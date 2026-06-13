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

// ts_headline sentinels. Private-Use-Area code points (U+E000 / U+E001) that
// cannot appear in WEB or SBLGNT verse text, so splitting the headline back
// into segments is unambiguous. HEADLINE_OPTIONS is passed to ts_headline; the
// same sentinels are parsed out here. Defined via fromCharCode to keep the
// source free of invisible literals.
const HL_START = String.fromCharCode(0xe000);
const HL_END = String.fromCharCode(0xe001);

export const HEADLINE_OPTIONS = `HighlightAll=TRUE, StartSel=${HL_START}, StopSel=${HL_END}`;

export function parseHeadlineSegments(headline: string): HighlightSegment[] {
  if (!headline) return [];
  const pattern = new RegExp(`${HL_START}([\\s\\S]*?)${HL_END}`, "g");
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const hit of headline.matchAll(pattern)) {
    const index = hit.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: "text", value: headline.slice(cursor, index) });
    }
    segments.push({ kind: "match", value: hit[1] });
    cursor = index + hit[0].length;
  }
  if (cursor < headline.length) {
    segments.push({ kind: "text", value: headline.slice(cursor) });
  }
  return segments;
}
