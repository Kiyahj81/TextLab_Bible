import { NextResponse } from "next/server";
import { z } from "zod";
import { answerBibleQuestion } from "@/lib/ai/assistant";
import { finishAssistantExchange, startAssistantExchange } from "@/lib/ai/sessions";
import { requireAuth } from "@/lib/auth";
import {
  jsonError,
  readJsonLimited,
  validateBody
} from "@/lib/http/validation";
import {
  consume,
  getClientIp,
  rateLimitKey,
  shouldEnforceLocalRateLimit
} from "@/lib/rate-limit";

const ASSISTANT_MAX_PROMPT_CHARS = 2_000;
const ASSISTANT_RATE_LIMIT = { burst: 10, refillPerSecond: 10 / 60 };

const assistantSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required.").max(
    ASSISTANT_MAX_PROMPT_CHARS,
    `Prompt must be ${ASSISTANT_MAX_PROMPT_CHARS} characters or fewer.`
  ),
  sessionId: z.string().trim().max(200).optional()
});

export async function POST(request: Request) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult;

  const read = await readJsonLimited(request);
  if (!read.ok) return read.response;

  const valid = validateBody(read.data, assistantSchema);
  if (!valid.ok) return valid.response;

  if (shouldEnforceLocalRateLimit()) {
    const ip = getClientIp(request.headers);
    const key = rateLimitKey({ userId, ip, scope: "assistant" });
    const limit = consume(key, ASSISTANT_RATE_LIMIT);
    if (!limit.allowed) {
      const response = jsonError("Rate limit exceeded.", 429);
      response.headers.set("Retry-After", String(limit.retryAfterSeconds));
      return response;
    }
  }

  const { prompt, sessionId: requestedSessionId = "" } = valid.data;

  const { sessionId, userMessagePromise } = await startAssistantExchange({
    userId,
    requestedSessionId,
    prompt
  });
  const answer = await answerBibleQuestion(prompt);
  await finishAssistantExchange({ sessionId, userMessagePromise, answer });

  return NextResponse.json({ ...answer, sessionId });
}
