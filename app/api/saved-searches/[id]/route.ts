import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { localUserId } from "@/lib/user";

type Params = Promise<{ id: string }>;

export async function PATCH(request: Request, { params }: { params: Params }) {
  const { id } = await params;
  const body = await request.json();
  const label = typeof body.label === "string" ? body.label.trim() : "";

  if (!label) {
    return NextResponse.json({ error: "Label is required." }, { status: 400 });
  }

  const result = await prisma.savedSearch.updateMany({
    where: { id, userId: localUserId },
    data: { label }
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Saved search not found." }, { status: 404 });
  }

  const savedSearch = await prisma.savedSearch.findFirst({
    where: { id, userId: localUserId }
  });

  return NextResponse.json({ savedSearch });
}

export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { id } = await params;

  const result = await prisma.savedSearch.deleteMany({
    where: { id, userId: localUserId }
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Saved search not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
