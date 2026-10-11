import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional


class TargetNotFoundError(Exception):
    pass


class PermissionDeniedError(Exception):
    pass


class InvalidPayloadError(Exception):
    pass


def link_document_to_target(
    user_context: Dict[str, Any],
    target_record: Optional[Dict[str, Any]],
    upload_result: Dict[str, Any],
    target_type: str,
    target_id: str
) -> Dict[str, Any]:
    if target_type not in ["agreement", "exchange"]:
        raise InvalidPayloadError(f"Invalid target_type: {target_type}")

    if not target_id:
        raise InvalidPayloadError("target_id is required")

    if not target_record:
        raise TargetNotFoundError(f"{target_type} with ID '{target_id}' not found.")

    user_id = user_context.get("user_id")
    user_role = user_context.get("role", "user")
    record_owner = target_record.get("owner_id") or target_record.get("created_by")

    is_authorized = (user_role == "admin") or (record_owner and record_owner == user_id)
    if not is_authorized:
        raise PermissionDeniedError(f"User {user_id} does not have permission to attach documents to this {target_type}.")

    required_fields = ["storage_key", "file_name", "file_size", "content_type"]
    for field in required_fields:
        if not upload_result.get(field):
            raise InvalidPayloadError(f"Missing required upload field: {field}")

    link_id = f"doc_{uuid.uuid4().hex[:12]}"
    created_at = datetime.now(timezone.utc).isoformat()

    return {
        "link_id": link_id,
        "target_type": target_type,
        "target_id": target_id,
        "storage_key": upload_result["storage_key"],
        "file_name": upload_result["file_name"],
        "file_size": upload_result["file_size"],
        "content_type": upload_result["content_type"],
        "uploaded_by": user_id,
        "created_at": created_at
    }


def sanitize_document_for_viewer(
    document_record: Dict[str, Any],
    user_context: Dict[str, Any],
    target_record: Optional[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    if not target_record:
        return None

    user_id = user_context.get("user_id")
    user_role = user_context.get("role", "user")
    record_owner = target_record.get("owner_id") or target_record.get("created_by")

    has_view_access = (user_role == "admin") or (record_owner and record_owner == user_id)
    if not has_view_access:
        return None

    return {
        "link_id": document_record.get("link_id"),
        "target_type": document_record.get("target_type"),
        "target_id": document_record.get("target_id"),
        "file_name": document_record.get("file_name"),
        "file_size": document_record.get("file_size"),
        "content_type": document_record.get("content_type"),
        "uploaded_by": document_record.get("uploaded_by"),
        "created_at": document_record.get("created_at")
    }