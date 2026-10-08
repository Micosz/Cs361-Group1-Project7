"""API Gateway HTTP API v2 transport. Never log request or cookie contents."""

import json
from .auth.session_service import AuthError, COOKIE_NAME, clear_cookie


def headers(event):
    return {k.lower(): v for k, v in event.get("headers", {}).items()}


def session_cookie(event):
    values = event.get("cookies")
    if values is None:
        values = [headers(event).get("cookie", "")]
    matches = []
    for value in values:
        for part in value.split(";"):
            key, sep, token = part.strip().partition("=")
            if sep and key == COOKIE_NAME:
                matches.append(token)
    if len(matches) > 1:
        raise AuthError("AUTH_REQUIRED")
    return matches[0] if matches else None


def response(status, body, cookie=None):
    result = {
        "statusCode": status,
        "headers": {"content-type": "application/json; charset=utf-8",
                    "cache-control": "no-store", "x-content-type-options": "nosniff"},
        "body": json.dumps(body, ensure_ascii=False),
    }
    if cookie is not None:
        result["cookies"] = [cookie]
    return result


def error_response(code, status, event):
    # Only an AWS-generated request ID is returned, never exception/request data.
    request_id = event.get("requestContext", {}).get("requestId", "")
    return response(status, {"error": {"code": code, "message": code},
                             "requestId": request_id},
                    clear_cookie() if status == 401 else None)


def handle(event, service, repository=None):
    try:
        if event.get("version") != "2.0":
            return error_response("UNSUPPORTED_EVENT", 400, event)
        method = event.get("requestContext", {}).get("http", {}).get("method")
        path = event.get("rawPath")
        if path not in {"/api/auth/session", "/api/auth/logout"}:
            from .permissions.gateway import PermissionGateway
            return PermissionGateway(service, repository).handle(event)
        expected = "GET" if path.endswith("session") else "POST"
        if method != expected:
            return error_response("METHOD_NOT_ALLOWED", 405, event)
        token = session_cookie(event)
        if method == "GET":
            cookie = None
            if token is None:
                issued = service.create_anonymous()
                token, cookie = issued.token, issued.cookie
            return response(200, service.state(token), cookie)
        request_headers = headers(event)
        service.logout(token, request_headers.get("origin"),
                       request_headers.get("x-csrf-token"))
        return response(200, {"ok": True}, clear_cookie())
    except AuthError as error:
        return error_response(error.code, error.status, event)
    except Exception:
        # Dependency/configuration failures cannot turn into anonymous success.
        return error_response("SESSION_UNAVAILABLE", 503, event)
