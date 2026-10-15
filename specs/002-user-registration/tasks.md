# Tasks: User Registration

**Input**: Design documents in `specs/002-user-registration/` — [spec](spec.md), [plan](plan.md), [data model](data-model.md), [research](research.md), [endpoint contract](contracts/auth-registration.md), [strategy contract](contracts/auth-strategy.md), and [quickstart](quickstart.md).

**Tests**: Included because the specification explicitly defines acceptance tests and the project constitution requires service, persistence/transport, and cross-module verification. Author the explicitly test-first batches (T010/T011, T014, T021/T022, T027/T028) before their corresponding implementation and confirm the expected failures. Other test tasks verify work already implemented and must pass when completed. All tests must pass at the relevant story/foundation checkpoint; no blanket test-first ordering applies to later integration or migration-verification tasks.

**Organization**: Setup → shared foundation → US1 creation → US2 validation feedback → US3 conflict/failure handling → cross-cutting delivery. These stories are incremental slices of one endpoint; US2/US3 depend on the US1 flow, but each has an independently runnable acceptance suite.

## Format and Scope

Every task uses `- [ ] Tnnn [P?] [USn?] Action with exact file paths`. `[P]` means it may be worked alongside the other marked task in the same ready test batch, after their shared prerequisites are complete. It does not remove dependencies. File paths are repository-relative.

Keep register(), private resolveStrategy(), and private hashPassword() together in auth.service.ts. LocalStrategy lives in local.strategies.ts and implements the provider-wide AuthStrategy, with register() only for now. Request validation belongs only to controller pipes; services enforce business invariants and database constraints. No sign-in, external provider integration, account linking, or additional hashing/resolver/transaction service is included.

A test-first authoring task is complete when its test cases are written, run, and confirmed to fail for the expected missing behavior (not a test-runner/configuration error); record that status as tests-authored, not feature-complete. Minimal loadable implementation shells may be introduced only to make these tests exercise missing behavior. An implementation or post-implementation verification task is complete only when its described changes/checks pass. At each foundation/story checkpoint, all tests belonging to that increment must be green, including earlier test-first cases. Dependencies below govern execution; never run tasks modifying the same file concurrently.


## Phase 1: Setup

**Goal**: Prepare the existing backend without creating a second project or extra service layers.

- [X] T001 Add compatible argon2 and @nestjs/throttler dependencies to `package.json` and update `package-lock.json`; verify installation works with the project’s Node runtime. Do not add a password-hasher service, resolver service, authentication implementation, or another transaction library.

- [X] T002 Confirm the implemented-file layout and existing isolated database-test helper in `src/prisma/testing/test-database.ts`; record setup/runtime prerequisites in `specs/002-user-registration/quickstart.md`. Reuse existing Nest, Vitest, and PostgreSQL configuration; keep new non-E2E tests under `src/auth/` and full-app tests under `test/`.

**Checkpoint**: Setup complete; begin the foundation.

## Phase 2: Foundational Prerequisites

**Goal**: Provide shared types, schema integrity, and transaction-aware user operations before building the registration endpoint.

**Independent verification**: Migrations preserve existing users; transaction-aware UserService operations use the supplied client; fresh and retained-data test schemas pass.

- [X] T003 Define `AuthProvider` in `src/auth/enums/auth-provider.enum.ts` with stable local/google/microsoft names and local-only support; define `AuthStrategy<P>` and registration context in `src/auth/strategies/auth-strategy.interface.ts`. The only operation is register(); context contains userId, typed payload { passwordHash: string }, and required Prisma.TransactionClient. Define internal creation/result metadata types in `src/auth/dto/create-auth-identity.dto.ts`; current local creation requires identity_id, user_id, provider, and password_hash. No prepare()/authenticate() stubs or all-optional DTO.

- [X] T004 Add AuthIdentity mapped to auth_identity and the User relation in `prisma/schema.prisma`: id "Int, primary key, autoincrement"; identity_id "String, required"; user_id "Int, required FK to User.id"; provider "String, required"; password_hash "String?, nullable"; created_at "DateTime, default now"; updated_at "DateTime, automatic update"; deleted_at "DateTime?, nullable". Keep provider as database text, use restrictive physical deletion, and declare unique (provider, identity_id) and (user_id, provider), including deleted rows.

- [X] T005 Create `prisma/migrations/20261014000100_add_auth_identity/migration.sql` from T004: add table/FK/composite unique keys and CHECKs implementing "Non-empty provider and identity_id", local identity_id = user_id cast to text, local nonempty encoded Argon2id password_hash, and "For non-local, password_hash must be null." Regenerate Prisma Client; do not add credentials/identities for existing users or add redundant user_id indexes.

- [X] T006 Create `prisma/migrations/20261014000200_normalize_user_email/migration.sql`: explicitly transact preflight/normalization/index creation so collisions abort before changes; preflight lower(btrim(email)) duplicates across retained active/deleted users, then normalize emails and add its expression unique index while keeping the existing exact email unique key. Preserve IDs/non-email fields; never merge/delete users automatically. Constraint: "All retained users, including soft-deleted users, reserve normalized email."

- [X] T007 Update `src/user/user.service.ts` and `src/user/user.repository.ts`: add getUserByEmail(email, tx?) returning a nullable retained user; allow create(dto, tx?) and its uniqueness lookup/insert to use the same tx, with root-client fallback only for standalone callers. Remove DTO revalidation from the create path; retain canonical email normalization on create/update and uniqueness business checks. Keep UserModule independent of auth and preserve existing public profile projections.

- [X] T008 Revise `src/user/user.service.spec.ts` and `src/user/user.repository.int-spec.ts` for T007: use valid DTO fixtures, remove create-only assertions expecting service field validation, verify same-tx forwarding for lookup/insert, root fallback, normalized create/update email, conflict handling, and deleted-user reservation. Preserve unrelated update/pagination/deletion tests and their behavior; no service DTO-validation tests for registration creation.

- [X] T009 Add `src/auth/auth-migration.int-spec.ts` using `src/prisma/testing/test-database.ts`: test fresh schema and upgrade from 20261012000000_add_user with retained users; assert IDs/non-email fields preserved, normalized emails, no invented identities/passwords, composite/FK/CHECK enforcement, and rollback of normalization when retained case/whitespace collisions exist. Use disposable schemas, never reset application data.

**Checkpoint**: Migrations preserve existing users; transaction-aware UserService operations use the supplied client; fresh and retained-data test schemas pass.

## Phase 3: User Story 1 — Register a New User (P1)

**Goal**: Accept a valid local registration and commit one user plus one protected local identity, returning safe confirmation.

**Independent verification**: An unauthenticated POST /auth/register returns 201 with user.id/name/email; one User and one local identity exist, the hash verifies the supplied password, and no session or secret is returned.

- [X] T010 [P] [US1] Write success-path tests in `src/auth/auth.service.spec.ts` using valid controller-normalized fixtures: resolve the injected local instance, hash before transaction start, create user then identity with the same tx, and return safe confirmation only after the transaction resolves. Mock argon2 directly; do not create a separate injected hash/resolver service or test service DTO revalidation.

- [X] T011 [P] [US1] Write persistence contract tests in `src/auth/auth.repository.int-spec.ts` for createIdentity(dto, tx), getIdentityByUserId(userId, provider?, tx?), and withTransaction(callback): successful callback commits, metadata excludes password_hash, lookups return arrays/empty arrays, optional provider filtering works, and retained deleted identities remain visible to reservation checks.

- [X] T012 [US1] Create `src/auth/dto/register-local.dto.ts` as a concrete flat request class with required provider/name/email/password; use controller-bound decorators/transforms only, local provider allowlist, guarded text transforms that trim name/email and lowercase email without coercing invalid types, and no password transform. Apply baseline required/type/email/name-limit checks; detailed password rules and structured field messages are completed in US2.

- [X] T013 [US1] Implement `src/auth/auth.repository.ts` with createIdentity requiring tx and persisting only internal derived fields; getIdentityByUserId returns an explicit metadata array without hash and optionally filters provider, including deleted rows; withTransaction<T>(callback) directly wraps Prisma.$transaction(callback), returns after commit, and propagates thrown errors for rollback. Keep all identity/database calls here; do not add a transaction service/file.

- [X] T014 [US1] Add unit tests in `src/auth/strategies/local.strategies.spec.ts` showing LocalStrategy.register derives rather than trusts identity IDs, forwards the provided user ID/hash/tx, propagates repository failure, and never returns hash metadata. Use repository mocks; retain this provider-wide file for future auth operations.

- [X] T015 [US1] Implement provider-wide `LocalStrategy` in `src/auth/strategies/local.strategies.ts`: register(context) derives identity_id String(context.userId), sets provider local and user_id, inserts payload.passwordHash via AuthRepository using context.tx, and returns secret-free metadata. Do not create the User here, hash inside the transaction, or add authentication/prepare operations.

- [X] T016 [US1] Implement private hashPassword(password) in `src/auth/auth.service.ts` with asynchronous argon2 Argon2id, memoryCost 19456 KiB, timeCost 2, parallelism 1, generated random salt, and encoded hash output. Preserve exact input, await hashing before transaction entry, and keep it private in this same file; test actual verification/salt uniqueness through service behavior without logging hashes.

- [X] T017 [US1] Implement register(dto) and private resolveStrategy(provider) together in `src/auth/auth.service.ts`: inject LocalStrategy/UserService/AuthRepository, resolve the existing strategy instance, precheck normalized email including retained users and inspect their identities, reject existing email, hash before writes, then recheck/create user and call strategy.register({ userId, payload: { passwordHash }, tx }) in one withTransaction callback. No Prisma queries or DTO validation in the service; no automatic linking.

- [X] T018 [US1] Add `src/auth/dto/registration-result.dto.ts` and `src/auth/auth.controller.ts`: expose public POST /auth/register, accept RegisterLocalDto through the configured ValidationPipe, delegate to AuthService, and return 201 with exactly { user: { id, name, email } }. No hash, identity object, cookie, token, automatic session, or new user-management endpoint.

- [X] T019 [US1] Wire `src/auth/auth.module.ts` and `src/app.module.ts`: AuthModule imports UserModule/PrismaModule, registers controller/AuthService/AuthRepository/LocalStrategy, and AppModule imports AuthModule. Confirm Nest resolves dependencies with no circular imports; hashPassword/resolveStrategy are private functions, not providers.

- [X] T020 [US1] Add success E2E in `test/auth.e2e-spec.ts` using real PostgreSQL and hashing: POST valid unauthenticated local registration, assert 201 projection, durable User plus local identity with String(user.id), hash verification and unique salts across distinct registrations, and credential-free existing public profile/list responses. No cookies/tokens; run T010/T011/T014 tests and the success E2E before marking US1 complete.

**Checkpoint**: An unauthenticated POST /auth/register returns 201 with user.id/name/email; one User and one local identity exist, the hash verifies the supplied password, and no session or secret is returned.

## Phase 4: User Story 2 — Correct Invalid Registration Details (P2)

**Goal**: Validate only at the controller boundary and return clear, secret-free field errors so a corrected submission succeeds.

**Independent verification**: Invalid/unsupported submissions return 400 identifying affected fields and create neither record; corrected details register successfully; services are not invoked for rejected DTOs.

- [X] T021 [P] [US2] Write controller/ValidationPipe contract tests in `src/auth/auth.controller.spec.ts` for missing/null/non-text provider/name/email/password, blank/overlong name, malformed email, unsupported fields, and missing/google/microsoft/unknown provider. Assert 400, field identifiers, no echoed values, and AuthService not called. Test transforms preserve the raw password and normalize name/email.

- [X] T022 [P] [US2] Write focused validator tests in `src/auth/validation/password-policy.validator.spec.ts`: passwords of 7/129 Unicode code points fail, 8/128 pass with every category; missing uppercase/lowercase/ASCII digit/symbol and whitespace-only special characters fail. Include Unicode letters and multicode-unit characters to verify code-point counting; assert separate stable codes for unmet rules.

- [X] T023 [US2] Implement `src/auth/validation/password-policy.validator.ts` and wire it into `src/auth/dto/register-local.dto.ts` at the controller pipe: enforce "8–128 Unicode code points, at least one Unicode uppercase letter, one Unicode lowercase letter, one ASCII digit, and one non-letter/non-digit/non-whitespace symbol." Enforce "Preserve exact supplied characters, do not normalize or trim. Whitespace cannot satisfy the symbol requirement." Avoid a new service/provider or validation call in AuthService/UserService.create.

- [X] T024 [US2] Complete controller DTO checks in `src/auth/dto/register-local.dto.ts`: enforce "required provider local, trimmed nonblank name at most 100 characters, normalized valid email, required password"; reject "missing/null/non-text fields, unsupported providers, and unknown fields." Ensure a 100-character trimmed name passes/101 fails; accepted email is trimmed/lowercase; never coerce arrays/numbers/objects into valid strings.

- [X] T025 [US2] Configure an auth-local ValidationPipe/exceptionFactory in `src/auth/auth.controller.ts` using the shared controller configuration from `src/configure-app.ts` as needed: return { statusCode: 400, code: VALIDATION_ERROR, message, errors: [{ field, code, message }] }, including stable password/provider/required/unsupported-field codes from the endpoint contract. Exclude class-validator target/value fields. Ensure global validation does not intercept first with an incompatible envelope; preserve unrelated endpoint behavior.

- [X] T026 [US2] Extend `test/auth.e2e-spec.ts` with invalid and corrected submissions, boundary name/password cases, rejected provider and injected user_id/identity_id/password_hash/role; verify zero new User/AuthIdentity rows for rejections, safe field errors, then successful corrected registration. Isolate limiter state so 429 cannot mask validation; run T021/T022 and controller tests before marking US2 complete.

**Checkpoint**: Invalid/unsupported submissions return 400 identifying affected fields and create neither record; corrected details register successfully; services are not invoked for rejected DTOs.

## Phase 5: User Story 3 — Safe Conflict and Failure Results (P2)

**Goal**: Return predictable conflicts/temporary failures while preventing duplicate, partial, or implicitly linked users.

**Independent verification**: Repeated/case-variant/concurrent emails yield at most one successful pair; a forced identity failure rolls back the new user; existing users stay unchanged, including those without a local identity.

- [X] T027 [P] [US3] Extend `src/auth/auth.service.spec.ts` with active/deleted users with and without local identity, including precheck identity inspection and transaction recheck; all return email unavailable and never attach credentials. Mock hash resource Error fixtures with ENOMEM/EAGAIN and generic Error/TypeError to assert no transaction starts and verify the 503/500 distinction. Add table-driven Prisma error tests for every allowlisted code, both recognized P2028 timeout phrases versus other P2028, recognized versus unknown P2002 targets, and configuration/internal errors from plan.md; preserve 400/409/429 outcomes instead of remapping them. Fixtures are valid DTOs; no service field-validation tests.

- [X] T028 [P] [US3] Extend `src/auth/auth.repository.int-spec.ts` with real transaction rollback after User creation when identity insertion fails; duplicate provider/subject and user/provider conflicts including deleted identities; invalid FK/local identifier/hash/nonlocal-hash CHECK failures; verify no extra retained User or identity after rollback and both writes use the transaction client.

- [X] T029 [US3] Complete conflict handling in `src/auth/auth.service.ts` and preserve user conflict semantics in `src/user/user.service.ts`: existing email always yields 409 EMAIL_UNAVAILABLE regardless of provider identity presence; map known email uniqueness races to the same result and identity uniqueness to 409 IDENTITY_UNAVAILABLE. Do not reuse/create credentials for retained users, revive deleted accounts, or expose their details.

- [X] T030 [US3] Complete failure classification in `src/auth/auth.service.ts` exactly per `specs/002-user-registration/plan.md` Failure classification: genuine Prisma P1001/P1002/P1008/P1017/P2024/P2034, selectively recognized P2028 timeout causes, and hash-call Error codes ENOMEM/EAGAIN yield 503 REGISTRATION_TEMPORARILY_UNAVAILABLE. Other P2028/unknown unique targets/configuration/FK-CHECK/query/validation/generic hash errors default to sanitized 500. Handle Prisma initialization errorCode and known-request code separately; plain objects with matching codes do not qualify. Let callback errors escape so rollback occurs. Distinguish conflict exceptions from availability failures; never catch-and-return a success value inside the transaction callback.

- [X] T031 [US3] Add auth-scoped exception response mapping in `src/auth/auth.controller.ts` so domain outcomes become the endpoint contract envelopes for 409/503/500, without raw Prisma errors, parameters, request DTOs, or stack traces. Keep this compact in the existing controller file unless Nest mechanics require a small local filter; retain controller-owned DTO validation and unrelated route responses.

- [X] T032 [US3] Extend `test/auth.e2e-spec.ts` with sequential retries, email case/whitespace variations, retained deleted users, and existing user with no local identity; run simultaneous same-email registrations within each IP limit and assert exactly one 201 with the rest 409, one User/local identity pair, and unchanged existing records. A retried lost-confirmation scenario must not create a duplicate.

- [X] T033 [US3] Add fault-injection E2E in `test/auth.e2e-spec.ts`: inject a recognized Prisma storage-availability failure during identity persistence after real UserService.create inside the transaction, expect sanitized 503 and no new records; inject a nonavailability identity failure and expect 500 with the same rollback; fail hashing before transaction with coded resource Error and generic Error fixtures, expect 503 and 500 respectively and no writes; test unknown/configuration/transaction-misuse errors produce sanitized 500 and no credentials in any response. Run conflict, repository rollback, and fault tests before marking US3 complete.

**Checkpoint**: Repeated/case-variant/concurrent emails yield at most one successful pair; a forced identity failure rolls back the new user; existing users stay unchanged, including those without a local identity.

## Phase 6: Polish & Cross-Cutting Verification

**Goal**: Finish the planned operations, documentation, and complete-feature checks without splitting service helpers into extra files.

**Independent verification**: Full test/build/lint checks pass; route limit and real end-to-end performance meet the documented contract; execution evidence is recorded.

- [X] T034 Add compact outcome logging to `src/auth/auth.service.ts` and `src/auth/auth.controller.ts`: record provider, success/validation/conflict/throttled/temporary/unexpected code, duration, and correlation ID; never log email, body, password, hash, or raw persistence errors. Add captured-log assertions in `src/auth/auth.service.spec.ts` and `src/auth/auth.controller.spec.ts` for success/failure/validation paths.

- [X] T035 Apply registration-only @nestjs/throttler configuration in `src/auth/auth.module.ts` and `src/auth/auth.controller.ts`: FR-017: 10 attempts per 60 seconds per trusted client IP, including successful/failed attempts; return 429 REGISTRATION_RATE_LIMITED plus Retry-After, no writes on throttled requests. Keep user read routes unaffected; do not trust arbitrary forwarded headers or create distributed-limiter infrastructure for this single-instance scope.

- [X] T036 Extend `test/auth.e2e-spec.ts` for SC-009: the 11th request/429/Retry-After/no writes, successful and rejected submissions sharing the same counter, window expiry recovery, and unaffected user reads. Ensure all existing validation/conflict tests reset or isolate limiter state; configure distinct trusted IP identities only in the isolated test app, not by enabling untrusted production header spoofing.

- [X] T037 Update `README.md` with POST /auth/register request/result examples, required fields/password rules, local-only provider support, no automatic sign-in, migrations and normalized-email preflight, controller-only DTO validation/internal caller contract, transaction wrapper explanation, single-instance throttle and trusted-proxy deployment assumptions. Keep example credentials synthetic.

- [X] T038 Run real-hash/real-PostgreSQL 20-concurrent distinct-email registrations using distinct trusted test IPs each within its attempt limit, as required by SC-005, in `test/auth.e2e-spec.ts` or an isolated validation runner referenced by `specs/002-user-registration/quickstart.md`; record runtime/hardware/hash parameters and measured p95 in that guide. At least 19 of 20 must complete within two seconds; do not bypass hashing/lower its baseline to pass. Run build/lint/unit-integration/E2E commands and record failures or passing evidence.

- [X] T039 Walk through all acceptance scenarios in `specs/002-user-registration/quickstart.md`, verify FR-001–FR-018 and SC-001–SC-010 against implemented behavior, and record concise evidence there; update `specs/002-user-registration/tasks.md` only for genuinely completed work. Review provider-wide strategy naming, register-only current interface, private same-file hash/resolver functions, module boundaries, migrations, and secret-free results before declaring the feature complete.

**Checkpoint**: Full test/build/lint checks pass; route limit and real end-to-end performance meet the documented contract; execution evidence is recorded.

## Dependencies & Execution Order

```text
T001–T002 Setup
  → T003 types → T004 schema → T005 identity migration → T006 email migration
  → T007 user transaction path → T008 user verification → T009 migration verification
  → US1 T010–T020 (functional registration)
  → US2 T021–T026 (controller validation feedback)
  → US3 T027–T033 (safe conflict and failure results)
  → T034–T039 operational checks and final verification
```

| Work | Must be complete first | Execution detail |
|------|------------------------|------------------|
| T001–T002 | None | Set up dependencies/context; no runtime feature yet |
| T003–T009 | Setup | Execute sequentially: schema before migrations, migrations before DB tests, user refactor before revised user tests |
| T010 + T011 | Foundation | Different service/repository test files may be authored in parallel; complete authoring and expected-failure verification before US1 implementation; green tests required only at the US1 checkpoint |
| T012–T013 | T010/T011 tests authored | Implement DTO/repository; run T011 to green |
| T014–T017 | T012/T013 | Author T014 local-strategy cases with expected failures; implement local strategy in T015 and make them green; T016 adds hashing; T017 integrates the service and makes T010 green |
| T018–T020 | T017 | Controller then module wiring, then success E2E. T014/T010/T011 must pass before the US1 checkpoint |
| T021 + T022 | US1 | Independent controller and password-validator test files may be authored in parallel |
| T023–T026 | T021/T022 | Validator, complete DTO, validation envelope, then full rejection/correction E2E |
| T027 + T028 | US1 and US2 | Independent service and repository failure-test files may be authored in parallel |
| T029–T033 | T027/T028 | Conflict policy, temporary failure mapping, controller envelopes, concurrent cases, then rollback fault E2E |
| T034–T039 | All stories | Sequential because service/controller/E2E files overlap; limit configuration before limiter E2E, then docs/performance/final evidence |

US1 is the first demonstrable increment. US2 and US3 each test their own user-facing outcomes but build on the shared registration implementation; do not interpret them as separate endpoints or independent deployment-ready features. Do not run US2 and US3 simultaneously against their shared controller/service/E2E files.

## Parallel Execution Examples

**US1**, after the foundation: author T010 in `src/auth/auth.service.spec.ts` alongside T011 in `src/auth/auth.repository.int-spec.ts`. One verifies service sequencing; the other verifies database contracts. Implementation waits until tests are authored and expected failures are established; this does not require the tests to pass before implementation.

**US2**, after US1: author T021 in `src/auth/auth.controller.spec.ts` alongside T022 in `src/auth/validation/password-policy.validator.spec.ts`. The controller batch verifies rejection/delegation; the validator batch verifies code points and character categories.

**US3**, after US2: author T027 in `src/auth/auth.service.spec.ts` alongside T028 in `src/auth/auth.repository.int-spec.ts`. Service failure classification and real database rollback checks operate in separate files. Use separate disposable schemas for any concurrent database execution.

These are scheduling opportunities for implementation, not instructions to create agents or run work during task generation.

## Requirements Traceability

| Requirements/outcomes | Primary tasks |
|-----------------------|---------------|
| FR-001, FR-005, FR-006; SC-001 | T013–T020 |
| FR-002, FR-003, FR-009, FR-011, FR-014, FR-015; SC-002, SC-008 | T012, T021–T026 |
| FR-004, FR-007, FR-008; SC-003 | T006–T009, T017, T027–T032 |
| FR-010, FR-016; SC-004 | T007, T013, T017, T027–T033 |
| FR-012, FR-013; SC-007 | T010–T020, T025, T031, T033–T034 |
| SC-005 latency | T038 |
| SC-006 understandable outcomes | T025–T026, T031, T039 |
| FR-017; SC-009; limiter/deployment assumptions | T035–T037 |
| FR-018; SC-010; availability vs internal-error distinction | T027, T030–T031, T033, T039 |

## Implementation Strategy

**MVP demonstration**: Complete setup/foundation and US1 (T001–T020). Demonstrate valid local registration with user/identity persistence, safe response, no session, and credential protection. Controller baseline checks and transaction correctness are part of this increment. Finish US2, US3, and cross-cutting checks before claiming the complete feature or production readiness.

**Incremental delivery**: Add clear field-specific validation (US2), then reliable conflict/concurrency/rollback outcomes (US3). Run each story’s independent tests at its checkpoint. Finish logs, limits, documentation, real-load verification, and acceptance review.

**Verification commands**: Use `npm run build`, `npm run lint`, `npm test`, and `npm run test:e2e` with local PostgreSQL running as described in quickstart.md. Run targeted checks during development and the complete set in T038; rerun beyond that only when changes/failures justify it.

**Guardrails**: No writes to the root Prisma client inside the registration transaction callback; no catch-and-success return after a failed identity write; no service DTO revalidation; no automatic email-based account linking; no plaintext credential logging; no source implementation in this task-generation phase.
