-- Phase 4, workstream AA: campaign records.

-- CreateTable
CREATE TABLE `Campaign` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `goal` VARCHAR(191) NOT NULL DEFAULT 'leads',
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `budget` DECIMAL(12, 2) NULL,
    `targetLeads` INTEGER NULL,
    `ownerId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `aliases` JSON NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Campaign_businessId_status_idx`(`businessId`, `status`),
    UNIQUE INDEX `Campaign_businessId_slug_key`(`businessId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `ContentPost` ADD COLUMN `campaignId` VARCHAR(191) NULL;
ALTER TABLE `LeadFormDef` ADD COLUMN `campaignId` VARCHAR(191) NULL;
ALTER TABLE `LeadMagnet` ADD COLUMN `campaignId` VARCHAR(191) NULL;
ALTER TABLE `LandingPage` ADD COLUMN `campaignId` VARCHAR(191) NULL;
ALTER TABLE `BookingType` ADD COLUMN `campaignId` VARCHAR(191) NULL;
ALTER TABLE `Touchpoint` ADD COLUMN `campaignId` VARCHAR(191) NULL;
ALTER TABLE `SubscriptionPlan` ADD COLUMN `campaignLimit` INTEGER NOT NULL DEFAULT 10;
ALTER TABLE `BusinessLimitOverride` ADD COLUMN `campaignLimit` INTEGER NULL;

-- CreateIndex
CREATE INDEX `ContentPost_campaignId_idx` ON `ContentPost`(`campaignId`);
CREATE INDEX `LeadFormDef_campaignId_idx` ON `LeadFormDef`(`campaignId`);
CREATE INDEX `LeadMagnet_campaignId_idx` ON `LeadMagnet`(`campaignId`);
CREATE INDEX `LandingPage_campaignId_idx` ON `LandingPage`(`campaignId`);
CREATE INDEX `BookingType_campaignId_idx` ON `BookingType`(`campaignId`);
CREATE INDEX `Touchpoint_campaignId_occurredAt_idx` ON `Touchpoint`(`campaignId`, `occurredAt`);

-- AddForeignKey
ALTER TABLE `Campaign` ADD CONSTRAINT `Campaign_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ContentPost` ADD CONSTRAINT `ContentPost_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `LeadFormDef` ADD CONSTRAINT `LeadFormDef_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `LeadMagnet` ADD CONSTRAINT `LeadMagnet_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `LandingPage` ADD CONSTRAINT `LandingPage_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `BookingType` ADD CONSTRAINT `BookingType_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Touchpoint` ADD CONSTRAINT `Touchpoint_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
