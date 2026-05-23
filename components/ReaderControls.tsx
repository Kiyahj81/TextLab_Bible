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
