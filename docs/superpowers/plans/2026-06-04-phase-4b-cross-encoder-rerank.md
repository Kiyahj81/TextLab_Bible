# Phase 4b — Cross-Encoder Rerank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Voyage rerank-2.5 (via Vercel AI Gateway) second-stage reranker to the assistant's `searchSemantic` pool, reordering the RRF-fused, SBL-spine-filtered candidates on WEB English text, with graceful fallback to RRF order.

**Architecture:** A new `lib/search/rerank.ts` module wraps the AI SDK `rerank` function. `searchSemantic` calls it as a final stage after the SBL-spine filter; on any failure or missing key it returns `null` and `searchSemantic` keeps its existing RRF order. RRF remains the candidate-assembly and fallback ranker. Only the assistant semantic path is touched.

**Tech Stack:** TypeScript, Next 15 (Node runtime), Prisma 6 / PostgreSQL (pgvector), Vitest 4, AI SDK (`ai` + `@ai-sdk/gateway`), existing `openai@4` for embeddings.

**Spec:** `docs/superpowers/specs/2026-06-04-phase-4b-cross-encoder-rerank-design.md`

**Branch:** `milestone-3/phase-4b-rerank` (already created; the design spec is committed there).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `lib/search/rerank.ts` | Wrap AI SDK `rerank`; key-gating, timeout, error→`null`, index→reference mapping | Create |
| `lib/search.ts` | Insert rerank stage into `searchSemantic`; add internal `rerank?: boolean` option | Modify |
| `tests/unit/lib/search/rerank.test.ts` | Unit tests for `rerankCandidates` (mock `ai` + `@ai-sdk/gateway`) | Create |
| `tests/unit/lib/search-semantic.test.ts` | Extend: rerank reorders, `null`→RRF identity, on-spine+WEB input | Modify |
| `tests/integration/semantic-search.test.ts` | Extend: gateway-keyed rerank path; skips without key | Modify |
| `scripts/rerank-diff.ts` | Manual harness: print RRF vs reranked ordering per prompt | Create |
| `.env.example` | Document `AI_GATEWAY_API_KEY`, `RERANK_MODEL`, `RERANK_TIMEOUT_MS` | Modify |
| `package.json` | Add `ai`, `@ai-sdk/gateway` deps | Modify (via npm) |
| `docs/Project_State.md`, `docs/HiFi-exegesis-nt-roadmap.md`, `README.md`, `docs/security-register.md` | Doc updates per CLAUDE.md | Modify |

**Note on `scripts/rerank-diff.ts` (deviation from spec wording):** the spec said "extend `scripts/evidence-diff.ts`." That existing harness is deliberately OpenAI-free and reproducible (it forces semantic retrieval *off*). Adding a key-dependent rerank comparison there would break that contract. Instead this plan adds a dedicated `scripts/rerank-diff.ts` that serves the same validation goal (RRF-vs-reranked ordering) without polluting the deterministic harness. This is a faithful realization of the spec's intent.

**Note on the `rerank?: boolean` option:** `searchSemantic` gains an optional `rerank` input (default `true`). Production callers are unaffected (default keeps rerank on). The flag exists so `scripts/rerank-diff.ts` can request the pre-rerank (RRF) ordering for comparison, and so a test can assert the disabled path.

---

### Task 1: Install dependencies and document env vars

**Files:**
- Modify: `package.json` (via npm), `.env.example`

- [ ] **Step 1: Install the AI SDK packages**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm install ai @ai-sdk/gateway
```
Expected: both packages added to `dependencies`; no peer-dependency errors.

- [ ] **Step 2: Confirm no new security advisories**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm run security:audit
```
Expected: only the previously-tracked postcss moderate (GHSA-qx2v-qp2m-jg93). If a NEW advisory appears, stop and record it in `docs/security-register.md` before continuing.

- [ ] **Step 3: Document the env vars in `.env.example`**

Append to `.env.example` (place near the existing `OPENAI_API_KEY` block):
```bash
# --- Phase 4b: semantic rerank (optional) ---
# Vercel AI Gateway key. Its PRESENCE enables Voyage reranking of the assistant's
# semantic candidate pool. Unset → searchSemantic falls back to RRF order (no behavior change).
# The Voyage API key itself lives in AI Gateway settings (BYOK) or Vercel credits — not here.
AI_GATEWAY_API_KEY=
# Optional rerank model override (default: voyage/rerank-2.5).
RERANK_MODEL=voyage/rerank-2.5
# Optional rerank timeout in ms (default: 3000).
RERANK_TIMEOUT_MS=3000
```

- [ ] **Step 4: Commit**

```powershell
git add package.json package-lock.json .env.example
git commit -m "build: add AI SDK rerank deps and document gateway env vars"
```

---

### Task 2: Create `lib/search/rerank.ts` (TDD)

**Files:**
- Create: `lib/search/rerank.ts`
- Test: `tests/unit/lib/search/rerank.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/search/rerank.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const { rerankMock } = vi.hoisted(() => ({ rerankMock: vi.fn() }));
vi.mock("ai", () => ({ rerank: rerankMock }));
vi.mock("@ai-sdk/gateway", () => ({
  gateway: { rerankingModel: vi.fn((id: string) => ({ id })) }
}));

import { rerankCandidates } from "@/lib/search/rerank";

const CANDS = [
  { reference: "John 1:1", text: "In the beginning was the Word" },
  { reference: "Eph 2:16", text: "and might reconcile both to God" },
  { reference: "Rom 5:10", text: "we were reconciled to God" }
];

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_GATEWAY_API_KEY;
});

describe("rerankCandidates", () => {
  it("returns null and makes no network call when AI_GATEWAY_API_KEY is unset", async () => {
    const out = await rerankCandidates({ query: "reconciliation", candidates: CANDS });
    expect(out).toBeNull();
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it("returns null for empty candidates without a network call", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    const out = await rerankCandidates({ query: "reconciliation", candidates: [] });
    expect(out).toBeNull();
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it("maps ranking.originalIndex back to references and honors topN", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    rerankMock.mockResolvedValueOnce({
      ranking: [
        { originalIndex: 2, score: 0.9, document: CANDS[2].text },
        { originalIndex: 1, score: 0.5, document: CANDS[1].text }
      ]
    });
    const out = await rerankCandidates({ query: "reconciliation", candidates: CANDS, topN: 2 });
    expect(out).not.toBeNull();
    expect(out!.map((c) => c.reference)).toEqual(["Rom 5:10", "Eph 2:16"]);
    expect(out!.length).toBe(2);
    // documents sent to the reranker are the candidate texts, in order
    expect(rerankMock.mock.calls[0][0].documents).toEqual(CANDS.map((c) => c.text));
    expect(rerankMock.mock.calls[0][0].query).toBe("reconciliation");
  });

  it("returns null when the rerank call throws (timeout/network/malformed)", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    rerankMock.mockRejectedValueOnce(new Error("boom"));
    const out = await rerankCandidates({ query: "x", candidates: CANDS });
    expect(out).toBeNull();
  });

  it("returns null when the response has no ranking array", async () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    rerankMock.mockResolvedValueOnce({});
    const out = await rerankCandidates({ query: "x", candidates: CANDS });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"; npx vitest run tests/unit/lib/search/rerank.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/search/rerank'`.

- [ ] **Step 3: Implement `lib/search/rerank.ts`**

Create `lib/search/rerank.ts`:
```ts
import { rerank } from "ai";
import { gateway } from "@ai-sdk/gateway";

export const RERANK_MODEL = process.env.RERANK_MODEL ?? "voyage/rerank-2.5";
const RERANK_TIMEOUT_MS = Number(process.env.RERANK_TIMEOUT_MS ?? 3000);

export type RerankCandidate = { reference: string; text: string };

// Returns the top `topN` candidates reordered by the reranker, or null when
// reranking is unavailable (no AI_GATEWAY_API_KEY) or the call fails/times out.
// On null the caller keeps its existing (RRF) order. Never throws.
export async function rerankCandidates(input: {
  query: string;
  candidates: RerankCandidate[];
  topN?: number;
}): Promise<RerankCandidate[] | null> {
  const { query, candidates, topN } = input;
  if (!process.env.AI_GATEWAY_API_KEY || candidates.length === 0) return null;

  try {
    const result = await rerank({
      model: gateway.rerankingModel(RERANK_MODEL),
      query,
      documents: candidates.map((c) => c.text),
      topN,
      abortSignal: AbortSignal.timeout(RERANK_TIMEOUT_MS)
    });
    const ranking = result?.ranking;
    if (!Array.isArray(ranking)) return null;
    return ranking
      .map((r) => candidates[r.originalIndex])
      .filter((c): c is RerankCandidate => Boolean(c));
  } catch {
    return null;
  }
}
```

Note: `topN` is forwarded to the reranker, so the returned array is already truncated; the `.map`/`.filter` only guards against an out-of-range index.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"; npx vitest run tests/unit/lib/search/rerank.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```powershell
git add lib/search/rerank.ts tests/unit/lib/search/rerank.test.ts
git commit -m "feat(search): add Voyage rerank wrapper with graceful fallback"
```

---

### Task 3: Integrate rerank into `searchSemantic` (TDD)

**Files:**
- Modify: `lib/search.ts` (the `searchSemantic` function and its input type)
- Test: `tests/unit/lib/search-semantic.test.ts`

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe("searchSemantic", …)` block in `tests/unit/lib/search-semantic.test.ts`)

First, add the rerank mock at the top of the file, beside the existing mocks (after the `getOpenAiMock` mock, before the `import`s of `@/lib/search`):
```ts
const { rerankCandidatesMock } = vi.hoisted(() => ({ rerankCandidatesMock: vi.fn() }));
vi.mock("@/lib/search/rerank", () => ({ rerankCandidates: rerankCandidatesMock }));
```

Then add these tests inside `describe("searchSemantic", …)`:
```ts
it("returns rerank order when rerank succeeds", async () => {
  getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
  prismaMock.$queryRaw.mockResolvedValueOnce([
    { osisId: "Eph", chapter: 2, verse: 16, text: "reconcile both" },
    { osisId: "Rom", chapter: 5, verse: 10, text: "we were reconciled" }
  ]);
  prismaMock.verse.findMany.mockResolvedValueOnce([
    { chapter: 2, verse: 16, book: { osisId: "Eph" } },
    { chapter: 5, verse: 10, book: { osisId: "Rom" } }
  ]);
  // rerank flips the RRF order
  rerankCandidatesMock.mockResolvedValueOnce([
    { reference: "Rom 5:10", text: "we were reconciled" },
    { reference: "Eph 2:16", text: "reconcile both" }
  ]);

  const out = await searchSemantic({ query: "reconciliation" });

  expect(out.map((r) => r.reference)).toEqual(["Rom 5:10", "Eph 2:16"]);
  // rerank received on-spine candidates with WEB text
  const passed = rerankCandidatesMock.mock.calls[0][0];
  expect(passed.candidates.map((c: { reference: string }) => c.reference)).toEqual([
    "Eph 2:16",
    "Rom 5:10"
  ]);
  expect(out.every((r) => r.corpus === "WEB")).toBe(true);
});

it("falls back to RRF order (byte-identical) when rerank returns null", async () => {
  getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
  prismaMock.$queryRaw.mockResolvedValueOnce([
    { osisId: "Eph", chapter: 2, verse: 16, text: "reconcile both" },
    { osisId: "Rom", chapter: 5, verse: 10, text: "we were reconciled" }
  ]);
  prismaMock.verse.findMany.mockResolvedValueOnce([
    { chapter: 2, verse: 16, book: { osisId: "Eph" } },
    { chapter: 5, verse: 10, book: { osisId: "Rom" } }
  ]);
  rerankCandidatesMock.mockResolvedValueOnce(null);

  const out = await searchSemantic({ query: "reconciliation" });
  // RRF order preserved (both at rank 0 of the single vector list → input order)
  expect(out.map((r) => r.reference)).toEqual(["Eph 2:16", "Rom 5:10"]);
});

it("does not call rerank when rerank:false is passed", async () => {
  getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
  prismaMock.$queryRaw.mockResolvedValueOnce([
    { osisId: "Eph", chapter: 2, verse: 16, text: "reconcile both" }
  ]);
  prismaMock.verse.findMany.mockResolvedValueOnce([
    { chapter: 2, verse: 16, book: { osisId: "Eph" } }
  ]);

  await searchSemantic({ query: "reconciliation", rerank: false });
  expect(rerankCandidatesMock).not.toHaveBeenCalled();
});
```

Also add `beforeEach` reset for the new mock — the file already calls `vi.clearAllMocks()` in its top-level `beforeEach`, so no change needed; but ensure `rerankCandidatesMock` returns `undefined` by default (treated as falsy → fallback) so the pre-existing `searchSemantic` tests still assert RRF order. Update those existing tests' expectations only if they now route through rerank: since default mock returns `undefined` (not an array), `searchSemantic` must treat a non-array as "no rerank" and keep RRF order. Confirm the existing tests still pass in Step 4.

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"; npx vitest run tests/unit/lib/search-semantic.test.ts
```
Expected: the 3 new tests FAIL (`rerank` not wired; `rerank:false` not a valid input yet).

- [ ] **Step 3: Modify `searchSemantic` in `lib/search.ts`**

Add the import near the top (with the other `@/lib/search/*` imports):
```ts
import { rerankCandidates } from "@/lib/search/rerank";
```

Extend the input type and replace the final return. Change the signature:
```ts
export async function searchSemantic(input: {
  query: string;
  keywords?: string;
  book?: string;
  chapter?: number;
  limit?: number;
  rerank?: boolean;
}): Promise<RankedRef[]> {
```

Replace the final `return onSpine.slice(0, limit);` with:
```ts
  if (input.rerank === false) return onSpine.slice(0, limit);

  const reranked = await rerankCandidates({
    query,
    candidates: onSpine.map((r) => ({ reference: r.reference, text: r.text })),
    topN: limit
  });
  if (!reranked) return onSpine.slice(0, limit);

  // Map reranked references back to the full RankedRef entries (preserve corpus/text).
  const byRef = new Map(onSpine.map((r) => [r.reference, r]));
  return reranked
    .map((c) => byRef.get(c.reference))
    .filter((r): r is RankedRef => Boolean(r))
    .slice(0, limit);
```

(`query` is the already-trimmed local variable from the top of `searchSemantic`.)

- [ ] **Step 4: Run the full search-semantic suite to verify all pass**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"; npx vitest run tests/unit/lib/search-semantic.test.ts
```
Expected: PASS (all existing + 3 new). If a pre-existing test fails because `rerankCandidatesMock` default returns `undefined`, confirm `searchSemantic` falls back on non-array (it does via `if (!reranked)`), so existing RRF-order assertions hold.

- [ ] **Step 5: Commit**

```powershell
git add lib/search.ts tests/unit/lib/search-semantic.test.ts
git commit -m "feat(search): rerank semantic pool with RRF fallback"
```

---

### Task 4: Extend the integration test

**Files:**
- Modify: `tests/integration/semantic-search.test.ts`

- [ ] **Step 1: Add a gateway-gated rerank integration test**

Append to `tests/integration/semantic-search.test.ts` (after the existing `describe.skipIf` block):
```ts
const rerankEnabled = Boolean(
  process.env.DATABASE_URL && process.env.OPENAI_API_KEY && process.env.AI_GATEWAY_API_KEY
);

describe.skipIf(!rerankEnabled)("semantic search with rerank", () => {
  it("returns reranked, on-spine results without error", async () => {
    const results = await searchSemantic({
      query: "what does Paul say about reconciliation between people and God",
      keywords: "reconciliation",
      limit: 5
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const parsed = parseReference(r.reference);
      expect(parsed, `unparseable reference: ${r.reference}`).not.toBeNull();
      const sbl = await getPassage({
        corpus: "SBLGNT",
        book: parsed!.book,
        chapter: parsed!.chapter,
        verseStart: parsed!.verse
      });
      expect(sbl.references.length, `${r.reference} absent from SBLGNT spine`).toBeGreaterThan(0);
    }
  }, 30_000);
});
```

- [ ] **Step 2: Run the integration suite (skips without keys)**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm run test:integration
```
Expected: PASS; the new block runs if `AI_GATEWAY_API_KEY` is set against the Neon test branch, otherwise it is skipped. No failures.

- [ ] **Step 3: Commit**

```powershell
git add tests/integration/semantic-search.test.ts
git commit -m "test(integration): rerank-enabled semantic search path"
```

---

### Task 5: Add the `scripts/rerank-diff.ts` manual harness

**Files:**
- Create: `scripts/rerank-diff.ts`

- [ ] **Step 1: Create the harness**

Create `scripts/rerank-diff.ts`:
```ts
// Phase 4b rerank diff harness. For each prompt, prints the semantic candidate
// ordering WITHOUT rerank (RRF) and WITH rerank (Voyage via AI Gateway), so the
// reordering can be eyeballed. Requires DATABASE_URL + OPENAI_API_KEY; rerank rows
// only differ when AI_GATEWAY_API_KEY is also set (else both columns match).
//
// Working invocation (loads .env automatically):
//   npx tsx --env-file=.env scripts/rerank-diff.ts

import { searchSemantic } from "../lib/search";

const PROMPTS = [
  "what does Paul say about reconciliation between people and God",
  "where does the New Testament talk about grace and truth",
  "trace the theme of love in 1 John",
  "verses about light overcoming darkness",
  "what is the meaning of being justified by faith"
];

async function main() {
  for (const query of PROMPTS) {
    const keywords = query.split(/\s+/).slice(-2).join(" ");
    const [rrf, reranked] = await Promise.all([
      searchSemantic({ query, keywords, limit: 5, rerank: false }),
      searchSemantic({ query, keywords, limit: 5, rerank: true })
    ]);
    console.log("=".repeat(80));
    console.log("PROMPT:", query);
    console.log("  RRF     :", rrf.map((r) => r.reference).join(", ") || "(none)");
    console.log("  RERANKED:", reranked.map((r) => r.reference).join(", ") || "(none)");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
```

- [ ] **Step 2: Smoke-run the harness (optional, needs keys + corpus)**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"; npx tsx --env-file=.env scripts/rerank-diff.ts
```
Expected: prints RRF vs RERANKED reference lists per prompt; with `AI_GATEWAY_API_KEY` set the RERANKED row differs from RRF on at least some prompts. (If keys/corpus are unavailable in this environment, skip running — the script is a manual tool, not part of `npm run verify`.)

- [ ] **Step 3: Commit**

```powershell
git add scripts/rerank-diff.ts
git commit -m "chore(scripts): add rerank-vs-RRF diff harness"
```

---

### Task 6: Documentation updates

**Files:**
- Modify: `docs/Project_State.md`, `docs/HiFi-exegesis-nt-roadmap.md`, `README.md`, `docs/security-register.md`

- [ ] **Step 1: Update `docs/HiFi-exegesis-nt-roadmap.md`**

Replace the Phase 4b paragraph (currently begins `**Phase 4b — Cross-encoder rerank (DEFERRED).**`) with:
```markdown
**Phase 4b — Cross-encoder rerank. ✅ DONE (branch `milestone-3/phase-4b-rerank`).** A
retrieve-then-rerank stage on the assistant's semantic pool: `lib/search/rerank.ts` reranks the
RRF-fused, SBL-spine-filtered candidates (top-30 → top-5) on WEB English text via **Voyage
rerank-2.5** through **Vercel AI Gateway** (AI SDK `rerank`). Gated on `AI_GATEWAY_API_KEY`;
missing key / error / timeout falls back to RRF order (graceful no-op). RRF remains the
candidate-assembly + fallback ranker. New: `lib/search/rerank.ts`, `scripts/rerank-diff.ts`,
deps `ai` + `@ai-sdk/gateway`.
```
Also in the **B. Retrieval pipeline** table, change the `Cross-encoder rerank (top-30→top-5)` row's
`Current state` from `❌ none` to `✅ Voyage rerank-2.5 via AI Gateway (graceful fallback to RRF)`
and the Gap to `Closed`. In the capability table, change the `pgvector + embeddings + hybrid + RRF +
rerank` row's distance to `Closed` and effort to `Phase 4a + 4b done`.

- [ ] **Step 2: Update `docs/Project_State.md`**

In the `### Assistant pipeline` section, step 2's `**Phase 4a semantic path**` sentence, append:
```markdown
 (f) **Phase 4b rerank**: after the SBL-spine filter, `searchSemantic` reranks the candidate pool (top-30 → top-5) on WEB text via Voyage rerank-2.5 through Vercel AI Gateway (`lib/search/rerank.ts`, AI SDK `rerank`), gated on `AI_GATEWAY_API_KEY`; on missing key / error / timeout it falls back to the RRF order (graceful no-op), so behavior is unchanged when the key is unset.
```
In the snapshot header line at the top, update the parenthetical to mention Phase 4b. In the
**Test surfaces** list, add a bullet under the Phase 4a additions:
```markdown
  - `tests/unit/lib/search/rerank.test.ts` — `rerankCandidates`: key-gating (no network without `AI_GATEWAY_API_KEY`), empty-input no-op, `originalIndex`→reference mapping + `topN`, and error/timeout → `null`
```

- [ ] **Step 3: Update `README.md`**

In the environment-variables / configuration section, add (near `OPENAI_API_KEY`):
```markdown
- `AI_GATEWAY_API_KEY` *(optional)* — enables Voyage rerank-2.5 reranking of the assistant's semantic results via Vercel AI Gateway. Unset → retrieval falls back to RRF ordering with no behavior change. `RERANK_MODEL` (default `voyage/rerank-2.5`) and `RERANK_TIMEOUT_MS` (default `3000`) tune it.
```

- [ ] **Step 4: Update `docs/security-register.md`**

Add a new entry:
```markdown
### Phase 4b rerank — new outbound host + third-party data flow (accepted)

- **Host:** `ai-gateway.vercel.sh`, called **server-side (Node) only** from `lib/search/rerank.ts`. No
  browser fetch, so the CSP `connect-src` (which already omits `api.openai.com` for the same reason)
  needs **no change**. Recorded as a reasoned decision, not an omission.
- **Data flow:** WEB verse text + the user prompt are sent to Voyage via the gateway. WEB is
  public-domain scripture and the prompt is already sent to OpenAI for synthesis, so no new class of
  data leaves the system. Reranking is gated on `AI_GATEWAY_API_KEY`; with the key unset, nothing is
  sent. **Status: accepted.**
```

- [ ] **Step 5: Commit**

```powershell
git add docs/Project_State.md docs/HiFi-exegesis-nt-roadmap.md README.md docs/security-register.md
git commit -m "docs: record Phase 4b rerank (roadmap, project state, README, security)"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full verify gate**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm run verify
```
Expected: lint + tsc + build + coverage all green; coverage stays ≥ 80/80/75/65. The new `lib/search/rerank.ts` branches (key set/unset, success/error, non-array) are covered by Task 2's tests.

- [ ] **Step 2: Run the integration suite**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm run test:integration
```
Expected: PASS (rerank block runs or skips depending on `AI_GATEWAY_API_KEY`).

- [ ] **Step 3: Run the acceptance suite (confirm no count drift)**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm run test:acceptance
```
Expected: PASS unchanged — rerank only reorders retrieval, adds no corpus-count assertions.

- [ ] **Step 4: Final commit if any verify-driven fixes were made**

```powershell
git add -A
git commit -m "chore: Phase 4b verification fixes"
```
(Skip if the tree is clean.)

---

## Self-Review Notes

- **Spec coverage:** new module (Task 2), `searchSemantic` integration + fallback + on-spine/WEB input (Task 3), deps + env (Task 1), graceful degradation (Task 2/3 tests), unit + integration + diff validation (Tasks 2–5), all four doc updates incl. security register (Task 6), verification incl. coverage/acceptance (Task 7). The spec's "extend evidence-diff" is realized as a dedicated `rerank-diff.ts` (documented deviation above).
- **Type consistency:** `RerankCandidate = { reference, text }` used identically in `rerank.ts`, its tests, and the `searchSemantic` mapping; `gateway.rerankingModel(...)` matches the verified AI SDK API; `rerankCandidates` signature/return (`RerankCandidate[] | null`) is consistent across definition, call site, and mocks.
- **Fallback safety:** `searchSemantic` treats any non-array (`null`/`undefined`) rerank result as "keep RRF order," so pre-existing tests whose default mock returns `undefined` continue to assert RRF ordering.
