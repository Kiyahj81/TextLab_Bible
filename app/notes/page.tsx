import type { Prisma } from "@prisma/client";
import { NotesPanel, NoteRow } from "@/components/NotesPanel";
import { prisma } from "@/lib/db";
import { parseNotesSort, parseReferenceFilter } from "@/lib/notes-filter";
import { parsePositiveInt } from "@/lib/params";
import { formatReference } from "@/lib/references";
import { localUserId } from "@/lib/user";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function NotesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tag = getParam(params.tag) ?? "";
  const reference = getParam(params.reference) ?? "";
  const sort = parseNotesSort(getParam(params.sort));
  const requestedPage = parsePositiveInt(getParam(params.page)) ?? 1;
  const pageSize = Math.min(parsePositiveInt(getParam(params.pageSize)) ?? 25, 100);

  const where: Prisma.NoteWhereInput = { userId: localUserId };

  if (tag.trim()) {
    where.tags = { has: tag.trim() };
  }

  const refFilter = parseReferenceFilter(reference);
  if (refFilter) {
    where.OR = [
      {
        verse: {
          book: { osisId: { contains: refFilter.book, mode: "insensitive" } },
          ...(refFilter.chapter ? { chapter: refFilter.chapter } : {})
        }
      },
      {
        token: {
          book: { osisId: { contains: refFilter.book, mode: "insensitive" } },
          ...(refFilter.chapter ? { chapter: refFilter.chapter } : {})
        }
      }
    ];
  }

  const orderBy: Prisma.NoteOrderByWithRelationInput[] =
    sort === "title"
      ? [{ title: "asc" }, { updatedAt: "desc" }]
      : sort === "canonical"
        ? [
            { verse: { book: { order: "asc" } } },
            { verse: { chapter: "asc" } },
            { verse: { verse: "asc" } },
            { updatedAt: "desc" }
          ]
        : [{ updatedAt: "desc" }];

  const total = await prisma.note.count({ where });
  const pageCount = Math.ceil(total / pageSize);
  const page = Math.min(requestedPage, Math.max(pageCount, 1));

  const notes = await prisma.note.findMany({
    where,
    include: {
      verse: { include: { book: true } },
      token: { include: { book: true } }
    },
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize
  });

  const rows: NoteRow[] = notes.map((note) => {
    const source = note.verse ?? note.token;
    const book = source?.book.osisId ?? "John";
    const chapter = source?.chapter ?? 1;
    const verse = source?.verse ?? 1;

    return {
      id: note.id,
      title: note.title,
      body: note.body,
      tags: note.tags,
      reference: formatReference(book, chapter, verse),
      book,
      chapter,
      verse,
      tokenSurface: note.token?.surface
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Notes</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Review and edit sample local notes attached to verses or Greek tokens.
        </p>
      </div>
      <NotesPanel
        notes={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        pageCount={pageCount}
        tag={tag}
        reference={reference}
        sort={sort}
      />
    </div>
  );
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
