/**
 * Embedding health-check (read-only). Reports VerseEmbedding coverage for the corpus
 * the assistant's semantic search queries (`SEMANTIC_INDEX_CORPUS`) on the current
 * `EMBEDDING_MODEL`. Run after an `embed:verses` ingest or a model change to confirm the
 * vector leg is populated and fresh.
 *
 *   npm run db:count-embeddings   (uses .env → DATABASE_URL)
 *
 * Freshness matters, not just presence. `searchSemantic` (lib/search/semantic.ts) filters
 * candidates by corpus + model ONLY — it does not check `textHash` — so a verse whose text
 * changed but still has a current-model row would serve a STALE vector. This check therefore
 * mirrors `embed-verses.ts` exactly: a verse is "up to date" only when its embedding's
 * `model === EMBEDDING_MODEL` AND `textHash === embeddingTextHash(text)`. The invariant is
 * "OK ⟺ `embed:verses` would embed nothing." Empty/whitespace-only verses (the omitted
 * critical-text placeholders WEB carries as blank, e.g. Acts 8:37) are excluded with the same
 * `text.trim()` test the ingest uses, so an unembedded blank verse never counts as a gap.
 * BUT a current-model embedding left on a now-empty verse (e.g. a re-import blanked the text) is
 * flagged as "stale-empty": embed:verses skips empty verses so it never prunes such a row, yet
 * searchSemantic (corpus+model filter only) will still serve that stale vector — so it fails the check.
 *
 * Scope: anchored to the single `SEMANTIC_INDEX_CORPUS` the assistant queries (currently WEB).
 * If the semantic index is extended to more translations, that constant / `searchSemantic`
 * change too, and this check should iterate the indexed corpora. The per-corpus breakdown
 * below surfaces embeddings for ANY corpus meanwhile, so a newly-embedded translation shows up
 * here even before the coverage gate is taught about it.
 *
 * Exit code: 0 only when the indexed corpus is populated AND every embeddable verse is embedded
 * and fresh on the current model; 1 otherwise — including an empty/unimported corpus (an empty
 * result must never green-light an ops check pointed at the wrong or unseeded database).
 */
import { prisma } from "@/lib/db";
import { EMBEDDING_MODEL, SEMANTIC_INDEX_CORPUS, embeddingTextHash } from "@/lib/search/semanticIndex";

async function main() {
  // Same shape + scope as embed-verses.ts: one row per verse in the indexed corpus, with its
  // (1:1) embedding's model + textHash (null when unembedded).
  const rows = await prisma.$queryRaw<
    Array<{ id: string; text: string; model: string | null; textHash: string | null }>
  >`
    SELECT v."id" AS id, v."text" AS text, e."model" AS model, e."textHash" AS "textHash"
    FROM "Verse" v
    JOIN "Corpus" c ON c."id" = v."corpusId"
    LEFT JOIN "VerseEmbedding" e ON e."verseId" = v."id"
    WHERE c."abbreviation" = ${SEMANTIC_INDEX_CORPUS}
    ORDER BY v."id"
  `;

  const nonEmpty = (t: string) => t.trim().length > 0; // matches embed-verses' skip test
  const isFresh = (r: { model: string | null; textHash: string | null; text: string }) =>
    r.model === EMBEDDING_MODEL && r.textHash === embeddingTextHash(r.text);

  const totalVerses = rows.length;
  const embeddable = rows.filter((r) => nonEmpty(r.text));
  const emptyPlaceholders = totalVerses - embeddable.length;

  // Gaps = exactly what embed-verses would (re-)embed: embeddable verses that are not fresh.
  const gaps = embeddable.filter((r) => !isFresh(r));
  const missing = gaps.filter((r) => r.model === null);
  const staleModel = gaps.filter((r) => r.model !== null && r.model !== EMBEDDING_MODEL);
  const staleHash = gaps.filter((r) => r.model === EMBEDDING_MODEL && r.textHash !== embeddingTextHash(r.text));
  const fresh = embeddable.length - gaps.length;

  // Orphaned stale rows: a current-model embedding on a now-empty/whitespace verse. embed-verses
  // skips empty verses, so it never refreshes or prunes these — yet searchSemantic filters vector
  // candidates by corpus+model ONLY (no textHash, no non-empty check), so it will still serve this
  // stale vector (ranked by the verse's OLD text). These are excluded from `gaps` (the verse is not
  // embeddable), so they must be flagged separately — otherwise an "empty-ing" re-import silently
  // keeps serving stale hits while the check reports OK.
  const staleEmpty = rows.filter((r) => r.model === EMBEDDING_MODEL && !nonEmpty(r.text));

  // Informational: global row counts by model + corpus (surfaces stale-model rows and any corpus
  // beyond the indexed one, e.g. a future translation). Independent reads → run concurrently.
  const [byModel, byCorpus, totalRows] = await Promise.all([
    prisma.$queryRaw<Array<{ model: string; n: bigint }>>`
      SELECT "model", COUNT(*)::bigint AS n FROM "VerseEmbedding" GROUP BY "model" ORDER BY n DESC
    `,
    prisma.$queryRaw<Array<{ abbreviation: string; n: bigint }>>`
      SELECT c."abbreviation" AS abbreviation, COUNT(*)::bigint AS n
      FROM "VerseEmbedding" e
      JOIN "Verse" v ON v."id" = e."verseId"
      JOIN "Corpus" c ON c."id" = v."corpusId"
      GROUP BY c."abbreviation" ORDER BY n DESC
    `,
    prisma.verseEmbedding.count()
  ]);

  const covEmbeddable = embeddable.length > 0 ? (fresh / embeddable.length) * 100 : 0;
  const covTotal = totalVerses > 0 ? (fresh / totalVerses) * 100 : 0;

  console.log("VerseEmbedding health check");
  console.log("───────────────────────────");
  console.log(`Indexed corpus / model:        ${SEMANTIC_INDEX_CORPUS} / ${EMBEDDING_MODEL}`);
  console.log(`Total embedding rows (any):    ${totalRows}`);
  console.log(`Models present:                ${byModel.map((r) => `${r.model}=${r.n}`).join(", ") || "(none)"}`);
  console.log(`Embeddings by corpus:          ${byCorpus.map((r) => `${r.abbreviation}=${r.n}`).join(", ") || "(none)"}`);
  console.log(`${SEMANTIC_INDEX_CORPUS} verses total:              ${totalVerses}`);
  console.log(`${SEMANTIC_INDEX_CORPUS} verses embeddable (text):  ${embeddable.length}   (${emptyPlaceholders} empty placeholders)`);
  console.log(`${SEMANTIC_INDEX_CORPUS} verses fresh (model+hash): ${fresh}`);
  console.log(`Stale rows on empty verses:    ${staleEmpty.length}`);
  console.log(`Coverage vs total:             ${covTotal.toFixed(2)}%`);
  console.log(`Coverage vs embeddable:        ${covEmbeddable.toFixed(2)}%`);

  // An empty indexed corpus is NOT healthy: for an ops check pointed at .env it means the
  // DB is empty/wrong or the corpus was never imported — never a green pass.
  const corpusEmpty = totalVerses === 0;
  const noEmbeddable = embeddable.length === 0;
  const healthy = !corpusEmpty && !noEmbeddable && gaps.length === 0 && staleEmpty.length === 0;

  if (corpusEmpty) {
    console.log(
      `\n❌ No ${SEMANTIC_INDEX_CORPUS} verses found — the database at DATABASE_URL is empty/wrong or the corpus was never imported.`
    );
  } else if (noEmbeddable) {
    console.log(`\n❌ ${SEMANTIC_INDEX_CORPUS} has ${totalVerses} verses but none carry embeddable text.`);
  } else {
    if (gaps.length > 0) {
      console.log(
        `\n⚠️  ${gaps.length} embeddable verse(s) need (re-)embedding` +
          `  [missing=${missing.length}, stale-model=${staleModel.length}, stale-text=${staleHash.length}]:`
      );
      for (const g of gaps.slice(0, 50)) {
        const reason = g.model === null ? "missing" : g.model !== EMBEDDING_MODEL ? `stale-model(${g.model})` : "stale-text";
        console.log(`   verse ${g.id}  ${reason}`);
      }
      if (gaps.length > 50) console.log(`   … and ${gaps.length - 50} more`);
      console.log(`   → run: npm run embed:verses`);
    }
    if (staleEmpty.length > 0) {
      console.log(
        `\n⚠️  ${staleEmpty.length} current-model embedding(s) on now-empty verse(s) — searchSemantic can still serve these stale vectors:`
      );
      for (const s of staleEmpty.slice(0, 50)) console.log(`   verse ${s.id}  stale-empty`);
      if (staleEmpty.length > 50) console.log(`   … and ${staleEmpty.length - 50} more`);
      console.log(`   → prune these rows (embed:verses skips empty verses, so it will NOT remove them).`);
    }
  }
  console.log(
    `\n${healthy ? "✅ OK — every embeddable verse is embedded and fresh on the current model (embed:verses would embed nothing)." : "❌ Attention needed — semantic search may be serving stale, missing, or unpopulated vectors (see above)."}`
  );

  process.exit(healthy ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
