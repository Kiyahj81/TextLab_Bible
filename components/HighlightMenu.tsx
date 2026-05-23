"use client";

import { ChevronDown, Highlighter } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  getStoredHighlightColor,
  setStoredHighlightColor
} from "@/lib/highlight";

export function HighlightMenu({
  onPick,
  disabled,
  label = "Highlight"
}: {
  onPick: (color: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [color, setColor] = useState<string>(DEFAULT_HIGHLIGHT_COLOR);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setColor(getStoredHighlightColor());
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
    setOpen(false);
    if (disabled) return;
    onPick(next);
  }

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={applyCurrent}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-l-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
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
        className="-ml-px inline-flex items-center rounded-r-md border border-stone-300 px-2 py-2 text-slate-500 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronDown size={14} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 flex gap-1 rounded-md border border-stone-300 bg-white p-2 shadow-lg"
        >
          {HIGHLIGHT_COLORS.map((option) => {
            const active = option.value === color;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => pick(option.value)}
                aria-label={option.label}
                title={option.label}
                className={`h-6 w-6 rounded-full border ${
                  active ? "border-slate-900 ring-2 ring-slate-300" : "border-stone-300 hover:border-slate-500"
                }`}
                style={{ backgroundColor: option.value }}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
