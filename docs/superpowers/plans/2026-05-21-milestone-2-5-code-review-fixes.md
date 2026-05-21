# Milestone 2.5 Code Review Fixes - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the high-, medium-, and low-severity findings from the 2026-05-21 code review of the Milestone 2.5 retrieval-first assistant work, in a sequence that keeps the tree green at each checkpoint and finishes with every milestone test/verification gate passing.

**Architecture:** Three phases (high -> medium -> low) with a vitest harness added up front so every behavioral change is TDD-driven. Persistence and OpenAI integration changes are framed as small, independently committable slices. The assistant route, model router, search layer, and reader controls are each touched in isolated tasks; cross-cutting renames (e.g. `AiMessage.citations` -> `metadata`) are handled in single dedicated tasks with their own DB migration.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.8, Prisma 6 over PostgreSQL, Playwright (acceptance via `scripts/acceptance-test.js`). This plan adds **vitest 2** for unit tests and the official **openai** Node SDK.

**Milestone alignment:** Every High task closes a Milestone 2.5 guardrail or contract requirement (safe live calls, structured citations, persistence shape, full-corpus perf). The Medium tasks improve correctness and stability without expanding scope. The Low tasks are bundled cleanups so they cost little time but leave the codebase in a maintainable state for Step 3 (Scholarly Mode V1). The milestone verification commands (`npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:acceptance`) are run at the end of every phase.

---

## File Map

| File | Action | Why |
|---|---|---|
| `package.json` | Modify | Add `vitest`, `@vitest/coverage-v8`, `openai`; add `test:unit` script |
| `vitest.config.ts` | Create | Standalone vitest config |
| `tests/unit/lib/search.test.ts` | Create | Token search + verse hydration tests |
| `tests/unit/lib/ai/assistant.test.ts` | Create | Fallback / live / persistence tests |
| `tests/unit/lib/ai/modelRouter.test.ts` | Create | Routing, timeout, retry-after, payload-cap tests |
| `tests/unit/components/ReaderControls.test.tsx` | Create | Derivation-not-state behavior |
| `tests/unit/api/assistant.test.ts` | Create | `recordAssistantExchange` shape test |
| `lib/search.ts` | Modify | Bulk verse hydration; safer `getTopLemmas`; named exports |
| `lib/ai/assistant.ts` | Modify | Dispatch table; structured trace; bulk Token query; book detection via `ntBooks`; options-object `withMarkdown` |
| `lib/ai/modelRouter.ts` | Modify | OpenAI SDK; AbortController + deadline; Retry-After; payload cap; hoisted constants |
| `lib/ai/openaiClient.ts` | Create | Shared OpenAI SDK client + env-driven config |
| `lib/ai/sessions.ts` | Create | Session/message persistence with new `metadata` shape |
| `lib/ai/toolTrace.ts` | Create | `ToolTraceEntry` type + formatter |
| `app/api/assistant/route.ts` | Modify | Call session helpers; overlap user-write with answer call |
| `components/AiAssistant.tsx` | Modify | Shared types; drop redundant `sessionId` state; collapse wrapper div |
| `components/ReaderControls.tsx` | Modify | Derive chapter from `book` + `passages` |
| `prisma/schema.prisma` | Modify | Rename `AiMessage.citations` -> `metadata`; add composite `Token` index |
| `prisma/migrations/<timestamp>_*/migration.sql` | Create (via Prisma) | Rename + index SQL |
| `scripts/acceptance-test.js` | Modify | Update assertion for new structured trace render |
| `.env.example` | Modify | Add `OPENAI_REQUEST_TIMEOUT_MS` |

---

## Phase Sequencing

- Each task is one commit unless explicitly broken into sub-commits.
- Phase boundary = run `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:unit`, `npm run test:acceptance`.
- Do not start a Medium task while a High is in flight.

---

# Phase 1 - Test Infrastructure + High-Severity Fixes

### Task 1: Add `vitest` and a passing sanity test

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/unit/helpers/prismaMock.ts`
- Create: `tests/unit/sanity.test.ts`

- [ ] **Step 1: Install**

```powershell
npm install --save-dev vitest@^2 @vitest/coverage-v8@^2
```

- [ ] **Step 2: Add scripts**

In `package.json`, add to `"scripts"`:

```json
"test:unit": "vitest run",
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    globals: false,
    pool: "threads"
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) }
  }
});
```

- [ ] **Step 4: Create Prisma mock helper**

`tests/unit/helpers/prismaMock.ts`:

```ts
import { vi } from "vitest";

export function createPrismaMock() {
  const fn = () => vi.fn();
  return {
    aiSession: { findFirst: fn(), create: fn() },
    aiMessage: { create: fn() },
    token: { findMany: fn(), groupBy: fn(), count: fn() },
    verse: { findMany: fn(), findFirst: fn(), count: fn() }
  };
}
export type PrismaMock = ReturnType<typeof createPrismaMock>;
```

- [ ] **Step 5: Sanity test**

`tests/unit/sanity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("vitest sanity", () => {
  it("runs", () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 6: Run + commit**

```powershell
npm run test:unit
git add package.json package-lock.json vitest.config.ts tests/unit/
git commit -m "test: add vitest harness for milestone 2.5 unit coverage"
```

---

### Task 2 (H2): Bulk verse hydration in `tokenToSearchResult`

**Why:** Milestone retrieval-first goal + corpus-scale stability. Today each token row triggers an extra `verse.findFirst`.

**Files:**
- Modify: `lib/search.ts:244, 290, 351-379`
- Test: `tests/unit/lib/search.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/lib/search.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const prismaMock = {
  token: { count: vi.fn(), findMany: vi.fn() },
  verse: { findMany: vi.fn(), findFirst: vi.fn() }
};
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { searchLemma } from "@/lib/search";

beforeEach(() => { vi.clearAllMocks(); });

describe("searchLemma verse hydration", () => {
  it("issues a single verse.findMany for all matching tokens", async () => {
    prismaMock.token.count.mockResolvedValue(2);
    prismaMock.token.findMany.mockResolvedValue([
      { id: "t1", surface: "x", lemma: "y", morphCode: "N", chapter: 1, verse: 1,
        book: { id: "b1", osisId: "John" }, corpus: { abbreviation: "SBLGNT" } },
      { id: "t2", surface: "x", lemma: "y", morphCode: "N", chapter: 1, verse: 14,
        book: { id: "b1", osisId: "John" }, corpus: { abbreviation: "SBLGNT" } }
    ]);
    prismaMock.verse.findMany.mockResolvedValue([
      { bookId: "b1", chapter: 1, verse: 1, text: "v1", corpus: { abbreviation: "SBLGNT" } },
      { bookId: "b1", chapter: 1, verse: 14, text: "v14", corpus: { abbreviation: "SBLGNT" } }
    ]);

    const result = await searchLemma({ lemma: "y" });

    expect(prismaMock.verse.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.verse.findMany).toHaveBeenCalledTimes(1);
    expect(result.results.map((r) => r.verseText)).toEqual(["v1", "v14"]);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```powershell
npm run test:unit -- tests/unit/lib/search.test.ts
```

- [ ] **Step 3: Replace `tokenToSearchResult` with bulk `hydrateTokens`**

In `lib/search.ts`, delete `tokenToSearchResult` (lines 351-379) and replace the `await Promise.all(tokens.map(tokenToSearchResult))` call sites in `searchLemma` and `searchMorphology` with `await hydrateTokens(tokens)`. Add:

```ts
type HydratedToken = {
  id: string; surface: string; lemma: string | null; morphCode: string | null;
  chapter: number; verse: number;
  book: { id: string; osisId: string }; corpus: { abbreviation: string };
};

async function hydrateTokens(tokens: HydratedToken[]) {
  if (tokens.length === 0) return [];
  const bookIds = Array.from(new Set(tokens.map((t) => t.book.id)));
  const corpora = Array.from(new Set(tokens.map((t) => t.corpus.abbreviation)));

  const verses = await prisma.verse.findMany({
    where: {
      corpus: { abbreviation: { in: corpora } },
      bookId: { in: bookIds },
      OR: tokens.map((t) => ({ bookId: t.book.id, chapter: t.chapter, verse: t.verse }))
    },
    select: { bookId: true, chapter: true, verse: true, text: true, corpus: { select: { abbreviation: true } } }
  });

  const key = (bookId: string, chapter: number, verse: number, corpus: string) =>
    `${corpus}|${bookId}|${chapter}|${verse}`;
  const verseText = new Map<string, string>();
  for (const v of verses) verseText.set(key(v.bookId, v.chapter, v.verse, v.corpus.abbreviation), v.text);

  return tokens.map((token) => ({
    tokenId: token.id,
    corpus: token.corpus.abbreviation,
    reference: formatReference(token.book.osisId, token.chapter, token.verse),
    surface: token.surface,
    lemma: token.lemma ?? "",
    morphCode: token.morphCode ?? "",
    verseText: verseText.get(key(token.book.id, token.chapter, token.verse, token.corpus.abbreviation)) ?? ""
  }));
}
```

- [ ] **Step 4: Run + commit**

```powershell
npm run test:unit
npm run lint
npx tsc --noEmit
git add lib/search.ts tests/unit/lib/search.test.ts
git commit -m "perf(search): bulk-hydrate verses for lemma/morph results"
```

---

### Task 3 (H3): Bulk Token query in important-words branch

**Why:** `getTopLemmas` already scans Token; the follow-up re-queries Token N times via `searchLemma`. Replace with one `findMany`.

**Files:**
- Modify: `lib/ai/assistant.ts:84-132`
- Modify: `lib/search.ts` (add `findLemmaExamples`)
- Test: `tests/unit/lib/ai/assistant.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/lib/ai/assistant.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const prismaMock = {
  token: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  verse: { findMany: vi.fn(), findFirst: vi.fn() }
};
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/ai/modelRouter", async (orig) => {
  const real = await (orig as () => Promise<typeof import("@/lib/ai/modelRouter")>)();
  return { ...real, isLiveAssistantEnabled: () => false };
});

import { answerBibleQuestion } from "@/lib/ai/assistant";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.token.groupBy.mockResolvedValue([
    { lemma: "a", partOfSpeech: "N-", _count: { _all: 40 } },
    { lemma: "b", partOfSpeech: "N-", _count: { _all: 30 } },
    { lemma: "c", partOfSpeech: "N-", _count: { _all: 20 } }
  ]);
  prismaMock.token.findMany.mockResolvedValue([
    { id: "t1", surface: "a", lemma: "a", morphCode: "N", chapter: 1, verse: 1,
      book: { id: "bJohn", osisId: "John" }, corpus: { abbreviation: "SBLGNT" } }
  ]);
  prismaMock.verse.findMany.mockResolvedValue([
    { bookId: "bJohn", chapter: 1, verse: 1, text: "v1", corpus: { abbreviation: "SBLGNT" } }
  ]);
});

describe("important-words branch", () => {
  it("issues exactly one token.findMany for example tokens", async () => {
    await answerBibleQuestion("What are the most important words in John?");
    expect(prismaMock.token.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.token.groupBy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```powershell
npm run test:unit -- tests/unit/lib/ai/assistant.test.ts
```

- [ ] **Step 3: Add `findLemmaExamples` in `lib/search.ts`**

```ts
export async function findLemmaExamples(input: {
  lemmas: string[];
  corpus?: "SBLGNT";
  book?: string;
  perLemma?: number;
}) {
  if (input.lemmas.length === 0) return new Map<string, Awaited<ReturnType<typeof hydrateTokens>>>();
  const book = normalizeBook(input.book);
  const perLemma = Math.max(1, Math.min(input.perLemma ?? 5, 25));

  const tokens = await prisma.token.findMany({
    where: {
      lemma: { in: input.lemmas },
      corpus: { abbreviation: input.corpus ?? "SBLGNT" },
      book: book ? { osisId: book } : undefined
    },
    include: { book: true, corpus: true },
    orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }, { verse: "asc" }, { wordIndex: "asc" }]
  });

  const grouped = new Map<string, typeof tokens>();
  for (const t of tokens) {
    if (!t.lemma) continue;
    const bucket = grouped.get(t.lemma) ?? [];
    if (bucket.length < perLemma) bucket.push(t);
    grouped.set(t.lemma, bucket);
  }

  const flat = Array.from(grouped.values()).flat();
  const hydrated = await hydrateTokens(flat);
  const byId = new Map(hydrated.map((row) => [row.tokenId, row]));

  const out = new Map<string, typeof hydrated>();
  for (const [lemma, bucket] of grouped) {
    out.set(lemma, bucket.map((t) => byId.get(t.id)!).filter(Boolean));
  }
  return out;
}
```

- [ ] **Step 4: Replace the branch in `lib/ai/assistant.ts`**

Replace lines 84-132 with:

```ts
if (book && isImportantWordsPrompt(normalized)) {
  const topLemmas = await getTopLemmas({ book, limit: 3 });
  toolTrace.push(`getTopLemmas({ book: "${book}", limit: 3 })`);

  const examples = await findLemmaExamples({
    lemmas: topLemmas.map((l) => l.lemma), book, perLemma: 5
  });
  toolTrace.push(`findLemmaExamples({ lemmas: ${JSON.stringify(topLemmas.map((l) => l.lemma))}, book: "${book}", perLemma: 5 })`);

  const citations = topLemmas.flatMap((entry) =>
    (examples.get(entry.lemma) ?? []).map((result) => ({
      reference: result.reference, corpus: result.corpus,
      searchQuery: `lemma:${entry.lemma}`, toolName: "findLemmaExamples", tokenId: result.tokenId
    }))
  );

  const rows = topLemmas.map((entry) => {
    const refs = (examples.get(entry.lemma) ?? []).map((r) => r.reference).join("; ");
    return `| ${entry.lemma} | ${entry.count} | ${entry.partOfSpeech} | ${refs || "No examples returned"} |`;
  }).join("\n");

  const answer = [
    `Textual observations: I searched the full SBLGNT token data for ${book} and ranked frequent content lemmas after excluding common function words and helper verbs.`,
    "",
    "| Lemma | Occurrences | Part of speech | Sample references |",
    "| --- | ---: | --- | --- |",
    rows || "| None | 0 | - | No matching lemma data. |",
    "",
    "Interpretive suggestion: \"Most important\" is an interpretive category, so this answer uses prominence in the tagged corpus as the measurable starting point.",
    "",
    "Application/reflection: Use the cited occurrences to test whether these frequent content words actually carry the themes you want to study in context."
  ].join("\n");

  return withMarkdown("Important Words", answer, citations, toolTrace, { mode: "fallback", ...routing });
}
```

Add `findLemmaExamples` to the `@/lib/search` import line.

- [ ] **Step 5: Run + commit**

```powershell
npm run test:unit
npm run test:acceptance
git add lib/search.ts lib/ai/assistant.ts tests/unit/lib/ai/assistant.test.ts
git commit -m "perf(assistant): bulk-fetch lemma examples in important-words branch"
```

---

### Task 4 (H1): Rename `AiMessage.citations` JSON column to `metadata`

**Why:** Milestone Persistence says "Store user prompt, assistant answer, mode, citations, and tool trace." Today everything is jammed into a column named `citations`. Renaming + a typed helper restores schema honesty.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_assistant_message_metadata/migration.sql`
- Create: `lib/ai/sessions.ts`
- Modify: `app/api/assistant/route.ts`
- Create: `tests/unit/api/assistant.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/api/assistant.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const prismaMock = {
  aiSession: { findFirst: vi.fn(), create: vi.fn() },
  aiMessage: { create: vi.fn() }
};
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/user", () => ({ localUserId: "local-user" }));

import { recordAssistantExchange } from "@/lib/ai/sessions";
import type { AssistantAnswer } from "@/lib/ai/assistant";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.aiSession.create.mockResolvedValue({ id: "sess-1" });
});

const answer: AssistantAnswer = {
  answer: "ok",
  citations: [{ reference: "John 1:1", corpus: "SBLGNT", searchQuery: "lemma:x" }],
  markdown: "# x",
  toolTrace: ["getPassage()"],
  mode: "fallback",
  modelRole: "default",
  modelUsed: "gpt-5.3-chat-latest",
  routingDecision: "Handled by the default model"
};

describe("recordAssistantExchange", () => {
  it("writes user with raw content + assistant with structured metadata", async () => {
    await recordAssistantExchange({ requestedSessionId: "", prompt: "What is logos?", answer });
    const writes = prismaMock.aiMessage.create.mock.calls.map((c) => c[0].data);
    expect(writes[0]).toMatchObject({ role: "user", content: "What is logos?", metadata: null });
    expect(writes[1]).toMatchObject({
      role: "assistant",
      content: "ok",
      metadata: { mode: "fallback", citations: answer.citations, toolTrace: answer.toolTrace }
    });
  });
});
```

- [ ] **Step 2: Run, expect fail**

```powershell
npm run test:unit -- tests/unit/api/assistant.test.ts
```

- [ ] **Step 3: Update Prisma schema**

In `prisma/schema.prisma`, replace `citations Json?` with `metadata Json?` in the `AiMessage` model.

- [ ] **Step 4: Generate migration**

```powershell
npx prisma migrate dev --name assistant_message_metadata
```

If Prisma generates DROP + ADD instead of RENAME, hand-edit the migration to:

```sql
ALTER TABLE "AiMessage" RENAME COLUMN "citations" TO "metadata";
```

- [ ] **Step 5: Create `lib/ai/sessions.ts`**

```ts
import { prisma } from "@/lib/db";
import { localUserId } from "@/lib/user";
import type { AssistantAnswer } from "@/lib/ai/assistant";

export type AssistantMessageMetadata = {
  mode: AssistantAnswer["mode"];
  modelRole: AssistantAnswer["modelRole"];
  modelUsed: AssistantAnswer["modelUsed"];
  routingDecision: AssistantAnswer["routingDecision"];
  recommendedUpgrade?: AssistantAnswer["recommendedUpgrade"];
  citations: AssistantAnswer["citations"];
  toolTrace: AssistantAnswer["toolTrace"];
};

export async function recordAssistantExchange(input: {
  requestedSessionId: string;
  prompt: string;
  answer: AssistantAnswer;
}) {
  const existing = input.requestedSessionId
    ? await prisma.aiSession.findFirst({ where: { id: input.requestedSessionId, userId: localUserId } })
    : null;

  const session = existing ?? (await prisma.aiSession.create({
    data: { userId: localUserId, title: input.prompt.slice(0, 80) }
  }));

  const userWrite = prisma.aiMessage.create({
    data: { sessionId: session.id, role: "user", content: input.prompt, metadata: null }
  });

  const metadata: AssistantMessageMetadata = {
    mode: input.answer.mode,
    modelRole: input.answer.modelRole,
    modelUsed: input.answer.modelUsed,
    routingDecision: input.answer.routingDecision,
    recommendedUpgrade: input.answer.recommendedUpgrade,
    citations: input.answer.citations,
    toolTrace: input.answer.toolTrace
  };

  const assistantWrite = prisma.aiMessage.create({
    data: { sessionId: session.id, role: "assistant", content: input.answer.answer, metadata }
  });

  await Promise.all([userWrite, assistantWrite]);
  return session.id;
}
```

- [ ] **Step 6: Rewrite the route**

`app/api/assistant/route.ts`:

```ts
import { NextResponse } from "next/server";
import { answerBibleQuestion } from "@/lib/ai/assistant";
import { recordAssistantExchange } from "@/lib/ai/sessions";

export async function POST(request: Request) {
  const body = await request.json();
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  const answer = await answerBibleQuestion(prompt);
  const sessionId = await recordAssistantExchange({ requestedSessionId, prompt, answer });

  return NextResponse.json({ ...answer, sessionId });
}
```

- [ ] **Step 7: Verify + commit**

```powershell
npm run test:unit
npm run lint
npx tsc --noEmit
npm run test:acceptance
git add prisma/schema.prisma prisma/migrations/ lib/ai/sessions.ts app/api/assistant/route.ts tests/unit/api/
git commit -m "feat(assistant): persist exchanges via AiMessage.metadata with typed shape"
```

---

### Task 5 (H4): AbortController + deadline on the OpenAI fetch

**Files:**
- Modify: `lib/ai/modelRouter.ts:101-110`
- Modify: `.env.example`
- Test: `tests/unit/lib/ai/modelRouter.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/lib/ai/modelRouter.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_REQUEST_TIMEOUT_MS", "1000");
});
afterEach(() => { vi.useRealTimers(); });

describe("OpenAI request timeout", () => {
  it("aborts after the configured deadline", async () => {
    const aborts: AbortSignal[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      aborts.push(init.signal!);
      return await new Promise<Response>((_, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      });
    });

    const { synthesizeWithDefaultModel } = await import("@/lib/ai/modelRouter");
    const promise = synthesizeWithDefaultModel({
      prompt: "hi",
      localAnswer: { answer: "x", citations: [], markdown: "", toolTrace: [],
        mode: "fallback", modelRole: "default", modelUsed: "gpt-5.3-chat-latest", routingDecision: "" },
      routing: { modelRole: "default", modelUsed: "gpt-5.3-chat-latest", routingDecision: "" }
    });

    await vi.advanceTimersByTimeAsync(1100);
    await expect(promise).rejects.toThrow(/abort|timed out/i);
    expect(aborts[0].aborted).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```powershell
npm run test:unit -- tests/unit/lib/ai/modelRouter.test.ts
```

- [ ] **Step 3: Update `lib/ai/modelRouter.ts`**

Replace `fetchResponsesWithRetry` with:

```ts
function getRequestTimeoutMs() {
  const raw = process.env.OPENAI_REQUEST_TIMEOUT_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25_000;
}

async function fetchResponsesWithRetry(init: Omit<RequestInit, "signal">) {
  const timeoutMs = getRequestTimeoutMs();

  async function attempt() {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`OpenAI request timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    try {
      return await fetch("https://api.openai.com/v1/responses", { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  const first = await attempt();
  if (![429, 500, 502, 503, 504].includes(first.status)) return first;

  const retryAfterMs = parseRetryAfter(first.headers.get("retry-after"), 500);
  await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  return attempt();
}

function parseRetryAfter(value: string | null, fallback: number) {
  if (!value) return fallback;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 10_000));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 10_000));
  return fallback;
}
```

- [ ] **Step 4: Add env var**

Append to `.env.example`:

```
OPENAI_REQUEST_TIMEOUT_MS="25000"
```

- [ ] **Step 5: Add fallback-on-timeout test**

Append to `tests/unit/lib/ai/modelRouter.test.ts`:

```ts
it("falls back locally when the OpenAI request times out", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_REQUEST_TIMEOUT_MS", "10");
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const { answerBibleQuestion } = await import("@/lib/ai/assistant");
  const answer = await answerBibleQuestion("Hello world");
  expect(answer.mode).toBe("fallback");
});
```

- [ ] **Step 6: Verify + commit**

```powershell
npm run test:unit
npm run lint
npx tsc --noEmit
git add lib/ai/modelRouter.ts .env.example tests/unit/lib/ai/modelRouter.test.ts
git commit -m "feat(assistant): bound OpenAI calls with timeout + Retry-After"
```

---

### Phase 1 Checkpoint

```powershell
npm run lint
npx tsc --noEmit
npm run build
npm run test:unit
npm run test:acceptance
```

All five must pass. HIGH severity is closed; milestone guardrails are in place.

---

# Phase 2 - Medium-Severity Fixes

### Task 6 (M1): Adopt the official `openai` SDK

**Files:**
- Modify: `package.json`
- Create: `lib/ai/openaiClient.ts`
- Modify: `lib/ai/modelRouter.ts`

- [ ] **Step 1: Install**

```powershell
npm install openai@^4
```

- [ ] **Step 2: `lib/ai/openaiClient.ts`**

```ts
import OpenAI from "openai";

let cached: OpenAI | null = null;

export function getOpenAi() {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const timeoutRaw = Number.parseInt(process.env.OPENAI_REQUEST_TIMEOUT_MS?.trim() ?? "", 10);
  cached = new OpenAI({
    apiKey,
    timeout: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 25_000,
    maxRetries: 1
  });
  return cached;
}

export function resetOpenAiClient() { cached = null; }
```

- [ ] **Step 3: Rewrite `synthesizeWithDefaultModel`**

In `lib/ai/modelRouter.ts`, remove `fetchResponsesWithRetry`, `OpenAiResponsePayload`, `extractResponseText`, and the raw fetch in `synthesizeWithDefaultModel`. Replace with:

```ts
import { getOpenAi } from "@/lib/ai/openaiClient";

const ASSISTANT_INSTRUCTIONS = [
  aiSystemPrompt,
  "Use only the retrieved evidence and deterministic draft supplied by TextLab Bible.",
  "Preserve the three sections: Textual observations, Interpretive suggestion, and Application/reflection.",
  "Do not add lexical, manuscript, historical, or scholarly claims that are not present in the retrieved evidence."
].join("\n\n");

function buildUserPayload(prompt: string, localAnswer: AssistantAnswer) {
  return [
    `User prompt:\n${prompt}`,
    `Retrieved citations:\n${JSON.stringify(localAnswer.citations.slice(0, 20))}`,
    `Retrieval trace:\n${localAnswer.toolTrace.join("\n")}`,
    `Deterministic draft:\n${localAnswer.answer}`
  ].join("\n\n");
}

export async function synthesizeWithDefaultModel(input: {
  prompt: string;
  localAnswer: AssistantAnswer;
  routing: RoutingDecision;
}) {
  const client = getOpenAi();
  if (!client) return null;

  const response = await client.responses.create({
    model: input.routing.modelUsed,
    instructions: ASSISTANT_INSTRUCTIONS,
    input: [{
      role: "user",
      content: [{ type: "input_text", text: buildUserPayload(input.prompt, input.localAnswer) }]
    }]
  });

  return response.output_text?.trim() || null;
}
```

(This single edit closes M1, M7, and L16.)

- [ ] **Step 4: Update modelRouter tests**

Replace fetch stubs with an SDK mock:

```ts
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    responses: { create: vi.fn().mockResolvedValue({ output_text: "" }) }
  }))
}));
```

Assert the SDK constructor was called with `timeout` matching `OPENAI_REQUEST_TIMEOUT_MS` and `maxRetries: 1`.

- [ ] **Step 5: Verify + commit**

```powershell
npm run test:unit
npm run lint
npx tsc --noEmit
git add package.json package-lock.json lib/ai/openaiClient.ts lib/ai/modelRouter.ts tests/unit/lib/ai/modelRouter.test.ts
git commit -m "refactor(assistant): use official openai SDK with shared client"
```

---

### Task 7 (M2): Word-boundary book detection via `ntBooks` aliases

**Files:**
- Modify: `lib/ai/assistant.ts`

- [ ] **Step 1: Failing test**

Append to `tests/unit/lib/ai/assistant.test.ts`:

```ts
import { detectBookFromPrompt } from "@/lib/ai/assistant";

describe("book detection", () => {
  it("ignores substrings inside other words", () => {
    expect(detectBookFromPrompt("from the start")).toBeUndefined();
    expect(detectBookFromPrompt("romance languages")).toBeUndefined();
  });
  it("matches alias word boundaries", () => {
    expect(detectBookFromPrompt("Tell me about Romans 8")).toBe("Rom");
    expect(detectBookFromPrompt("john 1:1")).toBe("John");
    expect(detectBookFromPrompt("1 cor 13")).toBe("1Cor");
  });
});
```

- [ ] **Step 2: Implement**

In `lib/ai/assistant.ts`:

```ts
import { ntBooks } from "@/lib/references";

export function detectBookFromPrompt(prompt: string): string | undefined {
  const lower = prompt.toLowerCase();
  for (const book of ntBooks) {
    for (const alias of book.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\]/g, "\$&");
      const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
      if (pattern.test(lower)) return book.osisId;
    }
  }
  return undefined;
}
```

Replace line 82 with `const book = detectBookFromPrompt(prompt);`.

- [ ] **Step 3: Commit**

```powershell
npm run test:unit
git add lib/ai/assistant.ts tests/unit/lib/ai/assistant.test.ts
git commit -m "fix(assistant): word-boundary alias matching for book detection"
```

---

### Task 8 (M8): Composite Token index for `getTopLemmas`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add index**

In the `Token` model, add:

```prisma
@@index([corpusId, bookId, partOfSpeech, lemma])
```

- [ ] **Step 2: Generate migration**

```powershell
npx prisma migrate dev --name token_lemma_index
```

- [ ] **Step 3: Verify + commit**

```powershell
npm run lint
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations/
git commit -m "perf(db): composite Token index for getTopLemmas filter set"
```

---

### Task 9 (M7): Cap citations + drop pretty-print

Covered inline by Task 6 (`.slice(0, 20)` + non-indented `JSON.stringify`). If Task 6 was split, add this regression test:

```ts
it("caps citations at 20 entries", async () => {
  const createMock = vi.fn().mockResolvedValue({ output_text: "ok" });
  vi.doMock("openai", () => ({
    default: vi.fn().mockImplementation(() => ({ responses: { create: createMock } }))
  }));
  vi.stubEnv("OPENAI_API_KEY", "x");
  const { synthesizeWithDefaultModel } = await import("@/lib/ai/modelRouter");
  const citations = Array.from({ length: 50 }, (_, i) => ({ reference: `John 1:${i+1}`, corpus: "SBLGNT", searchQuery: "x" }));
  await synthesizeWithDefaultModel({
    prompt: "hi",
    localAnswer: { answer: "", citations, markdown: "", toolTrace: [], mode: "fallback", modelRole: "default", modelUsed: "m", routingDecision: "" },
    routing: { modelRole: "default", modelUsed: "m", routingDecision: "" }
  });
  const text = createMock.mock.calls[0][0].input[0].content[0].text;
  const json = text.split("Retrieved citations:\n")[1].split("\n\nRetrieval trace:")[0];
  expect(JSON.parse(json)).toHaveLength(20);
  expect(json).not.toContain("\n  ");
});
```

---

### Task 10 (M6): Overlap user-write with answer generation

**Files:**
- Modify: `lib/ai/sessions.ts`
- Modify: `app/api/assistant/route.ts`

- [ ] **Step 1: Split into start/finish**

In `lib/ai/sessions.ts`:

```ts
export async function startAssistantExchange(input: { requestedSessionId: string; prompt: string }) {
  const existing = input.requestedSessionId
    ? await prisma.aiSession.findFirst({ where: { id: input.requestedSessionId, userId: localUserId } })
    : null;
  const session = existing ?? (await prisma.aiSession.create({
    data: { userId: localUserId, title: input.prompt.slice(0, 80) }
  }));
  const userMessagePromise = prisma.aiMessage.create({
    data: { sessionId: session.id, role: "user", content: input.prompt, metadata: null }
  });
  return { sessionId: session.id, userMessagePromise };
}

export async function finishAssistantExchange(input: {
  sessionId: string;
  userMessagePromise: Promise<unknown>;
  answer: AssistantAnswer;
}) {
  const metadata: AssistantMessageMetadata = {
    mode: input.answer.mode, modelRole: input.answer.modelRole,
    modelUsed: input.answer.modelUsed, routingDecision: input.answer.routingDecision,
    recommendedUpgrade: input.answer.recommendedUpgrade,
    citations: input.answer.citations, toolTrace: input.answer.toolTrace
  };
  const assistantWrite = prisma.aiMessage.create({
    data: { sessionId: input.sessionId, role: "assistant", content: input.answer.answer, metadata }
  });
  await Promise.all([input.userMessagePromise, assistantWrite]);
}
```

- [ ] **Step 2: Update the route**

```ts
import { NextResponse } from "next/server";
import { answerBibleQuestion } from "@/lib/ai/assistant";
import { finishAssistantExchange, startAssistantExchange } from "@/lib/ai/sessions";

export async function POST(request: Request) {
  const body = await request.json();
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  const { sessionId, userMessagePromise } = await startAssistantExchange({ requestedSessionId, prompt });
  const answer = await answerBibleQuestion(prompt);
  await finishAssistantExchange({ sessionId, userMessagePromise, answer });

  return NextResponse.json({ ...answer, sessionId });
}
```

- [ ] **Step 3: Update Task 4 test**

Replace `recordAssistantExchange` calls with `startAssistantExchange` + `finishAssistantExchange`. Add an assertion that the user write was initiated before `answerBibleQuestion` resolves.

- [ ] **Step 4: Commit**

```powershell
npm run test:unit
npm run lint
npx tsc --noEmit
git add app/api/assistant/route.ts lib/ai/sessions.ts tests/unit/api/
git commit -m "perf(assistant): overlap user-message write with answer generation"
```

---

### Task 11 (M4): `withMarkdown` -> single options object

**Files:**
- Modify: `lib/ai/assistant.ts`

- [ ] **Step 1: Change signature**

```ts
type WithMarkdownInput = {
  title: string;
  answer: string;
  citations: AssistantCitation[];
  toolTrace: string[];
  mode: AssistantMode;
  modelRole: ModelRole;
  modelUsed: string;
  routingDecision: string;
  recommendedUpgrade?: RecommendedUpgrade;
};

function withMarkdown(input: WithMarkdownInput): AssistantAnswer {
  const exportResult = createMarkdownExport({
    title: input.title, body: input.answer, citations: input.citations
  });
  return {
    answer: input.answer, citations: input.citations,
    markdown: exportResult.markdown, toolTrace: input.toolTrace,
    mode: input.mode, modelRole: input.modelRole, modelUsed: input.modelUsed,
    routingDecision: input.routingDecision, recommendedUpgrade: input.recommendedUpgrade
  };
}
```

- [ ] **Step 2: Update every call site**

```ts
return withMarkdown({ title: "Important Words", answer, citations, toolTrace, mode: "fallback", ...routing });
```

Apply to all 7 call sites in `lib/ai/assistant.ts` (important-words, lemma, morphology, passage, keyword + the two `answerBibleQuestion` branches).

- [ ] **Step 3: Commit**

```powershell
npm run test:unit
npm run lint
npx tsc --noEmit
git add lib/ai/assistant.ts
git commit -m "refactor(assistant): pass withMarkdown inputs as options object"
```

---

### Task 12 (M3): Derive `ReaderControls` chapter from book + passages

**Files:**
- Modify: `components/ReaderControls.tsx`
- Create: `tests/unit/components/ReaderControls.test.tsx`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Install jsdom + RTL**

```powershell
npm install --save-dev jsdom @testing-library/react @testing-library/dom
```

Add to `vitest.config.ts`:

```ts
environmentMatchGlobs: [["tests/unit/components/**", "jsdom"]],
```

- [ ] **Step 2: Failing test**

```tsx
import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ReaderControls } from "@/components/ReaderControls";

const books = [{ osisId: "John", label: "John" }, { osisId: "Rom", label: "Romans" }];
const passages = [
  { book: "John", chapter: 1, label: "John 1" },
  { book: "John", chapter: 2, label: "John 2" },
  { book: "Rom", chapter: 1, label: "Romans 1" }
];

describe("ReaderControls", () => {
  it("auto-selects first chapter when book changes", () => {
    const { getByDisplayValue, getByRole } = render(
      <ReaderControls books={books} passages={passages} selectedBook="John" selectedChapter={2} />
    );
    expect(getByDisplayValue("John 2")).toBeTruthy();
    fireEvent.change(getByRole("combobox", { name: /book/i }), { target: { value: "Rom" } });
    expect(getByDisplayValue("Romans 1")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Rewrite the component**

```tsx
"use client";

import { useMemo, useState } from "react";

type ReaderBookOption = { osisId: string; label: string };
type ReaderPassageOption = { book: string; label: string; chapter: number };

export function ReaderControls({
  books, passages, selectedBook, selectedChapter
}: {
  books: ReaderBookOption[]; passages: ReaderPassageOption[];
  selectedBook: string; selectedChapter: number;
}) {
  const [book, setBook] = useState(selectedBook);
  const [chapterOverride, setChapterOverride] = useState<number | null>(selectedChapter);

  const chapterOptions = useMemo(
    () => passages.filter((p) => p.book === book), [book, passages]
  );

  const activeChapter =
    chapterOverride !== null && chapterOptions.some((p) => p.chapter === chapterOverride)
      ? chapterOverride
      : chapterOptions[0]?.chapter ?? 1;

  return (
    <form className="flex flex-wrap gap-2" action="/read">
      <select
        aria-label="book" name="book" value={book}
        onChange={(e) => { setBook(e.target.value); setChapterOverride(null); }}
        className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
      >
        {books.map((b) => <option key={b.osisId} value={b.osisId}>{b.label}</option>)}
      </select>
      <select
        aria-label="chapter" name="chapter" value={activeChapter}
        onChange={(e) => setChapterOverride(Number.parseInt(e.target.value, 10))}
        className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
      >
        {chapterOptions.map((p) => (
          <option key={`${p.book}-${p.chapter}`} value={p.chapter}>{p.label}</option>
        ))}
      </select>
      <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Open</button>
    </form>
  );
}
```

- [ ] **Step 4: Commit**

```powershell
npm run test:unit
npm run lint
npx tsc --noEmit
git add components/ReaderControls.tsx tests/unit/components/ vitest.config.ts package.json package-lock.json
git commit -m "refactor(reader): derive chapter value instead of mirroring state"
```

---

### Task 13 (M5): Structured `ToolTraceEntry` records

**Files:**
- Create: `lib/ai/toolTrace.ts`
- Modify: `lib/ai/assistant.ts`, `lib/ai/modelRouter.ts`, `components/AiAssistant.tsx`, `scripts/acceptance-test.js`

- [ ] **Step 1: Create `lib/ai/toolTrace.ts`**

```ts
export type ToolTraceEntry = { tool: string; args?: Record<string, unknown>; error?: string };

export function formatToolTrace(entry: ToolTraceEntry): string {
  if (entry.error) return `${entry.tool} failed: ${entry.error}`;
  const args = entry.args ? `(${JSON.stringify(entry.args)})` : "()";
  return `${entry.tool}${args}`;
}
```

- [ ] **Step 2: Change `AssistantAnswer.toolTrace` to `ToolTraceEntry[]`**

Update every `toolTrace.push(...)` in assistant.ts and modelRouter.ts to push records:

```ts
toolTrace.push({ tool: "getTopLemmas", args: { book, limit: 3 } });
toolTrace.push({ tool: "searchLemma", args: { lemma: lemma.lemma, book } });
toolTrace.push({ tool: "openai.responses.create", args: { model: input.routing.modelUsed } });
toolTrace.push({ tool: "openai.responses.create", error: error instanceof Error ? error.message : "Unknown error" });
```

- [ ] **Step 3: Update the UI render in `components/AiAssistant.tsx`**

```tsx
import { formatToolTrace } from "@/lib/ai/toolTrace";

<ul>
  {response.toolTrace.map((entry, i) => (
    <li key={i} className="text-xs text-slate-500">{formatToolTrace(entry)}</li>
  ))}
</ul>
```

- [ ] **Step 4: Update acceptance assertion**

In `scripts/acceptance-test.js` near line 135, change the `searchLemma` substring to the new structured form: `searchLemma({"lemma":"logos","book":"John"})` (use the actual Greek lemma in the file).

- [ ] **Step 5: Commit**

```powershell
npm run test:unit
npm run test:acceptance
git add lib/ai/toolTrace.ts lib/ai/assistant.ts lib/ai/modelRouter.ts components/AiAssistant.tsx scripts/acceptance-test.js
git commit -m "refactor(assistant): structured ToolTraceEntry records"
```

---

### Task 14 (M9): Dispatch table for assistant branches

**Files:**
- Modify: `lib/ai/assistant.ts`

- [ ] **Step 1: Refactor**

```ts
type BranchContext = {
  prompt: string;
  normalized: string;
  book?: string;
  routing: RoutingDecision;
  toolTrace: ToolTraceEntry[];
};

const branches: Array<(ctx: BranchContext) => Promise<AssistantAnswer | null>> = [
  importantWordsBranch, lemmaAliasBranch, morphologyBranch, passageBranch
];

async function answerFromLocalRetrieval(prompt: string, routing = routeAssistantPrompt(prompt)): Promise<AssistantAnswer> {
  const ctx: BranchContext = {
    prompt, normalized: prompt.toLowerCase(),
    book: detectBookFromPrompt(prompt), routing, toolTrace: []
  };
  for (const branch of branches) {
    const result = await branch(ctx);
    if (result) return result;
  }
  return keywordFallback(ctx);
}
```

Extract each existing branch body into its own `async function importantWordsBranch(ctx: BranchContext)` etc.; each returns `null` when not applicable.

- [ ] **Step 2: Commit**

```powershell
npm run test:unit
npm run test:acceptance
git add lib/ai/assistant.ts
git commit -m "refactor(assistant): dispatch table replaces conditional ladder"
```

---

### Phase 2 Checkpoint

```powershell
npm run lint
npx tsc --noEmit
npm run build
npm run test:unit
npm run test:acceptance
```

---

# Phase 3 - Low-Severity Cleanups

### Task 15: UI type imports + drop redundant state + collapse wrapper

**Files:** Modify `components/AiAssistant.tsx`

- [ ] **Step 1: Import shared types**

```tsx
import type { AssistantMode, ModelRole, RecommendedUpgrade } from "@/lib/ai/modelRouter";
```

Use these instead of re-declared inline unions in `AssistantResponse`.

- [ ] **Step 2: Drop redundant `sessionId` state**

Remove `const [sessionId, setSessionId] = useState<string | null>(null);` and `setSessionId(body.sessionId);`. Use `response?.sessionId ?? null` in the POST body.

- [ ] **Step 3: Collapse the metadata wrapper**

Inline the `<div>{response.routingDecision}</div>` into the outer styled block so it is no longer a redundant child div.

- [ ] **Step 4: Commit**

```powershell
npm run test:unit
npm run lint
git add components/AiAssistant.tsx
git commit -m "refactor(ui): share assistant types, drop redundant state and wrapper"
```

---

### Task 16: Shared passage citation helper

**Files:** Modify `lib/ai/assistant.ts`

- [ ] **Step 1: Extract**

```ts
function passageCitations(corpus: "SBLGNT" | "WEB", refs: Array<{ book: string; chapter: number; verse: number; reference: string }>) {
  return refs.map((r) => ({
    reference: r.reference, corpus,
    searchQuery: "passage", toolName: "getPassage",
    book: r.book, chapter: r.chapter, verse: r.verse
  }));
}
```

Replace both maps with `[...passageCitations("SBLGNT", greek.references), ...passageCitations("WEB", english.references)]`.

- [ ] **Step 2: Commit**

```powershell
git add lib/ai/assistant.ts
git commit -m "refactor(assistant): share passageCitations across corpora"
```

---

### Task 17: Named exports for lemma vocab + push stopwords to SQL

**Files:** Modify `lib/search.ts`, `lib/ai/assistant.ts`

- [ ] **Step 1: Promote constants in `lib/search.ts`**

```ts
export const LEMMA_STOP_WORDS: ReadonlySet<string> = new Set([
  "εἰμί", "πᾶς", "λέγω", "γίνομαι", "ἔχω", "ποιέω"
]);
export const CONTENT_PART_OF_SPEECH = ["N-", "V-", "A-"] as const;
```

- [ ] **Step 2: Push `notIn` to SQL inside `getTopLemmas`**

```ts
where: {
  corpus: { abbreviation: input.corpus ?? "SBLGNT" },
  book: book ? { osisId: book } : undefined,
  lemma: { not: null, notIn: Array.from(LEMMA_STOP_WORDS) },
  partOfSpeech: { in: [...CONTENT_PART_OF_SPEECH] }
}
```

Then change `take: limit + stopLemmas.size + 10` back to `take: limit` and drop the JS filter step.

- [ ] **Step 3: Export `lemmaAliases`**

Change `const lemmaAliases` to `export const lemmaAliases` in `lib/ai/assistant.ts`.

- [ ] **Step 4: Commit**

```powershell
npm run test:unit
git add lib/search.ts lib/ai/assistant.ts
git commit -m "refactor(search): named lemma vocab + push stopwords to SQL"
```

---

### Task 18: Misc cleanups

**Files:** Modify `scripts/acceptance-test.js`, `lib/search.ts`

- [ ] **Step 1: Replace narrative comment**

`scripts/acceptance-test.js` near line 24 should read: `// Wait for Next to start serving; ECONNREFUSED is expected during boot.`

- [ ] **Step 2: Re-indent `where` blocks**

In `searchKeyword`, `searchLemma`, `searchMorphology`, re-indent the `where` literal to 2/4 spaces (currently 6 spaces).

- [ ] **Step 3: Commit**

```powershell
npm run lint
npm run test:unit
git add scripts/acceptance-test.js lib/search.ts
git commit -m "style: indent fix + clearer acceptance comment"
```

---

### Final Milestone Verification

Run the verification block from `MILESTONE_2_5_PLAN.md`:

```powershell
npm run lint
npx tsc --noEmit
npm run build
npm run test:unit
npm run test:acceptance
```

All must pass. Then this plan is complete.

---

## Milestone-Goal Mapping

| Milestone requirement | Tasks |
|---|---|
| Persist exchanges to AiSession / AiMessage | 4, 10 |
| Live model + safe fallback / retry once | 5, 6 |
| Tool trace concise & user-visible | 13 |
| Structured citations survive serialization | 4, 16 |
| Retrieval-first on full corpus | 2, 3, 8 |
| routingDecision + recommendedUpgrade returned, gpt-5.4 never called | preserved across all refactors |
| Focused unit tests (no-key fallback, mocked live, scholarly recommendation, persistence) | 1, 3, 4, 5, 7, 12 |
| Acceptance + lint + tsc + build all pass | Each phase checkpoint |

---

## Self-Review

**Spec coverage:** Every H/M/L finding from the 2026-05-21 review maps to a task. L3/L4 (informational reuse notes) and L17 (URL-driven reader navigation, scheduled for milestone Step 4) are intentionally deferred and called out here. L14 (always-on local retrieval) and L18 (per-row metadata size) are flagged-only with no behavior change required.

**Placeholder scan:** No TBD, no "implement later", no "add appropriate error handling" - every step has concrete code, exact commands, or a concrete diff target.

**Type consistency:** `AssistantAnswer.toolTrace` becomes `ToolTraceEntry[]` in Task 13 only; all earlier tasks treat it as `string[]`. `recordAssistantExchange` (Task 4) is replaced by `startAssistantExchange` + `finishAssistantExchange` (Task 10), and Task 10 explicitly updates Task 4's unit test.

---
