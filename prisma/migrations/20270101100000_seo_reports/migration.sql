-- Phase 3, workstream Z: monthly SEO reports

-- AlterTable
ALTER TABLE `SeoSettings` ADD COLUMN `reportEmail` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `SeoReport` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `periodStart` DATE NOT NULL,
    `periodEnd` DATE NOT NULL,
    `data` JSON NOT NULL,
    `nextSteps` JSON NULL,
    `aiError` TEXT NULL,
    `trigger` VARCHAR(20) NOT NULL DEFAULT 'schedule',
    `createdBy` VARCHAR(120) NULL,
    `emailedAt` DATETIME(3) NULL,
    `emailError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SeoReport_businessId_createdAt_idx`(`businessId`, `createdAt`),
    UNIQUE INDEX `SeoReport_businessId_month_key`(`businessId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- AddForeignKey
ALTER TABLE `SeoReport` ADD CONSTRAINT `SeoReport_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
