"use client";

import { useState } from "react";
import type { DomainOptions } from "@/lib/search";
import { useAutoDismissMap, useAutoDismissString } from "@/lib/useAutoDismissStatus";
import { normalizeSearchMode } from "@/lib/searchMode";
import type { SavedSearchRow } from "@/components/search/types";

function domainSaveLabel(
  domainOptions: DomainOptions,
  filter: { domain: string; subdomain: string; ln: string }
): string {
  let raw: string;
  if (filter.ln) {
    raw = `domain: LN ${filter.ln}`;
  } else if (filter.subdomain) {
    const parent = filter.subdomain.slice(0, 3);
    const sub = domainOptions.subdomainsByDomain[parent]?.find((s) => s.code === filter.subdomain);
    raw = sub ? `domain: ${sub.label}` : `domain: ${filter.subdomain}`;
  } else {
    const d = domainOptions.domains.find((entry) => entry.code === filter.domain);
    raw = d ? `domain: ${d.number} — ${d.label}` : `domain: ${filter.domain}`;
  }
  // The saved-searches API caps labels at 100 chars; a few Louw-Nida subdomain
  // labels exceed that and would 400 the save.
  return raw.length > 100 ? `${raw.slice(0, 99)}…` : raw;
}

type SavedSearchExecuted = {
  mode: string;
  query: string;
  book: string;
  chapter: string;
  matchMode: string;
  domain: string;
  subdomain: string;
  ln: string;
  domainOptions: DomainOptions;
};

export function useSavedSearches(initial: SavedSearchRow[], executed: SavedSearchExecuted) {
  const { mode, query, book, chapter, matchMode, domain, subdomain, ln, domainOptions } = executed;
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [itemStatus, setItemStatus] = useState<Record<string, string>>({});

  useAutoDismissString(saveStatus, setSaveStatus);
  useAutoDismissMap(itemStatus, setItemStatus);

  function setRowStatus(id: string, message: string | null) {
    setItemStatus((current) => ({ ...current, [id]: message ?? "" }));
  }

  async function saveSearch() {
    const executedMode = normalizeSearchMode(mode);
    const isDomain = executedMode === "domain";
    if (isDomain ? !(domain || subdomain || ln) : !query.trim()) return;
    if (saving) return;

    setSaving(true);
    setSaveStatus("Saving...");
    try {
      const response = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isDomain
            ? {
                mode: executedMode,
                label: domainSaveLabel(domainOptions, { domain, subdomain, ln }),
                ...(domain ? { domain } : {}),
                ...(subdomain ? { subdomain } : {}),
                ...(ln ? { ln } : {}),
                ...(book ? { book } : {}),
                ...(chapter ? { chapter: Number(chapter) } : {})
              }
            : {
                mode: executedMode,
                query,
                // Omit empty optional fields — the server schema rejects empty
                // strings on coerced-number / enum fields (chapter, matchMode).
                ...(book ? { book } : {}),
                ...(chapter ? { chapter: Number(chapter) } : {}),
                ...(executedMode === "morphology" && matchMode ? { matchMode } : {})
              }
        )
      });

      if (!response.ok) {
        setSaveStatus("Could not save search.");
        return;
      }

      const body = await response.json();
      setSaved((current) => [body.savedSearch, ...current].slice(0, 25));
      setSaveStatus("Search saved.");
    } catch {
      setSaveStatus("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSavedSearch(id: string) {
    if (pending[id]) return;
    setPending((current) => ({ ...current, [id]: true }));
    try {
      const response = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
      if (response.ok) {
        setSaved((current) => current.filter((row) => row.id !== id));
        return;
      }
      const message = response.status === 404 ? "Already removed." : "Could not delete.";
      setRowStatus(id, message);
    } catch {
      setRowStatus(id, "Network error.");
    } finally {
      setPending((current) => ({ ...current, [id]: false }));
    }
  }

  async function renameSavedSearch(id: string, newLabel: string) {
    const label = newLabel.trim();
    if (!label) {
      setEditingId(null);
      return;
    }
    if (pending[id]) return;
    setPending((current) => ({ ...current, [id]: true }));
    try {
      const response = await fetch(`/api/saved-searches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label })
      });
      if (response.ok) {
        setSaved((current) => current.map((row) => (row.id === id ? { ...row, label } : row)));
        setEditingId(null);
        return;
      }
      const message = response.status === 404 ? "Already removed." : "Could not rename.";
      setRowStatus(id, message);
    } catch {
      setRowStatus(id, "Network error.");
    } finally {
      setPending((current) => ({ ...current, [id]: false }));
    }
  }

  return {
    saved,
    saveStatus,
    saving,
    saveSearch,
    pending,
    editingId,
    setEditingId,
    itemStatus,
    deleteSavedSearch,
    renameSavedSearch
  };
}
