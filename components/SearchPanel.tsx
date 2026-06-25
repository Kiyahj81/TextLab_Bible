"use client";

import Link from "next/link";
import { BookmarkPlus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { decodeMorphCode } from "@/lib/morphology";
import type { DomainOptions } from "@/lib/search";
import { normalizeSearchMode } from "@/lib/searchMode";
import { MODES, MODE_HINTS, SHOW_ENGLISH_KEY } from "@/components/search/constants";
import type { SearchPanelResult, SavedSearchRow, SearchBookOption } from "@/components/search/types";
import { searchHref } from "@/components/search/searchHref";
import { ReferenceLink, HighlightedText, KeywordHighlight } from "@/components/search/highlight";
import { useSavedSearches } from "@/components/search/useSavedSearches";
import { SavedSearches } from "@/components/search/SavedSearches";

export type { SearchPanelResult, SavedSearchRow, SearchBookOption } from "@/components/search/types";
export { KeywordHighlight } from "@/components/search/highlight";

function buildExampleSearches(domainOptions: DomainOptions): { label: string; href: string }[] {
  const examples = [
    { label: "Lemma: λόγος", href: `/search?mode=lemma&q=${encodeURIComponent("λόγος")}` },
    { label: 'Keyword: "born again"', href: `/search?mode=keyword&q=${encodeURIComponent('"born again"')}` },
    { label: "Morphology: N-NSM", href: "/search?mode=morphology&q=N-NSM&matchMode=exact" }
  ];
  const domain = domainOptions.domains.find((d) => d.number === 25);
  if (domain) {
    examples.push({
      label: `Domain ${domain.number}: ${domain.label}`,
      href: `/search?mode=domain&domain=${encodeURIComponent(domain.code)}`
    });
  }
  return examples;
}

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
  savedSearches,
  domain,
  subdomain,
  ln,
  domainOptions,
  hasSearch,
  searchLabel
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
  domain: string;
  subdomain: string;
  ln: string;
  domainOptions: DomainOptions;
  hasSearch: boolean;
  searchLabel: string;
}) {
  const [activeMode, setActiveMode] = useState<string>(normalizeSearchMode(mode));
  const [queryValue, setQueryValue] = useState(query);
  const [selectedBook, setSelectedBook] = useState(book);
  const [selectedDomain, setSelectedDomain] = useState(domain);
  const [selectedSubdomain, setSelectedSubdomain] = useState(subdomain);
  const [lnValue, setLnValue] = useState(ln);
  const [showEnglish, setShowEnglish] = useState(false);

  const savedApi = useSavedSearches(savedSearches, {
    mode, query, book, chapter, matchMode, domain, subdomain, ln, domainOptions
  });

  useEffect(() => {
    if (window.localStorage.getItem(SHOW_ENGLISH_KEY) === "1") {
      setShowEnglish(true);
    }
  }, []);

  // ln has precedence over subdomain/domain in resolveDomainFilter, so a stale ln (e.g. from
  // ?ln=33.55) would silently override a freshly chosen domain/subdomain. Clear ln whenever the
  // user actively picks a domain or subdomain so the visible selection is what actually runs.
  function onDomainChange(value: string) {
    setSelectedDomain(value);
    setSelectedSubdomain("");
    setLnValue("");
  }

  function onSubdomainChange(value: string) {
    setSelectedSubdomain(value);
    setLnValue("");
  }

  const previousPage = Math.max(page - 1, 1);
  const nextPage = Math.min(page + 1, Math.max(pageCount, 1));
  const rangeStart = results.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = results.length === 0 ? 0 : rangeStart + results.length - 1;
  const showMorphMatch = activeMode === "morphology";
  const pageSizeOptions = Array.from(new Set([10, 25, 50, 100, pageSize])).sort((a, b) => a - b);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-6">
      <form className="space-y-3 rounded-md border border-stone-300 bg-white p-4 shadow-sm xl:sticky xl:top-0 xl:z-10" action="/search">
        {/* Row 1 — search mode, with the book/chapter scope pulled up alongside it */}
        <div className="flex flex-wrap items-end gap-3">
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</legend>
            <div className="mt-1 inline-flex flex-wrap rounded-md border border-stone-300 bg-stone-100 p-0.5">
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={`cursor-pointer rounded px-3 py-1.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-accent-400 ${
                    activeMode === m.value
                      ? "bg-accent-700 text-white shadow-sm forced-colors:outline forced-colors:outline-2 forced-colors:outline-offset-[-2px]"
                      : "text-slate-600 hover:text-slate-950"
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={m.value}
                    checked={activeMode === m.value}
                    onChange={() => setActiveMode(m.value)}
                    className="sr-only"
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-end gap-3 sm:ml-auto">
            <label className="w-40 space-y-1 sm:w-44">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Book</span>
              <select
                name="book"
                value={selectedBook}
                onChange={(event) => setSelectedBook(event.target.value)}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
              >
                <option value="">All books</option>
                {books.map((bookOption) => (
                  <option key={bookOption.osisId} value={bookOption.osisId}>
                    {bookOption.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-44 space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chapter</span>
              <input
                name="chapter"
                type="number"
                min="1"
                defaultValue={chapter}
                disabled={!selectedBook}
                placeholder={selectedBook ? "Any" : "Choose a book first"}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600 disabled:bg-stone-50 disabled:opacity-60"
              />
            </label>
          </div>
        </div>
        {/* Row 2 — the query (or domain filters) with page size and any mode-specific refinement */}
        {activeMode === "domain" ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[10rem] flex-1 space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Domain</span>
              <select
                name="domain"
                value={selectedDomain}
                onChange={(event) => onDomainChange(event.target.value)}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
              >
                <option value="">Any domain</option>
                {domainOptions.domains.map((d) => (
                  <option key={d.code} value={d.code}>{`${d.number} — ${d.label}`}</option>
                ))}
              </select>
            </label>
            <label className="min-w-[10rem] flex-1 space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subdomain</span>
              <select
                name="subdomain"
                value={selectedSubdomain}
                onChange={(event) => onSubdomainChange(event.target.value)}
                disabled={!selectedDomain}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">Any subdomain</option>
                {(domainOptions.subdomainsByDomain[selectedDomain] ?? []).map((s) => (
                  <option key={s.code} value={s.code}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className="min-w-[8rem] flex-1 space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">LN reference</span>
              <input
                name="ln"
                value={lnValue}
                onChange={(event) => setLnValue(event.target.value)}
                placeholder={MODE_HINTS.domain.placeholder}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600"
              />
            </label>
            <label className="w-24 space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page size</span>
              <select
                name="pageSize"
                defaultValue={String(pageSize)}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
              >
                {pageSizeOptions.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md bg-accent-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-800"
            >
              Search
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[12rem] flex-1 space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Query</span>
              <div className="relative">
                <input
                  name="q"
                  value={queryValue}
                  onChange={(event) => setQueryValue(event.target.value)}
                  className="w-full rounded-md border border-stone-300 px-3 py-2 pr-20 text-sm outline-none focus:border-accent-600"
                  placeholder={(MODE_HINTS[activeMode] ?? MODE_HINTS.keyword).placeholder}
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
            {showMorphMatch ? (
              <label className="w-32 space-y-1">
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
            <label className="w-24 space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page size</span>
              <select
                name="pageSize"
                defaultValue={String(pageSize)}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
              >
                {pageSizeOptions.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <p className="text-xs text-slate-500">{(MODE_HINTS[activeMode] ?? MODE_HINTS.keyword).hint}</p>
      </form>

      <section className="rounded-md border border-stone-300 bg-white shadow-sm">
        <div className="border-b border-stone-200 p-4">
          <h2 className="font-semibold text-slate-950">Results</h2>
          <p className="mt-1 text-sm text-slate-600">
            {hasSearch
              ? `${count} result${count === 1 ? "" : "s"} for ${searchLabel}${pageCount ? `, page ${page} of ${pageCount}` : ""}`
              : "Search the corpus by keyword, lemma, morphology, or semantic domain."}
          </p>
          {hasSearch ? (
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={showEnglish}
                onChange={(event) => {
                  setShowEnglish(event.target.checked);
                  window.localStorage.setItem(SHOW_ENGLISH_KEY, event.target.checked ? "1" : "0");
                }}
              />
              Show English (WEB)
            </label>
          ) : null}
          {query || (hasSearch && mode === "domain" && (domain || subdomain || ln)) ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={savedApi.saveSearch}
                disabled={savedApi.saving}
                className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BookmarkPlus size={16} />
                Save search
              </button>
            </div>
          ) : null}
          <span role="status" aria-live="polite" className="text-sm text-slate-600">
            {savedApi.saveStatus ?? ""}
          </span>
        </div>
        <div className="divide-y divide-stone-200">
          {!hasSearch ? (
            <div className="p-4">
              <p className="text-sm text-slate-600">Try an example:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {buildExampleSearches(domainOptions).map((example) => (
                  <Link
                    key={example.label}
                    href={example.href}
                    className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-accent-600 hover:text-accent-700"
                  >
                    {example.label}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          {results.map((result, index) => (
            <article key={`${result.reference}-${index}`} className="p-4 transition hover:bg-stone-50/70 hover:shadow-[inset_2px_0_0_theme(colors.accent.400)]">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <ReferenceLink reference={result.reference} linkable={result.kind === "keyword" ? result.onSpine !== false : undefined} />
                <span className="rounded bg-stone-100 px-2 py-1 text-xs text-slate-600">{result.corpus}</span>
                {result.kind === "token" ? (
                  <span
                    title={decodeMorphCode(result.morphCode) ?? undefined}
                    className="cursor-help rounded bg-blue-50 px-2 py-1 text-xs text-blue-900"
                  >
                    {result.morphCode}
                  </span>
                ) : null}
              </div>
              {result.kind === "token" ? (
                <div className="mt-2 grid gap-3 lg:grid-cols-[180px_1fr]">
                  <div className="greek-text text-xl text-slate-950">
                    {result.surface}
                    <div className="mt-1 text-sm text-slate-600">lemma: {result.lemma}</div>
                  </div>
                  <div>
                    <p className="greek-text leading-7 text-slate-800">
                      <HighlightedText text={result.verseText} match={result.surface} />
                    </p>
                    {showEnglish && result.englishText ? (
                      <p className="mt-1 text-sm leading-6 text-slate-600">{result.englishText}</p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="mt-2 leading-7 text-slate-800">
                    <KeywordHighlight
                      segments={result.highlightSegments}
                      text={result.text}
                      query={query}
                    />
                  </p>
                  {showEnglish && result.englishText ? (
                    <p className="mt-1 text-sm leading-6 text-slate-600">{result.englishText}</p>
                  ) : null}
                </div>
              )}
            </article>
          ))}
          {hasSearch && results.length === 0 ? (
            <div className="p-4 text-sm">
              <p className="text-slate-700">No results for {searchLabel}.</p>
              <p className="mt-1 text-slate-500">
                {mode === "morphology"
                  ? "Try switching Morph match to Prefix, or remove the book and chapter filters."
                  : mode === "domain"
                    ? "This domain has no results in the loaded corpus. Try removing the book and chapter filters."
                    : "Check the spelling, try a broader term, or remove the book and chapter filters."}
              </p>
            </div>
          ) : null}
        </div>
        {hasSearch && pageCount > 1 ? (
          <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 p-4 text-sm">
            {page <= 1 ? (
              <span aria-disabled="true" className="rounded-md border border-stone-200 px-3 py-2 text-slate-400">
                Previous
              </span>
            ) : (
              <Link
                className="rounded-md border border-stone-300 px-3 py-2 hover:border-slate-500"
                href={searchHref({ mode, query, book, chapter, matchMode, domain, subdomain, ln, page: previousPage, pageSize })}
              >
                Previous
              </Link>
            )}
            <span className="text-slate-600">
              Showing {rangeStart}–{rangeEnd} of {count}
            </span>
            {page >= pageCount ? (
              <span aria-disabled="true" className="rounded-md border border-stone-200 px-3 py-2 text-slate-400">
                Next
              </span>
            ) : (
              <Link
                className="rounded-md border border-stone-300 px-3 py-2 hover:border-slate-500"
                href={searchHref({ mode, query, book, chapter, matchMode, domain, subdomain, ln, page: nextPage, pageSize })}
              >
                Next
              </Link>
            )}
          </nav>
        ) : null}
      </section>
      </div>

      <SavedSearches
        pageSize={pageSize}
        saved={savedApi.saved}
        pending={savedApi.pending}
        editingId={savedApi.editingId}
        setEditingId={savedApi.setEditingId}
        itemStatus={savedApi.itemStatus}
        deleteSavedSearch={savedApi.deleteSavedSearch}
        renameSavedSearch={savedApi.renameSavedSearch}
      />
    </div>
  );
}

