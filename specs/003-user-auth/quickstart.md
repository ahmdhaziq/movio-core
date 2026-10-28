# Validation Guide: Stateless Authentication

The implemented flow uses stateless access JWTs and stored refresh rotation. See [validation.md](validation.md) for executed checks and measurements.

## Prerequisites and commands

Node 26+ or a supported Node 24 LTS release >=24.15, npm, Docker Compose/PostgreSQL 17; DATABASE_URL configured as in .env.example. TEST_DATABASE_URL uses a test role allowed to create/drop isolated schemas. Configure independently generated AUTH_ACCESS_SECRET/AUTH_REFRESH_SECRET base64 keys, each >=32 decoded random bytes. Never commit keys; implementation documents variables and provides explicit test-only configuration. Single application instance initially; shared throttler storage before replicas. HTTPS at production ingress.

From repository root, copy `.env.example` to `.env`, configure the database and set two independently generated secrets (`openssl rand -base64 32` per key). Then:

```bash
npm ci
docker compose up -d --wait postgres
npx prisma generate
npx prisma migrate deploy
npm run build
npm run lint
npm test
npm run test:e2e
node --env-file=.env dist/main.js
```

Expected: build/lint/tests pass; suites create/drop only their own schemas through testDatabase. No resetting developer data. Review [API contract](contracts/authentication-api.md), [verification paths](contracts/auth-internal.md) and [data model](data-model.md).

## Manual client flow

Use private variables in an HTTP client; do not publish tokens/logs. Local base URL http://localhost:3000 or configured PORT.

1. Register a local account, expect 201 user only. Login with local/email/password, expect 200 correct user and two tokens, access +3600 seconds and renewal +2592000 seconds.
2. Call user reads with access bearer, expect existing success. Omit bearer, change signature, or present refresh as bearer: expect 401 and no protected data. Root remains public.
3. Refresh with current refresh JWT, expect replacement and unchanged renewal deadline. Reuse consumed refresh: expect 401 and subsequent replacement renewal denied. Confirm already issued access remains accepted until exp.
4. Log in twice independently. Logout one login using its access or refresh token, expect Signed out. Its refresh is denied; outstanding access remains usable until expiry. Other login's refresh still succeeds. Client clears its local credentials.
5. Delete an account via an existing internal/test lifecycle action: login/renewal denied, previously issued access still authenticates until expiry. Existing business rules may separately affect requested data.

## Automated acceptance matrix

| Requirements/outcomes | Evidence required | Placement |
|---|---|---|
| FR-001–004 / SC-001 | Provider-to-concrete-DTO dispatch through the real global/parameter pipes, local only, unsupported/reserved provider rejected before strategy calls, invalid/extra fields rejected, email normalization, exact password, generic failures, digest persistence and rollback, safe response | Auth units/controller/repository contracts |
| FR-005–007 / SC-002,009 | Guard calls validateAccessToken once; JwtService verifies signature before claim/profile checks and principal attachment, strict headers, public/mode exemptions, request.user, test-only guarded action not executed on rejection | Auth adapter/guard tests and cross-domain E2E |
| FR-006–007 / SC-002,005,006 | Zero auth repository/user calls for access; access accepted after logout/deletion and auth DB outage until exp | Auth service/guard tests with failing persistence spies; E2E authentication-only fixture |
| FR-008–010 / SC-003,004 | Exact hour/30-day boundaries, access cap, retained root, digest mismatch no mutation, concurrent refresh at most one consume, family reuse revocation committed before 401 | Clock units, real PostgreSQL integration, token E2E |
| FR-011–012 / SC-005 | Access/refresh logout, consumed refresh logout, unknown/repeated/missing credentials, logout-vs-refresh lock ordering, independent families, access remains until exp | Auth units/repository integration/E2E |
| FR-013,015–016 / SC-006,009 | No tokens on failed commit, signing failure, config/corrupt-hash distinction, safe 401/503 on all controllers, shared correlation, no secrets in logs/results | Auth units/contracts and E2E |
| FR-014 / SC-008 | 11th login/refresh throttled, failed validations counted, independent buckets, Retry-After/window expiry, ordinary routes/logout unaffected | Controller contracts/E2E |
| FR-017 / SC-009 | Native explicit credentials, no roles/admin functionality, no registration auto-login | Contract review/E2E |
| SC-007 | 20 parallel logins and separately 20 renewals with real hashing/JWT/DB, distinct trusted IPs; >=95% finish under two seconds in each workload | Performance E2E |
| Migration | Existing accounts preserved, self-root insert, owner/root FK mismatch rejection, one-current partial index, no raw stored JWT, child-before-root cleanup | Auth PostgreSQL migration/integration tests |

Advance injected AuthClock in token-boundary tests; verifyAsync receives the current clockTimestamp per invocation. Test the direct JwtService service path and custom guard-to-service integration against identical signed tokens; never capture verification time at startup. Avoid real hour/month waits. Refresh races require real PostgreSQL, not mocked transaction ordering.

With auth persistence unavailable, a test-only guarded action that needs no DB must still accept valid access. Do not claim actual DB-backed business reads succeed during database outage. Invalid access always denies before the action. There is no auth-session table or live-state authentication check to satisfy.

Update existing auth/user E2E fixtures to login before guarded reads while preserving token-free registration. Delete nonroot refresh descendants, then self-referencing roots, then identities/users in fixture teardown. Do not bypass throttling globally for performance tests; use distinct trusted IPs. Executed results are recorded separately in validation.md.

Error and filter unit/contract tests belong beside their subjects under `src/auth/exceptions/`; the existing `src/**/*.spec.ts` test discovery includes them. Keep cross-domain E2E tests under `test/`.

Review type-level provider/payload correlation and registry consistency. A test-only alternative provider DTO/strategy can prove selection does not require local email/password; keep this fixture isolated from the production registry and do not enable a real external provider or skip local validation.


## HTTP examples

Register with the existing registration endpoint, then use an HTTP client with private token variables:

```http
POST /auth/login
Content-Type: application/json

{"provider":"local","email":"ada@example.com","password":"SyntheticPass9!"}
```

Save `access_token` and `refresh_token` from the 200 result. Use the access token
for `GET /user/list` with `Authorization: Bearer <access_token>`.

```http
POST /auth/refresh
Content-Type: application/json

{"refresh_token":"<current refresh_token>"}
```

Replace both local tokens with the response. The refresh deadline stays unchanged.
Serialize refresh requests and avoid automatic retries of a consumed credential.

```http
POST /auth/logout
Content-Type: application/json

{"token_type":"refresh","token":"<current refresh_token>"}
```

Clear both local tokens after success. Logout stops renewal; issued access remains
accepted until expiry. Retain refresh roots/history through the original deadline.
The first increment uses a single-instance in-memory limiter; shared storage is
required before replicas. Trust forwarded IPs only from explicitly configured
proxies. To add a provider, implement its DTO, typed request/credential maps,
registry entry and strategy; local is the only currently enabled provider.

## Organization revision status (2026-10-29)

Implemented: controller contracts share `src/auth/auth.controller.spec.ts`, all auth service cases share `src/auth/auth.service.spec.ts`, and validation factories live at `src/auth/exceptions/auth-validation.exception.ts`. Final checks passed 51 controller cases, 104 service cases and 26 login-pipe/filter cases (181 total), plus lint/build. See [executed evidence](validation.md#completed-revision-checks). Pre-move commands below are historical baseline instructions; use the destination-only commands for current validation.

## Controller-test consolidation validation

This revision needs installed dependencies and generated Prisma types used by application imports. It uses mocked AuthService methods and no database connection. Run from the repository root before moving tests and record the expanded test count and suite names:

```bash
npm test -- src/auth/auth.controller.spec.ts src/auth/auth-login.controller.spec.ts src/auth/auth-refresh.controller.spec.ts src/auth/auth-logout.controller.spec.ts
```

After merging all cases into `src/auth/auth.controller.spec.ts` and deleting the three endpoint-specific files:

```bash
npm test -- src/auth/auth.controller.spec.ts
npm run lint
npm run build
rg --files src/auth -g '*controller.spec.ts'
```

Expected: the merged spec passes all 51 expanded cases (registration 26, login 6, refresh 9, logout 10), matching the four-file case inventory, with registration, login, refresh and logout groups preserved. The file inventory contains only `src/auth/auth.controller.spec.ts`. Preserve validation rejection before service dispatch, normalization and exact passwords, sanitized logs/errors, body-only token handling and no-store headers. Existing ThrottlerGuard overrides remain; these commands do not prove real attempt-limit behavior. Review [internal contract](contracts/auth-internal.md#controller-contract-test-ownership-2026-10-29) and [model impact](data-model.md#controller-test-consolidation-impact-2026-10-29).

Record implementation results separately in `validation.md`. The consolidation is implemented and its focused checks passed; see the revision status above. Full database/E2E verification remains required for later runtime changes; the focused test-file move introduces no runtime or persistence change.

## Service-test consolidation validation

Use installed dependencies and generated Prisma types. These six service suites use mocked persistence and do not require a running database or HTTP listener. Before consolidation, capture the case inventory with:

```bash
npm test -- src/auth/auth.service.spec.ts src/auth/auth-login.service.spec.ts src/auth/auth-refresh.service.spec.ts src/auth/auth-logout.service.spec.ts src/auth/auth-access.service.spec.ts src/auth/auth-token.service.spec.ts
```

Executed planning baseline on 2026-10-29: six files passed, all 104 expanded tests passed. After moving all cases into `src/auth/auth.service.spec.ts` and removing the five source files, run:

```bash
npm test -- src/auth/auth.service.spec.ts
npm run lint
npm run build
rg --files src/auth -g '*service.spec.ts'
```

Expected: one auth service spec file with the same 104 expanded cases passing, including the token service's three behavior subgroups. Compare named cases and parameterized inputs as well as totals. Preserve registration's Argon2 mock and Logger cleanup, isolated user fixtures, sequential groups with local mock initialization, real JWT verification, injected clock resets, transaction commit guarantees and no-persistence access assertions. No service spec in another domain is moved. See [internal contract](contracts/auth-internal.md#service-contract-test-ownership-2026-10-29) and [model impact](data-model.md#service-test-consolidation-impact-2026-10-29).

Post-merge results are recorded in `validation.md`, separately from the passing pre-move baseline. Validate controller consolidation separately using the preceding guide.

## Validation exception relocation validation

Use the existing installed dependencies and generated Prisma types. After moving `src/auth/auth-validation.ts` to `src/auth/exceptions/auth-validation.exception.ts` and updating imports, run from the repository root:

```bash
npm test -- src/auth/auth.controller.spec.ts src/auth/pipes/login-validation.pipe.spec.ts src/auth/exceptions/auth-exception.filter.spec.ts
npm run lint
npm run build
rg -n 'auth-validation' src test
```

Run these commands after the planned controller consolidation; if the relocation is implemented first, also include the existing login, refresh and logout controller spec files in the focused test command. Controller tests need an environment that permits Supertest's localhost listener; these suites mock persistence and need no database connection.

Expected: all affected existing cases pass, consumers reference `auth-validation.exception.js` under exceptions, and `src/auth/auth-validation.ts` no longer exists. Verify registration-specific field codes/messages, generic sanitized auth validation errors, unsupported provider/extra-field rejection before service calls, and logout's missing/empty credential 401 versus malformed-field 400. Response bodies must not echo secrets. No additional test suite is required solely for this file move. See [factory contract](contracts/auth-internal.md#validation-exception-factories-2026-10-29).

The source relocation is implemented and its affected tests, lint and build passed. Record eventual results in `validation.md`.
