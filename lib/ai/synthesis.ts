import type { AssistantCitation } from "@/lib/ai/contracts";
import type { RoutingDecision } from "@/lib/ai/modelRouter";
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";
import type { GroundingClaim, GroundingReport } from "@/lib/ai/grounding";
import type { Intent } from "@/lib/ai/signals";
import { getMaxOutputTokens, getTemperature } from "@/lib/ai/modelRouter";
import { getOpenAi } from "@/lib/ai/openaiClient";
import { type ToolTraceEntry } from "@/lib/ai/toolTrace";
import { getPassage } from "@/lib/search";

// Retrieval has already been performed by the deterministic planner before this
// runs. The model is a synthesizer: it writes the answer from the supplied
// evidence and may call `getPassage` AT MOST once-per-round to pull a missing
// adjacent passage. It must never be told to "call the relevant search tool" —
// that instruction makes the model emit tool-call syntax as prose.
export const SYNTHESIS_SYSTEM_PROMPT = `You are an AI Bible study assistant inside an app called TextLab Bible.

Retrieval has already been performed. Below the user prompt you will see a
"Retrieved evidence" block containing the verses, lemmas, and tokens that
match the prompt. Use only this evidence to answer.

If a critical piece of context is missing — for example, the surrounding
verses of a key passage — you may call the getPassage tool. Otherwise, write
the answer directly.

Write a grounded core from the retrieved evidence first: what the text says, plus
lexical/grammatical observations supported by the provided morphology, glosses, and
Louw-Nida domains. You may then add a section headed "Going further" with interpretation
or application — but ONLY when the question invites it, and every such statement must
explicitly build on a stated observation from the core. Do not make leaps disconnected
from the evidence.

Grounding rules:
- Use ONLY the retrieved evidence. No cross-references or doctrine that are not in the
  retrieved evidence. Connecting retrieved passages is encouraged; importing unretrieved
  ones is not.
- Do not overclaim from metadata: a Louw-Nida domain label is a broad orienting category,
  not proof; a gloss is one context-limited English aid — say "the gloss given is …",
  not "the word means …".
- Mention only morphology/gloss/domain fields actually present in the evidence; never
  infer or invent them.

DO NOT include hashtags (#) in responses.

Write for an English reader who may not know Greek.

Rules for Greek in the answer:
1. Never quote a full Greek sentence in the prose answer unless the user explicitly asks for full Greek.
2. Provide the English explanation first.
3. When Greek is helpful or elucidating, quote only the necessary Greek word or short phrase, usually 1-5 words.
4. Every Greek word or phrase in the prose answer must be immediately accompanied by an English gloss in parentheses.
   Example: εἰρήνην (“peace”)
5. Good: Jesus calls this εἰρήνην τὴν ἐμήν (“my peace”).
   Bad: εἰρήνην ἀφίημι ὑμῖν, εἰρήνην τὴν ἐμὴν δίδωμι ὑμῖν...
6. Do not include any Greek text that is not glossed in the same sentence.
7. Do not make the reader infer meaning from Greek word order, syntax, or vocabulary. Explain the significance in English.
8. Full Greek verse quotations belong only in the structured claims array, not in the readable answer, unless the user asks for the full Greek.


Return JSON matching the provided schema: an "answer" string (the prose above)
and a "claims" array. For EVERY textual claim, add one entry with the SBLGNT
"reference", the exact "greekQuote" from that verse (or null), a literal "gloss"
(or null), and an optional "englishQuote" quoted verbatim from WEB as a labeled
readable aid (or null). Citations are always anchored to the SBLGNT (Greek)
source.

When producing greekQuote values, copy the Greek exactly as it appears in the
retrieved SBLGNT evidence, including text-critical sigla, brackets, dots,
accents, breathing marks, punctuation, and repeated words. If you intentionally
omit intervening Greek text, use an ellipsis (...) between exact copied
fragments. Do not smooth, normalize, or paraphrase Greek quotes.

Never invent lexicon entries, manuscript evidence, or scholarly
citations.`;

const INTENT_SHAPE_GUIDANCE: Record<Intent, string> = {
  "morphology":
    "Shape: concise and technical. Lead with the parse/forms. No application or reflection.",
  "passage-study":
    "Shape: medium. State what the passage says with its key grounded lexical observations, then the meaning. Add 'Going further' only if the question asks for significance/application.",
  "word-study":
    "Shape: medium. Survey the occurrences and their senses from the evidence. Rarely add 'Going further'.",
  "topic-survey":
    "Shape: medium. Present the retrieved passages and the thread connecting THEM (no imported passages). Add 'Going further' if the question invites it.",
  "comparison":
    "Shape: medium. Compare side by side; assert only contrasts the evidence supports. Add 'Going further' if invited.",
  "general":
    "Shape: scale to the question. Brief for a lookup; fuller for an open question. Add 'Going further' only if invited."
};

export function buildSynthesisInstructions(intent: Intent = "general"): string {
  return `${SYNTHESIS_SYSTEM_PROMPT}\n\nFor this question:\n${INTENT_SHAPE_GUIDANCE[intent]}`;
}

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

const SYNTHESIS_OUTPUT_FORMAT = {
  type: "json_schema" as const,
  name: "grounded_answer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            reference: { type: "string" },
            greekQuote: { type: ["string", "null"] },
            gloss: { type: ["string", "null"] },
            englishQuote: { type: ["string", "null"] }
          },
          required: ["reference", "greekQuote", "gloss", "englishQuote"]
        }
      }
    },
    required: ["answer", "claims"]
  }
};

export type SynthesisResult = {
  answer: string;
  claims: GroundingClaim[];
  citations: AssistantCitation[];
  toolTrace: ToolTraceEntry[];
};

type SynthesisInput = {
  prompt: string;
  evidence: EvidencePacket;
  routing: RoutingDecision;
  intent?: Intent;
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

function parseSynthesisOutput(text: string | undefined): { answer: string; claims: GroundingClaim[] } | null {
  const raw = text?.trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as { answer?: unknown; claims?: unknown };
  const answer = typeof obj.answer === "string" ? obj.answer.trim() : "";
  if (!answer) return null;
  const claims = Array.isArray(obj.claims) ? (obj.claims as GroundingClaim[]) : [];
  return { answer, claims };
}

export async function synthesizeWithRefinement(input: SynthesisInput): Promise<SynthesisResult | null> {
  const client = getOpenAi();
  if (!client) return null;

  const { prompt, evidence, routing, intent = "general" } = input;
  const instructions = buildSynthesisInstructions(intent);
  const citations: AssistantCitation[] = [...evidence.citations];
  const toolTrace: ToolTraceEntry[] = [...evidence.toolTrace];

  const inputItems: unknown[] = [
    { role: "user", content: [{ type: "input_text", text: buildUserPayload(prompt, evidence) }] }
  ];

  const first = await client.responses.create({
    model: routing.modelUsed,
    instructions: instructions,
    max_output_tokens: getMaxOutputTokens(),
    temperature: getTemperature(),
    tools: [REFINEMENT_TOOL],
    tool_choice: "auto",
    text: { format: SYNTHESIS_OUTPUT_FORMAT },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: inputItems as any
  });
  toolTrace.push({ tool: "openai.responses.create", args: { model: routing.modelUsed, phase: "synthesis" } });

  const calls = functionCalls(first.output);
  if (calls.length === 0) {
    const parsed = parseSynthesisOutput(first.output_text);
    return parsed ? { answer: parsed.answer, claims: parsed.claims, citations, toolTrace } : null;
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
    instructions: instructions,
    max_output_tokens: getMaxOutputTokens(),
    temperature: getTemperature(),
    text: { format: SYNTHESIS_OUTPUT_FORMAT },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: inputItems as any
  });
  toolTrace.push({ tool: "openai.responses.create", args: { model: routing.modelUsed, phase: "refinement-synthesis" } });

  const parsed = parseSynthesisOutput(second.output_text);
  return parsed ? { answer: parsed.answer, claims: parsed.claims, citations, toolTrace } : null;
}

export function buildDeterministicFallback(prompt: string, evidence: EvidencePacket): string {
  const hasEvidence = evidence.citations.length > 0;
  const header = `Grounded evidence TextLab retrieved for "${prompt.trim()}":`;
  const footer = hasEvidence
    ? "These are the cited occurrences from the corpus; treat them as the basis for any further study."
    : "No corpus evidence matched. Try rephrasing around a specific passage, Greek word, or reference so TextLab can retrieve supporting text.";
  return [header, "", evidence.formattedEvidence, "", footer].join("\n");
}

export function buildRefusalAnswer(
  prompt: string,
  evidence: EvidencePacket,
  report: GroundingReport
): string {
  const failed = report.verdicts.filter((v) => v.status !== "verified");
  const reasons = failed
    .map(
      (v) =>
        `- ${v.claim.reference}: ${v.status}` +
        (v.matchScore !== undefined ? ` (match ${v.matchScore.toFixed(2)})` : "")
    )
    .join("\n");

  return [
    "Insufficient textual evidence.",
    "",
    `TextLab drafted an answer to "${prompt.trim()}" but could not verify its citations against the SBLGNT, so it withheld the response rather than risk an unsupported claim.`,
    "",
    ...(failed.length ? [`Unverified claims:\n${reasons}`, ""] : []),
    "Verified evidence retrieved for your query:",
    evidence.formattedEvidence
  ].join("\n");
}

// On a grounded answer, WEB display aids that failed alignment are non-fatal. This
// does NOT remove the English rendering from the model's prose — it appends the
// recorded alignment caveats so the reader is warned the English display text may
// not match the cited Greek. (Actually stripping the aid would require structured
// rendering of the answer from claims; tracked as a follow-up.)
export function appendAlignmentNotes(answer: string, report: GroundingReport): string {
  const caveats = report.verdicts.filter((v) => v.alignmentCaveat);
  if (caveats.length === 0) return answer;
  const lines = caveats.map((v) => `- ${v.claim.reference}: ${v.alignmentCaveat}`).join("\n");
  return `${answer}\n\n---\nUnverified English rendering:\n${lines}`;
}
