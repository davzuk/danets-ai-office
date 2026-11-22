-- Booking part 2: Google Calendar and Calendly sync (Phase 2, workstream P)
ALTER TABLE `BookingType`
    MODIFY `calendarId` VARCHAR(255) NULL,
    ADD COLUMN `calendarConnectionId` VARCHAR(191) NULL,
    ADD COLUMN `calendarSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `calendlyEventTypeUri` VARCHAR(255) NULL;

ALTER TABLE `Booking`
    ADD COLUMN `externalProvider` VARCHAR(20) NULL,
    ADD COLUMN `externalData` JSON NULL,
    ADD COLUMN `meetingUrl` TEXT NULL;

CREATE INDEX `BookingType_provider_active_idx` ON `BookingType`(`provider`, `active`);
