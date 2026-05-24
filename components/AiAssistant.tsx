"use client";

import { Download, Loader2, Save, Send, Sparkles } from "lucide-react";
import type { SubmitEvent } from "react";
import { useState } from "react";
import { formatToolTrace, type ToolTraceEntry } from "@/lib/ai/toolTrace";
import type { AssistantMode, ModelRole, RecommendedUpgrade } from "@/lib/ai/modelRouter";
import { useAutoDismissString } from "@/lib/useAutoDismissStatus";

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

const SAMPLE_PROMPT = "Show me every use of logos in John 1 and summarize the pattern.";

type RestoredView = {
  prompt: string;
  answer: string;
  markdown: string;
  createdAt: Date | string;
};

export function AiAssistant({ initialNotes }: { initialNotes: GeneratedStudyNoteRow[] }) {
  const [prompt, setPrompt] = useState("");
  const [responsePrompt, setResponsePrompt] = useState("");
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [restoredView, setRestoredView] = useState<RestoredView | null>(null);
  const [notes, setNotes] = useState(initialNotes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  // error stays persistent — user retries before it should clear.
  useAutoDismissString(saveStatus, setSaveStatus);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);
    setRestoredView(null);
    try {
      const result = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sessionId: response?.sessionId ?? null })
      });

      if (!result.ok) {
        setError("The assistant could not answer this prompt.");
        return;
      }

      const body = (await result.json()) as AssistantResponse;
      setResponse(body);
      setResponsePrompt(prompt);
      setPrompt("");
      setSaveStatus(null);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function downloadMarkdown() {
    const markdown = restoredView?.markdown ?? response?.markdown;
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "textlab-study-note.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function saveGeneratedNote() {
    if (!response || restoredView) return;
    if (savingNote) return;

    setSavingNote(true);
    setSaveStatus("Saving...");
    try {
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
    } catch {
      setSaveStatus("Network error. Try again.");
    } finally {
      setSavingNote(false);
    }
  }

  function openHistory(note: GeneratedStudyNoteRow) {
    setRestoredView({
      prompt: note.prompt,
      answer: note.answer,
      markdown: note.markdown,
      createdAt: note.createdAt
    });
    setError(null);
    setSaveStatus(null);
  }

  function clearHistoryView() {
    setRestoredView(null);
  }

  const answerVisible = Boolean(restoredView ?? response);
  const answerText = restoredView?.answer ?? response?.answer ?? "";
  const markdownText = restoredView?.markdown ?? response?.markdown ?? "";
  const headerLabel = restoredView ? responsePrompt || restoredView.prompt : null;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px] lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-4">
        <form onSubmit={submit} className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
          <label className="text-sm font-semibold text-slate-950">Question</label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={SAMPLE_PROMPT}
            className="mt-2 min-h-32 w-full rounded-md border border-stone-300 p-3 text-sm outline-none focus:border-accent-600"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading || !prompt.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-accent-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {loading ? "Retrieving..." : "Ask assistant"}
            </button>
            <button
              type="button"
              onClick={() => setPrompt(SAMPLE_PROMPT)}
              disabled={loading}
              className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles size={14} aria-hidden />
              Try an example
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        </form>

        {loading && !answerVisible ? <AnswerSkeleton /> : null}

        {answerVisible ? (
          <article className="animate-answer-in rounded-md border border-accent-200 bg-accent-50/40 p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-950">Answer</h2>
                  {restoredView ? (
                    <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      Saved
                    </span>
                  ) : response ? (
                    <ModeBadge mode={response.mode} />
                  ) : null}
                </div>
                {restoredView ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Saved on {new Date(restoredView.createdAt).toLocaleString()}
                    {headerLabel ? ` — "${headerLabel}"` : ""}
                  </p>
                ) : response ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {response.modelRole} — {response.modelUsed}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {restoredView ? (
                  <button
                    type="button"
                    onClick={clearHistoryView}
                    className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500"
                  >
                    Close
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500"
                >
                  <Download size={16} />
                  Export Markdown
                </button>
                {!restoredView ? (
                  <button
                    type="button"
                    onClick={saveGeneratedNote}
                    disabled={savingNote}
                    className="inline-flex items-center gap-2 rounded-md bg-accent-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save size={16} />
                    Save generated note
                  </button>
                ) : null}
              </div>
            </div>
            {!restoredView && response ? (
              <details className="mb-4 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-slate-700">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Routing decision
                </summary>
                <div className="mt-2">{response.routingDecision}</div>
                {response.recommendedUpgrade ? (
                  <div className="mt-2 text-slate-600">
                    Scholarly mode recommended later: {response.recommendedUpgrade.model} —{" "}
                    {response.recommendedUpgrade.reason}
                  </div>
                ) : null}
              </details>
            ) : null}
            {saveStatus ? <p className="mb-3 text-sm text-slate-600">{saveStatus}</p> : null}
            <pre className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-800">{answerText}</pre>
          </article>
        ) : !loading ? (
          <div className="rounded-md border border-stone-300 bg-white p-6 text-slate-600 shadow-sm">
            Ask a question about the sample passages. The assistant route retrieves first, then summarizes from returned results.
          </div>
        ) : null}
      </section>

      <aside className="space-y-6">
        <section className="border-l-2 border-accent-200 pl-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Retrieval trace</h2>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            {!restoredView && response?.toolTrace.length ? (
              response.toolTrace.map((entry, index) => (
                <code
                  key={index}
                  className="block overflow-x-auto whitespace-nowrap rounded bg-stone-100 p-2 font-mono text-xs"
                >
                  {formatToolTrace(entry)}
                </code>
              ))
            ) : restoredView ? (
              <p className="text-slate-500">Trace not stored for saved notes.</p>
            ) : (
              <p className="text-slate-500">No retrieval has run yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-slate-950">Citations</h2>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            {!restoredView && response?.citations.length ? (
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
            ) : restoredView ? (
              <p>Citations not stored for saved notes.</p>
            ) : (
              <p>No citations yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-slate-950">Generated notes</h2>
          <div className="mt-3 space-y-3">
            {notes.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => openHistory(note)}
                className="block w-full rounded border border-stone-200 p-3 text-left text-sm hover:border-slate-400"
              >
                <div className="font-medium text-slate-950">{note.prompt}</div>
                <time className="mt-1 block text-xs text-slate-500">
                  {new Date(note.createdAt).toLocaleString()}
                </time>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-slate-700">{note.answer}</p>
              </button>
            ))}
            {notes.length === 0 ? <p className="text-sm text-slate-600">No generated notes saved yet.</p> : null}
          </div>
        </section>

        {answerVisible ? (
          <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-slate-950">Markdown</h2>
            <textarea
              readOnly
              value={markdownText}
              className="mt-3 min-h-72 w-full rounded-md border border-stone-300 p-3 font-mono text-sm text-slate-700"
            />
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function ModeBadge({ mode }: { mode: AssistantMode }) {
  if (mode === "live") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
      Local fallback
    </span>
  );
}

function AnswerSkeleton() {
  return (
    <div
      role="status"
      aria-label="Retrieving answer"
      className="rounded-md border border-stone-300 bg-white p-4 shadow-sm"
    >
      <div className="space-y-3">
        <div className="h-4 w-1/3 animate-pulse rounded bg-stone-200" />
        <div className="h-3 w-full animate-pulse rounded bg-stone-200" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-stone-200" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-stone-200" />
      </div>
    </div>
  );
}
