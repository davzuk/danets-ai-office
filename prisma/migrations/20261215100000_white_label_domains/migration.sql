-- White-label custom domains (login/app on a tenant's own domain). A tenant
-- adds app.theircompany.com and proves ownership with a TXT record; the
-- white-label.verify-domains job checks every 10 minutes for 72 hours.

ALTER TABLE `WhiteLabelConfig`
  ADD COLUMN `domainStatus` VARCHAR(191) NOT NULL DEFAULT 'none',
  ADD COLUMN `domainToken` VARCHAR(64) NULL,
  ADD COLUMN `domainRequestedAt` DATETIME(3) NULL,
  ADD COLUMN `domainCheckedAt` DATETIME(3) NULL,
  ADD COLUMN `domainVerifiedAt` DATETIME(3) NULL,
  ADD COLUMN `domainError` VARCHAR(300) NULL,
  ADD COLUMN `domainFailures` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `WhiteLabelConfig_domainStatus_domainCheckedAt_idx` ON `WhiteLabelConfig`(`domainStatus`, `domainCheckedAt`);