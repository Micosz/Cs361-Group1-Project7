"""Explicit local test double for AWS ports. No network or production credentials."""
import copy
import io
import re
import threading

from backend.auth.dynamo_accounts import decode
from backend.permissions.transactions import values


class ConditionalFailure(Exception):
    response = {'Error': {'Code': 'TransactionCanceledException'}}


class LocalDatabase:
    def __init__(self, accounts, sessions):
        self.accounts, self.sessions = accounts, sessions
        self.rows, self.lock = {}, threading.RLock()
        self.before_commit = None
        self.transactions = []

    def _row(self, table, key):
        if table == 'users':
            return self.accounts.rows.get(key)
        if table == 'sessions':
            return self.sessions.rows.get(key)
        return self.rows.get(key)

    def get_item(self, TableName, Key, **kwargs):
        key = next(iter(decode(Key).values()))
        row = self._row(TableName, key)
        return {'Item': values(copy.deepcopy(row))} if row else {}

    def query(self, **kwargs):
        partition = decode(kwargs['ExpressionAttributeValues'])[':partition']
        return {'Items': [values({'id': r['id']}) for r in self.rows.values() if r.get('scopeEntity') == partition]}

    def _condition(self, item):
        row = self._row(item['TableName'], next(iter(decode(item['Key'] if 'Key' in item else {'id': item['Item']['id']}).values()))) or {}
        expression = item.get('ConditionExpression', '')
        names = item.get('ExpressionAttributeNames', {})
        vals = decode(item.get('ExpressionAttributeValues', {})) or {}
        if expression == 'attribute_not_exists(id)':
            return not row
        if expression == 'attribute_not_exists(id) OR expiresAt <= :now':
            return not row or row['expiresAt'] <= vals[':now']
        for clause in expression.split(' AND '):
            missing = re.fullmatch(r'attribute_not_exists\(([^)]+)\)', clause)
            if missing:
                if names.get(missing[1], missing[1]) in row:
                    return False
                continue
            match = re.fullmatch(r'([#\w]+) (=|>) (:\w+)', clause)
            if not match:
                raise ValueError('Unsupported local condition: ' + clause)
            current = row.get(names.get(match[1], match[1]))
            expected = vals[match[3]]
            if current is None or (current != expected if match[2] == '=' else current <= expected):
                return False
        return True

    def transact_write_items(self, TransactItems):
        with self.lock:
            if self.before_commit:
                self.before_commit(); self.before_commit = None
            for operation in TransactItems:
                if not self._condition(next(iter(operation.values()))):
                    raise ConditionalFailure()
            for operation in TransactItems:
                if 'Put' in operation:
                    row = decode(operation['Put']['Item']); self.rows[row['id']] = row
            self.transactions.append(copy.deepcopy(TransactItems))
        return {}


class LocalObjects:
    def __init__(self):
        self.rows = {}

    def get_public_access_block(self, **kwargs):
        return {'PublicAccessBlockConfiguration': {name: True for name in (
            'BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets')}}

    def put_object(self, **kwargs):
        self.rows[kwargs['Key']] = kwargs['Body']

    def delete_object(self, **kwargs):
        self.rows.pop(kwargs['Key'], None)

    def get_object(self, **kwargs):
        return {'Body': io.BytesIO(self.rows[kwargs['Key']])}


def make_repository(service, accounts, sessions, seeds):
    from backend.business.dynamo_repository import DynamoBusinessRepository
    from backend.documents.storage import PrivateDocumentStorage
    database, objects = LocalDatabase(accounts, sessions), LocalObjects()
    for row in seeds:
        row = copy.deepcopy(row); row['scopeEntity'] = row['scopeId'] + '#' + row['entityType']
        database.rows[row['id']] = row
    return DynamoBusinessRepository(database, 'business', service, 'users', 'sessions',
        PrivateDocumentStorage(objects, 'local-documents')), database, objects
