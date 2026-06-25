// tests/unit/lib/search-facade.test.ts
import { describe, it, expect } from "vitest";
import * as search from "@/lib/search";
import type {
  SearchPagination, Citation, PassageNeighbor,
  SemanticRerankStatus, SemanticRerankTrace, SemanticSearchDetailedResult,
  DomainFilter, DomainOption, DomainOptions
} from "@/lib/search";

// The EXACT runtime surface of @/lib/search as it exists today. The facade must
// re-export these and ONLY these — no internal helper (hydrateTokens,
// normalizePagination, paginationResult, PaginationInput, HydratedToken) may leak.
const RUNTIME_EXPORTS = [
  "spineKey", "filterToSblSpine",
  "embedQuery", "searchSemantic", "searchSemanticDetailed",
  "EMBEDDING_MODEL", "SEMANTIC_INDEX_CORPUS", "embeddingTextHash", "formatVectorLiteral",
  "getAvailablePassages", "getAvailableReaderBooks", "getPassageNeighbors",
  "getReaderPassage", "getPassage", "searchKeyword",
  "searchLemma", "searchMorphology", "findLemmaExamples",
  "LEMMA_STOP_WORDS", "CONTENT_PART_OF_SPEECH", "getTopLemmas",
  "normalizeDomainCode", "resolveDomainFilter", "domainTokenWhere",
  "searchDomain", "getLouwNidaDomainOptions"
].sort();

describe("@/lib/search public surface", () => {
  it("re-exports EXACTLY the original runtime symbols — none missing, no leaked internals", () => {
    expect(Object.keys(search).sort()).toEqual(RUNTIME_EXPORTS);
  });

  it("preserves the public type exports (compile-time guard)", () => {
    // `assertType`'s parameter tuple references every public type, so removing any
    // one from @/lib/search breaks `tsc --noEmit`. Types are erased at runtime, so
    // they cannot be asserted in the runtime block above. `_args` is `_`-prefixed
    // for no-unused-vars; `assertType` is consumed by the expect below.
    const assertType = (..._args: [
      SearchPagination, Citation, PassageNeighbor,
      SemanticRerankStatus, SemanticRerankTrace, SemanticSearchDetailedResult,
      DomainFilter, DomainOption, DomainOptions
    ]) => undefined;
    expect(typeof assertType).toBe("function");
  });
});
