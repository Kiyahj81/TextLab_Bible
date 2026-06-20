"use client";

import { useEffect } from "react";
import Link from "next/link";
import { FOCUS_RING } from "@/lib/ui/focus";

export default function RootError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <h1 className="font-display text-2xl font-semibold text-slate-950">
        Something went wrong
      </h1>
      <p className="mt-3 text-sm text-slate-600">
        An unexpected error occurred. Please try again.
      </p>
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={reset}
          className={`rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 ${FOCUS_RING}`}
        >
          Try again
        </button>
        <Link
          href="/"
          className={`rounded-md text-sm font-medium text-accent-700 hover:text-accent-800 ${FOCUS_RING}`}
        >
          Home
        </Link>
      </div>
    </div>
  );
}
