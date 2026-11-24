-- Platform-only rework: website custom domains are removed. A tenant's own
-- domain is a white-label login domain (WhiteLabelConfig), not a website
-- address, so the TenantSite domain columns and their verification index go.

DROP INDEX `TenantSite_domainStatus_domainCheckedAt_idx` ON `TenantSite`;

ALTER TABLE `TenantSite`
  DROP COLUMN `customDomain`,
  DROP COLUMN `domainStatus`,
  DROP COLUMN `domainToken`,
  DROP COLUMN `domainRequestedAt`,
  DROP COLUMN `domainCheckedAt`,
  DROP COLUMN `domainVerifiedAt`,
  DROP COLUMN `domainError`,
  DROP COLUMN `domainFailures`;