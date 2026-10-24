# Implementation Plan: Stateless Access JWTs and Stored Refresh Tokens

**Branch**: `main` (actual Git branch; feature resolver label `003-user-auth`) | **Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

**Input**: Existing auth module, provider-keyed authenticate() DTOs, JwtService signing/validation, stored refresh tokens, and the user's explicit decision to remove server sessions and access-time database checks.

## Summary

Keep one-hour access JWT authentication stateless. Persist only refresh credentials in one new table, storing digests and related rotation generations. There is no auth_session table, session DTO, access-token allowlist, revocation list, or authentication database lookup on guarded requests. Logout and refresh reuse revoke further renewal; issued access remains valid until its signed expiry, at most one hour.

Extend existing AuthStrategy with authenticate() and local email/password verification. Protect business routes with our own AccessTokenGuard implementing Nest CanActivate. It extracts the bearer token, calls AuthService.validateAccessToken(raw), attaches the verified principal to request.user and allows the handler only on success. Nest JwtService signs both token types and verifies their signatures/expiry through service methods. Refresh validation additionally checks database state. No Passport packages or JWT transport strategy are introduced; future provider integrations remain owned by our strategy layer.

## Technical Context

**Language/Version**: TypeScript ^6.0.2, strict NodeNext ESM, ES2023; observed local Node v26.8.1. Verification baseline Node 24+ supported by installed dependencies.

**Primary Dependencies**: Existing NestJS common/core/platform-express ^12.0.1, Argon2 ^0.45.1, Throttler ^6.7.1, class-validator ^0.15.1. Add a compatible @nestjs/jwt release supporting Nest 12. No Passport dependencies or Passport-specific typings. Verify published peers during implementation and commit the lockfile; research of maintainer source is not proof of a published version.

**Storage**: PostgreSQL 17 and Prisma/client ^6.19.3. One refresh_token table with user/identity ownership, SHA-256 digest, immutable family root and deadline, consumption/revocation timestamps. Preserve Prisma 6 $transaction / TransactionClient APIs.

**Testing**: Vitest ^4.1.2, Supertest ^7.0.0, real PostgreSQL integration with isolated schemas via existing testDatabase helper. Inject AuthClock and pass its current epoch seconds to JwtService.verifyAsync on each call for exact token-boundary tests.

**Target Platform**: Existing Node HTTP service for native consumer mobile applications. Browser admin portal and role policies deferred.

**Project Type**: Backend web service, no client project or browser-cookie session.

**Performance Goals**: >=95% valid logins and renewals complete within two seconds at 20 concurrent attempts from distinct trusted IPs. Access authentication makes zero persistence calls.

**Constraints**: Access TTL <=3,600 seconds; fixed renewal deadline 2,592,000 seconds after login; refresh rotation/reuse detection; no immediate revocation of outstanding access. Account deletion is checked at login/renewal, not by access authentication. Initial in-memory throttling supports one instance; shared limiter storage is required before replicas.

**Scale/Scope**: Existing auth/user routes, three new auth endpoints, one additive table, retained refresh generations through their fixed deadline. No new device cap or roles.

## Constitution Check

*Pre-research gate: PASS. Post-design gate: PASS. No exceptions.*

| Principle | Evidence |
|---|---|
| Module-first boundaries | Auth owns DTOs, custom provider strategies, custom access guard, helpers, refresh persistence and colocated tests. User domain retains business data ownership. |
| Controller → Service → Repository | Controllers/pipes/guard handle transport; service orchestrates issuance/rotation/revocation; repository owns Prisma and parameterized row locking. |
| NestJS and DI | Add JwtModule inside existing AuthModule; inject JwtService, strategy and configuration. APP_GUARD uses Nest DI. No UserModule → AuthModule cycle. |
| PostgreSQL and Prisma | Add reviewed refresh-token migration and owner/root constraints; no rewriting retained users, emails, or passwords. |
| Module-scoped verification | Auth/user units and contract/integration tests remain under their domains; only full-application E2E tests live in test/. |

JWT verification is domain infrastructure; the guard is a transport adapter. A read-only auth repository projection may read linked users to verify login/renewal eligibility, without mutating user business data. Existing registration's dependency direction is preserved.

## Project Structure

### Documentation (this feature)

```text
specs/003-user-auth/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── contracts/
    ├── authentication-api.md
    └── auth-internal.md
```

Implementation tasks are tracked in [tasks.md](tasks.md); executed validation is recorded in [validation.md](validation.md).

### Source Code (repository root)

```text
src/auth/
├── auth.module.ts / auth.controller.ts / auth.service.ts / auth.repository.ts
├── auth-token.service.ts / auth-clock.ts / auth-token.config.ts
├── auth-validation.ts
├── exceptions/
│   ├── auth-errors.ts
│   ├── auth-exception.filter.ts
│   └── colocated *.spec.ts
├── dto/
│   ├── login.dto.ts / login-local.dto.ts / authenticate-local.dto.ts
│   ├── authenticated-user.dto.ts
│   ├── refresh-token.dto.ts / logout.dto.ts / token-result.dto.ts
│   └── create-refresh-token.dto.ts / existing registration DTOs
├── strategies/auth-strategy.interface.ts / strategies/local.strategies.ts
├── guards/access-token.guard.ts
├── helpers/extract-bearer-token.ts
├── pipes/login-validation.pipe.ts
├── decorators/auth-mode.decorator.ts
├── types/authenticated-request.ts
└── colocated *.spec.ts / *.int-spec.ts
src/configure-app.ts / src/app.controller.ts
src/user/                       # Existing behavior and authenticated contract tests
prisma/schema.prisma
prisma/migrations/<timestamp>_add_refresh_tokens/
test/auth.e2e-spec.ts / test/user.e2e-spec.ts / test/auth-token.e2e-spec.ts
.env.example / README.md / package.json / package-lock.json
```

**Structure Decision**: Custom LocalStrategy owns local provider authentication and retains register()/authenticate(). AccessTokenGuard is a thin HTTP adapter calling the service; no separate JWT strategy or authentication framework is added. Other provider implementations are future work. Generic LoginDto selects provider-specific concrete DTOs; local fields are not imposed on future providers. No server-session middleware is introduced. Auth-owned error types, custom exceptions and exception filters are colocated under `src/auth/exceptions/`, including their unit/contract tests. Other domains retain their own exceptions folders; no application-wide collection of domain errors is introduced.

## Phase 0 — Research Decisions

Completed in [research.md](research.md): provider-selected login DTO validation, custom CanActivate guard, bearer extraction, unified JwtService verification, claim/configuration checks, refresh-only family storage, row-lock races, database outage behavior, and existing filter compatibility. No unresolved clarification gates.

## Phase 1 — Design

### Login and issuance

Define LoginDto as a provider-discriminated request union derived from LoginRequestMap, with Local → LoginLocalDto `{ provider: local, email, password }` for now. The controller accepts this generic request through LoginValidationPipe, which selects the concrete DTO from an explicit enabled-provider registry and validates that DTO at HTTP intake. It then passes the matching provider and credential payload to AuthService.login(provider, input). LoginLocalDto remains local-specific, not the universal controller body type. Extend provider-keyed AuthenticationPayloadMap (Local → AuthenticateLocalDto) and AuthStrategy.authenticate(dto), preserving register(). Keep provider/payload correlation in service signatures using discriminated argument types or overloads; do not accept independent provider and unrelated union payload types.

LoginValidationPipe must inspect an unknown raw object, reject null/arrays, missing/non-text/unsupported or unimplemented provider before strategy execution, instantiate only an allowlisted concrete request DTO, then apply transform/whitelist/forbidNonWhitelisted and sanitized field errors. Email normalization/password rules belong only to the local DTO. No provider-controlled constructor lookup. The union is a compile-time type, not runtime validation metadata: use a parameter pipe on the generic body and ensure the existing global ValidationPipe does not first validate it as LoginLocalDto or a provider-only base class. Reflection metatype for this body is Object; the parameter pipe explicitly validates the selected concrete class. Do not weaken global validation for other routes. Contract tests must exercise the actual global-plus-parameter pipe order.

Future providers add a concrete request DTO, matching authenticate payload/result adapter, registry/type-map entry and strategy. They are not required to send email/password; their verified identity maps to the same safe authenticated-user result and common JWT/refresh issuance. Reserved Google/Microsoft enum values remain rejected until enabled. This increment adds no external provider, token verification, account linking or browser redirect flow. Preserve today's flat local HTTP body; do not add a nested payload wrapper merely for extensibility. 

LocalStrategy loads normalized email and local identity via a private credential projection and calls argon2.verify(storedHash, submittedPassword). Require both deleted_at null. Missing credentials, deleted user/identity and password mismatch share one public authentication-failed error. Use a precomputed dummy Argon2 hash on missing-credential branches to reduce obvious timing distinctions. Infrastructure/corrupt-hash failures are not mismatches. Return safe user and integer auth identity row ID only.

Service generates root UUID and access jti, fixes one whole-second issuance time, and signs access/refresh with AuthTokenService. Persist initial refresh row (root_token_id=id) after rechecking user/identity ownership/activity in a transaction. Respond only after commit. A JWT signed before failed persistence is never disclosed; unlike the previous stateful design, an accidentally disclosed access JWT cannot be made unusable by a missing database row, so do not log/stream any provisional tokens.

### JWT validation and guard call path

AuthTokenService wraps JwtService.signAsync/verifyAsync. Separate HS256 keys, fixed issuer movio-core, audiences movio-api and movio-refresh, and token_use access/refresh prevent substitution. Claims and exact configuration are in [internal contract](contracts/auth-internal.md). Enforce exp and iat at runtime, no future issuance, valid IDs, TTL and purpose. Do not use decode as verification or accept header-selected keys. No PII/passwords/roles in JWTs.

Guarded request path: AccessTokenGuard.canActivate → route auth-mode metadata → extractBearerToken(request) → AuthService.validateAccessToken(raw) → AuthTokenService.verifyAccessToken(raw) → JwtService.verifyAsync → runtime claim checks → typed request.user → controller. Exactly one signature verification per request, with no storage lookup. A missing/malformed header or failed verification raises a sanitized 401; returning false is not used for authentication failure because Nest defaults to 403.

AuthService.validateAccessToken(raw) is the single access validation entry point for both guard and access-based logout. It verifies the access profile and runs private claim validation before returning `{ userId, authIdentityId, refreshFamilyId }`. Never attach unverified decoded data to request.user. Services receive token strings and DTOs, never Express objects.

AuthService.validateRefreshToken(raw) calls JwtService refresh-profile verification and reads matching stored digest, root state, deadline and live user/local identity. Refresh orchestration rechecks after locking. It returns internal renewal evidence, never a principal accepted for business access. No generic public token-validation endpoint is added.

AuthTokenConfig supplies immutable algorithm/key/issuer/audience settings. Pass AuthClock's current integer epoch seconds as clockTimestamp on every verifyAsync call, with clockTolerance 0 and ignoreExpiration false. Never capture verification time during startup. Tests advance the injected clock without hour/month waits.

### Refresh-only storage and atomic rotation

See [data-model.md](data-model.md). Each row owns user_id, auth_identity_id, root_token_id, digest, fixed expired_at, consumed_at/revoked_at and creation time. The root is the first refresh row, not a separate server-session record. Access JWT fid identifies this root solely to allow logout to revoke its refresh family; the guard only checks fid shape and never looks it up.

Inside service-orchestrated Prisma 6 transactions, repository lockRefreshRoot(rootId, tx) locks the retained root row with parameterized SELECT FOR UPDATE, then rereads target/root/account state and current time. Verify exact token digest and signed ownership before revocation; guessed identifiers cannot trigger it. Current credential is consumed and replacement inserted atomically with unchanged root/deadline. Sign replacement pair before callback completes, release response only after commit. A partial unique index permits one unconsumed/unrevoked row per root.

Consumed matching-token reuse revokes all refresh rows in the family. Return reuseDetected from the transaction callback, commit, then raise 401 outside it, so revocation is not rolled back. The losing concurrent refresh revokes the winner's replacement refresh, but any issued access JWT remains valid. No grace period or automatic client retry. Lock/transaction timeouts return 503; no credentials are disclosed.

### Logout and account state

Logout accepts declared access or refresh token. Verify purpose/signature/expiry and signed owner/root; a refresh also matches its digest, and a consumed matching refresh may identify the family. Lock the same root and revoke every row in that family; return generic signed-out result. Repeated/unknown/malformed/expired credentials are idempotent confirmations without unrelated mutations; missing credentials are rejected. Required DB failure is 503, never a false confirmation.

Logout, reuse detection and account deletion do not terminate outstanding access. It remains accepted until exp, capped at the original 30-day renewal deadline. Deletion prevents login/renewal by checking linked deleted_at; existing business checks may independently deny a resource. A valid access token continues authenticating while the auth database is unavailable, though a business operation may itself need storage.

### HTTP integration and safe errors

Register AccessTokenGuard globally through APP_GUARD using Nest DI. Closed metadata modes: default access; public only for registration/login/root GET /; refresh/logout only on their respective credential-validating handlers. Implement canActivate directly rather than extending AuthGuard. In access mode, extract the bearer token and await AuthService.validateAccessToken; set typed request.user only after success, then return true. Public and credential-specific endpoint modes retain their documented checks.

The module-owned extractBearerToken(request) helper validates raw Authorization header uniqueness, accepts case-insensitive Bearer with exactly one non-whitespace token, rejects missing/duplicate/malformed/oversized credentials, and returns the raw token string. Reuse the 4,096-character token bound in the HTTP contract. It performs no cryptographic checks; JwtService performs verification. Keep helper and tests under src/auth/helpers/. Auth-domain exceptions and the HTTP filter map failures to safe 401 results; unexpected configuration/programming failures remain sanitized 500. The guard never calls repositories or UserService.

Keep independent ten-per-60-second login/refresh ThrottlerGuard buckets and existing registration behavior; skip logout and ordinary guarded routes. Existing in-memory limiter is single-instance; do not trust arbitrary forwarded-IP headers. Add documented secret configuration without values and preserve confidential production ingress.

Existing registration filter converts 401 to 500; extract/generalize operation-aware auth error handling into `src/auth/exceptions/auth-exception.filter.ts` while preserving registration results. Auth domain errors live in `src/auth/exceptions/auth-errors.ts`; any custom auth exception classes also belong in this folder. Grouping files does not merge responsibilities: domain error definitions remain transport-independent, and filters map failures to HTTP responses. Services and repositories must not import filters or request/response objects. A narrowly targeted global auth filter handles guard failures on user routes without changing unrelated user errors. Extend configureApp's safe DTO errors to new auth DTOs without registration complexity on login. One request correlation reference flows through audit logging, with UTC time, operation, outcome and duration; exclude bodies, email, token/hash contents and database diagnostics.

### Migration and verification

Add one refresh_token table plus ownership/root constraints/indexes, preserving existing identity_id text rules and all user data. Test fresh and retained-data upgrades in isolated PostgreSQL schemas. Fixture deletion removes refresh children before roots, then identities/users. No schema/reset commands run during planning.

Unit tests cover provider flow and runtime claim validation; login pipe/controller tests cover provider-to-DTO selection, unsupported provider rejection before strategy calls, whitelist enforcement and enabled-map consistency; guard/helper tests prove strict extraction, one service validation call, principal attachment only after verification, public metadata and 401 handling. Access-authentication tests spy on repository/user access and assert zero calls, including valid tokens after logout/deletion and while authentication storage is down. Boundary tests cover direct service validation and the guard-to-service integration using the same injected clock. Real database races prove atomic consume, family revoke commit-before-error and logout-vs-refresh ordering. Update legacy E2E reads to log in without changing registration auto-login behavior. Use a test-only guarded action to prove rejected requests do not execute business behavior. Run build/lint/colocated tests/E2E after implementation, including real 20-client performance cases.

## Complexity Tracking

No constitutional exceptions. One-table refresh generations and a retained root support reuse detection and independent logins without introducing access-time server state. The custom guard keeps HTTP extraction separate from JwtService verification and preserves our provider strategy layer without an additional authentication framework.
