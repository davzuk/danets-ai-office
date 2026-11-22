-- Phase 2 O: proactive widget messages and the pre-chat form.
ALTER TABLE `AiAgent` ADD COLUMN `preChatForm` JSON NULL;

ALTER TABLE `ChatSession` ADD COLUMN `widgetRuleId` VARCHAR(191) NULL;

CREATE TABLE `WidgetRule` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `conditions` JSON NOT NULL,
    `message` TEXT NOT NULL,
    `quickReplies` JSON NULL,
    `action` VARCHAR(191) NOT NULL DEFAULT 'bubble',
    `frequency` VARCHAR(191) NOT NULL DEFAULT 'session',
    `shows` INTEGER NOT NULL DEFAULT 0,
    `chats` INTEGER NOT NULL DEFAULT 0,
    `leads` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WidgetRule_businessId_enabled_idx`(`businessId`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WidgetRule` ADD CONSTRAINT `WidgetRule_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
