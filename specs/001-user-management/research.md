# Research: User Module Foundation

## Persistence and module boundary

- **Decision**: Define `User` in `prisma/schema.prisma`, expose the generated client through injectable `PrismaService`, and confine all `prisma.user.*` operations to `UserRepository`.
- **Rationale**: This meets the constitution's PostgreSQL/Prisma requirement and keeps database operations separate from user rules.
- **Alternatives considered**: Prisma calls in `UserService` were rejected because they violate the repository boundary.

## Validation and transformation

- **Decision**: Enable global Nest `ValidationPipe` with `transform: true`, `whitelist: true`, and `forbidNonWhitelisted: true`. Decorate DTOs with `class-validator`; use `@Type(() => Number)` from `class-transformer` for pagination.
- **Rationale**: Malformed HTTP input is rejected before service execution and query strings become validated numbers.
- **Alternatives considered**: Manual controller parsing was rejected because it duplicates validation behavior.

## DTO inheritance

- **Decision**: `UpdateUserDto` is `PartialType(CreateUserDto)`: it extends create field definitions yet allows either field to be omitted.
- **Rationale**: Omitted fields must be preserved while supplied fields retain create validation rules.
- **Alternatives considered**: A duplicated DTO risks rule drift; requiring both fields breaks partial updates.

## Email uniqueness and deletion

- **Decision**: Make `email` database-unique; creation first calls `getUser({ email })`, then translates a database uniqueness race into the same conflict result. Deleted rows remain excluded from active reads and retain their email.
- **Rationale**: The requested preflight provides a clear domain error and the database guarantees race-safe uniqueness.
- **Alternatives considered**: Application-only checks can race; a partial unique active-email index changes the requested behavior for previously used emails.

## Create-route ownership

- **Decision**: Expose no `POST /user/create` route from `UserController`. Keep `create(dto)` as a validated user-service/repository capability and bind it later from the auth module's registration endpoint.
- **Rationale**: Registration is an authentication workflow; placing its HTTP route in the auth module keeps credentials, identity verification, and registration orchestration together without weakening the user-domain persistence boundary.
- **Alternatives considered**: A temporary user-module create route was rejected because it would create a public contract that the auth module would immediately replace.

## Pagination and errors

- **Decision**: `getUsers(page = 1, perPage = 10)` computes `skip = (page - 1) * perPage`; DTO validation caps `perPage` at 50. The repository calls Prisma with `skip`, `take: perPage`, and `deleted_at: null`. The service throws `NotFoundException` for an empty page. Duplicate email is `ConflictException`.
- **Rationale**: It gives each layer its required responsibility and exactly follows the requested no-results behavior.
- **Alternatives considered**: An empty array was rejected because the request expressly requires `NotFoundException` when users are not found.

## Public profile and deletion precheck

- **Decision**: Expose `GET /user/:id` publicly until auth exists. It returns an active user's
  public fields only. `delete(id)` first calls `getUser({ id, deleted_at: null })`, then soft
  deletes; auth ownership/confirmation checks will be added with auth.
- **Rationale**: This supplies useful profile lookup and clear not-found behavior without
  pretending unauthenticated requests have an owner.

## Test placement

- **Decision**: Co-locate `user.service.spec.ts`, `user.controller.spec.ts`, and `user.repository.int-spec.ts` in `src/user/`; retain only `user.e2e-spec.ts` in the top-level `test/` directory.
- **Rationale**: Tests remain owned and discoverable with the domain module, as required by the constitution. The E2E test stays separate because it composes application-wide HTTP and persistence configuration.
- **Alternatives considered**: A central unit/integration test tree was rejected because it separates module behavior from the module that owns it.
