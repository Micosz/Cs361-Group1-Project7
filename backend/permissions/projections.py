"""Allowlisted projections; never return raw records or embedded reference objects."""

from .policy import allowed_roles, require_record

COMMON = {'id', 'entityType', 'version', 'createdAt', 'updatedAt'}
FIELDS = {
    'partner': {'name', 'type', 'summary', 'fullDescription', 'location', 'websiteUrl', 'logoPath', 'publication'},
    'activity': {'title', 'type', 'summary', 'fullDescription', 'partnerId', 'periodText', 'periodDate', 'imagePath', 'publication'},
    'agreement': {'title', 'agreementType', 'startDate', 'endDate', 'status', 'renewalDueOn', 'renewalNote', 'internalNote'},
    'exchange': {'title', 'agreementId', 'startDate', 'endDate', 'status', 'supportingInfo', 'supportingInfoForParticipant'},
    'contact': {'partnerId', 'name', 'position', 'email', 'phone'},
    'history': {'partnerId', 'occurredOn', 'kind', 'note'},
    'document': {'parentType', 'parentId', 'displayName', 'mime', 'size', 'audience', 'containsPersonal', 'uploadState'},
}
ARRAYS = {
    'partner': {'responsibleUserIds'},
    'activity': {'responsibleUserIds'},
    'agreement': {'responsibleUserIds'},
    'exchange': {'responsibleUserIds', 'participantUserIds'},
}
STUDENT = {'id', 'title', 'startDate', 'endDate', 'status', 'supportingInfoForParticipant'}
EXECUTIVE_EXCLUDED = {'internalNote', 'supportingInfo', 'supportingInfoForParticipant'}


def pick(record, fields):
    # Reject nested objects even under a known scalar field.
    return {k: v for k, v in record.items() if k in fields
            and (v is None or isinstance(v, (str, int, float, bool)))}


def project(context, kind, record, parent=None):
    roles = require_record(context, kind, 'read', record, parent)
    if kind == 'exchange' and roles == {'student'}:
        return pick(record, STUDENT)
    fields = COMMON | FIELDS[kind]
    editor = bool(roles & {'staff', 'coordinator'})
    if not editor:
        fields -= EXECUTIVE_EXCLUDED
    result = pick(record, fields)
    if editor:
        result.update(pick(record, {'scopeId'}))
        for key in ARRAYS.get(kind, ()):
            value = record.get(key)
            if isinstance(value, list) and all(isinstance(v, str) for v in value):
                result[key] = list(value)
    # Protected relationship IDs require their own permission check, never expansion
    # from raw partnerIds/agreementIds/referenceId or documents embedded in a row.
    return result


def visible_records(context, kind, records, parent=None):
    return [r for r in records if allowed_roles(context, kind, 'read', r, parent)]


PUBLIC_FIELDS = {
    'partner': {'id', 'name', 'type', 'summary', 'full_description', 'location', 'website_url', 'logo_path'},
    'activity': {'id', 'title', 'type', 'summary', 'full_description', 'partnerId', 'period', 'period_date', 'image_path', 'visibility'},
}
ALIASES = {'fullDescription': 'full_description', 'websiteUrl': 'website_url',
           'logoPath': 'logo_path', 'periodText': 'period', 'periodDate': 'period_date',
           'imagePath': 'image_path'}


def published(record):
    # Conflicting legacy publication flags fail closed. Missing v3 flag requires
    # an explicit legacy public flag; migration must still approve text content.
    flags = [record[k] for k in ('publication', 'access_level', 'visibility') if k in record]
    return bool(flags) and all(v == 'public' for v in flags)


def public_projection(kind, record, partners=None):
    if kind not in PUBLIC_FIELDS or not published(record):
        return None
    normalized = dict(record)
    for source, target in ALIASES.items():
        if source in record:
            normalized[target] = record[source]
    result = pick(normalized, PUBLIC_FIELDS[kind])
    if kind == 'activity':
        partner = (partners or {}).get(record.get('partnerId'))
        public_partner = public_projection('partner', partner) if partner else None
        if not public_partner:
            return None
        result['partnerName'] = public_partner.get('name', '')
        result['visibility'] = 'public'
        cohosts = []
        for key in record.get('coHostPartnerIds', []):
            other = (partners or {}).get(key)
            projected = public_projection('partner', other) if other else None
            if projected:
                cohosts.append(projected.get('name', ''))
        result['co_hosts'] = cohosts
    return result
