-- Site audit (Phase 3, workstream W)
-- AlterTable
ALTER TABLE `SubscriptionPlan` ADD COLUMN `auditPageLimit` INTEGER NOT NULL DEFAULT 200;
UPDATE `SubscriptionPlan` SET `auditPageLimit` = 1000 WHERE `name` = 'enterprise';

-- AlterTable
ALTER TABLE `BusinessLimitOverride` ADD COLUMN `auditPageLimit` INTEGER NULL;

-- CreateTable
CREATE TABLE `SeoSettings` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `auditUrl` VARCHAR(300) NULL,
    `auditMonthly` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SeoSettings_businessId_key`(`businessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SiteAudit` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `rootUrl` VARCHAR(300) NOT NULL,
    `trigger` VARCHAR(20) NOT NULL DEFAULT 'manual',
    `status` VARCHAR(20) NOT NULL DEFAULT 'queued',
    `pageLimit` INTEGER NOT NULL,
    `pagesCrawled` INTEGER NOT NULL DEFAULT 0,
    `score` INTEGER NULL,
    `summary` JSON NULL,
    `vitals` JSON NULL,
    `state` JSON NULL,
    `requestedBy` VARCHAR(120) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SiteAudit_businessId_createdAt_idx`(`businessId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditIssue` (
    `id` VARCHAR(191) NOT NULL,
    `auditId` VARCHAR(191) NOT NULL,
    `pageUrl` VARCHAR(1000) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `severity` VARCHAR(10) NOT NULL,
    `detail` JSON NULL,
    `suggestion` TEXT NULL,
    `suggestedAt` DATETIME(3) NULL,

    INDEX `AuditIssue_auditId_severity_idx`(`auditId`, `severity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SeoSettings` ADD CONSTRAINT `SeoSettings_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SiteAudit` ADD CONSTRAINT `SiteAudit_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditIssue` ADD CONSTRAINT `AuditIssue_auditId_fkey` FOREIGN KEY (`auditId`) REFERENCES `SiteAudit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

