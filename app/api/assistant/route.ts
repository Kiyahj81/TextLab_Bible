import { NextResponse } from "next/server";
import { answerBibleQuestion } from "@/lib/ai/assistant";
import { recordAssistantExchange } from "@/lib/ai/sessions";

export async function POST(request: Request) {
  const body = await request.json();
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  const answer = await answerBibleQuestion(prompt);
  const sessionId = await recordAssistantExchange({ requestedSessionId, prompt, answer });

  return NextResponse.json({ ...answer, sessionId });
}
