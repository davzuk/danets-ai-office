-- ─── OAuth connections ────────────────────────────────────────────
-- Third-party accounts a tenant connects via OAuth (Meta, Google).
-- accessToken / refreshToken hold encrypted envelopes, never plaintext.
CREATE TABLE `OAuthConnection` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `externalAccountId` VARCHAR(191) NOT NULL,
    `accountName` VARCHAR(191) NULL,
    `accountEmail` VARCHAR(191) NULL,
    `scopes` TEXT NOT NULL,
    `accessToken` JSON NOT NULL,
    `refreshToken` JSON NULL,
    `expiresAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `lastError` TEXT NULL,
    `lastRefreshedAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `connectedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OAuthConnection_businessId_provider_externalAccountId_key`(`businessId`, `provider`, `externalAccountId`),
    INDEX `OAuthConnection_businessId_idx`(`businessId`),
    INDEX `OAuthConnection_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OAuthConnection` ADD CONSTRAINT `OAuthConnection_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
