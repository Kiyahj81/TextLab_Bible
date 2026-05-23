import { SearchPanel, SearchPanelResult } from "@/components/SearchPanel";
import { prisma } from "@/lib/db";
import { parsePositiveInt } from "@/lib/params";
import { bookName } from "@/lib/references";
import { getAvailableReaderBooks, searchKeyword, searchLemma, searchMorphology } from "@/lib/search";
import { localUserId } from "@/lib/user";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mode = getParam(params.mode) ?? "keyword";
  const query = getParam(params.q) ?? "";
  const book = getParam(params.book) ?? "";
  const chapter = getParam(params.chapter) ?? "";
  const parsedChapter = parsePositiveInt(chapter);
  const page = parsePositiveInt(getParam(params.page)) ?? 1;
  const pageSize = Math.min(parsePositiveInt(getParam(params.pageSize)) ?? 25, 100);
  const matchMode = getParam(params.matchMode) === "prefix" ? "prefix" : "exact";

  let results: SearchPanelResult[] = [];
  let count = 0;
  let pageCount = 0;

  if (query.trim()) {
    if (mode === "lemma") {
      const search = await searchLemma({ lemma: query, book: book || undefined, chapter: parsedChapter, page, pageSize });
      count = search.count;
      pageCount = search.pagination.pageCount;
      results = search.results.map((result) => ({ kind: "token" as const, ...result }));
    } else if (mode === "morphology") {
      const search = await searchMorphology({
        morphCode: query,
        matchMode,
        book: book || undefined,
        chapter: parsedChapter,
        page,
        pageSize
      });
      count = search.count;
      pageCount = search.pagination.pageCount;
      results = search.results.map((result) => ({ kind: "token" as const, ...result }));
    } else {
      const search = await searchKeyword({ query, book: book || undefined, chapter: parsedChapter, page, pageSize });
      count = search.pagination.total;
      pageCount = search.pagination.pageCount;
      results = search.results.map((result) => ({ kind: "keyword" as const, ...result }));
    }
  }

  const [books, savedSearches] = await Promise.all([
    getAvailableReaderBooks(),
    prisma.savedSearch.findMany({
      where: { userId: localUserId },
      orderBy: { updatedAt: "desc" },
      take: 25
    })
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Search</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Search sample verses by keyword, Greek tokens by lemma, or morphology codes by exact or prefix match.
        </p>
      </div>
      <SearchPanel
        mode={mode}
        query={query}
        book={book}
        chapter={chapter}
        matchMode={matchMode}
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
