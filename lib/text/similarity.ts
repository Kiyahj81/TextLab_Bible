// Classic dynamic-programming Levenshtein edit distance.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// NFD-decompose, drop combining marks, lowercase, unify final sigma, drop
// non-letter characters, collapse whitespace. Diacritic-insensitive so accent /
// breathing-mark transcription noise does not cause false refusals.
export function normalizeGreek(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEnglish(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

// Quotes are usually a fragment of the verse. If the (normalized) quote is a
// substring, score 1.0; otherwise slide a window of the quote's length across
// the verse and take the best edit-distance ratio. Inputs must already be
// normalized by the caller.
export function containmentScore(normQuote: string, normVerse: string): number {
  if (!normQuote) return 0;
  if (normVerse.includes(normQuote)) return 1;

  const qlen = normQuote.length;
  if (qlen >= normVerse.length) return ratio(normQuote, normVerse);

  let best = 0;
  for (let i = 0; i + qlen <= normVerse.length; i++) {
    const score = ratio(normQuote, normVerse.slice(i, i + qlen));
    if (score > best) best = score;
    if (best === 1) break;
  }
  return best;
}
