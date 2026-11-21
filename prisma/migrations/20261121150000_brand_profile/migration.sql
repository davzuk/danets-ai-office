-- ─── Brand Voice profile (Phase 0, workstream E) ───────────────────
-- One row per tenant; consumed by AI content generators via buildBrandContext().

-- CreateTable
CREATE TABLE `BrandProfile` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `audience` JSON NULL,
    `tone` JSON NULL,
    `valueProps` JSON NULL,
    `offers` JSON NULL,
    `doPhrases` JSON NULL,
    `dontPhrases` JSON NULL,
    `locales` JSON NULL,
    `websiteUrl` VARCHAR(500) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `generatedAt` DATETIME(3) NULL,
    `generationStatus` VARCHAR(191) NOT NULL DEFAULT 'idle',
    `generationError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BrandProfile_businessId_key`(`businessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BrandProfile` ADD CONSTRAINT `BrandProfile_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

