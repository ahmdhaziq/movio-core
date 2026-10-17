# Feature Specification: User Authentication and Guarded Routes

**Feature Branch**: `main` (current branch; no branch-creation hook configured)

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "I want to implement authentication layer to protect guarded route from carrying out unauthorized request, allowing user to login and gain access to the application, have a short lived session (1 hour) but also long lived access (30 days)"

## Clarifications

### Session 2026-10-15

- Q: Which clients must this authentication feature support? → A: Consumer-facing native mobile applications now, with authentication reusable by a future browser-based admin portal.
- Q: Should this feature enforce admin-only access to admin portal operations? → A: Defer role-based access and admin-only operations to a later feature before the admin portal launches; this increment implements consumer authentication.

### Session 2026-10-16

- Planning revision: Access authentication is stateless, with no server-session table or database lookup in the access guard. Logout, refresh reuse, and account deletion prevent renewal; already issued access remains valid until its signed expiry (at most one hour). Refresh generations remain stored for rotation and revocation only.

## User Scenarios & Testing *(mandatory)*

An access credential proves a user's signed-in identity for up to one hour without consulting server-side state. A separate renewal credential allows access to be renewed until a fixed deadline 30 days from login. Related renewal credentials from one login form a renewal family; separate logins have independent families. Unless testing throttling, attempts are within their applicable limit.

### User Story 1 - Log In to the Application (Priority: P1)

As a registered user, I want to log in with my email and password to access the application.

**Why this priority**: Login establishes the identity required by guarded operations.

**Independent Test**: Log in using an active local account, verify the returned user and credential deadlines, then repeat with incorrect credentials.

**Acceptance Scenarios**:

1. **Given** an active user with an active local identity and password credentials, **When** they submit the local provider selector, their email, and correct password, **Then** login identifies that user, creates an independent renewal family, and grants one-hour access and renewal until 30 days after login.
2. **Given** a registered email, **When** login varies email case or surrounding whitespace but preserves the correct password exactly, **Then** the same user logs in successfully.
3. **Given** an unknown email, incorrect password, deleted or inactive user or identity, or identity without local password credentials, **When** login is attempted, **Then** the same generic authentication-failed result is returned and no renewal credential is retained.
4. **Given** missing, non-text, malformed, or unsupported fields or an unsupported provider, **When** login is attempted, **Then** a sanitized validation result identifies invalid fields without echoing passwords or exposing account existence.

---

### User Story 2 - Protect Guarded Operations (Priority: P1)

As an application user, I want protected data and actions available only to authenticated callers.

**Why this priority**: Guarded operations must verify identity before executing any protected behavior.

**Independent Test**: Request guarded reads and a representative guarded action with valid, missing, invalid, and expired access; inspect returned data and business side effects.

**Acceptance Scenarios**:

1. **Given** a correctly signed, unexpired access credential, **When** a guarded route is requested before expiry, **Then** it executes using the verified identity rather than a caller-supplied identity claim.
2. **Given** missing, malformed, tampered, or expired access, or only a renewal credential, **When** a guarded route is requested, **Then** an authentication-required result is returned before protected behavior executes, with no protected data or business side effects.
3. **Given** no access credential, **When** registration, login, or an existing public health check is requested, **Then** the authentication requirement does not block it; existing validation and throttling still apply.
4. **Given** an existing user-list or user-detail operation, or a newly added business route without an explicit public exemption, **When** it is requested without authentication, **Then** access is denied by default.
5. **Given** a user or local identity becomes deleted or inactive after login, **When** an already issued access credential is presented before expiry, **Then** authentication still accepts that credential without a state lookup; subsequent login and renewal are denied. Existing business eligibility checks remain applicable.

---

### User Story 3 - Renew Access Without Logging In Again (Priority: P2)

As a signed-in user, I want to renew access without re-entering my password for up to 30 days.

**Why this priority**: Renewal supports ongoing use while limiting each access credential's lifetime.

**Independent Test**: Use a controlled clock to test renewal and access immediately before and at the one-hour and 30-day boundaries.

**Acceptance Scenarios**:

1. **Given** expired access but valid renewal credentials and renewal family, **When** renewal is requested, **Then** new access is issued without a password and expires at the earlier of one hour after renewal or the original renewal deadline.
2. **Given** successful renewal, **When** its result is returned, **Then** a replacement renewal credential is issued, the submitted credential becomes unusable, and the original renewal deadline stays unchanged.
3. **Given** the 30-day deadline has been reached, **When** access or renewal is attempted, **Then** both are denied and login is required.
4. **Given** missing, invalid, expired, or revoked renewal credentials, or an inactive/deleted user or identity, **When** renewal is attempted, **Then** no usable credentials are issued and an authentication-required result is returned.
5. **Given** a known previously consumed renewal credential, **When** it is reused, **Then** its renewal family is revoked and no further renewal is allowed; already issued access remains valid until expiry.
6. **Given** concurrent renewals using the same credential, **When** processed, **Then** at most one consumes it successfully; subsequent reuse follows the same renewal-family revocation rule.

---

### User Story 4 - Log Out and Prevent Further Renewal (Priority: P2)

As a user, I want logout to prevent further renewal for this login while my client clears its stored credentials.

**Why this priority**: Long-lived access needs deliberate termination and predictable failure behavior.

**Independent Test**: Create two independent logins, log out of one, and verify its renewal is denied while its issued access expires naturally and the other login remains usable; simulate failures and attempt-limit exhaustion separately.

**Acceptance Scenarios**:

1. **Given** valid access or renewal identifying a login's renewal family, **When** logout succeeds, **Then** further renewal for that family is denied and the client can clear its credentials; already issued access remains valid until its signed expiry.
2. **Given** two independent logins for one user, **When** one expires, is logged out, or has renewal revoked for reuse, **Then** the other login remains usable.
3. **Given** an already revoked renewal family or unknown credential, **When** logout is requested, **Then** the same generic signed-out confirmation is returned without changing other families.
4. **Given** authentication persistence is temporarily unavailable, **When** login, renewal, or logout needs it, **Then** a sanitized temporary-unavailable result is returned and incomplete state changes are never reported as successful; access authentication itself still verifies valid JWTs without consulting storage.
5. **Given** 10 login attempts or 10 renewal attempts from one trusted client IP within 60 seconds, **When** another attempt of that operation occurs in the window, **Then** it is rate-limited with retry timing and issues no credentials; attempts resume after the window expires.

### Edge Cases

- Access is invalid at exactly its expiry; renewal is invalid at exactly the renewal deadline. One hour is 3,600 seconds and 30 days is 2,592,000 elapsed seconds, independent of calendar dates.
- Renewal just before the renewal deadline grants only the remaining renewal lifetime. Activity and renewal never restart the 30-day period; a fresh login creates an independent renewal family and deadline.
- A lost renewal response can leave the client holding a consumed credential. Retrying it revokes renewal for that family and requires login; no duplicate-renewal grace period is assumed.
- Login cannot create accounts, restore deleted users, attach identities, or invent passwords for retained users without credentials.
- Rejected requests may update security audit records or attempt counters but cause no protected business side effects.
- A valid logout credential identifies only its own renewal family. Missing logout credentials receive an authentication-required result; unknown credentials receive the generic signed-out confirmation.
- Unexpected internal failures return sanitized internal-error results and never bypass verification. Failed renewal leaves no usable partial credential pair.
- Registration keeps its existing behavior, including its own attempt limit and no automatic login after registration.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support local-provider email/password login for active users and identities, normalize emails consistently with registration, and preserve passwords exactly as submitted.
- **FR-002**: Login MUST require valid text provider, email, and password fields, reject unsupported fields/providers, and identify invalid fields without echoing secrets. It MUST NOT impose new password-complexity rules on existing credentials.
- **FR-003**: Unknown accounts, wrong passwords, missing local password credentials, and deleted/inactive users or identities MUST produce the same generic authentication-failed result without revealing account existence or retaining renewal credentials.
- **FR-004**: Successful login MUST create an independent renewal family and return the verified user's identifier and safe profile information, separate access and renewal credentials, and expiration times. Initial access MUST expire 3,600 seconds after issuance; initial and replacement renewal credentials MUST share a fixed deadline 2,592,000 seconds after login.
- **FR-005**: Business routes MUST require authentication by default, including existing user-list and user-detail operations. Explicit public exemptions in this increment MUST be limited to registration, login, and existing health checks. Renewal and logout MUST perform their own credential checks.
- **FR-006**: Guarded operations MUST verify the access signature, issuer, audience, purpose, claims and expiry before protected behavior executes, without querying a server-session record, renewal storage, or live user/identity state. They MUST receive the verified identity and MUST NOT trust caller-supplied identity claims as authentication.
- **FR-007**: Missing, invalid, expired, or wrong-purpose access credentials MUST produce an authentication-required result without protected data or business side effects. Logout, renewal revocation and account deletion MUST NOT invalidate already issued access before its signed expiry. Authentication MUST NOT grant elevated privileges or override existing business permission checks.
- **FR-008**: Valid renewal credentials MUST allow renewal without a password, including after access expiry. Renewed access MUST expire at the earlier of 3,600 seconds after issuance or the original renewal deadline. Renewal and activity MUST NOT extend that deadline.
- **FR-009**: Renewal MUST atomically consume the current credential and issue a replacement tied to the same fixed renewal deadline and family. At most one concurrent attempt may consume a credential. Detected reuse of a known consumed credential MUST revoke further renewal for that family; issued access remains valid until expiry.
- **FR-010**: At or after the renewal deadline, after renewal-family revocation, or after user/identity deletion or deactivation, renewal MUST be denied. A fresh successful login MUST be required for new credentials after expiry or revocation. Deleted/inactive accounts cannot log in. Access issued earlier remains governed only by its signed expiry.
- **FR-011**: Logout MUST accept valid access or renewal identifying the current renewal family and revoke further renewal for that family before confirming success. Already issued access MUST expire naturally; clients clear retained credentials on logout. Repeated logout or unknown credentials MUST receive a generic signed-out confirmation without affecting unrelated families; missing credentials MUST be rejected.
- **FR-012**: Separate logins MUST create independent renewal families. Expiry, logout, or renewal-reuse revocation of one MUST NOT affect another login for the same user.
- **FR-013**: Passwords, stored credential representations, and complete access/renewal credentials MUST NOT appear in logs, errors, or public user data. Issued credentials MUST be disclosed only to the requesting client in successful login/renewal results and accepted only over confidential transport. Retained renewal secrets MUST not be recoverable from their stored representation.
- **FR-014**: Login and renewal MUST each allow at most 10 attempts per 60-second window per trusted client IP, counting successful and failed attempts independently per operation. Further attempts MUST receive retry timing and issue no credentials. Registration limits and ordinary guarded requests MUST remain unaffected by these authentication-attempt limits.
- **FR-015**: Unavailable persistence required for login, renewal or logout MUST return a sanitized temporary-unavailable result. Access authentication MUST perform no storage lookup. Invalid access verification MUST fail closed; unexpected failures MUST return sanitized internal-error results. Failed login or renewal MUST disclose no usable partial credentials; failed logout MUST NOT claim successful renewal revocation.
- **FR-016**: Login, renewal, logout, and authentication-denial outcomes MUST be recorded with occurrence time and a request correlation reference, excluding secrets and submitted passwords. Public failures MUST exclude internal diagnostics.
- **FR-017**: This increment MUST support login, guarded requests, renewal, and logout for consumer-facing native mobile applications. Authentication MUST NOT grant administrative privileges. Admin-only operations and role-based access enforcement are deferred to a separate feature before the admin portal launches.

### Key Entities *(include if feature involves data)*

- **User**: Existing application identity with unique identifier, normalized email, safe profile information, and lifecycle state; can have multiple independent logins.
- **Local Identity**: Existing provider identity linked to a user, containing protected password credentials and lifecycle state.
- **Renewal Family**: Related stored renewal credentials descended from one login, sharing a fixed 30-day deadline and revocation boundary. This is renewal-only tracking, with no separate server-session entity or access-time state lookup.
- **Access Credential**: Signed proof of identity accepted without storage lookup until its expiry, no more than one hour after issuance and no later than the original renewal deadline.
- **Renewal Credential**: Secret bound to a renewal family and fixed deadline, with current, consumed, expired or revoked state; replaced on renewal and retained for reuse detection.
- **Authentication Outcome**: Safe success information or a validation, authentication-failed, authentication-required, rate-limit, temporary-unavailable, or internal-error result.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid active-account login tests within the attempt limit identify the correct user and issue credentials with the specified deadlines; all invalid-login cases retain no renewal credentials and disclose no account-existence distinction.
- **SC-002**: 100% of guarded rejection tests disclose no protected data and execute zero protected business actions, covering missing, tampered, expired, and wrong-purpose credentials. Tests include current user-list/user-detail reads and one representative guarded action; access validation makes zero persistence calls.
- **SC-003**: Controlled-time tests pass immediately before and at the 3,600-second access and 2,592,000-second renewal boundaries. Every renewal preserves the original renewal deadline and caps renewed access at that deadline.
- **SC-004**: Every successful renewal invalidates the submitted renewal credential; concurrent same-credential attempts yield at most one successful consumption. Every detected consumed-credential reuse prevents subsequent renewal for that family while outstanding access remains valid until expiry.
- **SC-005**: All logout tests deny subsequent renewal for the affected family, preserve outstanding access until its expiry, and leave separate logins usable. User/identity deletion tests deny login and renewal while outstanding access remains accepted until expiry.
- **SC-006**: Login/renewal/logout persistence-failure tests report no incomplete state change as successful and disclose no usable partial credentials. With authentication storage unavailable, valid access still passes authentication without a persistence call; malformed/expired access fails. Response/log inspections expose zero passwords, stored credential representations, or complete credentials outside successful credential-issuance responses.
- **SC-007**: At least 95% of valid login and renewal attempts finish within two seconds under 20 simultaneous attempts from distinct trusted client IPs, with dependencies available and callers within attempt limits.
- **SC-008**: For each of login and renewal, the 11th attempt from one trusted client IP within 60 seconds is rate-limited with retry timing; the other operation's allowance and ordinary guarded requests remain unaffected, and attempts resume after expiry of the window.
- **SC-009**: All registration, login, and public-health exemption tests remain accessible without access credentials; an unexempted business route rejects unauthenticated access by default. Outcome-recording tests cover login, renewal, logout, and denials without exposing secrets. Login, guarded access, renewal, and logout acceptance scenarios MUST pass for consumer mobile clients; no administrative privileges or admin-only operations are introduced by this increment.

## Assumptions

- The requested one-hour session and 30-day access mean one-hour access credentials renewable within an absolute 30-day renewal period from login. Every successful login grants long-lived renewal; optional remember-me selection and sliding expiry are outside scope.
- Local login builds on `002-user-registration`. Social login, account linking, multifactor authentication, password recovery/change, email verification, and login screens are outside this increment.
- Route protection establishes identity. New role hierarchies and resource-ownership policies are separate features. Any active authenticated user may reach current user-list/user-detail operations subject to their existing business rules.
- Logout revokes renewal for the current login only; it does not revoke issued access. Device management, login/device-list screens, and logout-everywhere are outside scope. Multiple independent logins are supported without a new product-level cap.
- Fixed expiry, stateless access with expiry-based termination, renewal replacement/reuse detection, default route protection, and attempt limits are explicit specification defaults for review. Credential format, client delivery/storage, and transport contracts remain planning decisions.
- The auth domain owns login, renewal lifecycle, credential verification, and authentication enforcement. The user domain retains user-record/lifecycle ownership. Request intake owns validation and result formatting; authentication use cases own credential/renewal rules; persistence access owns stored identity/renewal state. Planning must preserve these responsibilities and verify interactions across domains.
- Planning must assess durable renewal-state additions and migration impact while preserving existing users, identities, and business data. Retained users without local passwords need a separate future credential-enrollment process.
- Current supported clients are consumer-facing native mobile applications. A future separate browser-based admin portal is intended to reuse the authentication service; its browser credential handling, role-based access, and admin-only operations are outside this increment and must be specified before portal launch. A separate portal URL does not establish an authorization boundary. Clients can retain credentials and request renewal. Backend enforcement/issuance is in scope; automatic client retry, client storage implementation, and application navigation are outside scope. Dependency outages never bypass cryptographic verification; access authentication does not require persistence availability.
