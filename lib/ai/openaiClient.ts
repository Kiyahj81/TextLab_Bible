import OpenAI from "openai";

let cached: OpenAI | null = null;

export function getOpenAi() {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const timeoutRaw = Number.parseInt(process.env.OPENAI_REQUEST_TIMEOUT_MS?.trim() ?? "", 10);
  cached = new OpenAI({
    apiKey,
    timeout: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 25_000,
    maxRetries: 1
  });
  return cached;
}

export function resetOpenAiClient() {
  cached = null;
}
