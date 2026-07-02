import { NextResponse } from "next/server";
import { z } from "zod";
import { answerBibleQuestion } from "@/lib/ai/assistant";
import { finishAssistantExchange, startAssistantExchange } from "@/lib/ai/sessions";
import { requireAuth } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/http/security";
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
  sessionId: z.string().trim().max(200).optional(),
  // User-confirmed escalation to the scholarly model. Never set automatically.
  escalate: z.boolean().optional(),
  // Ask-first preference: complex questions return recommendedUpgrade instead of
  // auto-escalating. Auto-escalation is the DEFAULT when this is unset.
  confirmEscalation: z.boolean().optional(),
  // DEPRECATED (remove after one release): pre-auto-default clients sent this.
  // An explicit `false` was an opt-out of auto-scholarly and must stay one.
  autoEscalate: z.boolean().optional()
});

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

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

  const { prompt, sessionId: requestedSessionId = "", escalate = false } = valid.data;
  const confirmEscalation =
    valid.data.confirmEscalation ?? (valid.data.autoEscalate === false ? true : false);

  const { sessionId, userMessagePromise } = await startAssistantExchange({
    userId,
    requestedSessionId,
    prompt
  });
  const answer = await answerBibleQuestion(prompt, { escalate, confirmEscalation });
  await finishAssistantExchange({ sessionId, userMessagePromise, answer });

  return NextResponse.json({ ...answer, sessionId });
}
