"""Seven integration groups for #74-#80; no real TU/AWS/browser credentials."""
import copy
import io
import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from types import SimpleNamespace

from backend.application import AuthApplication
from backend.auth.accounts import AccountService
from backend.auth.roles import RoleService
from backend.auth.session_service import AuthError, SessionPolicy, SessionService, UserState, COOKIE_NAME
from backend.auth.tu_provider import LambdaTuProvider
from backend.auth.dynamo_accounts import DynamoAccounts, DynamoLoginLimiter
from backend.tests.test_sessions import MemoryStore


class Accounts:
    def __init__(self):
        self.rows, self.links = {}, {}
        self.lock = threading.Lock()

    def pair(self, subject):
        with self.lock:
            link = self.links.get(subject)
            return copy.deepcopy((link, self.rows.get(link['userId']))) if link else None

    def create_pair(self, user, link):
        with self.lock:
            if link['subjectKey'] in self.links:
                return False
            self.rows[user['id']], self.links[link['subjectKey']] = copy.deepcopy(user), copy.deepcopy(link)
            return True

    def user(self, key):
        return copy.deepcopy(self.rows.get(key))

    def get(self, key):
        row = self.rows.get(key)
        if not row:
            return None
        return UserState(row['id'], row['active'], row['authzVersion'], row['identityVerified'],
                         row['displayName'], tuple(row['grants']), tuple(row['capabilities']))

    def save_roles(self, context, original, updated, session_hash, now):
        # CAS double models the write, including revocation before commit.
        if self.rows[context.user.user_id]['authzVersion'] != context.user.authz_version:
            raise AuthError('VERSION_CONFLICT', 409)
        if self.rows[original['id']]['authzVersion'] != original['authzVersion']:
            raise AuthError('VERSION_CONFLICT', 409)
        self.rows[original['id']] = copy.deepcopy(updated)
        self.links[original['subjectKey']]['verification'] = 'verified'


class ProviderClient:
    def __init__(self):
        self.kind, self.calls, self.status = 'student', 0, 200
        self.extra = {}

    def invoke(self, **kwargs):
        self.calls += 1
        event = json.loads(kwargs['Payload'])
        request = json.loads(event['body'])
        user = {'username': request['UserName'], 'type': self.kind, 'displayname_th': 'Demo'}
        body = {'success': True, 'user': user, **self.extra} if self.status == 200 else {
            'success': False, 'code': 'INVALID_CREDENTIALS'}
        return {'StatusCode': 200, 'Payload': io.BytesIO(json.dumps({
            'statusCode': self.status, 'body': json.dumps(body)}).encode())}


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.store, self.sessions_store, self.provider = Accounts(), MemoryStore(), ProviderClient()
        self.linker = AccountService(self.store, b'i' * 32, 'cs-demo')
        self.sessions = SessionService(self.sessions_store, self.store,
            SessionPolicy('https://example.com', b's' * 32), lambda: 1000)
        self.limit_calls = []
        self.app = AuthApplication(self.sessions, LambdaTuProvider(self.provider, 'tuAuthLogin'),
            self.linker, RoleService(self.store), SimpleNamespace(check=lambda *args: self.limit_calls.append(args)))

    def event(self, path, method='POST', issued=None, payload=None):
        return {'version': '2.0', 'rawPath': path,
            'requestContext': {'http': {'method': method, 'sourceIp': '127.0.0.1'}},
            'headers': {'origin': 'https://example.com', 'x-csrf-token': issued.csrf_token if issued else ''},
            'cookies': [f'{COOKIE_NAME}={issued.token}'] if issued else [],
            'body': json.dumps(payload or {})}

    def login(self, username='fixture'):
        prior = self.sessions.create_anonymous()
        result = self.app.handle(self.event('/api/auth/login', issued=prior,
            payload={'username': username, 'password': 'synthetic-password'}))
        return prior, result

    def test_student_login_account_session_logout_flow(self):
        prior, result = self.login()
        self.assertEqual(result['statusCode'], 200)
        state = json.loads(result['body'])
        self.assertEqual(state['grants'], [{'role': 'student', 'scopeId': 'cs-demo'}])
        self.assertNotIn('synthetic-password', result['body'])
        token = result['cookies'][0].split(';')[0].split('=', 1)[1]
        with self.assertRaises(AuthError):
            self.sessions.validate(prior.token)
        self.assertEqual(self.sessions.validate(token).user.user_id, state['user']['id'])
        issued = SimpleNamespace(token=token, csrf_token=state['csrfToken'])
        self.assertEqual(self.app.handle(self.event('/api/auth/logout', issued=issued))['statusCode'], 200)
        with self.assertRaises(AuthError):
            self.sessions.validate(token)

    def test_employee_no_role_invalid_profiles_and_browser_injection(self):
        self.provider.kind = 'employee'
        _, result = self.login()
        self.assertEqual(json.loads(result['body'])['grants'], [])
        self.assertEqual(json.loads(result['body'])['capabilities'], [])
        for kind in [None, 'admin']:
            self.provider.kind = kind
            _, result = self.login('bad-' + str(kind))
            self.assertEqual(result['statusCode'], 502)
        self.provider.extra = {'success': 'true'}
        _, result = self.login('bad-status')
        self.assertEqual(result['statusCode'], 502)
        prior = self.sessions.create_anonymous()
        result = self.app.handle(self.event('/api/auth/login', issued=prior,
            payload={'username': 'forged', 'password': 'x', 'role': 'executive'}))
        self.assertEqual(result['statusCode'], 422)
        self.assertEqual(len(self.store.rows), 1)

    def test_csrf_failure_and_rate_limit_precede_provider_side_effects(self):
        issued = self.sessions.create_anonymous()
        event = self.event('/api/auth/login', issued=issued, payload={'username': 'x', 'password': 'x'})
        event['headers']['origin'] = 'https://attacker.invalid'
        self.assertEqual(self.app.handle(event)['statusCode'], 403)
        self.assertEqual(self.provider.calls, 0)
        def deny(*_):
            raise AuthError('RATE_LIMITED', 429)
        self.app.limiter = SimpleNamespace(check=deny)
        event['headers']['origin'] = 'https://example.com'
        result = self.app.handle(event)
        self.assertEqual(result['statusCode'], 429)
        self.assertEqual(self.provider.calls, 0)

    def test_repeat_concurrent_login_never_restores_revoked_grant_or_disabled_user(self):
        profile = {'username': 'same', 'type': 'student'}
        with ThreadPoolExecutor(max_workers=8) as pool:
            users = list(pool.map(lambda _: self.linker.link(profile), range(12)))
        self.assertEqual(len({u['id'] for u in users}), 1)
        row = self.store.rows[users[0]['id']]
        row['grants'] = []
        self.assertEqual(self.linker.link(profile)['grants'], [])
        row['active'] = False
        with self.assertRaises(AuthError) as error:
            self.linker.link(profile)
        self.assertEqual(error.exception.code, 'ACCOUNT_DISABLED')

    def test_manager_scoped_role_assignment_revoke_and_session_version(self):
        target = self.linker.link({'username': 'target', 'type': 'employee'})
        manager = self.linker.link({'username': 'manager', 'type': 'student'})
        self.store.rows[manager['id']]['capabilities'] = [dict(name='manageRoles', scopeId='cs-demo', active=True)]
        prior = self.sessions.create_anonymous()
        issued = self.sessions.issue_authenticated(manager['id'], prior.token, 'https://example.com', prior.csrf_token)
        context = self.sessions.validate(issued.token)
        payload = dict(scopeId='cs-demo', roles=['staff'], confirmIdentity=True)
        self.app.roles.update(context, target['id'], payload, 1, 'fixture-hash', 1000)
        self.assertTrue(self.store.get(target['id']).identity_verified)
        prior = self.sessions.create_anonymous()
        target_session = self.sessions.issue_authenticated(target['id'], prior.token, 'https://example.com', prior.csrf_token)
        self.app.roles.update(context, target['id'], dict(payload, roles=[]), 2, 'fixture-hash', 1000)
        with self.assertRaises(AuthError):
            self.sessions.validate(target_session.token)
        self.assertEqual(self.linker.link({'username': 'target', 'type': 'employee'})['grants'], [])
        for target_id, scope in [(manager['id'], 'cs-demo'), (target['id'], 'other')]:
            with self.assertRaises(AuthError):
                self.app.roles.update(context, target_id, dict(payload, scopeId=scope), 3, 'x', 1000)
        # Staff alone never becomes a role manager.
        self.store.rows[manager['id']]['capabilities'] = []
        no_capability = replace(context, user=self.store.get(manager['id']))
        with self.assertRaises(AuthError):
            self.app.roles.update(no_capability, target['id'], payload, 3, 'x', 1000)

    def test_atomic_dynamo_role_write_includes_user_session_target_and_link_guards(self):
        captured = []
        client = SimpleNamespace(transact_write_items=lambda **kw: captured.append(kw))
        storage = DynamoAccounts(client, 'users', 'identities', 'sessions')
        manager = UserState('manager', True, 2, True, capabilities=(dict(name='manageRoles', scopeId='cs-demo', active=True),))
        original = dict(id='target', active=True, subjectKey='subject', authzVersion=1)
        storage.save_roles(SimpleNamespace(user=manager), original,
                           dict(original, authzVersion=2), 'hash', 1000)
        items = captured[0]['TransactItems']
        self.assertEqual([next(iter(i)) for i in items], ['ConditionCheck', 'ConditionCheck', 'Put', 'Update'])
        self.assertIn('absoluteExpiresAt', str(items[1]))
        self.assertIn('authzVersion', str(items[2]))
        self.assertIn('subjectKey', str(items[2]))
        self.assertIn('userId = :user', items[3]['Update']['ConditionExpression'])

    def test_shared_dynamo_limiter_uses_hashes_atomic_bounds_and_no_retry(self):
        calls = []
        def update(**kwargs):
            calls.append(kwargs)
        limiter = DynamoLoginLimiter(SimpleNamespace(update_item=update), b'i' * 32, lambda: 1000)
        limiter.check('fixture-account', '127.0.0.1')
        self.assertEqual([c['ExpressionAttributeValues'][':limit'] for c in calls], [5, 30])
        self.assertNotIn('fixture-account', str(calls))
        self.assertNotIn('127.0.0.1', str(calls))
        self.assertTrue(all('attempts < :limit' in c['ConditionExpression'] for c in calls))


if __name__ == '__main__':
    unittest.main()
