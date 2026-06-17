// components/ReaderMasthead.tsx
export function ReaderMasthead({ bookLabel, chapter }: { bookLabel: string; chapter: number }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-accent-700">
        SBLGNT · Greek New Testament
      </p>
      <h1 className="flex items-baseline gap-3 font-display tracking-tight text-slate-950">
        <span className="text-4xl font-semibold">{bookLabel}</span>
        <span className="oldstyle-nums text-5xl font-normal leading-none text-accent-700">{chapter}</span>
      </h1>
    </div>
  );
}
