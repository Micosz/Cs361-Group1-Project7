"""Comprehensive test suite for Agreement domain (Issue #98 / Parent #83).

Verifies:
  - MoU / MoA create, read-back, and update operations
  - Required field validations (title, agreementType, partnerIds, scopeId)
  - Date validation (format, calendar correctness, startDate <= endDate)
  - Field bounds and unknown/forbidden field injection rejection
  - Role-based and scope-based permissions (Coordinator, Staff, Executive, Student, Anonymous)
  - Coordinator self-assignment on create vs assigned coordinator edit
  - Optimistic concurrency control (If-Match required, stale version returns 409)
  - Idempotency-Key replay (same payload returns identical result, different payload returns 409)
  - Internal confidentiality: Agreements never leak to Public projections
"""

from datetime import datetime, timezone
import json
import unittest

from backend.auth.session_service import SessionContext, UserState
from backend.http_api import handle
from backend.agreements.repository import AgreementRepository
from backend.agreements.validators import (
    validate_agreement_payload,
    validate_date,
)
from backend.permissions.projections import public_projection
from backend.tests import test_sessions as session_helpers


def user_context(role='staff', scope='c1', user='u1', extra=()):
    grants = ({'role': role, 'scopeId': scope, 'active': True},) if role else ()
    return SessionContext(UserState(user, True, 1, True, grants=grants + extra), 2000)


class AgreementTests(unittest.TestCase):
    login = session_helpers.SessionTests.login

    def login_as(self, user):
        self.users.user = user
        self.mock_user_dict[user.user_id] = user
        self.issued = self.service._issue(user)
        return self.issued

    def setUp(self):
        session_helpers.SessionTests.setUp(self)
        self.mock_user_dict = {}
        orig_get = self.users.get
        def mock_get(key):
            if self.users.user and key == self.users.user.user_id:
                return self.users.user
            if key in self.mock_user_dict:
                return self.mock_user_dict[key]
            return orig_get(key)
        self.users.get = mock_get
        self.repo = AgreementRepository(self.service, user_store=self.mock_user_dict)
        self.login_as(user_context('staff', 'c1', 'u1').user)
        for pid, name in [('partner-001', 'Partner Univ'), ('partner-002', 'Tech Corp'),
                          ('partner-1', 'AI Research Partner'), ('partner-2', 'Robotics Partner')]:
            self.repo.rows[('partner', pid)] = {
                'id': pid,
                'entityType': 'partner',
                'name': name,
                'scopeId': 'c1',
                'publication': 'internal',
                'responsibleUserIds': ['u1'],
            }

    def event(self, path='/api/agreements', method='GET', payload=None, query=None, **headers):
        if '?' in path:
            path_part, query_part = path.split('?', 1)
            from urllib.parse import parse_qs
            parsed_query = {k: v[0] for k, v in parse_qs(query_part).items()}
            query = {**(query or {}), **parsed_query}
            path = path_part
        import uuid
        idem_key = headers.pop('idempotency-key', None) or f"test-idem-{uuid.uuid4().hex}"
        hdrs = {
            'origin': self.policy.origin,
            'x-csrf-token': self.issued.csrf_token,
            'idempotency-key': idem_key,
            **headers,
        }
        ev = {
            'version': '2.0',
            'rawPath': path,
            'requestContext': {
                'http': {'method': method},
                'requestId': 'req-agreement-test-1',
            },
            'headers': hdrs,
            'cookies': [self.issued.cookie],
            'body': json.dumps(payload if payload is not None else {}),
        }
        if query:
            ev['queryStringParameters'] = query
        return ev


    def call(self, event):
        return handle(event, self.service, self.repo)

    # -------------------------------------------------------------
    # 1. Create, Read-back, and Update MoU / MoA
    # -------------------------------------------------------------
    def test_agreement_create_and_read_back_success(self):
        payload = {
            'title': 'Academic Collaboration MoU with Partner Univ',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'startDate': '2026-10-01',
            'endDate': '2027-09-30',
            'renewalDueOn': '2027-08-01',
            'renewalNote': 'Review renewal 2 months before expiration',
            'internalNote': 'Faculty internal contact: Prof. Somchai',
        }
        res = self.call(self.event('/api/agreements', 'POST', payload))
        self.assertEqual(201, res['statusCode'])
        data = json.loads(res['body'])['data']
        aid = data['id']
        self.assertEqual('Academic Collaboration MoU with Partner Univ', data['title'])
        self.assertEqual('MoU', data['agreementType'])
        self.assertEqual(1, data['version'])
        self.assertEqual('draft', data['status'])
        self.assertEqual('2026-10-01', data['startDate'])
        self.assertEqual('2027-09-30', data['endDate'])

        # Read-back
        read_res = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(200, read_res['statusCode'])
        read_data = json.loads(read_res['body'])['data']
        self.assertEqual(aid, read_data['id'])
        self.assertEqual('Academic Collaboration MoU with Partner Univ', read_data['title'])
        self.assertEqual('draft', read_data['status'])
        self.assertEqual(['u1'], read_data['responsibleUserIds'])

    def test_agreement_moa_type_and_patch_update(self):
        # Create MoA
        payload = {
            'title': 'Student Exchange MoA with Tech Corp',
            'agreementType': 'MoA',
            'partnerIds': ['partner-002'],
            'scopeId': 'c1',
        }
        res = self.call(self.event('/api/agreements', 'POST', payload))
        self.assertEqual(201, res['statusCode'])
        data = json.loads(res['body'])['data']
        aid = data['id']
        self.assertEqual('MoA', data['agreementType'])
        self.assertEqual(1, data['version'])

        # Update via PATCH
        update_payload = {
            'title': 'Student Exchange MoA with Tech Corp (Updated)',
            'startDate': '2026-11-01',
            'endDate': '2027-10-31',
            'internalNote': 'Updated internship quota to 10 students',
        }
        patch_res = self.call(self.event(f'/api/agreements/{aid}', 'PATCH', update_payload,
                                         **{'if-match': '"1"'}))
        self.assertEqual(200, patch_res['statusCode'])
        patch_data = json.loads(patch_res['body'])['data']
        self.assertEqual('Student Exchange MoA with Tech Corp (Updated)', patch_data['title'])
        self.assertEqual(2, patch_data['version'])
        self.assertEqual('2026-11-01', patch_data['startDate'])
        self.assertEqual('2027-10-31', patch_data['endDate'])

    # -------------------------------------------------------------
    # 2. Validation: Required fields, dates, limits, and unknown fields
    # -------------------------------------------------------------
    def test_agreement_create_missing_required_fields(self):
        required = ['title', 'agreementType', 'partnerIds', 'scopeId']
        valid = {
            'title': 'Valid Title',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
        }
        for field in required:
            bad = dict(valid)
            del bad[field]
            res = self.call(self.event('/api/agreements', 'POST', bad))
            self.assertEqual(422, res['statusCode'], f"Missing {field} must fail with 422")

    def test_agreement_invalid_types_and_date_rules(self):
        base = {
            'title': 'Valid Title',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
        }
        # Invalid agreementType
        bad_type = dict(base, agreementType='Contract')
        res = self.call(self.event('/api/agreements', 'POST', bad_type))
        self.assertEqual(422, res['statusCode'])

        # Empty partnerIds
        empty_pids = dict(base, partnerIds=[])
        res = self.call(self.event('/api/agreements', 'POST', empty_pids))
        self.assertEqual(422, res['statusCode'])

        # Malformed date strings
        for bad_date in ['2026-13-01', '2026-02-30', 'invalid-date', '26-10-2026']:
            bad = dict(base, startDate=bad_date)
            res = self.call(self.event('/api/agreements', 'POST', bad))
            self.assertEqual(422, res['statusCode'])

        # Range check: startDate > endDate
        inverted_dates = dict(base, startDate='2027-01-01', endDate='2026-01-01')
        res = self.call(self.event('/api/agreements', 'POST', inverted_dates))
        self.assertEqual(422, res['statusCode'])

    def test_agreement_string_length_limits(self):
        base = {
            'title': 'Valid Title',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
        }
        # Title > 200 chars
        long_title = dict(base, title='A' * 201)
        res = self.call(self.event('/api/agreements', 'POST', long_title))
        self.assertEqual(422, res['statusCode'])

        # renewalNote > 20,000 chars
        long_note = dict(base, renewalNote='B' * 20001)
        res = self.call(self.event('/api/agreements', 'POST', long_note))
        self.assertEqual(422, res['statusCode'])

    def test_agreement_unknown_and_injected_fields_rejected(self):
        base = {
            'title': 'Valid Title',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
        }
        # Unknown field
        unknown = dict(base, unsupportedField='hack')
        res = self.call(self.event('/api/agreements', 'POST', unknown))
        self.assertEqual(422, res['statusCode'])

        # Server-owned field injection (version, status, id)
        for injected_key, val in [('version', 10), ('status', 'active'), ('id', 'fake-id')]:
            injected = dict(base)
            injected[injected_key] = val
            res = self.call(self.event('/api/agreements', 'POST', injected))
            self.assertEqual(403, res['statusCode'])

    # -------------------------------------------------------------
    # 3. Roles and Permissions
    # -------------------------------------------------------------
    def test_coordinator_creates_with_auto_assignment(self):
        # Coordinator in c1 creates agreement
        self.login_as(user_context('coordinator', 'c1', 'u1').user)

        payload = {
            'title': 'Coordinator MoU',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
        }
        res = self.call(self.event('/api/agreements', 'POST', payload))
        self.assertEqual(201, res['statusCode'])
        data = json.loads(res['body'])['data']
        self.assertEqual(['u1'], data['responsibleUserIds'])
        aid = data['id']

        # Assigned coordinator can read
        read_res = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(200, read_res['statusCode'])

        # Assigned coordinator can update business fields
        patch_res = self.call(self.event(f'/api/agreements/{aid}', 'PATCH',
                                         {'title': 'Updated by Coord'},
                                         **{'if-match': '"1"'}))
        self.assertEqual(200, patch_res['statusCode'])

        # Unassigned coordinator in c1 cannot read or update
        self.repo.rows[('agreement', aid)]['responsibleUserIds'] = ['other_coord']
        denied_read = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(404, denied_read['statusCode'])
        denied_patch = self.call(self.event(f'/api/agreements/{aid}', 'PATCH',
                                             {'title': 'Unassigned edit'},
                                             **{'if-match': '"2"'}))
        self.assertEqual(404, denied_patch['statusCode'])

    def test_executive_and_student_permissions(self):
        # Create agreement as staff
        payload = {
            'title': 'Executive Review Agreement',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'internalNote': 'Highly sensitive internal discussion',
        }
        res = self.call(self.event('/api/agreements', 'POST', payload))
        aid = json.loads(res['body'])['data']['id']

        # Executive in c1 can read, but internalNote must be stripped
        self.login_as(user_context('executive', 'c1', 'u1').user)
        exec_res = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(200, exec_res['statusCode'])
        exec_data = json.loads(exec_res['body'])['data']
        self.assertEqual('Executive Review Agreement', exec_data['title'])
        self.assertNotIn('internalNote', exec_data)

        # Executive cannot write (POST/PATCH)
        exec_post = self.call(self.event('/api/agreements', 'POST', payload))
        self.assertEqual(403, exec_post['statusCode'])
        exec_patch = self.call(self.event(f'/api/agreements/{aid}', 'PATCH',
                                          {'title': 'Exec Edit'},
                                          **{'if-match': '"1"'}))
        self.assertEqual(403, exec_patch['statusCode'])

        # Unselected student cannot read; student writes remain forbidden
        self.login_as(user_context('student', 'c1', 'u1').user)
        stu_read = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(404, stu_read['statusCode'])
        stu_post = self.call(self.event('/api/agreements', 'POST', payload))
        self.assertEqual(403, stu_post['statusCode'])

    def test_cross_scope_isolation(self):
        # Staff in c1 creates agreement
        payload = {
            'title': 'Scope C1 Agreement',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
        }
        res = self.call(self.event('/api/agreements', 'POST', payload))
        aid = json.loads(res['body'])['data']['id']

        # Staff in c2 cannot read or update c1 agreement
        self.login_as(user_context('staff', 'c2', 'u1').user)
        read_res = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(404, read_res['statusCode'])
        patch_res = self.call(self.event(f'/api/agreements/{aid}', 'PATCH',
                                         {'title': 'Scope breach'},
                                         **{'if-match': '"1"'}))
        self.assertEqual(404, patch_res['statusCode'])

    # -------------------------------------------------------------
    # 4. Optimistic Concurrency Control (If-Match)
    # -------------------------------------------------------------
    def test_optimistic_concurrency_if_match_contract(self):
        payload = {
            'title': 'Concurrency Agreement',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
        }
        res = self.call(self.event('/api/agreements', 'POST', payload))
        aid = json.loads(res['body'])['data']['id']

        # Missing If-Match returns 428 Precondition Required
        no_if_match = self.call(self.event(f'/api/agreements/{aid}', 'PATCH', {'title': 'New'}))
        self.assertEqual(428, no_if_match['statusCode'])

        # Invalid format If-Match returns 422
        bad_format = self.call(self.event(f'/api/agreements/{aid}', 'PATCH', {'title': 'New'},
                                          **{'if-match': '1'}))
        self.assertEqual(422, bad_format['statusCode'])

        # Stale If-Match returns 409 Conflict
        stale = self.call(self.event(f'/api/agreements/{aid}', 'PATCH', {'title': 'New'},
                                     **{'if-match': '"999"'}))
        self.assertEqual(409, stale['statusCode'])

    # -------------------------------------------------------------
    # 5. Idempotency-Key Caching and Replay Contract
    # -------------------------------------------------------------
    def test_idempotency_key_replay_and_conflict(self):
        payload = {
            'title': 'Idempotent MoU',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
        }
        idem_key = 'idem-unique-agreement-123456789'

        # First submission
        res1 = self.call(self.event('/api/agreements', 'POST', payload,
                                    **{'idempotency-key': idem_key}))
        self.assertEqual(201, res1['statusCode'])
        data1 = json.loads(res1['body'])['data']
        self.assertEqual(1, self.repo.writes)

        # Replay with identical payload returns identical response without extra write
        res2 = self.call(self.event('/api/agreements', 'POST', payload,
                                    **{'idempotency-key': idem_key}))
        self.assertEqual(201, res2['statusCode'])
        data2 = json.loads(res2['body'])['data']
        self.assertEqual(data1['id'], data2['id'])
        self.assertEqual(1, self.repo.writes)

        # Replay with DIFFERENT payload returns 409 Conflict
        different_payload = dict(payload, title='Different Title')
        res3 = self.call(self.event('/api/agreements', 'POST', different_payload,
                                    **{'idempotency-key': idem_key}))
        self.assertEqual(409, res3['statusCode'])
        self.assertEqual(1, self.repo.writes)

    # -------------------------------------------------------------
    # 6. Internal Confidentiality: Agreements never leak to Public
    # -------------------------------------------------------------
    def test_agreement_does_not_leak_to_public_projection(self):
        agreement_rec = {
            'id': 'agreement-secret-001',
            'entityType': 'agreement',
            'title': 'Secret MoU',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'status': 'draft',
            'version': 1,
            'publication': 'internal',  # Explicitly private agreements stay hidden
        }
        proj = public_projection('agreement', agreement_rec)
        self.assertIsNone(proj, "Internal agreements must never be exposed via public projections")

    # -------------------------------------------------------------
    # 7. List and Query Filter
    # -------------------------------------------------------------
    def test_agreement_list_and_search_filter(self):
        # Create 2 agreements
        for idx, title in enumerate(['AI Research MoU', 'Robotics MoA'], 1):
            self.call(self.event('/api/agreements', 'POST', {
                'title': title,
                'agreementType': 'MoU' if 'MoU' in title else 'MoA',
                'partnerIds': [f'partner-{idx}'],
                'scopeId': 'c1',
            }, **{'idempotency-key': f'idem-list-test-{idx:04d}000000'}))

        # List all
        list_res = self.call(self.event('/api/agreements', 'GET'))
        self.assertEqual(200, list_res['statusCode'])
        body = json.loads(list_res['body'])
        self.assertEqual(2, body['count'])

        # Search with query q
        q_res = self.call(self.event('/api/agreements?q=Robotics', 'GET'))
        self.assertEqual(200, q_res['statusCode'])
        q_body = json.loads(q_res['body'])
        self.assertEqual(1, q_body['count'])
        self.assertEqual('Robotics MoA', q_body['data'][0]['title'])

    # -------------------------------------------------------------
    # 8. Issue #99: Multiple Partners, Assignee Validation, and Dates
    # -------------------------------------------------------------
    def test_agreement_multiple_partners_success(self):
        # Create agreement with multiple valid partners in scope c1
        payload = {
            'title': 'Consortium Agreement with 2 Partners',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001', 'partner-002'],
            'scopeId': 'c1',
            'startDate': '2026-10-01',
            'endDate': '2027-09-30',
        }
        res = self.call(self.event('/api/agreements', 'POST', payload))
        self.assertEqual(201, res['statusCode'])
        data = json.loads(res['body'])['data']
        aid = data['id']
        self.assertEqual(['partner-001', 'partner-002'], data['partnerIds'])

        # Read back returns both partner IDs
        read_res = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(200, read_res['statusCode'])
        read_data = json.loads(read_res['body'])['data']
        self.assertEqual(['partner-001', 'partner-002'], read_data['partnerIds'])

    def test_agreement_invalid_partner_references(self):
        base = {
            'title': 'Partners Ref Check',
            'agreementType': 'MoU',
            'scopeId': 'c1',
        }
        # 1. Non-existent partner ID
        res_missing = self.call(self.event('/api/agreements', 'POST', dict(base, partnerIds=['non-existent-partner'])))
        self.assertEqual(422, res_missing['statusCode'])

        # 2. Duplicate partner IDs in list
        res_dup = self.call(self.event('/api/agreements', 'POST', dict(base, partnerIds=['partner-001', 'partner-001'])))
        self.assertEqual(422, res_dup['statusCode'])

        # 3. Cross-scope partner ID
        self.repo.rows[('partner', 'partner-scope-c2')] = {
            'id': 'partner-scope-c2',
            'entityType': 'partner',
            'name': 'Other Campus Partner',
            'scopeId': 'c2',
            'publication': 'internal',
            'responsibleUserIds': ['u1'],
        }
        res_cross = self.call(self.event('/api/agreements', 'POST', dict(base, partnerIds=['partner-scope-c2'])))
        self.assertEqual(422, res_cross['statusCode'])

        # 4. Wrong entity type (e.g. contact instead of partner)
        self.repo.rows[('contact', 'contact-001')] = {
            'id': 'contact-001',
            'entityType': 'contact',
            'scopeId': 'c1',
        }
        res_type = self.call(self.event('/api/agreements', 'POST', dict(base, partnerIds=['contact-001'])))
        self.assertEqual(422, res_type['statusCode'])

        # 5. Partner cannot be read by caller (coordinator not in responsibleUserIds)
        self.login_as(user_context('coordinator', 'c1', 'coord_isolated').user)
        # Partner-001 has responsibleUserIds=['u1'], coord_isolated has no read permission
        res_unreadable = self.call(self.event('/api/agreements', 'POST', dict(base, partnerIds=['partner-001'])))
        self.assertEqual(422, res_unreadable['statusCode'])

    def test_agreement_assignee_validation(self):
        # Register test users
        coord_valid = user_context('coordinator', 'c1', 'coord_valid').user
        coord_unverified = UserState('coord_unverified', True, 1, False, grants=({'role': 'coordinator', 'scopeId': 'c1', 'active': True},))
        coord_inactive = UserState('coord_inactive', False, 1, True, grants=({'role': 'coordinator', 'scopeId': 'c1', 'active': True},))
        coord_wrong_scope = user_context('coordinator', 'c2', 'coord_wrong_scope').user
        student_user = user_context('student', 'c1', 'student_user').user

        for u in [coord_valid, coord_unverified, coord_inactive, coord_wrong_scope, student_user]:
            self.mock_user_dict[u.user_id] = u

        base = {
            'title': 'Assignee Check Agreement',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
        }

        # Valid staff can assign valid coordinator
        res_valid = self.call(self.event('/api/agreements', 'POST', dict(base, responsibleUserIds=['coord_valid'])))
        self.assertEqual(201, res_valid['statusCode'])
        self.assertEqual(['coord_valid'], json.loads(res_valid['body'])['data']['responsibleUserIds'])

        # Unverified user rejected
        res_unver = self.call(self.event('/api/agreements', 'POST', dict(base, responsibleUserIds=['coord_unverified'])))
        self.assertEqual(422, res_unver['statusCode'])

        # Inactive user rejected
        res_inact = self.call(self.event('/api/agreements', 'POST', dict(base, responsibleUserIds=['coord_inactive'])))
        self.assertEqual(422, res_inact['statusCode'])

        # Wrong scope user rejected
        res_scope = self.call(self.event('/api/agreements', 'POST', dict(base, responsibleUserIds=['coord_wrong_scope'])))
        self.assertEqual(422, res_scope['statusCode'])

        # Student user rejected (not coordinator/staff)
        res_stu = self.call(self.event('/api/agreements', 'POST', dict(base, responsibleUserIds=['student_user'])))
        self.assertEqual(422, res_stu['statusCode'])

        # Non-existent user rejected
        res_missing = self.call(self.event('/api/agreements', 'POST', dict(base, responsibleUserIds=['ghost_user'])))
        self.assertEqual(422, res_missing['statusCode'])

        # Duplicate assignees rejected
        res_dup = self.call(self.event('/api/agreements', 'POST', dict(base, responsibleUserIds=['coord_valid', 'coord_valid'])))
        self.assertEqual(422, res_dup['statusCode'])

    def test_agreement_coordinator_cannot_edit_responsibilities(self):
        # Create agreement as staff, assigning coordinator u1
        payload = {
            'title': 'Coord Update Test',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'responsibleUserIds': ['u1'],
        }
        res = self.call(self.event('/api/agreements', 'POST', payload))
        self.assertEqual(201, res['statusCode'])
        aid = json.loads(res['body'])['data']['id']

        # Switch to coordinator u1
        self.login_as(user_context('coordinator', 'c1', 'u1').user)

        # Coordinator can update title
        ok_patch = self.call(self.event(f'/api/agreements/{aid}', 'PATCH',
                                        {'title': 'Updated Title by Coord'},
                                        **{'if-match': '"1"'}))
        self.assertEqual(200, ok_patch['statusCode'])

        # Coordinator cannot update responsibleUserIds -> 403 Forbidden
        denied_patch = self.call(self.event(f'/api/agreements/{aid}', 'PATCH',
                                            {'responsibleUserIds': ['other_user']},
                                            **{'if-match': '"2"'}))
        self.assertEqual(403, denied_patch['statusCode'])

    def test_agreement_dynamic_coordinator_permission_transfer(self):
        coord_a = user_context('coordinator', 'c1', 'coord_a').user
        coord_b = user_context('coordinator', 'c1', 'coord_b').user
        self.mock_user_dict['coord_a'] = coord_a
        self.mock_user_dict['coord_b'] = coord_b
        # Partner readable by both coord_a and coord_b
        self.repo.rows[('partner', 'partner-001')]['responsibleUserIds'] = ['u1', 'coord_a', 'coord_b']

        # Staff creates agreement assigned to coord_a
        res = self.call(self.event('/api/agreements', 'POST', {
            'title': 'Assignment Transfer Agreement',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'responsibleUserIds': ['coord_a'],
        }))
        self.assertEqual(201, res['statusCode'])
        aid = json.loads(res['body'])['data']['id']

        # Coord A can read
        self.login_as(coord_a)
        res_a1 = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(200, res_a1['statusCode'])

        # Coord B cannot read (404)
        self.login_as(coord_b)
        res_b1 = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(404, res_b1['statusCode'])

        # Staff updates assignment from coord_a to coord_b
        self.login_as(user_context('staff', 'c1', 'staff_admin').user)
        patch_res = self.call(self.event(f'/api/agreements/{aid}', 'PATCH',
                                         {'responsibleUserIds': ['coord_b']},
                                         **{'if-match': '"1"'}))
        self.assertEqual(200, patch_res['statusCode'])

        # Now Coord A cannot read anymore (404)
        self.login_as(coord_a)
        res_a2 = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(404, res_a2['statusCode'])

        # Now Coord B has access (200)
        self.login_as(coord_b)
        res_b2 = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(200, res_b2['statusCode'])

    def test_agreement_same_day_and_null_dates(self):
        # Same-day interval (startDate == endDate) is allowed
        payload_sameday = {
            'title': 'One-Day Signing MoU',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'startDate': '2026-10-15',
            'endDate': '2026-10-15',
        }
        res_sameday = self.call(self.event('/api/agreements', 'POST', payload_sameday))
        self.assertEqual(201, res_sameday['statusCode'])
        data_sameday = json.loads(res_sameday['body'])['data']
        self.assertEqual('2026-10-15', data_sameday['startDate'])
        self.assertEqual('2026-10-15', data_sameday['endDate'])
        aid = data_sameday['id']

        # Draft with null dates is allowed
        payload_draft = {
            'title': 'Draft Agreement Without Dates',
            'agreementType': 'MoA',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'startDate': None,
            'endDate': None,
        }
        res_draft = self.call(self.event('/api/agreements', 'POST', payload_draft,
                                          **{'idempotency-key': 'idem-draft-null-dates'}))
        self.assertEqual(201, res_draft['statusCode'])
        data_draft = json.loads(res_draft['body'])['data']
        self.assertIsNone(data_draft['startDate'])
        self.assertIsNone(data_draft['endDate'])

        # Update with reversed dates (startDate > endDate) is rejected with 422
        bad_patch = self.call(self.event(f'/api/agreements/{aid}', 'PATCH',
                                         {'startDate': '2026-10-20'},
                                         **{'if-match': '"1"'}))
        self.assertEqual(422, bad_patch['statusCode'])

    # -------------------------------------------------------------
    # 9. Issue #100: Status Transitions, Renewal, and Concurrency
    # -------------------------------------------------------------
    def test_agreement_status_transitions_allowed_lifecycle(self):
        # Set Bangkok today to 2026-10-12
        self.repo.clock = lambda: datetime(2026, 10, 12, 12, 0, 0, tzinfo=timezone.utc).timestamp()

        # 1. Create Draft Agreement
        create_res = self.call(self.event('/api/agreements', 'POST', {
            'title': 'Lifecycle MoU',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'startDate': '2026-10-01',
            'endDate': '2027-10-01',
        }))
        self.assertEqual(201, create_res['statusCode'])
        aid = json.loads(create_res['body'])['data']['id']
        self.assertEqual('draft', json.loads(create_res['body'])['data']['status'])
        self.assertEqual(1, json.loads(create_res['body'])['data']['version'])

        # 2. draft -> active
        res_activate = self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                                           {'to': 'active'},
                                           **{'if-match': '"1"'}))
        self.assertEqual(200, res_activate['statusCode'])
        data_act = json.loads(res_activate['body'])['data']
        self.assertEqual('active', data_act['status'])
        self.assertEqual(2, data_act['version'])

        # Active agreement cannot expire while endDate >= today (2027-10-01 >= 2026-10-12)
        res_premature = self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                                             {'to': 'expired'},
                                             **{'if-match': '"2"'}))
        self.assertEqual(409, res_premature['statusCode'])

        # 3. Advance time to 2027-10-02 (after endDate 2027-10-01) -> active -> expired
        self.repo.clock = lambda: datetime(2027, 10, 2, 12, 0, 0, tzinfo=timezone.utc).timestamp()
        res_expire = self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                                          {'to': 'expired'},
                                          **{'if-match': '"2"'}))
        self.assertEqual(200, res_expire['statusCode'])
        data_exp = json.loads(res_expire['body'])['data']
        self.assertEqual('expired', data_exp['status'])
        self.assertEqual(3, data_exp['version'])

        # 4. expired -> active (Renewal)
        res_renew = self.call(self.event(f'/api/agreements/{aid}/status', 'POST', {
            'to': 'active',
            'endDate': '2028-10-01',
            'renewalNote': 'Renewed for another academic year',
        }, **{'if-match': '"3"'}))
        self.assertEqual(200, res_renew['statusCode'])
        data_ren = json.loads(res_renew['body'])['data']
        self.assertEqual('active', data_ren['status'])
        self.assertEqual('2028-10-01', data_ren['endDate'])
        self.assertEqual('Renewed for another academic year', data_ren['renewalNote'])
        self.assertEqual(aid, data_ren['id'])  # Preserves existing record ID
        self.assertEqual(4, data_ren['version'])

        # 5. active -> terminated
        res_term = self.call(self.event(f'/api/agreements/{aid}/status', 'POST', {
            'to': 'terminated',
            'reason': 'Mutual early termination due to partner restructuring',
        }, **{'if-match': '"4"'}))
        self.assertEqual(200, res_term['statusCode'])
        data_term = json.loads(res_term['body'])['data']
        self.assertEqual('terminated', data_term['status'])
        self.assertIn('Mutual early termination due to partner restructuring', data_term['internalNote'])
        self.assertEqual(5, data_term['version'])

        # 6. Terminated is a terminal state: cannot transition out
        res_out1 = self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                                        {'to': 'active'},
                                        **{'if-match': '"5"'}))
        self.assertEqual(409, res_out1['statusCode'])

        res_out2 = self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                                        {'to': 'draft'},
                                        **{'if-match': '"5"'}))
        self.assertEqual(409, res_out2['statusCode'])

    def test_agreement_status_transitions_denied_invalid_transitions(self):
        self.repo.clock = lambda: datetime(2026, 10, 12, 12, 0, 0, tzinfo=timezone.utc).timestamp()

        # Create Draft
        create_res = self.call(self.event('/api/agreements', 'POST', {
            'title': 'Transitions Matrix Test',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'startDate': '2026-10-01',
            'endDate': '2027-10-01',
        }))
        aid = json.loads(create_res['body'])['data']['id']

        # draft -> expired forbidden (409)
        res1 = self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                                    {'to': 'expired'},
                                    **{'if-match': '"1"'}))
        self.assertEqual(409, res1['statusCode'])

        # draft -> terminated forbidden (409)
        res2 = self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                                    {'to': 'terminated', 'reason': 'Premature termination'},
                                    **{'if-match': '"1"'}))
        self.assertEqual(409, res2['statusCode'])

        # Activate
        self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                             {'to': 'active'},
                             **{'if-match': '"1"'}))

        # active -> draft forbidden (409)
        res3 = self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                                    {'to': 'draft'},
                                    **{'if-match': '"2"'}))
        self.assertEqual(409, res3['statusCode'])

        # Expire
        self.repo.clock = lambda: datetime(2027, 10, 2, 12, 0, 0, tzinfo=timezone.utc).timestamp()
        self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                             {'to': 'expired'},
                             **{'if-match': '"2"'}))

        # expired -> terminated forbidden (409)
        res4 = self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                                    {'to': 'terminated', 'reason': 'Cannot terminate expired'},
                                    **{'if-match': '"3"'}))
        self.assertEqual(409, res4['statusCode'])

        # expired -> draft forbidden (409)
        res5 = self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                                    {'to': 'draft'},
                                    **{'if-match': '"3"'}))
        self.assertEqual(409, res5['statusCode'])

    def test_agreement_status_transition_guards_and_validation(self):
        self.repo.clock = lambda: datetime(2026, 10, 12, 12, 0, 0, tzinfo=timezone.utc).timestamp()

        # 1. draft -> active requires non-null dates and endDate >= today
        c1 = self.call(self.event('/api/agreements', 'POST', {
            'title': 'No Dates Agreement',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'startDate': None,
            'endDate': None,
        }))
        aid_nodate = json.loads(c1['body'])['data']['id']
        res_nodate = self.call(self.event(f'/api/agreements/{aid_nodate}/status', 'POST',
                                          {'to': 'active'},
                                          **{'if-match': '"1"'}))
        self.assertEqual(409, res_nodate['statusCode'])

        # draft -> active with endDate in the past rejected (409)
        c2 = self.call(self.event('/api/agreements', 'POST', {
            'title': 'Past Dates Agreement',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'startDate': '2026-01-01',
            'endDate': '2026-10-10',  # Past relative to 2026-10-12
        }))
        aid_past = json.loads(c2['body'])['data']['id']
        res_past = self.call(self.event(f'/api/agreements/{aid_past}/status', 'POST',
                                        {'to': 'active'},
                                        **{'if-match': '"1"'}))
        self.assertEqual(409, res_past['statusCode'])

        # 2. active -> terminated requires non-empty reason
        c3 = self.call(self.event('/api/agreements', 'POST', {
            'title': 'Termination Guard Agreement',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'startDate': '2026-10-01',
            'endDate': '2027-10-01',
        }))
        aid_term = json.loads(c3['body'])['data']['id']
        self.call(self.event(f'/api/agreements/{aid_term}/status', 'POST', {'to': 'active'}, **{'if-match': '"1"'}))

        # Missing reason -> 422
        res_noreason = self.call(self.event(f'/api/agreements/{aid_term}/status', 'POST',
                                            {'to': 'terminated'},
                                            **{'if-match': '"2"'}))
        self.assertEqual(422, res_noreason['statusCode'])

        # Blank/whitespace reason -> 422
        res_blankreason = self.call(self.event(f'/api/agreements/{aid_term}/status', 'POST',
                                              {'to': 'terminated', 'reason': '   '},
                                              **{'if-match': '"2"'}))
        self.assertEqual(422, res_blankreason['statusCode'])

        # 3. expired -> active (renewal) requires renewalNote and valid future endDate
        self.repo.clock = lambda: datetime(2027, 10, 2, 12, 0, 0, tzinfo=timezone.utc).timestamp()
        self.call(self.event(f'/api/agreements/{aid_term}/status', 'POST', {'to': 'expired'}, **{'if-match': '"2"'}))

        # Missing renewalNote -> 422
        res_nonote = self.call(self.event(f'/api/agreements/{aid_term}/status', 'POST', {
            'to': 'active',
            'endDate': '2028-10-01',
        }, **{'if-match': '"3"'}))
        self.assertEqual(422, res_nonote['statusCode'])

        # Missing endDate -> 422
        res_noend = self.call(self.event(f'/api/agreements/{aid_term}/status', 'POST', {
            'to': 'active',
            'renewalNote': 'Note without new endDate',
        }, **{'if-match': '"3"'}))
        self.assertEqual(422, res_noend['statusCode'])

        # Past endDate -> 422
        res_pastend = self.call(self.event(f'/api/agreements/{aid_term}/status', 'POST', {
            'to': 'active',
            'renewalNote': 'Renewing in the past',
            'endDate': '2027-09-01',  # Before current Bangkok today 2027-10-02
        }, **{'if-match': '"3"'}))
        self.assertEqual(422, res_pastend['statusCode'])

    def test_agreement_status_authorization_and_concurrency(self):
        self.repo.clock = lambda: datetime(2026, 10, 12, 12, 0, 0, tzinfo=timezone.utc).timestamp()

        # Staff creates agreement assigned to coord_user
        coord_user = user_context('coordinator', 'c1', 'coord_user').user
        exec_user = user_context('executive', 'c1', 'exec_user').user
        stu_user = user_context('student', 'c1', 'stu_user').user
        other_coord = user_context('coordinator', 'c1', 'other_coord').user
        scope_c2_staff = user_context('staff', 'c2', 'staff_c2').user

        for u in [coord_user, exec_user, stu_user, other_coord, scope_c2_staff]:
            self.mock_user_dict[u.user_id] = u

        c = self.call(self.event('/api/agreements', 'POST', {
            'title': 'Auth and Concurrency Test Agreement',
            'agreementType': 'MoU',
            'partnerIds': ['partner-001'],
            'scopeId': 'c1',
            'startDate': '2026-10-01',
            'endDate': '2027-10-01',
            'responsibleUserIds': ['coord_user'],
        }))
        aid = json.loads(c['body'])['data']['id']

        # 1. Executive denied (403)
        self.login_as(exec_user)
        res_exec = self.call(self.event(f'/api/agreements/{aid}/status', 'POST', {'to': 'active'}, **{'if-match': '"1"'}))
        self.assertEqual(403, res_exec['statusCode'])

        # 2. Student denied (403)
        self.login_as(stu_user)
        res_stu = self.call(self.event(f'/api/agreements/{aid}/status', 'POST', {'to': 'active'}, **{'if-match': '"1"'}))
        self.assertEqual(403, res_stu['statusCode'])

        # 3. Unassigned coordinator denied (404 isolated)
        self.login_as(other_coord)
        res_unassigned = self.call(self.event(f'/api/agreements/{aid}/status', 'POST', {'to': 'active'}, **{'if-match': '"1"'}))
        self.assertEqual(404, res_unassigned['statusCode'])

        # 4. Out-of-scope staff denied (404)
        self.login_as(scope_c2_staff)
        res_cross = self.call(self.event(f'/api/agreements/{aid}/status', 'POST', {'to': 'active'}, **{'if-match': '"1"'}))
        self.assertEqual(404, res_cross['statusCode'])

        # 5. Assigned coordinator allowed to change status
        self.login_as(coord_user)

        # Missing If-Match -> 428 Precondition Required
        res_missing_ifmatch = self.call(self.event(f'/api/agreements/{aid}/status', 'POST', {'to': 'active'}))
        self.assertEqual(428, res_missing_ifmatch['statusCode'])

        # Invalid If-Match format (unquoted) -> 422
        res_bad_ifmatch = self.call(self.event(f'/api/agreements/{aid}/status', 'POST', {'to': 'active'}, **{'if-match': '1'}))
        self.assertEqual(422, res_bad_ifmatch['statusCode'])

        # Stale If-Match -> 409 Conflict
        res_stale_ifmatch = self.call(self.event(f'/api/agreements/{aid}/status', 'POST', {'to': 'active'}, **{'if-match': '"99"'}))
        self.assertEqual(409, res_stale_ifmatch['statusCode'])

        # Unknown / forbidden fields in status payload -> 422
        res_unknown_fields = self.call(self.event(f'/api/agreements/{aid}/status', 'POST',
                                                  {'to': 'active', 'malicious': 'field'},
                                                  **{'if-match': '"1"'}))
        self.assertEqual(422, res_unknown_fields['statusCode'])

        # Valid assigned coordinator call succeeds
        res_coord_ok = self.call(self.event(f'/api/agreements/{aid}/status', 'POST', {'to': 'active'}, **{'if-match': '"1"'}))
        self.assertEqual(200, res_coord_ok['statusCode'])
        self.assertEqual('active', json.loads(res_coord_ok['body'])['data']['status'])


    def test_public_agreement_student_summary_and_unpublish_after_activation(self):
        created = self.call(self.event('/api/agreements', 'POST', {
            'title': 'Published MoU', 'agreementType': 'MoU',
            'partnerIds': ['partner-001'], 'scopeId': 'c1',
            'startDate': '2025-01-01', 'endDate': '2099-12-31',
            'publication': 'public', 'internalNote': 'SECRET', 'renewalNote': 'SECRET',
        }))
        self.assertEqual(201, created['statusCode'])
        aid = json.loads(created['body'])['data']['id']
        self.assertEqual(200, self.call(self.event('/api/agreements/'+aid+'/status', 'POST',
            {'to': 'active'}, **{'if-match': '"1"'}))['statusCode'])
        self.login_as(user_context('student', 'c1', 'student_any').user)
        response = self.call(self.event('/api/agreements/'+aid))
        self.assertEqual(200, response['statusCode'])
        self.assertNotIn('SECRET', response['body'])
        self.assertEqual({'id', 'entityType', 'title', 'agreementType', 'startDate', 'endDate', 'status'},
            set(json.loads(response['body'])['data']))
        self.assertEqual(403, self.call(self.event('/api/agreements/'+aid, 'PATCH',
            {'publication':'public'}, **{'if-match': '"2"'}))['statusCode'])
        self.login_as(user_context('staff', 'c1', 'u1').user)
        self.assertEqual(200, self.call(self.event('/api/agreements/'+aid, 'PATCH',
            {'publication':'internal'}, **{'if-match': '"2"'}))['statusCode'])
        self.login_as(user_context('student', 'c1', 'student_any').user)
        self.assertEqual(404, self.call(self.event('/api/agreements/'+aid))['statusCode'])

    def test_publication_rejects_invalid_values_and_old_reader_assignment(self):
        base = {'title': 'Publication', 'agreementType':'MoU', 'partnerIds':['partner-001'], 'scopeId':'c1'}
        for publication in (None, [], {}, 'Public', True):
            self.assertEqual(422, self.call(self.event('/api/agreements', 'POST',
                dict(base, publication=publication)))['statusCode'])
        self.assertEqual(422, self.call(self.event('/api/agreements', 'POST',
            dict(base, readerUserIds=['student_a'])))['statusCode'])
