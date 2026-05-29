import { ntBooks } from "@/lib/references";

export type ParsedReference = {
  book: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
};

export type MorphSignal = { code: string; mode: "exact" | "prefix" };

export type Intent =
  | "word-study"
  | "passage-study"
  | "topic-survey"
  | "morphology"
  | "comparison"
  | "general";

export type Signals = {
  references: ParsedReference[];
  greekWords: string[];
  topicWords: string[];
  morphCodes: MorphSignal[];
  intent: Intent;
  book?: string;
};

// English Bible terms → Greek lemma. Used by the retrieval planner to turn a
// topic word into a precise lemma search. Intentionally small for v1; extend
// based on real query traffic.
export const ENGLISH_TO_GREEK_LEMMA: Readonly<Record<string, string>> = {
  law: "νόμος",
  love: "ἀγάπη",
  faith: "πίστις",
  grace: "χάρις",
  spirit: "πνεῦμα",
  flesh: "σάρξ",
  word: "λόγος",
  righteousness: "δικαιοσύνη",
  sin: "ἁμαρτία",
  truth: "ἀλήθεια",
  life: "ζωή",
  light: "φῶς",
  glory: "δόξα",
  peace: "εἰρήνη",
  hope: "ἐλπίς",
  power: "δύναμις",
  kingdom: "βασιλεία",
  covenant: "διαθήκη",
  salvation: "σωτηρία",
  gospel: "εὐαγγέλιον",
  church: "ἐκκλησία",
  wisdom: "σοφία",
  knowledge: "γνῶσις",
  judgment: "κρίσις",
  mercy: "ἔλεος",
  hour: "ὥρα",
  blood: "αἷμα",
  fear: "φόβος",
  joy: "χαρά",
  works: "ἔργον"
};

const STOP_WORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "so", "as", "of", "in", "on", "at",
  "to", "for", "with", "by", "from", "into", "onto", "off", "out", "up", "down", "over",
  "under", "about", "between", "through", "during", "before", "after", "above", "below",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done",
  "have", "has", "had", "can", "could", "should", "would", "will", "shall", "may", "might",
  "must", "this", "that", "these", "those", "it", "its", "he", "she", "they", "them", "his",
  "her", "their", "you", "your", "yours", "i", "me", "my", "mine", "we", "our", "us", "who",
  "whom", "whose", "what", "when", "where", "why", "how", "which", "there", "here",
  "mean", "means", "meaning", "use", "used", "uses", "using", "show", "find", "tell", "read",
  "give", "list", "explain", "compare", "difference", "between", "versus", "vs", "passage",
  "passages", "verse", "verses", "word", "words", "lemma", "lemmas", "term", "terms",
  "say", "says", "said", "talk", "talks", "about", "role", "way", "ways", "thing", "things",
  "not", "no", "yes", "all", "any", "some", "more", "most", "much", "many", "few", "such",
  "very", "just", "only", "also", "too", "than", "like", "different", "senses", "sense"
]);

// Proper nouns that should not be treated as topic search terms. Book names are
// already excluded separately via the ntBooks alias set.
const PROPER_NOUNS: ReadonlySet<string> = new Set([
  "paul", "jesus", "christ", "peter", "james", "moses", "david", "abraham", "isaac",
  "jacob", "mary", "joseph", "pilate", "herod", "caesar", "jerusalem", "israel", "egypt",
  "rome", "babylon", "judah", "galilee", "nazareth", "bethlehem", "satan", "adam", "eve",
  "noah", "timothy", "barnabas", "stephen", "judas", "thomas", "philip", "andrew"
]);

const BOOK_ALIASES: ReadonlySet<string> = new Set(
  ntBooks.flatMap((book) => [book.osisId.toLowerCase(), ...book.aliases])
);

const ALIAS_TO_OSIS: ReadonlyMap<string, string> = new Map(
  ntBooks.flatMap((book) => book.aliases.map((alias) => [alias, book.osisId] as const))
);

const MORPH_POS_LETTERS = "NVATRCDPIX";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Detect the single dominant NT book named in a prompt, by OSIS id. Anchored on
// word boundaries so aliases embedded in larger words (e.g. "rom" in "from") do
// not match. Lives here because signal extraction is its primary consumer;
// re-exported from lib/ai/assistant for backward compatibility.
export function detectBookFromPrompt(prompt: string): string | undefined {
  const lower = prompt.toLowerCase();
  for (const book of ntBooks) {
    for (const alias of book.aliases) {
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}([^a-z0-9]|$)`, "i");
      if (pattern.test(lower)) return book.osisId;
    }
  }
  return undefined;
}

const REFERENCE_REGEX = (() => {
  const aliases = [...ALIAS_TO_OSIS.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  // (?<![a-z0-9]) avoids matching aliases embedded in larger words (e.g. "rom" in "from").
  return new RegExp(
    `(?<![a-z0-9])(${aliases.join("|")})\\s+(\\d+)(?::(\\d+)(?:\\s*[-\\u2013\\u2014]\\s*(\\d+))?)?`,
    "gi"
  );
})();

export function detectReferences(prompt: string): ParsedReference[] {
  const out: ParsedReference[] = [];
  for (const match of prompt.matchAll(REFERENCE_REGEX)) {
    const alias = match[1].toLowerCase().replace(/\s+/g, " ");
    const book = ALIAS_TO_OSIS.get(alias);
    if (!book) continue;
    const reference: ParsedReference = { book, chapter: Number.parseInt(match[2], 10) };
    if (match[3] !== undefined) reference.verseStart = Number.parseInt(match[3], 10);
    if (match[4] !== undefined) reference.verseEnd = Number.parseInt(match[4], 10);
    out.push(reference);
  }
  return out;
}

const GREEK_RUN_REGEX = /[Ͱ-Ͽἀ-῿]+/gu;

export function detectGreekWords(prompt: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of prompt.matchAll(GREEK_RUN_REGEX)) {
    const run = match[0];
    if ([...run].length < 2) continue;
    if (seen.has(run)) continue;
    seen.add(run);
    out.push(run);
  }
  return out;
}

const MORPH_CODE_REGEX = new RegExp(`\\b[${MORPH_POS_LETTERS}]-[A-Z0-9]+(?:-[A-Z0-9]+)*\\b`, "g");

export function detectMorphCodes(prompt: string): MorphSignal[] {
  const seen = new Set<string>();
  const out: MorphSignal[] = [];
  for (const match of prompt.matchAll(MORPH_CODE_REGEX)) {
    const code = match[0];
    if (seen.has(code)) continue;
    seen.add(code);
    const rest = code.slice(2); // strip "X-"
    const mode: MorphSignal["mode"] = rest.replace(/-/g, "").length <= 1 ? "prefix" : "exact";
    out.push({ code, mode });
  }
  return out;
}

export function detectTopicWords(prompt: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of prompt.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 3) continue;
    if (STOP_WORDS.has(raw)) continue;
    if (PROPER_NOUNS.has(raw)) continue;
    if (BOOK_ALIASES.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

export function detectIntent(prompt: string): Intent {
  const lower = prompt.toLowerCase();

  if (/\b(difference between|compare|versus|\bvs\b)/.test(lower)) return "comparison";

  if (
    detectMorphCodes(prompt).length > 0 ||
    /\b(imperative|participle|subjunctive|infinitive|aorist|morpholog|grammar|grammatical|tense|parse)/.test(lower)
  ) {
    return "morphology";
  }

  if (/(what does .+ mean|meaning of|how (is|are) .+ used|senses of|word study)/.test(lower)) {
    return "word-study";
  }

  if (/(verses about|passages about|find verses|where does .+ (talk|speak))/.test(lower)) {
    return "topic-survey";
  }

  if (detectReferences(prompt).length > 0 || /\b(show|read)\b/.test(lower) || lower.includes("passage")) {
    return "passage-study";
  }

  return "general";
}

export function extractSignals(prompt: string): Signals {
  return {
    references: detectReferences(prompt),
    greekWords: detectGreekWords(prompt),
    topicWords: detectTopicWords(prompt),
    morphCodes: detectMorphCodes(prompt),
    intent: detectIntent(prompt),
    book: detectBookFromPrompt(prompt)
  };
}
