# Milestone 3 Phase 5b — Louw-Nida Domain Search & Retrieval: Design

*Status:* Approved 2026-06-06 · *Milestone:* 3 · *Phase:* 5b · *Predecessor:* Phase 5a (merged, `main` @ `6ec059d`)
*Spec for Phase 5a:* `docs/superpowers/specs/2026-06-06-louw-nida-enrichment-design.md`

## Summary

Phase 5a imported Louw-Nida codes onto Greek tokens (`Token.lnDomain` = MARBLE numeric codes,
`Token.louwNida` = classic LN dotted refs), seeded the `LouwNidaDomain` label table, and displayed
domain/subdomain labels in the reader popover. Phase 5b adds the two **consumer** surfaces deferred from
Phase 5: a new **`domain` mode on `/search`** and **explicit domain-aware retrieval in the assistant**.
Both are delivered in one phase — they share a single `searchDomain` helper and one schema change.

## Background: two numbering systems (important)

The data carries two parallel encodings of the same 93-domain taxonomy, at different granularities:

- **`Token.lnDomain`** — MARBLE numeric codes. 3-digit = domain (e.g. `033`), 6-digit = subdomain
  (e.g. `033006`). Tokens are tagged at either level (in the SBLGNT data: ~2,981 occurrences of 3-digit
  codes, ~127,744 of 6-digit). GIN-indexed in 5a. This is the authoritative field for domain/subdomain
  membership and is what the dropdowns query.
- **`Token.louwNida`** — classic Louw-Nida dotted refs (e.g. `33.55`, `33.100`; ~131k occurrences). The
  human-facing citation form. **Not** indexed in 5a. This is what the free-text LN-reference field queries.

The two axes are rooted in the same domains but are **not 1:1** — a single MARBLE code commonly maps to
several LN refs (see Phase 5a spec §2). So the dropdowns (MARBLE codes) and the LN-ref field (dotted refs)
are *complementary* lookups, not redundant.

---

## 1. Schema

One change: **add a GIN index on `Token.louwNida`** (Phase 5a deliberately left it unindexed "until ln-ref
search is built"; 5b is when we build it). Backs fast exact lookups of dotted refs via `louwNida has '33.55'`.

```prisma
model Token {
  // ...existing fields incl. louwNida String[] @default([]), lnDomain String[] @default([])...
  @@index([lnDomain], type: Gin)   // existing (5a)
  @@index([louwNida], type: Gin)   // new (5b)
}
```

New migration (hand-authored to avoid the pgvector/generated-column drift `migrate dev` trips on — see
Phase 5a Task 2): `CREATE INDEX "Token_louwNida_idx" ON "Token" USING GIN ("louwNida");`. No new columns.

---

## 2. `searchDomain` helper (`lib/search.ts`)

A new exported helper that mirrors `searchLemma`'s shape: **token-based** (one result row per matched token
via the existing `hydrateTokens`), canonical ordering, the existing pagination + true-count contract, and
the same optional `book`/`chapter` scope. Because it is token-based, each result row carries the matched
token's `surface`/`lemma`/`morphCode` and renders as `kind: "token"` — so the existing
`<HighlightedText match={surface}>` renderer **bolds each matched Greek word for free** (no new
highlighting code).

### Input and filter resolution

```ts
searchDomain(input: {
  domain?: string;     // Level-1 code, e.g. "033" (or "33" — normalized to 3-digit)
  subdomain?: string;  // Level-2 MARBLE code, e.g. "033006"
  ln?: string;         // dotted LN ref, e.g. "33.55"
  corpus?: "SBLGNT";
  book?: string;
  chapter?: number;
} & PaginationInput)
```

Resolve exactly one token filter by **precedence (most specific first): `ln` → `subdomain` → `domain`**:

- **`ln`** → `louwNida: { has: ln }` (exact; GIN via the new index).
- **`subdomain`** → `lnDomain: { has: subdomain }` (exact; GIN).
- **`domain`** → expand to the domain's own 3-digit code plus all its subdomain codes
  (`LouwNidaDomain.findMany({ where: { OR: [{ code: dom }, { parentCode: dom }] }, select: { code } }`),
  then `lnDomain: { hasSome: codes }` (array overlap; GIN). This catches tokens tagged at either the
  domain or subdomain level.

If none of `ln`/`subdomain`/`domain` is supplied (or `domain` resolves to zero codes), return the empty
result shape (`{ ..., count: 0, results: [], pagination }`), matching the other helpers' empty-input guard.

Normalization: a bare domain number like `"33"` is left-padded to the 3-digit `"033"` before lookup;
`ln` is trimmed and matched verbatim (refs are stored as `"33.55"`, including letter suffixes like
`"93.169a"`).

### Return shape

`{ filter: { kind: "ln" | "subdomain" | "domain"; value: string; label?: string }, count, results, pagination }`
where `results` is the same `hydrateTokens` output lemma/morphology already return. `label` is the resolved
human-readable domain/subdomain label (looked up from `LouwNidaDomain`) for display in the results header,
when available.

---

## 3. `/search` domain mode (UI)

### Server (`app/search/page.tsx`)

Add a `mode === "domain"` branch that reads `domain` / `subdomain` / `ln` query params and calls
`searchDomain`. To populate the dropdowns, the page also loads the domain taxonomy:
`getLouwNidaDomainOptions()` — a new `lib/search.ts` helper returning the 93 Level-1 domains
(`{ code, number, label }`, sorted by number) and, for the currently-selected domain, its Level-2
subdomains (`{ code, label }`). Cheap (≤ ~93 + a few dozen rows) and cached per request.

### Client (`components/SearchPanel.tsx`)

- Add `domain` to the mode set (lemma / keyword / morphology / **domain**).
- When `domain` mode is active, render three controls (replacing the lemma/keyword text box):
  1. **Domain `<select>`** — options labeled **`33 — Communication`** (the LN domain number = `lnDomain`
     code parsed as int, then the label). Display decision **B**.
  2. **Subdomain `<select>`** — dependent on the chosen domain; options are **plain labels** (no number —
     the MARBLE 6-digit code is a different scheme from the dotted refs and would mislead). Includes an
     "(any subdomain)" default. Changing the domain resets/reloads this list.
  3. **LN reference `<input>`** — free text, e.g. `33.55`. Placeholder communicates the format.
- **Submission** sends only the populated fields; the URL carries `mode=domain` plus any of
  `domain=33&subdomain=033006&ln=33.55`. Server-side precedence (ln → subdomain → domain) decides the query.
- Results reuse the existing `kind: "token"` rendering (matched Greek word bolded, lemma + morphCode shown).
  The results header shows the resolved filter label (e.g. "Domain 33 — Communication", or "LN 33.55").

URL examples: `/search?mode=domain&domain=33&book=John`, `/search?mode=domain&ln=33.55`.

---

## 4. Assistant domain retrieval (explicit-only)

### Signal detection (`lib/ai/signals.ts`)

Add an optional `domainQuery` signal that fires **only on explicit markers** (v1 — safe by design; never
triggers on bare topical words that happen to be domain names):

- `domain 33`, `domain 033`
- `Louw-Nida 33`, `Louw Nida 33`, `LN 33` (case-insensitive)
- a dotted ref `33.55` (and letter-suffixed `93.169a`)

Resolve to `{ kind: "domain"; code: "033" }` or `{ kind: "ln"; ref: "33.55" }`. The assistant covers
**domain numbers and LN refs** only — it does *not* accept MARBLE subdomain codes (`033006`), which have no
natural prompt form (that path is dropdown-only in `/search`). The detected marker tokens are stripped from
topic extraction so they don't also fire a spurious lemma/keyword search.

### Planner (`lib/ai/retrievalPlanner.ts`)

When `domainQuery` is present, add a bounded `domainCall` alongside the existing deterministic calls:

- Calls `searchDomain` with the resolved `domain` or `ln`, scoped by the planner's existing book/chapter
  rules (single-chapter → chapter scope; multi-ref/cross-book → book/corpus).
- Formats matches into the `EvidencePacket` using the same assembly + caps as other survey calls
  (`MAX_PASSAGE_LINES`, `MAX_EVIDENCE_CHARS`, true-count marker for large domains — Communication matches
  thousands of tokens, so the survey is sampled with an honest `…(N more)` marker, mirroring large lemma
  surveys).
- Tool-trace entry mirrors the existing format, e.g. `searchDomain({"domain":"033","book":"John"})` or
  `searchDomain({"ln":"33.55"})`. Runs inside the existing deterministic budget — no extra model round-trip.

Grounding is unaffected: citations resolve to the SBLGNT spine exactly as today (the matched tokens are
SBLGNT tokens).

---

## 5. Testing

**Unit**
- `searchDomain` filter resolution: each mode (`ln`/`subdomain`/`domain`), precedence ordering, domain
  expansion (3-digit + children via `LouwNidaDomain`), `"33"`→`"033"` normalization, empty-input guard.
- `getLouwNidaDomainOptions`: 93 Level-1 sorted by number; subdomains for a given domain.
- `signals`: `domainQuery` fires on each explicit marker form; does **not** fire on topical prompts that
  merely contain a domain-name word (e.g. "communication in the early church"); marker tokens stripped
  from topic words.
- `retrievalPlanner`: `domainCall` added when `domainQuery` present, correct scope + caps + tool-trace;
  not added otherwise.

**Integration (Neon test branch)**
- The new `Token_louwNida_idx` exists; `louwNida has '33.55'` returns expected tokens.
- `searchDomain` domain/subdomain/ln modes return expected verses against the seeded corpus.

**Acceptance**
- A `/search?mode=domain&domain=33` smoke check renders token results without overflow.

**Gate:** `npm run verify` (lint + tsc + build + coverage thresholds) green; `test:integration` +
`test:acceptance` green against the test branch.

---

## 6. Documentation

- `README.md` — document the `/search` domain mode (dropdowns + LN-ref field) and the assistant's explicit
  domain/LN-ref queries.
- `docs/PROJECT_STATE.md` — Phase 5b status: new `Token.louwNida` GIN index + migration, `searchDomain`,
  the domain search mode, the assistant `domainQuery` signal + planner `domainCall`, new tests.
- `docs/HiFi-exegesis-nt-roadmap.md` — mark **Phase 5 done** (5a + 5b); flip the §B "query expansion"
  reconciliation note as appropriate.

---

## Key files

- Schema/data: `prisma/schema.prisma`, new migration, `lib/search.ts` (`searchDomain`,
  `getLouwNidaDomainOptions`)
- Search UI: `app/search/page.tsx`, `components/SearchPanel.tsx`
- Assistant: `lib/ai/signals.ts`, `lib/ai/retrievalPlanner.ts`
- Tests: `tests/unit/lib/*`, `tests/unit/lib/ai/*`, `tests/integration/*`

## Decisions locked during brainstorming

1. Search input = **domain dropdown + dependent subdomain dropdown + free-text LN-ref field**; precedence
   ln → subdomain → domain.
2. Dropdown display = **B**: domain shown `33 — Communication`; subdomain shown as a plain label.
3. Assistant detection = **explicit-only (A)** for v1: domain numbers + LN refs; no label-phrase matching.
4. **Inline highlighting included** (free — token-based results reuse the existing surface-highlight render).
5. **One phase** delivering both surfaces (shared `searchDomain` + the single GIN index).

## Out of scope (future)

- Natural-language domain-name detection in the assistant (the brainstormed Option C guard) — revisit if
  usage shows people phrasing domain queries conversationally.
- Subdomain selection in the assistant (no natural prompt form).
- Showing MARBLE subdomain codes or LN ranges in the subdomain dropdown.
