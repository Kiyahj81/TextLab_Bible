export type MarkdownCitation = {
  reference: string;
  corpus: string;
};

export function createMarkdownExport(input: {
  title: string;
  body: string;
  citations: MarkdownCitation[];
}) {
  const citations = input.citations
    .map((citation) => `- ${citation.reference}, ${citation.corpus}`)
    .join("\n");

  return {
    markdown: `# ${input.title}\n\n${input.body}\n\n## Citations\n\n${citations || "- No citations"}\n`
  };
}
