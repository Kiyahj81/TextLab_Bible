"use client";

import { useEffect } from "react";
import { LAST_PASSAGE_COOKIE, writePrefCookie } from "@/lib/readerPrefs";

// Persists the current passage so the server can restore it on a bare /read
// visit (the redirect now happens server-side in app/read/page.tsx, before
// paint — no client flash). This component only writes; it never navigates.
export function ReaderLocationMemo({ book, chapter }: { book: string; chapter: number }) {
  useEffect(() => {
    writePrefCookie(LAST_PASSAGE_COOKIE, JSON.stringify({ book, chapter }));
  }, [book, chapter]);

  return null;
}
