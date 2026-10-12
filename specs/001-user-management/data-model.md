# Data Model: User Module Foundation

## Prisma entity: `User`

| Field | Prisma type / constraint | Required | Notes |
|---|---|---:|---|
| `id` | `Int @id @default(autoincrement())` | Yes | Primary key. |
| `name` | `String` | Yes | Maximum 100 characters at DTO boundary. |
| `email` | `String @unique` | Yes | Valid email; database uniqueness protects concurrent creates. |
| `created_at` | `DateTime @default(now())` | Yes | Creation timestamp. |
| `updated_at` | `DateTime @updatedAt` | Yes | Automatically changed by Prisma. |
| `deleted_at` | `DateTime?` | No | `null` is active; a timestamp is soft deleted. |

```prisma
model User {
  id         Int       @id @default(autoincrement())
  name       String
  email      String    @unique
  created_at DateTime  @default(now())
  updated_at DateTime  @updatedAt
  deleted_at DateTime?

  @@index([deleted_at])
}
```

## State transition

```text
active (deleted_at = null) --soft delete--> deleted (deleted_at = timestamp)
```

Deleted rows are retained. Active list queries require `deleted_at: null`; update/delete treat an unmatched ID as not found. Restoration and hard deletion are out of scope.

## DTO rules

| DTO | Fields | Rules |
|---|---|---|
| `CreateUserDto` | `name`, `email` | Required strings; `name` maximum 100 characters; `email` valid email. |
| `UpdateUserDto` | `name?`, `email?` | `PartialType(CreateUserDto)`; every supplied field follows its create rule; require at least one property. |
| `ListUsersQueryDto` | `page?`, `perPage?` | Transform to positive integers; defaults are page `1` and per-page `10`; `perPage` MUST NOT exceed `50`. |

Repository `update(id, query)` uses `id` in Prisma `where` and the DTO in `data`; arbitrary update fields never form the `where` clause.
