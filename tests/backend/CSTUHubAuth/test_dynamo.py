"""SDK contract tests; no network, AWS credentials, or real tables are used."""

import unittest
import boto3
from botocore.exceptions import ClientError
from botocore.stub import Stubber

from backend.auth.session_store import DynamoSessionStore, DynamoUserReader


class DynamoTests(unittest.TestCase):
    def setUp(self):
        resource = boto3.resource("dynamodb", region_name="ap-southeast-1",
                                  aws_access_key_id="test", aws_secret_access_key="test")
        self.stub = Stubber(resource.meta.client)
        self.stub.activate()
        self.addCleanup(self.stub.deactivate)
        self.addCleanup(self.stub.assert_no_pending_responses)
        self.sessions = DynamoSessionStore(resource.Table("sessions"))
        self.users = DynamoUserReader(resource.Table("users"))

    def test_session_read_is_strong_and_normalizes_numbers(self):
        self.stub.add_response("get_item", {"Item": {
            "tokenHash": {"S": "key"}, "expiresAt": {"N": "100"}}},
            {"TableName": "sessions", "Key": {"tokenHash": "key"}, "ConsistentRead": True})
        expiry = self.sessions.get("key")["expiresAt"]
        self.assertEqual(100, expiry)
        self.assertIs(type(expiry), int)

    def test_user_authority_read_is_strong(self):
        self.stub.add_response("get_item", {"Item": {
            "id": {"S": "u1"}, "active": {"BOOL": True},
            "authzVersion": {"N": "3"}, "identityVerified": {"BOOL": True}}},
            {"TableName": "users", "Key": {"id": "u1"}, "ConsistentRead": True})
        self.assertEqual(3, self.users.get("u1").authz_version)

    def test_create_is_conditional_and_collision_propagates(self):
        self.stub.add_client_error("put_item", service_error_code="ConditionalCheckFailedException",
            expected_params={"TableName": "sessions", "Item": {"tokenHash": "key"},
                             "ConditionExpression": "attribute_not_exists(tokenHash)"})
        with self.assertRaises(ClientError):
            self.sessions.create({"tokenHash": "key"})

    def test_refresh_condition_blocks_deleted_expired_and_newer_rows(self):
        expected = {
            "TableName": "sessions", "Key": {"tokenHash": "key"},
            "UpdateExpression": "SET lastSeenAt = :now, expiresAt = :expires",
            "ConditionExpression": "attribute_exists(tokenHash) AND attribute_not_exists(revokedAt) "
                "AND expiresAt > :now AND absoluteExpiresAt > :now "
                "AND lastSeenAt <= :now AND expiresAt <= :expires",
            "ExpressionAttributeValues": {":now": 10, ":expires": 40},
        }
        self.stub.add_client_error("update_item", service_error_code="ConditionalCheckFailedException",
                                   expected_params=expected)
        self.assertFalse(self.sessions.touch("key", 10, 40))
        self.stub.add_response("update_item", {}, expected)
        self.assertTrue(self.sessions.touch("key", 10, 40))

    def test_consuming_login_token_is_conditional_once(self):
        expected = {"TableName": "sessions", "Key": {"tokenHash": "key"},
                    "ConditionExpression": "attribute_exists(tokenHash) AND attribute_not_exists(revokedAt) "
                        "AND expiresAt > :now AND absoluteExpiresAt > :now",
                    "ExpressionAttributeValues": {":now": 10}}
        self.stub.add_response("delete_item", {}, expected)
        self.assertTrue(self.sessions.consume("key", 10))
        self.stub.add_client_error("delete_item", service_error_code="ConditionalCheckFailedException",
                                  expected_params=expected)
        self.assertFalse(self.sessions.consume("key", 10))

    def test_outage_is_not_misreported_as_concurrent_change(self):
        self.stub.add_client_error("update_item", service_error_code="InternalServerError")
        with self.assertRaises(ClientError):
            self.sessions.touch("key", 10, 40)

    def test_logout_deletes_only_the_current_session(self):
        self.stub.add_response("delete_item", {},
            {"TableName": "sessions", "Key": {"tokenHash": "key"}})
        self.sessions.delete("key")
