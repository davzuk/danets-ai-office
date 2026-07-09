-- AlterTable
ALTER TABLE `subscriptionplan` ADD COLUMN `auditRetentionDays` INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN `chatRetentionDays` INTEGER NOT NULL DEFAULT 90,
    ADD COLUMN `leadRetentionDays` INTEGER NOT NULL DEFAULT 365;
