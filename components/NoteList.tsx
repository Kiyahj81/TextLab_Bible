// components/NoteList.tsx
"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { FOCUS_RING, FOCUS_RING_INPUT } from "@/lib/ui/focus";

type Note = { id: string; title: string | null; body: string; tags: string[] };

export function NoteList({ notes, onChanged }: { notes: Note[]; onChanged: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" }
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function save(note: Note) {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      // Send the full note (title + tags), not just body — the PATCH route rewrites
      // tags from the request, so a body-only PATCH would clear existing word/verse tags.
      const res = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: note.title ?? undefined, body, tags: note.tags })
      });
      if (res.ok) { setEditingId(null); onChanged(); }
    } finally {
      setBusy(false);
    }
  }

  if (notes.length === 0) return null;

  return (
    <ul className="space-y-2">
      {notes.map((note) => (
        <li key={note.id} className="rounded-md border border-stone-200 bg-white p-3 text-sm">
          {editingId === note.id ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className={`min-h-16 w-full rounded-md border border-stone-300 px-2 py-1 ${FOCUS_RING_INPUT}`}
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditingId(null)} className={`rounded-md px-2 py-1 text-slate-600 ${FOCUS_RING}`}>Cancel</button>
                <button type="button" disabled={busy} onClick={() => save(note)} className={`rounded-md bg-accent-600 px-3 py-1 font-medium text-white disabled:opacity-50 ${FOCUS_RING}`}>Save</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <p className="whitespace-pre-wrap text-slate-700">{note.body}</p>
              <div className="flex shrink-0 gap-1">
                <button type="button" aria-label="Edit note" onClick={() => { setEditingId(note.id); setDraft(note.body); }} className={`rounded-md p-1 text-slate-500 hover:text-slate-800 ${FOCUS_RING}`}><Pencil size={14} /></button>
                <button type="button" aria-label="Delete note" disabled={busy} onClick={() => remove(note.id)} className={`rounded-md p-1 text-slate-500 hover:text-red-700 ${FOCUS_RING}`}><Trash2 size={14} /></button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
