"""Comprehensive test suite for Partner & Contact domain (Issue #94).

Verifies:
  - Valid / invalid input validation for Partner and Contact
  - Missing required fields, unknown fields, malformed URLs/emails
  - Role-based and scope-based permissions
  - Assigned vs unassigned Coordinator access
  - Cross-parent access prevention
  - Optimistic concurrency control (If-Match versioning)
  - Idempotency-Key caching & replay / conflict contract
  - Sensitive field protection in Public projection
  - End-to-end read-back after mutations
"""

import json
import unittest

from backend.auth.session_service import SessionContext, UserState
from backend.http_api import handle
from backend.partners.repository import PartnerRepository
from backend.partners.validators import (
    validate_partner_payload,
    validate_contact_payload,
    validate_url,
    validate_email,
)
from backend.permissions.projections import public_projection
from backend.permissions.gateway import public_records
from backend.tests import test_sessions as session_helpers


def user_context(role='staff', scope='c1', user='u1', extra=()):
    grants = ({'role': role, 'scopeId': scope, 'active': True},) if role else ()
    return SessionContext(UserState(user, True, 1, True, grants=grants + extra), 2000)


class PartnerContactTests(unittest.TestCase):
    login = session_helpers.SessionTests.login

    def setUp(self):
        session_helpers.SessionTests.setUp(self)
        self.users.user = user_context('staff', 'c1', 'u1').user
        self.issued = self.login()
        self.repo = PartnerRepository(self.service)

    def event(self, path='/api/partners', method='GET', payload=None, **headers):
        hdrs = {
            'origin': self.policy.origin,
            'x-csrf-token': self.issued.csrf_token,
            'idempotency-key': 'test-idem-key-1234567890',
            **headers,
        }
        return {
            'version': '2.0',
            'rawPath': path,
            'requestContext': {
                'http': {'method': method},
                'requestId': 'req-test-1',
            },
            'headers': hdrs,
            'cookies': [self.issued.cookie],
            'body': json.dumps(payload if payload is not None else {}),
        }

    def call(self, event):
        return handle(event, self.service, self.repo)

    def test_contact_idempotency_is_scoped_to_parent_route(self):
        parent_ids = []
        for index in (1, 2):
            result = self.call(self.event('/api/partners', 'POST', {
                'name': f'Parent {index}', 'type': 'company', 'summary': 'Demo',
                'location': 'Bangkok', 'scopeId': 'c1',
            }, **{'idempotency-key': f'parent-create-key-{index}'}))
            parent_ids.append(json.loads(result['body'])['data']['id'])
        contacts = []
        for parent_id in parent_ids:
            result = self.call(self.event(f'/api/partners/{parent_id}/contacts', 'POST',
                {'name': 'Demo'}, **{'idempotency-key': 'same-contact-key-0001'}))
            self.assertEqual(201, result['statusCode'])
            contacts.append(json.loads(result['body'])['data'])
        self.assertNotEqual(contacts[0]['id'], contacts[1]['id'])
        self.assertEqual(parent_ids, [row['partnerId'] for row in contacts])

    def test_malformed_partner_values_return_validation_error_without_writes(self):
        payload = {'name': 'Demo', 'type': 'company', 'summary': 'Demo',
                   'location': 'Bangkok', 'scopeId': 'c1'}
        for patch in ({'responsibleUserIds': [{}]}, {'publication': []}):
            result = self.call(self.event('/api/partners', 'POST', {**payload, **patch}))
            self.assertEqual(422, result['statusCode'])
            self.assertEqual(0, self.repo.writes)
        validate_partner_payload({**payload, 'type': 'research_institute'})

    def test_prototype_rejects_unimplemented_feature_writes(self):
        result = self.call(self.event('/api/activities', 'POST', {
            'scopeId': 'c1', 'title': 'Demo', 'type': 'event', 'summary': 'Demo',
            'partnerId': 'p1',
        }))
        self.assertEqual(503, result['statusCode'])
        self.assertEqual(0, self.repo.writes)

    # -------------------------------------------------------------
    # 1. Partner Create, Read-back, and Field Validation
    # -------------------------------------------------------------
    def test_partner_create_and_read_back_success(self):
        payload = {
            'name': 'Thammasat University',
            'type': 'university',
            'summary': 'Leading university in Thailand.',
            'location': 'Pathum Thani',
            'websiteUrl': 'https://www.tu.ac.th',
            'publication': 'internal',
            'scopeId': 'c1',
        }
        res = self.call(self.event('/api/partners', 'POST', payload))
        self.assertEqual(201, res['statusCode'])
        data = json.loads(res['body'])['data']
        pid = data['id']
        self.assertEqual('Thammasat University', data['name'])
        self.assertEqual(1, data['version'])

        # Read-back
        read_res = self.call(self.event(f'/api/partners/{pid}', 'GET'))
        self.assertEqual(200, read_res['statusCode'])
        read_data = json.loads(read_res['body'])['data']
        self.assertEqual(pid, read_data['id'])
        self.assertEqual('Thammasat University', read_data['name'])

    def test_partner_create_missing_required_fields(self):
        required = ['name', 'type', 'summary', 'location', 'scopeId']
        valid = {
            'name': 'Partner Co',
            'type': 'company',
            'summary': 'Company summary',
            'location': 'Bangkok',
            'scopeId': 'c1',
        }
        for field in required:
            bad = dict(valid)
            del bad[field]
            res = self.call(self.event('/api/partners', 'POST', bad))
            self.assertEqual(422, res['statusCode'], f"Missing {field} should fail with 422")

    def test_partner_invalid_types_and_malformed_urls(self):
        base = {
            'name': 'Partner Co',
            'type': 'invalid_type',
            'summary': 'Company summary',
            'location': 'Bangkok',
            'scopeId': 'c1',
        }
        res = self.call(self.event('/api/partners', 'POST', base))
        self.assertEqual(422, res['statusCode'])

        # Malformed URLs
        for bad_url in ['javascript:alert(1)', 'ftp://example.com', 'data:text/html,x', 'bad-url']:
            bad = dict(base, type='company', websiteUrl=bad_url)
            res = self.call(self.event('/api/partners', 'POST', bad))
            self.assertEqual(422, res['statusCode'])

    def test_partner_unknown_and_injected_fields_rejected(self):
        base = {
            'name': 'Partner Co',
            'type': 'company',
            'summary': 'Summary',
            'location': 'Bangkok',
            'scopeId': 'c1',
            'unknownField': 'hacker',
        }
        res = self.call(self.event('/api/partners', 'POST', base))
        self.assertEqual(422, res['statusCode'])

        # Server-owned field injection
        injected = dict(base)
        del injected['unknownField']
        injected['version'] = 999
        res = self.call(self.event('/api/partners', 'POST', injected))
        self.assertEqual(403, res['statusCode'])

    # -------------------------------------------------------------
    # 2. Contact Nested Operations & Field Validation
    # -------------------------------------------------------------
    def test_contact_create_read_back_and_validation(self):
        # Setup partner first
        partner_payload = {
            'name': 'Partner Alpha',
            'type': 'company',
            'summary': 'Alpha',
            'location': 'Bangkok',
            'scopeId': 'c1',
        }
        p_res = self.call(self.event('/api/partners', 'POST', partner_payload))
        pid = json.loads(p_res['body'])['data']['id']

        # Create contact
        contact_payload = {
            'name': 'Somchai Jaidee',
            'position': 'Coordinator',
            'email': 'somchai@alpha.com',
            'phone': '+66-2-555-0100',
        }
        c_res = self.call(self.event(f'/api/partners/{pid}/contacts', 'POST', contact_payload))
        self.assertEqual(201, c_res['statusCode'])
        cdata = json.loads(c_res['body'])['data']
        cid = cdata['id']
        self.assertEqual('Somchai Jaidee', cdata['name'])
        self.assertEqual(pid, cdata['partnerId'])

        # Read-back single contact
        c_read = self.call(self.event(f'/api/partners/{pid}/contacts/{cid}', 'GET'))
        self.assertEqual(200, c_read['statusCode'])
        self.assertEqual('somchai@alpha.com', json.loads(c_read['body'])['data']['email'])

        # Read-back list of contacts
        list_res = self.call(self.event(f'/api/partners/{pid}/contacts', 'GET'))
        self.assertEqual(200, list_res['statusCode'])
        self.assertEqual(1, json.loads(list_res['body'])['count'])

    def test_contact_validation_missing_name_and_invalid_email(self):
        partner_payload = {
            'name': 'Partner Beta',
            'type': 'company',
            'summary': 'Beta',
            'location': 'Bangkok',
            'scopeId': 'c1',
        }
        p_res = self.call(self.event('/api/partners', 'POST', partner_payload))
        pid = json.loads(p_res['body'])['data']['id']

        # Missing name
        res = self.call(self.event(f'/api/partners/{pid}/contacts', 'POST', {'position': 'Dev'}))
        self.assertEqual(422, res['statusCode'])

        # Invalid email
        res = self.call(self.event(f'/api/partners/{pid}/contacts', 'POST', {'name': 'John', 'email': 'not-an-email'}))
        self.assertEqual(422, res['statusCode'])

    # -------------------------------------------------------------
    # 3. Role-based, Scope-based & Assigned Coordinator
    # -------------------------------------------------------------
    def test_scope_and_role_access_rules(self):
        # Staff in c1 creates partner
        res = self.call(self.event('/api/partners', 'POST', {
            'name': 'Scope Test', 'type': 'company', 'summary': 'Summary',
            'location': 'Bangkok', 'scopeId': 'c1',
        }))
        pid = json.loads(res['body'])['data']['id']

        # Staff in c2 cannot read c1 partner
        self.users.user = user_context('staff', 'c2', 'u1').user
        res = self.call(self.event(f'/api/partners/{pid}', 'GET'))
        self.assertEqual(404, res['statusCode'])

        # Student cannot create partner
        self.users.user = user_context('student', 'c1', 'u1').user
        res = self.call(self.event('/api/partners', 'POST', {
            'name': 'Student Partner', 'type': 'company', 'summary': 'Summary',
            'location': 'Bangkok', 'scopeId': 'c1',
        }))
        self.assertEqual(403, res['statusCode'])

        # Executive cannot create contact
        self.users.user = user_context('executive', 'c1', 'u1').user
        res = self.call(self.event(f'/api/partners/{pid}/contacts', 'POST', {'name': 'Exec Contact'}))
        self.assertEqual(403, res['statusCode'])

    def test_assigned_vs_unassigned_coordinator(self):
        # Staff creates internal partner with assigned coordinator u1
        p_res = self.call(self.event('/api/partners', 'POST', {
            'name': 'Coord Partner', 'type': 'company', 'summary': 'Summary',
            'location': 'Bangkok', 'scopeId': 'c1', 'responsibleUserIds': ['u1'],
        }))
        pid = json.loads(p_res['body'])['data']['id']

        # Assigned coordinator can update display fields
        self.users.user = user_context('coordinator', 'c1', 'u1').user
        upd_res = self.call(self.event(f'/api/partners/{pid}', 'PATCH', {'summary': 'Updated by Coord'}, **{'if-match': '"1"'}))
        self.assertEqual(200, upd_res['statusCode'])

        # Assigned coordinator CANNOT change publication or responsibleUserIds
        bad_pub = self.call(self.event(f'/api/partners/{pid}', 'PATCH', {'publication': 'public'}, **{'if-match': '"2"'}))
        self.assertEqual(403, bad_pub['statusCode'])

        # Unassigned coordinator cannot update
        self.repo.rows[('partner', pid)]['responsibleUserIds'] = ['other_coord']
        unassigned_res = self.call(self.event(f'/api/partners/{pid}', 'PATCH', {'summary': 'Hacked'}, **{'if-match': '"2"'}))
        self.assertEqual(404, unassigned_res['statusCode'])

    # -------------------------------------------------------------
    # 4. Cross-parent Contact Access Attempts
    # -------------------------------------------------------------
    def test_cross_parent_contact_access_blocked(self):
        # Create partner 1 and contact 1
        p1 = self.call(self.event('/api/partners', 'POST', {
            'name': 'P1', 'type': 'company', 'summary': 'S1', 'location': 'L1', 'scopeId': 'c1',
        }, **{'idempotency-key': 'key-p1-1234567890'}))
        pid1 = json.loads(p1['body'])['data']['id']
        c1 = self.call(self.event(f'/api/partners/{pid1}/contacts', 'POST', {'name': 'C1'}, **{'idempotency-key': 'key-c1-1234567890'}))
        cid1 = json.loads(c1['body'])['data']['id']

        # Create partner 2
        p2 = self.call(self.event('/api/partners', 'POST', {
            'name': 'P2', 'type': 'company', 'summary': 'S2', 'location': 'L2', 'scopeId': 'c1',
        }, **{'idempotency-key': 'key-p2-1234567890'}))
        pid2 = json.loads(p2['body'])['data']['id']

        # Try to access contact 1 via partner 2 URL
        tamper_read = self.call(self.event(f'/api/partners/{pid2}/contacts/{cid1}', 'GET'))
        self.assertEqual(404, tamper_read['statusCode'])

        # Try to patch contact 1 via partner 2 URL
        tamper_patch = self.call(self.event(f'/api/partners/{pid2}/contacts/{cid1}', 'PATCH', {'name': 'New C1'}, **{'if-match': '"1"'}))
        self.assertEqual(404, tamper_patch['statusCode'])

    # -------------------------------------------------------------
    # 5. Concurrency & If-Match Version Checks
    # -------------------------------------------------------------
    def test_optimistic_concurrency_and_stale_if_match(self):
        p = self.call(self.event('/api/partners', 'POST', {
            'name': 'Version Test', 'type': 'company', 'summary': 'V1', 'location': 'Bangkok', 'scopeId': 'c1',
        }))
        pid = json.loads(p['body'])['data']['id']

        # First update succeeds with version 1
        u1 = self.call(self.event(f'/api/partners/{pid}', 'PATCH', {'summary': 'V2'}, **{'if-match': '"1"'}))
        self.assertEqual(200, u1['statusCode'])
        self.assertEqual(2, json.loads(u1['body'])['data']['version'])

        # Second update with stale version 1 fails with 409
        u2 = self.call(self.event(f'/api/partners/{pid}', 'PATCH', {'summary': 'V3'}, **{'if-match': '"1"'}))
        self.assertEqual(409, u2['statusCode'])

        # Missing If-Match fails with 428
        e_missing = self.event(f'/api/partners/{pid}', 'PATCH', {'summary': 'No Header'})
        self.assertEqual(428, self.call(e_missing)['statusCode'])

    # -------------------------------------------------------------
    # 6. Idempotency Contract
    # -------------------------------------------------------------
    def test_idempotency_key_replay_and_conflict(self):
        payload = {
            'name': 'Idem Partner', 'type': 'company', 'summary': 'Idem',
            'location': 'Bangkok', 'scopeId': 'c1',
        }
        # First create
        first = self.call(self.event('/api/partners', 'POST', payload, **{'idempotency-key': 'fixed-key-1234567890'}))
        self.assertEqual(201, first['statusCode'])
        pid = json.loads(first['body'])['data']['id']
        writes_after_first = self.repo.writes

        # Replay with same payload and key -> returns identical response without re-writing
        second = self.call(self.event('/api/partners', 'POST', payload, **{'idempotency-key': 'fixed-key-1234567890'}))
        self.assertEqual(201, second['statusCode'])
        self.assertEqual(pid, json.loads(second['body'])['data']['id'])
        self.assertEqual(writes_after_first, self.repo.writes)

        # Different payload with same key -> 409 conflict
        different_payload = dict(payload, name='Different Partner')
        conflict = self.call(self.event('/api/partners', 'POST', different_payload, **{'idempotency-key': 'fixed-key-1234567890'}))
        self.assertEqual(409, conflict['statusCode'])

    # -------------------------------------------------------------
    # 7. Privacy & Sensitive Field Protection in Public Projection
    # -------------------------------------------------------------
    def test_public_projection_sensitive_data_leakage_prevented(self):
        # Create public partner
        p = self.call(self.event('/api/partners', 'POST', {
            'name': 'Public Partner Co', 'type': 'company', 'summary': 'Public summary',
            'location': 'Bangkok', 'websiteUrl': 'https://public.org',
            'publication': 'public', 'scopeId': 'c1', 'responsibleUserIds': ['u1'],
        }))
        pid = json.loads(p['body'])['data']['id']

        # Add contact
        c = self.call(self.event(f'/api/partners/{pid}/contacts', 'POST', {
            'name': 'Secret Contact', 'email': 'secret@private.com', 'phone': '081-999-9999',
        }))
        self.assertEqual(201, c['statusCode'])

        # Verify public projection of partner
        raw_partner = self.repo.get('partner', pid)
        projected = public_projection('partner', raw_partner)
        self.assertIsNotNone(projected)

        # Allowlisted fields present
        self.assertEqual('Public Partner Co', projected['name'])
        self.assertEqual('https://public.org', projected['website_url'])

        # Sensitive fields completely absent
        serialized = json.dumps(projected)
        self.assertNotIn('responsibleUserIds', serialized)
        self.assertNotIn('u1', serialized)
        self.assertNotIn('Secret Contact', serialized)
        self.assertNotIn('secret@private.com', serialized)
        self.assertNotIn('081-999-9999', serialized)
        self.assertNotIn('scopeId', serialized)

        # Public records test
        all_partners = [raw_partner]
        pub_result = public_records('partner', all_partners)
        self.assertEqual(1, pub_result['count'])
        pub_str = json.dumps(pub_result)
        self.assertNotIn('secret@private.com', pub_str)
        self.assertNotIn('responsibleUserIds', pub_str)


if __name__ == '__main__':
    unittest.main()

