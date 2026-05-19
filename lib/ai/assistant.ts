import { createMarkdownExport } from "@/lib/export/markdown";
import { getPassage, searchKeyword, searchLemma, searchMorphology } from "@/lib/search";

export type AssistantCitation = {
  reference: string;
  corpus: string;
  searchQuery: string;
};

export type AssistantAnswer = {
  answer: string;
  citations: AssistantCitation[];
  markdown: string;
  toolTrace: string[];
};

const lemmaAliases: Array<{ needles: string[]; lemma: string; label: string }> = [
  { needles: ["λόγος", "λογος", "logos", "word"], lemma: "λόγος", label: "λόγος" },
  { needles: ["δικαιοσύνη", "δικαιοσυνη", "righteousness"], lemma: "δικαιοσύνη", label: "δικαιοσύνη" },
  { needles: ["πιστεύω", "πιστευω", "believe"], lemma: "πιστεύω", label: "πιστεύω" }
];

export async function answerBibleQuestion(prompt: string): Promise<AssistantAnswer> {
  const normalized = prompt.toLowerCase();
  const toolTrace: string[] = [];

  const book = normalized.includes("rom") || normalized.includes("romans") ? "Rom" : normalized.includes("john") ? "John" : undefined;

  const lemma = lemmaAliases.find((entry) =>
    entry.needles.some((needle) => normalized.includes(needle.toLowerCase()))
  );

  if (lemma) {
    const search = await searchLemma({ lemma: lemma.lemma, book });
    toolTrace.push(`searchLemma({ lemma: "${lemma.lemma}"${book ? `, book: "${book}"` : ""} })`);

    const citations = search.results.map((result) => ({
      reference: result.reference,
      corpus: result.corpus,
      searchQuery: `lemma:${lemma.lemma}`
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

    return withMarkdown("Lemma Study", answer, citations, toolTrace);
  }

  if (normalized.includes("morph") || normalized.includes("imperative")) {
    const morphCode = normalized.includes("imperative") ? "V-P" : extractMorphCode(prompt) ?? "V-";
    const search = await searchMorphology({ morphCode, matchMode: "prefix", book });
    toolTrace.push(`searchMorphology({ morphCode: "${morphCode}", matchMode: "prefix"${book ? `, book: "${book}"` : ""} })`);

    const citations = search.results.map((result) => ({
      reference: result.reference,
      corpus: result.corpus,
      searchQuery: `morph:${morphCode}`
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

    return withMarkdown("Morphology Search", answer, citations, toolTrace);
  }

  if (normalized.includes("john 1") || normalized.includes("passage")) {
    const [greek, english] = await Promise.all([
      getPassage({ corpus: "SBLGNT", book: book ?? "John", chapter: 1, verseStart: 1, verseEnd: 5 }),
      getPassage({ corpus: "WEB", book: book ?? "John", chapter: 1, verseStart: 1, verseEnd: 5 })
    ]);
    toolTrace.push(`getPassage({ corpus: "SBLGNT", book: "${book ?? "John"}", chapter: 1, verseStart: 1, verseEnd: 5 })`);
    toolTrace.push(`getPassage({ corpus: "WEB", book: "${book ?? "John"}", chapter: 1, verseStart: 1, verseEnd: 5 })`);

    const citations = [
      ...greek.references.map((result) => ({
        reference: result.reference,
        corpus: "SBLGNT",
        searchQuery: "passage"
      })),
      ...english.references.map((result) => ({
        reference: result.reference,
        corpus: "WEB",
        searchQuery: "passage"
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

    return withMarkdown("Passage Study", answer, citations, toolTrace);
  }

  const keyword = prompt.trim();
  const search = await searchKeyword({ query: keyword, book });
  toolTrace.push(`searchKeyword({ query: "${keyword}"${book ? `, book: "${book}"` : ""} })`);

  const citations = search.results.map((result) => ({
    reference: result.reference,
    corpus: result.corpus,
    searchQuery: `keyword:${keyword}`
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

  return withMarkdown("Keyword Search", answer, citations, toolTrace);
}

function extractMorphCode(prompt: string) {
  return prompt.match(/\b[A-Z]-[A-Z0-9-]+\b/)?.[0];
}

function withMarkdown(
  title: string,
  answer: string,
  citations: AssistantCitation[],
  toolTrace: string[]
): AssistantAnswer {
  const exportResult = createMarkdownExport({
    title,
    body: answer,
    citations
  });

  return {
    answer,
    citations,
    markdown: exportResult.markdown,
    toolTrace
  };
}
