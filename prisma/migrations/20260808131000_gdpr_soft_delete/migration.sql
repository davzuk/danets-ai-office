-- Soft-delete support for GDPR delete.
--
-- Adds deletedAt + purgeScheduledAt to Business. The route at
-- /api/gdpr/delete flips status="deleted" and stamps deletedAt instead of
-- removing the row immediately. A retention cron (`purgeDeletedBusinesses`)
-- runs daily and physically deletes rows where purgeScheduledAt has passed.
--
-- This gives customers a 7-day cooling-off window during which support can
-- still recover the tenant by clearing deletedAt.

ALTER TABLE `Business`
  ADD COLUMN `deletedAt`         DATETIME(3) NULL,
  ADD COLUMN `purgeScheduledAt`  DATETIME(3) NULL;

-- The status column already accepts arbitrary strings, so we extend its
-- vocabulary to include "deleted" — no schema change needed for that.

-- Composite index for the purge cron: find rows that are due for purge.
CREATE INDEX `Business_purgeScheduledAt_idx` ON `Business`(`purgeScheduledAt`);