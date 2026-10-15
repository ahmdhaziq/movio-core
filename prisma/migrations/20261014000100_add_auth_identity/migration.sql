CREATE TABLE "auth_identity" (
  "id" SERIAL PRIMARY KEY,
  "identity_id" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "password_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "auth_identity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "auth_identity_nonempty" CHECK (length(btrim("provider")) > 0 AND length(btrim("identity_id")) > 0),
  CONSTRAINT "auth_identity_credentials" CHECK (
    ("provider" = 'local' AND "identity_id" = "user_id"::text AND "password_hash" IS NOT NULL
      AND "password_hash" ~ '^\$argon2id\$v=19\$m=[0-9]+,(t=[0-9]+,p=[0-9]+|p=[0-9]+,t=[0-9]+)\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$')
    OR ("provider" <> 'local' AND "password_hash" IS NULL)
  )
);
CREATE UNIQUE INDEX "auth_identity_provider_identity_id_key" ON "auth_identity"("provider", "identity_id");
CREATE UNIQUE INDEX "auth_identity_user_id_provider_key" ON "auth_identity"("user_id", "provider");
