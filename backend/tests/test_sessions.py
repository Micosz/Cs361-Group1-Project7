import copy
from dataclasses import replace
import json
import unittest
from unittest.mock import patch

from backend.auth.session_service import (
    AuthError, COOKIE_NAME, SessionPolicy, SessionService, UserState, token_hash,
)
from backend.auth.require_session import require_session
from backend.http_api import handle
from backend.lambda_function import handler


class MemoryStore:
    """Test double with the same atomic deadline/delete constraints as DynamoDB."""

    def __init__(self):
        self.rows = {}
        self.before_touch = None

    def create(self, row):
        assert row["tokenHash"] not in self.rows
        self.rows[row["tokenHash"]] = copy.deepcopy(row)

    def get(self, key):
        return copy.deepcopy(self.rows.get(key))

    def touch(self, key, now, expires):
        if self.before_touch:
            action, self.before_touch = self.before_touch, None
            action(key)
        row = self.rows.get(key)
        if (not row or "revokedAt" in row or row["expiresAt"] <= now
                or row["absoluteExpiresAt"] <= now or row["lastSeenAt"] > now
                or row["expiresAt"] > expires):
            return False
        row.update(lastSeenAt=now, expiresAt=expires)
        return True

    def delete(self, key):
        self.rows.pop(key, None)

    def consume(self, key, now):
        row = self.rows.get(key)
        if (not row or "revokedAt" in row or row["expiresAt"] <= now
                or row["absoluteExpiresAt"] <= now):
            return False
        self.delete(key)
        return True


class Users:
    def __init__(self):
        self.user = UserState("u1", True, 1, True, "Student")

    def get(self, key):
        return self.user if self.user and key == self.user.user_id else None


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000
        self.store, self.users = MemoryStore(), Users()
        self.policy = SessionPolicy("https://example.com", b"x" * 32,
                                    idle_seconds=30, absolute_seconds=80)
        self.service = SessionService(self.store, self.users, self.policy, lambda: self.now)

    def login(self):
        prior = self.service.create_anonymous()
        result = self.service.issue_authenticated("u1", prior.token, self.policy.origin,
                                                   prior.csrf_token)
        return result

    def event(self, path="session", token=None, csrf=None, origin=None, method=None):
        return {"version": "2.0", "rawPath": "/api/auth/" + path,
                "requestContext": {"http": {"method": method or
                                   ("GET" if path == "session" else "POST")},
                                   "requestId": "aws-request"},
                "headers": {"origin": origin or self.policy.origin,
                            "x-csrf-token": csrf or ""},
                "cookies": [f"{COOKIE_NAME}={token}"] if token else []}

    def assertCode(self, code, action):
        with self.assertRaises(AuthError) as caught:
            action()
        self.assertEqual(code, caught.exception.code)

    def test_random_tokens_hash_only_and_secret_repr(self):
        a, b = self.login(), self.login()
        self.assertNotEqual(a.token, b.token)
        self.assertEqual(43, len(a.token))
        stored = json.dumps(self.store.rows)
        self.assertNotIn(a.token, stored)
        self.assertNotIn(a.csrf_token, stored)
        self.assertIn(token_hash(a.token), stored)
        self.assertNotIn(a.token, repr(a))

    def test_cookie_security(self):
        cookie = self.login().cookie
        for flag in ("Secure", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=80"):
            self.assertIn(flag, cookie)
        self.assertTrue(cookie.startswith("__Host-cstuhub="))
        self.assertNotIn("Domain", cookie)

    def test_anonymous_cannot_access_protected_endpoint(self):
        token = self.service.create_anonymous().token
        self.assertCode("AUTH_REQUIRED", lambda: self.service.validate(token))

    def test_rotation_consumes_prior_and_cannot_replay(self):
        prior = self.service.create_anonymous()
        issued = self.service.issue_authenticated("u1", prior.token, self.policy.origin,
                                                  prior.csrf_token)
        self.assertNotEqual(prior.token, issued.token)
        self.assertNotEqual(prior.csrf_token, issued.csrf_token)
        self.assertCode("AUTH_REQUIRED", lambda: self.service.validate(prior.token))
        self.assertCode("AUTH_REQUIRED", lambda: self.service.issue_authenticated(
            "u1", prior.token, self.policy.origin, prior.csrf_token))

    def test_missing_tampered_and_unknown_credentials(self):
        for token in (None, "", "broken", "x" * 43, "💥" * 43):
            with self.subTest(token_type=type(token).__name__):
                self.assertCode("AUTH_REQUIRED", lambda: self.service.validate(token))

    def test_idle_expiry_exact_boundary(self):
        issued = self.login()
        self.now += 30
        self.assertCode("SESSION_EXPIRED", lambda: self.service.validate(issued.token))
        self.assertNotIn(token_hash(issued.token), self.store.rows)

    def test_sliding_expiry_never_exceeds_absolute(self):
        issued = self.login()
        for now in (1020, 1040, 1060, 1079):
            self.now = now
            self.service.validate(issued.token)
        self.assertEqual(1080, self.store.rows[token_hash(issued.token)]["expiresAt"])
        self.now = 1080
        self.assertCode("SESSION_EXPIRED", lambda: self.service.validate(issued.token))

    def test_logout_revokes_all_tabs_and_is_idempotent(self):
        issued = self.login()
        for _ in range(2):
            self.service.logout(issued.token, self.policy.origin, issued.csrf_token)
        self.assertCode("AUTH_REQUIRED", lambda: self.service.validate(issued.token))
        self.service.logout(None, self.policy.origin, None)

    def test_logout_works_after_expiry(self):
        issued = self.login()
        self.now += 100
        self.service.logout(issued.token, self.policy.origin, issued.csrf_token)
        self.assertNotIn(token_hash(issued.token), self.store.rows)

    def test_bad_origin_or_csrf_does_not_logout(self):
        issued = self.login()
        for origin, csrf in (("https://evil.test", issued.csrf_token),
                             (None, issued.csrf_token), (self.policy.origin, None),
                             (self.policy.origin, "0" * 64)):
            with self.assertRaises(AuthError):
                self.service.logout(issued.token, origin, csrf)
            self.assertIsNotNone(self.service.validate(issued.token).user)

    def test_csrf_bound_to_current_session(self):
        a, b = self.login(), self.login()
        self.assertCode("CSRF_DENIED", lambda: self.service.logout(
            a.token, self.policy.origin, b.csrf_token))

    def test_revocation_version_change_applies_next_request(self):
        issued = self.login()
        self.users.user = replace(self.users.user, authz_version=2)
        self.assertCode("SESSION_REVOKED", lambda: self.service.validate(issued.token))
        self.assertIsNotNone(self.service.validate(self.login().token).user)

    def test_disabled_or_deleted_user_rejected(self):
        for user in (replace(self.users.user, active=False), None):
            self.users.user = UserState("u1", True, 1, True)
            issued = self.login()
            self.users.user = user
            self.assertCode("SESSION_REVOKED", lambda: self.service.validate(issued.token))

    def test_no_role_can_login_and_provisional_has_no_permissions(self):
        self.assertEqual([], self.service.state(self.login().token)["grants"])
        self.users.user = replace(self.users.user, identity_verified=False,
                                 grants=({"role": "staff", "scopeId": "all", "active": True},),
                                 capabilities=({"name": "manageRoles", "scopeId": "all", "active": True},))
        state = self.service.state(self.login().token)
        self.assertEqual([], state["grants"])
        self.assertEqual([], state["capabilities"])

    def test_permission_projection_excludes_inactive_and_private_fields(self):
        self.users.user = replace(self.users.user, grants=(
            {"role": "staff", "scopeId": "cs", "active": True, "secret": "private"},
            {"role": "executive", "scopeId": "cs", "active": False},))
        self.assertEqual([{"role": "staff", "scopeId": "cs"}],
                         self.service.state(self.login().token)["grants"])

    def test_concurrent_logout_cannot_be_resurrected_by_touch(self):
        issued = self.login()
        self.store.before_touch = self.store.delete
        self.assertCode("AUTH_REQUIRED", lambda: self.service.validate(issued.token))
        self.assertNotIn(token_hash(issued.token), self.store.rows)

    def test_concurrent_refresh_retries_without_shortening(self):
        issued = self.login()
        self.now += 1
        self.store.before_touch = lambda key: self.store.rows[key].update(
            lastSeenAt=self.now + 1, expiresAt=self.now + 31)
        self.service.validate(issued.token)
        self.assertEqual(self.now + 31, self.store.rows[token_hash(issued.token)]["expiresAt"])

    def test_malformed_or_revoked_record_rejected(self):
        for change in ({"expiresAt": "future"}, {"revokedAt": 1000},
                       {"csrfHash": "0" * 64}, {"authzVersion": True}):
            issued = self.login()
            self.store.rows[token_hash(issued.token)].update(change)
            self.assertCode("SESSION_REVOKED", lambda: self.service.validate(issued.token))

    def test_http_bootstrap_anonymous_and_no_raw_token_in_body(self):
        result = handle(self.event(), self.service)
        self.assertEqual(200, result["statusCode"])
        body = json.loads(result["body"])
        self.assertIsNone(body["user"])
        token = result["cookies"][0].split("=", 1)[1].split(";", 1)[0]
        self.assertNotIn(token, result["body"])
        self.assertEqual("no-store", result["headers"]["cache-control"])
        self.assertEqual(self.service.csrf_token(token), body["csrfToken"])

    def test_invalid_cookie_returns_401_clear_cookie_without_anonymous_fallback(self):
        result = handle(self.event(token="bad"), self.service)
        self.assertEqual(401, result["statusCode"])
        self.assertIn("Max-Age=0", result["cookies"][0])
        self.assertEqual({}, self.store.rows)

    def test_duplicate_cookie_rejected(self):
        issued = self.login()
        event = self.event(token=issued.token)
        event["cookies"].append(f"{COOKIE_NAME}={issued.token}")
        self.assertEqual(401, handle(event, self.service)["statusCode"])

    def test_http_logout_clears_cookie_and_old_token_denied(self):
        issued = self.login()
        result = handle(self.event("logout", issued.token, issued.csrf_token), self.service)
        self.assertEqual(200, result["statusCode"])
        self.assertIn("Max-Age=0", result["cookies"][0])
        self.assertEqual(401, handle(self.event(token=issued.token), self.service)["statusCode"])

    def test_no_user_id_login_route_or_wrong_method(self):
        self.assertEqual(404, handle(self.event("login"), self.service)["statusCode"])
        self.assertEqual(405, handle(self.event(method="POST"), self.service)["statusCode"])
        self.assertEqual({}, self.store.rows)

    def test_protected_mutation_requires_csrf(self):
        issued = self.login()
        self.assertIsNotNone(require_session(self.event(token=issued.token), self.service).user)
        self.assertCode("CSRF_DENIED", lambda: require_session(
            self.event("record", issued.token), self.service))
        self.assertIsNotNone(require_session(
            self.event("record", issued.token, issued.csrf_token), self.service).user)

    def test_dependency_and_config_fail_closed_without_secret_error(self):
        with patch.object(self.store, "get", side_effect=RuntimeError("SECRET")):
            result = handle(self.event(token="x" * 43), self.service)
        self.assertEqual(503, result["statusCode"])
        self.assertNotIn("SECRET", result["body"])
        with patch("backend.lambda_function.build_service", side_effect=ValueError("SECRET")):
            result = handler(self.event(), None)
        self.assertEqual(503, result["statusCode"])
        self.assertNotIn("SECRET", result["body"])

    def test_https_origin_and_secret_configuration(self):
        for origin in ("http://example.com", "https://example.com/", "https://a@b", "https://b?x"):
            with self.assertRaises(ValueError):
                SessionPolicy(origin, b"x" * 32)
        with self.assertRaises(ValueError):
            SessionPolicy(self.policy.origin, b"short")


if __name__ == "__main__":
    unittest.main()
