export const SHOW_ENGLISH_KEY = "textlab:search:show-english";

export const MODES = [
  { value: "keyword", label: "Keyword" },
  { value: "lemma", label: "Lemma" },
  { value: "morphology", label: "Morphology" },
  { value: "domain", label: "Domain" }
] as const;

export const MODE_HINTS: Record<string, { placeholder: string; hint: string }> = {
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
