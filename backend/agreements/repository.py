"""In-memory Agreement repository adapter (Issue #98 / V3-B1).

Implements BusinessRepository interface for Agreement entity.
Enforces atomic preconditions, optimistic concurrency (If-Match),
24-hour Idempotency-Key caching, server-owned field defaults,
and scope/role boundaries.
"""

import copy
from datetime import datetime, timezone, timedelta
import threading
import time
import uuid

from ..auth.session_service import AuthError
from .validators import validate_agreement_payload, validate_agreement_status_transition


class AgreementRepository:
    """Agreement domain repository conforming to BusinessRepository protocol."""

    def __init__(self, service=None, initial_records=None, clock=None, partner_repo=None, user_store=None):
        self.service = service
        self.clock = clock or time.time
        self._lock = threading.RLock()
        self.rows = {}
        self.partner_repo = partner_repo
        self.user_store = user_store or {}
        # (user_id, kind, idempotency_key) -> (payload_copy, result_copy, created_at_timestamp)
        self.idempotency_cache = {}
        self.writes = 0

        if initial_records:
            for rec in initial_records:
                self.rows[(rec['entityType'], rec['id'])] = copy.deepcopy(rec)

    def _get_user(self, user_id: str):
        if user_id in self.user_store:
            return self.user_store[user_id]
        if not self.service:
            return None
        users = getattr(self.service, 'users', None)
        if users is None:
            return None
        if hasattr(users, 'get'):
            u = users.get(user_id)
            if u:
                return u
        if hasattr(users, 'store') and hasattr(users.store, 'user'):
            u = users.store.user(user_id)
            if u:
                return u
        user_prop = getattr(users, 'user', None)
        if user_prop and user_prop.user_id == user_id:
            return user_prop
        return None

    def _today_bangkok(self) -> str:
        tz_bkk = timezone(timedelta(hours=7))
        now_dt = datetime.fromtimestamp(self.clock(), tz=timezone.utc).astimezone(tz_bkk)
        return now_dt.strftime('%Y-%m-%d')

    def get(self, kind: str, key: str) -> dict | None:
        with self._lock:
            row = self.rows.get((kind, key))
            if row:
                return copy.deepcopy(row)
            if self.partner_repo and kind in {'partner', 'contact'}:
                return self.partner_repo.get(kind, key)
            return None


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
                results.append(copy.deepcopy(row))
        return results

    def mutate(self, kind: str, action: str, payload: dict, record: dict | None,
               parent: dict | None, conditions, idempotency_key: str | None,
               upload=None) -> dict:
        if kind != 'agreement' or action not in {'create', 'update', 'status'} or upload is not None:
            raise AuthError('PERMISSION_UNAVAILABLE', 503)

        with self._lock:
            # 1. Preconditions & Concurrency Checks
            if self.service is not None:
                user = self._get_user(conditions.user_id)
                if user is None:
                    user = getattr(self.service.users, 'user', None)
                    if user is None and hasattr(self.service.users, 'store'):
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

            # 2. Status Mutation (Issue #100)
            if action == 'status':
                if not record:
                    raise AuthError('NOT_FOUND', 404)
                today_str = self._today_bangkok()
                validate_agreement_status_transition(record, payload, today_str)

                now_iso = datetime.now(timezone.utc).isoformat()
                saved = copy.deepcopy(record)
                saved['status'] = payload['to']
                saved['updatedAt'] = now_iso
                saved['updatedBy'] = conditions.user_id
                saved['version'] = record.get('version', 1) + 1

                if 'endDate' in payload and payload['endDate'] is not None:
                    saved['endDate'] = payload['endDate']

                if 'renewalNote' in payload and payload['renewalNote'] is not None:
                    saved['renewalNote'] = payload['renewalNote']

                if 'reason' in payload and payload['reason'] is not None:
                    existing_internal = saved.get('internalNote') or ''
                    reason_entry = f"Status reason: {payload['reason'].strip()}"
                    saved['internalNote'] = f"{existing_internal}\n{reason_entry}".strip() if existing_internal else reason_entry

                self.rows[(kind, saved['id'])] = copy.deepcopy(saved)
                self.writes += 1
                return copy.deepcopy(saved)

            # 3. Idempotency Check for Create (24 hours = 86400 seconds)
            if action == 'create' and idempotency_key:
                cache_key = (conditions.user_id, kind, idempotency_key)
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
            validate_agreement_payload(payload, is_create=is_create)

            if not is_create and record:
                # Combined cross-field date validation on update
                start = payload.get('startDate', record.get('startDate'))
                end = payload.get('endDate', record.get('endDate'))
                if start is not None and end is not None and start > end:
                    raise AuthError('INVALID_FIELDS', 422)

            # Partner references validation (Issue #99)
            partner_ids = payload.get('partnerIds')
            if partner_ids is not None:
                for pid in partner_ids:
                    partner = self.get('partner', pid)
                    if not partner or partner.get('entityType') != 'partner':
                        raise AuthError('INVALID_REFERENCE', 422)
                    if partner.get('scopeId') != conditions.scope_id:
                        raise AuthError('INVALID_REFERENCE', 422)
                    caller = self._get_user(conditions.user_id)
                    if caller:
                        from ..auth.session_service import SessionContext
                        from ..permissions.policy import require_reference
                        caller_context = SessionContext(caller, self.clock())
                        require_reference(caller_context, partner, conditions.scope_id)

            # Assignee validation (Issue #99)
            resp_ids = payload.get('responsibleUserIds')
            if resp_ids is not None:
                for uid in resp_ids:
                    user = self._get_user(uid)
                    if not user:
                        raise AuthError('INVALID_REFERENCE', 422)
                    from ..permissions.policy import require_assignee
                    require_assignee(user, conditions.scope_id, participant=False)
            elif is_create:
                caller = self._get_user(conditions.user_id)
                if caller:
                    from ..permissions.policy import require_assignee
                    require_assignee(caller, conditions.scope_id, participant=False)

            # 4. Build and Persist Record
            now_iso = datetime.now(timezone.utc).isoformat()
            if is_create:
                rec_id = f"agreement-{uuid.uuid4().hex[:12]}"
                saved = {
                    'id': rec_id,
                    'entityType': 'agreement',
                    'schemaVersion': 3,
                    'scopeId': conditions.scope_id,
                    'status': 'draft',
                    'createdAt': now_iso,
                    'updatedAt': now_iso,
                    'createdBy': conditions.user_id,
                    'updatedBy': conditions.user_id,
                    'version': 1,
                    'startDate': None,
                    'endDate': None,
                    'renewalDueOn': None,
                    'renewalNote': None,
                    'internalNote': None,
                }
                # Coordinator create auto-assigns self; staff may specify or default to self
                if 'responsibleUserIds' in payload and payload['responsibleUserIds']:
                    saved['responsibleUserIds'] = list(payload['responsibleUserIds'])
                else:
                    saved['responsibleUserIds'] = [conditions.user_id]

                saved.update(payload)
                # Keep server-owned fields immutable
                saved['id'] = rec_id
                saved['entityType'] = 'agreement'
                saved['schemaVersion'] = 3
                saved['scopeId'] = conditions.scope_id
                saved['status'] = 'draft'
                saved['version'] = 1
                saved['createdBy'] = conditions.user_id
                saved['updatedBy'] = conditions.user_id
                saved['createdAt'] = now_iso
                saved['updatedAt'] = now_iso
            else:
                saved = copy.deepcopy(record)
                saved['updatedAt'] = now_iso
                saved['updatedBy'] = conditions.user_id
                saved['version'] = record.get('version', 1) + 1
                for k, v in payload.items():
                    if k not in {'id', 'entityType', 'schemaVersion', 'scopeId', 'createdBy', 'createdAt', 'status'}:
                        saved[k] = v

            self.rows[(kind, saved['id'])] = copy.deepcopy(saved)
            self.writes += 1

            # 5. Cache Idempotency for Create
            if action == 'create' and idempotency_key:
                cache_key = (conditions.user_id, kind, idempotency_key)
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

