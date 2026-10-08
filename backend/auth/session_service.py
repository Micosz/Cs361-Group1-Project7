"""Opaque sessions; independent of Lambda and DynamoDB for deterministic tests."""

from dataclasses import dataclass, field
import hashlib
import hmac
import re
import secrets
import time
from typing import Callable, Protocol
from urllib.parse import urlsplit

COOKIE_NAME = "__Host-cstuhub"
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}\Z")


class AuthError(Exception):
    def __init__(self, code: str, status: int = 401):
        self.code = code
        self.status = status
        super().__init__(code)  # Never put tokens or request data in errors.


@dataclass(frozen=True)
class SessionPolicy:
    origin: str
    csrf_secret: bytes = field(repr=False)
    idle_seconds: int = 1800
    absolute_seconds: int = 28800

    def __post_init__(self):
        parsed = urlsplit(self.origin)
        if (parsed.scheme != "https" or not parsed.netloc or parsed.username
                or parsed.password or parsed.path or parsed.query or parsed.fragment):
            raise ValueError("SESSION_ORIGIN must be an exact HTTPS origin")
        if len(self.csrf_secret) < 32:
            raise ValueError("CSRF secret requires at least 32 bytes")
        if not 0 < self.idle_seconds <= self.absolute_seconds:
            raise ValueError("Invalid session deadlines")


@dataclass(frozen=True)
class UserState:
    """Authoritative server snapshot supplied by account/role integration."""

    user_id: str
    active: bool
    authz_version: int
    identity_verified: bool
    display_name: str = ""
    grants: tuple = ()
    capabilities: tuple = ()

    def __post_init__(self):
        if (not isinstance(self.user_id, str) or not self.user_id
                or not isinstance(self.display_name, str) or type(self.active) is not bool
                or type(self.identity_verified) is not bool
                or type(self.authz_version) is not int or self.authz_version < 0):
            raise ValueError("Invalid authoritative user state")

    def permissions(self):
        if not self.identity_verified:
            return [], []
        grants = [
            {"role": g["role"], "scopeId": g["scopeId"]}
            for g in self.grants
            if isinstance(g, dict) and g.get("active") is True
            and g.get("role") in {"student", "coordinator", "staff", "executive"}
            and isinstance(g.get("scopeId"), str) and g["scopeId"]
        ]
        capabilities = [
            {"name": g["name"], "scopeId": g["scopeId"]}
            for g in self.capabilities
            if isinstance(g, dict) and g.get("active") is True
            and g.get("name") == "manageRoles"
            and isinstance(g.get("scopeId"), str) and g["scopeId"]
        ]
        return grants, capabilities


class SessionStore(Protocol):
    def create(self, record: dict) -> None: ...
    def get(self, token_hash: str) -> dict | None: ...
    def touch(self, token_hash: str, now: int, expires_at: int) -> bool: ...
    def delete(self, token_hash: str) -> None: ...
    def consume(self, token_hash: str, now: int) -> bool: ...


class UserReader(Protocol):
    def get(self, user_id: str) -> UserState | None: ...


@dataclass(frozen=True)
class IssuedSession:
    token: str = field(repr=False)
    csrf_token: str = field(repr=False)
    cookie: str = field(repr=False)


@dataclass(frozen=True)
class SessionContext:
    user: UserState | None
    absolute_expires_at: int


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def cookie_header(token: str, max_age: int) -> str:
    return (f"{COOKIE_NAME}={token}; Path=/; Secure; HttpOnly; "
            f"SameSite=Lax; Max-Age={max_age}")


def clear_cookie() -> str:
    return cookie_header("", 0) + "; Expires=Thu, 01 Jan 1970 00:00:00 GMT"


class SessionService:
    def __init__(self, store: SessionStore, users: UserReader, policy: SessionPolicy,
                 clock: Callable[[], float] = time.time):
        self.store, self.users, self.policy, self.clock = store, users, policy, clock

    def csrf_token(self, token: str) -> str:
        self._check_token(token)
        return hmac.new(self.policy.csrf_secret, token.encode("ascii"), "sha256").hexdigest()

    @staticmethod
    def _check_token(token):
        if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
            raise AuthError("AUTH_REQUIRED")

    def check_origin(self, origin: str | None):
        if origin != self.policy.origin:
            raise AuthError("ORIGIN_DENIED", 403)

    def check_csrf(self, token: str, origin: str | None, csrf: str | None):
        self.check_origin(origin)
        if (not isinstance(csrf, str) or not re.fullmatch(r"[a-f0-9]{64}", csrf)
                or not hmac.compare_digest(self.csrf_token(token), csrf)):
            raise AuthError("CSRF_DENIED", 403)

    def _issue(self, user: UserState | None) -> IssuedSession:
        now = int(self.clock())
        token = secrets.token_urlsafe(32)
        csrf = self.csrf_token(token)
        record = {
            "tokenHash": token_hash(token),
            "csrfHash": hashlib.sha256(csrf.encode("ascii")).hexdigest(),
            "createdAt": now, "lastSeenAt": now,
            "expiresAt": now + self.policy.idle_seconds,
            "absoluteExpiresAt": now + self.policy.absolute_seconds,
            "ttl": now + self.policy.absolute_seconds,
        }
        if user is not None:
            record.update(userId=user.user_id, authzVersion=user.authz_version)
        self.store.create(record)
        return IssuedSession(token, csrf, cookie_header(token, self.policy.absolute_seconds))

    def create_anonymous(self) -> IssuedSession:
        return self._issue(None)

    def validate(self, token: str | None, *, require_user: bool = True) -> SessionContext:
        self._check_token(token)
        key = token_hash(token)
        for _ in range(3):
            now = int(self.clock())
            row = self.store.get(key)
            if not row:
                raise AuthError("AUTH_REQUIRED")
            if (not all(type(row.get(k)) is int for k in
                        ("expiresAt", "absoluteExpiresAt", "lastSeenAt"))
                    or row.get("revokedAt") is not None
                    or not isinstance(row.get("csrfHash"), str)
                    or not hmac.compare_digest(row["csrfHash"],
                           hashlib.sha256(self.csrf_token(token).encode("ascii")).hexdigest())):
                raise AuthError("SESSION_REVOKED")
            if now >= min(row["expiresAt"], row["absoluteExpiresAt"]):
                self.store.delete(key)
                raise AuthError("SESSION_EXPIRED")
            user = None
            if "userId" in row:
                user = self.users.get(row["userId"])
                if (user is None or not user.active
                        or type(row.get("authzVersion")) is not int
                        or row["authzVersion"] != user.authz_version):
                    self.store.delete(key)
                    raise AuthError("SESSION_REVOKED")
            if require_user and user is None:
                raise AuthError("AUTH_REQUIRED")
            expires = min(now + self.policy.idle_seconds, row["absoluteExpiresAt"])
            # A later concurrent request may already have refreshed this session.
            # Never shorten its deadline, recreate a deleted record, or resurrect expiry.
            if row["lastSeenAt"] > now or self.store.touch(key, now, expires):
                return SessionContext(user, row["absoluteExpiresAt"])
        raise AuthError("SESSION_REVOKED")

    def issue_authenticated(self, user_id: str, prior_token: str,
                            origin: str, csrf: str) -> IssuedSession:
        """SERVER ONLY: #74/#76 call after TU success and account linking.

        Do not expose an HTTP route accepting a user ID to call this method.
        The pre-login token is consumed once, preventing fixation and double issuance.
        """
        self.check_csrf(prior_token, origin, csrf)
        self.validate(prior_token, require_user=False)
        user = self.users.get(user_id)
        if user is None or not user.active:
            raise AuthError("AUTH_REQUIRED")
        if not self.store.consume(token_hash(prior_token), int(self.clock())):
            raise AuthError("SESSION_REVOKED")
        return self._issue(user)

    def logout(self, token: str | None, origin: str | None, csrf: str | None):
        self.check_origin(origin)
        if token is None:
            return  # Already logged out; no server state is changed.
        self.check_csrf(token, origin, csrf)
        # No validation/touch: logout must also work for expired/revoked sessions.
        self.store.delete(token_hash(token))

    def state(self, token: str):
        context = self.validate(token, require_user=False)
        user = context.user
        grants, capabilities = user.permissions() if user else ([], [])
        return {
            "user": ({"id": user.user_id, "displayName": user.display_name,
                      "identityVerified": user.identity_verified} if user else None),
            "grants": grants, "capabilities": capabilities,
            "csrfToken": self.csrf_token(token),
        }
