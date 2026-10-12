# User API Contract — First Increment

Base path: `/user`. Requests and responses use JSON.

## Deferred registration contract

`UserService.create(CreateUserDto)` is an internal application contract in this increment. It
checks `getUser({ email })`, rejects an existing email with `ConflictException`, then calls the
repository; the database unique constraint remains the concurrency-safe final guard. A future auth
module owns the external registration endpoint and its request/response contract. Therefore,
`POST /user/create` does not exist.

## `GET /user/:id`

Publicly returns one active user's public profile while authentication is unavailable. It does not
identify the caller as the profile owner and never exposes email.

Example success response (`200`):

```json
{ "id": 11, "name": "Ada Lovelace", "created_at": "2026-10-12T03:00:00.000Z" }
```

`404` is returned for an absent or soft-deleted ID.

## `GET /user/list?page={page}&perPage={perPage}`

Returns active users only, using public-profile fields (`id`, `name`, `created_at`); email is not exposed in the list. No arbitrary filter or search parameter exists yet.

| Parameter | Type | Required | Rules |
|---|---|---:|---|
| `page` | integer | No | Positive, one-based page number; defaults to `1`. |
| `perPage` | integer | No | Positive size; defaults to `10`, maximum `50`. |

Example request: `GET /user/list?page=2&perPage=10`

The service calculates `skip = (page - 1) * perPage`. The repository receives `(skip, perPage)` and queries with `deleted_at: null`.

```json
[
  {
    "id": 11,
    "name": "Ada Lovelace",
    "created_at": "2026-10-12T03:00:00.000Z"
  }
]
```

| Status | Meaning |
|---:|---|
| 200 | The requested page contains active users. |
| 400 | Pagination input is invalid or exceeds its bound. |
| 404 | No active user falls within the requested page, including an empty active-user set. |

## Non-HTTP application contracts

| Service method | Repository call | Result |
|---|---|---|
| `update(id, query: UpdateUserDto)` | `update(id, query)` | Updated user, or `NotFoundException` for no matched row. |
| `delete(id)` | `softDelete(id)` | Sets `deleted_at` to now, or `NotFoundException` for no active matched row. |
