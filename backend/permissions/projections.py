"""Allowlisted projections; never return raw records or embedded reference objects."""

import copy

from .policy import allowed_roles, require_record
from ..relationships.activity_links import public_links, LinkError

COMMON = {'id', 'entityType', 'version', 'createdAt', 'updatedAt'}
FIELDS = {
    'partner': {'name', 'type', 'summary', 'fullDescription', 'location', 'websiteUrl', 'logoPath', 'publication'},
    'activity': {'title', 'type', 'summary', 'fullDescription', 'partnerId', 'periodText', 'periodDate', 'imagePath', 'publication', 'outcomeSummary'},
    'agreement': {'title', 'agreementType', 'startDate', 'endDate', 'status', 'renewalDueOn', 'renewalNote', 'internalNote', 'publication'},
    'exchange': {'title', 'agreementId', 'startDate', 'endDate', 'status', 'supportingInfo', 'supportingInfoForParticipant', 'outcomeSummary'},
    'formFeedback': {'parentId', 'parentType', 'formName', 'sourceType', 'fileName', 'sheetName', 'createdBy', 'importedByName', 'responseCount', 'origin'},
    'feedback': {'parentId', 'parentType', 'occurredOn', 'sourceType', 'respondentType', 'origin', 'comment', 'improvement'},
    'contact': {'partnerId', 'name', 'position', 'email', 'phone'},
    'history': {'partnerId', 'occurredOn', 'kind', 'note'},
    'document': {'parentType', 'parentId', 'displayName', 'mime', 'size', 'audience', 'containsPersonal', 'uploadState'},
}
ARRAYS = {
    'partner': {'responsibleUserIds'},
    'activity': {'responsibleUserIds'},
    'agreement': {'responsibleUserIds', 'partnerIds'},
    'exchange': {'partnerIds', 'responsibleUserIds', 'participantUserIds'},
}
STUDENT = {'id', 'title', 'startDate', 'endDate', 'status', 'supportingInfoForParticipant'}
ACTIVITY_STUDENT = {'id', 'entityType', 'title', 'type', 'summary', 'fullDescription', 'periodText', 'periodDate', 'imagePath', 'publication'}
EXECUTIVE_EXCLUDED = {'internalNote', 'supportingInfo', 'supportingInfoForParticipant'}


def pick(record, fields):
    # Reject nested objects even under a known scalar field.
    return {k: v for k, v in record.items() if k in fields
            and (v is None or isinstance(v, (str, int, float, bool)))}


def project(context, kind, record, parent=None):
    roles = require_record(context, kind, 'read', record, parent)
    if kind == 'agreement' and not roles & {'staff', 'coordinator', 'executive'}:
        return pick(record, {'id', 'entityType', 'title', 'agreementType', 'startDate', 'endDate', 'status'})
    if kind == 'activity' and not roles & {'staff', 'coordinator', 'executive'}:
        return pick(record, ACTIVITY_STUDENT)
    if kind == 'exchange' and roles == {'student'}:
        return pick(record, STUDENT)
    fields = COMMON | FIELDS[kind]
    editor = bool(roles & {'staff', 'coordinator', 'executive'})
    if not editor:
        fields -= EXECUTIVE_EXCLUDED
    result = pick(record, fields)
    if kind == 'formFeedback':
        result['columns'] = copy.deepcopy(record.get('columns', []))
        result['rows'] = copy.deepcopy(record.get('rows', []))
        result['canDelete'] = bool(allowed_roles(context, kind, 'delete', record, parent))
    if kind == 'feedback':
        result['canEdit'] = bool(allowed_roles(context, kind, 'update', record, parent))
    if editor:
        if kind == 'feedback':
            result.update(pick(record, {'respondentName'}))
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


AGREEMENT_PUBLIC = {'id', 'entityType', 'title', 'agreementType', 'startDate', 'endDate', 'status', 'publication'}

PUBLIC_FIELDS = {
    'agreement': AGREEMENT_PUBLIC,
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
    if kind == 'agreement' and record.get('publication') != 'public':
        return None
    if kind not in PUBLIC_FIELDS or not published(record):
        return None
    normalized = dict(record)
    for source, target in ALIASES.items():
        if source in record:
            normalized[target] = record[source]
    result = pick(normalized, PUBLIC_FIELDS[kind])
    if kind == 'activity':
        try:
            links = public_links(record, get_record=lambda kind, key: (partners or {}).get(key))
        except LinkError:
            return None
        if not links:
            return None
        result['partnerName'] = links['partner']['name']
        result['visibility'] = 'public'
        result['co_hosts'] = [item['name'] for item in links['coHosts']]
        tags = record.get('activity_tags')
        if isinstance(tags, list) and tags == ['mou']:
            result['activity_tags'] = list(tags)
    return result
