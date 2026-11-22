-- Phase 2 N: lock the widget public key to the tenant's own websites.
ALTER TABLE `Business` ADD COLUMN `widgetAllowedOrigins` JSON NULL;
