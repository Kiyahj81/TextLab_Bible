import { getPassage } from "@/lib/search";
import { parseReference } from "@/lib/references";
import { containmentScore, normalizeEnglish, normalizeGreek } from "@/lib/text/similarity";

export const QUOTE_MATCH_THRESHOLD = 0.9;

export type GroundingClaim = {
  reference: string;
  greekQuote: string | null;
  gloss: string | null;
  englishQuote: string | null;
};

export type ClaimVerdict = {
  claim: GroundingClaim;
  status: "verified" | "reference-not-found" | "quote-mismatch";
  matchScore?: number;
  resolvedText?: string;
  alignmentCaveat?: string;
};

export type GroundingReport = {
  grounded: boolean;
  verdicts: ClaimVerdict[];
};

type ParsedReference = NonNullable<ReturnType<typeof parseReference>>;

async function resolveText(
  cache: Map<string, string | null>,
  corpus: "SBLGNT" | "WEB",
  ref: ParsedReference
): Promise<string | null> {
  const key = `${corpus}|${ref.book}|${ref.chapter}|${ref.verse}|${ref.verseEnd ?? ""}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const res = await getPassage({
    corpus,
    book: ref.book,
    chapter: ref.chapter,
    verseStart: ref.verse,
    verseEnd: ref.verseEnd
  });
  const text = res.references.length ? res.references.map((r) => r.text).join(" ") : null;
  cache.set(key, text);
  return text;
}

export async function verifyGrounding(claims: GroundingClaim[]): Promise<GroundingReport> {
  const cache = new Map<string, string | null>();
  const verdicts: ClaimVerdict[] = [];

  for (const claim of claims) {
    const parsed = parseReference(claim.reference);
    if (!parsed) {
      verdicts.push({ claim, status: "reference-not-found" });
      continue;
    }

    const sblText = await resolveText(cache, "SBLGNT", parsed);
    if (sblText === null) {
      verdicts.push({ claim, status: "reference-not-found" });
      continue;
    }

    const verdict: ClaimVerdict = { claim, status: "verified", resolvedText: sblText };

    if (claim.greekQuote) {
      const score = containmentScore(normalizeGreek(claim.greekQuote), normalizeGreek(sblText));
      verdict.matchScore = score;
      if (score < QUOTE_MATCH_THRESHOLD) {
        verdicts.push({ claim, status: "quote-mismatch", matchScore: score, resolvedText: sblText });
        continue;
      }
    }

    if (claim.englishQuote) {
      const webText = await resolveText(cache, "WEB", parsed);
      if (webText === null) {
        verdict.alignmentCaveat =
          "WEB has no verse at this reference; the English display aid was withheld.";
      } else {
        const englishScore = containmentScore(normalizeEnglish(claim.englishQuote), normalizeEnglish(webText));
        if (englishScore < QUOTE_MATCH_THRESHOLD) {
          verdict.alignmentCaveat =
            "The WEB display translation does not align with the SBLGNT evidence here; the English aid was withheld.";
        }
      }
    }

    verdicts.push(verdict);
  }

  return { grounded: verdicts.every((v) => v.status === "verified"), verdicts };
}
