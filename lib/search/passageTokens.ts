// lib/search/passageTokens.ts — data types live in the search layer so the AI
// formatter depends on search, not the reverse.
export type PassageToken = {
  surface: string;
  lemma: string | null;
  morphCode: string | null;
  partOfSpeech: string | null;
  gloss: string | null;
  domainLabel: string | null;
};
export type PassageTokenRow = PassageToken & { verse: number; wordIndex: number };
