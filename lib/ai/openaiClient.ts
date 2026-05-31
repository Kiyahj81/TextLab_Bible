import OpenAI from "openai";

let cached: OpenAI | null = null;

export function getOpenAi() {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const timeoutRaw = Number.parseInt(process.env.OPENAI_REQUEST_TIMEOUT_MS?.trim() ?? "", 10);
  // A full grounded answer (~MAX_OUTPUT_TOKENS of structured JSON with Greek)
  // routinely takes longer than 25s to generate. At the old 25s default the
  // client abandoned responses the model had actually completed server-side and
  // surfaced "Request timed out" → the local fallback. Default high enough to
  // receive a complete answer; override per-environment via the env var. Note:
  // on serverless hosts the function maxDuration must be at least this large or
  // the platform kills the request first.
  cached = new OpenAI({
    apiKey,
    timeout: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 120_000,
    maxRetries: 1
  });
  return cached;
}

export function resetOpenAiClient() {
  cached = null;
}
