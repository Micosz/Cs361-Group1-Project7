"""Feedback values inherit authorization and transactional lifetime from their parent."""
from datetime import datetime, timezone
from uuid import uuid4

from .auth.session_service import AuthError
from .business.validation import normalize_payload
from .permissions.policy import require_record


def feedback_record(context, action, payload, record, parent, now):
    if not parent or parent.get('entityType') not in {'activity', 'exchange'}:
        raise AuthError('NOT_FOUND', 404)
    candidate = record or dict(entityType='feedback', scopeId=parent['scopeId'],
                               parentType=parent['entityType'], parentId=parent['id'])
    require_record(context, 'feedback', action, candidate, parent)
    normalized = normalize_payload('feedback', action, payload, record=record)
    timestamp = datetime.fromtimestamp(now, timezone.utc).isoformat()
    saved = dict(record or dict(id='feedback-' + uuid4().hex, entityType='feedback',
                 scopeId=parent['scopeId'], parentType=parent['entityType'],
                 parentId=parent['id'], createdAt=timestamp, createdBy=context.user.user_id))
    saved.update(normalized, version=(record or {}).get('version', 0) + 1,
                 updatedAt=timestamp, updatedBy=context.user.user_id)
    return saved
