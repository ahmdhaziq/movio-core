# Data Model: Refresh Tokens Only

No AuthSession entity or auth_session table is created. Access JWTs are not persisted or looked up. One login's related refresh generations are a refresh family, represented entirely in refresh_token.

## Existing ownership

User.id and AuthIdentity.id are integer primary keys. AuthIdentity.identity_id is provider-specific text; local identities store String(user.id). Name the new integer FK auth_identity_id to avoid confusing these. Login and refresh eligibility require both deleted_at fields null; access validation does not read either record.

Add User/AuthIdentity reverse refresh relations and AuthIdentity composite unique `(id, user_id)` for an ownership-preserving FK. No existing identity, password, email or lifecycle data is rewritten.

## RefreshToken → refresh_token

| Field | Type | Constraint/purpose |
|---|---|---|
| id | UUID | Primary key, equals refresh JWT jti; service generated |
| user_id | integer | Required User.id FK, restrictive deletion |
| auth_identity_id | integer | Required AuthIdentity.id, not provider text identity_id |
| root_token_id | UUID | Required self-reference to first refresh row in this login |
| token_hash | char(64) | Unique lowercase SHA-256 hex of complete refresh JWT |
| expired_at | timestamptz | Fixed original login time +2,592,000 seconds, same for every generation |
| consumed_at | nullable timestamptz | Set once when used successfully for refresh |
| revoked_at | nullable timestamptz | Set when refresh family is revoked |
| created_at | timestamptz | Whole-second UTC issuance time |

Initial row has root_token_id=id. Each replacement keeps the same root_token_id, ownership and expired_at. Root remains retained/lockable after its own token is consumed. Root consumed_at is normal and does not itself revoke children; root revoked_at blocks all renewal.

Add unique `(id,user_id,auth_identity_id)` and composite self FK `(root_token_id,user_id,auth_identity_id)` → `(id,user_id,auth_identity_id)` to enforce family owner consistency. Composite owner FK `(auth_identity_id,user_id)` → AuthIdentity `(id,user_id)` prevents linking another user's identity. Self-references use restrictive deletion and explicit relation names. Service/repository enforce that selected root points to itself and all generations share its immutable deadline. A same-row root self-reference is checked by PostgreSQL within the insert.

Indexes: user_id, auth_identity_id, root_token_id and expired_at; PK and token_hash unique indexes. Migration SQL adds partial unique `(root_token_id) WHERE consumed_at IS NULL AND revoked_at IS NULL` so at most one current credential exists per family. Consume the old row before inserting replacement. Prisma 6 schema records ordinary constraints while reviewed SQL owns the partial index.

The proposed access_token storage becomes token_hash, containing only refresh evidence. No raw bearer JWTs or short-lived access strings are stored. No device/IP/last-used fields required for this scope.

## CreateRefreshTokenDto

Internal fields: id, user_id, auth_identity_id, root_token_id, token_hash, expired_at, created_at. AuthRepository.createRefreshToken(dto, tx) receives this DTO in the caller's transaction. It does not accept a raw access_token, choose lifetimes or authenticate HTTP input. Verified user/identity IDs and root come from login/refresh service, never caller-supplied request fields.

## Transitions and locking

Current → consumed and replacement current, atomically. Current or consumed → revoked on family revocation. Time-expired when now >= expired_at. Matching known consumed-token reuse revokes every row in that family but leaves access JWTs valid until signed expiry.

Refresh/logout transactions lock the root first using repository parameterized SELECT FOR UPDATE. Then reread token/root state, ownership, exact digest, account activity and current time. All generation writes follow this lock protocol. Unknown/mismatched digest or claim IDs reject without revocation. Return reuseDetected from callback and throw only after revocation commit.

The family is not a server-side access session: the access guard never queries it. Signed fid merely allows a later logout request to identify which refresh family to revoke. Account deletion stops login/renewal; outstanding stateless access remains accepted through its exp.

## Retention and migration

Retain root and all generations at least through their fixed deadline; do not delete consumed rows early. Initial increment adds no purge job. Later cleanup must delete descendants before root (self-FK), then identities/users when hard deletion is explicitly authorized. Test fixtures follow the same order. Soft deletion is unaffected.

One additive migration creates refresh_token plus reverse relations, composite ownership/root constraints and indexes. No sessions seeded and no account modifications. Test migration with retained active/deleted users and identities, root self-insert, owner mismatch, same-family current-token uniqueness, transaction rollback and concurrent consume/revoke. There is no migration execution in planning.
