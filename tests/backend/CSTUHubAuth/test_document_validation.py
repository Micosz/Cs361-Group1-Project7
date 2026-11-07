import unittest
import io
import zipfile
import base64
import json
from backend.documents.validation import validate_file, prepare_upload_record, MAX_FILE_SIZE


class TestDocumentValidation(unittest.TestCase):

    def test_valid_pdf_file(self):
        content = b"%PDF-1.4 mock content"
        valid, msg = validate_file("contract.pdf", "application/pdf", content)
        self.assertTrue(valid)
        self.assertEqual(msg, "OK")

    def test_valid_docx_file(self):
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types/>')
            archive.writestr('word/document.xml', '<document/>')
        content = buffer.getvalue()
        valid, msg = validate_file("mou_draft.docx", mime, content)
        self.assertTrue(valid)
        self.assertEqual(msg, "OK")

    def test_valid_image_file(self):
        content = b"\x89PNG\r\n\x1a\n mock image"
        valid, msg = validate_file("photo.png", "image/png", content)
        self.assertTrue(valid)
        self.assertEqual(msg, "OK")

    def test_reject_unsupported_extension(self):
        valid, msg = validate_file("malicious.exe", "application/x-msdownload", b"MZ mock")
        self.assertFalse(valid)
        self.assertEqual(msg, "UNSUPPORTED_EXTENSION_EXE")

    def test_reject_unsupported_content_type(self):
        valid, msg = validate_file("document.pdf", "text/plain", b"%PDF-1.4")
        self.assertFalse(valid)
        self.assertEqual(msg, "UNSUPPORTED_CONTENT_TYPE")

    def test_reject_spoofed_file(self):
        # หลอกว่าส่ง PDF แต่นัยน์เนื้อในไม่ใช่ magic bytes ของ PDF
        fake_content = b"plain text claiming to be pdf"
        valid, msg = validate_file("fake.pdf", "application/pdf", fake_content)
        self.assertFalse(valid)
        self.assertEqual(msg, "CORRUPTED_OR_SPOOFED_FILE")

    def test_reject_oversized_file(self):
        too_large = b"%PDF-1.4" + (b"0" * (MAX_FILE_SIZE + 1))
        valid, msg = validate_file("big.pdf", "application/pdf", too_large)
        self.assertFalse(valid)
        self.assertEqual(msg, "FILE_TOO_LARGE")

    def test_reject_empty_file(self):
        valid, msg = validate_file("empty.pdf", "application/pdf", b"")
        self.assertFalse(valid)
        self.assertEqual(msg, "INVALID_FILE_SIZE")

    def test_server_generates_unique_key_to_prevent_collision(self):
        meta = {"fileName": "report.pdf", "contentType": "application/pdf"}
        content = b"%PDF-1.4 valid file"
        record1 = prepare_upload_record(meta, content)
        record2 = prepare_upload_record(meta, content)

        # ต้องสร้าง Key ต่างกันแม้ชื่อไฟล์จะซ้ำกัน
        self.assertNotEqual(record1["documentId"], record2["documentId"])
        self.assertNotEqual(record1["storageKey"], record2["storageKey"])
        self.assertTrue(record1["storageKey"].startswith("documents/"))

    def test_reject_zip_header_as_docx(self):
        self.assertFalse(validate_file('fake.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', b'PK\x03\x04 not a document')[0])

    def test_upload_round_trip_and_unknown_fields(self):
        from backend.documents.uploads import parse_upload
        from backend.auth.session_service import AuthError
        data = dict(fileName='report.pdf', contentType='application/pdf', fileBase64=base64.b64encode(b'%PDF-1.4 test').decode())
        payload, upload = parse_upload({'body': json.dumps(data)})
        self.assertEqual(payload['displayName'], 'report.pdf')
        self.assertEqual(upload['bytes'], b'%PDF-1.4 test')
        with self.assertRaises(AuthError):
            parse_upload({'body': json.dumps(dict(data, scopeId='spoof'))})


if __name__ == "__main__":
    unittest.main()
