import { describe, expect, it, vi, beforeEach } from "vitest";

const { findMany } = vi.hoisted(() => ({
  findMany: {
    verse: vi.fn(),
    token: vi.fn(),
    note: vi.fn(),
    louwNidaDomain: vi.fn()
  }
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    verse: { findMany: (...a: unknown[]) => findMany.verse(...a) },
    token: { findMany: (...a: unknown[]) => findMany.token(...a) },
    note: { findMany: (...a: unknown[]) => findMany.note(...a) },
    louwNidaDomain: { findMany: (...a: unknown[]) => findMany.louwNidaDomain(...a) }
  }
}));

import { getReaderPassage } from "@/lib/search";

const greekVerse = { id: "gv1", book: { osisId: "John", name: "John" }, chapter: 1, verse: 1, text: "Ἐν ἀρχῇ" };
const englishVerse = { id: "ev1", verse: 1, text: "In the beginning", corpus: { abbreviation: "WEB" }, highlights: [] };
const tokenRow = {
  id: "t1", book: { osisId: "John" }, chapter: 1, verse: 1, wordIndex: 0, surface: "Ἐν",
  normalized: "εν", lemma: "ἐν", morphCode: "P", partOfSpeech: "P-", gloss: "in",
  louwNida: [], lnDomain: [],
  notes: [{ id: "tn1", title: "John 1:1 Ἐν", body: "token note", tags: ["word"] }],
  highlights: []
};
const verseNoteRow = { id: "vn1", title: null, body: "verse note", tags: ["verse"], verseId: "gv1", createdAt: new Date(0) };

beforeEach(() => {
  findMany.verse.mockReset(); findMany.token.mockReset(); findMany.note.mockReset(); findMany.louwNidaDomain.mockReset();
  // Promise.all order: verse(greek) call 1, verse(english) call 2, token call.
  findMany.verse.mockResolvedValueOnce([greekVerse]).mockResolvedValueOnce([englishVerse]);
  findMany.token.mockResolvedValue([tokenRow]);
  findMany.note.mockResolvedValue([verseNoteRow]);
  findMany.louwNidaDomain.mockResolvedValue([]);
});

describe("getReaderPassage note mapping", () => {
  it("attaches user-scoped verse and token note bodies", async () => {
    const result = await getReaderPassage("John", 1, "u1");
    expect(result[0].notes).toEqual([{ id: "vn1", title: null, body: "verse note", tags: ["verse"] }]);
    expect(result[0].tokens[0].notes).toEqual([{ id: "tn1", title: "John 1:1 Ἐν", body: "token note", tags: ["word"] }]);
    expect(result[0].tokens[0].noteCount).toBe(1);
    // verse-notes query is scoped to the user and the loaded verse ids
    const noteWhere = findMany.note.mock.calls[0][0].where;
    expect(noteWhere.userId).toBe("u1");
    expect(noteWhere.verseId).toEqual({ in: ["gv1"] });
  });

  it("scopes to the __none__ sentinel for anonymous callers", async () => {
    await getReaderPassage("John", 1, null);
    expect(findMany.note.mock.calls[0][0].where.userId).toBe("__none__");
    // token notes are scoped the same way (include.notes.where)
    const tokenArgs = findMany.token.mock.calls[0][0];
    expect(tokenArgs.include.notes.where.userId).toBe("__none__");
  });
});
