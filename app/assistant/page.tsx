import { AiAssistant } from "@/components/AiAssistant";
import { aiSystemPrompt } from "@/lib/ai/systemPrompt";
import { prisma } from "@/lib/db";
import { localUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const generatedNotes = await prisma.generatedStudyNote.findMany({
    where: { userId: localUserId },
    orderBy: { createdAt: "desc" },
    take: 25
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">AI Study Assistant</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Ask sample-data Bible questions. The assistant shows its retrieval trace and citations before export.
        </p>
      </div>

      <details className="rounded-md border border-stone-300 bg-white p-4 text-sm text-slate-700">
        <summary className="cursor-pointer font-semibold text-slate-950">System prompt guardrails</summary>
        <pre className="mt-3 whitespace-pre-wrap leading-6">{aiSystemPrompt}</pre>
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
