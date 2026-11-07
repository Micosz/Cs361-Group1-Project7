"""Activity relationship domain logic (#97).

get_record(kind, id) reads trusted storage. allowed(kind, action, row) applies #79
using a server SessionContext and returns bool. Neither callback comes from HTTP.
This module never writes/deletes data or creates an authentication policy.
"""

from copy import deepcopy
from dataclasses import dataclass

FIELDS = {'partnerId', 'coHostPartnerIds', 'agreementIds'}


class LinkError(Exception):
    def __init__(self, code, status=422):
        super().__init__(code)
        self.code, self.status = code, status


def identifier(value):
    return isinstance(value, str) and bool(value.strip()) and value == value.strip()


def ids(value):
    if (not isinstance(value, list) or not all(identifier(v) for v in value)
            or len(value) != len(set(value))):
        raise LinkError('INVALID_FIELDS')
    return list(value)


def valid_target(activity):
    if (not isinstance(activity, dict) or activity.get('entityType') != 'activity'
            or not identifier(activity.get('id')) or not identifier(activity.get('scopeId'))
            or type(activity.get('version')) is not int or activity['version'] < 1):
        raise LinkError('INVALID_ACTIVITY', 409)


def require_allowed(allowed, kind, action, row):
    if allowed(kind, action, row) is not True:
        raise LinkError('NOT_FOUND', 404)


def reference(get_record, kind, key, scope):
    row = get_record(kind, key)
    if (not isinstance(row, dict) or row.get('id') != key
            or row.get('entityType') != kind or row.get('scopeId') != scope):
        raise LinkError('INVALID_REFERENCE')
    return row


@dataclass(frozen=True)
class ReferenceVersion:
    kind: str
    id: str
    scope_id: str
    version: int


@dataclass(frozen=True)
class LinkPlan:
    activity_id: str
    activity_version: int
    scope_id: str
    changes: dict
    references: tuple[ReferenceVersion, ...]


def plan_patch(activity, patch, *, get_record, allowed):
    """Validate relationship-only PATCH; return a plan, not a saved record.

    Storage must check target/reference versions AND #79 user/session conditions
    atomically with the write. An omitted field stays unchanged; [] unlinks all
    optional references. The primary partner is required and cannot be removed.
    """
    valid_target(activity)
    require_allowed(allowed, 'activity', 'update', activity)
    if not isinstance(patch, dict) or not patch or set(patch) - FIELDS:
        raise LinkError('INVALID_FIELDS')
    merged = {field: deepcopy(patch.get(field, activity.get(field, []))) for field in FIELDS}
    if not identifier(merged['partnerId']):
        raise LinkError('INVALID_FIELDS')
    cohosts, agreements = ids(merged['coHostPartnerIds']), ids(merged['agreementIds'])
    partners = [merged['partnerId'], *cohosts]
    # #91's partner relationship limit includes the primary partner.
    if len(partners) > 20 or len(partners) != len(set(partners)):
        raise LinkError('INVALID_FIELDS')
    # Co-host IDs affect public display. An assigned coordinator must first ask
    # staff to unpublish before editing these fields, matching #79's field policy.
    if (activity.get('publication') == 'public' and set(patch) & {'partnerId', 'coHostPartnerIds'}
            and allowed('activity', 'change_public_links', activity) is not True):
        raise LinkError('FORBIDDEN', 403)
    guards = []
    for kind, keys in (('partner', partners), ('agreement', agreements)):
        for key in keys:
            row = reference(get_record, kind, key, activity['scopeId'])
            # Missing, wrong-scope and unreadable references have the same error.
            if allowed(kind, 'read', row) is not True:
                raise LinkError('INVALID_REFERENCE')
            if type(row.get('version')) is not int or row['version'] < 1:
                raise LinkError('INVALID_REFERENCE')
            guards.append(ReferenceVersion(kind, key, activity['scopeId'], row['version']))
    return LinkPlan(activity['id'], activity['version'], activity['scopeId'],
                    {key: deepcopy(merged[key]) for key in patch}, tuple(guards))


def _label(row, kind):
    key = 'name' if kind == 'partner' else 'title'
    if not isinstance(row.get(key), str):
        raise LinkError('INVALID_REFERENCE')
    return {'id': row['id'], key: row[key]}


def internal_links(activity, *, get_record, allowed):
    """Read minimal relationship labels; hide inaccessible references entirely.

    No denied IDs, missing counts, raw objects or provider errors are returned.
    Exceptions from storage/policy propagate; outages are never empty success.
    """
    valid_target(activity)
    require_allowed(allowed, 'activity', 'read', activity)
    result = {'partner': None, 'coHosts': [], 'agreements': []}
    groups = [('partner', [activity.get('partnerId')], 'partner'),
              ('partner', ids(activity.get('coHostPartnerIds', [])), 'coHosts'),
              ('agreement', ids(activity.get('agreementIds', [])), 'agreements')]
    for kind, keys, target in groups:
        for key in keys:
            if not identifier(key):
                raise LinkError('INVALID_FIELDS')
            try:
                row = reference(get_record, kind, key, activity['scopeId'])
            except LinkError:
                continue
            if allowed(kind, 'read', row) is not True:
                continue
            label = _label(row, kind)
            if target == 'partner':
                result[target] = label
            else:
                result[target].append(label)
    return result


def published(row):
    flags = [row[k] for k in ('publication', 'access_level', 'visibility') if k in row]
    return bool(flags) and all(value == 'public' for value in flags)


def public_links(activity, *, get_record):
    """Public primary/co-host labels only. Never even fetch an agreement.

    Unpublished/orphan-primary activities are omitted. Legacy records may lack
    entityType/scope; v3 records require scope. Never infer co-host IDs by name.
    """
    if not isinstance(activity, dict) or not published(activity):
        return None
    if activity.get('entityType', 'activity') != 'activity':
        return None
    scope = activity.get('scopeId')
    if activity.get('schemaVersion') == 3 and not identifier(scope):
        return None

    def partner_label(key):
        if not identifier(key):
            return None
        row = get_record('partner', key)
        if (not isinstance(row, dict) or row.get('id') != key or not published(row)
                or row.get('entityType', 'partner') != 'partner'
                or row.get('scopeId') != scope
                or (row.get('schemaVersion') == 3 and not identifier(row.get('scopeId')))
                or not isinstance(row.get('name'), str)):
            return None
        return {'id': key, 'name': row['name']}

    primary = partner_label(activity.get('partnerId'))
    if primary is None:
        return None
    cohosts = ids(activity.get('coHostPartnerIds', []))
    return {'partner': primary, 'coHosts': [label for key in cohosts
            if key != primary['id'] and (label := partner_label(key)) is not None]}


def legacy_relationships(record):
    """Non-destructive V2 mapping fragment for a separately reviewed migration.

    Caller supplies scope/entity/version elsewhere. Names remain unresolved
    internal legacy metadata; this helper never guesses IDs or writes to AWS.
    """
    if not identifier(record.get('partnerId')):
        raise LinkError('INVALID_FIELDS')
    names = record.get('co_hosts', [])
    if not isinstance(names, list) or not all(isinstance(v, str) for v in names):
        raise LinkError('INVALID_FIELDS')
    return {'partnerId': record['partnerId'],
            'coHostPartnerIds': ids(record.get('coHostPartnerIds', [])),
            'agreementIds': ids(record.get('agreementIds', [])),
            'legacyCoHostNames': list(names)}
