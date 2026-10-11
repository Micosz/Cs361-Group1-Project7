import pytest
from backend.document_links import (
    link_document_to_target,
    sanitize_document_for_viewer,
    TargetNotFoundError,
    PermissionDeniedError,
    InvalidPayloadError,
)

@pytest.fixture
def valid_upload_result():
    return {
        "storage_key": "protected/agreements/agr_123/doc_abc.pdf",
        "file_name": "mou_agreement.pdf",
        "file_size": 204800,
        "content_type": "application/pdf"
    }

@pytest.fixture
def agreement_record():
    return {
        "id": "agr_123",
        "title": "Exchange Partnership",
        "owner_id": "user_john",
        "status": "active"
    }

def test_link_document_success(valid_upload_result, agreement_record):
    user = {"user_id": "user_john", "role": "user"}
    result = link_document_to_target(
        user_context=user,
        target_record=agreement_record,
        upload_result=valid_upload_result,
        target_type="agreement",
        target_id="agr_123"
    )
    assert result["target_id"] == "agr_123"
    assert result["file_name"] == "mou_agreement.pdf"
    assert result["uploaded_by"] == "user_john"
    assert "storage_key" in result

def test_link_document_target_not_found(valid_upload_result):
    user = {"user_id": "user_john", "role": "user"}
    with pytest.raises(TargetNotFoundError):
        link_document_to_target(
            user_context=user,
            target_record=None,
            upload_result=valid_upload_result,
            target_type="agreement",
            target_id="agr_999"
        )

def test_link_document_permission_denied(valid_upload_result, agreement_record):
    attacker = {"user_id": "user_hacker", "role": "user"}
    with pytest.raises(PermissionDeniedError):
        link_document_to_target(
            user_context=attacker,
            target_record=agreement_record,
            upload_result=valid_upload_result,
            target_type="agreement",
            target_id="agr_123"
        )

def test_link_document_missing_fields(agreement_record):
    user = {"user_id": "user_john", "role": "user"}
    incomplete_upload = {"file_name": "broken.pdf"}
    with pytest.raises(InvalidPayloadError):
        link_document_to_target(
            user_context=user,
            target_record=agreement_record,
            upload_result=incomplete_upload,
            target_type="agreement",
            target_id="agr_123"
        )

def test_sanitize_document_hides_storage_key(valid_upload_result, agreement_record):
    doc_record = {
        "link_id": "doc_001",
        "target_type": "agreement",
        "target_id": "agr_123",
        "storage_key": "secret/path/to/doc.pdf",
        "file_name": "doc.pdf",
        "file_size": 1024,
        "content_type": "application/pdf",
        "uploaded_by": "user_john",
        "created_at": "2026-10-12T00:00:00Z"
    }
    user = {"user_id": "user_john", "role": "user"}
    sanitized = sanitize_document_for_viewer(doc_record, user, agreement_record)
    assert sanitized is not None
    assert "storage_key" not in sanitized
    assert sanitized["file_name"] == "doc.pdf"

def test_sanitize_document_unauthorized_user(agreement_record):
    doc_record = {
        "link_id": "doc_001",
        "target_type": "agreement",
        "target_id": "agr_123",
        "file_name": "doc.pdf"
    }
    unauthorized_user = {"user_id": "stranger", "role": "user"}
    sanitized = sanitize_document_for_viewer(doc_record, unauthorized_user, agreement_record)
    assert sanitized is None