import { AiAssistant } from "@/components/AiAssistant";
import { DismissibleIntro } from "@/components/DismissibleIntro";
import { assistantGuardrailsDisplay } from "@/lib/ai/assistantGuardrailsDisplay";
import { requirePageAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { introCookieName } from "@/lib/readerPrefs";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const userId = await requirePageAuth();
  const introDismissed = (await cookies()).get(introCookieName("assistant"))?.value === "1";
  const generatedNotes = await prisma.generatedStudyNote.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 25
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-accent-700">
          Corpus-Grounded Q&amp;A
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950">Assistant</h1>
        <DismissibleIntro id="assistant" defaultDismissed={introDismissed}>
          Ask corpus-backed Bible questions. The assistant shows model routing, retrieval trace, and citations before export.
        </DismissibleIntro>
      </div>

      <details className="rounded-md border border-stone-300 bg-white p-4 text-sm text-slate-700">
        <summary className="cursor-pointer font-semibold text-slate-950">Assistant guardrails</summary>
        <pre className="mt-3 whitespace-pre-wrap leading-6">{assistantGuardrailsDisplay}</pre>
      </details>

      <AiAssistant
        initialNotes={generatedNotes.map((note) => ({
          id: note.id,
          prompt: note.prompt,
          answer: note.answer,
          markdown: note.markdown,
          createdAt: note.createdAt.toISOString()
        }))}
      />
    </div>
  );
}
