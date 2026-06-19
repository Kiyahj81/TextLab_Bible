// components/ReaderNotesDrawer.tsx
"use client";

import { NotebookText } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NoteList } from "@/components/NoteList";
import { FOCUS_RING } from "@/lib/ui/focus";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type DrawerNote = { id: string; title: string | null; body: string; tags: string[]; reference: string; verse: number };

export function ReaderNotesDrawer({ items, onChanged }: { items: DrawerNote[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState<"left" | "right">("left");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      const node = containerRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
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

  // Open toward the side with more room so the panel stays on-screen: left-anchored
  // when the trigger sits in the left half of the viewport (e.g. the sticky bar has
  // wrapped to a narrow row), right-anchored otherwise (the usual wide-screen case).
  // Measuring the trigger (not the panel) is alignment-independent, so toggling the
  // same button never oscillates. max-w caps the panel to the viewport on tiny screens.
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setAlign(rect.left + rect.width / 2 < window.innerWidth / 2 ? "left" : "right");
  }, [open]);

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
    <div ref={containerRef} className="relative">
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
        <div className={`absolute ${align === "right" ? "right-0" : "left-0"} z-20 mt-2 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border border-stone-300 bg-white p-3 shadow-xl`}>
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
