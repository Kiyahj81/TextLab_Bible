// Key for <SearchPanel> so it remounts whenever URL-driven search state changes.
// SearchPanel seeds useState from server props; without a remount, client-side
// navigation (e.g. clicking a saved search) leaves the form showing stale
// mode/query — the same bug class PR 16 fixed in ReaderControls.
// `page` and `pageSize` are intentionally excluded: paginating through results
// should not remount the panel or reset its form fields.
export function searchStateKey(params: {
  mode: string;
  query: string;
  book: string;
  chapter: string;
  matchMode: string;
  domain: string;
  subdomain: string;
  ln: string;
}): string {
  return JSON.stringify([
    params.mode,
    params.query,
    params.book,
    params.chapter,
    params.matchMode,
    params.domain,
    params.subdomain,
    params.ln
  ]);
}
