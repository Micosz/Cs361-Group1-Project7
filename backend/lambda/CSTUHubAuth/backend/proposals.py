"""Compatibility with the original date-only board and its embedded volunteer roster."""
from datetime import date, datetime, timedelta, timezone
import hashlib
import re

from .auth.session_service import AuthError, token_hash
from .http_api import headers, session_cookie
from .permissions.gateway import body, WriteConditions
from .permissions.transactions import transaction_checks, values

BANGKOK = timezone(timedelta(hours=7))
INTERNAL = {'coordinator', 'staff', 'executive'}


def closes_epoch(row):
    # The original board accepted offers through the whole printed Bangkok date.
    after = date.fromisoformat(row['deadline']) + timedelta(days=1)
    return int(datetime.combine(after, datetime.min.time(), tzinfo=BANGKOK).timestamp())


def original_member(uid, stored):
    if stored is None:
        return None
    person = {'name': stored} if isinstance(stored, str) else stored
    return dict(userId=uid, name=person['name'], note=person.get('note', ''), interested=True)


def commit(repo, actor, session_hash, scope, writes, now):
    conditions = WriteConditions(actor.user_id, actor.authz_version, session_hash,
                                 None, None, None, None, scope)
    checks = transaction_checks(conditions, user_table=repo.users, session_table=repo.sessions,
                                business_table=repo.table, now=int(now.timestamp()))
    try:
        repo.client.transact_write_items(TransactItems=[*checks, *writes])
    except Exception as exc:
        if getattr(exc, 'response', {}).get('Error', {}).get('Code') in {'TransactionCanceledException', 'TransactionConflictException'}:
            raise AuthError('VERSION_CONFLICT', 409) from None
        raise


def create(event, repo, user, scopes, now):
    payload = body(event)
    fields = {'title': 150, 'partner': 150, 'summary': 2000, 'scopeId': 100, 'deadline': 10}
    if set(payload) != set(fields):
        raise AuthError('INVALID_FIELDS', 422)
    for key, limit in fields.items():
        value = payload[key]
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit:
            raise AuthError('INVALID_FIELDS', 422)
        payload[key] = value.strip()
    if payload['scopeId'] not in scopes:
        raise AuthError('FORBIDDEN', 403)
    try:
        deadline = date.fromisoformat(payload['deadline'])
        if deadline.isoformat() != payload['deadline']:
            raise ValueError()
    except ValueError:
        raise AuthError('INVALID_FIELDS', 422) from None
    idem = headers(event).get('idempotency-key', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', idem):
        raise AuthError('INVALID_IDEMPOTENCY_KEY', 422)
    key = 'proposal-' + hashlib.sha256((user.user_id+'\0'+idem).encode()).hexdigest()

    def replay(row):
        if any(row.get(k) != v for k,v in payload.items()) or row.get('createdBy') != user.user_id:
            raise AuthError('IDEMPOTENCY_CONFLICT', 409)
        return row

    existing = repo.get('proposal', key)
    if existing:
        return replay(existing)
    if deadline < now.date():
        raise AuthError('PROPOSAL_CLOSED', 409)
    row = dict(payload, id=key, entityType='proposal', scopeEntity=payload['scopeId']+'#proposal',
               createdBy=user.user_id, creator=user.display_name or 'ผู้ใช้งานภายใน',
               members={}, createdAt=now.isoformat())
    try:
        commit(repo, user, token_hash(session_cookie(event)), payload['scopeId'],
               [{'Put': {'TableName':repo.table, 'Item': values(row),
                        'ConditionExpression':'attribute_not_exists(id)'}}], now)
    except AuthError as exc:
        existing = repo.get('proposal', key)
        if exc.code == 'VERSION_CONFLICT' and existing:
            return replay(existing)
        raise
    return row


def save_interest(event, repo, ctx, row, new, changes):
    """Keep original embedded names; subsequent offers use the same independent records as new boards."""
    now = datetime.fromtimestamp(repo.clock(), BANGKOK)
    if now.timestamp() >= closes_epoch(row):
        raise AuthError('PROPOSAL_CLOSED', 409)
    names = {'#v': 'version', '#k': 'entityType', '#s': 'scopeId', '#m': 'members', '#until': 'deadline'}
    args = {':k': 'proposal', ':s': row['scopeId'], ':members': row['members'], ':until': row['deadline']}
    check = 'attribute_not_exists(#v)'
    if 'version' in row:
        check = '#v = :v'
        args[':v'] = row['version']
    check += ' AND #k = :k AND #s = :s AND #m = :members AND #until = :until'
    parent = dict(TableName=repo.table, Item=values(new), ConditionExpression=check,
                  ExpressionAttributeNames=names, ExpressionAttributeValues=values(args))
    from .admission_store import version_condition
    writes = [{'Put': parent}]
    for old, updated in changes:
        guard = version_condition(old) if old else {'ConditionExpression': 'attribute_not_exists(id)'}
        writes.append({'Put': dict(TableName=repo.table, Item=values(updated), **guard)})
    commit(repo, ctx.user, token_hash(session_cookie(event)), row['scopeId'], writes, now)
