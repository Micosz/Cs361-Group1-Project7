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
        self.supported_kinds = set(supported_kinds) if supported_kinds is not None else {'partner', 'contact', 'history'}

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
                results.append(copy.deepcopy(row))
        return results

    def mutate(self, kind: str, action: str, payload: dict, record: dict | None,
               parent: dict | None, conditions, idempotency_key: str | None,
               upload=None) -> dict:
        if kind not in self.supported_kinds or action not in {'create', 'update', 'delete'} or upload is not None:
            raise AuthError('PERMISSION_UNAVAILABLE', 503)
        with self._lock:
            # 1. Preconditions & Concurrency Checks
            if self.service is not None:
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
            if is_create:
                rec_id = f"{kind}-{uuid.uuid4().hex[:12]}"
                saved = {
                    'id': rec_id,
                    'entityType': kind,
                    'schemaVersion': 3,
                    'scopeId': conditions.scope_id,
                    'createdAt': now_iso,
                    'updatedAt': now_iso,
                    'createdBy': conditions.user_id,
                    'updatedBy': conditions.user_id,
                    'version': 1,
                }
                if kind in {'contact', 'history'}:
                    saved['partnerId'] = parent['id']
                if kind == 'partner':
                    saved['publication'] = payload.get('publication', 'internal')
                    saved['responsibleUserIds'] = payload.get('responsibleUserIds', [])
                if kind == 'activity':
                    saved['publication'] = payload.get('publication', 'internal')
                    saved['responsibleUserIds'] = payload.get('responsibleUserIds', [conditions.user_id])
                    saved['coHostPartnerIds'] = []
                    saved['agreementIds'] = []
                if kind == 'history':
                    saved['recordedBy'] = conditions.user_id
                saved.update(payload)
            else:
                saved = copy.deepcopy(record)
                saved['updatedAt'] = now_iso
                saved['updatedBy'] = conditions.user_id
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
        kinds = supported_kinds if supported_kinds is not None else {'partner', 'contact', 'activity'}
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
            if action == 'status':
                validate_exchange_status_payload(payload)
                if not record:
                    raise AuthError('NOT_FOUND', 404)
                current_status = record.get('status', 'draft')
                to_status = payload['to']

                # Rules from transition table:
                # - draft -> ongoing: dates/partners/responsible and participant >= 1 valid, end >= today
                # - ongoing -> completed: supportingInfo required
                # - draft/ongoing -> cancelled: reason required
                # - draft -> draft / ongoing -> ongoing: valid
                # - completed / cancelled cannot transition to other statuses (INVALID_TRANSITION 409)
                today_str = datetime.fromtimestamp(self.clock(), timezone(timedelta(hours=7))).strftime('%Y-%m-%d')
                if current_status == 'draft' and to_status == 'ongoing':
                    # Verify required fields for ongoing
                    if not record.get('partnerIds') or not record.get('responsibleUserIds'):
                        raise AuthError('INVALID_TRANSITION', 409)
                    participants = record.get('participantUserIds', [])
                    if not isinstance(participants, list) or len(participants) < 1:
                        raise AuthError('INVALID_TRANSITION', 409)
                    if not record.get('startDate') or not record.get('endDate'):
                        raise AuthError('INVALID_TRANSITION', 409)
                    if record['endDate'] < today_str:
                        raise AuthError('INVALID_TRANSITION', 409)
                elif current_status == 'ongoing' and to_status == 'completed':
                    supp_info = payload.get('supportingInfo')
                    if not supp_info or not isinstance(supp_info, str) or not supp_info.strip():
                        raise AuthError('INVALID_TRANSITION', 409)
                elif current_status in {'draft', 'ongoing'} and to_status == 'cancelled':
                    reason = payload.get('reason')
                    if not reason or not isinstance(reason, str) or not reason.strip():
                        raise AuthError('INVALID_TRANSITION', 409)
                elif current_status == to_status:
                    pass
                else:
                    raise AuthError('INVALID_TRANSITION', 409)

            else:
                is_create = (action == 'create')
                validate_exchange_payload(payload, is_create=is_create)
                combined = dict(record or {}, **payload)
                start, end = combined.get('startDate'), combined.get('endDate')
                if start is not None and end is not None and start > end:
                    raise AuthError('INVALID_FIELDS', 422)

                # Verify partnerIds reference valid partners in same scope
                partner_ids = payload.get('partnerIds') or (record.get('partnerIds') if record else [])
                for pid in partner_ids:
                    partner_row = self.rows.get(('partner', pid))
                    if partner_row is None:
                        raise AuthError('NOT_FOUND', 404)
                    if partner_row.get('scopeId') != conditions.scope_id:
                        raise AuthError('NOT_FOUND', 404)

                # Verify agreementId if present
                agr_id = payload.get('agreementId')
                if agr_id:
                    agr_row = self.rows.get(('agreement', agr_id))
                    if agr_row is None or agr_row.get('scopeId') != conditions.scope_id:
                        raise AuthError('NOT_FOUND', 404)

                # Helper to get user object
                def get_user_obj(uid):
                    if not self.service or not hasattr(self.service, 'users'):
                        return None
                    u = getattr(self.service.users, 'user', None)
                    if callable(u):
                        return u(uid)
                    if hasattr(self.service.users, 'get'):
                        return self.service.users.get(uid)
                    if hasattr(self.service.users, 'store'):
                        return self.service.users.store.user(uid)
                    return None

                # Validate responsibleUserIds against active users in scope (for staff)
                resp_users = payload.get('responsibleUserIds')
                if resp_users:
                    for uid in resp_users:
                        target_user = get_user_obj(uid)
                        if not target_user:
                            raise AuthError('INVALID_FIELDS', 422)
                        try:
                            require_assignee(target_user, conditions.scope_id, participant=False)
                        except AuthError:
                            raise AuthError('INVALID_FIELDS', 422)

                # Validate participantUserIds against active verified students in scope (#105)
                part_users = payload.get('participantUserIds')
                if part_users:
                    for uid in part_users:
                        target_user = get_user_obj(uid)
                        if not target_user:
                            raise AuthError('INVALID_FIELDS', 422)
                        try:
                            require_assignee(target_user, conditions.scope_id, participant=True)
                        except AuthError:
                            raise AuthError('INVALID_FIELDS', 422)

            # 4. Build and Persist Record
            now_iso = datetime.now(timezone.utc).isoformat()
            if is_create:
                rec_id = f"exchange-{uuid.uuid4().hex[:12]}"
                saved = {
                    'id': rec_id,
                    'entityType': 'exchange',
                    'schemaVersion': 3,
                    'scopeId': conditions.scope_id,
                    'createdAt': now_iso,
                    'updatedAt': now_iso,
                    'createdBy': conditions.user_id,
                    'updatedBy': conditions.user_id,
                    'version': 1,
                    'status': 'draft',
                    'participantUserIds': payload.get('participantUserIds', []),
                    'responsibleUserIds': payload.get('responsibleUserIds', [conditions.user_id]),
                }
                saved.update(payload)
                # Ensure server owned fields cannot be overwritten by client payload
                saved['id'] = rec_id
                saved['entityType'] = 'exchange'
                saved['schemaVersion'] = 3
                saved['scopeId'] = conditions.scope_id
                saved['status'] = 'draft'
                saved['version'] = 1
                saved['createdBy'] = conditions.user_id
                saved['updatedBy'] = conditions.user_id
            elif action == 'status':
                saved = copy.deepcopy(record)
                saved['updatedAt'] = now_iso
                saved['updatedBy'] = conditions.user_id
                saved['version'] = record.get('version', 1) + 1
                saved['status'] = payload['to']
                if 'reason' in payload:
                    saved['reason'] = payload['reason']
                if 'supportingInfo' in payload:
                    saved['supportingInfo'] = payload['supportingInfo']
            else:
                saved = copy.deepcopy(record)
                saved['updatedAt'] = now_iso
                saved['updatedBy'] = conditions.user_id
                saved['version'] = record.get('version', 1) + 1
                saved.update(payload)

            self.rows[(kind, saved['id'])] = copy.deepcopy(saved)
            self.writes += 1

            # 5. Cache Idempotency for Create
            if action == 'create' and idempotency_key:
                cache_key = (conditions.user_id, kind, conditions.parent_id, idempotency_key)
                self.idempotency_cache[cache_key] = (
                    copy.deepcopy(payload),
                    copy.deepcopy(saved),
                    self.clock(),
                )

            return copy.deepcopy(saved)

