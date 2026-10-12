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

        self.user_student_other = UserState(
            user_id='u-student-other-scope',
            active=True,
            authz_version=1,
            identity_verified=True,
            display_name='Student Other Scope',
            grants=({'id': 'g5', 'role': 'student', 'scopeId': 'other-scope', 'active': True},),
            capabilities=(),
        )
        self.user_student_unverified = UserState(
            user_id='u-student-unverified',
            active=True,
            authz_version=1,
            identity_verified=False,
            display_name='Student Unverified',
            grants=({'id': 'g6', 'role': 'student', 'scopeId': 'cs', 'active': True},),
            capabilities=(),
        )

        users_map = {
            'u-coord-1': self.user_coord,
            'u-staff-1': self.user_staff,
            'u-student-1': self.user_student,
            'u-student-other-scope': self.user_student_other,
            'u-student-unverified': self.user_student_unverified,
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


    def test_participants_and_assignees_validation(self):
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
        # Valid student participant and coordinator responsible user
        payload = {
            'title': 'Exchange with Participant',
            'partnerIds': ['partner-1'],
            'participantUserIds': ['u-student-1'],
            'responsibleUserIds': ['u-coord-1'],
        }
        res = self.repo.mutate('exchange', 'create', payload, None, None, conditions, 'key-valid-part')
        self.assertEqual(res['participantUserIds'], ['u-student-1'])
        self.assertEqual(res['responsibleUserIds'], ['u-coord-1'])

        # Cross-scope student participant denied (422)
        payload_cross_student = {
            'title': 'Exchange Cross Student',
            'partnerIds': ['partner-1'],
            'participantUserIds': ['u-student-other-scope'],
        }
        with self.assertRaises(AuthError) as ctx:
            self.repo.mutate('exchange', 'create', payload_cross_student, None, None, conditions, 'key-cross-std')
        self.assertEqual(ctx.exception.status, 422)

        # Unverified student participant denied (422)
        payload_unverified = {
            'title': 'Exchange Unverified Student',
            'partnerIds': ['partner-1'],
            'participantUserIds': ['u-student-unverified'],
        }
        with self.assertRaises(AuthError) as ctx:
            self.repo.mutate('exchange', 'create', payload_unverified, None, None, conditions, 'key-unverified-std')
        self.assertEqual(ctx.exception.status, 422)

        # Assignee must not be student (must be staff/coordinator)
        payload_bad_assignee = {
            'title': 'Exchange Bad Assignee',
            'partnerIds': ['partner-1'],
            'responsibleUserIds': ['u-student-1'],
        }
        with self.assertRaises(AuthError) as ctx:
            self.repo.mutate('exchange', 'create', payload_bad_assignee, None, None, conditions, 'key-bad-assignee')
        self.assertEqual(ctx.exception.status, 422)

        # Participant must not be staff/coordinator (must be student)
        payload_bad_part = {
            'title': 'Exchange Bad Participant',
            'partnerIds': ['partner-1'],
            'participantUserIds': ['u-staff-1'],
        }
        with self.assertRaises(AuthError) as ctx:
            self.repo.mutate('exchange', 'create', payload_bad_part, None, None, conditions, 'key-bad-part')
        self.assertEqual(ctx.exception.status, 422)

    def test_agreement_reference_and_dates(self):
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
        # Valid agreement in same scope + same-day dates (startDate == endDate is valid)
        payload = {
            'title': 'Exchange Single Day',
            'partnerIds': ['partner-1'],
            'agreementId': 'agreement-1',
            'startDate': '2027-03-15',
            'endDate': '2027-03-15',
        }
        res = self.repo.mutate('exchange', 'create', payload, None, None, conditions, 'key-agr-ok')
        self.assertEqual(res['agreementId'], 'agreement-1')
        self.assertEqual(res['startDate'], '2027-03-15')
        self.assertEqual(res['endDate'], '2027-03-15')

        # Invalid agreement reference (not found or cross scope) -> 404
        payload_bad_agr = {
            'title': 'Exchange Bad Agreement',
            'partnerIds': ['partner-1'],
            'agreementId': 'non-existent-agreement',
        }
        with self.assertRaises(AuthError) as ctx:
            self.repo.mutate('exchange', 'create', payload_bad_agr, None, None, conditions, 'key-bad-agr')
        self.assertEqual(ctx.exception.status, 404)

    def test_status_transitions(self):
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
        # 1. Create draft exchange with valid dates & participant
        draft_payload = {
            'title': 'Exchange For Transition',
            'partnerIds': ['partner-1'],
            'participantUserIds': ['u-student-1'],
            'startDate': '2026-12-01',
            'endDate': '2027-05-31',
        }
        draft = self.repo.mutate('exchange', 'create', draft_payload, None, None, conditions, 'key-trans-init')
        self.assertEqual(draft['status'], 'draft')

        # 2. Transition draft -> ongoing
        cond_ongoing = WriteConditions(
            user_id='u-coord-1',
            authz_version=1,
            session_hash='s1',
            target_id=draft['id'],
            target_version=draft['version'],
            parent_id=None,
            parent_version=None,
            scope_id='cs',
        )
        ongoing = self.repo.mutate('exchange', 'status', {'to': 'ongoing'}, draft, None, cond_ongoing, None)
        self.assertEqual(ongoing['status'], 'ongoing')
        self.assertEqual(ongoing['version'], draft['version'] + 1)

        # 3. Transition ongoing -> completed requires supportingInfo
        cond_completed = WriteConditions(
            user_id='u-coord-1',
            authz_version=1,
            session_hash='s1',
            target_id=ongoing['id'],
            target_version=ongoing['version'],
            parent_id=None,
            parent_version=None,
            scope_id='cs',
        )
        # Without supportingInfo -> 409 INVALID_TRANSITION
        with self.assertRaises(AuthError) as ctx:
            self.repo.mutate('exchange', 'status', {'to': 'completed'}, ongoing, None, cond_completed, None)
        self.assertEqual(ctx.exception.status, 409)

        # With supportingInfo -> success
        completed = self.repo.mutate('exchange', 'status', {'to': 'completed', 'supportingInfo': 'Program finished successfully'}, ongoing, None, cond_completed, None)
        self.assertEqual(completed['status'], 'completed')
        self.assertEqual(completed['supportingInfo'], 'Program finished successfully')

        # 4. Completed cannot transition back (INVALID_TRANSITION 409)
        cond_revert = WriteConditions(
            user_id='u-coord-1',
            authz_version=1,
            session_hash='s1',
            target_id=completed['id'],
            target_version=completed['version'],
            parent_id=None,
            parent_version=None,
            scope_id='cs',
        )
        with self.assertRaises(AuthError) as ctx:
            self.repo.mutate('exchange', 'status', {'to': 'draft'}, completed, None, cond_revert, None)
        self.assertEqual(ctx.exception.status, 409)

        # 5. Cancel transition requires reason
        draft2_payload = {
            'title': 'Exchange To Cancel',
            'partnerIds': ['partner-1'],
        }
        draft2 = self.repo.mutate('exchange', 'create', draft2_payload, None, None, conditions, 'key-cancel-init')
        cond_cancel = WriteConditions(
            user_id='u-coord-1',
            authz_version=1,
            session_hash='s1',
            target_id=draft2['id'],
            target_version=draft2['version'],
            parent_id=None,
            parent_version=None,
            scope_id='cs',
        )
        # Without reason -> 409
        with self.assertRaises(AuthError) as ctx:
            self.repo.mutate('exchange', 'status', {'to': 'cancelled'}, draft2, None, cond_cancel, None)
        self.assertEqual(ctx.exception.status, 409)

        # With reason -> success
        cancelled = self.repo.mutate('exchange', 'status', {'to': 'cancelled', 'reason': 'Budget cut'}, draft2, None, cond_cancel, None)
        self.assertEqual(cancelled['status'], 'cancelled')
        self.assertEqual(cancelled['reason'], 'Budget cut')


if __name__ == '__main__':
    unittest.main()

