import { ntBooks } from "@/lib/references";

export type ParsedReference = {
  book: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
  chapterEnd?: number;
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
  // Matched English multi-word phrase strings (e.g. "sexual immorality"). Kept
  // separately because the phrase's component words are stripped from topicWords — so
  // this is the only signal that a phrase-only conceptual prompt carried a searchable
  // concept. It feeds BOTH the semantic gate and the FTS keywords (it is English, so
  // it can anchor the WEB full-text half); the corresponding Greek lemmas live in
  // greekWords and drive the deterministic searchLemma call.
  phraseTerms?: string[];
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
  logos: "λόγος",
  cross: "σταυρός",
  resurrection: "ἀνάστασις",
  righteousness: "δικαιοσύνη",
  sanctification: "ἁγιασμός",
  reconciliation: "καταλλαγή",
  sin: "ἁμαρτία",
  temptation: "πειρασμός",
  repentance: "μετάνοια",
  forgiveness: "ἄφεσις",
  redemption: "ἀπολύτρωσις",
  freedom: "ἐλευθερία",
  adoption: "υἱοθεσία",
  election: "ἐκλογή",
  chosen: "ἐκλεκτός",
  called: "κλητός",
  holy: "ἅγιος",
  truth: "ἀλήθεια",
  life: "ζωή",
  light: "φῶς",
  glory: "δόξα",
  peace: "εἰρήνη",
  hope: "ἐλπίς",
  mercy: "ἔλεος",
  power: "δύναμις",
  authority: "ἐξουσία",
  kingdom: "βασιλεία",
  covenant: "διαθήκη",
  promise: "ἐπαγγελία",
  commandment: "ἐντολή",
  salvation: "σωτηρία",
  gospel: "εὐαγγέλιον",
  church: "ἐκκλησία",
  baptism: "βάπτισμα",
  prayer: "προσευχή",
  thanksgiving: "εὐχαριστία",
  fellowship: "κοινωνία",
  prophecy: "προφητεία",
  gifts: "χάρισμα",
  wisdom: "σοφία",
  knowledge: "γνῶσις",
  judgment: "κρίσις",
  wrath: "ὀργή",
  death: "θάνατος",
  heaven: "οὐρανός",
  hell: "γέεννα",
  demon: "δαιμόνιον",
  angel: "ἄγγελος",
  creation: "κτίσις",
  world: "κόσμος",
  blood: "αἷμα",
  fear: "φόβος",
  joy: "χαρά",
  works: "ἔργον",
  jesus: "Ἰησοῦς",
  christ: "Χριστός",
  god: "θεός",
  lord: "κύριος",
  jerusalem: "Ἰερουσαλήμ",
  // Named adversary. Kept out of PROPER_NOUNS so named-entity questions ("what
  // does the Bible teach about satan/the devil") route to a precise SBLGNT lemma
  // search. searchLemma matches case-insensitively, so Σατανᾶς and the mixed-case
  // διάβολος/Διάβολος forms are all caught.
  satan: "Σατανᾶς",
  devil: "διάβολος",
};

// English multi-word phrases → Greek lemma. The single-word ENGLISH_TO_GREEK_LEMMA
// map can never match a phrase (topic words are split on non-letters, so the words
// arrive separately and never as one underscore/space-joined token). Phrases are
// detected against the raw prompt instead. Only worthwhile where neither component
// word already maps to the intended lemma — e.g. "second coming" → παρουσία, which
// "second" and "coming" never reach on their own.
export const ENGLISH_PHRASE_TO_GREEK_LEMMA: Readonly<Record<string, string>> = {
  "second coming": "παρουσία",
  "sexual immorality": "πορνεία",
};

const STOP_WORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "so", "as", "of", "in", "on", "at",
  "to", "for", "with", "by", "from", "into", "onto", "off", "out", "up", "down", "over",
  "under", "about", "between", "through", "during", "before", "after", "above", "below",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done",
  "have", "has", "had", "can", "could", "should", "would", "will", "shall", "may", "might",
  "must", "this", "that", "these", "those", "it", "its", "he", "she", "they", "them", "his", "hers",
  "her", "him", "their", "theirs", "you", "your", "yours", "i", "me", "my", "mine", "we", "our", "us",
  "who", "whom", "whose", "what", "when", "where", "why", "how", "which", "there", "here", "relate",
  "mean", "means", "meaning", "use", "used", "uses", "using", "describe", "show", "find", "tell", "read", "related",
  "give", "list", "explain", "compare", "difference", "between", "versus", "vs", "passage", "summary",
  "passages", "verse", "verses", "word", "words", "lemma", "lemmas", "term", "terms", "summarize",
  "say", "says", "said", "talk", "talks", "role", "way", "ways", "thing", "things", "every", "each",
  "not", "no", "yes", "all", "any", "some", "more", "most", "much", "many", "few", "such", "other",
  "very", "just", "only", "also", "too", "than", "like", "different", "senses", "sense", "bible",
  "form", "forms", "verb", "verbs", "imperative", "imperatives", "participle", "participles",
  "subjunctive", "subjunctives", "infinitive", "infinitives", "aorist", "tense", "grammar",
  "grammatical", "parse",
]);

// Proper nouns that should not be treated as topic search terms. Book names are
// already excluded separately via the ntBooks alias set.
const PROPER_NOUNS: ReadonlySet<string> = new Set([
  "paul", "peter", "simon", "moses", "david", "abraham", "isaac", "elijah",
  "jacob", "mary", "joseph", "pilate", "herod", "caesar", "israel", "egypt", "isaiah",
  "judah", "judea", "galilee", "timothy", "barnabas", "judas", "philip",
]);

const BOOK_ALIAS_ENTRIES: ReadonlyArray<{ alias: string; osisId: string }> = ntBooks
  .flatMap((book) =>
    [book.osisId.toLowerCase(), ...book.aliases].map((alias) => ({
      alias: alias.toLowerCase().replace(/\s+/g, " "),
      osisId: book.osisId
    }))
  )
  .sort((a, b) => b.alias.length - a.alias.length || a.alias.localeCompare(b.alias));

const BOOK_ALIASES: ReadonlySet<string> = new Set(BOOK_ALIAS_ENTRIES.map((entry) => entry.alias));

const ALIAS_TO_OSIS: ReadonlyMap<string, string> = new Map(
  BOOK_ALIAS_ENTRIES.map((entry) => [entry.alias, entry.osisId] as const)
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
  for (const { alias, osisId } of BOOK_ALIAS_ENTRIES) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}([^a-z0-9]|$)`, "i");
    if (pattern.test(lower)) return osisId;
  }
  return undefined;
}

const REFERENCE_REGEX = (() => {
  const aliases = [...ALIAS_TO_OSIS.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  // Groups: 1=alias 2=chapter 3=verseStart 4=endChapter(optional) 5=endVerse
  // (?<![a-z0-9]) avoids matching aliases embedded in larger words (e.g. "rom" in "from").
  return new RegExp(
    `(?<![a-z0-9])(${aliases.join("|")})\\s+(\\d+)(?::(\\d+)(?:\\s*[-\\u2013\\u2014]\\s*(?:(\\d+):)?(\\d+))?)?`,
    "gi"
  );
})();

const BOOK_ALIAS_REGEX = (() => {
  const aliases = BOOK_ALIAS_ENTRIES.map((entry) => escapeRegExp(entry.alias));
  return new RegExp(`(?<![a-z0-9])(?:${aliases.join("|")})(?![a-z0-9])`, "gi");
})();

export function detectReferences(prompt: string): ParsedReference[] {
  const out: ParsedReference[] = [];
  for (const match of prompt.matchAll(REFERENCE_REGEX)) {
    const alias = match[1].toLowerCase().replace(/\s+/g, " ");
    const book = ALIAS_TO_OSIS.get(alias);
    if (!book) continue;
    const reference: ParsedReference = { book, chapter: Number.parseInt(match[2], 10) };
    if (match[3] !== undefined) reference.verseStart = Number.parseInt(match[3], 10);
    if (match[5] !== undefined) reference.verseEnd = Number.parseInt(match[5], 10);
    if (match[4] !== undefined) reference.chapterEnd = Number.parseInt(match[4], 10);
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

function stripMorphCodes(prompt: string): string {
  return prompt.replace(MORPH_CODE_REGEX, " ");
}

function stripReferencesAndBookAliases(prompt: string): string {
  return prompt.replace(REFERENCE_REGEX, " ").replace(BOOK_ALIAS_REGEX, " ");
}

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

// Precompiled phrase matchers. Anchored so a phrase embedded in a larger word does
// not match (no alphanumerics on either side); internal whitespace is flexible.
const PHRASE_PATTERNS: ReadonlyArray<{ source: string; phrase: string; lemma: string }> = Object.entries(
  ENGLISH_PHRASE_TO_GREEK_LEMMA
).map(([phrase, lemma]) => ({
  source: `(?<![a-z0-9])${phrase.split(/\s+/).map(escapeRegExp).join("\\s+")}(?![a-z0-9])`,
  phrase,
  lemma
}));

type PhraseMatch = { lemmas: string[]; terms: string[]; cleaned: string };

// Scan the raw prompt for known multi-word phrases, returning the deduped Greek
// lemmas, the matched English phrase strings (`terms`), and a copy of the prompt with
// matched phrases blanked out — so their component words are not also picked up as
// standalone topic words. `terms` is the FTS-usable English text (the lemmas are Greek
// and only drive the deterministic searchLemma / semantic gate).
function matchPhrases(prompt: string): PhraseMatch {
  const lemmas: string[] = [];
  const terms: string[] = [];
  const seenLemma = new Set<string>();
  const seenTerm = new Set<string>();
  let cleaned = prompt;

  const addLemma = (lemma: string) => {
    if (seenLemma.has(lemma)) return;
    seenLemma.add(lemma);
    lemmas.push(lemma);
  };

  const addTerm = (term: string) => {
    if (seenTerm.has(term)) return;
    seenTerm.add(term);
    terms.push(term);
  };

  cleaned = cleaned.replace(/"([^"]+)"/g, (_match, rawPhrase: string) => {
    const phrase = rawPhrase.trim().replace(/\s+/g, " ");
    if (phrase.split(/\s+/).filter(Boolean).length < 2) return " ";
    const normalized = phrase.toLowerCase();
    addTerm(`"${normalized}"`);
    const lemma = ENGLISH_PHRASE_TO_GREEK_LEMMA[normalized];
    if (lemma) addLemma(lemma);
    return " ";
  });

  for (const { source, phrase, lemma } of PHRASE_PATTERNS) {
    if (!new RegExp(source, "i").test(cleaned)) continue;
    addLemma(lemma);
    addTerm(phrase);
    cleaned = cleaned.replace(new RegExp(source, "gi"), " ");
  }
  return { lemmas, terms, cleaned };
}

export function detectPhraseLemmas(prompt: string): string[] {
  return matchPhrases(prompt).lemmas;
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
  // Phrase lemmas join greekWords — the retrieval planner already routes that field
  // to a precise lemma search. Topic words are extracted from the phrase-stripped
  // prompt so a matched phrase's component words don't also fire as standalone
  // keyword searches.
  const references = detectReferences(prompt);
  const phrases = matchPhrases(prompt);
  const topicSource = stripReferencesAndBookAliases(stripMorphCodes(phrases.cleaned));
  return {
    references,
    greekWords: [...detectGreekWords(prompt), ...phrases.lemmas],
    topicWords: detectTopicWords(topicSource),
    morphCodes: detectMorphCodes(prompt),
    intent: detectIntent(prompt),
    book: detectBookFromPrompt(prompt),
    phraseTerms: phrases.terms
  };
}
