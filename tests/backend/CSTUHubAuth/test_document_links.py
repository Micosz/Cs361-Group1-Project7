import unittest
from backend.document_links import (
    link_document_to_target,
    sanitize_document_for_viewer,
    TargetNotFoundError,
    PermissionDeniedError,
    InvalidPayloadError,
)

class TestDocumentLinks(unittest.TestCase):

    def setUp(self):
        self.valid_upload_result = {
            "storage_key": "protected/agreements/agr_123/doc_abc.pdf",
            "file_name": "mou_agreement.pdf",
            "file_size": 204800,
            "content_type": "application/pdf"
        }
        self.agreement_record = {
            "id": "agr_123",
            "title": "Exchange Partnership",
            "owner_id": "user_john",
            "status": "active"
        }

    def test_link_document_success(self):
        user = {"user_id": "user_john", "role": "user"}
        result = link_document_to_target(
            user_context=user,
            target_record=self.agreement_record,
            upload_result=self.valid_upload_result,
            target_type="agreement",
            target_id="agr_123"
        )
        self.assertEqual(result["target_id"], "agr_123")
        self.assertEqual(result["file_name"], "mou_agreement.pdf")
        self.assertEqual(result["uploaded_by"], "user_john")
        self.assertIn("storage_key", result)

    def test_link_document_target_not_found(self):
        user = {"user_id": "user_john", "role": "user"}
        with self.assertRaises(TargetNotFoundError):
            link_document_to_target(
                user_context=user,
                target_record=None,
                upload_result=self.valid_upload_result,
                target_type="agreement",
                target_id="agr_999"
            )

    def test_link_document_permission_denied(self):
        attacker = {"user_id": "user_hacker", "role": "user"}
        with self.assertRaises(PermissionDeniedError):
            link_document_to_target(
                user_context=attacker,
                target_record=self.agreement_record,
                upload_result=self.valid_upload_result,
                target_type="agreement",
                target_id="agr_123"
            )

    def test_link_document_missing_fields(self):
        user = {"user_id": "user_john", "role": "user"}
        incomplete_upload = {"file_name": "broken.pdf"}
        with self.assertRaises(InvalidPayloadError):
            link_document_to_target(
                user_context=user,
                target_record=self.agreement_record,
                upload_result=incomplete_upload,
                target_type="agreement",
                target_id="agr_123"
            )

    def test_sanitize_document_hides_storage_key(self):
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
        sanitized = sanitize_document_for_viewer(doc_record, user, self.agreement_record)
        self.assertIsNotNone(sanitized)
        self.assertNotIn("storage_key", sanitized)
        self.assertEqual(sanitized["file_name"], "doc.pdf")

    def test_sanitize_document_unauthorized_user(self):
        doc_record = {
            "link_id": "doc_001",
            "target_type": "agreement",
            "target_id": "agr_123",
            "file_name": "doc.pdf"
        }
        unauthorized_user = {"user_id": "stranger", "role": "user"}
        sanitized = sanitize_document_for_viewer(doc_record, unauthorized_user, self.agreement_record)
        self.assertIsNone(sanitized)
    def test_wrong_target_and_canonical_upload(self):
        user = {'user_id': 'user_john', 'role': 'user'}
        with self.assertRaises(TargetNotFoundError):
            link_document_to_target(user, self.agreement_record, self.valid_upload_result, 'agreement', 'other')
        upload = {'storageKey': 'documents/id.pdf', 'originalFileName': 'a.pdf', 'fileSize': 100, 'contentType': 'application/pdf'}
        result = link_document_to_target(user, self.agreement_record, upload, 'agreement', 'agr_123')
        self.assertEqual(result['storage_key'], 'documents/id.pdf')


if __name__ == "__main__":
    unittest.main()
