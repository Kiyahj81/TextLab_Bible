"use client";

import Link from "next/link";
import { Save, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NotesSort } from "@/lib/notes-filter";
import { useAutoDismissMap } from "@/lib/useAutoDismissStatus";

export type NoteRow = {
  id: string;
  title: string | null;
  body: string;
  tags: string[];
  reference: string;
  book: string;
  chapter: number;
  verse: number;
  tokenSurface?: string;
};

const URL_SYNC_DEBOUNCE_MS = 300;

export function NotesPanel({
  notes,
  total,
  page,
  pageSize,
  pageCount,
  tag,
  reference,
  sort
}: {
  notes: NoteRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  tag: string;
  reference: string;
  sort: NotesSort;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState(notes);
  const [tagFilter, setTagFilter] = useState(tag);
  const [referenceFilter, setReferenceFilter] = useState(reference);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  useAutoDismissMap(status, setStatus);
  const initialRender = useRef(true);

  // Reset local state when the server resends a fresh page (different filter / sort / page).
  useEffect(() => {
    setRows(notes);
  }, [notes]);

  // Debounced URL sync for filter inputs. Server-side filtering picks up the new params.
  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      setOrDelete(next, "tag", tagFilter.trim());
      setOrDelete(next, "reference", referenceFilter.trim());
      // Reset to page 1 whenever filters change.
      next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `/notes?${qs}` : "/notes");
    }, URL_SYNC_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
    // searchParams is intentionally omitted: we want the debounce to fire only on filter input changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFilter, referenceFilter]);

  function onSortChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    setOrDelete(next, "sort", value === "recent" ? "" : value);
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `/notes?${qs}` : "/notes");
  }

  function setNoteStatus(id: string, message: string) {
    setStatus((current) => ({ ...current, [id]: message }));
  }

  async function save(note: NoteRow) {
    if (pending[note.id]) return;
    setPending((current) => ({ ...current, [note.id]: true }));
    try {
      const response = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note)
      });
      const message =
        response.ok ? "Saved." : response.status === 404 ? "Note not found." : "Could not save.";
      setNoteStatus(note.id, message);
    } catch {
      setNoteStatus(note.id, "Network error. Try again.");
    } finally {
      setPending((current) => ({ ...current, [note.id]: false }));
    }
  }

  async function remove(noteId: string) {
    if (pending[noteId]) return;
    setPending((current) => ({ ...current, [noteId]: true }));
    try {
      const response = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
      if (response.ok) {
        setRows((current) => current.filter((note) => note.id !== noteId));
        return;
      }
      const message = response.status === 404 ? "Note not found." : "Could not delete.";
      setNoteStatus(noteId, message);
    } catch {
      setNoteStatus(noteId, "Network error. Try again.");
    } finally {
      setPending((current) => ({ ...current, [noteId]: false }));
    }
  }

  const pageHref = (targetPage: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(targetPage));
    return `/notes?${next.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-md border border-stone-300 bg-white p-4 shadow-sm sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filter by tag</span>
          <input
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600"
            placeholder="verse"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filter by reference</span>
          <input
            value={referenceFilter}
            onChange={(event) => setReferenceFilter(event.target.value)}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600"
            placeholder="John or John 1"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sort</span>
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
          >
            <option value="recent">Most recent</option>
            <option value="canonical">Canonical</option>
            <option value="title">Title</option>
          </select>
        </label>
      </div>

      <p className="text-sm text-slate-600">
        {total === 0
          ? "No notes match the current filters."
          : `${total} note${total === 1 ? "" : "s"}${pageCount > 1 ? `, page ${page} of ${pageCount}` : ""}`}
      </p>

      <div className="space-y-3">
        {rows.map((note) => (
          <article key={note.id} className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  href={`/read?book=${note.book}&chapter=${note.chapter}&verse=${note.verse}`}
                  className="oldstyle-nums font-display text-base font-semibold text-slate-900 hover:underline"
                >
                  {note.reference}
                </Link>
                {note.tokenSurface ? (
                  <span className="greek-text ml-2 text-slate-600">token: {note.tokenSurface}</span>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {note.tags.map((noteTag) => (
                    <span key={noteTag} className="rounded bg-stone-100 px-2 py-1 text-xs text-slate-600">
                      {noteTag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => save(note)}
                  disabled={pending[note.id]}
                  className="inline-flex items-center gap-2 rounded-md bg-accent-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save size={16} />
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => remove(note.id)}
                  disabled={pending[note.id]}
                  className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-red-400 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </div>
            <input
              value={note.title ?? ""}
              onChange={(event) =>
                setRows((current) =>
                  current.map((row) => (row.id === note.id ? { ...row, title: event.target.value } : row))
                )
              }
              className="mt-4 w-full rounded-md border border-stone-300 px-3 py-2 text-sm font-medium outline-none focus:border-accent-600"
              placeholder="Title"
            />
            <textarea
              value={note.body}
              onChange={(event) =>
                setRows((current) =>
                  current.map((row) => (row.id === note.id ? { ...row, body: event.target.value } : row))
                )
              }
              className="mt-3 min-h-28 max-h-72 w-full overflow-auto rounded-md border border-stone-300 p-3 text-sm outline-none focus:border-accent-600"
            />
            {status[note.id] ? <p className="mt-2 text-sm text-slate-600">{status[note.id]}</p> : null}
          </article>
        ))}
        {rows.length === 0 ? (
          <div className="rounded-md border border-stone-300 bg-white p-6 text-slate-600">
            No notes match the current filters.
          </div>
        ) : null}
      </div>

      {pageCount > 1 ? (
        <nav className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-stone-200 bg-white p-3 text-sm">
          <PageLink href={pageHref(Math.max(page - 1, 1))} disabled={page <= 1} label="Previous" />
          <span className="text-slate-600">
            {pageSize} per page
          </span>
          <PageLink
            href={pageHref(Math.min(page + 1, pageCount))}
            disabled={page >= pageCount}
            label="Next"
          />
        </nav>
      ) : null}
    </div>
  );
}

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  const baseClass = "rounded-md border border-stone-300 px-3 py-2";
  if (disabled) {
    return <span className={`${baseClass} cursor-not-allowed opacity-50`}>{label}</span>;
  }
  return (
    <Link className={`${baseClass} hover:border-slate-500`} href={href}>
      {label}
    </Link>
  );
}

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  if (value) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
}
