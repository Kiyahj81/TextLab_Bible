import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/http/security";
import { readJsonLimited, validateBody } from "@/lib/http/validation";

const MAX_PROMPT = 2_000;
// A deterministic-fallback answer embeds the full retrieved evidence, which for a
// whole chapter across both corpora (SBLGNT + WEB) runs ~13 KB and is hard-bounded
// by the planner's MAX_PASSAGE_LINES ceiling (worst realistic case ~30 KB). Caps
// sized to fit that completely while still rejecting pathological payloads.
const MAX_ANSWER = 40_000;
const MAX_MARKDOWN = 48_000;
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

// Larger body cap than the default — generated notes embed a full-chapter
// markdown document plus the answer text and citation array; 64 KB is too tight
// once whole passages (answer ≤ 40 KB + markdown ≤ 48 KB) are returned in full.
const NOTE_BODY_LIMIT = 128 * 1024;

export async function GET() {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult;

  const notes = await prisma.generatedStudyNote.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 25
  });

  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult;

  const read = await readJsonLimited(request, { maxBytes: NOTE_BODY_LIMIT });
  if (!read.ok) return read.response;

  const valid = validateBody(read.data, generatedStudyNoteSchema);
  if (!valid.ok) return valid.response;

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
