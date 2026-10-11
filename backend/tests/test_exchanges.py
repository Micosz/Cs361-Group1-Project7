"""Unit tests for Exchange domain repository and validation (Issue #104 / Parent #85)."""

import copy
import unittest

from backend.auth.session_service import AuthError, SessionContext, UserState
from backend.permissions.gateway import WriteConditions
from backend.partners.validators import validate_exchange_payload
from backend.partners.repository import ExchangeRepository


class DummyUsers:
    def __init__(self, users_dict):
        self.users = users_dict
        self.store = self

    def user(self, user_id):
        return self.users.get(user_id)


class ExchangeTests(unittest.TestCase):
    def setUp(self):
        # Setup mock user states
        self.user_coord = UserState(
            user_id='u-coord-1',
            active=True,
            authz_version=1,
            identity_verified=True,
            display_name='Coordinator 1',
            grants=({'id': 'g1', 'role': 'coordinator', 'scopeId': 'cs', 'active': True},),
            capabilities=(),
        )
        self.user_staff = UserState(
            user_id='u-staff-1',
            active=True,
            authz_version=1,
            identity_verified=True,
            display_name='Staff 1',
            grants=({'id': 'g2', 'role': 'staff', 'scopeId': 'cs', 'active': True},),
            capabilities=({'name': 'manageRoles', 'scopeId': 'cs'},),
        )
        self.user_student = UserState(
            user_id='u-student-1',
            active=True,
            authz_version=1,
            identity_verified=True,
            display_name='Student 1',
            grants=({'id': 'g3', 'role': 'student', 'scopeId': 'cs', 'active': True},),
            capabilities=(),
        )
        self.user_exec = UserState(
            user_id='u-exec-1',
            active=True,
            authz_version=1,
            identity_verified=True,
            display_name='Exec 1',
            grants=({'id': 'g4', 'role': 'executive', 'scopeId': 'cs', 'active': True},),
            capabilities=(),
        )

        users_map = {
            'u-coord-1': self.user_coord,
            'u-staff-1': self.user_staff,
            'u-student-1': self.user_student,
            'u-exec-1': self.user_exec,
        }
        self.dummy_users = DummyUsers(users_map)

        # Prepopulate partners and agreements
        self.initial_records = [
            {
                'id': 'partner-1',
                'entityType': 'partner',
                'scopeId': 'cs',
                'name': 'Partner University',
                'type': 'university',
                'summary': 'Summary',
                'location': 'Tokyo',
                'publication': 'public',
                'version': 1,
            },
            {
                'id': 'partner-other-scope',
                'entityType': 'partner',
                'scopeId': 'other-scope',
                'name': 'Other University',
                'type': 'university',
                'summary': 'Summary',
                'location': 'Seoul',
                'publication': 'public',
                'version': 1,
            },
            {
                'id': 'agreement-1',
                'entityType': 'agreement',
                'scopeId': 'cs',
                'title': 'MoU CS',
                'agreementType': 'MoU',
                'partnerIds': ['partner-1'],
                'version': 1,
            },
        ]

        class DummyService:
            def __init__(self, users_obj):
                self.users = users_obj
                self.store = self

            def get(self, token_h):
                return {'userId': 'test', 'active': True}

        self.service = DummyService(self.dummy_users)
        self.repo = ExchangeRepository(service=self.service, initial_records=self.initial_records)

    def test_validation_required_and_field_rules(self):
        # Missing required on create
        with self.assertRaises(AuthError) as ctx:
            validate_exchange_payload({'title': 'Exchange'}, is_create=True)
        self.assertEqual(ctx.exception.status, 422)

        # Invalid partnerIds (empty list)
        with self.assertRaises(AuthError) as ctx:
            validate_exchange_payload({'title': 'Exchange', 'partnerIds': []}, is_create=True)
        self.assertEqual(ctx.exception.status, 422)

        # Date ordering validation
        with self.assertRaises(AuthError) as ctx:
            validate_exchange_payload({
                'title': 'Exchange',
                'partnerIds': ['partner-1'],
                'startDate': '2026-12-01',
                'endDate': '2026-11-01',
            }, is_create=True)
        self.assertEqual(ctx.exception.status, 422)

        # Valid payload passes
        validate_exchange_payload({
            'title': 'Exchange Japan 2027',
            'partnerIds': ['partner-1'],
            'startDate': '2027-01-10',
            'endDate': '2027-06-30',
            'participantUserIds': ['u-student-1'],
        }, is_create=True)

    def test_coordinator_create_auto_assigns_self_and_status_draft(self):
        conditions = WriteConditions(
            user_id='u-coord-1',
            authz_version=1,
            session_hash='s1',
            target_id=None,
            target_version=None,
            parent_id=None,
            parent_version=None,
            scope_id='cs',
        )
        payload = {
            'title': 'Student Exchange 2027',
            'partnerIds': ['partner-1'],
            'startDate': '2027-01-01',
            'endDate': '2027-05-31',
        }
        res = self.repo.mutate('exchange', 'create', payload, None, None, conditions, 'key-1')
        self.assertEqual(res['title'], 'Student Exchange 2027')
        self.assertEqual(res['status'], 'draft')
        self.assertEqual(res['version'], 1)
        self.assertEqual(res['responsibleUserIds'], ['u-coord-1'])
        self.assertEqual(res['scopeId'], 'cs')

    def test_cross_scope_partner_reference_denied(self):
        conditions = WriteConditions(
            user_id='u-staff-1',
            authz_version=1,
            session_hash='s1',
            target_id=None,
            target_version=None,
            parent_id=None,
            parent_version=None,
            scope_id='cs',
        )
        payload = {
            'title': 'Cross Scope Exchange',
            'partnerIds': ['partner-other-scope'],
        }
        with self.assertRaises(AuthError) as ctx:
            self.repo.mutate('exchange', 'create', payload, None, None, conditions, 'key-cross')
        self.assertEqual(ctx.exception.status, 404)

    def test_concurrency_and_idempotency_key(self):
        conditions = WriteConditions(
            user_id='u-coord-1',
            authz_version=1,
            session_hash='s1',
            target_id=None,
            target_version=None,
            parent_id=None,
            parent_version=None,
            scope_id='cs',
        )
        payload = {
            'title': 'Exchange Idempotent',
            'partnerIds': ['partner-1'],
        }
        # First create
        res1 = self.repo.mutate('exchange', 'create', payload, None, None, conditions, 'idem-1')

        # Replay with same key & payload -> identical return
        res2 = self.repo.mutate('exchange', 'create', payload, None, None, conditions, 'idem-1')
        self.assertEqual(res1['id'], res2['id'])

        # Different payload with same key -> 409
        diff_payload = {'title': 'Different Title', 'partnerIds': ['partner-1']}
        with self.assertRaises(AuthError) as ctx:
            self.repo.mutate('exchange', 'create', diff_payload, None, None, conditions, 'idem-1')
        self.assertEqual(ctx.exception.status, 409)

        # Version conflict on update
        update_cond_stale = WriteConditions(
            user_id='u-coord-1',
            authz_version=1,
            session_hash='s1',
            target_id=res1['id'],
            target_version=999,  # Stale
            parent_id=None,
            parent_version=None,
            scope_id='cs',
        )
        with self.assertRaises(AuthError) as ctx:
            self.repo.mutate('exchange', 'update', {'title': 'New'}, res1, None, update_cond_stale, None)
        self.assertEqual(ctx.exception.status, 409)


if __name__ == '__main__':
    unittest.main()

