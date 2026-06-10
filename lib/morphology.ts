// Decodes MorphGNT-derived codes as stored on Token.morphCode by
// scripts/import-open-bible.ts: `${partOfSpeech}${parsingCode minus leading dashes}`
// with trailing dashes stripped from the whole string.
// Real shapes: "N-NSM", "RANSM", "V-3PAI-S" (finite), "V-PAPNSM" (participle),
// "V-PAN" (infinitive), "C" (indeclinable — the strip ate the dash of "C-").

const POS_LABELS: Record<string, string> = {
  "A-": "adjective",
  "C-": "conjunction",
  "D-": "adverb",
  "I-": "interjection",
  "N-": "noun",
  "P-": "preposition",
  RA: "article",
  RD: "demonstrative pronoun",
  RI: "interrogative/indefinite pronoun",
  RP: "personal pronoun",
  RR: "relative pronoun",
  "V-": "verb",
  "X-": "particle"
};

const CASES: Record<string, string> = { N: "nominative", G: "genitive", D: "dative", A: "accusative", V: "vocative" };
const NUMBERS: Record<string, string> = { S: "singular", P: "plural" };
const GENDERS: Record<string, string> = { M: "masculine", F: "feminine", N: "neuter" };
const TENSES: Record<string, string> = { P: "present", I: "imperfect", F: "future", A: "aorist", X: "perfect", Y: "pluperfect" };
const VOICES: Record<string, string> = { A: "active", M: "middle", P: "passive" };
const MOODS: Record<string, string> = { I: "indicative", D: "imperative", S: "subjunctive", O: "optative" };
const DEGREES: Record<string, string> = { C: "comparative", S: "superlative" };
const PERSON_ORDINALS: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd" };

export function decodeMorphCode(morphCode: string): string | null {
  const code = morphCode.trim();
  if (!code) return null;
  const pos = code.length === 1 ? `${code}-` : code.slice(0, 2);
  const posLabel = POS_LABELS[pos];
  if (!posLabel) return null;

  const rest = code.slice(2).replace(/^-/, "");
  if (!rest) return posLabel;

  const detail = pos === "V-" ? decodeVerb(rest) : decodeNominal(rest);
  return detail ? `${posLabel} — ${detail}` : posLabel;
}

function decodeNominal(rest: string): string | null {
  const match = rest.match(/^([NGDAV])([SP])([MFN])([CS])?$/);
  if (!match) return null;
  const [, caseCode, numberCode, genderCode, degreeCode] = match;
  const base = `${CASES[caseCode]} ${NUMBERS[numberCode]} ${GENDERS[genderCode]}`;
  return degreeCode ? `${base}, ${DEGREES[degreeCode]}` : base;
}

function decodeVerb(rest: string): string | null {
  const finite = rest.match(/^([123])([PIFAXY])([AMP])([IDSO])-([SP])$/);
  if (finite) {
    const [, person, tense, voice, mood, number] = finite;
    return `${TENSES[tense]} ${VOICES[voice]} ${MOODS[mood]}, ${PERSON_ORDINALS[person]} person ${NUMBERS[number]}`;
  }
  const participle = rest.match(/^([PIFAXY])([AMP])P([NGDAV])([SP])([MFN])$/);
  if (participle) {
    const [, tense, voice, caseCode, number, gender] = participle;
    return `${TENSES[tense]} ${VOICES[voice]} participle, ${CASES[caseCode]} ${NUMBERS[number]} ${GENDERS[gender]}`;
  }
  const infinitive = rest.match(/^([PIFAXY])([AMP])N$/);
  if (infinitive) {
    const [, tense, voice] = infinitive;
    return `${TENSES[tense]} ${VOICES[voice]} infinitive`;
  }
  return null;
}
