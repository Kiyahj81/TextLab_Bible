"use client";

import { Download, Send } from "lucide-react";
import { FormEvent, useState } from "react";

type AssistantResponse = {
  answer: string;
  markdown: string;
  citations: Array<{
    reference: string;
    corpus: string;
    searchQuery: string;
  }>;
  toolTrace: string[];
};

const samplePrompt = "Show me every use of λόγος in John 1 and summarize the pattern.";

export function AiAssistant() {
  const [prompt, setPrompt] = useState(samplePrompt);
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    setLoading(false);

    if (!result.ok) {
      setError("The assistant could not answer this prompt.");
      return;
    }

    setResponse(await result.json());
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
              <h2 className="font-semibold text-slate-950">Answer</h2>
              <button
                type="button"
                onClick={downloadMarkdown}
                className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500"
              >
                <Download size={16} />
                Export Markdown
              </button>
            </div>
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
              response.toolTrace.map((trace) => (
                <code key={trace} className="block rounded bg-stone-100 p-2">
                  {trace}
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
                  <div className="text-xs text-slate-500">{citation.searchQuery}</div>
                </div>
              ))
            ) : (
              <p>No citations yet.</p>
            )}
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
