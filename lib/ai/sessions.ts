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

export async function startAssistantExchange(input: {
  requestedSessionId: string;
  prompt: string;
}): Promise<{ sessionId: string; userMessagePromise: Promise<unknown> }> {
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

  const userMessagePromise = prisma.aiMessage.create({
    data: {
      sessionId: session.id,
      role: "user",
      content: input.prompt,
      metadata: Prisma.JsonNull
    }
  });

  return { sessionId: session.id, userMessagePromise };
}

export async function finishAssistantExchange(input: {
  sessionId: string;
  userMessagePromise: Promise<unknown>;
  answer: AssistantAnswer;
}): Promise<void> {
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
    data: {
      sessionId: input.sessionId,
      role: "assistant",
      content: input.answer.answer,
      metadata: metadata as unknown as Prisma.InputJsonValue
    }
  });

  await Promise.all([input.userMessagePromise, assistantWrite]);
}
