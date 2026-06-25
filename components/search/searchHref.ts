export function searchHref({
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
