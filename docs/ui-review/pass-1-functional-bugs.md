# Pass 1 — Functional Bugs

Reviewed: 2026-05-23
Branch: main (clean)
Scope: Reader, Search, Notes, Assistant + global shell
Method: source review of every in-scope component + live behavioral probes against `http://localhost:3000` (Docker + `npm run dev` running)

## Summary

- Critical: 4 (4 fixed ✅)
- Moderate: 6 (4 fixed ✅)
- Minor: 5 (3 fixed ✅)
- **Total: 15 (12 fixed: 5 in PR1, 1 in PR2, 6 in PR3)**

Remaining: F-1.5 (pagination clamp portion — covered by PR4 search hygiene), F-1.9 (token popover state loss when switching tokens — noted as moderate, not yet scheduled), F-1.14 (notes filter URL sync — PR5).

---

## Findings

### F-1.1 — `/read` returns HTTP 500 when `chapter` param is non-numeric ✅ Fixed in PR1
- **View:** Reader
- **File:** `app/read/page.tsx:12`
- **Severity:** critical
- **Problem:** `Number(getParam(params.chapter) ?? "1")` returns `NaN` for any non-numeric chapter. The downstream `getReaderPassage(book, NaN)` then throws inside Prisma. There is no `parsePositiveInt` guard like the one used at `app/search/page.tsx:99-103`.
- **Repro / evidence:** `curl -s -o NUL -w "%{http_code}" "http://localhost:3000/read?book=John&chapter=abc"` → `500`.
- **Suggested fix:** Replace line 12 with `const chapter = parsePositiveInt(getParam(params.chapter)) ?? 1;` and lift `parsePositiveInt` from `app/search/page.tsx` into a shared `lib/params.ts` helper.

### F-1.2 — `POST /api/notes` returns 500 on invalid `verseId` / `tokenId` ✅ Fixed in PR1
- **View:** Reader (verse note form), MorphologyPopover (word note form)
- **File:** `app/api/notes/route.ts:35-44` — surfaced from `components/BibleReader.tsx:32-50` and `components/MorphologyPopover.tsx:42-60`
- **Severity:** critical
- **Problem:** The handler checks that *one* of `verseId`/`tokenId` is present (line 27-29), but never confirms they reference real rows. If the client posts a non-existent id, Prisma throws a foreign-key constraint violation and the route returns an unhandled 500. The UI surface text ("Could not save note.") is fine, but the server crash pollutes logs and the failure mode is opaque to the client.
- **Repro / evidence:** `curl -X POST http://localhost:3000/api/notes -H "Content-Type: application/json" -d '{"verseId":"does-not-exist","body":"y","tags":["v"]}'` → `HTTP 500`.
- **Suggested fix:** Validate ids before insert (`prisma.verse.findUnique({ where: { id }, select: { id: true } })` etc.) and return 400 with a structured `{ error: "verseId not found" }` on miss. Wrap the create call in `try/catch` returning 500 only for true server errors.

### F-1.3 — `POST /api/highlights` returns 500 on invalid `verseId` / `tokenId` ✅ Fixed in PR1
- **View:** Reader, MorphologyPopover
- **File:** `app/api/highlights/route.ts:13-22` — surfaced from `components/BibleReader.tsx:53-64` and `components/MorphologyPopover.tsx:62-71`
- **Severity:** critical
- **Problem:** Same shape as F-1.2. No existence check before `prisma.highlight.create`; FK violation propagates as 500.
- **Repro / evidence:** `curl -X POST http://localhost:3000/api/highlights -H "Content-Type: application/json" -d '{"verseId":"does-not-exist"}'` → `HTTP 500`.
- **Suggested fix:** Same as F-1.2 — validate references, wrap in try/catch.

### F-1.4 — Notes PATCH silently succeeds when the id doesn't exist or belongs to another user ✅ Fixed in PR1
- **View:** Notes
- **File:** `app/api/notes/[id]/route.ts:22-35` — consumer at `components/NotesPanel.tsx:35-44`
- **Severity:** critical
- **Problem:** `prisma.note.updateMany({ where: { id, userId } ... })` returns a count, not the row. The subsequent `findFirst` returns `null` if the row never existed (or belonged to someone else), but the route still returns `200 { note: null }`. `NotesPanel.save()` only checks `response.ok`, so it shows "Saved." even though nothing was persisted. Users can be misled into believing edits succeeded.
- **Repro / evidence:** Source review. The same pattern repeats in DELETE at `app/api/notes/[id]/route.ts:38-44` — deleting a non-existent note returns 200 `{ ok: true }`.
- **Suggested fix:** After `updateMany`, inspect `count`; return 404 if 0. Or use `prisma.note.update` which throws on miss, caught and converted to 404. The client should then surface "Note not found" status.

### F-1.5 — Pagination "Previous" stays enabled past `pageCount`; URL accepts arbitrary `page`

> Note: the "Save/Delete/Highlight buttons lack in-flight disabled state — double-submit hazard"
> aspect of F-1.5 (which the report originally bundled into this entry's neighborhood) was
> addressed in PR3 — every async button now disables during in-flight. The pagination clamp
> portion of F-1.5 remains for PR4.

- **View:** Search
- **File:** `components/SearchPanel.tsx:88-89`, `211-232`; result text at `:167`; server at `app/search/page.tsx:18`
- **Severity:** moderate
- **Problem:** `previousPage = Math.max(page - 1, 1)` together with the `page <= 1` disabled-check means a user landing on `/search?page=999` for a 7-page query still sees a clickable Previous (going to page 998). The header text reads literally `"42 results for "test", page 999 of 7"` and the list is empty. There is no server-side clamp at `app/search/page.tsx:18` (`page = parsePositiveInt(...) ?? 1` keeps the raw value).
- **Repro / evidence:** Live: `curl http://localhost:3000/search?mode=keyword&q=test&page=999` shows `page 999 of 7` in the header and `Showing 0 of 42`.
- **Suggested fix:** Clamp server-side: in `app/search/page.tsx` after computing `pageCount`, set `page = Math.min(Math.max(page, 1), Math.max(pageCount, 1))`. Then the URL still works but the panel renders consistent state.

### F-1.6 — Async fetch handlers have no `try`/`catch`; network failures leave UI in stuck states ✅ Fixed in PR3
- **View:** Reader, MorphologyPopover, Notes, Search, Assistant
- **File:** `components/AiAssistant.tsx:46-68` (worst symptom); also `components/BibleReader.tsx:27-64`, `components/MorphologyPopover.tsx:37-71`, `components/NotesPanel.tsx:35-54`, `components/SearchPanel.tsx:69-86`
- **Severity:** moderate
- **Problem:** None of the async handlers wrap `fetch(...)` in try/catch. A thrown fetch (offline, DNS failure, aborted request, CORS error) bypasses `setLoading(false)` / `setSaving(false)`. In the Assistant this leaves the Send button disabled with text "Retrieving..." permanently — the only recovery is a page reload.
- **Repro / evidence:** Source review. The MorphologyPopover correctly uses a `saving` flag but still never resets it in a `finally`.
- **Suggested fix:** Standard pattern per handler:
  ```ts
  try {
    const res = await fetch(...);
    if (!res.ok) throw new Error(...);
    // success
  } catch (e) {
    setError("Network error. Try again.");
  } finally {
    setLoading(false);
  }
  ```

### F-1.7 — Save / Delete / Highlight buttons lack in-flight disabled state; double-submit hazard ✅ Fixed in PR3
- **View:** Reader, Notes
- **File:** `components/BibleReader.tsx:85-92` (verse highlight), `:147-152` (verse note save); `components/NotesPanel.tsx:102-118` (note save & delete); `components/SearchPanel.tsx:172-179` (save search)
- **Severity:** moderate
- **Problem:** Async handlers run without disabling their trigger button. A rapid double-click duplicates highlights/notes (two POSTs land before the state catches up). `MorphologyPopover` correctly uses `disabled={saving}` (lines 113, 134) — the other components should match.
- **Suggested fix:** Mirror `MorphologyPopover`'s `saving` flag in each component; disable the button while `saving === true`.

### F-1.8 — Reader token highlight does not update visually until full page reload ✅ Fixed in PR2
- **View:** Reader
- **File:** `components/BibleReader.tsx:106-108`, `components/MorphologyPopover.tsx:62-71`
- **Severity:** moderate
- **Problem:** Token `highlighted` and verse `highlighted` come from server props. After a successful highlight POST, the popover shows "Highlight saved." but the token/verse retains its un-highlighted style because no local state mutation reflects the new highlight. User has to refresh to see the yellow background.
- **Repro / evidence:** Source: `verse.highlighted ? "border-yellow-300" : "border-stone-300"` (line 79-81) and `token.highlighted ? "bg-yellow-200" : ""` (line 107-108) are derived from the original props.
- **Suggested fix:** After a 201 response, optimistically update local state (lift `highlighted` into a `useState` map in `BibleReader`), OR call `router.refresh()` from `next/navigation` to re-fetch the server component.

### F-1.9 — Selecting a different token leaves the previously-open popover's local form state lost; no warning if there were unsaved edits
- **View:** Reader
- **File:** `components/BibleReader.tsx:103-118`, `components/MorphologyPopover.tsx:33-60`
- **Severity:** moderate
- **Problem:** `selectedTokenId` change unmounts the current `MorphologyPopover`, which has local `body` state for the note textarea. If the user typed a note but didn't save, switching tokens silently discards the text.
- **Repro / evidence:** Source review (`<MorphologyPopover>` is conditionally rendered on `selectedTokenId === token.id`; unmount drops local state).
- **Suggested fix:** Either prompt before switching when `body.trim()` is non-empty, lift the per-token note draft into `BibleReader`'s `noteBodies` map, or warn via a small "Unsaved note discarded" toast.

### F-1.10 — BibleReader silently ignores empty-body note submissions ✅ Fixed in PR3
- **View:** Reader
- **File:** `components/BibleReader.tsx:29-30`
- **Severity:** minor
- **Problem:** `if (!body) return;` early-returns with no status update. User clicks "Save note" with an empty input and gets no feedback; the request didn't fire but the UI gives no indication. Many users will assume saved.
- **Suggested fix:** Either set `status[verse.id] = "Write a note before saving."` or disable the Save button while body is empty (matching `MorphologyPopover` at line 134: `disabled={saving || !body.trim()}`).

### F-1.11 — Saved-search "Save" button doesn't disable while `Saving...`; clicking twice creates duplicates ✅ Fixed in PR3
- **View:** Search
- **File:** `components/SearchPanel.tsx:69-86`, `172-179`
- **Severity:** minor
- **Problem:** `saveSearch()` sets `saveStatus = "Saving..."` but doesn't disable the button. Two clicks → two POSTs → two saved-search rows with identical auto-labels. Tracked separately from F-1.7 because the symptom is more visible (duplicate sidebar entries).
- **Suggested fix:** Add a `saving` boolean; `disabled={saving}` on the button.

### F-1.12 — `MorphologyPopover` has no outside-click or Escape-to-close affordances ✅ Fixed in PR3
- **View:** Reader
- **File:** `components/MorphologyPopover.tsx:75-143`
- **Severity:** minor
- **Problem:** Only the explicit "Close" button or clicking the same token again closes the popover. Clicking elsewhere on the page leaves it open. Pressing Escape doesn't close it. Both are conventional popover behaviors users will expect to "just work."
- **Suggested fix:** `useEffect` that registers `mousedown` on `document` and closes when the event target is outside a ref'd container; also a `keydown` listener for `Escape`.

### F-1.13 — Assistant `prompt` textarea stays prefilled with the just-submitted question ✅ Fixed in PR3
- **View:** Assistant
- **File:** `components/AiAssistant.tsx:38-68`
- **Severity:** minor
- **Problem:** After submit, `prompt` keeps the submitted text. To ask a new question the user has to manually clear the textarea. Most chat-style UIs clear the input on submit and let history scroll.
- **Suggested fix:** Either `setPrompt("")` after successful submit, or add a small "Clear" button next to "Ask assistant".

### F-1.14 — Notes filter inputs do not sync to URL; refresh loses filter state
- **View:** Notes
- **File:** `components/NotesPanel.tsx:18-78`
- **Severity:** minor
- **Problem:** `tagFilter` / `referenceFilter` are React state only. Reloading the page or sharing the URL drops the filter. Inconsistent with `/search` which keeps query state in the URL.
- **Suggested fix:** Mirror filter state into URL via `useSearchParams` + `router.replace` (debounced).

### F-1.15 — Saved-search POST accepts `matchMode=prefix` for keyword/lemma modes (server keeps it) ✅ Fixed in PR1
- **View:** Search
- **File:** `app/api/saved-searches/route.ts:36-38`, `components/SearchPanel.tsx:69-76`
- **Severity:** minor
- **Problem:** The server validates `matchMode ∈ {exact, prefix}` but does not gate it by `mode`. A user saving a keyword search with the morph-match dropdown left on "Prefix" stores `matchMode: "prefix"` against a keyword search. When restored via the sidebar link, the URL carries `matchMode=prefix` but the keyword search ignores it. Misleading.
- **Suggested fix:** Reject `matchMode` if `mode !== "morphology"`, or strip it before save.

---

## Out-of-scope items observed during review (logged, not findings)

- `app/api/notes/[id]/route.ts:5` redeclares `localUserId = "local-user"` as a local constant instead of importing from `lib/user.ts` like the rest of the codebase. Drift risk if the user-id source changes. (Non-UI; flagged for cleanup.) ✅ Fixed in PR1
- `app/api/highlights/route.ts:4` does the same. ✅ Fixed in PR1
