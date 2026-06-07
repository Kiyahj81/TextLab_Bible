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
  notes: z.string().optional()
});

export const goldenSetSchema = z.array(goldenItemSchema).min(1);
export type GoldenItem = z.infer<typeof goldenItemSchema>;
