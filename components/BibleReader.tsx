"use client";

import { NotebookPen } from "lucide-react";
import { useRouter } from "next/navigation";
import type { SubmitEvent } from "react";
import { Fragment, useEffect, useState } from "react";
import { HighlightMenu } from "@/components/HighlightMenu";
import { MorphologyPopover, ReaderToken } from "@/components/MorphologyPopover";
import { ReaderModeToggle, type ReaderMode } from "@/components/ReaderModeToggle";
import { useAutoDismissMap } from "@/lib/useAutoDismissStatus";

const READER_MODE_STORAGE_KEY = "textlab-reader-mode";
const READER_MODES: ReaderMode[] = ["greek", "english", "parallel"];

function isReaderMode(value: string | null): value is ReaderMode {
  return value !== null && READER_MODES.includes(value as ReaderMode);
}

type ReaderVerse = {
  id: string;
  book: string;
  bookName: string;
  chapter: number;
  verse: number;
  reference: string;
  greekText: string;
  englishText: string;
  englishCorpus: string;
  tokens: ReaderToken[];
  highlightColor: string | null;
};

export function BibleReader({
  verses,
  targetVerse
}: {
  verses: ReaderVerse[];
  targetVerse?: number | null;
}) {
  const router = useRouter();
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [noteBodies, setNoteBodies] = useState<Record<string, string>>({});
  const [tokenNoteDrafts, setTokenNoteDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<Record<string, boolean>>({});
  const [highlighting, setHighlighting] = useState<Record<string, boolean>>({});
  const [readerMode, setReaderMode] = useState<ReaderMode>("parallel");

  useAutoDismissMap(status, setStatus);

  useEffect(() => {
    if (!targetVerse) return;
    const node = document.getElementById(`verse-${targetVerse}`);
    if (node) node.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [targetVerse]);

  useEffect(() => {
    const saved = typeof window === "undefined" ? null : window.localStorage.getItem(READER_MODE_STORAGE_KEY);
    if (isReaderMode(saved)) setReaderMode(saved);
  }, []);

  function changeReaderMode(next: ReaderMode) {
    setReaderMode(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(READER_MODE_STORAGE_KEY, next);
    }
  }

  function setTokenDraft(tokenId: string, next: string) {
    setTokenNoteDrafts((current) => ({ ...current, [tokenId]: next }));
  }

  function setVerseStatus(verseId: string, message: string) {
    setStatus((current) => ({ ...current, [verseId]: message }));
  }

  async function addVerseNote(event: SubmitEvent<HTMLFormElement>, verse: ReaderVerse) {
    event.preventDefault();
    const body = noteBodies[verse.id]?.trim();
    if (!body) return;
    if (savingNote[verse.id]) return;

    setSavingNote((current) => ({ ...current, [verse.id]: true }));
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verseId: verse.id,
          title: verse.reference,
          body,
          tags: ["verse"]
        })
      });

      if (response.ok) {
        setVerseStatus(verse.id, "Note saved.");
        setNoteBodies((current) => ({ ...current, [verse.id]: "" }));
      } else {
        setVerseStatus(verse.id, "Could not save note.");
      }
    } catch {
      setVerseStatus(verse.id, "Network error. Try again.");
    } finally {
      setSavingNote((current) => ({ ...current, [verse.id]: false }));
    }
  }

  async function highlightVerse(verse: ReaderVerse, color: string | null) {
    if (highlighting[verse.id]) return;

    setHighlighting((current) => ({ ...current, [verse.id]: true }));
    try {
      const response =
        color === null
          ? await fetch("/api/highlights", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ verseId: verse.id })
            })
          : await fetch("/api/highlights", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ verseId: verse.id, color })
            });

      if (response.ok) {
        setVerseStatus(verse.id, color === null ? "Highlight removed." : "Highlight saved.");
        router.refresh();
      } else {
        setVerseStatus(verse.id, color === null ? "Could not remove highlight." : "Could not save highlight.");
      }
    } catch {
      setVerseStatus(verse.id, "Network error. Try again.");
    } finally {
      setHighlighting((current) => ({ ...current, [verse.id]: false }));
    }
  }

  if (verses.length === 0) {
    return (
      <div className="rounded-md border border-stone-300 bg-white p-6 text-slate-700">
        No sample verses are available for this passage. Run the Prisma seed script after configuring PostgreSQL.
      </div>
    );
  }

  const showGreek = readerMode !== "english";
  const showEnglish = readerMode !== "greek";
  const showBothColumns = showGreek && showEnglish;

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <ReaderModeToggle mode={readerMode} onChange={changeReaderMode} />
      </div>

      {verses.map((verse) => (
        <article
          key={verse.id}
          id={`verse-${verse.verse}`}
          style={
            verse.highlightColor
              ? {
                  borderLeftColor: verse.highlightColor,
                  backgroundColor: `color-mix(in srgb, ${verse.highlightColor} 40%, transparent)`
                }
              : undefined
          }
          className={`scroll-mt-24 rounded-r-md border-l-2 py-2 pl-6 pr-3 ${
            verse.highlightColor ? "" : "border-accent-200"
          } ${targetVerse === verse.verse ? "ring-2 ring-amber-300 ring-offset-4 ring-offset-[var(--background)]" : ""}`}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="oldstyle-nums font-display text-base font-semibold text-slate-700">{verse.reference}</h2>
            <HighlightMenu
              label="Highlight verse"
              onPick={(color) => highlightVerse(verse, color)}
              disabled={highlighting[verse.id]}
            />
          </div>

          <div className={`grid gap-4 ${showBothColumns ? "md:grid-cols-2" : ""}`}>
            {showGreek ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">SBLGNT</div>
                <div className="greek-text text-[1.45rem] leading-10 text-slate-950">
                  {verse.tokens.length > 0
                    ? verse.tokens.map((token) => (
                        <Fragment key={token.id}>
                          <span className="relative inline-block">
                            <button
                              type="button"
                              onClick={() => setSelectedTokenId(selectedTokenId === token.id ? null : token.id)}
                              style={token.highlightColor ? { backgroundColor: token.highlightColor } : undefined}
                              className="mx-0.5 rounded px-1.5 py-1 transition-colors hover:bg-accent-50"
                            >
                              {token.surface}
                            </button>
                            {selectedTokenId === token.id ? (
                              <MorphologyPopover
                                token={token}
                                reference={verse.reference}
                                body={tokenNoteDrafts[token.id] ?? ""}
                                onBodyChange={(next) => setTokenDraft(token.id, next)}
                                onClose={() => setSelectedTokenId(null)}
                              />
                            ) : null}
                          </span>{" "}
                        </Fragment>
                      ))
                    : verse.greekText}
                </div>
              </div>
            ) : null}
            {showEnglish ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {verse.englishCorpus}
                </div>
                <p className="text-base leading-7 text-slate-800">{verse.englishText}</p>
              </div>
            ) : null}
          </div>

          <form onSubmit={(event) => addVerseNote(event, verse)} className="mt-4 border-t border-stone-200 pt-4">
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
              <NotebookPen size={16} />
              Note on {verse.reference}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={noteBodies[verse.id] ?? ""}
                onChange={(event) =>
                  setNoteBodies((current) => ({ ...current, [verse.id]: event.target.value }))
                }
                className="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600"
                placeholder="Write a brief note"
              />
              <button
                type="submit"
                disabled={savingNote[verse.id] || !(noteBodies[verse.id] ?? "").trim()}
                className="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save note
              </button>
            </div>
            {status[verse.id] ? <p className="mt-2 text-sm text-slate-600">{status[verse.id]}</p> : null}
          </form>
        </article>
      ))}
    </div>
  );
}
