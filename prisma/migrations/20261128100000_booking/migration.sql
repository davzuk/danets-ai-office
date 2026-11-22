-- Phase 2 P (part 1): native booking types, bookings and the booking-type limit.
ALTER TABLE `SubscriptionPlan` ADD COLUMN `bookingTypeLimit` INTEGER NOT NULL DEFAULT 3;

ALTER TABLE `BusinessLimitOverride` ADD COLUMN `bookingTypeLimit` INTEGER NULL;

-- Suggested defaults: Starter 3, Pro 10, Enterprise unlimited (0).
UPDATE `SubscriptionPlan` SET `bookingTypeLimit` = 10 WHERE `name` IN ('pro', 'premium');
UPDATE `SubscriptionPlan` SET `bookingTypeLimit` = 0 WHERE `name` = 'enterprise';

CREATE TABLE `BookingType` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `description` TEXT NULL,
    `durationMin` INTEGER NOT NULL DEFAULT 30,
    `bufferMin` INTEGER NOT NULL DEFAULT 0,
    `minNoticeHours` INTEGER NOT NULL DEFAULT 4,
    `maxDaysAhead` INTEGER NOT NULL DEFAULT 30,
    `slotStepMin` INTEGER NOT NULL DEFAULT 30,
    `availability` JSON NOT NULL,
    `location` VARCHAR(191) NOT NULL DEFAULT 'phone',
    `locationDetail` TEXT NULL,
    `questions` JSON NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'native',
    `calendarId` VARCHAR(191) NULL,
    `calendlyUrl` TEXT NULL,
    `assignedUserId` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BookingType_businessId_active_idx`(`businessId`, `active`),
    UNIQUE INDEX `BookingType_businessId_slug_key`(`businessId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Booking` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `bookingTypeId` VARCHAR(191) NULL,
    `leadId` VARCHAR(191) NULL,
    `contactId` VARCHAR(191) NULL,
    `sessionId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `bufferMin` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'confirmed',
    `answers` JSON NULL,
    `notes` TEXT NULL,
    `visitorTimezone` VARCHAR(64) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'page',
    `consentText` TEXT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledBy` VARCHAR(191) NULL,
    `cancelReason` TEXT NULL,
    `sequence` INTEGER NOT NULL DEFAULT 0,
    `externalId` VARCHAR(191) NULL,
    `cancelToken` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Booking_cancelToken_key`(`cancelToken`),
    INDEX `Booking_businessId_startsAt_idx`(`businessId`, `startsAt`),
    INDEX `Booking_businessId_status_startsAt_idx`(`businessId`, `status`, `startsAt`),
    INDEX `Booking_leadId_idx`(`leadId`),
    INDEX `Booking_contactId_idx`(`contactId`),
    UNIQUE INDEX `Booking_businessId_externalId_key`(`businessId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BookingType` ADD CONSTRAINT `BookingType_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Booking` ADD CONSTRAINT `Booking_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Booking` ADD CONSTRAINT `Booking_bookingTypeId_fkey` FOREIGN KEY (`bookingTypeId`) REFERENCES `BookingType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Booking` ADD CONSTRAINT `Booking_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Booking` ADD CONSTRAINT `Booking_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
