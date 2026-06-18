// components/ReaderNotesDrawer.tsx
"use client";

import { NotebookText } from "lucide-react";
import { useState } from "react";
import { NoteList } from "@/components/NoteList";
import { FOCUS_RING } from "@/lib/ui/focus";

export type DrawerNote = { id: string; title: string | null; body: string; tags: string[]; reference: string; verse: number };

export function ReaderNotesDrawer({ items, onChanged }: { items: DrawerNote[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);

  // UX decision: hide the button entirely when the passage has no notes.
  if (items.length === 0) return null;

  function jump(verse: number) {
    const node = document.getElementById(`verse-${verse}`);
    if (!node) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    setOpen(false);
  }

  // Group by reference so the jump label + NoteList read cleanly.
  const groups = items.reduce<Record<string, DrawerNote[]>>((acc, n) => {
    (acc[n.reference] ??= []).push(n);
    return acc;
  }, {});

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-500 ${FOCUS_RING}`}
      >
        <NotebookText size={16} />
        Notes ({items.length})
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 max-h-[70vh] w-80 overflow-auto rounded-md border border-stone-300 bg-white p-3 shadow-xl">
          <div className="space-y-4">
            {Object.entries(groups).map(([reference, notes]) => (
              <div key={reference}>
                <button
                  type="button"
                  onClick={() => jump(notes[0].verse)}
                  aria-label={`Go to ${reference}`}
                  className={`mb-1 text-xs font-semibold uppercase tracking-wide text-accent-700 hover:text-accent-800 ${FOCUS_RING}`}
                >
                  {reference}
                </button>
                <NoteList notes={notes} onChanged={onChanged} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
