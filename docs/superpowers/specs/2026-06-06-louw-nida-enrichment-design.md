# Milestone 3 Phase 5 — Louw-Nida Enrichment: Design

*Status:* Approved 2026-06-06 · *Milestone:* 3 (High-Fidelity NT Exegesis) · *Phase:* 5 ·
*Scope:* NT-Greek subset · *Predecessor:* Phase 4b (cross-encoder rerank, on `main`)

## Summary

Import the Louw-Nida semantic-domain data already present in the MACULA TSV
(`data/macula-greek/macula-greek-SBLGNT.tsv`), attach human-readable domain and subdomain labels
from the open UBS lexical-domains dataset, and expose the result on three surfaces: the reader
morphology popover, assistant domain-aware retrieval, and a `/search` domain mode.

The MACULA TSV carries two relevant per-token columns:

- `domain` — MARBLE numeric codes, e.g. `033005`, sometimes multiple space-separated (`010002 033003`).
- `ln` — Louw-Nida references, e.g. `33.38`, sometimes multiple (`10.24 33.19`) with letter suffixes (`93.169a`).

Neither column carries labels. Labels come from the open UBS dataset (see §1). A MACULA `domain` code
maps **directly** to a Level-2 subdomain entry in that dataset; truncating the code to its first three
digits (`033`) gives the Level-1 domain entry. The `ln` reference is the human-facing citation form.

## Phasing

This is larger than the roadmap's "~1 day" sizing because the consumer scope was expanded to all three
surfaces. It is split like Phase 4a/4b so each part ships independently:

- **Phase 5a — Data + schema + popover display.** Vendoring the label dataset, schema + migration,
  import-pipeline changes, the reference-table seed, and read-time label resolution in the reader popover.
  Self-contained and shippable on its own.
- **Phase 5b — Assistant domain retrieval + `/search` domain mode.** Both consume 5a's stored codes and
  reference table. Ships after 5a.

Each sub-phase gets its own implementation plan and PR.

---

## 1. Label data sourcing (Phase 5a)

**Source.** `UBSGreekNTDicLexicalDomains-v1.1-en.JSON` from
[`ubsicap/ubs-open-license`](https://github.com/ubsicap/ubs-open-license)
(`dictionaries/greek/JSON/`). This is the open release of the MARBLE / Semantic Dictionary of the Greek
New Testament lexical-domain taxonomy — the same data the MACULA `domain` codes index into.

**File shape** (confirmed against the live file):

```json
{
  "SemanticDomainLocalizations": [{
    "LanguageCode": "en",
    "Label": "Geographical Objects and Features",
    "Description": "",
    "Comment": "..."
  }],
  "Level": 1,
  "Code": "001",
  "HasSubDomains": true,
  "Entries": []
}
```

- `Code` — numeric domain identifier; Level 1 is 3 digits (`001`, `033`), Level 2 is 6 digits (`001002`, `033005`).
- `Level` — `1` = main domain, `2` = subdomain.
- `Label` (inside `SemanticDomainLocalizations[LanguageCode == "en"]`) — the human-readable name.
- `HasSubDomains` — whether the entry has children.

**Vendoring.** Commit the JSON under `data/louw-nida/UBSGreekNTDicLexicalDomains-v1.1-en.JSON`. It is the
taxonomy file (not the 15 MB full dictionary), so it is small and stable.

**Licensing — CC-BY-SA 4.0 (obligation).** The UBS data is Creative Commons Attribution-ShareAlike 4.0.
This is the only new external dependency in Phase 5 and carries explicit obligations:

- **Attribution** — add a credit to `README.md` (Open Text Imports section) and a `data/louw-nida/NOTICE.md`
  naming the source, version, license, and URL.
- **ShareAlike** — applies to the data and any adapted/derived database of it. Record the obligation in
  `docs/security-register.md` (licensing notes) so future corpus-expansion work inherits the constraint.

The Greek text (SBLGNT/MorphGNT) and WEB remain under their existing licenses; this adds a separately
licensed reference dataset, not a relicensing of the corpus.

---

## 2. Schema (Phase 5a)

### `Token` — new columns

```prisma
model Token {
  // ...existing fields...
  louwNida  String[]  // Louw-Nida references, e.g. ["33.38"]
  lnDomain  String[]  // MARBLE numeric codes, e.g. ["033005"]

  // ...existing indexes...
  @@index([lnDomain], type: Gin)
}
```

- Both are Postgres scalar string arrays (`text[]`), default empty. Prisma represents these natively as
  `String[]` on PostgreSQL.
- The GIN index on `lnDomain` backs `@>` membership queries (retrieval + search). `louwNida` is carried for
  display/citation and does not need its own index in Phase 5 (add later only if `ln`-ref search is built).
- Positional alignment: for a given token, `louwNida[i]` corresponds to `lnDomain[i]` — both arrays are
  built from the same MACULA row in column order, so element *i* is the same sense.

### `LouwNidaDomain` — new reference table

```prisma
model LouwNidaDomain {
  code       String  @id          // e.g. "033" or "033005"
  level      Int                  // 1 = domain, 2 = subdomain
  label      String               // e.g. "Communication" / "Speak, Talk"
  parentCode String?              // e.g. "033" for "033005"; null for level 1

  @@index([parentCode])
}
```

- Flattened Level-1 + Level-2 entries from the vendored JSON. `parentCode` is the 3-digit prefix for
  Level-2 rows, `null` for Level-1.
- Static reference data, small (93 domains plus their subdomains), seeded idempotently (§3).

### Migration

One new Prisma migration (`prisma migrate dev`) adding the two `Token` columns, the GIN index, and the
`LouwNidaDomain` table. Follows the existing hand-written-migration convention (`db:push` stays disabled).

---

## 3. Import pipeline (Phase 5a)

### 3a. `parseMaculaTsv` (`scripts/import-open-bible.ts`)

- Add `const lnIdx = col("ln");` and `const domainIdx = col("domain");`.
- Parse each into a string array: split on whitespace, trim, drop empties and `"-"` sentinels.
- Extend `ParsedMaculaRow` with `louwNida: string[]` and `lnDomain: string[]`.

```ts
const splitCodes = (raw: string | undefined): string[] =>
  (raw ?? "").trim().split(/\s+/).filter((c) => c && c !== "-");

const louwNida = splitCodes(cells[lnIdx]);
const lnDomain = splitCodes(cells[domainIdx]);
```

The MACULA override table (`MACULA_OVERRIDES`, Pericope Adulterae) does not currently carry domain data;
overridden rows keep whatever the upstream `domain`/`ln` columns supply. No override-table change needed.

### 3b. `importMaculaGreekGlosses` — carry codes through both write paths

The current code updates only `gloss`. Both paths must additionally persist the arrays:

- **Overridden-verse refresh path** (the `prisma.token.update` near the `inOverriddenVerse` branch): add
  `louwNida: row.louwNida` and `lnDomain: row.lnDomain` to the `data` object.
- **Batch `updates` path**: the `updates` array currently pushes `{ id, gloss }`; extend to
  `{ id, gloss, louwNida, lnDomain }`, and extend the batched `prisma.token.update` `data` accordingly.

These are idempotent: re-running the import overwrites the arrays with the parsed values.

### 3c. `scripts/import-louw-nida.ts` (new) + `npm run import:louw-nida`

- Reads the vendored JSON, walks Level-1 and Level-2 entries, and `upsert`s `LouwNidaDomain` rows
  (`code`, `level`, `label` from the `en` localization, `parentCode` = 3-digit prefix for Level 2).
- Idempotent — safe to re-run. Matches the existing `import:*` script family and runs via
  `tsx --env-file=.env`.
- Sequencing: run `import:louw-nida` (reference table) then re-run `import:macula-glosses` (token codes).

### 3d. Acceptance/test-count impact

Per project memory, retrieval/corpus changes can break `scripts/acceptance-test.js` corpus-count
assertions. Token *rows* do not change in Phase 5 (only new columns populated), so counts should hold —
but verify, and update the script if any assertion keys off token/verse content.

---

## 4. Popover display (Phase 5a)

### Read-time label resolution

`getReaderPassage` (`lib/search.ts` / reader data path) currently returns reader tokens with
lemma/morph/gloss. Extend it to resolve domain labels:

1. Collect the distinct `lnDomain` codes across the passage's tokens.
2. Look up labels in one query: the Level-2 row (subdomain label) and its `parentCode` Level-1 row
   (domain label) — a single `LouwNidaDomain` `findMany` over `code IN (codes ∪ parentCodes)`, assembled
   into a `Map`.
3. For each token, build a per-sense list pairing `lnDomain[i]` → `{ domainLabel, subdomainLabel }` with
   `louwNida[i]` as the citation ref.

The resolved structure (e.g. `senses: { domainLabel, subdomainLabel, ref }[]`) is attached to the reader
token and flows into `ReaderToken` in `components/MorphologyPopover.tsx`.

### UI

`MorphologyPopover` gains a "Semantic domain" row in the definition list, rendered per the approved mock:

```
Domain     Communication
Subdomain  Speak, Talk (33.38)
```

- Multi-sense tokens render one line per sense.
- Tokens with no domain data render nothing for this row (consistent with the existing
  "Not supplied"/omit pattern — omit rather than show "Unknown" for an absent enrichment).

---

## 5. Assistant domain retrieval (Phase 5b)

### Signal detection (`lib/ai/signals.ts`)

Detect explicit domain intent, kept deliberately narrow to avoid false positives:

- An explicit code: `domain 33`, `Louw-Nida 33`, `LN 33`, or a dotted ref `33.6`.
- A domain **label** phrase that matches a known Level-1 `LouwNidaDomain.label` (e.g. "Communication").

Emit a `domainTerms` signal carrying the resolved 3-digit (or 6-digit) code(s). This is the
highest-uncertainty piece; if label-phrase matching proves noisy in practice, fall back to
code/`LN`-prefixed detection only. It must not hijack ordinary topical prompts that merely happen to
contain a domain-name word.

### Planner (`lib/ai/retrievalPlanner.ts`)

When `domainTerms` is present, add a bounded `domainCall` alongside the existing deterministic calls:

- Query tokens where `lnDomain @> [code]` (membership), scoped to the same book/chapter rules the planner
  already applies (single-chapter → chapter scope; multi-ref/cross-book → book/corpus).
- Resolve to the verses containing those tokens, expand/format into the `EvidencePacket` with the same
  size caps (`MAX_PASSAGE_LINES`, `MAX_EVIDENCE_CHARS`) and true-count markers used elsewhere.
- Tool-trace entry mirrors existing format, e.g. `searchDomain({"code":"033","book":"John"})`.

This runs inside the existing deterministic budget; it does not add a model round-trip.

---

## 6. Search mode (Phase 5b)

### `searchDomain` (`lib/search.ts`)

A new helper mirroring `searchLemma`/`searchKeyword`: given a domain code (or a label resolved to a code
via `LouwNidaDomain`), return the verses whose tokens satisfy `lnDomain @> [code]`, with the existing
pagination, scope, and result shape. Raw SQL bound via `Prisma.sql` parameters if the array operator
needs `$queryRaw` (no string interpolation of user input), consistent with the Phase 3 FTS approach.

### UI (`components/SearchPanel.tsx`)

- Add `domain` to the mode set (lemma / keyword / morphology / **domain**).
- The input accepts a domain code (`33`, `033`, `033005`) or a label string; a label is resolved to its
  code server-side. Results reuse the existing verse-result rendering and match-highlight surface.
- URL form: `/search?mode=domain&q=33&book=John`, consistent with existing modes.

---

## 7. Testing

**Unit**

- `parseMaculaTsv`: multi-value `ln`/`domain` parsing, whitespace splitting, `-`/empty filtering, letter
  suffixes (`93.169a`), single vs multiple senses, positional alignment with `louwNida`.
- `import-louw-nida`: Level-1/Level-2 flatten, `parentCode` derivation, `en` localization selection,
  idempotent upsert.
- Label resolution helper: code → domain/subdomain label, missing-code tolerance, multi-sense assembly.
- (5b) `searchDomain` query shaping; `signals` domain detection (fires on explicit code/label, does **not**
  fire on incidental topical words); planner `domainCall` scope + caps.

**Integration (Neon test branch)**

- After import, tokens carry expected `lnDomain`/`louwNida` arrays for known references (e.g. John 1:1
  `λόγος` → domain `033...`).
- `LouwNidaDomain` reference table seeded with expected Level-1 + Level-2 rows.
- (5b) domain search end-to-end returns the expected verses.

**Acceptance**

- Verify `scripts/acceptance-test.js` corpus-count assertions still hold (token rows unchanged); update if
  any assertion keys off enriched content.

**Gate**

- `npm run verify` (lint + tsc + build + coverage 80/80/75/65) green; `test:integration` and
  `test:acceptance` green against the Neon test branch.

---

## 8. Documentation

- `README.md` — Open Text Imports: document `import:louw-nida`, the popover domain display, the `/search`
  domain mode (5b), and the **CC-BY-SA attribution** for the UBS dataset.
- `data/louw-nida/NOTICE.md` — source, version, license, URL.
- `docs/PROJECT_STATE.md` — Phase 5 status, new schema/migration, new script, new surfaces.
- `docs/HiFi-exegesis-nt-roadmap.md` — mark Phase 5 done; update the Louw-Nida reconciliation rows
  (§A "Louw-Nida domains" gap → closed).
- `docs/security-register.md` — CC-BY-SA ShareAlike obligation on the vendored dataset.

---

## Key files

- Schema/data: `prisma/schema.prisma`, new migration, `data/louw-nida/`,
  `data/macula-greek/macula-greek-SBLGNT.tsv`
- Import: `scripts/import-open-bible.ts` (`parseMaculaTsv`, `importMaculaGreekGlosses`),
  `scripts/import-louw-nida.ts` (new), `package.json` scripts
- Read path / UI: `lib/search.ts` (reader passage + `searchDomain`), `components/MorphologyPopover.tsx`,
  `components/SearchPanel.tsx`
- Assistant: `lib/ai/signals.ts`, `lib/ai/retrievalPlanner.ts`
- Docs: `README.md`, `docs/PROJECT_STATE.md`, `docs/HiFi-exegesis-nt-roadmap.md`,
  `docs/security-register.md`

## Open items to resolve during implementation

1. **`getReaderPassage` shape** — confirm the exact reader-token type the passage query returns and thread
   the resolved `senses` through without bloating the row; one batched `LouwNidaDomain` lookup per passage,
   not per token.
2. **Domain label matching breadth (5b)** — start with explicit code / `LN`-prefixed detection; enable
   label-phrase matching only if it does not produce false positives on ordinary topical prompts.
3. **Letter-suffixed `ln` refs** — `93.169a` is a valid display ref; ensure it round-trips as a display
   string and that domain-code derivation uses the `domain` column (not parsed from `ln`).
