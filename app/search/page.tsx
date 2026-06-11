import { DismissibleIntro } from "@/components/DismissibleIntro";
import { SearchPanel, SearchPanelResult } from "@/components/SearchPanel";
import { searchStateKey } from "@/lib/searchStateKey";
import { requirePageAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parsePositiveInt } from "@/lib/params";
import { bookName } from "@/lib/references";
import { querySearchLabel, scopeSuffix } from "@/lib/searchLabel";
import { getAvailableReaderBooks, getLouwNidaDomainOptions, searchDomain, searchKeyword, searchLemma, searchMorphology } from "@/lib/search";
import type { DomainOptions } from "@/lib/search";
import { normalizeSearchMode } from "@/lib/searchMode";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await requirePageAuth();
  const params = await searchParams;
  const mode = normalizeSearchMode(getParam(params.mode));
  const query = getParam(params.q) ?? "";
  const book = getParam(params.book) ?? "";
  const chapter = getParam(params.chapter) ?? "";
  // A chapter filter without a book is unreachable from the form (the chapter
  // input is disabled until a book is chosen) and would filter invisibly —
  // scopeSuffix omits it and the input can't display it. Ignore it.
  const parsedChapter = book ? parsePositiveInt(chapter) : undefined;
  // Mirror the server-side rule in the UI state: a chapter without a book is ignored,
  // so don't let it linger in the (disabled) input or the remount key either.
  const effectiveChapter = book ? chapter : "";
  const requestedPage = parsePositiveInt(getParam(params.page)) ?? 1;
  const pageSize = Math.min(parsePositiveInt(getParam(params.pageSize)) ?? 25, 100);
  const matchMode = getParam(params.matchMode) === "prefix" ? "prefix" : "exact";
  const domain = getParam(params.domain) ?? "";
  const subdomain = getParam(params.subdomain) ?? "";
  const ln = getParam(params.ln) ?? "";

  let results: SearchPanelResult[] = [];
  let count = 0;
  let pageCount = 0;
  let page = requestedPage;
  let hasSearch = false;
  let searchLabel = "";

  const domainOptions = await getLouwNidaDomainOptions();

  // Helper: fetch with requestedPage; if the result's pageCount is smaller,
  // clamp to the last valid page and refetch so we never render an empty offset.
  // Normal requests (requestedPage ≤ pageCount) take exactly one fetch.
  // Zero-result searches (pageCount 0) clamp to 1; if requestedPage was already
  // 1 a refetch is harmless (same args), and for requestedPage > 1 with 0
  // results the refetch returns empty again — correct behaviour.
  async function fetchClamped<T extends { pagination: { pageCount: number } }>(
    run: (page: number) => Promise<T>
  ): Promise<{ search: T; page: number }> {
    let search = await run(requestedPage);
    const clamped = Math.min(requestedPage, Math.max(search.pagination.pageCount, 1));
    if (clamped !== requestedPage) search = await run(clamped);
    return { search, page: clamped };
  }

  if (mode === "domain" && (domain || subdomain || ln)) {
    const { search, page: clampedPage } = await fetchClamped((p) =>
      searchDomain({
        domain: domain || undefined,
        subdomain: subdomain || undefined,
        ln: ln || undefined,
        book: book || undefined,
        chapter: parsedChapter,
        page: p,
        pageSize
      })
    );
    count = search.count;
    pageCount = search.pagination.pageCount;
    results = search.results.map((result) => ({ kind: "token" as const, ...result }));
    hasSearch = true;
    searchLabel = domainSearchLabel(search.filter, domainOptions) + scopeSuffix(book, parsedChapter);
    page = clampedPage;
  } else if (query.trim()) {
    if (mode === "lemma") {
      const { search, page: clampedPage } = await fetchClamped((p) =>
        searchLemma({ lemma: query, book: book || undefined, chapter: parsedChapter, page: p, pageSize })
      );
      count = search.count;
      pageCount = search.pagination.pageCount;
      results = search.results.map((result) => ({ kind: "token" as const, ...result }));
      page = clampedPage;
    } else if (mode === "morphology") {
      const { search, page: clampedPage } = await fetchClamped((p) =>
        searchMorphology({
          morphCode: query,
          matchMode,
          book: book || undefined,
          chapter: parsedChapter,
          page: p,
          pageSize
        })
      );
      count = search.count;
      pageCount = search.pagination.pageCount;
      results = search.results.map((result) => ({ kind: "token" as const, ...result }));
      page = clampedPage;
    } else {
      const { search, page: clampedPage } = await fetchClamped((p) =>
        searchKeyword({ query, book: book || undefined, chapter: parsedChapter, page: p, pageSize })
      );
      count = search.pagination.total;
      pageCount = search.pagination.pageCount;
      results = search.results.map((result) => ({ kind: "keyword" as const, ...result }));
      page = clampedPage;
    }

    hasSearch = true;
    searchLabel = querySearchLabel(mode, query, book, parsedChapter);
  }

  const [books, savedSearches] = await Promise.all([
    getAvailableReaderBooks(),
    prisma.savedSearch.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 25
    })
  ]);

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-accent-700">
          Lexical &amp; Morphological
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950">Search</h1>
        <DismissibleIntro id="search">
          Search verses by keyword, Greek tokens by lemma, or morphology codes by exact or prefix match.
        </DismissibleIntro>
      </div>
      <SearchPanel
        key={searchStateKey({ mode, query, book, chapter: effectiveChapter, matchMode, domain, subdomain, ln })}
        mode={mode}
        query={query}
        book={book}
        chapter={effectiveChapter}
        matchMode={matchMode}
        domain={domain}
        subdomain={subdomain}
        ln={ln}
        domainOptions={domainOptions}
        hasSearch={hasSearch}
        searchLabel={searchLabel}
        page={page}
        pageSize={pageSize}
        count={count}
        pageCount={pageCount}
        results={results}
        books={books.map((item) => ({ osisId: item.osisId, label: bookName(item.osisId) }))}
        savedSearches={savedSearches.map((item) => ({
          id: item.id,
          label: item.label,
          mode: item.mode,
          query: item.query,
          book: item.book,
          chapter: item.chapter,
          matchMode: item.matchMode
        }))}
      />
    </div>
  );
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function domainSearchLabel(
  filter: { kind: "ln" | "subdomain" | "domain"; value: string } | null,
  options: DomainOptions
): string {
  if (!filter) return "";
  if (filter.kind === "ln") return `LN ${filter.value}`;
  if (filter.kind === "subdomain") {
    const parent = filter.value.slice(0, 3);
    const sub = options.subdomainsByDomain[parent]?.find((s) => s.code === filter.value);
    return sub ? `Subdomain: ${sub.label}` : `Subdomain ${filter.value}`;
  }
  const domain = options.domains.find((d) => d.code === filter.value);
  return domain ? `Domain ${domain.number} — ${domain.label}` : `Domain ${Number.parseInt(filter.value, 10)}`;
}
