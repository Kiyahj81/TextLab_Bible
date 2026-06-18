"use client";

import { ChevronDown, Highlighter } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HighlightPalette } from "@/components/HighlightPalette";
import { FOCUS_RING } from "@/lib/ui/focus";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  broadcastHighlightColor,
  getStoredHighlightColor,
  setStoredHighlightColor,
  subscribeHighlightColor
} from "@/lib/highlight";

export function HighlightMenu({
  onPick,
  disabled,
  label = "Highlight"
}: {
  onPick: (color: string | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [color, setColor] = useState<string>(DEFAULT_HIGHLIGHT_COLOR);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setColor(getStoredHighlightColor());
    return subscribeHighlightColor(setColor);
  }, []);

  useEffect(() => {
    if (!open) return;

    function onMouseDown(event: MouseEvent) {
      const node = wrapperRef.current;
      if (!node) return;
      if (event.target instanceof Node && !node.contains(event.target)) {
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

  function applyCurrent() {
    if (disabled) return;
    onPick(color);
  }

  function pick(next: string) {
    setColor(next);
    setStoredHighlightColor(next);
    broadcastHighlightColor(next);
    setOpen(false);
    if (disabled) return;
    onPick(next);
  }

  function clear() {
    setOpen(false);
    if (disabled) return;
    onPick(null);
  }

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={applyCurrent}
        disabled={disabled}
        className={`inline-flex items-center gap-2 rounded-l-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      >
        <Highlighter size={16} style={{ color }} />
        {label}
      </button>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-label="Choose highlight color"
        aria-expanded={open}
        aria-haspopup="menu"
        className={`-ml-px inline-flex items-center rounded-r-md border border-stone-300 px-2 py-2 text-slate-500 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      >
        <ChevronDown size={14} aria-hidden />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 rounded-md border border-stone-300 bg-white p-2 shadow-lg">
          <HighlightPalette activeColor={color} onPick={pick} onClear={clear} />
        </div>
      ) : null}
    </div>
  );
}
