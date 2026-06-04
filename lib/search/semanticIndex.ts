import { createHash } from "node:crypto";

// The single corpus whose verses are embedded for semantic search. Other English
// translations added later are display-only, resolved by reference.
export const SEMANTIC_INDEX_CORPUS = "WEB" as const;
export const EMBEDDING_MODEL = "text-embedding-3-small";

export function embeddingTextHash(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

// Render a JS number[] as a pgvector text literal: "[0.1,0.2,...]".
export function formatVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
