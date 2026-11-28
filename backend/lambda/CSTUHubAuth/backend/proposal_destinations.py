"""Hand reviewed proposals to the normal business writers in a single transaction."""

from .admission_store import save
from .admissions import check_version
from .auth.session_service import AuthError, token_hash
from .business.validation import ACTIVITY_TYPES, calendar_day, identifier
from .http_api import headers, session_cookie
from .permissions.gateway import body, WriteConditions
from .permissions.policy import allowed_roles, can_reference, matching_roles, validate_fields
from .proposal_workflow import advance, stamp, visible

KINDS = {'activity': 'activity', 'exchange': 'exchange', 'mou': 'agreement'}
INTERNAL = {'coordinator', 'staff', 'executive'}


def visible_destination(repo, ctx, row):
    """A board reader may not have internal read rights on an assigned business record."""
    link = row.get('destination')
    if not link or not visible(ctx, row) or link.get('kind') != KINDS.get(row.get('kind')):
        return None
    target = repo.get(link['kind'], link.get('id'))
    if (not target or target.get('scopeId') != row['scopeId']
            or target.get('proposalId') != row['id']
            or not (allowed_roles(ctx, link['kind'], 'read', target) & INTERNAL)):
        return None
    return {**{k: target[k] for k in ('id', 'title', 'version', 'startDate', 'endDate') if k in target},
            'kind': link['kind']}


def visible_source(repo, ctx, target):
    kind = target['entityType']
    if not (allowed_roles(ctx, kind, 'read', target) & INTERNAL):
        return None
    source = repo.get('proposal', target.get('proposalId'))
    link = (source or {}).get('destination') or {}
    if (visible(ctx, source) and source['scopeId'] == target['scopeId'] and link.get('kind') == kind
            and link.get('id') == target['id'] and KINDS.get(source.get('kind')) == kind):
        return source['id']
    return None


def manages_destination(ctx, row):
    roles = matching_roles(ctx, row) & INTERNAL
    return bool(roles and (ctx.user.user_id in {row['createdBy'], row.get('hostId')}
                or (row['kind'] == 'mou' and roles & {'staff', 'executive'})))


def ready(row):
    return (row['status'] in {'signing', 'signed'} and bool(row.get('approvedRevision'))
            if row['kind'] == 'mou' else row['status'] == 'closed')


def can_create(ctx, row):
    if not ready(row) or row.get('destination') or not manages_destination(ctx, row):
        return False
    # The original coordinator creation policy assigns only that coordinator.
    return (not row.get('hostId') or row['hostId'] == ctx.user.user_id
            or bool(matching_roles(ctx, row) & {'staff', 'executive'}))


def eligible_agreement(ctx, row, target):
    return bool(target and target.get('agreementType') == 'MoU'
                and target.get('scopeId') == row['scopeId'] and not target.get('proposalId')
                and (not row.get('partnerId') or row['partnerId'] in (target.get('partnerIds') or []))
                and allowed_roles(ctx, 'agreement', 'update', target))


def can_sign(repo, ctx, row):
    if row.get('kind') != 'mou' or row.get('status') != 'signing' or not manages_destination(ctx, row):
        return False
    link = row.get('destination')
    if not link:
        return True
    target = repo.get('agreement', link.get('id'))
    return bool(link.get('kind') == 'agreement' and target and target['scopeId'] == row['scopeId']
                and target.get('proposalId') == row['id'] and allowed_roles(ctx, 'agreement', 'update', target))


def preview(repo, ctx, row):
    create = can_create(ctx, row)
    link = row['kind'] == 'mou' and ready(row) and not row.get('destination') and manages_destination(ctx, row)
    partners = [{'id': p['id'], 'name': p['name']} for p in repo.list('partner', ctx)
                if p.get('name') and p.get('source_state') != 'retired'
                and can_reference(ctx, p, row['scopeId'])] if create else []
    agreements = [{k: a[k] for k in ('id', 'title', 'version', 'startDate', 'endDate') if k in a}
                  for a in repo.list('agreement', ctx) if eligible_agreement(ctx, row, a)] if link else []
    return {
        'kind': KINDS[row['kind']], 'title': row['title'], 'summary': row['summary'],
        'partnerName': row.get('partner', ''), 'partnerType': row.get('partnerType'),
        'partnerId': row.get('partnerId') or '', 'hostName': row.get('hostName') or ctx.user.display_name,
        'canCreate': create, 'canLink': link, 'partners': sorted(partners, key=lambda p: p['name']),
        'agreements': sorted(agreements, key=lambda a: a['title']),
        'destination': visible_destination(repo, ctx, row),
    }


def field_set(data, expected):
    if set(data) != set(expected):
        raise AuthError('INVALID_FIELDS', 422)


def positive(value):
    if type(value) is not int or value < 1:
        raise AuthError('INVALID_FIELDS', 422)
    return value


def write_target(repo, event, ctx, row, after, kind, fields, record=None, guards=()):
    """Run the same field policy, domain validators and transactional reference checks as the detail editor."""
    action = 'update' if record else 'create'
    data = validate_fields(ctx, kind, action, fields, record)
    conditions = WriteConditions(ctx.user.user_id, ctx.user.authz_version, token_hash(session_cookie(event)),
                                 record['id'] if record else None, record['version'] if record else None,
                                 None, None, row['scopeId'])
    repo.mutate(kind, action, data, record, None, conditions, None, proposal_change=(row, after, guards))
    return after


def destination_input(data, kind):
    if data.get('mode') == 'link' and kind == 'agreement':
        field_set(data, {'mode', 'agreementId', 'agreementVersion'} | ({'confirmDates'} & data.keys()))
        if 'confirmDates' in data and type(data['confirmDates']) is not bool:
            raise AuthError('INVALID_FIELDS', 422)
        positive(data['agreementVersion'])
        return {'mode': 'link', 'agreementId': identifier(data['agreementId'])}
    if data.get('mode') != 'create':
        raise AuthError('INVALID_FIELDS', 422)
    field_set(data, {'mode', 'title', 'partnerId'} | ({'activityType'} if kind == 'activity' else set()))
    title = data['title']
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 200:
        raise AuthError('INVALID_FIELDS', 422)
    request = {'mode': 'create', 'title': title.strip(), 'partnerId': identifier(data['partnerId'])}
    if kind == 'activity':
        if not isinstance(data['activityType'], str) or data['activityType'] not in ACTIVITY_TYPES:
            raise AuthError('INVALID_FIELDS', 422)
        request['activityType'] = data['activityType']
    return request


def destination_replay(row, request):
    if row.get('destination'):
        if row.get('destinationRequest') == request:
            return row
        raise AuthError('PROPOSAL_ALREADY_LINKED', 409)
    return None


def create_fields(ctx, row, request):
    fields = {'scopeId': row['scopeId'], 'title': request['title']}
    if matching_roles(ctx, row) & {'staff', 'executive'}:
        fields['responsibleUserIds'] = [row.get('hostId') or ctx.user.user_id]
    if row['kind'] == 'activity':
        fields.update(type=request['activityType'], partnerId=request['partnerId'], summary=row['summary'])
    else:
        fields['partnerIds'] = [request['partnerId']]
        if row['kind'] == 'exchange':
            fields['supportingInfo'] = row['summary']
        else:
            fields['agreementType'] = 'MoU'
            if row.get('signed'):
                fields.update(startDate=row['signed']['startDate'], endDate=row['signed']['endDate'])
    return fields


def registered_period(record, signed, data):
    fields = {k: signed[k] for k in ('startDate', 'endDate')}
    if any(record.get(k) and record[k] != v for k, v in fields.items()) and data.get('confirmDates') is not True:
        raise AuthError('AGREEMENT_DATES_CONFIRMATION_REQUIRED', 409)
    return fields


def destination(event, repo, ctx, row, method):
    if method == 'GET':
        return preview(repo, ctx, row)
    if method != 'POST':
        raise AuthError('METHOD_NOT_ALLOWED', 405)
    if not manages_destination(ctx, row):
        raise AuthError('FORBIDDEN', 403)
    kind = KINDS[row['kind']]
    data = body(event)
    request = destination_input(data, kind)
    replay = destination_replay(row, request)
    if replay:
        return replay
    check_version(event, row)
    if not ready(row):
        raise AuthError('PROPOSAL_NOT_READY', 409)
    after = advance(row, 'destination', row['status'], ctx.user, stamp(repo.clock()), revision=row.get('approvedRevision'))
    after['destinationRequest'] = request
    record = None
    if request['mode'] == 'link':
        record = repo.get('agreement', request['agreementId'])
        if not eligible_agreement(ctx, row, record):
            raise AuthError('INVALID_REFERENCE', 422)
        if record['version'] != data['agreementVersion']:
            raise AuthError('VERSION_CONFLICT', 409)
        fields = (registered_period(record, row['signed'], data) if row.get('signed')
                  else {'title': record['title']})
    else:
        if not can_create(ctx, row):
            raise AuthError('FORBIDDEN', 403)
        fields = create_fields(ctx, row, request)
    try:
        return write_target(repo, event, ctx, row, after, kind, fields, record)
    except AuthError as error:
        if error.code == 'VERSION_CONFLICT':
            latest = repo.get('proposal', row['id'])
            if latest and destination_replay(latest, request):
                return latest
        raise


def signing(event, repo, ctx, row):
    if row['kind'] != 'mou' or not manages_destination(ctx, row):
        raise AuthError('FORBIDDEN', 403)
    data = body(event)
    required = {'revision', 'evidenceId', 'signedOn', 'startDate', 'endDate'}
    field_set(data, required | ({'agreementVersion', 'confirmDates'} & data.keys()))
    if 'confirmDates' in data and type(data['confirmDates']) is not bool:
        raise AuthError('INVALID_FIELDS', 422)
    if 'agreementVersion' in data:
        positive(data['agreementVersion'])
    positive(data['revision'])
    identifier(data['evidenceId'])
    for k in ('signedOn', 'startDate', 'endDate'):
        calendar_day(data[k])
    if data['endDate'] < data['startDate']:
        raise AuthError('INVALID_FIELDS', 422)
    signature = {k: data[k] for k in required}
    if row.get('signed'):
        if all(row['signed'].get(k) == v for k, v in signature.items()):
            return row
        raise AuthError('PROPOSAL_ALREADY_SIGNED', 409)
    check_version(event, row)
    if row.get('status') != 'signing' or row.get('approvedRevision') != data['revision']:
        raise AuthError('PROPOSAL_NOT_READY', 409)
    if not can_sign(repo, ctx, row):
        raise AuthError('FORBIDDEN', 403)
    evidence = repo.get('proposalFile', data['evidenceId'])
    if (not evidence or evidence.get('parentType') != 'proposal' or evidence.get('parentId') != row['id']
            or evidence.get('scopeId') != row['scopeId'] or evidence.get('purpose') != 'evidence'
            or not any(f['id'] == evidence['id'] and f.get('purpose') == 'evidence' for f in row.get('files', []))):
        raise AuthError('INVALID_REFERENCE', 422)
    now = stamp(repo.clock())
    after = advance(row, 'sign', 'signed', ctx.user, now, revision=data['revision'])
    after['signed'] = dict(signature, actor=ctx.user.display_name, actorId=ctx.user.user_id, at=now)
    link = row.get('destination')
    try:
        if link:
            target = repo.get('agreement', link['id'])
            if not target or 'agreementVersion' not in data or data['agreementVersion'] != target['version']:
                raise AuthError('VERSION_CONFLICT', 409)
            return write_target(repo, event, ctx, row, after, 'agreement',
                                registered_period(target, signature, data), target, guards=[evidence])
        if 'agreementVersion' in data:
            raise AuthError('VERSION_CONFLICT', 409)
        save(repo, event, ctx.user, row['scopeId'], guards=[evidence], changes=[(row, after)])
        return after
    except AuthError as error:
        if error.code == 'VERSION_CONFLICT':
            latest = repo.get('proposal', row['id']) or {}
            if all((latest.get('signed') or {}).get(k) == v for k, v in signature.items()):
                return latest
        raise


def handle_destination(event, repo, ctx, row, action, method):
    if not (matching_roles(ctx, row) & INTERNAL):
        raise AuthError('NOT_FOUND', 404)
    if method == 'POST' and not headers(event).get('if-match'):
        raise AuthError('PRECONDITION_REQUIRED', 428)
    if row.get('kind') not in KINDS:
        raise AuthError('PROPOSAL_NOT_READY', 409)
    if action == 'destination':
        return destination(event, repo, ctx, row, method)
    if action == 'signing' and method == 'POST':
        return signing(event, repo, ctx, row)
    raise AuthError('METHOD_NOT_ALLOWED', 405)
