-- Phase 2 S: lead-capture forms and their submissions.

ALTER TABLE `SubscriptionPlan` ADD COLUMN `formLimit` INTEGER NOT NULL DEFAULT 3;
ALTER TABLE `BusinessLimitOverride` ADD COLUMN `formLimit` INTEGER NULL;

CREATE TABLE `LeadFormDef` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `fields` JSON NOT NULL,
    `settings` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `submissions` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LeadFormDef_businessId_status_idx`(`businessId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FormSubmission` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `formId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NULL,
    `contactId` VARCHAR(191) NULL,
    `data` JSON NOT NULL,
    `pageUrl` TEXT NULL,
    `ipHash` VARCHAR(64) NULL,
    `spamScore` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'accepted',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FormSubmission_formId_createdAt_idx`(`formId`, `createdAt`),
    INDEX `FormSubmission_businessId_createdAt_idx`(`businessId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LeadFormDef` ADD CONSTRAINT `LeadFormDef_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `FormSubmission` ADD CONSTRAINT `FormSubmission_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `FormSubmission` ADD CONSTRAINT `FormSubmission_formId_fkey` FOREIGN KEY (`formId`) REFERENCES `LeadFormDef`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;