"""Integrated #74-#80 transport. New routes stay offline until #81 deployment."""
import re
from .auth.session_service import AuthError, token_hash
from .auth.require_session import require_session
from .http_api import handle, headers, session_cookie, response, error_response
from .permissions.gateway import body
from .permissions.policy import require_role_management


class AuthApplication:
    def __init__(self, sessions, provider, accounts, roles, limiter, repository=None):
        self.sessions, self.provider, self.accounts = sessions, provider, accounts
        self.roles, self.limiter, self.repository = roles, limiter, repository

    def handle(self, event):
        try:
            if event.get('version') != '2.0':
                raise AuthError('UNSUPPORTED_EVENT', 400)
            path = event.get('rawPath', '')
            if path == '/api/auth/login':
                return self.login(event)
            target = re.fullmatch(r'/api/users/([^/]+)/roles', path)
            if target:
                return self.role_request(event, target[1])
            return handle(event, self.sessions, self.repository)
        except AuthError as error:
            result = error_response(error.code, error.status, event)
            if error.status == 429:
                result['headers']['retry-after'] = '60'
            return result
        except Exception:
            return error_response('AUTH_UNAVAILABLE', 503, event)

    def login(self, event):
        if event.get('requestContext', {}).get('http', {}).get('method') != 'POST':
            raise AuthError('METHOD_NOT_ALLOWED', 405)
        if event.get('queryStringParameters'):
            raise AuthError('INVALID_QUERY', 422)
        request_headers, token = headers(event), session_cookie(event)
        origin, csrf = request_headers.get('origin'), request_headers.get('x-csrf-token')
        self.sessions.check_csrf(token, origin, csrf)
        self.sessions.validate(token, require_user=False)
        payload = body(event)
        if (set(payload) != {'username', 'password'}
                or not isinstance(payload['username'], str) or not payload['username'].strip()
                or not 1 <= len(payload['username']) <= 128
                or not isinstance(payload['password'], str) or not 1 <= len(payload['password']) <= 512):
            raise AuthError('INVALID_FIELDS', 422)
        ip = event.get('requestContext', {}).get('http', {}).get('sourceIp', 'unknown')
        self.limiter.check(payload['username'], ip)
        profile = self.provider.authenticate(payload['username'], payload['password'])
        user = self.accounts.link(profile)
        issued = self.sessions.issue_authenticated(user['id'], token, origin, csrf)
        return response(200, self.sessions.state(issued.token), issued.cookie)

    def role_request(self, event, target):
        context = require_session(event, self.sessions)
        method = event.get('requestContext', {}).get('http', {}).get('method')
        if method == 'GET':
            query = event.get('queryStringParameters') or {}
            if set(query) != {'scopeId'} or not query['scopeId']:
                raise AuthError('INVALID_QUERY', 422)
            scope = query['scopeId']
            require_role_management(context, scope, target)
            user = self.roles.store.user(target)
            if not user or not user.get('active'):
                raise AuthError('NOT_FOUND', 404)
            return response(200, {'data': {'id': user['id'], 'displayName': user['displayName'],
                'identityVerified': user['identityVerified'], 'authzVersion': user['authzVersion'],
                'grants': [g for g in user.get('grants', []) if g.get('scopeId') == scope]}})
        if method != 'PATCH':
            raise AuthError('METHOD_NOT_ALLOWED', 405)
        if event.get('queryStringParameters'):
            raise AuthError('INVALID_QUERY', 422)
        version = headers(event).get('if-match')
        if version is None:
            raise AuthError('PRECONDITION_REQUIRED', 428)
        if not re.fullmatch(r'"[1-9][0-9]*"', version):
            raise AuthError('INVALID_VERSION', 422)
        data = self.roles.update(context, target, body(event), int(version[1:-1]),
            token_hash(session_cookie(event)), int(self.sessions.clock()))
        self.sessions.validate(session_cookie(event))
        return response(200, {'data': data})
