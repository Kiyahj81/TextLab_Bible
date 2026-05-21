-- Rename AiMessage.citations to AiMessage.metadata to better reflect the
-- structured payload (mode, modelRole, modelUsed, routingDecision,
-- recommendedUpgrade, toolTrace, citations) now persisted alongside each
-- assistant turn. RENAME preserves the existing JSONB values in the column.
ALTER TABLE "public"."AiMessage" RENAME COLUMN "citations" TO "metadata";
