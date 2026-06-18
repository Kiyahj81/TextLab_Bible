"use client";

import { useEffect, useMemo, useState } from "react";
import { FOCUS_RING, FOCUS_RING_INPUT } from "@/lib/ui/focus";
import { ReaderJumpForm } from "@/components/ReaderJumpForm";

type ReaderBookOption = { osisId: string; label: string };
type ReaderPassageOption = { book: string; label: string; chapter: number };

export function ReaderControls({
  books, passages, selectedBook, selectedChapter, selectedVerse
}: {
  books: ReaderBookOption[]; passages: ReaderPassageOption[];
  selectedBook: string; selectedChapter: number;
  selectedVerse?: number | null;
}) {
  const [book, setBook] = useState(selectedBook);
  const [chapterOverride, setChapterOverride] = useState<number | null>(selectedChapter);

  // Re-sync to URL-driven props (e.g. after a server-side redirect restores a
  // saved passage on a bare /read visit), otherwise the dropdowns keep showing
  // their initial-mount values while the page actually displays a different
  // book/chapter.
  useEffect(() => {
    setBook(selectedBook);
  }, [selectedBook]);

  useEffect(() => {
    setChapterOverride(selectedChapter);
  }, [selectedChapter]);

  const chapterOptions = useMemo(
    () => passages.filter((p) => p.book === book), [book, passages]
  );

  const activeChapter =
    chapterOverride !== null && chapterOptions.some((p) => p.chapter === chapterOverride)
      ? chapterOverride
      : chapterOptions[0]?.chapter ?? 1;

  return (
    <div className="flex flex-col gap-2">
      <ReaderJumpForm />
      <form className="flex flex-wrap gap-2" action="/read">
        <select
          aria-label="book" name="book" value={book}
          onChange={(e) => { setBook(e.target.value); setChapterOverride(null); }}
          className={`rounded-md border border-stone-300 bg-white px-3 py-2 text-sm ${FOCUS_RING_INPUT}`}
        >
          {books.map((b) => <option key={b.osisId} value={b.osisId}>{b.label}</option>)}
        </select>
        <select
          aria-label="chapter" name="chapter" value={activeChapter}
          onChange={(e) => setChapterOverride(Number.parseInt(e.target.value, 10))}
          className={`rounded-md border border-stone-300 bg-white px-3 py-2 text-sm ${FOCUS_RING_INPUT}`}
        >
          {chapterOptions.map((p) => (
            <option key={`${p.book}-${p.chapter}`} value={p.chapter}>{p.chapter}</option>
          ))}
        </select>
        <input
          aria-label="verse"
          name="verse"
          type="number"
          min={1}
          inputMode="numeric"
          defaultValue={selectedVerse ?? ""}
          placeholder="Verse"
          className={`w-20 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent-600 ${FOCUS_RING_INPUT}`}
        />
        <button className={`rounded-md bg-accent-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-800 ${FOCUS_RING}`}>Open</button>
      </form>
    </div>
  );
}
