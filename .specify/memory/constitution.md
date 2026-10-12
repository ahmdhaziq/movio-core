<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.1.0
- Modified principles: V. Module-Scoped Verification (expanded test ownership and placement)
- Added sections: none
- Removed sections: none
- Follow-up TODOs: none
-->

# Movio Core Constitution

## Core Principles

### I. Module-First Domain Boundaries
The system MUST organize backend code by business domain. Each module owns its controllers,
services, repositories, DTOs, entities or models, tests, and module-specific supporting code.
Code for one domain MUST NOT be placed in a cross-cutting layer merely for organizational
convenience. Shared code is permitted only when it has a stable, domain-neutral purpose.

Rationale: Domain-local ownership keeps fitness challenge capabilities independently understandable
and prevents unrelated features from becoming tightly coupled.

### II. Clear Application Layering
Modules MUST use a Controller -> Service -> Repository flow when they expose HTTP-backed
application behavior. Controllers MUST handle transport concerns, services MUST own use-case and
business logic, and repositories MUST own persistence access. A module may use a different
structure only when its technical purpose makes this flow inapplicable; the exception and its
boundary MUST be explicit in the module's design or review record.

Rationale: Explicit responsibility boundaries make behavior testable and keep HTTP and database
details out of business rules.

### III. NestJS Is the Backend Framework
Production backend code MUST be implemented with NestJS. Modules MUST declare their dependencies
through NestJS module boundaries and use dependency injection rather than constructing
infrastructure dependencies directly in application code.

Rationale: Consistent framework conventions provide predictable composition, lifecycle handling,
and test seams throughout the backend.

### IV. PostgreSQL and Prisma Are the Persistence Standard
Persistent application data MUST reside in PostgreSQL and MUST be accessed through Prisma in the
NestJS application. Database schema changes MUST be represented by reviewed Prisma migrations.
Repositories MUST be the default boundary for Prisma calls; direct Prisma use outside a repository
requires the same documented exception standard as other layering deviations.

Rationale: One database and access pattern preserve data integrity, migration traceability, and
consistent query behavior.

### V. Module-Scoped Verification
Every behavior change MUST include tests at the layer that owns the behavior. Services MUST have
unit tests for business rules; controllers and repositories MUST have integration or contract tests
when their transport or persistence behavior changes. Changes that cross module boundaries MUST
verify the affected interaction end to end. All unit, integration, and contract tests that belong
to a domain module MUST be colocated with that module's source directory. Only end-to-end tests,
which compose the full application across module boundaries, MUST live in the top-level `test/`
directory.

Rationale: The module boundary is the unit of ownership, so it is also the unit of reliable
verification. Colocation makes the owner and scope of each non-E2E test unambiguous, while a
dedicated E2E directory distinguishes full-application verification from module-local tests.

## Architecture & Technology Constraints

Feature work MUST begin by identifying its owning domain module. New modules MUST use a dedicated
folder and expose only intentional public contracts to other modules. Circular module dependencies
are prohibited. Controllers MUST NOT contain business logic or issue database queries. Services
MUST NOT depend on HTTP request or response objects. Repositories MUST NOT encode presentation or
transport rules. A top-level `test/` directory MUST contain end-to-end tests only; module-local
tests MUST NOT be moved there for organizational convenience.

The PostgreSQL schema, Prisma schema, and Prisma migrations are authoritative persistence
artifacts. Any schema change MUST preserve data through an explicit migration strategy and MUST
consider existing challenge, participant, and activity data before deployment.

## Development & Quality Workflow

Specifications and implementation plans MUST name the affected module, describe changes to
controller, service, and repository responsibilities, and identify Prisma migration impact where
applicable. Code review MUST verify module boundaries, dependency direction, data-access placement,
and relevant automated tests. Deviations from the prescribed layering MUST be recorded with the
reason, scope, and test strategy before merge.

## Governance
This constitution supersedes conflicting development practices for Movio Core. Amendments MUST be
documented in this file, reviewed with their implementation impact, and assigned a semantic version:
MAJOR for removed or incompatible governance, MINOR for new or materially expanded requirements,
and PATCH for clarifications that do not change obligations. Every specification, plan, task list,
and code review MUST assess compliance with these principles. Approved exceptions MUST be narrow,
documented, and re-evaluated when the affected module changes.

**Version**: 1.1.0 | **Ratified**: 2026-10-07 | **Last Amended**: 2026-10-12
