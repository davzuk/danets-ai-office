-- AlterTable
ALTER TABLE `BusinessLocation` ADD COLUMN `averageRating` DOUBLE NULL,
    ADD COLUMN `metricsError` TEXT NULL,
    ADD COLUMN `metricsSyncedThrough` DATE NULL,
    ADD COLUMN `reviewsError` TEXT NULL,
    ADD COLUMN `reviewsSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `reviewsSyncedThrough` DATETIME(3) NULL,
    ADD COLUMN `totalReviewCount` INTEGER NULL;

-- AlterTable
ALTER TABLE `SeoSettings` ADD COLUMN `autoReplyNoText` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `GbpReview` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `reviewName` VARCHAR(400) NOT NULL,
    `reviewerName` VARCHAR(200) NULL,
    `reviewerPhoto` TEXT NULL,
    `anonymous` BOOLEAN NOT NULL DEFAULT false,
    `starRating` INTEGER NOT NULL,
    `comment` TEXT NULL,
    `reviewCreatedAt` DATETIME(3) NOT NULL,
    `reviewUpdatedAt` DATETIME(3) NOT NULL,
    `replyText` TEXT NULL,
    `repliedAt` DATETIME(3) NULL,
    `replyState` VARCHAR(20) NULL,
    `replyStatus` VARCHAR(191) NOT NULL DEFAULT 'none',
    `draftReply` TEXT NULL,
    `draftedById` VARCHAR(191) NULL,
    `draftedByName` VARCHAR(120) NULL,
    `replyError` TEXT NULL,
    `autoReplied` BOOLEAN NOT NULL DEFAULT false,
    `contactId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GbpReview_businessId_reviewCreatedAt_idx`(`businessId`, `reviewCreatedAt`),
    INDEX `GbpReview_businessId_replyStatus_idx`(`businessId`, `replyStatus`),
    UNIQUE INDEX `GbpReview_locationId_reviewName_key`(`locationId`, `reviewName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GbpDailyMetric` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `metric` VARCHAR(60) NOT NULL,
    `value` INTEGER NOT NULL,

    INDEX `GbpDailyMetric_businessId_date_idx`(`businessId`, `date`),
    UNIQUE INDEX `GbpDailyMetric_locationId_date_metric_key`(`locationId`, `date`, `metric`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReviewRequest` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `leadId` VARCHAR(191) NULL,
    `bookingId` VARCHAR(191) NULL,
    `workflowId` VARCHAR(191) NULL,
    `channel` VARCHAR(20) NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `token` VARCHAR(32) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `clickedAt` DATETIME(3) NULL,
    `clicks` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `ReviewRequest_token_key`(`token`),
    INDEX `ReviewRequest_businessId_recipient_sentAt_idx`(`businessId`, `recipient`, `sentAt`),
    INDEX `ReviewRequest_businessId_contactId_sentAt_idx`(`businessId`, `contactId`, `sentAt`),
    INDEX `ReviewRequest_businessId_sentAt_idx`(`businessId`, `sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GbpReview` ADD CONSTRAINT `GbpReview_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GbpReview` ADD CONSTRAINT `GbpReview_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `BusinessLocation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GbpReview` ADD CONSTRAINT `GbpReview_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GbpDailyMetric` ADD CONSTRAINT `GbpDailyMetric_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GbpDailyMetric` ADD CONSTRAINT `GbpDailyMetric_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `BusinessLocation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewRequest` ADD CONSTRAINT `ReviewRequest_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewRequest` ADD CONSTRAINT `ReviewRequest_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `BusinessLocation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewRequest` ADD CONSTRAINT `ReviewRequest_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Each Business Profile location already being managed becomes a publishing
-- account, so the content calendar can post to it (google_business).
INSERT IGNORE INTO `SocialAccount` (`id`, `businessId`, `connectionId`, `platform`, `externalId`, `name`, `inboxEnabled`, `leadSyncEnabled`, `publishEnabled`, `autoReply`, `status`, `createdAt`, `updatedAt`)
SELECT CONCAT('gbp', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 22)), `businessId`, `connectionId`, 'google_business', CONCAT(`accountName`, '/', `locationName`), LEFT(`title`, 191), false, false, true, 'off',
       IF(`status` = 'active', 'active', 'error'), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `BusinessLocation`;
