import { NextResponse } from "next/server";
import { answerBibleQuestion } from "@/lib/ai/assistant";

export async function POST(request: Request) {
  const body = await request.json();
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  const answer = await answerBibleQuestion(prompt);
  return NextResponse.json(answer);
}
