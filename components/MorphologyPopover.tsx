"use client";

import Link from "next/link";
import { Highlighter, NotebookPen, Search } from "lucide-react";
import { FormEvent, useState } from "react";

export type ReaderToken = {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  wordIndex: number;
  surface: string;
  normalized: string | null;
  lemma: string | null;
  morphCode: string | null;
  partOfSpeech: string | null;
  gloss: string | null;
  noteCount: number;
  highlighted: boolean;
};

export function MorphologyPopover({
  token,
  reference,
  onClose
}: {
  token: ReaderToken;
  reference: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;

    setSaving(true);
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenId: token.id,
        title: `${reference} ${token.surface}`,
        body,
        tags: ["word"]
      })
    });
    setSaving(false);

    if (response.ok) {
      setBody("");
      setStatus("Note saved.");
    } else {
      setStatus("Could not save note.");
    }
  }

  async function highlightToken() {
    setSaving(true);
    const response = await fetch("/api/highlights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId: token.id, color: "#fde68a" })
    });
    setSaving(false);
    setStatus(response.ok ? "Highlight saved." : "Could not save highlight.");
  }

  const lemmaSearchHref = `/search?mode=lemma&q=${encodeURIComponent(token.lemma ?? token.normalized ?? token.surface)}&book=${token.book}`;

  return (
    <div className="absolute left-0 top-full z-20 mt-2 w-80 rounded-md border border-stone-300 bg-white p-4 text-left shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="greek-text text-2xl font-semibold">{token.surface}</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{reference}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-stone-100"
        >
          Close
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-slate-500">Lemma</dt>
        <dd className="greek-text">{token.lemma ?? "Unknown"}</dd>
        <dt className="text-slate-500">Morphology</dt>
        <dd>{token.morphCode ?? "Unknown"}</dd>
        <dt className="text-slate-500">Part of speech</dt>
        <dd>{token.partOfSpeech ?? "Unknown"}</dd>
        <dt className="text-slate-500">Gloss</dt>
        <dd>{token.gloss ?? "Not supplied"}</dd>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={lemmaSearchHref}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          <Search size={16} />
          Search lemma
        </Link>
        <button
          type="button"
          onClick={highlightToken}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500"
        >
          <Highlighter size={16} />
          Highlight
        </button>
      </div>

      <form onSubmit={addNote} className="mt-4 space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <NotebookPen size={16} />
          Add note
        </label>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="min-h-20 w-full rounded-md border border-stone-300 p-2 text-sm outline-none focus:border-slate-600"
          placeholder="Write a note on this token"
        />
        <button
          type="submit"
          disabled={saving || !body.trim()}
          className="rounded-md bg-[#365f7e] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save note
        </button>
      </form>

      {status ? <p className="mt-3 text-sm text-slate-600">{status}</p> : null}
    </div>
  );
}
