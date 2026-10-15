# Implementation Plan: User Registration

**Branch**: `main` (actual Git branch; feature identifier `002-user-registration`) | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: `specs/002-user-registration/spec.md` and the user's auth-module, auth_identity, repository, and strategy design instructions.

## Summary

Expose POST /auth/register through a new AuthModule. AuthService resolves a Nest-injected LocalStrategy, prepares protected credentials, then creates a User through UserService and its AuthIdentity through AuthRepository in one shared transaction. Add provider-specific DTOs and a provider-wide AuthStrategy contract. Its only operation now is register(); the same interface and LocalStrategy class will later gain authenticate() and other auth operations as they are implemented. Local registration requires a password and stores its hash on the identity. Existing emails always produce a conflict; adding identities to retained users belongs to future verified account linking.

The specification has been aligned with the user's latest ownership and provider-selection instructions. Earlier registration designs on other branches are not prerequisites; the existing UserModule on main is reused through its public service. This revision follows the user’s provider-wide strategy and controller-only DTO validation instructions.

## Technical Context

**Language/Version**: TypeScript 6.x, ESM/NodeNext; observed runtime Node 26.8.1, maintain Node >=22 compatibility for chosen hashing library.

**Primary Dependencies**: Existing NestJS 12.x, Prisma Client 6.19.x, class-validator and class-transformer; add argon2 and @nestjs/throttler with compatible versions locked during implementation.

**Storage**: Existing PostgreSQL via Prisma; add AuthIdentity mapped to auth_identity plus reviewed SQL constraints and normalized email migration.

**Testing**: Vitest 4.x, Supertest, existing isolated PostgreSQL test-schema helper. Module unit/contract/integration tests under src; cross-module E2E under test.

**Target Platform**: Node backend, macOS local development and Node-compatible Linux deployment; verify native argon2 installation on deployment target.

**Project Type**: Web service; backend only.

**Performance Goals**: At least 95% of valid registrations complete within two seconds with 20 simultaneous distinct-email submissions; use 20 distinct trusted client IPs to isolate hashing/transaction latency from throttling.

**Constraints**: Atomic user/identity persistence; no plaintext password persistence/logging; all retained emails and identity keys remain reserved; no credentials or session in response. Expensive hashing and future provider verification occur before the transaction. Initial limiter supports one application instance; scaling requires shared limiter storage.

**Scale/Scope**: One local strategy, one endpoint, one identity model, no provider network integration, no sign-in or account linking. Current exact-case email behavior must be migrated safely.

## Constitution Check

*Pre-research and post-design gates both pass.*

| Principle | Pre-research assessment | Post-design assessment |
|-----------|-------------------------|------------------------|
| Module-first domains | Auth owns registration and identities; User owns profiles | AuthModule imports UserModule; no reverse dependency or direct User writes from auth |
| Controller → Service → Repository | Controller validates input/handles transport; service orchestrates; repositories persist | Strategy is an auth use-case collaborator; queries remain in repositories; transaction begins in AuthRepository |
| NestJS and injection | Existing framework retained | Resolver returns injected instances; no manual construction |
| PostgreSQL and Prisma | Existing stack retained | New model, reviewed migrations, explicit transaction client; no direct service queries |
| Module-scoped verification | Tests planned at owning layers | Auth/User tests colocated; transaction composition and endpoint E2E in test |
| Migration preservation | Inspect existing users before schema changes | Preflight normalized conflicts; abort on ambiguity; no invented credentials or user merges |

No constitutional exception is required. AuthService may forward an opaque transaction context but never executes Prisma queries; AuthRepository owns the transaction API, UserRepository owns all User queries. withTransaction() is a small method in auth.repository.ts, not an extra service, manager, or file.

## Project Structure

### Documentation (this feature)

```text
specs/002-user-registration/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── auth-registration.md
│   └── auth-strategy.md
└── checklists/requirements.md
```

`tasks.md` is produced by the next command, not this planning phase.

### Source Code (repository root)

```text
src/
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts           # register(), private resolveStrategy(), private hashPassword()
│   ├── auth.repository.ts
│   ├── enums/auth-provider.enum.ts
│   ├── dto/register-local.dto.ts
│   ├── dto/create-auth-identity.dto.ts
│   ├── dto/registration-result.dto.ts
│   ├── strategies/auth-strategy.interface.ts
│   ├── strategies/local.strategies.ts
│   ├── validation/password-policy.validator.ts
│   ├── auth.service.spec.ts
│   ├── auth.controller.spec.ts
│   ├── auth.repository.int-spec.ts
│   └── strategies/ colocated *.spec.ts
├── user/                         # transaction forwarding + email normalization + tests
├── prisma/                       # existing client and isolated test-database helper
├── configure-app.ts              # sanitized validation errors if required
└── app.module.ts                 # import AuthModule
prisma/
├── schema.prisma
└── migrations/                  # auth identity + normalized email migration
test/
└── auth.e2e-spec.ts
```

**Structure Decision**: Extend the existing single backend repository. Auth owns its DTOs, provider enum, strategies, repository, controller, and tests. Keep register(), resolveStrategy(), and hashPassword() together in auth.service.ts. resolveStrategy() and hashPassword() are private methods; no extra injectable resolver or hashing service is needed. Tests for these helpers run through AuthService behavior. UserModule exposes transaction-aware user behavior; it does not depend on auth. Controller-bound ValidationPipe owns DTO validation and normalization of submitted names/emails. UserService retains canonical email normalization at its write boundary as a data invariant, not a second DTO validation pass. AuthService and UserService.create receive trusted, already validated DTOs; internal callers are responsible for validating their input before invoking these services.

## Registration Execution

1. Validate and normalize the flat local DTO at the controller boundary through ValidationPipe, including the supported provider allowlist. Do not infer provider or accept caller-supplied user IDs. AuthService receives the validated DTO and does not invoke class-validator or repeat field validation. Resolve the injected strategy once; resolver still rejects unconfigured strategies as a business configuration check.
2. Use UserService.getUserByEmail(normalizedEmail) for a preliminary check. If found, inspect AuthRepository.getIdentityByUserId(user.id, provider), including retained deleted identities, and return 409 regardless of its result. No implicit account linking.
3. AuthService calls its private hashPassword(dto.password) function before the transaction for the local provider and constructs the typed registration payload containing passwordHash. This is credential preparation, not DTO revalidation. AuthStrategy has no prepare() method; its only current operation is register(). No identity insert yet.
4. AuthRepository.withTransaction passes tx to AuthService's callback. Recheck email through UserService.getUserByEmail(email, tx) to improve conflict reporting; constraints still enforce races.
5. Call UserService.create({ name, email }, tx). Remove the existing DTO revalidation from the UserService.create path; its business email checks and UserRepository.create use this same tx, never the root client. Preserve standalone calls by making tx optional outside registration.
6. Call strategy.register({ userId: user.id, payload, tx }); local persists provider local, identity_id String(user.id), user_id user.id, password_hash payload.passwordHash through AuthRepository.createIdentity.
7. Commit both records before producing an explicit response projection. Convert transaction uniqueness errors to 409; identity creation failures roll back the User. Never return repository objects directly.

### What withTransaction() means

withTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> is a small AuthRepository method that delegates to prisma.$transaction(work). It starts one database transaction and passes its transaction client to the callback. AuthService creates the User and calls strategy.register() inside that callback, forwarding the same tx to both repositories. If the callback completes, Prisma commits both writes; if a write or callback throws, Prisma rolls them back and the wrapper propagates the error. Returning the callback result is not success until the transaction promise has committed.

This wrapper keeps the Prisma transaction API in the repository under the existing project layering rule. It does not replace Prisma, open nested transactions, create a transaction service, or validate DTOs. A root Prisma client call made inside the callback would still be outside this transaction, so explicit tx forwarding is required. Hashing stays before the callback to keep the transaction short.

### Failure classification

Keep classification in auth.service.ts and transport envelope mapping in the controller. Evaluate known validation/conflict/rate-limit outcomes first; never convert them to availability errors. Only actual Prisma error instances qualify for Prisma-code handling: read code on PrismaClientKnownRequestError and errorCode on PrismaClientInitializationError. A plain object/string that happens to contain a code is not sufficient.

| Failure | Public result | Test fixture / distinction |
|---------|---------------|----------------------------|
| Existing retained email or known User email P2002 constraint | 409 EMAIL_UNAVAILABLE | Precheck conflict and concurrent insert race |
| Known auth_identity composite unique P2002 constraint | 409 IDENTITY_UNAVAILABLE | Identity key conflict; no existing identity details |
| Prisma P1001, P1002, P1008, P1017, P2024 | 503 REGISTRATION_TEMPORARILY_UNAVAILABLE | Unreachable storage, connection/operation timeout, closed connection, pool acquisition timeout |
| Prisma P2034 | 503 REGISTRATION_TEMPORARILY_UNAVAILABLE | Transaction write contention/deadlock; no automatic retry in this increment |
| Prisma P2028 with a verified timeout cause | 503 REGISTRATION_TEMPORARILY_UNAVAILABLE | Only meta.error/message containing the recognized Prisma phrases "Unable to start a transaction in the given time" or "A query cannot be executed on an expired transaction"; unit-test both fixtures |
| Hash call rejects a runtime resource error carrying code ENOMEM or EAGAIN | 503 REGISTRATION_TEMPORARILY_UNAVAILABLE | Check this code only on an Error thrown by the hashing call; injected unit fixture proves handling, without claiming all argon2 failures have these codes |
| Other P2028; unrecognized P2002 target; invalid FK/CHECK/internal query; Prisma validation errors | 500 INTERNAL_ERROR | Internal misuse/data invariant breach is not a client conflict or availability error |
| P1000/P1003/P1010/P1012/P1013/P1014/P1015 or missing hashing module/configuration | 500 INTERNAL_ERROR | Invalid credentials/schema/permissions/configuration |
| Any other error, including generic Error/TypeError from hashing | 500 INTERNAL_ERROR | Default-safe fallback; no broad all-hash-errors-to-503 catch |

Match unique constraints against the actual reviewed migration/schema constraint names or Prisma target fields; do not classify every P2002 as an email conflict. P2028 alone is insufficient to prove a timeout. Callback errors must escape until rollback; classification must not turn a thrown callback into a committed result. Every public envelope excludes raw messages, metadata, parameters, stack traces, request values, and hashes.

The Prisma code meanings are verified against the [Prisma v6 error reference](https://www.prisma.io/docs/orm/v6/reference/error-reference). HTTP categories and the selective matching policy are this feature's design decisions.

## Verification and Delivery

Verify DTO policy and provider rejection at the controller/pipe boundary; service tests use validated DTO fixtures and check orchestration/business rules rather than repeat DTO validation; service strategy selection using the injected LocalStrategy; hash salt uniqueness; absence of credentials in responses/logs; repository FK/unique/CHECK constraints; shared-context forwarding; rollback after User creation and before identity commit; duplicate/case-variant/concurrent attempts; soft-deleted email conflicts; missing local identity on a retained user still conflicts; throttling and recovery; existing public profiles stay credential-free.

Migration tests apply from the existing schema with retained users and confirm unchanged IDs, normalized emails, no identity/password backfill, and deliberate failure for normalized duplicates. Benchmark real hashing and storage against SC-005. Complete npm run build, npm run lint, npm test, and npm run test:e2e during implementation. This phase changes documentation only; implementation and performance have not been validated yet.

See [research.md](research.md), [data-model.md](data-model.md), [endpoint contract](contracts/auth-registration.md), [strategy contract](contracts/auth-strategy.md), and [quickstart.md](quickstart.md).
