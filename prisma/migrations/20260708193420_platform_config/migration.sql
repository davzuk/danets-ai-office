-- CreateTable
CREATE TABLE `PlatformConfig` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `platformName` VARCHAR(191) NOT NULL DEFAULT 'Danets AI Automation',
    `platformTagline` VARCHAR(191) NOT NULL DEFAULT 'AI-powered business automation',
    `supportEmail` VARCHAR(191) NULL,
    `supportPhone` VARCHAR(191) NULL,
    `defaultSignupPlan` VARCHAR(191) NOT NULL DEFAULT 'free',
    `maintenanceMode` BOOLEAN NOT NULL DEFAULT false,
    `maintenanceMessage` VARCHAR(191) NULL,
    `emailFromName` VARCHAR(191) NOT NULL DEFAULT 'Danets AI',
    `emailFromAddress` VARCHAR(191) NULL,
    `allowPublicSignup` BOOLEAN NOT NULL DEFAULT true,
    `enforcePlatform2fa` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
