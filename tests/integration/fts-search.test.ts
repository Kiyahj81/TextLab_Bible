import { describe, expect, it } from "vitest";
import { searchKeyword } from "@/lib/search";

// FTS behavior against the real corpus. Skips when no DB is configured.
// Requires the lexical_fts migration applied and the full NT corpus seeded on
// the target branch.
//
// Unlike db-ownership.test.ts (which builds its own PrismaClient pointed at
// DATABASE_URL_TEST), this suite calls the real `searchKeyword`, which uses the
// shared prisma singleton (@/lib/db). That client reads DATABASE_URL only, so we
// gate on the same variable — otherwise setting only DATABASE_URL_TEST would
// enable the suite but run queries against the wrong DB (or crash with no URL).
// `npm run test:integration` loads .env.test, pointing DATABASE_URL at the
// integration-acceptance test branch.
const enabled = Boolean(process.env.DATABASE_URL);

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

  it("rank ordering returns results in a different order than canonical", async () => {
    const ranked = await searchKeyword({ query: "love", corpus: "WEB", orderBy: "rank", pageSize: 5 });
    const canonical = await searchKeyword({ query: "love", corpus: "WEB", orderBy: "canonical", pageSize: 5 });
    expect(ranked.results.length).toBeGreaterThan(0);
    expect(canonical.results.length).toBeGreaterThan(0);
    // "love" is densest in late-canon books (1 John, 1 Cor), so ts_rank must
    // surface a different top-5 than canonical (Matthew-first) order. This makes
    // the assertion a real signal for the rank feature, not just a non-empty check.
    expect(ranked.results).not.toEqual(canonical.results);
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

  it("stems English: a 'love' search includes inflections like 'loved'", async () => {
    const love = await searchKeyword({ query: "love", corpus: "WEB", pageSize: 100 });
    const refs = love.results.map((r) => r.reference);
    expect(love.pagination.total).toBeGreaterThan(0);
    // A verse whose surface form is "loved" (not the bare word "love").
    expect(refs).toContain("John 3:16"); // "God so loved the world"
  });

  it("does not match a different stem: 'love' excludes 'beloved'-only verses", async () => {
    const love = await searchKeyword({ query: "love", corpus: "WEB", book: "3John", pageSize: 100 });
    const beloved = await searchKeyword({ query: "beloved", corpus: "WEB", book: "3John", pageSize: 100 });
    const loveRefs = new Set(love.results.map((r) => r.reference));
    // 3John 1:2 ("Beloved, I pray…") contains "beloved" but no love-stem word.
    expect(beloved.results.some((r) => r.reference === "3John 1:2")).toBe(true);
    expect(loveRefs.has("3John 1:2")).toBe(false);
  });

  it("highlights the stemmed inflection (segments contain a match)", async () => {
    const love = await searchKeyword({ query: "love", corpus: "WEB", pageSize: 100 });
    const john316 = love.results.find((r) => r.reference === "John 3:16");
    expect(john316?.highlightSegments?.some((s) => s.kind === "match")).toBe(true);
  });

  it("leaves Greek matching unchanged (whole-lexeme λόγος)", async () => {
    const greek = await searchKeyword({ query: "λόγος", corpus: "SBLGNT" });
    expect(greek.pagination.total).toBeGreaterThan(0);
    // Still whole-lexeme: a fragment does not match.
    const fragment = await searchKeyword({ query: "λογ", corpus: "SBLGNT" });
    expect(fragment.pagination.total).toBe(0);
  });
});
