CREATE UNIQUE INDEX "auth_identity_id_user_id_key" ON "auth_identity"("id", "user_id");
CREATE TABLE "refresh_token" (
  "id" UUID NOT NULL,
  "user_id" INTEGER NOT NULL,
  "auth_identity_id" INTEGER NOT NULL,
  "root_token_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expired_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "refresh_token_auth_identity_id_user_id_fkey" FOREIGN KEY ("auth_identity_id", "user_id") REFERENCES "auth_identity"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "refresh_token_digest_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");
CREATE UNIQUE INDEX "refresh_token_id_user_id_auth_identity_id_key" ON "refresh_token"("id", "user_id", "auth_identity_id");
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_root_token_id_user_id_auth_identity_id_fkey" FOREIGN KEY ("root_token_id", "user_id", "auth_identity_id") REFERENCES "refresh_token"("id", "user_id", "auth_identity_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE UNIQUE INDEX "refresh_token_one_current_per_family" ON "refresh_token"("root_token_id") WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token"("user_id");
CREATE INDEX "refresh_token_auth_identity_id_idx" ON "refresh_token"("auth_identity_id");
CREATE INDEX "refresh_token_root_token_id_idx" ON "refresh_token"("root_token_id");
CREATE INDEX "refresh_token_expired_at_idx" ON "refresh_token"("expired_at");
