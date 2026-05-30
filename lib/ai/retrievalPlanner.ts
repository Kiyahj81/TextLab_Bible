import type { AssistantCitation } from "@/lib/ai/assistant";
import { type ToolTraceEntry } from "@/lib/ai/toolTrace";
import { ENGLISH_TO_GREEK_LEMMA, type ParsedReference, type Signals } from "@/lib/ai/signals";
import {
  findLemmaExamples,
  getPassage,
  getTopLemmas,
  searchKeyword,
  searchLemma,
  searchMorphology
} from "@/lib/search";

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
// Each call cites a bounded sample; the whole packet is capped so downstream
// consumers never overflow.
const MAX_TOTAL_CITATIONS = 40;

type Scope = { book?: string; chapter?: number };

// A single, single-chapter reference scopes word searches to that chapter. A
// cross-chapter reference, multiple references, or none falls back to book scope
// (or corpus-wide if no book is detected).
function scopeFor(signals: Signals): Scope {
  if (signals.references.length === 1) {
    const ref = signals.references[0];
    const singleChapter = ref.chapterEnd === undefined || ref.chapterEnd === ref.chapter;
    if (singleChapter) return { book: ref.book, chapter: ref.chapter };
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

// "to end of chapter" upper bound (no NT chapter exceeds this).
const PASSAGE_CHAPTER_END = 200;

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
        // A chapter past the book's end (or an out-of-range start) returns nothing.
        // Stop here so a pathological span can't fire one empty query per clamped
        // segment — the verse ceiling never trips when chapters come back empty.
        if (res.references.length === 0) break;
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
      const res = await searchKeyword({ ...args, pageSize: MAX_WORD_SAMPLE });
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

function buildPlan(signals: Signals): PlannedCall[] {
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

  return calls.slice(0, MAX_PLANNED_CALLS);
}

export async function runRetrievalPlan(signals: Signals): Promise<EvidencePacket> {
  const plan = buildPlan(signals);
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
    formattedEvidence:
      sections.length > 0 ? sections.join("\n\n") : "No retrieval signals produced evidence from the corpus."
  };
}
