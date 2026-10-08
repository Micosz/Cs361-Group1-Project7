"""Feature API boundary. Storage/validation/file streaming are injected by features.

There is deliberately no in-memory production repository. An adapter must make
`mutate` atomic with the supplied user/record preconditions and perform business
validation (refs, state transitions, idempotency) before its first side effect.
"""

import base64
from dataclasses import dataclass, replace
import json
import re

from ..auth.require_session import require_session
from ..auth.session_service import AuthError, token_hash
from ..http_api import error_response, headers, response, session_cookie
from .policy import (BUSINESS, require_action, require_record, validate_fields,
                     allowed_roles)
from .projections import project, public_projection
from .listing import page

COLLECTIONS = {'partners': 'partner', 'activities': 'activity',
               'agreements': 'agreement', 'exchanges': 'exchange'}
NESTED = {'contacts': 'contact', 'history': 'history', 'documents': 'document'}


@dataclass(frozen=True)
class WriteConditions:
    """Adapter must check ALL conditions in the same transaction as the write.

    Parent and target versions cover assignment/visibility changes; user version
    covers role withdrawal. Session row existence/expiry covers logout during a
    write. No conditions may be dropped or checked with an eventual read.
    """
    user_id: str
    authz_version: int
    session_hash: str
    target_id: str | None
    target_version: int | None
    parent_id: str | None
    parent_version: int | None
    scope_id: str


def route(event):
    path = event.get('rawPath', '').split('/')
    if path[:2] != ['', 'api']:
        raise AuthError('NOT_FOUND', 404)
    parts = path[2:]
    mine = parts[:2] == ['me', 'exchanges']
    if mine:
        parts = parts[1:]
    if len(parts) == 2 and parts[0] == 'documents':
        return 'document', parts[1], None, None, False, mine
    if len(parts) == 3 and parts[0] == 'documents' and parts[2] == 'content':
        return 'document', parts[1], None, None, True, mine
    if not parts or parts[0] not in COLLECTIONS:
        raise AuthError('NOT_FOUND', 404)
    kind = COLLECTIONS[parts[0]]
    if len(parts) in {1, 2}:
        return kind, parts[1] if len(parts) == 2 else None, None, None, False, mine
    if len(parts) == 3 and parts[2] == 'status' and kind in {'agreement', 'exchange'}:
        return kind, parts[1], None, None, 'status', mine
    if len(parts) in {3, 4} and parts[2] in NESTED:
        child = NESTED[parts[2]]
        if (child in {'contact', 'history'} and kind != 'partner'
                or child == 'document' and kind not in {'agreement', 'exchange'}):
            raise AuthError('NOT_FOUND', 404)
        return child, parts[3] if len(parts) == 4 else None, kind, parts[1], False, mine
    raise AuthError('NOT_FOUND', 404)


def body(event):
    try:
        raw = event.get('body') or '{}'
        if event.get('isBase64Encoded'):
            raw = base64.b64decode(raw, validate=True).decode('utf-8')
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError('duplicate key')
                result[key] = value
            return result
        value = json.loads(raw, object_pairs_hook=unique,
                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, TypeError, UnicodeError):
        raise AuthError('INVALID_BODY', 400) from None


def version(record):
    value = record.get('version') if record else None
    if type(value) is not int or value < 1:
        raise AuthError('INVALID_RECORD_VERSION', 409)
    return value


class PermissionGateway:
    """Required port methods:

    get(kind, id): trusted record or None, strongly consistent
    list(kind, context, parent): ALL candidates in permitted grant scopes (not a
      page/global count); gateway filters record permissions before projection.
    parse_upload(event): (metadata dict, validated file), with no side effects
    mutate(kind, action, payload, record, parent, conditions, idempotency_key, upload=None):
      validate values/refs/transitions + transactional preconditions; return row.
    content(document, disposition): private stream response; never a public URL.

    Feature adapters must not call writes/streams before these methods authorize.
    """
    def __init__(self, service, repository):
        self.service, self.repository = service, repository

    def handle(self, event):
        try:
            if event.get('version') != '2.0':
                raise AuthError('UNSUPPORTED_EVENT', 400)
            kind, key, parent_kind, parent_key, special, mine = route(event)
            method = event.get('requestContext', {}).get('http', {}).get('method')
            action = ('status' if special == 'status' and method == 'POST' else
                      'read' if method == 'GET' and special != 'status' else
                      'update' if method == 'PATCH' and key and not special else
                      'upload' if method == 'POST' and not key and kind == 'document' else
                      'create' if method == 'POST' and not key else None)
            if action is None or (mine and method != 'GET'):
                raise AuthError('METHOD_NOT_ALLOWED', 405)
            context = require_session(event, self.service)
            require_action(context, kind, action)
            if mine:
                student_grants = tuple(g for g in context.user.grants
                                       if g.get('role') == 'student')
                context = replace(context, user=replace(context.user, grants=student_grants, capabilities=()))
                require_action(context, kind, action)
            # A missing adapter is a dependency failure, never an empty success.
            if self.repository is None:
                raise AuthError('PERMISSION_UNAVAILABLE', 503)
            parent = self.repository.get(parent_kind, parent_key) if parent_kind else None
            record = self.repository.get(kind, key) if key else None
            if parent_kind:
                require_record(context, parent_kind, 'read', parent)
            if key:
                if kind == 'document' and parent is None:
                    parent = self._parent(record, kind)
                require_record(context, kind, action, record, parent)
                if mine and not self._participant(context, record if kind == 'exchange' else parent):
                    raise AuthError('NOT_FOUND', 404)
            query = event.get('queryStringParameters') or {}
            if action == 'read':
                if special is True:
                    if set(query) - {'disposition'} or query.get('disposition', 'inline') not in {'inline', 'attachment'}:
                        raise AuthError('INVALID_QUERY', 422)
                    if record.get('uploadState') != 'ready':
                        raise AuthError('NOT_FOUND', 404)
                    result = self.repository.content(record, query.get('disposition', 'inline'))
                    # Streams remain private even if the feature omitted headers.
                    result.setdefault('headers', {}).update({'cache-control': 'no-store',
                                                             'x-content-type-options': 'nosniff'})
                    return result
                if key:
                    if query:
                        raise AuthError('INVALID_QUERY', 422)
                    data = project(context, kind, record, parent)
                    return self._response(event, data)
                rows = []
                for row in self.repository.list(kind, context, parent):
                    if not allowed_roles(context, kind, 'read', row, parent):
                        continue
                    if mine and not self._participant(context, row if kind == 'exchange' else parent):
                        continue
                    rows.append(project(context, kind, row, parent))
                data, count, pagination = page(rows, event, self.service)
                return response(200, {'data': data, 'count': count, 'page': pagination,
                                      'requestId': event.get('requestContext', {}).get('requestId', '')})
            if query:
                raise AuthError('INVALID_QUERY', 422)
            request_headers = headers(event)
            upload = None
            if action == 'upload':
                # Feature #101 parses/validates multipart without storing bytes.
                payload, upload = self.repository.parse_upload(event)
            else:
                payload = body(event)
            # Child create/upload inherits parent permissions and IDs.
            authorization_record = record
            if not key and parent_kind:
                authorization_record = {'entityType': kind, 'scopeId': parent['scopeId']}
                if kind == 'document':
                    authorization_record.update(parentType=parent_kind, parentId=parent_key,
                                                audience=payload.get('audience'),
                                                containsPersonal=payload.get('containsPersonal'))
                else:
                    authorization_record['partnerId'] = parent_key
            payload = validate_fields(context, kind, action, payload, authorization_record, parent)
            expected = None
            if action in {'update', 'status'}:
                match = request_headers.get('if-match')
                if match is None:
                    raise AuthError('PRECONDITION_REQUIRED', 428)
                if not re.fullmatch(r'"[1-9][0-9]*"', match):
                    raise AuthError('INVALID_VERSION', 422)
                expected = int(match[1:-1])
                if version(record) != expected:
                    raise AuthError('VERSION_CONFLICT', 409)
            idempotency = None
            if action in {'create', 'upload'}:
                idempotency = request_headers.get('idempotency-key')
                if not isinstance(idempotency, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', idempotency):
                    raise AuthError('INVALID_IDEMPOTENCY_KEY', 422)
            conditions = WriteConditions(context.user.user_id, context.user.authz_version,
                                         token_hash(session_cookie(event)), key, expected,
                                         parent_key, version(parent) if parent else None,
                                         (record or parent or payload)['scopeId'])
            saved = self.repository.mutate(kind, action, payload, record, parent, conditions, idempotency, upload=upload)
            # Recheck a fresh session before returning protected write data.
            current = require_session(event, self.service)
            return self._response(event, project(current, kind, saved, parent),
                                  status=201 if action in {'create', 'upload'} else 200)
        except AuthError as error:
            return error_response(error.code, error.status, event)
        except Exception:
            return error_response('PERMISSION_UNAVAILABLE', 503, event)

    def _parent(self, record, kind):
        if kind != 'document' or not record:
            return None
        return self.repository.get(record.get('parentType'), record.get('parentId'))

    @staticmethod
    def _participant(context, record):
        return record and 'student' in allowed_roles(context, 'exchange', 'read', record)

    @staticmethod
    def _response(event, data, status=200, count=None):
        result = {'data': data, 'requestId': event.get('requestContext', {}).get('requestId', '')}
        if count is not None:
            result.update(count=count, page={'limit': len(data), 'nextCursor': None})
        return response(status, result)


def public_records(kind, records, partners=None, predicate=lambda _: True):
    """Shared public/backup projection; filtering sees only projected data."""
    result = []
    for row in records:
        projected = public_projection(kind, row, partners)
        if projected is not None and predicate(projected):
            result.append(projected)
    return {'data': result, 'count': len(result)}
