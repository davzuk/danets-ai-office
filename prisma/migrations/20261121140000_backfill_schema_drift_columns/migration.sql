-- Columns that exist in schema.prisma but were never added by a migration
-- (they reached local databases via `prisma db push`, or not at all).
-- Without them, login fails: /api/auth/login selects
-- BusinessUser.totpBackupCodes.
--
-- If a database already has these columns (from db push), mark this
-- migration as applied instead of running it:
--   npx prisma migrate resolve --applied 20261121140000_backfill_schema_drift_columns

-- Tenant-wide 2FA policy (super-admin toggle).
ALTER TABLE `Business`
  ADD COLUMN `enforce2fa` BOOLEAN NOT NULL DEFAULT false;

-- SHA-256 hashes of one-time TOTP backup codes.
ALTER TABLE `BusinessUser`
  ADD COLUMN `totpBackupCodes` JSON NULL;

-- Scheduled plan downgrades (plan-transitions helper / retention cron).
ALTER TABLE `BusinessSubscription`
  ADD COLUMN `downgradeScheduledFor` DATETIME(3) NULL,
  ADD COLUMN `downgradeTargetPlan` VARCHAR(191) NULL,
  ADD COLUMN `metadata` JSON NULL;
