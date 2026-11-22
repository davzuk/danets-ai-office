-- Integration.config and WhatsAppIntegration.apiKey hold encrypted API keys
-- (AES-GCM envelopes of 200+ chars), which VARCHAR(191) truncated or rejected.
ALTER TABLE `Integration` MODIFY `config` TEXT NULL;
ALTER TABLE `WhatsAppIntegration` MODIFY `apiKey` TEXT NULL;
