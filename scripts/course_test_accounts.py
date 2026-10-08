#!/usr/bin/env python3
"""Generate private course account files; --apply provisions explicit existing tables."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import sys
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.auth.course_accounts import password_digest

CATALOG = [('student-a',['student']), ('student-b',['student']), ('coordinator',['coordinator']),
           ('staff',['staff']), ('executive',['executive']), ('employee',[]),
           ('manager',[]), ('multi',['student','coordinator'])]


def private_file(path, value):
    # Exclusive creation and mode 0600; never overwrite a password handoff silently.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output: output.write(value)


def generate(directory, scope):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if any((directory / f).exists() for f in ['accounts.tsv','manifest.json','lambda-env.json']):
        raise ValueError('Private files already exist; reuse them or choose a new directory')
    manifest, configuration, handoff = [], [], ['username\tpassword\troles\tuserId']
    now = datetime.now(timezone.utc).isoformat()
    for short, roles in CATALOG:
        username, user_id, password, salt = 'course.' + short, str(uuid.uuid4()), secrets.token_urlsafe(18), secrets.token_hex(16)
        subject = 'course-test:' + user_id
        user = dict(id=user_id, displayName='บัญชีทดสอบ ' + short, active=True, identityVerified=True,
            authzVersion=1, authProvider='course-test', subjectKey=subject, capabilities=[],
            grants=[dict(id=str(uuid.uuid4()),role=role,scopeId=scope,active=True,
                         grantedBy='system:course-test-setup',grantedAt=now) for role in roles])
        if short == 'manager': user['capabilities'] = [dict(name='manageRoles',scopeId=scope,active=True)]
        manifest.append(dict(user=user, identity=dict(subjectKey=subject,provider='course-test',userId=user_id,verification='verified')))
        configuration.append(dict(username=username,userId=user_id,salt=salt,passwordHash=password_digest(password,salt)))
        handoff.append(username+'\t'+password+'\t'+','.join(roles)+'\t'+user_id)
    private_file(directory / 'accounts.tsv', '\n'.join(handoff)+'\n')
    private_file(directory / 'manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    private_file(directory / 'lambda-env.json', json.dumps({'COURSE_TEST_ENABLED':'true',
        'COURSE_TEST_ACCOUNTS':json.dumps(configuration,separators=(',',':'))},indent=2))
    print('Created private account files. Passwords were not printed. No AWS changes.')


def apply(directory):
    import boto3
    from backend.permissions.transactions import values
    users, identities = os.environ['USER_TABLE'], os.environ['IDENTITY_TABLE']
    if not users or not identities or users == identities: raise ValueError('Separate existing tables required')
    rows = json.loads((directory / 'manifest.json').read_text())
    client = boto3.client('dynamodb')
    for row in rows:
        user, identity = row['user'], row['identity']
        if user.get('authProvider') != 'course-test' or identity.get('provider') != 'course-test':
            raise ValueError('Only course-test records may be provisioned')
        old = client.get_item(TableName=users,Key=values({'id':user['id']}),ConsistentRead=True).get('Item')
        link = client.get_item(TableName=identities,Key=values({'subjectKey':identity['subjectKey']}),ConsistentRead=True).get('Item')
        if old or link:
            if (old and link and old.get('authProvider')=={'S':'course-test'}
                    and old.get('subjectKey')=={'S':identity['subjectKey']}
                    and link.get('provider')=={'S':'course-test'} and link.get('userId')=={'S':user['id']}):
                continue  # Never restore withdrawn roles or disabled accounts on rerun.
            raise ValueError('Existing account/identity collision; no overwrite')
        client.transact_write_items(TransactItems=[
            {'Put':{'TableName':users,'Item':values(user),'ConditionExpression':'attribute_not_exists(id)'}},
            {'Put':{'TableName':identities,'Item':values(identity),'ConditionExpression':'attribute_not_exists(subjectKey)'}}])
    print('Course accounts provisioned; existing records left unchanged. Lambda config not modified.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,default=Path(__file__).resolve().parents[1]/'.course-test')
    parser.add_argument('--scope')
    parser.add_argument('--apply',action='store_true')
    args = parser.parse_args()
    if args.apply: apply(args.directory)
    else:
        import re
        if not args.scope or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',args.scope): parser.error('--scope required (confirmed scope ID)')
        generate(args.directory,args.scope)

if __name__ == '__main__':
    try: main()
    except Exception:
        print('Course account setup failed. Check configuration privately; no credentials printed.',file=sys.stderr)
        sys.exit(1)
