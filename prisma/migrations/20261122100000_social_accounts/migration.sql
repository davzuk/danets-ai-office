-- ─── Social accounts (Phase 1, workstream F) ──────────────────────
-- Facebook Pages / Instagram accounts per tenant, and Meta data-deletion
-- callback requests.

-- CreateTable
CREATE TABLE `SocialAccount` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `connectionId` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `parentExternalId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NULL,
    `pictureUrl` TEXT NULL,
    `tasks` JSON NULL,
    `accessToken` JSON NULL,
    `inboxEnabled` BOOLEAN NOT NULL DEFAULT false,
    `leadSyncEnabled` BOOLEAN NOT NULL DEFAULT false,
    `publishEnabled` BOOLEAN NOT NULL DEFAULT true,
    `autoReply` VARCHAR(191) NOT NULL DEFAULT 'off',
    `subscribedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SocialAccount_businessId_idx`(`businessId`),
    INDEX `SocialAccount_connectionId_idx`(`connectionId`),
    UNIQUE INDEX `SocialAccount_platform_externalId_key`(`platform`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MetaDataDeletionRequest` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `metaUserId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `deleted` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `MetaDataDeletionRequest_code_key`(`code`),
    INDEX `MetaDataDeletionRequest_metaUserId_idx`(`metaUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SocialAccount` ADD CONSTRAINT `SocialAccount_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SocialAccount` ADD CONSTRAINT `SocialAccount_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `OAuthConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

