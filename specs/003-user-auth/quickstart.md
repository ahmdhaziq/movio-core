# Validation Guide: Stateless Authentication

This guide applies after implementation. Planning does not install dependencies, add production endpoints or apply migrations.

## Prerequisites and commands

Node 24+ supported by project dependencies, npm, Docker Compose/PostgreSQL 17; DATABASE_URL configured as in .env.example. TEST_DATABASE_URL uses a test role allowed to create/drop isolated schemas. Configure independently generated AUTH_ACCESS_SECRET/AUTH_REFRESH_SECRET base64 keys, each >=32 decoded random bytes. Never commit keys; implementation documents variables and provides explicit test-only configuration. Single application instance initially; shared throttler storage before replicas. HTTPS at production ingress.

From repository root after dependencies/migration are implemented:

```bash
npm ci
docker compose up -d --wait postgres
npx prisma generate
npx prisma migrate deploy
npm run build
npm run lint
npm test
npm run test:e2e
npm run start:dev
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

Update existing auth/user E2E fixtures to login before guarded reads while preserving token-free registration. Delete nonroot refresh descendants, then self-referencing roots, then identities/users in fixture teardown. Do not bypass throttling globally for performance tests; use distinct trusted IPs. No test success is claimed by this planning guide.

Error and filter unit/contract tests belong beside their subjects under `src/auth/exceptions/`; the existing `src/**/*.spec.ts` test discovery includes them. Keep cross-domain E2E tests under `test/`.

Review type-level provider/payload correlation and registry consistency. A test-only alternative provider DTO/strategy can prove selection does not require local email/password; keep this fixture isolated from the production registry and do not enable a real external provider or skip local validation.
