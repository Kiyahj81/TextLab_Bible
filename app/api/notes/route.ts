import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseTags } from "@/lib/references";
import { localUserId } from "@/lib/user";

export async function GET() {
  const notes = await prisma.note.findMany({
    where: { userId: localUserId },
    include: {
      verse: { include: { book: true, corpus: true } },
      token: { include: { book: true, corpus: true } }
    },
    orderBy: { updatedAt: "desc" }
  });

  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const body = await request.json();
  const noteBody = typeof body.body === "string" ? body.body.trim() : "";

  if (!noteBody) {
    return NextResponse.json({ error: "Note body is required." }, { status: 400 });
  }

  if (!body.verseId && !body.tokenId) {
    return NextResponse.json({ error: "A verseId or tokenId is required." }, { status: 400 });
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag: unknown) => typeof tag === "string")
    : parseTags(typeof body.tags === "string" ? body.tags : "");

  const note = await prisma.note.create({
    data: {
      userId: localUserId,
      verseId: typeof body.verseId === "string" ? body.verseId : undefined,
      tokenId: typeof body.tokenId === "string" ? body.tokenId : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      body: noteBody,
      tags
    }
  });

  return NextResponse.json({ note }, { status: 201 });
}
