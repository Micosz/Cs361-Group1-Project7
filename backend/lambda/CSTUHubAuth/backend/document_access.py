import time
import re
from urllib.parse import urlsplit, parse_qs, urlencode
from typing import Dict, Any, Optional


class AuthenticationRequiredError(Exception):
    pass


class AccessDeniedError(Exception):
    pass


class DocumentNotFoundError(Exception):
    pass


class LinkExpiredError(Exception):
    pass


def generate_download_access(
    session: Optional[Dict[str, Any]],
    document_record: Optional[Dict[str, Any]],
    target_record: Optional[Dict[str, Any]],
    expires_in_seconds: int = 300
) -> Dict[str, Any]:
    if not session or not session.get("is_authenticated"):
        raise AuthenticationRequiredError("Authentication required to access document.")

    if not document_record:
        raise DocumentNotFoundError("Document record not found.")

    if not target_record:
        raise DocumentNotFoundError("Associated target record not found.")

    user_id = session.get("user_id")
    user_role = session.get("role", "user")
    owner_id = target_record.get("owner_id") or target_record.get("created_by")
    participants = target_record.get("participants", [])

    is_authorized = (
        user_role == "admin"
        or (owner_id and owner_id == user_id)
        or (user_id in participants)
    )

    if not is_authorized:
        raise AccessDeniedError("User does not have permission to access this document.")

    now = int(time.time())
    expires_at = now + expires_in_seconds
    # Every access uses the authenticated gateway stream; no bearer S3 URL.
    document_id = document_record.get('id') or document_record.get('link_id')
    if not isinstance(document_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', document_id):
        raise DocumentNotFoundError('Document ID required.')
    presigned_download_url = '/api/documents/' + document_id + '/content?disposition=attachment'

    return {
        "download_url": presigned_download_url,
        "expires_at": expires_at,
        "expires_in_seconds": expires_in_seconds,
        "file_name": document_record.get("file_name")
    }


def validate_access_link(
    token_url: str,
    current_session: Optional[Dict[str, Any]],
    current_time: Optional[int] = None
) -> bool:
    if not current_session or not current_session.get("is_authenticated"):
        raise AuthenticationRequiredError("Session has expired or logged out.")

    parsed = urlsplit(token_url)
    if parsed.scheme or parsed.netloc or not re.fullmatch(r'/api/documents/[A-Za-z0-9_-]{1,128}/content', parsed.path):
        raise LinkExpiredError('Invalid access URL format.')
    if parse_qs(parsed.query) != {'disposition': ['attachment']}:
        raise LinkExpiredError('Invalid access URL format.')
    # This only validates URL shape. PermissionGateway authorizes the actual GET
    # using current Session, record, parent, role and document audience.
    return True
