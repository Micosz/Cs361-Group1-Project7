"""Private S3 content, streamed only after PermissionGateway authorizes metadata."""
import base64
from urllib.parse import quote

from ..auth.session_service import AuthError
from .validation import MAX_FILE_SIZE


class PrivateDocumentStorage:
    def __init__(self, client, bucket):
        if not bucket:
            raise ValueError('Private document bucket required')
        self.client, self.bucket = client, bucket
        self._checked = False

    def _private(self):
        if not self._checked:
            block = self.client.get_public_access_block(Bucket=self.bucket)['PublicAccessBlockConfiguration']
            if not all(block.get(key) is True for key in (
                    'BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets')):
                raise AuthError('PRIVATE_STORAGE_REQUIRED', 503)
            self._checked = True

    def put(self, document, raw):
        self._private()
        self.client.put_object(Bucket=self.bucket, Key=document['objectKey'], Body=raw,
                               ContentType=document['mime'], ServerSideEncryption='AES256')

    def delete(self, document):
        self.client.delete_object(Bucket=self.bucket, Key=document['objectKey'])

    def content(self, document, disposition='attachment'):
        self._private()
        if document.get('uploadState') != 'ready' or not 0 < document.get('size', 0) <= MAX_FILE_SIZE:
            raise AuthError('NOT_FOUND', 404)
        result = self.client.get_object(Bucket=self.bucket, Key=document['objectKey'])
        stream = result['Body']
        try:
            raw = stream.read(MAX_FILE_SIZE + 1)
        finally:
            stream.close()
        if len(raw) != document['size']:
            raise AuthError('DOCUMENT_UNAVAILABLE', 503)
        import hashlib
        if hashlib.sha256(raw).hexdigest() != document.get('hash'):
            raise AuthError('DOCUMENT_UNAVAILABLE', 503)
        filename = quote(document['displayName'], safe='')
        # Download all uploaded content as an attachment, avoiding active content.
        return {'statusCode': 200, 'isBase64Encoded': True,
                'body': base64.b64encode(raw).decode(), 'headers': {
                    'content-type': document['mime'],
                    'content-disposition': "attachment; filename*=UTF-8''" + filename,
                    'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}}
