import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseTags } from "@/lib/references";
import { requireUserId } from "@/lib/auth";
import { jsonError, readJsonLimited, validateBody } from "@/lib/http/validation";

type Params = Promise<{ id: string }>;

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

const notePatchSchema = z.object({
  body: z.string().trim().min(1, "Note body is required.").max(MAX_NOTE_BODY),
  title: z.string().max(MAX_NOTE_TITLE).optional(),
  tags: tagsField
});

export async function PATCH(request: Request, { params }: { params: Params }) {
  const { id } = await params;

  const read = await readJsonLimited(request);
  if (!read.ok) return read.response;

  const valid = validateBody(read.data, notePatchSchema);
  if (!valid.ok) return valid.response;

  const userId = await requireUserId();
  const { body, title, tags: rawTags } = valid.data;
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((tag) => typeof tag === "string")
    : parseTags(typeof rawTags === "string" ? rawTags : "");

  const result = await prisma.note.updateMany({
    where: { id, userId },
    data: { title, body, tags }
  });

  if (result.count === 0) {
    return jsonError("Note not found.", 404);
  }

  const note = await prisma.note.findFirst({
    where: { id, userId }
  });

  return NextResponse.json({ note });
}

export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { id } = await params;
  const userId = await requireUserId();
  const result = await prisma.note.deleteMany({
    where: { id, userId }
  });

  if (result.count === 0) {
    return jsonError("Note not found.", 404);
  }

  return NextResponse.json({ ok: true });
}
