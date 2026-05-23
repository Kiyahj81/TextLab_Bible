# Pass 2 — Layout & Sizing

Reviewed: 2026-05-23
Branch: main (clean)
Scope: Reader, Search, Notes, Assistant + global shell
Method: source review of every in-scope component + live HTML inspection at `http://localhost:3000`

## Summary

- Critical: 1 (1 fixed ✅)
- Moderate: 6 (3 fixed ✅)
- Minor: 5 (4 fixed ✅)
- **Total: 12 (8 fixed: 1 in PR2, 2 in PR5, 5 in PR6)**

---

## Findings

### F-2.1 — `MorphologyPopover` is hard-pinned to `left-0`; overflows viewport for right-side tokens and on mobile ✅ Fixed in PR2
- **View:** Reader, Search (popover is shared)
- **File:** `components/MorphologyPopover.tsx:76`
- **Severity:** critical
- **Problem:** `absolute left-0 top-full mt-2 w-80` (320 px) anchors the popover to the *left* edge of every token. For tokens near the right viewport edge — common at end-of-line — the popover extends past the viewport and gets clipped, or it forces horizontal page scroll. At ≤375 px viewports (iPhone SE), the popover overflows on every token because the page padding is `px-4` and the popover is fixed at 320 px wide.
- **Repro / evidence:** Open `/read?book=John&chapter=1`, click the last word of verse 5 (αὐτὸ). The popover's right edge is past the main column. Source: only `left-0` positioning exists; no flip/clamp logic.
- **Suggested fix:** Adopt position-aware positioning. Two options:
  1. Quick: compute `tokenRect.right > window.innerWidth - 320` and apply `right-0` instead of `left-0` (toggle via local state in `BibleReader`).
  2. Robust: use Floating UI (`@floating-ui/react`) with `flip` + `shift` middleware. Same library Tailwind UI uses.

### F-2.2 — Search filter row packs 7 controls into one md-row, then collapses to 7 stacked rows below md
- **View:** Search
- **File:** `components/SearchPanel.tsx:95`
- **Severity:** moderate
- **Problem:** `grid gap-3 md:grid-cols-[150px_1fr_150px_120px_150px_120px_auto]` is dense even at md (768 px) — `Chapter` and `Page size` columns are 120 px each, and "Morph match" label wraps. Below md, every control becomes its own row → 7-row stack before results. Cognitive load is high for what should be a quick-action form.
- **Repro / evidence:** Resize to 768 px in DevTools — labels start truncating; at 700 px the grid breaks down.
- **Suggested fix:** Two-tier disclosure. Top tier always visible: Mode, Query, Search button. Secondary controls (Book, Chapter, Page size, Morph match) tucked under a "Filters" toggle / expandable panel. Reduces visual noise and matches the dominant search action.

### F-2.3 — Assistant retrieval-trace code blocks overflow the 360 px sidebar ✅ Fixed in PR6
- **View:** Assistant
- **File:** `components/AiAssistant.tsx:178-181`
- **Severity:** moderate
- **Problem:** Trace entries render inside `<code class="block rounded bg-stone-100 p-2">` with no overflow rules. Real entries look like `searchMorphology({"morphCode":"V-PAI-3S","matchMode":"prefix","book":"John"})` — easily 60+ chars. The 360 px sidebar (lg breakpoint) can't fit them, and they wrap awkwardly inside the rounded card or overflow horizontally.
- **Suggested fix:** Add `overflow-x-auto whitespace-nowrap` on the `<code>` so each trace becomes scrollable horizontally. Optionally tooltip/expand on click. If we want wrapping instead, add `break-all`.

### F-2.4 — Reader 2-column grid only at lg+; tablet portrait stacks English below Greek with no parallel view
- **View:** Reader
- **File:** `components/BibleReader.tsx:95`
- **Severity:** moderate
- **Problem:** `grid gap-4 lg:grid-cols-2` means at <1024 px the English translation appears *below* the Greek block for every verse. iPad portrait (768 px wide) — a primary study form factor — loses the parallel reading layout. With multi-verse passages, English is far below the Greek text.
- **Suggested fix:** Lower the breakpoint to `md:grid-cols-2` (768 px). For sub-md, consider a tab toggle ("Greek / English / Both") rather than fixed stacking.

### F-2.5 — Greek-token touch targets are below mobile minimum (~24–28 px tall)
- **View:** Reader
- **File:** `components/BibleReader.tsx:103-111`
- **Severity:** moderate
- **Problem:** Tokens are `<button className="mx-0.5 rounded px-1 py-0.5">` — vertical padding totals ~4 px on top of 1.45 rem (~23 px) text. Short particles (ὁ, ἡ, ὃς) tap-target out at ~12-16 px wide. WCAG 2.1 minimum is 24×24 px (AAA: 44×44). Mobile users — particularly with thumbs — will mis-tap onto adjacent tokens.
- **Suggested fix:** Increase to `px-1.5 py-1` for >40 px height, and consider `min-w-[24px]` for narrow tokens. Adjust line height (`leading-10` is fine, gives 40 px line box).

### F-2.6 — `app/notes` has no pagination or list virtualization; all notes render at once ✅ Fixed in PR5
- **View:** Notes
- **File:** `app/notes/page.tsx:9-16`, `components/NotesPanel.tsx:79-141`
- **Severity:** moderate
- **Problem:** `prisma.note.findMany` with no `take`. NotesPanel renders the entire list as full editable articles (each with title input, body textarea ~100 px tall, save/delete buttons). At ~30 notes the page is already a long scroll; at 100+ notes the page will be a layout-and-typing latency problem.
- **Suggested fix:** Server-side pagination (default 25 per page, `take`/`skip` from URL). Optionally collapse each note by default (header only) with click-to-expand.

### F-2.7 — Notes textareas have no max-height; large note bodies push siblings off-screen ✅ Fixed in PR5
- **View:** Notes
- **File:** `components/NotesPanel.tsx:130-138`
- **Severity:** moderate
- **Problem:** `min-h-28` (~112 px) but no max-height. A pasted study note of 500 words renders as a single uncapped textarea that occupies most of the viewport. The text area is *also* scrollable internally — so the visual cue ("this is one note") gets lost.
- **Suggested fix:** `min-h-28 max-h-72 overflow-auto` on the textarea. If we want autosize-on-content, add a small autosize utility (~10 lines) but cap at 50% viewport height.

### F-2.8 — Generated-notes history uses `line-clamp-3` with no expand affordance ✅ Fixed in PR6
- **View:** Assistant
- **File:** `components/AiAssistant.tsx:213-220`
- **Severity:** minor
- **Problem:** Each history card clamps the answer at 3 lines. There is no expand/collapse, no link to view the full note, and clicking the card does nothing — so the rest of the answer is effectively unreadable from this view. Users must re-ask the question to see the full output again.
- **Suggested fix:** Wrap each card in a button or expandable `<details>` that reveals the full `note.answer`. Alternatively, clicking a history card should rehydrate the main answer pane.

### F-2.9 — Markdown export textarea uses `text-xs`; hard to scan ✅ Fixed in PR6
- **View:** Assistant
- **File:** `components/AiAssistant.tsx:226-233`
- **Severity:** minor
- **Problem:** Read-only `<textarea readOnly value={response.markdown} className="... text-xs ...">` is 12 px text. Below recommended body-text size; users squint to verify the export before copying.
- **Suggested fix:** `text-sm` (14 px) and switch to monospace via Tailwind `font-mono` for markdown clarity.

### F-2.10 — Assistant layout has no md breakpoint; sidebar only appears at lg+ (≥1024 px) ✅ Fixed in PR6
- **View:** Assistant
- **File:** `components/AiAssistant.tsx:107`
- **Severity:** minor
- **Problem:** `grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]` — between md and lg (768-1023 px, common for tablet landscape), the trace/citations/notes/markdown columns all drop below the main pane, forcing significant scroll after every answer.
- **Suggested fix:** Add `md:grid-cols-[minmax(0,1fr)_280px]` as an intermediate; the 280-px sidebar fits at md without crowding the answer.

### F-2.11 — `<pre>` answer block uses `whitespace-pre-wrap` only; long unbroken tokens (URLs, lemma chains) can overflow ✅ Fixed in PR6
- **View:** Assistant
- **File:** `components/AiAssistant.tsx:164`
- **Severity:** minor
- **Problem:** `whitespace-pre-wrap` wraps on whitespace, but a long URL or compound lemma string with no spaces causes horizontal overflow of the response card. The card itself doesn't have `overflow-x-auto`, so it pushes the whole grid wider.
- **Suggested fix:** Add `break-words` (CSS `overflow-wrap: anywhere`) to the `<pre>` so long unbroken sequences wrap.

### F-2.12 — Reader top-row layout (title + ReaderControls) wraps awkwardly at narrow widths
- **View:** Reader
- **File:** `app/read/page.tsx:21-29`, `components/ReaderControls.tsx:27`
- **Severity:** minor
- **Problem:** The header section is `flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between`. On a narrow sm-and-above screen (e.g. 640–700 px), the controls form takes ~360 px and the title + description ~280 px, with `items-end` pushing controls to baseline. The book dropdown can wrap onto a second row mid-form (book + chapter on row 1, "Open" button on row 2) without alignment guides.
- **Suggested fix:** Either keep `flex-col` until md (`md:flex-row`), or make the controls form `grid grid-cols-3` so book/chapter/Open never wrap.
