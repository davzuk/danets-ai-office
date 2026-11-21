-- Add the new quota columns declared in the SubscriptionPlan schema.
-- These are additive, default-populated, and do not affect any existing
-- data. We avoid `prisma db push` because it would also try to add a
-- unique constraint on Session.csrfToken, which is unrelated and
-- potentially destructive.

ALTER TABLE SubscriptionPlan
  ADD COLUMN ticketLimit           INT NOT NULL DEFAULT 100,
  ADD COLUMN documentLimit         INT NOT NULL DEFAULT 25,
  ADD COLUMN automationLimit       INT NOT NULL DEFAULT 5,
  ADD COLUMN seatLimit             INT NOT NULL DEFAULT 3,
  ADD COLUMN whatsappTemplateLimit INT NOT NULL DEFAULT 5,
  ADD COLUMN integrationLimit      INT NOT NULL DEFAULT 3,
  ADD COLUMN proposalTemplateLimit INT NOT NULL DEFAULT 10,
  ADD COLUMN quoteLimit            INT NOT NULL DEFAULT 50;

-- Backfill any existing rows to the same defaults (ADD COLUMN with
-- DEFAULT already populates, but be explicit for clarity in audit logs).
UPDATE SubscriptionPlan
SET
  ticketLimit = 100,
  documentLimit = 25,
  automationLimit = 5,
  seatLimit = 3,
  whatsappTemplateLimit = 5,
  integrationLimit = 3,
  proposalTemplateLimit = 10,
  quoteLimit = 50
WHERE 1 = 1;

-- BusinessLimitOverride: nullable overrides, so ADD COLUMN without
-- a NOT NULL is safe on existing rows.
ALTER TABLE BusinessLimitOverride
  ADD COLUMN ticketLimit           INT NULL,
  ADD COLUMN documentLimit         INT NULL,
  ADD COLUMN automationLimit       INT NULL,
  ADD COLUMN seatLimit             INT NULL,
  ADD COLUMN whatsappTemplateLimit INT NULL,
  ADD COLUMN integrationLimit      INT NULL,
  ADD COLUMN proposalTemplateLimit INT NULL,
  ADD COLUMN quoteLimit            INT NULL;
