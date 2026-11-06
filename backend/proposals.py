"""Internal proposal board. An interest is voluntary, scoped, and belongs to the session user."""
from datetime import date, datetime, timedelta, timezone
import hashlib
import re

from .auth.require_session import require_session
from .auth.session_service import AuthError, token_hash
from .http_api import headers, response, session_cookie
from .permissions.gateway import body, WriteConditions
from .permissions.transactions import transaction_checks, values

BANGKOK = timezone(timedelta(hours=7))
INTERNAL = {'coordinator', 'staff', 'executive'}


def present(row, uid):
    members = row['members']
    return {**{key: row[key] for key in ('id', 'scopeId', 'title', 'partner', 'summary',
                                         'deadline', 'createdAt', 'creator')},
            'interested': sorted(members.values()), 'mine': uid in members}


def commit(repo, actor, session_hash, scope, write, now):
    conditions = WriteConditions(actor.user_id, actor.authz_version, session_hash,
                                 None, None, None, None, scope)
    checks = transaction_checks(conditions, user_table=repo.users, session_table=repo.sessions,
                                business_table=repo.table, now=int(now.timestamp()))
    try:
        repo.client.transact_write_items(TransactItems=[*checks, write])
    except Exception as exc:
        if getattr(exc, 'response', {}).get('Error', {}).get('Code') == 'TransactionCanceledException':
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
               {'Put': {'TableName':repo.table, 'Item': values(row),
                        'ConditionExpression':'attribute_not_exists(id)'}}, now)
    except AuthError as exc:
        existing = repo.get('proposal', key)
        if exc.code == 'VERSION_CONFLICT' and existing:
            return replay(existing)
        raise
    return row


def interest(event, repo, user, scopes, key, now):
    row = repo.get('proposal', key)
    if not row or row['scopeId'] not in scopes:
        raise AuthError('NOT_FOUND', 404)
    payload = body(event)
    if set(payload) != {'interested'} or type(payload['interested']) is not bool:
        raise AuthError('INVALID_FIELDS', 422)
    if row['deadline'] < now.date().isoformat():
        raise AuthError('PROPOSAL_CLOSED', 409)
    names = {'#kind':'entityType', '#scope':'scopeId', '#people':'members',
             '#uid':user.user_id, '#until':'deadline'}
    args = {':kind':'proposal', ':scope':row['scopeId'], ':today':now.date().isoformat()}
    condition = '#kind = :kind AND #scope = :scope AND #until >= :today'
    update = 'REMOVE #people.#uid'
    if payload['interested']:
        args[':name'] = user.display_name or 'ผู้ใช้งานภายใน'
        args[':cap'] = 500
        condition += ' AND (attribute_exists(#people.#uid) OR size(#people) < :cap)'
        update = 'SET #people.#uid = :name'
    commit(repo, user, token_hash(session_cookie(event)), row['scopeId'],
           {'Update': {'TableName':repo.table, 'Key':values({'id':key}),
                       'UpdateExpression':update, 'ConditionExpression':condition,
                       'ExpressionAttributeNames':names, 'ExpressionAttributeValues':values(args)}}, now)
    return repo.get('proposal', key)


def handle(event, sessions, repo, interest_id):
    ctx = require_session(event, sessions)
    scopes = {g['scopeId'] for g in ctx.user.permissions()[0] if g['role'] in INTERNAL}
    if not scopes:
        raise AuthError('FORBIDDEN', 403)
    if not repo:
        raise AuthError('PERMISSION_UNAVAILABLE', 503)
    if event.get('queryStringParameters'):
        raise AuthError('INVALID_QUERY', 422)
    method = event['requestContext']['http']['method']
    now = datetime.fromtimestamp(repo.clock(), BANGKOK)
    uid = ctx.user.user_id
    status = 200
    if method == 'GET' and not interest_id:
        rows = sorted((row for row in repo.list('proposal', ctx) if row['scopeId'] in scopes),
                      key=lambda r: (r['createdAt'], r['id']), reverse=True)
        data = [present(row, uid) for row in rows]
    elif method == 'POST' and not interest_id:
        data, status = present(create(event, repo, ctx.user, scopes, now), uid), 201
    elif method == 'PUT' and interest_id:
        data = present(interest(event, repo, ctx.user, scopes, interest_id, now), uid)
    else:
        raise AuthError('METHOD_NOT_ALLOWED', 405)
    require_session(event, sessions)
    return response(status, {'data':data})
