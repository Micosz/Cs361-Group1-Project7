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
                          DynamoUserReader(database.Table(user_table)), policy)


def handler(event, context):
    try:
        return handle(event, build_service())
    except Exception:
        return error_response("SESSION_UNAVAILABLE", 503, event)
