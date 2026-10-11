"""Business validators for Agreement domain (Issue #98 / V3-B1).

Strictly enforces Agreement schema, types, field lengths, dates, and required fields.
"""

from datetime import datetime
import re

from ..auth.session_service import AuthError

AGREEMENT_TYPES = {'MoU', 'MoA'}
AGREEMENT_STATUSES = {'draft', 'active', 'expired', 'terminated'}
ALLOWED_FIELDS = {
    'title',
    'agreementType',
    'partnerIds',
    'startDate',
    'endDate',
    'renewalDueOn',
    'renewalNote',
    'internalNote',
    'responsibleUserIds',
    'scopeId',
    'status',
}



def validate_date(date_str: str) -> bool:
    if not isinstance(date_str, str):
        return False
    trimmed = date_str.strip()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', trimmed):
        return False
    try:
        datetime.strptime(trimmed, '%Y-%m-%d')
        return True
    except ValueError:
        return False


def validate_string(val, max_len: int, min_len: int = 1, required: bool = True) -> str | None:
    if val is None:
        if required:
            raise AuthError('INVALID_FIELDS', 422)
        return None
    if not isinstance(val, str):
        raise AuthError('INVALID_FIELDS', 422)
    trimmed = val.strip()
    if required and len(trimmed) < min_len:
        raise AuthError('INVALID_FIELDS', 422)
    if len(trimmed) > max_len:
        raise AuthError('INVALID_FIELDS', 422)
    return trimmed


def validate_agreement_payload(payload: dict, is_create: bool = True):
    if not isinstance(payload, dict):
        raise AuthError('INVALID_BODY', 400)

    # Check for unknown fields
    unknown = set(payload) - ALLOWED_FIELDS
    if unknown:
        raise AuthError('INVALID_FIELDS', 422)

    if is_create:
        required = {'title', 'agreementType', 'partnerIds', 'scopeId'}
        if not required.issubset(set(payload)):
            raise AuthError('INVALID_FIELDS', 422)

    # Validate title (1-200 chars)
    if 'title' in payload:
        validate_string(payload['title'], max_len=200, min_len=1, required=True)

    # Validate agreementType (MoU | MoA)
    if 'agreementType' in payload:
        atype = payload['agreementType']
        if not isinstance(atype, str) or atype not in AGREEMENT_TYPES:
            raise AuthError('INVALID_FIELDS', 422)

    # Validate partnerIds (non-empty list of 1-20 unique string IDs)
    if 'partnerIds' in payload:
        pids = payload['partnerIds']
        if not isinstance(pids, list) or len(pids) == 0 or len(pids) > 20:
            raise AuthError('INVALID_FIELDS', 422)
        for pid in pids:
            if not isinstance(pid, str) or not pid.strip() or len(pid.strip()) > 200:
                raise AuthError('INVALID_FIELDS', 422)
        if len(set(pids)) != len(pids):
            raise AuthError('INVALID_FIELDS', 422)

    # Validate scopeId (non-empty string <= 200 chars)
    if 'scopeId' in payload:
        validate_string(payload['scopeId'], max_len=200, min_len=1, required=True)

    # Validate startDate
    if 'startDate' in payload and payload['startDate'] is not None:
        if not validate_date(payload['startDate']):
            raise AuthError('INVALID_FIELDS', 422)

    # Validate endDate
    if 'endDate' in payload and payload['endDate'] is not None:
        if not validate_date(payload['endDate']):
            raise AuthError('INVALID_FIELDS', 422)

    # Range check: startDate <= endDate if both are provided
    start = payload.get('startDate')
    end = payload.get('endDate')
    if start is not None and end is not None:
        if start > end:
            raise AuthError('INVALID_FIELDS', 422)

    # Validate renewalDueOn
    if 'renewalDueOn' in payload and payload['renewalDueOn'] is not None:
        if not validate_date(payload['renewalDueOn']):
            raise AuthError('INVALID_FIELDS', 422)

    # Validate renewalNote (<= 20,000 chars)
    if 'renewalNote' in payload and payload['renewalNote'] is not None:
        validate_string(payload['renewalNote'], max_len=20000, min_len=0, required=False)

    # Validate internalNote (<= 20,000 chars)
    if 'internalNote' in payload and payload['internalNote'] is not None:
        validate_string(payload['internalNote'], max_len=20000, min_len=0, required=False)

    # Validate responsibleUserIds (1-20 unique string IDs)
    if 'responsibleUserIds' in payload and payload['responsibleUserIds'] is not None:
        resp = payload['responsibleUserIds']
        if not isinstance(resp, list) or len(resp) == 0 or len(resp) > 20:
            raise AuthError('INVALID_FIELDS', 422)
        for uid in resp:
            if not isinstance(uid, str) or not uid.strip() or len(uid.strip()) > 200:
                raise AuthError('INVALID_FIELDS', 422)
        if len(set(resp)) != len(resp):
            raise AuthError('INVALID_FIELDS', 422)

    # Validate status
    if 'status' in payload and payload['status'] is not None:
        st = payload['status']
        if not isinstance(st, str) or st not in AGREEMENT_STATUSES:
            raise AuthError('INVALID_FIELDS', 422)


