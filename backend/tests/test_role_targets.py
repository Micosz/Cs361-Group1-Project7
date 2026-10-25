import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.application import AuthApplication
from backend.auth.dynamo_accounts import DynamoAccounts
from backend.permissions.transactions import values


class RoleTargetTests(unittest.TestCase):
    def app(self, capability_scope='cs-demo'):
        self.calls = []
        store = SimpleNamespace(role_targets=lambda scope, term: self.calls.append((scope, term)) or [
            {'id': 'u1', 'displayName': 'Ari', 'identityVerified': True}])
        user = SimpleNamespace(user_id='manager', active=True, permissions=lambda: ([], [
            {'name': 'manageRoles', 'scopeId': capability_scope, 'active': True}]))
        return AuthApplication(None, None, SimpleNamespace(store=store), None, None), SimpleNamespace(user=user)

    def event(self, scope='cs-demo', term='ar', method='GET'):
        query = {'scopeId': scope}
        if term is not None:
            query['q'] = term
        return {'version': '2.0', 'rawPath': '/api/role-targets',
            'queryStringParameters': query,
            'requestContext': {'http': {'method': method}}}

    def test_omitted_query_term_returns_all_targets_in_scope(self):
        app, context = self.app()
        with patch('backend.application.require_session', return_value=context):
            result = app.handle(self.event(term=None))
        self.assertEqual(200, result['statusCode'])
        self.assertEqual([('cs-demo', '')], self.calls)

    def test_scoped_manager_gets_only_minimal_names_and_session_is_rechecked(self):
        app, context = self.app()
        with patch('backend.application.require_session', return_value=context) as auth:
            result = app.handle(self.event())
        self.assertEqual(200, result['statusCode'])
        self.assertEqual({'data': [{'id': 'u1', 'displayName': 'Ari', 'identityVerified': True}]}, json.loads(result['body']))
        self.assertEqual([('cs-demo', 'ar')], self.calls)
        self.assertEqual(2, auth.call_count)

    def test_other_scope_and_invalid_queries_are_rejected_before_lookup(self):
        app, context = self.app()
        with patch('backend.application.require_session', return_value=context):
            self.assertEqual(403, app.handle(self.event(scope='other'))['statusCode'])
            for event in [self.event(term='a'), self.event(method='POST')]:
                self.assertIn(app.handle(event)['statusCode'], {405, 422})
        self.assertEqual([], self.calls)

    def test_storage_filters_to_active_accounts_in_scope_or_unassigned_employees(self):
        def row(key, name, **extra):
            result = dict(id=key, displayName=name, active=True, identityVerified=True, grants=[])
            result.update(extra)
            return result
        rows = [
            row('student', 'Ari Student', studentGrantScopeId='cs-demo'),
            row('employee', 'Ari Employee', tuType='employee'),
            row('other-scope', 'Ari Other', grants=[dict(scopeId='other', role='staff', active=True)]),
            row('disabled', 'Ari Disabled', active=False),
            row('wrong-name', 'Mina', studentGrantScopeId='cs-demo'),
        ]
        calls = []
        def scan(**kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                return {'Items': [values(r) for r in rows[:2]], 'LastEvaluatedKey': values({'id':'next'})}
            return {'Items': [values(r) for r in rows[2:]]}
        store = DynamoAccounts(SimpleNamespace(scan=scan), 'users', 'identities', 'sessions')
        self.assertEqual([
            {'id':'employee','displayName':'Ari Employee','identityVerified':True},
            {'id':'student','displayName':'Ari Student','identityVerified':True},
        ], store.role_targets('cs-demo', 'ari'))
        self.assertEqual(2, len(calls))
        self.assertNotIn('email', calls[0]['ProjectionExpression'])


if __name__ == '__main__':
    unittest.main()
