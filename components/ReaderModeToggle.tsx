"use client";

export type ReaderMode = "greek" | "english" | "parallel";

const OPTIONS: { value: ReaderMode; label: string }[] = [
  { value: "greek", label: "Greek" },
  { value: "english", label: "English" },
  { value: "parallel", label: "Parallel" }
];

export function ReaderModeToggle({
  mode,
  onChange
}: {
  mode: ReaderMode;
  onChange: (next: ReaderMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Reader display mode"
      className="inline-flex rounded-md border border-stone-300 bg-white p-0.5 text-sm"
    >
      {OPTIONS.map((option) => {
        const active = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${
              active
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
