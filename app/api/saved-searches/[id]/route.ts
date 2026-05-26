import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { jsonError, readJsonLimited, validateBody } from "@/lib/http/validation";

type Params = Promise<{ id: string }>;

const MAX_LABEL = 100;

const savedSearchPatchSchema = z.object({
  label: z.string().trim().min(1, "Label is required.").max(MAX_LABEL)
});

export async function PATCH(request: Request, { params }: { params: Params }) {
  const { id } = await params;

  const read = await readJsonLimited(request);
  if (!read.ok) return read.response;

  const valid = validateBody(read.data, savedSearchPatchSchema);
  if (!valid.ok) return valid.response;

  const userId = await requireUserId();
  const { label } = valid.data;

  const result = await prisma.savedSearch.updateMany({
    where: { id, userId },
    data: { label }
  });

  if (result.count === 0) {
    return jsonError("Saved search not found.", 404);
  }

  const savedSearch = await prisma.savedSearch.findFirst({
    where: { id, userId }
  });

  return NextResponse.json({ savedSearch });
}

export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { id } = await params;
  const userId = await requireUserId();

  const result = await prisma.savedSearch.deleteMany({
    where: { id, userId }
  });

  if (result.count === 0) {
    return jsonError("Saved search not found.", 404);
  }

  return NextResponse.json({ ok: true });
}
