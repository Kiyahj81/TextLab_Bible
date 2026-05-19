import { Search } from "lucide-react";

export type SearchPanelResult =
  | {
      kind: "keyword";
      corpus: string;
      reference: string;
      text: string;
    }
  | {
      kind: "token";
      corpus: string;
      reference: string;
      surface: string;
      lemma: string;
      morphCode: string;
      verseText: string;
    };

export function SearchPanel({
  mode,
  query,
  book,
  matchMode,
  count,
  results
}: {
  mode: string;
  query: string;
  book: string;
  matchMode: string;
  count: number;
  results: SearchPanelResult[];
}) {
  return (
    <div className="space-y-6">
      <form className="rounded-md border border-stone-300 bg-white p-4 shadow-sm" action="/search">
        <div className="grid gap-3 md:grid-cols-[160px_1fr_150px_150px_auto]">
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</span>
            <select name="mode" defaultValue={mode} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm">
              <option value="keyword">Keyword</option>
              <option value="lemma">Lemma</option>
              <option value="morphology">Morphology</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Query</span>
            <input
              name="q"
              defaultValue={query}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
              placeholder="λόγος, N-NSM, righteousness"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Book</span>
            <select name="book" defaultValue={book} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm">
              <option value="">All sample books</option>
              <option value="John">John</option>
              <option value="Rom">Romans</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Morph match</span>
            <select
              name="matchMode"
              defaultValue={matchMode}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
            >
              <option value="exact">Exact</option>
              <option value="prefix">Prefix</option>
            </select>
          </label>
          <button className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white md:self-end">
            <Search size={16} />
            Search
          </button>
        </div>
      </form>

      <section className="rounded-md border border-stone-300 bg-white shadow-sm">
        <div className="border-b border-stone-200 p-4">
          <h2 className="font-semibold text-slate-950">Results</h2>
          <p className="mt-1 text-sm text-slate-600">
            {query ? `${count} result${count === 1 ? "" : "s"} for "${query}"` : "Enter a search query."}
          </p>
        </div>
        <div className="divide-y divide-stone-200">
          {results.map((result, index) => (
            <article key={`${result.reference}-${index}`} className="p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-slate-950">{result.reference}</span>
                <span className="rounded bg-stone-100 px-2 py-1 text-xs text-slate-600">{result.corpus}</span>
                {result.kind === "token" ? (
                  <span className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-900">{result.morphCode}</span>
                ) : null}
              </div>
              {result.kind === "token" ? (
                <div className="mt-2 grid gap-3 lg:grid-cols-[180px_1fr]">
                  <div className="greek-text text-xl text-slate-950">
                    {result.surface}
                    <div className="mt-1 text-sm text-slate-600">lemma: {result.lemma}</div>
                  </div>
                  <p className="greek-text leading-7 text-slate-800">{result.verseText}</p>
                </div>
              ) : (
                <p className="mt-2 leading-7 text-slate-800">{result.text}</p>
              )}
            </article>
          ))}
          {query && results.length === 0 ? (
            <div className="p-4 text-sm text-slate-600">No matching sample-data results.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
