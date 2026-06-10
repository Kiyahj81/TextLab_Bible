import { describe, expect, it } from "vitest";
import { searchStateKey } from "@/lib/searchStateKey";

const base = {
  mode: "keyword",
  query: "light",
  book: "",
  chapter: "",
  matchMode: "exact",
  domain: "",
  subdomain: "",
  ln: ""
};

describe("searchStateKey", () => {
  it("is stable for identical params", () => {
    expect(searchStateKey({ ...base })).toBe(searchStateKey({ ...base }));
  });

  it("changes when any param changes", () => {
    expect(searchStateKey({ ...base, mode: "lemma" })).not.toBe(searchStateKey(base));
    expect(searchStateKey({ ...base, ln: "33.55" })).not.toBe(searchStateKey(base));
    expect(searchStateKey({ ...base, book: "John" })).not.toBe(searchStateKey(base));
  });

  it("does not collide when the delimiter character appears in a value", () => {
    expect(searchStateKey({ ...base, query: "foo|bar", book: "" })).not.toBe(
      searchStateKey({ ...base, query: "foo", book: "bar" })
    );
  });
});
