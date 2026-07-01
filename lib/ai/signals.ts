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
  | "passage-recite"
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
  domainQuery?: DomainQuerySignal;
};

export type DomainQuerySignal = { kind: "domain"; code: string } | { kind: "ln"; ref: string };

// Anchored to an explicit Louw-Nida marker so ordinary text — including
// chapter.verse notation like "John 3.16" — never trips domain retrieval.
// Bare dotted refs are intentionally NOT detected here (the /search LN field
// handles those). Both forms validate the domain number as 1..93 (the LN form
// guards the part before the dot); an out-of-range marker is treated as ordinary
// text so the prompt falls back to normal topic extraction/search.
const LN_REF_RE = /(?:louw[\s-]?nida|\bln)\s+(\d{1,2})\.(\d{1,3}[a-z]?)\b/i;
const DOMAIN_NUM_RE = /(?:louw[\s-]?nida|\bln|\bdomain)\s+0*(\d{1,3})\b/i;

export function detectDomainQuery(prompt: string): DomainQuerySignal | undefined {
  const lnMatch = LN_REF_RE.exec(prompt);
  if (lnMatch) {
    const n = Number.parseInt(lnMatch[1], 10);
    if (n >= 1 && n <= 93) return { kind: "ln", ref: `${lnMatch[1]}.${lnMatch[2]}` };
  }
  const domMatch = DOMAIN_NUM_RE.exec(prompt);
  if (domMatch) {
    const n = Number.parseInt(domMatch[1], 10);
    if (n >= 1 && n <= 93) return { kind: "domain", code: String(n).padStart(3, "0") };
  }
  return undefined;
}

function stripDomainMarkers(text: string): string {
  // Both marker forms are stripped only when the captured domain number is in
  // range 1..93 — mirroring detectDomainQuery's guard so an out-of-range marker
  // (which was NOT recognized as a domain query) is left intact for topic
  // extraction. Fresh local /g copies so EVERY in-range marker is stripped (a
  // prompt can name more than one, e.g. "compare LN 33 and domain 88"); the
  // module-level regexes stay non-global because detectDomainQuery drives them
  // with stateful .exec() and must not carry lastIndex between calls.
  const inRange = (num: string) => {
    const n = Number.parseInt(num, 10);
    return n >= 1 && n <= 93;
  };
  const global = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return text
    .replace(global(LN_REF_RE), (match, dom: string) => (inRange(dom) ? " " : match))
    .replace(global(DOMAIN_NUM_RE), (match, num: string) => (inRange(num) ? " " : match));
}

// English Bible terms → Greek lemma. Used by the retrieval planner to turn a
// topic word into a precise lemma search. Intentionally small for v1; extend
// based on real query traffic. A value may be an array when one English term
// has several distinct NT lemmas (e.g. the Hebraic and Hellenized forms of
// "Jerusalem"); the planner fans out one lemma search per entry.
export const ENGLISH_TO_GREEK_LEMMA: Readonly<Record<string, string | readonly string[]>> = {
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
  prayer: ["προσευχή", "δέησις"],
  thanksgiving: "εὐχαριστία",
  fellowship: "κοινωνία",
  prophecy: "προφητεία",
  gifts: "χάρισμα",
  wisdom: "σοφία",
  knowledge: "γνῶσις",
  judgment: ["κρίσις", "κρίμα"],
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
  // Two distinct NT lemmas: the indeclinable Hebraic Ἰερουσαλήμ and the
  // Hellenized Ἱεροσόλυμα. Fan out to both so neither form is missed.
  jerusalem: ["Ἰερουσαλήμ", "Ἱεροσόλυμα"],
  // Named adversary. Kept out of PROPER_NOUNS so named-entity questions ("what
  // does the Bible teach about satan/the devil") route to a precise SBLGNT lemma
  // search. searchLemma matches case-insensitively, so Σατανᾶς and the mixed-case
  // διάβολος/Διάβολος forms are all caught.
  satan: "Σατανᾶς",
  devil: "διάβολος",
  egypt: "Αἴγυπτος",
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

// Frozen baseline stoplist — generic, framing, and morphology words that are noise for
// BOTH keyword/semantic search AND the scholarly-routing concept count. The router reads
// ONLY this list (via detectConceptWords), so it stays stable when the search stoplist is
// tuned. Put a word here when it should be excluded from routing too (e.g. framing words
// like "within"/"context").
const BASE_STOP_WORDS: ReadonlySet<string> = new Set([
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
  "very", "only", "also", "too", "than", "like", "different", "senses", "sense", "bible",
  "form", "forms", "verb", "verbs", "imperative", "imperatives", "indicative", "participle", "participles",
  "subjunctive", "subjunctives", "infinitive", "infinitives", "aorist", "aorists", "tense", "tenses", "mood", "moods",
  "grammar", "grammatical", "parse", "noun", "nouns", "adjective", "adjectives", "adverb", "adverbs", "pronoun", "pronouns",
  "deponent", "optative", "vocative", "nominative", "genitive", "dative", "accusative", "singular", "plural",
  "feminine", "masculine", "neuter", "morphology", "morphological", "within", "context", "contextual",
  // Louw-Nida domain-marker words — never real search concepts. Keeps them out of both
  // search keywords and scholarly routing when an out-of-range marker (e.g. "domain 200 love",
  // "Louw-Nida 94.2 love") is left in the text after detectDomainQuery rejects it.
  "domain", "louw", "nida",
]);

// Additional exclusions for KEYWORD/SEMANTIC SEARCH ONLY. Tune this for search quality;
// it does NOT affect scholarly routing (which counts concepts from BASE_STOP_WORDS via
// detectConceptWords). Add a word here when it pollutes search but should still count as a
// substantive concept for routing. Currently empty — the decoupling is structural.
const SEARCH_ONLY_STOP_WORDS: ReadonlySet<string> = new Set<string>([]);

// Search-facing stoplist = frozen base + search-only extras. Editing SEARCH_ONLY_STOP_WORDS
// changes search without touching routing.
const STOP_WORDS: ReadonlySet<string> = new Set([...BASE_STOP_WORDS, ...SEARCH_ONLY_STOP_WORDS]);

// Proper nouns that should not be treated as topic search terms. Book names are
// already excluded separately via the ntBooks alias set.
const PROPER_NOUNS: ReadonlySet<string> = new Set([
  "paul", "peter", "simon", "moses", "david", "abraham", "isaac", "elijah",
  "jacob", "mary", "joseph", "pilate", "herod", "caesar", "israel", "isaiah",
  "judea", "galilee", "timothy", "barnabas", "judas", "philip",
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

export function detectTopicWords(prompt: string, stopWords: ReadonlySet<string> = STOP_WORDS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of prompt.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 3) continue;
    if (stopWords.has(raw)) continue;
    if (PROPER_NOUNS.has(raw)) continue;
    if (BOOK_ALIASES.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

// Routing-stable "concept" words: filtered by the frozen BASE_STOP_WORDS only, so tuning
// the search stoplist (SEARCH_ONLY_STOP_WORDS) can never shift scholarly routing. The router
// counts these instead of the search-facing topicWords.
export function detectConceptWords(prompt: string): string[] {
  return detectTopicWords(prompt, BASE_STOP_WORDS);
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

  // Word-study routes to the lexical / lexeme answer path. Explicit lexical cues
  // (usage, "senses of", "word study") always qualify. A generic "what does X
  // mean" / "meaning of X" qualifies only when it is NOT about a passage —
  // "what does John 3:16 mean" is passage interpretation, not a word study —
  // unless a Greek lemma is named ("what does νόμος mean in Romans 7"), which
  // keeps the lexeme in focus.
  const hasReference = detectReferences(prompt).length > 0;
  const explicitLexicalCue = /(how (is|are) .+ used|senses of|word study)/.test(lower);
  const genericMeaningQuery = /(what does .+ mean|meaning of)/.test(lower);
  const namesGreekLemma = detectGreekWords(prompt).length > 0;
  if (explicitLexicalCue || (genericMeaningQuery && (!hasReference || namesGreekLemma))) {
    return "word-study";
  }

  if (/(verses about|passages about|find verses|where does .+ (talk|speak))/.test(lower)) {
    return "topic-survey";
  }

  // Explicit "recite the text" requests — lead the answer with the verbatim verse.
  // Needs a passage reference, a recite verb, and NOT a word-survey or analysis framing,
  // so "Explain Romans 8", "what does Paul say ABOUT X", and lemma surveys stay explanatory.
  const reciteVerb = /\b(say|says|written|show|shows|showing|display|read|recite|quote)\b/.test(lower);
  const wordSurvey = /\b(use|uses|usage|sense|senses|occurrence|occurrences|mean|meaning|word study)\b/.test(lower);
  const analysisFraming =
    /\b(explain|why|significance|implication|teach|about|regarding|concerning|plain language)\b/.test(lower);
  if (hasReference && reciteVerb && !wordSurvey && !analysisFraming) {
    return "passage-recite";
  }

  if (hasReference || /\b(show|read)\b/.test(lower) || lower.includes("passage")) {
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
  const domainQuery = detectDomainQuery(prompt);
  const topicSource = stripDomainMarkers(
    stripReferencesAndBookAliases(stripMorphCodes(phrases.cleaned))
  );
  return {
    references,
    greekWords: [...detectGreekWords(prompt), ...phrases.lemmas],
    topicWords: detectTopicWords(topicSource),
    morphCodes: detectMorphCodes(prompt),
    intent: detectIntent(prompt),
    book: detectBookFromPrompt(prompt),
    phraseTerms: phrases.terms,
    domainQuery
  };
}
