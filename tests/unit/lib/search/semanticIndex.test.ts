import { describe, expect, it } from "vitest";

import {
  EMBEDDING_MODEL,
  SEMANTIC_INDEX_CORPUS,
  embeddingTextHash,
  formatVectorLiteral
} from "@/lib/search/semanticIndex";

describe("semantic index helpers", () => {
  it("centralizes the semantic index corpus and embedding model", () => {
    expect(SEMANTIC_INDEX_CORPUS).toBe("WEB");
    expect(EMBEDDING_MODEL).toBe("text-embedding-3-small");
  });

  it("hashes normalized embedding text consistently", () => {
    expect(embeddingTextHash(" In the beginning ")).toBe(embeddingTextHash("In the beginning"));
    expect(embeddingTextHash("In the beginning")).not.toBe(embeddingTextHash("In the end"));
  });

  it("renders vectors as pgvector literals", () => {
    expect(formatVectorLiteral([0.1, 0.2, -0.3])).toBe("[0.1,0.2,-0.3]");
  });
});
