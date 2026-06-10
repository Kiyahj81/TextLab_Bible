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

// Robinson tense/mood letters that differ from the stored MorphGNT scheme.
// Robinson R=perfect → stored X; Robinson M=imperative → stored D.
const ROBINSON_TENSE_MAP: Record<string, string> = { R: "X" };
const ROBINSON_MOOD_MAP: Record<string, string> = { M: "D" };

// Robinson finite verb: V-<tense><voice><mood>-<person><number>
// e.g. "V-PAI-3S" (present active indicative 3rd singular)
const ROBINSON_FINITE_RE = /^V-([PIFRAXY])([AMP])([ISOMD])-([123])([SP])$/i;

// Robinson participle: V-<tense><voice>P-<case><number><gender>
// e.g. "V-PAP-NSM" (present active participle nominative singular masculine)
const ROBINSON_PARTICIPLE_RE = /^V-([PIFRAXY])([AMP])P-([NGDAV])([SP])([MFN])$/i;

// Robinson infinitive: V-<tense><voice>N
// e.g. "V-PAN" (present active infinitive), "V-RAN" → "V-XAN"
const ROBINSON_INFINITIVE_RE = /^V-([PIFRAXY])([AMP])N$/i;

/**
 * Normalizes a Robinson-convention morph code query to the stored MorphGNT
 * scheme used in Token.morphCode, so that user- or assistant-supplied Robinson
 * codes match the corpus.
 *
 * Differences handled:
 *  - Finite verbs: Robinson person-LAST ("V-PAI-3S") → stored person-FIRST ("V-3PAI-S")
 *  - Tense letter: Robinson R=perfect → stored X
 *  - Mood letter:  Robinson M=imperative → stored D
 *  - Participles:  Robinson dashed ("V-PAP-NSM") → stored joined ("V-PAPNSM")
 *  - Infinitives:  tense R→X only (shape otherwise identical)
 *
 * Input is uppercased before matching so lowercase queries work. Anything
 * that is already in MorphGNT form or is not a recognized Robinson pattern
 * (nouns, pronouns, prefixes, arbitrary text) is returned unchanged.
 */
export function normalizeMorphCodeQuery(code: string): string {
  const upper = code.toUpperCase();

  // Robinson finite verb: V-TAM-PSN → V-P T A M - S (person-first)
  const finiteMatch = ROBINSON_FINITE_RE.exec(upper);
  if (finiteMatch) {
    const [, tense, voice, mood, person, number] = finiteMatch;
    const t = ROBINSON_TENSE_MAP[tense] ?? tense;
    const m = ROBINSON_MOOD_MAP[mood] ?? mood;
    return `V-${person}${t}${voice}${m}-${number}`;
  }

  // Robinson participle: V-TAP-CGN → V-TAPNGN (dash removed)
  const participleMatch = ROBINSON_PARTICIPLE_RE.exec(upper);
  if (participleMatch) {
    const [, tense, voice, caseCode, number, gender] = participleMatch;
    const t = ROBINSON_TENSE_MAP[tense] ?? tense;
    return `V-${t}${voice}P${caseCode}${number}${gender}`;
  }

  // Robinson infinitive: V-TAN → V-TAN (same shape, but tense R→X)
  const infinitiveMatch = ROBINSON_INFINITIVE_RE.exec(upper);
  if (infinitiveMatch) {
    const [, tense, voice] = infinitiveMatch;
    const t = ROBINSON_TENSE_MAP[tense] ?? tense;
    return `V-${t}${voice}N`;
  }

  // Pass through: already MorphGNT-scheme, nominals, prefixes, arbitrary text.
  return code;
}

export function decodeMorphCode(morphCode: string): string | null {
  const code = morphCode.trim();
  if (!code) return null;
  const pos = code.length === 1 ? `${code}-` : code.slice(0, 2);
  const posLabel = POS_LABELS[pos];
  if (!posLabel) return null;

  const rest = code.slice(2).replace(/^-/, "");
  if (!rest) return posLabel;

  // Adverb/particle degree: rest is exactly "C" or "S" and pos is not a verb
  if (pos !== "V-" && (rest === "C" || rest === "S")) {
    return `${posLabel} — ${DEGREES[rest]}`;
  }

  // Personal/interrogative/demonstrative/relative pronoun family:
  // Try digit-led person decode, then case+number+gender (nominal), then case+number only.
  if (pos === "RP" || pos === "RI" || pos === "RD" || pos === "RR") {
    const detail =
      decodePronoun(rest) ??
      decodeNominal(rest) ??
      decodeCaseNumber(rest);
    return detail ? `${posLabel} — ${detail}` : posLabel;
  }

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

function decodePronoun(rest: string): string | null {
  // Digit-led person + case + number, e.g. "1NS", "2AS"
  const match = rest.match(/^([123])([NGDAV])([SP])$/);
  if (!match) return null;
  const [, person, caseCode, numberCode] = match;
  return `${PERSON_ORDINALS[person]} person ${CASES[caseCode]} ${NUMBERS[numberCode]}`;
}

function decodeCaseNumber(rest: string): string | null {
  const match = rest.match(/^([NGDAV])([SP])$/);
  if (!match) return null;
  const [, caseCode, numberCode] = match;
  return `${CASES[caseCode]} ${NUMBERS[numberCode]}`;
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
