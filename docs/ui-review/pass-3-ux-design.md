# Pass 3 — UX & Design Quality

Reviewed: 2026-05-23
Branch: main (clean)
Scope: Reader, Search, Notes, Assistant + global shell
Method: source review of every in-scope component + live HTML inspection at `http://localhost:3000`

## Summary

- Critical: 2 (1 fixed ✅)
- Moderate: 15 (5 fixed ✅)
- Minor: 11 (5 fixed ✅)
- **Total: 28 (11 fixed: 2 in PR2, 3 in PR4, 2 in PR5, 4 in PR6)**

Note: F-3.1 through F-3.16 are UX findings (interaction, hierarchy, primary-use-case friction). F-3.17 through F-3.28 are **design-identity findings** added via a second pass through the `frontend-design` skill lens — covering visual identity, typography, color system, motion, and distinctive-pattern gaps that the first pass de-prioritized.

---

## Findings

### F-3.1 — Reader has no Previous / Next chapter affordance; sequential reading is dropdown-only ✅ Fixed in PR2
- **View:** Reader
- **File:** `components/ReaderControls.tsx:27-46`, `app/read/page.tsx:19-33`
- **Severity:** critical (against the *primary use case*: reading a book sequentially)
- **Problem:** To move from John 1 to John 2 the user must open the chapter dropdown, scroll, select chapter 2, then click "Open". Three deliberate interactions to do the single most-frequent action in any Bible reader. No keyboard arrows, no swipe, no in-flow links.
- **Suggested fix:** Add prominent `← Previous chapter` / `Next chapter →` link buttons in the Reader header (next to or below `ReaderControls`). They are simple `<Link href="/read?book=X&chapter=N±1">`. Disable at book boundaries; optionally roll over to the next/previous book. Bind ←/→ keys at the page level.

### F-3.2 — Greek tokens are clickable buttons but look identical to inline text
- **View:** Reader
- **File:** `components/BibleReader.tsx:103-111`
- **Severity:** moderate
- **Problem:** Tokens render as `<button>` (good for a11y) but have no static visual affordance — no underline, no color, no caret, no icon. The only cue is `hover:bg-blue-100` which (a) requires hover, so it's invisible to touch users, and (b) is a faint blue tint discovered only by scrubbing. New users may not realize the entire reading surface is clickable.
- **Suggested fix:** Apply a quiet but persistent affordance — e.g. `border-b border-dotted border-slate-300` on tokens, deepening to `border-slate-700` on hover. Or set token text to `text-slate-900` while surrounding non-token Greek (rare here) stays `text-slate-600`. Keep it subtle so the page doesn't look like every word is underlined.

### F-3.3 — Highlight is a single yellow color with no categorization
- **View:** Reader, MorphologyPopover
- **File:** `components/BibleReader.tsx:57` (`color: "#fde68a"`), `components/MorphologyPopover.tsx:67` (same)
- **Severity:** moderate
- **Problem:** Every highlight is identical yellow. There's no way to color-code by theme (e.g. promises = blue, commands = red), which is the primary reason long-form study readers highlight at all. The backend schema already accepts `color`, so this is purely a missing UI affordance.
- **Suggested fix:** Replace the single "Highlight" button with a small palette dropdown — 5 colors covering common categories (yellow / blue / green / red / purple) — clicking applies that color. Persist the last-used color as the default per user. Tie color → tag if categories are needed.

### F-3.4 — "Morph match" toggle is shown for every search mode but only respected by morphology ✅ Fixed in PR4
- **View:** Search
- **File:** `components/SearchPanel.tsx:133-143`, `app/search/page.tsx:20`
- **Severity:** moderate
- **Problem:** The Exact/Prefix dropdown is always rendered. The server ignores it unless `mode === "morphology"`. A user doing a lemma search with the toggle visibly set to "Prefix" reasonably believes their search is being lemma-prefix-matched. It isn't.
- **Suggested fix:** Conditionally show the "Morph match" control. Two paths:
  1. Make `mode` a client `useState`, and conditionally render the morph-match column when `mode === "morphology"`.
  2. Move morph-specific fields into a separate row that appears only when the morphology mode is selected.

### F-3.5 — Saved searches have no delete / rename / clear-all affordance; list grows unbounded ✅ Fixed in PR4 (delete + rename; clear-all deferred)
- **View:** Search
- **File:** `components/SearchPanel.tsx:237-263`, `app/api/saved-searches/route.ts` (no DELETE handler)
- **Severity:** moderate
- **Problem:** Save adds to the sidebar; nothing removes from it. The display caps at 25, the DB is uncapped. Auto-labels (`"lemma: λόγος"`) repeat for identical searches at different chapters. No edit. The sidebar will fill with cruft within a week of normal use.
- **Suggested fix:**
  - Backend: add `DELETE /api/saved-searches/[id]` and `PATCH` for rename.
  - UI: tiny `×` per card, an "Edit" pencil for rename, and a low-emphasis "Clear all" link below the list.
  - Optional: dedupe at save time (if an identical mode+query+book+chapter+matchMode already exists, update its `updatedAt` instead of inserting).

### F-3.6 — Assistant has no loading skeleton / spinner; only button text changes for 5–10+ s ✅ Fixed in PR6
- **View:** Assistant
- **File:** `components/AiAssistant.tsx:117-123`
- **Severity:** moderate
- **Problem:** While waiting on `/api/assistant`, the only visible change is the button text "Retrieving..." and the disabled state. The main pane below is unchanged. With live OpenAI synthesis the round-trip is 5-10 s; users will retry or navigate away assuming the click didn't register.
- **Suggested fix:** Add a `Loader2` (lucide) `animate-spin` icon next to "Retrieving...". In the answer card area, show a brief skeleton (3 grey bars) while loading. Optionally stream the answer (`ReadableStream` from OpenAI) so partial text shows immediately — but that's a bigger feature than this report scopes.

### F-3.7 — Token highlight click doesn't visually confirm; user can't see what was highlighted ✅ Fixed in PR2
- **View:** Reader
- **File:** `components/MorphologyPopover.tsx:62-71`, `components/BibleReader.tsx:106-108`
- **Severity:** moderate (overlaps with F-1.8; rephrased for UX framing)
- **Problem:** The status text "Highlight saved." appears in the popover, but the token underneath still looks unhighlighted (no yellow background). Without a page reload, the user has no visual confirmation that their highlight applied to the correct word. For a primary study action this is jarring.
- **Suggested fix:** See F-1.8 — optimistic local state, or `router.refresh()` after success.

### F-3.8 — Status messages don't auto-dismiss; UI accumulates stale "saved" / "could not" text
- **View:** Reader, MorphologyPopover, Notes, Assistant, Search
- **File:** `components/BibleReader.tsx:43-46, 60-63, 154`; `components/MorphologyPopover.tsx:54-58, 69-70, 141`; `components/NotesPanel.tsx:41-44, 51-53, 139`; `components/AiAssistant.tsx:163`; `components/SearchPanel.tsx:69-86, 180`
- **Severity:** moderate
- **Problem:** Success/error strings ("Note saved.", "Could not save.", "Search saved.") appear under their respective forms and remain until the next action that overwrites them. After several edits the UI is dotted with stale messages, none of which are current.
- **Suggested fix:** Auto-clear success messages after ~3 s via `setTimeout` (clear on next status update). Keep error messages until user interacts with the offending control again. Or move all transient feedback to a single global toast surface (one component, one state slot).

### F-3.9 — Sample prompt is hardcoded into the Assistant textarea on first load ✅ Fixed in PR6
- **View:** Assistant
- **File:** `components/AiAssistant.tsx:35-38`
- **Severity:** moderate
- **Problem:** `const samplePrompt = "Show me every use of logos in John 1 and summarize the pattern."` is set as the initial `prompt` value. If the user lands on `/assistant` and clicks "Ask assistant" without editing, they get the answer to *that* example rather than their own question. The example also obscures whether the textarea is empty (placeholder-like, but actually content).
- **Suggested fix:** Move the sample to the `placeholder` attribute (so it shows greyed out until the user types) and start with `useState("")`. Optionally add a small "Try an example" link below the form that fills the textarea on click.

### F-3.10 — Live / Local-fallback indicator is typographically the *smallest* element in the answer card ✅ Fixed in PR6
- **View:** Assistant
- **File:** `components/AiAssistant.tsx:132-134`
- **Severity:** moderate
- **Problem:** Whether the answer came from live OpenAI synthesis (`Live`) or local heuristic fallback (`Local fallback`) is a primary trust signal. It renders in `text-xs text-slate-500` — the smallest, lightest text on the page — adjacent to model role and ID strings. Users can miss the indicator entirely.
- **Suggested fix:** Promote to a small badge next to the "Answer" header:
  - `Live` → `inline-flex rounded-full bg-emerald-50 text-emerald-800 px-2 py-1 text-xs font-medium`
  - `Local fallback` → `bg-amber-50 text-amber-800`
  - Model role / id can stay subtle below.

### F-3.11 — Routing-decision panel uses 11 px text on bg-stone-50; near-illegible at a glance ✅ Fixed in PR6
- **View:** Assistant
- **File:** `components/AiAssistant.tsx:155-162`
- **Severity:** minor
- **Problem:** `text-xs text-slate-600` on `bg-stone-50` for the routing decision (e.g. multi-line reasoning + recommended upgrade text). Insufficient contrast; small text. Users skim past it.
- **Suggested fix:** Bump to `text-sm`, contrast to `text-slate-700`. Consider collapsing into a `<details>` so it doesn't always occupy header space.

### F-3.12 — Saved-search auto-labels collide; no rename or context ✅ Fixed in PR4
- **View:** Search
- **File:** `app/api/saved-searches/route.ts:30`, `components/SearchPanel.tsx:240-258`
- **Severity:** minor
- **Problem:** Labels default to `${mode}: ${query}`. Two saves of `λόγος` in lemma mode (one filtered to John, one to all books) both display the same label. The secondary line shows `mode + book scope` but the *primary* label is the same — users can't tell them apart without clicking.
- **Suggested fix:** Either include book/chapter in the auto-label, or expose an inline rename. Even better: at save time, prompt for an optional name.

### F-3.13 — Notes panel cannot be sorted; can't see most-recently-edited first vs by reference ✅ Fixed in PR5
- **View:** Notes
- **File:** `components/NotesPanel.tsx`, `app/notes/page.tsx:15`
- **Severity:** minor
- **Problem:** Server orders by `updatedAt: "desc"` and the panel renders that order. There is no sort toggle for "by reference (canonical)" or "by title" or "by tag". For long lists of notes attached to a specific book, canonical sorting is the natural reading order.
- **Suggested fix:** Add a small sort dropdown ("Most recent / Canonical / Title"). Easy server-side change.

### F-3.14 — Note links from /notes lose verse anchor — Reader doesn't scroll to the note's verse ✅ Fixed in PR5
- **View:** Notes → Reader navigation
- **File:** `components/NotesPanel.tsx:84-89`, `app/read/page.tsx:9-17`
- **Severity:** minor
- **Problem:** Clicking a note's reference takes the user to `/read?book=John&chapter=1` (no verse). The Reader has no `?verse=` param support and no auto-scroll behavior. For a note attached to Romans 8:28, the user lands at Romans 8:1 and has to scroll.
- **Suggested fix:** Add a `verse` query param to the link and to `ReadPage`. Inside `BibleReader`, scroll to `#verse-${id}` on mount if present. Also add `id="verse-${id}"` to each verse `<article>`.

### F-3.15 — Reader has no toggle for Greek-only / English-only / both; the parallel view is mandatory
- **View:** Reader
- **File:** `components/BibleReader.tsx:95-130`
- **Severity:** minor
- **Problem:** Some study workflows want Greek-only (translation hidden) for retention practice; others want English-only after looking up a word. The current layout forces both, always.
- **Suggested fix:** Add a 3-way segmented control (Greek | English | Parallel) in the Reader header. Persist preference in localStorage.

### F-3.16 — Reader description copy is generic ("sample" wording) and not load-bearing
- **View:** Reader
- **File:** `app/read/page.tsx:24-26`
- **Severity:** minor
- **Problem:** "Read imported or sample Greek text beside English and click Greek words for morphology." occupies a third of the header on smaller widths and adds no information after the first visit. The same kind of stale description text appears on `/search`, `/notes`, `/assistant`.
- **Suggested fix:** Either (a) drop the descriptions on return visits via a one-time dismiss, or (b) shrink them to a single line under `text-sm`. The first-time-user case can be served better by an empty-state on each panel.

---

## Design Identity Findings (Frontend-Design Lens)

The following findings come from applying the `frontend-design` skill's audit lens to the existing UI. They focus on **visual identity, typography, color system, motion, and distinctive patterns** — qualities the first pass treated as secondary to interaction. Severity here reflects impact on the product's *aesthetic point of view*, not bugs.

### F-3.17 — App has no visual identity beyond Tailwind defaults; reads as a starter template
- **View:** Global
- **File:** `app/globals.css:1-39`, `app/layout.tsx:18-42`, every component card
- **Severity:** critical (against design-identity goals)
- **Problem:** The interface uses Tailwind's default `slate-*` and `stone-*` palettes, default Lucide icons, and a stamped "rounded-md border border-stone-300 bg-white shadow-sm" card on every surface. Nothing in the visual language signals "scholarly Greek + English Bible reader" — the same shell could be a starter dashboard, a CRUD CMS, or a documentation site. The product is a unique niche (corpus-backed Greek-and-English study tool) and currently looks like none of it.
- **Repro / evidence:** Open any of the four routes side-by-side; the only thing that changes is the h1 text. `globals.css` defines no fonts, no decorative tokens, no atmospheric variables — only base resets and `.greek-text` for serif fallback.
- **Suggested fix:** Establish a clear aesthetic direction (editorial / scholarly / codex). Concretely: load a distinctive display serif via `next/font/google` (Spectral, EB Garamond, or DM Serif Display), define a stronger color palette anchored on the existing `--accent: #365f7e`, and break the card-stamp pattern at least on the Reader (the signature surface).

### F-3.18 — Defined accent color (`--accent: #365f7e`) is unused; primary actions all default to `bg-slate-900`
- **View:** Global
- **File:** `app/globals.css:12`; consumer evidence at `components/BibleReader.tsx:149`, `components/MorphologyPopover.tsx:135`, `components/AiAssistant.tsx:148` (these three places use the accent inline), vs. `components/SearchPanel.tsx:155`, `components/ReaderControls.tsx:44`, `components/NotesPanel.tsx:105`, `components/AiAssistant.tsx:119` which all use `bg-slate-900`.
- **Severity:** moderate
- **Problem:** A real accent is defined in CSS variables but only three buttons in the entire app use it (and those use the literal hex via `bg-[#365f7e]`, not a Tailwind token, so the connection to the variable is invisible to the maintainer). All other primary buttons use Tailwind's `bg-slate-900` (near-black). The accent has no chance to feel like the brand color because it's used in <10% of the contexts where it should appear.
- **Suggested fix:** Add `accent: '#365f7e'` (and tints) to `tailwind.config.ts`. Replace `bg-slate-900` on primary action buttons with `bg-accent`. Use accent for active nav state in the header, for focused input borders (replacing `focus:border-slate-600`), and for verse-number markers. Reserve `bg-slate-900` for true high-emphasis confirmation (currently overused).

### F-3.19 — No `next/font` loading; body type stack is system sans-serif (Arial/Helvetica) — the AI-template look
- **View:** Global
- **File:** `app/layout.tsx:1-43` (no font import), `app/globals.css:30-35` (resets only), Tailwind default sans stack inherited
- **Severity:** moderate
- **Problem:** The body has no custom font. It falls back to the system sans stack, which on Windows is Arial, on macOS is San Francisco, on Linux is whatever. This is the single biggest "AI-generated UI" tell. For a product whose primary content is text (Greek + English Bible verses + study notes), the typography should be the design statement.
- **Suggested fix:** Use `next/font/google` to load a distinctive editorial serif for body (e.g. **Spectral**, **Lora**, **Crimson Pro**, **EB Garamond**) and pair it with a refined sans for UI chrome (e.g. **Inter Tight**, **DM Sans**, **Söhne**-style — avoid generic Inter). Define both via Tailwind's `theme.fontFamily.serif` and `.sans`. The Reader specifically deserves the serif treatment edge-to-edge.

### F-3.20 — Greek serif and English sans look like two different products bolted together
- **View:** Reader, Search (token results), Notes (token references)
- **File:** `app/globals.css:37-39`, `components/BibleReader.tsx:98, 129`, `components/MorphologyPopover.tsx:79, 93`
- **Severity:** moderate
- **Problem:** `.greek-text` uses `Georgia, Cambria, "Times New Roman", serif`. The English column uses the inherited sans. Side-by-side, the Greek looks scholarly and the English looks like a settings page. The parallel-reading experience — the product's signature — feels visually fractured.
- **Suggested fix:** Either pair Greek and English in matched serifs (Greek: a Greek-capable serif like **GFS Didot**, **Cardo**, or **Gentium**; English: a body serif from the same family or a complementary pair), OR treat the English as the more "set" voice and the Greek as the manuscript voice with subtle differentiation in size/weight. Avoid the current "serif vs sans" dichotomy.

### F-3.21 — Card pattern stamped on every surface; no semantic visual differentiation
- **View:** Reader, Search, Notes, Assistant
- **File:** Search the repo: `border border-stone-300 bg-white` appears 16+ times across components. Examples: `components/BibleReader.tsx:79`, `components/MorphologyPopover.tsx:76`, `components/SearchPanel.tsx:94, 162, 237`, `components/NotesPanel.tsx:58, 81, 143`, `components/AiAssistant.tsx:109, 128, 167, 174, 189, 209, 226`.
- **Severity:** moderate
- **Problem:** A verse, a search result, a saved-search entry, a note, the chat input, the AI answer, the retrieval trace, the citations, and the markdown export all live inside the same `rounded-md border border-stone-300 bg-white shadow-sm` shell. The information architecture is rich (verses ≠ commentary ≠ search hits ≠ AI traces) but the visual treatment flattens all of it into one bucket.
- **Suggested fix:** Differentiate by content type. A few examples:
  - Verses: borderless or with a thin left-rule (like a manuscript margin), Greek slightly larger, English in a quieter weight.
  - AI answer: distinct background tone (e.g., faint accent-tinted card) to signal "generated content."
  - Retrieval trace: monospace block with a code-editor aesthetic, no card.
  - Saved searches: list rows with bottom-borders, not a stack of boxed cards.

### F-3.22 — Every route opens with the same h1 + description block; no surface-specific identity
- **View:** Reader, Search, Notes, Assistant
- **File:** `app/read/page.tsx:21-29`, `app/search/page.tsx:62-68`, `app/notes/page.tsx:36-43`, `app/assistant/page.tsx:15-22`
- **Severity:** moderate
- **Problem:** Every route opens identically: `<h1 className="text-3xl font-semibold text-slate-950">{label}</h1>` plus a one-sentence description. Reader, Search, Notes, Assistant feel like four chapters of the same admin app rather than four distinct workspaces. The Reader (where users spend most of their time) gets no extra typographic or compositional weight.
- **Suggested fix:** Give the Reader a different opening — maybe a large, set, book+chapter title in display serif (e.g., `Κατὰ Ἰωάννην 1` / `John 1` in a typographic stack) without the generic h1 chrome. Strip the description on return visits (one-time dismiss). For Search/Notes/Assistant, use the same h1 pattern but reserve the display treatment for the Reader.

### F-3.23 — No motion anywhere; popovers snap, hovers flip, content materializes
- **View:** Global, especially Reader popover
- **File:** Repo-wide — `transition`, `animate`, and `duration` classes are absent from all in-scope components. Specific high-impact misses: `components/MorphologyPopover.tsx:76` (no entrance), `components/BibleReader.tsx:103-111` (no hover transition), `components/AiAssistant.tsx:127-165` (no answer entrance), `app/layout.tsx:26-36` (nav links flip color instantly).
- **Severity:** moderate
- **Problem:** Motion is one of the cheapest ways to make a UI feel built rather than scaffolded. Currently the popover snaps in/out, the token hover background flips instantly, and the AI answer materializes with no entrance. The cumulative effect is "static" — like reading a PDF with hover states.
- **Suggested fix:** Add small, considered transitions:
  - Token hover: `transition-colors duration-150`.
  - Popover: a subtle scale+fade entrance (`origin-top scale-95 opacity-0 → scale-100 opacity-100`, 120 ms).
  - AI answer: a staggered fade for the answer card (`opacity-0 translate-y-1 → ...`, 200 ms with a small delay for the buttons).
  - Highlight save: a brief background-pulse on the highlighted verse on success.
  Keep it restrained — overshooting becomes distracting in a reading tool.

### F-3.24 — Verse references are styled identically to section labels; the primary content unit gets no typographic moment
- **View:** Reader, Search (result references), Notes (note references)
- **File:** `components/BibleReader.tsx:84` (`text-sm font-semibold uppercase tracking-wide text-slate-500`), compare `components/BibleReader.tsx:97, 126` (corpus label uses literally the same classes), `components/SearchPanel.tsx:188`, `components/NotesPanel.tsx:87`.
- **Severity:** minor
- **Problem:** "John 1:1" should be a typographic event in a Bible app — it's the indexing scheme for the entire corpus. Today it shares its styling with the SBLGNT/WEB corpus labels and the form-field labels. It blends in.
- **Suggested fix:** Set the reference in the display serif at a larger size with letterforms that catch the eye (e.g., small caps for the book name, oldstyle figures for the numbers: "John 1:1" with `font-variant-numeric: oldstyle-nums`). Corpus labels (SBLGNT, WEB) can stay as the muted section labels they currently are.

### F-3.25 — Token highlight is the only personality color used; otherwise the palette is stone/slate
- **View:** Reader, Notes
- **File:** `components/BibleReader.tsx:57, 80, 107`, `components/MorphologyPopover.tsx:67`
- **Severity:** minor (overlaps F-3.3 thematically)
- **Problem:** `#fde68a` yellow is the only chromatic note in an otherwise grayscale palette. It does its job, but coupled with no accent usage (F-3.18), the highlight reads as the *only* color in the app — making highlighted verses feel like an aberration rather than part of a designed system.
- **Suggested fix:** Either commit to a richer palette (highlight + accent + 2 secondary tones for tags / morph badges / corpus markers) or commit to monochrome and use weight/spacing for emphasis instead.

### F-3.26 — Page background is solid `#f6f5f1`; no atmospheric depth, no scholarly-paper texture
- **View:** Global
- **File:** `app/globals.css:7, 20`
- **Severity:** minor
- **Problem:** The body bg is a warm cream — a thoughtful choice for sustained reading — but it's a flat fill. There is no rule line, no paper texture, no margin grid, no chapter ornament. A reading tool can earn distinction with very subtle atmospheric layers (paper grain, edge vignetting, faint dotted rules in the margin).
- **Suggested fix:** Add a very subtle SVG-based paper grain to `body` (5–8% opacity noise). Optionally a thin rule line down the center of the reader's parallel grid to anchor the parallel structure. Restraint is key — atmosphere, not decoration.

### F-3.27 — Lucide icons used at face value; no domain-specific glyphs to signal the product category
- **View:** Global
- **File:** `components/SearchPanel.tsx:4, 156, 177`, `components/AiAssistant.tsx:3, 121, 142, 150`, `components/BibleReader.tsx:3`, `components/MorphologyPopover.tsx:4`, `components/NotesPanel.tsx:4`
- **Severity:** minor
- **Problem:** Search, Send, Save, Trash2, Download, BookmarkPlus, Highlighter, NotebookPen — every icon is the Lucide default for that abstract action. There is no glyph that says "lemma", no glyph for "cross-reference," no codex / scroll mark that would anchor the AI Assistant's identity as a *study* tool rather than a generic chat. Generic icons are the third-biggest AI-template tell after Inter and slate-900 buttons.
- **Suggested fix:** Either commission/build a small set of domain-specific glyphs (lemma λ-mark, morphology dot-grid, cross-reference arrows) and use them in the popover and search-mode dropdown, OR pick a more characterful icon set (Phosphor, Tabler with `stroke-width-1`) and treat icons more sparingly. Lucide everywhere is fine; Lucide as the *only* visual language is the problem.

### F-3.28 — Right-sidebar-for-secondary-info is the universal SaaS pattern, applied without adaptation
- **View:** Search, Assistant
- **File:** `components/SearchPanel.tsx:92` (`xl:grid-cols-[minmax(0,1fr)_320px]`), `components/AiAssistant.tsx:107` (`lg:grid-cols-[minmax(0,1fr)_360px]`)
- **Severity:** minor
- **Problem:** Both surfaces shape secondary info (saved searches, retrieval trace, citations) into a fixed-width right sidebar. This is the standard SaaS / docs layout. It works, but a scholarly Bible tool has the opportunity to feel more like a codex (marginalia in a left or right *gutter*, lower visual weight, closer to the primary content) rather than a workspace with a sidebar.
- **Suggested fix:** Consider a margin-gutter approach — narrower (180–220 px), no card chrome, left-rule separating the gutter from the main column, smaller type. Reads as commentary alongside the text rather than a parallel SaaS panel.

---



- **Empty states across views are unstyled paragraphs** ("No retrieval has run yet.", "No saved searches yet.", "No notes match the current filters."). Each view would benefit from an empty-state illustration or icon + a short "Try X" hint that points to the primary action.
- **No keyboard shortcuts anywhere.** Power users — the likely audience for a corpus-backed Greek tool — get no `?` help, no `/` to focus search, no `Esc` to close popovers, no `←/→` to navigate chapters. Worth scoping a small shortcut layer separately.
- **No persistent user preferences** (theme, font size, default search mode, default highlight color). Several findings above reference settings that would naturally belong to a small Settings page.
