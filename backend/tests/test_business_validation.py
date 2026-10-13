import unittest

from backend.auth.session_service import AuthError
from backend.business.validation import normalize_payload
from backend.permissions.policy import validate_fields
from backend.permissions.projections import public_projection
from backend.tests.fixtures.partners_activities import context, records


class BusinessValidationTests(unittest.TestCase):
    def invalid(self, kind, payload, *, action='create', record=None):
        with self.assertRaises(AuthError) as caught:
            normalize_payload(kind, action, payload, record=record)
        self.assertEqual(caught.exception.status, 422)

    def test_create_and_partial_update_preserve_inputs_and_required_fields(self):
        payload = dict(scopeId='cs-demo', name=' Demo ', type='research_institute',
                       summary=' Example ', location='Bangkok')
        authorized = validate_fields(context(), 'partner', 'create', payload)
        normalized = normalize_payload('partner', 'create', authorized)
        self.assertEqual(normalized['name'], 'Demo')
        self.assertEqual(normalized['publication'], 'internal')
        self.assertEqual(payload['name'], ' Demo ')
        partner = records()[0]
        patch = normalize_payload('partner', 'update', {'summary': ' New '}, record=partner)
        self.assertEqual(patch, {'summary': 'New'})
        self.assertEqual(partner['summary'], 'Synthetic public description')
        self.invalid('partner', {**payload, 'name': ' '})
        self.invalid('partner', {**payload, 'version': 1})
        self.invalid('partner', {**payload, 'summary': 'x' * 2001})
        self.invalid('partner', {**payload, 'publication': []})

    def test_dates_and_coupled_history_refs_validate_effective_patch(self):
        history = records()[4]
        self.assertEqual(normalize_payload('history', 'update', {'note': 'New'}, record=history), {'note': 'New'})
        for patch in ({'occurredOn': '2026-02-30'}, {'referenceType': None},
                      {'referenceId': None}, {'referenceType': ['activity']}):
            self.invalid('history', patch, action='update', record=history)
        self.assertEqual(normalize_payload('history', 'update',
            {'referenceType': None, 'referenceId': None}, record=history),
            {'referenceType': None, 'referenceId': None})
        self.invalid('history', {'occurredOn': '2026-10-11', 'kind': 'other', 'note': ''})

    def test_activity_links_limits_and_safe_optional_values(self):
        activity = records()[2]
        for patch in ({'coHostPartnerIds': ['p-public']}, {'agreementIds': ['g', 'g']},
                      {'coHostPartnerIds': 'p2'}, {'imagePath': '../private/doc.pdf'},
                      {'periodDate': '2026-10-11T00:00:00Z'}):
            self.invalid('activity', patch, action='update', record=activity)
        patch = dict(agreementIds=[], periodDate=None, imagePath='resources/demo.jpg')
        self.assertEqual(normalize_payload('activity', 'update', patch, record=activity), patch)
        partner = records()[0]
        for url in ('javascript:alert(1)', 'https://user:password@example.invalid', 'https://example.invalid:bad'):
            self.invalid('partner', {'websiteUrl': url}, action='update', record=partner)

    def test_value_validator_does_not_replace_policy_or_public_projection(self):
        activity = records()[2]
        forged = {'responsibleUserIds': ['u-other']}
        with self.assertRaises(AuthError) as caught:
            validate_fields(context('coordinator', user='u-coordinator'), 'activity', 'update', forged, activity)
        self.assertEqual(caught.exception.status, 403)
        snapshot = records()
        partners = {r['id']: r for r in snapshot if r['entityType'] == 'partner'}
        public = public_projection('activity', {**activity, 'publication': 'public'}, partners)
        self.assertEqual(public['co_hosts'], [])
        self.assertNotIn('agreementIds', public)
        self.assertNotIn('responsibleUserIds', public)
        self.assertIsNone(public_projection('contact', snapshot[3]))
        self.assertIsNone(public_projection('history', snapshot[4]))
