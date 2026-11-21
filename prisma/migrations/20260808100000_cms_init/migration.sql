-- Public Website CMS — tables for marketing site, blog, docs, navigation,
-- block library, media, changelog and contact submissions. Editable from
-- the super-admin console at /platform/cms.

CREATE TABLE `CmsSite` (
  `id` VARCHAR(191) NOT NULL,
  `domain` VARCHAR(191) NULL,
  `brandName` VARCHAR(191) NOT NULL DEFAULT 'Danets AI Automation',
  `tagline` VARCHAR(191) NULL,
  `description` TEXT NULL,
  `supportEmail` VARCHAR(191) NULL,
  `logoUrl` VARCHAR(191) NULL,
  `faviconUrl` VARCHAR(191) NULL,
  `primaryColor` VARCHAR(191) NOT NULL DEFAULT '#1d4ed8',
  `accentColor` VARCHAR(191) NOT NULL DEFAULT '#84cc16',
  `socialLinks` JSON NULL,
  `seoDefaults` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CmsSite_domain_key`(`domain`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CmsAuthor` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `bio` TEXT NULL,
  `avatarUrl` VARCHAR(191) NULL,
  `twitter` VARCHAR(191) NULL,
  `linkedin` VARCHAR(191) NULL,
  `siteId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `CmsAuthor_siteId_idx`(`siteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CmsTag` (
  `id` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `siteId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `CmsTag_slug_key`(`slug`),
  INDEX `CmsTag_siteId_idx`(`siteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CmsPage` (
  `id` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `ogImage` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
  `publishedAt` DATETIME(3) NULL,
  `blocks` JSON NOT NULL,
  `seo` JSON NULL,
  `siteId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CmsPage_slug_key`(`slug`),
  INDEX `CmsPage_status_publishedAt_idx`(`status`, `publishedAt`),
  INDEX `CmsPage_siteId_idx`(`siteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CmsPost` (
  `id` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `excerpt` TEXT NULL,
  `coverImage` VARCHAR(191) NULL,
  `bodyMdx` LONGTEXT NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
  `publishedAt` DATETIME(3) NULL,
  `seo` JSON NULL,
  `authorId` VARCHAR(191) NULL,
  `siteId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CmsPost_slug_key`(`slug`),
  INDEX `CmsPost_status_publishedAt_idx`(`status`, `publishedAt`),
  INDEX `CmsPost_authorId_idx`(`authorId`),
  INDEX `CmsPost_siteId_idx`(`siteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CmsNavItem` (
  `id` VARCHAR(191) NOT NULL,
  `parentId` VARCHAR(191) NULL,
  `label` VARCHAR(191) NOT NULL,
  `href` VARCHAR(191) NOT NULL,
  `order` INT NOT NULL DEFAULT 0,
  `visible` BOOLEAN NOT NULL DEFAULT true,
  `icon` VARCHAR(191) NULL,
  `siteId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `CmsNavItem_siteId_order_idx`(`siteId`, `order`),
  INDEX `CmsNavItem_parentId_idx`(`parentId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CmsBlock` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `schema` JSON NOT NULL,
  `defaultProps` JSON NOT NULL,
  `icon` VARCHAR(191) NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `siteId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CmsBlock_key_key`(`key`),
  INDEX `CmsBlock_siteId_idx`(`siteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CmsMedia` (
  `id` VARCHAR(191) NOT NULL,
  `filename` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `sizeBytes` INT NOT NULL,
  `url` VARCHAR(191) NOT NULL,
  `altText` TEXT NULL,
  `width` INT NULL,
  `height` INT NULL,
  `storageKey` VARCHAR(191) NULL,
  `uploadedBy` VARCHAR(191) NULL,
  `siteId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `CmsMedia_siteId_createdAt_idx`(`siteId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CmsChangelogEntry` (
  `id` VARCHAR(191) NOT NULL,
  `version` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `body` LONGTEXT NOT NULL,
  `kind` VARCHAR(191) NOT NULL DEFAULT 'release',
  `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `siteId` VARCHAR(191) NULL,
  INDEX `CmsChangelogEntry_publishedAt_idx`(`publishedAt`),
  INDEX `CmsChangelogEntry_siteId_idx`(`siteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CmsContactSubmission` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(191) NULL,
  `company` VARCHAR(191) NULL,
  `message` LONGTEXT NOT NULL,
  `pageSlug` VARCHAR(191) NULL,
  `leadId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `CmsContactSubmission_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- M:N relation table for CmsPost ↔ CmsTag. Prisma generates this
-- implicitly from the @relation("PostTags") name.
CREATE TABLE `_CmsPostTags` (
  `A` VARCHAR(191) NOT NULL,
  `B` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `_CmsPostTags_AB_unique`(`A`, `B`),
  INDEX `_CmsPostTags_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign keys
ALTER TABLE `CmsAuthor` ADD CONSTRAINT `CmsAuthor_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `CmsSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CmsTag` ADD CONSTRAINT `CmsTag_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `CmsSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CmsPage` ADD CONSTRAINT `CmsPage_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `CmsSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CmsPost` ADD CONSTRAINT `CmsPost_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `CmsSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CmsPost` ADD CONSTRAINT `CmsPost_authorId_fkey`
  FOREIGN KEY (`authorId`) REFERENCES `CmsAuthor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CmsNavItem` ADD CONSTRAINT `CmsNavItem_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `CmsSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CmsNavItem` ADD CONSTRAINT `CmsNavItem_parentId_fkey`
  FOREIGN KEY (`parentId`) REFERENCES `CmsNavItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CmsBlock` ADD CONSTRAINT `CmsBlock_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `CmsSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CmsMedia` ADD CONSTRAINT `CmsMedia_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `CmsSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CmsChangelogEntry` ADD CONSTRAINT `CmsChangelogEntry_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `CmsSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `_CmsPostTags` ADD CONSTRAINT `_CmsPostTags_A_fkey`
  FOREIGN KEY (`A`) REFERENCES `CmsPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `_CmsPostTags` ADD CONSTRAINT `_CmsPostTags_B_fkey`
  FOREIGN KEY (`B`) REFERENCES `CmsTag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;