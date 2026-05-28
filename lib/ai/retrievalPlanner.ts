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
const MAX_SECTION_LINES = 10;

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

function passageCall(corpus: "SBLGNT" | "WEB", ref: ParsedReference): PlannedCall {
  const verseStart = ref.verseStart ?? 1;
  // A bare chapter reference (no verse) fetches the whole chapter via a high upper bound.
  const verseEnd = ref.verseEnd ?? (ref.verseStart === undefined ? 200 : undefined);
  const args = {
    corpus,
    book: ref.book,
    chapter: ref.chapter,
    verseStart,
    ...(verseEnd !== undefined ? { verseEnd } : {})
  };
  return {
    key: `passage:${corpus}|${ref.book}|${ref.chapter}|${verseStart}|${ref.verseEnd ?? ""}`,
    errorTrace: { tool: "getPassage", args },
    run: async () => {
      const res = await getPassage(args);
      const citations = res.references.map((r) => ({
        reference: r.reference,
        corpus: res.corpus,
        searchQuery: "passage",
        toolName: "getPassage",
        book: r.book,
        chapter: r.chapter,
        verse: r.verse
      }));
      const lines = res.references.slice(0, MAX_SECTION_LINES).map((r) => `- ${r.reference}, ${res.corpus}: ${r.text}`);
      return {
        citations,
        section: sectionBlock(`getPassage(${ref.book} ${ref.chapter}, ${corpus})`, lines, res.references.length),
        traces: [{ tool: "getPassage", args }]
      };
    }
  };
}

function lemmaCall(lemma: string, book?: string): PlannedCall {
  const args = book ? { lemma, book } : { lemma };
  return {
    key: `lemma:${lemma}|${book ?? ""}`,
    errorTrace: { tool: "searchLemma", args },
    run: async () => {
      const res = await searchLemma({ ...args, pageSize: 20 });
      const citations = res.results.map((r) => ({
        reference: r.reference,
        corpus: r.corpus,
        searchQuery: `lemma:${lemma}`,
        toolName: "searchLemma",
        tokenId: r.tokenId
      }));
      const lines = res.results
        .slice(0, MAX_SECTION_LINES)
        .map((r) => `| ${r.reference} | ${r.surface} | ${r.morphCode} | ${r.verseText} |`);
      return {
        citations,
        section: sectionBlock(`searchLemma(${lemma}${book ? `, ${book}` : ""}) — ${res.count} hit(s)`, lines, res.results.length),
        traces: [{ tool: "searchLemma", args }]
      };
    }
  };
}

function keywordCall(word: string, book?: string): PlannedCall {
  const args = book ? { query: word, book } : { query: word };
  return {
    key: `keyword:${word}|${book ?? ""}`,
    errorTrace: { tool: "searchKeyword", args },
    run: async () => {
      const res = await searchKeyword({ ...args, pageSize: 10 });
      const citations = res.results.map((r) => ({
        reference: r.reference,
        corpus: r.corpus,
        searchQuery: `keyword:${word}`,
        toolName: "searchKeyword"
      }));
      const lines = res.results.slice(0, MAX_SECTION_LINES).map((r) => `- ${r.reference}, ${r.corpus}: ${r.text}`);
      return {
        citations,
        section: sectionBlock(`searchKeyword(${word}${book ? `, ${book}` : ""})`, lines, res.results.length),
        traces: [{ tool: "searchKeyword", args }]
      };
    }
  };
}

function morphCall(code: string, mode: "exact" | "prefix", book?: string): PlannedCall {
  const args = book ? { morphCode: code, matchMode: mode, book } : { morphCode: code, matchMode: mode };
  return {
    key: `morph:${code}|${mode}|${book ?? ""}`,
    errorTrace: { tool: "searchMorphology", args },
    run: async () => {
      const res = await searchMorphology({ ...args, pageSize: 20 });
      const citations = res.results.map((r) => ({
        reference: r.reference,
        corpus: r.corpus,
        searchQuery: `morph:${code}`,
        toolName: "searchMorphology",
        tokenId: r.tokenId
      }));
      const lines = res.results
        .slice(0, MAX_SECTION_LINES)
        .map((r) => `| ${r.reference} | ${r.surface} | ${r.lemma} | ${r.morphCode} |`);
      return {
        citations,
        section: sectionBlock(`searchMorphology(${code}, ${mode}) — ${res.count} hit(s)`, lines, res.results.length),
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
  const book = signals.book;

  for (const ref of signals.references) {
    add(passageCall("SBLGNT", ref));
    add(passageCall("WEB", ref));
  }

  for (const lemma of signals.greekWords) {
    add(lemmaCall(lemma, book));
  }

  for (const word of signals.topicWords) {
    const mapped = ENGLISH_TO_GREEK_LEMMA[word];
    if (mapped) add(lemmaCall(mapped, book));
    else add(keywordCall(word, book));
  }

  for (const morph of signals.morphCodes) {
    add(morphCall(morph.code, morph.mode, book));
  }

  if (signals.intent === "topic-survey" && book && calls.length === 0) {
    add(topLemmasCall(book));
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
    citations,
    toolTrace,
    formattedEvidence:
      sections.length > 0 ? sections.join("\n\n") : "No retrieval signals produced evidence from the corpus."
  };
}
