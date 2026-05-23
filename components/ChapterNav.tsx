import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { bookName } from "@/lib/references";

type Neighbor = { book: string; chapter: number };

export function ChapterNav({
  prev,
  next
}: {
  prev: Neighbor | null;
  next: Neighbor | null;
}) {
  return (
    <nav aria-label="Chapter navigation" className="flex flex-wrap gap-2 text-sm">
      <NavLink
        direction="prev"
        target={prev}
        label={prev ? `${bookName(prev.book)} ${prev.chapter}` : "First chapter"}
      />
      <NavLink
        direction="next"
        target={next}
        label={next ? `${bookName(next.book)} ${next.chapter}` : "Last chapter"}
      />
    </nav>
  );
}

function NavLink({
  direction,
  target,
  label
}: {
  direction: "prev" | "next";
  target: Neighbor | null;
  label: string;
}) {
  const baseClass =
    "inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 font-medium text-slate-700";
  const disabledClass = "cursor-not-allowed opacity-50";
  const activeClass = "hover:border-slate-500 hover:bg-slate-50";

  const content =
    direction === "prev" ? (
      <>
        <ChevronLeft size={16} aria-hidden />
        <span>
          <span className="text-xs uppercase tracking-wide text-slate-500">Previous</span>
          <span className="ml-2">{label}</span>
        </span>
      </>
    ) : (
      <>
        <span>
          <span className="text-xs uppercase tracking-wide text-slate-500">Next</span>
          <span className="ml-2">{label}</span>
        </span>
        <ChevronRight size={16} aria-hidden />
      </>
    );

  if (!target) {
    return (
      <span aria-disabled className={`${baseClass} ${disabledClass}`}>
        {content}
      </span>
    );
  }

  return (
    <Link
      href={`/read?book=${target.book}&chapter=${target.chapter}`}
      className={`${baseClass} ${activeClass}`}
    >
      {content}
    </Link>
  );
}
