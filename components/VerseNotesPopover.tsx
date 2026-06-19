// components/VerseNotesPopover.tsx
"use client";

import { NotebookPen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NoteList } from "@/components/NoteList";
import { FOCUS_RING } from "@/lib/ui/focus";

type Note = { id: string; title: string | null; body: string; tags: string[] };

export function VerseNotesPopover({ notes, reference, onChanged }: { notes: Note[]; reference: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      const node = containerRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Only verses that HAVE notes get the indicator (matches "see a verse has a note").
  if (notes.length === 0) return null;

  return (
    <span ref={containerRef} className="relative mr-0.5 inline-block align-super">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Notes on ${reference}`}
        className={`text-accent-600 hover:text-accent-800 ${FOCUS_RING}`}
      >
        <NotebookPen size={13} aria-hidden />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-stone-300 bg-white p-3 text-left shadow-xl">
          <NoteList notes={notes} onChanged={onChanged} />
        </div>
      ) : null}
    </span>
  );
}
