"use client";

import Link from "next/link";
import { Highlighter, NotebookPen, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import type { SubmitEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const POPOVER_MARGIN = 8;
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type ReaderToken = {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  wordIndex: number;
  surface: string;
  normalized: string | null;
  lemma: string | null;
  morphCode: string | null;
  partOfSpeech: string | null;
  gloss: string | null;
  noteCount: number;
  highlighted: boolean;
};

export function MorphologyPopover({
  token,
  reference,
  body,
  onBodyChange,
  onClose
}: {
  token: ReaderToken;
  reference: string;
  body: string;
  onBodyChange: (next: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [horizontalAlign, setHorizontalAlign] = useState<"left" | "right">("left");

  useIsomorphicLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const overflowsRight = rect.right > window.innerWidth - POPOVER_MARGIN;
    setHorizontalAlign(overflowsRight ? "right" : "left");
  }, [token.id]);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      const node = containerRef.current;
      if (!node) return;
      // The trigger token button is a sibling of this popover inside a shared
      // wrapper span. Widening the "inside" check to the popover's parent
      // ensures clicking the same token still toggles via its own onClick
      // handler instead of being treated as an outside click.
      const scope = node.parentElement ?? node;
      if (event.target instanceof Node && !scope.contains(event.target)) {
        onClose();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  async function addNote(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    if (saving) return;

    setSaving(true);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: token.id,
          title: `${reference} ${token.surface}`,
          body,
          tags: ["word"]
        })
      });

      if (response.ok) {
        onBodyChange("");
        setStatus("Note saved.");
      } else {
        setStatus("Could not save note.");
      }
    } catch {
      setStatus("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function highlightToken() {
    if (saving) return;

    setSaving(true);
    try {
      const response = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId: token.id, color: "#fde68a" })
      });

      if (response.ok) {
        setStatus("Highlight saved.");
        router.refresh();
      } else {
        setStatus("Could not save highlight.");
      }
    } catch {
      setStatus("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const lemmaSearchHref = `/search?mode=lemma&q=${encodeURIComponent(token.lemma ?? token.normalized ?? token.surface)}&book=${token.book}`;

  return (
    <div
      ref={containerRef}
      className={`absolute top-full z-20 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-md border border-stone-300 bg-white p-4 text-left shadow-xl ${
        horizontalAlign === "right" ? "right-0" : "left-0"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="greek-text text-2xl font-semibold">{token.surface}</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{reference}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-stone-100"
        >
          Close
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-slate-500">Lemma</dt>
        <dd className="greek-text">{token.lemma ?? "Unknown"}</dd>
        <dt className="text-slate-500">Morphology</dt>
        <dd>{token.morphCode ?? "Unknown"}</dd>
        <dt className="text-slate-500">Part of speech</dt>
        <dd>{token.partOfSpeech ?? "Unknown"}</dd>
        <dt className="text-slate-500">Gloss</dt>
        <dd>{token.gloss ?? "Not supplied"}</dd>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={lemmaSearchHref}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          <Search size={16} />
          Search lemma
        </Link>
        <button
          type="button"
          onClick={highlightToken}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500"
        >
          <Highlighter size={16} />
          Highlight
        </button>
      </div>

      <form onSubmit={addNote} className="mt-4 space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <NotebookPen size={16} />
          Add note
        </label>
        <textarea
          value={body}
          onChange={(event) => onBodyChange(event.target.value)}
          className="min-h-20 w-full rounded-md border border-stone-300 p-2 text-sm outline-none focus:border-slate-600"
          placeholder="Write a note on this token"
        />
        <button
          type="submit"
          disabled={saving || !body.trim()}
          className="rounded-md bg-[#365f7e] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save note
        </button>
      </form>

      {status ? <p className="mt-3 text-sm text-slate-600">{status}</p> : null}
    </div>
  );
}
