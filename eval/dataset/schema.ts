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
  // legitimately route a borderline item differently from the score, and different
  // router models disagree (2026-07-02: on routing-why-alone-default — "Why did Paul
  // write Romans?", contested scholarship — gpt-5-mini routed scholarly while the
  // current default gpt-5.4-mini agreed with the score's default). A report showing
  // modelRole !== expectedRouting with routerSource "llm" is a model judgment call,
  // not a bug.
  expectedRouting: z.enum(["default", "scholarly"]).optional(),
  notes: z.string().optional()
});

export const goldenSetSchema = z.array(goldenItemSchema).min(1);
export type GoldenItem = z.infer<typeof goldenItemSchema>;
