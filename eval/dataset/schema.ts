// eval/dataset/schema.ts
import { z } from "zod";

export const QUERY_TYPES = [
  "exact-verse",
  "lemma-survey",
  "conceptual",
  "domain",
  "cross-chapter"
] as const;

export type QueryType = (typeof QUERY_TYPES)[number];

export const goldenItemSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  queryType: z.enum(QUERY_TYPES),
  goldenReferences: z.array(z.string().min(1)).min(1),
  mustContainLemma: z.string().min(1).optional(),
  // Asserted against the DETERMINISTIC score's routing in the key-free gate.
  // NOT a live-routing expectation: in report mode the LLM classifier may
  // legitimately route differently (observed 2026-07-02: the LLM consistently
  // routes routing-why-alone-default scholarly — the purpose of Romans is
  // contested scholarship — while the score correctly stays default). A report
  // showing modelRole !== expectedRouting with routerSource "llm" is not a bug.
  expectedRouting: z.enum(["default", "scholarly"]).optional(),
  notes: z.string().optional()
});

export const goldenSetSchema = z.array(goldenItemSchema).min(1);
export type GoldenItem = z.infer<typeof goldenItemSchema>;
