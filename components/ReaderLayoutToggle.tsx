"use client";

import type { ReaderLayout } from "@/lib/readerPrefs";
import { FOCUS_RING } from "@/lib/ui/focus";

const OPTIONS: { value: ReaderLayout; label: string }[] = [
  { value: "study", label: "Study" },
  { value: "continuous", label: "Continuous" }
];

export function ReaderLayoutToggle({
  layout,
  onChange,
  continuousDisabled = false
}: {
  layout: ReaderLayout;
  onChange: (next: ReaderLayout) => void;
  continuousDisabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Reading layout" className="inline-flex rounded-md border border-stone-300 bg-white p-0.5 text-sm">
      {OPTIONS.map((option) => {
        const active = layout === option.value;
        const disabled = option.value === "continuous" && continuousDisabled;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={disabled ? "Switch to Greek or English for continuous reading" : undefined}
            onClick={() => onChange(option.value)}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${FOCUS_RING} ${
              active ? "bg-accent-700 text-white" : "text-slate-600 hover:text-slate-900"
            } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
