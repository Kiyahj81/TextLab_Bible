// tests/integration/passage-tokens.test.ts
import { describe, expect, it } from "vitest";
import { getPassageTokens } from "@/lib/search";

const dbConfigured = Boolean(process.env.DATABASE_URL);
const d = dbConfigured ? describe : describe.skip;

d("getPassageTokens (integration)", () => {
  it("returns enriched SBLGNT tokens for John 1:1 in word order", async () => {
    const rows = await getPassageTokens({ book: "John", chapter: 1, verseStart: 1, verseEnd: 1 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.verse === 1)).toBe(true);
    for (let i = 1; i < rows.length; i++) expect(rows[i].wordIndex).toBeGreaterThanOrEqual(rows[i - 1].wordIndex);
    const logos = rows.find((r) => r.lemma === "λόγος");
    expect(logos?.surface).toBeTruthy();
    expect(logos?.morphCode).toBeTruthy();
  });
});
