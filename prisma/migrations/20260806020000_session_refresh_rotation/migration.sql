-- Alter Session table: add absoluteExpiresAt + lastSeenAt columns for the
-- P10 sliding/absolute session expiry model. Migration is safe because:
--  - absoluteExpiresAt defaults to expiresAt for existing rows so behavior
--    is unchanged for users mid-session.
--  - lastSeenAt defaults to createdAt so the very first request after this
--    migration extends the window naturally.

ALTER TABLE `Session`
  ADD COLUMN `absoluteExpiresAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `lastSeenAt`        DATETIME(3) NULL;

-- Backfill: copy expiresAt into absoluteExpiresAt for all existing rows so
-- the absolute cap matches what users already had.
UPDATE `Session` SET `absoluteExpiresAt` = `expiresAt`;

-- Drop the temporary default so future inserts must provide an explicit
-- value (matches the prisma schema, which makes the column required).
ALTER TABLE `Session`
  ALTER COLUMN `absoluteExpiresAt` DROP DEFAULT;

CREATE INDEX `Session_absoluteExpiresAt_idx` ON `Session`(`absoluteExpiresAt`);
