"""Unit tests for Exchange domain repository and validation (Issue #104 / Parent #85)."""

import base64
import copy
from dataclasses import replace
import json
import unittest

from backend.auth.session_service import AuthError, SessionContext, UserState
from backend.permissions.gateway import WriteConditions
from backend.partners.validators import validate_exchange_payload
from backend.partners.repository import ExchangeRepository
from backend.http_api import handle
from backend.tests import test_sessions as session_helpers


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


class MyExchangeApiTests(unittest.TestCase):
    setUp = session_helpers.SessionTests.setUp

    def setUp(self):
        session_helpers.SessionTests.setUp(self)

        self.student_a = UserState(
            user_id='u-std-a',
            active=True,
            authz_version=1,
            identity_verified=True,
            display_name='Student A',
            grants=({'id': 'g-std-a', 'role': 'student', 'scopeId': 'cs', 'active': True},),
            capabilities=(),
        )
        self.student_b = UserState(
            user_id='u-std-b',
            active=True,
            authz_version=1,
            identity_verified=True,
            display_name='Student B',
            grants=({'id': 'g-std-b', 'role': 'student', 'scopeId': 'cs', 'active': True},),
            capabilities=(),
        )
        self.student_c = UserState(
            user_id='u-std-c',
            active=True,
            authz_version=1,
            identity_verified=True,
            display_name='Student C',
            grants=({'id': 'g-std-c', 'role': 'student', 'scopeId': 'cs', 'active': True},),
            capabilities=(),
        )
        self.coordinator = UserState(
            user_id='u-coord-1',
            active=True,
            authz_version=1,
            identity_verified=True,
            display_name='Coordinator 1',
            grants=({'id': 'g-coord', 'role': 'coordinator', 'scopeId': 'cs', 'active': True},),
            capabilities=(),
        )

        records = [
            {
                'id': 'ex-1',
                'entityType': 'exchange',
                'scopeId': 'cs',
                'title': 'Exchange A Only',
                'status': 'ongoing',
                'startDate': '2026-11-01',
                'endDate': '2026-12-01',
                'responsibleUserIds': ['u-coord-1'],
                'participantUserIds': ['u-std-a'],
                'internalNote': 'TOP SECRET NOTE A',
                'supportingInfo': 'INTERNAL SUPPORTING INFO A',
                'supportingInfoForParticipant': 'Welcome Student A',
                'version': 1,
            },
            {
                'id': 'ex-2',
                'entityType': 'exchange',
                'scopeId': 'cs',
                'title': 'Exchange B Only',
                'status': 'draft',
                'startDate': '2026-11-01',
                'endDate': '2026-12-01',
                'responsibleUserIds': ['u-coord-1'],
                'participantUserIds': ['u-std-b'],
                'internalNote': 'TOP SECRET NOTE B',
                'supportingInfo': 'INTERNAL SUPPORTING INFO B',
                'supportingInfoForParticipant': 'Welcome Student B',
                'version': 1,
            },
            {
                'id': 'ex-3',
                'entityType': 'exchange',
                'scopeId': 'cs',
                'title': 'Exchange Shared A and B',
                'status': 'ongoing',
                'startDate': '2026-11-01',
                'endDate': '2026-12-01',
                'responsibleUserIds': ['u-coord-1'],
                'participantUserIds': ['u-std-a', 'u-std-b'],
                'internalNote': 'TOP SECRET SHARED NOTE',
                'supportingInfo': 'INTERNAL SUPPORTING INFO SHARED',
                'supportingInfoForParticipant': 'Welcome Both Participants',
                'version': 1,
            },
            {
                'id': 'ex-4',
                'entityType': 'exchange',
                'scopeId': 'math',
                'title': 'Exchange Cross-Scope Math',
                'status': 'ongoing',
                'startDate': '2026-11-01',
                'endDate': '2026-12-01',
                'responsibleUserIds': ['u-coord-1'],
                'participantUserIds': ['u-std-a'],
                'version': 1,
            },
            {
                'id': 'doc-1',
                'entityType': 'document',
                'parentType': 'exchange',
                'parentId': 'ex-1',
                'scopeId': 'cs',
                'displayName': 'Student Guide.pdf',
                'mime': 'application/pdf',
                'size': 1234,
                'audience': 'participants',
                'containsPersonal': False,
                'uploadState': 'ready',
                'objectKey': 'SECRET-OBJECT-KEY-1',
                'version': 1,
            },
            {
                'id': 'doc-2',
                'entityType': 'document',
                'parentType': 'exchange',
                'parentId': 'ex-1',
                'scopeId': 'cs',
                'displayName': 'Internal Budget.pdf',
                'mime': 'application/pdf',
                'size': 5678,
                'audience': 'internal',
                'containsPersonal': False,
                'uploadState': 'ready',
                'objectKey': 'SECRET-OBJECT-KEY-2',
                'version': 1,
            },
            {
                'id': 'doc-3',
                'entityType': 'document',
                'parentType': 'exchange',
                'parentId': 'ex-1',
                'scopeId': 'cs',
                'displayName': 'Pending Guide.pdf',
                'mime': 'application/pdf',
                'size': 999,
                'audience': 'participants',
                'containsPersonal': False,
                'uploadState': 'pending',
                'objectKey': 'SECRET-OBJECT-KEY-3',
                'version': 1,
            },
            {
                'id': 'doc-4-b',
                'entityType': 'document',
                'parentType': 'exchange',
                'parentId': 'ex-2',
                'scopeId': 'cs',
                'displayName': 'Student B Guide.pdf',
                'mime': 'application/pdf',
                'size': 2000,
                'audience': 'participants',
                'containsPersonal': False,
                'uploadState': 'ready',
                'objectKey': 'SECRET-OBJECT-KEY-4',
                'version': 1,
            },
        ]
        self.doc_bytes = {
            'doc-1': b'%PDF-1.4 Mock Student Guide Content',
            'doc-4-b': b'%PDF-1.4 Mock Student B Guide Content',
        }
        self.repo = ExchangeRepository(self.service, records, document_contents=self.doc_bytes)

    def login_as(self, user_state):
        self.users.user = user_state
        prior = self.service.create_anonymous()
        return self.service.issue_authenticated(user_state.user_id, prior.token,
                                               self.policy.origin, prior.csrf_token)

    def event(self, issued, path='/api/me/exchanges', method='GET', payload=None, **hs):
        return {
            'version': '2.0',
            'rawPath': path,
            'requestContext': {'http': {'method': method}, 'requestId': 'req-test'},
            'headers': {
                'origin': self.policy.origin,
                'x-csrf-token': issued.csrf_token if issued else '',
                'if-match': '"1"',
                'idempotency-key': 'test-key-1234567890123456',
                **hs,
            },
            'cookies': [issued.cookie] if issued else [],
            'body': json.dumps(payload or {}),
        }

    def call(self, event):
        return handle(event, self.service, self.repo)

    def assert_status(self, status, event):
        result = self.call(event)
        self.assertEqual(status, result['statusCode'], result)
        self.assertEqual('no-store', result['headers']['cache-control'])
        return json.loads(result['body'])

    def test_student_a_and_b_listing_isolation_and_empty_for_student_c(self):
        # Student A sees ex-1 and ex-3 (shared); does not see ex-2 or ex-4
        tok_a = self.login_as(self.student_a)
        res_a = self.assert_status(200, self.event(tok_a, '/api/me/exchanges'))
        ids_a = [r['id'] for r in res_a['data']]
        self.assertEqual(res_a['count'], 2)
        self.assertEqual(sorted(ids_a), ['ex-1', 'ex-3'])

        # Student B sees ex-2 and ex-3 (shared); does not see ex-1 or ex-4
        tok_b = self.login_as(self.student_b)
        res_b = self.assert_status(200, self.event(tok_b, '/api/me/exchanges'))
        ids_b = [r['id'] for r in res_b['data']]
        self.assertEqual(res_b['count'], 2)
        self.assertEqual(sorted(ids_b), ['ex-2', 'ex-3'])

        # Student C participates in 0 exchanges -> receives empty array
        tok_c = self.login_as(self.student_c)
        res_c = self.assert_status(200, self.event(tok_c, '/api/me/exchanges'))
        self.assertEqual(res_c['count'], 0)
        self.assertEqual(res_c['data'], [])

    def test_student_projection_excludes_internal_fields_and_other_participants(self):
        tok_a = self.login_as(self.student_a)
        res_a = self.assert_status(200, self.event(tok_a, '/api/me/exchanges/ex-1'))
        data_a = res_a['data']

        # Safe student projection allowlist: {'id', 'title', 'startDate', 'endDate', 'status', 'supportingInfoForParticipant'}
        expected_fields = {'id', 'title', 'startDate', 'endDate', 'status', 'supportingInfoForParticipant'}
        self.assertEqual(set(data_a.keys()), expected_fields)
        self.assertEqual(data_a['id'], 'ex-1')
        self.assertEqual(data_a['title'], 'Exchange A Only')
        self.assertEqual(data_a['status'], 'ongoing')
        self.assertEqual(data_a['supportingInfoForParticipant'], 'Welcome Student A')

        # Internal notes or internal supporting info must never leak
        raw_json = json.dumps(res_a)
        self.assertNotIn('TOP SECRET', raw_json)
        self.assertNotIn('INTERNAL SUPPORTING INFO', raw_json)
        self.assertNotIn('responsibleUserIds', data_a)
        self.assertNotIn('participantUserIds', data_a)
        self.assertNotIn('scopeId', data_a)
        self.assertNotIn('version', data_a)

        # In shared exchange ex-3, Student A should not see other participant ID 'u-std-b'
        res_shared = self.assert_status(200, self.event(tok_a, '/api/me/exchanges/ex-3'))
        self.assertNotIn('u-std-b', json.dumps(res_shared))

    def test_single_record_cross_student_and_cross_scope_returns_404(self):
        tok_a = self.login_as(self.student_a)

        # Student A querying Student B's exchange -> 404 NOT_FOUND
        self.assert_status(404, self.event(tok_a, '/api/me/exchanges/ex-2'))

        # Student A querying cross-scope math exchange -> 404 NOT_FOUND
        self.assert_status(404, self.event(tok_a, '/api/me/exchanges/ex-4'))

        # Student A querying non-existent exchange -> 404 NOT_FOUND
        self.assert_status(404, self.event(tok_a, '/api/me/exchanges/ex-nonexistent'))

    def test_student_mutations_and_unsupported_methods_denied(self):
        tok_a = self.login_as(self.student_a)

        # Mutation on /api/me/exchanges -> 405 METHOD_NOT_ALLOWED
        self.assert_status(405, self.event(tok_a, '/api/me/exchanges', method='POST', payload={'title': 'hacked'}))
        self.assert_status(405, self.event(tok_a, '/api/me/exchanges/ex-1', method='PATCH', payload={'title': 'hacked'}))
        self.assert_status(405, self.event(tok_a, '/api/me/exchanges/ex-1/status', method='POST', payload={'to': 'completed'}))

        # Direct mutation on /api/exchanges by student -> 403 FORBIDDEN
        self.assert_status(403, self.event(tok_a, '/api/exchanges', method='POST', payload={'title': 'hacked', 'scopeId': 'cs'}))
        self.assert_status(403, self.event(tok_a, '/api/exchanges/ex-1', method='PATCH', payload={'title': 'hacked'}))
        self.assert_status(403, self.event(tok_a, '/api/exchanges/ex-1/status', method='POST', payload={'to': 'completed'}))

    def test_participant_removed_and_session_expired_deny_next_request(self):
        tok_a = self.login_as(self.student_a)
        self.assert_status(200, self.event(tok_a, '/api/me/exchanges/ex-1'))

        # When participant assignment is removed: next request to /api/me/exchanges/ex-1 returns 404
        self.repo.rows[('exchange', 'ex-1')]['participantUserIds'] = []
        self.assert_status(404, self.event(tok_a, '/api/me/exchanges/ex-1'))

        # And listing excludes ex-1 immediately
        res = self.assert_status(200, self.event(tok_a, '/api/me/exchanges'))
        self.assertEqual(res['count'], 1)
        self.assertEqual([r['id'] for r in res['data']], ['ex-3'])

        # Session revoked / version increment
        self.users.user = replace(self.student_a, authz_version=2)
        self.assert_status(401, self.event(tok_a, '/api/me/exchanges/ex-3'))

        # Anonymous or bad session
        unauth_event = self.event(None, '/api/me/exchanges')
        self.assert_status(401, unauth_event)

    def test_documents_for_participant_student(self):
        tok_a = self.login_as(self.student_a)

        # GET /api/me/exchanges/ex-1/documents
        # doc-1 (participants audience) is returned; doc-2 (internal audience) is filtered out
        res_docs = self.assert_status(200, self.event(tok_a, '/api/me/exchanges/ex-1/documents'))
        self.assertEqual(res_docs['count'], 2)  # doc-1 (ready) and doc-3 (pending) both have audience=participants
        doc_ids = [d['id'] for d in res_docs['data']]
        self.assertIn('doc-1', doc_ids)
        self.assertNotIn('doc-2', doc_ids)
        # Verify objectKey and private fields are not in response
        self.assertNotIn('SECRET-OBJECT-KEY', json.dumps(res_docs))

        # Student A requesting documents for Student B's exchange -> 404
        self.assert_status(404, self.event(tok_a, '/api/me/exchanges/ex-2/documents'))

        # Download content of ready document for participant
        content_res = self.call(self.event(tok_a, '/api/documents/doc-1/content'))
        self.assertEqual(content_res['statusCode'], 200)
        self.assertEqual(content_res['headers']['cache-control'], 'no-store')
        self.assertEqual(content_res['headers']['x-content-type-options'], 'nosniff')
        self.assertEqual(content_res['headers']['content-type'], 'application/pdf')
        decoded = base64.b64decode(content_res['body'])
        self.assertEqual(decoded, self.doc_bytes['doc-1'])

        # Pending document cannot be downloaded -> 404
        self.assert_status(404, self.event(tok_a, '/api/documents/doc-3/content'))

        # Internal document cannot be downloaded by student -> 404
        self.assert_status(404, self.event(tok_a, '/api/documents/doc-2/content'))

        # Student B's document cannot be downloaded by Student A -> 404
        self.assert_status(404, self.event(tok_a, '/api/documents/doc-4-b/content'))

        # Student upload attempt on documents -> 403 FORBIDDEN
        self.assert_status(403, self.event(tok_a, '/api/exchanges/ex-1/documents', method='POST', payload={'displayName': 'evil.pdf'}))


if __name__ == '__main__':
    unittest.main()
