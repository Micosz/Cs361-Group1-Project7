import time
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
    storage_key = document_record["storage_key"]
    token = f"auth_token_{user_id}_{expires_at}"

    presigned_download_url = (
        f"https://s3.amazonaws.com/testuiforcloud/{storage_key}?token={token}&expires={expires_at}"
    )

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

    if "expires=" not in token_url:
        raise LinkExpiredError("Invalid access URL format.")

    try:
        expires_param = int(token_url.split("expires=")[1].split("&")[0])
    except (ValueError, IndexError):
        raise LinkExpiredError("Invalid expiration in URL.")

    check_time = current_time if current_time is not None else int(time.time())
    if check_time > expires_param:
        raise LinkExpiredError("The download link has expired.")

    return True