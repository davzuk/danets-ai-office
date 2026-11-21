-- AlterTable
ALTER TABLE `Lead` ADD COLUMN `externalRef` VARCHAR(191) NULL,
    MODIFY `message` TEXT NULL;

-- CreateTable
CREATE TABLE `MetaLeadForm` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `socialAccountId` VARCHAR(191) NOT NULL,
    `formId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `metaStatus` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `questions` JSON NULL,
    `fieldMapping` JSON NULL,
    `leadsImported` INTEGER NOT NULL DEFAULT 0,
    `lastLeadAt` DATETIME(3) NULL,
    `polledThrough` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MetaLeadForm_businessId_idx`(`businessId`),
    UNIQUE INDEX `MetaLeadForm_socialAccountId_formId_key`(`socialAccountId`, `formId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Lead_businessId_externalRef_key` ON `Lead`(`businessId`, `externalRef`);

-- AddForeignKey
ALTER TABLE `MetaLeadForm` ADD CONSTRAINT `MetaLeadForm_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MetaLeadForm` ADD CONSTRAINT `MetaLeadForm_socialAccountId_fkey` FOREIGN KEY (`socialAccountId`) REFERENCES `SocialAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

