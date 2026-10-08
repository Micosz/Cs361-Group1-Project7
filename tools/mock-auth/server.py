#!/usr/bin/env python3
"""Local-only #81 demo. Standard library only; never contacts AWS or TU."""
import argparse
import copy
import json
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import secrets
import sys
import time
from urllib.parse import urlsplit, parse_qsl

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.application import AuthApplication
from backend.auth.accounts import AccountService
from backend.auth.roles import RoleService
from backend.auth.session_service import AuthError, SessionPolicy, SessionService, UserState, COOKIE_NAME

SCOPE = 'cs-demo'
CATALOG = [
    ('student-a', 'นักศึกษา A', 'student', ['student']),
    ('student-b', 'นักศึกษา B', 'student', ['student']),
    ('coordinator', 'ผู้ประสานงาน', 'employee', ['coordinator']),
    ('staff', 'เจ้าหน้าที่หลักสูตร', 'employee', ['staff']),
    ('executive', 'ผู้บริหาร (อ่านอย่างเดียว)', 'employee', ['executive']),
    ('employee', 'พนักงานที่ยังไม่มีบทบาท', 'employee', []),
    ('manager', 'ผู้มอบหมายบทบาท', 'employee', []),
    ('multi', 'หลายบทบาท: นักศึกษา + ผู้ประสานงาน', 'student', ['student', 'coordinator']),
]


class Sessions:
    def __init__(self): self.rows = {}
    def create(self, row): self.rows[row['tokenHash']] = copy.deepcopy(row)
    def get(self, key): return copy.deepcopy(self.rows.get(key))
    def delete(self, key): self.rows.pop(key, None)
    def touch(self, key, now, expires):
        row = self.rows.get(key)
        if (not row or 'revokedAt' in row or row['expiresAt'] <= now
                or row['absoluteExpiresAt'] <= now or row['lastSeenAt'] > now or row['expiresAt'] > expires):
            return False
        row.update(lastSeenAt=now, expiresAt=expires)
        return True
    def consume(self, key, now):
        row = self.rows.get(key)
        if not row or 'revokedAt' in row or min(row['expiresAt'], row['absoluteExpiresAt']) <= now:
            return False
        self.delete(key)
        return True


class Accounts:
    def __init__(self, sessions): self.rows, self.links, self.sessions = {}, {}, sessions
    def pair(self, subject):
        link = self.links.get(subject)
        return copy.deepcopy((link, self.rows.get(link['userId']))) if link else None
    def create_pair(self, user, link):
        if link['subjectKey'] in self.links: return False
        self.rows[user['id']], self.links[link['subjectKey']] = copy.deepcopy(user), copy.deepcopy(link)
        return True
    def user(self, key): return copy.deepcopy(self.rows.get(key))
    def get(self, key):
        row = self.rows.get(key)
        return UserState(row['id'], row['active'], row['authzVersion'], row['identityVerified'],
                         row['displayName'], tuple(row['grants']), tuple(row['capabilities'])) if row else None
    def save_roles(self, context, original, updated, session_hash, now):
        actor, target, session = self.rows.get(context.user.user_id), self.rows.get(original['id']), self.sessions.get(session_hash)
        if (not actor or not actor['active'] or not actor['identityVerified']
                or actor['authzVersion'] != context.user.authz_version
                or not target or not target['active'] or target['authzVersion'] != original['authzVersion']
                or not session or session.get('userId') != actor['id']
                or session.get('authzVersion') != actor['authzVersion'] or 'revokedAt' in session
                or min(session['expiresAt'], session['absoluteExpiresAt']) <= now):
            raise AuthError('VERSION_CONFLICT', 409)
        self.rows[original['id']] = copy.deepcopy(updated)
        self.links[original['subjectKey']]['verification'] = 'verified'


class Provider:
    def authenticate(self, username, password):
        entry = next((c for c in CATALOG if c[0] == username), None)
        if not entry or password != 'mock': raise AuthError('INVALID_CREDENTIALS')
        return {'username': username, 'type': entry[2], 'displayname_th': entry[1]}


class Limiter:
    def __init__(self): self.counts = {}
    def check(self, username, ip):
        window = int(time.time()) // 300
        self.counts = {k: v for k, v in self.counts.items() if k[0] == window}
        for category, value, maximum in [('user', username, 30), ('ip', ip, 200)]:
            key = (window, category, value)
            if self.counts.get(key, 0) >= maximum: raise AuthError('RATE_LIMITED', 429)
            self.counts[key] = self.counts.get(key, 0) + 1


class ReadOnlyRecords:
    def __init__(self, users):
        ids = {u['username']: u['id'] for u in users}
        self.rows = []
        for key, participant, scope in [('exchange-a', 'student-a', SCOPE),
                                       ('exchange-b', 'student-b', SCOPE),
                                       ('exchange-other', 'student-a', 'other-scope')]:
            self.rows.append(dict(id=key, entityType='exchange', scopeId=scope, version=1,
                title='ข้อมูลจำลอง ' + key, status='active', publication='internal',
                responsibleUserIds=[ids['coordinator'], ids['multi']], participantUserIds=[ids[participant]],
                supportingInfo='ข้อมูลภายในจำลองสำหรับผู้รับผิดชอบ/เจ้าหน้าที่',
                supportingInfoForParticipant='รายละเอียดจำลองสำหรับนักศึกษาผู้เข้าร่วม'))
    def get(self, kind, key):
        return copy.deepcopy(next((r for r in self.rows if r['entityType'] == kind and r['id'] == key), None))
    def list(self, kind, context, parent): return [copy.deepcopy(r) for r in self.rows if r['entityType'] == kind]
    def mutate(self, *args, **kwargs): raise AuthError('MOCK_READ_ONLY', 405)
    def parse_upload(self, event): raise AuthError('MOCK_READ_ONLY', 405)
    def content(self, *args): raise AuthError('NOT_FOUND', 404)


def make_app(port):
    sessions = Sessions()
    accounts = Accounts(sessions)
    linker = AccountService(accounts, secrets.token_bytes(32), SCOPE)
    users = []
    for username, name, kind, roles in CATALOG:
        row = linker.link(Provider().authenticate(username, 'mock'))
        stored = accounts.rows[row['id']]
        # Explicit local fixture setup, never a browser-selected production role.
        stored['identityVerified'] = username != 'employee'
        accounts.links[stored['subjectKey']]['verification'] = 'verified' if stored['identityVerified'] else 'provisional'
        stored['grants'] = [dict(role=r, scopeId=SCOPE, active=True) for r in roles]
        if username == 'manager': stored['capabilities'] = [dict(name='manageRoles', scopeId=SCOPE, active=True)]
        users.append(dict(username=username, id=row['id'], name=name))
    service = SessionService(sessions, accounts, SessionPolicy(f'https://127.0.0.1:{port}', secrets.token_bytes(32)))
    return AuthApplication(service, Provider(), linker, RoleService(accounts), Limiter(), ReadOnlyRecords(users)), users


def make_handler(app, users, port):
    origin = f'http://127.0.0.1:{port}'
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT / 'public'), **kwargs)
        def log_message(self, *args): pass  # No cookies, passwords, requests or profile logs.
        def send_data(self, status, content, content_type='application/json; charset=utf-8', headers=None, cookies=()):
            self.send_response(status)
            self.send_header('content-type', content_type)
            self.send_header('cache-control', 'no-store')
            self.send_header('x-content-type-options', 'nosniff')
            for k, v in (headers or {}).items():
                if k.lower() not in {'content-type', 'cache-control', 'x-content-type-options'}: self.send_header(k, v)
            for cookie in cookies:
                # Transport-only adaptation for loopback HTTP. Production cookie policy stays untouched.
                self.send_header('Set-Cookie', cookie.replace(COOKIE_NAME + '=', 'cstuhub_mock=').replace('; Secure', ''))
            self.end_headers()
            self.wfile.write(content.encode())
        def dispatch(self):
            if self.headers.get('Host') != f'127.0.0.1:{port}':
                self.send_data(403, '{"error":"LOCAL_HOST_REQUIRED"}'); return
            parsed = urlsplit(self.path)
            if parsed.path.startswith('/api/'):
                request_headers = {k.lower(): v for k,v in self.headers.items()}
                request_origin = request_headers.get('origin')
                if self.command != 'GET' and request_origin != origin:
                    self.send_data(403, '{"error":{"code":"ORIGIN_DENIED"}}'); return
                if request_origin == origin: request_headers['origin'] = app.sessions.policy.origin
                try: length = int(self.headers.get('Content-Length', '0'))
                except ValueError: length = -1
                if not 0 <= length <= 16384:
                    self.send_data(413, '{"error":"BODY_TOO_LARGE"}'); return
                try: raw = self.rfile.read(length).decode()
                except UnicodeError:
                    self.send_data(400, '{"error":"INVALID_BODY"}'); return
                cookie = self.headers.get('Cookie', '').replace('cstuhub_mock=', COOKIE_NAME + '=')
                event = dict(version='2.0', rawPath=parsed.path, headers=request_headers, cookies=[cookie],
                    requestContext={'http': {'method': self.command, 'sourceIp': '127.0.0.1'}},
                    queryStringParameters=dict(parse_qsl(parsed.query)), body=raw)
                result = app.handle(event)
                self.send_data(result['statusCode'], result['body'], headers=result['headers'], cookies=result.get('cookies', []))
            elif self.command != 'GET': self.send_data(405, '{"error":"METHOD_NOT_ALLOWED"}')
            elif parsed.path == '/assets/auth-config.js':
                self.send_data(200, 'window.CSTU_AUTH_CONFIG = Object.freeze({enabled:true});', 'text/javascript')
            elif parsed.path == '/__mock/users': self.send_data(200, json.dumps(users, ensure_ascii=False))
            elif parsed.path in {'/', '/mock.html', '/mock.js'}:
                filename = 'mock.html' if parsed.path in {'/', '/mock.html'} else 'mock.js'
                self.send_data(200, (ROOT / 'tools/mock-auth' / filename).read_text(),
                               'text/html; charset=utf-8' if filename.endswith('html') else 'text/javascript')
            else: super().do_GET()
        do_GET = dispatch
        do_POST = dispatch
        do_PATCH = dispatch
        def do_HEAD(self): self.send_data(405, '')
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535: parser.error('port must be 1024–65535')
    app, users = make_app(args.port)
    server = HTTPServer(('127.0.0.1', args.port), make_handler(app, users, args.port))
    print(f'Mock #81: http://127.0.0.1:{args.port}/mock.html\nLocal synthetic data only. Stop/reset: Ctrl+C then run again.', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()

if __name__ == '__main__': main()
