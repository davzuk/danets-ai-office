-- Search Console performance data (Phase 3, workstream V)
-- CreateTable
CREATE TABLE `SearchMetricDaily` (
    `id` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `key` VARCHAR(500) NOT NULL,
    `clicks` INTEGER NOT NULL,
    `impressions` INTEGER NOT NULL,
    `ctr` DOUBLE NOT NULL,
    `position` DOUBLE NOT NULL,

    INDEX `SearchMetricDaily_propertyId_kind_date_idx`(`propertyId`, `kind`, `date`),
    UNIQUE INDEX `SearchMetricDaily_propertyId_date_kind_key_key`(`propertyId`, `date`, `kind`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SearchMetricDaily` ADD CONSTRAINT `SearchMetricDaily_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `SearchProperty`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

