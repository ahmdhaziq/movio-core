# Implementation Plan: User Module Foundation

**Branch**: `001-user-management` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Build the reusable user-domain base: data model, validated DTOs, repository/service
layers, creation, public profiles, paginated listing, update support, and soft deletion. Auth,
registration, identity ownership, and route guards are explicitly deferred.

## Summary

Create a module-local NestJS `user` domain backed by PostgreSQL through Prisma. It provides
validated create/update DTOs; a repository as the sole owner of Prisma calls; a service that
enforces email-existence and not-found rules; and public `GET /user/list` plus `GET /user/:id`
profile routes. Create, update, and soft-delete are service/repository use cases without user
controller mutation routes. A future auth module will bind creation to registration and add guards.

## Technical Context

**Language/Version**: TypeScript 6.0.2; Node.js runtime is not pinned by the repository.

**Primary Dependencies**: NestJS 12; Prisma Client and CLI (add); `class-validator`, `class-transformer`, and `@nestjs/mapped-types` (add); RxJS.

**Storage**: PostgreSQL, only through Prisma; add a reviewed Prisma schema migration.

**Testing**: Vitest 4 with Nest testing utilities and Supertest. Service, controller, and repository tests are colocated with `src/user/`; only the full HTTP end-to-end suite is separate under `test/`.

**Target Platform**: Node.js HTTP API server.

**Project Type**: Single-project web service.

**Performance Goals**: Pagination bounds each database read to a maximum `perPage` of 50.

**Constraints**: Module-local controller -> service -> repository flow; no direct Prisma use outside a repository; Nest `ValidationPipe` transforms and validates inputs; retain soft-deleted rows while excluding them from lists. No list filtering beyond the mandatory active-row predicate.

**Scale/Scope**: One `User` model; create, public profile by ID, paginated active-user list,
update, and soft-delete application methods. HTTP scope: `GET /user/list` and `GET /user/:id`.
Auth registration, guards, ownership checks, and credentials are deferred.

## Constitution Check

*GATE: Passed before Phase 0 research; re-checked after Phase 1 design.*

| Constitution requirement | Plan response |
|---|---|
| Module-first boundaries | All feature code resides in `src/user/`; `PrismaService` is narrow shared infrastructure. |
| Controller -> service -> repository | Controllers bind/validate, services own business decisions, repositories own Prisma calls. |
| NestJS + DI | `UserModule` injects controller, service, repository, and Prisma dependency. |
| PostgreSQL + Prisma + migrations | `User` schema and a reviewed Prisma migration establish persistence. |
| Module-scoped verification | User-module service, controller, and repository tests are colocated with their owner; public profile/list E2E coverage remains separate. |

No exception or gate violation is required. The post-design data model, API contract, and validation guide preserve the same boundaries and test obligations.

## Project Structure

### Documentation

```text
specs/001-user-management/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/user-api.md
└── tasks.md                  # Generated later by speckit-tasks
```

### Source Code

```text
prisma/
├── schema.prisma
└── migrations/<timestamp>_add_user/

src/
├── app.module.ts
├── main.ts
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts
└── user/
    ├── dto/
    │   ├── create-user.dto.ts
    │   ├── update-user.dto.ts
    │   └── list-users-query.dto.ts
    ├── create-user.dto.spec.ts
    ├── update-user.dto.spec.ts
    ├── user.controller.ts
    ├── user.controller.spec.ts
    ├── user.module.ts
    ├── user.repository.ts
    ├── user.repository.int-spec.ts
    └── user.service.ts
    └── user.service.spec.ts

test/
└── user.e2e-spec.ts
```

**Structure Decision**: Extend the existing single NestJS project. `src/user/` is the sole owner of the user domain and its non-E2E tests; `src/prisma/` only handles injectable client lifecycle/configuration. `test/` contains only cross-layer end-to-end coverage.
