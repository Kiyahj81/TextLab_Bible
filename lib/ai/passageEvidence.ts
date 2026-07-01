// lib/ai/passageEvidence.ts
import { decodeMorphCode } from "@/lib/morphology";
import type { PassageToken } from "@/lib/search/passageTokens";

// Skip articles, conjunctions, and particles by default. These are the stored
// 2-char Token.partOfSpeech values (see lib/morphology.ts POS_LABELS).
export const ANNOTATION_SKIP_POS: readonly string[] = ["RA", "C-", "X-"];

// Negation is meaning-critical (it can flip a clause) and is tagged inconsistently
// in the corpus: οὐ/μή are usually adverbs (D-, annotated) but a real minority are
// tagged particles (X-, in the skip list above). Always keep these so the negation
// gets its per-token annotation regardless of POS tag.
const NEGATION_LEMMAS: ReadonlySet<string> = new Set(["οὐ", "οὐκ", "οὐχ", "οὐχί", "οὔ", "μή"]);

function isContentToken(t: PassageToken, targetLemmas?: ReadonlySet<string>): boolean {
  if (t.lemma && targetLemmas?.has(t.lemma)) return true; // always keep query targets
  if (t.lemma && NEGATION_LEMMAS.has(t.lemma)) return true; // always keep negation (meaning-critical)
  return !ANNOTATION_SKIP_POS.includes(t.partOfSpeech ?? "");
}

// One indented "surface · lemma · decoded morph · "gloss" · domain" line per kept
// token; every field after surface is included only when present.
export function formatTokenAnnotations(
  tokens: PassageToken[],
  opts: { contentOnly?: boolean; targetLemmas?: ReadonlySet<string> } = {}
): string[] {
  const contentOnly = opts.contentOnly ?? true;
  const lines: string[] = [];
  for (const t of tokens) {
    if (contentOnly && !isContentToken(t, opts.targetLemmas)) continue;
    const parts: string[] = [t.surface];
    if (t.lemma) parts.push(t.lemma);
    const decoded = t.morphCode ? decodeMorphCode(t.morphCode) : null;
    if (decoded) parts.push(decoded);
    if (t.gloss) parts.push(`"${t.gloss}"`);
    if (t.domainLabel) parts.push(t.domainLabel);
    lines.push(`    ${parts.join(" · ")}`);
  }
  return lines;
}
