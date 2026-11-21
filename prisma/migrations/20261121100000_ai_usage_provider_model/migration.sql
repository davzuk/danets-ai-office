-- ─── AI provider layer: per-call provider/model on AiUsageLog ──────
-- Adds the columns needed for per-model pricing and cache accounting.
-- All additive with defaults, so existing rows (all z-ai) stay valid.
ALTER TABLE `AiUsageLog`
  ADD COLUMN `provider` VARCHAR(191) NOT NULL DEFAULT 'zai',
  ADD COLUMN `model` VARCHAR(191) NULL,
  ADD COLUMN `cacheReadTokens` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `cacheWriteTokens` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `latencyMs` INTEGER NULL;
