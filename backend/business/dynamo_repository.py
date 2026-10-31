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
from ..permissions.policy import require_assignee, require_reference, allowed_roles, can_reference
from ..permissions.transactions import values, transaction_checks, target_condition
from ..agreements.repository import AgreementRepository
from ..partners.repository import PartnerRepository, ExchangeRepository, ActivityRepository
from ..document_links import document_record
from ..documents.uploads import parse_upload
from .validation import normalize_payload
from ..relationships.activity_links import plan_patch, LinkError


class DynamoBusinessRepository:
    def __init__(self, client, table, service, users, sessions, documents=None,
                 index='scope-entity-id', clock=time.time, partner_table=None):
        if not table or table in {users, sessions}:
            raise ValueError('Separate business table required')
        self.client, self.table, self.service = client, table, service
        self.users, self.sessions = users, sessions
        self.documents, self.index, self.clock = documents, index, clock
        if partner_table and partner_table in {users, sessions}:
            raise ValueError('Partner table must be separate from authentication')
        self.partner_table = partner_table

    def _table(self, kind=None):
        return self.partner_table if self.partner_table and kind in {'partner','activity'} else self.table

    def _key(self, kind, row):
        key = {'id':row['id']}
        if self.partner_table and kind in {'partner','activity'}:
            key['type'] = row['type']
        return values(key)

    def _read(self, key, kind=None):
        if self.partner_table and kind in {'partner','activity'}:
            rows, cursor = [], None
            while True:
                query = dict(TableName=self.partner_table, ConsistentRead=True,
                             KeyConditionExpression='#id = :id', ExpressionAttributeNames={'#id':'id'},
                             ExpressionAttributeValues=values({':id':key}))
                if cursor:
                    query['ExclusiveStartKey'] = cursor
                result = self.client.query(**query)
                rows.extend(decode(item) for item in result.get('Items',[]))
                cursor = result.get('LastEvaluatedKey')
                if not cursor:
                    break
            matches = [row for row in rows if row.get('entityType') == kind and row.get('source_state') != 'retired']
            if len(matches) > 1:
                raise AuthError('AMBIGUOUS_RECORD',409)
            return matches[0] if matches else None
        return decode(self.client.get_item(TableName=self.table, Key=values({'id': key}),
                                           ConsistentRead=True).get('Item'))

    def get(self, kind, key):
        row = self._read(key, kind) if isinstance(key, str) and key else None
        return row if row and row.get('entityType') == kind else None

    def list(self, kind, context, parent=None):
        rows = []
        scopes = {g['scopeId'] for g in context.user.permissions()[0]}
        if self.partner_table and kind in {'partner','activity'}:
            cursor = None
            while True:
                query = dict(TableName=self.partner_table, ConsistentRead=True,
                             FilterExpression='#kind = :kind',
                             ExpressionAttributeNames={'#kind':'entityType'},
                             ExpressionAttributeValues=values({':kind':kind}), ProjectionExpression='id')
                if cursor:
                    query['ExclusiveStartKey'] = cursor
                result = self.client.scan(**query)
                for item in result.get('Items', []):
                    row = self.get(kind, decode(item)['id'])
                    if row and row.get('scopeId') in scopes and not any(item['id']==row['id'] for item in rows):
                        rows.append(row)
                cursor = result.get('LastEvaluatedKey')
                if not cursor:
                    return rows
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
                    if parent and kind in {'document', 'feedback', 'formFeedback'} and (row.get('parentId') != parent['id'] or row.get('parentType') != parent['entityType']):
                        continue
                    if parent and kind in {'contact', 'history'} and row.get('partnerId') != parent['id']:
                        continue
                    rows.append(row)
                cursor = result.get('LastEvaluatedKey')
                if not cursor:
                    break
        return rows

    def public_agreements(self):
        from ..permissions.projections import public_projection
        rows, cursor = [], None
        while True:
            query = dict(TableName=self.table, ConsistentRead=True,
                         FilterExpression='#kind = :kind',
                         ExpressionAttributeNames={'#kind': 'entityType'},
                         ExpressionAttributeValues=values({':kind': 'agreement'}))
            if cursor:
                query['ExclusiveStartKey'] = cursor
            result = self.client.scan(**query)
            for item in result.get('Items', []):
                record = decode(item)
                if record.get('entityType') != 'agreement' or record.get('source_state') == 'retired':
                    continue
                projected = public_projection('agreement', record)
                if projected is not None:
                    rows.append(projected)
            cursor = result.get('LastEvaluatedKey')
            if not cursor:
                return rows

    def public_catalog(self):
        # Public reads never reuse editor projections, assignments or child records.
        from ..permissions.projections import public_projection
        rows, cursor = [], None
        while True:
            query = dict(TableName=self._table('partner'), ConsistentRead=True,
                         FilterExpression='#kind IN (:partner, :activity)',
                         ExpressionAttributeNames={'#kind': 'entityType'},
                         ExpressionAttributeValues=values({':partner': 'partner', ':activity': 'activity'}))
            if cursor:
                query['ExclusiveStartKey'] = cursor
            result = self.client.scan(**query)
            rows.extend(decode(item) for item in result.get('Items', []))
            cursor = result.get('LastEvaluatedKey')
            if not cursor:
                break
        rows = [row for row in rows if row.get('source_state') != 'retired']
        partners = {row['id']: row for row in rows if row.get('entityType') == 'partner'}
        catalog = []
        for row in rows:
            projected = public_projection(row.get('entityType'), row, partners)
            if projected is not None:
                projected['visibility'] = 'public'
                if row.get('legacySource') and row.get('entityType') == 'activity':
                    labels = row.get('co_hosts',[])
                    if isinstance(labels,list) and all(isinstance(label,str) for label in labels):
                        projected['co_hosts'] = list(labels)
                catalog.append(projected)
        return catalog

    def create_public_feedback(self, kind, key, payload, session_hash, idempotency_key):
        """Write-only public feedback; visibility and session are checked atomically."""
        import re
        from uuid import uuid4
        from ..permissions.projections import public_projection
        if kind not in {'partner', 'activity'} or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', key):
            raise AuthError('NOT_FOUND', 404)
        if (not isinstance(payload, dict) or set(payload) != {'respondentType', 'comment'}
                or not isinstance(payload['respondentType'], str)
                or payload['respondentType'] not in {'student', 'teacher', 'partner', 'participant', 'other'}
                or not isinstance(payload['comment'], str) or not 1 <= len(payload['comment'].strip()) <= 5000):
            raise AuthError('INVALID_FIELDS', 422)
        parent = self.get(kind, key)
        if not parent or not isinstance(parent.get('scopeId'), str) or not parent['scopeId'] or type(parent.get('version')) is not int:
            raise AuthError('NOT_FOUND', 404)
        partner = self.get('partner', parent.get('partnerId')) if kind == 'activity' else None
        partners = {partner['id']: partner} if partner else {}
        if public_projection(kind, parent, partners) is None:
            raise AuthError('NOT_FOUND', 404)
        now = int(self.clock())
        normalized = {'respondentType': payload['respondentType'], 'comment': payload['comment'].strip()}
        fingerprint = hashlib.sha256(json.dumps([kind, key, normalized], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        retry_id = 'public-feedback-retry-' + hashlib.sha256((session_hash + '\0' + idempotency_key).encode()).hexdigest()
        retry = self._read(retry_id)
        if retry and retry.get('expiresAt', 0) > now:
            if retry.get('fingerprint') != fingerprint:
                raise AuthError('IDEMPOTENCY_CONFLICT', 409)
            return
        timestamp = datetime.fromtimestamp(now, timezone.utc).isoformat()
        saved = {'id': 'feedback-' + uuid4().hex, 'entityType': 'feedback',
                 'scopeId': parent['scopeId'], 'scopeEntity': parent['scopeId'] + '#feedback',
                 'parentType': kind, 'parentId': key, 'occurredOn': timestamp[:10],
                 'sourceType': 'other', 'origin': 'web', **normalized,
                 'createdAt': timestamp, 'updatedAt': timestamp, 'createdBy': 'anonymous',
                 'updatedBy': 'anonymous', 'version': 1}
        checks = [{'ConditionCheck': {'TableName': self.sessions, 'Key': values({'tokenHash': session_hash}),
                   'ConditionExpression': '#e > :now AND #a > :now AND attribute_not_exists(#r)',
                   'ExpressionAttributeNames': {'#e': 'expiresAt', '#a': 'absoluteExpiresAt', '#r': 'revokedAt'},
                   'ExpressionAttributeValues': values({':now': now})}}]
        # A version check prevents an unpublished or reassigned record from racing the write.
        for item_kind, item in [(kind, parent)] + ([('partner', partner)] if partner else []):
            if type(item.get('version')) is not int or not item.get('scopeId'):
                raise AuthError('NOT_FOUND', 404)
            checks.append({'ConditionCheck': {'TableName': self._table(item_kind), 'Key': self._key(item_kind, item),
                'ConditionExpression': '#v = :v AND #s = :s',
                'ExpressionAttributeNames': {'#v': 'version', '#s': 'scopeId'},
                'ExpressionAttributeValues': values({':v': item['version'], ':s': item['scopeId']})}})
        checks.extend([{'Put': {'TableName': self.table, 'Item': values(saved),
                               'ConditionExpression': 'attribute_not_exists(id)'}},
                       {'Put': {'TableName': self.table, 'Item': values({'id': retry_id, 'entityType': 'idempotency',
                                'fingerprint': fingerprint, 'resultId': saved['id'], 'expiresAt': now + 86400, 'ttl': now + 86400}),
                                'ConditionExpression': 'attribute_not_exists(id) OR expiresAt <= :now',
                                'ExpressionAttributeValues': values({':now': now})}}])
        try:
            self.client.transact_write_items(TransactItems=checks)
        except Exception as error:
            retry = self._read(retry_id)
            if retry and retry.get('expiresAt', 0) > now:
                if retry.get('fingerprint') == fingerprint:
                    return
                raise AuthError('IDEMPOTENCY_CONFLICT', 409) from None
            if getattr(error, 'response', {}).get('Error', {}).get('Code') == 'TransactionCanceledException':
                raise AuthError('VERSION_CONFLICT', 409) from None
            raise

    def parse_upload(self, event):
        if self.documents is None:
            raise AuthError('DOCUMENT_STORAGE_UNAVAILABLE', 503)
        return parse_upload(event)

    def content(self, document, disposition):
        if self.documents is None:
            raise AuthError('DOCUMENT_STORAGE_UNAVAILABLE', 503)
        return self.documents.content(document, disposition)

    def mutate(self, kind, action, payload, record, parent, conditions, idempotency_key, upload=None):
        if action == 'delete' and kind == 'formFeedback':
            return self._delete_form_feedback(record, parent, conditions)
        if action == 'delete' and kind == 'contact':
            return self._delete_contact(record, parent, conditions)
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
        if kind == 'activity' and record:
            patch = {key: value for key, value in payload.items() if key in {'partnerId', 'coHostPartnerIds', 'agreementIds'}}
            if patch:
                def allowed(entity, action, row):
                    if action == 'change_public_links':
                        return bool(allowed_roles(context, 'activity', 'update', row) & {'staff', 'executive'})
                    if entity == 'partner' and action == 'read':
                        return can_reference(context, row, record['scopeId'])
                    return bool(allowed_roles(context, entity, action, row))
                try:
                    plan = plan_patch(record, patch, get_record=reference, allowed=allowed)
                    payload = dict(payload, **plan.changes)
                except LinkError as error:
                    raise AuthError(error.code, error.status) from None
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
        elif kind == 'formFeedback' and action == 'create':
            from ..form_feedback import form_record
            saved = form_record(context, payload, parent, now)
            if self.get(kind, saved['id']):
                raise AuthError('DUPLICATE_FORM_IMPORT', 409)
        elif kind == 'feedback' and action in {'create', 'update'}:
            from ..feedback import feedback_record
            saved = feedback_record(context, action, payload, record, parent, now)
        elif kind == 'document' and action == 'delete' and record and parent:
            # Logical removal is atomic with user/session/parent/version checks.
            # Bytes remain private in S3; deleted metadata cannot be read or streamed.
            saved = dict(record, uploadState='deleted', version=record['version'] + 1,
                         updatedAt=now, updatedBy=conditions.user_id, deletedAt=now)
        elif kind == 'document' and action == 'upload' and upload and parent:
            if not self.documents:
                raise AuthError('DOCUMENT_STORAGE_UNAVAILABLE', 503)
            saved = document_record(context, parent, payload, upload)
        else:
            raise AuthError('PERMISSION_UNAVAILABLE', 503)
        if self.partner_table and kind in {'partner','activity'}:
            # Preserve the public reader's field names and existing source metadata.
            aliases = {'fullDescription':'full_description', 'websiteUrl':'website_url', 'logoPath':'logo_path',
                       'periodText':'period', 'periodDate':'period_date', 'imagePath':'image_path'}
            for canonical, legacy in aliases.items():
                if canonical in saved:
                    saved[legacy] = saved[canonical]
            saved['visibility'] = saved.get('publication','internal')
            saved['access_level'] = saved['visibility']
            if kind == 'activity':
                if not record or saved['partnerId'] != record.get('partnerId') or 'partnerName' not in saved:
                    saved['partnerName'] = references[saved['partnerId']]['name']
                if not record or saved.get('coHostPartnerIds',[]) != record.get('coHostPartnerIds',[]):
                    saved['co_hosts'] = [references[key]['name'] for key in saved.get('coHostPartnerIds',[])]
        saved['scopeEntity'] = scope + '#' + kind
        checks = transaction_checks(conditions, user_table=self.users, session_table=self.sessions,
                                    business_table=self.table, now=now)
        if parent and conditions.parent_id is not None:
            for check in checks:
                item = check.get('ConditionCheck',{})
                if item.get('TableName') == self.table:
                    item['TableName'] = self._table(parent['entityType'])
                    item['Key'] = self._key(parent['entityType'],parent)
        for row in references.values():
            if row['id'] in {conditions.target_id, conditions.parent_id}:
                continue
            checks.append({'ConditionCheck': {'TableName': self._table(row['entityType']), 'Key': self._key(row['entityType'],row),
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
        put = {'TableName': self._table(kind), 'Item': values(saved)}
        if record and self.partner_table and kind in {'partner','activity'} and record['type'] != saved['type']:
            # A DynamoDB sort-key change is an atomic move, never an extra copy.
            remove = {'TableName':self.partner_table,'Key':self._key(kind,record)}
            remove.update(target_condition(conditions))
            checks.append({'Delete':remove})
            put['ConditionExpression'] = 'attribute_not_exists(id)'
        else:
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
                if kind == 'formFeedback' and current is not None:
                    raise AuthError('DUPLICATE_FORM_IMPORT', 409) from None
                raise AuthError('VERSION_CONFLICT', 409) from None
            raise
        return copy.deepcopy(saved)

    def _delete_contact(self, record, parent, conditions):
        """Delete one authorized contact atomically with actor/session/parent checks."""
        if (not record or record.get('entityType') != 'contact' or not parent
                or parent.get('entityType') != 'partner'
                or record.get('partnerId') != parent.get('id')):
            raise AuthError('NOT_FOUND', 404)
        now = int(self.clock())
        actor = self.service.users.get(conditions.user_id)
        if not actor or actor.authz_version != conditions.authz_version:
            raise AuthError('SESSION_REVOKED', 401)
        checks = transaction_checks(conditions, user_table=self.users, session_table=self.sessions,
                                    business_table=self.table, now=now)
        for check in checks:
            item = check.get('ConditionCheck', {})
            if item.get('TableName') == self.table and conditions.parent_id is not None:
                item['TableName'] = self._table(parent['entityType'])
                item['Key'] = self._key(parent['entityType'], parent)
        delete = {
            'TableName': self._table('contact'),
            'Key': self._key('contact', record),
            'ConditionExpression': '#v = :v AND #s = :scope AND #kind = :kind AND #parent = :parent',
            'ExpressionAttributeNames': {'#v': 'version', '#s': 'scopeId', '#kind': 'entityType', '#parent': 'partnerId'},
            'ExpressionAttributeValues': values({
                ':v': conditions.target_version, ':scope': conditions.scope_id,
                ':kind': 'contact', ':parent': parent['id'],
            }),
        }
        checks.append({'Delete': delete})
        if len(checks) > 100:
            raise AuthError('TOO_MANY_REFERENCES', 422)
        try:
            self.client.transact_write_items(TransactItems=checks)
        except Exception as error:
            code = getattr(error, 'response', {}).get('Error', {}).get('Code')
            if code == 'TransactionCanceledException':
                raise AuthError('VERSION_CONFLICT', 409) from None
            raise
        return copy.deepcopy(record)

    def _delete_form_feedback(self, record, parent, conditions):
        now = int(self.clock())
        actor = self.service.users.get(conditions.user_id)
        if not actor or actor.authz_version != conditions.authz_version:
            raise AuthError('SESSION_REVOKED', 401)
        from ..permissions.policy import require_record
        require_record(SessionContext(actor, now), 'formFeedback', 'delete', record, parent)
        checks = transaction_checks(conditions, user_table=self.users, session_table=self.sessions,
                                    business_table=self.table, now=now)
        for check in checks:
            item = check.get('ConditionCheck', {})
            if item.get('TableName') == self.table:
                item['TableName'] = self._table(parent['entityType'])
                item['Key'] = self._key(parent['entityType'], parent)
        delete = {'TableName': self.table, 'Key': self._key('formFeedback', record)}
        delete.update(target_condition(conditions))
        checks.append({'Delete': delete})
        try:
            self.client.transact_write_items(TransactItems=checks)
        except Exception as error:
            if getattr(error, 'response', {}).get('Error', {}).get('Code') == 'TransactionCanceledException':
                raise AuthError('VERSION_CONFLICT', 409) from None
            raise
        return copy.deepcopy(record)
