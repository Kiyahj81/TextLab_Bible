# Stage 1 — 2A Faithfulness Before/After Snapshot (2026-06-26)

Manual measurement for the "Assistant Grounded, Question-Shaped Answers — Stage 1" work
(plan: `docs/superpowers/plans/2026-06-26-assistant-grounded-answers-stage-1.md`).

**Method.** `npm run eval:report` (non-blocking hybrid pipeline + LLM faithfulness judge) against the
`.env.test` Neon branch (full NT corpus). Live synthesis on (OPENAI_API_KEY), faithfulness judge on
(AI_GATEWAY_API_KEY), semantic KNN on. Faithfulness = fraction of an answer's atomic statements the
judge marks *directly supported by the retrieved evidence*. Per-statement reasons drive the bucket
classification below.

- **BEFORE**: branch base `c8ca1ee` (docs branch = `main` + planning docs; no code changes).
- **AFTER**: `3f5b786` (Stage 1 Tasks 1–9 + the acceptance lockstep fix; runtime assistant code at `8e29a8f`).
- Same env / same golden set (20 items) for both runs.

## Headline

| Metric | BEFORE | AFTER |
|---|---|---|
| Items judged | 16 / 20 | 14 / 20 |
| Mean faithfulness (all judged) | 0.662 | 0.920 |
| **Mean faithfulness (12 items judged in BOTH runs)** | **0.638** | **0.935** (+0.30) |
| **Total ✗ statements on those common 12 items** | **60** | **10** (−83%) |

**Judge-error caveat (why we compare the common 12).** The LLM judge intermittently errors (transient
gateway 4xx), so the judged set differs run to run: BEFORE errored on 4 items
(`john-3-16-exact`, `reconciliation-conceptual`, `sexual-immorality-conceptual`, `earthen-vessels-cross-chapter`);
AFTER errored on 6 (`reconciliation`, `domain-33-communication`, `domain-ln-25-love`, `beatitudes-cross-chapter`,
`earthen-vessels`, `armor-of-god-cross-chapter`). These errors are unrelated to the code change. The
**12 items judged in both runs** are the apples-to-apples comparison; the gain there (+0.30, ✗ 60→10) is
the trustworthy number. (Of the items only AFTER could judge: `john-3-16` 0.67, `sexual-immorality` 1.00.)

## Per-item (BEFORE → AFTER score; ✗ before→after)

```text
0.80 -> 1.00  ✗ 3->0  agape-1cor13-lemma
0.75 -> 1.00  ✗ 3->0  charis-eph2-lemma
0.63 -> 0.96  ✗ 6->1  domain-88-moral-rom1
0.30 -> 0.88  ✗ 7->1  faith-hope-love-exact
0.43 -> 0.93  ✗ 8->1  fruit-of-spirit-conceptual
0.59 -> 1.00  ✗ 7->0  justification-faith-conceptual
0.75 -> 0.85  ✗ 3->2  logos-john1-lemma
0.61 -> 0.69  ✗ 7->4  love-neighbor-conceptual
0.31 -> 1.00  ✗ 9->0  matt-6-9-exact
1.00 -> 1.00  ✗ 0->0  pistis-rom4-lemma
1.00 -> 0.91  ✗ 0->1  resurrection-1cor15-conceptual   (lone regression: one new ✗)
0.50 -> 1.00  ✗ 7->0  rom-8-28-exact
(AFTER-only, BEFORE judge-errored)  john-3-16-exact 0.67 (✗5) · sexual-immorality-conceptual 1.00 (✗0)
(AFTER judge-errored, not scored)  domain-33, domain-ln-25, beatitudes, armor-of-god
```

The largest gains are exactly the items that BEFORE were drowning in forced interpretation/application:
`matt-6-9` 0.31→1.00, `rom-8-28` 0.50→1.00, `justification-faith` 0.59→1.00, `faith-hope-love` 0.30→0.88,
`fruit-of-spirit` 0.43→0.93.

## ✗ Composition — what changed

**BEFORE (80 ✗ across 16 items).** Dominated by three failure modes the old 3-section prompt forced:
- **A — forced interpretation/application**: nearly every item carried applicational ✗'s
  ("believers are encouraged to…", "a practical application of this verse is…") because the prompt
  mandated an Application/reflection section.
- **B — lexical/metadata overclaim**: glosses/domains asserted as the word's meaning
  ("Louw-Nida domain 33 focuses on communication", "μακάριοι means 'happy'", "χάρις = unearned favor").
- **C — imported/outside content**: passages and labels never retrieved
  ("the Lord's Prayer", Good Samaritan conclusions, Psalm 37:11, Isaiah 59:17, "Sermon on the Mount").

**AFTER (15 ✗ across 14 items).** The forced-application flood (A) is **gone** — no applicational ✗'s
remain, because "Going further" is now opt-in and application is no longer mandated. The residual ✗'s:

- **B — residual lexical/metadata overclaim (~6)**: the model still occasionally states a lexical sense
  the evidence's gloss/domain doesn't define — `john-3-16` "οὕτως emphasizes manner/degree" (evidence
  domain says 'Sequence'), "τὸν κόσμον means humanity as a whole", "aorist indicates completed past
  action"; `love-neighbor` "ἀγαπήσεις expresses committed active concern, not merely affection",
  "πλησίον … not limited by ethnicity/status". These are the next target (the anti-overclaim guardrail
  reduced but did not eliminate them — several are *defensible standard lexicography* the strict judge
  still dings because the definition isn't literally in the evidence block).
- **C — imported/outside (~3)**: `love-neighbor` still reaches for the Good Samaritan parable (not
  retrieved) ×2, and `faith-hope-love` "Paul concludes his discussion of love" (no preceding context
  retrieved). Far fewer than BEFORE, and concentrated in one topical item whose retrieval is thin.
- **A — interpretation, now as visible derivation (~6)**: e.g. `john-3-16` "the contrast underscores the
  life-giving result of faith", `logos-john1` "the repetition emphasizes identity/relationship",
  `fruit-of-spirit` "presented as the natural outcome ('fruit') of Spirit-directed life",
  `resurrection-1cor15` "Acts 24:15 aligns Paul with broader Jewish resurrection expectation".

## "Going further" ✗ — defensible derivation vs genuine leap (raw input for the 2B rubric)

Classifying the interpretation-class (A) residual ✗'s, which is the design input for the future Stage-2B
split metric:

- **Defensible derivation** (builds visibly on a stated core observation; the judge dings it only because
  the *conclusion* isn't verbatim in the evidence): `john-3-16` "contrast underscores the life-giving
  result of faith" (builds on the retrieved perish/eternal-life contrast); `logos-john1` "repetition
  emphasizes identity/relationship" and "λόγος denotes a preexistent divine agent who becomes incarnate"
  (builds on retrieved "in the beginning"/"became flesh"); `fruit-of-spirit` "natural outcome ('fruit')"
  (builds on the word καρπός); `resurrection-1cor15` Acts 24:15 framing (builds on the retrieved verse).
- **Borderline / genuine leap** (extends past the retrieved evidence into doctrine): `domain-88`
  "underlines Paul's central claim … sets the stage for the gospel's saving power" (reaches beyond the
  domain-term contrast into a salvation-history claim).
- **Residual lexical (B) — not derivation, a separate target**: the οὕτως / κόσμον / ἀγαπήσεις / πλησίον
  cases are gloss-as-meaning overclaims, not Going-further leaps; Stage 2B should score these on the
  lexical axis, not the interpretation axis.

**Takeaway for 2B.** Most surviving interpretation ✗'s are defensible derivations a split metric should
*credit* (they build on retrieved observations), not penalize as overreach. The genuine remaining work is
(1) tightening the lexical-gloss guardrail (B) and (2) improving topical retrieval so items like
`love-neighbor` actually retrieve the passages they reason about (C), rather than reaching for unretrieved
ones. The forced-application failure mode that 2A targeted is eliminated.

## Artifacts

Raw `report.json` / `report.html` for both runs are preserved in the session scratchpad
(`scratchpad/2A-before/`, `scratchpad/2A-after/`); `eval/output/` holds the latest (AFTER) run.
