# Read Page Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every finding from the Read-page UI review — first-load stability, perceived performance, reading-experience redesign, accessibility, and copy/polish — and add three requested features (passage reference quick-jump, a continuous reading mode, and notes access from the Read page) without regressing existing behavior.

**Architecture:** The Reader is a Next.js 15 App Router server page ([app/read/page.tsx](../../../app/read/page.tsx)) that fetches a passage and renders a client component ([components/BibleReader.tsx](../../../components/BibleReader.tsx)) plus server-rendered controls. We push client-only preferences (reader mode, layout, last passage, intro dismissal) to cookies so the server renders the correct first paint, make highlighting optimistic to drop the full-passage refetch, and restructure the verse list (masthead, inline verse numbers, per-chapter column headers, on-demand notes). On top of that: a reference quick-jump that reuses the existing reference parser; a continuous (prose) reading layout as a second axis independent of the language toggle; and notes surfaced on the Read page via a passage drawer plus in-popover lists with full edit/delete.

**Tech Stack:** Next.js 15 (App Router, async `cookies()`/`headers()`), React 19, TypeScript, Tailwind CSS, Prisma/Neon, Vitest + @testing-library/react (jsdom), Playwright (manual visual verification).

**Phasing:** Eight phases (A–H). Each is independently shippable and testable; prefer one PR per phase. Execute roughly in order — Phase C stabilizes the verse-list structure, Phase D's focus util is referenced by later polish, and the feature phases depend on earlier ones:
- **A–E** resolve the review findings (as before).
- **F — Reference quick-jump** is independent (depends only on the existing reference parser); can ship any time. It does not use the Phase D focus helper.
- **G — Continuous reading mode** depends on A (cookie pattern), B/C (shared word renderers, verse-number marker, sticky bar), and **D1** (the `FOCUS_RING` constant used by the extracted renderers / toggle). If G ships before D, create `lib/ui/focus.ts` (D1 Step 3) first.
- **H — Notes on the Read page** depends on B (re-introduces `useRouter` for note refresh), C (on-demand note area, sticky bar), **D1** (`FOCUS_RING`/`FOCUS_RING_INPUT` in `NoteList`/drawer), and a `getReaderPassage` shape change. The notes drawer is also what provides notes access inside continuous mode (where per-verse editors are hidden), so if G and H both ship, run G before H or expect a small merge in the sticky bar.

### Branches & PRs (one per phase)

One branch + one PR per phase, cut from an up-to-date `main` (protected: PR required, `gate` check must pass, no direct pushes). Recommended order: A → B → C → D → E → F → G → H. End each PR body with the standard Claude Code attribution; end commits with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

| Phase | Branch | PR title |
|-------|--------|----------|
| A | `feat/read-phase-a-first-load` | `Read: server-render reader prefs to remove first-load flashes (Phase A)` |
| B | `feat/read-phase-b-perf` | `Read: loading skeleton + optimistic highlighting (Phase B)` |
| C | `feat/read-phase-c-reading-experience` | `Read: masthead, inline verse numbers, column headers, on-demand notes (Phase C)` |
| D | `feat/read-phase-d-a11y` | `Read: focus-visible rings, reduced-motion, aria-live, tap targets (Phase D)` |
| E | `feat/read-phase-e-polish` | `Read: empty state, chapter dropdown, contrast, accent target ring (Phase E)` |
| F | `feat/read-phase-f-reference-jump` | `Read: free-text passage reference quick-jump (Phase F)` |
| G | `feat/read-phase-g-continuous` | `Read: continuous reading mode for single-language (Phase G)` |
| H | `feat/read-phase-h-notes` | `Read: notes drawer + in-popover notes with edit/delete (Phase H)` |

---

## File Structure

**New files:**
- `lib/readerPrefs.ts` — cookie names, `ReaderMode` type/union, parse helpers, client cookie writer. Single source of truth for reader preferences (replaces scattered `localStorage` keys).
- `lib/ui/focus.ts` — shared `FOCUS_RING` / `FOCUS_RING_INPUT` class constants so focus styling is consistent and defined once.
- `app/read/loading.tsx` — route-level loading skeleton for `/read`.
- Test files under `tests/unit/components/` and `tests/unit/lib/`.

**Modified files:**
- `app/read/page.tsx` — read pref cookies, server-side bare-URL redirect, masthead hero, sticky reader bar wiring, pass `initialMode`/`introDismissed`.
- `components/BibleReader.tsx` — initialize mode from prop, optimistic highlight state, inline verse numbers, per-chapter column headers, on-demand note form, measure cap, single active popover, aria-live, reduced-motion scroll, accent ring, focus rings.
- `components/ReaderModeToggle.tsx` — import `ReaderMode` from `lib/readerPrefs`, add focus rings.
- `components/MorphologyPopover.tsx` — delegate highlight to a callback (remove internal fetch + `router.refresh`), aria-live, λ glyph decorative, focus rings, contrast fix.
- `components/EnglishWordPopover.tsx` — focus rings (via palette).
- `components/HighlightPalette.tsx` — tap-target hit area.
- `components/ReaderControls.tsx` — chapter dropdown number-only, focus rings.
- `components/ChapterNav.tsx` — focus rings (used by the sticky bar + bottom nav).
- `components/ReaderLocationMemo.tsx` — write last-passage cookie instead of `localStorage`; remove client redirect.
- `components/DismissibleIntro.tsx` — accept `defaultDismissed` prop from server cookie.
- `lib/search.ts` — none required (chapter label change is done in the component to avoid touching shared data).
- `app/globals.css` — `prefers-reduced-motion` block.
- `tests/unit/components/ReaderControls.test.tsx` — update for number-only chapter options (Phase E) and the reference field (Phase F).
- `README.md` / `docs/PROJECT_STATE.md` — update after Phase C (per CLAUDE.md).

**Feature-phase files (F–H):**
- `lib/references.ts` — add `parsePassageQuery()` (Phase F).
- `lib/readerPrefs.ts` — add `ReaderLayout` type + cookie helpers (Phase G).
- `components/ReaderLayoutToggle.tsx` — Study/Continuous toggle (Phase G).
- `components/readerTokens.tsx` — shared `GreekToken` / `EnglishWords` renderers + `ReaderVerse` / `ReaderToken` types, imported by both `BibleReader` and `ContinuousReader` (Phase G; separate module to avoid a circular import).
- `components/ContinuousReader.tsx` — flowing single-language reading view (Phase G).
- `components/NoteList.tsx` — view/edit/delete list of notes, reused by popover + verse area + drawer (Phase H).
- `components/ReaderNotesDrawer.tsx` — passage-scoped notes drawer with jump-to-verse (Phase H).
- `lib/search.ts` — `getReaderPassage()` returns note bodies for tokens + verses (Phase H). **Check `scripts/acceptance-test.js`** for shape assertions.

---

## Phase A — First-load stability (review findings #1)

**Branch:** `feat/read-phase-a-first-load` · **PR:** `Read: server-render reader prefs to remove first-load flashes (Phase A)`

Move reader-mode, last-passage, and intro-dismissal from post-hydration `localStorage` reads to cookies the server reads on first paint, eliminating the parallel-flash, intro-blink, and redirect-refetch sequence.

### Task A1: Reader-mode source of truth in a cookie, server-rendered

**Files:**
- Create: `lib/readerPrefs.ts`
- Create: `tests/unit/lib/readerPrefs.test.ts`
- Modify: `components/ReaderModeToggle.tsx` (import type)
- Modify: `components/BibleReader.tsx` (init from prop, write cookie)
- Modify: `app/read/page.tsx` (read cookie, pass `initialMode`)

- [ ] **Step 1: Write the failing test for the prefs helper**

```ts
// tests/unit/lib/readerPrefs.test.ts
import { describe, expect, it } from "vitest";
import { parseReaderMode, READER_MODE_COOKIE } from "@/lib/readerPrefs";

describe("parseReaderMode", () => {
  it("accepts the three valid modes", () => {
    expect(parseReaderMode("greek")).toBe("greek");
    expect(parseReaderMode("english")).toBe("english");
    expect(parseReaderMode("parallel")).toBe("parallel");
  });
  it("falls back to null for anything else", () => {
    expect(parseReaderMode("klingon")).toBeNull();
    expect(parseReaderMode(null)).toBeNull();
    expect(parseReaderMode(undefined)).toBeNull();
  });
  it("exposes a stable cookie name", () => {
    expect(READER_MODE_COOKIE).toBe("textlab-reader-mode");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/lib/readerPrefs.test.ts`
Expected: FAIL — cannot resolve `@/lib/readerPrefs`.

- [ ] **Step 3: Create the prefs helper**

```ts
// lib/readerPrefs.ts
export type ReaderMode = "greek" | "english" | "parallel";

export const READER_MODES: readonly ReaderMode[] = ["greek", "english", "parallel"];
export const READER_MODE_COOKIE = "textlab-reader-mode";
export const LAST_PASSAGE_COOKIE = "textlab-reader-last-passage";

export function introCookieName(id: string): string {
  return `textlab-intro-dismissed-${id}`;
}

export function parseReaderMode(value: string | null | undefined): ReaderMode | null {
  return value != null && (READER_MODES as readonly string[]).includes(value)
    ? (value as ReaderMode)
    : null;
}

export type SavedPassage = { book: string; chapter: number };

export function parseSavedPassage(value: string | null | undefined): SavedPassage | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SavedPassage>;
    if (typeof parsed?.book === "string" && Number.isInteger(parsed?.chapter)) {
      return { book: parsed.book, chapter: parsed.chapter as number };
    }
  } catch {
    // malformed cookie — ignore
  }
  return null;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Client-only writer for non-httpOnly preference cookies. Server reads via cookies().
export function writePrefCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/lib/readerPrefs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Point ReaderModeToggle at the shared type**

In [components/ReaderModeToggle.tsx](../../../components/ReaderModeToggle.tsx), replace the local type export (lines 1-3):

```tsx
"use client";

import type { ReaderMode } from "@/lib/readerPrefs";

export type { ReaderMode };
```

Leave the `OPTIONS` array and component body unchanged.

- [ ] **Step 6: Initialize BibleReader mode from a prop and write the cookie on change**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx): remove the local `READER_MODE_STORAGE_KEY`, `READER_MODES`, and `isReaderMode` (lines 12-17) and the localStorage `useEffect` (lines 79-82). Update imports and state:

```tsx
import { ReaderModeToggle } from "@/components/ReaderModeToggle";
import { writePrefCookie, READER_MODE_COOKIE, type ReaderMode } from "@/lib/readerPrefs";
```

Change the component signature and mode state:

```tsx
export function BibleReader({
  verses,
  targetVerse,
  initialMode = "parallel"
}: {
  verses: ReaderVerse[];
  targetVerse?: number | null;
  initialMode?: ReaderMode;
}) {
  const router = useRouter();
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedEnglishWord, setSelectedEnglishWord] = useState<string | null>(null);
  const [noteBodies, setNoteBodies] = useState<Record<string, string>>({});
  const [tokenNoteDrafts, setTokenNoteDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<Record<string, boolean>>({});
  const [readerMode, setReaderMode] = useState<ReaderMode>(initialMode);
```

Replace `changeReaderMode` (lines 84-89):

```tsx
  function changeReaderMode(next: ReaderMode) {
    setReaderMode(next);
    writePrefCookie(READER_MODE_COOKIE, next);
  }
```

- [ ] **Step 7: Read the cookie on the server and pass it down**

In [app/read/page.tsx](../../../app/read/page.tsx), add the import and read the cookie:

```tsx
import { cookies } from "next/headers";
import { parseReaderMode, READER_MODE_COOKIE } from "@/lib/readerPrefs";
```

Inside `ReadPage`, after `const params = await searchParams;`:

```tsx
  const cookieStore = await cookies();
  const initialMode = parseReaderMode(cookieStore.get(READER_MODE_COOKIE)?.value) ?? "parallel";
```

Pass it to the reader (replace line 50):

```tsx
      <BibleReader verses={verses} targetVerse={targetVerse} initialMode={initialMode} />
```

- [ ] **Step 8: Verify no parallel-flash via a unit test**

```tsx
// tests/unit/components/BibleReader-initial-mode.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1,
  reference: "John 1:1", greekText: "Ἐν ἀρχῇ", englishText: "In the beginning",
  englishCorpus: "WEB", englishVerseId: "e1", englishHighlights: [], tokens: []
};

describe("BibleReader initial mode", () => {
  it("renders greek-only on first paint when initialMode=greek (no parallel flash)", () => {
    const { queryByText } = render(<BibleReader verses={[verse]} initialMode="greek" />);
    expect(queryByText("SBLGNT")).toBeTruthy();
    expect(queryByText("WEB")).toBeNull(); // English column not rendered
  });
});
```

Run: `npx vitest run tests/unit/components/BibleReader-initial-mode.test.tsx`
Expected: PASS. (After Phase C task C4 this assertion moves to the column header — update the test then.)

- [ ] **Step 9: Commit**

```bash
git add lib/readerPrefs.ts tests/unit/lib/readerPrefs.test.ts components/ReaderModeToggle.tsx components/BibleReader.tsx app/read/page.tsx tests/unit/components/BibleReader-initial-mode.test.tsx
git commit -m "feat(read): server-render reader mode from cookie to kill first-paint flash"
```

### Task A2: Last-passage cookie + server-side bare-URL redirect

**Files:**
- Modify: `components/ReaderLocationMemo.tsx`
- Modify: `app/read/page.tsx`
- Create: `tests/unit/components/ReaderLocationMemo.test.tsx`

- [ ] **Step 1: Write the failing test for the cookie writer**

```tsx
// tests/unit/components/ReaderLocationMemo.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { ReaderLocationMemo } from "@/components/ReaderLocationMemo";

beforeEach(() => {
  document.cookie = "textlab-reader-last-passage=; max-age=0; path=/";
});

describe("ReaderLocationMemo", () => {
  it("writes the current passage to the last-passage cookie", () => {
    render(<ReaderLocationMemo book="Rom" chapter={5} />);
    expect(decodeURIComponent(document.cookie)).toContain('textlab-reader-last-passage={"book":"Rom","chapter":5}');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/ReaderLocationMemo.test.tsx`
Expected: FAIL — component still writes `localStorage`, cookie absent.

- [ ] **Step 3: Rewrite ReaderLocationMemo to write the cookie and drop the client redirect**

Replace the entire body of [components/ReaderLocationMemo.tsx](../../../components/ReaderLocationMemo.tsx):

```tsx
"use client";

import { useEffect } from "react";
import { LAST_PASSAGE_COOKIE, writePrefCookie } from "@/lib/readerPrefs";

// Persists the current passage so the server can restore it on a bare /read
// visit (the redirect now happens server-side in app/read/page.tsx, before
// paint — no client flash). This component only writes; it never navigates.
export function ReaderLocationMemo({ book, chapter }: { book: string; chapter: number }) {
  useEffect(() => {
    writePrefCookie(LAST_PASSAGE_COOKIE, JSON.stringify({ book, chapter }));
  }, [book, chapter]);

  return null;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/components/ReaderLocationMemo.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the server-side bare-URL redirect**

In [app/read/page.tsx](../../../app/read/page.tsx), add imports:

```tsx
import { redirect } from "next/navigation";
import { parseSavedPassage, LAST_PASSAGE_COOKIE } from "@/lib/readerPrefs";
```

Inside `ReadPage`, after reading `cookieStore` (Task A1 step 7) and before the `getParam(params.book)` line, detect a bare URL and redirect:

```tsx
  const isBareUrl =
    params.book === undefined && params.chapter === undefined && params.verse === undefined;
  if (isBareUrl) {
    const saved = parseSavedPassage(cookieStore.get(LAST_PASSAGE_COOKIE)?.value);
    if (saved) {
      redirect(`/read?book=${encodeURIComponent(saved.book)}&chapter=${saved.chapter}`);
    }
  }
```

(`ReaderLocationMemo` is still rendered in the returned JSX — leave line 34 as-is. It now only writes the cookie.)

- [ ] **Step 6: Commit**

```bash
git add components/ReaderLocationMemo.tsx app/read/page.tsx tests/unit/components/ReaderLocationMemo.test.tsx
git commit -m "feat(read): restore last passage via server redirect, not client refetch"
```

### Task A3: Intro dismissal server-rendered

**Files:**
- Modify: `components/DismissibleIntro.tsx`
- Modify: `app/read/page.tsx`
- Create: `tests/unit/components/DismissibleIntro.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/DismissibleIntro.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DismissibleIntro } from "@/components/DismissibleIntro";

describe("DismissibleIntro", () => {
  it("renders nothing on first paint when defaultDismissed is true", () => {
    const { container } = render(
      <DismissibleIntro id="read" defaultDismissed>hello</DismissibleIntro>
    );
    expect(container.firstChild).toBeNull();
  });
  it("renders the intro when not dismissed", () => {
    const { getByText } = render(<DismissibleIntro id="read">hello</DismissibleIntro>);
    expect(getByText("hello")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/DismissibleIntro.test.tsx`
Expected: FAIL — `defaultDismissed` prop not supported; component starts visible then hides post-effect.

- [ ] **Step 3: Add the `defaultDismissed` prop and cookie persistence**

In [components/DismissibleIntro.tsx](../../../components/DismissibleIntro.tsx), update the imports and signature:

```tsx
"use client";

import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { introCookieName, writePrefCookie } from "@/lib/readerPrefs";

export function DismissibleIntro({
  id,
  defaultDismissed = false,
  children
}: {
  id: string;
  defaultDismissed?: boolean;
  children: ReactNode;
}) {
  const [dismissed, setDismissed] = useState(defaultDismissed);

  if (dismissed) return null;

  function dismiss() {
    writePrefCookie(introCookieName(id), "1");
    setDismissed(true);
  }

  return (
    <div className="mt-2 flex max-w-2xl items-start gap-3">
      <p className="text-slate-600">{children}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss this description"
        className="mt-0.5 text-slate-500 hover:text-slate-700"
      >
        <X size={16} />
      </button>
    </div>
  );
}
```

(Note: the close-icon color is bumped from `text-slate-400` to `text-slate-500` — this also resolves the contrast item in Task E4 for this control.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/components/DismissibleIntro.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Pass the server-read dismissal flag**

In [app/read/page.tsx](../../../app/read/page.tsx), add the import and compute the flag:

```tsx
import { introCookieName } from "@/lib/readerPrefs";
```

After `initialMode`:

```tsx
  const introDismissed = cookieStore.get(introCookieName("read"))?.value === "1";
```

Update the `DismissibleIntro` usage (lines 41-43):

```tsx
          <DismissibleIntro id="read" defaultDismissed={introDismissed}>
            Read the Greek New Testament beside English, and click any Greek word for its morphology.
          </DismissibleIntro>
```

- [ ] **Step 6: Commit**

```bash
git add components/DismissibleIntro.tsx app/read/page.tsx tests/unit/components/DismissibleIntro.test.tsx
git commit -m "feat(read): server-render intro dismissal to remove blink-on-load"
```

---

## Phase B — Perceived performance (review findings #2, #10)

**Branch:** `feat/read-phase-b-perf` · **PR:** `Read: loading skeleton + optimistic highlighting (Phase B)`

### Task B1: Route-level loading skeleton for `/read`

**Files:**
- Create: `app/read/loading.tsx`

- [ ] **Step 1: Create the skeleton**

```tsx
// app/read/loading.tsx
export default function ReadLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading passage">
      <div className="animate-pulse space-y-3">
        <div className="h-3 w-40 rounded bg-stone-200" />
        <div className="h-10 w-48 rounded bg-stone-200" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse border-l-2 border-stone-200 pl-6">
          <div className="mb-3 h-4 w-16 rounded bg-stone-200" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="h-5 w-full rounded bg-stone-100" />
              <div className="h-5 w-5/6 rounded bg-stone-100" />
            </div>
            <div className="space-y-2">
              <div className="h-5 w-full rounded bg-stone-100" />
              <div className="h-5 w-4/6 rounded bg-stone-100" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify it renders (manual, via the run skill)**

Start the dev server (`npm run dev`), then with a Playwright script (see the `run` skill / `examples/playwright.md`) throttle navigation and confirm the skeleton paints on chapter change. Expected: pulsing placeholders appear during the server round-trip rather than a frozen page.

- [ ] **Step 3: Commit**

```bash
git add app/read/loading.tsx
git commit -m "feat(read): add loading skeleton for passage navigation"
```

### Task B2: Optimistic highlighting (Greek + English), remove full-passage refetch

**Files:**
- Modify: `components/BibleReader.tsx`
- Modify: `components/MorphologyPopover.tsx`
- Create: `tests/unit/components/BibleReader-highlight.test.tsx`

- [ ] **Step 1: Write the failing test for optimistic Greek highlight**

```tsx
// tests/unit/components/BibleReader-highlight.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { BibleReader } from "@/components/BibleReader";

const token = {
  id: "t1", book: "John", chapter: 1, verse: 1, wordIndex: 0,
  surface: "Ἐν", normalized: "εν", lemma: "ἐν", morphCode: "P", partOfSpeech: "P-",
  gloss: "in", domains: [], noteCount: 0, highlightColor: null
};
const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: [token]
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true })));
});
afterEach(() => vi.unstubAllGlobals());

describe("BibleReader optimistic highlight", () => {
  it("colors the token immediately when Highlight is applied (no refetch needed)", async () => {
    const { getByRole } = render(<BibleReader verses={[verse]} initialMode="greek" />);
    fireEvent.click(getByRole("button", { name: "Ἐν" }));          // open popover
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));  // apply default color
    const tokenBtn = getByRole("button", { name: "Ἐν" });
    expect(tokenBtn.getAttribute("style")).toMatch(/background-color/);
  });

  it("reverts and shows an error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false })));
    const { getByRole, findByText } = render(<BibleReader verses={[verse]} initialMode="greek" />);
    fireEvent.click(getByRole("button", { name: "Ἐν" }));
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));
    expect(await findByText(/could not save highlight/i)).toBeTruthy();
    expect(getByRole("button", { name: "Ἐν" }).getAttribute("style") ?? "").not.toMatch(/background-color/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/BibleReader-highlight.test.tsx`
Expected: FAIL — `MorphologyPopover` currently owns the fetch and the token color comes only from props/`router.refresh`, so no immediate style and no verse-level error.

- [ ] **Step 3: Add optimistic override state and lifted highlight handlers in BibleReader**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx), add state alongside the existing hooks:

```tsx
  const [tokenColorOverride, setTokenColorOverride] = useState<Record<string, string | null>>({});
  const [englishColorOverride, setEnglishColorOverride] = useState<Record<string, string | null>>({});
```

Add a Greek highlight handler (place near `highlightEnglishWord`):

```tsx
  async function highlightToken(token: ReaderToken, color: string | null) {
    const prev = tokenColorOverride[token.id] ?? token.highlightColor;
    setTokenColorOverride((current) => ({ ...current, [token.id]: color }));
    try {
      const response =
        color === null
          ? await fetch("/api/highlights", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tokenId: token.id })
            })
          : await fetch("/api/highlights", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tokenId: token.id, color })
            });
      if (!response.ok) {
        setTokenColorOverride((current) => ({ ...current, [token.id]: prev }));
        setVerseStatus(token.verse === verse_unused(token) ? "" : "", ""); // placeholder removed in step 4
      }
    } catch {
      setTokenColorOverride((current) => ({ ...current, [token.id]: prev }));
    }
  }
```

> Note: the placeholder line is corrected in Step 4 — `highlightToken` needs the owning verse to set status. Implement it as shown in Step 4, which threads the verse through.

- [ ] **Step 4: Finalize highlightToken with verse-scoped status and update the English handler**

Replace the Step 3 sketch with the verse-aware version (the token render loop already has `verse` in scope, so pass it in):

```tsx
  async function highlightToken(verse: ReaderVerse, token: ReaderToken, color: string | null) {
    const prev = tokenColorOverride[token.id] ?? token.highlightColor;
    setTokenColorOverride((current) => ({ ...current, [token.id]: color }));
    try {
      const response =
        color === null
          ? await fetch("/api/highlights", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tokenId: token.id })
            })
          : await fetch("/api/highlights", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tokenId: token.id, color })
            });
      if (!response.ok) {
        setTokenColorOverride((current) => ({ ...current, [token.id]: prev }));
        setVerseStatus(verse.id, "Could not save highlight.");
      }
    } catch {
      setTokenColorOverride((current) => ({ ...current, [token.id]: prev }));
      setVerseStatus(verse.id, "Network error. Try again.");
    }
  }
```

Rewrite `highlightEnglishWord` (lines 131-163) to be optimistic and drop `router.refresh`:

```tsx
  async function highlightEnglishWord(verse: ReaderVerse, wordIndex: number, color: string | null) {
    if (!verse.englishVerseId) return;
    const key = `${verse.id}-${wordIndex}`;
    const prev =
      key in englishColorOverride
        ? englishColorOverride[key]
        : verse.englishHighlights.find((h) => h.wordIndex === wordIndex)?.color ?? null;
    setEnglishColorOverride((current) => ({ ...current, [key]: color }));
    try {
      const response =
        color === null
          ? await fetch("/api/highlights", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ verseId: verse.englishVerseId, englishWordIndex: wordIndex })
            })
          : await fetch("/api/highlights", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ verseId: verse.englishVerseId, englishWordIndex: wordIndex, color })
            });
      if (!response.ok) {
        setEnglishColorOverride((current) => ({ ...current, [key]: prev }));
        setVerseStatus(verse.id, "Could not save highlight.");
      }
    } catch {
      setEnglishColorOverride((current) => ({ ...current, [key]: prev }));
      setVerseStatus(verse.id, "Network error. Try again.");
    }
  }
```

`router` is now used only by — nothing; remove the `const router = useRouter();` line and the `useRouter` import if no other usage remains. (Verify: after this change `router` has no references in BibleReader.)

- [ ] **Step 5: Apply the override when rendering token color and pass the handler to the popover**

In the Greek token render (around lines 199-218), compute the effective color and use it:

```tsx
                    ? verse.tokens.map((token) => {
                        const tokenColor =
                          token.id in tokenColorOverride
                            ? tokenColorOverride[token.id]
                            : token.highlightColor;
                        return (
                        <Fragment key={token.id}>
                          <span className="relative inline-block">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedEnglishWord(null);
                                setSelectedTokenId(selectedTokenId === token.id ? null : token.id);
                              }}
                              style={tokenColor ? { backgroundColor: tokenColor } : undefined}
                              className="mx-0.5 rounded px-1 py-0.5 transition-colors hover:bg-accent-50"
                            >
                              {token.surface}
                            </button>
                            {selectedTokenId === token.id ? (
                              <MorphologyPopover
                                token={token}
                                reference={verse.reference}
                                body={tokenNoteDrafts[token.id] ?? ""}
                                onBodyChange={(next) => setTokenDraft(token.id, next)}
                                onHighlight={(color) => highlightToken(verse, token, color)}
                                onClose={() => setSelectedTokenId(null)}
                              />
                            ) : null}
                          </span>{" "}
                        </Fragment>
                        );
                      })
```

(The `setSelectedEnglishWord(null)` here also delivers review polish "single active popover" — Task E6 covers the English side symmetrically.)

- [ ] **Step 6: Apply the override in the English column**

Pass override resolution into `EnglishVerseText`. Update its props and call site so the effective color prefers the override. In the `EnglishVerseText` render call (around line 231) add:

```tsx
                <EnglishVerseText
                  verse={verse}
                  selectedKey={selectedEnglishWord}
                  overrides={englishColorOverride}
                  onSelect={setSelectedEnglishWord}
                  onPick={(wordIndex, color) => highlightEnglishWord(verse, wordIndex, color)}
                  onClear={(wordIndex) => highlightEnglishWord(verse, wordIndex, null)}
                />
```

In `EnglishVerseText` (lines 272-329), add `overrides` to the props type and use it when resolving `color`:

```tsx
function EnglishVerseText({
  verse,
  selectedKey,
  overrides,
  onSelect,
  onPick,
  onClear
}: {
  verse: ReaderVerse;
  selectedKey: string | null;
  overrides: Record<string, string | null>;
  onSelect: (key: string | null) => void;
  onPick: (wordIndex: number, color: string) => void;
  onClear: (wordIndex: number) => void;
}) {
```

Replace the per-word color resolution (line 303):

```tsx
        const key = `${verse.id}-${token.wordIndex}`;
        const color = key in overrides ? overrides[key] : highlightByWord.get(token.wordIndex) ?? null;
```

- [ ] **Step 7: Convert MorphologyPopover highlighting to a callback**

In [components/MorphologyPopover.tsx](../../../components/MorphologyPopover.tsx): add `onHighlight` to props, delete the internal `highlightToken` function (lines 118-147) and the `router`/`router.refresh` usage for highlights. Keep note saving and its `saving` state.

Props change:

```tsx
export function MorphologyPopover({
  token,
  reference,
  body,
  onBodyChange,
  onHighlight,
  onClose
}: {
  token: ReaderToken;
  reference: string;
  body: string;
  onBodyChange: (next: string) => void;
  onHighlight: (color: string | null) => void;
  onClose: () => void;
}) {
```

Replace the HighlightMenu usage (line 220):

```tsx
        <HighlightMenu label="Highlight" onPick={onHighlight} />
```

Remove `useRouter`/`router` if no longer used (note save does not use it). Confirm no remaining `router.` references; remove the import.

- [ ] **Step 8: Run the highlight tests**

Run: `npx vitest run tests/unit/components/BibleReader-highlight.test.tsx`
Expected: PASS (2 tests). Then run the full suite to catch fallout: `npm run test:unit`. Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add components/BibleReader.tsx components/MorphologyPopover.tsx tests/unit/components/BibleReader-highlight.test.tsx
git commit -m "feat(read): optimistic highlighting; drop full-passage refetch and dual feedback"
```

---

## Phase C — Reading-experience redesign (review findings #3, #4, #5, #6, #11, mode-toggle/ChapterNav polish)

**Branch:** `feat/read-phase-c-reading-experience` · **PR:** `Read: masthead, inline verse numbers, column headers, on-demand notes (Phase C)`

> Design direction (approved in review): the masthead is the passage, not the word "Reader"; verse references become inline numbers; corpus labels move to one per-chapter header; the mode toggle and current-location indicator live in a slim sticky bar.

### Task C1: Chapter masthead hero

**Files:**
- Modify: `app/read/page.tsx`
- Create: `tests/unit/components/ReadMasthead.test.tsx` (optional render check via the page is heavy; test the small presentational piece instead)
- Create: `components/ReaderMasthead.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/ReadMasthead.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ReaderMasthead } from "@/components/ReaderMasthead";

describe("ReaderMasthead", () => {
  it("shows the book name and chapter as the single page heading", () => {
    const { getByRole } = render(<ReaderMasthead bookLabel="John" chapter={1} />);
    const h1 = getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("John");
    expect(h1.textContent).toContain("1");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/ReadMasthead.test.tsx`
Expected: FAIL — `@/components/ReaderMasthead` does not exist.

- [ ] **Step 3: Create the masthead**

```tsx
// components/ReaderMasthead.tsx
export function ReaderMasthead({ bookLabel, chapter }: { bookLabel: string; chapter: number }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-accent-700">
        SBLGNT · Greek New Testament
      </p>
      <h1 className="flex items-baseline gap-3 font-display tracking-tight text-slate-950">
        <span className="text-4xl font-semibold">{bookLabel}</span>
        <span className="oldstyle-nums text-5xl font-normal leading-none text-accent-700">{chapter}</span>
      </h1>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/components/ReadMasthead.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it into the page**

In [app/read/page.tsx](../../../app/read/page.tsx), add imports:

```tsx
import { ReaderMasthead } from "@/components/ReaderMasthead";
import { bookName } from "@/lib/references";
```

Replace the eyebrow + `<h1>Reader</h1>` (lines 37-40) inside the `<div>` with:

```tsx
          <ReaderMasthead bookLabel={bookName(book)} chapter={chapter} />
```

Leave the `DismissibleIntro` directly below it.

- [ ] **Step 6: Commit**

```bash
git add components/ReaderMasthead.tsx tests/unit/components/ReadMasthead.test.tsx app/read/page.tsx
git commit -m "feat(read): replace generic 'Reader' title with passage masthead"
```

### Task C2: Slim sticky reader bar (location + mode toggle); remove redundant top ChapterNav

**Files:**
- Modify: `app/read/page.tsx`
- Modify: `components/BibleReader.tsx`

- [ ] **Step 1: Add a sticky bar inside BibleReader carrying location + mode toggle**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx), add a `chapterLabel` prop:

```tsx
export function BibleReader({
  verses,
  targetVerse,
  initialMode = "parallel",
  chapterLabel
}: {
  verses: ReaderVerse[];
  targetVerse?: number | null;
  initialMode?: ReaderMode;
  chapterLabel: string;
}) {
```

Replace the standalone mode-toggle row (lines 178-181) with a sticky bar:

```tsx
  return (
    <div className="space-y-8">
      <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b border-stone-200 bg-[var(--background)]/90 px-4 py-2 backdrop-blur">
        <span className="font-display text-sm font-semibold text-slate-700">{chapterLabel}</span>
        <ReaderModeToggle mode={readerMode} onChange={changeReaderMode} />
      </div>
```

- [ ] **Step 2: Pass `chapterLabel` and remove the top ChapterNav**

In [app/read/page.tsx](../../../app/read/page.tsx), update the reader usage and delete the first `<ChapterNav>` (line 48), keeping the one after the reader (line 52):

```tsx
      <BibleReader
        verses={verses}
        targetVerse={targetVerse}
        initialMode={initialMode}
        chapterLabel={`${bookName(book)} ${chapter}`}
      />

      <ChapterNav prev={neighbors.prev} next={neighbors.next} />
```

- [ ] **Step 3: Verify (manual, run skill)**

Start dev server, scroll the chapter, confirm the bar stays pinned showing "John 1" + the toggle, and only one prev/next nav remains (below the verses). Respect for `prefers-reduced-motion` is unaffected (no animation here).

- [ ] **Step 4: Commit**

```bash
git add app/read/page.tsx components/BibleReader.tsx
git commit -m "feat(read): sticky reader bar for wayfinding; remove duplicate chapter nav"
```

### Task C3: Inline verse numbers (remove per-verse `<h2>`)

**Files:**
- Modify: `components/BibleReader.tsx`
- Create: `tests/unit/components/BibleReader-verse-numbers.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/BibleReader-verse-numbers.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 3, reference: "John 1:3",
  greekText: "πάντα", englishText: "All things", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: []
};

describe("BibleReader verse numbering", () => {
  it("renders no per-verse h2 and labels the article with the reference", () => {
    const { container } = render(
      <BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" />
    );
    expect(container.querySelectorAll("h2").length).toBe(0);
    const article = container.querySelector("article");
    expect(article?.getAttribute("aria-label")).toBe("John 1:3");
    expect(article?.textContent).toContain("3"); // inline verse number visible
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/BibleReader-verse-numbers.test.tsx`
Expected: FAIL — current code renders an `<h2>` and no `aria-label`.

- [ ] **Step 3: Replace the h2 with an inline verse number + article label**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx), update the `<article>` opening (lines 184-191): add `aria-label`, and replace the `<h2>` reference with an inline number marker rendered at the start of each text column.

Article tag:

```tsx
        <article
          key={verse.id}
          id={`verse-${verse.verse}`}
          aria-label={verse.reference}
          className={`scroll-mt-24 border-l-2 border-accent-200 pl-6 ${
            targetVerse === verse.verse ? "rounded-sm ring-2 ring-accent-400 ring-offset-4 ring-offset-[var(--background)]" : ""
          }`}
        >
```

Delete the `<h2>…</h2>` line (191). In the Greek column, prefix the text with the verse number (inside the `.greek-text` div, before the tokens map):

```tsx
                <div className="greek-text text-[1.45rem] leading-10 text-slate-950">
                  <span className="oldstyle-nums mr-2 align-super text-sm font-semibold text-slate-500" aria-hidden>
                    {verse.verse}
                  </span>
                  {verse.tokens.length > 0
```

And in the English column, prefix similarly inside `EnglishVerseText`'s container. Add the same marker just inside the returned `<div className="text-xl leading-10 …">` in both the `!verse.englishVerseId` branch and the token branch:

```tsx
      <span className="oldstyle-nums mr-2 align-super text-sm font-semibold text-slate-500" aria-hidden>
        {verse.verse}
      </span>
```

(The `ring-amber-300 → ring-accent-400` change in the article also delivers Task E3.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/components/BibleReader-verse-numbers.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/BibleReader.tsx tests/unit/components/BibleReader-verse-numbers.test.tsx
git commit -m "feat(read): inline verse numbers; one heading per chapter; accent target ring"
```

### Task C4: Per-chapter column headers (remove per-verse corpus labels)

**Files:**
- Modify: `components/BibleReader.tsx`
- Create: `tests/unit/components/BibleReader-column-headers.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/BibleReader-column-headers.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BibleReader } from "@/components/BibleReader";

const mk = (n: number) => ({
  id: `v${n}`, book: "John", bookName: "John", chapter: 1, verse: n, reference: `John 1:${n}`,
  greekText: "x", englishText: "y", englishCorpus: "WEB", englishVerseId: `e${n}`,
  englishHighlights: [], tokens: []
});

describe("BibleReader column headers", () => {
  it("shows the corpus label once, not once per verse", () => {
    const { getAllByText } = render(
      <BibleReader verses={[mk(1), mk(2), mk(3)]} initialMode="parallel" chapterLabel="John 1" />
    );
    expect(getAllByText("SBLGNT").length).toBe(1);
    expect(getAllByText("WEB").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/BibleReader-column-headers.test.tsx`
Expected: FAIL — currently one label per verse (3 each).

- [ ] **Step 3: Hoist the labels to a single header row and delete the per-verse labels**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx): remove the per-verse label `<div>`s (the `SBLGNT` div at line 196 and the `{verse.englishCorpus}` div at lines 228-230). Add one header row above the `verses.map(...)` (just after the sticky bar), using the first verse for the corpus name:

```tsx
      <div className={`grid gap-4 px-6 ${showBothColumns ? "md:grid-cols-2" : ""}`}>
        {showGreek ? (
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">SBLGNT</div>
        ) : null}
        {showEnglish ? (
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {verses[0]?.englishCorpus ?? "WEB"}
          </div>
        ) : null}
      </div>
```

(`text-slate-500 → text-slate-600` also satisfies the contrast item in Task E4 for these labels.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/components/BibleReader-column-headers.test.tsx`
Expected: PASS. Also update `tests/unit/components/BibleReader-initial-mode.test.tsx` from Task A1 (the `WEB`/`SBLGNT` assertions now refer to the header) — re-run `npx vitest run tests/unit/components/BibleReader-initial-mode.test.tsx` and adjust if needed.

- [ ] **Step 5: Commit**

```bash
git add components/BibleReader.tsx tests/unit/components/BibleReader-column-headers.test.tsx tests/unit/components/BibleReader-initial-mode.test.tsx
git commit -m "feat(read): one corpus header per chapter instead of per verse"
```

### Task C5: Cap reading measure in single-column modes

**Files:**
- Modify: `components/BibleReader.tsx`

- [ ] **Step 1: Add a measure cap when not showing both columns**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx), the verse grid wrapper (line 193) becomes measure-capped in single-column mode. Change:

```tsx
          <div className={`grid gap-4 ${showBothColumns ? "md:grid-cols-2" : "max-w-[68ch]"}`}>
```

Apply the same `max-w-[68ch]` to the column-header row from Task C4 so the header aligns with the text in single-column mode:

```tsx
      <div className={`grid gap-4 px-6 ${showBothColumns ? "md:grid-cols-2" : "max-w-[68ch]"}`}>
```

- [ ] **Step 2: Verify (manual, run skill)**

Switch to Greek-only and English-only modes; confirm lines no longer span the full `max-w-6xl` width. Expected: comfortable ~66–75 char measure.

- [ ] **Step 3: Commit**

```bash
git add components/BibleReader.tsx
git commit -m "feat(read): cap reading measure in single-column modes"
```

### Task C6: On-demand note affordance (and `<input>` → `<textarea>`)

**Files:**
- Modify: `components/BibleReader.tsx`
- Create: `tests/unit/components/BibleReader-note.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/BibleReader-note.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: []
};

describe("BibleReader note affordance", () => {
  it("hides the note editor until the note button is pressed", () => {
    const { queryByPlaceholderText, getByRole } = render(
      <BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" />
    );
    expect(queryByPlaceholderText(/write a note/i)).toBeNull();
    fireEvent.click(getByRole("button", { name: /note on john 1:1/i }));
    expect(queryByPlaceholderText(/write a note/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/BibleReader-note.test.tsx`
Expected: FAIL — the note form is always visible.

- [ ] **Step 3: Add per-verse open state and a reveal toggle**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx), add state:

```tsx
  const [openNote, setOpenNote] = useState<Record<string, boolean>>({});
```

Replace the note `<form>` block (lines 242-265) with a toggle button + conditionally-rendered `<textarea>` editor:

```tsx
          <div className="mt-4 border-t border-stone-200 pt-4">
            <button
              type="button"
              onClick={() => setOpenNote((c) => ({ ...c, [verse.id]: !c[verse.id] }))}
              aria-expanded={!!openNote[verse.id]}
              className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-accent-800"
            >
              <NotebookPen size={16} />
              Note on {verse.reference}
            </button>
            {openNote[verse.id] ? (
              <form onSubmit={(event) => addVerseNote(event, verse)} className="mt-3 flex flex-col gap-2">
                <textarea
                  value={noteBodies[verse.id] ?? ""}
                  onChange={(event) =>
                    setNoteBodies((current) => ({ ...current, [verse.id]: event.target.value }))
                  }
                  className="min-h-20 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600"
                  placeholder="Write a note"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingNote[verse.id] || !(noteBodies[verse.id] ?? "").trim()}
                    className="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save note
                  </button>
                </div>
                {status[verse.id] ? (
                  <p role="status" aria-live="polite" className="text-sm text-slate-600">{status[verse.id]}</p>
                ) : null}
              </form>
            ) : null}
          </div>
```

(This also delivers the aria-live status region for verse notes — part of Task D3 — and the `<input>`→`<textarea>` consistency fix.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/components/BibleReader-note.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/BibleReader.tsx tests/unit/components/BibleReader-note.test.tsx
git commit -m "feat(read): reveal note editor on demand; use textarea; announce status"
```

### Task C7: Update docs after the redesign (per CLAUDE.md)

**Files:**
- Modify: `README.md`
- Modify: `docs/PROJECT_STATE.md`

- [ ] **Step 1: Replace the README Reader bullets**

In [README.md](../../../README.md) under "Product Surface", replace the three Reader sub-bullets (currently lines 12–14: "Parallel SBLGNT…", "Greek token popovers…", "English word highlighting…") with:

```markdown
  - Greek / English / Parallel display modes, persisted per reader via cookie and rendered server-side (no first-paint flash). A chapter masthead and a sticky bar keep your location visible while scrolling.
  - Verses use inline verse numbers; the corpus label (SBLGNT / WEB) appears once per chapter as a column header. Single-language modes cap the reading measure for legibility.
  - Greek token popovers with lemma, morphology, gloss, and Louw-Nida domain/subdomain labels when present.
  - English word and Greek token highlighting apply optimistically (no full-page reload). Per-verse notes open on demand.
  - Verse and chapter navigation, plus last-passage restore (applied server-side on a bare `/read` visit).
```

- [ ] **Step 2: Add a dated PROJECT_STATE entry**

In [docs/PROJECT_STATE.md](../../../docs/PROJECT_STATE.md), add a new subsection after the most recent one (keep the existing "Snapshot" line format and dated-section style):

```markdown
### Read page improvements (2026-06)

Review-driven pass over `/read` (plan: `docs/superpowers/plans/2026-06-17-read-page-improvements.md`).

- **First-load stability** — reader mode, last passage, and intro dismissal moved from post-hydration `localStorage` reads to cookies the server reads on first paint, eliminating the parallel-flash / intro-blink / redirect-refetch sequence.
- **Perceived performance** — route-level `app/read/loading.tsx` skeleton; highlighting is optimistic (removed the per-toggle full-passage `router.refresh`), unifying the Greek and English feedback paths.
- **Reading experience** — passage masthead replaces the generic "Reader" title; sticky wayfinding bar; inline verse numbers (one heading per chapter); per-chapter corpus headers; capped reading measure in single-column modes; on-demand note editor.
- **Accessibility** — shared `focus-visible` rings (`lib/ui/focus.ts`), `prefers-reduced-motion` honored, aria-live status regions, larger tap targets.
- **Copy / polish** — user-facing empty state, number-only chapter dropdown, accent (not amber) target ring, raised contrast on low-contrast text.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/PROJECT_STATE.md
git commit -m "docs: reflect Read page redesign (Phases A–E)"
```

---

## Phase D — Accessibility (review finding #8, tap targets)

**Branch:** `feat/read-phase-d-a11y` · **PR:** `Read: focus-visible rings, reduced-motion, aria-live, tap targets (Phase D)`

### Task D1: Consistent `focus-visible` rings

**Files:**
- Create: `lib/ui/focus.ts`
- Create: `tests/unit/lib/focus.test.ts`
- Modify: `components/BibleReader.tsx`, `components/ReaderModeToggle.tsx`, `components/ChapterNav.tsx`, `components/ReaderControls.tsx`

- [ ] **Step 1: Write the failing test for the focus constant**

```ts
// tests/unit/lib/focus.test.ts
import { describe, expect, it } from "vitest";
import { FOCUS_RING, FOCUS_RING_INPUT } from "@/lib/ui/focus";

describe("focus ring tokens", () => {
  it("uses focus-visible and an accent ring", () => {
    expect(FOCUS_RING).toContain("focus-visible:ring-2");
    expect(FOCUS_RING).toContain("focus-visible:ring-accent-400");
    expect(FOCUS_RING).toContain("focus:outline-none");
  });
  it("keeps a ring for inputs too", () => {
    expect(FOCUS_RING_INPUT).toContain("focus-visible:ring-2");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/lib/focus.test.ts`
Expected: FAIL — `@/lib/ui/focus` missing.

- [ ] **Step 3: Create the focus constants**

```ts
// lib/ui/focus.ts
// Shared keyboard-focus styling so every interactive control gets the same
// visible ring. Defined once; Tailwind scans lib/** so these classes ship.
export const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

export const FOCUS_RING_INPUT =
  "focus:outline-none focus:border-accent-600 focus-visible:ring-2 focus-visible:ring-accent-400";
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/lib/focus.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply FOCUS_RING to reader controls**

Import in each file: `import { FOCUS_RING, FOCUS_RING_INPUT } from "@/lib/ui/focus";`

- BibleReader Greek token button className: append `` ${FOCUS_RING}`` — e.g. ``className={`mx-0.5 rounded px-1 py-0.5 transition-colors hover:bg-accent-50 ${FOCUS_RING}`}``.
- BibleReader English word button (`EnglishVerseText`, line 311): ``className={`rounded px-1 py-0.5 transition-colors hover:bg-accent-50 ${FOCUS_RING}`}`` (the `px-1` also enlarges the tap target — Task D4).
- BibleReader note textarea/save button and the note toggle: append `` ${FOCUS_RING}`` (textarea uses `FOCUS_RING_INPUT`).
- ReaderModeToggle buttons (line 33): append `` ${FOCUS_RING}``.
- ChapterNav `baseClass` (line 39-40): append `` ${FOCUS_RING}``.
- ReaderControls selects (lines 44, 51), verse input (line 65) use `FOCUS_RING_INPUT`; the Open button (line 67) uses `FOCUS_RING`.

- [ ] **Step 6: Verify keyboard focus (manual, run skill — re-run the earlier Tab-through)**

Start dev server, Tab through `/read`, and confirm each control (selects, Open, mode toggle, tokens, note controls, chapter nav) now shows the accent ring on keyboard focus (`focus-visible`), and that inputs show a ring rather than only a 1px border. Expected computed style on a focused token: a visible `box-shadow` ring (not `outline: auto`).

- [ ] **Step 7: Commit**

```bash
git add lib/ui/focus.ts tests/unit/lib/focus.test.ts components/BibleReader.tsx components/ReaderModeToggle.tsx components/ChapterNav.tsx components/ReaderControls.tsx
git commit -m "feat(a11y): consistent focus-visible rings across reader controls"
```

### Task D2: Respect `prefers-reduced-motion`

**Files:**
- Modify: `app/globals.css`
- Modify: `components/BibleReader.tsx`
- Create: `tests/unit/components/BibleReader-reduced-motion.test.tsx`

- [ ] **Step 1: Write the failing test for the scroll behavior**

```tsx
// tests/unit/components/BibleReader-reduced-motion.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: []
};

describe("BibleReader reduced motion", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}
    }));
  });

  it("scrolls without smooth behavior when reduced motion is preferred", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" targetVerse={1} />);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/BibleReader-reduced-motion.test.tsx`
Expected: FAIL — current scroll hardcodes `behavior: "smooth"`.

- [ ] **Step 3: Guard the scroll effect**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx), update the target-verse effect (lines 73-77):

```tsx
  useEffect(() => {
    if (!targetVerse) return;
    const node = document.getElementById(`verse-${targetVerse}`);
    if (!node) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [targetVerse]);
```

- [ ] **Step 4: Add the CSS guard**

Append to [app/globals.css](../../../app/globals.css):

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/components/BibleReader-reduced-motion.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css components/BibleReader.tsx tests/unit/components/BibleReader-reduced-motion.test.tsx
git commit -m "feat(a11y): respect prefers-reduced-motion for animations and scroll"
```

### Task D3: aria-live status in the morphology popover

**Files:**
- Modify: `components/MorphologyPopover.tsx`

(The verse-note status region was already converted to `role="status" aria-live="polite"` in Task C6.)

- [ ] **Step 1: Wrap the popover status in a live region**

In [components/MorphologyPopover.tsx](../../../components/MorphologyPopover.tsx), replace the status line (line 243):

```tsx
      {status ? (
        <p role="status" aria-live="polite" className="mt-3 text-sm text-slate-600">{status}</p>
      ) : null}
```

- [ ] **Step 2: Verify the existing popover tests still pass**

Run: `npm run test:unit`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add components/MorphologyPopover.tsx
git commit -m "feat(a11y): announce note-save status in the morphology popover"
```

### Task D4: Tap targets for highlight swatches

**Files:**
- Modify: `components/HighlightPalette.tsx`

(English word and Greek token tap areas were enlarged via `px-1 py-0.5` in Tasks B2/D1.)

- [ ] **Step 1: Enlarge the swatch hit area while keeping the visual size**

In [components/HighlightPalette.tsx](../../../components/HighlightPalette.tsx), wrap each swatch's clickable area with padding so the target is ≥40px without growing the colored dot. Change the swatch button (lines 22-34) to use a padded transparent button containing a sized inner dot:

```tsx
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            onClick={() => onPick(option.value)}
            aria-label={option.label}
            title={option.label}
            className="flex h-9 w-9 items-center justify-center rounded-full"
          >
            <span
              className={`block h-6 w-6 rounded-full border ${
                active ? "border-slate-900 ring-2 ring-slate-300" : "border-stone-300"
              }`}
              style={{ backgroundColor: option.value }}
            />
          </button>
```

Apply the same `h-9 w-9` padded pattern to the "Remove highlight" button (lines 42-49), keeping its inner `Ban` icon size.

- [ ] **Step 2: Verify the palette tests still pass**

Run: `npm run test:unit`
Expected: all green (interactions target the buttons by `aria-label`, unchanged).

- [ ] **Step 3: Commit**

```bash
git add components/HighlightPalette.tsx
git commit -m "feat(a11y): enlarge highlight swatch tap targets"
```

---

## Phase E — Copy & polish (review findings #7, #9, #12, #13, λ glyph, single popover)

**Branch:** `feat/read-phase-e-polish` · **PR:** `Read: empty state, chapter dropdown, contrast, accent target ring (Phase E)`

### Task E1: User-facing empty state

**Files:**
- Modify: `components/BibleReader.tsx`
- Create: `tests/unit/components/BibleReader-empty.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/BibleReader-empty.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BibleReader } from "@/components/BibleReader";

describe("BibleReader empty state", () => {
  it("shows a reader-facing message with a way back, never implementation detail", () => {
    const { getByRole, queryByText } = render(
      <BibleReader verses={[]} initialMode="parallel" chapterLabel="John 1" />
    );
    expect(queryByText(/prisma|postgres|seed script/i)).toBeNull();
    const link = getByRole("link", { name: /john 1/i });
    expect(link.getAttribute("href")).toContain("/read?book=John&chapter=1");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/BibleReader-empty.test.tsx`
Expected: FAIL — current copy mentions Prisma/Postgres and has no link.

- [ ] **Step 3: Rewrite the empty state**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx), replace the early return (lines 165-171). Add `import Link from "next/link";` at the top, then:

```tsx
  if (verses.length === 0) {
    return (
      <div className="rounded-md border border-stone-300 bg-white p-6 text-slate-700">
        <p>This passage isn’t available yet.</p>
        <Link href="/read?book=John&chapter=1" className="mt-2 inline-block font-medium text-accent-700 hover:text-accent-800">
          Go to John 1
        </Link>
      </div>
    );
  }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/components/BibleReader-empty.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/BibleReader.tsx tests/unit/components/BibleReader-empty.test.tsx
git commit -m "fix(read): user-facing empty state with a way back"
```

### Task E2: Chapter dropdown shows the chapter number only

**Files:**
- Modify: `components/ReaderControls.tsx`
- Modify: `tests/unit/components/ReaderControls.test.tsx`

- [ ] **Step 1: Update the existing test for number-only options**

Replace the assertions in [tests/unit/components/ReaderControls.test.tsx](../../../tests/unit/components/ReaderControls.test.tsx):

```tsx
  it("auto-selects first chapter (by number) when book changes", () => {
    const { getByDisplayValue, getByRole } = render(
      <ReaderControls books={books} passages={passages} selectedBook="John" selectedChapter={2} />
    );
    expect(getByDisplayValue("2")).toBeTruthy();
    fireEvent.change(getByRole("combobox", { name: /book/i }), { target: { value: "Rom" } });
    expect(getByDisplayValue("1")).toBeTruthy();
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/ReaderControls.test.tsx`
Expected: FAIL — options still render `p.label` ("John 2").

- [ ] **Step 3: Render the chapter number as the option text**

In [components/ReaderControls.tsx](../../../components/ReaderControls.tsx), change the chapter `<option>` (lines 53-55) to display the number:

```tsx
        {chapterOptions.map((p) => (
          <option key={`${p.book}-${p.chapter}`} value={p.chapter}>{p.chapter}</option>
        ))}
```

(Leave `getAvailablePassages` and its `label` in [lib/search.ts](../../../lib/search.ts) untouched — the data is shared; only the reader's presentation changes.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/components/ReaderControls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ReaderControls.tsx tests/unit/components/ReaderControls.test.tsx
git commit -m "fix(read): chapter dropdown shows the number, not the redundant book label"
```

### Task E3: Accent target-verse ring

Already delivered in Task C3 (the `<article>` ring changed from `ring-amber-300` to `ring-accent-400`). No separate task. Confirm during Phase C review that no `ring-amber-` class remains in [components/BibleReader.tsx](../../../components/BibleReader.tsx):

- [ ] **Step 1: Grep to confirm**

Run: `git grep -n "ring-amber" components/BibleReader.tsx`
Expected: no output.

### Task E4: Contrast fixes for low-contrast text

**Files:**
- Modify: `components/MorphologyPopover.tsx`

(The `slate-400` intro close icon → `slate-500` was handled in Task A3; per-verse and column labels moved to `slate-600` in Tasks C4/C6.)

- [ ] **Step 1: Darken the Louw-Nida reference parentheticals**

In [components/MorphologyPopover.tsx](../../../components/MorphologyPopover.tsx), change the two `text-slate-400` spans wrapping `(sense.ref)` (lines 196 and 204) to `text-slate-500`:

```tsx
                <span className="text-slate-500"> ({sense.ref})</span>
```

(both occurrences)

- [ ] **Step 2: Verify build/lint**

Run: `npx tsc --noEmit --pretty false`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/MorphologyPopover.tsx
git commit -m "fix(a11y): raise contrast of Louw-Nida reference text"
```

### Task E5: Make the λ glyph decorative (no misleading tooltip)

**Files:**
- Modify: `components/MorphologyPopover.tsx`

- [ ] **Step 1: Remove the title attribute from the decorative lambda**

In [components/MorphologyPopover.tsx](../../../components/MorphologyPopover.tsx), the lambda span (lines 160-166) is already `aria-hidden`; drop the `title="Lemma lookup"` so it reads purely as a decorative accent (the labeled "Search lemma" button below is the real affordance):

```tsx
          <span aria-hidden className="greek-text text-3xl font-semibold leading-none text-accent-600">
            λ
          </span>
```

- [ ] **Step 2: Commit**

```bash
git add components/MorphologyPopover.tsx
git commit -m "polish(read): treat lemma lambda as decorative, not a hidden affordance"
```

### Task E6: Single active popover (English side)

**Files:**
- Modify: `components/BibleReader.tsx`

(The Greek-side clear of `selectedEnglishWord` was added in Task B2 step 5. This task adds the symmetric clear when an English word opens.)

- [ ] **Step 1: Clear the Greek selection when an English word is selected**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx), the `EnglishVerseText` button `onSelect` opens the English popover. Wrap the `setSelectedEnglishWord` setter passed to it so it also clears the token selection. Change the call site (Task B2 step 6 block):

```tsx
                  onSelect={(key) => { setSelectedTokenId(null); setSelectedEnglishWord(key); }}
```

- [ ] **Step 2: Add a regression test**

```tsx
// tests/unit/components/BibleReader-single-popover.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { BibleReader } from "@/components/BibleReader";

const token = {
  id: "t1", book: "John", chapter: 1, verse: 1, wordIndex: 0, surface: "Ἐν",
  normalized: "εν", lemma: "ἐν", morphCode: "P", partOfSpeech: "P-", gloss: "in",
  domains: [], noteCount: 0, highlightColor: null
};
const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: [token]
};

describe("single active popover", () => {
  it("closes the Greek popover when an English word is opened", () => {
    const { getByRole, queryByText } = render(
      <BibleReader verses={[verse]} initialMode="parallel" chapterLabel="John 1" />
    );
    fireEvent.click(getByRole("button", { name: "Ἐν" }));      // open Greek popover
    expect(queryByText(/morphology/i)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "In" }));      // open English popover
    expect(queryByText(/morphology/i)).toBeNull();             // Greek popover closed
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/unit/components/BibleReader-single-popover.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/BibleReader.tsx tests/unit/components/BibleReader-single-popover.test.tsx
git commit -m "polish(read): only one word popover open at a time"
```

### Task E7 (optional): Tighten highlight padding

**Files:**
- Modify: `components/BibleReader.tsx`

(Greek token padding was already reduced from `px-1.5 py-1` to `px-1 py-0.5` in Task B2 step 5, so highlight boxes hug the word more tightly. No further change required; confirm the screenshots show snug highlight boxes during Phase B verification. If still too boxy, reduce to `px-0.5` — verify spacing stays even via the run skill.)

- [ ] **Step 1: Confirm via the run skill** that highlighted Greek words show snug, evenly-spaced boxes (re-use the gap measurement from the earlier verification — expect uniform inter-token gaps). No commit unless a change is made.

---

## Phase F — Passage reference quick-jump (feature request)

**Branch:** `feat/read-phase-f-reference-jump` · **PR:** `Read: free-text passage reference quick-jump (Phase F)`

Let the reader type a free-text reference (e.g. `John 3:16`, `Rom 5`, `1 cor 13:4`) in addition to the book/chapter dropdowns. Reuses the existing reference machinery; the dropdowns remain and keep working without JavaScript.

> **Scope addition (decided 2026-06-17, after Phase C merged — user request):** the quick-jump must ALSO live in the Phase C **sticky reader bar** (the pinned bar inside [components/BibleReader.tsx](../../../components/BibleReader.tsx) that carries the chapter label + mode toggle), not only in `ReaderControls` at the top. Without this, the reader has to scroll all the way back to the top to change book/chapter/verse while reading. Surface the free-text quick-jump (`parsePassageQuery` → `router.push`) in the sticky bar alongside the chapter label and mode toggle — and consider compact prev/next chapter controls there too — so the reader can jump to any passage from anywhere while scrolled. Keep the `ReaderControls` field as well (Task F2; it works without JavaScript). Any scroll-to-target after a jump must respect `prefers-reduced-motion` (the Phase D guard). This completes the Phase C (C2) sticky-bar wayfinding intent.

### Task F1: `parsePassageQuery` helper (accepts chapter-only and chapter:verse)

**Files:**
- Modify: `lib/references.ts`
- Create: `tests/unit/lib/parsePassageQuery.test.ts`

> Why a new helper: the existing `parseReference()` regex *requires* a `:verse`, so "John 3" would not parse, and `normalizeBook()` returns the raw input for unknown books (so "Hobbiton 1:1" would falsely succeed). `parsePassageQuery` accepts chapter-only references and rejects unknown books.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/parsePassageQuery.test.ts
import { describe, expect, it } from "vitest";
import { parsePassageQuery } from "@/lib/references";

describe("parsePassageQuery", () => {
  it("parses book + chapter", () => {
    expect(parsePassageQuery("John 3")).toEqual({ book: "John", chapter: 3 });
  });
  it("parses book + chapter:verse", () => {
    expect(parsePassageQuery("John 3:16")).toEqual({ book: "John", chapter: 3, verse: 16 });
  });
  it("resolves aliases and ranges (uses the start verse)", () => {
    expect(parsePassageQuery("1 cor 13:4-7")).toEqual({ book: "1Cor", chapter: 13, verse: 4 });
  });
  it("rejects unknown books and malformed input", () => {
    expect(parsePassageQuery("Hobbiton 1:1")).toBeNull();
    expect(parsePassageQuery("John")).toBeNull();
    expect(parsePassageQuery("")).toBeNull();
    expect(parsePassageQuery(null)).toBeNull();
  });
  it("rejects non-positive chapter and verse", () => {
    expect(parsePassageQuery("John 0:1")).toBeNull();
    expect(parsePassageQuery("John 3:0")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/lib/parsePassageQuery.test.ts`
Expected: FAIL — `parsePassageQuery` is not exported.

- [ ] **Step 3: Implement the helper**

Append to [lib/references.ts](../../../lib/references.ts):

```ts
// Parse a free-text passage query: "Book Chapter" or "Book Chapter:Verse[-VerseEnd]".
// Verse range collapses to the start verse (the reader scrolls there). Returns null
// for malformed input or a book not in ntBooks.
export function parsePassageQuery(
  input?: string | null
): { book: string; chapter: number; verse?: number } | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/\s+/g, " ");
  const match = trimmed.match(/^(.+?)\s+(\d+)(?::(\d+)(?:-\d+)?)?$/);
  if (!match) return null;
  const book = normalizeBook(match[1]);
  if (!book || !ntBooks.some((b) => b.osisId === book)) return null;
  const chapter = Number.parseInt(match[2], 10);
  if (chapter < 1) return null;
  let verse: number | undefined;
  if (match[3] !== undefined) {
    verse = Number.parseInt(match[3], 10);
    if (verse < 1) return null; // reject "John 3:0"; chapter < 1 ("John 0:1") already rejected above
  }
  return { book, chapter, ...(verse !== undefined ? { verse } : {}) };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/lib/parsePassageQuery.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/references.ts tests/unit/lib/parsePassageQuery.test.ts
git commit -m "feat(read): add parsePassageQuery for free-text reference jumps"
```

### Task F2: Reference field in ReaderControls

**Files:**
- Modify: `components/ReaderControls.tsx`
- Modify: `tests/unit/components/ReaderControls.test.tsx`

- [ ] **Step 1: Add the failing test (router push + invalid feedback)**

Add to [tests/unit/components/ReaderControls.test.tsx](../../../tests/unit/components/ReaderControls.test.tsx). First add a router mock at the top (after the imports):

```tsx
import { vi } from "vitest";
// vi.mock is hoisted above imports, so the mock factory must not close over a
// later-declared const. Use vi.hoisted (the repo's pattern, see tests/unit/app/signin-actions.test.ts).
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
```

Then add cases inside the `describe`:

```tsx
  it("navigates to a typed reference on submit", () => {
    const { getByRole } = render(
      <ReaderControls books={books} passages={passages} selectedBook="John" selectedChapter={1} />
    );
    fireEvent.change(getByRole("textbox", { name: /reference/i }), { target: { value: "John 3:16" } });
    fireEvent.submit(getByRole("textbox", { name: /reference/i }).closest("form")!);
    expect(push).toHaveBeenCalledWith("/read?book=John&chapter=3&verse=16");
  });

  it("shows an error for an unparseable reference", () => {
    const { getByRole, getByText } = render(
      <ReaderControls books={books} passages={passages} selectedBook="John" selectedChapter={1} />
    );
    fireEvent.change(getByRole("textbox", { name: /reference/i }), { target: { value: "nope" } });
    fireEvent.submit(getByRole("textbox", { name: /reference/i }).closest("form")!);
    expect(getByText(/try a reference like/i)).toBeTruthy();
  });
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run tests/unit/components/ReaderControls.test.tsx`
Expected: FAIL — no reference textbox; `useRouter` unused.

- [ ] **Step 3: Add the reference field and submit interceptor**

In [components/ReaderControls.tsx](../../../components/ReaderControls.tsx), update imports and component. Add:

```tsx
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { parsePassageQuery } from "@/lib/references";
```

(The existing `ReaderControls.tsx` imports only named React hooks, not the `React` namespace — so use `import type { FormEvent }` rather than `React.FormEvent`.)

> Phase F is self-contained — it does **not** import `lib/ui/focus` (that's Phase D). The reference input uses the same plain border classes as the existing dropdowns; Phase D Task D1 later adds the shared `focus-visible` ring to this field along with the other reader controls.

Inside the component body, add state and handler:

```tsx
  const router = useRouter();
  const [ref, setRef] = useState("");
  const [refError, setRefError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const query = ref.trim();
    if (!query) return; // empty reference → let the dropdowns GET normally
    event.preventDefault();
    const parsed = parsePassageQuery(query);
    if (!parsed) {
      setRefError("Try a reference like “John 3:16”.");
      return;
    }
    setRefError(null);
    const href = `/read?book=${encodeURIComponent(parsed.book)}&chapter=${parsed.chapter}${
      parsed.verse !== undefined ? `&verse=${parsed.verse}` : ""
    }`;
    router.push(href);
  }
```

Wrap the existing controls so the error can sit below. Change the `<form className="flex flex-wrap gap-2" action="/read">` opening to `<form className="flex flex-wrap gap-2" action="/read" onSubmit={handleSubmit}>` and add the reference input as the first child:

```tsx
      <input
        aria-label="reference"
        value={ref}
        onChange={(event) => { setRef(event.target.value); setRefError(null); }}
        placeholder="Go to e.g. John 3:16"
        className={`w-44 rounded-md border bg-white px-3 py-2 text-sm ${
          refError ? "border-red-400" : "border-stone-300"
        }`}
      />
```

After the `</form>`, render the error in a sibling (wrap form + error in a `<div>`):

```tsx
      {refError ? <p role="alert" className="mt-1 text-sm text-red-700">{refError}</p> : null}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run tests/unit/components/ReaderControls.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add components/ReaderControls.tsx tests/unit/components/ReaderControls.test.tsx
git commit -m "feat(read): free-text reference quick-jump alongside the dropdowns"
```

---

## Phase G — Continuous reading mode (feature request)

**Branch:** `feat/read-phase-g-continuous` · **PR:** `Read: continuous reading mode for single-language (Phase G)`

A second display axis, independent of Greek/English/Parallel: **Study** (today's per-verse layout) vs **Continuous** (flowing prose with superscript verse numbers and no per-verse note editors). Per the agreed design: **continuous is available for single-language only** — in Parallel the continuous option is disabled and the layout falls back to study. Words remain tappable (morphology + highlight) and existing highlights still render; only the per-verse note editors are hidden. The morphology popover (including its own add-note form) stays fully functional.

### Task G1: Layout preference (cookie)

**Files:**
- Modify: `lib/readerPrefs.ts`
- Modify: `tests/unit/lib/readerPrefs.test.ts`

- [ ] **Step 1: Add a failing test**

Append to [tests/unit/lib/readerPrefs.test.ts](../../../tests/unit/lib/readerPrefs.test.ts):

```ts
import { parseReaderLayout, READER_LAYOUT_COOKIE } from "@/lib/readerPrefs";

describe("parseReaderLayout", () => {
  it("accepts study and continuous, rejects others", () => {
    expect(parseReaderLayout("study")).toBe("study");
    expect(parseReaderLayout("continuous")).toBe("continuous");
    expect(parseReaderLayout("scroll")).toBeNull();
    expect(parseReaderLayout(null)).toBeNull();
  });
  it("exposes a stable cookie name", () => {
    expect(READER_LAYOUT_COOKIE).toBe("textlab-reader-layout");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run tests/unit/lib/readerPrefs.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Add the layout pref to readerPrefs**

Append to [lib/readerPrefs.ts](../../../lib/readerPrefs.ts):

```ts
export type ReaderLayout = "study" | "continuous";
export const READER_LAYOUTS: readonly ReaderLayout[] = ["study", "continuous"];
export const READER_LAYOUT_COOKIE = "textlab-reader-layout";

export function parseReaderLayout(value: string | null | undefined): ReaderLayout | null {
  return value != null && (READER_LAYOUTS as readonly string[]).includes(value)
    ? (value as ReaderLayout)
    : null;
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run tests/unit/lib/readerPrefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/readerPrefs.ts tests/unit/lib/readerPrefs.test.ts
git commit -m "feat(read): add reader layout preference (study/continuous) cookie"
```

### Task G2: ReaderLayoutToggle component

**Files:**
- Create: `components/ReaderLayoutToggle.tsx`
- Create: `tests/unit/components/ReaderLayoutToggle.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/ReaderLayoutToggle.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ReaderLayoutToggle } from "@/components/ReaderLayoutToggle";

describe("ReaderLayoutToggle", () => {
  it("disables Continuous when continuousDisabled is set", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <ReaderLayoutToggle layout="study" onChange={onChange} continuousDisabled />
    );
    const cont = getByRole("radio", { name: "Continuous" });
    expect(cont).toBeDisabled();
    fireEvent.click(cont);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("fires onChange when an enabled option is clicked", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<ReaderLayoutToggle layout="study" onChange={onChange} />);
    fireEvent.click(getByRole("radio", { name: "Continuous" }));
    expect(onChange).toHaveBeenCalledWith("continuous");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run tests/unit/components/ReaderLayoutToggle.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Create the toggle**

```tsx
// components/ReaderLayoutToggle.tsx
"use client";

import type { ReaderLayout } from "@/lib/readerPrefs";
import { FOCUS_RING } from "@/lib/ui/focus";

const OPTIONS: { value: ReaderLayout; label: string }[] = [
  { value: "study", label: "Study" },
  { value: "continuous", label: "Continuous" }
];

export function ReaderLayoutToggle({
  layout,
  onChange,
  continuousDisabled = false
}: {
  layout: ReaderLayout;
  onChange: (next: ReaderLayout) => void;
  continuousDisabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Reading layout" className="inline-flex rounded-md border border-stone-300 bg-white p-0.5 text-sm">
      {OPTIONS.map((option) => {
        const active = layout === option.value;
        const disabled = option.value === "continuous" && continuousDisabled;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={disabled ? "Switch to Greek or English for continuous reading" : undefined}
            onClick={() => onChange(option.value)}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${FOCUS_RING} ${
              active ? "bg-accent-700 text-white" : "text-slate-600 hover:text-slate-900"
            } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run tests/unit/components/ReaderLayoutToggle.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ReaderLayoutToggle.tsx tests/unit/components/ReaderLayoutToggle.test.tsx
git commit -m "feat(read): study/continuous layout toggle"
```

### Task G3: Extract shared word renderers (`GreekToken`, `EnglishWords`)

**Files:**
- Create: `components/readerTokens.tsx`
- Modify: `components/BibleReader.tsx`

> Refactor only — no behavior change. Continuous mode and study mode must render identical word buttons, so extract them once. **Put them in a new `components/readerTokens.tsx`** (with the `ReaderVerse`/`ReaderToken` types) rather than exporting from `BibleReader`: `BibleReader` imports `ContinuousReader`, which needs these renderers, so exporting from `BibleReader` would create a circular import. Both `BibleReader` and `ContinuousReader` import from `readerTokens`. Existing tests stay green.

- [ ] **Step 1: Extract `GreekToken` into `components/readerTokens.tsx`**

In `components/readerTokens.tsx`, add the `ReaderVerse` type (moved from `BibleReader`) and re-export `ReaderToken` so `ContinuousReader` can import both as types, then add the shared renderers. `BibleReader` imports `ReaderVerse`/`GreekToken`/`EnglishWords` from `readerTokens` instead of defining them. The file's exported surface:

```tsx
"use client";

import { Fragment, useMemo } from "react";
import { EnglishWordPopover } from "@/components/EnglishWordPopover";
import { MorphologyPopover, type ReaderToken } from "@/components/MorphologyPopover";
import { FOCUS_RING } from "@/lib/ui/focus";

export type { ReaderToken };

export type EnglishHighlight = { wordIndex: number; color: string };

export type ReaderVerse = {
  id: string;
  book: string;
  bookName: string;
  chapter: number;
  verse: number;
  reference: string;
  greekText: string;
  englishText: string;
  englishCorpus: string;
  englishVerseId: string | null;
  englishHighlights: EnglishHighlight[];
  tokens: ReaderToken[];
};
```

(Move the type exactly as it exists when G3 runs — do **not** add a `notes` field here; Phase H1 adds `notes` to `ReaderVerse`/`ReaderToken` wherever the type lives. The `tokenizeEnglish` helper moves here too, or is imported from a shared module, since `EnglishWords` uses it.) Then the renderers:

```tsx
export function GreekToken({
  token, color, reference, selected, noteDraft, onToggle, onDraftChange, onHighlight, onClose, onNotesChanged
}: {
  token: ReaderToken;
  color: string | null;
  reference: string;
  selected: boolean;
  noteDraft: string;
  onToggle: () => void;
  onDraftChange: (next: string) => void;
  onHighlight: (color: string | null) => void;
  onClose: () => void;
  onNotesChanged?: () => void;
}) {
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={onToggle}
        style={color ? { backgroundColor: color } : undefined}
        className={`mx-0.5 rounded px-1 py-0.5 transition-colors hover:bg-accent-50 ${FOCUS_RING}`}
      >
        {token.surface}
      </button>
      {selected ? (
        <MorphologyPopover
          token={token}
          reference={reference}
          body={noteDraft}
          onBodyChange={onDraftChange}
          onHighlight={onHighlight}
          onClose={onClose}
          onNotesChanged={onNotesChanged}
        />
      ) : null}
    </span>
  );
}
```

`onNotesChanged` is optional. So that `GreekToken` forwarding it typechecks even before Phase H, **G3 must also add the optional prop to `MorphologyPopover`** (Step 1b below). `FOCUS_RING` comes from `@/lib/ui/focus` (Phase D); if Phase G is implemented before D, create `lib/ui/focus.ts` first (D1 Step 3) — readerTokens is the one feature-phase file that needs it.

- [ ] **Step 1b: Add the optional `onNotesChanged` prop to `MorphologyPopover`**

In [components/MorphologyPopover.tsx](../../../components/MorphologyPopover.tsx), extend the props (from Task B2) with an optional callback and invoke it after a successful note add. Add to the props type:

```tsx
  onNotesChanged?: () => void;
```

and add it to the destructured params. In `addNote`, after `setStatus("Note saved.")`, call it:

```tsx
        onBodyChange("");
        setStatus("Note saved.");
        onNotesChanged?.();
```

(Phase H Task H3 then renders the note list using this same hook; if H is implemented without G, H3 adds this prop instead — see H3.)

Replace the inline token JSX in the study verse map with `<GreekToken … />`, threading the same values (`selected={selectedTokenId === token.id}`, `onToggle={() => { setSelectedEnglishWord(null); setSelectedTokenId(selectedTokenId === token.id ? null : token.id); }}`, etc.). **Omit `onNotesChanged` here** — it's optional, and `router` is not in `BibleReader` at this point (B2 removed it; G5 and Phase H re-introduce it). Wire `onNotesChanged={() => router.refresh()}` at the call sites in G5 (ContinuousReader) and Phase H, once `router` exists.

- [ ] **Step 2: Extract `EnglishWords`**

Pull the inline word-mapping out of `EnglishVerseText` into a fragment-returning component reused by both layouts:

```tsx
export function EnglishWords({
  verse, overrides, selectedKey, onSelect, onPick, onClear
}: {
  verse: ReaderVerse;
  overrides: Record<string, string | null>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onPick: (wordIndex: number, color: string) => void;
  onClear: (wordIndex: number) => void;
}) {
  const tokens = useMemo(() => tokenizeEnglish(verse.englishText), [verse.englishText]);
  const highlightByWord = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of verse.englishHighlights) map.set(entry.wordIndex, entry.color);
    return map;
  }, [verse.englishHighlights]);

  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === "space") return <Fragment key={`s-${index}`}>{token.value}</Fragment>;
        const key = `${verse.id}-${token.wordIndex}`;
        const color = key in overrides ? overrides[key] : highlightByWord.get(token.wordIndex) ?? null;
        const open = selectedKey === key;
        return (
          <span key={key} className="relative inline-block">
            <button
              type="button"
              onClick={() => { onSelect(open ? null : key); }}
              style={color ? { backgroundColor: color } : undefined}
              className={`rounded px-1 py-0.5 transition-colors hover:bg-accent-50 ${FOCUS_RING}`}
            >
              {token.value}
            </button>
            {open ? (
              <EnglishWordPopover
                word={token.value}
                activeColor={color}
                onPick={(nextColor) => onPick(token.wordIndex, nextColor)}
                onClear={() => onClear(token.wordIndex)}
                onClose={() => onSelect(null)}
              />
            ) : null}
          </span>
        );
      })}
    </>
  );
}
```

`EnglishVerseText` now wraps `EnglishWords` in its block container (keeping the `!verse.englishVerseId` plain-text fallback and the inline verse-number marker from Task C3). The single-popover `onSelect` wrapper from Task E6 stays at the `BibleReader` call site.

- [ ] **Step 3: Run the full suite (no behavior change)**

Run: `npm run test:unit`
Expected: all green — the extraction is behavior-preserving.

- [ ] **Step 4: Commit**

```bash
git add components/readerTokens.tsx components/BibleReader.tsx components/MorphologyPopover.tsx
git commit -m "refactor(read): extract GreekToken/EnglishWords; optional onNotesChanged on popover"
```

### Task G4: ContinuousReader component

**Files:**
- Create: `components/ContinuousReader.tsx`
- Create: `tests/unit/components/ContinuousReader.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/ContinuousReader.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ContinuousReader } from "@/components/ContinuousReader";

const token = (id: string, surface: string, verse: number) => ({
  id, book: "John", chapter: 1, verse, wordIndex: 0, surface, normalized: surface,
  lemma: surface, morphCode: "P", partOfSpeech: "P-", gloss: "", domains: [], noteCount: 0, highlightColor: null
});
const verses = [
  { id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
    greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
    englishHighlights: [], tokens: [token("t1", "Ἐν", 1)] },
  { id: "v2", book: "John", bookName: "John", chapter: 1, verse: 2, reference: "John 1:2",
    greekText: "οὗτος", englishText: "He", englishCorpus: "WEB", englishVerseId: "e2",
    englishHighlights: [], tokens: [token("t2", "οὗτος", 2)] }
];
const noop = vi.fn();
const handlers = {
  selectedTokenId: null, setSelectedTokenId: noop, tokenColorOverride: {}, onHighlightToken: noop,
  tokenNoteDrafts: {}, onTokenDraft: noop, onNotesChanged: noop,
  selectedEnglishWord: null, setSelectedEnglishWord: noop, englishColorOverride: {},
  onPickEnglish: noop, onClearEnglish: noop
};

describe("ContinuousReader", () => {
  it("flows Greek verses with superscript numbers and no note editors", () => {
    const { container, getByRole, queryByPlaceholderText } = render(
      <ContinuousReader verses={verses} mode="greek" {...handlers} />
    );
    expect(getByRole("button", { name: "Ἐν" })).toBeTruthy();
    expect(getByRole("button", { name: "οὗτος" })).toBeTruthy();
    expect(queryByPlaceholderText(/write a note/i)).toBeNull();          // no per-verse editors
    expect(container.querySelector("#verse-2")).toBeTruthy();             // jump anchor present
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run tests/unit/components/ContinuousReader.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Create the ContinuousReader**

```tsx
// components/ContinuousReader.tsx
"use client";

import { Fragment } from "react";
import { GreekToken, EnglishWords, type ReaderVerse, type ReaderToken } from "@/components/readerTokens";

const VERSE_NUMBER_CLASS = "oldstyle-nums mr-1 align-super text-sm font-semibold text-slate-500 scroll-mt-24";

export function ContinuousReader(props: {
  verses: ReaderVerse[];
  mode: "greek" | "english";
  selectedTokenId: string | null;
  setSelectedTokenId: (id: string | null) => void;
  tokenColorOverride: Record<string, string | null>;
  onHighlightToken: (verse: ReaderVerse, token: ReaderToken, color: string | null) => void;
  tokenNoteDrafts: Record<string, string>;
  onTokenDraft: (tokenId: string, next: string) => void;
  onNotesChanged: () => void;
  selectedEnglishWord: string | null;
  setSelectedEnglishWord: (key: string | null) => void;
  englishColorOverride: Record<string, string | null>;
  onPickEnglish: (verse: ReaderVerse, wordIndex: number, color: string) => void;
  onClearEnglish: (verse: ReaderVerse, wordIndex: number) => void;
}) {
  const { verses, mode } = props;

  if (mode === "greek") {
    return (
      <div className="greek-text max-w-[68ch] text-[1.45rem] leading-10 text-slate-950">
        {verses.map((verse) => (
          <Fragment key={verse.id}>
            <span id={`verse-${verse.verse}`} className={VERSE_NUMBER_CLASS} aria-hidden>{verse.verse}</span>
            {verse.tokens.length > 0
              ? verse.tokens.map((token) => {
                  const color = token.id in props.tokenColorOverride ? props.tokenColorOverride[token.id] : token.highlightColor;
                  return (
                    <GreekToken
                      key={token.id}
                      token={token}
                      color={color}
                      reference={verse.reference}
                      selected={props.selectedTokenId === token.id}
                      noteDraft={props.tokenNoteDrafts[token.id] ?? ""}
                      onToggle={() => { props.setSelectedEnglishWord(null); props.setSelectedTokenId(props.selectedTokenId === token.id ? null : token.id); }}
                      onDraftChange={(next) => props.onTokenDraft(token.id, next)}
                      onHighlight={(c) => props.onHighlightToken(verse, token, c)}
                      onClose={() => props.setSelectedTokenId(null)}
                      onNotesChanged={props.onNotesChanged}
                    />
                  );
                })
              : verse.greekText}
            {" "}
          </Fragment>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-[68ch] text-xl leading-10 text-slate-950">
      {verses.map((verse) => (
        <Fragment key={verse.id}>
          <span id={`verse-${verse.verse}`} className={VERSE_NUMBER_CLASS} aria-hidden>{verse.verse}</span>
          {verse.englishVerseId ? (
            <EnglishWords
              verse={verse}
              overrides={props.englishColorOverride}
              selectedKey={props.selectedEnglishWord}
              onSelect={(key) => { props.setSelectedTokenId(null); props.setSelectedEnglishWord(key); }}
              onPick={(wordIndex, color) => props.onPickEnglish(verse, wordIndex, color)}
              onClear={(wordIndex) => props.onClearEnglish(verse, wordIndex)}
            />
          ) : (
            verse.englishText
          )}
          {" "}
        </Fragment>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run tests/unit/components/ContinuousReader.test.tsx`
Expected: PASS — depends only on Task G3's `components/readerTokens.tsx` exports (no dependency on G5).

- [ ] **Step 5: Commit**

```bash
git add components/ContinuousReader.tsx tests/unit/components/ContinuousReader.test.tsx
git commit -m "feat(read): continuous flowing reader for single-language modes"
```

### Task G5: Wire layout into BibleReader and the page

**Files:**
- Modify: `components/BibleReader.tsx`
- Modify: `app/read/page.tsx`
- Create: `tests/unit/components/BibleReader-layout.test.tsx`

- [ ] **Step 1: Import shared renderers and add layout state**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx): import `ReaderVerse`/`GreekToken`/`EnglishWords` from `@/components/readerTokens` (extracted in Task G3 — no longer defined locally). Add the layout imports and state:

```tsx
import { useRouter } from "next/navigation";
import { ReaderLayoutToggle } from "@/components/ReaderLayoutToggle";
import { ContinuousReader } from "@/components/ContinuousReader";
import {
  writePrefCookie, READER_MODE_COOKIE, READER_LAYOUT_COOKIE,
  type ReaderMode, type ReaderLayout
} from "@/lib/readerPrefs";
```

```tsx
  // B2 removed useRouter (highlights became optimistic); re-introduce it here —
  // ContinuousReader's onNotesChanged refreshes the passage after a note mutation.
  const router = useRouter();

  const [layout, setLayout] = useState<ReaderLayout>(initialLayout);

  function changeLayout(next: ReaderLayout) {
    setLayout(next);
    writePrefCookie(READER_LAYOUT_COOKIE, next);
  }

  const continuousAvailable = readerMode !== "parallel";
  const effectiveLayout: ReaderLayout = continuousAvailable ? layout : "study";
```

Add `initialLayout = "study"` to the props (alongside `initialMode`).

- [ ] **Step 2: Put the layout toggle in the sticky bar and branch the render**

In the sticky bar (Task C2), add the layout toggle next to the mode toggle:

```tsx
        <div className="flex items-center gap-2">
          <ReaderLayoutToggle layout={layout} onChange={changeLayout} continuousDisabled={!continuousAvailable} />
          <ReaderModeToggle mode={readerMode} onChange={changeReaderMode} />
        </div>
```

This step is **purely mechanical: wrap the existing study verse map in a layout ternary. Do not retype or modify the `<article>` body.** The current `BibleReader` return already ends with the study list:

```tsx
      {verses.map((verse) => (
        <article key={verse.id} id={`verse-${verse.verse}`} aria-label={verse.reference} className={/* … */}>
          {/* … existing Greek/English columns + on-demand note section (Tasks C3/C4/C6/H4) … */}
        </article>
      ))}
```

Make exactly two edits to that block — insert an opening line before it and a closing line after it, leaving everything in between byte-for-byte unchanged:

1. **Before** the `{verses.map((verse) => (` line, insert:

```tsx
      {effectiveLayout === "continuous" ? (
        <ContinuousReader
          verses={verses}
          mode={readerMode === "english" ? "english" : "greek"}
          selectedTokenId={selectedTokenId}
          setSelectedTokenId={setSelectedTokenId}
          tokenColorOverride={tokenColorOverride}
          onHighlightToken={highlightToken}
          tokenNoteDrafts={tokenNoteDrafts}
          onTokenDraft={setTokenDraft}
          onNotesChanged={() => router.refresh()}
          selectedEnglishWord={selectedEnglishWord}
          setSelectedEnglishWord={setSelectedEnglishWord}
          englishColorOverride={englishColorOverride}
          onPickEnglish={(verse, wordIndex, color) => highlightEnglishWord(verse, wordIndex, color)}
          onClearEnglish={(verse, wordIndex) => highlightEnglishWord(verse, wordIndex, null)}
        />
      ) : (
```

   and change the existing `{verses.map((verse) => (` to `verses.map((verse) => (` (drop the leading `{` — it is now inside the ternary).

2. **After** the block's closing `))}`, the trailing `}` of the original `{…}` expression becomes the ternary close. Net result, with the article body unchanged in the middle:

```tsx
      {effectiveLayout === "continuous" ? (
        <ContinuousReader … />        {/* the element from edit 1, in full */}
      ) : (
        verses.map((verse) => (
          /* the existing <article>…</article> body — unchanged */
        ))
      )}
```

`router` was added in Step 1, so `onNotesChanged={() => router.refresh()}` resolves. The `/* … */` / `<ContinuousReader … />` ellipses above mark **existing or already-shown code**, not text to retype — they are intentionally not compilable, so there is no blank-`<article>` trap.

- [ ] **Step 3: Read the layout cookie on the server**

In [app/read/page.tsx](../../../app/read/page.tsx):

```tsx
import { parseReaderLayout, READER_LAYOUT_COOKIE } from "@/lib/readerPrefs";
```

```tsx
  const initialLayout = parseReaderLayout(cookieStore.get(READER_LAYOUT_COOKIE)?.value) ?? "study";
```

Pass `initialLayout={initialLayout}` to `<BibleReader … />`.

- [ ] **Step 4: Add the layout behavior test**

```tsx
// tests/unit/components/BibleReader-layout.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: []
};

describe("BibleReader layout", () => {
  it("renders continuous (no per-verse note toggle) for greek", () => {
    const { queryByRole } = render(
      <BibleReader verses={[verse]} initialMode="greek" initialLayout="continuous" chapterLabel="John 1" />
    );
    expect(queryByRole("button", { name: /note on john 1:1/i })).toBeNull();
  });
  it("forces study layout in parallel even if continuous was saved", () => {
    const { getByRole } = render(
      <BibleReader verses={[verse]} initialMode="parallel" initialLayout="continuous" chapterLabel="John 1" />
    );
    expect(getByRole("button", { name: /note on john 1:1/i })).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run the test + full suite**

Run: `npx vitest run tests/unit/components/BibleReader-layout.test.tsx` then `npm run test:unit`
Expected: PASS / all green.

- [ ] **Step 6: Commit**

```bash
git add components/BibleReader.tsx app/read/page.tsx tests/unit/components/BibleReader-layout.test.tsx
git commit -m "feat(read): wire continuous layout; parallel falls back to study"
```

---

## Phase H — Notes on the Read page (feature request)

**Branch:** `feat/read-phase-h-notes` · **PR:** `Read: notes drawer + in-popover notes with edit/delete (Phase H)`

Surface existing notes while reading: a passage-scoped **notes drawer** (with jump-to-verse) plus note lists **inside the word/verse popovers**, all with **full edit/delete inline**. The drawer is also the notes entry point in continuous mode (where per-verse editors are hidden).

> Dependency: this re-introduces `useRouter` in `BibleReader` (not the popover — `MorphologyPopover` calls the `onNotesChanged` callback instead) for a post-mutation `router.refresh()` (notes are not optimistic — a refresh re-reads bodies from the server). It also changes the `getReaderPassage` return shape; **verify `scripts/acceptance-test.js`** before committing H1.

### Task H1: Return note bodies from `getReaderPassage`

**Files:**
- Modify: `lib/search.ts`
- Modify: the file holding `ReaderVerse` — `components/BibleReader.tsx`, **or `components/readerTokens.tsx` if Phase G has moved the type there** — and `components/MorphologyPopover.tsx` (ReaderToken type)
- Verify: `scripts/acceptance-test.js`

- [ ] **Step 1: Check acceptance assertions first**

Run: `git grep -n "getReaderPassage\|noteCount\|\.notes" scripts/acceptance-test.js`
Expected: note any assertion on the passage shape; if present, plan to update it in Step 4.

- [ ] **Step 2: Add the verse-notes query and expose bodies**

In [lib/search.ts](../../../lib/search.ts) `getReaderPassage`, after the `Promise.all` that loads `greekVerses`/`englishVerses`/`tokens`, fetch verse notes scoped to the user:

```ts
  const verseNotes = await prisma.note.findMany({
    where: { ...userScope, verseId: { in: greekVerses.map((v) => v.id) } },
    select: { id: true, title: true, body: true, tags: true, verseId: true, createdAt: true },
    orderBy: { createdAt: "asc" }
  });
  const notesByVerse = new Map<string, { id: string; title: string | null; body: string; tags: string[] }[]>();
  for (const n of verseNotes) {
    if (!n.verseId) continue;
    const list = notesByVerse.get(n.verseId) ?? [];
    list.push({ id: n.id, title: n.title, body: n.body, tags: n.tags });
    notesByVerse.set(n.verseId, list);
  }
```

In the returned verse object, add `notes: notesByVerse.get(verse.id) ?? []`. In the token mapping, replace `noteCount: token.notes.length` usage to also expose bodies (include `tags` so inline edits can round-trip the full note — see Task H2):

```ts
        noteCount: token.notes.length,
        notes: token.notes.map((n) => ({ id: n.id, title: n.title, body: n.body, tags: n.tags })),
```

- [ ] **Step 3: Update the consumer types**

Add to `ReaderVerse` (in `components/BibleReader.tsx`, or `components/readerTokens.tsx` if Phase G has already moved the type there):

```tsx
  notes: { id: string; title: string | null; body: string; tags: string[] }[];
```

Add to `ReaderToken` in [components/MorphologyPopover.tsx](../../../components/MorphologyPopover.tsx):

```tsx
  notes: { id: string; title: string | null; body: string; tags: string[] }[];
```

Update every test fixture that builds a verse/token to include `notes: []` (the fixtures in `BibleReader-*.test.tsx`, and `ContinuousReader.test.tsx` if Phase G is present).

- [ ] **Step 4: Update acceptance test if needed; run typecheck**

If Step 1 found assertions, update `scripts/acceptance-test.js` to expect the `notes` arrays. Then:

Run: `npx tsc --noEmit --pretty false` and `npm run test:unit`
Expected: no type errors; tests green.

- [ ] **Step 5: Commit**

```bash
# Include components/readerTokens.tsx if Phase G moved ReaderVerse there.
git add lib/search.ts components/BibleReader.tsx components/readerTokens.tsx components/MorphologyPopover.tsx tests/ scripts/acceptance-test.js
git commit -m "feat(read): include token and verse note bodies in the reader passage"
```

### Task H2: `NoteList` component (view + edit + delete)

**Files:**
- Create: `components/NoteList.tsx`
- Create: `tests/unit/components/NoteList.test.tsx`
- Verify: `app/api/notes/[id]/route.ts` supports `PATCH` and `DELETE`

- [ ] **Step 1: Confirm the note item API**

Run: `git grep -n "export async function" app/api/notes/[id]/route.ts`
Expected: `PATCH` and `DELETE` handlers exist (NotesPanel already edits/deletes). If a verb is missing, add it mirroring the POST validation in [app/api/notes/route.ts](../../../app/api/notes/route.ts) (same-origin assert, auth, ownership check by `userId`).

- [ ] **Step 2: Write the failing test**

```tsx
// tests/unit/components/NoteList.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { NoteList } from "@/components/NoteList";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true }))));
afterEach(() => vi.unstubAllGlobals());

const notes = [{ id: "n1", title: "John 1:1", body: "logos = word", tags: ["word"] }];

describe("NoteList", () => {
  it("deletes a note and notifies the caller", async () => {
    const onChanged = vi.fn();
    const { getByRole } = render(<NoteList notes={notes} onChanged={onChanged} />);
    fireEvent.click(getByRole("button", { name: /delete note/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/api/notes/n1", expect.objectContaining({ method: "DELETE" }));
  });

  it("edits a note via PATCH, preserving title and tags", async () => {
    const onChanged = vi.fn();
    const { getByRole, getByDisplayValue } = render(<NoteList notes={notes} onChanged={onChanged} />);
    fireEvent.click(getByRole("button", { name: /edit note/i }));
    fireEvent.change(getByDisplayValue("logos = word"), { target: { value: "the Word" } });
    fireEvent.click(getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ title: "John 1:1", body: "the Word", tags: ["word"] });
  });
});
```

- [ ] **Step 3: Run to confirm it fails**

Run: `npx vitest run tests/unit/components/NoteList.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 4: Create the NoteList**

```tsx
// components/NoteList.tsx
"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { FOCUS_RING, FOCUS_RING_INPUT } from "@/lib/ui/focus";

type Note = { id: string; title: string | null; body: string; tags: string[] };

export function NoteList({ notes, onChanged }: { notes: Note[]; onChanged: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" }
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function save(note: Note) {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      // Send the full note (title + tags), not just body — the PATCH route rewrites
      // tags from the request, so a body-only PATCH would clear existing word/verse tags.
      const res = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: note.title ?? undefined, body, tags: note.tags })
      });
      if (res.ok) { setEditingId(null); onChanged(); }
    } finally {
      setBusy(false);
    }
  }

  if (notes.length === 0) return null;

  return (
    <ul className="space-y-2">
      {notes.map((note) => (
        <li key={note.id} className="rounded-md border border-stone-200 bg-white p-3 text-sm">
          {editingId === note.id ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className={`min-h-16 w-full rounded-md border border-stone-300 px-2 py-1 ${FOCUS_RING_INPUT}`}
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditingId(null)} className={`rounded-md px-2 py-1 text-slate-600 ${FOCUS_RING}`}>Cancel</button>
                <button type="button" disabled={busy} onClick={() => save(note)} className={`rounded-md bg-accent-600 px-3 py-1 font-medium text-white disabled:opacity-50 ${FOCUS_RING}`}>Save</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <p className="whitespace-pre-wrap text-slate-700">{note.body}</p>
              <div className="flex shrink-0 gap-1">
                <button type="button" aria-label="Edit note" onClick={() => { setEditingId(note.id); setDraft(note.body); }} className={`rounded-md p-1 text-slate-500 hover:text-slate-800 ${FOCUS_RING}`}><Pencil size={14} /></button>
                <button type="button" aria-label="Delete note" disabled={busy} onClick={() => remove(note.id)} className={`rounded-md p-1 text-slate-500 hover:text-red-700 ${FOCUS_RING}`}><Trash2 size={14} /></button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Run to confirm it passes**

Run: `npx vitest run tests/unit/components/NoteList.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add components/NoteList.tsx tests/unit/components/NoteList.test.tsx
git commit -m "feat(read): NoteList with inline edit/delete"
```

### Task H3: Show token notes in the morphology popover

**Files:**
- Modify: `components/MorphologyPopover.tsx`

- [ ] **Step 1: Render existing token notes above the add-note form**

In [components/MorphologyPopover.tsx](../../../components/MorphologyPopover.tsx): the optional `onNotesChanged?: () => void` prop and its `addNote` call were added in Phase G Task G3 Step 1b. **If Phase G has not been implemented**, add them now (optional prop + `onNotesChanged?.()` after `setStatus("Note saved.")`). The popover itself does **not** use `useRouter` — the actual refresh is performed by the caller's `onNotesChanged` (`BibleReader` passes `() => router.refresh()`).

Import and render `NoteList` from `token.notes` just before the add-note `<form>`:

```tsx
import { NoteList } from "@/components/NoteList";
...
      {token.notes.length > 0 ? (
        <div className="mt-4">
          <NoteList notes={token.notes} onChanged={() => onNotesChanged?.()} />
        </div>
      ) : null}
```

- [ ] **Step 2: Verify the suite**

Run: `npm run test:unit`
Expected: green (update any MorphologyPopover test fixtures to include `notes: []` and an `onNotesChanged` no-op prop).

- [ ] **Step 3: Commit**

```bash
git add components/MorphologyPopover.tsx
git commit -m "feat(read): show token notes in the morphology popover"
```

### Task H4: Show verse notes in the study verse area

**Files:**
- Modify: `components/BibleReader.tsx`
- Create: `tests/unit/components/BibleReader-verse-notes.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/BibleReader-verse-notes.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: [], notes: [{ id: "n1", title: null, body: "my verse note", tags: ["verse"] }]
};

describe("BibleReader verse notes", () => {
  it("renders existing verse notes in study layout", () => {
    const { getByText } = render(
      <BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" />
    );
    expect(getByText("my verse note")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run tests/unit/components/BibleReader-verse-notes.test.tsx`
Expected: FAIL — verse notes not rendered.

- [ ] **Step 3: Render the verse NoteList above the add-note toggle**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx), in the study-layout note section (Task C6), add before the "Note on …" toggle button:

```tsx
            {verse.notes.length > 0 ? (
              <div className="mb-3">
                <NoteList notes={verse.notes} onChanged={() => router.refresh()} />
              </div>
            ) : null}
```

Import `NoteList`. After a successful `addVerseNote`, also call `router.refresh()` so the new note appears in the list. **Ensure `BibleReader` has `const router = useRouter();` and `import { useRouter } from "next/navigation";`** — added in G5 Step 1 if Phase G ran; if H is implemented without G, add them here (B2 removed the import).

- [ ] **Step 4: Run the test + suite**

Run: `npx vitest run tests/unit/components/BibleReader-verse-notes.test.tsx` then `npm run test:unit`
Expected: PASS / green.

- [ ] **Step 5: Commit**

```bash
git add components/BibleReader.tsx tests/unit/components/BibleReader-verse-notes.test.tsx
git commit -m "feat(read): show verse notes inline in study layout"
```

### Task H5: Passage notes drawer

**Files:**
- Create: `components/ReaderNotesDrawer.tsx`
- Create: `tests/unit/components/ReaderNotesDrawer.test.tsx`
- Modify: `components/BibleReader.tsx` (sticky bar toggle + data)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/ReaderNotesDrawer.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ReaderNotesDrawer } from "@/components/ReaderNotesDrawer";

const items = [
  { id: "n1", title: null, body: "verse note", tags: ["verse"], reference: "John 1:1", verse: 1 },
  { id: "n2", title: null, body: "word note", tags: ["word"], reference: "John 1:1 · λόγος", verse: 1 }
];

describe("ReaderNotesDrawer", () => {
  it("opens to reveal passage notes and jumps to a verse", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    document.body.innerHTML = '<div id="verse-1"></div>';
    const { getByRole, getByText } = render(<ReaderNotesDrawer items={items} onChanged={() => {}} />);
    fireEvent.click(getByRole("button", { name: /notes \(2\)/i }));
    expect(getByText("verse note")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: /go to john 1:1 · λόγος/i }));
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run tests/unit/components/ReaderNotesDrawer.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Create the drawer**

```tsx
// components/ReaderNotesDrawer.tsx
"use client";

import { NotebookText } from "lucide-react";
import { useState } from "react";
import { NoteList } from "@/components/NoteList";
import { FOCUS_RING } from "@/lib/ui/focus";

export type DrawerNote = { id: string; title: string | null; body: string; tags: string[]; reference: string; verse: number };

export function ReaderNotesDrawer({ items, onChanged }: { items: DrawerNote[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);

  function jump(verse: number) {
    const node = document.getElementById(`verse-${verse}`);
    if (!node) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    setOpen(false);
  }

  // Group by reference so the jump label + NoteList read cleanly.
  const groups = items.reduce<Record<string, DrawerNote[]>>((acc, n) => {
    (acc[n.reference] ??= []).push(n);
    return acc;
  }, {});

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-500 ${FOCUS_RING}`}
      >
        <NotebookText size={16} />
        Notes ({items.length})
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 max-h-[70vh] w-80 overflow-auto rounded-md border border-stone-300 bg-white p-3 shadow-xl">
          {items.length === 0 ? (
            <p className="text-sm text-slate-600">No notes in this passage yet.</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(groups).map(([reference, notes]) => (
                <div key={reference}>
                  <button
                    type="button"
                    onClick={() => jump(notes[0].verse)}
                    aria-label={`Go to ${reference}`}
                    className={`mb-1 text-xs font-semibold uppercase tracking-wide text-accent-700 hover:text-accent-800 ${FOCUS_RING}`}
                  >
                    {reference}
                  </button>
                  <NoteList notes={notes} onChanged={onChanged} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Build the drawer item list in BibleReader and add it to the sticky bar**

In [components/BibleReader.tsx](../../../components/BibleReader.tsx), compute the combined list and render the drawer in the sticky bar (works in both layouts):

```tsx
  const drawerNotes = verses.flatMap((verse) => [
    ...verse.notes.map((n) => ({ ...n, reference: verse.reference, verse: verse.verse })),
    ...verse.tokens.flatMap((t) =>
      t.notes.map((n) => ({ ...n, reference: `${verse.reference} · ${t.surface}`, verse: verse.verse }))
    )
  ]);
```

In the sticky bar:

```tsx
        <ReaderNotesDrawer items={drawerNotes} onChanged={() => router.refresh()} />
```

- [ ] **Step 5: Run the test + suite**

Run: `npx vitest run tests/unit/components/ReaderNotesDrawer.test.tsx` then `npm run test:unit`
Expected: PASS / green.

- [ ] **Step 6: Update docs**

In [README.md](../../../README.md), append these bullets to the Reader list (after the bullets from Task C7 Step 1):

```markdown
  - A reference quick-jump field accepts free-text references (`John 3:16`, `Rom 5`) alongside the book/chapter dropdowns.
  - A continuous reading mode (single-language) flows the text as prose with inline verse numbers; words stay tappable for morphology/highlighting. Parallel stays in the verse-by-verse layout.
  - Notes appear on the Read page: a passage notes drawer (jump to a verse) and note lists inside the word/verse popovers, with inline edit and delete.
```

In [docs/PROJECT_STATE.md](../../../docs/PROJECT_STATE.md), append to the "Read page improvements (2026-06)" subsection:

```markdown
- **Reader features** — free-text reference quick-jump (`parsePassageQuery` in `lib/references.ts`); a continuous (prose) reading layout as a second axis, persisted via cookie and limited to single-language modes; notes surfaced on `/read` via a passage drawer plus in-popover lists with full edit/delete (`getReaderPassage` now returns note bodies + tags for tokens and verses).
```

- [ ] **Step 7: Commit**

```bash
git add components/ReaderNotesDrawer.tsx components/BibleReader.tsx tests/unit/components/ReaderNotesDrawer.test.tsx README.md docs/PROJECT_STATE.md
git commit -m "feat(read): passage notes drawer with jump-to-verse"
```

---

## Self-Review: Spec Coverage

Every review finding maps to a task:

| # | Finding | Task(s) |
|---|---------|---------|
| 1 | First-load jank cluster (mode flash, intro blink, redirect refetch) | A1, A2, A3 |
| 2 | No loading feedback; highlight refetches whole chapter | B1, B2 |
| 3 | Hero doesn't earn space; no persistent wayfinding | C1, C2 |
| 4 | Per-verse note form dominates; input vs textarea | C6 |
| 5 | Verse reference as `<h2>` per verse | C3 |
| 6 | Redundant per-verse column labels | C4 |
| 7 | Developer-facing empty state | E1 |
| 8 | Focus rings inconsistent | D1 |
| 8 | No reduced-motion handling | D2 |
| 8 | Status not announced (aria-live) | C6 (verse), D3 (popover) |
| 9 | Redundant chapter dropdown labels | E2 |
| 10 | Two highlight feedback models | B2 |
| 11 | Uncapped reading measure in single-column | C5 |
| 12 | Off-palette amber target ring | C3 (folded), E3 (verify) |
| 13 | Contrast (slate-400 / slate-500) | A3, C4, C6, E4 |
| polish | Mode toggle placement | C2 |
| polish | Two ChapterNav rows | C2 |
| polish | λ glyph meaning only in title | E5 |
| polish | Two popovers open at once | B2 (Greek side), E6 (English side) |
| polish | Tap targets (words, swatches) | B2/D1 (words), D4 (swatches) |
| polish | Highlight boxiness | B2 (padding), E7 (optional) |
| 14 | Greek spacing/punctuation | Retracted — no task (verified clean) |

**Feature requests (F–H):**

| Request | Decision | Task(s) |
|---------|----------|---------|
| Type a passage reference (in addition to dropdowns) | Coexists with dropdowns; supports `Book C` and `Book C:V` | F1, F2 |
| Continuous reading mode | Second axis; single-language only (Parallel disables it); keep word-tap + highlights; hide per-verse note editors | G1–G5 |
| See notes from the Read page | Drawer + in-popover lists; full edit/delete inline | H1–H5 |

**Type/name consistency check:** `ReaderMode` is defined once in `lib/readerPrefs.ts` and imported everywhere; cookie names (`READER_MODE_COOKIE`, `LAST_PASSAGE_COOKIE`, `introCookieName`) are referenced consistently across `page.tsx`, `BibleReader.tsx`, `ReaderLocationMemo.tsx`, `DismissibleIntro.tsx`. `highlightToken(verse, token, color)` and `highlightEnglishWord(verse, wordIndex, color)` signatures match their call sites. `MorphologyPopover`'s `onHighlight` prop matches the `highlightToken` adapter passed from `BibleReader`. `FOCUS_RING` / `FOCUS_RING_INPUT` names match across all consumers. `chapterLabel` (required prop) is supplied by `page.tsx` and by every test that renders `BibleReader`. For the feature phases: `ReaderLayout` is defined once in `lib/readerPrefs.ts`; `parsePassageQuery` lives in `lib/references.ts`; `GreekToken`/`EnglishWords`/`ReaderVerse`/`ReaderToken` are exported from `components/readerTokens.tsx` (Phase G) and imported by both `BibleReader` and `ContinuousReader`; `NoteList`'s `onChanged: () => void` matches every call site; `onNotesChanged?` (optional) threads `BibleReader → GreekToken → MorphologyPopover`; and the drawer item shape (`{ id, title, body, tags, reference, verse }`) matches `DrawerNote`. **Router caveat:** Task B2 removes `useRouter` from both `BibleReader` and `MorphologyPopover` (highlights became optimistic). Phase G5 (and Phase H, if G is skipped) re-introduces it **in `BibleReader` only** — `const router = useRouter()` — for `router.refresh()` on note mutations; `MorphologyPopover` does not regain `useRouter` (it invokes the `onNotesChanged` callback supplied by `BibleReader`).

**Placeholder scan:** No incomplete-but-compilable code is presented as final. The deliberately-flagged Step 3 sketch in Task B2 is corrected in Step 4. Task G5 Step 2 is a mechanical "wrap the existing block" edit: the study `<article>` body is never retyped — it is referenced via non-compilable `/* … */` / `<ContinuousReader … />` ellipsis markers that explicitly denote existing or already-shown code, so a worker cannot copy a blank `<article>`. Likewise, "move the type as it exists" (G3) and "the existing study verse map, unchanged" directives point at prior-task output rather than re-stating it.

---

## Final Verification (run once, after all phases)

- [ ] `npm run test:unit` — all unit tests green.
- [ ] `npx tsc --noEmit --pretty false` — no type errors.
- [ ] `npm run lint` — no warnings.
- [ ] Run skill (Playwright): sign in, load `/read`, confirm no first-paint flash, sticky bar wayfinding, inline verse numbers, single corpus header, on-demand notes, optimistic highlight (no full-page refetch), capped measure in single-column modes, visible `focus-visible` rings on Tab-through, and reduced-motion honored. Read-only — do not save notes/highlights against a shared DB unless intended.
- [ ] Run skill (Playwright), feature phases: type `John 3:16` in the reference field and confirm navigation; switch to Greek-only → Continuous and confirm flowing prose with superscript numbers and no per-verse note editors, then confirm Continuous is disabled in Parallel; open the notes drawer, jump to a verse, and edit/delete a note; confirm token notes appear in the morphology popover. (Note creation/edit/delete writes to the DB — use a throwaway note or the intended account.)
- [ ] Confirm `scripts/acceptance-test.js` passes after the `getReaderPassage` shape change (`npm run test:acceptance`, per the corpus-count caveat).
- [ ] `npm run verify` before opening the PR(s).
