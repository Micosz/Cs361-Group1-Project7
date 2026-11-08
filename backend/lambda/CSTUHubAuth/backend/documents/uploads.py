"""Parse a bounded upload without side effects; authorization belongs to the gateway."""
import base64
from email import policy
from email.parser import BytesParser
import json

from ..auth.session_service import AuthError
from .validation import MAX_FILE_SIZE, prepare_upload_record


def parse_upload(event):
    try:
        encoded = event.get('body') or ''
        if len(encoded) > (MAX_FILE_SIZE * 4 // 3 + 32768):
            raise AuthError('FILE_TOO_LARGE', 413)
        raw = base64.b64decode(encoded, validate=True) if event.get('isBase64Encoded') else encoded.encode()
        headers = {k.lower(): v for k, v in event.get('headers', {}).items()}
        content_type = headers.get('content-type', '')
        if content_type.startswith('multipart/form-data;'):
            message = BytesParser(policy=policy.default).parsebytes(
                ('Content-Type: ' + content_type + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + raw)
            if not message.is_multipart():
                raise ValueError()
            fields, file_bytes, file_meta = {}, None, None
            for part in message.iter_parts():
                name = part.get_param('name', header='content-disposition')
                if name in fields or (name == 'file' and file_bytes is not None):
                    raise ValueError()
                if name == 'file':
                    file_bytes = part.get_payload(decode=True)
                    file_meta = {'fileName': part.get_filename(), 'contentType': part.get_content_type()}
                elif name in {'displayName', 'audience', 'containsPersonal'}:
                    fields[name] = part.get_content().strip()
                else:
                    raise ValueError()
            if file_bytes is None:
                raise ValueError()
            personal = fields.get('containsPersonal', 'false')
            if personal not in {'true', 'false'}:
                raise ValueError()
            payload = dict(displayName=fields.get('displayName') or file_meta['fileName'],
                           audience=fields.get('audience', 'internal'), containsPersonal=personal == 'true')
        else:
            data = json.loads(raw)
            if not isinstance(data, dict) or set(data) - {'fileName', 'contentType', 'fileBase64', 'displayName', 'audience', 'containsPersonal'}:
                raise ValueError()
            file_bytes = base64.b64decode(data['fileBase64'], validate=True)
            file_meta = data
            payload = {k: data[k] for k in ('displayName', 'audience', 'containsPersonal') if k in data}
            payload.setdefault('displayName', data.get('fileName'))
            payload.setdefault('audience', 'internal')
            payload.setdefault('containsPersonal', False)
        record = prepare_upload_record(file_meta, file_bytes)
        return payload, {'metadata': record, 'bytes': file_bytes}
    except AuthError:
        raise
    except (ValueError, TypeError, KeyError, UnicodeError, AttributeError):
        raise AuthError('INVALID_UPLOAD', 422) from None
