"""Seed and verify a Singapore CSTUHub trial using synthetic records only."""
import argparse
import base64
import getpass
import hashlib
import hmac
import http.cookiejar
import json
from pathlib import Path
import re
import secrets
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, HTTPCookieProcessor, Request, build_opener
import zipfile

import boto3
from botocore.exceptions import BotoCoreError, ClientError

REGION = 'ap-southeast-1'
DIRECT_ORIGIN = 'https://trial.cstuhub.invalid'
TRIAL_PATTERN = r'cstuhub-iac-[a-z0-9](?:[a-z0-9-]{0,16}[a-z0-9])?'
USERNAME = 'course.v5-smoke'
USER_ID = '4551ad71-509b-4ee0-a2b3-bf8d870811ac'
PUBLIC_PARTNER = 'v5-smoke-public'
INTERNAL_PARTNER = 'v5-smoke-internal'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def outputs(session, name):
    result = session.client('cloudformation').describe_stacks(StackName=name)
    return {row['OutputKey']: row['OutputValue'] for row in result['Stacks'][0]['Outputs']}


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600_000).hex()


def put_once(table, item):
    try:
        table.put_item(Item=item, ConditionExpression='attribute_not_exists(id)')
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        key = {field['AttributeName']: item[field['AttributeName']] for field in table.key_schema}
        if table.get_item(Key=key, ConsistentRead=True).get('Item') != item:
            raise ValueError('Trial fixture already exists with different values; choose a new trial name.') from None


def seed(session, trial, password, account):
    data = outputs(session, f'{trial}-data')
    if (data['UserTable'], data['PartnerTable']) != (f'{trial}-users', f'{trial}-partners'):
        raise ValueError('Unexpected data stack outputs.')
    bucket = f'{trial}-docs-{account}-{REGION}'
    if data['DocumentsBucket'] != bucket:
        raise ValueError('Unexpected document bucket output.')
    secret_id = f'{trial}/auth'
    secret_client = session.client('secretsmanager')
    salt = secrets.token_hex(16)
    entry = dict(username=USERNAME, userId=USER_ID, salt=salt, passwordHash=password_hash(password, salt))
    configuration = dict(
        sessionCsrf=base64.b64encode(secrets.token_bytes(32)).decode(),
        identityHmac=base64.b64encode(secrets.token_bytes(32)).decode(),
        courseAccounts=json.dumps([entry]),
    )
    try:
        result = secret_client.create_secret(Name=secret_id, SecretString=json.dumps(configuration))
    except secret_client.exceptions.ResourceExistsException:
        result = secret_client.get_secret_value(SecretId=secret_id)
        current = json.loads(json.loads(result['SecretString'])['courseAccounts'])
        if (len(current) != 1 or current[0]['username'] != USERNAME or current[0]['userId'] != USER_ID
                or not hmac.compare_digest(current[0]['passwordHash'], password_hash(password, current[0]['salt']))):
            raise ValueError('Existing trial secret has different fixtures; choose a new trial name.') from None

    dynamo = session.resource('dynamodb')
    put_once(dynamo.Table(data['UserTable']), dict(
        id=USER_ID, authProvider='course-test', displayName='V5 Smoke Student',
        identityVerified=True, active=True, authzVersion=1, capabilities=[],
        grants=[dict(id='v5-smoke-grant', role='student', scopeId='v5-trial', active=True)],
    ))
    partner_table = dynamo.Table(data['PartnerTable'])
    for identifier, name, visibility in (
            (PUBLIC_PARTNER, 'V5 Smoke Public Partner', 'public'),
            (INTERNAL_PARTNER, 'V5 Smoke Internal Partner', 'internal')):
        put_once(partner_table, dict(id=identifier, name=name, type='Company', entityType='partner',
                                     visibility=visibility, publication=visibility, access_level=visibility))
    storage = session.client('s3')
    try:
        storage.put_object(Bucket=bucket, Key='v5-smoke/retention.txt',
                           Body=b'CSTUHub V5 synthetic retention check\n',
                           ContentType='text/plain', ServerSideEncryption='AES256',
                           IfNoneMatch='*')
    except ClientError as error:
        if error.response['Error']['Code'] != 'PreconditionFailed':
            raise
    print(result['VersionId'])


def hosting(session, trial):
    frontend = outputs(session, f'{trial}-frontend')
    app = frontend['AppId']
    origin = frontend['Origin']
    if not re.fullmatch(r'd[a-z0-9]+', app) or origin != f'https://trial.{app}.amplifyapp.com':
        raise ValueError('Unexpected trial hosting outputs.')
    amplify = session.client('amplify')
    settings = amplify.get_app(appId=app)['app']
    if settings['name'] != f'{trial}-hosting' or settings.get('repository'):
        raise ValueError('Expected a dedicated Amplify app without a Git connection.')
    backend = outputs(session, f'{trial}-backend')['ApiEndpoint']
    rewrites = {rule['source']: rule['target'] for rule in settings.get('customRules', [])}
    if (not re.fullmatch(r'https://[a-z0-9]+\.execute-api\.ap-southeast-1\.amazonaws\.com/default', backend)
            or rewrites.get('/api/<*>') != f'{backend}/api/<*>'
            or rewrites.get('/fetchPartnersData') != f'{backend}/fetchPartnersData'):
        raise ValueError('Trial Amplify rewrites must point to the matching backend stack.')
    return amplify, app, origin


def publish(session, trial, archive):
    amplify, app, _ = hosting(session, trial)
    with zipfile.ZipFile(archive) as website:
        if website.testzip() is not None or 'index.html' not in website.namelist():
            raise ValueError('Expected a valid ZIP with index.html at its root.')
    job = amplify.create_deployment(appId=app, branchName='trial')
    request = Request(job['zipUploadUrl'], data=archive.read_bytes(), method='PUT')
    with build_opener(NoRedirect()).open(request, timeout=90):
        pass
    job_id = job['jobId']
    amplify.start_deployment(appId=app, branchName='trial', jobId=job_id)
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        status = amplify.get_job(appId=app, branchName='trial', jobId=job_id)['job']['summary']['status']
        if status == 'SUCCEED':
            print(f'Amplify trial job {job_id} SUCCEED')
            return
        if status in {'FAILED', 'CANCELLED'}:
            raise ValueError(f'Amplify trial job {job_id} {status}.')
        time.sleep(5)
    raise ValueError(f'Amplify trial job {job_id} is still running.')


def check_catalog(rows):
    if not isinstance(rows, list):
        raise ValueError('Expected a JSON array from the public catalog.')
    ids = {row['id'] for row in rows}
    if PUBLIC_PARTNER not in ids or INTERNAL_PARTNER in ids:
        raise ValueError('Expected the public fixture only.')


def invoke_json(lambdas, name, event):
    result = lambdas.invoke(FunctionName=name, Payload=json.dumps(event).encode())
    with result['Payload'] as payload:
        response = json.load(payload)
    if result.get('FunctionError'):
        raise ValueError('Trial Lambda invocation returned a function error.')
    return response['statusCode'], json.loads(response['body'])


def verify(session, trial, password, direct_api=False):
    if direct_api:
        endpoint = outputs(session, f'{trial}-backend')['ApiEndpoint']
        if not re.fullmatch(r'https://[a-z0-9]+\.execute-api\.ap-southeast-1\.amazonaws\.com/default', endpoint):
            raise ValueError('Unexpected trial API endpoint.')
        origin = DIRECT_ORIGIN
        transport = 'API Gateway'
    else:
        _, _, origin = hosting(session, trial)
        endpoint = origin
        transport = 'the Amplify rewrite'
    opener = build_opener(NoRedirect(), HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(path, data=None, csrf=None):
        headers = {'Cache-Control': 'no-cache'}
        if data is not None:
            headers.update({'Content-Type': 'application/json', 'Origin': origin, 'X-CSRF-Token': csrf})
        req = Request(endpoint + path, data=None if data is None else json.dumps(data).encode(), headers=headers)
        try:
            with opener.open(req, timeout=25) as result:
                media_type = result.headers.get_content_type()
                # The legacy catalog route returns JSON with a text/plain header.
                if media_type != 'application/json' and (path, media_type) != ('/fetchPartnersData', 'text/plain'):
                    raise ValueError(f'{path} returned a non-JSON response.')
                return json.load(result)
        except HTTPError as error:
            raise ValueError(f'{path} returned HTTP {error.code}.') from None

    check_catalog(request('/fetchPartnersData'))
    request('/api/public/records')
    target = outputs(session, f'{trial}-backend')['PublicFunctionName']
    if target != f'{trial}-getPublicPartners':
        raise ValueError('Unexpected public Lambda output.')
    lambdas = session.client('lambda')
    status, direct = invoke_json(lambdas, target, {})
    if status != 200:
        raise ValueError('Direct invocation of getPublicPartners failed.')
    check_catalog(direct)
    print(f'Catalog via {transport} and direct Lambda returned only the public fixture.')

    tu_event = dict(httpMethod='POST', body=json.dumps(dict(UserName='v5-fixture', PassWord='synthetic-only')))
    status, adapter = invoke_json(lambdas, f'{trial}-tuAuthLogin', tu_event)
    if status != 503 or adapter.get('code') != 'AUTH_CONFIGURATION_UNAVAILABLE':
        raise ValueError('Trial adapter did not confirm the expected disabled TU configuration.')
    print('Trial TU adapter returned the expected configuration error.')

    anonymous = request('/api/auth/session')
    login = request('/api/auth/login', {'username': USERNAME, 'password': password}, anonymous['csrfToken'])
    current = request('/api/auth/session')
    if (login.get('user') or {}).get('id') != USER_ID or (current.get('user') or {}).get('id') != USER_ID:
        raise ValueError('Trial login or session cookie verification failed.')
    request('/api/auth/logout', {}, current['csrfToken'])
    if request('/api/auth/session').get('user') is not None:
        raise ValueError('Trial logout left an authenticated session.')
    print(f'Synthetic login, session and logout passed through {transport}.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['seed', 'publish', 'verify'])
    parser.add_argument('trial')
    parser.add_argument('--profile', required=True)
    parser.add_argument('--account', required=True, help='Expected 12-digit AWS account ID')
    parser.add_argument('--password-file', type=Path, help='Optional local file outside the checkout')
    parser.add_argument('--direct-api', action='store_true', help='Verify an API-only trial without Amplify')
    parser.add_argument('--archive', type=Path, help='Static frontend ZIP for publish')
    args = parser.parse_args()
    if not re.fullmatch(TRIAL_PATTERN, args.trial) or not re.fullmatch(r'[0-9]{12}', args.account):
        parser.error('Expected a cstuhub-iac- trial name and a 12-digit account.')
    if args.direct_api and args.action != 'verify':
        parser.error('--direct-api is available only for verify.')
    if args.action == 'publish' and args.archive is None:
        parser.error('publish requires --archive.')

    session = boto3.Session(profile_name=args.profile, region_name=REGION)
    try:
        if session.client('sts').get_caller_identity()['Account'] != args.account:
            raise ValueError('Unexpected AWS account.')
        if args.action == 'publish':
            publish(session, args.trial, args.archive)
            return
        password = (args.password_file.read_text().rstrip('\r\n') if args.password_file
                    else getpass.getpass('Synthetic trial password: '))
        if not 12 <= len(password) <= 100:
            raise ValueError('Use a synthetic password of 12 to 100 characters.')
        if args.action == 'seed':
            seed(session, args.trial, password, args.account)
        else:
            verify(session, args.trial, password, args.direct_api)
    except ClientError as error:
        parser.exit(1, f'AWS operation failed: {error.response["Error"]["Code"]}\n')
    except BotoCoreError as error:
        parser.exit(1, f'AWS client could not complete the request: {type(error).__name__}\n')
    except HTTPError as error:
        parser.exit(1, f'Trial artifact upload returned HTTP {error.code}.\n')
    except URLError:
        parser.exit(1, 'Trial HTTPS request could not connect.\n')
    except (KeyError, OSError, ValueError, zipfile.BadZipFile) as error:
        message = str(error) if type(error) is ValueError else 'Invalid trial response or local input.'
        parser.exit(1, f'{message}\n')


if __name__ == '__main__':
    main()
