"""Document Storage & Upload Validation Module (Issue #101)

Key Requirements:
- Validate allowed extensions and MIME types.
- Inspect magic bytes (do not trust client MIME headers blindly).
- Server generates a unique storage key (UUID) to prevent name collision/overwriting.
- File size limit enforcement.
"""

import os
import uuid
import io
import zipfile
from typing import Tuple, Dict, Any

# Buffered Lambda responses have a 6 MB envelope; base64 and headers need room.
MAX_FILE_SIZE = min(int(os.environ.get("MAX_FILE_SIZE_BYTES", 3 * 1024 * 1024)), 3 * 1024 * 1024)
CONTENT_TYPES = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
                 "jpeg": "image/jpeg", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}

ALLOWED_EXTENSIONS = {"pdf", "docx", "png", "jpg", "jpeg"}
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "image/jpeg",
}

# Magic bytes signature for true content verification
MAGIC_NUMBERS = {
    "pdf": [b"%PDF"],
    "png": [b"\x89PNG\r\n\x1a\n"],
    "jpg": [b"\xff\xd8\xff"],
    "jpeg": [b"\xff\xd8\xff"],
    "docx": [b"PK\x03\x04"],  # ZIP container header for DOCX
}


def verify_magic_bytes(raw_bytes: bytes, ext: str) -> bool:
    """Verify that file header matches declared extension to prevent spoofing."""
    if not raw_bytes:
        return False
    signatures = MAGIC_NUMBERS.get(ext.lower(), [])
    if not any(raw_bytes.startswith(sig) for sig in signatures):
        return False
    if ext.lower() == 'docx':
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
                names = set(archive.namelist())
                return {'[Content_Types].xml', 'word/document.xml'} <= names and not any(
                    name.lower().endswith('vbaproject.bin') for name in names)
        except (zipfile.BadZipFile, ValueError):
            return False
    return True


def validate_file(filename: str, content_type: str, raw_bytes: bytes) -> Tuple[bool, str]:
    """Validate file extension, size, client MIME, and actual magic bytes."""
    if not filename or not isinstance(filename, str):
        return False, "INVALID_FILENAME"

    parts = filename.rsplit(".", 1)
    if len(parts) < 2:
        return False, "MISSING_EXTENSION"

    ext = parts[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return False, f"UNSUPPORTED_EXTENSION_{ext.upper()}"

    if not content_type or content_type.lower() != CONTENT_TYPES[ext]:
        return False, "UNSUPPORTED_CONTENT_TYPE"

    size = len(raw_bytes) if raw_bytes else 0
    if size <= 0:
        return False, "INVALID_FILE_SIZE"

    if size > MAX_FILE_SIZE:
        return False, "FILE_TOO_LARGE"

    if not verify_magic_bytes(raw_bytes, ext):
        return False, "CORRUPTED_OR_SPOOFED_FILE"

    return True, "OK"


def prepare_upload_record(metadata: Dict[str, Any], raw_bytes: bytes) -> Dict[str, Any]:
    """Validate upload and generate a collision-free server storage ID."""
    filename = metadata.get("fileName", "")
    content_type = metadata.get("contentType", "")

    valid, reason = validate_file(filename, content_type, raw_bytes)
    if not valid:
        raise ValueError(reason)

    ext = filename.rsplit(".", 1)[1].lower()
    # Server assigns a unique file key to prevent overwriting
    document_id = str(uuid.uuid4())
    storage_key = f"documents/{document_id}.{ext}"

    return {
        "documentId": document_id,
        "storageKey": storage_key,
        "originalFileName": filename,
        "contentType": content_type,
        "fileSize": len(raw_bytes),
        "status": "ready"
    }
