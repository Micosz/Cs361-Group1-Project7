"""Business validators for Partner, Contact, History, and Activity (Issue #94 / V3-B1).

Strictly enforces schema, types, field lengths, URL protocols, and required fields.
"""

from datetime import datetime
import re
from urllib.parse import urlparse

from ..auth.session_service import AuthError

PARTNER_TYPES = {'company', 'university', 'government', 'internship'}
PUBLICATION_TYPES = {'public', 'internal'}
HISTORY_KINDS = {'meeting', 'agreement', 'activity', 'other'}
REFERENCE_TYPES = {'agreement', 'activity'}

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')
PHONE_REGEX = re.compile(r'^[0-9+\-()./\s]{1,50}$')


def validate_url(url: str) -> bool:
    if not isinstance(url, str):
        return False
    trimmed = url.strip()
    if not trimmed:
        return False
    try:
        parsed = urlparse(trimmed)
        if parsed.scheme.lower() not in {'http', 'https'}:
            return False
        if not parsed.netloc:
            return False
        return True
    except Exception:
        return False


def validate_email(email: str) -> bool:
    if not isinstance(email, str):
        return False
    trimmed = email.strip()
    if not trimmed or len(trimmed) > 200:
        return False
    return bool(EMAIL_REGEX.match(trimmed))


def validate_phone(phone: str) -> bool:
    if not isinstance(phone, str):
        return False
    trimmed = phone.strip()
    if not trimmed or len(trimmed) > 50:
        return False
    return bool(PHONE_REGEX.match(trimmed))


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


def validate_partner_payload(payload: dict, is_create: bool = True):
    if not isinstance(payload, dict):
        raise AuthError('INVALID_BODY', 400)

    if is_create:
        required = {'name', 'type', 'summary', 'location', 'scopeId'}
        if not required.issubset(set(payload)):
            raise AuthError('INVALID_FIELDS', 422)

    if 'name' in payload:
        validate_string(payload['name'], max_len=200, min_len=1, required=True)

    if 'type' in payload:
        ptype = payload['type']
        if not isinstance(ptype, str) or ptype not in PARTNER_TYPES:
            raise AuthError('INVALID_FIELDS', 422)

    if 'summary' in payload:
        validate_string(payload['summary'], max_len=2000, min_len=1, required=True)

    if 'location' in payload:
        validate_string(payload['location'], max_len=200, min_len=1, required=True)

    if 'fullDescription' in payload and payload['fullDescription'] is not None:
        validate_string(payload['fullDescription'], max_len=20000, min_len=0, required=False)

    if 'websiteUrl' in payload and payload['websiteUrl'] is not None:
        url = payload['websiteUrl']
        if url != '' and not validate_url(url):
            raise AuthError('INVALID_FIELDS', 422)

    if 'logoPath' in payload and payload['logoPath'] is not None:
        validate_string(payload['logoPath'], max_len=500, min_len=0, required=False)

    if 'responsibleUserIds' in payload:
        resp = payload['responsibleUserIds']
        if not isinstance(resp, list) or len(resp) > 20:
            raise AuthError('INVALID_FIELDS', 422)
        if len(set(resp)) != len(resp):
            raise AuthError('INVALID_FIELDS', 422)
        for uid in resp:
            if not isinstance(uid, str) or not uid.strip():
                raise AuthError('INVALID_FIELDS', 422)

    if 'publication' in payload:
        pub = payload['publication']
        if pub not in PUBLICATION_TYPES:
            raise AuthError('INVALID_FIELDS', 422)


def validate_contact_payload(payload: dict, is_create: bool = True):
    if not isinstance(payload, dict):
        raise AuthError('INVALID_BODY', 400)

    if is_create:
        if 'name' not in payload:
            raise AuthError('INVALID_FIELDS', 422)

    if 'name' in payload:
        validate_string(payload['name'], max_len=200, min_len=1, required=True)

    if 'position' in payload and payload['position'] is not None:
        validate_string(payload['position'], max_len=200, min_len=0, required=False)

    if 'email' in payload and payload['email'] is not None:
        email = payload['email']
        if email != '' and not validate_email(email):
            raise AuthError('INVALID_FIELDS', 422)

    if 'phone' in payload and payload['phone'] is not None:
        phone = payload['phone']
        if phone != '' and not validate_phone(phone):
            raise AuthError('INVALID_FIELDS', 422)


def validate_history_payload(payload: dict, is_create: bool = True):
    if not isinstance(payload, dict):
        raise AuthError('INVALID_BODY', 400)

    if is_create:
        required = {'occurredOn', 'kind', 'note'}
        if not required.issubset(set(payload)):
            raise AuthError('INVALID_FIELDS', 422)

    if 'occurredOn' in payload:
        if not validate_date(payload['occurredOn']):
            raise AuthError('INVALID_FIELDS', 422)

    if 'kind' in payload:
        if payload['kind'] not in HISTORY_KINDS:
            raise AuthError('INVALID_FIELDS', 422)

    if 'note' in payload:
        validate_string(payload['note'], max_len=20000, min_len=1, required=True)

    if 'referenceType' in payload and payload['referenceType'] is not None:
        if payload['referenceType'] not in REFERENCE_TYPES:
            raise AuthError('INVALID_FIELDS', 422)


def validate_activity_payload(payload: dict, is_create: bool = True):
    if not isinstance(payload, dict):
        raise AuthError('INVALID_BODY', 400)

    if is_create:
        required = {'title', 'type', 'summary', 'partnerId'}
        if not required.issubset(set(payload)):
            raise AuthError('INVALID_FIELDS', 422)

    if 'title' in payload:
        validate_string(payload['title'], max_len=200, min_len=1, required=True)

    if 'type' in payload:
        validate_string(payload['type'], max_len=100, min_len=1, required=True)

    if 'summary' in payload:
        validate_string(payload['summary'], max_len=2000, min_len=1, required=True)

    if 'fullDescription' in payload and payload['fullDescription'] is not None:
        validate_string(payload['fullDescription'], max_len=20000, min_len=0, required=False)

    if 'partnerId' in payload:
        validate_string(payload['partnerId'], max_len=200, min_len=1, required=True)

    if 'periodDate' in payload and payload['periodDate'] is not None:
        if not validate_date(payload['periodDate']):
            raise AuthError('INVALID_FIELDS', 422)

    if 'coHostPartnerIds' in payload and payload['coHostPartnerIds'] is not None:
        cohosts = payload['coHostPartnerIds']
        if not isinstance(cohosts, list) or len(cohosts) > 20:
            raise AuthError('INVALID_FIELDS', 422)
        if len(set(cohosts)) != len(cohosts):
            raise AuthError('INVALID_FIELDS', 422)

    if 'agreementIds' in payload and payload['agreementIds'] is not None:
        agreements = payload['agreementIds']
        if not isinstance(agreements, list) or len(agreements) > 20:
            raise AuthError('INVALID_FIELDS', 422)

    if 'responsibleUserIds' in payload and payload['responsibleUserIds'] is not None:
        resp = payload['responsibleUserIds']
        if not isinstance(resp, list) or len(resp) > 20:
            raise AuthError('INVALID_FIELDS', 422)

    if 'publication' in payload and payload['publication'] is not None:
        if payload['publication'] not in PUBLICATION_TYPES:
            raise AuthError('INVALID_FIELDS', 422)

