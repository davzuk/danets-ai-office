-- Phase 2 Q (part 1): tenant websites and landing pages.

-- AlterTable: published website pages per plan (0 = unlimited).
ALTER TABLE `SubscriptionPlan` ADD COLUMN `pageLimit` INTEGER NOT NULL DEFAULT 3;
ALTER TABLE `BusinessLimitOverride` ADD COLUMN `pageLimit` INTEGER NULL;

UPDATE `SubscriptionPlan` SET `pageLimit` = 25 WHERE `name` IN ('pro', 'premium');
UPDATE `SubscriptionPlan` SET `pageLimit` = 0 WHERE `name` = 'enterprise';

-- CreateTable
CREATE TABLE `TenantSite` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `subdomain` VARCHAR(63) NOT NULL,
    `customDomain` VARCHAR(191) NULL,
    `domainStatus` VARCHAR(191) NOT NULL DEFAULT 'none',
    `domainToken` VARCHAR(64) NULL,
    `theme` JSON NULL,
    `seoDefaults` JSON NULL,
    `widgetEnabled` BOOLEAN NOT NULL DEFAULT true,
    `analyticsTag` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TenantSite_businessId_key`(`businessId`),
    UNIQUE INDEX `TenantSite_subdomain_key`(`subdomain`),
    UNIQUE INDEX `TenantSite_customDomain_key`(`customDomain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LandingPage` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `blocks` JSON NOT NULL,
    `publishedBlocks` JSON NULL,
    `seo` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `publishedAt` DATETIME(3) NULL,
    `views` INTEGER NOT NULL DEFAULT 0,
    `generatedFrom` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LandingPage_businessId_status_idx`(`businessId`, `status`),
    UNIQUE INDEX `LandingPage_siteId_slug_key`(`siteId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LandingPageVersion` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `blocks` JSON NOT NULL,
    `seo` JSON NULL,
    `title` VARCHAR(200) NOT NULL,
    `publishedBy` VARCHAR(191) NULL,
    `restoredFrom` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LandingPageVersion_pageId_createdAt_idx`(`pageId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TenantSite` ADD CONSTRAINT `TenantSite_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LandingPage` ADD CONSTRAINT `LandingPage_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LandingPage` ADD CONSTRAINT `LandingPage_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TenantSite`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LandingPageVersion` ADD CONSTRAINT `LandingPageVersion_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `LandingPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- The Website module is gated on this flag. Off by default: enable it in the
-- platform console (globally or per tenant).
INSERT IGNORE INTO `PlatformFeatureFlag` (`id`, `key`, `name`, `description`, `enabled`, `createdAt`, `updatedAt`)
VALUES ('flag_sites_builder', 'sites_builder', 'Website builder', 'Tenant websites and landing pages on their own subdomain.', false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
