// `shared` is re-exported BY NAME (not `export *`) so its internal helpers
// (PaginationInput, normalizePagination, paginationResult, HydratedToken,
// hydrateTokens) stay private to lib/search/*. The other five modules export
// only originally-public symbols, so `export *` is leak-free for them.
export { spineKey, filterToSblSpine } from "@/lib/search/shared";
export type { SearchPagination, Citation } from "@/lib/search/shared";
export * from "@/lib/search/reader";
export * from "@/lib/search/keyword";
export * from "@/lib/search/tokens";
export * from "@/lib/search/domain";
export * from "@/lib/search/semantic";
export { getPassageTokens, type PassageToken, type PassageTokenRow } from "@/lib/search/passageTokens";
