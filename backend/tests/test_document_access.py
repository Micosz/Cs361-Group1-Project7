import unittest
import time
from backend.document_access import (
    generate_download_access,
    validate_access_link,
    AuthenticationRequiredError,
    AccessDeniedError,
    DocumentNotFoundError,
    LinkExpiredError,
)

class TestDocumentAccess(unittest.TestCase):

    def setUp(self):
        self.doc_record = {
            "storage_key": "protected/agreements/agr_123/mou.pdf",
            "file_name": "mou.pdf"
        }
        self.target_record = {
            "id": "agr_123",
            "owner_id": "user_alice",
            "participants": ["user_bob"]
        }

    def test_authorized_user_can_generate_download_url(self):
        session = {"user_id": "user_alice", "is_authenticated": True, "role": "user"}
        result = generate_download_access(session, self.doc_record, self.target_record)
        self.assertIn("download_url", result)
        self.assertIn("token=", result["download_url"])
        self.assertIn("expires=", result["download_url"])

    def test_unauthenticated_user_denied(self):
        session = {"user_id": "anon", "is_authenticated": False}
        with self.assertRaises(AuthenticationRequiredError):
            generate_download_access(session, self.doc_record, self.target_record)

    def test_unauthorized_user_denied(self):
        session = {"user_id": "user_charlie", "is_authenticated": True, "role": "user"}
        with self.assertRaises(AccessDeniedError):
            generate_download_access(session, self.doc_record, self.target_record)

    def test_document_not_found(self):
        session = {"user_id": "user_alice", "is_authenticated": True, "role": "user"}
        with self.assertRaises(DocumentNotFoundError):
            generate_download_access(session, None, self.target_record)

    def test_validate_link_success(self):
        session = {"user_id": "user_alice", "is_authenticated": True}
        future_time = int(time.time()) + 300
        url = f"https://s3.amazonaws.com/testuiforcloud/file.pdf?token=abc&expires={future_time}"
        self.assertTrue(validate_access_link(url, session))

    def test_validate_link_expired(self):
        session = {"user_id": "user_alice", "is_authenticated": True}
        past_time = int(time.time()) - 10
        url = f"https://s3.amazonaws.com/testuiforcloud/file.pdf?token=abc&expires={past_time}"
        with self.assertRaises(LinkExpiredError):
            validate_access_link(url, session)
            
    def test_validate_link_logged_out_session(self):
        session = {"user_id": "user_alice", "is_authenticated": False}
        future_time = int(time.time()) + 300
        url = f"https://s3.amazonaws.com/testuiforcloud/file.pdf?token=abc&expires={future_time}"
        with self.assertRaises(AuthenticationRequiredError):
            validate_access_link(url, session)

if __name__ == "__main__":
    unittest.main()
import time
from backend.document_access import (
    generate_download_access,
    validate_access_link,
    AuthenticationRequiredError,
    AccessDeniedError,
    DocumentNotFoundError,
    LinkExpiredError,
)

class TestDocumentAccess(unittest.TestCase):

    def setUp(self):
        self.doc_record = {
            "storage_key": "protected/agreements/agr_123/mou.pdf",
            "file_name": "mou.pdf"
        }
        self.target_record = {
            "id": "agr_123",
            "owner_id": "user_alice",
            "participants": ["user_bob"]
        }

    def test_authorized_user_can_generate_download_url(self):
        session = {"user_id": "user_alice", "is_authenticated": True, "role": "user"}
        result = generate_download_access(session, self.doc_record, self.target_record)
        self.assertIn("download_url", result)
        self.assertIn("token=", result["download_url"])
        self.assertIn("expires=", result["download_url"])

    def test_unauthenticated_user_denied(self):
        session = {"user_id": "anon", "is_authenticated": False}
        with self.assertRaises(AuthenticationRequiredError):
            generate_download_access(session, self.doc_record, self.target_record)

    def test_unauthorized_user_denied(self):
        session = {"user_id": "user_charlie", "is_authenticated": True, "role": "user"}
        with self.assertRaises(AccessDeniedError):
            generate_download_access(session, self.doc_record, self.target_record)

    def test_document_not_found(self):
        session = {"user_id": "user_alice", "is_authenticated": True, "role": "user"}
        with self.assertRaises(DocumentNotFoundError):
            generate_download_access(session, None, self.target_record)

    def test_validate_link_success(self):
        session = {"user_id": "user_alice", "is_authenticated": True}
        future_time = int(time.time()) + 300
        url = f"https://s3.amazonaws.com/testuiforcloud/file.pdf?token=abc&expires={future_time}"
        self.assertTrue(validate_access_link(url, session))

    def test_validate_link_expired(self):
        session = {"user_id": "user_alice", "is_authenticated": True}
        past_time = int(time.time()) - 10
        url = f"https://s3.amazonaws.com/testuiforcloud/file.pdf?token=abc&expires={past_time}"
        with self.assertRaises(LinkExpiredError):
            validate_access_link(url, session)

    def test_validate_link_logged_out_session(self):
        session = {"user_id": "user_alice", "is_authenticated": False}
        future_time = int(time.time()) + 300
        url = f"https://s3.amazonaws.com/testuiforcloud/file.pdf?token=abc&expires={future_time}"
        with self.assertRaises(AuthenticationRequiredError):
            validate_access_link(url, session)

if __name__ == "__main__":
    unittest.main()