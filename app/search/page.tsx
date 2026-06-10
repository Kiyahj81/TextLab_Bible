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

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await requirePageAuth();
  const params = await searchParams;
  const mode = getParam(params.mode) ?? "keyword";
  const query = getParam(params.q) ?? "";
  const book = getParam(params.book) ?? "";
  const chapter = getParam(params.chapter) ?? "";
  const parsedChapter = parsePositiveInt(chapter);
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

  if (mode === "domain" && (domain || subdomain || ln)) {
    const search = await searchDomain({
      domain: domain || undefined,
      subdomain: subdomain || undefined,
      ln: ln || undefined,
      book: book || undefined,
      chapter: parsedChapter,
      page: requestedPage,
      pageSize
    });
    count = search.count;
    pageCount = search.pagination.pageCount;
    results = search.results.map((result) => ({ kind: "token" as const, ...result }));
    hasSearch = true;
    searchLabel = domainSearchLabel(search.filter, domainOptions) + scopeSuffix(book, parsedChapter);
    page = Math.min(requestedPage, Math.max(pageCount, 1));
  } else if (query.trim()) {
    if (mode === "lemma") {
      const search = await searchLemma({ lemma: query, book: book || undefined, chapter: parsedChapter, page: requestedPage, pageSize });
      count = search.count;
      pageCount = search.pagination.pageCount;
      results = search.results.map((result) => ({ kind: "token" as const, ...result }));
    } else if (mode === "morphology") {
      const search = await searchMorphology({
        morphCode: query,
        matchMode,
        book: book || undefined,
        chapter: parsedChapter,
        page: requestedPage,
        pageSize
      });
      count = search.count;
      pageCount = search.pagination.pageCount;
      results = search.results.map((result) => ({ kind: "token" as const, ...result }));
    } else {
      const search = await searchKeyword({ query, book: book || undefined, chapter: parsedChapter, page: requestedPage, pageSize });
      count = search.pagination.total;
      pageCount = search.pagination.pageCount;
      results = search.results.map((result) => ({ kind: "keyword" as const, ...result }));
    }

    hasSearch = true;
    searchLabel = querySearchLabel(mode, query, book, parsedChapter);
    // Clamp the displayed page to a valid range so out-of-bounds URLs (e.g.
    // ?page=999 for a 7-page result) render the last real page instead of
    // an empty list with a Previous link that walks down through phantom pages.
    page = Math.min(requestedPage, Math.max(pageCount, 1));
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
        key={searchStateKey({ mode, query, book, chapter, matchMode, domain, subdomain, ln })}
        mode={mode}
        query={query}
        book={book}
        chapter={chapter}
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
