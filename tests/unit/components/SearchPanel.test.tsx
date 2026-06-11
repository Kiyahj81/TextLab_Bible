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

  it("submits the selected mode through the form GET contract", () => {
    render(<SearchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("radio", { name: "Lemma" }));
    const lemmaRadio = screen.getByRole("radio", { name: "Lemma" }) as HTMLInputElement;
    expect(lemmaRadio.name).toBe("mode");
    expect(lemmaRadio.value).toBe("lemma");
    expect(lemmaRadio.checked).toBe(true);
  });

  it("falls back to keyword when the URL carries an unknown mode", () => {
    render(<SearchPanel {...baseProps} mode="garbage" />);
    expect((screen.getByRole("radio", { name: "Keyword" }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("SearchPanel empty state", () => {
  it("shows example search chips before any search", () => {
    render(<SearchPanel {...baseProps} />);
    expect(screen.getByRole("link", { name: "Lemma: λόγος" }).getAttribute("href")).toBe(
      `/search?mode=lemma&q=${encodeURIComponent("λόγος")}`
    );
    expect(screen.getByRole("link", { name: "Domain 25: Attitudes and Emotions" }).getAttribute("href")).toBe(
      "/search?mode=domain&domain=025"
    );
  });

  it("hides example chips once a search has run", () => {
    render(<SearchPanel {...baseProps} hasSearch={true} searchLabel='"x"' />);
    expect(screen.queryByText("Try an example:")).toBeNull();
  });

  it("omits the domain chip when domain 25 is unavailable", () => {
    render(
      <SearchPanel
        {...baseProps}
        domainOptions={{ domains: [{ code: "001", number: 1, label: "Geographical Objects" }], subdomainsByDomain: {} }}
      />
    );
    expect(screen.queryByText(/^Domain 1:/)).toBeNull();
    expect(screen.getByRole("link", { name: "Lemma: λόγος" })).toBeTruthy();
  });
});

describe("SearchPanel off-spine keyword hits", () => {
  it("renders off-spine references as plain text, not links", () => {
    const offSpine: SearchPanelResult = { kind: "keyword", corpus: "WEB", reference: "Acts 8:37", text: "Philip said...", onSpine: false };
    const onSpine: SearchPanelResult = { kind: "keyword", corpus: "WEB", reference: "Acts 8:36", text: "See, here is water...", onSpine: true };
    render(<SearchPanel {...baseProps} hasSearch={true} searchLabel='"water"' count={2} pageCount={1} results={[offSpine, onSpine]} />);
    expect(screen.queryByRole("link", { name: /Acts 8:37/ })).toBeNull();
    expect(screen.getByText("Acts 8:37")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Acts 8:36/ })).toBeTruthy();
  });
});

describe("SearchPanel no-results state", () => {
  it("shows recovery guidance instead of sample-data copy", () => {
    render(<SearchPanel {...baseProps} hasSearch={true} searchLabel='"zzz"' results={[]} />);
    expect(screen.getByText(/No results for/)).toBeTruthy();
    expect(screen.getByText(/broader term/)).toBeTruthy();
    expect(screen.queryByText(/sample-data/)).toBeNull();
  });

  it("shows morphology-specific recovery guidance", () => {
    render(<SearchPanel {...baseProps} mode="morphology" hasSearch={true} searchLabel='"V-3PAI"' results={[]} />);
    expect(screen.getByText(/Try switching Morph match to Prefix/)).toBeTruthy();
    expect(screen.queryByText(/broader term/)).toBeNull();
  });

  it("shows domain-specific recovery guidance", () => {
    render(<SearchPanel {...baseProps} mode="domain" hasSearch={true} searchLabel="Domain 25" results={[]} />);
    expect(screen.getByText(/no results in the loaded corpus/i)).toBeTruthy();
  });
});

describe("SearchPanel morph tooltip", () => {
  it("explains the morph code via a title tooltip", () => {
    render(
      <SearchPanel {...baseProps} hasSearch={true} searchLabel='lemma "λόγος"' count={1} pageCount={1} results={[tokenResult]} />
    );
    expect(screen.getByTitle("noun — nominative singular masculine")).toBeTruthy();
  });
});

describe("SearchPanel saved searches", () => {
  it("shows friendly book names instead of osis ids", () => {
    render(
      <SearchPanel
        {...baseProps}
        savedSearches={[
          { id: "s1", label: "lemma: ἀγάπη", mode: "lemma", query: "ἀγάπη", book: "1Cor", chapter: null, matchMode: null }
        ]}
      />
    );
    expect(screen.getByText(/in 1 Corinthians/)).toBeTruthy();
  });

  it("offers Save search for an executed domain search", () => {
    render(<SearchPanel {...baseProps} mode="domain" domain="025" hasSearch={true} searchLabel="Domain 25" />);
    expect(screen.queryByText(/can't be saved yet/i)).toBeNull();
    expect(screen.getByRole("button", { name: /save search/i })).toBeTruthy();
  });
});

describe("SearchPanel chapter filter", () => {
  it("disables chapter until a book is chosen", () => {
    render(<SearchPanel {...baseProps} />);
    const chapterInput = screen.getByPlaceholderText("Choose a book first") as HTMLInputElement;
    expect(chapterInput.disabled).toBe(true);

    fireEvent.change(screen.getByRole("combobox", { name: "Book" }), { target: { value: "John" } });
    expect((screen.getByPlaceholderText("Any") as HTMLInputElement).disabled).toBe(false);
  });
});

describe("SearchPanel pagination", () => {
  it("shows the absolute result range", () => {
    const results = Array.from({ length: 25 }, (_, i) => ({ ...tokenResult, reference: `John 1:${i + 1}` }));
    render(
      <SearchPanel {...baseProps} hasSearch={true} searchLabel='"x"' results={results} count={116} page={2} pageCount={5} />
    );
    expect(screen.getByText(/Showing 26–50 of 116/)).toBeTruthy();
  });
});

describe("SearchPanel page size", () => {
  it("offers standard page sizes as a select", () => {
    render(<SearchPanel {...baseProps} />);
    const select = screen.getByRole("combobox", { name: "Page size" }) as HTMLSelectElement;
    expect(select.value).toBe("25");
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["10", "25", "50", "100"]);
  });

  it("keeps a non-standard size from the URL selectable", () => {
    render(<SearchPanel {...baseProps} pageSize={37} />);
    const select = screen.getByRole("combobox", { name: "Page size" }) as HTMLSelectElement;
    expect(select.value).toBe("37");
  });
});

describe("SearchPanel domain submit", () => {
  it("renders a standalone labeled Search button in domain mode", () => {
    render(<SearchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("radio", { name: "Domain" }));
    const button = screen.getByRole("button", { name: "Search" });
    expect(button.textContent).toBe("Search");
  });
});

describe("SearchPanel save search payload", () => {
  it("saves the executed search's mode, not a toggled-but-unsubmitted mode", async () => {
    let captured: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
        captured = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            savedSearch: { id: "n1", label: "keyword: light", mode: "keyword", query: "light", book: null, chapter: null, matchMode: null }
          })
        };
      })
    );
    render(<SearchPanel {...baseProps} mode="keyword" query="light" hasSearch={true} searchLabel='keyword "light"' />);
    fireEvent.click(screen.getByRole("radio", { name: "Lemma" }));
    fireEvent.click(screen.getByRole("button", { name: /save search/i }));
    await screen.findByText("Search saved.");
    expect(captured).not.toBeNull();
    expect(captured!.mode).toBe("keyword");
  });

  it("normalizes an unknown executed mode to keyword in the save payload", async () => {
    let captured: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
        captured = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            savedSearch: { id: "n2", label: "keyword: light", mode: "keyword", query: "light", book: null, chapter: null, matchMode: null }
          })
        };
      })
    );
    render(<SearchPanel {...baseProps} mode="garbage" query="light" hasSearch={true} searchLabel='keyword "light"' />);
    fireEvent.click(screen.getByRole("button", { name: /save search/i }));
    await screen.findByText("Search saved.");
    expect(captured).not.toBeNull();
    expect(captured!.mode).toBe("keyword");
    expect(captured!.matchMode).toBeUndefined();
  });
});

describe("SearchPanel disabled pagination", () => {
  it("renders disabled pagination as text, not focusable links", () => {
    render(
      <SearchPanel {...baseProps} hasSearch={true} searchLabel='"x"' results={[tokenResult]} count={50} page={1} pageCount={2} />
    );
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(screen.getByRole("link", { name: "Next" })).toBeTruthy();
  });
});

describe("SearchPanel rename input", () => {
  it("exposes an accessible name", () => {
    render(
      <SearchPanel
        {...baseProps}
        savedSearches={[
          { id: "s1", label: "keyword: light", mode: "keyword", query: "light", book: null, chapter: null, matchMode: null }
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    expect(screen.getByRole("textbox", { name: "Saved search name" })).toBeTruthy();
  });
});

describe("SearchPanel page size auto-apply", () => {
  it("submits the form when a new page size is selected", () => {
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});
    render(<SearchPanel {...baseProps} query="light" hasSearch={true} searchLabel='keyword "light"' />);
    fireEvent.change(screen.getByRole("combobox", { name: "Page size" }), { target: { value: "50" } });
    expect(submitSpy).toHaveBeenCalledTimes(1);
    submitSpy.mockRestore();
  });
});

describe("SearchPanel status live regions", () => {
  it("pre-renders the save-status live region even without a query", () => {
    render(<SearchPanel {...baseProps} />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  it("announces save status via a polite live region", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          savedSearch: { id: "n1", label: "keyword: light", mode: "keyword", query: "light", book: null, chapter: null, matchMode: null }
        })
      })
    );
    render(<SearchPanel {...baseProps} query="light" hasSearch={true} searchLabel='keyword "light"' />);
    fireEvent.click(screen.getByRole("button", { name: /save search/i }));
    await screen.findByText("Search saved.");
    expect(screen.getAllByRole("status").some((el) => el.textContent === "Search saved.")).toBe(true);
  });
});

describe("SearchPanel English toggle", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("shows WEB English under Greek results when toggled on", () => {
    render(
      <SearchPanel
        {...baseProps}
        hasSearch={true}
        searchLabel='lemma "λόγος"'
        count={1}
        pageCount={1}
        results={[{ ...tokenResult, englishText: "In the beginning was the Word" }]}
      />
    );
    expect(screen.queryByText("In the beginning was the Word")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /show english/i }));
    expect(screen.getByText("In the beginning was the Word")).toBeTruthy();
    expect(window.localStorage.getItem("textlab:search:show-english")).toBe("1");
  });

  it("honors a persisted preference on mount", () => {
    window.localStorage.setItem("textlab:search:show-english", "1");
    render(
      <SearchPanel
        {...baseProps}
        hasSearch={true}
        searchLabel='lemma "λόγος"'
        count={1}
        pageCount={1}
        results={[{ ...tokenResult, englishText: "In the beginning was the Word" }]}
      />
    );
    expect(screen.getByText("In the beginning was the Word")).toBeTruthy();
  });
});

describe("SearchPanel domain save", () => {
  it("saves an executed domain search with its filter fields and a friendly label", async () => {
    let captured: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
        captured = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            savedSearch: {
              id: "d1", label: "domain: 25 — Attitudes and Emotions", mode: "domain",
              query: null, book: null, chapter: null, matchMode: null,
              domain: "025", subdomain: null, ln: null
            }
          })
        };
      })
    );
    render(
      <SearchPanel {...baseProps} mode="domain" domain="025" hasSearch={true} searchLabel="Domain 25 — Attitudes and Emotions" />
    );
    fireEvent.click(screen.getByRole("button", { name: /save search/i }));
    await screen.findByText("Search saved.");
    expect(captured).not.toBeNull();
    expect(captured!.mode).toBe("domain");
    expect(captured!.domain).toBe("025");
    expect(captured!.query).toBeUndefined();
    expect(captured!.label).toBe("domain: 25 — Attitudes and Emotions");
  });

  it("truncates an over-long subdomain label to the API's 100-char cap", async () => {
    let captured: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
        captured = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            savedSearch: { id: "d2", label: "x", mode: "domain", query: null, book: null, chapter: null, matchMode: null, domain: null, subdomain: "010001", ln: null }
          })
        };
      })
    );
    const longLabel = "Groups and Members of Groups of Persons Regarded as Related by Blood but without Special Reference to Successive Generations";
    render(
      <SearchPanel
        {...baseProps}
        mode="domain"
        subdomain="010001"
        hasSearch={true}
        searchLabel="Subdomain"
        domainOptions={{
          domains: [{ code: "010", number: 10, label: "Kinship Terms" }],
          subdomainsByDomain: { "010": [{ code: "010001", label: longLabel }] }
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /save search/i }));
    await screen.findByText("Search saved.");
    expect(captured).not.toBeNull();
    expect((captured!.label as string).length).toBeLessThanOrEqual(100);
    expect(captured!.label).toContain("domain: Groups and Members");
  });

  it("links a saved domain search back to a domain URL", () => {
    render(
      <SearchPanel
        {...baseProps}
        savedSearches={[
          { id: "d1", label: "domain: 25 — Attitudes and Emotions", mode: "domain", query: null,
            book: null, chapter: null, matchMode: null, domain: "025", subdomain: null, ln: null }
        ]}
      />
    );
    const link = screen.getByRole("link", { name: /domain: 25/i });
    expect(link.getAttribute("href")).toContain("mode=domain");
    expect(link.getAttribute("href")).toContain("domain=025");
    expect(link.getAttribute("href")).not.toContain("q=");
  });
});
