# Internal Auth Contracts and Verification Paths

## Existing provider strategy

Keep register(context) and add two provider-keyed maps:

| Contract | Enabled mapping now | Responsibility |
|---|---|---|
| LoginRequestMap | Local → LoginLocalDto `{ provider: local, email, password }` | Concrete runtime DTO for HTTP field validation |
| AuthenticationPayloadMap | Local → AuthenticateLocalDto `{ email, password }` | Strategy-specific credential input after validated dispatch |
| LoginDto | Union of LoginRequestMap values, discriminated by provider | Generic controller request type; not a decorated runtime class |
| AuthenticatedUserDto | `{ user: { id, name, email }, authIdentityId }` | Shared safe result from all strategies |

Controller accepts LoginDto through a parameter-level LoginValidationPipe. It separates provider from credentials and invokes the corresponding AuthService.login(provider,input). Preserve the relationship between selector and input using discriminated argument types/overloads; do not erase it with a broad union or unchecked cast. AuthStrategy<P>.authenticate receives AuthenticationPayloadMap[P] and returns AuthenticatedUserDto. The enabled provider registry must associate the selector, concrete request DTO and matching strategy consistently. Keep RegistrationPayloadMap/register unchanged.

LoginValidationPipe receives unknown input and first requires a non-null object (not an array) and a supported text provider. Use an explicit Map of enabled providers or an own-property-checked lookup, not inherited object properties or arbitrary constructor selection. Reject dangerous own keys such as __proto__, constructor and prototype before safe transformation; do not blindly copy raw properties. Keep implicit conversion disabled so non-text credentials are not coerced into strings. Transform to the selected concrete DTO, run class-validator with whitelist and forbidNonWhitelisted, and format sanitized errors without values or targets. Preserve registration's separate validation behavior. Missing/unknown/unimplemented providers fail before authentication or issuance, even if present in AuthProvider enum.

A TypeScript union is erased at runtime. The existing global ValidationPipe therefore cannot select DTOs from LoginDto by itself. Do not annotate the body as LoginLocalDto or a provider-only concrete base class: global validation would reject future credentials before the parameter pipe. Use the generic body metatype Object and let LoginValidationPipe explicitly validate the concrete class. Keep global validation unchanged for other routes and verify the real pipe order in HTTP contract tests.

Local request still uses the flat `{ provider, email, password }` shape. LoginLocalDto owns local email/password rules; it may reuse local credential validation, but its provider must be the Local literal. Other providers will define different fields, not inherit local credential requirements. Adding one later means adding its DTO, payload map/registry entry, strategy and protocol-specific verification. External protocols needing redirects/callbacks can add those intake routes later and reuse the authenticated-user result/token issuer; this generic endpoint does not promise every protocol fits one request shape.

LocalStrategy remains our existing provider strategy with register()/authenticate(). It uses a private findLocalCredentialsByEmail projection filtered to provider local, verifies Argon2 hash exactly, and returns safe IDs/profile. Public IdentityMetadata remains hash-free. Invalid credentials share one domain error; storage/hashing failures remain distinct. Only local is enabled now; no Google/Microsoft implementation or account linking is included.

## Guard and token verification

| Entry point | Verification path | Storage? |
|---|---|---|
| Guarded HTTP request | AccessTokenGuard implements CanActivate → extractBearerToken → AuthService.validateAccessToken(raw) → AuthTokenService.verifyAccessToken → JwtService.verifyAsync → runtime claim checks → request.user | None for authentication |
| AuthService.validateAccessToken(raw) | AuthTokenService.verifyAccessToken uses JwtService.verifyAsync → private runtime claim checks → verified principal | None |
| AuthService.validateRefreshToken(raw) | AuthTokenService.verifyRefreshToken uses JwtService.verifyAsync → refresh claim checks → matching digest/root/account state | Yes |
| AuthService.refresh(dto) | validateRefreshToken then locked transaction rechecks and rotates or commits family revocation | Yes |
| AuthService.logout(dto) | Purpose-correct raw verification, lookup matching ownership/family and revoke refresh family | Yes if signed known credential |

AccessTokenGuard implements Nest CanActivate and receives AuthService/Reflector through DI. It handles route auth-mode metadata, extracts the bearer token, awaits validateAccessToken(raw), attaches `{ userId, authIdentityId, refreshFamilyId }` to request.user, and returns true. Missing/invalid credentials reject with sanitized 401; unexpected failures remain sanitized 500. No AuthGuard superclass, JWT transport strategy, Passport packages, session middleware or public claim-only authentication entry point is needed. Both guarded requests and access-based logout use the same raw-token validation method.

The module-owned extractBearerToken helper accepts a case-insensitive Bearer scheme followed by one non-whitespace token and no extra components. Inspect rawHeaders to reject duplicate Authorization fields even if Node normalizes them. Missing/wrong-scheme/empty/malformed or >4,096-character token credentials are 401. Never accept query-string/cookie credentials. The helper returns the token string without decoding/verifying it; the service handles verification exactly once. Put helper and its colocated tests in src/auth/helpers/.

Public mode only register/login/root. Refresh/logout modes only their respective controller handlers, which validate body credentials; no arbitrary route may silently bypass authentication. Mode contract tests enumerate each exemption. No database/UserService calls during access authentication.

## Service/helper boundaries

AuthService owns login(provider,input), refresh(dto), logout(dto), validateAccessToken(raw) and validateRefreshToken(raw). No Express request/response objects. AuthTokenService owns signAccessToken/signRefreshToken and purpose-specific JwtService verification. AuthTokenConfig supplies immutable shared keys/options; AuthClock supplies current time. DTOs cannot choose signing keys, IDs, issuer/audience, expiry or roles.

AuthRepository methods: findLocalCredentialsByEmail, createRefreshToken(dto,tx), findRefreshTokenById(jti,tx?), lockRefreshRoot(rootId,tx), consumeRefreshToken(id,now,tx), revokeRefreshFamily(rootId,now,tx), and existing withTransaction/registration methods. Consumption checks affected-row count; revoke marks every family row. Repository owns parameterized SQL and Prisma. Service decides outcomes; no nested independently committing transactions.

## JWT profile

| Property | Access | Refresh |
|---|---|---|
| algorithm | HS256 only | HS256 only |
| secret env | AUTH_ACCESS_SECRET | AUTH_REFRESH_SECRET, distinct |
| iss | movio-core | movio-core |
| aud | movio-api | movio-refresh |
| token_use | access | refresh |
| sub | canonical positive integer user ID as string | same |
| auth_identity_id | positive integer identity row ID | same |
| fid | root refresh-row UUID | same immutable family root |
| jti | fresh UUID | refresh_token.id UUID |
| iat | integer epoch issuance seconds | integer epoch issuance seconds |
| renewal_exp | fixed original 30-day epoch deadline | same |
| exp | min(iat+3600, renewal_exp) | renewal_exp |

Validate required numeric dates, exp > iat, iat <= now, valid ID shapes, now < exp, allowed lifetime and correct purpose. Access exp must not exceed renewal_exp; refresh exp must equal renewal_exp. No access database check for fid/ownership/account state: trust signed claims only. Refresh must compare signed sub/auth_identity_id/fid/jti/deadline with stored row/root and require account/identity active.

Configure keys as base64 of at least 32 random bytes each; reject missing, malformed, weak or identical keys at startup, no default secrets. Purpose-specific algorithm/issuer/audience policy is enforced through JwtService.verifyAsync. ignoreExpiration false, clockTolerance 0, no unsafe decode/no unverified key discovery. Pass the injected clock's current seconds per verify call, never a startup timestamp. Guard and logout share this access verification path; runtime claim checks remain private and run only after successful signature verification. Runtime claim validation is mandatory; generic TypeScript return typing does not validate input.

SHA-256 the complete refresh JWT; compare fixed-size digest bytes with timingSafeEqual after signature/claims verification. Unknown jti, wrong digest or mismatched ownership rejects without changing rows. Known consumed matching credentials trigger family-only renewal revocation. Root consumed_at is allowed; root revoked_at is not.

## Errors and logout

Auth-owned error definitions, custom exceptions and filters live together in `src/auth/exceptions/`. Use `auth-errors.ts` for transport-independent domain errors and `auth-exception.filter.ts` for sanitized HTTP mapping; keep their non-E2E tests beside them. Any additional auth exception classes belong in this same folder. Sharing a folder does not allow domain code to depend on HTTP filters. Other domains retain ownership of their own errors.

Domain failure mapping: credential mismatch → AUTHENTICATION_FAILED; invalid JWT/claims/expired or unusable refresh → AUTHENTICATION_REQUIRED. Password mismatch is not infrastructure failure. Corrupt stored Argon2 hash/configuration → sanitized 500; hashing/verification ENOMEM/EAGAIN → recognized temporary 503.

Prisma known/init temporary codes P1001/P1002/P1008/P1017/P2024/P2034; P2028 temporary only for recognized start-timeout/expired-transaction cases matching existing registration allowlisting. Unexpected errors/invalid operations/UUID collisions → sanitized 500. Do not blindly convert every exception into 401 or retry a client refresh operation. Preserve registration classification separately.

Reuse transaction returns a typed outcome, commits revocation, then service raises 401. Consumed matching refresh may identify its family for logout; standalone access verification may identify its signed fid. Verify persisted owner before mutation. Invalid/expired/unknown logout token returns generic Signed out without unrelated writes; missing token is 401. If required persistence fails, return 503 rather than false success. Access remains valid after logout and requires no stored family at all.
