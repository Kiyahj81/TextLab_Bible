import { SearchPanel, SearchPanelResult } from "@/components/SearchPanel";
import { searchKeyword, searchLemma, searchMorphology } from "@/lib/search";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mode = getParam(params.mode) ?? "keyword";
  const query = getParam(params.q) ?? "";
  const book = getParam(params.book) ?? "";
  const matchMode = getParam(params.matchMode) === "prefix" ? "prefix" : "exact";

  let results: SearchPanelResult[] = [];
  let count = 0;

  if (query.trim()) {
    if (mode === "lemma") {
      const search = await searchLemma({ lemma: query, book: book || undefined });
      count = search.count;
      results = search.results.map((result) => ({ kind: "token" as const, ...result }));
    } else if (mode === "morphology") {
      const search = await searchMorphology({
        morphCode: query,
        matchMode,
        book: book || undefined
      });
      count = search.count;
      results = search.results.map((result) => ({ kind: "token" as const, ...result }));
    } else {
      const search = await searchKeyword({ query, book: book || undefined });
      count = search.results.length;
      results = search.results.map((result) => ({ kind: "keyword" as const, ...result }));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Search</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Search sample verses by keyword, Greek tokens by lemma, or morphology codes by exact or prefix match.
        </p>
      </div>
      <SearchPanel mode={mode} query={query} book={book} matchMode={matchMode} count={count} results={results} />
    </div>
  );
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
