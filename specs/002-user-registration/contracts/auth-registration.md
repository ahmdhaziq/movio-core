# Endpoint Contract: Local Registration

## POST /auth/register

Public endpoint; no session required. Content-Type application/json. Only the local provider is implemented. No success cookie, access token, refresh token, or automatic sign-in.

### Request

```json
{
  "provider": "local",
  "name": "New User",
  "email": "new.user@example.com",
  "password": "ExamplePass9!"
}
```

Controller-bound ValidationPipe validates this request before AuthService is invoked. Services do not revalidate the DTO. All four properties are required. Unknown properties are rejected, including identity_id, user_id, password_hash, role, and lifecycle timestamps. Missing or unsupported provider returns 400, including google/microsoft until implemented. Names/emails are trimmed and email lowercased; passwords are untouched. Name maximum is 100 characters after trimming. Password rules are defined in [data-model.md](../data-model.md).

### Success: 201 Created

```json
{
  "user": {
    "id": 123,
    "name": "New User",
    "email": "new.user@example.com"
  }
}
```

Both User and AuthIdentity must be committed before this response. Identity ID, hash, and credentials are intentionally omitted; the User email is returned only to the submitting client. Public user-profile responses retain their existing projection.

### Errors

Error envelopes have statusCode, code, message, and optional errors array. Validation errors include field, code, and message, never submitted values. The contract is implemented with auth-owned error mapping/filtering and sanitized validation failures; existing unrelated endpoint behavior should be preserved.

| Status | Code | Meaning |
|--------|------|---------|
| 400 | VALIDATION_ERROR | Missing/invalid name, email, password, provider, or unsupported fields; errors lists affected fields |
| 409 | EMAIL_UNAVAILABLE | A retained user already holds the normalized email, including when no local identity exists |
| 409 | IDENTITY_UNAVAILABLE | Identity unique constraint conflict; no existing identity details are exposed |
| 429 | REGISTRATION_RATE_LIMITED | More than 10 attempts within 60 seconds for the trusted client IP; Retry-After header indicates seconds to retry |
| 503 | REGISTRATION_TEMPORARILY_UNAVAILABLE | Known temporary persistence, transaction, or credential-preparation failure |
| 500 | INTERNAL_ERROR | Unexpected error, with sanitized public message |

Duplicate example:

```json
{
  "statusCode": 409,
  "code": "EMAIL_UNAVAILABLE",
  "message": "Email is unavailable"
}
```

Password validation example:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Registration details are invalid",
  "errors": [
    {
      "field": "password",
      "code": "PASSWORD_SYMBOL_REQUIRED",
      "message": "Password must include a symbol"
    }
  ]
}
```

Distinct unmet password rules should use stable field codes for length/uppercase/lowercase/digit/symbol. Provider errors use field provider and PROVIDER_REQUIRED or PROVIDER_UNSUPPORTED. Unknown fields use FIELD_UNSUPPORTED; missing required fields use FIELD_REQUIRED. Class-validator transport errors must be mapped without serializing its target/value fields.

Failure classification follows the explicit allowlist and fallback in [plan.md](../plan.md#failure-classification). Recognized availability errors return 503; configuration/internal misuse/unrecognized failures return 500. Preserve validation/conflict/rate-limit outcomes. Use identified temporary errors in fault-injection tests; a generic Error is an unexpected failure, not a 503 fixture.

## Guarantees

- Repetition and concurrent normalized-email attempts create at most one User and one local identity.
- User and identity creation share a transaction; failure inserting the identity rolls back the new User.
- Existing users and identities are never modified or linked by this endpoint.
- Local identity_id is String(createdUser.id), not the email or a caller-supplied value.
- Password input/hash never appear in responses, public views, or logs.
- No email verification, credential update, OAuth callback, account linking, or authentication endpoint is introduced.

## Operations

Route-scoped 10 attempts/60 seconds/IP throttling includes failed submissions. Responses should include Retry-After on throttling; implementation may need a route-specific guard/filter to provide the envelope and header. Use server-derived IP; deployment proxy trust must be explicit. Initial single-instance limiter is adequate only for that deployment scope; replicas require shared limiter storage before rollout. Outcome metrics distinguish success, validation failure, conflict, throttled, temporary failure, and unexpected failure; structured logs include provider, outcome code, duration, and correlation ID, excluding request body/email/password/hash and raw persistence errors.
