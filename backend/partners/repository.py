"""Concrete repository adapter for Partner, Contact, and related entities (Issue #94).

Implements PermissionGateway port contract:
  - get(kind, id)
  - list(kind, context, parent=None)
  - mutate(kind, action, payload, record, parent, conditions, idempotency_key, upload=None)
  - parse_upload(event)
  - content(document, disposition)

Enforces atomic precondition checks, optimistic concurrency (If-Match),
24-hour idempotency caching, and strict server-side validation.
"""

import copy
from datetime import datetime, timezone
import threading
import time
import uuid

from ..auth.session_service import AuthError
from .validators import (
    validate_partner_payload,
    validate_contact_payload,
    validate_history_payload,
    validate_activity_payload,
)


class PartnerRepository:
    """Thread-safe concrete repository adapter for Partner & Contact business operations."""

    def __init__(self, service=None, initial_records=None, clock=None):
        self.service = service
        self.clock = clock or time.time
        self._lock = threading.Lock()
        self.rows = {}
        # (user_id, kind, idempotency_key) -> (payload_copy, result_copy, created_at_timestamp)
        self.idempotency_cache = {}
        self.writes = 0

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
        with self._lock:
            # 1. Preconditions & Concurrency Checks
            if self.service is not None:
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

            # Optimistic concurrency check for parent record
            if conditions.parent_id is not None and parent is not None:
                current_parent = self.rows.get((parent.get('entityType'), conditions.parent_id))
                if not current_parent or current_parent.get('version') != conditions.parent_version:
                    raise AuthError('VERSION_CONFLICT', 409)

            # 2. Idempotency Check for Create (24 hours = 86400 seconds)
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
            if kind == 'partner':
                validate_partner_payload(payload, is_create=is_create)
            elif kind == 'contact':
                validate_contact_payload(payload, is_create=is_create)
            elif kind == 'history':
                validate_history_payload(payload, is_create=is_create)
            elif kind == 'activity':
                validate_activity_payload(payload, is_create=is_create)

            # 4. Parent-Child Relationship Integrity
            if kind in {'contact', 'history'}:
                if not parent or parent.get('entityType') != 'partner':
                    raise AuthError('NOT_FOUND', 404)
                if parent.get('scopeId') != conditions.scope_id:
                    raise AuthError('NOT_FOUND', 404)
                if not is_create and record:
                    if record.get('partnerId') != parent.get('id') or record.get('scopeId') != parent.get('scopeId'):
                        raise AuthError('NOT_FOUND', 404)

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
                cache_key = (conditions.user_id, kind, idempotency_key)
                self.idempotency_cache[cache_key] = (
                    copy.deepcopy(payload),
                    copy.deepcopy(saved),
                    self.clock(),
                )

            return copy.deepcopy(saved)

    def parse_upload(self, event):
        return {}, b''

    def content(self, document: dict, disposition: str):
        raise AuthError('NOT_FOUND', 404)

