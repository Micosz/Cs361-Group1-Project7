"""In-memory prototype for #94 local tests, NOT a production storage adapter.

Rows, locks and idempotency are process-local and disappear on restart. They do
not make user/session reads atomic with business writes across Lambda instances.
Do not inject this repository into the deployed application. Production requires
persistent scoped storage and atomic user/session/target/parent/reference checks.
"""

import base64
import copy
from datetime import datetime, timezone, timedelta
import threading
import time
import uuid

from ..auth.session_service import AuthError
from ..business.validation import normalize_payload
from ..permissions.policy import require_assignee, require_reference
from .validators import (
    validate_partner_payload,
    validate_contact_payload,
    validate_history_payload,
    validate_activity_payload,
    validate_exchange_payload,
    validate_exchange_status_payload,
    validate_feedback_payload,
)


class PartnerRepository:
    """Local Partner/Contact prototype; its lock protects only this process."""

    def __init__(self, service=None, initial_records=None, clock=None, supported_kinds=None):
        self.service = service
        self.clock = clock or time.time
        self._lock = threading.Lock()
        self.rows = {}
        # (user_id, kind, parent_id, idempotency_key) -> (payload_copy, result_copy, created_at_timestamp)
        self.idempotency_cache = {}
        self.writes = 0
        self.supported_kinds = set(supported_kinds) if supported_kinds is not None else {'partner', 'contact', 'history', 'feedback'}

        if initial_records:
            for rec in initial_records:
                self.rows[(rec['entityType'], rec['id'])] = copy.deepcopy(rec)

    def get(self, kind: str, key: str) -> dict | None:
        with self._lock:
            row = self.rows.get((kind, key))
            return copy.deepcopy(row) if row else None

    def list(self, kind: str, context, parent: dict | None = None) -> list:
        user = context.user
        permitted_scopes = {g['scopeId'] for g in user.grants if g.get('active')}
        results = []
        with self._lock:
            for (k, _), row in self.rows.items():
                if k != kind:
                    continue
                if row.get('scopeId') not in permitted_scopes:
                    continue
                if parent is not None:
                    parent_id = parent.get('id')
                    if kind in {'contact', 'history'} and row.get('partnerId') != parent_id:
                        continue
                    if kind == 'document' and row.get('parentId') != parent_id:
                        continue
                    if kind == 'feedback' and row.get('targetId') != parent_id:
                        continue
                results.append(copy.deepcopy(row))
        return results

    def mutate(self, kind: str, action: str, payload: dict, record: dict | None,
               parent: dict | None, conditions, idempotency_key: str | None,
               upload=None) -> dict:
        if kind not in self.supported_kinds or action not in {'create', 'update', 'delete'} or upload is not None:
            raise AuthError('PERMISSION_UNAVAILABLE', 503)
        with self._lock:
            # 1. Preconditions & Concurrency Checks
            if self.service is not None and not (kind == 'feedback' and action == 'create'):
                user = getattr(self.service.users, 'user', None)
                if callable(user):
                    user = user(conditions.user_id)
                elif user is None and hasattr(self.service.users, 'store'):
                    user = self.service.users.store.user(conditions.user_id)
                if user is None and hasattr(self.service.users, 'get'):
                    user = self.service.users.get(conditions.user_id)
                if user is None or not user.active or user.authz_version != conditions.authz_version:
                    raise AuthError('SESSION_REVOKED', 401)
                session = self.service.store.get(conditions.session_hash) if hasattr(self.service, 'store') else None
                if not session:
                    raise AuthError('SESSION_REVOKED', 401)

            # Optimistic concurrency check for target record
            if conditions.target_id is not None:
                current = self.rows.get((kind, conditions.target_id))
                if not current or current.get('version') != conditions.target_version:
                    raise AuthError('VERSION_CONFLICT', 409)

            # Optimistic concurrency check for parent record
            if conditions.parent_id is not None and parent is not None:
                current_parent = self.rows.get((parent.get('entityType'), conditions.parent_id))
                if not current_parent or current_parent.get('version') != conditions.parent_version:
                    raise AuthError('VERSION_CONFLICT', 409)

            # 2. Idempotency Check for Create (24 hours = 86400 seconds)
            if action == 'create' and idempotency_key:
                cache_key = (conditions.user_id, kind, conditions.parent_id, idempotency_key)
                cached = self.idempotency_cache.get(cache_key)
                if cached:
                    cached_payload, cached_result, timestamp = cached
                    if self.clock() - timestamp < 86400:
                        if cached_payload == payload:
                            return copy.deepcopy(cached_result)
                        else:
                            raise AuthError('IDEMPOTENCY_CONFLICT', 409)

            # 3. Domain Business Validation
            is_create = (action == 'create')
            if kind == 'partner':
                validate_partner_payload(payload, is_create=is_create)
            elif kind == 'contact':
                validate_contact_payload(payload, is_create=is_create)
            elif kind == 'history':
                validate_history_payload(payload, is_create=is_create)
            elif kind == 'feedback':
                validate_feedback_payload(payload, is_create=is_create)
                target_type = payload.get('targetType') or (record.get('targetType') if record else None)
                target_id = payload.get('targetId') or (record.get('targetId') if record else None)
                target_row = self.rows.get((target_type, target_id))
                if not target_row or target_row.get('scopeId') != conditions.scope_id:
                    raise AuthError('NOT_FOUND', 404)
            elif kind == 'activity':
                payload = normalize_payload(kind, action, payload, record=record)
                validate_activity_payload(payload, is_create=is_create)

            # 4. Parent-Child & Reference Integrity
            if kind in {'contact', 'history'}:
                if not parent or parent.get('entityType') != 'partner':
                    raise AuthError('NOT_FOUND', 404)
                if parent.get('scopeId') != conditions.scope_id:
                    raise AuthError('NOT_FOUND', 404)
                if not is_create and record:
                    if record.get('partnerId') != parent.get('id') or record.get('scopeId') != parent.get('scopeId'):
                        raise AuthError('NOT_FOUND', 404)

            if action == 'delete':
                if kind != 'contact' or not record or not parent:
                    raise AuthError('NOT_FOUND', 404)
                del self.rows[(kind, record['id'])]
                self.writes += 1
                return copy.deepcopy(record)

            if kind == 'activity':
                # Primary partner reference (required, must exist in same scope)
                effective_partner_id = payload.get('partnerId', (record or {}).get('partnerId'))
                partner_rec = self.rows.get(('partner', effective_partner_id))
                if not partner_rec or partner_rec.get('scopeId') != conditions.scope_id:
                    raise AuthError('INVALID_REFERENCE', 422)

                # Co-host partner references (optional, must exist in same scope)
                effective_cohosts = payload.get('coHostPartnerIds', (record or {}).get('coHostPartnerIds', []))
                for ch_id in effective_cohosts:
                    ch_rec = self.rows.get(('partner', ch_id))
                    if not ch_rec or ch_rec.get('scopeId') != conditions.scope_id:
                        raise AuthError('INVALID_REFERENCE', 422)

                # Agreement references (optional, must exist in same scope)
                effective_agreements = payload.get('agreementIds', (record or {}).get('agreementIds', []))
                for ag_id in effective_agreements:
                    ag_rec = self.rows.get(('agreement', ag_id))
                    if not ag_rec or ag_rec.get('scopeId') != conditions.scope_id:
                        raise AuthError('INVALID_REFERENCE', 422)

                # Responsible user assignees (must be active, verified, staff/coordinator in same scope)
                effective_responsible = payload.get('responsibleUserIds', (record or {}).get('responsibleUserIds', []))
                if self.service is not None and hasattr(self.service, 'users'):
                    for uid in effective_responsible:
                        u_state = None
                        if hasattr(self.service.users, 'get'):
                            u_state = self.service.users.get(uid)
                        elif hasattr(self.service.users, 'store') and hasattr(self.service.users.store, 'user'):
                            u_state = self.service.users.store.user(uid)
                        elif getattr(self.service.users, 'user', None) and self.service.users.user.user_id == uid:
                            u_state = self.service.users.user
                        require_assignee(u_state, conditions.scope_id)

            # 5. Build and Persist Record
            now_iso = datetime.now(timezone.utc).isoformat()
            user_id_val = getattr(conditions, 'user_id', None) or 'anonymous'
            if is_create:
                rec_id = f"{kind}-{uuid.uuid4().hex[:12]}"
                saved = {
                    'id': rec_id,
                    'entityType': kind,
                    'schemaVersion': 3,
                    'scopeId': conditions.scope_id,
                    'createdAt': now_iso,
                    'updatedAt': now_iso,
                    'createdBy': user_id_val,
                    'updatedBy': user_id_val,
                    'version': 1,
                }
                if kind in {'contact', 'history'}:
                    saved['partnerId'] = parent['id']
                if kind == 'feedback':
                    saved['targetType'] = payload['targetType']
                    saved['targetId'] = payload['targetId']
                    saved['respondentCategory'] = payload['respondentCategory']
                    saved['channel'] = payload.get('channel', 'web')
                    saved['content'] = payload['content']
                    saved['submittedAt'] = now_iso
                if kind == 'partner':
                    saved['publication'] = payload.get('publication', 'internal')
                    saved['responsibleUserIds'] = payload.get('responsibleUserIds', [])
                if kind == 'activity':
                    saved['publication'] = payload.get('publication', 'internal')
                    saved['responsibleUserIds'] = payload.get('responsibleUserIds', [user_id_val])
                    saved['coHostPartnerIds'] = []
                    saved['agreementIds'] = []
                if kind == 'history':
                    saved['recordedBy'] = user_id_val
                saved.update(payload)
            else:
                saved = copy.deepcopy(record)
                saved['updatedAt'] = now_iso
                saved['updatedBy'] = user_id_val
                saved['version'] = record.get('version', 1) + 1
                saved.update(payload)

            self.rows[(kind, saved['id'])] = copy.deepcopy(saved)
            self.writes += 1

            # 6. Cache Idempotency for Create
            if action == 'create' and idempotency_key:
                cache_key = (conditions.user_id, kind, conditions.parent_id, idempotency_key)
                self.idempotency_cache[cache_key] = (
                    copy.deepcopy(payload),
                    copy.deepcopy(saved),
                    self.clock(),
                )

            return copy.deepcopy(saved)

    def parse_upload(self, event):
        raise AuthError('PERMISSION_UNAVAILABLE', 503)

    def content(self, document: dict, disposition: str):
        raise AuthError('NOT_FOUND', 404)


class ActivityRepository(PartnerRepository):
    """Local prototype supporting Activity, Partner, and Contact domain operations (#96)."""

    def __init__(self, service=None, initial_records=None, clock=None, supported_kinds=None):
        kinds = supported_kinds if supported_kinds is not None else {'partner', 'contact', 'activity', 'feedback'}
        super().__init__(service=service, initial_records=initial_records, clock=clock, supported_kinds=kinds)


class ExchangeRepository(PartnerRepository):
    """In-memory repository for Exchanges (Issue #104 / Parent #85)."""

    def __init__(self, service=None, initial_records=None, clock=None, document_contents=None):
        super().__init__(service, initial_records, clock)
        self.document_contents = dict(document_contents or {})

    def content(self, document: dict, disposition: str):
        with self._lock:
            doc_id = document.get('id')
            content_bytes = self.document_contents.get(doc_id, b'%PDF-1.4 mock exchange document')
            mime = document.get('mime', 'application/pdf')
            filename = document.get('displayName', 'document.pdf')
            return {
                'statusCode': 200,
                'headers': {
                    'content-type': mime,
                    'content-disposition': f"{disposition}; filename=\"{filename}\"",
                },
                'body': base64.b64encode(content_bytes).decode('utf-8') if isinstance(content_bytes, bytes) else content_bytes,
                'isBase64Encoded': True,
            }

    def mutate(self, kind: str, action: str, payload: dict, record: dict | None,
               parent: dict | None, conditions, idempotency_key: str | None,
               upload=None) -> dict:
        if kind != 'exchange' or action not in {'create', 'update', 'status'} or upload is not None:
            return super().mutate(kind, action, payload, record, parent, conditions, idempotency_key, upload)

        with self._lock:
            # 1. Preconditions & Concurrency Checks
            if self.service is not None:
                user = getattr(self.service.users, 'user', None)
                if callable(user):
                    user = user(conditions.user_id)
                elif user is None and hasattr(self.service.users, 'store'):
                    user = self.service.users.store.user(conditions.user_id)
                if user is None or not user.active or user.authz_version != conditions.authz_version:
                    raise AuthError('SESSION_REVOKED', 401)
                session = self.service.store.get(conditions.session_hash) if hasattr(self.service, 'store') else None
                if not session:
                    raise AuthError('SESSION_REVOKED', 401)

            # Optimistic concurrency check for target record
            if conditions.target_id is not None:
                current = self.rows.get((kind, conditions.target_id))
                if not current or current.get('version') != conditions.target_version:
                    raise AuthError('VERSION_CONFLICT', 409)

            # 2. Idempotency Check for Create (24 hours)
            if action == 'create' and idempotency_key:
                cache_key = (conditions.user_id, kind, conditions