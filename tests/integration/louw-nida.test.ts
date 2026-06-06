import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

const itDb = process.env.DATABASE_URL ? it : it.skip;

describe("Louw-Nida enrichment (integration)", () => {
  itDb("seeds the LouwNidaDomain reference table with domain 33 = Communication", async () => {
    const domain = await prisma.louwNidaDomain.findUnique({ where: { code: "033" } });
    expect(domain?.label).toBe("Communication");
    expect(domain?.level).toBe(1);
    expect(domain?.parentCode).toBeNull();
  });

  itDb("attaches domain/ln codes to John 1:1 λόγος", async () => {
    const token = await prisma.token.findFirst({
      where: { lemma: "λόγος", book: { osisId: "John" }, chapter: 1, verse: 1 },
      select: { louwNida: true, lnDomain: true }
    });
    expect(token).not.toBeNull();
    expect(token!.lnDomain.length).toBeGreaterThan(0);
    expect(token!.louwNida.length).toBeGreaterThan(0);
  });

  itDb("supports GIN array-membership queries on lnDomain", async () => {
    const count = await prisma.token.count({ where: { lnDomain: { has: "033006" } } });
    expect(count).toBeGreaterThan(0);
  });

  // Regression for the MACULA-only insert/upsert path. This test must run on a
  // branch where John 7:53 had zero SBLGNT tokens before the MACULA import,
  // because MorphGNT omits the Pericope Adulterae and MACULA inserts it. The upstream MACULA row for
  // 7:53!1 (Καὶ) carries domain 091001 / ln 91.1, so asserting the EXACT values proves the
  // insert path wrote the parsed arrays through — not merely the schema's @default([]) empty
  // array (which an Array.isArray check would pass even if the insert forgot the fields).
  itDb("persists parsed code arrays on inserted Pericope Adulterae tokens", async () => {
    const token = await prisma.token.findFirst({
      where: { book: { osisId: "John" }, chapter: 7, verse: 53, wordIndex: 1 },
      select: { surface: true, louwNida: true, lnDomain: true }
    });
    expect(token).not.toBeNull();
    expect(token!.lnDomain).toContain("091001");
    expect(token!.louwNida).toContain("91.1");
  });
});
