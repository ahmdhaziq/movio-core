# Data Model: Auth Registration

## User (existing)

Existing id, name, email, created_at, updated_at, deleted_at remain user-owned. Add a one-to-many auth identities relation without moving credentials into User. All retained users, including soft-deleted users, reserve normalized email.

Email writes trim surrounding whitespace and lowercase before persistence. Retain email @unique for Prisma findUnique support; add a SQL unique index on lower(btrim(email)) so normalized uniqueness also holds outside service writes. Before enabling registration, preflight duplicates across all retained rows, abort on collisions, then normalize existing emails in the reviewed migration. No automatic merge, physical delete, or identity/credential backfill.

## AuthIdentity (new Prisma model, table auth_identity)

| Field | Type / default | Meaning |
|-------|----------------|---------|
| id | Int, primary key, autoincrement | Internal identity row key |
| identity_id | String, required | Provider subject; local uses String(user.id), not caller input |
| user_id | Int, required FK to User.id | Owning user |
| provider | String, required | Stable provider name; local/google/microsoft enum values in application |
| password_hash | String?, nullable | Encoded salted Argon2id hash for local; null for external providers |
| created_at | DateTime, default now | Creation timestamp |
| updated_at | DateTime, automatic update | Last identity update |
| deleted_at | DateTime?, nullable | Soft deletion marker; normalize proposed deleted_At spelling |

Relations and constraints:

- User has many identities; each identity belongs to exactly one User. FK uses restrictive physical deletion; User soft deletion retains identities and future authentication must check both states.
- Unique (provider, identity_id): a provider subject belongs to at most one retained identity.
- Unique (user_id, provider): one retained identity per provider per user. This design intentionally excludes multiple accounts at the same provider for one user.
- Uniqueness applies across soft-deleted rows; recovery and reuse require a future explicit policy.
- Non-empty provider and identity_id. For provider local, identity_id must equal user_id cast to text and password_hash must be a nonempty encoded Argon2id value. For non-local, password_hash must be null. Enforce structural invariants via service-derived identity fields, typed internal creation DTOs, and SQL CHECK constraints where expressible; repositories do not re-run request DTO validation.
- (user_id, provider) unique index serves user lookup; no redundant user_id index needed initially. Add a deleted_at index if active identity browsing is introduced later.
- Provider is stored as text, not a PostgreSQL enum, to allow future provider rollout. Application acceptance remains local-only.

No email copy, token, password salt, algorithm column, email_verified flag, or password-change timestamp is required for current behavior. Hash encoding contains algorithm/parameters/salt. External token management, issuer/tenant namespaces, and credential rotation belong to future provider designs; future identity_id must namespace issuer/tenant where subjects are not globally unique within a provider.

## Internal creation input

CreateAuthIdentityDto carries identity_id, user_id, provider and password_hash. For current local identity creation, the hash is required. Future external variants carry no password_hash. This DTO is internal and is never accepted by the registration controller. IDs, lifecycle fields, and hash are derived by the service/strategy, not trusted from clients.

AuthRepository.getIdentityByUserId(userId, provider?, tx?) returns an array of identity metadata, optionally filtered by provider, including soft-deleted rows for reservation checks. Empty array means no matching identity. Metadata excludes password_hash. This explicit plural result prevents ambiguity once a user has multiple providers. register supplies provider local; at most one row matches due to uniqueness.

## Validation

- Local request: required provider local, trimmed nonblank name at most 100 characters, normalized valid email, required password.
- Password: 8–128 Unicode code points, at least one Unicode uppercase letter, one Unicode lowercase letter, one ASCII digit, and one non-letter/non-digit/non-whitespace symbol. Preserve exact supplied characters, do not normalize or trim. Whitespace cannot satisfy the symbol requirement.
- Reject missing/null/non-text fields, unsupported providers, and unknown fields. Error messages identify rules without echoing passwords.
- DTO validation runs only at the controller boundary. AuthService and UserService.create do not re-run it; internal callers must validate inputs at their own entry boundary before invoking services. Email conflicts, normalization invariants, resolver availability, and persistence constraints are still enforced as business/data rules.

## Lifecycle and atomicity

Registration → active User plus active AuthIdentity in one commit. Failed creation → neither new record. There is no pending email verification or signed-in state. Existing active/deleted users reject registration even when they have no local identity. No account linking, revival, identity deletion endpoint, or credential update is implemented here.

## Migration impact

One additive identity table with FK, timestamp/defaults, hash field, composite unique keys and SQL CHECKs; one normalized-email index/data normalization migration. Existing User identifiers and non-email data remain intact. The preflight must fail clearly on conflicting case/whitespace variants and leave data unmerged. Test migrations from the current 20261012000000_add_user baseline and on a fresh database. Confirm the Prisma schema and raw SQL constraints agree; expression-index/CHECK limitations require committed migration SQL rather than relying on schema declarations alone.
