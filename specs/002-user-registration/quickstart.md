# Quickstart Validation: User Registration

The local registration implementation has been validated with the commands below. Migrations were exercised in isolated test schemas; the application database was not migrated or reset during implementation.

## Prerequisites

- Node >=22 compatible with the installed argon2 release, npm dependencies installed, Docker and local PostgreSQL available.
- Apply the implemented reviewed migrations and regenerate Prisma Client; use the repository README for database URL configuration.
- Inspect normalized-email migration preflight results. Conflicting retained emails must be resolved deliberately before applying that migration; do not reset or discard application data.

From the repository root:

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

The tests use existing randomly named PostgreSQL schemas; production/application tables must not be reset. The tests verify migrations, identity constraints, shared transaction behavior, and the public endpoint, following [data-model.md](data-model.md) and the [endpoint contract](contracts/auth-registration.md).

## Successful registration

Use a new synthetic email for each successful manual run. The example password is test data.

```bash
curl -i -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  --data '{"provider":"local","name":"New User","email":"registration.test@example.com","password":"ExamplePass9!"}'
```

Expect 201 with user.id, normalized name, and normalized email. No password, hash, identity details, cookie, or sign-in token. In the test database, confirm exactly one User and one local AuthIdentity with identity_id equal to String(user.id); hash differs from plaintext and validates the supplied password through the hashing library. Do not print a real hash in logs or reports.

## Negative and boundary validation

| Scenario | Expected outcome |
|----------|------------------|
| Repeat successful request | 409 EMAIL_UNAVAILABLE; row counts unchanged |
| Same email with case changes/surrounding spaces | 409; no additional identity/user |
| Missing/null/non-text required field | 400 field error; no writes |
| Missing/google/microsoft/unknown provider | 400 provider error; no writes or hashing |
| Extra user_id, identity_id, password_hash, or role | 400 unsupported field; no writes |
| Blank/overlong name or malformed email | 400; correct field identified |
| Password 7 or 129 code points | 400; password length rule identified |
| Password 8 or 128 code points with every category | 201 with an otherwise valid unique submission |
| Password missing uppercase/lowercase/digit/symbol | 400 explaining each unmet rule, no echoed password |
| Password whose only special character is whitespace | 400 symbol error |
| Existing/deleted user, no local identity | 409; no attachment, revival, or new credential |

Run field/password/provider validation through controller/ValidationPipe contract tests and endpoint E2E. AuthService tests use valid DTO fixtures to verify orchestration, conflicts, hashing, and transactions; they do not expect service DTO revalidation. Use distinct emails and isolated limiter state so throttling does not mask validation cases. Confirm raw passwords remain unchanged before hashing, including allowed leading/trailing whitespace.

## Atomicity and concurrency

1. In E2E fault injection, inject a recognized Prisma availability failure in AuthRepository.createIdentity after UserService.create has returned within the transaction. Expect sanitized 503 and zero new User/AuthIdentity rows.
2. Mock the argon2 hashing call before transaction entry with an Error carrying ENOMEM/EAGAIN: expect sanitized 503 and no records. Repeat with generic Error/TypeError: expect sanitized 500 and no records. Neither response/log contains secret diagnostics. Verify all database and hashing cases in the [failure classification table](plan.md#failure-classification), including recognized timeout versus transaction misuse.
3. Submit concurrent requests using the same normalized email. Exactly one can return 201; others return 409. Verify one User and one local identity.
4. Retry after intentionally losing the success response. Within the attempt limit, expect 409 without duplicate records.
5. Test AuthService.resolveStrategy() selection of the injected LocalStrategy and the register-only AuthStrategy contract, then test repository uniqueness/FK/CHECK violations directly in isolated schemas; failed writes must not weaken invariants.
6. Apply migration against retained-user fixtures. IDs and non-email fields remain unchanged; emails normalize; no identities/passwords are invented. Case/whitespace collisions fail preflight safely.

## Confidentiality, limits, and performance

Capture request outcome logs and responses during both success and failure; verify they contain neither submitted passwords nor stored credentials. Existing GET /user/:id and /user/list contain public profile fields only.

Test the 11th attempt within a 60-second window from the same trusted client IP, counting both successful/rejected prior submissions: expect 429 plus Retry-After and no write. Advance the test clock beyond the window and confirm requests can proceed. Ensure unrelated user endpoints are unaffected. Do not spoof untrusted forwarding headers in production.

Measure 20 concurrent, valid registrations with distinct synthetic emails and distinct trusted client IP identities, each within its attempt limit. Throttled submissions do not count as completed registrations. Use real hashing and PostgreSQL, include password-preparation and commit latency, and verify at least 95% finish within two seconds. Record runtime, hardware, hash configuration and results. Do not bypass hashing or lower its selected baseline to obtain a passing result; investigate execution capacity if the target fails.

## Scope

Sign-in, provider integrations, verified account linking, credential recovery, and multi-instance deployment infrastructure remain separate features.

Implementation prerequisites verified: existing Nest/Vitest configuration and isolated test-database helper are reused; PostgreSQL runs via Compose. Dependencies are locked in package-lock.json.

## Implementation verification — 2026-10-15

All 39 tasks are complete. The quality checklist was treated as read-only; its markers were not changed during implementation.

| Check | Observed result |
|-------|-----------------|
| `npm run build` | Passed |
| `npm run lint` | Passed, no lint warnings |
| `npm test` | 151 tests passed in 12 files |
| `npm run test:e2e` | 41 tests passed in 3 files |
| `git diff --check` | Passed |
| Prisma client generation/schema formatting | Passed |
| Native Argon2 hashing | Confirmed on the local runtime |

Performance evidence: 20 simultaneous successful local registrations with distinct synthetic emails/trusted test IPs, real Argon2id hashing, and real local PostgreSQL. Node v26.8.1, macOS arm64, Apple M4 (10 logical CPUs); memoryCost 19456 KiB, timeCost 2, parallelism 1. Final run p95 **116 ms**, maximum **122 ms**; all 20 completed under two seconds. This is local-machine evidence, not a production latency guarantee. The test server listens once on a random local port before the concurrent run, avoiding per-request server lifecycle warnings.

| Acceptance coverage | Evidence |
|---------------------|----------|
| FR-001/FR-005/FR-006; SC-001 | Success E2E confirms public access, matching durable user/identity, exact safe response, and commit completion |
| FR-002/FR-003/FR-009/FR-011/FR-014/FR-015; SC-002/SC-008 | Controller contract and E2E reject missing/invalid/unsupported input before service invocation; name/password limits and Unicode password code points verified; corrected input succeeds |
| FR-004/FR-007/FR-008; SC-003 | Unit/DB/E2E cover normalization, case/whitespace races, retries, retained/deleted users, and absence of automatic identity linking |
| FR-010/FR-016; SC-004 | Actual user creation followed by injected identity failure rolls back both records; repository tests enforce shared tx and database CHECK/FK/unique constraints |
| FR-012/FR-013; SC-007 | Real hash verification, distinct salts, safe user-list/profile projections, no session/cookie/token, and captured response/log checks |
| FR-017; SC-009 | Successful/failed attempts share the ten-per-60-second limiter; 11th attempt returns 429/Retry-After with no writes; clock-advanced expiry recovers and user reads remain available |
| FR-018; SC-010 | Table-driven Prisma/runtime fixtures verify exact 503 allowlist versus default 500, recognized constraint conflicts, timeout evidence, initialization errorCode, and no spoofed plain-object classification |
| SC-005 | 20-registration measured performance above |
| SC-006 | Message review confirms distinct plain-language success, field-correction, email-unavailable, and temporary-failure outcomes; no technical diagnostics are required to distinguish them |
| Migration preservation | Baseline-upgrade tests preserve retained user IDs/non-email fields, add no invented credentials, and abort normalized collisions without partial data changes |

Architecture review: AuthModule imports UserModule; UserModule does not import auth. Controller pipes own request validation, AuthService retains business orchestration and private hash/strategy functions, and repositories own queries/transaction creation. LocalStrategy in local.strategies.ts implements the provider-wide interface with register() only. The identity hash CHECK accepts both parameter orders emitted by supported Argon2 encoders. Non-E2E tests remain colocated with their modules.

Before running this version against an existing application database, apply the committed migrations with `npx prisma migrate deploy` using the intended DATABASE_URL. No application table reset, production migration, or deployment was performed. The existing Vite tsconfig-paths plugin emits an informational deprecation notice during tests; the checks themselves pass.
