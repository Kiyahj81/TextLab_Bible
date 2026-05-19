import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseTags } from "@/lib/references";

const localUserId = "local-user";

type Params = Promise<{ id: string }>;

export async function PATCH(request: Request, { params }: { params: Params }) {
  const { id } = await params;
  const body = await request.json();
  const noteBody = typeof body.body === "string" ? body.body.trim() : "";

  if (!noteBody) {
    return NextResponse.json({ error: "Note body is required." }, { status: 400 });
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag: unknown) => typeof tag === "string")
    : parseTags(typeof body.tags === "string" ? body.tags : "");

  await prisma.note.updateMany({
    where: { id, userId: localUserId },
    data: {
      title: typeof body.title === "string" ? body.title : undefined,
      body: noteBody,
      tags
    }
  });

  const note = await prisma.note.findFirst({
    where: { id, userId: localUserId }
  });

  return NextResponse.json({ note });
}

export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { id } = await params;
  await prisma.note.deleteMany({
    where: { id, userId: localUserId }
  });

  return NextResponse.json({ ok: true });
}
