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
import { introCookieName, parseReaderMode, parseReaderLayout, parseSavedPassage, LAST_PASSAGE_COOKIE, READER_MODE_COOKIE, READER_LAYOUT_COOKIE } from "@/lib/readerPrefs";
import { redirect } from "next/navigation";
import {
  getAvailablePassages,
  getAvailableReaderBooks,
  getPassageNeighbors,
  getReaderPassage
} from "@/lib/search";
import { withDbRetry } from "@/lib/db-retry";
import { cookies } from "next/headers";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function ReadPage({ searchParams }: { searchParams: SearchParams }) {
  // Retry the auth/session read too: requirePageAuth() -> auth() runs the
  // sessionCallback's prisma.user.findUnique (revocation watermark), the FIRST
  // DB read on the page and the most likely to hit a stale Neon connection
  // after idle. Its redirect-on-unauthenticated throw carries a NEXT_REDIRECT
  // digest, so withDbRetry rethrows it immediately and never retries it.
  const userId = await withDbRetry(() => requirePageAuth());
  const params = await searchParams;
  const cookieStore = await cookies();
  const initialMode = parseReaderMode(cookieStore.get(READER_MODE_COOKIE)?.value) ?? "parallel";
  const initialLayout = parseReaderLayout(cookieStore.get(READER_LAYOUT_COOKIE)?.value) ?? "study";
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
  // Retry transient Neon connection drops (idle-suspend / pooler recycle) on
  // these idempotent reads before letting the page fall through to error.tsx.
  const [books, passages, verses, neighbors] = await withDbRetry(() =>
    Promise.all([
      getAvailableReaderBooks(),
      getAvailablePassages(),
      getReaderPassage(book, chapter, userId),
      getPassageNeighbors(book, chapter)
    ])
  );

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

      {/* jumpSlot carries a stable key: it's a Server-Component element passed as
          a prop and rendered among siblings in BibleReader's sticky bar, so on a
          client re-render React's reconciler would otherwise flag it as a keyless
          list child (react.dev/link/warning-keys). */}
      <BibleReader
        verses={verses}
        targetVerse={targetVerse}
        initialMode={initialMode}
        initialLayout={initialLayout}
        chapterLabel={`${bookName(book)} ${chapter}`}
        jumpSlot={<ReaderJumpForm key="reader-jump" label="Jump to reference" />}
      />

      <ChapterNav prev={neighbors.prev} next={neighbors.next} />
    </div>
  );
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
