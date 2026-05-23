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

  const verseId = typeof body.verseId === "string" ? body.verseId : undefined;
  const tokenId = typeof body.tokenId === "string" ? body.tokenId : undefined;

  if (!verseId && !tokenId) {
    return NextResponse.json({ error: "A verseId or tokenId is required." }, { status: 400 });
  }

  if (verseId) {
    const verse = await prisma.verse.findUnique({ where: { id: verseId }, select: { id: true } });
    if (!verse) {
      return NextResponse.json({ error: "verseId not found." }, { status: 400 });
    }
  }

  if (tokenId) {
    const token = await prisma.token.findUnique({ where: { id: tokenId }, select: { id: true } });
    if (!token) {
      return NextResponse.json({ error: "tokenId not found." }, { status: 400 });
    }
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag: unknown) => typeof tag === "string")
    : parseTags(typeof body.tags === "string" ? body.tags : "");

  try {
    const note = await prisma.note.create({
      data: {
        userId: localUserId,
        verseId,
        tokenId,
        title: typeof body.title === "string" ? body.title : undefined,
        body: noteBody,
        tags
      }
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("notes POST failed", error);
    return NextResponse.json({ error: "Could not save note." }, { status: 500 });
  }
}
