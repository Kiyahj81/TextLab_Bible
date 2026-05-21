import { NextResponse } from "next/server";
import { answerBibleQuestion } from "@/lib/ai/assistant";
import { prisma } from "@/lib/db";
import { localUserId } from "@/lib/user";

export async function POST(request: Request) {
  const body = await request.json();
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  const session =
    requestedSessionId
      ? await prisma.aiSession.findFirst({
          where: { id: requestedSessionId, userId: localUserId }
        })
      : null;

  const activeSession =
    session ??
    (await prisma.aiSession.create({
      data: {
        userId: localUserId,
        title: prompt.slice(0, 80)
      }
    }));

  await prisma.aiMessage.create({
    data: {
      sessionId: activeSession.id,
      role: "user",
      content: prompt
    }
  });

  const answer = await answerBibleQuestion(prompt);
  const response = { ...answer, sessionId: activeSession.id };

  await prisma.aiMessage.create({
    data: {
      sessionId: activeSession.id,
      role: "assistant",
      content: response.answer,
      citations: {
        citations: response.citations,
        mode: response.mode,
        modelRole: response.modelRole,
        modelUsed: response.modelUsed,
        routingDecision: response.routingDecision,
        recommendedUpgrade: response.recommendedUpgrade ?? null,
        toolTrace: response.toolTrace
      }
    }
  });

  return NextResponse.json(response);
}
