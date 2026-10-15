# Feature Specification: User Registration

**Feature Branch**: `main` (current branch; no branch-creation hook configured)

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "i want to build user registration, where details will be sent to the backend a user will be created, ignore the user registration in the other branch"

## Clarifications

### Session 2026-10-14

- Q: Should registration create a user using only name and email, or also require a password? → A: Require name, email, and password; sign-in is a separate feature.
- Q: What password rules should registration enforce? → A: Require 8–128 characters, including uppercase, lowercase, a number, and a symbol.
- Planning input: Registration is owned by the new auth module, uses provider-selected strategies, and creates a linked provider identity atomically with the user; only local registration is implemented now.
- Planning revision: Provider strategies are shared across auth operations; the interface currently exposes register() only and will later add authenticate(). DTO validation runs only at the controller boundary, without service revalidation.

## User Scenarios & Testing *(mandatory)*

Unless a scenario explicitly tests throttling, submissions occur within the trusted client IP’s registration attempt limit.

### User Story 1 - Register a New User (Priority: P1)

As a new user, I want to submit my name, email, and password so that the application creates a user record and confirms that registration succeeded.

**Why this priority**: Creating a recognized user is the core outcome of this feature.

**Independent Test**: Submit valid details with an unused email, confirm a success result identifying the new user, and verify that exactly one user is retained after the operation completes.

**Acceptance Scenarios**:

1. **Given** a person has a valid name, an unused email, and a valid password, **When** they submit those details with the local provider selected for registration, **Then** the system stores one user and returns confirmation containing the new user's identifier and accepted name and email.
2. **Given** registration has succeeded, **When** the created user is subsequently retrieved through an authorized internal read, **Then** their identifier and stored details match the registration result.
3. **Given** a person has no existing account or signed-in session, **When** they submit valid registration details, **Then** registration is available to them.
4. **Given** registration succeeds, **When** the client receives the result, **Then** it contains no password or stored credential representation and does not sign the user in.
5. **Given** the local provider is selected, **When** registration succeeds, **Then** the new user has one local identity whose provider identifier is the user identifier represented as text.

---

### User Story 2 - Correct Invalid Registration Details (Priority: P2)

As a new user, I want to understand which submitted details are invalid so that I can correct them and register successfully.

**Why this priority**: Clear validation prevents unusable records and helps people complete registration.

**Independent Test**: Submit invalid details, verify that no user is created and the invalid fields are identified, then resubmit corrected details and confirm success.

**Acceptance Scenarios**:

1. **Given** a submission has a missing name, email, or password, an invalid password, a blank name, a name exceeding 100 characters, or a malformed email, **When** registration is attempted, **Then** the system rejects the submission, identifies each invalid field, and creates no user.
2. **Given** a submission contains unsupported fields, **When** registration is attempted, **Then** the system rejects the submission and identifies the unsupported fields without storing them.
3. **Given** a person corrects a rejected submission, **When** they submit valid details with an unused email, **Then** registration succeeds.
4. **Given** a password is shorter than 8 characters, longer than 128 characters, or lacks any required character category, **When** registration is attempted, **Then** the system identifies the unmet password rules without echoing the password and creates no user.
5. **Given** a password is exactly 8 or 128 characters and includes all required character categories, **When** it is submitted with a valid name and unused email, **Then** registration succeeds.
6. **Given** a missing, unknown, or unimplemented provider selector, **When** registration is attempted, **Then** the system rejects the provider and creates neither a user nor an identity.

---

### User Story 3 - Receive a Safe Result When Registration Cannot Complete (Priority: P2)

As a new user, I want a clear result when my details conflict with an existing user or the service cannot complete registration so that I know whether registration succeeded.

**Why this priority**: Reliable outcomes prevent duplicate users and misleading confirmations.

**Independent Test**: Attempt duplicate registrations and simulate a storage failure; verify clear failure results, no duplicate or partially created user, and no change to existing users.

**Acceptance Scenarios**:

1. **Given** a user already holds an email, **When** another registration uses that email, **Then** the system reports that the email is unavailable without creating another user or exposing the existing user's details.
2. **Given** two registration submissions simultaneously use the same unused email, **When** both are processed, **Then** at most one succeeds and the other receives an email-unavailable result.
3. **Given** a recognized temporary storage failure prevents creating the new user, **When** registration is attempted, **Then** it returns a temporary failure result without claiming success, exposing internal diagnostics, or retaining a partial user or identity.
4. **Given** registration succeeded but the client did not receive confirmation, **When** the same details are submitted again within the attempt limit, **Then** the system creates no duplicate and reports the email as unavailable.
5. **Given** an unexpected internal or configuration error prevents registration, **When** the submission is processed, **Then** the system returns a sanitized internal-error result and no partial new user or identity remains.
6. **Given** a client IP has made 10 attempts within 60 seconds, **When** it submits another registration in that window, **Then** the system returns a rate-limit result with retry timing and creates no records; once the window expires, a valid new registration can proceed.

### Edge Cases

- Leading and trailing whitespace is removed from names and emails before validation; a name containing only whitespace is rejected.
- Email uniqueness ignores letter case and surrounding whitespace. Stored registration emails use a consistent lowercase form.
- Names of exactly 100 characters are accepted when otherwise valid; names exceeding that limit are rejected after surrounding whitespace is removed.
- Missing, null, or non-text required details are rejected with field-specific errors.
- Repeated or concurrent submissions cannot create multiple users for the same email.
- An email retained by an inactive or deleted user remains unavailable; registration does not restore or modify that user.
- A connection loss after a completed registration may leave the client uncertain; retrying preserves uniqueness and does not imply that the previous creation failed.
- Passwords of exactly 8 or 128 characters are valid when all required character categories are present; whitespace alone does not count as a symbol.
- Password input is preserved exactly as supplied; name and email normalization MUST NOT trim or change passwords.
- More than 10 attempts within one client-IP window are rate-limited, even if earlier attempts failed validation or conflicted with existing users.
- A temporary storage/resource failure and an unexpected programming/configuration failure have distinct public results.
- Registration failures leave existing users unchanged and never disclose their personal details.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept registration submissions from a client without requiring an existing account or signed-in session.
- **FR-002**: A local registration submission MUST contain a provider selector, name, email, and password. The system MUST reject unsupported fields.
- **FR-003**: The system MUST remove surrounding whitespace, require a nonblank text name of at most 100 characters, and require a syntactically valid text email before creating a user.
- **FR-004**: The system MUST treat emails differing only in letter case or surrounding whitespace as the same identity and store emails in lowercase form.
- **FR-005**: The system MUST create and durably retain exactly one active user with a unique identifier, accepted name and email, an associated provider identity with protected password credentials, and creation time for each successful registration.
- **FR-006**: The system MUST confirm success only after creation has completed and MUST return the new user's identifier, accepted name, and email to the submitting client.
- **FR-007**: The system MUST reject registration for any email already held by a retained user, including an inactive or deleted user, without changing that user.
- **FR-008**: Within the registration attempt limit, repeated or simultaneous registrations using the same email MUST result in at most one stored user; unsuccessful attempts MUST receive an email-unavailable result.
- **FR-009**: For submissions processed within the registration attempt limit, validation failures MUST identify the invalid or unsupported fields and MUST create no user.
- **FR-010**: A failed creation MUST leave no partial user, preserve existing user details, and return a clear failure result without internal diagnostics or another user's personal information. Recognized availability/resource failures MUST be reported as temporary; unexpected internal failures MUST be reported as internal errors.
- **FR-011**: Registration MUST NOT assign elevated privileges or accept client-supplied identifiers, lifecycle state, or creation times.
- **FR-012**: The system MUST retain password credentials in a form that does not allow the original password to be recovered. Passwords and stored credential representations MUST NOT appear in registration results, public user information, or logs.
- **FR-013**: Successful registration MUST NOT sign the user in or return sign-in credentials; sign-in is a separate feature.
- **FR-014**: The system MUST require a text password of 8–128 characters inclusive, containing at least one uppercase letter, one lowercase letter, one digit, and one non-letter, non-digit, non-whitespace symbol. Invalid passwords MUST produce a password-field error explaining unmet rules, without repeating the submitted password. Passwords MUST be validated exactly as supplied, without trimming or normalization.

- **FR-015**: The system MUST require a registration provider selector and support only local registration in this increment. Missing, unknown, or unimplemented providers MUST be rejected before any user or identity is created.
- **FR-016**: Successful registration MUST create both the user and its provider identity atomically. A failure creating either MUST leave neither new record. Local provider identity identifiers MUST use the created user identifier represented as text.

- **FR-017**: Registration MUST allow at most 10 attempts in a 60-second window per trusted client IP, counting successful and failed submissions. Further attempts in that window MUST receive a rate-limit result with the number of seconds to wait before retrying, without creating a user or identity. Other user-information operations MUST be unaffected.
- **FR-018**: Recognized service availability failures (unreachable/disconnected storage, storage operation/connection/transaction timeouts, transaction contention, and explicitly identified temporary hashing resource exhaustion) MUST return a temporary-unavailable result. Configuration errors, invalid internal operations, and unrecognized errors MUST return a sanitized internal-error result. Validation, conflict, and rate-limit results MUST retain their own categories.

### Key Entities *(include if feature involves data)*

- **Registration Details**: The provider selector, name, email, and password supplied by a prospective user, subject to validation; only name and email are normalized.
- **User**: The created application identity, with a unique identifier, name, unique email, creation time and active lifecycle state. Credentials belong to the associated registration identity and are never part of public user information.
- **Registration Identity**: A provider-specific identity linked to a user, with a provider name, provider identity identifier, lifecycle timestamps, and protected password credentials for local registration.
- **Registration Result**: Confirmation identifying the newly created user, or a validation, email-unavailable, or temporary failure result. Failure results contain no existing user's personal details.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid, nonconflicting registration acceptance tests within the registration attempt limit produce one retained user and a matching success confirmation.
- **SC-002**: 100% of invalid-submission tests within the registration attempt limit identify the rejected fields and produce zero new users.
- **SC-003**: 100% of duplicate, retry, and simultaneous same-email tests retain at most one user, including tests that vary email case and surrounding whitespace.
- **SC-004**: 100% of simulated creation-failure tests produce no success confirmation, no partial user, and no changes to existing users.
- **SC-005**: At least 95% of valid registrations receive confirmation within two seconds under a verification workload of 20 simultaneous submissions with distinct emails and distinct trusted client IPs, each within its registration attempt limit. Throttled submissions are evaluated separately and do not count as completed registrations.
- **SC-006**: In a review of the acceptance scenarios, a product reviewer can distinguish successful registration, details needing correction, an unavailable email, and a temporary failure from the returned results without technical assistance.
- **SC-007**: 100% of registration result, public user-information, and captured-log checks expose neither submitted passwords nor stored credential representations; successful registration never creates a signed-in session.
- **SC-008**: 100% of password boundary and character-category tests within the registration attempt limit enforce the selected rules, identify unmet rules without revealing passwords, and leave rejected submissions without a new user.

- **SC-009**: In rate-limit tests, the 11th attempt from one trusted client IP within 60 seconds returns a rate-limit result with retry timing and creates no records; attempts can proceed after the window expires, and user-information operations remain unaffected.
- **SC-010**: 100% of tested recognized availability failures return temporary-unavailable results, while configuration/invalid-operation/unrecognized failures return internal-error results; neither category exposes internal diagnostics or credentials, and failures before commit leave no partial user or identity.

## Assumptions

- Only local registration is implemented; other provider methods and account linking are future work.
- This specification is standalone. Registration specifications or implementations on other branches do not define its requirements or prerequisites.
- Local registration requires the local provider selector, name, email, and password. Registration sets up password credentials for future sign-in. Sign-in, automatic sessions, email verification, password recovery, and social registration are outside this increment.
- Scope covers receiving registration details and returning a creation result in the backend. Building a registration screen is outside this increment; an existing client or test caller can submit details.
- The auth domain owns registration and provider identities; the user domain continues to own user records. Registration intake owns submission validation and result formatting; user creation owns email uniqueness and user-record business rules; identity storage owns provider identity persistence. User and identity creation must complete together or leave neither record. These responsibilities remain separate under the project constitution.
- Planning must assess the existing user data and any migration impact before implementation, preserving retained users and resolving any existing email conflicts before enabling normalized uniqueness. Planning must also determine how protected credentials are added without inventing passwords for retained users.
- The feature requires available durable user storage and a client able to submit the local provider selector, name, email, and password. Successful registration creates an active user immediately, without manual approval.
- Performance targets apply when the service is available and do not include client connectivity outages.
