"""Feature API boundary. Storage/validation/file streaming are injected by features.

There is deliberately no in-memory production repository. An adapter must make
`mutate` atomic with the supplied user/record preconditions and perform business
validation (refs, state transitions, idempotency) before its first side effect.
"""

import base64
from dataclasses import dataclass, replace
from datetime import date
import json
import re

from ..auth.require_session import require_session
from ..auth.session_service import AuthError, token_hash
from ..http_api import error_response, headers, response, session_cookie
from .policy import (BUSINESS, require_action, require_record, validate_fields,
                     allowed_roles)
from .projections import project, public_projection
from .listing import page
from ..relationships.activity_links import internal_links, LinkError

COLLECTIONS = {'partners': 'partner', 'activities': 'activity',
               'agreements': 'agreement', 'exchanges': 'exchange'}
NESTED = {'contacts': 'contact', 'history': 'history', 'documents': 'document', 'feedback': 'feedback'}


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
    if parts == ['feedback']:
        return 'feedback', None, None, None, 'inbox', False
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
                or child == 'document' and kind not in {'agreement', 'exchange'}
                or child == 'feedback' and kind not in {'activity', 'exchange'}):
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
            if event.get('rawPath') == '/api/overview':
                return self.overview(event)
            kind, key, parent_kind, parent_key, special, mine = route(event)
            method = event.get('requestContext', {}).get('http', {}).get('method')
            action = ('status' if special == 'status' and method == 'POST' else
                      'read' if method == 'GET' and special != 'status' else
                      'update' if method == 'PATCH' and key and not special else
                      'delete' if method == 'DELETE' and key and kind in {'document', 'contact'} and not special else
                      'upload' if method == 'POST' and not key and kind == 'document' else
                      'create' if method == 'POST' and not key else None)
            if special == 'inbox' and method != 'GET':
                raise AuthError('METHOD_NOT_ALLOWED', 405)
            if action is None or (mine and method != 'GET'):
                raise AuthError('METHOD_NOT_ALLOWED', 405)
            context = require_session(event, self.service)
            require_action(context, kind, action)
            if special == 'inbox' and not any(g['role'] in {'staff', 'executive'}
                                             for g in context.user.permissions()[0]):
                raise AuthError('NOT_FOUND', 404)
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
                if not key and not parent_kind and 'scopeId' in query:
                    scope = query['scopeId']
                    if not isinstance(scope, str) or not scope or len(scope) > 200:
                        raise AuthError('INVALID_QUERY', 422)
                    scoped = tuple(g for g in context.user.grants if g.get('scopeId') == scope)
                    context = replace(context, user=replace(context.user, grants=scoped, capabilities=()))
                    require_action(context, kind, 'read')
                    if special == 'inbox' and not any(g['role'] in {'staff', 'executive'}
                                                     for g in context.user.permissions()[0]):
                        raise AuthError('NOT_FOUND', 404)
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
                    data = self._project(context, kind, record, parent)
                    return self._response(event, data)
                rows = []
                for row in self.repository.list(kind, context, parent):
                    row_parent = parent
                    if special == 'inbox':
                        row_parent = self.repository.get(row.get('parentType'), row.get('parentId'))
                        if not row_parent or row_parent.get('entityType') not in {'activity', 'exchange'}:
                            continue
                    if not allowed_roles(context, kind, 'read', row, row_parent):
                        continue
                    if mine and not self._participant(context, row if kind == 'exchange' else parent):
                        continue
                    projected = self._project(context, kind, row, row_parent)
                    if special == 'inbox':
                        projected.pop('respondentName', None)
                        projected['parentTitle'] = row_parent.get('title', '')
                    rows.append(projected)
                data, count, pagination = page(rows, event, self.service, kind)
                result_body = {'data': data, 'count': count, 'page': pagination,
                               'requestId': event.get('requestContext', {}).get('requestId', '')}
                if kind == 'feedback' and parent is not None:
                    candidate = {'entityType': 'feedback', 'scopeId': parent['scopeId'],
                                 'parentType': parent['entityType'], 'parentId': parent['id']}
                    result_body['canCreate'] = bool(allowed_roles(context, 'feedback', 'create', candidate, parent))
                return response(200, result_body)
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
                if kind in {'document', 'feedback'}:
                    authorization_record.update(parentType=parent_kind, parentId=parent_key)
                    if kind == 'document':
                        authorization_record.update(audience=payload.get('audience'),
                                                    containsPersonal=payload.get('containsPersonal'))
                else:
                    authorization_record['partnerId'] = parent_key
            payload = validate_fields(context, kind, action, payload, authorization_record, parent)
            expected = None
            if action in {'update', 'status', 'delete'}:
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
                                         parent['id'] if parent else parent_key, version(parent) if parent else None,
                                         (record or parent or payload)['scopeId'])
            saved = self.repository.mutate(kind, action, payload, record, parent, conditions, idempotency, upload=upload)
            # Recheck a fresh session before returning protected write data.
            current = require_session(event, self.service)
            if action == 'delete':
                return self._response(event, {'id': saved['id'], 'deleted': True})
            return self._response(event, self._project(current, kind, saved, parent),
                                  status=201 if action in {'create', 'upload'} else 200)
        except AuthError as error:
            return error_response(error.code, error.status, event)
        except Exception:
            return error_response('PERMISSION_UNAVAILABLE', 503, event)

    def _project(self, context, kind, record, parent=None):
        data = project(context, kind, record, parent)
        if kind == 'activity':
            try:
                from .policy import can_reference
                links = internal_links(record, get_record=self.repository.get,
                    allowed=lambda entity, action, row: can_reference(context, row, record['scopeId'])
                    if entity == 'partner' and action == 'read'
                    else bool(allowed_roles(context, entity, action, row)))
            except LinkError as error:
                raise AuthError(error.code, error.status) from None
            data.pop('partnerId', None)
            if links['partner']:
                data['partnerId'] = links['partner']['id']
            data['relationships'] = links
            roles = allowed_roles(context, kind, 'read', record)
            if roles & {'staff', 'coordinator'}:
                data['coHostPartnerIds'] = [item['id'] for item in links['coHosts']]
                data['agreementIds'] = [item['id'] for item in links['agreements']]
                data['relationshipsComplete'] = bool(links['partner'] and
                    len(links['coHosts']) == len(record.get('coHostPartnerIds', [])) and
                    len(links['agreements']) == len(record.get('agreementIds', [])))
        if kind == 'history' and record.get('referenceType') in {'activity', 'agreement'}:
            ref_kind = record['referenceType']
            target = self.repository.get(ref_kind, record.get('referenceId'))
            if (target and target.get('scopeId') == record.get('scopeId')
                    and allowed_roles(context, ref_kind, 'read', target)):
                data.update(referenceType=ref_kind, referenceId=target['id'],
                            referenceLabel=target.get('title', ''))
        return data

    def overview(self, event):
        if event.get('requestContext', {}).get('http', {}).get('method') != 'GET':
            raise AuthError('METHOD_NOT_ALLOWED', 405)
        query = event.get('queryStringParameters') or {}
        supported = {'scopeId', 'stakeholderType', 'activityType', 'status', 'startDate', 'endDate'}
        if not isinstance(query, dict) or set(query) - supported:
            raise AuthError('INVALID_QUERY', 422)
        context = require_session(event, self.service)
        role_grants = tuple(g for g in context.user.grants if g.get('role') in {'staff', 'executive'})
        role = 'executive' if any(g.get('role') == 'executive' for g in role_grants) else 'staff'
        role_grants = tuple(g for g in role_grants if g.get('role') == role)
        if not role_grants:
            raise AuthError('FORBIDDEN', 403)
        scopes = sorted({g.get('scopeId') for g in role_grants if isinstance(g.get('scopeId'), str)})
        if not scopes:
            raise AuthError('FORBIDDEN', 403)
        scope = query.get('scopeId')
        if scope is not None:
            if not isinstance(scope, str) or not scope or len(scope) > 200 or scope not in scopes:
                raise AuthError('NOT_FOUND', 404)
            role_grants = tuple(g for g in role_grants if g.get('scopeId') == scope)
            scopes = [scope]
        context = replace(context, user=replace(context.user, grants=role_grants, capabilities=()))
        require_action(context, 'partner', 'read')
        if self.repository is None:
            raise AuthError('PERMISSION_UNAVAILABLE', 503)

        def valid_day(value):
            try:
                return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
            except (ValueError, TypeError):
                return False

        for key, allowed in (('stakeholderType', {'company', 'university', 'government', 'research_institute', 'internship'}),
                             ('activityType', {'academic_activity', 'event', 'research'})):
            if key in query and (not isinstance(query[key], str) or query[key] not in allowed):
                raise AuthError('INVALID_QUERY', 422)
        if 'status' in query and (not isinstance(query['status'], str) or not query['status'] or len(query['status']) > 64):
            raise AuthError('INVALID_QUERY', 422)
        for key in ('startDate', 'endDate'):
            if key in query and not valid_day(query[key]):
                raise AuthError('INVALID_QUERY', 422)
        start, end = query.get('startDate'), query.get('endDate')
        if start and end and start > end:
            raise AuthError('INVALID_QUERY', 422)

        def authorized(kind, parent=None):
            return [row for row in self.repository.list(kind, context, parent)
                    if allowed_roles(context, kind, 'read', row, parent)]

        def in_period(kind, row):
            if not start and not end:
                return True
            if kind == 'activity':
                day = row.get('periodDate')
                return valid_day(day) and (not start or day >= start) and (not end or day <= end)
            first, last = row.get('startDate'), row.get('endDate')
            return (valid_day(first) and valid_day(last) and first <= last
                    and (not end or first <= end) and (not start or last >= start))

        partners = authorized('partner')
        if 'stakeholderType' in query:
            partners = [row for row in partners if row.get('type') == query['stakeholderType']]
        visible_partner_ids = {row['id'] for row in partners}

        def related_to_selected_stakeholder(kind, row):
            if 'stakeholderType' not in query:
                return True
            if kind == 'activity':
                ids = [row.get('partnerId')]
                if isinstance(row.get('coHostPartnerIds'), list):
                    ids.extend(row['coHostPartnerIds'])
            else:
                ids = row.get('partnerIds') if isinstance(row.get('partnerIds'), list) else []
            return any(isinstance(item, str) and item in visible_partner_ids for item in ids)

        activities = [row for row in authorized('activity')
                      if ('activityType' not in query or row.get('type') == query['activityType'])
                      and in_period('activity', row) and related_to_selected_stakeholder('activity', row)]
        agreements = [row for row in authorized('agreement')
                      if ('status' not in query or row.get('status') == query['status'])
                      and in_period('agreement', row) and related_to_selected_stakeholder('agreement', row)]
        exchanges = [row for row in authorized('exchange')
                     if ('status' not in query or row.get('status') == query['status'])
                     and in_period('exchange', row) and related_to_selected_stakeholder('exchange', row)]

        def counts(rows, field):
            result = {}
            for row in rows:
                value = row.get(field)
                if isinstance(value, str) and value:
                    result[value] = result.get(value, 0) + 1
            return result

        outcomes = []
        for kind, rows, title_field, date_field in (
                ('activity', activities, 'title', 'periodDate'),
                ('exchange', exchanges, 'title', 'startDate')):
            for row in rows:
                summary = row.get('outcomeSummary')
                if isinstance(summary, str) and summary.strip():
                    outcomes.append({'recordType': kind, 'title': row.get(title_field, ''),
                                     'date': row.get(date_field, ''), 'summary': summary.strip()[:500]})
        outcomes.sort(key=lambda row: row.get('date') or '', reverse=True)

        feedback = []
        visible_parents = {(kind, row['id']): row for kind, rows in (
            ('activity', activities), ('exchange', exchanges)) for row in rows}
        for row in self.repository.list('feedback', context, None):
            parent_kind, parent_id = row.get('parentType'), row.get('parentId')
            parent = visible_parents.get((parent_kind, parent_id))
            if not parent or not allowed_roles(context, 'feedback', 'read', row, parent):
                continue
            if start and (not valid_day(row.get('occurredOn')) or row['occurredOn'] < start):
                continue
            if end and (not valid_day(row.get('occurredOn')) or row['occurredOn'] > end):
                continue
            item = project(context, 'feedback', row, parent)
            feedback.append({'date': item.get('occurredOn', ''),
                             'sourceType': item.get('sourceType', ''),
                             'parentType': parent_kind,
                             'parentTitle': parent.get('title', ''),
                             'comment': item.get('comment', '')[:500],
                             'improvement': item.get('improvement', '')[:500]})
        feedback.sort(key=lambda row: row.get('date') or '', reverse=True)

        result = {
            'role': role,
            'filters': {key: query[key] for key in sorted(query)},
            'availableScopes': scopes,
            'stakeholders': {'count': len(partners), 'byType': counts(partners, 'type')},
            'partners': {'count': len(partners), 'byType': counts(partners, 'type')},
            'activities': {'count': len(activities), 'byType': counts(activities, 'type'),
                           'outcomesRecorded': sum(isinstance(row.get('outcomeSummary'), str) and bool(row['outcomeSummary'].strip()) for row in activities)},
            'agreements': {'count': len(agreements), 'statuses': counts(agreements, 'status')},
            'exchanges': {'count': len(exchanges), 'statuses': counts(exchanges, 'status'),
                          'outcomesRecorded': sum(isinstance(row.get('outcomeSummary'), str) and bool(row['outcomeSummary'].strip()) for row in exchanges)},
            'outcomes': {'count': len(outcomes), 'records': outcomes[:5]},
            'feedback': {'count': len(feedback), 'bySource': counts(feedback, 'sourceType'),
                         'withImprovement': sum(bool(row.get('improvement')) for row in feedback),
                         'latest': feedback[:5]},
        }
        return self._response(event, result)

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
