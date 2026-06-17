"use client";

import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { introCookieName, writePrefCookie } from "@/lib/readerPrefs";

export function DismissibleIntro({
  id,
  defaultDismissed = false,
  children
}: {
  id: string;
  defaultDismissed?: boolean;
  children: ReactNode;
}) {
  const [dismissed, setDismissed] = useState(defaultDismissed);

  if (dismissed) return null;

  function dismiss() {
    writePrefCookie(introCookieName(id), "1");
    setDismissed(true);
  }

  return (
    <div className="mt-2 flex max-w-2xl items-start gap-3">
      <p className="text-slate-600">{children}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss this description"
        className="mt-0.5 text-slate-500 hover:text-slate-700"
      >
        <X size={16} />
      </button>
    </div>
  );
}
