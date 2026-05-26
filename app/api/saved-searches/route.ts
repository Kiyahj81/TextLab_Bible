import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { bookName } from "@/lib/references";
import { requireUserId } from "@/lib/auth";
import { readJsonLimited, validateBody } from "@/lib/http/validation";

const MAX_LABEL = 100;
const MAX_QUERY = 500;
const MAX_CORPUS = 100;
const MAX_BOOK = 100;

const savedSearchCreateSchema = z.object({
  query: z.string().trim().min(1, "Query is required.").max(MAX_QUERY),
  mode: z.enum(["keyword", "lemma", "morphology"]).default("keyword"),
  matchMode: z.enum(["exact", "prefix"]).optional(),
  corpus: z.string().trim().max(MAX_CORPUS).optional(),
  book: z.string().trim().max(MAX_BOOK).optional(),
  chapter: z.coerce.number().int().positive().optional(),
  label: z.string().trim().max(MAX_LABEL).optional()
});

function autoLabel({
  mode,
  query,
  book,
  chapter
}: {
  mode: string;
  query: string;
  book?: string;
  chapter?: number;
}) {
  if (!book) return `${mode}: ${query}`;
  const scope = chapter ? `${bookName(book)} ${chapter}` : bookName(book);
  return `${mode}: ${query} (${scope})`;
}

export async function GET() {
  const userId = await requireUserId();
  const savedSearches = await prisma.savedSearch.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 25
  });

  return NextResponse.json({ savedSearches });
}

export async function POST(request: Request) {
  const read = await readJsonLimited(request);
  if (!read.ok) return read.response;

  const valid = validateBody(read.data, savedSearchCreateSchema);
  if (!valid.ok) return valid.response;

  const userId = await requireUserId();
  const { query, mode, matchMode: rawMatchMode, corpus, book, chapter, label: rawLabel } = valid.data;

  const matchMode = mode === "morphology" ? rawMatchMode : undefined;
  const label = rawLabel || autoLabel({ mode, query, book, chapter });

  const savedSearch = await prisma.savedSearch.create({
    data: {
      userId,
      label,
      mode,
      query,
      corpus,
      book,
      chapter,
      matchMode
    }
  });

  return NextResponse.json({ savedSearch }, { status: 201 });
}
