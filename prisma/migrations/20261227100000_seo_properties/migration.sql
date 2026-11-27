-- Google properties for SEO (Phase 3, workstream U)
ALTER TABLE `SubscriptionPlan` ADD COLUMN `seoPropertyLimit` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `gbpLocationLimit` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `BusinessLimitOverride` ADD COLUMN `seoPropertyLimit` INTEGER NULL,
    ADD COLUMN `gbpLocationLimit` INTEGER NULL;

CREATE TABLE `SearchProperty` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `connectionId` VARCHAR(191) NOT NULL,
    `siteUrl` VARCHAR(300) NOT NULL,
    `permission` VARCHAR(40) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `lastCheckedAt` DATETIME(3) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `syncedThrough` DATE NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SearchProperty_businessId_siteUrl_key`(`businessId`, `siteUrl`),
    INDEX `SearchProperty_connectionId_idx`(`connectionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BusinessLocation` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `connectionId` VARCHAR(191) NOT NULL,
    `accountName` VARCHAR(120) NOT NULL,
    `locationName` VARCHAR(120) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `address` TEXT NULL,
    `mapsUri` TEXT NULL,
    `reviewUri` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `lastCheckedAt` DATETIME(3) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BusinessLocation_businessId_locationName_key`(`businessId`, `locationName`),
    INDEX `BusinessLocation_connectionId_idx`(`connectionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SearchProperty` ADD CONSTRAINT `SearchProperty_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BusinessLocation` ADD CONSTRAINT `BusinessLocation_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
