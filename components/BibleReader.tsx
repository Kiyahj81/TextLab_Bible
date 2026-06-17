"use client";

import { NotebookPen } from "lucide-react";
import type { SubmitEvent } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { EnglishWordPopover } from "@/components/EnglishWordPopover";
import { MorphologyPopover, ReaderToken } from "@/components/MorphologyPopover";
import { ReaderModeToggle } from "@/components/ReaderModeToggle";
import { writePrefCookie, READER_MODE_COOKIE, type ReaderMode } from "@/lib/readerPrefs";
import { useAutoDismissMap } from "@/lib/useAutoDismissStatus";

type EnglishHighlight = { wordIndex: number; color: string };

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
  englishVerseId: string | null;
  englishHighlights: EnglishHighlight[];
  tokens: ReaderToken[];
};

type EnglishToken = { kind: "word"; value: string; wordIndex: number } | { kind: "space"; value: string };

function tokenizeEnglish(text: string): EnglishToken[] {
  if (!text) return [];
  const parts = text.split(/(\s+)/);
  const result: EnglishToken[] = [];
  let wordIndex = 0;
  for (const part of parts) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      result.push({ kind: "space", value: part });
    } else {
      result.push({ kind: "word", value: part, wordIndex });
      wordIndex += 1;
    }
  }
  return result;
}

export function BibleReader({
  verses,
  targetVerse,
  initialMode = "parallel",
  chapterLabel
}: {
  verses: ReaderVerse[];
  targetVerse?: number | null;
  initialMode?: ReaderMode;
  chapterLabel: string;
}) {
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedEnglishWord, setSelectedEnglishWord] = useState<string | null>(null);
  const [noteBodies, setNoteBodies] = useState<Record<string, string>>({});
  const [tokenNoteDrafts, setTokenNoteDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<Record<string, boolean>>({});
  const [readerMode, setReaderMode] = useState<ReaderMode>(initialMode);
  const [tokenColorOverride, setTokenColorOverride] = useState<Record<string, string | null>>({});
  const [englishColorOverride, setEnglishColorOverride] = useState<Record<string, string | null>>({});
  const highlightSeqRef = useRef<Record<string, number>>({});
  const highlightChainRef = useRef<Record<string, Promise<unknown>>>({});
  const confirmedColorRef = useRef<Record<string, string | null>>({});

  useAutoDismissMap(status, setStatus);

  useEffect(() => {
    if (!targetVerse) return;
    const node = document.getElementById(`verse-${targetVerse}`);
    if (node) node.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [targetVerse]);

  function changeReaderMode(next: ReaderMode) {
    setReaderMode(next);
    writePrefCookie(READER_MODE_COOKIE, next);
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

  async function highlightToken(verse: ReaderVerse, token: ReaderToken, color: string | null) {
    const key = token.id;
    const seq = (highlightSeqRef.current[key] ?? 0) + 1;
    highlightSeqRef.current[key] = seq;
    setTokenColorOverride((current) => ({ ...current, [key]: color }));

    const previous = highlightChainRef.current[key] ?? Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      try {
        const response =
          color === null
            ? await fetch("/api/highlights", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tokenId: token.id })
              })
            : await fetch("/api/highlights", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tokenId: token.id, color })
              });
        if (response.ok) {
          confirmedColorRef.current[key] = color;
        } else if (highlightSeqRef.current[key] === seq) {
          const confirmed = key in confirmedColorRef.current ? confirmedColorRef.current[key] : token.highlightColor;
          setTokenColorOverride((current) => ({ ...current, [key]: confirmed }));
          setVerseStatus(verse.id, "Could not save highlight.");
        }
      } catch {
        if (highlightSeqRef.current[key] === seq) {
          const confirmed = key in confirmedColorRef.current ? confirmedColorRef.current[key] : token.highlightColor;
          setTokenColorOverride((current) => ({ ...current, [key]: confirmed }));
          setVerseStatus(verse.id, "Network error. Try again.");
        }
      }
    });
    highlightChainRef.current[key] = run;
    await run;
  }

  async function highlightEnglishWord(verse: ReaderVerse, wordIndex: number, color: string | null) {
    if (!verse.englishVerseId) return;
    const key = `${verse.id}-${wordIndex}`;
    const seq = (highlightSeqRef.current[key] ?? 0) + 1;
    highlightSeqRef.current[key] = seq;
    setEnglishColorOverride((current) => ({ ...current, [key]: color }));

    const previous = highlightChainRef.current[key] ?? Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      try {
        const response =
          color === null
            ? await fetch("/api/highlights", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verseId: verse.englishVerseId, englishWordIndex: wordIndex })
              })
            : await fetch("/api/highlights", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verseId: verse.englishVerseId, englishWordIndex: wordIndex, color })
              });
        if (response.ok) {
          confirmedColorRef.current[key] = color;
        } else if (highlightSeqRef.current[key] === seq) {
          const confirmed = key in confirmedColorRef.current ? confirmedColorRef.current[key] : verse.englishHighlights.find((h) => h.wordIndex === wordIndex)?.color ?? null;
          setEnglishColorOverride((current) => ({ ...current, [key]: confirmed }));
          setVerseStatus(verse.id, "Could not save highlight.");
        }
      } catch {
        if (highlightSeqRef.current[key] === seq) {
          const confirmed = key in confirmedColorRef.current ? confirmedColorRef.current[key] : verse.englishHighlights.find((h) => h.wordIndex === wordIndex)?.color ?? null;
          setEnglishColorOverride((current) => ({ ...current, [key]: confirmed }));
          setVerseStatus(verse.id, "Network error. Try again.");
        }
      }
    });
    highlightChainRef.current[key] = run;
    await run;
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
      <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b border-stone-200 bg-[var(--background)]/90 px-4 py-2 backdrop-blur">
        <span className="font-display text-sm font-semibold text-slate-700">{chapterLabel}</span>
        <ReaderModeToggle mode={readerMode} onChange={changeReaderMode} />
      </div>

      <div className={`grid gap-4 px-6 ${showBothColumns ? "md:grid-cols-2" : ""}`}>
        {showGreek ? (
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">SBLGNT</div>
        ) : null}
        {showEnglish ? (
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {verses[0]?.englishCorpus ?? "WEB"}
          </div>
        ) : null}
      </div>

      {verses.map((verse) => (
        <article
          key={verse.id}
          id={`verse-${verse.verse}`}
          aria-label={verse.reference}
          className={`scroll-mt-24 border-l-2 border-accent-200 pl-6 ${
            targetVerse === verse.verse ? "rounded-sm ring-2 ring-accent-400 ring-offset-4 ring-offset-[var(--background)]" : ""
          }`}
        >
          <div className={`grid gap-4 ${showBothColumns ? "md:grid-cols-2" : ""}`}>
            {showGreek ? (
              <div>
                <div className="greek-text text-[1.45rem] leading-10 text-slate-950">
                  <span className="oldstyle-nums mr-2 align-super text-sm font-semibold text-slate-500" aria-hidden>
                    {verse.verse}
                  </span>
                  {verse.tokens.length > 0
                    ? verse.tokens.map((token) => {
                        const tokenColor =
                          token.id in tokenColorOverride
                            ? tokenColorOverride[token.id]
                            : token.highlightColor;
                        return (
                        <Fragment key={token.id}>
                          <span className="relative inline-block">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedEnglishWord(null);
                                setSelectedTokenId(selectedTokenId === token.id ? null : token.id);
                              }}
                              style={tokenColor ? { backgroundColor: tokenColor } : undefined}
                              className="mx-0.5 rounded px-1 py-0.5 transition-colors hover:bg-accent-50"
                            >
                              {token.surface}
                            </button>
                            {selectedTokenId === token.id ? (
                              <MorphologyPopover
                                token={token}
                                reference={verse.reference}
                                body={tokenNoteDrafts[token.id] ?? ""}
                                onBodyChange={(next) => setTokenDraft(token.id, next)}
                                onHighlight={(color) => highlightToken(verse, token, color)}
                                onClose={() => setSelectedTokenId(null)}
                              />
                            ) : null}
                          </span>{" "}
                        </Fragment>
                        );
                      })
                    : verse.greekText}
                </div>
              </div>
            ) : null}
            {showEnglish ? (
              <div>
                <EnglishVerseText
                  verse={verse}
                  selectedKey={selectedEnglishWord}
                  overrides={englishColorOverride}
                  onSelect={setSelectedEnglishWord}
                  onPick={(wordIndex, color) => highlightEnglishWord(verse, wordIndex, color)}
                  onClear={(wordIndex) => highlightEnglishWord(verse, wordIndex, null)}
                />
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

function EnglishVerseText({
  verse,
  selectedKey,
  overrides,
  onSelect,
  onPick,
  onClear
}: {
  verse: ReaderVerse;
  selectedKey: string | null;
  overrides: Record<string, string | null>;
  onSelect: (key: string | null) => void;
  onPick: (wordIndex: number, color: string) => void;
  onClear: (wordIndex: number) => void;
}) {
  const tokens = useMemo(() => tokenizeEnglish(verse.englishText), [verse.englishText]);
  const highlightByWord = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of verse.englishHighlights) map.set(entry.wordIndex, entry.color);
    return map;
  }, [verse.englishHighlights]);

  if (!verse.englishVerseId) {
    return (
      <div className="text-xl leading-10 text-slate-950">
        <span className="oldstyle-nums mr-2 align-super text-sm font-semibold text-slate-500" aria-hidden>
          {verse.verse}
        </span>
        {verse.englishText}
      </div>
    );
  }

  return (
    <div className="text-xl leading-10 text-slate-950">
      <span className="oldstyle-nums mr-2 align-super text-sm font-semibold text-slate-500" aria-hidden>
        {verse.verse}
      </span>
      {tokens.map((token, index) => {
        if (token.kind === "space") {
          return <Fragment key={`s-${index}`}>{token.value}</Fragment>;
        }
        const key = `${verse.id}-${token.wordIndex}`;
        const color = key in overrides ? overrides[key] : highlightByWord.get(token.wordIndex) ?? null;
        const open = selectedKey === key;
        return (
          <span key={key} className="relative inline-block">
            <button
              type="button"
              onClick={() => onSelect(open ? null : key)}
              style={color ? { backgroundColor: color } : undefined}
              className="rounded px-0.5 transition-colors hover:bg-accent-50"
            >
              {token.value}
            </button>
            {open ? (
              <EnglishWordPopover
                word={token.value}
                activeColor={color}
                onPick={(nextColor) => onPick(token.wordIndex, nextColor)}
                onClear={() => onClear(token.wordIndex)}
                onClose={() => onSelect(null)}
              />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
