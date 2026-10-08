"""Authoritative #76/#77 storage; no table creation or automatic migration."""
import hashlib
import hmac
import time
from boto3.dynamodb.types import TypeSerializer, TypeDeserializer
from .session_service import AuthError
from .session_store import _integers
from ..permissions.transactions import values


def decode(item):
    return _integers({k: TypeDeserializer().deserialize(v) for k, v in item.items()}) if item else None


class DynamoAccounts:
    def __init__(self, client, users, identities, sessions):
        if len({users, identities, sessions}) != 3 or not all((users, identities, sessions)):
            raise ValueError('Separate auth tables required')
        self.client, self.users, self.identities, self.sessions = client, users, identities, sessions

    def user(self, user_id):
        return decode(self.client.get_item(TableName=self.users,
            Key=values({'id': user_id}), ConsistentRead=True).get('Item'))

    def pair(self, subject):
        link = decode(self.client.get_item(TableName=self.identities,
            Key=values({'subjectKey': subject}), ConsistentRead=True).get('Item'))
        if not link:
            return None
        if not isinstance(link.get('userId'), str):
            raise AuthError('IDENTITY_REVIEW_REQUIRED', 409)
        result = self.client.transact_get_items(TransactItems=[
            {'Get': {'TableName': self.identities, 'Key': values({'subjectKey': subject})}},
            {'Get': {'TableName': self.users, 'Key': values({'id': link['userId']})}},
        ])['Responses']
        return tuple(decode(item.get('Item')) for item in result)

    def create_pair(self, user, link):
        try:
            self.client.transact_write_items(TransactItems=[
                {'Put': {'TableName': self.identities, 'Item': values(link),
                         'ConditionExpression': 'attribute_not_exists(subjectKey)'}},
                {'Put': {'TableName': self.users, 'Item': values(user),
                         'ConditionExpression': 'attribute_not_exists(id)'}},
            ])
            return True
        except Exception as error:
            info = getattr(error, 'response', {})
            reasons = info.get('CancellationReasons', [])
            if (info.get('Error', {}).get('Code') == 'TransactionCanceledException'
                    and reasons and reasons[0].get('Code') == 'ConditionalCheckFailed'
                    and all(r.get('Code') in {'None', 'ConditionalCheckFailed'} for r in reasons)):
                return False
            raise

    def save_roles(self, context, original, updated, session_hash, now):
        from ..permissions.gateway import WriteConditions
        from ..permissions.transactions import transaction_checks
        conditions = WriteConditions(context.user.user_id, context.user.authz_version,
            session_hash, original['id'], original['authzVersion'], None, None, '')
        checks = transaction_checks(conditions, user_table=self.users,
            session_table=self.sessions, business_table=self.users, now=now)
        # The manager's capability is in the snapshot guarded by authzVersion.
        # Target Put checks active/version/subject together; never revive a closed account.
        checks += [{'Put': {'TableName': self.users, 'Item': values(updated),
            'ConditionExpression': '#v = :v AND #a = :yes AND #s = :s',
            'ExpressionAttributeNames': {'#v': 'authzVersion', '#a': 'active', '#s': 'subjectKey'},
            'ExpressionAttributeValues': values({':v': original['authzVersion'], ':yes': True,
                                                 ':s': original['subjectKey']})}},
            {'Update': {'TableName': self.identities,
                'Key': values({'subjectKey': original['subjectKey']}),
                'UpdateExpression': 'SET verification = :verified',
                'ConditionExpression': 'userId = :user AND provider = :provider',
                'ExpressionAttributeValues': values({':verified': 'verified',
                    ':user': original['id'], ':provider': original.get('authProvider', 'tu')})}}]
        try:
            self.client.transact_write_items(TransactItems=checks)
        except Exception as error:
            if getattr(error, 'response', {}).get('Error', {}).get('Code') == 'TransactionCanceledException':
                raise AuthError('VERSION_CONFLICT', 409) from None
            raise


class DynamoLoginLimiter:
    """Fixed 5-minute window; atomic counters shared by all Lambda instances."""
    def __init__(self, table, secret, clock=time.time):
        self.table, self.secret, self.clock = table, secret, clock

    def check(self, username, ip):
        window = int(self.clock()) // 300
        for category, value, limit in [('identity', username, 5), ('ip', ip, 30)]:
            fingerprint = hmac.new(self.secret, (category + '\0' + value).encode(), hashlib.sha256).hexdigest()
            try:
                self.table.update_item(Key={'key': f'{category}:{window}:{fingerprint}'},
                    UpdateExpression='SET expiresAt = :expires ADD attempts :one',
                    ConditionExpression='attribute_not_exists(attempts) OR attempts < :limit',
                    ExpressionAttributeValues={':expires': (window + 2) * 300,
                                               ':one': 1, ':limit': limit})
            except Exception as error:
                if getattr(error, 'response', {}).get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
                    raise AuthError('RATE_LIMITED', 429) from None
                raise
