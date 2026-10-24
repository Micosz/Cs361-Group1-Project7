"""Direct S3 contract tests with explicit AWS doubles, not deployment evidence."""
import hashlib
import io
import json
import unittest
import zipfile
from urllib.parse import urlsplit, parse_qsl

from backend.auth.session_service import COOKIE_NAME
from backend.documents.direct_storage import DirectDocumentStorage
from backend.documents.direct_validation import DOCUMENT_LIMIT, IMAGE_LIMIT
from support.mock_auth import make_app


class VersionedObjects:
    def __init__(self):
        self.objects, self.current, self.posts, self.copies, self.downloads, self.deleted = {}, {}, [], [], [], []
        self.after_copy = None
        self.before_read = None
        self.versioned = True
        self.read_sizes = []

    def get_public_access_block(self, **kwargs):
        return {'PublicAccessBlockConfiguration': {key: True for key in (
            'BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets')}}

    def generate_presigned_post(self, **kwargs):
        self.posts.append(kwargs)
        return {'url': 'https://test-bucket.s3.ap-southeast-2.amazonaws.com/',
                'fields': dict(kwargs['Fields'], key=kwargs['Key'], policy='unit-test-policy')}

    def upload(self, ticket, raw, version='source-v1'):
        key = ticket['stagingKey']
        self.objects[key, version] = dict(Body=raw, ContentLength=len(raw), ContentType=ticket['mime'],
            VersionId=version if self.versioned else None, ServerSideEncryption='AES256',
            Metadata={'upload-id': ticket['id'], 'sha256': ticket['sha256']})
        self.current[key] = version

    def head_object(self, **kwargs):
        key = kwargs['Key']
        if key not in self.current:
            from botocore.exceptions import ClientError
            raise ClientError({'Error': {'Code': '404'}}, 'HeadObject')
        return {k: v for k, v in self.objects[key, self.current[key]].items() if k != 'Body'}

    def get_object(self, **kwargs):
        if self.before_read:
            hook, self.before_read = self.before_read, None
            hook()
        raw = self.objects[kwargs['Key'], kwargs['VersionId']]['Body']
        sizes = self.read_sizes
        class Stream(io.BytesIO):
            def read(self, size=-1):
                if size < 0 or size > 65536:
                    raise AssertionError('Upload validation must use bounded reads')
                sizes.append(size)
                return super().read(size)
        return {'Body': Stream(raw)}

    def copy_object(self, **kwargs):
        source = kwargs['CopySource']
        raw = self.objects[source['Key'], source['VersionId']]['Body']
        version = 'ready-v' + str(len(self.copies) + 1)
        self.objects[kwargs['Key'], version] = {'Body': raw}
        self.current[kwargs['Key']] = version
        self.copies.append(kwargs)
        if self.after_copy:
            hook, self.after_copy = self.after_copy, None
            hook()
        return {'VersionId': version}

    def generate_presigned_url(self, operation, **kwargs):
        self.downloads.append((operation, kwargs))
        return 'https://test-bucket.s3.ap-southeast-2.amazonaws.com/file?test-only-signature=1'

    def delete_object(self, **kwargs):
        self.deleted.append(kwargs['Key'])


class DirectDocumentTests(unittest.TestCase):
    def setUp(self):
        self.app, catalog = make_app(8765, writable=True)
        self.ids = {entry['username']: entry['id'] for entry in catalog}
        self.repo = self.app.repository
        self.s3 = VersionedObjects()
        self.storage = DirectDocumentStorage(self.s3, 'test-bucket', enabled=True)
        self.repo.documents = self.storage
        self.actor = 'staff'
        result, body = self.call('/api/exchanges', 'POST', dict(title='Private upload fixture',
            scopeId='cs-demo', partnerIds=['partner-demo'], responsibleUserIds=[self.ids['coordinator']],
            participantUserIds=[self.ids['student-a']]))
        self.assertEqual(201, result['statusCode'], body)
        self.parent = body['data']
        self.path = '/api/exchanges/' + self.parent['id'] + '/document-uploads'

    def call(self, path, method='GET', data=None, key='direct-upload-request-00001', extra_headers=None):
        service = self.app.sessions
        issued = service._issue(service.users.get(self.ids[self.actor]))
        headers = {'origin': service.policy.origin, 'x-csrf-token': issued.csrf_token, 'idempotency-key': key}
        headers.update(extra_headers or {})
        parsed = urlsplit(path)
        event = dict(version='2.0', rawPath=parsed.path, requestContext={'requestId': 'test-request',
            'http': {'method': method}}, headers=headers, cookies=[COOKIE_NAME + '=' + issued.token],
            body=json.dumps(data or {}), queryStringParameters=dict(parse_qsl(parsed.query)))
        result = self.app.handle(event)
        return result, json.loads(result['body']) if result.get('body') else None

    def start(self, raw=b'%PDF-1.4 test', name='sample.pdf', **changes):
        mime = {'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg'}[name.rsplit('.', 1)[1]]
        data = dict(fileName=name, contentType=mime, size=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                    audience='internal', containsPersonal=False)
        data.update(changes)
        result, body = self.call(self.path, 'POST', data)
        return result, body

    def finish(self, raw=b'%PDF-1.4 test', name='sample.pdf', **changes):
        result, body = self.start(raw, name, **changes)
        self.assertEqual(201, result['statusCode'], body)
        ticket = self.repo.get('documentUpload', body['data']['uploadId'])
        self.s3.upload(ticket, raw)
        result, body = self.call('/api/document-uploads/' + ticket['id'] + '/complete', 'POST')
        return result, body, ticket

    def test_large_pdf_uploaded_without_api_binary_and_download_pins_verified_version(self):
        raw = b'%PDF-1.4\n' + b'x' * (23 * 1024 * 1024)
        result, body, ticket = self.finish(raw)
        self.assertEqual(200, result['statusCode'], body)
        document = body['data']['document']
        self.assertEqual(len(raw), document['size'])
        for secret in ['objectKey', 'storageVersionId', 'hash', 'stagingKey']:
            self.assertNotIn(secret, document)
        self.assertTrue(self.s3.read_sizes)
        result, _ = self.call('/api/documents/' + document['id'] + '/content')
        self.assertEqual(302, result['statusCode'])
        params = self.s3.downloads[-1][1]
        self.assertEqual(120, params['ExpiresIn'])
        self.assertEqual('ready-v1', params['Params']['VersionId'])
        self.assertEqual('no-store', result['headers']['cache-control'])

    def test_policy_has_exact_size_expiry_encryption_and_no_public_acl(self):
        result, body = self.start()
        self.assertEqual(201, result['statusCode'])
        policy = self.s3.posts[-1]
        self.assertIn(['content-length-range', 13, 13], policy['Conditions'])
        self.assertEqual(300, policy['ExpiresIn'])
        self.assertEqual('AES256', policy['Fields']['x-amz-server-side-encryption'])
        self.assertNotIn('acl', policy['Fields'])
        self.assertTrue(policy['Key'].startswith('documents/staging/upload-'))
        self.assertNotIn('stagingKey', body['data'])

    def test_all_types_including_jpeg_alias_publish(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types/>')
            archive.writestr('word/document.xml', '<document/>')
        for name, raw in [('a.docx', buffer.getvalue()), ('a.png', b'\x89PNG\r\n\x1a\ncontent'),
                          ('a.jpg', b'\xff\xd8\xffcontent'), ('a.jpeg', b'\xff\xd8\xffcontent')]:
            with self.subTest(name=name):
                self.setUp()
                result, body, _ = self.finish(raw, name)
                self.assertEqual(200, result['statusCode'], body)

    def test_signing_budget_and_final_expiry_fail_closed(self):
        _, body = self.start()
        budget = next(row for row in self.repo.client.rows.values() if row.get('entityType') == 'uploadBudget')
        budget['count'] = 20
        meta = dict(fileName='another.pdf', contentType='application/pdf', size=5, sha256='a' * 64)
        self.assertEqual(429, self.call(self.path, 'POST', meta, key='different-budget-request-001')[0]['statusCode'])
        ticket = self.repo.get('documentUpload', body['data']['uploadId'])
        self.s3.upload(ticket, b'%PDF-1.4 test')
        self.s3.after_copy = lambda: setattr(self.repo, 'clock', lambda: ticket['expiresAt'] + 1)
        result, _ = self.call('/api/document-uploads/' + ticket['id'] + '/complete', 'POST')
        self.assertEqual(409, result['statusCode'])
        self.assertIsNone(self.repo.get('document', ticket['documentId']))

    def test_bad_checksum_never_publishes(self):
        result, body, ticket = self.finish(sha256='0' * 64)
        self.assertEqual(422, result['statusCode'])
        self.assertEqual('CHECKSUM_MISMATCH', body['error']['code'])
        self.assertEqual('failed', self.repo.get('documentUpload', ticket['id'])['state'])
        self.assertFalse(self.s3.copies)
        self.assertIsNone(self.repo.get('document', ticket['documentId']))

    def test_missing_versioning_fails_closed(self):
        self.s3.versioned = False
        result, body, ticket = self.finish()
        self.assertEqual(503, result['statusCode'])
        self.assertEqual('STORAGE_VERSIONING_REQUIRED', body['error']['code'])
        self.assertIsNone(self.repo.get('document', ticket['documentId']))

    def test_staging_overwrite_during_validation_cannot_swap_verified_bytes(self):
        result, body = self.start()
        ticket = self.repo.get('documentUpload', body['data']['uploadId'])
        self.s3.upload(ticket, b'%PDF-1.4 test')
        self.s3.before_read = lambda: self.s3.upload(ticket, b'%PDF-evil different bytes', version='attacker-v2')
        result, body = self.call('/api/document-uploads/' + ticket['id'] + '/complete', 'POST')
        self.assertEqual(200, result['statusCode'], body)
        self.assertEqual('source-v1', self.s3.copies[-1]['CopySource']['VersionId'])

    def test_repeated_start_and_complete_are_idempotent(self):
        result, body, ticket = self.finish()
        self.assertEqual(200, result['statusCode'])
        result, again = self.start()
        self.assertEqual(ticket['id'], again['data']['uploadId'])
        self.assertEqual('ready', again['data']['state'])
        result, again = self.call('/api/document-uploads/' + ticket['id'] + '/complete', 'POST')
        self.assertEqual(200, result['statusCode'])
        self.assertEqual(1, len(self.s3.copies))
        self.assertEqual(409, self.start(displayName='changed.pdf')[0]['statusCode'])

    def test_missing_object_can_be_retried_without_duplicate_ticket(self):
        _, body = self.start()
        ticket = self.repo.get('documentUpload', body['data']['uploadId'])
        path = '/api/document-uploads/' + ticket['id'] + '/complete'
        result, body = self.call(path, 'POST')
        self.assertEqual('UPLOAD_NOT_RECEIVED', body['error']['code'])
        self.s3.upload(ticket, b'%PDF-1.4 test')
        self.assertEqual(200, self.call(path, 'POST')[0]['statusCode'])

    def test_roles_owner_csrf_and_input_injection(self):
        for actor in ['student-a', 'executive', 'employee']:
            self.actor = actor
            self.assertNotEqual(201, self.start()[0]['statusCode'])
        self.actor = 'staff'
        self.assertEqual(403, self.call(self.path, 'POST', {}, extra_headers={'x-csrf-token': ''})[0]['statusCode'])
        self.assertEqual(422, self.start(objectKey='documents/another-user.pdf')[0]['statusCode'])
        _, body = self.start()
        self.actor = 'coordinator'
        self.assertEqual(404, self.call('/api/document-uploads/' + body['data']['uploadId'])[0]['statusCode'])

    def test_role_withdrawal_after_s3_io_prevents_publish_and_hides_candidate(self):
        def revoke():
            self.repo.client.accounts.rows[self.ids['staff']]['authzVersion'] += 1
        self.s3.after_copy = revoke
        result, body, ticket = self.finish()
        self.assertEqual(401, result['statusCode'], body)
        self.assertIsNone(self.repo.get('document', ticket['documentId']))
        self.assertEqual(1, len(self.s3.deleted))

    def test_parent_version_race_prevents_publish(self):
        def race():
            self.repo.client.before_commit = lambda: self.repo.client.rows[self.parent['id']].update(version=2)
        self.s3.after_copy = race
        result, body, ticket = self.finish()
        self.assertEqual(409, result['statusCode'], body)
        self.assertIsNone(self.repo.get('document', ticket['documentId']))

    def test_expired_ticket_and_size_limits(self):
        self.assertEqual(413, self.start(size=DOCUMENT_LIMIT + 1)[0]['statusCode'])
        self.assertEqual(413, self.start(b'\x89PNG\r\n\x1a\n', 'a.png', size=IMAGE_LIMIT + 1)[0]['statusCode'])
        _, body = self.start()
        ticket = self.repo.get('documentUpload', body['data']['uploadId'])
        self.repo.clock = lambda: ticket['expiresAt'] + 1
        self.assertEqual(410, self.call('/api/document-uploads/' + ticket['id'] + '/complete', 'POST')[0]['statusCode'])

    def test_spoofed_docx_macro_and_signature_are_not_ready(self):
        result, _, ticket = self.finish(b'not a PDF', 'a.pdf')
        self.assertEqual(422, result['statusCode'])
        self.assertIsNone(self.repo.get('document', ticket['documentId']))
        self.setUp()
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types/>')
            archive.writestr('word/document.xml', '<document/>')
            archive.writestr('word/vbaProject.bin', b'macro')
        self.assertEqual(422, self.finish(buffer.getvalue(), 'a.docx')[0]['statusCode'])

    def test_existing_permissions_control_signed_download_and_flag_rollback(self):
        result, body, _ = self.finish(audience='participants', containsPersonal=True)
        document = body['data']['document']
        self.actor = 'student-a'
        self.assertEqual(302, self.call('/api/documents/' + document['id'] + '/content')[0]['statusCode'])
        self.actor = 'student-b'
        self.assertEqual(404, self.call('/api/documents/' + document['id'] + '/content')[0]['statusCode'])
        self.actor = 'staff'
        self.storage.direct_enabled = False
        self.assertEqual(404, self.call('/api/documents/config')[0]['statusCode'])
        self.assertEqual(302, self.call('/api/documents/' + document['id'] + '/content')[0]['statusCode'])


if __name__ == '__main__':
    unittest.main()
