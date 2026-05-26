import { NextResponse } from "next/server";
import { z } from "zod";

export const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

export type ErrorBody = { error: string; details?: unknown };

export function jsonError(message: string, status: number, details?: unknown): NextResponse {
  const body: ErrorBody = { error: message };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status });
}

export type ReadResult =
  | { ok: true; data: unknown }
  | { ok: false; response: NextResponse };

export async function readJsonLimited(
  request: Request,
  options: { maxBytes?: number } = {}
): Promise<ReadResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BODY_BYTES;

  const declared = request.headers.get("content-length");
  if (declared) {
    const declaredBytes = Number.parseInt(declared, 10);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      return { ok: false, response: jsonError("Request body too large.", 413) };
    }
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: jsonError("Could not read request body.", 400) };
  }

  // Byte-length check (UTF-8) — header may have been absent or lied.
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > maxBytes) {
    return { ok: false, response: jsonError("Request body too large.", 413) };
  }

  if (!text) {
    return { ok: true, data: {} };
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, response: jsonError("Invalid JSON body.", 400) };
  }
}

export type ValidateResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

export function validateBody<S extends z.ZodTypeAny>(
  data: unknown,
  schema: S
): ValidateResult<z.output<S>> {
  const result = schema.safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      response: jsonError("Invalid request body.", 400, formatZodIssues(result.error))
    };
  }
  return { ok: true, data: result.data };
}

function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message
  }));
}
