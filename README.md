<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

### Local PostgreSQL

Copy `.env.example` to `.env` to customize the local database settings. Compose also
works with the defaults without an `.env` file:

```bash
docker compose up -d --wait postgres
docker compose ps
```

PostgreSQL is available at `127.0.0.1:5432`. The default database/user is `movio`,
with local-development password `movio_local`. The matching Prisma `DATABASE_URL`
is provided in `.env.example`. Update that URL too if you change the credentials,
database name, or host port. These credentials are only for local development.

```bash
# Open a database shell
docker compose exec postgres psql -U movio -d movio

# Stop the database; its named volume is retained
docker compose down
```

The `postgres_data` volume persists data across container restarts. Initialization
credentials apply when the volume is first created; changing environment values
does not change an existing database's credentials.

```bash
$ npm install
npx prisma generate
npx prisma migrate deploy
```

Prisma reads `DATABASE_URL` from `.env`. Generate the client after installing
dependencies, then apply migrations before starting the API.

### User module

Guarded endpoints are `GET /user/list?page=1&perPage=10` (maximum `perPage=50`)
and `GET /user/:id`. They return only `id`, `name`, and `created_at` for active
users; an empty page or missing profile returns 404. Invalid parameters return 400.
Creation, partial updates, and soft deletion are internal `UserService` methods.
There is no user-module create, update, or delete HTTP endpoint. Registration is
provided by the auth module below. User reads require an access bearer token;
role and ownership authorization remain future work.

## Compile and run the project

```bash
# development
node --env-file=.env node_modules/@nestjs/cli/bin/nest.js start

# watch mode
node --env-file=.env node_modules/@nestjs/cli/bin/nest.js start --watch

# production mode
node --env-file=.env dist/main.js
```

## Run tests

```bash
# colocated unit/contract tests and PostgreSQL integration tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

Start PostgreSQL before running integration/E2E tests. They default to the local
Compose database; set `TEST_DATABASE_URL` if using different credentials or a
different host. Each suite creates a randomly named `test_...` schema, deploys the
real migrations there, and drops only that schema afterward. Existing application
tables are untouched. The test database role must be allowed to create/drop schemas.
Non-E2E tests are colocated with their modules; only E2E suites live in `test/`.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project:

```bash
$ npm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/overview) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

## Local user registration

`POST /auth/register` is public and accepts only these fields:

```json
{
  "provider": "local",
  "name": "Ada",
  "email": "ada@example.com",
  "password": "SyntheticPass9!"
}
```

Success is HTTP 201 with `{ "user": { "id": 1, "name": "Ada", "email": "ada@example.com" } }`.
No identity/hash is returned and no session, cookie, or sign-in token is created.
Only local is enabled; Google/Microsoft enum values reserve names for future work.

Name is trimmed, nonblank, and at most 100 characters. Email is trimmed/lowercased
and must be valid. Password is preserved exactly and requires 8–128 Unicode code
points, uppercase/lowercase letters, an ASCII digit, and a non-letter/non-number/
non-whitespace symbol. Unknown fields and missing/null/non-text required fields
are rejected. Validation runs at the controller pipe; AuthService and
UserService.create accept already validated input. Other internal callers must
validate at their entry boundary. UserService still enforces canonical email
normalization and uniqueness as business/data invariants.

The endpoint returns sanitized field errors (400), unavailable email/identity
(409), rate limiting (429 with Retry-After seconds), recognized temporary resource
or storage failure (503), or unexpected/configuration error (500). Existing emails
remain unavailable even for deleted users or users without a local identity;
registration does not link or restore accounts. See
[the endpoint contract](specs/002-user-registration/contracts/auth-registration.md)
and [failure classification](specs/002-user-registration/plan.md#failure-classification).

Before starting the API, run `npx prisma generate` and `npx prisma migrate deploy`
with your configured database URL. The reviewed migrations add auth_identity and
normalize retained emails. The normalization migration locks the User table and
aborts on case/whitespace collisions; resolve those deliberately and follow Prisma's
failed-migration recovery procedure before retrying. It never merges/deletes users
or invents credentials for retained accounts. Test upgrades against a backup before
applying to a populated deployment.

AuthService keeps register(), private resolveStrategy(), and private hashPassword()
in one file. AuthRepository.withTransaction() is a thin Prisma transaction wrapper:
UserService.create and LocalStrategy.register receive the same transaction client,
so a failed identity write rolls back the new user. Argon2id hashing runs before
the transaction, using 19456 KiB memory, two iterations, and parallelism one.

The endpoint allows ten attempts per rolling 60-second window per client IP,
including successful and rejected attempts. Other user routes are unaffected.
The limiter uses in-memory storage for one application instance. Configure shared
storage before deploying replicas. Forwarded IP headers are not trusted by default;
only configure Express trusted proxies for a known deployment proxy boundary.
Passwords, encoded hashes, emails, and request bodies are excluded from outcome logs.

Run `npm test` and `npm run test:e2e` with PostgreSQL available. Tests create and
remove isolated schemas; they never reset application tables. The registration
E2E suite checks rollback, duplicate races, credential confidentiality, limiter
expiry, and 20 concurrent registrations with real hashing and distinct test IPs.

## Authentication and guarded routes

Use Node 26+ (or a supported Node 24 LTS release at least 24.15), npm and PostgreSQL 17.
Copy `.env.example` to `.env` and set `AUTH_ACCESS_SECRET` and
`AUTH_REFRESH_SECRET` to **different** base64 keys. Generate each independently
with `openssl rand -base64 32`. Keys must decode to at least 32 bytes; missing,
malformed, short or identical keys prevent startup. Never commit `.env`.

```bash
npm ci
# After configuring .env:
docker compose up -d --wait postgres
npx prisma generate
npx prisma migrate deploy
npm run build
node --env-file=.env dist/main.js
```

If port 5432 is occupied, set `POSTGRES_PORT` and the port in `DATABASE_URL`
together. Tests can use `TEST_DATABASE_URL` for a separate PostgreSQL endpoint.
They create and remove isolated schemas and never reset application tables.

| Endpoint | Request | Behavior |
|---|---|---|
| `POST /auth/login` | `{ "provider": "local", "email": "ada@example.com", "password": "SyntheticPass9!" }` | 200 safe user plus access/refresh JWTs and UTC expiry times |
| `GET /user/list`, `GET /user/:id` | `Authorization: Bearer <access_token>` | Existing profile results; missing/invalid access returns 401 |
| `POST /auth/refresh` | `{ "refresh_token": "<current refresh token>" }` | 200 replacement pair with unchanged renewal deadline |
| `POST /auth/logout` | `{ "token_type": "access", "token": "<access token>" }` or refresh equivalent | 200 `{ "message": "Signed out" }` after family revocation |

Business routes require access authentication by default. Only registration,
login and the existing root health/greeting are public. Refresh and logout
validate body credentials themselves. Registration still returns only a user
and does not log in automatically. All auth responses use `Cache-Control: no-store`.

Access lasts one hour and is verified without database calls. Renewal ends at a
fixed deadline 30 elapsed days after login; activity never extends it. Renewal
near that deadline caps access to the remaining time. Logout, account deletion
and refresh reuse stop renewal; issued access remains valid until its signed
expiry. Separate logins have independent families. Existing business eligibility
checks still apply to authenticated callers.

Mobile clients should securely store credentials, replace both tokens on refresh,
**serialize refresh requests**, and clear stored credentials on logout. Do not
automatically retry refresh after a lost response: using a consumed token revokes
renewal for that login, including an already issued replacement. A fresh login
is then required. Send credentials over HTTPS in production, never in URLs.

Login and refresh each allow ten attempts per 60 seconds per trusted client IP,
counting validation failures and successes independently. Registration retains
its own limit; logout and ordinary guarded requests do not consume these buckets.
The limiter is in memory for one instance. Configure shared storage before
replicas. Forwarded IPs are not trusted by default; configure only known ingress
proxies at the deployment boundary. Outcome logs exclude emails, passwords,
tokens, digests and internal diagnostics, and include a request correlation ID
also returned as `X-Request-Id`.

The additive Prisma migration creates `refresh_token`, storing SHA-256 digests,
ownership and rotation history. Retain roots and consumed generations through the
fixed deadline. There is no cleanup job in this increment; a future purge must
remove descendants before roots. Apply reviewed migrations without resetting
existing users or identities.

Only local authentication is enabled. Adding a provider requires its own concrete
request DTO, matching provider-keyed request/credential map and registry entry,
and implemented strategy. Reserved enum values alone do not enable a provider.
Roles, admin operations, social login, password recovery and client UI are outside
this increment. See the [API contract](specs/003-user-auth/contracts/authentication-api.md),
[quickstart](specs/003-user-auth/quickstart.md) and
[validation evidence](specs/003-user-auth/validation.md).

```bash
npm run build
npm run lint
npm test
npm run test:e2e
```
