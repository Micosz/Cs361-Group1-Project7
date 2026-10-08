"""Lambda handler: backend.lambda_function.handler; no resources created here."""

import base64
from functools import lru_cache
import os
from .auth.session_service import SessionPolicy, SessionService
from .auth.session_store import DynamoSessionStore, DynamoUserReader
from .http_api import handle, error_response


@lru_cache(maxsize=1)
def build_service():
    import boto3
    session_table = os.environ["SESSION_TABLE"]
    user_table = os.environ["USER_TABLE"]
    if not session_table or not user_table or session_table == user_table:
        raise ValueError("Separate session/user tables required")
    policy = SessionPolicy(
        origin=os.environ["SESSION_ORIGIN"],
        csrf_secret=base64.b64decode(os.environ["SESSION_CSRF_SECRET"], validate=True),
    )
    database = boto3.resource("dynamodb", region_name=os.environ["AWS_REGION"])
    return SessionService(DynamoSessionStore(database.Table(session_table)),
                          DynamoUserReader(database.Table(user_table),
                              allow_course_tests=os.environ.get("COURSE_TEST_ENABLED") == "true"), policy)


@lru_cache(maxsize=1)
def build_application():
    import boto3
    from botocore.config import Config
    from .application import AuthApplication
    from .auth.accounts import AccountService
    from .auth.roles import RoleService
    from .auth.dynamo_accounts import DynamoAccounts, DynamoLoginLimiter
    from .auth.tu_provider import LambdaTuProvider
    from .auth.course_accounts import CourseProvider, CourseAccounts
    sessions = build_service()
    secret = base64.b64decode(os.environ['IDENTITY_HMAC_SECRET'], validate=True)
    db = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION'])
    store = DynamoAccounts(boto3.client('dynamodb', region_name=os.environ['AWS_REGION']), os.environ['USER_TABLE'],
                           os.environ['IDENTITY_TABLE'], os.environ['SESSION_TABLE'])
    # No SDK retry of a password invocation. The Node adapter has its own 8s deadline.
    client = boto3.client('lambda', region_name=os.environ['AWS_REGION'],
                          config=Config(connect_timeout=3, read_timeout=12, retries={'total_max_attempts': 1}))
    provider = CourseProvider(LambdaTuProvider(client, 'tuAuthLogin'),
        enabled=os.environ.get('COURSE_TEST_ENABLED') == 'true',
        configuration=os.environ.get('COURSE_TEST_ACCOUNTS', '[]'))
    accounts = CourseAccounts(AccountService(store, secret, os.environ['STUDENT_SCOPE_ID']), store)
    return AuthApplication(sessions, provider, accounts, RoleService(store),
        DynamoLoginLimiter(db.Table(os.environ['LOGIN_RATE_TABLE']), secret))


def handler(event, context):
    try:
        # HTTP API named stages appear in rawPath; route only the application path.
        stage = event.get('requestContext', {}).get('stage')
        prefix = '/' + stage + '/' if isinstance(stage, str) and stage != '$default' else None
        if prefix and event.get('rawPath', '').startswith(prefix):
            event = {**event, 'rawPath': event['rawPath'][len(prefix) - 1:]}
        # Preserve the standalone #78 handler contract; new orchestration requires
        # explicit deployment configuration and is never enabled by the frontend alone.
        if os.environ.get('AUTH_V3_ENABLED') == 'true':
            return build_application().handle(event)
        return handle(event, build_service())
    except Exception:
        return error_response("SESSION_UNAVAILABLE", 503, event)
