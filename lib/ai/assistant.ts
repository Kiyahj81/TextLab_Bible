import { createMarkdownExport } from "@/lib/export/markdown";
import {
  type AssistantMode,
  type ModelRole,
  type RecommendedUpgrade,
  type RoutingDecision,
  isLiveAssistantEnabled,
  routeAssistantPrompt,
  synthesizeWithDefaultModel
} from "@/lib/ai/modelRouter";
import { findLemmaExamples, getPassage, getTopLemmas, searchKeyword, searchLemma, searchMorphology } from "@/lib/search";
import { ntBooks } from "@/lib/references";
import { type ToolTraceEntry } from "@/lib/ai/toolTrace";

type BranchContext = {
  prompt: string;
  normalized: string;
  book?: string;
  routing: RoutingDecision;
  toolTrace: ToolTraceEntry[];
};

export type AssistantCitation = {
  reference: string;
  corpus: string;
  searchQuery: string;
  toolName?: string;
  book?: string;
  chapter?: number;
  verse?: number;
  tokenId?: string;
};

export type AssistantAnswer = {
  answer: string;
  citations: AssistantCitation[];
  markdown: string;
  toolTrace: ToolTraceEntry[];
  mode: AssistantMode;
  modelRole: ModelRole;
  modelUsed: string;
  routingDecision: string;
  recommendedUpgrade?: RecommendedUpgrade;
  sessionId?: string;
};

const lemmaAliases: Array<{ needles: string[]; lemma: string; label: string }> = [
  { needles: ["λόγος", "λογος", "logos"], lemma: "λόγος", label: "λόγος" },
  { needles: ["δικαιοσύνη", "δικαιοσυνη", "righteousness"], lemma: "δικαιοσύνη", label: "δικαιοσύνη" },
  { needles: ["πιστεύω", "πιστευω", "believe"], lemma: "πιστεύω", label: "πιστεύω" }
];

export function detectBookFromPrompt(prompt: string): string | undefined {
  const lower = prompt.toLowerCase();
  for (const book of ntBooks) {
    for (const alias of book.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
      if (pattern.test(lower)) return book.osisId;
    }
  }
  return undefined;
}

export async function answerBibleQuestion(prompt: string): Promise<AssistantAnswer> {
  const routing = routeAssistantPrompt(prompt);
  const localAnswer = await answerFromLocalRetrieval(prompt, routing);

  if (!isLiveAssistantEnabled()) {
    return localAnswer;
  }

  try {
    const liveAnswer = await synthesizeWithDefaultModel({ prompt, localAnswer, routing });

    if (!liveAnswer) {
      return localAnswer;
    }

    return withMarkdown({
      title: "TextLab Assistant",
      answer: liveAnswer,
      citations: localAnswer.citations,
      toolTrace: [
        ...localAnswer.toolTrace,
        { tool: "modelRouter", args: { role: routing.modelRole, model: routing.modelUsed } },
        { tool: "openai.responses.create", args: { model: routing.modelUsed } }
      ],
      mode: "live",
      ...routing
    });
  } catch (error) {
    return withMarkdown({
      title: "TextLab Assistant",
      answer: localAnswer.answer,
      citations: localAnswer.citations,
      toolTrace: [
        ...localAnswer.toolTrace,
        { tool: "modelRouter", args: { role: routing.modelRole, model: routing.modelUsed } },
        { tool: "openai.responses.create", error: error instanceof Error ? error.message : "Unknown error" }
      ],
      mode: "fallback",
      ...routing,
      routingDecision: `${routing.routingDecision} The live model call failed, so TextLab returned the local retrieval fallback.`
    });
  }
}

const branches: Array<(ctx: BranchContext) => Promise<AssistantAnswer | null>> = [
  importantWordsBranch,
  lemmaAliasBranch,
  morphologyBranch,
  passageBranch
];

async function answerFromLocalRetrieval(prompt: string, routing = routeAssistantPrompt(prompt)): Promise<AssistantAnswer> {
  const ctx: BranchContext = {
    prompt,
    normalized: prompt.toLowerCase(),
    book: detectBookFromPrompt(prompt),
    routing,
    toolTrace: []
  };

  for (const branch of branches) {
    const result = await branch(ctx);
    if (result) return result;
  }

  return keywordFallback(ctx);
}

async function importantWordsBranch(ctx: BranchContext): Promise<AssistantAnswer | null> {
  const { book, normalized, routing, toolTrace } = ctx;

  if (!(book && isImportantWordsPrompt(normalized))) {
    return null;
  }

  const topLemmas = await getTopLemmas({ book, limit: 3 });
  toolTrace.push({ tool: "getTopLemmas", args: { book, limit: 3 } });

  const examples = await findLemmaExamples({
    lemmas: topLemmas.map((l) => l.lemma),
    book,
    perLemma: 5
  });
  toolTrace.push({ tool: "findLemmaExamples", args: { lemmas: topLemmas.map((l) => l.lemma), book, perLemma: 5 } });

  const citations = topLemmas.flatMap((entry) =>
    (examples.get(entry.lemma) ?? []).map((result) => ({
      reference: result.reference,
      corpus: result.corpus,
      searchQuery: `lemma:${entry.lemma}`,
      toolName: "findLemmaExamples",
      tokenId: result.tokenId
    }))
  );

  const rows = topLemmas
    .map((entry) => {
      const refs = (examples.get(entry.lemma) ?? []).map((r) => r.reference).join("; ");
      return `| ${entry.lemma} | ${entry.count} | ${entry.partOfSpeech} | ${refs || "No examples returned"} |`;
    })
    .join("\n");

  const answer = [
    `Textual observations: I searched the full SBLGNT token data for ${book} and ranked frequent content lemmas after excluding common function words and helper verbs.`,
    "",
    "| Lemma | Occurrences | Part of speech | Sample references |",
    "| --- | ---: | --- | --- |",
    rows || "| None | 0 | - | No matching lemma data. |",
    "",
    "Interpretive suggestion: \"Most important\" is an interpretive category, so this answer uses prominence in the tagged corpus as the measurable starting point. These lemmas should be treated as a retrieval-based shortlist, not a final theological ranking.",
    "",
    "Application/reflection: Use the cited occurrences to test whether these frequent content words actually carry the themes you want to study in context."
  ].join("\n");

  return withMarkdown({
    title: "Important Words",
    answer,
    citations,
    toolTrace,
    mode: "fallback",
    ...routing
  });
}

async function lemmaAliasBranch(ctx: BranchContext): Promise<AssistantAnswer | null> {
  const { book, normalized, routing, toolTrace } = ctx;

  const lemma = lemmaAliases.find((entry) =>
    entry.needles.some((needle) => normalized.includes(needle.toLowerCase()))
  );

  if (!lemma) {
    return null;
  }

  const search = await searchLemma({ lemma: lemma.lemma, book });
  toolTrace.push({ tool: "searchLemma", args: book ? { lemma: lemma.lemma, book } : { lemma: lemma.lemma } });

  const citations = search.results.map((result) => ({
    reference: result.reference,
    corpus: result.corpus,
    searchQuery: `lemma:${lemma.lemma}`,
    toolName: "searchLemma",
    tokenId: result.tokenId
  }));

  const rows = search.results
    .map(
      (result) =>
        `| ${result.reference} | ${result.surface} | ${result.morphCode} | ${result.verseText} |`
    )
    .join("\n");

  const answer = [
    `Textual observations: I found ${search.count} occurrence${search.count === 1 ? "" : "s"} of ${lemma.label}${book ? ` in ${book}` : ""} in the sample database.`,
    "",
    "| Reference | Form | Morphology | Verse |",
    "| --- | --- | --- | --- |",
    rows || "| None | - | - | No matching sample-data results. |",
    "",
    "Interpretive suggestion: Any summary should stay limited to these retrieved occurrences. In this sample, the pattern is visible only where the database contains matching tokens.",
    "",
    "Application/reflection: Use the cited verses as the starting point before making broader theological claims."
  ].join("\n");

  return withMarkdown({
    title: "Lemma Study",
    answer,
    citations,
    toolTrace,
    mode: "fallback",
    ...routing
  });
}

async function morphologyBranch(ctx: BranchContext): Promise<AssistantAnswer | null> {
  const { book, normalized, prompt, routing, toolTrace } = ctx;

  if (!(normalized.includes("morph") || normalized.includes("imperative"))) {
    return null;
  }

  const morphCode = normalized.includes("imperative") ? "V-P" : extractMorphCode(prompt) ?? "V-";
  const search = await searchMorphology({ morphCode, matchMode: "prefix", book });
  toolTrace.push({ tool: "searchMorphology", args: book ? { morphCode, matchMode: "prefix", book } : { morphCode, matchMode: "prefix" } });

  const citations = search.results.map((result) => ({
    reference: result.reference,
    corpus: result.corpus,
    searchQuery: `morph:${morphCode}`,
    toolName: "searchMorphology",
    tokenId: result.tokenId
  }));

  const rows = search.results
    .map((result) => `| ${result.reference} | ${result.surface} | ${result.lemma} | ${result.morphCode} |`)
    .join("\n");

  const answer = [
    `Textual observations: I searched the sample token data for morphology prefix ${morphCode} and found ${search.count} matching token${search.count === 1 ? "" : "s"}.`,
    "",
    "| Reference | Form | Lemma | Morphology |",
    "| --- | --- | --- | --- |",
    rows || "| None | - | - | - |",
    "",
    "Interpretive suggestion: The assistant is reporting only tagged sample tokens, so absence from the table is not evidence about the full Greek New Testament.",
    "",
    "Application/reflection: Review the cited forms in their immediate verses before drawing conclusions."
  ].join("\n");

  return withMarkdown({
    title: "Morphology Search",
    answer,
    citations,
    toolTrace,
    mode: "fallback",
    ...routing
  });
}

async function passageBranch(ctx: BranchContext): Promise<AssistantAnswer | null> {
  const { book, normalized, routing, toolTrace } = ctx;

  if (!(normalized.includes("john 1") || normalized.includes("passage"))) {
    return null;
  }

  const [greek, english] = await Promise.all([
    getPassage({ corpus: "SBLGNT", book: book ?? "John", chapter: 1, verseStart: 1, verseEnd: 5 }),
    getPassage({ corpus: "WEB", book: book ?? "John", chapter: 1, verseStart: 1, verseEnd: 5 })
  ]);
  toolTrace.push({ tool: "getPassage", args: { corpus: "SBLGNT", book: book ?? "John", chapter: 1, verseStart: 1, verseEnd: 5 } });
  toolTrace.push({ tool: "getPassage", args: { corpus: "WEB", book: book ?? "John", chapter: 1, verseStart: 1, verseEnd: 5 } });

  const citations = [
    ...greek.references.map((result) => ({
      reference: result.reference,
      corpus: "SBLGNT",
      searchQuery: "passage",
      toolName: "getPassage",
      book: result.book,
      chapter: result.chapter,
      verse: result.verse
    })),
    ...english.references.map((result) => ({
      reference: result.reference,
      corpus: "WEB",
      searchQuery: "passage",
      toolName: "getPassage",
      book: result.book,
      chapter: result.chapter,
      verse: result.verse
    }))
  ];

  const answer = [
    "Textual observations: I retrieved John 1:1-5 from SBLGNT and WEB before answering.",
    "",
    greek.references.map((verse) => `- ${verse.reference}, SBLGNT: ${verse.text}`).join("\n"),
    "",
    english.references.map((verse) => `- ${verse.reference}, WEB: ${verse.text}`).join("\n"),
    "",
    "Interpretive suggestion: The sample passage emphasizes the Word, creation, life, and light within the cited verses.",
    "",
    "Application/reflection: Keep any study note tied to the cited passage rather than importing outside lexical or manuscript claims."
  ].join("\n");

  return withMarkdown({
    title: "Passage Study",
    answer,
    citations,
    toolTrace,
    mode: "fallback",
    ...routing
  });
}

async function keywordFallback(ctx: BranchContext): Promise<AssistantAnswer> {
  const { book, prompt, routing, toolTrace } = ctx;

  const keyword = prompt.trim();
  const search = await searchKeyword({ query: keyword, book });
  toolTrace.push({ tool: "searchKeyword", args: book ? { query: keyword, book } : { query: keyword } });

  const citations = search.results.map((result) => ({
    reference: result.reference,
    corpus: result.corpus,
    searchQuery: `keyword:${keyword}`,
    toolName: "searchKeyword"
  }));

  const answer = [
    `Textual observations: I searched the sample verse text for "${keyword}" and found ${search.results.length} matching verse${search.results.length === 1 ? "" : "s"}.`,
    "",
    ...search.results.map((result) => `- ${result.reference}, ${result.corpus}: ${result.text}`),
    "",
    "Interpretive suggestion: The response is limited to the retrieved sample data.",
    "",
    "Application/reflection: Broader conclusions should wait until full-corpus import exists."
  ].join("\n");

  return withMarkdown({
    title: "Keyword Search",
    answer,
    citations,
    toolTrace,
    mode: "fallback",
    ...routing
  });
}

function extractMorphCode(prompt: string) {
  return prompt.match(/\b[A-Z]-[A-Z0-9-]+\b/)?.[0];
}

function isImportantWordsPrompt(normalizedPrompt: string) {
  return (
    (normalizedPrompt.includes("important") || normalizedPrompt.includes("top") || normalizedPrompt.includes("key")) &&
    (normalizedPrompt.includes("word") || normalizedPrompt.includes("lemma") || normalizedPrompt.includes("theme"))
  );
}

type WithMarkdownInput = {
  title: string;
  answer: string;
  citations: AssistantCitation[];
  toolTrace: ToolTraceEntry[];
  mode: AssistantMode;
  modelRole: ModelRole;
  modelUsed: string;
  routingDecision: string;
  recommendedUpgrade?: RecommendedUpgrade;
};

function withMarkdown(input: WithMarkdownInput): AssistantAnswer {
  const { title, answer, citations, toolTrace, ...metadata } = input;
  const exportResult = createMarkdownExport({
    title,
    body: answer,
    citations
  });

  return {
    answer,
    citations,
    markdown: exportResult.markdown,
    toolTrace,
    ...metadata
  };
}
