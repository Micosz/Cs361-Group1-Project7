"""Three local HTTP smoke checks; no AWS/TU or real credentials."""
import http.cookiejar
import importlib.util
import json
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer

spec = importlib.util.spec_from_file_location('mock_auth_server', Path(__file__).with_name('server.py'))
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


class MockServerTests(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(('127.0.0.1', 0), server_module.make_handler(None, [], 0))
        port = self.server.server_port
        app, self.users = server_module.make_app(port)
        self.server.RequestHandlerClass = server_module.make_handler(app, self.users, port)
        self.origin = f'http://127.0.0.1:{port}'
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.browser = self.client()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def client(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, method='GET', data=None, client=None, headers=None):
        hs = {'Origin': self.origin, 'Content-Type': 'application/json', **(headers or {})}
        request = urllib.request.Request(self.origin + path, method=method, headers=hs,
            data=json.dumps(data).encode() if data is not None else None)
        try: response = (client or self.browser).open(request)
        except urllib.error.HTTPError as error: response = error
        with response:
            content = response.read().decode()
            return response.status, json.loads(content) if content else None, response.headers

    def login(self, name, client=None):
        _, state, _ = self.request('/api/auth/session', client=client)
        status, state, _ = self.request('/api/auth/login', 'POST', {'username': name, 'password': 'mock'}, client,
                                      {'X-CSRF-Token': state['csrfToken']})
        self.assertEqual(status, 200)
        return state

    def test_local_origin_cookie_and_logout(self):
        _, state, headers = self.request('/api/auth/session')
        self.assertIn('cstuhub_mock=', headers['Set-Cookie'])
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        self.assertEqual(self.request('/api/auth/login', 'POST', {'username':'staff','password':'mock'},
            headers={'Origin':'https://other.invalid','X-CSRF-Token':state['csrfToken']})[0], 403)
        state = self.login('staff')
        self.assertEqual(self.request('/api/auth/logout', 'POST', {}, headers={'X-CSRF-Token':state['csrfToken']})[0], 200)
        self.assertEqual(self.request('/api/exchanges')[0], 401)

    def test_roles_and_record_filtering(self):
        for name, ids in [('student-a', ['exchange-a']), ('student-b', ['exchange-b']),
                          ('staff', ['exchange-a','exchange-b']), ('executive', ['exchange-a','exchange-b']),
                          ('coordinator', ['exchange-a','exchange-b']), ('multi', ['exchange-a','exchange-b'])]:
            self.login(name)
            status, body, _ = self.request('/api/exchanges')
            self.assertEqual(status, 200)
            self.assertEqual(sorted(r['id'] for r in body['data']), ids)
            if name in {'student-a','student-b','executive'}: self.assertTrue(all('supportingInfo' not in row for row in body['data']))
            if name == 'staff': self.assertTrue(all('supportingInfo' in row for row in body['data']))
            self.assertEqual(self.request('/api/exchanges/exchange-other')[0], 404)
        for name in ['employee','manager']:
            self.login(name)
            self.assertEqual(self.request('/api/exchanges')[0], 403)

    def test_manager_assignment_readback_and_session_revocation(self):
        target = next(u for u in self.users if u['username']=='employee')['id']
        manager = self.login('manager')
        path = '/api/users/' + target + '/roles'
        self.assertEqual(self.request(path+'?scopeId=cs-demo')[0], 200)
        payload = {'scopeId':'cs-demo','roles':['staff'],'confirmIdentity':True}
        self.assertEqual(self.request(path, 'PATCH', payload, headers={
            'X-CSRF-Token':manager['csrfToken'],'If-Match':'"1"'})[0], 200)
        target_browser = self.client(); self.login('employee', target_browser)
        self.assertEqual(self.request('/api/exchanges', client=target_browser)[0], 200)
        _, saved, _ = self.request(path+'?scopeId=cs-demo')
        self.assertEqual(saved['data']['grants'][0]['role'], 'staff')
        self.assertEqual(self.request(path, 'PATCH', dict(payload,roles=[]), headers={
            'X-CSRF-Token':manager['csrfToken'],'If-Match':'"2"'})[0], 200)
        self.assertEqual(self.request('/api/exchanges', client=target_browser)[0], 401)
        self.login('employee', target_browser)
        self.assertEqual(self.request('/api/exchanges', client=target_browser)[0], 403)

if __name__ == '__main__': unittest.main()
