import type { HighlightSegment } from "@/lib/search-highlight";

export type SearchPanelResult =
  | {
      kind: "keyword";
      corpus: string;
      reference: string;
      text: string;
      onSpine?: boolean;
      englishText?: string;
      highlightSegments?: HighlightSegment[];
    }
  | {
      kind: "token";
      corpus: string;
      reference: string;
      surface: string;
      lemma: string;
      morphCode: string;
      verseText: string;
      englishText?: string;
    };

export type SavedSearchRow = {
  id: string;
  label: string;
  mode: string;
  query: string | null;
  book: string | null;
  chapter: number | null;
  matchMode: string | null;
  domain?: string | null;
  subdomain?: string | null;
  ln?: string | null;
};

export type SearchBookOption = {
  osisId: string;
  label: string;
};
