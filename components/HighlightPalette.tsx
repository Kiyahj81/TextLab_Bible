"use client";

import { Ban } from "lucide-react";
import { HIGHLIGHT_COLORS } from "@/lib/highlight";

export function HighlightPalette({
  activeColor,
  onPick,
  onClear,
  showClear = true
}: {
  activeColor?: string | null;
  onPick: (color: string) => void;
  onClear?: () => void;
  showClear?: boolean;
}) {
  return (
    <div role="menu" className="flex items-center gap-1">
      {HIGHLIGHT_COLORS.map((option) => {
        const active = option.value === activeColor;
        return (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            onClick={() => onPick(option.value)}
            aria-label={option.label}
            title={option.label}
            className={`h-6 w-6 rounded-full border ${
              active ? "border-slate-900 ring-2 ring-slate-300" : "border-stone-300 hover:border-slate-500"
            }`}
            style={{ backgroundColor: option.value }}
          />
        );
      })}
      {showClear && onClear ? (
        <>
          <span aria-hidden className="mx-1 h-6 w-px bg-stone-200" />
          <button
            type="button"
            role="menuitem"
            onClick={onClear}
            aria-label="Remove highlight"
            title="Remove highlight"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-stone-300 bg-white text-slate-500 hover:border-slate-500 hover:text-slate-700"
          >
            <Ban size={14} aria-hidden />
          </button>
        </>
      ) : null}
    </div>
  );
}
