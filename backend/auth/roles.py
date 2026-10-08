"""#77: scoped capability authorization; role changes invalidate old Sessions."""
from copy import deepcopy
from datetime import datetime, timezone
import uuid
from .session_service import AuthError
from ..permissions.policy import require_role_management

ROLES = {'student', 'coordinator', 'staff', 'executive'}


class RoleService:
    def __init__(self, store):
        self.store = store

    def update(self, context, target_id, payload, expected_version, session_hash, now):
        if (not isinstance(payload, dict) or set(payload) - {'scopeId', 'roles', 'confirmIdentity'}
                or not isinstance(payload.get('scopeId'), str) or not payload['scopeId']
                or not isinstance(payload.get('roles'), list)
                or not all(isinstance(r, str) and r in ROLES for r in payload['roles'])
                or len(set(payload['roles'])) != len(payload['roles'])
                or type(payload.get('confirmIdentity', False)) is not bool):
            raise AuthError('INVALID_FIELDS', 422)
        scope = payload['scopeId']
        require_role_management(context, scope, target_id)
        original = self.store.user(target_id)
        if not original or not original.get('active'):
            raise AuthError('NOT_FOUND', 404)
        if original.get('authzVersion') != expected_version:
            raise AuthError('VERSION_CONFLICT', 409)
        if not original.get('identityVerified') and payload.get('confirmIdentity') is not True:
            raise AuthError('IDENTITY_REVIEW_REQUIRED', 409)
        updated = deepcopy(original)
        # Replace grants ONLY in the manager's selected scope, preserving others.
        updated['grants'] = [g for g in original.get('grants', []) if g.get('scopeId') != scope]
        timestamp = datetime.fromtimestamp(now, timezone.utc).isoformat()
        updated['grants'] += [dict(id=str(uuid.uuid4()), role=r, scopeId=scope, active=True,
                                  grantedBy=context.user.user_id, grantedAt=timestamp) for r in payload['roles']]
        updated['identityVerified'] = True
        updated['authzVersion'] = expected_version + 1
        updated['updatedBy'] = context.user.user_id
        updated['updatedAt'] = timestamp
        # Storage rechecks manager + target + Session + identity link atomically.
        self.store.save_roles(context, original, updated, session_hash, now)
        return {'id': target_id, 'authzVersion': updated['authzVersion'],
                'grants': [g for g in updated['grants'] if g.get('scopeId') == scope]}
