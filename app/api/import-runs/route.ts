import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const importRuns = await prisma.importRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 25
  });

  return NextResponse.json({ importRuns });
}
