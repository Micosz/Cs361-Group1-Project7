"""Search/count/page only after record authorization and field projection."""

import base64
import hashlib
import hmac
import json
import re
from datetime import date

from ..auth.session_service import AuthError, token_hash
from ..http_api import session_cookie


def page(rows, event, service, kind=None):
    query = event.get('queryStringParameters') or {}
    supported = {'q', 'limit', 'cursor'}
    if kind in {'partner', 'activity'}:
        supported.add('type')
    if kind in {'agreement', 'exchange'}:
        supported.add('status')
    if kind in {'activity', 'agreement', 'exchange'}:
        supported.update({'startDate', 'endDate'})
    if set(query) - supported:
        raise AuthError('INVALID_QUERY', 422)
    for field in ('type', 'status'):
        if field in query and (not isinstance(query[field], str) or not query[field] or len(query[field]) > 64):
            raise AuthError('INVALID_QUERY', 422)

    def valid_day(value):
        try:
            return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
        except (ValueError, TypeError):
            return False

    for field in ('startDate', 'endDate'):
        if field in query and not valid_day(query[field]):
            raise AuthError('INVALID_QUERY', 422)
    start, end = query.get('startDate'), query.get('endDate')
    if start and end and start > end:
        raise AuthError('INVALID_QUERY', 422)

    def matches(row):
        if any(field in query and row.get(field) != query[field] for field in ('type', 'status')):
            return False
        if not (start or end):
            return True
        if kind == 'activity':
            day = row.get('periodDate')
            return valid_day(day) and (not start or day >= start) and (not end or day <= end)
        first, last = row.get('startDate'), row.get('endDate')
        return (valid_day(first) and valid_day(last) and first <= last
                and (not end or first <= end) and (not start or last >= start))

    rows = [row for row in rows if matches(row)]
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
    binding = json.dumps([event['rawPath'], token_hash(session_cookie(event)), needle, limit, {k: query[k] for k in sorted(query) if k not in {'q', 'limit', 'cursor'}}, rows],
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
