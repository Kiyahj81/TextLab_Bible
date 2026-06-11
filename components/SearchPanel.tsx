"use client";

import Link from "next/link";
import { BookmarkPlus, Pencil, Search, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { splitWithMatches } from "@/lib/search-highlight";
import { decodeMorphCode } from "@/lib/morphology";
import type { DomainOptions } from "@/lib/search";
import { bookName, readerHref } from "@/lib/references";
import { useAutoDismissMap, useAutoDismissString } from "@/lib/useAutoDismissStatus";
import { normalizeSearchMode } from "@/lib/searchMode";

const SHOW_ENGLISH_KEY = "textlab:search:show-english";

const MODES = [
  { value: "keyword", label: "Keyword" },
  { value: "lemma", label: "Lemma" },
  { value: "morphology", label: "Morphology" },
  { value: "domain", label: "Domain" }
] as const;

const MODE_HINTS: Record<string, { placeholder: string; hint: string }> = {
  keyword: {
    placeholder: 'e.g. righteousness, "born again"',
    hint: "Searches verse text in every corpus. Use quotes for exact phrases and a leading - to exclude a word."
  },
  lemma: {
    placeholder: "e.g. λόγος, ἀγάπη, πίστις",
    hint: "Finds every inflected form of a Greek dictionary headword (case-insensitive)."
  },
  morphology: {
    placeholder: "e.g. N-NSM, V-3PAI-S",
    hint: "MorphGNT parsing codes. Switch Morph match to Prefix to broaden (e.g. V-3PAI)."
  },
  domain: {
    placeholder: "e.g. 33.55",
    hint: "Louw–Nida semantic domains. Pick a domain, narrow by subdomain, or enter an exact LN reference."
  }
};

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

export type SearchPanelResult =
  | {
      kind: "keyword";
      corpus: string;
      reference: string;
      text: string;
      onSpine?: boolean;
      englishText?: string;
    }
  | {
      kind: "token";
      corpus: string;
      reference: string;
      surface: string;
      lemma: string;
      morphCode: string;
      verseText: string;
      englishText?: string;
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
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(savedSearches);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [itemStatus, setItemStatus] = useState<Record<string, string>>({});
  const [showEnglish, setShowEnglish] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(SHOW_ENGLISH_KEY) === "1") {
      setShowEnglish(true);
    }
  }, []);

  useAutoDismissString(saveStatus, setSaveStatus);
  useAutoDismissMap(itemStatus, setItemStatus);

  function setRowStatus(id: string, message: string | null) {
    setItemStatus((current) => ({ ...current, [id]: message ?? "" }));
  }

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

  async function saveSearch() {
    if (!query.trim()) return;
    if (saving) return;
    const executedMode = normalizeSearchMode(mode);
    if (executedMode === "domain") return;

    setSaving(true);
    setSaveStatus("Saving...");
    try {
      const response = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: executedMode,
          query,
          // Omit empty optional fields — the server schema rejects empty
          // strings on coerced-number / enum fields (chapter, matchMode).
          ...(book ? { book } : {}),
          ...(chapter ? { chapter: Number(chapter) } : {}),
          ...(executedMode === "morphology" && matchMode ? { matchMode } : {})
        })
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
  const rangeStart = results.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = results.length === 0 ? 0 : rangeStart + results.length - 1;
  const showMorphMatch = activeMode === "morphology";
  const pageSizeOptions = Array.from(new Set([10, 25, 50, 100, pageSize])).sort((a, b) => a - b);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-6">
      <form className="space-y-3 rounded-md border border-stone-300 bg-white p-4 shadow-sm xl:sticky xl:top-0 xl:z-10" action="/search">
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
        {activeMode === "domain" ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <label className="space-y-1">
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
            <label className="space-y-1">
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
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">LN reference</span>
              <input
                name="ln"
                value={lnValue}
                onChange={(event) => setLnValue(event.target.value)}
                placeholder={MODE_HINTS.domain.placeholder}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600"
              />
            </label>
            <button
              type="submit"
              className="self-end rounded-md bg-accent-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-800"
            >
              Search
            </button>
          </div>
        ) : (
          <label className="block space-y-1">
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
        )}
        <p className="text-xs text-slate-500">{(MODE_HINTS[activeMode] ?? MODE_HINTS.keyword).hint}</p>
        <div className="grid gap-3 border-t border-stone-200 pt-3 sm:grid-cols-2 md:grid-cols-4">
          <label className="space-y-1">
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
          <label className="space-y-1">
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
          <label className="space-y-1">
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
            </div>
          ) : hasSearch && mode === "domain" ? (
            <p className="mt-3 text-sm text-slate-500">Domain searches can&apos;t be saved yet.</p>
          ) : null}
          <span role="status" aria-live="polite" className="text-sm text-slate-600">
            {saveStatus ?? ""}
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
            <article key={`${result.reference}-${index}`} className="border-l-2 border-transparent p-4 transition-colors hover:border-accent-400 hover:bg-stone-50/70">
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
                    <HighlightedText text={result.text} match={query} />
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

      <aside className="border-l-2 border-accent-200 pl-4 xl:sticky xl:top-6 xl:self-start">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Saved searches</h2>
        <div className="mt-3 divide-y divide-stone-200">
          {saved.map((item) => (
            <div key={item.id} className="py-3 text-sm">
              {editingId === item.id ? (
                <input
                  autoFocus
                  aria-label="Saved search name"
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
                    {item.mode} {item.book ? `in ${bookName(item.book)}` : "in all books"}
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
                <span role="status" aria-live="polite" className="ml-auto text-slate-500">
                  {itemStatus[item.id] ?? ""}
                </span>
              </div>
            </div>
          ))}
          {saved.length === 0 ? <p className="text-sm text-slate-600">No saved searches yet.</p> : null}
        </div>
      </aside>
    </div>
  );
}

function ReferenceLink({ reference, linkable = true }: { reference: string; linkable?: boolean }) {
  const className = "oldstyle-nums font-display text-base font-semibold text-slate-900";
  const href = readerHref(reference);
  if (!href || !linkable) return <span className={className}>{reference}</span>;
  return (
    <Link
      href={href}
      title="Open in reader"
      className={`${className} underline-offset-4 transition-colors hover:text-accent-700 hover:underline`}
    >
      {reference}
    </Link>
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
  domain,
  subdomain,
  ln,
  page,
  pageSize
}: {
  mode: string;
  query: string;
  book: string;
  chapter: string;
  matchMode: string;
  domain?: string;
  subdomain?: string;
  ln?: string;
  page: number;
  pageSize: number;
}) {
  const params = new URLSearchParams({ mode, page: String(page), pageSize: String(pageSize) });

  if (mode === "domain") {
    if (domain) params.set("domain", domain);
    if (subdomain) params.set("subdomain", subdomain);
    if (ln) params.set("ln", ln);
  } else {
    params.set("q", query);
    if (mode === "morphology") params.set("matchMode", matchMode);
  }

  if (book) params.set("book", book);
  if (chapter) params.set("chapter", chapter);

  return `/search?${params.toString()}`;
}
