"""Optional course test accounts. Passwords and roles are never browser authority."""
import hashlib
import hmac
import json
import re
from .session_service import AuthError

ITERATIONS = 600_000
PREFIX = 'course.'


def password_digest(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), ITERATIONS).hex()


class CourseProvider:
    def __init__(self, tu_provider, enabled=False, configuration='[]'):
        self.tu, self.enabled, self.entries = tu_provider, enabled, {}
        if not enabled:
            return
        try:
            entries = json.loads(configuration)
            if not isinstance(entries, list) or not 1 <= len(entries) <= 12:
                raise ValueError()
            for entry in entries:
                if (set(entry) != {'username', 'userId', 'salt', 'passwordHash'}
                        or not re.fullmatch(r'course\.[a-z0-9-]{1,30}', entry['username'])
                        or not re.fullmatch(r'[a-f0-9-]{36}', entry['userId'])
                        or not re.fullmatch(r'[a-f0-9]{32}', entry['salt'])
                        or not re.fullmatch(r'[a-f0-9]{64}', entry['passwordHash'])
                        or entry['username'] in self.entries):
                    raise ValueError()
                self.entries[entry['username']] = entry
        except (ValueError, TypeError, KeyError):
            raise ValueError('Invalid course account configuration') from None

    def authenticate(self, username, password):
        if not username.startswith(PREFIX):
            return self.tu.authenticate(username, password)
        # Reserved test usernames never fall back to TU, including disabled/wrong-password cases.
        entry = self.entries.get(username) if self.enabled else None
        candidate = password_digest(password, entry['salt'] if entry else '00' * 16)
        if not entry or not hmac.compare_digest(candidate, entry['passwordHash']):
            raise AuthError('INVALID_CREDENTIALS', 401)
        return {'provider': 'course-test', 'userId': entry['userId']}


class CourseAccounts:
    def __init__(self, tu_accounts, store):
        self.tu, self.store = tu_accounts, store

    def link(self, profile):
        if profile.get('provider') != 'course-test':
            return self.tu.link(profile)
        user = self.store.user(profile['userId'])
        if not user or user.get('authProvider') != 'course-test' or user.get('identityVerified') is not True:
            raise AuthError('AUTH_REQUIRED')
        if user.get('active') is not True:
            raise AuthError('ACCOUNT_DISABLED', 403)
        # Never recreate accounts or restore grants. Use current authoritative roles/version.
        return user
