-- AlterTable
ALTER TABLE `subscriptionplan` ADD COLUMN `agentLimit` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `BusinessLimitOverride` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `chatLimit` INTEGER NULL,
    `leadLimit` INTEGER NULL,
    `kbLimit` INTEGER NULL,
    `agentLimit` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BusinessLimitOverride_businessId_key`(`businessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BusinessLimitOverride` ADD CONSTRAINT `BusinessLimitOverride_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
