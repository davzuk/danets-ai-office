-- Custom domains for tenant websites (Phase 2, workstream Q part 2).
ALTER TABLE `TenantSite`
  ADD COLUMN `domainRequestedAt` DATETIME(3) NULL,
  ADD COLUMN `domainCheckedAt` DATETIME(3) NULL,
  ADD COLUMN `domainVerifiedAt` DATETIME(3) NULL,
  ADD COLUMN `domainError` VARCHAR(300) NULL,
  ADD COLUMN `domainFailures` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `TenantSite_domainStatus_domainCheckedAt_idx` ON `TenantSite`(`domainStatus`, `domainCheckedAt`);
