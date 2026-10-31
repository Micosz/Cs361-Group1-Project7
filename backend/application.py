"""Integrated #74-#80 transport. New routes stay offline until #81 deployment."""
import re
from .auth.session_service import AuthError, token_hash
from .auth.require_session import require_session
from .http_api import handle, headers, session_cookie, response, error_response
from .permissions.gateway import body
from .permissions.policy import require_role_management, require_role_management_scope


class AuthApplication:
    def __init__(self, sessions, provider, accounts, roles, limiter, repository=None):
        self.sessions, self.provider, self.accounts = sessions, provider, accounts
        self.roles, self.limiter, self.repository = roles, limiter, repository

    def handle(self, event):
        try:
            if event.get('version') != '2.0':
                raise AuthError('UNSUPPORTED_EVENT', 400)
            path = event.get('rawPath', '')
            from .documents.direct_gateway import handles, DirectUploadGateway
            if handles(path):
                return DirectUploadGateway(self.sessions, self.repository).handle(event)
            if path == '/api/public/agreements' or path.startswith('/api/public/agreements/'):
                return self.public_agreements(event)
            if path == '/api/public/records':
                return self.public_catalog(event)
            public_feedback = re.fullmatch(r'/api/public/(partners|activities)/([^/]+)/feedback', path)
            if public_feedback:
                return self.public_feedback(event, public_feedback[1], public_feedback[2])
            if path == '/api/selection-partners':
                return self.selection_partners(event)
            if path == '/api/selection-users':
                return self.selection_users(event)
            if path == '/api/role-targets':
                return self.role_targets(event)
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

    def public_agreements(self, event):
        if event.get('requestContext', {}).get('http', {}).get('method') != 'GET':
            raise AuthError('METHOD_NOT_ALLOWED', 405)
        if self.repository is None or not hasattr(self.repository, 'public_agreements'):
            raise AuthError('PERMISSION_UNAVAILABLE', 503)
        rows = self.repository.public_agreements()
        path = event['rawPath']
        if path != '/api/public/agreements':
            key = path[len('/api/public/agreements/'):]
            if not key or '/' in key or event.get('queryStringParameters'):
                raise AuthError('NOT_FOUND', 404)
            record = next((row for row in rows if row['id'] == key), None)
            if record is None:
                raise AuthError('NOT_FOUND', 404)
            return response(200, {'data': record})
        from .permissions.listing import page
        if 'scopeId' in (event.get('queryStringParameters') or {}):
            raise AuthError('INVALID_QUERY', 422)
        data, count, pagination = page(rows, event, self.sessions, 'agreement')
        return response(200, {'data': data, 'count': count, 'page': pagination})

    def public_catalog(self, event):
        if event.get('requestContext', {}).get('http', {}).get('method') != 'GET':
            raise AuthError('METHOD_NOT_ALLOWED', 405)
        if event.get('queryStringParameters'):
            raise AuthError('INVALID_QUERY', 422)
        if self.repository is None or not hasattr(self.repository, 'public_catalog'):
            raise AuthError('PERMISSION_UNAVAILABLE', 503)
        return response(200, self.repository.public_catalog())

    def public_feedback(self, event, collection, key):
        """Public web comments only; internal feedback keeps its scoped routes."""
        kind = 'partner' if collection == 'partners' else 'activity'
        method = event.get('requestContext', {}).get('http', {}).get('method')
        if method == 'GET':
            from .permissions.listing import page
            if set(event.get('queryStringParameters') or {}) - {'limit', 'cursor'}:
                raise AuthError('INVALID_QUERY', 422)
            if not self.repository or not hasattr(self.repository, 'public_feedback'):
                raise AuthError('PERMISSION_UNAVAILABLE', 503)
            rows = self.repository.public_feedback(kind, key)
            data, count, pagination = page(rows, event, self.sessions, 'feedback')
            return response(200, {'data': data, 'count': count, 'page': pagination})
        if method != 'POST':
            raise AuthError('METHOD_NOT_ALLOWED', 405)
        if event.get('queryStringParameters'):
            raise AuthError('INVALID_QUERY', 422)
        token = session_cookie(event)
        request_headers = headers(event)
        self.sessions.check_csrf(token, request_headers.get('origin'), request_headers.get('x-csrf-token'))
        self.sessions.validate(token, require_user=False)
        idem = request_headers.get('idempotency-key')
        if not isinstance(idem, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', idem):
            raise AuthError('INVALID_IDEMPOTENCY_KEY', 422)
        if not self.repository or not hasattr(self.repository, 'create_public_feedback'):
            raise AuthError('PERMISSION_UNAVAILABLE', 503)
        ip = event.get('requestContext', {}).get('http', {}).get('sourceIp')
        if not isinstance(ip, str) or not ip or not hasattr(self.limiter, 'check_feedback'):
            raise AuthError('PERMISSION_UNAVAILABLE', 503)
        self.limiter.check_feedback(ip)
        self.repository.create_public_feedback('partner' if collection == 'partners' else 'activity',
                                               key, body(event), token_hash(token), idem)
        return response(201, {'ok': True})

    def selection_partners(self, event):
        context = require_session(event, self.sessions)
        if event.get('requestContext', {}).get('http', {}).get('method') != 'GET':
            raise AuthError('METHOD_NOT_ALLOWED', 405)
        query = event.get('queryStringParameters') or {}
        scope = query.get('scopeId')
        if set(query) != {'scopeId'} or not isinstance(scope, str) or not 1 <= len(scope) <= 100:
            raise AuthError('INVALID_QUERY', 422)
        if not any(g['scopeId'] == scope and g['role'] in {'staff', 'coordinator', 'executive'}
                   for g in context.user.permissions()[0]):
            raise AuthError('FORBIDDEN', 403)
        from .permissions.policy import can_reference
        rows = self.repository.list('partner', context)
        data = [{'id': row['id'], 'name': row['name']} for row in rows
                if can_reference(context, row, scope)]
        require_session(event, self.sessions)
        return response(200, {'data': sorted(data, key=lambda row: (row['name'],row['id']))})

    def selection_users(self, event):
        context = require_session(event, self.sessions)
        if event.get('requestContext', {}).get('http', {}).get('method') != 'GET':
            raise AuthError('METHOD_NOT_ALLOWED', 405)
        query = event.get('queryStringParameters') or {}
        if (set(query) != {'scopeId', 'kind'} or not isinstance(query['scopeId'], str)
                or not 1 <= len(query['scopeId']) <= 100
                or query['kind'] not in {'participant', 'responsible'}):
            raise AuthError('INVALID_QUERY', 422)
        scope, kind = query['scopeId'], query['kind']
        allowed = {'staff', 'coordinator', 'executive'} if kind == 'participant' else {'staff', 'executive'}
        grants = context.user.permissions()[0]
        if not any(g['scopeId'] == scope and g['role'] in allowed for g in grants):
            raise AuthError('FORBIDDEN', 403)
        rows = self.accounts.store.selection_users(scope, kind)
        # A revoked session must not receive names collected before revocation.
        require_session(event, self.sessions)
        return response(200, {'data': rows})

    def role_targets(self, event):
        context = require_session(event, self.sessions)
        if event.get('requestContext', {}).get('http', {}).get('method') != 'GET':
            raise AuthError('METHOD_NOT_ALLOWED', 405)
        query = event.get('queryStringParameters') or {}
        if (not isinstance(query.get('scopeId'), str) or not 1 <= len(query['scopeId']) <= 100
                or set(query) - {'scopeId', 'q'}):
            raise AuthError('INVALID_QUERY', 422)
        term = ''
        if 'q' in query and query['q'] != '':
            if not isinstance(query['q'], str) or not 2 <= len(query['q'].strip()) <= 80:
                raise AuthError('INVALID_QUERY', 422)
            term = query['q'].strip()
        scope = query['scopeId']
        require_role_management_scope(context, scope)
        rows = self.accounts.store.role_targets(scope, term)
        # A revoked session must not receive names collected before revocation.
        require_session(event, self.sessions)
        return response(200, {'data': rows})

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
