"use client";

import Link from "next/link";
import { BookmarkPlus, Pencil, Search, Trash2, X } from "lucide-react";
import { Fragment, useState } from "react";
import { splitWithMatches } from "@/lib/search-highlight";
import { useAutoDismissMap, useAutoDismissString } from "@/lib/useAutoDismissStatus";

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
  const [activeMode, setActiveMode] = useState(mode);
  const [queryValue, setQueryValue] = useState(query);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(savedSearches);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [itemStatus, setItemStatus] = useState<Record<string, string>>({});

  useAutoDismissString(saveStatus, setSaveStatus);
  useAutoDismissMap(itemStatus, setItemStatus);

  function setRowStatus(id: string, message: string | null) {
    setItemStatus((current) => ({ ...current, [id]: message ?? "" }));
  }

  async function saveSearch() {
    if (!query.trim()) return;
    if (saving) return;

    setSaving(true);
    setSaveStatus("Saving...");
    try {
      const response = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: activeMode, query, book, chapter, matchMode, pageSize })
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

  async function deleteSavedSearch(id: string) {
    if (pending[id]) return;
    setPending((current) => ({ ...current, [id]: true }));
    try {
      const response = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
      if (response.ok) {
        setSaved((current) => current.filter((row) => row.id !== id));
        return;
      }
      const message = response.status === 404 ? "Already removed." : "Could not delete.";
      setRowStatus(id, message);
    } catch {
      setRowStatus(id, "Network error.");
    } finally {
      setPending((current) => ({ ...current, [id]: false }));
    }
  }

  async function renameSavedSearch(id: string, newLabel: string) {
    const label = newLabel.trim();
    if (!label) {
      setEditingId(null);
      return;
    }
    if (pending[id]) return;
    setPending((current) => ({ ...current, [id]: true }));
    try {
      const response = await fetch(`/api/saved-searches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label })
      });
      if (response.ok) {
        setSaved((current) => current.map((row) => (row.id === id ? { ...row, label } : row)));
        setEditingId(null);
        return;
      }
      const message = response.status === 404 ? "Already removed." : "Could not rename.";
      setRowStatus(id, message);
    } catch {
      setRowStatus(id, "Network error.");
    } finally {
      setPending((current) => ({ ...current, [id]: false }));
    }
  }

  const previousPage = Math.max(page - 1, 1);
  const nextPage = Math.min(page + 1, Math.max(pageCount, 1));
  const showMorphMatch = activeMode === "morphology";

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-6">
      <form className="space-y-3 rounded-md border border-stone-300 bg-white p-4 shadow-sm" action="/search">
        <div className="grid gap-3 md:grid-cols-[180px_1fr]">
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</span>
            <select
              name="mode"
              value={activeMode}
              onChange={(event) => setActiveMode(event.target.value)}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
            >
              <option value="keyword">Keyword</option>
              <option value="lemma">Lemma</option>
              <option value="morphology">Morphology</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Query</span>
            <div className="relative">
              <input
                name="q"
                value={queryValue}
                onChange={(event) => setQueryValue(event.target.value)}
                className="w-full rounded-md border border-stone-300 px-3 py-2 pr-20 text-sm outline-none focus:border-accent-600"
                placeholder="λόγος, N-NSM, righteousness"
              />
              <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                {queryValue ? (
                  <button
                    type="button"
                    onClick={() => setQueryValue("")}
                    aria-label="Clear query"
                    title="Clear"
                    className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition-colors hover:bg-stone-100 hover:text-slate-700"
                  >
                    <X size={16} aria-hidden />
                  </button>
                ) : null}
                <button
                  type="submit"
                  aria-label="Search"
                  title="Search"
                  className="flex h-7 w-7 items-center justify-center rounded bg-accent-700 text-white transition-colors hover:bg-accent-800"
                >
                  <Search size={16} aria-hidden />
                </button>
              </div>
            </div>
          </label>
        </div>
        <div className="grid gap-3 border-t border-stone-200 pt-3 sm:grid-cols-2 md:grid-cols-4">
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
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600"
              placeholder="Any"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page size</span>
            <input
              name="pageSize"
              type="number"
              min="1"
              max="100"
              defaultValue={pageSize}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600"
            />
          </label>
          {showMorphMatch ? (
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
          ) : null}
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
                <span className="oldstyle-nums font-display text-base font-semibold text-slate-900">{result.reference}</span>
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
                  <p className="greek-text leading-7 text-slate-800">
                    <HighlightedText text={result.verseText} match={result.surface} />
                  </p>
                </div>
              ) : (
                <p className="mt-2 leading-7 text-slate-800">
                  <HighlightedText text={result.text} match={query} />
                </p>
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
              href={searchHref({ mode: activeMode, query, book, chapter, matchMode, page: previousPage, pageSize })}
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
              href={searchHref({ mode: activeMode, query, book, chapter, matchMode, page: nextPage, pageSize })}
            >
              Next
            </Link>
          </nav>
        ) : null}
      </section>
      </div>

      <aside className="border-l-2 border-accent-200 pl-4 xl:sticky xl:top-6 xl:self-start">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Saved searches</h2>
        <div className="mt-3 divide-y divide-stone-200">
          {saved.map((item) => (
            <div key={item.id} className="py-3 text-sm">
              {editingId === item.id ? (
                <input
                  autoFocus
                  defaultValue={item.label}
                  onBlur={(event) => renameSavedSearch(item.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      renameSavedSearch(item.id, event.currentTarget.value);
                    } else if (event.key === "Escape") {
                      setEditingId(null);
                    }
                  }}
                  disabled={pending[item.id]}
                  className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm outline-none focus:border-accent-600 disabled:opacity-50"
                />
              ) : (
                <Link
                  href={searchHref({
                    mode: item.mode,
                    query: item.query,
                    book: item.book ?? "",
                    chapter: item.chapter ? String(item.chapter) : "",
                    matchMode: item.matchMode ?? "exact",
                    page: 1,
                    pageSize
                  })}
                  className="block hover:underline"
                >
                  <span className="font-medium text-slate-950">{item.label}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {item.mode} {item.book ? `in ${item.book}` : "in all books"}
                  </span>
                </Link>
              )}
              <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => setEditingId(editingId === item.id ? null : item.id)}
                  disabled={pending[item.id]}
                  className="inline-flex items-center gap-1 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Pencil size={12} aria-hidden />
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => deleteSavedSearch(item.id)}
                  disabled={pending[item.id]}
                  className="inline-flex items-center gap-1 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={12} aria-hidden />
                  Delete
                </button>
                {itemStatus[item.id] ? (
                  <span className="ml-auto text-slate-500">{itemStatus[item.id]}</span>
                ) : null}
              </div>
            </div>
          ))}
          {saved.length === 0 ? <p className="text-sm text-slate-600">No saved searches yet.</p> : null}
        </div>
      </aside>
    </div>
  );
}

function HighlightedText({ text, match }: { text: string; match: string }) {
  const segments = splitWithMatches(text, match);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "match" ? (
          <mark
            key={index}
            className="rounded-sm bg-amber-200/80 px-0.5 font-semibold text-slate-950"
          >
            {segment.value}
          </mark>
        ) : (
          <Fragment key={index}>{segment.value}</Fragment>
        )
      )}
    </>
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
    page: String(page),
    pageSize: String(pageSize)
  });

  if (book) params.set("book", book);
  if (chapter) params.set("chapter", chapter);
  if (mode === "morphology") params.set("matchMode", matchMode);

  return `/search?${params.toString()}`;
}
