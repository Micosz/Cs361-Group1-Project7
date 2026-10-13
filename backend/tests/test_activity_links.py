"""Small offline #97 suite; storage and #79 policy are explicit test doubles."""
import copy
import json
from pathlib import Path
import unittest

from backend.relationships.activity_links import (
    LinkError, internal_links, legacy_relationships, plan_patch, public_links,
)


def row(kind, key, **extra):
    return dict(id=key, entityType=kind, scopeId='cs-demo', version=1,
                publication='internal', **extra)


class ActivityLinksTests(unittest.TestCase):
    def setUp(self):
        self.activity = row('activity', 'a1', partnerId='p1', coHostPartnerIds=['p2'],
                            agreementIds=['g1'], title='Demo activity')
        self.rows = {
            ('partner', 'p1'): row('partner', 'p1', name='Primary'),
            ('partner', 'p2'): row('partner', 'p2', name='Co-host'),
            ('agreement', 'g1'): row('agreement', 'g1', title='Internal agreement', internalNote='private'),
        }
        self.calls = []
        self.denied = set()

    def get(self, kind, key):
        self.calls.append((kind, key))
        return self.rows.get((kind, key))

    def allowed(self, kind, action, record):
        return (kind, record['id'], action) not in self.denied

    def plan(self, patch):
        return plan_patch(self.activity, patch, get_record=self.get, allowed=self.allowed)

    def test_link_read_and_unlink_are_non_destructive(self):
        before = copy.deepcopy((self.activity, self.rows))
        linked = self.plan({'partnerId': 'p2', 'coHostPartnerIds': ['p1'], 'agreementIds': []})
        self.assertEqual(linked.activity_version, 1)
        self.assertEqual({r.id for r in linked.references}, {'p1', 'p2'})
        saved_example = dict(self.activity, **linked.changes)
        detail = internal_links(saved_example, get_record=self.get, allowed=self.allowed)
        self.assertEqual(detail, {'partner': {'id': 'p2', 'name': 'Co-host'},
                                  'coHosts': [{'id': 'p1', 'name': 'Primary'}], 'agreements': []})
        self.assertEqual(self.plan({'coHostPartnerIds': []}).changes, {'coHostPartnerIds': []})
        self.assertEqual((self.activity, self.rows), before)  # No implicit update/delete.
        self.assertIn(('agreement', 'g1'), self.rows)

    def test_invalid_duplicate_missing_wrong_kind_scope_and_denied_references(self):
        for patch in ({'partnerId': None}, {'coHostPartnerIds': ['p2', 'p2']},
                      {'coHostPartnerIds': ['p1']}, {'agreementIds': 'g1'},
                      {'agreementIds': ['missing']}, {'agreementIds': ['p2']},
                      {'scopeId': 'forged'}, {'coHostPartnerIds': [' ']},
                      {'coHostPartnerIds': [f'p{i}' for i in range(2, 22)]}):
            with self.subTest(patch=patch), self.assertRaises(LinkError):
                self.plan(patch)
        for change in ({'scopeId': 'other'}, {'entityType': 'partner'}, {'version': 0}):
            original = self.rows[('agreement', 'g1')]
            self.rows[('agreement', 'g1')] = dict(original, **change)
            with self.assertRaises(LinkError) as raised:
                self.plan({'agreementIds': ['g1']})
            self.assertEqual(raised.exception.code, 'INVALID_REFERENCE')
            self.rows[('agreement', 'g1')] = original
        self.denied.add(('agreement', 'g1', 'read'))
        with self.assertRaises(LinkError) as raised:
            self.plan({'agreementIds': ['g1']})
        self.assertEqual(raised.exception.code, 'INVALID_REFERENCE')

    def test_policy_denies_target_public_edits_and_hides_unreadable_labels(self):
        self.denied.add(('activity', 'a1', 'update'))
        with self.assertRaises(LinkError) as raised:
            self.plan({'agreementIds': []})
        self.assertEqual(raised.exception.status, 404)
        self.denied.clear()
        self.activity['publication'] = 'public'
        self.denied.add(('activity', 'a1', 'change_public_links'))
        with self.assertRaises(LinkError) as raised:
            self.plan({'coHostPartnerIds': []})
        self.assertEqual(raised.exception.status, 403)
        self.denied.add(('agreement', 'g1', 'read'))
        detail = internal_links(self.activity, get_record=self.get, allowed=self.allowed)
        self.assertEqual(detail['agreements'], [])
        self.assertNotIn('g1', json.dumps(detail))
        self.denied.add(('activity', 'a1', 'read'))
        with self.assertRaises(LinkError):
            internal_links(self.activity, get_record=self.get, allowed=self.allowed)

    def test_public_never_fetches_agreements_and_dependency_errors_propagate(self):
        self.activity['publication'] = 'public'
        self.rows[('partner', 'p1')]['publication'] = 'public'
        self.assertEqual(public_links(self.activity, get_record=self.get),
                         {'partner': {'id': 'p1', 'name': 'Primary'}, 'coHosts': []})
        self.assertTrue(all(kind == 'partner' for kind, _ in self.calls))
        self.rows[('partner', 'p2')]['publication'] = 'public'
        self.assertEqual(len(public_links(self.activity, get_record=self.get)['coHosts']), 1)
        self.rows[('partner', 'p1')]['access_level'] = 'internal'
        self.assertIsNone(public_links(self.activity, get_record=self.get))
        def unavailable(*_):
            raise RuntimeError('synthetic storage outage')
        with self.assertRaises(RuntimeError):
            internal_links(self.activity, get_record=unavailable, allowed=self.allowed)
        with self.assertRaises(RuntimeError):
            public_links(self.activity, get_record=unavailable)

    def test_actual_v2_snapshot_preserves_primary_ids_and_unresolved_names(self):
        path = Path(__file__).resolve().parents[2] / 'public/data/partner-data-backup.json'
        source = json.loads(path.read_text())
        partners = {r['id']: r for r in source if 'name' in r}
        activities = [r for r in source if 'partnerId' in r]
        self.assertTrue(activities)
        before = copy.deepcopy(source)
        for activity in activities:
            mapped = legacy_relationships(activity)
            self.assertEqual(mapped['partnerId'], activity['partnerId'])
            self.assertEqual(mapped['legacyCoHostNames'], activity.get('co_hosts', []))
            self.assertEqual(mapped['coHostPartnerIds'], [])
            self.assertEqual(mapped['agreementIds'], [])
            display = public_links(activity, get_record=lambda kind, key: partners.get(key))
            self.assertEqual(display['partner']['id'], activity['partnerId'])
            self.assertNotIn('agreements', display)
        self.assertEqual(source, before)


if __name__ == '__main__':
    unittest.main()
