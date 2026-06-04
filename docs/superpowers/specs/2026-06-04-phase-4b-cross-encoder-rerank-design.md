# Milestone 3 — Phase 4b: Cross-Encoder Rerank — Design

*Date:* 2026-06-04 · *Status:* Approved for planning · *Scope:* NT-Greek subset · *Builds on:* Phase 4a (Vector + Hybrid Retrieval, merged PR #9)

## Summary

Add the cross-encoder rerank stage the architecture doc calls for (top-30 → top-5) on top of
the existing `searchSemantic` hybrid pipeline. Reranking is done by **Voyage rerank-2.5** accessed
through **Vercel AI Gateway** via the AI SDK `rerank` function. The rerank step reorders the
already-RRF-fused, SBL-spine-filtered candidate pool and returns the top `topN`. When the gateway
key is unset or the call fails, the pipeline gracefully falls back to the current RRF order, so the
project keeps its "works without external keys" guarantee.

Phase 4b was deferred in the roadmap because a true cross-encoder required a vendor outside the
OpenAI-only dependency set. This design adopts that vendor (Voyage) through Vercel AI Gateway.

## Goals

- Insert a retrieve-then-rerank second stage into the assistant's semantic retrieval path.
- Use Voyage rerank-2.5 via Vercel AI Gateway (AI SDK `rerank`).
- Preserve the SBLGNT citation-spine guarantee: rerank only ever reorders/truncates an
  already-valid, already-spine-filtered candidate set.
- Graceful no-op degradation when `AI_GATEWAY_API_KEY` is unset or the rerank call errors/times out.
- Validate with unit + integration tests, an extended evidence-diff harness, and manual spot-checks.

## Non-goals

- Reranking the standalone `/search` UI (assistant semantic path only).
- A scored quantitative eval gate (nDCG/MRR/RAGAS) — deferred to Phase 6's evaluation harness.
- Replacing RRF (RRF stays as candidate assembly + fallback ranker).
- Changing embeddings or synthesis (both remain on `openai@4`).
- OT/Strong's/speaker/alignment data work (deferred past Milestone 3).

## Decisions (locked during brainstorming, 2026-06-04)

| Decision | Choice |
|---|---|
| Reranker approach | Dedicated rerank vendor (not LLM-as-reranker, not local model) |
| Vendor + access | Voyage **rerank-2.5** (full) through **Vercel AI Gateway** (AI SDK `rerank`) |
| Fallback | Graceful no-op → current RRF order on missing key / error / timeout |
| Scope | Assistant `searchSemantic` pool only; `/search` UI unchanged |
| Rerank input text | WEB English verse text vs. the English natural-language prompt |
| Validation | Unit + integration tests, extended `scripts/evidence-diff.ts`, manual |
| Integration shape | Approach 1 — rerank as a stage inside `searchSemantic`; RRF = fallback |

## Architecture

### New module: `lib/search/rerank.ts`

Single purpose: turn a query + candidate verses into a reranked subset via AI Gateway, or signal
"couldn't rerank" so the caller keeps its existing order.

```ts
// lib/search/rerank.ts
export const RERANK_MODEL = process.env.RERANK_MODEL ?? "voyage/rerank-2.5";

export type RerankCandidate = { reference: string; text: string };

// Returns reranked candidates (top topN) on success.
// Returns null when rerank is unavailable (no AI_GATEWAY_API_KEY) or the
// call fails/times out — caller falls back to its existing (RRF) order.
export async function rerankCandidates(input: {
  query: string;
  candidates: RerankCandidate[];
  topN?: number;
}): Promise<RerankCandidate[] | null>;
```

Internals:

1. If `!process.env.AI_GATEWAY_API_KEY` or `candidates.length === 0` → return `null` immediately
   (no network).
2. Otherwise call the AI SDK:
   ```ts
   import { rerank } from "ai";
   import { gateway } from "@ai-sdk/gateway";

   const result = await rerank({
     model: gateway.rerankingModel(RERANK_MODEL),
     query,
     documents: candidates.map((c) => c.text),
     topN,
     abortSignal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
   });
   ```
3. Map `result.ranking[].originalIndex` back onto the original `candidates` array to preserve each
   `reference` (the reranker only sees `text`). Return the mapped candidates in ranked order,
   truncated to `topN`.
4. Wrap 2–3 in `try/catch`; any throw (including timeout) → return `null`.

`RERANK_TIMEOUT_MS` defaults to ~3000ms (env-overridable) to bound added latency.

### Integration into `searchSemantic` (`lib/search.ts`)

Single insertion point, replacing the current final `return onSpine.slice(0, limit);`:

```
vector KNN (POOL=30) + FTS (POOL=30)
        ↓
   RRF fuse + dedupe            (unchanged)
        ↓
   SBL-spine filter → onSpine   (unchanged)
        ↓
   reranked = await rerankCandidates({ query, candidates: onSpine, topN: limit })
        ↓
   return (reranked ?? onSpine).slice(0, limit)
```

Notes:
- `query` passed to rerank is the same natural-language `input.query` already embedded for the
  vector half (English prompt).
- Candidates carry WEB `text` (already present on `RankedRef` from the RRF stage) and `reference`.
- Rerank runs on **on-spine candidates only** — we never rerank a verse we cannot cite, and the
  spine filter still runs first so a citation can never become unresolvable due to reranking.
- On `null`, output is byte-identical to today's behavior.

`RankedRef` already includes `reference`, `corpus`, and `text`, so `rerankCandidates` consumes it
directly (mapping `{ reference, text }`); the reranked result is mapped back to the full `RankedRef`
entries by `reference` before slicing.

## Dependencies

Additive, scoped to rerank. Existing embeddings + synthesis stay on `openai@4`.

- `ai` — provides `rerank`.
- `@ai-sdk/gateway` — provides the `gateway(modelId)` provider.

Pin to the current major. Run `npm run security:audit` after install; expect no new advisories
beyond the tracked postcss one (`docs/security-register.md`).

## Configuration

Added to `.env.example`:

- `AI_GATEWAY_API_KEY` — Vercel AI Gateway auth. **Presence is the on/off switch** for rerank; unset
  → `searchSemantic` behaves exactly as today.
- `RERANK_MODEL` — optional override, default `voyage/rerank-2.5`.
- `RERANK_TIMEOUT_MS` — optional, default ~3000ms.

The Voyage API key itself lives in Vercel AI Gateway settings (BYOK) or is covered by Vercel
credits — it is **not** stored in our `.env`. We only hold the gateway key.

## Error handling / degradation

`rerankCandidates` never throws to its caller. Missing key, network error, timeout (`AbortSignal`),
or a malformed response all resolve to `null`, and `searchSemantic` returns its RRF-ordered slice.
This preserves two existing guarantees:

1. The app works with no external keys.
2. The SBL-spine filter runs **before** rerank, so reranking only reorders/truncates an
   already-valid, already-spine-filtered candidate set — a citation can never become unresolvable.

## Security

To be recorded in `docs/security-register.md`:

- **New outbound host** `ai-gateway.vercel.sh`, server-side (Node) only. The CSP `connect-src`
  already excludes `api.openai.com` because OpenAI calls are server-side, not browser fetches;
  rerank is likewise server-side, so **no CSP change is needed**. Record this as a reasoned decision,
  not an omission.
- **Third-party data flow:** WEB verse text + the user prompt are sent to Voyage via the gateway.
  WEB is public-domain scripture and the prompt is already sent to OpenAI for synthesis, so no new
  class of data leaves the system. Record this rationale.

## Testing

### Unit — `tests/unit/lib/search/rerank.test.ts` (mock the AI SDK `rerank`)

- Returns `null` immediately when `AI_GATEWAY_API_KEY` is unset (asserts **no** network call).
- Returns `null` on empty candidates.
- On success, maps `ranking[].originalIndex` back to the correct `reference` (reorders correctly,
  preserves references — guard the index mapping against off-by-one).
- Honors `topN` (returns at most `topN`).
- Swallows a thrown / timed-out rerank call → returns `null`.

### Unit — extend `tests/unit/lib/search-semantic.test.ts`

- With rerank mocked to a reordering, `searchSemantic` returns rerank order (not RRF order).
- With rerank mocked to `null`, output is byte-identical to today's RRF slice (locks the fallback).
- Rerank receives **only on-spine** candidates (spine filter runs first) and **WEB text**.

### Integration — extend `tests/integration/semantic-search.test.ts`

- Run the rerank path against the Neon test branch when `AI_GATEWAY_API_KEY` is present; **skip**
  when unset (mirrors existing OpenAI-key-gated skips), so `npm run verify` stays green without
  secrets.

### Evidence-diff — extend `scripts/evidence-diff.ts`

- Print before/after (RRF vs reranked) ordering for a few sample conceptual prompts for manual
  quality inspection.

### Gates

- **Coverage:** new module must stay within 80/80/75/65; the unit tests cover both branches
  (key set/unset, success/error).
- **Acceptance:** `scripts/acceptance-test.js` is corpus-count-pinned; rerank only reorders
  retrieval and adds no new assertions, so no count changes — confirm it still passes rather than
  edit it.

## Documentation updates (per CLAUDE.md)

- `docs/Project_State.md` — Phase 4b done; update assistant-pipeline step 2 semantic-path text.
- `docs/HiFi-exegesis-nt-roadmap.md` — flip Phase 4b from DEFERRED to DONE; update the
  reconciliation rerank rows (B. Retrieval pipeline; capability table).
- `README.md` — new env vars + the optional rerank dependency.
- `docs/security-register.md` — the entry described under Security.

## Risks / open considerations

- **Cross-lingual reranking:** the query is English and documents are WEB English, so this is a
  same-language rerank — low risk. (Greek-text reranking was considered and rejected.)
- **Added latency:** one extra network round-trip on conceptual prompts only; bounded by
  `RERANK_TIMEOUT_MS` with graceful fallback on timeout.
- **AI SDK version drift:** `rerank` is a relatively new AI SDK surface; pin versions and lock
  behavior with mocked unit tests so an upstream signature change surfaces in CI.
- **Quality measurement:** Phase 4b validates ordering qualitatively (evidence-diff + manual);
  quantitative faithfulness/precision gating is intentionally deferred to Phase 6.

## Verification

- `npm run verify` (lint + tsc + build + coverage) green.
- `npm run test:integration` and `npm run test:acceptance` green against the Neon test branch.
- Manual: ask the assistant a conceptual word-study prompt with and without `AI_GATEWAY_API_KEY`
  set; confirm reranked ordering when set and identical-to-baseline behavior when unset; confirm
  citations still resolve to real SBLGNT verses.
- `npm run security:audit` shows no new advisories beyond the tracked postcss one.
