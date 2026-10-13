"""Durable shared adapter; existing feature repositories plan domain changes.

Domain repositories mutate request-local copies only. DynamoDB commits the result,
session, actor, target, parent, references and retry key in one transaction.
"""
import copy
from datetime import datetime, timezone
import hashlib
import json
from types import SimpleNamespace
import time

from ..auth.dynamo_accounts import decode
from ..auth.session_service import AuthError, SessionContext
from ..permissions.policy import require_assignee, require_reference
from ..permissions.transactions import values, transaction_checks, target_condition
from ..agreements.repository import AgreementRepository
from ..partners.repository import PartnerRepository, ExchangeRepository, ActivityRepository
from ..document_links import document_record
from ..documents.uploads import parse_upload
from .validation import normalize_payload


class DynamoBusinessRepository:
    def __init__(self, client, table, service, users, sessions, documents=None,
                 index='scope-entity-id', clock=time.time):
        if not table or table in {users, sessions}:
            raise ValueError('Separate business table required')
        self.client, self.table, self.service = client, table, service
        self.users, self.sessions = users, sessions
        self.documents, self.index, self.clock = documents, index, clock

    def _read(self, key):
        return decode(self.client.get_item(TableName=self.table, Key=values({'id': key}),
                                           ConsistentRead=True).get('Item'))

    def get(self, kind, key):
        row = self._read(key) if isinstance(key, str) and key else None
        return row if row and row.get('entityType') == kind else None

    def list(self, kind, context, parent=None):
        rows = []
        scopes = {g['scopeId'] for g in context.user.permissions()[0]}
        for scope in sorted(scopes):
            cursor = None
            while True:
                query = dict(TableName=self.table, IndexName=self.index,
                             KeyConditionExpression='#partition = :partition',
                             ExpressionAttributeNames={'#partition': 'scopeEntity'},
                             ExpressionAttributeValues=values({':partition': scope + '#' + kind}),
                             ProjectionExpression='id')
                if cursor:
                    query['ExclusiveStartKey'] = cursor
                result = self.client.query(**query)
                # GSI gives candidates only; current permissions use strong reads.
                for item in result.get('Items', []):
                    candidate = decode(item)
                    row = self.get(kind, candidate['id'])
                    if not row or row.get('scopeId') != scope:
                        continue
                    if parent and kind == 'document' and (row.get('parentId') != parent['id'] or row.get('parentType') != parent['entityType']):
                        continue
                    if parent and kind in {'contact', 'history'} and row.get('partnerId') != parent['id']:
                        continue
                    rows.append(row)
                cursor = result.get('LastEvaluatedKey')
                if not cursor:
                    break
        return rows

    def parse_upload(self, event):
        if self.documents is None:
            raise AuthError('DOCUMENT_STORAGE_UNAVAILABLE', 503)
        return parse_upload(event)

    def content(self, document, disposition):
        if self.documents is None:
            raise AuthError('DOCUMENT_STORAGE_UNAVAILABLE', 503)
        return self.documents.content(document, disposition)

    def mutate(self, kind, action, payload, record, parent, conditions, idempotency_key, upload=None):
        now = int(self.clock())
        actor = self.service.users.get(conditions.user_id)
        if not actor or actor.authz_version != conditions.authz_version:
            raise AuthError('SESSION_REVOKED', 401)
        context = SessionContext(actor, now)
        references, assignees = {}, {}

        def user(key):
            if key not in assignees:
                assignees[key] = self.service.users.get(key)
            return assignees[key]

        def reference(entity, key):
            row = self.get(entity, key)
            if row:
                references[row['id']] = row
            return row

        # A retry must refer to exactly the same validated submission and bytes.
        fingerprint = hashlib.sha256(json.dumps([kind, action, payload,
            hashlib.sha256(upload['bytes']).hexdigest() if upload else None],
            sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        retry_id = ('retry-' + hashlib.sha256(json.dumps([
            conditions.user_id, kind, conditions.parent_id, idempotency_key]).encode()).hexdigest()) if idempotency_key else None
        cached = self._read(retry_id) if retry_id else None
        if cached and cached.get('expiresAt', 0) > now:
            if cached['fingerprint'] != fingerprint:
                raise AuthError('IDEMPOTENCY_CONFLICT', 409)
            # Return current record, never a cached projection after reassignment.
            result = self.get(kind, cached['resultId'])
            if not result:
                raise AuthError('VERSION_CONFLICT', 409)
            return result

        if kind == 'history':
            payload = normalize_payload(kind, action, payload, record=record)
        effective = dict(record or {}, **payload)
        scope = conditions.scope_id
        ref_pairs = [('partner', key) for key in effective.get('partnerIds', [])]
        if kind == 'activity':
            ref_pairs += [('partner', effective.get('partnerId'))]
            ref_pairs += [('partner', key) for key in effective.get('coHostPartnerIds', [])]
            ref_pairs += [('agreement', key) for key in effective.get('agreementIds', [])]
        if kind == 'history' and effective.get('referenceType'):
            ref_pairs += [(effective['referenceType'], effective['referenceId'])]
        if kind == 'exchange' and effective.get('agreementId'):
            ref_pairs += [('agreement', effective['agreementId'])]
        for entity, key in ref_pairs:
            require_reference(context, reference(entity, key), scope)
        for field, participant in [('responsibleUserIds', False), ('participantUserIds', True)]:
            for key in effective.get(field, []):
                require_assignee(user(key), scope, participant=participant)

        local_service = SimpleNamespace(users=SimpleNamespace(user=user, get=user), store=self.service.store)
        seeds = list(references.values()) + ([record] if record else [])
        if kind == 'agreement':
            domain = AgreementRepository(local_service, seeds, clock=self.clock,
                partner_repo=SimpleNamespace(get=reference))
            saved = domain.mutate(kind, action, payload, record, parent, conditions, None)
        elif kind == 'exchange':
            domain = ExchangeRepository(local_service, seeds, clock=self.clock)
            saved = domain.mutate(kind, action, payload, record, parent, conditions, None)
        elif kind in {'partner', 'contact', 'history'}:
            normalized = normalize_payload(kind, action, payload, record=record)
            domain = PartnerRepository(local_service, seeds + ([parent] if parent else []), clock=self.clock)
            saved = domain.mutate(kind, action, normalized, record, parent, conditions, None)
        elif kind == 'activity' and action in {'create', 'update'}:
            normalized = normalize_payload(kind, action, payload, record=record)
            domain = ActivityRepository(local_service, seeds, clock=self.clock)
            saved = domain.mutate(kind, action, normalized, record, parent, conditions, None)
        elif kind == 'document' and action == 'upload' and upload and parent:
            if not self.documents:
                raise AuthError('DOCUMENT_STORAGE_UNAVAILABLE', 503)
            saved = document_record(context, parent, payload, upload)
        else:
            raise AuthError('PERMISSION_UNAVAILABLE', 503)
        saved['scopeEntity'] = scope + '#' + kind
        checks = transaction_checks(conditions, user_table=self.users, session_table=self.sessions,
                                    business_table=self.table, now=now)
        for row in references.values():
            if row['id'] in {conditions.target_id, conditions.parent_id}:
                continue
            checks.append({'ConditionCheck': {'TableName': self.table, 'Key': values({'id': row['id']}),
                'ConditionExpression': '#v = :v AND #s = :s AND #kind = :kind',
                'ExpressionAttributeNames': {'#v': 'version', '#s': 'scopeId', '#kind': 'entityType'},
                'ExpressionAttributeValues': values({':v': row['version'], ':s': scope, ':kind': row['entityType']})}})
        for key, state in assignees.items():
            if key == conditions.user_id:
                continue
            checks.append({'ConditionCheck': {'TableName': self.users, 'Key': values({'id': key}),
                'ConditionExpression': '#v = :v AND #a = :yes AND #i = :yes',
                'ExpressionAttributeNames': {'#v': 'authzVersion', '#a': 'active', '#i': 'identityVerified'},
                'ExpressionAttributeValues': values({':v': state.authz_version, ':yes': True})}})
        put = {'TableName': self.table, 'Item': values(saved)}
        put.update(target_condition(conditions) if record else {'ConditionExpression': 'attribute_not_exists(id)'})
        checks.append({'Put': put})
        if retry_id:
            checks.append({'Put': {'TableName': self.table,
                'Item': values(dict(id=retry_id, entityType='idempotency', fingerprint=fingerprint,
                                   resultId=saved['id'], expiresAt=now + 86400, ttl=now + 86400)),
                'ConditionExpression': 'attribute_not_exists(id) OR expiresAt <= :now',
                'ExpressionAttributeValues': values({':now': now})}})
        if len(checks) > 100:
            raise AuthError('TOO_MANY_REFERENCES', 422)
        stored = False
        try:
            if upload:
                self.documents.put(saved, upload['bytes'])
                stored = True
            self.client.transact_write_items(TransactItems=checks)
        except Exception as error:
            # Reconcile ambiguous timeouts before cleanup; never delete committed bytes.
            current = self.get(kind, saved['id'])
            if current == saved:
                return saved
            if stored and current is None:
                self.documents.delete(saved)
            code = getattr(error, 'response', {}).get('Error', {}).get('Code')
            if code == 'TransactionCanceledException':
                raise AuthError('VERSION_CONFLICT', 409) from None
            raise
        return copy.deepcopy(saved)
