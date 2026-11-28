"""Transactions for admission records in the existing business table and scope GSI."""

from .auth.dynamo_accounts import decode
from .auth.session_service import AuthError, token_hash
from .http_api import session_cookie
from .permissions.gateway import WriteConditions
from .permissions.transactions import transaction_checks, values


def indexed(repo, partition, kind):
    rows = []
    query = dict(
        TableName=repo.table,
        IndexName=repo.index,
        ProjectionExpression='id',
        KeyConditionExpression='#partition = :partition',
        ExpressionAttributeNames={'#partition': 'scopeEntity'},
        ExpressionAttributeValues=values({':partition': partition}),
    )
    while True:
        page = repo.client.query(**query)
        for candidate in page.get('Items', []):
            row = repo.get(kind, decode(candidate)['id'])
            if row and row.get('scopeEntity') == partition:
                rows.append(row)
        if not page.get('LastEvaluatedKey'):
            return rows
        query['ExclusiveStartKey'] = page['LastEvaluatedKey']


def version_condition(row):
    return dict(
        ConditionExpression='#v = :v AND #s = :s AND #k = :k',
        ExpressionAttributeNames={'#v': 'version', '#s': 'scopeId', '#k': 'entityType'},
        ExpressionAttributeValues=values(
            {':v': row['version'], ':s': row['scopeId'], ':k': row['entityType']}
        ),
    )


def save(repo, event, actor, scope, *, guards, changes, window=None, enrollee=None):
    """Recheck the actor, references, versions and the trusted clock at the write boundary."""
    now = int(repo.clock())
    if window:
        start, end, reason = window
        if not start <= now < end:
            raise AuthError(reason, 409)
    c = WriteConditions(
        actor.user_id, actor.authz_version, token_hash(session_cookie(event)), None, None, None, None, scope
    )
    ops = transaction_checks(
        c, user_table=repo.users, session_table=repo.sessions, business_table=repo.table, now=now
    )
    if enrollee and enrollee.user_id != actor.user_id:
        ops.append(
            {
                'ConditionCheck': dict(
                    TableName=repo.users,
                    Key=values({'id': enrollee.user_id}),
                    ConditionExpression='#a = :yes AND #i = :yes AND #v = :v',
                    ExpressionAttributeNames={'#a': 'active', '#i': 'identityVerified', '#v': 'authzVersion'},
                    ExpressionAttributeValues=values({':yes': True, ':v': enrollee.authz_version}),
                )
            }
        )
    changed = {new['id'] for _, new in changes}
    for row in {r['id']: r for r in guards}.values():
        if row['id'] not in changed:
            kind = row['entityType']
            ops.append(
                {
                    'ConditionCheck': dict(
                        TableName=repo._table(kind), Key=repo._key(kind, row), **version_condition(row)
                    )
                }
            )
    for old, new in changes:
        check = version_condition(old) if old else {'ConditionExpression': 'attribute_not_exists(id)'}
        ops.append({'Put': dict(TableName=repo._table(new['entityType']), Item=values(new), **check)})
    try:
        repo.client.transact_write_items(TransactItems=ops)
    except Exception as exc:
        error = getattr(exc, 'response', {}).get('Error', {}).get('Code')
        if error in {'TransactionCanceledException', 'TransactionConflictException'}:
            raise AuthError('VERSION_CONFLICT', 409) from None
        raise
