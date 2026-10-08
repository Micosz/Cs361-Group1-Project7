"""DynamoDB adapters. Tables/permissions are configured outside this module."""

from decimal import Decimal
from .session_service import UserState


def _integers(value):
    if isinstance(value, Decimal):
        if value != value.to_integral_value():
            raise ValueError("Expected integer state")
        return int(value)
    if isinstance(value, dict):
        return {k: _integers(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_integers(v) for v in value]
    return value


def _conditional_failure(error):
    return getattr(error, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException"


class DynamoSessionStore:
    """Partition key tokenHash (String); ttl is cleanup only, never authorization."""

    def __init__(self, table):
        self.table = table

    def create(self, record):
        self.table.put_item(Item=record, ConditionExpression="attribute_not_exists(tokenHash)")

    def get(self, token_hash):
        row = self.table.get_item(Key={"tokenHash": token_hash}, ConsistentRead=True).get("Item")
        return _integers(row) if row else None

    def touch(self, token_hash, now, expires_at):
        try:
            self.table.update_item(
                Key={"tokenHash": token_hash},
                UpdateExpression="SET lastSeenAt = :now, expiresAt = :expires",
                ConditionExpression=("attribute_exists(tokenHash) AND attribute_not_exists(revokedAt) "
                                     "AND expiresAt > :now AND absoluteExpiresAt > :now "
                                     "AND lastSeenAt <= :now AND expiresAt <= :expires"),
                ExpressionAttributeValues={":now": now, ":expires": expires_at},
            )
            return True
        except Exception as error:
            if _conditional_failure(error):
                return False
            raise

    def delete(self, token_hash):
        self.table.delete_item(Key={"tokenHash": token_hash})

    def consume(self, token_hash, now):
        try:
            self.table.delete_item(
                Key={"tokenHash": token_hash},
                ConditionExpression=("attribute_exists(tokenHash) AND attribute_not_exists(revokedAt) "
                                     "AND expiresAt > :now AND absoluteExpiresAt > :now"),
                ExpressionAttributeValues={":now": now},
            )
            return True
        except Exception as error:
            if _conditional_failure(error):
                return False
            raise


class DynamoUserReader:
    """PK id; #76/#77 maintain an atomic user+authz snapshot, see backend README."""

    def __init__(self, table):
        self.table = table

    def get(self, user_id):
        raw = self.table.get_item(Key={"id": user_id}, ConsistentRead=True).get("Item")
        if raw is None:
            return None
        row = _integers(raw)
        return UserState(
            user_id=row["id"], active=row["active"], authz_version=row["authzVersion"],
            identity_verified=row["identityVerified"], display_name=row.get("displayName", ""),
            grants=tuple(row.get("grants", [])), capabilities=tuple(row.get("capabilities", [])),
        )
