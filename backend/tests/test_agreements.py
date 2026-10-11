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

    def setUp(self):
        session_helpers.SessionTests.setUp(self)
        self.users.user = user_context('staff', 'c1', 'u1').user
        self.issued = self.login()
        self.repo = AgreementRepository(self.service)

    def event(self, path='/api/agreements', method='GET', payload=None, query=None, **headers):
        if '?' in path:
            path_part, query_part = path.split('?', 1)
            from urllib.parse import parse_qs
            parsed_query = {k: v[0] for k, v in parse_qs(query_part).items()}
            query = {**(query or {}), **parsed_query}
            path = path_part
        hdrs = {
            'origin': self.policy.origin,
            'x-csrf-token': self.issued.csrf_token,
            'idempotency-key': 'test-idem-key-agreement-001',
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
        self.users.user = user_context('coordinator', 'c1', 'u1').user

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
        self.users.user = user_context('executive', 'c1', 'u1').user
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

        # Student has no access to agreements (403 on create/read/update)
        self.users.user = user_context('student', 'c1', 'u1').user
        stu_read = self.call(self.event(f'/api/agreements/{aid}', 'GET'))
        self.assertEqual(403, stu_read['statusCode'])
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
        self.users.user = user_context('staff', 'c2', 'u1').user
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
            'publication': 'public',  # Even if injected maliciously
        }
        proj = public_projection('agreement', agreement_rec)
        self.assertIsNone(proj, "Agreements must never be exposed via public projections")

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

