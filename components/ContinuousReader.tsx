"use client";

import { Fragment } from "react";
import { GreekToken, EnglishWords, type ReaderVerse, type ReaderToken } from "@/components/readerTokens";

const VERSE_NUMBER_CLASS = "oldstyle-nums mr-1 align-super text-sm font-semibold text-slate-500 scroll-mt-24";

export function ContinuousReader(props: {
  verses: ReaderVerse[];
  mode: "greek" | "english";
  selectedTokenId: string | null;
  setSelectedTokenId: (id: string | null) => void;
  tokenColorOverride: Record<string, string | null>;
  onHighlightToken: (verse: ReaderVerse, token: ReaderToken, color: string | null) => void;
  tokenNoteDrafts: Record<string, string>;
  onTokenDraft: (tokenId: string, next: string) => void;
  onNotesChanged: () => void;
  selectedEnglishWord: string | null;
  setSelectedEnglishWord: (key: string | null) => void;
  englishColorOverride: Record<string, string | null>;
  onPickEnglish: (verse: ReaderVerse, wordIndex: number, color: string) => void;
  onClearEnglish: (verse: ReaderVerse, wordIndex: number) => void;
}) {
  const { verses, mode } = props;

  if (mode === "greek") {
    return (
      <div className="greek-text max-w-[68ch] text-[1.45rem] leading-10 text-slate-950">
        {verses.map((verse) => (
          <Fragment key={verse.id}>
            <span className="sr-only">{verse.reference} </span>
            <span id={`verse-${verse.verse}`} className={VERSE_NUMBER_CLASS} aria-hidden>{verse.verse}</span>
            {verse.tokens.length > 0
              ? verse.tokens.map((token) => {
                  const color = token.id in props.tokenColorOverride ? props.tokenColorOverride[token.id] : token.highlightColor;
                  return (
                    <GreekToken
                      key={token.id}
                      token={token}
                      color={color}
                      reference={verse.reference}
                      selected={props.selectedTokenId === token.id}
                      noteDraft={props.tokenNoteDrafts[token.id] ?? ""}
                      onToggle={() => { props.setSelectedEnglishWord(null); props.setSelectedTokenId(props.selectedTokenId === token.id ? null : token.id); }}
                      onDraftChange={(next) => props.onTokenDraft(token.id, next)}
                      onHighlight={(c) => props.onHighlightToken(verse, token, c)}
                      onClose={() => props.setSelectedTokenId(null)}
                      onNotesChanged={props.onNotesChanged}
                    />
                  );
                })
              : verse.greekText}
            {" "}
          </Fragment>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-[68ch] text-xl leading-10 text-slate-950">
      {verses.map((verse) => (
        <Fragment key={verse.id}>
          <span className="sr-only">{verse.reference} </span>
          <span id={`verse-${verse.verse}`} className={VERSE_NUMBER_CLASS} aria-hidden>{verse.verse}</span>
          {verse.englishVerseId ? (
            <EnglishWords
              verse={verse}
              overrides={props.englishColorOverride}
              selectedKey={props.selectedEnglishWord}
              onSelect={(key) => { props.setSelectedTokenId(null); props.setSelectedEnglishWord(key); }}
              onPick={(wordIndex, color) => props.onPickEnglish(verse, wordIndex, color)}
              onClear={(wordIndex) => props.onClearEnglish(verse, wordIndex)}
            />
          ) : (
            verse.englishText
          )}
          {" "}
        </Fragment>
      ))}
    </div>
  );
}
