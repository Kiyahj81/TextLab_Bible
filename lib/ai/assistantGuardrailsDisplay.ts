export const assistantGuardrailsDisplay = `Corpus-grounded answers

TextLab retrieves relevant passage, lemma, morphology, keyword, and semantic evidence before the live model writes an answer.

The assistant should:
- answer from retrieved corpus evidence, not general biblical memory;
- cite textual claims with book, chapter, verse, and corpus;
- give a grounded core first — what the text says, plus lexical/grammatical observations supported by the provided morphology, glosses, and Louw-Nida domains — and add interpretation only when the question invites it, as a labeled "Going further" step that builds on a stated observation;
- show retrieval trace and citations before export;
- treat Greek or Hebrew word claims cautiously and ground them in retrieved usage;
- avoid invented lexicon entries, manuscript evidence, or scholarly citations.

The live synthesis prompt lives in lib/ai/synthesis.ts. This panel is a readable summary of the guardrails, not the exact model instructions.`;
