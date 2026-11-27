-- Lead magnets (Phase 2, workstream T)
ALTER TABLE `SubscriptionPlan` ADD COLUMN `leadMagnetLimit` INTEGER NOT NULL DEFAULT 3;
ALTER TABLE `BusinessLimitOverride` ADD COLUMN `leadMagnetLimit` INTEGER NULL;

ALTER TABLE `FormSubmission` ADD COLUMN `leadMagnetId` VARCHAR(191) NULL,
    ADD COLUMN `magnetDownloadedAt` DATETIME(3) NULL;

CREATE TABLE `LeadMagnet` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `bullets` JSON NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'upload',
    `content` JSON NULL,
    `fileKey` VARCHAR(300) NULL,
    `fileName` VARCHAR(200) NULL,
    `fileBytes` INTEGER NULL,
    `formId` VARCHAR(191) NULL,
    `deliveryEmail` JSON NULL,
    `downloads` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LeadMagnet_businessId_status_idx`(`businessId`, `status`),
    INDEX `LeadMagnet_formId_idx`(`formId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LeadMagnet` ADD CONSTRAINT `LeadMagnet_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LeadMagnet` ADD CONSTRAINT `LeadMagnet_formId_fkey` FOREIGN KEY (`formId`) REFERENCES `LeadFormDef`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
