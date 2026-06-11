export const SEARCH_MODES = ["keyword", "lemma", "morphology", "domain"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export function normalizeSearchMode(value?: string | null): SearchMode {
  return SEARCH_MODES.includes(value as SearchMode) ? (value as SearchMode) : "keyword";
}
