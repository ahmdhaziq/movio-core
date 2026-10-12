# Feature Specification: User Management

**Feature Branch**: `001-user-management`

**Created**: 2026-10-07

**Status**: Draft

**Input**: Build the core user module: data model, validated DTOs, repository/service layers,
public profile/list reads, update support, and soft deletion. Auth, credentials, registration HTTP,
identity ownership, and guards are separate future work.

## Clarifications

### Session 2026-10-07

- Q: How must an account deletion affect stored account data? → A: Use soft deletion.
- Q: Which user-information views are in scope? → A: User profile, user list, and user details.
- Q: How does the module expose user creation? → A: It exposes an internal service method; the
  future auth module owns the registration endpoint.
- Q: How are profiles protected before auth exists? → A: `GET /user/:id` is public and returns
  public fields only; authenticated own-profile behavior is deferred.
- Q: What are pagination defaults and bounds? → A: `page` defaults to 1, `perPage` defaults to 10,
  and `perPage` is at most 50.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register an Account (Priority: P1)

As a future registration flow, I need a reusable user-creation capability so that the auth module
can create a recognized user later.

**Why this priority**: Registration creates the identity required for every later user capability.

**Independent Test**: A caller can invoke validated user creation and receive a stored user, while
a duplicate email is rejected without creating a second record.

**Acceptance Scenarios**:

1. **Given** a new valid name and email, **When** the future auth flow calls user creation,
   **Then** the system creates one user record.
2. **Given** an account already uses an email address, **When** a person attempts to register with
   that address, **Then** the system rejects the request and explains that the email is unavailable.
3. **Given** a person submits missing or invalid required details, **When** they register, **Then**
   the system does not create an account and identifies the invalid fields.

---

### User Story 2 - View User Information (Priority: P2)

As an API consumer, I want to browse active users and view an active user's public details so that
I can identify participants before authentication is added.

**Why this priority**: User information is needed to recognize oneself and other participants
before fitness-challenge interactions are added.

**Independent Test**: A caller can retrieve an active public profile by ID and browse active users;
deleted users and email are never shown.

**Acceptance Scenarios**:

1. **Given** an active user, **When** a caller requests `GET /user/:id`, **Then** the system returns
   that user's public profile.
2. **Given** active users exist, **When** a registered user requests the user list, **Then** the
   system returns a navigable, bounded set of active users with their public profile information.
3. **Given** an active user exists, **When** a registered user views that user's details, **Then**
   the system returns the user's public profile information without exposing email or sign-in
   details.
4. **Given** a user has been deleted, **When** a registered user requests the list or that user's
   details, **Then** the system does not expose the deleted user as an active profile.

---

### User Story 3 - Update My Details (Priority: P3)

As a future authenticated flow, I need a validated user update capability so that account details
can remain accurate once identity handling exists.

**Why this priority**: Accurate details let users retain a usable identity after registration.

**Independent Test**: A registered user changes one or more allowed profile details and can see the
updated information; invalid or conflicting changes leave the prior details unchanged.

**Acceptance Scenarios**:

1. **Given** a registered user, **When** they submit valid changes to allowed details, **Then** the
   system saves and returns their updated details.
2. **Given** a registered user, **When** they change their email to one already used by another
   account, **Then** the system rejects the change and preserves their existing email.
3. **Given** a registered user, **When** they submit invalid details, **Then** the system rejects
   the change and preserves their previously saved details.

---

### User Story 4 - Delete My Account (Priority: P4)

As a future authenticated flow, I need a soft-delete capability so that an account can become
unavailable while its record is retained.

**Why this priority**: Users need control over whether their account remains in the application.

**Independent Test**: Deleting an existing active ID marks it deleted; it cannot be updated or
listed afterward, and an absent/deleted ID returns not found.

**Acceptance Scenarios**:

1. **Given** an active user ID, **When** deletion is invoked, **Then** the service first verifies
   the active user exists, marks it deleted, and prevents subsequent active use.
3. **Given** an account has already been deleted, **When** a deletion is requested again, **Then**
   the system reports that no active account exists and does not fail unexpectedly.

### Edge Cases

- Registration requests that repeat after a successful submission create no duplicate account.
- Updating only a subset of allowed details preserves all omitted details.
- Simultaneous attempts to claim the same email result in at most one account using that email.
- Deleted accounts are excluded from active-account operations and cannot be updated or restored
  through this feature.
- User lists and public user-detail views exclude deleted accounts.
- A request for user details that does not identify an active user returns a clear unavailable result
  without revealing whether a deleted account previously existed.
- An account deletion request cannot delete a different user's account.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The user module MUST create a user through an internal service using a unique email
  and name; credentials and the registration endpoint are out of scope.
- **FR-002**: The system MUST validate required registration and update details and identify fields
  that are missing, malformed, or invalid.
- **FR-003**: The system MUST prevent more than one active account from using the same email.
- **FR-004**: The system MUST publicly return an active user's public profile by identifier;
  own-profile behavior and email exposure are deferred to auth.
- **FR-005**: The system MUST allow a registered user to update their own allowed account details,
  including name and email.
- **FR-006**: The user module MUST provide validated update behavior; caller ownership enforcement
  is deferred until authentication exists.
- **FR-007**: The delete service MUST first verify that an active user exists; confirmation and
  caller authorization are deferred until authentication exists.
- **FR-008**: The system MUST retain a deleted account as a deleted record rather than permanently
  removing it, and MUST prevent the deleted account from being used for later account updates.
- **FR-009**: The system MUST provide a clear success or failure result for registration, update,
  deletion, and viewing requests without exposing another user's non-public account details.
- **FR-010**: The system MUST retain the previous account details if an update cannot be completed.
- **FR-011**: The system MUST allow a registered user to browse a navigable, bounded list of active
  users with each user's public profile information.
- **FR-012**: The system MUST expose a public endpoint for an active user's public profile by ID.
- **FR-013**: The system MUST exclude deleted accounts from user lists and public user-detail views.
- **FR-014**: The system MUST never expose email addresses or sign-in details in another user's
  public profile, user list entry, or user-detail view.

### Key Entities *(include if feature involves data)*

- **User Account**: A person's application identity, containing a unique email, name, lifecycle
  state, creation/update timestamps, and a deletion timestamp when deleted. Credentials are auth-owned.
- **Public User Profile**: The non-sensitive information about an active user available to other
  registered users: the user's identifier, name, and account creation date.
- **Registration Details**: The information a prospective user provides to create an account.
- **Account Update**: A validated change to permitted user-account details initiated by that user.
- **Deletion Request**: An internal request to soft-delete an active user; future auth owns caller
  authorization and confirmation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of tested valid internal create calls persist a user without requiring credentials.
- **SC-002**: 100% of tested attempts to register or change to an email already held by an active
  account are rejected without creating duplicate active accounts.
- **SC-003**: 100% of tested valid update calls preserve omitted fields and persist supplied fields.
- **SC-004**: 100% of tested delete calls for an active ID mark it unavailable for later updates.
- **SC-005**: Ownership tests are deferred until auth and guards are implemented.
- **SC-006**: 100% of acceptance tests verify that public user lists and user-detail views include
  only active users and never expose another user's email or sign-in details.
- **SC-007**: At least 95% of registered users can find an active user's public details through the
  user list or a direct user-detail view in under one minute.

## Assumptions

- This first user-module increment provides reusable user-domain behavior; auth registration,
  credentials, roles, guards, and identity ownership are out of scope.
- The application has an existing or forthcoming identity-verification mechanism that identifies
  the requesting registered user for viewing, update, and deletion actions.
- Any caller may browse active users and view an active user's public profile. A
  public profile contains only the user's identifier, name, and account creation date;
  email and sign-in details remain private.
- Email and name are the only editable personal details in this increment; password change,
  email verification, sign-in, password recovery, and social sign-in are out of scope.
- Account deletion is a soft deletion: the account remains retained as deleted and unavailable to
  the user. Any retention obligations for challenge records or audit data will be defined by a
  future feature or policy.
- Registration is available to people who meet the product's applicable age and eligibility rules;
  eligibility verification is out of scope for this increment.
