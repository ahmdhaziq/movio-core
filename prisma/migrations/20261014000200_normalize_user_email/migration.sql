BEGIN;
LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" GROUP BY lower(btrim("email")) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Normalized user email conflicts exist; resolve retained duplicates before retrying migration';
  END IF;
END $$;
UPDATE "User" SET "email" = lower(btrim("email"));
CREATE UNIQUE INDEX "User_email_normalized_key" ON "User"(lower(btrim("email")));
COMMIT;
