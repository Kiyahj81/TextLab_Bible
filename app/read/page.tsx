import { BibleReader } from "@/components/BibleReader";
import { getAvailablePassages, getAvailableReaderBooks, getReaderPassage } from "@/lib/search";
import { bookName } from "@/lib/references";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function ReadPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const book = getParam(params.book) ?? "John";
  const chapter = Number(getParam(params.chapter) ?? "1");
  const [books, passages, verses] = await Promise.all([
    getAvailableReaderBooks(),
    getAvailablePassages(),
    getReaderPassage(book, chapter)
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
        <form className="flex flex-wrap gap-2" action="/read">
          <select name="book" defaultValue={book} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm">
            {books.map((bookOption) => (
              <option key={bookOption.osisId} value={bookOption.osisId}>
                {bookOption.label}
              </option>
            ))}
          </select>
          <select
            name="chapter"
            defaultValue={String(chapter)}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {passages
              .filter((passage) => passage.book === book)
              .map((passage) => (
                <option key={`${passage.book}-${passage.chapter}`} value={passage.chapter}>
                  {bookName(passage.book)} {passage.chapter}
                </option>
              ))}
          </select>
          <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Open</button>
        </form>
      </section>

      <BibleReader verses={verses} />
    </div>
  );
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
