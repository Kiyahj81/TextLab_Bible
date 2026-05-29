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

function cacheKey(corpus: "SBLGNT" | "WEB", ref: ParsedReference): string {
  return `${corpus}|${ref.book}|${ref.chapter}|${ref.verse}|${ref.verseEnd ?? ""}`;
}

async function resolveText(
  cache: Map<string, string | null>,
  corpus: "SBLGNT" | "WEB",
  ref: ParsedReference
): Promise<string | null> {
  const key = cacheKey(corpus, ref);
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

  // Parse once, then resolve every distinct verse lookup in parallel so a
  // multi-claim response costs a single DB round-trip instead of N serial ones.
  // SBLGNT is always needed (the citation spine); WEB only for claims that carry
  // an English display aid.
  const parsedClaims = claims.map((claim) => parseReference(claim.reference));
  const lookups = new Map<string, { corpus: "SBLGNT" | "WEB"; ref: ParsedReference }>();
  claims.forEach((claim, index) => {
    const ref = parsedClaims[index];
    if (!ref) return;
    lookups.set(cacheKey("SBLGNT", ref), { corpus: "SBLGNT", ref });
    if (claim.englishQuote) lookups.set(cacheKey("WEB", ref), { corpus: "WEB", ref });
  });
  await Promise.all([...lookups.values()].map((lookup) => resolveText(cache, lookup.corpus, lookup.ref)));

  // Evaluate verdicts against the warm cache (no further DB awaits).
  const verdicts: ClaimVerdict[] = [];
  claims.forEach((claim, index) => {
    const parsed = parsedClaims[index];
    if (!parsed) {
      verdicts.push({ claim, status: "reference-not-found" });
      return;
    }

    const sblText = cache.get(cacheKey("SBLGNT", parsed)) ?? null;
    if (sblText === null) {
      verdicts.push({ claim, status: "reference-not-found" });
      return;
    }

    const verdict: ClaimVerdict = { claim, status: "verified", resolvedText: sblText };

    if (claim.greekQuote) {
      const score = containmentScore(normalizeGreek(claim.greekQuote), normalizeGreek(sblText));
      if (score < QUOTE_MATCH_THRESHOLD) {
        verdicts.push({ claim, status: "quote-mismatch", matchScore: score, resolvedText: sblText });
        return;
      }
      verdict.matchScore = score;
    }

    if (claim.englishQuote) {
      const webText = cache.get(cacheKey("WEB", parsed)) ?? null;
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
  });

  return { grounded: verdicts.every((v) => v.status === "verified"), verdicts };
}
