import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseTags } from "@/lib/references";
import { requireAuth } from "@/lib/auth";
import { jsonError, readJsonLimited, validateBody } from "@/lib/http/validation";

const MAX_NOTE_BODY = 10_000;
const MAX_NOTE_TITLE = 200;
const MAX_TAG_LENGTH = 32;
const MAX_TAGS = 20;

const tagsField = z
  .union([
    z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS),
    z.string().max(MAX_TAGS * (MAX_TAG_LENGTH + 1))
  ])
  .optional();

const noteCreateSchema = z
  .object({
    body: z.string().trim().min(1, "Note body is required.").max(MAX_NOTE_BODY),
    title: z.string().max(MAX_NOTE_TITLE).optional(),
    verseId: z.string().min(1).optional(),
    tokenId: z.string().min(1).optional(),
    tags: tagsField
  })
  .refine((v) => v.verseId || v.tokenId, {
    message: "A verseId or tokenId is required.",
    path: ["verseId"]
  });

export async function GET() {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult;

  const notes = await prisma.note.findMany({
    where: { userId },
    include: {
      verse: { include: { book: true, corpus: true } },
      token: { include: { book: true, corpus: true } }
    },
    orderBy: { updatedAt: "desc" }
  });

  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult;

  const read = await readJsonLimited(request);
  if (!read.ok) return read.response;

  const valid = validateBody(read.data, noteCreateSchema);
  if (!valid.ok) return valid.response;

  const { body, title, verseId, tokenId, tags: rawTags } = valid.data;

  if (verseId) {
    const verse = await prisma.verse.findUnique({ where: { id: verseId }, select: { id: true } });
    if (!verse) return jsonError("verseId not found.", 400);
  }

  if (tokenId) {
    const token = await prisma.token.findUnique({ where: { id: tokenId }, select: { id: true } });
    if (!token) return jsonError("tokenId not found.", 400);
  }

  const tags = Array.isArray(rawTags)
    ? rawTags.filter((tag) => typeof tag === "string")
    : parseTags(typeof rawTags === "string" ? rawTags : "");

  try {
    const note = await prisma.note.create({
      data: {
        userId,
        verseId,
        tokenId,
        title,
        body,
        tags
      }
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("notes POST failed", error);
    return jsonError("Could not save note.", 500);
  }
}
