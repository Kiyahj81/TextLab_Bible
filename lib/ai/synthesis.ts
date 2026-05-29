import type { AssistantCitation } from "@/lib/ai/assistant";
import type { RoutingDecision } from "@/lib/ai/modelRouter";
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";
import { getMaxOutputTokens } from "@/lib/ai/modelRouter";
import { getOpenAi } from "@/lib/ai/openaiClient";
import { type ToolTraceEntry } from "@/lib/ai/toolTrace";
import { getPassage } from "@/lib/search";

// Retrieval has already been performed by the deterministic planner before this
// runs. The model is a synthesizer: it writes the answer from the supplied
// evidence and may call `getPassage` AT MOST once-per-round to pull a missing
// adjacent passage. It must never be told to "call the relevant search tool" —
// that instruction makes the model emit tool-call syntax as prose.
export const SYNTHESIS_SYSTEM_PROMPT = `You are an AI Bible study assistant inside TextLab Bible.

Retrieval has already been performed. Below the user prompt you will see a
"Retrieved evidence" block containing the verses, lemmas, and tokens that
match the prompt. Use only this evidence to answer.

If a critical piece of context is missing — for example, the surrounding
verses of a key passage — you may call the getPassage tool. Otherwise, write
the answer directly.

Structure the answer in three sections:
1. Textual observations
2. Interpretive suggestion
3. Application/reflection

Cite every textual claim with book, chapter, verse, and corpus. Never invent
lexicon entries, manuscript evidence, or scholarly citations. Do not claim that
a Greek word "means" something unless the retrieved usage data supports it.`;

const REFINEMENT_TOOL = {
  type: "function" as const,
  name: "getPassage",
  strict: true,
  description:
    "Fetch additional verse text from SBLGNT or WEB. Use ONLY when the retrieved evidence is missing critical context (e.g., you need verses immediately before or after a passage already cited). Do not use to re-fetch what is already in the evidence block.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      corpus: { type: "string", enum: ["SBLGNT", "WEB"] },
      book: { type: "string", description: "OSIS id or book name." },
      chapter: { type: "integer", minimum: 1 },
      verseStart: { type: "integer", minimum: 1 },
      verseEnd: {
        // OpenAI strict mode requires every property in `required`; express
        // "optional" as a nullable type rather than omitting it.
        type: ["integer", "null"],
        minimum: 1,
        description: "Inclusive end verse. Pass null to fetch a single verse."
      }
    },
    required: ["corpus", "book", "chapter", "verseStart", "verseEnd"]
  }
};

export type SynthesisResult = {
  answer: string;
  citations: AssistantCitation[];
  toolTrace: ToolTraceEntry[];
};

type SynthesisInput = {
  prompt: string;
  evidence: EvidencePacket;
  routing: RoutingDecision;
};

function buildUserPayload(prompt: string, evidence: EvidencePacket): string {
  return [
    `User prompt:\n${prompt}`,
    `Retrieved evidence:\n${evidence.formattedEvidence}`,
    `Retrieved citations:\n${JSON.stringify(evidence.citations.slice(0, 20))}`
  ].join("\n\n");
}

type FunctionCallItem = {
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
};

function functionCalls(output: unknown): FunctionCallItem[] {
  if (!Array.isArray(output)) return [];
  return output.filter(
    (item): item is FunctionCallItem =>
      typeof item === "object" && item !== null && (item as { type?: string }).type === "function_call"
  );
}

async function executeGetPassage(call: FunctionCallItem): Promise<{
  output: unknown;
  citations: AssistantCitation[];
  trace: ToolTraceEntry;
}> {
  let args: { corpus: "SBLGNT" | "WEB"; book: string; chapter: number; verseStart: number; verseEnd?: number | null };
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return { output: { error: "Invalid tool arguments" }, citations: [], trace: { tool: "getPassage", error: "Invalid tool arguments" } };
  }

  let res: Awaited<ReturnType<typeof getPassage>>;
  try {
    res = await getPassage({
      corpus: args.corpus,
      book: args.book,
      chapter: args.chapter,
      verseStart: args.verseStart,
      verseEnd: args.verseEnd ?? undefined
    });
  } catch (err) {
    // Attribute DB failures to getPassage (not the model call) and let the
    // remaining refinement complete rather than aborting synthesis.
    const message = err instanceof Error ? err.message : "Unknown error";
    return { output: { error: message }, citations: [], trace: { tool: "getPassage", args, error: message } };
  }

  const citations = res.references.map((r) => ({
    reference: r.reference,
    corpus: res.corpus,
    searchQuery: "passage",
    toolName: "getPassage",
    book: r.book,
    chapter: r.chapter,
    verse: r.verse
  }));
  return { output: res, citations, trace: { tool: "getPassage", args } };
}

export async function synthesizeWithRefinement(input: SynthesisInput): Promise<SynthesisResult | null> {
  const client = getOpenAi();
  if (!client) return null;

  const { prompt, evidence, routing } = input;
  const citations: AssistantCitation[] = [...evidence.citations];
  const toolTrace: ToolTraceEntry[] = [...evidence.toolTrace];

  const inputItems: unknown[] = [
    { role: "user", content: [{ type: "input_text", text: buildUserPayload(prompt, evidence) }] }
  ];

  const first = await client.responses.create({
    model: routing.modelUsed,
    instructions: SYNTHESIS_SYSTEM_PROMPT,
    max_output_tokens: getMaxOutputTokens(),
    tools: [REFINEMENT_TOOL],
    tool_choice: "auto",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: inputItems as any
  });
  toolTrace.push({ tool: "openai.responses.create", args: { model: routing.modelUsed, phase: "synthesis" } });

  const calls = functionCalls(first.output);
  if (calls.length === 0) {
    const answer = first.output_text?.trim();
    return answer ? { answer, citations, toolTrace } : null;
  }

  // Execute every getPassage call from this round, then make exactly one more
  // synthesis call with NO tools registered — this hard-caps refinement.
  inputItems.push(...calls);
  // executeGetPassage never throws, so these DB round-trips can run in parallel.
  const callResults = await Promise.all(calls.map((call) => executeGetPassage(call)));
  callResults.forEach((result, index) => {
    toolTrace.push(result.trace);
    citations.push(...result.citations);
    inputItems.push({ type: "function_call_output", call_id: calls[index].call_id, output: JSON.stringify(result.output) });
  });

  const second = await client.responses.create({
    model: routing.modelUsed,
    instructions: SYNTHESIS_SYSTEM_PROMPT,
    max_output_tokens: getMaxOutputTokens(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: inputItems as any
  });
  toolTrace.push({ tool: "openai.responses.create", args: { model: routing.modelUsed, phase: "refinement-synthesis" } });

  const answer = second.output_text?.trim();
  return answer ? { answer, citations, toolTrace } : null;
}

export function buildDeterministicFallback(prompt: string, evidence: EvidencePacket): string {
  const hasEvidence = evidence.citations.length > 0;
  return [
    `Textual observations: TextLab retrieved the following evidence for "${prompt.trim()}".`,
    "",
    evidence.formattedEvidence,
    "",
    hasEvidence
      ? "Interpretive suggestion: Any summary should stay limited to the retrieved occurrences above; the pattern is visible only where the corpus contains matching tokens."
      : "Interpretive suggestion: No corpus evidence was retrieved, so no grounded interpretation can be offered for this prompt.",
    "",
    hasEvidence
      ? "Application/reflection: Use the cited references as the starting point before making broader theological claims."
      : "Application/reflection: Try rephrasing the question around a specific passage, Greek word, or reference so TextLab can retrieve supporting text."
  ].join("\n");
}
