import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { localUserId } from "@/lib/user";

export async function GET() {
  const notes = await prisma.generatedStudyNote.findMany({
    where: { userId: localUserId },
    orderBy: { createdAt: "desc" },
    take: 25
  });

  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const body = await request.json();
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  const markdown = typeof body.markdown === "string" ? body.markdown.trim() : "";

  if (!prompt || !answer || !markdown) {
    return NextResponse.json({ error: "Prompt, answer, and markdown are required." }, { status: 400 });
  }

  const note = await prisma.generatedStudyNote.create({
    data: {
      userId: localUserId,
      prompt,
      answer,
      markdown,
      citations: Array.isArray(body.citations) ? body.citations : undefined
    }
  });

  return NextResponse.json({ note }, { status: 201 });
}
