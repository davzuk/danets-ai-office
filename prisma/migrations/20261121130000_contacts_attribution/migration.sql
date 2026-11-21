-- ─── Contacts + attribution (Phase 0, workstream D) ───────────────
-- Unified Contact per tenant, its identities, and marketing touchpoints.
-- All additive: nullable contactId on Lead / ChatSession / SupportTicket /
-- QuoteRequest; existing rows are linked by scripts/backfill-contacts.ts.

-- AlterTable
ALTER TABLE `ChatSession` ADD COLUMN `contactId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Lead` ADD COLUMN `contactId` VARCHAR(191) NULL,
    ADD COLUMN `firstTouchId` VARCHAR(191) NULL,
    ADD COLUMN `lastTouchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SupportTicket` ADD COLUMN `contactId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `QuoteRequest` ADD COLUMN `contactId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Contact` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `company` VARCHAR(191) NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `consent` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Contact_businessId_phone_idx`(`businessId`, `phone`),
    INDEX `Contact_businessId_lastSeenAt_idx`(`businessId`, `lastSeenAt`),
    UNIQUE INDEX `Contact_businessId_email_key`(`businessId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContactIdentity` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ContactIdentity_contactId_idx`(`contactId`),
    UNIQUE INDEX `ContactIdentity_businessId_type_value_key`(`businessId`, `type`, `value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Touchpoint` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `visitorId` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NULL,
    `medium` VARCHAR(191) NULL,
    `campaign` VARCHAR(191) NULL,
    `term` VARCHAR(191) NULL,
    `content` VARCHAR(191) NULL,
    `clickId` VARCHAR(500) NULL,
    `clickIdType` VARCHAR(191) NULL,
    `landingUrl` TEXT NULL,
    `referrer` TEXT NULL,
    `dedupeKey` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Touchpoint_dedupeKey_key`(`dedupeKey`),
    INDEX `Touchpoint_businessId_occurredAt_idx`(`businessId`, `occurredAt`),
    INDEX `Touchpoint_contactId_occurredAt_idx`(`contactId`, `occurredAt`),
    INDEX `Touchpoint_businessId_visitorId_idx`(`businessId`, `visitorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `ChatSession_contactId_idx` ON `ChatSession`(`contactId`);

-- CreateIndex
CREATE INDEX `ChatSession_businessId_visitorId_idx` ON `ChatSession`(`businessId`, `visitorId`);

-- CreateIndex
CREATE INDEX `Lead_contactId_idx` ON `Lead`(`contactId`);

-- CreateIndex
CREATE INDEX `SupportTicket_contactId_idx` ON `SupportTicket`(`contactId`);

-- CreateIndex
CREATE INDEX `QuoteRequest_contactId_idx` ON `QuoteRequest`(`contactId`);

-- AddForeignKey
ALTER TABLE `ChatSession` ADD CONSTRAINT `ChatSession_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupportTicket` ADD CONSTRAINT `SupportTicket_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuoteRequest` ADD CONSTRAINT `QuoteRequest_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactIdentity` ADD CONSTRAINT `ContactIdentity_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Touchpoint` ADD CONSTRAINT `Touchpoint_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Touchpoint` ADD CONSTRAINT `Touchpoint_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

