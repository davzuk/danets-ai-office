-- Add Session.csrfToken column + unique index.
-- The schema declares it as @unique and ensureCsrfForSession() issues
-- db.session.update({ data: { csrfToken } }) on every authenticated
-- state-changing request. Without this column, those writes throw P2022
-- and the API returns 401 with CSRF_INVALID.
--
-- The column is nullable so existing sessions continue to work; the
-- ensureCsrfForSession helper lazily backfills the token on the next
-- authenticated request.

ALTER TABLE `Session`
  ADD COLUMN `csrfToken` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Session_csrfToken_key` ON `Session`(`csrfToken`);
