import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { readJsonLimited, validateBody } from "@/lib/http/validation";

const MAX_PROMPT = 2_000;
const MAX_ANSWER = 10_000;
const MAX_MARKDOWN = 12_000;
const MAX_CITATIONS = 50;

const citationSchema = z
  .object({
    reference: z.string().max(200).optional(),
    corpus: z.string().max(100).optional(),
    searchQuery: z.string().max(500).optional(),
    toolName: z.string().max(100).optional(),
    book: z.string().max(100).optional(),
    chapter: z.number().int().nonnegative().optional(),
    verse: z.number().int().nonnegative().optional(),
    tokenId: z.string().max(200).optional()
  })
  .passthrough();

const generatedStudyNoteSchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_PROMPT),
  answer: z.string().trim().min(1).max(MAX_ANSWER),
  markdown: z.string().trim().min(1).max(MAX_MARKDOWN),
  citations: z.array(citationSchema).max(MAX_CITATIONS).optional()
});

// Larger body cap than the default — generated notes embed a markdown
// document plus citation array; 16 KB is too tight.
const NOTE_BODY_LIMIT = 64 * 1024;

export async function GET() {
  const userId = await requireUserId();
  const notes = await prisma.generatedStudyNote.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 25
  });

  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const read = await readJsonLimited(request, { maxBytes: NOTE_BODY_LIMIT });
  if (!read.ok) return read.response;

  const valid = validateBody(read.data, generatedStudyNoteSchema);
  if (!valid.ok) return valid.response;

  const userId = await requireUserId();
  const { prompt, answer, markdown, citations } = valid.data;

  const note = await prisma.generatedStudyNote.create({
    data: {
      userId,
      prompt,
      answer,
      markdown,
      citations: citations as Prisma.InputJsonValue | undefined
    }
  });

  return NextResponse.json({ note }, { status: 201 });
}
