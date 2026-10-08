#!/usr/bin/env python3
"""Explicit AWS-admin provisioning; dry-run by default. Never dumps user profiles."""
import argparse
from copy import deepcopy
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.auth.dynamo_accounts import DynamoAccounts
from backend.permissions.transactions import values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--user-id', required=True)
    parser.add_argument('--scope-id', required=True)
    parser.add_argument('--confirm-identity', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    import boto3
    store = DynamoAccounts(boto3.client('dynamodb'), os.environ['USER_TABLE'],
                           os.environ['IDENTITY_TABLE'], os.environ['SESSION_TABLE'])
    original = store.user(args.user_id)
    if not original or original.get('active') is not True or not original.get('subjectKey'):
        raise ValueError('Existing active TU-linked user required')
    if not original.get('identityVerified') and not args.confirm_identity:
        raise ValueError('Manual identity verification is required')
    if not args.scope_id.strip() or args.scope_id != args.scope_id.strip():
        raise ValueError('Confirmed scope required')
    updated = deepcopy(original)
    if any(c.get('name') == 'manageRoles' and c.get('scopeId') == args.scope_id
           and c.get('active') is True for c in updated.get('capabilities', [])):
        print('Capability already provisioned; no change')
        return
    updated['identityVerified'] = True
    updated['authzVersion'] += 1
    updated.setdefault('capabilities', []).append(
        dict(name='manageRoles', scopeId=args.scope_id, active=True))
    if not args.apply:
        print('Dry-run validated: would provision scoped manageRoles capability; no role added')
        return
    store.client.transact_write_items(TransactItems=[
        {'Put': {'TableName': store.users, 'Item': values(updated),
            'ConditionExpression': '#v = :v AND #a = :yes AND subjectKey = :subject',
            'ExpressionAttributeNames': {'#v': 'authzVersion', '#a': 'active'},
            'ExpressionAttributeValues': values({':v': original['authzVersion'], ':yes': True,
                                                 ':subject': original['subjectKey']})}},
        {'Update': {'TableName': store.identities,
            'Key': values({'subjectKey': original['subjectKey']}),
            'UpdateExpression': 'SET verification = :verified',
            'ConditionExpression': 'userId = :user AND provider = :provider',
            'ExpressionAttributeValues': values({':verified': 'verified', ':user': args.user_id,
                                                 ':provider': 'tu'})}}])
    print('Scoped manageRoles capability provisioned; old sessions invalidated')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Bootstrap failed; inspect configuration/permissions without dumping secrets', file=sys.stderr)
        sys.exit(1)
