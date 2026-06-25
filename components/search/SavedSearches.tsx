"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { bookName } from "@/lib/references";
import { searchHref } from "@/components/search/searchHref";
import type { SavedSearchRow } from "@/components/search/types";

export function SavedSearches(props: {
  pageSize: number;
  saved: SavedSearchRow[];
  pending: Record<string, boolean>;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  itemStatus: Record<string, string>;
  deleteSavedSearch: (id: string) => Promise<void>;
  renameSavedSearch: (id: string, newLabel: string) => Promise<void>;
}) {
  const { pageSize, saved, pending, editingId, setEditingId, itemStatus, deleteSavedSearch, renameSavedSearch } = props;
  return (
      <aside className="border-l-2 border-accent-200 pl-4 xl:sticky xl:top-6 xl:self-start">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Saved searches</h2>
        <div className="mt-3 divide-y divide-stone-200">
          {saved.map((item) => (
            <div key={item.id} className="py-3 text-sm">
              {editingId === item.id ? (
                <input
                  autoFocus
                  aria-label="Saved search name"
                  defaultValue={item.label}
                  onBlur={(event) => renameSavedSearch(item.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      renameSavedSearch(item.id, event.currentTarget.value);
                    } else if (event.key === "Escape") {
                      setEditingId(null);
                    }
                  }}
                  disabled={pending[item.id]}
                  className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm outline-none focus:border-accent-600 disabled:opacity-50"
                />
              ) : (
                <Link
                  href={searchHref({
                    mode: item.mode,
                    query: item.query ?? "",
                    book: item.book ?? "",
                    chapter: item.chapter ? String(item.chapter) : "",
                    matchMode: item.matchMode ?? "exact",
                    domain: item.domain ?? "",
                    subdomain: item.subdomain ?? "",
                    ln: item.ln ?? "",
                    page: 1,
                    pageSize
                  })}
                  className="block hover:underline"
                >
                  <span className="font-medium text-slate-950">{item.label}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {item.mode} {item.book ? `in ${bookName(item.book)}` : "in all books"}
                  </span>
                </Link>
              )}
              <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => setEditingId(editingId === item.id ? null : item.id)}
                  disabled={pending[item.id]}
                  className="inline-flex items-center gap-1 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Pencil size={12} aria-hidden />
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => deleteSavedSearch(item.id)}
                  disabled={pending[item.id]}
                  className="inline-flex items-center gap-1 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={12} aria-hidden />
                  Delete
                </button>
                <span role="status" aria-live="polite" className="ml-auto text-slate-500">
                  {itemStatus[item.id] ?? ""}
                </span>
              </div>
            </div>
          ))}
          {saved.length === 0 ? <p className="text-sm text-slate-600">No saved searches yet.</p> : null}
        </div>
      </aside>
  );
}
