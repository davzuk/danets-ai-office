-- Login attempt tracking.
--
-- Used by /api/auth/login to apply both IP-based and per-account rate limits.
-- A row exists per (ip, email, attemptedAt). Failed attempts increment a
-- counter; after 25 failed attempts in 15 min for a single email, the
-- account is locked until the window expires.

CREATE TABLE `LoginAttempt` (
  `id`           VARCHAR(191) NOT NULL,
  `ip`           VARCHAR(64)  NOT NULL,
  `email`        VARCHAR(191) NOT NULL,
  `businessId`   VARCHAR(191) NULL,
  `succeeded`    TINYINT(1)   NOT NULL DEFAULT 0,
  `userAgent`    VARCHAR(255) NULL,
  `attemptedAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `LoginAttempt_ip_attemptedAt_idx` (`ip`, `attemptedAt`),
  KEY `LoginAttempt_email_attemptedAt_idx` (`email`, `attemptedAt`),
  KEY `LoginAttempt_attemptedAt_idx` (`attemptedAt`)
);