"""Comprehensive test suite for Activity domain and assignees (Issue #96).

Verifies:
  - Create / update / read-back for staff and coordinator
  - Auto-assignment and default internal publication on coordinator creation
  - Deny coordinator forgery of publication, responsibleUserIds, or scopeId
  - Deny coordinator editing public activity display fields
  - Optimistic concurrency control (If-Match required, stale version returns 409)
  - Idempotency-Key caching, replay, and conflict on altered payload
  - Invalid fields, invalid dates, invalid image paths, unknown/injected fields
  - Primary partner in co-hosts validation (rejected with 422)
  - Missing and cross-scope reference rejection (partner, co-hosts, agreements)
  - Responsible user assignee validation (must be active, verified, staff/coordinator in scope)
  - Access matrix updates when responsible users are changed
  - Sanitization of internal fields in public projection
  - Preservation of MoU activity_tags on update
"""

import json
import unittest

from backend.auth.session_service import SessionContext, UserState
from backend.http_api import handle
from backend.partners.repository import ActivityRepository, PartnerRepository
from backend.permissions.projections import public_projection
from backend.tests import test_sessions as session_helpers


def user_context(role='staff', scope='c1', user='u1', verified=True, active=True, extra_grants=()):
    grants = ({'role': role, 'scopeId': scope, 'active': active},) if role else ()
    all_grants = grants + tuple(extra_grants)
    return SessionContext(UserState(user, active, 1, verified, grants=all_grants), 2000)


class MockUsers:
    def __init__(self, initial_users=None):
        self.users = {u.user_id: u for u in (initial_users or [])}

    def get(self, user_id):
        return self.users.get(user_id)

    def add(self, user_state):
        self.users[user_state.user_id] = user_state


class ActivityTests(unittest.TestCase):
    login = session_helpers.SessionTests.login

    def setUp(self):
        session_helpers.SessionTests.setUp(self)

        # Multi-user mock directory for assignee validation
        self.mock_users = MockUsers([
            user_context('staff', 'c1', 'u_staff').user,
            user_context('coordinator', 'c1', 'u_coord1').user,
            user_context('coordinator', 'c1', 'u_coord2').user,
            user_context('coordinator', 'c2', 'u_coord_c2').user,  # different scope
            user_context('coordinator', 'c1', 'u_unverified', verified=False).user,
            user_context('coordinator', 'c1', 'u_inactive', active=False).user,
            user_context('student', 'c1', 'u_student').user,
        ])
        self.service.users = self.mock_users

        # Default caller is staff
        self.caller_user = self.mock_users.get('u_staff')
        self.issued = self.login_as('u_staff')

        self.initial_records = [
            {
                'id': 'p1',
                'entityType': 'partner',
                'schemaVersion': 3,
                'scopeId': 'c1',
                'version': 1,
                'name': 'Partner One',
                'type': 'company',
                'summary': 'Summary 1',
                'location': 'Bangkok',
                'publication': 'public',
                'responsibleUserIds': ['u_coord1'],
                'createdAt': '2026-10-11T00:00:00Z',
                'updatedAt': '2026-10-11T00:00:00Z',
                'createdBy': 'u_staff',
                'updatedBy': 'u_staff',
            },
            {
                'id': 'p2',
                'entityType': 'partner',
                'schemaVersion': 3,
                'scopeId': 'c1',
                'version': 1,
                'name': 'Partner Two',
                'type': 'university',
                'summary': 'Summary 2',
                'location': 'Tokyo',
                'publication': 'public',
                'responsibleUserIds': ['u_coord1'],
                'createdAt': '2026-10-11T00:00:00Z',
                'updatedAt': '2026-10-11T00:00:00Z',
                'createdBy': 'u_staff',
                'updatedBy': 'u_staff',
            },
            {
                'id': 'p_c2',
                'entityType': 'partner',
                'schemaVersion': 3,
                'scopeId': 'c2',
                'version': 1,
                'name': 'Partner Scope 2',
                'type': 'government',
                'summary': 'Other scope partner',
                'location': 'Chiang Mai',
                'publication': 'public',
                'responsibleUserIds': ['u_coord_c2'],
                'createdAt': '2026-10-11T00:00:00Z',
                'updatedAt': '2026-10-11T00:00:00Z',
                'createdBy': 'u_staff',
                'updatedBy': 'u_staff',
            },
            {
                'id': 'g1',
                'entityType': 'agreement',
                'schemaVersion': 3,
                'scopeId': 'c1',
                'version': 1,
                'title': 'Agreement One',
                'agreementType': 'MoU',
                'partnerIds': ['p1'],
                'status': 'draft',
                'responsibleUserIds': ['u_coord1'],
                'createdAt': '2026-10-11T00:00:00Z',
                'updatedAt': '2026-10-11T00:00:00Z',
                'createdBy': 'u_staff',
                'updatedBy': 'u_staff',
            },
            {
                'id': 'g_c2',
                'entityType': 'agreement',
                'schemaVersion': 3,
                'scopeId': 'c2',
                'version': 1,
                'title': 'Agreement Scope 2',
                'agreementType': 'MoU',
                'partnerIds': ['p_c2'],
                'status': 'draft',
                'responsibleUserIds': ['u_coord_c2'],
                'createdAt': '2026-10-11T00:00:00Z',
                'updatedAt': '2026-10-11T00:00:00Z',
                'createdBy': 'u_staff',
                'updatedBy': 'u_staff',
            },
        ]

        self.repo = ActivityRepository(self.service, initial_records=self.initial_records)

    def login_as(self, user_id):
        prior = self.service.create_anonymous()
        return self.service.issue_authenticated(user_id, prior.token, self.policy.origin, prior.csrf_token)

    def event(self, path='/api/activities', method='GET', payload=None, issued=None, **headers):
        token_info = issued or self.issued
        hdrs = {
            'origin': self.policy.origin,
            'x-csrf-token': token_info.csrf_token,
            'idempotency-key': 'test-idem-activity-0001',
            **headers,
        }
        return {
            'version': '2.0',
            'rawPath': path,
            'requestContext': {
                'http': {'method': method},
                'requestId': 'req-activity-test',
            },
            'headers': hdrs,
            'cookies': [token_info.cookie],
            'body': json.dumps(payload if payload is not None else {}),
        }

    def call(self, event):
        return handle(event, self.service, self.repo)

    def test_activity_create_and_read_back_success(self):
        payload = {
            'scopeId': 'c1',
            'title': 'Global Tech Symposium 2026',
            'type': 'event',
            'summary': 'Annual technology collaboration symposium',
            'fullDescription': 'Comprehensive academic and research symposium with industry partners.',
            'partnerId': 'p1',
            'coHostPartnerIds': ['p2'],
            'agreementIds': ['g1'],
            'periodText': '15-18 October 2026',
            'periodDate': '2026-10-15',
            'imagePath': 'resources/symposium.jpg',
            'responsibleUserIds': ['u_coord1'],
            'publication': 'internal',
        }
        create_res = self.call(self.event('/api/activities', 'POST', payload))
        self.assertEqual(201, create_res['statusCode'])
        data = json.loads(create_res['body'])['data']
        self.assertTrue(data['id'].startswith('activity-'))
        self.assertEqual('Global Tech Symposium 2026', data['title'])
        self.assertEqual('event', data['type'])
        self.assertEqual('p1', data['partnerId'])
        self.assertEqual('2026-10-15', data['periodDate'])
        self.assertEqual(1, data['version'])
        self.assertEqual('internal', data['publication'])
        self.assertEqual(['u_coord1'], data['responsibleUserIds'])

        # Read back
        read_res = self.call(self.event(f"/api/activities/{data['id']}", 'GET'))
        self.assertEqual(200, read_res['statusCode'])
        read_data = json.loads(read_res['body'])['data']
        self.assertEqual(data['id'], read_data['id'])
        self.assertEqual(data['title'], read_data['title'])

    def test_activity_coordinator_creation_assigns_self_and_defaults_internal(self):
        coord_issued = self.login_as('u_coord1')
        payload = {
            'scopeId': 'c1',
            'title': 'Coordinator Hosted Workshop',
            'type': 'academic_activity',
            'summary': 'Workshop arranged by coordinator',
            'partnerId': 'p1',
            'periodDate': '2026-11-01',
        }
        res = self.call(self.event('/api/activities', 'POST', payload, issued=coord_issued))
        self.assertEqual(201, res['statusCode'])
        data = json.loads(res['body'])['data']
        self.assertEqual(['u_coord1'], data['responsibleUserIds'])
        self.assertEqual('internal', data['publication'])

    def test_activity_coordinator_cannot_forge_publication_or_assignee(self):
        coord_issued = self.login_as('u_coord1')
        payload = {
            'scopeId': 'c1',
            'title': 'Forged Activity',
            'type': 'event',
            'summary': 'Attempting unauthorized fields',
            'partnerId': 'p1',
        }
        # Attempt to set publication to public
        forged_pub = {**payload, 'publication': 'public'}
        res_pub = self.call(self.event('/api/activities', 'POST', forged_pub, issued=coord_issued))
        self.assertEqual(403, res_pub['statusCode'])

        # Attempt to set responsibleUserIds
        forged_resp = {**payload, 'responsibleUserIds': ['u_coord2']}
        res_resp = self.call(self.event('/api/activities', 'POST', forged_resp, issued=coord_issued))
        self.assertEqual(403, res_resp['statusCode'])

    def test_activity_coordinator_cannot_edit_public_activity_display_fields(self):
        # Create a public activity by staff
        payload = {
            'scopeId': 'c1',
            'title': 'Public Announcement Activity',
            'type': 'event',
            'summary': 'Initial public summary',
            'partnerId': 'p1',
            'publication': 'public',
            'responsibleUserIds': ['u_coord1'],
        }
        create_res = self.call(self.event('/api/activities', 'POST', payload))
        act_id = json.loads(create_res['body'])['data']['id']

        # Coordinator attempts to PATCH display field 'title'
        coord_issued = self.login_as('u_coord1')
        patch_res = self.call(self.event(
            f"/api/activities/{act_id}",
            'PATCH',
            {'title': 'Changed by coordinator'},
            issued=coord_issued,
            **{'if-match': '"1"'}
        ))
        self.assertEqual(403, patch_res['statusCode'])

    def test_activity_optimistic_concurrency_and_stale_if_match(self):
        payload = {
            'scopeId': 'c1',
            'title': 'Version Testing Activity',
            'type': 'research',
            'summary': 'Testing optimistic locking',
            'partnerId': 'p1',
            'responsibleUserIds': ['u_coord1'],
        }
        create_res = self.call(self.event('/api/activities', 'POST', payload))
        act_id = json.loads(create_res['body'])['data']['id']

        # Missing If-Match returns 428
        res_no_match = self.call(self.event(
            f"/api/activities/{act_id}",
            'PATCH',
            {'summary': 'Update without if-match'}
        ))
        self.assertEqual(428, res_no_match['statusCode'])

        # Correct If-Match returns 200 and version 2
        res_v1 = self.call(self.event(
            f"/api/activities/{act_id}",
            'PATCH',
            {'summary': 'First update'},
            **{'if-match': '"1"'}
        ))
        self.assertEqual(200, res_v1['statusCode'])
        self.assertEqual(2, json.loads(res_v1['body'])['data']['version'])

        # Stale If-Match "1" returns 409 Conflict
        res_stale = self.call(self.event(
            f"/api/activities/{act_id}",
            'PATCH',
            {'summary': 'Second update with old version'},
            **{'if-match': '"1"'}
        ))
        self.assertEqual(409, res_stale['statusCode'])

    def test_activity_idempotency_key_replay_and_conflict(self):
        payload = {
            'scopeId': 'c1',
            'title': 'Idempotent Activity',
            'type': 'event',
            'summary': 'Testing idempotency cache',
            'partnerId': 'p1',
        }
        key = 'idem-activity-fixed-key-12345'
        first = self.call(self.event('/api/activities', 'POST', payload, **{'idempotency-key': key}))
        self.assertEqual(201, first['statusCode'])
        first_id = json.loads(first['body'])['data']['id']

        # Replay with identical payload and key returns 201 with identical record
        replay = self.call(self.event('/api/activities', 'POST', payload, **{'idempotency-key': key}))
        self.assertEqual(201, replay['statusCode'])
        self.assertEqual(first_id, json.loads(replay['body'])['data']['id'])
        self.assertEqual(1, self.repo.writes)

        # Altered payload with same key returns 409 Conflict
        altered = {**payload, 'title': 'Altered Activity Title'}
        conflict = self.call(self.event('/api/activities', 'POST', altered, **{'idempotency-key': key}))
        self.assertEqual(409, conflict['statusCode'])

    def test_activity_invalid_fields_and_malformed_values(self):
        base = {
            'scopeId': 'c1',
            'title': 'Base Valid',
            'type': 'event',
            'summary': 'Valid summary',
            'partnerId': 'p1',
        }
        invalid_cases = [
            ({'title': ''}, 422),
            ({'type': 'invalid_type'}, 422),
            ({'periodDate': '2026-02-30'}, 422),  # invalid calendar date
            ({'periodDate': '2026-10-15T00:00:00Z'}, 422),  # ISO datetime not allowed
            ({'imagePath': 'https://evil.com/img.png'}, 422),  # non-resource url
            ({'imagePath': '../secret.txt'}, 422),  # traversal
            ({'title': 'x' * 201}, 422),  # exceeds 200 chars
            ({'summary': 'x' * 2001}, 422),  # exceeds 2000 chars
            ({'coHostPartnerIds': 'not-a-list'}, 422),
            ({'createdAt': '2026-10-11T00:00:00Z'}, 403),  # server field injection
            ({'version': 1}, 403),  # server field injection
        ]
        for patch, expected_status in invalid_cases:
            with self.subTest(patch=patch):
                res = self.call(self.event('/api/activities', 'POST', {**base, **patch}))
                self.assertEqual(expected_status, res['statusCode'])
        self.assertEqual(0, self.repo.writes)

    def test_activity_primary_in_cohosts_rejected(self):
        payload = {
            'scopeId': 'c1',
            'title': 'Duplicate Host Activity',
            'type': 'event',
            'summary': 'Primary partner cannot be co-host',
            'partnerId': 'p1',
            'coHostPartnerIds': ['p1'],
        }
        res = self.call(self.event('/api/activities', 'POST', payload))
        self.assertEqual(422, res['statusCode'])
        self.assertEqual(0, self.repo.writes)

    def test_activity_cross_scope_and_missing_references_rejected(self):
        base = {
            'scopeId': 'c1',
            'title': 'Reference Integrity Test',
            'type': 'event',
            'summary': 'Testing references',
            'partnerId': 'p1',
        }
        cases = [
            ({**base, 'partnerId': 'p_c2'}, 'Cross-scope primary partner'),
            ({**base, 'partnerId': 'p_missing'}, 'Missing primary partner'),
            ({**base, 'coHostPartnerIds': ['p_c2']}, 'Cross-scope co-host partner'),
            ({**base, 'coHostPartnerIds': ['p_missing']}, 'Missing co-host partner'),
            ({**base, 'agreementIds': ['g_c2']}, 'Cross-scope agreement'),
            ({**base, 'agreementIds': ['g_missing']}, 'Missing agreement'),
        ]
        for payload, description in cases:
            with self.subTest(description=description):
                res = self.call(self.event('/api/activities', 'POST', payload))
                self.assertEqual(422, res['statusCode'])
        self.assertEqual(0, self.repo.writes)

    def test_activity_responsible_user_assignee_validation(self):
        base = {
            'scopeId': 'c1',
            'title': 'Assignee Validation Test',
            'type': 'event',
            'summary': 'Testing responsible users',
            'partnerId': 'p1',
        }
        # Unverified user in scope
        res_unverified = self.call(self.event('/api/activities', 'POST', {**base, 'responsibleUserIds': ['u_unverified']}))
        self.assertEqual(422, res_unverified['statusCode'])

        # Inactive user in scope
        res_inactive = self.call(self.event('/api/activities', 'POST', {**base, 'responsibleUserIds': ['u_inactive']}))
        self.assertEqual(422, res_inactive['statusCode'])

        # Cross-scope user (coordinator in c2)
        res_c2 = self.call(self.event('/api/activities', 'POST', {**base, 'responsibleUserIds': ['u_coord_c2']}))
        self.assertEqual(422, res_c2['statusCode'])

        # Student user (cannot be responsible user for activity)
        res_student = self.call(self.event('/api/activities', 'POST', {**base, 'responsibleUserIds': ['u_student']}))
        self.assertEqual(422, res_student['statusCode'])

        # Unknown user ID
        res_unknown = self.call(self.event('/api/activities', 'POST', {**base, 'responsibleUserIds': ['u_nonexistent']}))
        self.assertEqual(422, res_unknown['statusCode'])

        # Valid verified coordinator in scope c1 succeeds
        res_valid = self.call(self.event('/api/activities', 'POST', {**base, 'responsibleUserIds': ['u_coord1', 'u_coord2']}))
        self.assertEqual(201, res_valid['statusCode'])

    def test_activity_reassignment_updates_access_matrix(self):
        # 1. Staff creates internal activity assigned to u_coord1
        payload = {
            'scopeId': 'c1',
            'title': 'Reassignment Target Activity',
            'type': 'event',
            'summary': 'Testing role changes',
            'partnerId': 'p1',
            'responsibleUserIds': ['u_coord1'],
            'publication': 'internal',
        }
        res_create = self.call(self.event('/api/activities', 'POST', payload))
        act_id = json.loads(res_create['body'])['data']['id']

        # u_coord1 can read and update
        coord1_issued = self.login_as('u_coord1')
        res_c1 = self.call(self.event(
            f"/api/activities/{act_id}", 'PATCH', {'summary': 'Updated by coord 1'},
            issued=coord1_issued, **{'if-match': '"1"'}
        ))
        self.assertEqual(200, res_c1['statusCode'])

        # u_coord2 (unassigned) cannot update
        coord2_issued = self.login_as('u_coord2')
        res_c2_denied = self.call(self.event(
            f"/api/activities/{act_id}", 'PATCH', {'summary': 'Coord 2 trying to edit'},
            issued=coord2_issued, **{'if-match': '"2"'}
        ))
        self.assertEqual(404, res_c2_denied['statusCode'])

        # 2. Staff reassigns activity to u_coord2
        res_reassign = self.call(self.event(
            f"/api/activities/{act_id}", 'PATCH', {'responsibleUserIds': ['u_coord2']},
            **{'if-match': '"2"'}
        ))
        self.assertEqual(200, res_reassign['statusCode'])

        # Now u_coord1 is unassigned -> update denied
        res_c1_revoked = self.call(self.event(
            f"/api/activities/{act_id}", 'PATCH', {'summary': 'Coord 1 trying after reassignment'},
            issued=coord1_issued, **{'if-match': '"3"'}
        ))
        self.assertEqual(404, res_c1_revoked['statusCode'])

        # Now u_coord2 is assigned -> update allowed
        res_c2_allowed = self.call(self.event(
            f"/api/activities/{act_id}", 'PATCH', {'summary': 'Coord 2 update after reassignment'},
            issued=coord2_issued, **{'if-match': '"3"'}
        ))
        self.assertEqual(200, res_c2_allowed['statusCode'])

    def test_activity_public_projection_sanitizes_internal_fields(self):
        activity = {
            'id': 'act-pub-1',
            'entityType': 'activity',
            'schemaVersion': 3,
            'scopeId': 'c1',
            'version': 1,
            'title': 'Public Showcase',
            'type': 'event',
            'summary': 'Public summary',
            'fullDescription': 'Full detail text',
            'partnerId': 'p1',
            'coHostPartnerIds': ['p2'],
            'agreementIds': ['g1'],
            'periodText': '2026',
            'periodDate': '2026-10-20',
            'imagePath': 'resources/showcase.jpg',
            'responsibleUserIds': ['u_coord1'],
            'publication': 'public',
        }
        partners = {r['id']: r for r in self.initial_records if r['entityType'] == 'partner'}
        projected = public_projection('activity', activity, partners)

        self.assertIsNotNone(projected)
        self.assertEqual('Public Showcase', projected['title'])
        self.assertEqual('Partner One', projected['partnerName'])
        self.assertEqual(['Partner Two'], projected['co_hosts'])
        self.assertEqual('public', projected['visibility'])
        self.assertEqual('resources/showcase.jpg', projected['image_path'])
        self.assertEqual('2026-10-20', projected['period_date'])

        # Sensitive internal fields MUST NOT leak
        self.assertNotIn('responsibleUserIds', projected)
        self.assertNotIn('agreementIds', projected)
        self.assertNotIn('scopeId', projected)

    def test_activity_tags_mou_preserved_on_update(self):
        # Create an activity record with existing activity_tags: ['mou']
        act_row = {
            'id': 'act-mou-1',
            'entityType': 'activity',
            'schemaVersion': 3,
            'scopeId': 'c1',
            'version': 1,
            'title': 'MoU Signing Activity',
            'type': 'academic_activity',
            'summary': 'MoU ceremonial signing event',
            'partnerId': 'p1',
            'responsibleUserIds': ['u_coord1'],
            'publication': 'internal',
            'activity_tags': ['mou'],
        }
        self.repo.rows[('activity', 'act-mou-1')] = act_row

        # Update summary via PATCH
        res = self.call(self.event(
            '/api/activities/act-mou-1',
            'PATCH',
            {'summary': 'Updated MoU summary'},
            **{'if-match': '"1"'}
        ))
        self.assertEqual(200, res['statusCode'])

        # Stored row preserves activity_tags
        stored = self.repo.get('activity', 'act-mou-1')
        self.assertEqual(['mou'], stored.get('activity_tags'))


if __name__ == '__main__':
    unittest.main()
