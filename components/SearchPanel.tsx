"use client";

import { useSavedSearches } from "@/components/search/useSavedSearches";
import { SearchForm } from "@/components/search/SearchForm";
import { SearchResults } from "@/components/search/SearchResults";
import { SavedSearches } from "@/components/search/SavedSearches";
import type { DomainOptions } from "@/lib/search";
import type { SearchPanelResult, SavedSearchRow, SearchBookOption } from "@/components/search/types";

export type { SearchPanelResult, SavedSearchRow, SearchBookOption } from "@/components/search/types";
export { KeywordHighlight } from "@/components/search/highlight";

export function SearchPanel({
  mode, query, book, chapter, matchMode, page, pageSize, count, pageCount,
  results, books, savedSearches, domain, subdomain, ln, domainOptions,
  hasSearch, searchLabel
}: {
  mode: string; query: string; book: string; chapter: string; matchMode: string;
  page: number; pageSize: number; count: number; pageCount: number;
  results: SearchPanelResult[]; books: SearchBookOption[]; savedSearches: SavedSearchRow[];
  domain: string; subdomain: string; ln: string; domainOptions: DomainOptions;
  hasSearch: boolean; searchLabel: string;
}) {
  const savedApi = useSavedSearches(savedSearches, {
    mode, query, book, chapter, matchMode, domain, subdomain, ln, domainOptions
  });

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-6">
        <SearchForm
          mode={mode} query={query} book={book} chapter={chapter} matchMode={matchMode}
          domain={domain} subdomain={subdomain} ln={ln}
          books={books} domainOptions={domainOptions} pageSize={pageSize}
        />
        <SearchResults
          results={results} hasSearch={hasSearch} count={count} page={page}
          pageCount={pageCount} pageSize={pageSize} searchLabel={searchLabel}
          mode={mode} query={query} book={book} chapter={chapter} matchMode={matchMode}
          domain={domain} subdomain={subdomain} ln={ln} domainOptions={domainOptions}
          saveSearch={savedApi.saveSearch} saving={savedApi.saving} saveStatus={savedApi.saveStatus}
        />
      </div>
      <SavedSearches
        pageSize={pageSize}
        saved={savedApi.saved} pending={savedApi.pending}
        editingId={savedApi.editingId} setEditingId={savedApi.setEditingId}
        itemStatus={savedApi.itemStatus}
        deleteSavedSearch={savedApi.deleteSavedSearch}
        renameSavedSearch={savedApi.renameSavedSearch}
      />
    </div>
  );
}
