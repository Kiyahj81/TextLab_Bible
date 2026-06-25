"use client";

import Link from "next/link";
import { Fragment } from "react";
import { splitWithMatches, type HighlightSegment } from "@/lib/search-highlight";
import { readerHref } from "@/lib/references";

export function ReferenceLink({ reference, linkable = true }: { reference: string; linkable?: boolean }) {
  const className = "oldstyle-nums font-display text-base font-semibold text-slate-900";
  const href = readerHref(reference);
  if (!href || !linkable) return <span className={className}>{reference}</span>;
  return (
    <Link
      href={href}
      title="Open in reader"
      className={`${className} underline-offset-4 transition-colors hover:text-accent-700 hover:underline`}
    >
      {reference}
    </Link>
  );
}

export function HighlightedText({ text, match }: { text: string; match: string }) {
  const segments = splitWithMatches(text, match);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "match" ? (
          <mark
            key={index}
            className="rounded-sm bg-amber-200/80 px-0.5 font-semibold text-slate-950"
          >
            {segment.value}
          </mark>
        ) : (
          <Fragment key={index}>{segment.value}</Fragment>
        )
      )}
    </>
  );
}

export function KeywordHighlight({
  segments,
  text,
  query
}: {
  segments?: HighlightSegment[];
  text: string;
  query: string;
}) {
  // Stem-aware path: render the ts_headline segments the server produced.
  if (segments && segments.length > 0) {
    return (
      <>
        {segments.map((segment, index) =>
          segment.kind === "match" ? (
            <mark
              key={index}
              className="rounded-sm bg-amber-200/80 px-0.5 font-semibold text-slate-950"
            >
              {segment.value}
            </mark>
          ) : (
            <Fragment key={index}>{segment.value}</Fragment>
          )
        )}
      </>
    );
  }
  // Fallback: literal-substring highlight of the raw query, matching the prior
  // behavior for any keyword result that lacks segments.
  return <HighlightedText text={text} match={query} />;
}
