-- ─── Background job queue ─────────────────────────────────────────
-- Backing table for src/lib/jobs. Workers claim due rows with
-- SELECT ... FOR UPDATE SKIP LOCKED (MySQL 8+).
CREATE TABLE `Job` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `lockedAt` DATETIME(3) NULL,
    `lockedBy` VARCHAR(191) NULL,
    `lastError` TEXT NULL,
    `dedupeKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Job_dedupeKey_key`(`dedupeKey`),
    INDEX `Job_status_runAt_idx`(`status`, `runAt`),
    INDEX `Job_status_lockedAt_idx`(`status`, `lockedAt`),
    INDEX `Job_businessId_idx`(`businessId`),
    INDEX `Job_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
