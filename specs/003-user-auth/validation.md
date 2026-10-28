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

## Organization revision — 2026-10-29 (T063–T073)

Baseline: service suites passed **104/104** in six files. The sandboxed controller run discovered 51 cases but localhost listeners were blocked; rerunning the four controller files with listener permission passed **51/51**. No assertion changes were needed.

### Baseline expanded case inventory

Case names below include expanded parameterized inputs where the existing title interpolates them. Parameter matrices are preserved verbatim during transfer and compared against the original source.


**auth-access.service.spec.ts** (1 cases)

- Stateless AuthService access authenticates with unavailable persistence and performs no database calls


**auth-login.controller.spec.ts** (6 cases)

- Login HTTP contract through real pipes accepts flat local input and preserves the exact password

- Login HTTP contract through real pipes rejects malformed fields before dispatch

- Login HTTP contract through real pipes rejects malformed fields before dispatch

- Login HTTP contract through real pipes rejects malformed fields before dispatch

- Login HTTP contract through real pipes rejects malformed fields before dispatch

- Login HTTP contract through real pipes returns generic login failure


**auth-login.service.spec.ts** (6 cases)

- Login orchestration dispatches only credentials and stores only the refresh digest after ownership recheck

- Login orchestration waits for commit before disclosing tokens

- Login orchestration denies ownership becoming inactive before commit

- Login orchestration classifies storage P1001 safely

- Login orchestration classifies storage P2002 safely

- Login orchestration discloses no pair when signing fails


**auth-logout.controller.spec.ts** (10 cases)

- Logout HTTP contract accepts explicit access body credential

- Logout HTTP contract accepts explicit refresh body credential

- Logout HTTP contract rejects missing credentials with 401 despite access header

- Logout HTTP contract rejects missing credentials with 401 despite access header

- Logout HTTP contract rejects missing credentials with 401 despite access header

- Logout HTTP contract rejects invalid fields safely with 400

- Logout HTTP contract rejects invalid fields safely with 400

- Logout HTTP contract rejects invalid fields safely with 400

- Logout HTTP contract rejects invalid fields safely with 400

- Logout HTTP contract rejects invalid fields safely with 400


**auth-logout.service.spec.ts** (11 cases)

- Logout orchestration revokes only the verified access family before success

- Logout orchestration revokes only the verified refresh family before success

- Logout orchestration allows consumed refresh for logout identification only

- Logout orchestration returns generic confirmation for malformed without unrelated changes

- Logout orchestration returns generic confirmation for expired without unrelated changes

- Logout orchestration returns generic confirmation for unknown without unrelated changes

- Logout orchestration returns generic confirmation for revoked without unrelated changes

- Logout orchestration returns generic confirmation for owner-mismatch without unrelated changes

- Logout orchestration returns generic confirmation for bad-digest without unrelated changes

- Logout orchestration rejects missing credentials

- Logout orchestration never claims success on required persistence failure


**auth-refresh.controller.spec.ts** (9 cases)

- Refresh HTTP contract accepts only body refresh credential, no access header required

- Refresh HTTP contract safely rejects malformed body

- Refresh HTTP contract safely rejects malformed body

- Refresh HTTP contract safely rejects malformed body

- Refresh HTTP contract safely rejects malformed body

- Refresh HTTP contract safely rejects malformed body

- Refresh HTTP contract safely rejects malformed body

- Refresh HTTP contract maps AUTHENTICATION_REQUIRED

- Refresh HTTP contract maps AUTH_TEMPORARILY_UNAVAILABLE


**auth-refresh.service.spec.ts** (8 cases)

- Refresh orchestration consumes before replacing, returns safe user and preserves fixed deadline

- Refresh orchestration caps near-deadline access and never restarts 30 days

- Refresh orchestration rejects missing without issuing tokens

- Refresh orchestration rejects revoked without issuing tokens

- Refresh orchestration rejects deleted without issuing tokens

- Refresh orchestration rejects bad-digest without issuing tokens

- Refresh orchestration commits consumed-token revocation before throwing 401

- Refresh orchestration allows a current descendant even when its root was consumed


**auth-token.service.spec.ts** (35 cases)

- Purpose-specific signing signs exact access and refresh profiles with separate keys/audiences

- Purpose-specific signing caps access at the fixed original renewal deadline

- Purpose-specific signing propagates signing failure without a usable result

- Stateless access verification performs exactly one signature verification and returns only verified principal

- Stateless access verification rejects invalid runtime claims {"sub":"042"}

- Stateless access verification rejects invalid runtime claims {"sub":42}

- Stateless access verification rejects invalid runtime claims {"sub":"-1"}

- Stateless access verification rejects invalid runtime claims {"auth_identity_id":0}

- Stateless access verification rejects invalid runtime claims {"auth_identity_id":"7"}

- Stateless access verification rejects invalid runtime claims {"fid":"bad"}

- Stateless access verification rejects invalid runtime claims {"jti":null}

- Stateless access verification rejects invalid runtime claims {}

- Stateless access verification rejects invalid runtime claims {"exp":1800000000}

- Stateless access verification rejects invalid runtime claims {"iat":1800000001}

- Stateless access verification rejects invalid runtime claims {"iat":"1800000000"}

- Stateless access verification rejects invalid runtime claims {"token_use":"refresh"}

- Stateless access verification rejects invalid runtime claims {"renewal_exp":1800000001}

- Stateless access verification rejects invalid runtime claims {"exp":1800003601}

- Stateless access verification rejects wrong cryptographic profile {"secret":{"type":"Buffer","data":[82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82,82]}}

- Stateless access verification rejects wrong cryptographic profile {"algorithm":"HS384"}

- Stateless access verification rejects wrong cryptographic profile {"issuer":"other"}

- Stateless access verification rejects wrong cryptographic profile {"audience":"movio-refresh"}

- Stateless access verification uses current clock on every verification, rejecting exactly at expiry

- Stateless access verification rejects refresh-purpose tokens as access

- Refresh cryptographic profile rejects access credentials at the refresh verifier

- Refresh cryptographic profile rejects invalid refresh claims {"token_use":"access"}

- Refresh cryptographic profile rejects invalid refresh claims {"exp":1802591999}

- Refresh cryptographic profile rejects invalid refresh claims {"renewal_exp":1802591999}

- Refresh cryptographic profile rejects invalid refresh claims {"iat":1800000001}

- Refresh cryptographic profile rejects invalid refresh claims {"sub":"0"}

- Refresh cryptographic profile rejects invalid refresh claims {"fid":"bad"}

- Refresh cryptographic profile rejects invalid refresh claims {"auth_identity_id":"7"}

- Refresh cryptographic profile rejects invalid refresh claims {}

- Refresh cryptographic profile accepts immediately before and rejects exactly at the renewal deadline

- Refresh cryptographic profile preserves unexpected verifier failures instead of classifying them as invalid credentials


**auth.controller.spec.ts** (26 cases)

- Registration controller validation rejects invalid name without invoking services

- Registration controller validation rejects invalid name without invoking services

- Registration controller validation rejects invalid name without invoking services

- Registration controller validation rejects invalid name without invoking services

- Registration controller validation rejects invalid name without invoking services

- Registration controller validation rejects invalid email without invoking services

- Registration controller validation rejects invalid email without invoking services

- Registration controller validation rejects invalid email without invoking services

- Registration controller validation rejects invalid email without invoking services

- Registration controller validation rejects invalid email without invoking services

- Registration controller validation rejects invalid password without invoking services

- Registration controller validation rejects invalid password without invoking services

- Registration controller validation rejects invalid password without invoking services

- Registration controller validation rejects invalid password without invoking services

- Registration controller validation rejects invalid password without invoking services

- Registration controller validation rejects invalid provider without invoking services

- Registration controller validation rejects invalid provider without invoking services

- Registration controller validation rejects invalid provider without invoking services

- Registration controller validation rejects invalid provider without invoking services

- Registration controller validation rejects invalid provider without invoking services

- Registration controller validation rejects invalid role without invoking services

- Registration controller validation rejects invalid user_id without invoking services

- Registration controller validation rejects invalid identity_id without invoking services

- Registration controller validation rejects invalid password_hash without invoking services

- Registration controller validation normalizes name/email and preserves the exact password

- Registration controller validation logs validation outcome without submitted credentials or body


**auth.service.spec.ts** (43 cases)

- AuthService prepares credentials before atomically creating a user and identity

- AuthService does not report success until commit has resolved

- AuthService rejects retained users even without a local identity

- AuthService rejects retained users even without a local identity

- AuthService rejects an email claimed between the precheck and transaction

- AuthService maps availability P1001 to 503

- AuthService maps availability P1002 to 503

- AuthService maps availability P1008 to 503

- AuthService maps availability P1017 to 503

- AuthService maps availability P2024 to 503

- AuthService maps availability P2034 to 503

- AuthService recognizes positive P2028 timeout evidence

- AuthService recognizes positive P2028 timeout evidence

- AuthService maps initialization/configuration P1000 to 500

- AuthService maps initialization/configuration P1003 to 500

- AuthService maps initialization/configuration P1010 to 500

- AuthService maps initialization/configuration P1012 to 500

- AuthService maps initialization/configuration P1013 to 500

- AuthService maps initialization/configuration P1014 to 500

- AuthService maps initialization/configuration P1015 to 500

- AuthService recognizes unavailable initialization errorCode

- AuthService classifies P2002 and its constraint/cause

- AuthService classifies P2002 and its constraint/cause

- AuthService classifies P2002 and its constraint/cause

- AuthService classifies P2002 and its constraint/cause

- AuthService classifies P2002 and its constraint/cause

- AuthService classifies P2002 and its constraint/cause

- AuthService classifies P2028 and its constraint/cause

- AuthService classifies P2003 and its constraint/cause

- AuthService classifies P2004 and its constraint/cause

- AuthService classifies hashing failures before any write

- AuthService classifies hashing failures before any write

- AuthService classifies hashing failures before any write

- AuthService classifies hashing failures before any write

- AuthService classifies hashing failures before any write

- AuthService does not treat arbitrary storage objects or resource errors as hashing failures

- AuthService does not expose diagnostics in unexpected failures

- AuthService logs safe outcome metadata on success and failures without credentials

- AuthService preserves recognized dependency outcomes without exposing diagnostics

- AuthService preserves recognized dependency outcomes without exposing diagnostics

- AuthService preserves recognized dependency outcomes without exposing diagnostics

- AuthService rejects an unconfigured strategy before hashing or touching persistence

- AuthService never trusts a plain object carrying a Prisma error code

### Completed revision checks

T063 baseline inventory above contains all 155 expanded cases. Baseline run: six service specs passed 104/104; the four controller specs passed 51/51 after allowing Supertest's localhost listeners. The earlier sandbox listener failure was environmental and is superseded by this passing baseline.

T064 moved the factories unchanged to `src/auth/exceptions/auth-validation.exception.ts`, updated both consumers and its local AuthError import, and removed the old file. All existing four controller suites plus login pipe/filter suites passed before consolidation (77 cases).

| Task/checkpoint | Result |
|---|---|
| T065: registration/login/token service consolidation | 84 service cases passed |
| T066: registration/login controller consolidation | 32 controller cases passed |
| T067: stateless access transfer | 85 service cases passed |
| T068: refresh service transfer | 93 service cases passed |
| T069: refresh controller transfer | 41 controller cases passed |
| T070: logout service transfer | 104 service cases passed |
| T071: logout controller transfer | 51 controller cases passed |
| T072: final focused controller/service/login-pipe/filter run | 4 files, 181 cases passed |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |

Final command: `npm test -- src/auth/auth.controller.spec.ts src/auth/auth.service.spec.ts src/auth/pipes/login-validation.pipe.spec.ts src/auth/exceptions/auth-exception.filter.spec.ts`. HTTP test runs used permitted localhost listeners; persistence remained mocked and no database reset/migration was performed.

Case preservation checks compare the expanded case-name multisets against the original ten-file baseline: identical 51 controller and 104 service cases, with only an added AuthTokenService parent group. A TypeScript AST/printer comparison also confirms identical test bodies and parameter matrices (19 controller and 58 service test-call expressions, including `it.each` tables). Imports and fixture scoping changed; case inputs and assertions did not. Original source snapshots and JSON reports used for comparison are temporary verification artifacts under `/private/tmp/`.

Final inventory: only `src/auth/auth.controller.spec.ts` and `src/auth/auth.service.spec.ts` remain for auth controller/service subjects. All eight split source specs and `src/auth/auth-validation.ts` are removed. Both factory consumers use `exceptions/auth-validation.exception.js`. AuthService and AuthTokenService remain distinct production classes; DTO rules, error semantics, audit logging, dependencies, API contracts and Prisma artifacts are unchanged. Existing guard/pipe/strategy/config/repository/E2E tests and other domains retain their placement.

T073 reconciles the quickstart and internal contract with these implemented paths and results. The earlier 62-task completion statement and full database/E2E results above are historical; this revision completes T063–T073, making all 73 tasks complete. No database/E2E rerun was needed for this file organization change. No extension hooks are registered (`.specify/extensions.yml` absent).
