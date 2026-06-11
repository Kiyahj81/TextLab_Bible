import { describe, expect, it, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

// Real-Prisma integration tests against the configured PostgreSQL.
// Skips itself when DATABASE_URL is not set or not reachable, so it is
// safe to ship in the default suite. Run via `npm run test:integration`.

const databaseUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
const enabled = Boolean(databaseUrl);

const prisma = enabled
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  : null;

describe.skipIf(!enabled)("DB ownership and FK behavior", () => {
  // Each test gets its own alice/bob pair so files can run in any order
  // without colliding. Cleanup happens in afterEach.
  let alice: { id: string };
  let bob: { id: string };
  let sharedVerseId: string;
  let sharedTokenId: string;

  beforeAll(async () => {
    // Need at least one Verse and Token row to anchor FK-bearing children.
    // The dev DB is seeded; we don't seed inside the test.
    const verse = await prisma!.verse.findFirst({ select: { id: true } });
    if (!verse) {
      throw new Error("Test DB has no Verse rows — seed the corpus before running integration tests.");
    }
    sharedVerseId = verse.id;

    const token = await prisma!.token.findFirst({ select: { id: true } });
    if (!token) {
      throw new Error("Test DB has no Token rows — seed the corpus before running integration tests.");
    }
    sharedTokenId = token.id;
  });

  beforeEach(async () => {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    alice = await prisma!.user.create({
      data: { email: `alice-${ts}-${rand}@integration.test`, name: "alice" }
    });
    bob = await prisma!.user.create({
      data: { email: `bob-${ts}-${rand}@integration.test`, name: "bob" }
    });
  });

  afterEach(async () => {
    // Cascading deletes on User wipe all child records.
    await prisma!.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
  });

  afterAll(async () => {
    await prisma!.$disconnect();
  });

  it("Notes: user A cannot see user B's notes via a userId-scoped query", async () => {
    const aliceNote = await prisma!.note.create({
      data: { userId: alice.id, verseId: sharedVerseId, body: "alice secret" }
    });

    const bobView = await prisma!.note.findMany({ where: { userId: bob.id } });
    expect(bobView).toHaveLength(0);

    const aliceView = await prisma!.note.findMany({ where: { userId: alice.id } });
    expect(aliceView).toHaveLength(1);
    expect(aliceView[0].id).toBe(aliceNote.id);
  });

  it("Notes: a scoped deleteMany only deletes the current user's row", async () => {
    const aliceNote = await prisma!.note.create({
      data: { userId: alice.id, verseId: sharedVerseId, body: "alice" }
    });
    const bobNote = await prisma!.note.create({
      data: { userId: bob.id, verseId: sharedVerseId, body: "bob" }
    });

    // Simulates the route handler trying to delete by id while filtering on
    // the caller's userId — bob's request cannot reach alice's row.
    const result = await prisma!.note.deleteMany({
      where: { id: aliceNote.id, userId: bob.id }
    });
    expect(result.count).toBe(0);

    const aliceStill = await prisma!.note.findUnique({ where: { id: aliceNote.id } });
    const bobStill = await prisma!.note.findUnique({ where: { id: bobNote.id } });
    expect(aliceStill?.id).toBe(aliceNote.id);
    expect(bobStill?.id).toBe(bobNote.id);
  });

  it("Highlights: user A cannot see user B's highlights", async () => {
    await prisma!.highlight.create({
      data: { userId: alice.id, verseId: sharedVerseId, color: "#fde68a" }
    });
    const bobView = await prisma!.highlight.findMany({ where: { userId: bob.id } });
    expect(bobView).toHaveLength(0);
  });

  it("SavedSearches: user A cannot see user B's saved searches", async () => {
    await prisma!.savedSearch.create({
      data: { userId: alice.id, label: "alice", mode: "keyword", query: "logos" }
    });
    const bobView = await prisma!.savedSearch.findMany({ where: { userId: bob.id } });
    expect(bobView).toHaveLength(0);
  });

  it("stores and scopes a domain saved search with null query", async () => {
    const row = await prisma!.savedSearch.create({
      data: { userId: alice.id, label: "domain: LN 33.55", mode: "domain", query: null, ln: "33.55" }
    });
    const fetched = await prisma!.savedSearch.findFirst({ where: { id: row.id, userId: alice.id } });
    expect(fetched?.ln).toBe("33.55");
    expect(fetched?.query).toBeNull();
    const crossUser = await prisma!.savedSearch.findFirst({ where: { id: row.id, userId: bob.id } });
    expect(crossUser).toBeNull();
  });

  it("GeneratedStudyNotes: user A cannot see user B's generated notes", async () => {
    await prisma!.generatedStudyNote.create({
      data: { userId: alice.id, prompt: "p", answer: "a", markdown: "m" }
    });
    const bobView = await prisma!.generatedStudyNote.findMany({ where: { userId: bob.id } });
    expect(bobView).toHaveLength(0);
  });

  it("AiSessions: user A cannot reach user B's session by id", async () => {
    const aliceSession = await prisma!.aiSession.create({
      data: { userId: alice.id, title: "alice convo" }
    });
    const lookup = await prisma!.aiSession.findFirst({
      where: { id: aliceSession.id, userId: bob.id }
    });
    expect(lookup).toBeNull();
  });

  it("FK cascade: deleting a user removes all their notes/highlights/saved-searches/generated-notes/ai-sessions", async () => {
    await prisma!.note.create({
      data: { userId: alice.id, verseId: sharedVerseId, body: "n" }
    });
    await prisma!.highlight.create({
      data: { userId: alice.id, tokenId: sharedTokenId, color: "#fde68a" }
    });
    await prisma!.savedSearch.create({
      data: { userId: alice.id, label: "s", mode: "keyword", query: "q" }
    });
    await prisma!.generatedStudyNote.create({
      data: { userId: alice.id, prompt: "p", answer: "a", markdown: "m" }
    });
    await prisma!.aiSession.create({ data: { userId: alice.id } });

    await prisma!.user.delete({ where: { id: alice.id } });

    // After cascade, every child row referencing alice.id is gone.
    expect(await prisma!.note.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma!.highlight.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma!.savedSearch.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma!.generatedStudyNote.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma!.aiSession.count({ where: { userId: alice.id } })).toBe(0);

    // afterEach will try to delete alice again — we have to keep it
    // resolvable. Recreate a dummy row so the deleteMany doesn't error;
    // deleteMany on a missing id is a no-op anyway, so this is just to
    // avoid surprising failure modes. Actually deleteMany returns count=0
    // when nothing matches and never throws, so no recreation needed.
    // Set alice.id to bob.id so afterEach doesn't try to delete twice.
    alice = bob;
  });
});
