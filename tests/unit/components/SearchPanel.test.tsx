// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchPanel, SearchPanelResult } from "@/components/SearchPanel";
import type { DomainOptions } from "@/lib/search";

const domainOptions: DomainOptions = {
  domains: [{ code: "025", number: 25, label: "Attitudes and Emotions" }],
  subdomainsByDomain: { "025": [{ code: "025001", label: "Attitude, Disposition" }] }
};

const baseProps = {
  mode: "keyword",
  query: "",
  book: "",
  chapter: "",
  matchMode: "exact",
  page: 1,
  pageSize: 25,
  count: 0,
  pageCount: 0,
  results: [] as SearchPanelResult[],
  books: [
    { osisId: "John", label: "John" },
    { osisId: "1Cor", label: "1 Corinthians" }
  ],
  savedSearches: [],
  domain: "",
  subdomain: "",
  ln: "",
  domainOptions,
  hasSearch: false,
  searchLabel: ""
};

const tokenResult: SearchPanelResult = {
  kind: "token",
  corpus: "SBLGNT",
  reference: "John 1:1",
  surface: "λόγος",
  lemma: "λόγος",
  morphCode: "N-NSM",
  verseText: "Ἐν ἀρχῇ ἦν ὁ λόγος"
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SearchPanel result references", () => {
  it("links each result reference to the reader", () => {
    render(
      <SearchPanel
        {...baseProps}
        hasSearch={true}
        searchLabel='"λόγος"'
        count={1}
        pageCount={1}
        results={[tokenResult]}
      />
    );
    const link = screen.getByRole("link", { name: /John 1:1/ });
    expect(link.getAttribute("href")).toBe("/read?book=John&chapter=1&verse=1");
  });
});

describe("SearchPanel remount key", () => {
  it("resets client form state when the key changes", () => {
    const { rerender } = render(<SearchPanel key="a" {...baseProps} mode="keyword" />);
    fireEvent.click(screen.getByRole("radio", { name: "Lemma" }));
    expect((screen.getByRole("radio", { name: "Lemma" }) as HTMLInputElement).checked).toBe(true);

    rerender(<SearchPanel key="b" {...baseProps} mode="domain" />);
    expect((screen.getByRole("radio", { name: "Domain" }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("SearchPanel mode control", () => {
  it("renders the four modes as a radio group", () => {
    render(<SearchPanel {...baseProps} />);
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect((screen.getByRole("radio", { name: "Keyword" }) as HTMLInputElement).checked).toBe(true);
  });

  it("switches placeholder and hint with the selected mode", () => {
    render(<SearchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("radio", { name: "Lemma" }));
    expect(screen.getByPlaceholderText(/λόγος, ἀγάπη/)).toBeTruthy();
    expect(screen.getByText(/inflected form/i)).toBeTruthy();
  });

  it("shows domain filters when Domain mode is selected", () => {
    render(<SearchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("radio", { name: "Domain" }));
    expect(screen.getByRole("combobox", { name: "Domain" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Subdomain" })).toBeTruthy();
  });
});
