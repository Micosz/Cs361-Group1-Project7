"""Public notices and the scoped exchange projects that own them."""

from datetime import datetime
import hashlib
import re
from urllib.parse import urlsplit

from .auth.session_service import AuthError
from .http_api import headers
from .permissions.gateway import body
from .permissions.policy import require_record
from .relationships.activity_links import LinkError, public_links
from .admission_store import indexed, save

ROUND = 'exchangeRound'
APPLICATION = 'exchangeApplication'
OWNER_LINK = 'exchangeApplicationOwner'
PUBLIC_FIELDS = (
    'id',
    'activityId',
    'title',
    'eligibility',
    'capacity',
    'opensAt',
    'closesAt',
    'resultsAt',
    'noticeEndsAt',
    'confirmBy',
    'channel',
    'officeName',
    'officeUrl',
    'needsConfirmation',
    'needsPartner',
    'question',
)


def identifier(prefix, *parts):
    return prefix + '-' + hashlib.sha256('\0'.join(parts).encode()).hexdigest()


def text_field(value, maximum, required=True):
    if not isinstance(value, str) or len(value.strip()) > maximum or (required and not value.strip()):
        raise AuthError('INVALID_FIELDS', 422)
    return value.strip()


def timestamp(value):
    if not isinstance(value, str) or len(value) > 32:
        raise AuthError('INVALID_DATES', 422)
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if dt.tzinfo is None or dt.microsecond or not 2000 <= dt.year <= 2100:
            raise ValueError()
        return int(dt.timestamp())
    except (ValueError, OverflowError):
        raise AuthError('INVALID_DATES', 422) from None


def validate_round(payload):
    required = {
        'activityId',
        'partnerId',
        'title',
        'eligibility',
        'capacity',
        'opensAt',
        'closesAt',
        'resultsAt',
        'noticeEndsAt',
        'channel',
        'needsConfirmation',
        'needsPartner',
    }
    if not required <= set(payload) <= required | {'confirmBy', 'officeUrl', 'officeName', 'question'}:
        raise AuthError('INVALID_FIELDS', 422)
    out = {
        k: text_field(payload[k], n)
        for k, n in [('title', 160), ('activityId', 200), ('partnerId', 200), ('eligibility', 1600)]
    }
    for k in ('needsConfirmation', 'needsPartner'):
        if type(payload[k]) is not bool:
            raise AuthError('INVALID_FIELDS', 422)
        out[k] = payload[k]
    if type(payload['capacity']) is not int or not 1 <= payload['capacity'] <= 200:
        raise AuthError('INVALID_FIELDS', 422)
    out['capacity'] = payload['capacity']
    for k in ('opensAt', 'closesAt', 'resultsAt', 'noticeEndsAt'):
        out[k] = timestamp(payload[k])
    if not out['opensAt'] < out['closesAt'] <= out['resultsAt'] < out['noticeEndsAt']:
        raise AuthError('INVALID_DATES', 422)
    out['channel'] = payload['channel']
    if out['channel'] not in ('department', 'official'):
        raise AuthError('INVALID_FIELDS', 422)
    out['question'] = text_field(payload.get('question', ''), 300, False)
    out['officeName'] = text_field(payload.get('officeName', ''), 120, False)
    out['officeUrl'] = text_field(payload.get('officeUrl', ''), 600, False)
    if out['officeName'] or out['officeUrl'] or out['channel'] == 'official':
        try:
            url = urlsplit(out['officeUrl'])
            if (
                url.scheme != 'https'
                or not url.hostname
                or url.username
                or url.password
                or not out['officeName']
            ):
                raise ValueError()
        except ValueError:
            raise AuthError('INVALID_FIELDS', 422) from None
    if out['channel'] == 'official' and (out['needsConfirmation'] or out['needsPartner'] or out['question']):
        raise AuthError('INVALID_FIELDS', 422)
    out['confirmBy'] = timestamp(payload['confirmBy']) if payload.get('confirmBy') else None
    if bool(out['confirmBy']) != out['needsConfirmation'] or (
        out['confirmBy'] and out['confirmBy'] <= out['resultsAt']
    ):
        raise AuthError('INVALID_DATES', 422)
    return out


def manager(repo, ctx, project_id):
    project = repo.get('exchange', project_id)
    if not project:
        raise AuthError('NOT_FOUND', 404)
    require_record(ctx, 'exchange', 'update', project)
    return project


def linked_partners(repo, project, activity):
    partners, _ = relation(repo, project, activity)
    return partners


def relation(repo, project, activity):
    if (
        not activity
        or activity.get('scopeId') != project['scopeId']
        or activity.get('source_state') == 'retired'
        or not isinstance(activity.get('version'), int)
    ):
        return [], {}
    snapshots = {}

    def read(kind, key):
        if key not in snapshots:
            snapshots[key] = repo.get(kind, key)
        return snapshots[key]

    try:
        links = public_links(activity, get_record=read)
    except LinkError:
        return [], {}
    if not links:
        return [], {}
    ids = set(project.get('partnerIds', []))
    matches = [p for p in [links['partner'], *links['coHosts']] if p['id'] in ids]
    return matches, snapshots


def public_references(repo, project, activity, partner_id):
    matches, snapshots = relation(repo, project, activity)
    if not any(p['id'] == partner_id for p in matches):
        return []
    rows = [activity] + [snapshots[k] for k in {partner_id, activity['partnerId']}]
    return rows if all(isinstance(r.get('version'), int) for r in rows) else []


def phase(row, now):
    if now < row['opensAt']:
        return 'scheduled'
    return 'open' if now < row['closesAt'] else 'closed'


def notice(row, partner, now):
    return {**{k: row[k] for k in PUBLIC_FIELDS}, 'partner': partner, 'phase': phase(row, now)}


def for_activity(repo, activity_id, now):
    activity = repo.get('activity', activity_id)
    if not activity or not activity.get('scopeId'):
        return []
    rows = indexed(repo, activity['scopeId'] + '#' + ROUND, ROUND)
    notices = []
    for row in rows:
        if row['activityId'] != activity_id or row['scopeId'] != activity['scopeId']:
            continue
        project = repo.get('exchange', row['exchangeId'])
        partner = (
            next((p for p in linked_partners(repo, project, activity) if p['id'] == row['partnerId']), None)
            if project
            else None
        )
        if partner:
            notices.append(notice(row, partner, now))
    return sorted(notices, key=lambda r: (r['opensAt'], r['id']))


def for_manager(repo, ctx, project, now):
    choices = []
    for activity in repo.list('activity', ctx):
        partners = linked_partners(repo, project, activity)
        if partners:
            choices.append({'id': activity['id'], 'title': activity['title'], 'partners': partners})
    rows = indexed(repo, project['scopeId'] + '#' + ROUND, ROUND)
    rounds = [
        dict(
            id=r['id'],
            title=r['title'],
            activityId=r['activityId'],
            capacity=r['capacity'],
            phase=phase(r, now),
        )
        for r in rows
        if r['exchangeId'] == project['id']
    ]
    return {
        'activities': sorted(choices, key=lambda a: (a['title'], a['id'])),
        'rounds': sorted(rounds, key=lambda r: (r['title'], r['id'])),
    }


def create(repo, event, ctx, project):
    data = validate_round(body(event))
    key = headers(event).get('idempotency-key', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', key):
        raise AuthError('INVALID_IDEMPOTENCY_KEY', 422)
    rid = identifier('round', project['id'], ctx.user.user_id, key)
    old = repo.get(ROUND, rid)
    if old:
        if any(old.get(k) != v for k, v in data.items()):
            raise AuthError('IDEMPOTENCY_CONFLICT', 409)
        return {'id': rid, 'title': old['title']}
    if project.get('status') in ('completed', 'cancelled'):
        raise AuthError('PROJECT_CLOSED', 409)
    activity = repo.get('activity', data['activityId'])
    refs = public_references(repo, project, activity, data['partnerId'])
    if not refs:
        raise AuthError('INVALID_REFERENCE', 422)
    guards = [project, *refs]
    row = dict(
        data,
        id=rid,
        entityType=ROUND,
        scopeId=project['scopeId'],
        exchangeId=project['id'],
        scopeEntity=project['scopeId'] + '#' + ROUND,
        version=1,
        accepted=0,
        createdBy=ctx.user.user_id,
        createdAt=int(repo.clock()),
    )
    save(
        repo,
        event,
        ctx.user,
        row['scopeId'],
        guards=guards,
        changes=[(None, row)],
        window=(0, row['closesAt'], 'ROUND_CLOSED'),
    )
    return {'id': rid, 'title': row['title']}
