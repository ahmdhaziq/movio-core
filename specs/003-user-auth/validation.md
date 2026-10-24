# Implementation evidence

2026-10-23: T001 verified published @nestjs/jwt 12.0.3 peer range includes Nest 12; installed with lockfile. T002 adds explicit public test-only keys and controllable clock.

Foundation (T003–T014): tests were authored before implementation; initial run failed for missing modules. After implementation, the three foundation suites plus registration controller/service suites pass: **5 files, 87 tests**. Command: `PATH=/opt/homebrew/bin:$PATH TEST_DATABASE_URL=postgresql://movio:movio_local@127.0.0.1:55432/movio npm test -- src/auth/auth-token.config.spec.ts src/auth/auth-refresh-migration.int-spec.ts src/auth/exceptions/auth-exception.filter.spec.ts src/auth/auth.controller.spec.ts src/auth/auth.service.spec.ts`.

Local PostgreSQL 17 started via Compose on port 55432 because 5432 was already allocated. All migration tests use random isolated schemas. Sandbox requires escalation for loopback database and HTTP listeners. Runtime for verification: Homebrew Node 25.9.0 (default shell Node 20.20.0 is too old for current dependencies). No developer schema reset or migration deployment to public.

US1 (T015–T030): test-first run failed for missing login methods/modules. After implementation, auth checks passed except a test-only concurrent insert ordering assumption, fixed and rerun successfully. Login E2E: **4/4 passed**. Build passed. Provider-selection includes a test-only alternate DTO without local credentials; production remains local-only. Login returns only after transaction commit; persistence/signing fault tests disclose no pair.

US2 (T031–T040): test-first run failed for missing guard/extractor/access verification. After implementation, **49/49 focused tests** and **47/47 E2E tests across 4 files** pass. Build passes. E2E confirms default protection before handler/DTO work, one JwtService verification per valid action, zero auth persistence calls, and accepted access after deletion/storage outage until exact signed expiry. Existing user/registration tests now log in before guarded reads.

US3 (T041–T050): refresh service tests failed before implementation. After implementation, **20/20 refresh unit/controller/PostgreSQL tests** pass, and lifecycle E2E grows to **11/11 passed**. Build and lint pass. Real same-token race yields at most one pair; replay commits family revocation before failure, including winner replacement, while access remains valid. Transaction-insert failure rolls back consumption. Exact hour/30-day boundaries, one-second final access, independent limiter recovery, and deleted user/identity cases pass.

US4 (T051–T058): logout service tests failed before implementation. After implementation, **26/26 logout/transaction checks** and **17/17 lifecycle E2E scenarios** pass. Real PostgreSQL logout-versus-refresh race uses the common root lock; all affected renewal is unusable afterward while another login renews. Revocation-write fault rolls back and returns failure. HTTP tests cover access/refresh/consumed-refresh logout, generic repeated/unknown results, missing credential 401, independent families, preserved access, safe 503/500 and request correlation IDs.

Final verification (T059–T062), 2026-10-23, Node **26.12.1**, Darwin arm64 / Apple M4 (10 CPUs), PostgreSQL 17:

| Command/check | Result |
|---|---|
| `npm run build` | PASS |
| `npm run lint` | PASS, no warnings |
| `npx tsc --noEmit --incremental false` | PASS, including test fixtures |
| `npm test` | PASS: 28 files, 298 tests |
| `npm run test:e2e` | PASS: 5 files, 60 tests |
| 20 distinct-IP real login requests | 20 successful; p95 167 ms, max 167 ms |
| 20 distinct-IP real refresh requests | 20 successful; p95 45 ms, max 49 ms |
| Compiled-application quickstart smoke | PASS: registration, login, default protection, refresh/replay, independent logout, deletion and expiry |
| `git diff --check` | PASS |

Final commands used `PATH=/private/tmp/movio-node-runtime/node_modules/.bin:/opt/homebrew/bin:$PATH`; test commands also used `TEST_DATABASE_URL=postgresql://movio:movio_local@127.0.0.1:55432/movio`. The temporary supported Node runtime avoids the shell's Node 20. Initial phase checks used Homebrew Node 25; final results above supersede those runtime checks. Each database suite owns a separate random schema, including the compiled smoke script `/private/tmp/movio-auth-smoke.mjs`; all smoke/test schemas are dropped afterward. Tests run real Argon2, JwtService and PostgreSQL; no limiter bypass was used for performance. Measurements describe this local workload, not a deployed production benchmark.

The final review added a regression for malformed JSON: responses already excluded the secret but lacked no-store. Auth middleware now sets no-store before parsing; the regression and full suites pass. The compiled smoke exercised the documented flow against built `dist/` code and used only a fresh schema, not developer tables.

Requirement evidence review:

| Requirement | Passing evidence |
|---|---|
| FR-001 | Login pipe, LocalStrategy authentication and lifecycle E2E: normalized email, exact password, active local identity |
| FR-002 | Provider pipe and login HTTP contracts: missing/non-text/extra/dangerous fields, reserved provider rejection, short existing passwords accepted |
| FR-003 | Strategy and lifecycle cases: unknown/wrong/deleted/missing hash share generic failure and retain no renewal credential |
| FR-004 | Signing, login orchestration/repository and E2E: safe profile, independent root, exact one-hour/fixed-30-day UTC deadlines |
| FR-005 | Global guard, user metadata checks and lifecycle action: default protected business routes, enumerated public exemptions |
| FR-006 | Token, access service and guard tests: pinned signature/issuer/audience/purpose/runtime claims, one verification, zero auth DB calls, verified request.user |
| FR-007 | Helper/guard/E2E: rejected tokens disclose no business data/side effects; access survives logout/deletion/storage outage until expiry |
| FR-008 | Refresh unit/E2E: renew after access expiry; original deadline preserved; near-deadline access capped |
| FR-009 | Real PostgreSQL refresh race, replay and rollback: at most one consume; replacement atomically inserted; replay revocation commits before 401 |
| FR-010 | Exact 30-day boundary, revoked family and deleted user/identity E2E; signed ownership/deadline/digest mismatch integration tests |
| FR-011 | Logout unit/controller/E2E: access/refresh/consumed-refresh identification, missing 401, generic repeated/unknown, renewal revoked before success |
| FR-012 | Logout and replay lifecycle cases plus DB race: independent logins remain usable |
| FR-013 | Digest-only repository storage, safe signing/commit failures, response/log inspections, no-store including malformed JSON; confidential transport documented for ingress |
| FR-014 | Lifecycle/registration E2E: independent login/refresh/registration limits, 11th attempt 429/Retry-After, success/validation counting, recovery, ordinary routes/logout unaffected |
| FR-015 | Fault injection in login/refresh/logout; rollback after writes; safe 503/500; storage-free valid access and fail-closed invalid access |
| FR-016 | Safe audit/filter/lifecycle checks: UTC operation/outcome/duration, shared correlation ID and X-Request-Id, no credentials/email/diagnostics |
| FR-017 | Explicit native-style body/bearer HTTP flow and contract review: no role/admin operations, no client UI |

| Success criterion | Passing evidence |
|---|---|
| SC-001 | Login validation/strategy/orchestration/repository/controller tests and E2E |
| SC-002 | One-verification guard test; authentication-only action; protected user reads; zero auth persistence spies |
| SC-003 | Injected-clock token/service/E2E tests immediately before/at hour and 30-day deadlines; final one-second access |
| SC-004 | Real same-token race and replay revocation commit/rollback cases |
| SC-005 | Independent login logout/deletion/replay lifecycle plus real logout/refresh race |
| SC-006 | Signing/storage/hash fault tests, rollback and secret inspection, stateless storage-outage action |
| SC-007 | Real 20-client login/refresh performance E2E above, all 20 of each below two seconds |
| SC-008 | Independent 11th-attempt limits, Retry-After and clock-driven limiter recovery |
| SC-009 | Public health/register/login, default new-action guard, outcome audit and mobile HTTP lifecycle |

Architecture review: Auth owns DTOs, strategies, guard, errors/filter, token infrastructure and refresh persistence. Controllers handle transport; services orchestrate; repositories own all Prisma/parameterized SQL. Dependencies stay AuthModule → UserModule/PrismaModule with Nest DI and no cycle. Module tests remain colocated; only full-application E2E lives under test/. One additive reviewed migration preserves retained accounts and enforces composite owner/root FKs plus one-current partial uniqueness. No Passport, server-session lookup, raw-token storage, enabled social provider, admin roles or client UI added.

No extension hooks were registered (`.specify/extensions.yml` absent). All 62 tasks complete. No known failing checks remain. Before running the API against an application database, supply distinct signing keys and apply the migration with `prisma migrate deploy`; these checks deliberately did not migrate the application's public schema. The planned single-instance limiter and expiry-based access revocation boundary remain as specified.
