"""DynamoDB transaction checks for adapters implementing PermissionGateway.mutate.

Use low-level boto3 TransactWriteItems. Target update MUST include target_condition
on the Update itself (DynamoDB forbids checking/updating the same item twice).
Feature validators still own values, references, transitions and idempotency.
"""

from boto3.dynamodb.types import TypeSerializer


def values(mapping):
    serializer = TypeSerializer()
    return {key: serializer.serialize(value) for key, value in mapping.items()}


def target_condition(conditions):
    if conditions.target_id is None or conditions.target_version is None:
        raise ValueError('An existing target version is required')
    return {
        'ConditionExpression': '#v = :v AND #s = :scope',
        'ExpressionAttributeNames': {'#v': 'version', '#s': 'scopeId'},
        'ExpressionAttributeValues': values({':v': conditions.target_version,
                                            ':scope': conditions.scope_id}),
    }


def transaction_checks(conditions, *, user_table, session_table, business_table, now):
    """Build checks to include beside the target Put/Update; never execute alone.

    All table keys use the physical #78 user/session contract and a feature table
    keyed by id. Adapter must map another layout explicitly, without weakening
    the version/scope checks. `now` is a trusted server timestamp in seconds.
    """
    if type(now) is not int:
        raise ValueError('Server time must be integer seconds')
    checks = [
        {'ConditionCheck': {
            'TableName': user_table, 'Key': values({'id': conditions.user_id}),
            'ConditionExpression': '#a = :yes AND #i = :yes AND #v = :v',
            'ExpressionAttributeNames': {'#a': 'active', '#i': 'identityVerified', '#v': 'authzVersion'},
            'ExpressionAttributeValues': values({':yes': True, ':v': conditions.authz_version}),
        }},
        {'ConditionCheck': {
            'TableName': session_table, 'Key': values({'tokenHash': conditions.session_hash}),
            'ConditionExpression': ('#u = :u AND #v = :v AND #e > :now AND #absolute > :now '
                                    'AND attribute_not_exists(#r)'),
            'ExpressionAttributeNames': {'#u': 'userId', '#v': 'authzVersion', '#e': 'expiresAt',
                                         '#absolute': 'absoluteExpiresAt', '#r': 'revokedAt'},
            'ExpressionAttributeValues': values({':u': conditions.user_id, ':v': conditions.authz_version,
                                                 ':now': now}),
        }},
    ]
    if conditions.parent_id is not None:
        if type(conditions.parent_version) is not int:
            raise ValueError('Parent version is required')
        checks.append({'ConditionCheck': {
            'TableName': business_table, 'Key': values({'id': conditions.parent_id}),
            'ConditionExpression': '#v = :v AND #s = :scope',
            'ExpressionAttributeNames': {'#v': 'version', '#s': 'scopeId'},
            'ExpressionAttributeValues': values({':v': conditions.parent_version, ':scope': conditions.scope_id}),
        }})
    return checks
