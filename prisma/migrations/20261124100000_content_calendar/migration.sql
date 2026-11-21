-- AlterTable
ALTER TABLE `Business` ADD COLUMN `contentApproval` VARCHAR(191) NOT NULL DEFAULT 'auto',
    ADD COLUMN `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE `ScheduledPost` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `variantId` VARCHAR(191) NOT NULL,
    `socialAccountId` VARCHAR(191) NULL,
    `scheduledFor` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'scheduled',
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `jobId` VARCHAR(191) NULL,
    `containerId` VARCHAR(191) NULL,
    `externalPostId` VARCHAR(191) NULL,
    `permalink` TEXT NULL,
    `publishedAt` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ScheduledPost_businessId_scheduledFor_idx`(`businessId`, `scheduledFor`),
    INDEX `ScheduledPost_status_scheduledFor_idx`(`status`, `scheduledFor`),
    INDEX `ScheduledPost_variantId_idx`(`variantId`),
    INDEX `ScheduledPost_socialAccountId_idx`(`socialAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ScheduledPost` ADD CONSTRAINT `ScheduledPost_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScheduledPost` ADD CONSTRAINT `ScheduledPost_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `PostVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScheduledPost` ADD CONSTRAINT `ScheduledPost_socialAccountId_fkey` FOREIGN KEY (`socialAccountId`) REFERENCES `SocialAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

