"use client";

import { Fragment, useMemo } from "react";
import { NotebookPen } from "lucide-react";
import { EnglishWordPopover } from "@/components/EnglishWordPopover";
import { MorphologyPopover, type ReaderToken } from "@/components/MorphologyPopover";
import { FOCUS_RING } from "@/lib/ui/focus";

export type { ReaderToken };

export type EnglishHighlight = { wordIndex: number; color: string };

export type ReaderVerse = {
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
  notes: { id: string; title: string | null; body: string; tags: string[] }[];
};

export type EnglishToken = { kind: "word"; value: string; wordIndex: number } | { kind: "space"; value: string };

export function tokenizeEnglish(text: string): EnglishToken[] {
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

export function GreekToken({
  token, color, reference, selected, noteDraft, onToggle, onDraftChange, onHighlight, onClose, onNotesChanged
}: {
  token: ReaderToken;
  color: string | null;
  reference: string;
  selected: boolean;
  noteDraft: string;
  onToggle: () => void;
  onDraftChange: (next: string) => void;
  onHighlight: (color: string | null) => void;
  onClose: () => void;
  onNotesChanged?: () => void;
}) {
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={onToggle}
        style={color ? { backgroundColor: color } : undefined}
        className={`mx-0.5 rounded px-1 py-0.5 transition-colors hover:bg-accent-50 ${FOCUS_RING}`}
      >
        {token.surface}
        {token.noteCount > 0 ? (
          <>
            <NotebookPen size={12} aria-hidden className="ml-0.5 inline align-super text-accent-600" />
            <span className="sr-only">{token.noteCount === 1 ? " (has a note)" : ` (has ${token.noteCount} notes)`}</span>
          </>
        ) : null}
      </button>
      {selected ? (
        <MorphologyPopover
          token={token}
          reference={reference}
          body={noteDraft}
          onBodyChange={onDraftChange}
          onHighlight={onHighlight}
          onClose={onClose}
          onNotesChanged={onNotesChanged}
        />
      ) : null}
    </span>
  );
}

export function EnglishWords({
  verse, overrides, selectedKey, onSelect, onPick, onClear
}: {
  verse: ReaderVerse;
  overrides: Record<string, string | null>;
  selectedKey: string | null;
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

  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === "space") return <Fragment key={`s-${index}`}>{token.value}</Fragment>;
        const key = `${verse.id}-${token.wordIndex}`;
        const color = key in overrides ? overrides[key] : highlightByWord.get(token.wordIndex) ?? null;
        const open = selectedKey === key;
        return (
          <span key={key} className="relative inline-block">
            <button
              type="button"
              onClick={() => { onSelect(open ? null : key); }}
              style={color ? { backgroundColor: color } : undefined}
              className={`rounded px-1 py-0.5 transition-colors hover:bg-accent-50 ${FOCUS_RING}`}
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
    </>
  );
}
