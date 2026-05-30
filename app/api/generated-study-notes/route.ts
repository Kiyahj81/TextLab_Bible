import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/http/security";
import { readJsonLimited, validateBody } from "@/lib/http/validation";

const MAX_PROMPT = 2_000;
// A deterministic-fallback answer embeds the full retrieved evidence. This is
// hard-bounded by the planner: at most MAX_PLANNED_CALLS (8) passage fetches, each
// capped at MAX_PASSAGE_LINES, so the worst case is ~4 large chapters across both
// corpora — measured at ~57 KB answer / ~58 KB markdown / ~167 KB request body on
// the full corpus. Caps sized to fit that ceiling with margin while still rejecting
// anything beyond the planner's reach.
const MAX_ANSWER = 64_000;
const MAX_MARKDOWN = 72_000;
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

// Larger body cap than the default — generated notes embed full passages as both
// answer text and markdown plus the citation array. A multi-reference prompt at the
// planner's 8-call ceiling produces a ~167 KB request body, so 256 KB fits the
// worst case (answer ≤ 64 KB + markdown ≤ 72 KB + citations) with margin.
const NOTE_BODY_LIMIT = 256 * 1024;

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
