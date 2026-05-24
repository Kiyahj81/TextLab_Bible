"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const STORAGE_KEY = "textlab-reader-last-passage";

type SavedPassage = { book: string; chapter: number };

function readSavedPassage(): SavedPassage | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPassage>;
    if (typeof parsed?.book === "string" && typeof parsed?.chapter === "number") {
      return { book: parsed.book, chapter: parsed.chapter };
    }
  } catch {
    // malformed storage — ignore
  }
  return null;
}

export function ReaderLocationMemo({ book, chapter }: { book: string; chapter: number }) {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isBareUrl = window.location.search === "";
    if (isBareUrl) {
      const saved = readSavedPassage();
      if (saved && (saved.book !== book || saved.chapter !== chapter)) {
        router.replace(`/read?book=${saved.book}&chapter=${saved.chapter}`);
        return;
      }
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ book, chapter }));
  }, [book, chapter, router]);

  return null;
}
