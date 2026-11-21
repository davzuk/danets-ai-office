-- AlterTable
ALTER TABLE `SubscriptionPlan` ADD COLUMN `mediaStorageMbLimit` INTEGER NOT NULL DEFAULT 1024;

-- AlterTable
ALTER TABLE `BusinessLimitOverride` ADD COLUMN `mediaStorageMbLimit` INTEGER NULL;

-- CreateTable
CREATE TABLE `MediaAsset` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `altText` TEXT NULL,
    `originalName` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'upload',
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MediaAsset_storageKey_key`(`storageKey`),
    INDEX `MediaAsset_businessId_createdAt_idx`(`businessId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MediaAsset` ADD CONSTRAINT `MediaAsset_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Per-plan media storage (MB). 0 = unlimited.
UPDATE `SubscriptionPlan` SET `mediaStorageMbLimit` = 250 WHERE `name` = 'free';
UPDATE `SubscriptionPlan` SET `mediaStorageMbLimit` = 2048 WHERE `name` IN ('starter', 'business');
UPDATE `SubscriptionPlan` SET `mediaStorageMbLimit` = 10240 WHERE `name` IN ('pro', 'premium');
UPDATE `SubscriptionPlan` SET `mediaStorageMbLimit` = 51200 WHERE `name` = 'enterprise';
