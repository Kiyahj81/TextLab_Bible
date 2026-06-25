"use client";

import Link from "next/link";
import { BookmarkPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { decodeMorphCode } from "@/lib/morphology";
import { SHOW_ENGLISH_KEY } from "@/components/search/constants";
import { searchHref } from "@/components/search/searchHref";
import { ReferenceLink, HighlightedText, KeywordHighlight } from "@/components/search/highlight";
import type { SearchPanelResult } from "@/components/search/types";
import type { DomainOptions } from "@/lib/search";

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

export function SearchResults({
  results, hasSearch, count, page, pageCount, pageSize, searchLabel,
  mode, query, book, chapter, matchMode, domain, subdomain, ln, domainOptions,
  saveSearch, saving, saveStatus
}: {
  results: SearchPanelResult[]; hasSearch: boolean; count: number;
  page: number; pageCount: number; pageSize: number; searchLabel: string;
  mode: string; query: string; book: string; chapter: string; matchMode: string;
  domain: string; subdomain: string; ln: string; domainOptions: DomainOptions;
  saveSearch: () => Promise<void>; saving: boolean; saveStatus: string | null;
}) {
  const [showEnglish, setShowEnglish] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(SHOW_ENGLISH_KEY) === "1") {
      setShowEnglish(true);
    }
  }, []);

  const previousPage = Math.max(page - 1, 1);
  const nextPage = Math.min(page + 1, Math.max(pageCount, 1));
  const rangeStart = results.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = results.length === 0 ? 0 : rangeStart + results.length - 1;

  return (
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
                onClick={saveSearch}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BookmarkPlus size={16} />
                Save search
              </button>
            </div>
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
  );
}
