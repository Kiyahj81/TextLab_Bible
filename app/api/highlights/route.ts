import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const localUserId = "local-user";

export async function POST(request: Request) {
  const body = await request.json();

  if (!body.verseId && !body.tokenId) {
    return NextResponse.json({ error: "A verseId or tokenId is required." }, { status: 400 });
  }

  const highlight = await prisma.highlight.create({
    data: {
      userId: localUserId,
      verseId: typeof body.verseId === "string" ? body.verseId : undefined,
      tokenId: typeof body.tokenId === "string" ? body.tokenId : undefined,
      color: typeof body.color === "string" ? body.color : "#fde68a"
    }
  });

  return NextResponse.json({ highlight }, { status: 201 });
}
