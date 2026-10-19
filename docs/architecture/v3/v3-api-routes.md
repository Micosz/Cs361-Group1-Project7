# CSTUHub API route map

Companion to [the V3 architecture diagram](v3-architecture-diagram.png). The architecture diagram stays at service level; this document lists the route templates found in the current checkout so the diagram does not need to carry every HTTP path.

**Evidence boundary:** source inspection only, 19 October 2026. These routes are not proof that every route is deployed or enabled in AWS. In [`backend/lambda_function.py`](../../../backend/lambda_function.py), the integrated application is selected only when `AUTH_V3_ENABLED=true`; otherwise the handler falls back to the session-only transport. Verify the deployed Lambda configuration, API Gateway integration, and Amplify rewrite before describing a source route as live. No AWS configuration was changed for this inventory.

## Browser and public catalog

| Method and route | Access / behavior | Service or data path | Source |
|---|---|---|---|
| `GET /api/auth/session` | Anonymous or signed-in session state; creates an anonymous session when no cookie exists | `CSTUHubAuth` session service; DynamoDB Sessions and Users | [`http_api.py`](../../../backend/http_api.py) |
| `POST /api/auth/login` | Starts a session after CSRF/origin checks and login rate limiting | `CSTUHubAuth` → IAM invoke `tuAuthLogin` → TU API; links User/Identity and issues session | [`application.py`](../../../backend/application.py), [`lambda_function.py`](../../../backend/lambda_function.py) |
| `POST /api/auth/logout` | Requires a valid session and CSRF/origin checks; expires the cookie/session | `CSTUHubAuth` → DynamoDB Sessions | [`http_api.py`](../../../backend/http_api.py) |
| `GET /api/public/records` | Anonymous; returns only the public projection; rejects query parameters | Integrated application repository → DynamoDB business records | [`application.py`](../../../backend/application.py), [`projections.py`](../../../backend/permissions/projections.py) |
| `GET /api/overview` | Signed-in Executive in scope; summary counts and statuses | Integrated application repository → business records | [`gateway.py`](../../../backend/permissions/gateway.py) |
| `GET /api/selection-partners?scopeId={scopeId}` | Signed-in Coordinator or Staff with a matching scope grant | Integrated application → business Partner records | [`application.py`](../../../backend/application.py) |
| `GET /api/selection-users?scopeId={scopeId}&kind=participant\|responsible` | Signed-in; `participant` requires Coordinator/Staff in scope, `responsible` requires Staff in scope | Integrated application → account/user store | [`application.py`](../../../backend/application.py) |
| `GET /api/users/{userId}/roles?scopeId={scopeId}` | Requires `manageRoles` capability for the requested scope and target | Integrated application → user/role store | [`application.py`](../../../backend/application.py) |
| `PATCH /api/users/{userId}/roles` | Same capability; requires `If-Match` version header; no query string | Integrated application → user/role store; invalidates stale authorization versions | [`application.py`](../../../backend/application.py) |

### Public catalog legacy path

The homepage first calls `GET https://eb49u61kph.execute-api.us-east-1.amazonaws.com/default/fetchPartnersData` from [`public/assets/script.js`](../../../public/assets/script.js). If that fails, it loads `public/data/partner-data-backup.json`. When auth is enabled, it also requests `/api/public/records` and merges those explicitly public records. This means public browsing has a legacy data-function path and a same-origin API path; the diagram should not imply that every public catalog request goes through the generic `/api/*` rewrite.

## Business records

Every route below uses the integrated permission gateway. A signed-in session is required. Access is additionally checked against role, scope, assignment, parent record, and (for participant routes) participation. Lists support paging; supported query parameters are validated by the handler.

| Resource | List / create | Read / update | Additional route | Source |
|---|---|---|---|---|
| Partners | `GET /api/partners` · `POST /api/partners` | `GET /api/partners/{partnerId}` · `PATCH /api/partners/{partnerId}` | — | [`gateway.py`](../../../backend/permissions/gateway.py) |
| Activities | `GET /api/activities` · `POST /api/activities` | `GET /api/activities/{activityId}` · `PATCH /api/activities/{activityId}` | Feedback routes below | [`gateway.py`](../../../backend/permissions/gateway.py) |
| Agreements | `GET /api/agreements` · `POST /api/agreements` | `GET /api/agreements/{agreementId}` · `PATCH /api/agreements/{agreementId}` | `POST /api/agreements/{agreementId}/status` · documents below | [`gateway.py`](../../../backend/permissions/gateway.py) |
| Exchanges | `GET /api/exchanges` · `POST /api/exchanges` | `GET /api/exchanges/{exchangeId}` · `PATCH /api/exchanges/{exchangeId}` | `POST /api/exchanges/{exchangeId}/status` · feedback and documents below | [`gateway.py`](../../../backend/permissions/gateway.py) |

Role summary from [`policy.py`](../../../backend/permissions/policy.py): Staff can create and manage records in their granted scope; Coordinators can create/manage permitted work they are responsible for; Executives are read-only for non-personal information; Students have the participant-only Exchange routes below. Partner creation is Staff-only. The backend policy is authoritative; frontend menu visibility is not an access control.

## Nested resources

| Method and route | Access / behavior | Storage path |
|---|---|---|
| `GET /api/partners/{partnerId}/contacts` · `POST /api/partners/{partnerId}/contacts` | Coordinator/Staff with parent access | DynamoDB business records |
| `GET /api/partners/{partnerId}/contacts/{contactId}` · `PATCH /api/partners/{partnerId}/contacts/{contactId}` | Coordinator/Staff with parent access | DynamoDB business records |
| `GET /api/partners/{partnerId}/history` · `POST /api/partners/{partnerId}/history` | Read includes Executive; create requires Coordinator/Staff with parent access | DynamoDB business records |
| `GET /api/partners/{partnerId}/history/{historyId}` · `PATCH /api/partners/{partnerId}/history/{historyId}` | Read includes Executive; update requires Coordinator/Staff with parent access | DynamoDB business records |
| `GET /api/{activities\|exchanges}/{recordId}/feedback` · `POST /api/{activities\|exchanges}/{recordId}/feedback` | Coordinator/Staff with parent access; Executive read-only | DynamoDB business records; response projection omits respondent name for Executive |
| `GET /api/{activities\|exchanges}/{recordId}/feedback/{feedbackId}` · `PATCH /api/{activities\|exchanges}/{recordId}/feedback/{feedbackId}` | Coordinator/Staff with parent access; Executive read-only | DynamoDB business records |
| `GET /api/{agreements\|exchanges}/{recordId}/documents` · `POST /api/{agreements\|exchanges}/{recordId}/documents` | Coordinator/Staff with parent access; Student can read participant-audience documents on their own Exchange; Executive can read eligible internal documents | Metadata in DynamoDB; private object in S3 |
| `GET /api/documents/{documentId}` | Read only, after access check against the parent record and audience | DynamoDB metadata |
| `GET /api/documents/{documentId}/content?disposition=inline\|attachment` | Streams authorized private file content; query accepts only the optional disposition | API → private S3 storage adapter; no public object URL is returned |
| `GET /api/me/exchanges` · `GET /api/me/exchanges/{exchangeId}` | Student participant projection for own Exchanges; read only | DynamoDB business records |
| `GET /api/me/exchanges/{exchangeId}/documents` | Student participant-audience documents for own Exchange; read only | DynamoDB metadata and private S3 content path |

There is no `DELETE` route in this gateway. Status changes are separate `POST` operations and require a version precondition. `PATCH` updates and status changes require `If-Match`; create/upload requests require an `Idempotency-Key`.

## Diagram relationship

Keep the main diagram at the service/traffic level. Its API Gateway → Lambda edge can be labeled `same-origin /api/*`; this route map carries the individual paths and access rules. Show the `fetchPartnersData` public-catalog call as its own legacy path (plus local JSON fallback), because the current frontend source still uses it. Keep `tuAuthLogin` and TU API on the server-side login flow, and show S3 only as private document storage behind the API authorization check.

## Verification needed before claiming live coverage

- Confirm which Amplify branch is being described and inspect its current `/api/<*>` rewrite.
- Confirm API Gateway route and deployed Lambda target/configuration, especially `AUTH_V3_ENABLED` and repository/table/bucket variables.
- Smoke-test representative anonymous, authenticated, forbidden, and private-document routes against the intended environment. Source routes and unit tests alone do not establish deployed behavior.
