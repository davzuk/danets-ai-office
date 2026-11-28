-- Phase 3, workstream Y: tracked keywords, content opportunities and briefs.

-- AlterTable
ALTER TABLE `BusinessLimitOverride` ADD COLUMN `trackedKeywordLimit` INTEGER NULL;

-- AlterTable
ALTER TABLE `SearchProperty` ADD COLUMN `opportunitiesAt` DATETIME(3) NULL,
    ADD COLUMN `opportunitiesError` TEXT NULL;

-- AlterTable
ALTER TABLE `SubscriptionPlan` ADD COLUMN `trackedKeywordLimit` INTEGER NOT NULL DEFAULT 50;
UPDATE `SubscriptionPlan` SET `trackedKeywordLimit` = 500 WHERE `name` = 'enterprise';

-- CreateTable
CREATE TABLE `TrackedKeyword` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `keyword` VARCHAR(200) NOT NULL,
    `targetUrl` VARCHAR(1000) NULL,
    `rankingPage` VARCHAR(1000) NULL,
    `rankingAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

INDEX `TrackedKeyword_businessId_idx`(`businessId`),
    UNIQUE INDEX `TrackedKeyword_propertyId_keyword_key`(`propertyId`, `keyword`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoOpportunity` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `query` VARCHAR(500) NOT NULL,
    `page` VARCHAR(1000) NULL,
    `pages` JSON NULL,
    `clicks` INTEGER NOT NULL,
    `impressions` INTEGER NOT NULL,
    `ctr` DOUBLE NOT NULL,
    `position` DOUBLE NOT NULL,
    `expectedCtr` DOUBLE NULL,
    `potentialClicks` INTEGER NOT NULL DEFAULT 0,
    `suggestion` TEXT NULL,
    `suggestedAt` DATETIME(3) NULL,
    `dismissedAt` DATETIME(3) NULL,
    `computedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

INDEX `SeoOpportunity_businessId_kind_idx`(`businessId`, `kind`),
    UNIQUE INDEX `SeoOpportunity_propertyId_kind_query_key`(`propertyId`, `kind`, `query`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentBrief` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NULL,
    `opportunityId` VARCHAR(191) NULL,
    `query` VARCHAR(500) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `brief` JSON NOT NULL,
    `markdown` TEXT NOT NULL,
    `gaps` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NULL,
    `createdByName` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

INDEX `ContentBrief_businessId_createdAt_idx`(`businessId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TrackedKeyword` ADD CONSTRAINT `TrackedKeyword_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrackedKeyword` ADD CONSTRAINT `TrackedKeyword_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `SearchProperty`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoOpportunity` ADD CONSTRAINT `SeoOpportunity_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoOpportunity` ADD CONSTRAINT `SeoOpportunity_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `SearchProperty`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentBrief` ADD CONSTRAINT `ContentBrief_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
