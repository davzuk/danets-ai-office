-- Password reset tokens.
--
-- Used by /api/auth/forgot-password and /api/auth/reset-password.
-- TokenHash stores a SHA-256 of the cleartext token (the cleartext is only
-- ever held in the URL fragment that we email to the user; the DB never
-- sees it). Single-use: consumed via updateMany in a transaction.

CREATE TABLE `PasswordResetToken` (
  `id`          VARCHAR(191) NOT NULL,
  `userId`      VARCHAR(191) NOT NULL,
  `businessId`  VARCHAR(191) NOT NULL,
  `tokenHash`   VARCHAR(191) NOT NULL,
  `expiresAt`   DATETIME(3)  NOT NULL,
  `usedAt`      DATETIME(3)  NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `PasswordResetToken_tokenHash_key` (`tokenHash`),
  KEY `PasswordResetToken_userId_idx` (`userId`),
  KEY `PasswordResetToken_expiresAt_idx` (`expiresAt`)
);

-- Mirror the same table for platform admin resets.
CREATE TABLE `PlatformPasswordResetToken` (
  `id`         VARCHAR(191) NOT NULL,
  `adminId`    VARCHAR(191) NOT NULL,
  `tokenHash`  VARCHAR(191) NOT NULL,
  `expiresAt`  DATETIME(3)  NOT NULL,
  `usedAt`     DATETIME(3)  NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `PlatformPasswordResetToken_tokenHash_key` (`tokenHash`),
  KEY `PlatformPasswordResetToken_adminId_idx` (`adminId`),
  KEY `PlatformPasswordResetToken_expiresAt_idx` (`expiresAt`)
);