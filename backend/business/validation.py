"""Value validation AFTER #79 validate_fields; features still own refs and writes.

Return a normalized payload fragment, never a saved/authorized entity. No I/O.
The caller supplies trusted stored data for PATCH and must validate references,
assignees and all transaction preconditions before the first side effect.
"""
from datetime import date
import re
from urllib.parse import urlsplit

from ..auth.session_service import AuthError
from ..permissions.policy import WRITABLE

# Union of V3-B1 and actual V2 types, preserving research_institute/internship.
PARTNER_TYPES = frozenset({'company', 'university', 'government',
                           'research_institute', 'internship'})
ACTIVITY_TYPES = frozenset({'academic_activity', 'event', 'research'})
REQUIRED = {
    'partner': ('name', 'type', 'summary', 'location'),
    'activity': ('title', 'type', 'summary', 'partnerId'),
    'feedback': ('occurredOn', 'sourceType', 'comment'),
    'contact': ('name',),
    'history': ('occurredOn', 'kind', 'note'),
}
TEXT_LIMITS = {
    'name': 200, 'title': 200, 'summary': 2000, 'location': 2000,
    'fullDescription': 20000, 'note': 20000, 'periodText': 2000,
    'comment': 10000, 'improvement': 10000, 'respondentName': 200,
    'outcomeSummary': 10000,
    'position': 200, 'email': 320, 'phone': 100,
}


def invalid():
    raise AuthError('INVALID_FIELDS', 422)


def identifier(value):
    if (not isinstance(value, str) or not value or len(value) > 200
            or value != value.strip() or any(ord(c) < 32 or ord(c) == 127 for c in value)):
        invalid()
    return value


def ids(value, limit=20):
    if not isinstance(value, list) or len(value) > limit:
        invalid()
    result = [identifier(item) for item in value]
    if len(set(result)) != len(result):
        invalid()
    return result


def calendar_day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        invalid()
    try:
        date.fromisoformat(value)
    except ValueError:
        invalid()
    return value


def public_asset(value):
    # Match the existing resources/ convention; no remote/private/active content.
    if (not isinstance(value, str) or not re.fullmatch(
            r'resources/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)', value, re.IGNORECASE)):
        invalid()
    return value


def normalize_payload(kind, action, payload, *, record=None):
    """Validate create/update fragments; #79 owns WHO may submit each field.

    PATCH validates the effective required values and coupled references using
    the trusted record, so changing only referenceType cannot leave a bad pair.
    Optional strings clear with ''; optional periodDate clears with null; link
    arrays clear with []. Omitted PATCH fields never overwrite stored values.
    """
    if kind not in REQUIRED or action not in {'create', 'update'}:
        invalid()
    if not isinstance(payload, dict) or not payload:
        invalid()
    fields = set(WRITABLE[kind])
    if kind in {'partner', 'activity'}:
        fields |= {'publication', 'responsibleUserIds'}
        if action == 'create':
            fields.add('scopeId')
    if set(payload) - fields:
        invalid()
    if action == 'update' and (not isinstance(record, dict) or record.get('entityType') != kind):
        invalid()
    result = dict(payload)
    for field, value in result.items():
        if field in TEXT_LIMITS:
            if not isinstance(value, str):
                invalid()
            result[field] = value.strip()
            if len(result[field]) > TEXT_LIMITS[field]:
                invalid()
        elif field in {'scopeId', 'partnerId', 'referenceId'} and value is not None:
            identifier(value)
        elif field in {'responsibleUserIds', 'coHostPartnerIds', 'agreementIds'}:
            result[field] = ids(value)
        elif field in {'occurredOn', 'periodDate'}:
            if field == 'periodDate' and value is None:
                continue
            calendar_day(value)
        elif field in {'logoPath', 'imagePath'}:
            if value != '':
                public_asset(value)
        elif field == 'websiteUrl':
            if not isinstance(value, str) or len(value) > 2000:
                invalid()
            if value:
                try:
                    parsed = urlsplit(value)
                    parsed.port  # Validate malformed/out-of-range ports too.
                    if (parsed.scheme not in {'https', 'http'} or not parsed.hostname
                            or parsed.username is not None or parsed.password is not None
                            or any(c.isspace() or ord(c) < 32 for c in value)):
                        invalid()
                except ValueError:
                    invalid()
    effective = {**(record or {}), **result}
    for field in REQUIRED[kind]:
        value = effective.get(field)
        if not isinstance(value, str) or not value.strip():
            invalid()
        if field in TEXT_LIMITS and len(value.strip()) > TEXT_LIMITS[field]:
            invalid()
    if kind in {'partner', 'activity'}:
        if action == 'create':
            identifier(result.get('scopeId'))
            result.setdefault('publication', 'internal')
        if 'publication' in result and (not isinstance(result['publication'], str)
                or result['publication'] not in {'internal', 'public'}):
            invalid()
        types = PARTNER_TYPES if kind == 'partner' else ACTIVITY_TYPES
        if effective['type'] not in types:
            invalid()
    if kind == 'activity':
        primary = identifier(effective['partnerId'])
        cohosts = ids(effective.get('coHostPartnerIds', []), 19)
        ids(effective.get('agreementIds', []))
        if primary in cohosts:
            invalid()
    if kind == 'feedback':
        calendar_day(effective['occurredOn'])
        if not isinstance(effective['sourceType'], str) or effective['sourceType'] not in {'participant', 'partner', 'other'}:
            invalid()
    if kind == 'history':
        calendar_day(effective['occurredOn'])
        if effective['kind'] not in {'meeting', 'agreement', 'activity', 'other'}:
            invalid()
        reference_type, reference_id = effective.get('referenceType'), effective.get('referenceId')
        if reference_type is not None or reference_id is not None:
            if not isinstance(reference_type, str) or reference_type not in {'agreement', 'activity'}:
                invalid()
            identifier(reference_id)
    return result
