import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  const importRuns = await prisma.importRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 25
  });

  return NextResponse.json({ importRuns });
}
