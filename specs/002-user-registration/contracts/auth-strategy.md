# Internal Contract: Provider Auth Strategies

## Provider and request types

AuthProvider is a string enum with stable local, google, microsoft names. The implemented registry and endpoint accept local only. Future names are identifiers, not enabled behavior.

RegisterLocalDto is the concrete runtime DTO: provider local, name, email, password, all required. Keep the public request flat. Future methods get dedicated DTOs and controller validation; compose provider variants as a discriminated union when implemented. Do not put optional password, token, and authorization-code fields on one shared class. A TypeScript interface alone cannot supply runtime validation metadata.

DTO validation runs at the controller boundary through ValidationPipe, including field/password/provider policy and unknown-field rejection. AuthService and UserService.create trust those validated DTOs and do not repeat class-validator checks. Non-HTTP callers must validate their input at their own entry boundary before invoking services. Business checks such as email conflicts and strategy availability remain in the service; database constraints remain in repositories.

## Provider-wide strategy interface

Define AuthStrategy<P> using provider-keyed registration payload types. Initially the payload map contains only local; widen it when another provider is implemented. The same provider strategy will support registration, authentication, and other auth operations as they are scoped. The only operation declared now is register(); there are no authenticate() stubs or prepare() operation.

| Member | Contract |
|--------|----------|
| provider | The exact provider literal P |
| register(context: AuthRegistrationContext<P>) | Promise<IdentityMetadata>; persist the provider identity through AuthRepository using required tx |

AuthRegistrationContext<P> contains userId, payload: RegistrationPayloadMap[P], and tx: Prisma.TransactionClient. Local payload is { passwordHash: string }. AuthService obtains this hash through its private hashPassword() function before opening the transaction. Raw passwords are never forwarded into the transaction or persistence DTO.

LocalStrategy lives in strategies/local.strategies.ts and implements AuthStrategy<'local'>. Its register() derives String(userId), sets provider local, and calls repository creation with password_hash from payload.passwordHash. Metadata return excludes password_hash.

When authentication is implemented, extend this same AuthStrategy interface with authenticate() and its provider-specific parameter types, and add the corresponding implementation to LocalStrategy in the same provider file. Registration's payload remains distinct from future authentication input. Do not introduce a parallel registration-only strategy class or separate AuthenticationStrategy requirement.

Future external provider verification and trusted profile extraction must finish before user/identity persistence. That orchestration will be designed with the provider feature; no speculative verification or preparation interface methods are introduced now.

## Strategy selection in AuthService

AuthService.resolveStrategy(AuthProvider.Local) returns the injected LocalStrategy instance. An explicit map or provider switch is sufficient for this increment; no dynamic class loading or per-request construction. Controller validation rejects unsupported request providers; resolveStrategy() independently rejects unconfigured strategies as a business/configuration guard. Future overloads preserve provider/payload type correlation; do not erase it using any or unsafe casts.

AuthModule registers LocalStrategy, AuthService, and AuthRepository. resolveStrategy() and hashPassword() are private methods in AuthService, not injectable providers. It imports UserModule and PrismaModule. UserModule never imports AuthModule.

## Service and repository contracts

- AuthService.register(dto: RegisterLocalDto) takes the already validated DTO used by the controller; dto.provider chooses the strategy. No redundant separate strategy parameter and no service DTO validation pass.
- AuthService calls its private hashPassword(dto.password) function for local registration before starting the transaction. No strategy preparation method is needed.
- AuthRepository.withTransaction(callback) is a small method in auth.repository.ts delegating to Prisma.$transaction; callback receives tx. The promise resolves after commit; any callback/write error rolls back user and identity creation and propagates. Both repositories must use the supplied tx. No separate transaction service or abstraction is introduced. AuthService orchestrates but executes no Prisma queries.
- AuthRepository.createIdentity(dto: CreateAuthIdentityDto, tx: Prisma.TransactionClient) requires a transaction for registration writes and returns metadata with secrets excluded. It receives internally derived, typed input rather than validating a public DTO.
- AuthRepository.getIdentityByUserId(userId, provider?, tx?) returns metadata[] including deleted identities; an optional provider filters the list. It never returns hashes for duplicate checks.
- UserService.getUserByEmail(normalizedEmail, tx?) is an explicit nullable internal lookup, including deleted users. Add it deliberately; the existing public getUserById is not the registration lookup.
- UserService.create(CreateUserDto, tx?) forwards the same tx for its business lookup and insert; UserRepository accepts that context. Remove the existing validateDto invocation from this creation path and revise its tests accordingly. Existing standalone callers provide validated DTOs; optional tx preserves standalone persistence behavior. Canonical email normalization remains a write invariant, not DTO revalidation.

Existing email → check provider identity → return 409 whether present or absent. This sequence honors the requested inspection without granting credentials on an existing account. Future authenticated account linking is a different operation.

## Error and rollback guarantees

Controller DTO validation happens before service orchestration. A pre-transaction hash failure cannot leave records. Database unique constraints resolve races. Any error after user creation prevents commit of both records. Return 409 for identified duplicate/identity uniqueness conflicts, 503 only for the explicit availability/resource allowlist in [plan.md](../plan.md#failure-classification), and sanitized 500 for configuration/internal misuse/unrecognized failures. A generic hash rejection is not automatically temporary. No response or logged exception embeds input passwords, encoded hashes, or raw database parameters.
