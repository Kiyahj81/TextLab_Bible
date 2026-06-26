import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeBook } from "@/lib/references";
import {
  hydrateTokens, normalizePagination, paginationResult, type PaginationInput
} from "@/lib/search/shared";

export type DomainFilter =
  | { kind: "ln"; value: string }
  | { kind: "subdomain"; value: string }
  | { kind: "domain"; value: string };

// "33" → "033"; "0033" → "033". Strips non-digits, then takes the rightmost 3 digits
// and left-pads to 3 so hand-authored URLs (e.g. ?domain=0033) still match the canonical
// 3-digit Louw-Nida domain codes. Empty/non-digit input collapses to "000" (matches nothing).
export function normalizeDomainCode(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-3).padStart(3, "0");
}

// Most-specific filter wins: ln → subdomain → domain.
export function resolveDomainFilter(input: { ln?: string; subdomain?: string; domain?: string }): DomainFilter | null {
  const ln = input.ln?.trim();
  if (ln) return { kind: "ln", value: ln };
  const subdomain = input.subdomain?.trim();
  if (subdomain) return { kind: "subdomain", value: subdomain };
  const domain = input.domain?.trim();
  if (domain) return { kind: "domain", value: normalizeDomainCode(domain) };
  return null;
}

// `domainCodes` is the expanded [domain code + its subdomain codes]; only used for the domain kind.
export function domainTokenWhere(filter: DomainFilter, domainCodes: string[]): Prisma.TokenWhereInput {
  if (filter.kind === "ln") return { louwNida: { has: filter.value } };
  if (filter.kind === "subdomain") return { lnDomain: { has: filter.value } };
  return { lnDomain: { hasSome: domainCodes } };
}

export async function searchDomain(
  input: {
    domain?: string;
    subdomain?: string;
    ln?: string;
    corpus?: "SBLGNT";
    book?: string;
    chapter?: number;
    withEnglish?: boolean;
  } & PaginationInput
) {
  const filter = resolveDomainFilter(input);
  const book = normalizeBook(input.book);
  const pagination = normalizePagination(input);
  const empty = {
    filter,
    count: 0,
    results: [] as Awaited<ReturnType<typeof hydrateTokens>>,
    pagination: { ...pagination, total: 0, pageCount: 0 }
  };

  if (!filter) return empty;

  let domainCodes: string[] = [];
  if (filter.kind === "domain") {
    const rows = await prisma.louwNidaDomain.findMany({
      where: { OR: [{ code: filter.value }, { parentCode: filter.value }] },
      select: { code: true }
    });
    domainCodes = rows.map((r) => r.code);
    if (domainCodes.length === 0) return empty;
  }

  const where: Prisma.TokenWhereInput = {
    ...domainTokenWhere(filter, domainCodes),
    corpus: { abbreviation: input.corpus ?? "SBLGNT" },
    book: book ? { osisId: book } : undefined,
    chapter: input.chapter
  };

  // `gloss` is a scalar column returned by default; surfaced via hydrateTokens for evidence.
  const [total, tokens] = await Promise.all([
    prisma.token.count({ where }),
    prisma.token.findMany({
      where,
      include: { book: true, corpus: true },
      orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }, { verse: "asc" }, { wordIndex: "asc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize
    })
  ]);

  const results = await hydrateTokens(tokens, input.withEnglish);

  return { filter, count: total, pagination: paginationResult(pagination, total), results };
}

export type DomainOption = { code: string; number: number; label: string };
export type DomainOptions = {
  domains: DomainOption[];
  subdomainsByDomain: Record<string, { code: string; label: string }[]>;
};

export async function getLouwNidaDomainOptions(): Promise<DomainOptions> {
  const rows = await prisma.louwNidaDomain.findMany({
    where: { level: { in: [1, 2] } },
    select: { code: true, level: true, label: true, parentCode: true }
  });
  const domains = rows
    .filter((r) => r.level === 1)
    .map((r) => ({ code: r.code, number: Number.parseInt(r.code, 10), label: r.label }))
    .sort((a, b) => a.number - b.number);
  const subdomainsByDomain: Record<string, { code: string; label: string }[]> = {};
  for (const r of rows) {
    if (r.level === 2 && r.parentCode) {
      (subdomainsByDomain[r.parentCode] ??= []).push({ code: r.code, label: r.label });
    }
  }
  for (const code of Object.keys(subdomainsByDomain)) {
    subdomainsByDomain[code].sort((a, b) => a.code.localeCompare(b.code));
  }
  return { domains, subdomainsByDomain };
}
