"""Default-deny authorization. Inputs are server records and SessionContext only."""

from ..auth.session_service import AuthError

BUSINESS = {'partner', 'activity', 'agreement', 'exchange'}
CHILDREN = {'contact', 'history', 'document'}
DISPLAY = {
    'partner': {'name', 'type', 'summary', 'fullDescription', 'location', 'websiteUrl', 'logoPath'},
    'activity': {'title', 'type', 'summary', 'fullDescription', 'partnerId',
                 'coHostPartnerIds', 'periodText', 'periodDate', 'imagePath'},
}
WRITABLE = {
    **DISPLAY,
    'agreement': {'title', 'agreementType', 'partnerIds', 'startDate', 'endDate',
                  'renewalDueOn', 'renewalNote', 'internalNote'},
    'exchange': {'title', 'partnerIds', 'agreementId', 'participantUserIds',
                 'startDate', 'endDate', 'supportingInfo', 'supportingInfoForParticipant'},
    'contact': {'name', 'position', 'email', 'phone'},
    'history': {'occurredOn', 'kind', 'note', 'referenceType', 'referenceId'},
    'document': {'displayName', 'audience', 'containsPersonal'},
}
WRITABLE['activity'] = WRITABLE['activity'] | {'agreementIds'}
STATUS = {
    'agreement': {'to', 'reason', 'endDate', 'renewalNote'},
    'exchange': {'to', 'reason', 'supportingInfo'},
}
SERVER_FIELDS = {'id', 'entityType', 'schemaVersion', 'version', 'createdAt', 'updatedAt',
                 'createdBy', 'updatedBy', 'recordedBy', 'partnerId', 'parentId',
                 'parentType', 'objectKey', 'hash', 'mime', 'size', 'uploadedBy',
                 'uploadedAt', 'uploadState', 'userId', 'role', 'grants', 'capabilities',
                 'authzVersion'}


def denied(status=403):
    raise AuthError('NOT_FOUND' if status == 404 else 'FORBIDDEN', status)


def user_from(context):
    user = context.user
    if user is None or not user.active:
        raise AuthError('AUTH_REQUIRED')
    return user


def grants(context):
    return user_from(context).permissions()[0]


def action_roles(kind, action):
    if kind not in BUSINESS | CHILDREN:
        return set()
    if action == 'read':
        return ({'student', 'coordinator', 'staff', 'executive'} if kind in {'exchange', 'document'}
                else {'coordinator', 'staff'} if kind == 'contact'
                else {'coordinator', 'staff', 'executive'})
    if action == 'create':
        return {'staff'} if kind == 'partner' else {'coordinator', 'staff'}
    if action == 'update':
        return {'coordinator', 'staff'} if kind != 'document' else set()
    if action == 'status' and kind in STATUS:
        return {'coordinator', 'staff'}
    if action == 'upload' and kind == 'document':
        return {'coordinator', 'staff'}
    return set()


def require_action(context, kind, action):
    if not any(g['role'] in action_roles(kind, action) for g in grants(context)):
        denied()


def matching_roles(context, record):
    """Do not combine one role's action with another role's scope."""
    scope = record.get('scopeId')
    if not isinstance(scope, str) or not scope:
        return set()
    return {g['role'] for g in grants(context) if g['scopeId'] == scope}


def linked(record, field, user_id):
    value = record.get(field)
    return isinstance(value, list) and user_id in value and all(isinstance(v, str) for v in value)


def allowed_roles(context, kind, action, record, parent=None):
    user = user_from(context)
    if not isinstance(record, dict) or record.get('entityType') != kind:
        return set()
    if kind in CHILDREN:
        if (not isinstance(parent, dict) or not parent.get('id')
                or record.get('scopeId') != parent.get('scopeId')):
            return set()
        if kind in {'contact', 'history'}:
            if parent.get('entityType') != 'partner' or record.get('partnerId') != parent['id']:
                return set()
        elif (parent.get('entityType') not in {'agreement', 'exchange'}
              or record.get('parentId') != parent['id']
              or record.get('parentType') != parent['entityType']):
            return set()
        base = parent
    else:
        base = record
    if base.get('entityType') not in BUSINESS or (kind in BUSINESS and base.get('entityType') != kind):
        return set()
    roles = matching_roles(context, base) & action_roles(kind, action)
    if not linked(base, 'responsibleUserIds', user.user_id):
        roles.discard('coordinator')
    if base.get('entityType') != 'exchange' or not linked(base, 'participantUserIds', user.user_id):
        roles.discard('student')
    if kind == 'document':
        audience, personal = record.get('audience'), record.get('containsPersonal')
        if audience not in {'internal', 'participants'} or type(personal) is not bool:
            return set()
        if personal and (audience != 'participants' or base['entityType'] != 'exchange'):
            return set()
        if audience == 'participants' and base['entityType'] != 'exchange':
            return set()
        if audience != 'participants':
            roles.discard('student')
        if audience != 'internal' or personal:
            roles.discard('executive')
    return roles


def require_record(context, kind, action, record, parent=None):
    require_action(context, kind, action)
    roles = allowed_roles(context, kind, action, record, parent)
    if not roles:
        denied(404)
    return roles


def validate_fields(context, kind, action, payload, record=None, parent=None):
    """Authorization only; feature validators still validate values/refs/states."""
    require_action(context, kind, action)
    if not isinstance(payload, dict):
        raise AuthError('INVALID_BODY', 400)
    if action in {'create', 'upload'} and kind in BUSINESS:
        scope = payload.get('scopeId')
        if not isinstance(scope, str) or not scope:
            raise AuthError('INVALID_FIELDS', 422)
        roles = matching_roles(context, {'scopeId': scope}) & action_roles(kind, action)
        if not roles:
            denied(404)
    else:
        roles = require_record(context, kind, action, record, parent)
    fields = set(STATUS.get(kind, ())) if action == 'status' else set(WRITABLE.get(kind, ()))
    if action == 'create' and kind in BUSINESS:
        fields.add('scopeId')
    if 'staff' in roles and action != 'status' and kind in BUSINESS:
        fields.add('responsibleUserIds')
        if kind in DISPLAY:
            fields.add('publication')
    unknown = set(payload) - fields
    if unknown:
        # Permission-sensitive injection must not be silently ignored.
        forbidden = SERVER_FIELDS | {'scopeId', 'responsibleUserIds', 'publication', 'status'}
        if unknown & forbidden:
            denied()
        raise AuthError('INVALID_FIELDS', 422)
    if ('staff' not in roles and kind in DISPLAY and record
            and record.get('publication') == 'public' and set(payload) & DISPLAY[kind]):
        denied()
    result = dict(payload)
    if action == 'create' and kind in BUSINESS:
        if 'staff' not in roles:
            result['responsibleUserIds'] = [user_from(context).user_id]
        if kind in DISPLAY:
            result.setdefault('publication', 'internal')
        if kind in STATUS:
            result['status'] = 'draft'
    return result


def require_role_management(context, scope_id, target_user_id):
    """#77 must additionally validate target and atomically increment authzVersion."""
    user = user_from(context)
    _, capabilities = user.permissions()
    if target_user_id == user.user_id or not any(
            g['name'] == 'manageRoles' and g['scopeId'] == scope_id for g in capabilities):
        denied()


def require_reference(context, record, scope_id):
    if not record or record.get('scopeId') != scope_id:
        raise AuthError('INVALID_REFERENCE', 422)
    kind = record.get('entityType')
    if not allowed_roles(context, kind, 'read', record):
        raise AuthError('INVALID_REFERENCE', 422)


def require_assignee(user, scope_id, *, participant=False):
    roles = {'student'} if participant else {'staff', 'coordinator'}
    if (user is None or not user.active or not user.identity_verified
            or not any(g['scopeId'] == scope_id and g['role'] in roles
                       for g in user.permissions()[0])):
        raise AuthError('INVALID_REFERENCE', 422)
