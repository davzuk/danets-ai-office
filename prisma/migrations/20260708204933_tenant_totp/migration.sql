-- AlterTable
ALTER TABLE `businessuser` ADD COLUMN `totpEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `totpPending` VARCHAR(191) NULL,
    ADD COLUMN `totpSecret` VARCHAR(191) NULL;
