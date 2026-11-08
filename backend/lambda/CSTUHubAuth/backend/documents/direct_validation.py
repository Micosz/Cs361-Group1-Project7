"""Bounded validation for files uploaded to a private S3 staging key."""
import hashlib
import hmac
import os
import re
import zipfile

from ..auth.session_service import AuthError
from .validation import CONTENT_TYPES

DOCUMENT_LIMIT = min(int(os.environ.get('DOCUMENT_MAX_BYTES', 50 * 1024 * 1024)), 50 * 1024 * 1024)
IMAGE_LIMIT = min(int(os.environ.get('DOCUMENT_IMAGE_MAX_BYTES', 10 * 1024 * 1024)), 10 * 1024 * 1024, DOCUMENT_LIMIT)
UPLOAD_TTL = 900
SIGNATURE_TTL = 300
DOWNLOAD_TTL = 120


def upload_metadata(data):
    allowed = {'fileName', 'contentType', 'size', 'sha256', 'displayName', 'audience', 'containsPersonal'}
    if not isinstance(data, dict) or set(data) - allowed:
        raise AuthError('INVALID_UPLOAD', 422)
    name = data.get('fileName')
    if (not isinstance(name, str) or not 1 <= len(name) <= 200
            or re.search(r'[\x00-\x1f\x7f/\\]', name) or '.' not in name):
        raise AuthError('INVALID_UPLOAD', 422)
    extension = name.rsplit('.', 1)[1].lower()
    mime = CONTENT_TYPES.get(extension)
    if not mime or data.get('contentType') != mime:
        raise AuthError('INVALID_UPLOAD', 422)
    size = data.get('size')
    limit = IMAGE_LIMIT if mime.startswith('image/') else DOCUMENT_LIMIT
    if type(size) is not int or size < 1:
        raise AuthError('INVALID_UPLOAD', 422)
    if size > limit:
        raise AuthError('FILE_TOO_LARGE', 413)
    checksum = data.get('sha256')
    if not isinstance(checksum, str) or not re.fullmatch(r'[a-f0-9]{64}', checksum):
        raise AuthError('INVALID_UPLOAD', 422)
    display = data.get('displayName', name)
    if (not isinstance(display, str) or not display.strip() or len(display) > 200
            or re.search(r'[\x00-\x1f\x7f]', display)):
        raise AuthError('INVALID_UPLOAD', 422)
    audience, personal = data.get('audience', 'internal'), data.get('containsPersonal', False)
    if audience not in {'internal', 'participants'} or type(personal) is not bool:
        raise AuthError('INVALID_UPLOAD', 422)
    return dict(fileName=name, extension=extension, mime=mime, size=size, sha256=checksum,
                displayName=display, audience=audience, containsPersonal=personal)


def validate_stream(stream, destination, metadata):
    """Never load the entire upload into Lambda memory or extract a ZIP."""
    digest, total, prefix = hashlib.sha256(), 0, b''
    try:
        while True:
            chunk = stream.read(64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > metadata['size']:
                raise AuthError('FILE_TOO_LARGE', 413)
            prefix = (prefix + chunk)[:8]
            digest.update(chunk)
            destination.write(chunk)
    finally:
        stream.close()
    if total != metadata['size']:
        raise AuthError('INVALID_UPLOAD', 422)
    if not hmac.compare_digest(digest.hexdigest(), metadata['sha256']):
        raise AuthError('CHECKSUM_MISMATCH', 422)
    signatures = {'pdf': b'%PDF-', 'png': b'\x89PNG\r\n\x1a\n',
                  'jpg': b'\xff\xd8\xff', 'jpeg': b'\xff\xd8\xff', 'docx': b'PK\x03\x04'}
    if not prefix.startswith(signatures[metadata['extension']]):
        raise AuthError('INVALID_UPLOAD', 422)
    if metadata['extension'] == 'docx':
        destination.seek(0)
        try:
            with zipfile.ZipFile(destination) as archive:
                entries = archive.infolist()
                names = {entry.filename for entry in entries}
                if (len(entries) > 10000 or len(names) != len(entries)
                        or sum(entry.file_size for entry in entries) > 200 * 1024 * 1024
                        or not {'[Content_Types].xml', 'word/document.xml'} <= names
                        or any(entry.flag_bits & 1 or '\\' in entry.filename
                               or entry.filename.startswith('/') or '..' in entry.filename.split('/')
                               or entry.filename.lower().endswith('vbaproject.bin') for entry in entries)):
                    raise ValueError()
        except (zipfile.BadZipFile, ValueError, OSError):
            raise AuthError('INVALID_UPLOAD', 422) from None
    return digest.hexdigest()
