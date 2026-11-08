"""Integration point for #79; business permission checks remain mandatory."""

from ..http_api import headers, session_cookie


def require_session(event, service):
    token = session_cookie(event)
    context = service.validate(token)
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    if method not in {"GET", "HEAD", "OPTIONS"}:
        request_headers = headers(event)
        service.check_csrf(token, request_headers.get("origin"),
                           request_headers.get("x-csrf-token"))
    return context
