"""#76 account linking. Only the server TU provider may supply this profile."""
from datetime import datetime, timezone
import hashlib
import hmac
import re
import uuid
from .session_service import AuthError


class AccountService:
    def __init__(self, store, secret, student_scope):
        if len(secret) < 32 or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', student_scope):
            raise ValueError('Invalid identity configuration')
        self.store, self.secret, self.scope = store, secret, student_scope

    def link(self, profile):
        username, kind = profile.get('username'), profile.get('type')
        if (not isinstance(username, str) or not username.strip() or len(username) > 128
                or any(ord(c) < 32 for c in username) or kind not in {'student', 'employee'}):
            raise AuthError('AUTH_PROVIDER_INVALID_RESPONSE', 502)
        subject = 'tu-username-v1:' + hmac.new(self.secret, ('tu\0' + username).encode(), hashlib.sha256).hexdigest()
        found = self.store.pair(subject)
        if found:
            return self._existing(subject, kind, found)
        student = kind == 'student'
        user_id = str(uuid.uuid4())
        name = profile.get('displayname_th') or profile.get('displayname_en') or 'TU user'
        if not isinstance(name, str) or len(name) > 200:
            raise AuthError('AUTH_PROVIDER_INVALID_RESPONSE', 502)
        user = dict(id=user_id, displayName=name, active=True, identityVerified=student,
                    authzVersion=1, tuType=kind, subjectKey=subject, grants=[], capabilities=[])
        if student:
            user.update(studentGrantScopeId=self.scope, autoStudentPolicyVersion=1)
            user['grants'] = [dict(id=str(uuid.uuid4()), role='student', scopeId=self.scope, active=True,
                grantedBy='system:tu-authentication', grantedAt=datetime.now(timezone.utc).isoformat())]
        link = dict(subjectKey=subject, provider='tu', userId=user_id,
                    verification='verified' if student else 'provisional')
        # Store returns False ONLY for a conditional mapping race; other errors propagate.
        if self.store.create_pair(user, link):
            return user
        winner = self.store.pair(subject)
        if not winner:
            raise AuthError('IDENTITY_STORE_BUSY', 503)
        return self._existing(subject, kind, winner)

    def _existing(self, subject, kind, pair):
        link, user = pair
        if (not link or not user or link.get('provider') != 'tu'
                or link.get('subjectKey') != subject or user.get('subjectKey') != subject
                or link.get('userId') != user.get('id') or user.get('tuType') != kind
                or (link.get('verification') == 'verified') != user.get('identityVerified')
                or link.get('verification') not in {'verified', 'provisional'}
                or type(user.get('active')) is not bool
                or type(user.get('identityVerified')) is not bool
                or type(user.get('authzVersion')) is not int or user['authzVersion'] < 1
                or (kind == 'student' and (user.get('studentGrantScopeId') != self.scope
                    or user.get('autoStudentPolicyVersion') != 1))):
            raise AuthError('IDENTITY_REVIEW_REQUIRED', 409)
        if not user['active']:
            raise AuthError('ACCOUNT_DISABLED', 403)
        # Never restore removed grants or change identity aliases on repeat login.
        return user
