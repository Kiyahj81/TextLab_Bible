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

// A single claim often summarizes several non-adjacent occurrences, joining the
// quoted fragments with an ellipsis (e.g. "νόμῳ θεοῦ … νόμῳ ἁμαρτίας" or the
// ASCII "..."). The spliced whole is never a contiguous substring of the verse,
// so scoring it as one string produces a false mismatch. Split on the ellipsis
// and require EVERY fragment to match; the claim's score is its weakest
// fragment. A quote with no ellipsis yields a single fragment, so this is a
// no-op for the common case.
const ELLIPSIS_SEPARATOR = /\s*(?:…|\.{2,})\s*/;

function fragmentContainment(quote: string, verseText: string, normalize: (s: string) => string): number {
  const normVerse = normalize(verseText);
  const fragments = quote
    .split(ELLIPSIS_SEPARATOR)
    .map((fragment) => normalize(fragment))
    .filter((fragment) => fragment.length > 0);
  if (fragments.length === 0) return 0;
  return Math.min(...fragments.map((fragment) => containmentScore(fragment, normVerse)));
}

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
      const score = fragmentContainment(claim.greekQuote, sblText, normalizeGreek);
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
          "WEB has no verse at this reference; treat any English rendering as unverified against the Greek.";
      } else {
        const englishScore = fragmentContainment(claim.englishQuote, webText, normalizeEnglish);
        if (englishScore < QUOTE_MATCH_THRESHOLD) {
          verdict.alignmentCaveat =
            "This English wording couldn't be confirmed against the WEB display text for this verse; treat it as an unverified paraphrase and defer to the SBLGNT Greek.";
        }
      }
    }

    verdicts.push(verdict);
  });

  return { grounded: verdicts.every((v) => v.status === "verified"), verdicts };
}
