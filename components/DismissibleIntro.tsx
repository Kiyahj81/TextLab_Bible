"use client";

import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export function DismissibleIntro({ id, children }: { id: string; children: ReactNode }) {
  const storageKey = `textlab-intro-dismissed-${id}`;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(storageKey) === "1") {
      setDismissed(true);
    }
  }, [storageKey]);

  if (dismissed) return null;

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, "1");
    }
    setDismissed(true);
  }

  return (
    <div className="mt-2 flex max-w-2xl items-start gap-3">
      <p className="text-slate-600">{children}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss this description"
        className="mt-0.5 text-slate-400 hover:text-slate-700"
      >
        <X size={16} />
      </button>
    </div>
  );
}
