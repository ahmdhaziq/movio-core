# Authentication HTTP Contract

Native clients send explicit credentials over HTTPS (loopback HTTP allowed for development). No cookies or server-session mechanism introduced. Never send tokens in URLs. Access authentication is stateless; renewal and logout use stored refresh evidence.

## Routes

| Endpoint | Mode | Request | Success |
|---|---|---|---|
| POST /auth/register | public | Existing registration DTO | Existing 201 user only, no login tokens |
| POST /auth/login | public | `{ "provider": "local", "email": "ada@example.com", "password": "SyntheticPass9!" }` | 200 token result |
| POST /auth/refresh | refresh | `{ "refresh_token": "<refresh JWT>" }` | 200 replacement pair |
| POST /auth/logout | logout | `{ "token_type": "access" or "refresh", "token": "<JWT>" }` | 200 `{ "message": "Signed out" }` |
| GET / | public | Existing root greeting/health | Existing result |
| GET /user/list | access | Existing query plus bearer | Existing safe profile results |
| GET /user/:id | access | Existing ID plus bearer | Existing safe profile result |
| Other business routes | access default | Bearer | Existing operation contract |

Exactly one Authorization: Bearer <access JWT> header on guarded requests. Reject duplicate/malformed headers, access tokens exceeding 4,096 characters, refresh bearer, and cookie/query tokens. The module-owned bearer extractor only reads the token; AuthService validates it with Nest JwtService before the guard attaches request.user. Refresh/logout use body credentials only and do not fall back to headers if body verification fails. Metadata exemptions are explicitly limited to their intended routes.

## Token result

```json
{
  "user": { "id": 1, "name": "Ada", "email": "ada@example.com" },
  "token_type": "Bearer",
  "access_token": "<access JWT>",
  "refresh_token": "<refresh JWT>",
  "access_expires_at": "2026-10-16T11:00:00.000Z",
  "refresh_expires_at": "2026-11-15T10:00:00.000Z"
}
```

Example login at 2026-10-16T10:00:00Z. Access initially expires after 3,600 seconds; renewal ends after 2,592,000 seconds. Refresh preserves refresh_expires_at and caps access expiry at it. UTC ISO-8601 dates; Cache-Control: no-store on all auth responses. No hash, identity metadata or role fields. Refresh returns safe user from its account eligibility lookup.

Mobile clients store both tokens, replace refresh on successful renewal and serialize refresh requests. Reusing a consumed credential revokes further renewal for that login, including any concurrent replacement refresh. Already issued access JWTs remain valid until exp. Lost refresh responses can require login. Client secure-storage implementation is outside this backend scope.

## Logout and account lifecycle

Logout revokes the presented credential's refresh family. Client clears its stored access/refresh credentials. Logout does not invalidate a copied or outstanding access token: it remains accepted until its signed expiry (at most one hour). No database lookup by the access guard. Separate logins are unaffected.

Deleted/inactive users cannot log in or renew. Previously issued access still authenticates until exp; existing resource/business eligibility checks are separate. Auth storage outage does not by itself prevent valid access authentication, though the requested business operation may require storage.

Repeated logout and supplied unknown/malformed/expired credentials return the same Signed out result. A valid, owner-matching access token or digest-matching refresh (including consumed refresh) may revoke only its own family. Missing credentials return 401. If required database work fails, return 503 instead of claiming revocation succeeded.

## Validation and failures

POST /auth/login is provider-selected. The current concrete local request remains `{ provider: local, email, password }`; LoginDto represents the generic provider-discriminated request, and LoginValidationPipe selects and validates its concrete DTO. Only local is enabled now. Unknown, reserved or unimplemented providers return 400 before authentication. A future enabled provider can define different credential fields without being forced to submit email/password, but adding a provider requires its own implemented and verified strategy; an enum value alone does not enable it. There is no nested payload wrapper or additional social-login flow in this increment.

Whitelist against the selected concrete provider DTO; reject unsupported fields/provider. For local, reject invalid text/email. Trim/lowercase email, preserve password exactly. Login password must be nonempty text <=128 Unicode code points (existing maximum), without registration's complexity/minimum-eight rules. Refresh/logout token text nonempty, <=4,096 ASCII characters. Invalid JWT syntax within size bound is an authentication failure. Logout token_type must be access or refresh; missing credentials 401, unsupported fields/type 400. No input values, password or token contents in field errors.

Envelope example: `{ "statusCode": 401, "code": "AUTHENTICATION_REQUIRED", "message": "Authentication is required" }`.

| Status | Code | Meaning |
|---|---|---|
| 400 | VALIDATION_ERROR | Safe errors [{field,code,message}] |
| 401 | AUTHENTICATION_FAILED | Login failure; identical Email or password is incorrect for unknown/mismatch/deleted/missing local credentials |
| 401 | AUTHENTICATION_REQUIRED | Missing/invalid/expired/wrong-purpose access or unusable refresh; no detailed reason |
| 429 | AUTH_RATE_LIMITED | Login/refresh bucket exhausted; Retry-After integer seconds |
| 503 | AUTH_TEMPORARILY_UNAVAILABLE | Required login/refresh/logout state unavailable |
| 500 | INTERNAL_ERROR | Unexpected/configuration failure, sanitized |

Preserve registration's existing 400/409/429/503/500 codes/messages. Guard rejection precedes business behavior/DTO processing. Authenticated user operations retain existing 400/404 behavior. No role/ownership authorization feature is introduced.

Ten login and ten refresh attempts per 60 seconds per trusted IP, independent buckets counting all attempts. Registration retains own bucket; logout and ordinary guarded routes are outside these limits. In-memory limiter supports one instance; shared storage required before replicas and only configured proxies may supply trusted forwarded IPs.

Audit UTC time, operation, outcome, duration and one request correlation ID. Never log email, raw bodies, token/hash contents or internal diagnostics. Invalid access fails closed despite absence of persistence checks; valid stateless access is not converted to 503 just because the database is down.
