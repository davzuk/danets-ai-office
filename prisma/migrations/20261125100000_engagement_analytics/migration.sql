-- AlterTable
ALTER TABLE `ScheduledPost` ADD COLUMN `metricsSyncedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `PostMetric` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `scheduledPostId` VARCHAR(191) NOT NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `impressions` INTEGER NULL,
    `reach` INTEGER NULL,
    `engagements` INTEGER NULL,
    `clicks` INTEGER NULL,
    `comments` INTEGER NULL,
    `shares` INTEGER NULL,
    `saves` INTEGER NULL,
    `videoViews` INTEGER NULL,
    `raw` JSON NULL,

    INDEX `PostMetric_scheduledPostId_capturedAt_idx`(`scheduledPostId`, `capturedAt`),
    INDEX `PostMetric_businessId_capturedAt_idx`(`businessId`, `capturedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountMetric` (
    `socialAccountId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `followers` INTEGER NULL,
    `reach` INTEGER NULL,
    `impressions` INTEGER NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AccountMetric_businessId_date_idx`(`businessId`, `date`),
    PRIMARY KEY (`socialAccountId`, `date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentInsight` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `content` JSON NOT NULL,
    `stats` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ContentInsight_businessId_createdAt_idx`(`businessId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PostMetric` ADD CONSTRAINT `PostMetric_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostMetric` ADD CONSTRAINT `PostMetric_scheduledPostId_fkey` FOREIGN KEY (`scheduledPostId`) REFERENCES `ScheduledPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountMetric` ADD CONSTRAINT `AccountMetric_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountMetric` ADD CONSTRAINT `AccountMetric_socialAccountId_fkey` FOREIGN KEY (`socialAccountId`) REFERENCES `SocialAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentInsight` ADD CONSTRAINT `ContentInsight_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

