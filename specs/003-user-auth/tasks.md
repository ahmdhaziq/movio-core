# Tasks: Stateless Access JWTs and Stored Refresh Tokens

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [HTTP contract](contracts/authentication-api.md), [internal contract](contracts/auth-internal.md), [validation guide](quickstart.md).

**Organization**: Implement in phase order. Every task names the code or evidence file and the result to achieve. All tasks are initially unchecked; this document is an implementation checklist, not a claim that the feature exists.

**Tests**: Included because the specification explicitly requires acceptance, concurrency, expiry, confidentiality and performance tests, and the constitution requires tests at the behavior-owning layer. Within each phase write the listed tests before the matching behavior and confirm they fail for the missing behavior; run them again at its checkpoint. A written test is not a passed test. Only full-application E2E tests go under `test/`.

**Read this first**:

- Access JWT = one-hour credential; the guard verifies it through Nest JwtService without any database lookup.
- Refresh JWT = credential stored only as a digest; replacements share the first token's `root_token_id` and fixed 30-day deadline. This group is called a refresh family.
- Logout/reuse revokes future renewal, not already issued access. There is no server-session table.
- `LoginDto` selects the provider's concrete request DTO. `LocalStrategy.authenticate()` accepts only its mapped `AuthenticateLocalDto`; future providers can have different input fields. Only local is enabled now.
- Own guard implements CanActivate; auth errors/filters live under `src/auth/exceptions/`. No Passport, roles, admin portal or mobile UI implementation is included.
- `[P]` means a task can be authored alongside other marked tasks in the same group after their phase prerequisites. Shared service/controller/repository edits stay sequential.
- Paths are repository-relative. Keep ESM `.js` imports. Use the existing isolated-schema database helper; never reset developer tables. Future `validation.md` is a short implementation evidence log, not another feature specification.

## Revision scope — 2026-10-29

T001–T062 are completed implementation history; retain their checked status and original paths. T063–T073 implement the plan's three organization changes and are now complete; executed checks are recorded in `validation.md`. Historical controller/service spec paths and `src/auth/auth-validation.ts` are superseded by the destinations below once those moves are complete. No new business behavior, dependency, persistence model or migration is requested. All auth module service cases, including AuthTokenService, belong in `src/auth/auth.service.spec.ts`; controller contracts belong in `src/auth/auth.controller.spec.ts`.

Constitution check: PASS. Auth owns the moved factories and all non-E2E tests; Controller → Service → Repository responsibilities and production class boundaries remain unchanged. Preserve existing coverage and error semantics. No new test suite is required just to mirror these file moves. Follow [plan.md](plan.md), research decisions 8–10 and the three relocation/consolidation guides in [quickstart.md](quickstart.md).

## Phase 1: Setup — Add the JWT dependency and safe test configuration

Use the existing project and auth module. Do not create another application or install Passport.

- [X] T001 Add only a published Nest-12-compatible `@nestjs/jwt` release to `package.json` and `package-lock.json`; verify its peer dependencies and preserve the existing ESM setup. Do not add Passport, session middleware or another JWT library.

- [X] T002 Create explicit test-only signing keys and an overridable clock fixture in `src/auth/testing/auth-test-config.ts`; update test application bootstraps in `src/auth/auth.controller.spec.ts`, `test/auth.e2e-spec.ts`, `test/user.e2e-spec.ts` and `test/app.e2e-spec.ts` to use it when JWT configuration becomes required. Keep credentials out of tracked environment files and preserve isolated database schemas.

## Phase 2: Foundation — Shared storage, configuration and safe errors

**Goal**: Prepare the infrastructure used by every story. Complete this phase before story implementation. Write the tests first; the checkpoint runs them again after implementation.

- [X] T003 [P] Write configuration/clock tests in `src/auth/auth-token.config.spec.ts`: missing, malformed, shorter-than-32-byte or identical decoded secrets fail startup; separate valid keys work; the clock returns the current time rather than a startup timestamp.

- [X] T004 [P] Write retained-data upgrade tests in `src/auth/auth-refresh-migration.int-spec.ts`: deploy real migrations in isolated schemas, preserve active/deleted users and identities, allow a self-referencing root insert, reject owner/root mismatches and two current refresh tokens per family, and delete descendants before roots during cleanup.

- [X] T005 [P] Write filter contract tests in `src/auth/exceptions/auth-exception.filter.spec.ts`: new auth failures preserve 401/503, registration keeps its current error codes/messages, unrelated user errors remain unchanged, Retry-After survives, and responses/logs contain no submitted secrets.

- [X] T006 Add `RefreshToken` ownership fields and reverse relations in `prisma/schema.prisma`, mapped to `refresh_token`: `id` UUID — "Primary key, equals refresh JWT jti; service generated"; `user_id` integer — "Required User.id FK, restrictive deletion"; `auth_identity_id` integer — "Required AuthIdentity.id, not provider text identity_id"; `root_token_id` UUID — "Required self-reference to first refresh row in this login". Do not add a session table or store access JWTs.

- [X] T007 Complete the fields in `prisma/schema.prisma`: `token_hash` char(64) — "Unique lowercase SHA-256 hex of complete refresh JWT"; `expired_at` timestamptz — "Fixed original login time +2,592,000 seconds, same for every generation"; nullable `consumed_at` — "Set once when used successfully for refresh"; nullable `revoked_at` — "Set when refresh family is revoked"; `created_at` timestamptz — "Whole-second UTC issuance time". Initial rows use `root_token_id=id`; replacements retain owner/root/deadline.

- [X] T008 Create `prisma/migrations/20261016000100_add_refresh_tokens/migration.sql` with the new table, User FK, AuthIdentity unique `(id,user_id)` and owner FK `(auth_identity_id,user_id)`, refresh unique `(id,user_id,auth_identity_id)` and matching composite root FK, restrictive deletes, and indexes on user/identity/root/expiry. Add partial unique `(root_token_id) WHERE consumed_at IS NULL AND revoked_at IS NULL`. Keep existing account data unchanged; generate the Prisma client without resetting application tables.

- [X] T009 Implement `src/auth/auth-clock.ts` and `src/auth/auth-token.config.ts`, and document variable names in `.env.example`: two distinct base64 keys of at least 32 decoded random bytes; HS256 only; issuer `movio-core`; audiences `movio-api`/`movio-refresh`; access 3,600 seconds; renewal 2,592,000 seconds. No default production keys; capture no fixed verification timestamp.

- [X] T010 Define transport-independent auth error types in `src/auth/exceptions/auth-errors.ts` for invalid credentials, authentication required, rate limiting, temporary failure and unexpected failure. Keep errors and any custom exceptions under `src/auth/exceptions/`; do not introduce HTTP request/response objects into service/repository contracts.

- [X] T011 Extract/generalize the existing registration filter into `src/auth/exceptions/auth-exception.filter.ts`, updating `src/auth/auth.controller.ts`: preserve registration behavior and add operation-aware safe auth mapping. Provide a narrowly scoped auth-error filter for guard failures on other controllers; never blanket-convert all exceptions into 401 or change unrelated user errors.

- [X] T012 Add a request correlation reference and reusable safe outcome logging in `src/auth/auth-audit.ts` and `src/configure-app.ts`: record UTC time, operation, outcome, duration and one correlation ID reused by guard/service/filter. Exclude email, request bodies, passwords, raw tokens, stored hashes/digests and internal diagnostics; prepare success and failure logging for later stories.

- [X] T013 Register JWT configuration, clock and supporting providers in existing `src/auth/auth.module.ts`; keep AuthModule → UserModule/PrismaModule dependency direction. Apply `Cache-Control: no-store` to all auth responses in `src/auth/auth.controller.ts`. Do not enable the global access guard until the guarded-route story.

- [X] T014 Run the foundation tests through `npm test -- src/auth/auth-token.config.spec.ts src/auth/auth-refresh-migration.int-spec.ts src/auth/exceptions/auth-exception.filter.spec.ts` with PostgreSQL available. Record commands/results in `specs/003-user-auth/validation.md`; fix failures before starting stories. Existing registration must still work without issuing login tokens.

## Phase 3: US1 — Log In to the Application (P1)

**Goal**: Accept a provider-selected login request, authenticate local credentials and return access/refresh JWTs only after the refresh digest is stored.

**Independent test**: Register a local user, log in, and verify the returned identity, one-hour access, fixed 30-day renewal deadline and stored digest. Invalid credentials produce the same 401 and retain no new refresh row.

**Tests first**: Add these cases before implementing the matching behavior. `[P]` test-authoring tasks use separate files and may run together once the foundation is ready.

- [X] T015 [P] [US1] Write request/pipe tests in `src/auth/pipes/login-validation.pipe.spec.ts`: select the concrete local DTO, normalize email only, preserve password, reject missing/null/non-text/extra/dangerous fields and unsupported reserved providers before strategy calls. Include an isolated test-only alternate-provider DTO to prove it need not contain email/password.

- [X] T016 [P] [US1] Extend `src/auth/strategies/local.strategies.spec.ts` with authenticate tests: verify the local identity password hash, reject deleted users/identities, unknown emails, missing local hashes and wrong passwords with the same domain error; do not return hashes or break register().

- [X] T017 [P] [US1] Write `src/auth/auth-login.repository.int-spec.ts` for internal credential lookup, initial root-token creation and transaction rollback. Assert other providers are not selected, refresh storage contains a digest rather than either raw JWT, and failed persistence leaves no refresh row.

- [X] T018 [P] [US1] Write signing tests in `src/auth/auth-token.service.spec.ts`: both JWTs have the exact purpose-specific claims from `contracts/auth-internal.md`, different keys/audiences, unique jti, immutable fid/renewal_exp, exact deadlines and no PII/roles/passwords; signing failure discloses no partial pair.

- [X] T019 [P] [US1] Write login orchestration tests in `src/auth/auth-login.service.spec.ts`: resolve the matching provider strategy, pass only its credential DTO, use its safe authenticated-user result for token issuance, recheck active ownership before persistence, return only after commit, and classify hashing/storage failures without exposing secrets.

- [X] T020 [P] [US1] Write `src/auth/auth-login.controller.spec.ts` against the actual configured global and parameter pipes: flat local request succeeds with 200 and the documented token result; malformed/unsupported input is safe 400; all account/mismatch cases share 401; registration stays 201 with no tokens and no automatic login.

- [X] T021 [US1] Create `src/auth/dto/login.dto.ts`, `login-local.dto.ts`, `authenticate-local.dto.ts` and `authenticated-user.dto.ts`; extend `src/auth/strategies/auth-strategy.interface.ts`. Map Local → its request/credential DTO; define `LoginDto` as the provider-discriminated request union and `authenticate(input: AuthenticationPayloadMap[P]): Promise<AuthenticatedUserDto>`. Preserve register() and provider/payload type correlation. Local password: nonempty text, max 128 Unicode code points, no new complexity rule.

- [X] T022 [US1] Implement `src/auth/pipes/login-validation.pipe.ts` with an explicit enabled-provider Map and concrete DTO transformation/validation; reject null/arrays, inherited lookup keys, __proto__/constructor/prototype fields and unsupported providers safely. Whitelist fields, forbid extras, disable implicit coercion and sanitize errors through `src/auth/auth-validation.ts`. Only local is enabled.

- [X] T023 [US1] Add `findLocalCredentialsByEmail()` and `createRefreshToken(dto,tx)` in `src/auth/auth.repository.ts`; define internal `src/auth/dto/create-refresh-token.dto.ts` with id, user_id, auth_identity_id, root_token_id, token_hash, expired_at and created_at. Add a private credential/active-owner projection without widening public IdentityMetadata; all writes use the caller’s Prisma 6 transaction.

- [X] T024 [US1] Implement `LocalStrategy.authenticate(AuthenticateLocalDto)` in `src/auth/strategies/local.strategies.ts`: lookup normalized email and provider local, require user/identity deleted_at null, run `argon2.verify(storedHash,password)`, use a precomputed dummy hash for missing-credential branches, and return only safe user/identity data. Treat corrupt hashes/configuration as internal failures, not password mismatches.

- [X] T025 [US1] Implement `signAccessToken()`/`signRefreshToken()` in `src/auth/auth-token.service.ts` using Nest `JwtService.signAsync()`. Generate purpose-specific claims, integer-second iat/exp, access exp=min(now+3600,renewal_exp), refresh exp=renewal_exp; create only SHA-256 refresh digests for storage. Add `src/auth/dto/token-result.dto.ts` matching the response contract.

- [X] T026 [US1] Implement typed `login(provider,input)` and strategy resolution in `src/auth/auth.service.ts`: authenticate, establish root/token IDs and fixed deadline, sign pair, recheck active ownership inside the persistence transaction, insert the initial root refresh row and return the pair after commit only. Do not log/stream provisional JWTs. Use the safe audit/error infrastructure and preserve register().

- [X] T027 [US1] Add POST `/auth/login` to `src/auth/auth.controller.ts` and wire the pipe/strategy/token providers in `src/auth/auth.module.ts`. The body parameter must use the generic request metatype Object plus LoginValidationPipe, not LoginLocalDto/base-class global validation. Separate provider from validated credentials without unchecked casts; return 200 with the documented safe result.

- [X] T028 [US1] Configure login’s independent 10-attempt/60-second trusted-IP bucket in `src/auth/auth.controller.ts`, retaining registration’s separate bucket and Retry-After. Count successes and validation/authentication failures; do not trust arbitrary forwarded headers or rate-limit ordinary user routes through this bucket.

- [X] T029 [US1] Add login scenarios to `test/auth-token.e2e-spec.ts`: real registered user, case/whitespace email handling, exact password, generic failures, no raw-token storage, no response before successful commit, no-store header, and the 11th login attempt returning 429. Use explicit test keys and isolated schemas.

- [X] T030 [US1] Run US1 unit/controller/repository tests and the login cases in `test/auth-token.e2e-spec.ts`; record results in `specs/003-user-auth/validation.md`. Verify the local DTO map is extensible without enabling a real social provider; do not mark this story complete just because its tests were written.

## Phase 4: US2 — Protect Guarded Operations (P1)

**Goal**: Reject unauthenticated business requests before controller behavior, using stateless JWT verification and our own CanActivate guard.

**Independent test**: Call user reads and a test-only guarded action with valid, absent, malformed, expired and refresh-purpose tokens. Only valid access reaches the handler; authentication performs zero database calls. Requires US1 for real login fixtures.

- [X] T031 [P] [US2] Write `src/auth/helpers/extract-bearer-token.spec.ts`: accept one case-insensitive Bearer scheme with one token; reject absent/empty/wrong-scheme/extra-component, duplicate raw Authorization headers and tokens over 4,096 characters; never use cookie/query tokens.

- [X] T032 [P] [US2] Write `src/auth/guards/access-token.guard.spec.ts`: verify one service validation call, no principal attached before success, verified request.user on success, safe 401 rather than false/403 on failure, explicit public/refresh/logout modes only, and rejection before a protected handler runs.

- [X] T033 [US2] Add access-verification tests to `src/auth/auth-token.service.spec.ts` and `src/auth/auth-access.service.spec.ts`: reject wrong key/algorithm/issuer/audience/purpose, missing/wrong-type claims, invalid ID shapes, future iat and exp at exactly now; accept valid access with unavailable storage and assert zero auth-repository/UserService calls. Do not run this task concurrently with other edits to auth-token.service.spec.ts.

- [X] T034 [US2] Implement `verifyAccessToken()` in `src/auth/auth-token.service.ts` and `validateAccessToken()` in `src/auth/auth.service.ts` using `JwtService.verifyAsync()` once, with pinned access options, per-call current clockTimestamp and runtime claim checks. Return only userId/authIdentityId/refreshFamilyId; do not query storage or expose a public decoded-claims bypass.

- [X] T035 [US2] Implement `src/auth/helpers/extract-bearer-token.ts` to enforce the tested raw-header/scheme/token-length rules and return only the raw token. Extraction must not decode, verify or log credentials.

- [X] T036 [US2] Create `src/auth/decorators/auth-mode.decorator.ts`, `src/auth/types/authenticated-request.ts` and `src/auth/guards/access-token.guard.ts`. Implement CanActivate directly: read mode, extract token, await service verification, assign request.user and return true. Map invalid/missing credentials to safe 401, keep unexpected failures distinct, and use no Passport or server-session lookup.

- [X] T037 [US2] Register the guard using APP_GUARD in `src/auth/auth.module.ts`; explicitly mark register/login and root GET `/` in `src/auth/auth.controller.ts`/`src/app.controller.ts`. Protect `/user/list`, `/user/:id` and newly added unexempted business routes by default; reserve refresh/logout modes for their own handlers. Preserve the root greeting and authenticated user response shapes.

- [X] T038 [US2] Update authenticated-read expectations in `src/user/user.controller.spec.ts`, `test/user.e2e-spec.ts` and `test/auth.e2e-spec.ts`: obtain access through login before user reads, retain parameter/404 checks with valid authentication, and retain registration’s token-free response. Confirm missing access is rejected before user DTO/business processing.

- [X] T039 [US2] Add guarded read/action scenarios to `test/auth-token.e2e-spec.ts`, using a test-only POST handler and side-effect spy rather than a production write endpoint. Cover valid/invalid access, refresh-as-bearer, explicit exemptions and a newly added default-guarded test route; prove valid access authenticates with a deleted account or unavailable auth storage until signed expiry.

- [X] T040 [US2] Run the US2 helper/service/guard/controller checks and affected user/auth E2E suites; record results in `specs/003-user-auth/validation.md`. Confirm a valid request uses exactly one JWT signature verification and zero authentication persistence calls, and invalid requests perform zero protected business side effects.

## Phase 5: US3 — Renew Access Without Logging In Again (P2)

**Goal**: Rotate refresh JWTs safely until the original fixed 30-day deadline, detecting reuse without revoking already issued access.

**Independent test**: Advance the clock past access expiry, refresh successfully, reuse the old refresh and confirm all further renewal for that family fails while issued access stays valid until exp. Requires US1 issuance and US2 access verification.

- [X] T041 [P] [US3] Write `src/auth/auth-refresh.service.spec.ts`: current refresh succeeds without password; missing/invalid/revoked/consumed credentials reject; root consumption alone does not revoke a valid child; near-deadline access is capped; deletion prevents renewal; reuse revokes renewal only and the original deadline never moves.

- [X] T042 [P] [US3] Write real PostgreSQL transaction tests in `src/auth/auth-refresh.repository.int-spec.ts`: concurrent same-token requests produce at most one consumption; consumed-token reuse commits family revocation before a 401; bad digest/owner/root does not revoke unrelated rows; consume/insert failure rolls back and exposes no pair.

- [X] T043 [P] [US3] Write `src/auth/auth-refresh.controller.spec.ts`: strict refresh_token-only body, safe 400 versus 401/503, no access-header fallback, 200 replacement shape/no-store, independent 11th-attempt rate limit with Retry-After and resumed attempts after window expiry.

- [X] T044 [US3] Add `src/auth/dto/refresh-token.dto.ts` with required nonempty ASCII refresh_token of at most 4,096 characters; extend `src/auth/auth-validation.ts` and `src/configure-app.ts` for safe field errors while retaining registration and provider-selected login validation.

- [X] T045 [US3] Implement `verifyRefreshToken()` in `src/auth/auth-token.service.ts` and `validateRefreshToken()` in `src/auth/auth.service.ts`: verify refresh-specific JWT options/claims, match SHA-256 digest with timingSafeEqual, compare signed owner/root/jti/deadline, and require live account/identity eligibility. Return internal evidence for locked rechecking, never business-route authorization.

- [X] T046 [US3] Add `findRefreshTokenById()`, `lockRefreshRoot()`, `consumeRefreshToken()` and `revokeRefreshFamily()` in `src/auth/auth.repository.ts`, using caller transactions and parameterized SELECT FOR UPDATE. Lock retained root before generation reads/writes, verify affected counts and keep all history through expiry; distinguish consumed root from revoked root.

- [X] T047 [US3] Implement `refresh()` in `src/auth/auth.service.ts`: verify then lock/recheck root, token, owner/account and current time; consume current token before inserting its replacement, keep original deadline/root, sign the pair and respond only after commit. For matching consumed-token reuse, return a typed outcome, commit family revocation, then throw 401 outside the transaction. Do not revoke outstanding access or automatically retry refresh requests.

- [X] T048 [US3] Add POST `/auth/refresh` and its refresh-only auth mode in `src/auth/auth.controller.ts`; wire its DTO and independent ten-per-60-second bucket in `src/auth/auth.module.ts` as needed. The endpoint must validate its body credential even though it bypasses the access-token guard; do not require an unexpired access token.

- [X] T049 [US3] Extend `test/auth-token.e2e-spec.ts` with real renewal, response-loss/retry behavior, before/at-hour and before/at-30-day boundaries, near-deadline access cap, changed deadline/ownership rejection, inactive user/identity, and consumed-token replay. Assert replacement refresh is revoked on replay but issued access still authenticates until its expiry.

- [X] T050 [US3] Run refresh unit/controller and PostgreSQL race tests plus affected E2E cases; record results in `specs/003-user-auth/validation.md`. Verify the family revocation remains committed after the public 401 and no test relies solely on mocked transaction ordering or real hour/month waits.

## Phase 6: US4 — Log Out and Prevent Further Renewal (P2)

**Goal**: Revoke renewal for the current login without changing other logins or attempting immediate access-token revocation; handle failure results honestly.

**Independent test**: Create two logins, log out one with access or refresh evidence, and confirm only that family loses renewal. Its access JWT remains usable until expiry. Requires the earlier token/guard/refresh primitives.

- [X] T051 [P] [US4] Write `src/auth/auth-logout.service.spec.ts`: access or refresh identifies its own family; matching consumed refresh can identify it; repeated/unknown/malformed/expired logout gives generic Signed out; missing token is rejected; database failure is 503; separate logins and issued access remain unaffected.

- [X] T052 [P] [US4] Write `src/auth/auth-logout.controller.spec.ts`: accept only token_type access/refresh and token, enforce nonempty ASCII <=4,096 characters, distinguish missing credentials 401 from invalid token_type/extra fields 400, preserve no-store and generic 200, use body only, and exclude logout from login/refresh buckets.

- [X] T053 [US4] Create `src/auth/dto/logout.dto.ts` and extend `src/auth/auth-validation.ts`/`src/configure-app.ts` for the documented missing-token and field-error behavior. Never echo token input or permit client-chosen family/user IDs.

- [X] T054 [US4] Implement `logout()` in `src/auth/auth.service.ts`: use purpose-correct raw JWT verification, verify stored owner and (for refresh) digest, lock the retained root via `src/auth/auth.repository.ts`, and revoke its refresh family before returning Signed out. Matching consumed refresh is usable for identification only; unknown/invalid credentials cannot mutate unrelated rows. Do not alter stateless access validity or report success when required persistence fails.

- [X] T055 [US4] Add POST `/auth/logout` with logout-only mode and no authentication-attempt limiter in `src/auth/auth.controller.ts`; connect operation-aware exception mapping and safe outcome audit logging. Ensure the controller invokes the credential-validating service and does not become an unprotected business-route exemption.

- [X] T056 [US4] Extend `src/auth/auth-refresh.repository.int-spec.ts` with real logout-versus-refresh concurrency tests: both lock the same root, no successful renewal remains after logout commit, unrelated family stays usable, and a transaction failure does not claim revocation. Keep existing root/descendant cleanup order.

- [X] T057 [US4] Add logout and availability scenarios in `test/auth-token.e2e-spec.ts`: two logins, access/refresh/consumed-refresh logout, repeated/missing/unknown credentials, renewal denial after logout, access acceptance until expiry, and sanitized persistence/internal failures. Inspect logs for zero secret exposure and shared request correlation IDs.

- [X] T058 [US4] Run US4 service/controller and affected race/E2E tests; record results in `specs/003-user-auth/validation.md`. Confirm logout revokes renewal rather than outstanding access, and failed logout never claims a completed revocation.

## Phase 7: Polish — Full verification and clear usage documentation

Complete after all four stories. These tasks finish the feature; they are not a substitute for the story checkpoints.

- [X] T059 Add and run 20-client login and refresh workloads in `test/auth-performance.e2e-spec.ts` with real Argon2/JWT/PostgreSQL and distinct trusted IPs within attempt limits; at least 95% of each workload must complete within two seconds. Record measured results in `specs/003-user-auth/validation.md`; do not bypass limits or count throttled requests as completed authentication.

- [X] T060 Update `README.md`, `.env.example` and `specs/003-user-auth/quickstart.md` with runnable login/guard/refresh/logout usage, signing-key setup, migration commands, client credential clearing, refresh serialization, one-hour access/fixed-30-day renewal, root-history retention, trusted proxies and single-instance limiter scope. Explain that adding a provider requires its DTO, typed map/registry entry and strategy; local is the only enabled provider.

- [X] T061 Run `npm run build`, `npm run lint`, `npm test` and `npm run test:e2e` after all changes; execute `specs/003-user-auth/quickstart.md` scenarios and record commands/results/remaining issues in `specs/003-user-auth/validation.md`. Fix actual failures and rerun affected checks; distinguish authored tests from passing tests.

- [X] T062 Review `specs/003-user-auth/spec.md`, `contracts/authentication-api.md`, `contracts/auth-internal.md` and `tasks.md` against the implementation; record FR-001–FR-017 and SC-001–SC-009 evidence in `specs/003-user-auth/validation.md`. Confirm no Passport, server-session checks, raw-token storage, unintended social provider, admin role, or client UI was added, and every accepted behavior has passing evidence.

## Phase 8: Revision setup — Baseline inventory

**Goal**: Record the existing case inventory before files move.

- [X] T063 Inventory all cases in `src/auth/auth.controller.spec.ts`, `src/auth/auth-login.controller.spec.ts`, `src/auth/auth-refresh.controller.spec.ts`, `src/auth/auth-logout.controller.spec.ts`, `src/auth/auth.service.spec.ts`, `src/auth/auth-login.service.spec.ts`, `src/auth/auth-access.service.spec.ts`, `src/auth/auth-refresh.service.spec.ts`, `src/auth/auth-logout.service.spec.ts` and `src/auth/auth-token.service.spec.ts`; record case names, parameterized inputs and the expected 51 controller/104 service totals in `specs/003-user-auth/validation.md`. Reuse the recorded 104-test passing service baseline; obtain a passing controller baseline with the quickstart command where localhost listeners are allowed, or record the actual environment limitation without claiming a pass. Depends on no new implementation task.

## Phase 9: Revision foundation — Validation exception factories

**Goal**: Relocate the shared factories while preserving all endpoint validation semantics.

- [X] T064 Move `src/auth/auth-validation.ts` to `src/auth/exceptions/auth-validation.exception.ts`; preserve all three exports and implementation, change its AuthError import to `./auth-errors.js`, update `src/configure-app.ts` to `./auth/exceptions/auth-validation.exception.js` and `src/auth/pipes/login-validation.pipe.ts` to `../exceptions/auth-validation.exception.js`. Search `src/` and `test/` for other consumers and update them, then remove the old file without a re-export. Preserve registration-specific safe field errors, generic authentication 400 responses and missing/empty logout credential 401 behavior; keep DTO rules and pipe ordering. Run existing login pipe/filter tests and current four controller specs per `specs/003-user-auth/quickstart.md` before proceeding. Depends on T063.

## Phase 10: Revision US1 — Login and registration test consolidation (P1)

**Goal**: Establish the two destination specs, preserving registration/login and the token service subject boundary.

**Independent test**: Existing registration/login HTTP and service cases still pass with exact-password/email normalization, generic failures, safe logging, token deadlines and commit-before-response assertions. Token signing/verification cases use real JwtService.

- [X] T065 [P] [US1] Move every case from `src/auth/auth-login.service.spec.ts` and `src/auth/auth-token.service.spec.ts` into `src/auth/auth.service.spec.ts`. Keep registration/login groups and a distinct AuthTokenService group with its three existing subgroups. Scope registration dto/user (ID 1), login user (ID 42), token config/JwtService/clock/context/service to their owning groups; deduplicate imports while preserving ESM specifiers. Retain the hoisted Argon2 hashing mock, registration-only Logger spies/restore hooks, token clock resets and JwtService spy cleanup. Keep groups sequential with initialized local mocks; preserve all assertions and remove the two source specs after transfer. Run the destination service spec. Depends on T064.

- [X] T066 [P] [US1] Move all cases from `src/auth/auth-login.controller.spec.ts` into `src/auth/auth.controller.spec.ts`, preserving registration and login groups with local app/service mocks and lifecycle hooks. Deduplicate imports and call useAuthTestEnvironment once at file scope; preserve actual configureApp/global-plus-parameter pipes, ThrottlerGuard override, sanitized errors, no-store header and exact-password dispatch. Keep groups sequential, retain app.close cleanup, delete the login source spec after transfer and run the destination controller spec. Depends on T064.

## Phase 11: Revision US2 — Stateless access service tests (P1)

**Goal**: Keep all AuthService access cases in the shared service spec.

**Independent test**: Valid access authenticates using real JWT verification while repository/UserService failure spies receive zero calls; token profile/claim/expiry cases remain intact.

- [X] T067 [US2] Move all cases from `src/auth/auth-access.service.spec.ts` into the stateless-access group in `src/auth/auth.service.spec.ts`; retain its real AuthTokenService/JwtService, local injected clock and unavailable-persistence spies. Preserve the token verification groups moved by T065, remove the access source spec after transfer and run `src/auth/auth.service.spec.ts`. Depends on T065 and T066; do not edit the destination alongside any other service-consolidation task.

## Phase 12: Revision US3 — Refresh test consolidation (P2)

**Goal**: Preserve renewal service and HTTP contracts in their respective destination files.

**Independent test**: Refresh preserves the fixed deadline, consumes before replacement, commits reuse revocation before rejection and retains body-only credential validation with safe 400/401/503 responses.

- [X] T068 [P] [US3] Move every case from `src/auth/auth-refresh.service.spec.ts` into a refresh group in `src/auth/auth.service.spec.ts`; preserve group-local repository/token mocks, transaction handle, root/claims fixtures and per-test clock reset. Keep near-deadline access caps, digest/owner checks, consumed-root descendant acceptance and commit-before-error assertions intact. Remove the source spec after transfer and run the destination service spec. Depends on T067.

- [X] T069 [P] [US3] Move every case from `src/auth/auth-refresh.controller.spec.ts` into the refresh group in `src/auth/auth.controller.spec.ts`; preserve local app/service mocks, actual validation pipes, lifecycle cleanup, ThrottlerGuard override, body-only credential checks, malformed input matrix, safe error statuses and no-store header. Deduplicate imports, remove the source spec after transfer and run the destination controller spec. Depends on T067. Existing suites bypass throttling; do not claim this move adds real rate-limit coverage.

## Phase 13: Revision US4 — Logout test consolidation (P2)

**Goal**: Preserve logout service/HTTP cases in the shared destination specs.

**Independent test**: Access/refresh logout identifies only its own family, malformed/unknown credentials retain generic outcomes, persistence failure never reports success, and missing credentials remain 401 while other malformed fields remain 400.

- [X] T070 [P] [US4] Move every case from `src/auth/auth-logout.service.spec.ts` into the logout group in `src/auth/auth.service.spec.ts`; preserve local transaction/repository/token/clock fixtures and all parameterized cases for consumed tokens, malformed/expired/unknown/revoked credentials, owner/digest mismatches, missing tokens and persistence failures. Remove the source spec after transfer and run the destination service spec. Depends on T068 and T069.

- [X] T071 [P] [US4] Move every case from `src/auth/auth-logout.controller.spec.ts` into the logout group in `src/auth/auth.controller.spec.ts`; preserve local app/service mocks, actual validation, cleanup, body-only access/refresh credentials, no-store response and missing-token versus malformed-field status assertions. Remove the source spec after transfer and run the destination controller spec. Depends on T068 and T069.

## Phase 14: Revision polish — Verify final layout and coverage

**Goal**: Prove all three organization changes preserve existing behavior.

- [X] T072 Run `npm test -- src/auth/auth.controller.spec.ts src/auth/auth.service.spec.ts src/auth/pipes/login-validation.pipe.spec.ts src/auth/exceptions/auth-exception.filter.spec.ts`, `npm run lint` and `npm run build`; compare destination cases against T063's inventory in `specs/003-user-auth/validation.md`, requiring all 51 controller and 104 service cases with no omissions or duplicates. Verify `src/auth/` has only `auth.controller.spec.ts` and `auth.service.spec.ts` for these subjects, all eight old split specs and `src/auth/auth-validation.ts` are absent, and source/test references resolve the new exception factory path. Preserve other domains' service specs and existing guard/pipe/configuration/strategy/repository/E2E placement. Record actual failures or listener restrictions without marking successful verification. Depends on T070 and T071.

- [X] T073 Reconcile `specs/003-user-auth/quickstart.md`, `specs/003-user-auth/contracts/auth-internal.md` and `specs/003-user-auth/validation.md` with the implemented destinations and executed results; preserve historical baseline evidence and distinguish it from post-move checks. Confirm no production service merge, auth-audit refactor, dependency, validation behavior, API contract or Prisma migration change was introduced. Mark T063–T073 complete only after their actual work and validation succeed. Depends on T072.

## Dependencies and execution order

```text
Setup → Foundation → US1: Login → US2: Guard routes → US3: Refresh → US4: Logout → Full verification
```

These stories are independently testable after their prerequisites; they are not independent code branches. They share auth.service.ts, auth.controller.ts and auth.repository.ts, so complete their mutations in sequence. A story checkpoint exercises that story with explicit account/token fixtures rather than requiring a UI.

| Phase | Start after | Finish condition |
|---|---|---|
| Setup | None | T001–T002 complete |
| Foundation | Setup | T014 passes |
| US1: Login | Foundation | T030 passes |
| US2: Guarded routes | US1 | T040 passes |
| US3: Refresh | US1 and US2 | T050 passes |
| US4: Logout | US1–US3 | T058 passes |
| Polish | All four stories | T061 and T062 complete |

Within a phase, execute unmarked implementation tasks in order. Test tasks define behavior first; schema/repository methods precede services, services precede endpoint integration, and the phase ends with passing checks. All token deadlines/keys and wire shapes are fixed by the linked contracts; do not invent a new shape during implementation.

### Revision dependencies

```text
T063 baseline → T064 exception move → (T065 service + T066 controller)
→ T067 access → (T068 refresh service + T069 refresh controller)
→ (T070 logout service + T071 logout controller) → T072 verification → T073 evidence
```

The revision introduces no new user stories: US1–US4 retain the specification's priorities and acceptance criteria. Incremental story checkpoints run the destination file, with not-yet-moved source files retained until their assigned task. Any same-file mutations are sequential. Phase 14 closes the refactor only after all stories' cases have moved.

## Parallel execution examples

| Group | Tasks that may be authored together | Prerequisite |
|---|---|---|
| Foundation tests | T003, T004, T005 — separate configuration, migration and filter test files | Setup complete |
| US1 tests | T015, T016, T017, T018, T019, T020 — separate test files | Foundation complete |
| US2 tests | T031 and T032 — extraction and guard test files | US1 complete |
| US3 tests | T041, T042, T043 — service, repository and HTTP test files | US2 complete |
| US4 tests | T051 and T052 — service and HTTP test files | US3 complete |

The table above describes completed historical authoring only. For the revision, US1 allows T065/T066 together, US3 allows T068/T069 together, and US4 allows T070/T071 together because each pair edits separate service/controller destinations. US2's T067 is sequential; a read-only comparison of its token case inventory can occur alongside it. Do not author different user stories into the same destination spec concurrently.

Do not run database suites against shared fixtures or run mutations of the same file in parallel. Each database suite retains its own schema. Parallel test authoring does not mean the same feature's endpoints are ready before its implementation tasks.

## Implementation strategy

1. Finish shared setup and foundation, including the migration and safe error mapping.
2. Build US1: provider-selected input → local authenticate() → JWT pair → stored refresh digest → safe response.
3. Build US2: bearer extraction → JWT verification → request.user → protected controller. **Suggested first reviewable MVP: US1 + US2**, because the requested feature must both log in users and protect routes. US1 alone demonstrates login issuance but does not protect the application.
4. Build US3 to replace refresh credentials safely; prove fixed expiry and replay/concurrency behavior.
5. Build US4 to revoke renewal for one login; prove independent logins and existing access expiry.
6. Finish performance, full regression checks and usage documentation. All four stories are required to complete the requested feature; the MVP is a review checkpoint, not permission to omit refresh/logout.

For this revision, start with T063–T066 as the first reviewable increment: factory relocation plus registration/login/token groups. Then complete US2, US3 and US4 moves before final verification; the accepted scope requires both final consolidated files. The original feature MVP remains US1 + US2. Do not reopen completed feature work or generate new persistence constraints for these organization-only revisions.

## Requirement coverage

| Requirement/outcome | Main tasks |
|---|---|
| FR-001–004, SC-001: validated login and correct identity/token issuance | T021–T030 |
| FR-005–007, SC-002: default protection and stateless verified identity | T031–T040 |
| FR-008–010, SC-003–004: fixed deadline, rotation, replay and account eligibility | T041–T050 |
| FR-011–012, SC-005: logout and independent logins | T051–T058 |
| FR-013,015–016, SC-006: privacy, honest failures and correlation | T005, T010–T012, T019, T039, T057, T062 |
| FR-014, SC-008: independent limits with retry timing | T028, T029, T043, T048 |
| FR-017, SC-009: native-client flow, exemptions and no admin scope | T020, T037–T039, T060, T062 |
| SC-007: real concurrent performance target | T059 |
| Data integrity and upgrade preservation | T004–T008, T042, T056 |

## Task counts

Total: **73 tasks**: **62 completed historical tasks** and **11 completed revision tasks** (T063–T073).

| Scope | Historical | New | Total |
|---|---:|---:|---:|
| Setup/foundation/polish | 18 | 4 | 22 |
| US1: Login | 16 | 2 | 18 |
| US2: Guarded operations | 10 | 1 | 11 |
| US3: Refresh | 10 | 2 | 12 |
| US4: Logout | 8 | 2 | 10 |
| All tasks | 62 | 11 | 73 |

Parallel-marked tasks: **22** (16 historical, 6 revision). All 73 tasks are complete. Revision tasks retain sequential IDs, exact paths and story labels within story phases. Historical completed tasks are preserved.
