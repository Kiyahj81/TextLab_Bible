import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { localUserId } from "@/lib/user";

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));

  const verseId = typeof body?.verseId === "string" ? body.verseId : undefined;
  const tokenId = typeof body?.tokenId === "string" ? body.tokenId : undefined;
  const englishWordIndex =
    typeof body?.englishWordIndex === "number" && Number.isInteger(body.englishWordIndex)
      ? body.englishWordIndex
      : undefined;

  if (!verseId && !tokenId) {
    return NextResponse.json({ error: "A verseId or tokenId is required." }, { status: 400 });
  }

  try {
    const result = await prisma.highlight.deleteMany({
      where: {
        userId: localUserId,
        ...(verseId ? { verseId } : {}),
        ...(tokenId ? { tokenId } : {}),
        ...(englishWordIndex !== undefined ? { englishWordIndex } : { englishWordIndex: null })
      }
    });
    return NextResponse.json({ deleted: result.count }, { status: 200 });
  } catch (error) {
    console.error("highlights DELETE failed", error);
    return NextResponse.json({ error: "Could not remove highlight." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json();

  const verseId = typeof body.verseId === "string" ? body.verseId : undefined;
  const tokenId = typeof body.tokenId === "string" ? body.tokenId : undefined;
  const englishWordIndex =
    typeof body.englishWordIndex === "number" && Number.isInteger(body.englishWordIndex)
      ? body.englishWordIndex
      : undefined;

  if (!verseId && !tokenId) {
    return NextResponse.json({ error: "A verseId or tokenId is required." }, { status: 400 });
  }

  if (englishWordIndex !== undefined && !verseId) {
    return NextResponse.json(
      { error: "englishWordIndex requires a verseId." },
      { status: 400 }
    );
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

  try {
    // One highlight per (verseId + englishWordIndex) slot per user — replace
    // any existing row so picking a new color doesn't accumulate stacked rows.
    if (verseId && englishWordIndex !== undefined) {
      await prisma.highlight.deleteMany({
        where: { userId: localUserId, verseId, englishWordIndex }
      });
    }

    const highlight = await prisma.highlight.create({
      data: {
        userId: localUserId,
        verseId,
        tokenId,
        englishWordIndex,
        color: typeof body.color === "string" ? body.color : "#fde68a"
      }
    });

    return NextResponse.json({ highlight }, { status: 201 });
  } catch (error) {
    console.error("highlights POST failed", error);
    return NextResponse.json({ error: "Could not save highlight." }, { status: 500 });
  }
}
