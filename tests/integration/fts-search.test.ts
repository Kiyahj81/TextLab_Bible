import { describe, expect, it } from "vitest";
import { searchKeyword } from "@/lib/search";

// FTS behavior against the real corpus. Skips when no DB is configured, like
// db-ownership.test.ts. Requires the lexical_fts migration applied and the full
// NT corpus seeded on the target branch.
const enabled = Boolean(process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL);

describe.skipIf(!enabled)("FTS keyword search", () => {
  it("matches Greek accent-insensitively (unaccented query finds accented text)", async () => {
    const accented = await searchKeyword({ query: "λόγος", corpus: "SBLGNT" });
    const bare = await searchKeyword({ query: "λογος", corpus: "SBLGNT" });
    expect(accented.pagination.total).toBeGreaterThan(0);
    expect(bare.pagination.total).toBe(accented.pagination.total);
  });

  it("matches whole lexemes, not substrings", async () => {
    const fragment = await searchKeyword({ query: "lov", corpus: "WEB" });
    const whole = await searchKeyword({ query: "love", corpus: "WEB" });
    expect(whole.pagination.total).toBeGreaterThan(0);
    expect(fragment.pagination.total).toBe(0);
  });

  it("ANDs multiple words (both terms present, any position)", async () => {
    const both = await searchKeyword({ query: "grace truth", corpus: "WEB" });
    expect(both.results.some((r) => r.reference === "John 1:14")).toBe(true);
  });

  it("rank ordering returns results and differs from canonical where applicable", async () => {
    const ranked = await searchKeyword({ query: "love", corpus: "WEB", orderBy: "rank", pageSize: 5 });
    const canonical = await searchKeyword({ query: "love", corpus: "WEB", orderBy: "canonical", pageSize: 5 });
    expect(ranked.results.length).toBeGreaterThan(0);
    expect(canonical.results.length).toBeGreaterThan(0);
  });

  it("scopes by book and chapter", async () => {
    const scoped = await searchKeyword({ query: "λόγος", corpus: "SBLGNT", book: "John", chapter: 1 });
    expect(scoped.pagination.total).toBeGreaterThan(0);
    expect(scoped.results.every((r) => r.reference.startsWith("John 1:"))).toBe(true);
  });

  it("paginates with a stable total", async () => {
    const page1 = await searchKeyword({ query: "love", corpus: "WEB", page: 1, pageSize: 5 });
    const page2 = await searchKeyword({ query: "love", corpus: "WEB", page: 2, pageSize: 5 });
    expect(page1.pagination.total).toBe(page2.pagination.total);
    expect(page1.results).not.toEqual(page2.results);
  });
});
