import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { localUserId } from "@/lib/user";

const allowedModes = new Set(["keyword", "lemma", "morphology"]);
const allowedMatchModes = new Set(["exact", "prefix"]);

export async function GET() {
  const savedSearches = await prisma.savedSearch.findMany({
    where: { userId: localUserId },
    orderBy: { updatedAt: "desc" },
    take: 25
  });

  return NextResponse.json({ savedSearches });
}

export async function POST(request: Request) {
  const body = await request.json();
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const mode = typeof body.mode === "string" && allowedModes.has(body.mode) ? body.mode : "keyword";

  if (!query) {
    return NextResponse.json({ error: "Query is required." }, { status: 400 });
  }

  const savedSearch = await prisma.savedSearch.create({
    data: {
      userId: localUserId,
      label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : `${mode}: ${query}`,
      mode,
      query,
      corpus: typeof body.corpus === "string" && body.corpus.trim() ? body.corpus.trim() : undefined,
      book: typeof body.book === "string" && body.book.trim() ? body.book.trim() : undefined,
      chapter: Number.isFinite(Number(body.chapter)) && Number(body.chapter) > 0 ? Number(body.chapter) : undefined,
      matchMode:
        typeof body.matchMode === "string" && allowedMatchModes.has(body.matchMode) ? body.matchMode : undefined
    }
  });

  return NextResponse.json({ savedSearch }, { status: 201 });
}
