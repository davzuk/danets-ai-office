-- Composite (businessId, createdAt) indexes for tenant-scoped list endpoints.
--
-- Every list endpoint queries `WHERE businessId = ? ORDER BY createdAt DESC`.
-- Without this compound index, MySQL does a filesort on every page load,
-- which costs 200-500ms once a tenant has 50k+ rows. This migration adds
-- the index for the hot-path models: Lead, ChatSession, QuoteRequest,
-- SupportTicket, AutomationRun, Payment, Invoice, ActivityLog,
-- Notification, AiUsageLog, KnowledgeBaseItem, Document, WhatsAppMessage.

CREATE INDEX `Lead_businessId_createdAt_idx` ON `Lead`(`businessId`, `createdAt`);
CREATE INDEX `ChatSession_businessId_createdAt_idx` ON `ChatSession`(`businessId`, `createdAt`);
CREATE INDEX `QuoteRequest_businessId_createdAt_idx` ON `QuoteRequest`(`businessId`, `createdAt`);
CREATE INDEX `SupportTicket_businessId_createdAt_idx` ON `SupportTicket`(`businessId`, `createdAt`);
CREATE INDEX `AutomationRun_businessId_createdAt_idx` ON `AutomationRun`(`businessId`, `createdAt`);
CREATE INDEX `Payment_businessId_createdAt_idx` ON `Payment`(`businessId`, `createdAt`);
CREATE INDEX `Invoice_businessId_createdAt_idx` ON `Invoice`(`businessId`, `createdAt`);
CREATE INDEX `ActivityLog_businessId_createdAt_idx` ON `ActivityLog`(`businessId`, `createdAt`);
CREATE INDEX `Notification_businessId_createdAt_idx` ON `Notification`(`businessId`, `createdAt`);
CREATE INDEX `AiUsageLog_businessId_createdAt_idx` ON `AiUsageLog`(`businessId`, `createdAt`);
CREATE INDEX `KnowledgeBaseItem_businessId_status_idx` ON `KnowledgeBaseItem`(`businessId`, `status`);
CREATE INDEX `Document_businessId_createdAt_idx` ON `Document`(`businessId`, `createdAt`);
CREATE INDEX `WhatsAppMessage_businessId_createdAt_idx` ON `WhatsAppMessage`(`businessId`, `createdAt`);
CREATE INDEX `ChatMessage_sessionId_createdAt_idx` ON `ChatMessage`(`sessionId`, `createdAt`);
CREATE INDEX `ProposalItem_quoteRequestId_sortOrder_idx` ON `ProposalItem`(`quoteRequestId`, `sortOrder`);