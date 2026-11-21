-- CreateTable
CREATE TABLE `ContentPost` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `brief` TEXT NOT NULL,
    `goal` VARCHAR(191) NULL,
    `toneTweak` VARCHAR(191) NULL,
    `campaignTag` VARCHAR(191) NULL,
    `sourceType` VARCHAR(191) NULL,
    `sourceId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `createdById` VARCHAR(191) NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContentPost_businessId_updatedAt_idx`(`businessId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostVariant` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `hashtags` JSON NULL,
    `mediaIds` JSON NULL,
    `linkUrl` TEXT NULL,
    `imagePrompt` TEXT NULL,
    `aiGenerated` BOOLEAN NOT NULL DEFAULT true,
    `editedByHuman` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PostVariant_postId_platform_key`(`postId`, `platform`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ContentPost` ADD CONSTRAINT `ContentPost_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostVariant` ADD CONSTRAINT `PostVariant_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `ContentPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- The Social Media module (Content Studio, later the calendar) is gated on
-- this flag. Off by default: enable it in the platform console.
INSERT IGNORE INTO `PlatformFeatureFlag` (`id`, `key`, `name`, `description`, `enabled`, `createdAt`, `updatedAt`)
VALUES ('flag_social_hub', 'social_hub', 'Social Media hub', 'Content Studio, calendar and publishing for Facebook, Instagram and LinkedIn.', false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
