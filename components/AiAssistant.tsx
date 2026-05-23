"use client";

import { Download, Save, Send } from "lucide-react";
import type { SubmitEvent } from "react";
import { useState } from "react";
import { formatToolTrace, type ToolTraceEntry } from "@/lib/ai/toolTrace";
import type { AssistantMode, ModelRole, RecommendedUpgrade } from "@/lib/ai/modelRouter";

type AssistantResponse = {
  answer: string;
  markdown: string;
  citations: Array<{
    reference: string;
    corpus: string;
    searchQuery: string;
    toolName?: string;
  }>;
  toolTrace: ToolTraceEntry[];
  mode: AssistantMode;
  sessionId: string;
  modelRole: ModelRole;
  modelUsed: string;
  routingDecision: string;
  recommendedUpgrade?: RecommendedUpgrade;
};

export type GeneratedStudyNoteRow = {
  id: string;
  prompt: string;
  answer: string;
  markdown: string;
  createdAt: Date | string;
};

const samplePrompt = "Show me every use of logos in John 1 and summarize the pattern.";

export function AiAssistant({ initialNotes }: { initialNotes: GeneratedStudyNoteRow[] }) {
  const [prompt, setPrompt] = useState(samplePrompt);
  const [responsePrompt, setResponsePrompt] = useState("");
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [notes, setNotes] = useState(initialNotes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, sessionId: response?.sessionId ?? null })
    });

    setLoading(false);

    if (!result.ok) {
      setError("The assistant could not answer this prompt.");
      return;
    }

    const body = (await result.json()) as AssistantResponse;
    setResponse(body);
    setResponsePrompt(prompt);
    setSaveStatus(null);
  }

  function downloadMarkdown() {
    if (!response) return;
    const blob = new Blob([response.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "textlab-study-note.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function saveGeneratedNote() {
    if (!response) return;
    setSaveStatus("Saving...");

    const result = await fetch("/api/generated-study-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: responsePrompt,
        answer: response.answer,
        markdown: response.markdown,
        citations: response.citations
      })
    });

    if (!result.ok) {
      setSaveStatus("Could not save generated note.");
      return;
    }

    const body = await result.json();
    setNotes((current) => [body.note, ...current].slice(0, 25));
    setSaveStatus("Generated note saved.");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-4">
        <form onSubmit={submit} className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
          <label className="text-sm font-semibold text-slate-950">Question</label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="mt-2 min-h-32 w-full rounded-md border border-stone-300 p-3 text-sm outline-none focus:border-slate-600"
          />
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} />
            {loading ? "Retrieving..." : "Ask assistant"}
          </button>
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        </form>

        {response ? (
          <article className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-950">Answer</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {response.mode === "live" ? "Live" : "Local fallback"} - {response.modelRole} - {response.modelUsed}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500"
                >
                  <Download size={16} />
                  Export Markdown
                </button>
                <button
                  type="button"
                  onClick={saveGeneratedNote}
                  className="inline-flex items-center gap-2 rounded-md bg-[#365f7e] px-3 py-2 text-sm font-medium text-white"
                >
                  <Save size={16} />
                  Save generated note
                </button>
              </div>
            </div>
            <div className="mb-4 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs text-slate-600">
              {response.routingDecision}
              {response.recommendedUpgrade ? (
                <div className="mt-2">
                  Scholarly mode recommended later: {response.recommendedUpgrade.model} - {response.recommendedUpgrade.reason}
                </div>
              ) : null}
            </div>
            {saveStatus ? <p className="mb-3 text-sm text-slate-600">{saveStatus}</p> : null}
            <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{response.answer}</pre>
          </article>
        ) : (
          <div className="rounded-md border border-stone-300 bg-white p-6 text-slate-600 shadow-sm">
            Ask a question about the sample passages. The assistant route retrieves first, then summarizes from returned results.
          </div>
        )}
      </section>

      <aside className="space-y-4">
        <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-slate-950">Retrieval trace</h2>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            {response?.toolTrace.length ? (
              response.toolTrace.map((entry, index) => (
                <code key={index} className="block rounded bg-stone-100 p-2">
                  {formatToolTrace(entry)}
                </code>
              ))
            ) : (
              <p>No retrieval has run yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-slate-950">Citations</h2>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            {response?.citations.length ? (
              response.citations.map((citation, index) => (
                <div key={`${citation.reference}-${index}`} className="rounded border border-stone-200 p-2">
                  <div className="font-medium text-slate-950">
                    {citation.reference}, {citation.corpus}
                  </div>
                  <div className="text-xs text-slate-500">
                    {[citation.toolName, citation.searchQuery].filter(Boolean).join(" - ")}
                  </div>
                </div>
              ))
            ) : (
              <p>No citations yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-slate-950">Generated notes</h2>
          <div className="mt-3 space-y-3">
            {notes.map((note) => (
              <article key={note.id} className="rounded border border-stone-200 p-3 text-sm">
                <div className="font-medium text-slate-950">{note.prompt}</div>
                <time className="mt-1 block text-xs text-slate-500">
                  {new Date(note.createdAt).toLocaleString()}
                </time>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-slate-700">{note.answer}</p>
              </article>
            ))}
            {notes.length === 0 ? <p className="text-sm text-slate-600">No generated notes saved yet.</p> : null}
          </div>
        </section>

        {response ? (
          <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-slate-950">Markdown</h2>
            <textarea
              readOnly
              value={response.markdown}
              className="mt-3 min-h-72 w-full rounded-md border border-stone-300 p-3 text-xs text-slate-700"
            />
          </section>
        ) : null}
      </aside>
    </div>
  );
}
