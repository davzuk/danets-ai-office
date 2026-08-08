-- ─── Lead dedupe by (businessId, email) ───────────────────────────
-- The audit flagged that two-tab same-email submissions create two
-- Lead rows because the table had no compound unique constraint.
-- This migration adds one.
--
-- MySQL allows multiple NULL values in a unique index, so anonymous
-- leads (no email collected) are unaffected — only leads with an
-- actual email are deduped. The index is also usable by the public
-- widget's pre-submit dedupe lookup.
--
-- First we delete any pre-existing duplicate (keep the oldest), then
-- add the constraint. We pick `MIN(id)` per (businessId, email) group
-- to keep the earliest lead, matching the product behaviour where
-- re-submissions update the existing record.
DELETE l1
FROM Lead l1
INNER JOIN Lead l2
  ON l1.businessId = l2.businessId
  AND l1.email IS NOT NULL
  AND l2.email IS NOT NULL
  AND l1.email = l2.email
  AND l1.id > l2.id;

-- Add the unique constraint. The name matches what Prisma generates
-- from the @@unique([businessId, email]) directive in schema.prisma.
ALTER TABLE Lead
  ADD CONSTRAINT Lead_businessId_email_key UNIQUE (businessId, email);
