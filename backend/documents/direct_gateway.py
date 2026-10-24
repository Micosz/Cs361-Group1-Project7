"""Authorized, idempotent control plane for direct private S3 uploads.

Only small JSON requests traverse API Gateway. Existing session/CSRF/role/scope
and transactional actor/session/parent checks remain mandatory at publication.
"""
from datetime import datetime, timezone
import hashlib
import json
import re
import uuid

from ..auth.require_session import require_session
from ..auth.session_service import AuthError, token_hash
from ..http_api import error_response, headers, response, session_cookie
from ..permissions.gateway import body, WriteConditions
from ..permissions.policy import require_action, require_record, validate_fields
from ..permissions.projections import project
from ..permissions.transactions import transaction_checks, values
from .direct_validation import upload_metadata, DOCUMENT_LIMIT, IMAGE_LIMIT, UPLOAD_TTL

START = re.compile(r'/api/(agreements|exchanges)/([^/]+)/document-uploads')
TICKET = re.compile(r'/api/document-uploads/(upload-[a-f0-9-]{36})(/complete)?')


def handles(path):
    return path == '/api/documents/config' or bool(START.fullmatch(path) or TICKET.fullmatch(path))


class DirectUploadGateway:
    def __init__(self, service, repository):
        self.service, self.repo = service, repository

    def handle(self, event):
        try:
            if event.get('version') != '2.0':
                raise AuthError('UNSUPPORTED_EVENT', 400)
            storage = getattr(self.repo, 'documents', None)
            if not getattr(storage, 'direct_enabled', False):
                raise AuthError('NOT_FOUND', 404)
            method = event.get('requestContext', {}).get('http', {}).get('method')
            path = event.get('rawPath', '')
            if event.get('queryStringParameters'):
                raise AuthError('INVALID_QUERY', 422)
            if len(event.get('body') or '') > 16384:
                raise AuthError('INVALID_BODY', 400)
            context = require_session(event, self.service)
            require_action(context, 'document', 'upload')
            if path == '/api/documents/config':
                if method != 'GET':
                    raise AuthError('METHOD_NOT_ALLOWED', 405)
                return self._response(event, dict(directUpload=True, documentMaxBytes=DOCUMENT_LIMIT,
                    imageMaxBytes=IMAGE_LIMIT, uploadExpiresIn=300, downloadExpiresIn=120))
            start = START.fullmatch(path)
            if start:
                if method != 'POST':
                    raise AuthError('METHOD_NOT_ALLOWED', 405)
                metadata = upload_metadata(body(event))
                parent = self._authorize(context, start[1][:-1], start[2], metadata)
                ticket = self._start(event, context, parent, metadata)
                return self._response(event, self._view(context, parent, ticket, sign=True), 201)
            target = TICKET.fullmatch(path)
            if not target or method != ('POST' if target[2] else 'GET'):
                raise AuthError('METHOD_NOT_ALLOWED', 405)
            if target[2] and body(event):
                raise AuthError('INVALID_FIELDS', 422)
            ticket = self.repo.get('documentUpload', target[1])
            if not ticket or ticket.get('ownerId') != context.user.user_id:
                raise AuthError('NOT_FOUND', 404)
            parent = self._authorize(context, ticket['parentType'], ticket['parentId'], ticket)
            if parent['scopeId'] != ticket['scopeId']:
                raise AuthError('NOT_FOUND', 404)
            if target[2]:
                ticket = self._complete(event, context, parent, ticket)
            return self._response(event, self._view(context, parent, ticket),
                                  202 if ticket['state'] == 'processing' else 200)
        except AuthError as error:
            return error_response(error.code, error.status, event)
        except Exception:
            return error_response('UPLOAD_UNAVAILABLE', 503, event)

    def _authorize(self, context, kind, key, metadata):
        parent = self.repo.get(kind, key)
        require_record(context, kind, 'read', parent)
        payload = {k: metadata[k] for k in ('displayName', 'audience', 'containsPersonal')}
        probe = dict(entityType='document', scopeId=parent['scopeId'],
                     parentType=kind, parentId=key, **payload)
        validate_fields(context, 'document', 'upload', payload, probe, parent)
        return parent

    def _conditions(self, event, context, parent):
        return WriteConditions(context.user.user_id, context.user.authz_version,
            token_hash(session_cookie(event)), None, None, parent['id'], parent['version'], parent['scopeId'])

    def _checks(self, event, context, parent):
        return transaction_checks(self._conditions(event, context, parent), user_table=self.repo.users,
            session_table=self.repo.sessions, business_table=self.repo.table, now=int(self.repo.clock()))

    def _put(self, ticket, previous=None, live=False):
        put = dict(TableName=self.repo.table, Item=values(ticket), ConditionExpression='attribute_not_exists(id)')
        if previous:
            put.update(ConditionExpression='#v = :v AND #state = :state',
                       ExpressionAttributeNames={'#v': 'version', '#state': 'state'},
                       ExpressionAttributeValues=values({':v': previous['version'], ':state': previous['state']}))
        if live:
            put['ConditionExpression'] += ' AND expiresAt > :now'
            put['ExpressionAttributeValues'].update(values({':now': int(self.repo.clock())}))
        return {'Put': put}

    def _commit(self, checks):
        try:
            self.repo.client.transact_write_items(TransactItems=checks)
        except Exception as error:
            code = getattr(error, 'response', {}).get('Error', {}).get('Code')
            if code in {'TransactionCanceledException', 'ConditionalCheckFailedException'}:
                raise AuthError('VERSION_CONFLICT', 409) from None
            raise

    def _start(self, event, context, parent, metadata):
        now = int(self.repo.clock())
        key = headers(event).get('idempotency-key')
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', key):
            raise AuthError('INVALID_IDEMPOTENCY_KEY', 422)
        fingerprint = hashlib.sha256(json.dumps(metadata, sort_keys=True).encode()).hexdigest()
        retry_id = 'upload-retry-' + hashlib.sha256(json.dumps([
            context.user.user_id, parent['entityType'], parent['id'], key]).encode()).hexdigest()
        cached = self.repo._read(retry_id)
        if cached and cached['expiresAt'] > now:
            if cached['fingerprint'] != fingerprint:
                raise AuthError('IDEMPOTENCY_CONFLICT', 409)
            ticket = self.repo.get('documentUpload', cached['resultId'])
            if not ticket or ticket.get('ownerId') != context.user.user_id:
                raise AuthError('NOT_FOUND', 404)
            if ticket.get('scopeId') != parent['scopeId']:
                raise AuthError('NOT_FOUND', 404)
            return ticket
        identifier, document_id = 'upload-' + str(uuid.uuid4()), str(uuid.uuid4())
        ticket = dict(metadata, id=identifier, documentId=document_id, entityType='documentUpload',
            scopeEntity=parent['scopeId'] + '#documentUpload', scopeId=parent['scopeId'],
            parentType=parent['entityType'], parentId=parent['id'], ownerId=context.user.user_id,
            stagingKey='documents/staging/' + identifier + '.' + metadata['extension'],
            state='pending', version=1, expiresAt=now + UPLOAD_TTL, ttl=now + 86400, createdAt=now)
        retry = dict(id=retry_id, entityType='idempotency', fingerprint=fingerprint, resultId=identifier,
                     expiresAt=now + UPLOAD_TTL, ttl=now + 86400)
        # Budget signing attempts as well as bytes reserved, including abandoned tickets.
        budget_id = 'upload-budget-' + hashlib.sha256((context.user.user_id + ':' + str(now // 3600)).encode()).hexdigest()
        old_budget = self.repo._read(budget_id)
        count, reserved = (old_budget or {}).get('count', 0), (old_budget or {}).get('reservedBytes', 0)
        if count >= 20 or reserved + metadata['size'] > 500 * 1024 * 1024:
            raise AuthError('UPLOAD_QUOTA_EXCEEDED', 429)
        budget = dict(id=budget_id, entityType='uploadBudget', version=(old_budget or {}).get('version', 0) + 1,
                      count=count + 1, reservedBytes=reserved + metadata['size'], ttl=now + 90000)
        budget_put = dict(TableName=self.repo.table, Item=values(budget), ConditionExpression='attribute_not_exists(id)')
        if old_budget:
            budget_put.update(ConditionExpression='#v = :v', ExpressionAttributeNames={'#v': 'version'},
                              ExpressionAttributeValues=values({':v': old_budget['version']}))
        self._commit(self._checks(event, context, parent) + [self._put(ticket), {'Put': budget_put}, {'Put': dict(
            TableName=self.repo.table, Item=values(retry),
            ConditionExpression='attribute_not_exists(id) OR expiresAt <= :now',
            ExpressionAttributeValues=values({':now': now}))}])
        return ticket

    def _view(self, context, parent, ticket, sign=False):
        view = dict(uploadId=ticket['id'], state=ticket['state'], expiresAt=ticket['expiresAt'])
        if ticket['state'] == 'ready':
            document = self.repo.get('document', ticket['documentId'])
            if not document:
                raise AuthError('NOT_FOUND', 404)
            view['document'] = project(context, 'document', document, parent)
        elif ticket['expiresAt'] <= int(self.repo.clock()):
            raise AuthError('UPLOAD_EXPIRED', 410)
        elif ticket['state'] == 'failed':
            view['error'] = ticket.get('error', 'INVALID_UPLOAD')
        elif sign and ticket['state'] == 'pending':
            view['upload'] = self.repo.documents.sign_upload(ticket, int(self.repo.clock()))
        return view

    def _complete(self, event, context, parent, ticket):
        now = int(self.repo.clock())
        if ticket['state'] in {'ready', 'failed'}:
            return ticket
        if ticket['expiresAt'] <= now:
            raise AuthError('UPLOAD_EXPIRED', 410)
        if ticket['state'] == 'processing' and ticket.get('leaseUntil', 0) > now:
            return ticket
        claimed = dict(ticket, state='processing', version=ticket['version'] + 1,
                       leaseUntil=now + 120, attempt=uuid.uuid4().hex)
        self._commit(self._checks(event, context, parent) + [self._put(claimed, ticket)])
        candidate = None
        try:
            candidate, storage_version = self.repo.documents.verify_and_promote(claimed)
            # Re-read account/session/parent after I/O; permission withdrawal wins.
            fresh = require_session(event, self.service)
            current_parent = self._authorize(fresh, claimed['parentType'], claimed['parentId'], claimed)
            if current_parent['scopeId'] != claimed['scopeId']:
                raise AuthError('NOT_FOUND', 404)
            timestamp = datetime.now(timezone.utc).isoformat()
            document = dict(id=claimed['documentId'], entityType='document', schemaVersion=3,
                scopeId=claimed['scopeId'], scopeEntity=claimed['scopeId'] + '#document', version=1,
                parentType=claimed['parentType'], parentId=claimed['parentId'],
                displayName=claimed['displayName'], audience=claimed['audience'],
                containsPersonal=claimed['containsPersonal'], mime=claimed['mime'], size=claimed['size'],
                hash=claimed['sha256'], objectKey=candidate, storageVersionId=storage_version,
                storageMode='direct', uploadState='ready', uploadedBy=fresh.user.user_id,
                uploadedAt=timestamp, createdAt=timestamp, updatedAt=timestamp,
                createdBy=fresh.user.user_id, updatedBy=fresh.user.user_id)
            require_record(fresh, 'document', 'upload', document, current_parent)
            ready = dict(claimed, state='ready', version=claimed['version'] + 1)
            self._commit(self._checks(event, fresh, current_parent) + [self._put(ready, claimed, live=True),
                {'Put': dict(TableName=self.repo.table, Item=values(document),
                             ConditionExpression='attribute_not_exists(id)')}])
            return ready
        except Exception as error:
            # A lost response after a commit must never remove committed content.
            saved = self.repo.get('document', claimed['documentId'])
            if saved and saved.get('objectKey') == candidate:
                return self.repo.get('documentUpload', claimed['id'])
            if candidate:
                self.repo.documents.abandon(candidate)
            code = error.code if isinstance(error, AuthError) else None
            aws_code = getattr(error, 'response', {}).get('Error', {}).get('Code')
            if aws_code in {'NoSuchKey', 'NotFound', '404'}:
                code = 'UPLOAD_NOT_RECEIVED'
                error = AuthError(code, 409)
            terminal = code in {'INVALID_UPLOAD', 'CHECKSUM_MISMATCH', 'FILE_TOO_LARGE'}
            retry = dict(claimed, state='failed' if terminal else 'pending',
                         version=claimed['version'] + 1, error=code or 'UPLOAD_UNAVAILABLE')
            try:
                self._commit(self._checks(event, context, parent) + [self._put(retry, claimed)])
            except Exception:
                pass  # Role/session/parent races fail closed; lease permits later retry.
            raise error

    @staticmethod
    def _response(event, data, status=200):
        return response(status, {'data': data, 'requestId': event.get('requestContext', {}).get('requestId', '')})
