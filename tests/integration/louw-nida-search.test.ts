import { describe, expect, it } from "vitest";
import { searchDomain, getLouwNidaDomainOptions } from "@/lib/search";
import { prisma } from "@/lib/db";

const itDb = process.env.DATABASE_URL ? it : it.skip;

describe("Louw-Nida domain search (integration)", () => {
  itDb("created the louwNida GIN index with the intended shape", async () => {
    // Assert the full contract, not just the name: a same-named but wrong index
    // (e.g. a btree, or on the wrong column) would otherwise pass with IF NOT EXISTS.
    const rows = await prisma.$queryRaw<{ tablename: string; indexdef: string }[]>`
      SELECT tablename, indexdef FROM pg_indexes WHERE indexname = 'Token_louwNida_idx'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].tablename).toBe("Token");
    expect(rows[0].indexdef).toMatch(/USING gin/i);
    expect(rows[0].indexdef).toContain('"louwNida"');
  });

  itDb("returns tokens for an exact LN reference", async () => {
    const res = await searchDomain({ ln: "33.55", pageSize: 5 });
    expect(res.count).toBeGreaterThan(0);
    expect(res.results.every((r) => typeof r.surface === "string")).toBe(true);
  });

  itDb("result rows carry a non-empty gloss from hydrateTokens", async () => {
    const res = await searchDomain({ ln: "33.55", pageSize: 5 });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.some((r) => typeof r.gloss === "string" && r.gloss.length > 0)).toBe(true);
  });

  itDb("returns tokens for an exact subdomain code", async () => {
    const res = await searchDomain({ subdomain: "033006", pageSize: 5 });
    expect(res.count).toBeGreaterThan(0);
  });

  itDb("returns more for a whole domain than for one of its subdomains", async () => {
    const whole = await searchDomain({ domain: "033", pageSize: 1 });
    const sub = await searchDomain({ subdomain: "033006", pageSize: 1 });
    expect(whole.count).toBeGreaterThan(sub.count);
    expect(whole.count).toBeGreaterThan(0);
  });

  itDb("scopes by book", async () => {
    const all = await searchDomain({ domain: "033", pageSize: 1 });
    const john = await searchDomain({ domain: "033", book: "John", pageSize: 1 });
    expect(john.count).toBeGreaterThan(0);
    expect(john.count).toBeLessThanOrEqual(all.count);
  });

  itDb("exposes 93 domain options sorted by number", async () => {
    const opts = await getLouwNidaDomainOptions();
    expect(opts.domains.length).toBe(93);
    expect(opts.domains[0].number).toBe(1);
    expect(opts.subdomainsByDomain["033"]?.length ?? 0).toBeGreaterThan(0);
  });
});
