"""Scoped proposal state, exact closing instants, and version-bound MoU decisions."""
from datetime import datetime
import hashlib
import hmac
import json
import re
from urllib.parse import urlsplit

from .admission_store import save
from .auth.session_service import AuthError
from .business.validation import identifier
from .http_api import headers
from .permissions.policy import matching_roles, require_reference
from .proposals import BANGKOK, INTERNAL


def stamp(seconds):
    return datetime.fromtimestamp(int(seconds), BANGKOK).isoformat()


def require(condition, code='INVALID_FIELDS', status=422):
    if not condition:
        raise AuthError(code, status)


def text_value(value, maximum, required=True):
    require(isinstance(value, str))
    value = value.strip()
    require(len(value) <= maximum and (not required or bool(value)))
    return value


def web_link(value):
    value = text_value(value, 1200, False)
    if value:
        try:
            url = urlsplit(value)
            url.port  # Validate malformed or out-of-range ports.
            require(url.scheme in ('https', 'http') and url.hostname and url.username is None and url.password is None
                    and all(not c.isspace() and ord(c) >= 32 for c in value))
        except ValueError:
            raise AuthError('INVALID_FIELDS', 422) from None
    return value


def object_id(prefix, *parts):
    return prefix + '-' + hashlib.sha256('\0'.join(parts).encode()).hexdigest()


def digest(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False).encode()).hexdigest()


def preview_signature(sessions, user, days, closes_at):
    data = json.dumps(['proposal-deadline-v1', user.user_id, days, closes_at], separators=(',', ':')).encode()
    return hmac.new(sessions.policy.csrf_secret, data, 'sha256').hexdigest()


def preview(sessions, user, days, now):
    require(type(days) is int and 1 <= days <= 365)
    closes_at = stamp(now + days * 86400)
    return dict(openDays=days, closesAt=closes_at,
                confirmation=preview_signature(sessions, user, days, closes_at))


def deadline(payload, sessions, user, now):
    days, closes, proof = (payload.get(k) for k in ('openDays', 'closesAt', 'confirmation'))
    require(type(days) is int and 1 <= days <= 365 and isinstance(closes, str) and len(closes) <= 32)
    require(isinstance(proof, str) and re.fullmatch(r'[a-f0-9]{64}', proof)
            and hmac.compare_digest(proof, preview_signature(sessions, user, days, closes)),
            'INVALID_DEADLINE', 422)
    until = int(datetime.fromisoformat(closes).timestamp())
    require(now < until, 'PROPOSAL_CLOSED', 409)
    return dict(openDays=days, closesAt=closes, closesEpoch=until, deadline=closes[:10])


def history_event(row, action, status, actor, at, note='', revision=None):
    entry = dict(action=action, status=status, actor=actor, at=at, note=note)
    if revision is not None:
        entry['revision'] = revision
    return entry


def advance(row, action, status, user, at, note='', revision=None, **fields):
    entry = history_event(row, action, status, user.display_name, at, note, revision)
    entry['actorId'] = user.user_id
    return dict(row, **fields, status=status, version=row['version'] + 1, updatedAt=at,
                history=[*row['history'], entry])


def visible(ctx, row):
    if not row or not matching_roles(ctx, row) & INTERNAL:
        return False
    if row.get('source') == 'direct' and row['createdBy'] != ctx.user.user_id:
        return row['status'] != 'draft' and 'executive' in matching_roles(ctx, row)
    return True


def is_owner(ctx, row):
    return row['createdBy'] == ctx.user.user_id


def require_owner(ctx, row):
    require(is_owner(ctx, row), 'FORBIDDEN', 403)


def may_decide(ctx, row):
    return 'executive' in matching_roles(ctx, row) and not is_owner(ctx, row)


def may_record_evidence(ctx, row):
    return (is_owner(ctx, row) or ctx.user.user_id == row.get('hostId')
            or bool(matching_roles(ctx, row) & {'staff', 'executive'}))


def submitted_revisions(row):
    return {e['revision'] for e in row['history'] if e['action'] in ('submit', 'auto-submit')}


def file_visible(ctx, row, entry, submitted=None):
    purpose = entry['purpose']
    if purpose == 'support':
        return True
    if purpose == 'evidence':
        return may_record_evidence(ctx, row)
    return is_owner(ctx, row) or (may_decide(ctx, row) and
        entry.get('revision') in (submitted if submitted is not None else submitted_revisions(row)))


def create(event, sessions, repo, ctx, payload):
    user, now = ctx.user, int(repo.clock())
    idem = headers(event).get('idempotency-key', '')
    require(isinstance(idem, str) and re.fullmatch(r'[A-Za-z0-9_-]{16,128}', idem),
            'INVALID_IDEMPOTENCY_KEY', 422)
    key, checksum = object_id('proposal', user.user_id, idem), digest(payload)
    scope = identifier(payload.get('scopeId'))
    require(matching_roles(ctx, {'scopeId': scope}) & INTERNAL, 'FORBIDDEN', 403)

    def replay(existing):
        require(existing.get('createdBy') == user.user_id and existing.get('requestHash') == checksum,
                'IDEMPOTENCY_CONFLICT', 409)
        return existing

    existing = repo.get('proposal', key)
    if existing:
        return replay(existing)
    kind, source, stage = (payload.get(k) for k in ('kind', 'source', 'stage'))
    require(kind in ('activity', 'exchange', 'mou') and source in ('board', 'direct')
            and (source != 'direct' or kind == 'mou') and stage in ('idea', 'contacted', 'planning'))
    ptype = payload.get('partnerType')
    require(ptype in ('existing', 'organization', 'person'))
    fields = {'scopeId', 'kind', 'source', 'stage', 'title', 'summary', 'partnerType', 'hostSelf'}
    fields.add('partnerId' if ptype == 'existing' else 'partner')
    if source == 'board':
        fields.update(('openDays', 'closesAt', 'confirmation'))
    require(fields <= set(payload) <= fields | {'supportLink'})
    require(type(payload['hostSelf']) is bool)
    timing = deadline(payload, sessions, user, now) if source == 'board' else {}
    refs = []
    if ptype == 'existing':
        partner = repo.get('partner', identifier(payload['partnerId']))
        require_reference(ctx, partner, scope)
        require(partner.get('source_state') != 'retired' and type(partner.get('version')) is int,
                'INVALID_REFERENCE', 422)
        partner_name = partner.get('name') or partner.get('title')
        require(isinstance(partner_name, str) and partner_name.strip(), 'INVALID_REFERENCE', 422)
        refs.append(partner)
    else:
        partner_name = text_value(payload['partner'], 150)
    at = stamp(now)
    status = 'open' if source == 'board' else 'draft'
    row = dict(timing, id=key, entityType='proposal', scopeEntity=scope + '#proposal', scopeId=scope,
               version=1, kind=kind, source=source, stage=stage, title=text_value(payload['title'], 150),
               summary=text_value(payload['summary'], 2000), partnerType=ptype, partner=partner_name,
               supportLink=web_link(payload.get('supportLink', '')), status=status, createdBy=user.user_id,
               creator=user.display_name, createdAt=at, updatedAt=at, requestHash=checksum,
               files=[], history=[], interestCount=0, notedCount=0)
    if refs:
        row['partnerId'] = refs[0]['id']
    if payload['hostSelf']:
        row.update(hostId=user.user_id, hostName=user.display_name)
    row['history'].append(dict(history_event(row, 'create', status, user.display_name, at), actorId=user.user_id))
    try:
        save(repo, event, user, scope, guards=refs, changes=[(None, row)])
    except AuthError as exc:
        stored = repo.get('proposal', key) if exc.code == 'VERSION_CONFLICT' else None
        if stored:
            return replay(stored)
        raise
    return row


def reconcile(event, repo, ctx, row):
    """Execute only the owner's persisted consent. A reader's role never authorizes a decision."""
    for _ in range(3):
        if row.get('status') != 'open' or int(repo.clock()) < row['closesEpoch']:
            return row
        at = row['closesAt']
        history = [*row['history'], history_event(row, 'close', 'closed', 'ระบบ', at)]
        new = dict(row, status='closed', closedAt=at, updatedAt=at, version=row['version'] + 1,
                   history=history)
        revision = row.get('autoRevision')
        if row['kind'] == 'mou' and revision is not None:
            new.update(status='review', submittedAt=at, submittedRevision=revision)
            history.append(dict(history_event(row, 'auto-submit', 'review', 'ระบบ', at, revision=revision),
                                confirmedBy=row['autoConfirmedBy'], confirmedAt=row['autoConfirmedAt']))
        try:
            save(repo, event, ctx.user, row['scopeId'], guards=[], changes=[(row, new)])
            return new
        except AuthError as exc:
            if exc.code != 'VERSION_CONFLICT':
                raise
            row = repo.get('proposal', row['id'])
            require(visible(ctx, row), 'NOT_FOUND', 404)
    raise AuthError('VERSION_CONFLICT', 409)


def edit(event, repo, ctx, row, payload):
    require_owner(ctx, row)
    require(row['status'] in ('open', 'draft', 'changes'), 'INVALID_TRANSITION', 409)
    require(payload and set(payload) <= {'title', 'summary', 'stage', 'supportLink'})
    updated = {}
    if 'stage' in payload:
        require(payload['stage'] in ('idea', 'contacted', 'planning'))
        updated['stage'] = payload['stage']
    if 'supportLink' in payload:
        updated['supportLink'] = web_link(payload['supportLink'])
    for key, cap in (('title', 150), ('summary', 2000)):
        if key in payload:
            updated[key] = text_value(payload[key], cap)
    new = advance(row, 'edit', row['status'], ctx.user, stamp(repo.clock()), **updated)
    window = (0, row['closesEpoch'], 'PROPOSAL_CLOSED') if row['status'] == 'open' else None
    save(repo, event, ctx.user, row['scopeId'], guards=[], changes=[(row, new)], window=window)
    return new


def workflow(event, repo, ctx, row, payload):
    action = payload.get('action')
    require(action in ('inform', 'auto', 'submit', 'return', 'approve'))
    expected = {'action'} if action == 'inform' else {'action', 'revision'}
    require(expected <= set(payload) <= expected | ({'note'} if action in ('submit', 'return') else set()))
    status, at = row['status'], stamp(repo.clock())
    if action in ('return', 'approve'):
        require(may_decide(ctx, row), 'FORBIDDEN', 403)
    else:
        require_owner(ctx, row)
    fields, note = {}, ''
    revision = payload.get('revision')
    if action == 'inform':
        require(row['source'] == 'board' and status in ('open', 'closed'), 'INVALID_TRANSITION', 409)
        if row.get('informedAt'):
            return row
        fields['informedAt'] = at
    else:
        require(row['kind'] == 'mou', 'INVALID_TRANSITION', 409)
        drafts = [f['revision'] for f in row['files'] if f['purpose'] == 'draft']
        clearing = action == 'auto' and revision is None
        require(clearing or type(revision) is int and revision in drafts, 'INVALID_REVISION', 422)
        if action == 'auto':
            require(row['source'] == 'board' and status == 'open', 'INVALID_TRANSITION', 409)
            if row.get('autoRevision') == revision:
                return row
            fields.update(autoRevision=revision, autoConfirmedBy=ctx.user.user_id, autoConfirmedAt=at)
        elif action == 'submit':
            require(status in ('draft', 'closed', 'changes'), 'INVALID_TRANSITION', 409)
            if status == 'changes':
                require(revision > row['resubmitAfterRevision'], 'NEW_REVISION_REQUIRED', 409)
                note = text_value(payload.get('note'), 1000)
            else:
                require(not payload.get('note'))
            status = 'review'
            fields.update(submittedRevision=revision, submittedAt=at)
        else:
            require(status == 'review', 'INVALID_TRANSITION', 409)
            require(revision == row.get('submittedRevision'), 'REVISION_CONFLICT', 409)
            if action == 'return':
                note = text_value(payload.get('note'), 1000)
                status = 'changes'
                # A file staged before this decision is not a revision responding to its reason.
                fields['resubmitAfterRevision'] = max(drafts)
            else:
                status = 'signing'
                fields['approvedRevision'] = revision
    new = advance(row, action, status, ctx.user, at, note, revision, **fields)
    window = (0, row['closesEpoch'], 'PROPOSAL_CLOSED') if row['status'] == 'open' else None
    save(repo, event, ctx.user, row['scopeId'], guards=[], changes=[(row, new)], window=window)
    return new
