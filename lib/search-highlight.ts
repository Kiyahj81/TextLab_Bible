export type HighlightSegment = { kind: "text" | "match"; value: string };

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function normalize(value: string): string {
  return value.normalize("NFC");
}

export function splitWithMatches(text: string, match: string): HighlightSegment[] {
  if (!text) return [];
  if (!match) return [{ kind: "text", value: text }];

  const haystack = normalize(text);
  const needle = normalize(match);
  if (!needle) return [{ kind: "text", value: text }];

  const pattern = new RegExp(needle.replace(REGEX_SPECIALS, "\\$&"), "giu");
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const hit of haystack.matchAll(pattern)) {
    const index = hit.index ?? 0;
    const [token] = hit;
    if (index > cursor) {
      segments.push({ kind: "text", value: haystack.slice(cursor, index) });
    }
    segments.push({ kind: "match", value: token });
    cursor = index + token.length;
    if (token.length === 0) {
      cursor += 1;
    }
  }

  if (cursor < haystack.length) {
    segments.push({ kind: "text", value: haystack.slice(cursor) });
  }

  return segments;
}
