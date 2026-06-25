"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";
import { MODES, MODE_HINTS } from "@/components/search/constants";
import { normalizeSearchMode } from "@/lib/searchMode";
import type { DomainOptions } from "@/lib/search";
import type { SearchBookOption } from "@/components/search/types";

export function SearchForm(props: {
  mode: string;
  query: string;
  book: string;
  chapter: string;
  matchMode: string;
  domain: string;
  subdomain: string;
  ln: string;
  books: SearchBookOption[];
  domainOptions: DomainOptions;
  pageSize: number;
}) {
  const { mode, query, book, chapter, matchMode, domain, subdomain, ln, books, domainOptions, pageSize } = props;
  const [activeMode, setActiveMode] = useState<string>(normalizeSearchMode(mode));
  const [queryValue, setQueryValue] = useState(query);
  const [selectedBook, setSelectedBook] = useState(book);
  const [selectedDomain, setSelectedDomain] = useState(domain);
  const [selectedSubdomain, setSelectedSubdomain] = useState(subdomain);
  const [lnValue, setLnValue] = useState(ln);

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

  const showMorphMatch = activeMode === "morphology";
  const pageSizeOptions = Array.from(new Set([10, 25, 50, 100, pageSize])).sort((a, b) => a - b);

  return (
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
  );
}
