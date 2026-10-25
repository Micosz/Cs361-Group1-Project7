"""Default-deny authorization. Inputs are server records and SessionContext only."""

from ..auth.session_service import AuthError

BUSINESS = {'partner', 'activity', 'agreement', 'exchange'}
CHILDREN = {'contact', 'history', 'document', 'feedback'}
DISPLAY = {
    'partner': {'name', 'type', 'summary', 'fullDescription', 'location', 'websiteUrl', 'logoPath'},
    'activity': {'title', 'type', 'summary', 'fullDescription', 'partnerId',
                 'coHostPartnerIds', 'periodText', 'periodDate', 'imagePath', 'outcomeSummary'},
}
WRITABLE = {
    **DISPLAY,
    'agreement': {'title', 'agreementType', 'partnerIds', 'startDate', 'endDate',
                  'renewalDueOn', 'renewalNote', 'internalNote'},
    'exchange': {'title', 'partnerIds', 'agreementId', 'participantUserIds',
                 'startDate', 'endDate', 'supportingInfo', 'supportingInfoForParticipant', 'outcomeSummary'},
    'contact': {'name', 'position', 'email', 'phone'},
    'history': {'occurredOn', 'kind', 'note', 'referenceType', 'referenceId'},
    'feedback': {'occurredOn', 'sourceType', 'comment', 'improvement', 'respondentName'},
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
        return ({'student', 'coordinator', 'staff', 'executive'} if kind in {'activity', 'agreement', 'exchange', 'document', 'feedback'}
                else {'coordinator', 'staff'} if kind == 'contact'
                else {'coordinator', 'staff', 'executive'})
    if action == 'create':
        return ({'staff'} if kind == 'partner'
                else {'student', 'coordinator', 'staff'} if kind == 'feedback'
                else {'coordinator', 'staff'})
    if action == 'update':
        return ({'student', 'coordinator', 'staff'} if kind == 'feedback'
                else {'coordinator', 'staff'} if kind != 'document'
                else set())
    if action == 'status' and kind in STATUS:
        return {'coordinator', 'staff'}
    if action in {'upload', 'delete'} and kind == 'document':
        return {'coordinator', 'staff'}
    if action == 'delete' and kind == 'contact':
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
        elif kind == 'feedback':
            if (parent.get('entityType') not in {'activity', 'exchange'}
                    or record.get('parentId') != parent['id']
                    or record.get('parentType') != parent['entityType']):
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
    if kind == 'feedback' and action == 'update' and record.get('createdBy') != user.user_id:
        roles -= {'staff', 'coordinator', 'student'}
    if not linked(base, 'responsibleUserIds', user.user_id):
        roles.discard('coordinator')
    from ..relationships.activity_links import published
    student_agreement = (kind == 'agreement' and action == 'read'
                      and base.get('publication') == 'public')
    student_activity = (base.get('entityType') == 'activity' and published(base)
                        and (kind == 'activity' and action == 'read'
                             or kind == 'feedback' and action in {'read', 'create', 'update'}))
    if not (student_agreement or student_activity) and (base.get('entityType') != 'exchange'
            or not linked(base, 'participantUserIds', user.user_id)):
        roles.discard('student')
    if kind == 'document':
        if record.get('uploadState') == 'deleted':
            return set()
        if action == 'delete' and record.get('uploadState') != 'ready':
            return set()
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
    fields = set() if action == 'delete' else (set(STATUS.get(kind, ())) if action == 'status' else set(WRITABLE.get(kind, ())))
    if action == 'create' and kind in BUSINESS:
        fields.add('scopeId')
    if 'staff' in roles and action != 'status' and kind in BUSINESS:
        fields.add('responsibleUserIds')
        if kind in DISPLAY:
            fields.add('publication')
    if kind == 'agreement' and action in {'create', 'update'} and 'staff' in roles:
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


def require_role_management_scope(context, scope_id):
    """Require the scoped capability before exposing any role-management data."""
    _, capabilities = user_from(context).permissions()
    if not any(g['name'] == 'manageRoles' and g['scopeId'] == scope_id for g in capabilities):
        denied()


def require_role_management(context, scope_id, target_user_id):
    """#77 must additionally validate target and atomically increment authzVersion."""
    user = user_from(context)
    require_role_management_scope(context, scope_id)
    if target_user_id == user.user_id:
        denied()


def can_reference(context, record, scope_id):
    if not record or record.get('scopeId') != scope_id:
        return False
    if allowed_roles(context, record.get('entityType'), 'read', record):
        return True
    # A public organization may be linked without granting access to its
    # internal management record, contacts, history or editing permissions.
    from ..relationships.activity_links import published
    return (record.get('entityType') == 'partner'
            and record.get('source_state') != 'retired' and published(record)
            and bool(matching_roles(context, record) & {'staff', 'coordinator'}))


def require_reference(context, record, scope_id):
    if not can_reference(context, record, scope_id):
        raise AuthError('INVALID_REFERENCE', 422)


def require_assignee(user, scope_id, *, participant=False):
    roles = {'student'} if participant else {'staff', 'coordinator'}
    if (user is None or not user.active or not user.identity_verified
            or not any(g['scopeId'] == scope_id and g['role'] in roles
                       for g in user.permissions()[0])):
        raise AuthError('INVALID_REFERENCE', 422)
