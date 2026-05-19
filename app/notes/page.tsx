import { NotesPanel, NoteRow } from "@/components/NotesPanel";
import { prisma } from "@/lib/db";
import { formatReference } from "@/lib/references";

const localUserId = "local-user";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const notes = await prisma.note.findMany({
    where: { userId: localUserId },
    include: {
      verse: { include: { book: true } },
      token: { include: { book: true } }
    },
    orderBy: { updatedAt: "desc" }
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
      <NotesPanel notes={rows} />
    </div>
  );
}
