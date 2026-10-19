"""Main remains trusted; explicitly configured preview origins retain CSRF guards."""

import base64
import json
import os
import unittest
from unittest.mock import patch

from backend.auth.session_service import AuthError, SessionPolicy, SessionService
from backend.lambda_function import session_policy_from_environment
from backend.tests.test_sessions import MemoryStore, Users


MAIN = "https://main.example.com"
PREVIEW = "https://preview.example.com"


class SessionOriginTests(unittest.TestCase):
    def test_main_and_preview_login_logout_keep_csrf_and_rotation(self):
        policy = SessionPolicy(MAIN, b"x" * 32, additional_origins=(PREVIEW,))
        service = SessionService(MemoryStore(), Users(), policy)
        for origin in (MAIN, PREVIEW):
            with self.subTest(origin=origin):
                prior = service.create_anonymous()
                with self.assertRaises(AuthError) as caught:
                    service.issue_authenticated("u1", prior.token, origin, "0" * 64)
                self.assertEqual("CSRF_DENIED", caught.exception.code)
                issued = service.issue_authenticated("u1", prior.token, origin, prior.csrf_token)
                self.assertNotEqual(prior.token, issued.token)
                self.assertEqual("u1", service.validate(issued.token).user.user_id)
                service.logout(issued.token, origin, issued.csrf_token)
                with self.assertRaises(AuthError):
                    service.validate(issued.token)

    def test_missing_and_lookalike_origins_remain_denied(self):
        policy = SessionPolicy(MAIN, b"x" * 32, additional_origins=(PREVIEW,))
        service = SessionService(MemoryStore(), Users(), policy)
        prior = service.create_anonymous()
        for origin in (None, "", "null", "http://preview.example.com", PREVIEW + "/",
                       PREVIEW + ".evil.test", "https://other.example.com"):
            with self.subTest(origin=origin), self.assertRaises(AuthError) as caught:
                service.check_csrf(prior.token, origin, prior.csrf_token)
            self.assertEqual("ORIGIN_DENIED", caught.exception.code)

    def test_environment_defaults_keep_existing_single_origin(self):
        environment = {"SESSION_ORIGIN": MAIN,
                       "SESSION_CSRF_SECRET": base64.b64encode(b"x" * 32).decode()}
        with patch.dict(os.environ, environment, clear=True):
            policy = session_policy_from_environment()
            self.assertEqual(MAIN, policy.origin)
            self.assertEqual((), policy.additional_origins)
            os.environ["SESSION_ADDITIONAL_ORIGINS"] = json.dumps([PREVIEW])
            self.assertEqual((PREVIEW,), session_policy_from_environment().additional_origins)
            for invalid in ('"https://preview.example.com"', '{}', 'null', '[null]',
                            '["https://*.example.com"]', '["http://preview.example.com"]',
                            '["https://preview.example.com/path"]', 'invalid-json'):
                with self.subTest(invalid=invalid):
                    os.environ["SESSION_ADDITIONAL_ORIGINS"] = invalid
                    with self.assertRaises(ValueError):
                        session_policy_from_environment()

    def test_preview_not_implicitly_trusted_without_configuration(self):
        service = SessionService(MemoryStore(), Users(), SessionPolicy(MAIN, b"x" * 32))
        service.check_origin(MAIN)
        with self.assertRaises(AuthError):
            service.check_origin(PREVIEW)
