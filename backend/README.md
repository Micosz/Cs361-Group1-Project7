# Session backend — #78

Python implementation of the [session baseline](../docs/design/v3/authentication-session.md).
This directory is server code; Amplify currently publishes `public/` only. No AWS
resources, routing, or frontend authentication are provisioned by this change.

## Run checks

From the repository root, using Python 3.12+:

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python -m unittest discover -s backend/tests -v
npm test
```

The Python suite exercises lifecycle/HTTP behavior using a deterministic test
store, and DynamoDB request contracts using botocore Stubber. It makes no AWS/TU
requests. GitHub Actions runs the backend suite separately from frontend checks.

## What is implemented

- `auth/session_service.py`: anonymous bootstrap, trusted authenticated issuance,
  token rotation, validation, expiry, role-version revocation, CSRF, logout.
- `auth/session_store.py`: DynamoDB session and authoritative user adapters.
- `http_api.py`: API Gateway HTTP API **payload v2.0** routes.
- `auth/require_session.py`: authenticated request/CSRF guard for #79.
- `lambda_function.py`: lazy production wiring; dependency failures return 503.

| Route | Behavior |
| --- | --- |
| `GET /api/auth/session` | Without a cookie, create anonymous state and return CSRF token. With a valid cookie, return current user/grants/capabilities/CSRF. |
| `POST /api/auth/logout` | Require exact Origin; with a cookie also require its CSRF token. Delete server session and expire cookie. Repeated logout succeeds. |

All responses use `Cache-Control: no-store`. Invalid existing cookies return 401
and an expired cookie; they do not silently become a new anonymous login. The
client may then request fresh anonymous state. No login-by-user-ID route exists.

Sessions use 32 random bytes; only SHA-256 token hashes and CSRF hashes are stored.
The raw token is delivered only through `__Host-cstuhub`, with `Secure`, `HttpOnly`,
`SameSite=Lax`, `Path=/`, no Domain, and an eight-hour cookie lifetime. Backend idle
expiry is 30 minutes and absolute expiry eight hours; activity cannot extend the
absolute deadline. DynamoDB TTL is cleanup only. Expiry is checked on every use.

## Integration with #74 / #76 / #77 / #79 / #80

**#74/#76** must verify TU credentials and link the identity **on the server**
before calling this internal method:

```python
from backend.lambda_function import build_service
from backend.http_api import headers, session_cookie, response

service = build_service()
request_headers = headers(event)
prior = session_cookie(event)
# Before calling TU: check Origin/CSRF and validate the bootstrap session.
service.check_csrf(prior, request_headers.get("origin"),
                   request_headers.get("x-csrf-token"))
service.validate(prior, require_user=False)
# Apply login rate limits, verify TU response and link account here (#74/#76).
# linked_user_id comes from that trusted server result, never request JSON.
issued = service.issue_authenticated(
    linked_user_id, prior, request_headers.get("origin"),
    request_headers.get("x-csrf-token"),
)
result = response(200, service.state(issued.token), issued.cookie)
```

This is an integration sketch, not an implemented TU login endpoint. The prior
session is consumed atomically once before issuance, preventing replay/fixation.
Do not return `issued.token` in JSON or logs; return `issued.cookie` through the
HTTP API v2 `cookies` response field. Passwords/TU credentials are never inputs to
the session service.

**#79** wraps protected business handlers with `require_session(event, service)`.
It returns an authoritative `SessionContext`; checking the action, role, scope,
record ownership and provisional-account restrictions remains #79's responsibility.
An authenticated no-role user is valid but receives no business permissions.

**#76/#77 user contract:** the supplied `DynamoUserReader` expects a table with
partition key `id` (String), and one authoritative row containing:

```json
{
  "id": "application-user-uuid", "active": true,
  "identityVerified": true, "authzVersion": 1, "displayName": "Student",
  "grants": [{"role": "student", "scopeId": "cs", "active": true}],
  "capabilities": []
}
```

Grants project only active baseline roles and `scopeId`; capabilities project
only active `manageRoles` grants. Unverified identities project neither. This is
an **adapter contract**, not a migration of existing public data or a decision to
remove the separate logical RoleGrant entity in the design. If #76/#77 choose a
different physical layout, inject another `UserReader` with the same interface.
Maintain the materialized grants/capabilities snapshot and increment `authzVersion`
**atomically** when adding/removing/changing roles or capabilities. If separate
RoleGrant rows exist, update them and this snapshot/version in one transaction.
Default eventual/GSI reads do not satisfy this contract.

Every authenticated request strongly reads the user row; inactive/deleted users
or version mismatches revoke the old session with 401 `SESSION_REVOKED`. A committed
change therefore takes effect on the **next validation that reads after the
commit**, without waiting for TTL or a cache interval. A request already validated
before a logout/role change can finish; recheck within the business transaction
if an operation needs a stronger concurrency guarantee. Other devices must login
again after a version change; logging out revokes only the current session shared
by tabs in that browser.

**#80 client behavior:** fetch same-origin `/api/auth/session` with cookies; keep
the returned CSRF token only in memory and send it as `X-CSRF-Token` on mutations.
Never put session credentials in local/session storage, URLs, or public bundles.
On 401 clear cached user/protected data and show login; on 503 show unavailable.
After logout clear in-memory data and notify other tabs (e.g. BroadcastChannel);
on tab focus and `pageshow` refetch state before displaying cached protected data.
The server already rejects old credentials across tabs; visual tab synchronization
still belongs to frontend integration. Previously downloaded content cannot be
retracted by a server logout.

## Deployment contract (not executed)

Package `backend/` at the Lambda zip root, with dependencies, and use handler
`backend.lambda_function.handler`. Set:

| Environment | Value |
| --- | --- |
| `SESSION_TABLE` | Separate DynamoDB table, String partition key `tokenHash`, TTL attribute `ttl` |
| `USER_TABLE` | Authoritative user table described above, String partition key `id` |
| `SESSION_ORIGIN` | Exact HTTPS origin, e.g. `https://hub.example.edu` (no trailing slash) |
| `SESSION_CSRF_SECRET` | Base64-encoded cryptographically random secret of at least 32 bytes |
| `AWS_REGION` | Region containing both tables |

Keep the secret stable across warm/cold instances; rotating it invalidates existing
CSRF hashes/sessions. Supply it through protected runtime configuration; never
commit it. Use a regional authoritative user table, with session/user reads and
writes in the same region; multi-region eventual replicas are outside this policy.

Grant Lambda only GetItem/PutItem/UpdateItem/DeleteItem on the session table and
GetItem on the user table. Route `/api/auth/session` and `/api/auth/logout` through
the **same HTTPS origin** as the frontend, preserving these exact `rawPath` values;
HTTP API custom-domain mappings can strip prefixes, so verify them before launch.
Do not cache these API responses at a CDN. Configure API throttling and login
rate limits, and disable request/response body, Cookie, Set-Cookie, password and
CSRF logging in gateway/proxy/APM instrumentation. The modules themselves emit no
request or credential logs and return generic dependency errors.

References: [HTTP API v2 cookies and paths](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html),
[DynamoDB conditional operations](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html).

## Evidence and remaining acceptance checks

Local checks: **33 Python tests passed**, including SDK stubs; the existing three
frontend test files also passed. Local runtime: Python 3.14.7, boto3 1.43.104.
CI targets Python 3.12. This is local/mock evidence, not an AWS/TU integration test.

Before closing #78, connect #76/#77 and #74/#79/#80, deploy the same-origin routes,
then verify in an HTTPS browser and against a protected API: valid/missing/tampered/
expired session; logout and replay in another tab; committed role-version change
and subsequent denial; outage handling; cookie flags and no credential logs.
The integration dependencies are still open, so #78 should stay open until these
checks pass. No AWS resources or real user roles were changed by this implementation.
