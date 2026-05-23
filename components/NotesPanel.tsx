"use client";

import Link from "next/link";
import { Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

export type NoteRow = {
  id: string;
  title: string | null;
  body: string;
  tags: string[];
  reference: string;
  book: string;
  chapter: number;
  tokenSurface?: string;
};

export function NotesPanel({ notes }: { notes: NoteRow[] }) {
  const [rows, setRows] = useState(notes);
  const [tagFilter, setTagFilter] = useState("");
  const [referenceFilter, setReferenceFilter] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  function setNoteStatus(id: string, message: string) {
    setStatus((current) => ({ ...current, [id]: message }));
  }

  const filteredRows = useMemo(
    () =>
      rows.filter((note) => {
        const matchesTag = !tagFilter || note.tags.some((tag) => tag.toLowerCase().includes(tagFilter.toLowerCase()));
        const matchesReference =
          !referenceFilter || note.reference.toLowerCase().includes(referenceFilter.toLowerCase());
        return matchesTag && matchesReference;
      }),
    [rows, tagFilter, referenceFilter]
  );

  async function save(note: NoteRow) {
    if (pending[note.id]) return;
    setPending((current) => ({ ...current, [note.id]: true }));
    try {
      const response = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note)
      });
      const message =
        response.ok ? "Saved." : response.status === 404 ? "Note not found." : "Could not save.";
      setNoteStatus(note.id, message);
    } catch {
      setNoteStatus(note.id, "Network error. Try again.");
    } finally {
      setPending((current) => ({ ...current, [note.id]: false }));
    }
  }

  async function remove(noteId: string) {
    if (pending[noteId]) return;
    setPending((current) => ({ ...current, [noteId]: true }));
    try {
      const response = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
      if (response.ok) {
        setRows((current) => current.filter((note) => note.id !== noteId));
        return;
      }
      const message = response.status === 404 ? "Note not found." : "Could not delete.";
      setNoteStatus(noteId, message);
    } catch {
      setNoteStatus(noteId, "Network error. Try again.");
    } finally {
      setPending((current) => ({ ...current, [noteId]: false }));
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-md border border-stone-300 bg-white p-4 shadow-sm sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filter by tag</span>
          <input
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
            placeholder="verse, word"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filter by reference</span>
          <input
            value={referenceFilter}
            onChange={(event) => setReferenceFilter(event.target.value)}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
            placeholder="John 1:1"
          />
        </label>
      </div>

      <div className="space-y-3">
        {filteredRows.map((note) => (
          <article key={note.id} className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  href={`/read?book=${note.book}&chapter=${note.chapter}`}
                  className="font-semibold text-slate-950 hover:underline"
                >
                  {note.reference}
                </Link>
                {note.tokenSurface ? (
                  <span className="greek-text ml-2 text-slate-600">token: {note.tokenSurface}</span>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {note.tags.map((tag) => (
                    <span key={tag} className="rounded bg-stone-100 px-2 py-1 text-xs text-slate-600">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => save(note)}
                  disabled={pending[note.id]}
                  className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save size={16} />
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => remove(note.id)}
                  disabled={pending[note.id]}
                  className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-red-400 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </div>
            <input
              value={note.title ?? ""}
              onChange={(event) =>
                setRows((current) =>
                  current.map((row) => (row.id === note.id ? { ...row, title: event.target.value } : row))
                )
              }
              className="mt-4 w-full rounded-md border border-stone-300 px-3 py-2 text-sm font-medium outline-none focus:border-slate-600"
              placeholder="Title"
            />
            <textarea
              value={note.body}
              onChange={(event) =>
                setRows((current) =>
                  current.map((row) => (row.id === note.id ? { ...row, body: event.target.value } : row))
                )
              }
              className="mt-3 min-h-28 w-full rounded-md border border-stone-300 p-3 text-sm outline-none focus:border-slate-600"
            />
            {status[note.id] ? <p className="mt-2 text-sm text-slate-600">{status[note.id]}</p> : null}
          </article>
        ))}
        {filteredRows.length === 0 ? (
          <div className="rounded-md border border-stone-300 bg-white p-6 text-slate-600">
            No notes match the current filters.
          </div>
        ) : null}
      </div>
    </div>
  );
}
