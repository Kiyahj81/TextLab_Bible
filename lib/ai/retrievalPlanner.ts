import type { AssistantCitation } from "@/lib/ai/assistant";
import { type ToolTraceEntry } from "@/lib/ai/toolTrace";
import { ENGLISH_TO_GREEK_LEMMA, type ParsedReference, type Signals } from "@/lib/ai/signals";
import {
  findLemmaExamples,
  getPassage,
  getTopLemmas,
  searchKeyword,
  searchLemma,
  searchMorphology,
  searchSemanticDetailed
} from "@/lib/search";
import { parseReference } from "@/lib/references";

export type EvidencePacket = {
  citations: AssistantCitation[];
  toolTrace: ToolTraceEntry[];
  formattedEvidence: string;
};

// Bounds the number of DB-backed tool calls a single prompt can trigger.
const MAX_PLANNED_CALLS = 8;
// Per-call CITATION sample. Citations stay bounded (save-note caps at 50, the
// synthesis payload slices to 20) even when the evidence text is complete.
const MAX_SECTION_LINES = 10;
// Word-search evidence lines + page size: show all hits when count <= this, else
// this many + the true total count.
const MAX_WORD_SAMPLE = 25;
// Hard ceiling on passage evidence lines per corpus (no real NT chapter/pericope
// approaches this; it only stops a pathological whole-book range).
const MAX_PASSAGE_LINES = 120;
// Ceiling on the TOTAL assembled evidence text. The deterministic fallback embeds
// this verbatim into the answer it returns (and the user may save), so it must stay
// within the generated-study-note persistence caps by construction. The planner can
// otherwise emit up to MAX_PLANNED_CALLS × MAX_PASSAGE_LINES lines (~960 verses ×
// two corpora ≈ 124 KB) for a multi-range prompt. Sized so a realistic single/few-
// reference answer is never trimmed; only a pathological multi-range prompt is.
const MAX_EVIDENCE_CHARS = 58_000;
// Each call cites a bounded sample; the whole packet is capped so downstream
// consumers never overflow.
const MAX_TOTAL_CITATIONS = 40;
// Semantic search: how many fused hits to expand, and the ± window per hit.
const SEMANTIC_HIT_LIMIT = 5;
const SEMANTIC_WINDOW = 2;

type Scope = { book?: string; chapter?: number };

// A single, single-chapter reference scopes word searches to that chapter.
// Multiple references only retain book scope when all refs are in the same book;
// cross-book comparisons stay corpus-wide instead of inheriting the first book.
function scopeFor(signals: Signals): Scope {
  if (signals.references.length === 1) {
    const ref = signals.references[0];
    const singleChapter = ref.chapterEnd === undefined || ref.chapterEnd === ref.chapter;
    if (singleChapter) return { book: ref.book, chapter: ref.chapter };
    return { book: ref.book };
  }
  if (signals.references.length > 1) {
    const books = new Set(signals.references.map((ref) => ref.book));
    if (books.size === 1) return { book: signals.references[0].book };
    return {};
  }
  return signals.book ? { book: signals.book } : {};
}

type CallResult = { citations: AssistantCitation[]; section: string; traces: ToolTraceEntry[] };

type PlannedCall = {
  key: string;
  errorTrace: ToolTraceEntry;
  run: () => Promise<CallResult>;
};

function sectionBlock(heading: string, lines: string[], total: number): string {
  const body = lines.length > 0 ? lines.join("\n") : "(no matches)";
  const more = total > lines.length ? `\n…(${total - lines.length} more)` : "";
  return `### ${heading}\n${body}${more}`;
}

// Join sections into the evidence text, but stop once the total would exceed
// MAX_EVIDENCE_CHARS so the fallback answer (which embeds this) stays within the
// persisted-note caps. At least one section is always kept; if any are dropped, an
// honest marker is appended.
function assembleEvidence(sections: string[]): string {
  if (sections.length === 0) return "No retrieval signals produced evidence from the corpus.";
  const kept: string[] = [];
  let chars = 0;
  let truncated = false;
  for (const section of sections) {
    if (kept.length > 0 && chars + section.length > MAX_EVIDENCE_CHARS) {
      truncated = true;
      break;
    }
    kept.push(section);
    chars += section.length + 2; // separator
  }
  const marker = truncated
    ? "\n\n…(further evidence omitted to keep the answer within the saved-note limit; narrow the request for the rest)"
    : "";
  return kept.join("\n\n") + marker;
}

// "to end of chapter" upper bound (no NT chapter exceeds this).
const PASSAGE_CHAPTER_END = 200;
// How many leading empty chapters to probe before giving up. Lets an out-of-range
// starting verse (empty first segment) still reach a valid later chapter, while
// keeping a fully out-of-range span to a small, bounded number of DB calls.
const MAX_PASSAGE_EMPTY_PROBES = 2;

type PassageSegment = { chapter: number; verseStart: number; verseEnd: number };

// Expand a (possibly cross-chapter) reference into single-chapter fetch segments.
function passageSegments(ref: ParsedReference): PassageSegment[] {
  const startChapter = ref.chapter;
  // Clamp the end chapter so an unvalidated value from an (authenticated) user
  // prompt — e.g. "John 1:1-999999999:1" — cannot allocate an unbounded segment
  // array or fan out into unbounded getPassage calls. No segment beyond the line
  // ceiling can survive the MAX_PASSAGE_LINES slice, so capping the span there is
  // safe and loses nothing for any real NT passage.
  const endChapter = Math.min(ref.chapterEnd ?? startChapter, startChapter + MAX_PASSAGE_LINES);

  // Malformed inverted range (end before start) → no segments; caller's parser
  // should not emit these, but stay safe rather than fetch chapters out of order.
  if (endChapter < startChapter) return [];

  if (endChapter === startChapter) {
    const verseStart = ref.verseStart ?? 1;
    // bare chapter → whole chapter; explicit range → that range; single verse → that verse
    const verseEnd = ref.verseEnd ?? (ref.verseStart === undefined ? PASSAGE_CHAPTER_END : verseStart);
    return [{ chapter: startChapter, verseStart, verseEnd }];
  }

  const segments: PassageSegment[] = [{ chapter: startChapter, verseStart: ref.verseStart ?? 1, verseEnd: PASSAGE_CHAPTER_END }];
  for (let ch = startChapter + 1; ch < endChapter; ch++) {
    segments.push({ chapter: ch, verseStart: 1, verseEnd: PASSAGE_CHAPTER_END });
  }
  segments.push({ chapter: endChapter, verseStart: 1, verseEnd: ref.verseEnd ?? PASSAGE_CHAPTER_END });
  return segments;
}

function passageCall(corpus: "SBLGNT" | "WEB", ref: ParsedReference): PlannedCall {
  const segments = passageSegments(ref);
  const crossChapter = ref.chapterEnd !== undefined && ref.chapterEnd !== ref.chapter;
  const endVersePart = ref.verseEnd !== undefined ? `:${ref.verseEnd}` : "";
  const label = crossChapter
    ? `${ref.book} ${ref.chapter}:${ref.verseStart ?? 1}-${ref.chapterEnd}${endVersePart}`
    : ref.verseStart === undefined
      ? `${ref.book} ${ref.chapter}`
      : `${ref.book} ${ref.chapter}:${ref.verseStart}${ref.verseEnd !== undefined ? `-${ref.verseEnd}` : ""}`;
  return {
    key: `passage:${corpus}|${ref.book}|${ref.chapter}|${ref.verseStart ?? ""}|${ref.chapterEnd ?? ""}|${ref.verseEnd ?? ""}`,
    errorTrace: { tool: "getPassage", args: { corpus, book: ref.book, chapter: ref.chapter } },
    run: async () => {
      const all: Array<{ book: string; chapter: number; verse: number; reference: string; text: string }> = [];
      // Build the trace lazily — one entry per chapter we ACTUALLY fetch — so neither
      // break below leaves phantom getPassage entries in the tool trace, which is
      // forwarded to the synthesis model as grounding context.
      const traces: ToolTraceEntry[] = [];
      let truncatedByCeiling = false;
      let hasContent = false;
      let emptyProbes = 0;
      for (const seg of segments) {
        // Stop once we have enough to fill the ceiling — later segments would be
        // sliced off anyway, so don't pay for the DB round-trips.
        if (all.length >= MAX_PASSAGE_LINES) {
          truncatedByCeiling = true;
          break;
        }
        const args = { corpus, book: ref.book, chapter: seg.chapter, verseStart: seg.verseStart, verseEnd: seg.verseEnd };
        const res = await getPassage(args);
        traces.push({ tool: "getPassage", args });
        if (res.references.length === 0) {
          // Empty AFTER we already have verses → past the book end, stop. Empty
          // BEFORE any content (e.g. an out-of-range starting verse) → probe a
          // bounded number of later chapters so a valid tail isn't silently
          // dropped, without firing one query per clamped segment.
          if (hasContent || ++emptyProbes >= MAX_PASSAGE_EMPTY_PROBES) break;
          continue;
        }
        hasContent = true;
        all.push(...res.references);
      }
      const shown = all.slice(0, MAX_PASSAGE_LINES);
      const citations = shown.slice(0, MAX_SECTION_LINES).map((r) => ({
        reference: r.reference,
        corpus,
        searchQuery: "passage",
        toolName: "getPassage",
        book: r.book,
        chapter: r.chapter,
        verse: r.verse
      }));
      const lines = shown.map((r) => `- ${r.reference}, ${corpus}: ${r.text}`);
      const heading = `getPassage(${label}, ${corpus})`;
      // When the ceiling cut the fetch short, `all` only counts the fetched prefix,
      // so the usual "(N more)" count would understate the omission and could vanish
      // if the prefix lands exactly on the ceiling. Emit an explicit truncation
      // marker instead, so the synthesis model never reads it as complete.
      const section = truncatedByCeiling
        ? `### ${heading}\n${lines.join("\n")}\n…(truncated at ${MAX_PASSAGE_LINES}-line ceiling; request a narrower range for the full passage)`
        : sectionBlock(heading, lines, all.length);
      return { citations, section, traces };
    }
  };
}

function lemmaCall(lemma: string, scope: Scope): PlannedCall {
  const args: { lemma: string; book?: string; chapter?: number } = { lemma };
  if (scope.book) args.book = scope.book;
  if (scope.chapter !== undefined) args.chapter = scope.chapter;
  const label = `${lemma}${scope.book ? `, ${scope.book}` : ""}${scope.chapter !== undefined ? ` ${scope.chapter}` : ""}`;
  return {
    key: `lemma:${lemma}|${scope.book ?? ""}|${scope.chapter ?? ""}`,
    errorTrace: { tool: "searchLemma", args },
    run: async () => {
      const res = await searchLemma({ ...args, pageSize: MAX_WORD_SAMPLE });
      const citations = res.results.slice(0, MAX_SECTION_LINES).map((r) => ({
        reference: r.reference,
        corpus: r.corpus,
        searchQuery: `lemma:${lemma}`,
        toolName: "searchLemma",
        tokenId: r.tokenId
      }));
      const lines = res.results
        .slice(0, MAX_WORD_SAMPLE)
        .map((r) => `| ${r.reference} | ${r.surface} | ${r.morphCode} | ${r.verseText} |`);
      return {
        citations,
        section: sectionBlock(`searchLemma(${label}) — ${res.count} hit(s)`, lines, res.count),
        traces: [{ tool: "searchLemma", args }]
      };
    }
  };
}

function keywordCall(word: string, scope: Scope): PlannedCall {
  const args: { query: string; book?: string; chapter?: number } = { query: word };
  if (scope.book) args.book = scope.book;
  if (scope.chapter !== undefined) args.chapter = scope.chapter;
  const label = `${word}${scope.book ? `, ${scope.book}` : ""}${scope.chapter !== undefined ? ` ${scope.chapter}` : ""}`;
  return {
    key: `keyword:${word}|${scope.book ?? ""}|${scope.chapter ?? ""}`,
    errorTrace: { tool: "searchKeyword", args },
    run: async () => {
      const res = await searchKeyword({ ...args, pageSize: MAX_WORD_SAMPLE, orderBy: "rank" });
      const total = res.pagination?.total ?? res.results.length;
      const citations = res.results.slice(0, MAX_SECTION_LINES).map((r) => ({
        reference: r.reference,
        corpus: r.corpus,
        searchQuery: `keyword:${word}`,
        toolName: "searchKeyword"
      }));
      const lines = res.results.slice(0, MAX_WORD_SAMPLE).map((r) => `- ${r.reference}, ${r.corpus}: ${r.text}`);
      return {
        citations,
        section: sectionBlock(`searchKeyword(${label})`, lines, total),
        traces: [{ tool: "searchKeyword", args }]
      };
    }
  };
}

function morphCall(code: string, mode: "exact" | "prefix", scope: Scope): PlannedCall {
  const args: { morphCode: string; matchMode: "exact" | "prefix"; book?: string; chapter?: number } = {
    morphCode: code,
    matchMode: mode
  };
  if (scope.book) args.book = scope.book;
  if (scope.chapter !== undefined) args.chapter = scope.chapter;
  const label = `${code}, ${mode}${scope.book ? `, ${scope.book}` : ""}${scope.chapter !== undefined ? ` ${scope.chapter}` : ""}`;
  return {
    key: `morph:${code}|${mode}|${scope.book ?? ""}|${scope.chapter ?? ""}`,
    errorTrace: { tool: "searchMorphology", args },
    run: async () => {
      const res = await searchMorphology({ ...args, pageSize: MAX_WORD_SAMPLE });
      const citations = res.results.slice(0, MAX_SECTION_LINES).map((r) => ({
        reference: r.reference,
        corpus: r.corpus,
        searchQuery: `morph:${code}`,
        toolName: "searchMorphology",
        tokenId: r.tokenId
      }));
      const lines = res.results
        .slice(0, MAX_WORD_SAMPLE)
        .map((r) => `| ${r.reference} | ${r.surface} | ${r.lemma} | ${r.morphCode} |`);
      return {
        citations,
        section: sectionBlock(`searchMorphology(${label}) — ${res.count} hit(s)`, lines, res.count),
        traces: [{ tool: "searchMorphology", args }]
      };
    }
  };
}

function topLemmasCall(book: string): PlannedCall {
  return {
    key: `toplemmas:${book}`,
    errorTrace: { tool: "getTopLemmas", args: { book, limit: 10 } },
    run: async () => {
      const top = await getTopLemmas({ book, limit: 10 });
      const examples = await findLemmaExamples({ lemmas: top.map((t) => t.lemma), book, perLemma: 3 });
      const citations = top.flatMap((t) =>
        (examples.get(t.lemma) ?? []).map((r) => ({
          reference: r.reference,
          corpus: r.corpus,
          searchQuery: `lemma:${t.lemma}`,
          toolName: "findLemmaExamples",
          tokenId: r.tokenId
        }))
      );
      const lines = top.slice(0, MAX_SECTION_LINES).map((t) => `| ${t.lemma} | ${t.count} | ${t.partOfSpeech} |`);
      return {
        citations,
        section: sectionBlock(`getTopLemmas(${book})`, lines, top.length),
        traces: [
          { tool: "getTopLemmas", args: { book, limit: 10 } },
          { tool: "findLemmaExamples", args: { lemmas: top.map((t) => t.lemma), book, perLemma: 3 } }
        ]
      };
    }
  };
}

// Fire semantic search only for conceptual prompts that carry an actual concept term:
// either extracted topic words, or a mapped multi-word phrase. The phrase case matters
// because extractSignals strips a matched phrase before computing topicWords (leaving
// none) but records its English text in phraseTerms — so a phrase-only prompt of ANY
// intent ("What is sexual immorality?", "verses about sexual immorality") still gets
// hybrid recall, matching how the single-word equivalent ("What is reconciliation?")
// behaves. A bare, termless book survey ("themes in Hebrews") has neither and stays on
// the deterministic getTopLemmas path instead of issuing an empty semantic call.
export function shouldRunSemantic(signals: Signals): boolean {
  const conceptual = signals.topicWords.length > 0 || (signals.phraseTerms?.length ?? 0) > 0;
  if (!conceptual) return false;
  // Skip semantic search when the prompt is fully pinned to specific verses — a
  // pinpointed lookup (one or more exact verse references) is better served by the
  // deterministic passage/lemma calls. A bare-chapter reference (no verseStart) or
  // a reference-free topical prompt still runs semantic search.
  const allExactVerses =
    signals.references.length > 0 && signals.references.every((r) => r.verseStart !== undefined);
  return !allExactVerses;
}

type SemanticWindowVerse = {
  reference: string;
  sblText: string;
  webText?: string;
};

// Build an on-spine ±2 window for a hit: SBLGNT range defines which references are
// citable; WEB supplies readable display text. A WEB-only verse in the window is
// omitted because it is absent from the SBL range. When WEB exists, keep it beside
// the SBLGNT line so synthesis has exact Greek for greekQuote plus a readable aid.
async function expandOnSpineWindow(
  reference: string
): Promise<SemanticWindowVerse[]> {
  const parsed = parseReference(reference);
  if (!parsed) return [];
  const verseStart = Math.max(1, parsed.verse - SEMANTIC_WINDOW);
  const verseEnd = parsed.verse + SEMANTIC_WINDOW;
  const [sbl, web] = await Promise.all([
    getPassage({ corpus: "SBLGNT", book: parsed.book, chapter: parsed.chapter, verseStart, verseEnd }),
    getPassage({ corpus: "WEB", book: parsed.book, chapter: parsed.chapter, verseStart, verseEnd })
  ]);
  const webText = new Map(web.references.map((r) => [r.verse, r.text]));
  return sbl.references.map((r) => ({
    reference: r.reference,
    sblText: r.text,
    webText: webText.get(r.verse)
  }));
}

function semanticCall(prompt: string, keywords: string, scope: Scope): PlannedCall {
  // Record `keywords` (the FTS half's query) in the trace so the grounding context
  // and user-visible tool-trace reflect that a keyword FTS pass ran alongside KNN.
  const args: { query: string; keywords?: string; book?: string; chapter?: number } = { query: prompt };
  if (keywords) args.keywords = keywords;
  if (scope.book) args.book = scope.book;
  if (scope.chapter !== undefined) args.chapter = scope.chapter;
  return {
    key: `semantic:${scope.book ?? ""}|${scope.chapter ?? ""}`,
    errorTrace: { tool: "searchSemantic", args },
    run: async () => {
      const semantic = await searchSemanticDetailed({
        query: prompt,
        keywords,
        book: scope.book,
        // Honor the same chapter scope as the deterministic calls: a prompt like
        // "verses about love in John 3" must not pull semantic hits from other chapters.
        chapter: scope.chapter,
        limit: SEMANTIC_HIT_LIMIT
      });
      const hits = semantic.results;
      const traceArgs = {
        ...args,
        rerankStatus: semantic.rerank.status,
        rerankCandidateCount: semantic.rerank.candidateCount
      };
      const lines: string[] = [];
      const citations: AssistantCitation[] = [];
      const windows = await Promise.all(hits.map((h) => expandOnSpineWindow(h.reference)));
      hits.forEach((hit, i) => {
        const window = windows[i];
        if (window.length === 0) return;
        lines.push(`#### ${hit.reference} (semantic hit)`);
        for (const v of window) {
          lines.push(`- ${v.reference}, SBLGNT: ${v.sblText}`);
          if (v.webText !== undefined) lines.push(`- ${v.reference}, WEB: ${v.webText}`);
        }
        citations.push({
          reference: hit.reference,
          corpus: "SBLGNT",
          searchQuery: "semantic",
          toolName: "searchSemantic"
        });
      });
      return {
        // No hits (e.g. empty/partial embedding index) → contribute no section, so a
        // degraded semantic index never injects a noisy "(no matches)" block. The
        // trace still records the attempt for observability.
        citations: citations.slice(0, MAX_SECTION_LINES),
        section: lines.length > 0 ? sectionBlock("searchSemantic — top hits with ±2 context", lines, lines.length) : "",
        traces: [{ tool: "searchSemantic", args: traceArgs }]
      };
    }
  };
}

function buildPlan(signals: Signals, prompt: string, semanticEnabled: boolean): PlannedCall[] {
  const calls: PlannedCall[] = [];
  const seen = new Set<string>();
  const add = (call: PlannedCall) => {
    if (seen.has(call.key)) return;
    seen.add(call.key);
    calls.push(call);
  };
  const scope = scopeFor(signals);

  for (const ref of signals.references) {
    add(passageCall("SBLGNT", ref));
    add(passageCall("WEB", ref));
  }

  for (const lemma of signals.greekWords) {
    add(lemmaCall(lemma, scope));
  }

  for (const word of signals.topicWords) {
    const mapped = ENGLISH_TO_GREEK_LEMMA[word];
    if (mapped) add(lemmaCall(mapped, scope));
    else add(keywordCall(word, scope));
  }

  for (const morph of signals.morphCodes) {
    add(morphCall(morph.code, morph.mode, scope));
  }

  if (signals.intent === "topic-survey" && signals.book && calls.length === 0) {
    add(topLemmasCall(signals.book));
  }

  // Bound the DETERMINISTIC calls to the budget.
  const plan = calls.slice(0, MAX_PLANNED_CALLS);

  // Semantic retrieval runs in ADDITION to the deterministic budget (at most one
  // extra call), never inside it. This deliberately resolves the tension between two
  // failure modes: placing it inside the slice either let many topic words crowd it
  // out, or — when the embedding index is empty/partial (live on, but searchSemantic
  // returns [])— let an empty semantic call displace a deterministic search exactly
  // when the index is degraded. As a separate slot it can do neither; an empty result
  // simply contributes no section. Total evidence stays bounded by MAX_EVIDENCE_CHARS.
  if (semanticEnabled && shouldRunSemantic(signals)) {
    // FTS keywords = topic words PLUS matched English phrase terms. Without the phrase
    // terms a phrase-only prompt ("What is sexual immorality?") would pass empty
    // keywords and silently skip the FTS half — leaving it vector-only, unlike its
    // single-word equivalent which gets full KNN+FTS.
    const keywords = [...signals.topicWords, ...(signals.phraseTerms ?? [])].join(" ");
    plan.push(semanticCall(prompt, keywords, scope));
  }

  return plan;
}

export async function runRetrievalPlan(
  signals: Signals,
  prompt = "",
  semanticEnabled = true
): Promise<EvidencePacket> {
  const plan = buildPlan(signals, prompt, semanticEnabled);
  const citations: AssistantCitation[] = [];
  const toolTrace: ToolTraceEntry[] = [];
  const sections: string[] = [];

  const settled = await Promise.allSettled(plan.map((call) => call.run()));
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      citations.push(...result.value.citations);
      toolTrace.push(...result.value.traces);
      if (result.value.section) sections.push(result.value.section);
    } else {
      const message = result.reason instanceof Error ? result.reason.message : "Unknown error";
      toolTrace.push({ ...plan[index].errorTrace, error: message });
    }
  });

  return {
    citations: citations.slice(0, MAX_TOTAL_CITATIONS),
    toolTrace,
    formattedEvidence: assembleEvidence(sections)
  };
}
