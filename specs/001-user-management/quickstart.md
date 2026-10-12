# Quickstart: Validate the User Module Foundation

## Prerequisites

- Node.js compatible with NestJS 12 and the lockfile.
- A reachable PostgreSQL database configured through Prisma's `DATABASE_URL`.
- Dependencies installed with `npm install` after implementation adds Prisma and validation packages.

## Prepare and run

1. Copy `.env.example` to `.env`, start PostgreSQL, generate the Prisma client,
   and apply the reviewed migration:

   ```bash
   docker compose up -d --wait postgres
   npx prisma generate
   npx prisma migrate deploy
   ```

2. Run focused tests and checks:

   PostgreSQL integration and E2E tests use random isolated schemas and apply the
   actual migrations automatically. They default to the local Compose credentials.
   Export `TEST_DATABASE_URL` to override that connection; the role needs permission
   to create/drop schemas. Cleanup removes only each suite's own schema.

   ```bash
   npm run test -- src/user/user.service.spec.ts
   npm run test -- src/user/user.controller.spec.ts
   npm run test -- src/user/user.repository.int-spec.ts
   npm run test:e2e -- test/user.e2e-spec.ts
   npm run lint
   npm run build
   ```

3. Start the API:

   ```bash
   npm run start:dev
   ```

## Validation scenarios

| Scenario | Action | Expected result |
|---|---|---|
| Valid creation | Invoke `UserService.create` with a short valid name and new email | A generated ID/timestamps and `deleted_at: null`. |
| Invalid creation | Validate malformed email, missing name, 101-character name, or extra property through the DTO/validation-pipe tests | Validation failure; no row is created. |
| Duplicate email | Invoke `UserService.create` twice with the same email, including concurrent repository attempts | One create succeeds, every other attempt raises `ConflictException`, and one row only remains. |
| Paginated list | Create more users than `perPage`, then request page 2 | `200`; results begin after `(page - 1) * perPage`. |
| Public profile | Request `GET /user/:id` for an active seeded user | `200`; only ID, name, and creation timestamp are returned. |
| Missing profile | Request `GET /user/:id` for an absent or deleted user | `404`; no email or deletion history is exposed. |
| Empty page | Request a page beyond active rows | `404`. |
| Soft delete | Exercise service `delete(id)`, then list | Row remains with `deleted_at` set and is absent from the list. |
| Partial update | Exercise `update(id, { name: ... })` | Name changes, email remains; invalid/unmatched input preserves stored values. |

See [data-model.md](./data-model.md) and [user-api.md](./contracts/user-api.md).
