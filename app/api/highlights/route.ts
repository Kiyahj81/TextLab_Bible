import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/http/security";
import { DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_COLORS } from "@/lib/highlight";
import { jsonError, readJsonLimited, validateBody } from "@/lib/http/validation";

const allowedColors = HIGHLIGHT_COLORS.map((c) => c.value) as [string, ...string[]];

const highlightPostSchema = z
  .object({
    verseId: z.string().min(1).optional(),
    tokenId: z.string().min(1).optional(),
    englishWordIndex: z.number().int().min(0).optional(),
    color: z.enum(allowedColors).default(DEFAULT_HIGHLIGHT_COLOR)
  })
  .refine((v) => v.verseId || v.tokenId, {
    message: "A verseId or tokenId is required.",
    path: ["verseId"]
  })
  .refine((v) => v.englishWordIndex === undefined || v.verseId, {
    message: "englishWordIndex requires a verseId.",
    path: ["englishWordIndex"]
  });

const highlightDeleteSchema = z
  .object({
    verseId: z.string().min(1).optional(),
    tokenId: z.string().min(1).optional(),
    englishWordIndex: z.number().int().min(0).optional()
  })
  .refine((v) => v.verseId || v.tokenId, {
    message: "A verseId or tokenId is required.",
    path: ["verseId"]
  });

export async function DELETE(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult;

  const read = await readJsonLimited(request);
  if (!read.ok) return read.response;

  const valid = validateBody(read.data, highlightDeleteSchema);
  if (!valid.ok) return valid.response;

  const { verseId, tokenId, englishWordIndex } = valid.data;

  try {
    const result = await prisma.highlight.deleteMany({
      where: {
        userId,
        ...(verseId ? { verseId } : {}),
        ...(tokenId ? { tokenId } : {}),
        ...(englishWordIndex !== undefined ? { englishWordIndex } : { englishWordIndex: null })
      }
    });
    return NextResponse.json({ deleted: result.count }, { status: 200 });
  } catch (error) {
    console.error("highlights DELETE failed", error);
    return jsonError("Could not remove highlight.", 500);
  }
}

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult;

  const read = await readJsonLimited(request);
  if (!read.ok) return read.response;

  const valid = validateBody(read.data, highlightPostSchema);
  if (!valid.ok) return valid.response;

  const { verseId, tokenId, englishWordIndex, color } = valid.data;

  if (verseId) {
    const verse = await prisma.verse.findUnique({ where: { id: verseId }, select: { id: true } });
    if (!verse) return jsonError("verseId not found.", 400);
  }

  if (tokenId) {
    const token = await prisma.token.findUnique({ where: { id: tokenId }, select: { id: true } });
    if (!token) return jsonError("tokenId not found.", 400);
  }

  try {
    if (verseId && englishWordIndex !== undefined) {
      await prisma.highlight.deleteMany({
        where: { userId, verseId, englishWordIndex }
      });
    }

    const highlight = await prisma.highlight.create({
      data: {
        userId,
        verseId,
        tokenId,
        englishWordIndex,
        color
      }
    });

    return NextResponse.json({ highlight }, { status: 201 });
  } catch (error) {
    console.error("highlights POST failed", error);
    return jsonError("Could not save highlight.", 500);
  }
}
