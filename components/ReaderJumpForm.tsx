"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { parsePassageQuery } from "@/lib/references";
import { FOCUS_RING_INPUT } from "@/lib/ui/focus";

export function ReaderJumpForm({ className }: { className?: string }) {
  const router = useRouter();
  const [ref, setRef] = useState("");
  const [refError, setRefError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = ref.trim();
    if (!query) return;
    const parsed = parsePassageQuery(query);
    if (!parsed) {
      setRefError("Try a reference like “John 3:16”.");
      return;
    }
    setRefError(null);
    const href = `/read?book=${encodeURIComponent(parsed.book)}&chapter=${parsed.chapter}${
      parsed.verse !== undefined ? `&verse=${parsed.verse}` : ""
    }`;
    router.push(href);
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      <input
        aria-label="reference"
        value={ref}
        onChange={(event) => { setRef(event.target.value); setRefError(null); }}
        placeholder="Go to e.g. John 3:16"
        className={`w-44 rounded-md border bg-white px-3 py-2 text-sm ${
          refError ? "border-red-400" : "border-stone-300"
        } ${FOCUS_RING_INPUT}`}
      />
      {refError ? <p role="alert" className="mt-1 text-sm text-red-700">{refError}</p> : null}
    </form>
  );
}
