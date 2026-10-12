---

description: "Actionable implementation tasks for the User Module Foundation"
---

# Tasks: User Module Foundation

**Input**: Design documents from `/specs/001-user-management/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [user-api.md](./contracts/user-api.md), and
[constitution.md](../../.specify/memory/constitution.md).

**Tests**: Required by Constitution V. User-module service, repository, and controller tests are
colocated in `src/user/`; only the list-route E2E suite resides in `test/`.

**Organization**: Create, update, and delete are user-domain application methods. Auth will own the
future registration HTTP contract; this increment exposes public `GET /user/list` and `GET /user/:id`.

## Phase 1: Setup (Shared Infrastructure)

**Additional infrastructure (2026-10-12)**: Added `compose.yaml` for local PostgreSQL 17,
a persistent volume, localhost binding, and health check, plus `.env.example` and README
startup instructions. Compose configuration validation passed and PostgreSQL started healthy.
The Prisma datasource/generator is configured and integration tests migrate isolated schemas.

**Purpose**: Add Prisma and Nest DTO-validation dependencies.

- [X] T001 Add Prisma runtime/CLI, `class-validator`, `class-transformer`, and `@nestjs/mapped-types` dependencies in `package.json` and `package-lock.json`.
- [X] T002 [P] Configure the Prisma datasource/generator and `DATABASE_URL` documentation in `prisma/schema.prisma` and `.env.example`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build persistence, validation, and Nest module infrastructure required by every story.

**⚠️ CRITICAL**: Complete this phase before user-story implementation.

- [X] T003 Define `User` in `prisma/schema.prisma` with `id Int @id @default(autoincrement())`, required `name String`, `email String @unique`, `created_at DateTime @default(now())`, `updated_at DateTime @updatedAt`, nullable `deleted_at DateTime?`, and `@@index([deleted_at])`.
- [X] T004 Create and review the `User` migration in `prisma/migrations/<timestamp>_add_user/migration.sql`.
- [X] T005 Implement injectable Prisma lifecycle access in `src/prisma/prisma.service.ts` and export it from `src/prisma/prisma.module.ts`.
- [X] T006 Enable global `ValidationPipe` with `transform: true`, `whitelist: true`, and `forbidNonWhitelisted: true` in `src/main.ts`.
- [X] T007 Create `UserModule` in `src/user/user.module.ts` and register it in `src/app.module.ts`.

**Checkpoint**: The schema, migration, injected Prisma client, validation, and module boundary exist.

---

## Phase 3: User Story 1 — Register an Account (Priority: P1) 🎯 MVP

**Goal**: Provide validated, unique user creation to the future auth registration flow without a
user-controller route.

**Independent Test**: `UserService.create` creates a valid user, rejects an existing email with
`ConflictException`, and concurrent duplicate attempts result in exactly one stored row.

### Tests for User Story 1

- [X] T008 [P] [US1] Write failing `UserRepository` create, email lookup, and database-unique-race tests in `src/user/user.repository.int-spec.ts`.
- [X] T009 [P] [US1] Write failing `UserService.create` tests for valid creation, `getUser({ email })` preflight, duplicate `ConflictException`, and Prisma unique-error translation in `src/user/user.service.spec.ts`.
- [X] T010 [P] [US1] Write failing DTO validation tests for required string `name` (maximum 100 characters) and required valid-email `email` in `src/user/create-user.dto.spec.ts`.

### Implementation for User Story 1

- [X] T011 [US1] Implement `CreateUserDto` in `src/user/dto/create-user.dto.ts` with required string `name` (maximum 100 characters) and required valid-email `email` decorators.
- [X] T012 [US1] Implement repository `getUser` and `create` Prisma operations in `src/user/user.repository.ts`; keep all Prisma calls in this repository.
- [X] T013 [US1] Implement `UserService.create` in `src/user/user.service.ts`: check `getUser({ email })`, throw `ConflictException` if found, call the repository otherwise, and translate concurrent unique failures to the same result.
- [X] T014 [US1] Make creation DTO, repository, and service tests pass in `src/user/create-user.dto.spec.ts`, `src/user/user.repository.int-spec.ts`, and `src/user/user.service.spec.ts`; do not add `POST /user/create`.

**Checkpoint**: The future auth registration module has a complete, tested user-creation boundary.

---

## Phase 4: User Story 2 — View User Information (Priority: P2)

**Goal**: Expose active public profiles through `GET /user/:id` and paginated `GET /user/list`.

**Independent Test**: `GET /user/:id` and `GET /user/list` return active public profiles only;
list defaults to page 1/perPage 10, rejects perPage above 50, and never returns email or deleted rows.

### Tests for User Story 2

- [X] T015 [P] [US2] Write failing active list/profile repository tests for ID lookup, `skip`, `take`, `deleted_at: null`, and public-field selection in `src/user/user.repository.int-spec.ts`.
- [X] T016 [P] [US2] Write failing service tests for profile-by-ID not found, list skip/defaults, perPage maximum 50, and empty-page `NotFoundException` in `src/user/user.service.spec.ts`.
- [X] T017 [P] [US2] Write failing controller contract tests for public `GET /user/:id`, list defaults, and invalid pagination in `src/user/user.controller.spec.ts`.
- [X] T018 [P] [US2] Write failing profile/list E2E tests for public fields, deleted exclusion, defaults, max 50, and `404` in `test/user.e2e-spec.ts`.

### Implementation for User Story 2

- [X] T019 [US2] Implement `ListUsersQueryDto` in `src/user/dto/list-users-query.dto.ts` with `@Type(() => Number)`, positive-integer rules, defaults of page 1/perPage 10, and `perPage` maximum 50.
- [X] T020 [US2] Add active `getUserById(id)` and `getUsers(skip, perPage)` repository operations in `src/user/user.repository.ts` with `deleted_at: null` and public-field selection limited to `id`, `name`, and `created_at`.
- [X] T021 [US2] Add `getUserById(id)` and `getUsers(page = 1, perPage = 10)` in `src/user/user.service.ts`; calculate skip, enforce the 50 limit, and throw `NotFoundException` for missing profiles/empty pages.
- [X] T022 [US2] Implement public `GET /user/:id` and `GET /user/list` in `src/user/user.controller.ts`, wire providers in `src/user/user.module.ts`, and return public profiles only.
- [X] T023 [US2] Make list repository, service, controller, and E2E tests pass in `src/user/user.repository.int-spec.ts`, `src/user/user.service.spec.ts`, `src/user/user.controller.spec.ts`, and `test/user.e2e-spec.ts`.

**Checkpoint**: Public profile-by-ID and bounded active-user list endpoints return only public data.

---

## Phase 5: User Story 3 — Update My Details (Priority: P3)

**Goal**: Provide a tested partial-update application method for a later authenticated route.

**Independent Test**: Updating one field preserves the other; invalid DTO, duplicate email, or an
unmatched/deleted ID preserves stored values and yields the appropriate exception.

### Tests for User Story 3

- [X] T024 [P] [US3] Write failing partial-update, unmatched-ID, and deleted-row repository tests in `src/user/user.repository.int-spec.ts`.
- [X] T025 [P] [US3] Write failing update-service tests for partial updates, duplicate-email conflict, and `NotFoundException` preservation in `src/user/user.service.spec.ts`.
- [X] T026 [P] [US3] Write failing update DTO tests for `PartialType(CreateUserDto)`, at least one property, supplied `name` maximum 100 characters, and supplied valid-email `email` in `src/user/update-user.dto.spec.ts`.

### Implementation for User Story 3

- [X] T027 [US3] Implement `UpdateUserDto` in `src/user/dto/update-user.dto.ts` as `PartialType(CreateUserDto)`, require at least one property, and retain the supplied-field validation constraints.
- [X] T028 [US3] Add repository `update(id, query)` in `src/user/user.repository.ts`, using ID only in Prisma `where`, the DTO only in `data`, and an active-row predicate.
- [X] T029 [US3] Add `UserService.update(id, query)` in `src/user/user.service.ts`, translating no matched row to `NotFoundException` and unique email errors to `ConflictException`; do not add an HTTP route.
- [X] T030 [US3] Make update DTO, repository, and service tests pass in `src/user/update-user.dto.spec.ts`, `src/user/user.repository.int-spec.ts`, and `src/user/user.service.spec.ts`.

**Checkpoint**: A future authenticated update route can safely consume the user service.

---

## Phase 6: User Story 4 — Delete My Account (Priority: P4)

**Goal**: Provide a tested soft-delete application method for a later confirmed authenticated route.

**Independent Test**: Deletion stamps `deleted_at` while retaining the row; the row is absent from
active lists, and repeat/unmatched deletion returns `NotFoundException`.

### Tests for User Story 4

- [X] T031 [P] [US4] Write failing repository tests for stamping `deleted_at`, retaining the row, and rejecting unmatched/already-deleted IDs in `src/user/user.repository.int-spec.ts`.
- [X] T032 [P] [US4] Write failing service tests proving `delete(id)` first checks active `getUser`, then soft deletes; absent/deleted IDs raise `NotFoundException` in `src/user/user.service.spec.ts`.

### Implementation for User Story 4

- [X] T033 [US4] Add repository `softDelete(id)` in `src/user/user.repository.ts`, updating `deleted_at` to the current timestamp only where `id` matches and `deleted_at` is null.
- [X] T034 [US4] Add `UserService.delete(id)` in `src/user/user.service.ts`, first verify active `getUser`, throw `NotFoundException` when absent, then soft delete; defer auth ownership/confirmation checks.
- [X] T035 [US4] Make soft-delete repository and service tests pass in `src/user/user.repository.int-spec.ts` and `src/user/user.service.spec.ts`.

**Checkpoint**: Soft deletion is retained and excluded from active user operations.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validate migrations and every current contract.

- [X] T036 Verify generated Prisma client/migration state and run `npx prisma migrate deploy` against the test database using `prisma/schema.prisma`.
- [X] T037 Run module tests, list E2E tests, lint, and build using `src/user/*.spec.ts`, `src/user/*.int-spec.ts`, `test/user.e2e-spec.ts`, and `package.json` scripts; resolve all failures.
- [X] T038 Verify `POST /user/create` is absent and public `GET /user/:id` plus `GET /user/list` match `specs/001-user-management/contracts/user-api.md` in `src/user/user.controller.ts` and `test/user.e2e-spec.ts`.

---

## Dependencies & Execution Order

```text
Setup → Foundational → US1 (MVP service boundary) → US2 (list route) → US3 → US4 → Polish
```

- Setup and Foundational phases block all stories.
- US1 must precede US2–US4 because they need created users in tests.
- US2 is the first HTTP increment and may begin after US1.
- US3 and US4 follow US1; perform sequentially because both modify the shared repository/service.

## Parallel Opportunities

- T002 can run alongside T001.
- T008–T010 can be authored in parallel, as can T011's independent DTO file.
- T015–T018 can be authored in parallel; T019 uses a separate DTO file.
- T024–T026 and T031–T032 can each be authored in parallel.

## Parallel Example: User Story 2

```text
Task: "Write list persistence tests in src/user/user.repository.int-spec.ts"
Task: "Write list service tests in src/user/user.service.spec.ts"
Task: "Write list controller tests in src/user/user.controller.spec.ts"
Task: "Write list E2E tests in test/user.e2e-spec.ts"
Task: "Implement ListUsersQueryDto in src/user/dto/list-users-query.dto.ts"
```

## Implementation Strategy

### MVP First

1. Complete Setup and Foundational work.
2. Complete US1 through T014 to deliver the auth-ready creation boundary.
3. Validate the service/repository/DTO tests; no HTTP create route is expected.

### Incremental Delivery

1. Add US2 to expose the active-user list and run the separate E2E suite.
2. Add US3 and US4 as tested application methods while preserving their route deferral.
3. Finish Polish and all quickstart checks.

## Implementation verification (2026-10-12)

- All T001–T038 completed; no commits created.
- `npm test -- --coverage`: 6 suites, 60 tests passed (including PostgreSQL integration).
- `npm run test:e2e`: 2 suites, 15 tests passed.
- `npm run lint`, `npm run build`, `npx tsc --noEmit --incremental false`, and formatting checks passed.
- Prisma client generated; schema validation passed. Migration SQL reviewed against Prisma's
  generated diff and deployed successfully into isolated integration/E2E test schemas.
- E2E confirms public list/profile fields, bounded pagination, deleted-user exclusion,
  and absent create/update/delete HTTP routes.
- Internal create/update methods validate DTOs themselves because there is no HTTP pipe on
  these application boundaries. Test fixtures use direct Prisma only for isolated setup/cleanup;
  production user persistence remains in `UserRepository`.
- No `.specify/extensions.yml` exists; no post-implementation hooks apply.
