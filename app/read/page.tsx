import { BibleReader } from "@/components/BibleReader";
import { ChapterNav } from "@/components/ChapterNav";
import { ReaderControls } from "@/components/ReaderControls";
import { parsePositiveInt } from "@/lib/params";
import {
  getAvailablePassages,
  getAvailableReaderBooks,
  getPassageNeighbors,
  getReaderPassage
} from "@/lib/search";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function ReadPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const book = getParam(params.book) ?? "John";
  const chapter = parsePositiveInt(getParam(params.chapter)) ?? 1;
  const targetVerse = parsePositiveInt(getParam(params.verse)) ?? null;
  const [books, passages, verses, neighbors] = await Promise.all([
    getAvailableReaderBooks(),
    getAvailablePassages(),
    getReaderPassage(book, chapter),
    getPassageNeighbors(book, chapter)
  ]);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-950">Reader</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Read imported or sample Greek text beside English and click Greek words for morphology.
          </p>
        </div>
        <ReaderControls books={books} passages={passages} selectedBook={book} selectedChapter={chapter} />
      </section>

      <ChapterNav prev={neighbors.prev} next={neighbors.next} />

      <BibleReader verses={verses} targetVerse={targetVerse} />
    </div>
  );
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
