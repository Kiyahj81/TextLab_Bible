"use client";

import Link from "next/link";
import { BookmarkPlus, Search } from "lucide-react";
import { useState } from "react";

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

export type SavedSearchRow = {
  id: string;
  label: string;
  mode: string;
  query: string;
  book: string | null;
  chapter: number | null;
  matchMode: string | null;
};

export type SearchBookOption = {
  osisId: string;
  label: string;
};

export function SearchPanel({
  mode,
  query,
  book,
  chapter,
  matchMode,
  page,
  pageSize,
  count,
  pageCount,
  results,
  books,
  savedSearches
}: {
  mode: string;
  query: string;
  book: string;
  chapter: string;
  matchMode: string;
  page: number;
  pageSize: number;
  count: number;
  pageCount: number;
  results: SearchPanelResult[];
  books: SearchBookOption[];
  savedSearches: SavedSearchRow[];
}) {
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(savedSearches);

  async function saveSearch() {
    if (!query.trim()) return;
    if (saving) return;

    setSaving(true);
    setSaveStatus("Saving...");
    try {
      const response = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, query, book, chapter, matchMode, pageSize })
      });

      if (!response.ok) {
        setSaveStatus("Could not save search.");
        return;
      }

      const body = await response.json();
      setSaved((current) => [body.savedSearch, ...current].slice(0, 25));
      setSaveStatus("Search saved.");
    } catch {
      setSaveStatus("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const previousPage = Math.max(page - 1, 1);
  const nextPage = Math.min(page + 1, Math.max(pageCount, 1));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
      <form className="rounded-md border border-stone-300 bg-white p-4 shadow-sm" action="/search">
        <div className="grid gap-3 md:grid-cols-[150px_1fr_150px_120px_150px_120px_auto]">
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
              <option value="">All books</option>
              {books.map((bookOption) => (
                <option key={bookOption.osisId} value={bookOption.osisId}>
                  {bookOption.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chapter</span>
            <input
              name="chapter"
              defaultValue={chapter}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
              placeholder="Any"
            />
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
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page size</span>
            <input
              name="pageSize"
              type="number"
              min="1"
              max="100"
              defaultValue={pageSize}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
            />
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
            {query
              ? `${count} result${count === 1 ? "" : "s"} for "${query}"${pageCount ? `, page ${page} of ${pageCount}` : ""}`
              : "Enter a search query."}
          </p>
          {query ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveSearch}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BookmarkPlus size={16} />
                Save search
              </button>
              {saveStatus ? <span className="text-sm text-slate-600">{saveStatus}</span> : null}
            </div>
          ) : null}
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
        {query && pageCount > 1 ? (
          <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 p-4 text-sm">
            <Link
              className={`rounded-md border border-stone-300 px-3 py-2 ${
                page <= 1 ? "pointer-events-none opacity-50" : "hover:border-slate-500"
              }`}
              href={searchHref({ mode, query, book, chapter, matchMode, page: previousPage, pageSize })}
            >
              Previous
            </Link>
            <span className="text-slate-600">
              Showing {results.length} of {count}
            </span>
            <Link
              className={`rounded-md border border-stone-300 px-3 py-2 ${
                page >= pageCount ? "pointer-events-none opacity-50" : "hover:border-slate-500"
              }`}
              href={searchHref({ mode, query, book, chapter, matchMode, page: nextPage, pageSize })}
            >
              Next
            </Link>
          </nav>
        ) : null}
      </section>
      </div>

      <aside className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-950">Saved searches</h2>
        <div className="mt-3 space-y-2">
          {saved.map((item) => (
            <Link
              key={item.id}
              href={searchHref({
                mode: item.mode,
                query: item.query,
                book: item.book ?? "",
                chapter: item.chapter ? String(item.chapter) : "",
                matchMode: item.matchMode ?? "exact",
                page: 1,
                pageSize
              })}
              className="block rounded-md border border-stone-200 p-3 text-sm hover:border-slate-400"
            >
              <span className="font-medium text-slate-950">{item.label}</span>
              <span className="mt-1 block text-xs text-slate-500">
                {item.mode} {item.book ? `in ${item.book}` : "in all books"}
              </span>
            </Link>
          ))}
          {saved.length === 0 ? <p className="text-sm text-slate-600">No saved searches yet.</p> : null}
        </div>
      </aside>
    </div>
  );
}

function searchHref({
  mode,
  query,
  book,
  chapter,
  matchMode,
  page,
  pageSize
}: {
  mode: string;
  query: string;
  book: string;
  chapter: string;
  matchMode: string;
  page: number;
  pageSize: number;
}) {
  const params = new URLSearchParams({
    mode,
    q: query,
    matchMode,
    page: String(page),
    pageSize: String(pageSize)
  });

  if (book) params.set("book", book);
  if (chapter) params.set("chapter", chapter);

  return `/search?${params.toString()}`;
}
