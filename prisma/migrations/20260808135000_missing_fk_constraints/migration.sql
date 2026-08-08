-- ─── Missing foreign-key constraints ───────────────────────────────
-- The original schema and several follow-up migrations added logical
-- FKs in Prisma but did not emit MySQL-level FOREIGN KEY clauses for
-- every column. Orphan rows can therefore accumulate (e.g. a
-- BusinessUser is deleted but their Notifications stay around, or a
-- Business is deleted but its LoginAttempts linger forever).
--
-- This migration adds the missing DB-level FKs with explicit
-- ON DELETE behaviour. It is additive and idempotent at the schema
-- level: re-running prisma migrate diff against a freshly-bootstrapped
-- DB should produce no further FK additions.
--
-- All actions:
--   - Notification.userId           → BusinessUser.id   ON DELETE SET NULL
--   - ActivityLog.userId            → BusinessUser.id   ON DELETE SET NULL
--   - LoginAttempt.businessId       → Business.id       ON DELETE SET NULL
--   - PasswordResetToken.userId     → BusinessUser.id   ON DELETE CASCADE
--   - PasswordResetToken.businessId → Business.id       ON DELETE CASCADE
--   - SupportTicketNote.businessId  → Business.id       ON DELETE CASCADE
--   - PlatformFeatureFlagOverride.businessId → Business.id ON DELETE CASCADE
--   - PlatformFeatureFlagOverride.flagKey    → PlatformFeatureFlag.key ON DELETE CASCADE

-- ─── Add the missing constraints ───────────────────────────────────

-- Notification.userId → BusinessUser.id. If the targeted user is
-- deleted we keep the notification (null out the userId) so the audit
-- trail is preserved.
ALTER TABLE `Notification`
  ADD CONSTRAINT `Notification_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `BusinessUser`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ActivityLog.userId → BusinessUser.id. Same rationale as Notification —
-- keep the historical record, drop the link.
ALTER TABLE `ActivityLog`
  ADD CONSTRAINT `ActivityLog_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `BusinessUser`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- LoginAttempt.businessId → Business.id. The IP / email audit log
-- outlives the tenant — keep the row, drop the FK.
ALTER TABLE `LoginAttempt`
  ADD CONSTRAINT `LoginAttempt_businessId_fkey`
  FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Password reset tokens cascade with the user / tenant they belong to.
ALTER TABLE `PasswordResetToken`
  ADD CONSTRAINT `PasswordResetToken_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `BusinessUser`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PasswordResetToken`
  ADD CONSTRAINT `PasswordResetToken_businessId_fkey`
  FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SupportTicketNote.businessId was indexed but had no FK. Cascade with
-- the tenant so notes don't leak across the GDPR purge window.
ALTER TABLE `SupportTicketNote`
  ADD CONSTRAINT `SupportTicketNote_businessId_fkey`
  FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- PlatformFeatureFlagOverride was added without FKs on either side.
ALTER TABLE `PlatformFeatureFlagOverride`
  ADD CONSTRAINT `PlatformFeatureFlagOverride_businessId_fkey`
  FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PlatformFeatureFlagOverride`
  ADD CONSTRAINT `PlatformFeatureFlagOverride_flagKey_fkey`
  FOREIGN KEY (`flagKey`) REFERENCES `PlatformFeatureFlag`(`key`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Add a few missing lookup indexes ─────────────────────────────
-- CmsContactSubmission only had a `createdAt` index — lookups by
-- email (for the dedupe window) and by linked leadId (for "show me
-- submissions that turned into leads") were both full table scans.
CREATE INDEX `CmsContactSubmission_email_idx` ON `CmsContactSubmission`(`email`);
CREATE INDEX `CmsContactSubmission_leadId_idx` ON `CmsContactSubmission`(`leadId`);

-- PasswordResetToken is queried by tokenHash (single-use claim path)
-- and by userId (admin "see outstanding tokens for this user" view).
-- Only tokenHash was indexed in P15; add userId so the per-user view
-- stays sub-millisecond at 10k+ tokens.
CREATE INDEX `PasswordResetToken_userId_idx` ON `PasswordResetToken`(`userId`);
