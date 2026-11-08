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

    if not target_record or target_record.get("id") != target_id:
        raise TargetNotFoundError(f"{target_type} with ID '{target_id}' not found.")

    user_id = user_context.get("user_id")
    user_role = user_context.get("role", "user")
    record_owner = target_record.get("owner_id") or target_record.get("created_by")

    is_authorized = (user_role == "admin") or (record_owner and record_owner == user_id)
    if not is_authorized:
        raise PermissionDeniedError(f"User {user_id} does not have permission to attach documents to this {target_type}.")

    # Accept the upload module's server-generated metadata without changing its API.
    upload_result = dict(upload_result)
    for legacy, current in {'storage_key': 'storageKey', 'file_name': 'originalFileName',
                            'file_size': 'fileSize', 'content_type': 'contentType'}.items():
        if legacy not in upload_result and current in upload_result:
            upload_result[legacy] = upload_result[current]
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


def document_record(context, parent, payload, upload, *, document_id=None, now=None):
    """Canonical #91 metadata for the authorized API; legacy helpers stay compatible.

    The repository persists this row together with user/session/parent checks.
    Never authorize a V3 request using the legacy owner/admin dictionaries above.
    """
    import hashlib
    from backend.permissions.policy import require_record
    from backend.auth.session_service import AuthError
    metadata, raw = upload['metadata'], upload['bytes']
    row = dict(id=document_id or metadata['documentId'], entityType='document', schemaVersion=3,
               scopeId=parent['scopeId'], parentType=parent['entityType'], parentId=parent['id'],
               version=1, displayName=payload['displayName'], audience=payload['audience'],
               containsPersonal=payload['containsPersonal'], mime=metadata['contentType'],
               size=metadata['fileSize'], objectKey=metadata['storageKey'],
               hash=hashlib.sha256(raw).hexdigest(), uploadState='ready',
               uploadedBy=context.user.user_id, uploadedAt=now or datetime.now(timezone.utc).isoformat())
    if not isinstance(row['displayName'], str) or not row['displayName'].strip() or len(row['displayName']) > 200:
        raise AuthError('INVALID_FIELDS', 422)
    require_record(context, 'document', 'upload', row, parent)
    row.update(createdAt=row['uploadedAt'], updatedAt=row['uploadedAt'],
               createdBy=context.user.user_id, updatedBy=context.user.user_id)
    return row
