"""S3 bytes never pass through API Gateway; only this service signs requests."""
import re
import tempfile
from urllib.parse import quote

from ..auth.session_service import AuthError
from .storage import PrivateDocumentStorage
from .direct_validation import (DOCUMENT_LIMIT, IMAGE_LIMIT, SIGNATURE_TTL,
                                DOWNLOAD_TTL, validate_stream)


class DirectDocumentStorage(PrivateDocumentStorage):
    def __init__(self, client, bucket, *, enabled=False):
        super().__init__(client, bucket)
        self.direct_enabled = enabled

    def sign_upload(self, ticket, now):
        self._private()
        ttl = min(SIGNATURE_TTL, ticket['expiresAt'] - now)
        if ttl < 1:
            raise AuthError('UPLOAD_EXPIRED', 410)
        fields = {'Content-Type': ticket['mime'], 'x-amz-server-side-encryption': 'AES256',
                  'x-amz-meta-upload-id': ticket['id'], 'x-amz-meta-sha256': ticket['sha256']}
        conditions = [{key: value} for key, value in fields.items()]
        # Exact file size is enforced by S3 as well as during final validation.
        conditions.append(['content-length-range', ticket['size'], ticket['size']])
        return self.client.generate_presigned_post(Bucket=self.bucket, Key=ticket['stagingKey'],
            Fields=fields, Conditions=conditions, ExpiresIn=ttl)

    def verify_and_promote(self, ticket):
        self._private()
        head = self.client.head_object(Bucket=self.bucket, Key=ticket['stagingKey'])
        version = head.get('VersionId')
        if not version or version == 'null':
            raise AuthError('STORAGE_VERSIONING_REQUIRED', 503)
        if (head.get('ContentLength') != ticket['size'] or head.get('ContentType') != ticket['mime']
                or head.get('ServerSideEncryption') != 'AES256'
                or head.get('Metadata', {}).get('upload-id') != ticket['id']
                or head.get('Metadata', {}).get('sha256') != ticket['sha256']):
            raise AuthError('INVALID_UPLOAD', 422)
        # Pin the exact version inspected; a reusable POST cannot change it mid-check.
        result = self.client.get_object(Bucket=self.bucket, Key=ticket['stagingKey'], VersionId=version)
        with tempfile.TemporaryFile() as destination:
            validate_stream(result['Body'], destination, ticket)
        final_key = 'documents/ready/' + ticket['documentId'] + '-' + ticket['attempt'] + '.' + ticket['extension']
        copied = self.client.copy_object(Bucket=self.bucket, Key=final_key,
            CopySource={'Bucket': self.bucket, 'Key': ticket['stagingKey'], 'VersionId': version},
            MetadataDirective='REPLACE', Metadata={'upload-id': ticket['id'], 'sha256': ticket['sha256']},
            ContentType=ticket['mime'], ServerSideEncryption='AES256')
        if not copied.get('VersionId') or copied['VersionId'] == 'null':
            raise AuthError('STORAGE_VERSIONING_REQUIRED', 503)
        return final_key, copied['VersionId']

    def abandon(self, key):
        # A delete marker hides a failed unique candidate; lifecycle handles old versions.
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def content(self, document, disposition='attachment'):
        if not self.direct_enabled and document.get('storageMode') != 'direct':
            return super().content(document, disposition)
        self._private()
        limit = IMAGE_LIMIT if document.get('mime', '').startswith('image/') else DOCUMENT_LIMIT
        if document.get('uploadState') != 'ready' or not 0 < document.get('size', 0) <= limit:
            raise AuthError('NOT_FOUND', 404)
        key = document.get('objectKey', '')
        if not re.fullmatch(r'documents/[A-Za-z0-9_./-]+', key) or '..' in key.split('/'):
            raise AuthError('DOCUMENT_UNAVAILABLE', 503)
        params = dict(Bucket=self.bucket, Key=key,
                      ResponseContentType=document['mime'],
                      ResponseContentDisposition="attachment; filename*=UTF-8''" + quote(document['displayName'], safe=''),
                      ResponseCacheControl='no-store')
        if document.get('storageVersionId'):
            params['VersionId'] = document['storageVersionId']
        url = self.client.generate_presigned_url('get_object', Params=params, ExpiresIn=DOWNLOAD_TTL)
        return {'statusCode': 302, 'headers': {'location': url, 'cache-control': 'no-store',
                'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff'}, 'body': ''}
