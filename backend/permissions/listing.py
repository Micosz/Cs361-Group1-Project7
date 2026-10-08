"""Search/count/page only after record authorization and field projection."""

import base64
import hashlib
import hmac
import json
import re

from ..auth.session_service import AuthError, token_hash
from ..http_api import session_cookie


def page(rows, event, service):
    query = event.get('queryStringParameters') or {}
    if set(query) - {'q', 'limit', 'cursor'}:
        raise AuthError('INVALID_QUERY', 422)
    q = query.get('q', '')
    raw_limit = query.get('limit', '20')
    if (not isinstance(q, str) or len(q) > 200 or not isinstance(raw_limit, str)
            or not re.fullmatch(r'[1-9][0-9]{0,2}', raw_limit) or int(raw_limit) > 100):
        raise AuthError('INVALID_QUERY', 422)
    limit = int(raw_limit)
    needle = q.strip().casefold()
    rows = sorted((r for r in rows if needle in str(r.get('name', r.get('title', ''))).casefold()),
                  key=lambda r: r['id'])
    # Include the authorized projection snapshot so record edits/assignment changes
    # invalidate pagination rather than shifting a stale page across permissions.
    binding = json.dumps([event['rawPath'], token_hash(session_cookie(event)), needle, limit, rows],
                         sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    fingerprint = hashlib.sha256(binding).hexdigest()
    secret = service.policy.csrf_secret

    def sign(offset):
        message = f'permissions-page:{fingerprint}:{offset}'.encode()
        return hmac.new(secret, message, 'sha256').hexdigest()

    offset = 0
    if 'cursor' in query:
        try:
            cursor = query['cursor']
            if not isinstance(cursor, str) or len(cursor) > 256:
                raise ValueError()
            raw = base64.b64decode(cursor, altchars=b'-_', validate=True).decode('ascii')
            position, signature = raw.split(':')
            if not re.fullmatch(r'[1-9][0-9]*', position):
                raise ValueError()
            offset = int(position)
            if offset >= len(rows) or not hmac.compare_digest(sign(offset), signature):
                raise ValueError()
        except (ValueError, TypeError, UnicodeError):
            raise AuthError('INVALID_CURSOR', 422) from None
    next_offset = offset + limit
    cursor = None
    if next_offset < len(rows):
        cursor = base64.urlsafe_b64encode(f'{next_offset}:{sign(next_offset)}'.encode()).decode()
    return rows[offset:next_offset], len(rows), {'limit': limit, 'nextCursor': cursor}
