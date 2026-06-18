import { BibleReader } from "@/components/BibleReader";
import { ChapterNav } from "@/components/ChapterNav";
import { DismissibleIntro } from "@/components/DismissibleIntro";
import { ReaderControls } from "@/components/ReaderControls";
import { ReaderJumpForm } from "@/components/ReaderJumpForm";
import { ReaderLocationMemo } from "@/components/ReaderLocationMemo";
import { ReaderMasthead } from "@/components/ReaderMasthead";
import { bookName } from "@/lib/references";
import { requirePageAuth } from "@/lib/auth";
import { parsePositiveInt } from "@/lib/params";
import { introCookieName, parseReaderMode, parseSavedPassage, LAST_PASSAGE_COOKIE, READER_MODE_COOKIE } from "@/lib/readerPrefs";
import { redirect } from "next/navigation";
import {
  getAvailablePassages,
  getAvailableReaderBooks,
  getPassageNeighbors,
  getReaderPassage
} from "@/lib/search";
import { cookies } from "next/headers";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function ReadPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await requirePageAuth();
  const params = await searchParams;
  const cookieStore = await cookies();
  const initialMode = parseReaderMode(cookieStore.get(READER_MODE_COOKIE)?.value) ?? "parallel";
  const introDismissed = cookieStore.get(introCookieName("read"))?.value === "1";
  // Treat empty query values (e.g. `/read?book=`) as absent, so a bare-ish URL
  // still restores the saved passage and the book still defaults to John.
  const bookParam = getParam(params.book) || undefined;
  const chapterParam = getParam(params.chapter) || undefined;
  const verseParam = getParam(params.verse) || undefined;
  const isBareUrl = bookParam === undefined && chapterParam === undefined && verseParam === undefined;
  if (isBareUrl) {
    const saved = parseSavedPassage(cookieStore.get(LAST_PASSAGE_COOKIE)?.value);
    if (saved) {
      redirect(`/read?book=${encodeURIComponent(saved.book)}&chapter=${saved.chapter}`);
    }
  }
  const book = bookParam ?? "John";
  const chapter = parsePositiveInt(chapterParam) ?? 1;
  const targetVerse = parsePositiveInt(verseParam) ?? null;
  const [books, passages, verses, neighbors] = await Promise.all([
    getAvailableReaderBooks(),
    getAvailablePassages(),
    getReaderPassage(book, chapter, userId),
    getPassageNeighbors(book, chapter)
  ]);

  return (
    <div className="space-y-6">
      <ReaderLocationMemo book={book} chapter={chapter} />
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <ReaderMasthead bookLabel={bookName(book)} chapter={chapter} />
          <DismissibleIntro id="read" defaultDismissed={introDismissed}>
            Read the Greek New Testament beside English, and click any Greek word for its morphology.
          </DismissibleIntro>
        </div>
        <ReaderControls books={books} passages={passages} selectedBook={book} selectedChapter={chapter} selectedVerse={targetVerse} />
      </section>

      <BibleReader
        verses={verses}
        targetVerse={targetVerse}
        initialMode={initialMode}
        chapterLabel={`${bookName(book)} ${chapter}`}
        jumpSlot={<ReaderJumpForm />}
      />

      <ChapterNav prev={neighbors.prev} next={neighbors.next} />
    </div>
  );
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
