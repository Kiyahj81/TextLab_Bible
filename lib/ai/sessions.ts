import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { localUserId } from "@/lib/user";
import type { AssistantAnswer } from "@/lib/ai/assistant";

export type AssistantMessageMetadata = {
  mode: AssistantAnswer["mode"];
  modelRole: AssistantAnswer["modelRole"];
  modelUsed: AssistantAnswer["modelUsed"];
  routingDecision: AssistantAnswer["routingDecision"];
  recommendedUpgrade?: AssistantAnswer["recommendedUpgrade"];
  citations: AssistantAnswer["citations"];
  toolTrace: AssistantAnswer["toolTrace"];
};

export async function recordAssistantExchange(input: {
  requestedSessionId: string;
  prompt: string;
  answer: AssistantAnswer;
}) {
  const existing = input.requestedSessionId
    ? await prisma.aiSession.findFirst({
        where: { id: input.requestedSessionId, userId: localUserId }
      })
    : null;

  const session =
    existing ??
    (await prisma.aiSession.create({
      data: { userId: localUserId, title: input.prompt.slice(0, 80) }
    }));

  const userWrite = prisma.aiMessage.create({
    data: {
      sessionId: session.id,
      role: "user",
      content: input.prompt,
      metadata: Prisma.JsonNull
    }
  });

  const metadata: AssistantMessageMetadata = {
    mode: input.answer.mode,
    modelRole: input.answer.modelRole,
    modelUsed: input.answer.modelUsed,
    routingDecision: input.answer.routingDecision,
    recommendedUpgrade: input.answer.recommendedUpgrade,
    citations: input.answer.citations,
    toolTrace: input.answer.toolTrace
  };

  const assistantWrite = prisma.aiMessage.create({
    data: { sessionId: session.id, role: "assistant", content: input.answer.answer, metadata }
  });

  await Promise.all([userWrite, assistantWrite]);
  return session.id;
}
