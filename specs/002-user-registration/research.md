# Research: User Registration

## 1. Provider-specific input and strategy resolution

**Decision**: Keep a flat `RegisterLocalDto` with required `provider: local`, `name`, `email`, and `password`. Use an `AuthProvider` string enum (local/google/microsoft identifiers) but a separate supported-provider allowlist containing only local. As new methods are implemented, add dedicated DTO variants and a discriminated union keyed by provider. Define `AuthStrategy<P>` with provider-specific registration payload maps and only `register(context)` today. The same provider-wide interface and `LocalStrategy` in `local.strategies.ts` will later add `authenticate()` and other operations when those features are implemented; do not create separate registration-only or authentication-only strategy classes. Resolver returns the Nest-injected instance, never a class constructor or a second dispatch indicator.

**Rationale**: Invalid password/token combinations should be rejected structurally; interfaces provide compile-time contracts while concrete DTO classes provide runtime validation. Controller DTO validation handles local fields. AuthService calls its private hashPassword() before writes; LocalStrategy.register persists the prepared local credential. Provider classes are reusable for all auth operations. Future provider verification can be added to orchestration without adding a speculative prepare() interface operation now.

**Alternatives considered**: One DTO with optional fields weakens validation; a universal strategy with untyped input discards type safety; mandatory future methods create empty stubs. Avoid unsafe casts in the registry: use typed overloads and explicit provider narrowing as variants arrive.

Sources: [TypeScript discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions), [Nest injected providers](https://docs.nestjs.com/fundamentals/custom-providers).

## 2. Local credentials

**Decision**: Add nullable `password_hash` to auth_identity; enforce non-null for local and null for non-local via a migration CHECK. A private hashPassword() function in auth.service.ts, called before transaction start, uses the `argon2` package with Argon2id, memoryCost 19456 KiB, timeCost 2, parallelism 1, random salt, and an encoded hash containing algorithm, parameters, and salt. No separate salt/algorithm columns are needed. Do not hash inside the transaction. Keep plaintext out of persistence and diagnostics, including validation messages.

**Rationale**: The accepted specification requires password credentials, so a local identity containing only identifiers is incomplete. The package provides password-oriented encoded hashes and TypeScript declarations. The selected baseline follows OWASP; benchmark it against SC-005 without reducing security parameters.

**Alternatives considered**: Hash on User couples user records to one provider; separate credential table adds an unnecessary relation for this increment. Node scrypt is viable but needs a custom encoding contract; bcrypt's input byte limit conflicts with accepting up to 128 characters. Additional pepper management is outside this increment.

Sources: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [node-argon2](https://github.com/ranisalt/node-argon2).

## 3. Atomic cross-module persistence

**Decision**: AuthRepository owns `withTransaction(callback)` wrapping Prisma interactive transactions. AuthService orchestrates the callback, passes the same `Prisma.TransactionClient` to UserService.create(dto, tx) and strategy.register(context), and returns only after commit. UserService forwards tx through all reads and writes in that path to UserRepository. AuthService performs no Prisma queries itself. AuthService prepares credentials through its private hashPassword() function before opening the transaction; the strategy interface contains only register().

**Rationale**: Existing UserRepository.create uses the root PrismaService; wrapping its unchanged service call would not make that write transactional. Explicit context forwarding makes the boundary reviewable. Auth depends on UserModule, never the reverse.

**Alternatives considered**: Direct cross-domain writes in AuthRepository break domain ownership; root-client calls inside callbacks are not enclosed in that transaction; nested write ownership and ambient transaction state obscure current module boundaries.

Source: [Prisma v6 transactions](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions).

## 4. Existing users, conflicts, and identity reservation

**Decision**: Normalize email and use an explicit UserService.getUserByEmail(email, tx?) helper rather than a caller-supplied user ID or public profile read. If a user exists, inspect its provider identities as requested, then reject registration with the same 409 EMAIL_UNAVAILABLE whether the chosen identity exists or not. Never attach a new identity to an existing user using only their email. Future account linking requires a separately verified flow.

**Rationale**: Email uniqueness already forbids another User record, and a caller knowing an email has not demonstrated ownership. Database uniqueness, not prechecks, determines the winner of concurrent submissions.

**Alternatives considered**: Create another user when identity is absent violates uniqueness; silently attach credentials could give an attacker account access. Provider identifiers for future providers must derive from verified subject claims, not email.

Source: [Google OpenID Connect subject identifiers](https://developers.google.com/identity/openid-connect/openid-connect).

## 5. Schema and email migration

**Decision**: Create auth_identity with unique (provider, identity_id) and (user_id, provider), a User FK with restrictive physical deletion, nullable hash, consistent deleted_at spelling, and lifecycle timestamps. Retained deleted identities reserve their keys. Add a normalized-email unique expression index on lower(btrim(email)); preserve the existing exact unique key used by Prisma. Preflight conflicts across all retained users, abort rather than merge/delete conflicts, then normalize existing emails. All UserService create/update paths normalize emails, not only registration.

**Rationale**: One user may later have multiple providers; one provider subject cannot belong to multiple users. SQL expression indexes cover writes that bypass application normalization. Existing users retain IDs and receive no invented credential or identity.

**Alternatives considered**: Unique identity_id alone collides across providers; active-only indexes allow ambiguous reuse; automatic identity backfills cannot invent passwords. Database provider strings remain extensible without a database-enum migration.

## 6. Validation, errors, and operations

**Decision**: Use the existing global ValidationPipe at the controller boundary only. AuthService and the UserService.create path do not revalidate DTOs. Internal callers must supply validated, trusted DTOs; service business checks and database constraints remain in place. Reject unknown fields, including client user_id/identity_id/hash. Count password length as Unicode code points, recognize uppercase/lowercase Unicode letters, ASCII digits, and non-letter/non-digit/non-whitespace symbols; preserve raw password. Return sanitized field errors, 409 conflicts, and 503 temporary persistence/hash failures. DTO transformations at the controller normalize submitted names/emails; UserService retains canonical email normalization as a persistence invariant. Map Prisma P2002 to conflicts and roll back all dependent writes. Use the explicit Prisma/runtime-code allowlist and default-500 policy in [plan.md](plan.md#failure-classification). Configuration/internal misuse/unrecognized errors remain sanitized 500 errors; generic hash failures are not automatically 503.

**Decision**: Add route-scoped Nest throttling: 10 attempts per 60 seconds per trusted client IP, with 429 and Retry-After; do not change user read routes. Tests use isolated limiter state and the 20-registration performance workload uses distinct client IPs. Do not trust forwarded IP headers unless the deployment explicitly configures trusted proxies. Single-instance in-memory storage is the initial deployment scope; distributed limiting is a deployment prerequisite before scaling replicas. Log outcome code/provider/duration/correlation ID only; no request body, email, credential, or raw Prisma exception.

**Rationale**: Public password hashing needs bounded abuse exposure. Validation constraints and error classification must be testable and preserve secret hygiene.

**Alternatives considered**: Globally throttling unrelated endpoints expands scope; logging full DTOs violates credential confidentiality; distributed infrastructure is unnecessary for current single-service scope.

Source: [Nest rate limiting](https://docs.nestjs.com/security/rate-limiting).

All planning unknowns are resolved. Google/Microsoft flows, sign-in, linking, recovery, and distributed deployment are explicitly outside implementation scope.

## Revision: Provider-wide strategy and validation ownership

**Decision**: Follow the user’s explicit scope: local.strategies.ts implements AuthStrategy with register() only for now; expand this same interface/class with authenticate() later. No public prepare() method and no split authentication interface. DTO validation belongs only to controller pipes, including field/password/provider checks.

**Rationale**: This gives each provider one strategy implementation across auth use cases, while keeping the current surface limited to implemented operations. Hash preparation remains outside the transaction in the private hashPassword() function in auth.service.ts. Services still enforce email conflicts and transaction consistency; those are business invariants, not DTO validation.

**Alternatives considered**: Registration-only strategies, a separate future AuthenticationStrategy, and duplicate service DTO validation are superseded by the user’s design instructions. Future internal entry points must validate input at their own boundary before calling services.

## Revision: Keep auth service helpers together

**Decision**: Keep register(), private resolveStrategy(), and private hashPassword() in auth.service.ts. Inject LocalStrategy directly into AuthService. Use the existing argon2 dependency from the private function; no injectable password-hashing service, resolver class, or credential-helper file is required. Keep withTransaction() as a small AuthRepository method delegating directly to Prisma.$transaction, without introducing another service/file.

**Rationale**: These helpers have one current owner and do not need independent dependency lifecycles. The repository transaction wrapper only preserves the existing persistence boundary; all business orchestration stays in AuthService. Hashing before the transaction and shared transaction-client forwarding still provide the required atomicity.

**Alternatives considered**: Separate hashing/resolver providers and a general transaction manager add organization and injection overhead without current reuse. Private methods can be extracted later if another owner actually needs them. Direct Prisma transaction orchestration in AuthService would depart from the project's repository persistence boundary without reducing the number of necessary transaction writes.

## Analysis remediation

The specification now includes the planned 10-attempt/60-second/IP limit and its acceptance criteria; performance uses 20 distinct, within-limit trusted IPs. Failure handling uses the exact allowlist and fallback in plan.md, grounded in the Prisma v6 error reference. Test authoring with expected failures is distinct from implementation/checkpoint completion with passing tests; task ordering follows these explicit gates.
