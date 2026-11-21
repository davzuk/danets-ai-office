-- AlterTable
ALTER TABLE `ChatSession` ADD COLUMN `autoReplyPaused` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `channel` VARCHAR(191) NOT NULL DEFAULT 'widget',
    ADD COLUMN `externalThreadId` VARCHAR(191) NULL,
    ADD COLUMN `lastInboundAt` DATETIME(3) NULL,
    ADD COLUMN `socialAccountId` VARCHAR(191) NULL,
    ADD COLUMN `threadMeta` JSON NULL,
    MODIFY `summary` TEXT NULL,
    MODIFY `nextAction` TEXT NULL;

-- AlterTable
ALTER TABLE `ChatMessage` ADD COLUMN `deliveryStatus` VARCHAR(191) NULL,
    ADD COLUMN `externalId` VARCHAR(191) NULL,
    ADD COLUMN `sentByUserId` VARCHAR(191) NULL,
    MODIFY `content` TEXT NOT NULL,
    MODIFY `meta` TEXT NULL;

-- CreateIndex
CREATE INDEX `ChatSession_businessId_channel_updatedAt_idx` ON `ChatSession`(`businessId`, `channel`, `updatedAt`);

-- CreateIndex
CREATE UNIQUE INDEX `ChatSession_socialAccountId_externalThreadId_key` ON `ChatSession`(`socialAccountId`, `externalThreadId`);

-- CreateIndex
CREATE UNIQUE INDEX `ChatMessage_externalId_key` ON `ChatMessage`(`externalId`);

-- AddForeignKey
ALTER TABLE `ChatSession` ADD CONSTRAINT `ChatSession_socialAccountId_fkey` FOREIGN KEY (`socialAccountId`) REFERENCES `SocialAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

