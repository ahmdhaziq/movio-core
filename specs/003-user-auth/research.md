# Research: Stateless Access Authentication

Date: 2026-10-16. User revision supersedes the earlier session-backed access design. No unresolved research questions remain; publication compatibility is checked during dependency installation.

## 1. Stateless access and revocation boundary

**Decision**: No server-session table and no database calls during access authentication. JWT expiry is the access termination mechanism. Persist only refresh generations and revoke their renewal family on logout/reuse.

**Rationale**: This follows the user's explicit choice. Account deletion and refresh revocation stop issuing new credentials but cannot revoke an outstanding stateless access token. Existing business rules can still reject resources independently.

**Alternatives considered**: Live session checks and JWT denylisting allow immediate revocation but conflict with the requested stateless access design. The specification now states the expiry-based behavior explicitly.

## 2. Custom CanActivate guard and owned provider strategies

**Decision**: AccessTokenGuard implements Nest CanActivate and calls AuthService.validateAccessToken(raw). It uses our own extractBearerToken helper, attaches verified request.user, and is registered through APP_GUARD. Keep existing LocalStrategy.register/authenticate; future providers remain custom strategy work.

**Rationale**: The user explicitly chose custom guards and Nest JwtService, preserving one provider strategy layer and one access verification path. The guard handles only HTTP concerns; cryptographic validation stays in the service/helper.

**Alternatives considered**: Passport AuthGuard plus passport-jwt is valid but adds an unneeded strategy adapter/dependencies for this design. A middleware-only check lacks the selected guard's route metadata boundary. No Passport packages are planned.

Source: [Nest custom guards and APP_GUARD](https://docs.nestjs.com/guards). Existing module ownership and dependency direction remain unchanged.

## 3. Unified JwtService verification and extraction

**Decision**: JwtService.signAsync signs both token types. Both validateAccessToken(raw) and validateRefreshToken(raw) call purpose-specific JwtService.verifyAsync, then validate runtime claims. Refresh additionally checks stored evidence. The access guard calls the same raw-token service method used by logout, exactly once.

**Rationale**: There is no second cryptographic verifier or public claim-only authentication path. The helper extracts a strict single bearer value and rejects duplicate raw Authorization headers; it does not decode or verify credentials. Typed principal is created only after verification. Current injected clock seconds are passed on every verify call.

**Alternatives considered**: Accepting decoded claims without signature verification is invalid. Duplicating verification in the guard and service adds no value. A fixed startup verification timestamp would break expiry; use current per-call time.

Source: [JwtService async signing/verification and options](https://raw.githubusercontent.com/nestjs/jwt/master/README.md). Verify a published Nest-12-compatible @nestjs/jwt release during implementation and commit its lockfile resolution. No new package installation is performed during planning.

## 4. Refresh table and safe rotation

**Decision**: One refresh_token table with self-referencing root_token_id, owner identity, immutable expiry, digest, consumed_at and revoked_at. Lock root for refresh and logout mutations. Keep root and consumed evidence until the 30-day deadline.

**Rationale**: Rotation needs retained evidence to distinguish consumed-token reuse. A common retained root serializes all generations and supplies one refresh-only revocation boundary per login. It does not participate in access validation.

**Alternatives considered**: Overwriting one digest loses history. Separate server-session entity is unnecessary. Unlocked read/write can mint competing replacements.

Sources: [refresh rotation/reuse detection](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2), [PostgreSQL 17 row locks](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS). This applies the rotation pattern without claiming OAuth-server conformance. Prisma 6 transaction APIs come from the installed codebase, not unversioned newer documentation.

Reuse revocation returns an outcome and commits before service raises 401. It revokes replacement refresh credentials, not outstanding access JWTs.

## 5. Token security and existing integration

**Decision**: Separate access/refresh HS256 secrets, issuer/audience/purpose checks and strict claim validation. Store SHA-256 refresh digests only. Preserve registration filter semantics while adding authentication-aware errors.

**Rationale**: Different JWT purposes need distinct acceptance rules. AuthIdentity.id is the integer row FK; identity_id is provider-specific text. Existing IdentityMetadata excludes password_hash, so add a private lookup. Active currently means both User.deleted_at and AuthIdentity.deleted_at null. Existing filter maps unrecognized 401 to 500 and requires correction; existing public-user E2E assumptions require login setup.

**Alternatives considered**: Same-purpose generic token acceptance risks substitution. Raw stored credentials are unnecessary. Reusing registration error formatting unchanged gives wrong login/guard responses.

Source: [JWT best current practice](https://www.rfc-editor.org/rfc/rfc8725.html#section-3.12). Local evidence: src/auth/auth.controller.ts, auth.repository.ts, strategies/auth-strategy.interface.ts, local.strategies.ts, src/configure-app.ts and prisma/schema.prisma.

## 6. Exception and error organization

**Decision**: Colocate auth errors, custom exceptions, exception filters and their non-E2E tests in `src/auth/exceptions/`. This is the user's requested folder organization.

**Rationale**: One module-owned folder keeps related failure handling discoverable while preserving domain ownership. Domain errors remain independent of HTTP; filters retain transport mapping. No runtime behavior, token handling or database contract changes.

**Alternatives considered**: Separate errors/filters folders are unnecessary for this module's current size. A root-level folder collecting every domain's errors conflicts with the project's module-first ownership principle.

Evidence: `.specify/memory/constitution.md` principles I, II and V. Pre/post-design constitutional checks remain passing.

## 7. Provider-selected login DTOs

**Decision**: Keep LoginLocalDto as the concrete local request, expose LoginDto as a provider-discriminated request type, and use LoginValidationPipe to select/validate an enabled concrete DTO before calling login(provider,input). Provider-keyed authentication payload types preserve strategy-specific fields.

**Rationale**: A local DTO does not limit the strategy interface, but annotating the universal HTTP body with that concrete class would impose its local fields on every future strategy. The existing global ValidationPipe validates by reflected class metadata; an explicit parameter pipe must select the runtime class for a generic request. Local-only behavior remains unchanged today.

**Alternatives considered**: One class with optional email/password/provider-token fields allows invalid combinations and grows with every provider. A provider-only base class would conflict with strict global whitelisting. Separate future provider routes remain possible for redirect/callback protocols, while sharing common credential issuance.

Sources: [Nest validation and concrete runtime DTOs](https://docs.nestjs.com/techniques/validation), [ValidationPipe implementation and Object metatype handling](https://raw.githubusercontent.com/nestjs/nest/master/packages/common/pipes/validation.pipe.ts). Local evidence: src/configure-app.ts and src/auth/strategies/auth-strategy.interface.ts. This selects existing class-transformer/class-validator capabilities, not a new dependency.
