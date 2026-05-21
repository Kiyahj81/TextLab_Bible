"use client";

import { useMemo, useState } from "react";

type ReaderBookOption = {
  osisId: string;
  label: string;
};

type ReaderPassageOption = {
  book: string;
  label: string;
  chapter: number;
};

export function ReaderControls({
  books,
  passages,
  selectedBook,
  selectedChapter
}: {
  books: ReaderBookOption[];
  passages: ReaderPassageOption[];
  selectedBook: string;
  selectedChapter: number;
}) {
  const [book, setBook] = useState(selectedBook);
  const [chapter, setChapter] = useState(String(selectedChapter));

  const chapterOptions = useMemo(
    () => passages.filter((passage) => passage.book === book),
    [book, passages]
  );

  const chapterValue = chapterOptions.some((option) => String(option.chapter) === chapter)
    ? chapter
    : String(chapterOptions[0]?.chapter ?? 1);

  return (
    <form className="flex flex-wrap gap-2" action="/read">
      <select
        name="book"
        value={book}
        onChange={(event) => {
          const nextBook = event.target.value;
          const nextChapter = passages.find((passage) => passage.book === nextBook)?.chapter ?? 1;
          setBook(nextBook);
          setChapter(String(nextChapter));
        }}
        className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
      >
        {books.map((bookOption) => (
          <option key={bookOption.osisId} value={bookOption.osisId}>
            {bookOption.label}
          </option>
        ))}
      </select>
      <select
        name="chapter"
        value={chapterValue}
        onChange={(event) => setChapter(event.target.value)}
        className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
      >
        {chapterOptions.map((passage) => (
          <option key={`${passage.book}-${passage.chapter}`} value={passage.chapter}>
            {passage.label}
          </option>
        ))}
      </select>
      <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Open</button>
    </form>
  );
}
