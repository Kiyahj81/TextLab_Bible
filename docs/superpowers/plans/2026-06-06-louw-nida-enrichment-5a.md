# Phase 5a — Louw-Nida Enrichment (Data + Schema + Popover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the MACULA Louw-Nida `domain`/`ln` codes onto Greek tokens, seed a human-readable label reference table from the open UBS lexical-domains dataset, and show domain + subdomain labels in the reader morphology popover.

**Architecture:** New `Token.louwNida`/`Token.lnDomain` string-array columns (GIN-indexed) hold the per-token codes parsed from the MACULA TSV. A new `LouwNidaDomain` reference table maps each code to its label, seeded from a vendored CC-BY-SA UBS JSON via a dedicated idempotent import script. At read time, `getReaderPassage` batch-resolves each token's codes to domain/subdomain labels (a pure helper in `lib/louwNida.ts`) and threads them into the popover.

**Tech Stack:** Next.js 15 / React 19 / TypeScript 5.8, Prisma 6 over PostgreSQL (Neon), Vitest 4, `tsx` import scripts.

**Scope note:** This is Phase 5a only. Phase 5b (assistant domain retrieval + `/search` domain mode) is a separate plan that builds on the data this plan produces. The full design is in `docs/superpowers/specs/2026-06-06-louw-nida-enrichment-design.md`.

**Windows/TLS note:** Every `npx prisma …`, `npm run …`, and import command that touches the network or the Neon DB must run with `$env:NODE_OPTIONS="--use-system-ca"` set in the PowerShell session first (see README). Commands below assume it is set.

**Branch:** `milestone-3/phase-5-louw-nida` (already created; the spec commit is on it).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `data/louw-nida/UBSGreekNTDicLexicalDomains-v1.1-en.JSON` | Vendored UBS label taxonomy | Create |
| `data/louw-nida/NOTICE.md` | CC-BY-SA attribution for the dataset | Create |
| `lib/louwNida.ts` | Pure helpers: flatten taxonomy JSON → rows; resolve token codes → label senses; type `TokenDomainSense` | Create |
| `prisma/schema.prisma` | `Token.louwNida`/`lnDomain` + GIN index; `LouwNidaDomain` model | Modify |
| `prisma/migrations/<ts>_add_louw_nida/migration.sql` | Schema migration | Create (via `prisma migrate dev`) |
| `scripts/import-louw-nida.ts` | Idempotent upsert of `LouwNidaDomain` from the vendored JSON | Create |
| `scripts/import-open-bible.ts` | `parseMaculaTsv` parses `ln`/`domain`; `importMaculaGreekGlosses` persists arrays | Modify |
| `package.json` | `import:louw-nida` script | Modify |
| `lib/search.ts` | `getReaderPassage` selects + resolves domains into the token shape | Modify |
| `components/MorphologyPopover.tsx` | `ReaderToken.domains`; Domain / Subdomain rows | Modify |
| `tests/unit/lib/louwNida.test.ts` | Unit tests for both pure helpers | Create |
| `tests/unit/scripts/import-open-bible.test.ts` | `parseMaculaTsv` ln/domain parsing cases | Modify |
| `tests/integration/louw-nida.test.ts` | End-to-end: codes on tokens + reference table seeded | Create |
| `README.md`, `docs/PROJECT_STATE.md`, `docs/HiFi-exegesis-nt-roadmap.md`, `docs/security-register.md` | Docs | Modify |

---

## Task 1: Vendor the UBS label dataset + attribution

**Files:**
- Create: `data/louw-nida/UBSGreekNTDicLexicalDomains-v1.1-en.JSON`
- Create: `data/louw-nida/NOTICE.md`

- [ ] **Step 1: Download the dataset**

Run:
```powershell
New-Item -ItemType Directory -Force data/louw-nida | Out-Null
curl -L -o "data/louw-nida/UBSGreekNTDicLexicalDomains-v1.1-en.JSON" `
  "https://raw.githubusercontent.com/ubsicap/ubs-open-license/main/dictionaries/greek/JSON/UBSGreekNTDicLexicalDomains-v1.1-en.JSON"
```
Expected: a JSON file of a few hundred KB (the taxonomy file, not the 15 MB full dictionary).

- [ ] **Step 2: Confirm it parses and inspect the top-level shape**

Run:
```powershell
node -e "const d=require('./data/louw-nida/UBSGreekNTDicLexicalDomains-v1.1-en.JSON'); const a=Array.isArray(d)?d:(d.items||d.SemanticDomains||Object.values(d)[0]); console.log('top-level isArray:', Array.isArray(d)); console.log('first node keys:', Object.keys((Array.isArray(d)?d[0]:a[0])||{})); console.log(JSON.stringify((Array.isArray(d)?d[0]:a[0]), null, 2).slice(0,800));"
```
Expected: prints a node with `Code`, `Level`, `SemanticDomainLocalizations`, `HasSubDomains`, `Entries`. **Record the actual top-level container** (a bare array vs an object wrapping an array, and where child/sub-domain nodes live — nested under `Entries` or flat). Task 3's helper walks the structure recursively, so either shape is handled, but confirm it here.

- [ ] **Step 3: Write the attribution NOTICE**

Create `data/louw-nida/NOTICE.md`:
```markdown
# Louw-Nida Semantic Domain Labels — Attribution

The file `UBSGreekNTDicLexicalDomains-v1.1-en.JSON` in this directory is the English
lexical-domains taxonomy from the **UBS Dictionary of the Greek New Testament**, adapted
from *Greek-English Lexicon of the New Testament: Based on Semantic Domains* (Louw & Nida).

- Source: https://github.com/ubsicap/ubs-open-license (`dictionaries/greek/JSON/`)
- Version: v1.1, English
- License: **Creative Commons Attribution-ShareAlike 4.0 International (CC-BY-SA 4.0)**
  — https://creativecommons.org/licenses/by-sa/4.0/

This dataset is used to map the numeric Louw-Nida domain codes already present in the
MACULA Greek SBLGNT data to human-readable domain and subdomain labels. Per CC-BY-SA, any
redistribution of this data or an adapted database of it must retain this attribution and
be shared under the same license.
```

- [ ] **Step 4: Commit**

```powershell
git add data/louw-nida/
git commit -m "Vendor UBS Louw-Nida lexical-domains dataset (CC-BY-SA 4.0)"
```

---

## Task 2: Schema — Token columns + LouwNidaDomain table + migration

**Files:**
- Modify: `prisma/schema.prisma` (Token model ~`88-112`)
- Create: `prisma/migrations/<timestamp>_add_louw_nida/migration.sql` (generated)

- [ ] **Step 1: Add the two array columns + GIN index to `Token`**

In `prisma/schema.prisma`, inside `model Token`, add the two fields after `gloss` and the index in the index block:
```prisma
  gloss        String?
  louwNida     String[] @default([])
  lnDomain     String[] @default([])

  corpus     Corpus      @relation(fields: [corpusId], references: [id])
  book       Book        @relation(fields: [bookId], references: [id])
  notes      Note[]
  highlights Highlight[]

  @@unique([corpusId, bookId, chapter, verse, wordIndex])
  @@index([lemma])
  @@index([morphCode])
  @@index([bookId, chapter, verse])
  @@index([corpusId, bookId, partOfSpeech, lemma])
  @@index([lnDomain], type: Gin)
```

- [ ] **Step 2: Add the `LouwNidaDomain` reference model**

Add at the end of `prisma/schema.prisma`:
```prisma
model LouwNidaDomain {
  code       String  @id
  level      Int
  label      String
  parentCode String?

  @@index([parentCode])
}
```

- [ ] **Step 3: Create and apply the migration against the dev Neon branch**

Run:
```powershell
npx prisma migrate dev --name add_louw_nida
```
Expected: a new `prisma/migrations/<timestamp>_add_louw_nida/migration.sql` is generated and applied; `prisma generate` runs. With `@default([])` the array columns are added **non-nullable with an empty-array default**, so existing `Token` rows backfill cleanly. The SQL should be:
```sql
ALTER TABLE "Token" ADD COLUMN "louwNida" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
                    ADD COLUMN "lnDomain" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "Token_lnDomain_idx" ON "Token" USING GIN ("lnDomain");
CREATE TABLE "LouwNidaDomain" (
  "code" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "parentCode" TEXT,
  CONSTRAINT "LouwNidaDomain_pkey" PRIMARY KEY ("code")
);
CREATE INDEX "LouwNidaDomain_parentCode_idx" ON "LouwNidaDomain" ("parentCode");
```
Confirm the two `ADD COLUMN` lines include `NOT NULL DEFAULT ARRAY[]::TEXT[]`; if they don't, the `@default([])` was omitted from the schema — go back and add it before continuing.

- [ ] **Step 4: Verify the schema is valid and types regenerated**

Run:
```powershell
npx prisma validate
npx tsc --noEmit
```
Expected: both exit 0 (the generated client now knows `louwNida`/`lnDomain` and `prisma.louwNidaDomain`).

- [ ] **Step 5: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/
git commit -m "Add Token Louw-Nida columns and LouwNidaDomain reference table"
```

---

## Task 3: `lib/louwNida.ts` — flatten helper (TDD)

**Files:**
- Create: `lib/louwNida.ts`
- Test: `tests/unit/lib/louwNida.test.ts`

- [ ] **Step 1: Write the failing test for `flattenLouwNidaDomains`**

Create `tests/unit/lib/louwNida.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { flattenLouwNidaDomains } from "@/lib/louwNida";

describe("flattenLouwNidaDomains", () => {
  it("flattens nested domain/subdomain nodes with derived level and parentCode", () => {
    const json = [
      {
        Code: "033",
        Level: 1,
        SemanticDomainLocalizations: [
          { LanguageCode: "en", Label: "Communication" },
          { LanguageCode: "fr", Label: "Communication (fr)" }
        ],
        Entries: [
          {
            Code: "033006",
            Level: 2,
            SemanticDomainLocalizations: [{ LanguageCode: "en", Label: "Speak, Talk" }],
            Entries: []
          }
        ]
      }
    ];

    const rows = flattenLouwNidaDomains(json);
    expect(rows).toContainEqual({ code: "033", level: 1, label: "Communication", parentCode: null });
    expect(rows).toContainEqual({ code: "033006", level: 2, label: "Speak, Talk", parentCode: "033" });
  });

  it("picks the English localization and dedupes repeated codes", () => {
    const json = [
      { Code: "001", SemanticDomainLocalizations: [{ LanguageCode: "en", Label: "A" }] },
      { Code: "001", SemanticDomainLocalizations: [{ LanguageCode: "en", Label: "A-dup" }] }
    ];
    const rows = flattenLouwNidaDomains(json);
    expect(rows.filter((r) => r.code === "001")).toHaveLength(1);
  });

  it("ignores nodes without a code or without an English label", () => {
    const json = [
      { Code: "", SemanticDomainLocalizations: [{ LanguageCode: "en", Label: "skip" }] },
      { Code: "050", SemanticDomainLocalizations: [{ LanguageCode: "fr", Label: "only-fr" }] }
    ];
    expect(flattenLouwNidaDomains(json)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/louwNida.test.ts`
Expected: FAIL — `flattenLouwNidaDomains` is not exported from `@/lib/louwNida` (module not found).

- [ ] **Step 3: Implement `flattenLouwNidaDomains` (and types)**

Create `lib/louwNida.ts`:
```ts
export type LouwNidaDomainRow = {
  code: string;
  level: number;
  label: string;
  parentCode: string | null;
};

type RawNode = {
  Code?: unknown;
  SemanticDomainLocalizations?: Array<{ LanguageCode?: unknown; Label?: unknown }>;
  [key: string]: unknown;
};

function englishLabel(node: RawNode): string | null {
  const loc = (node.SemanticDomainLocalizations ?? []).find((l) => l?.LanguageCode === "en");
  const label = typeof loc?.Label === "string" ? loc.Label.trim() : "";
  return label ? label : null;
}

// Domains are 3-digit, subdomains 6-digit, deeper levels add 3 digits each.
function levelOf(code: string): number {
  return Math.max(1, Math.floor(code.length / 3));
}

function parentOf(code: string): string | null {
  return code.length > 3 ? code.slice(0, code.length - 3) : null;
}

/**
 * Recursively walk the UBS lexical-domains JSON and emit one row per node that
 * carries a numeric Code and an English label. Works for both flat-array and
 * nested (`Entries`) layouts. Dedupes by code (first English label wins).
 */
export function flattenLouwNidaDomains(json: unknown): LouwNidaDomainRow[] {
  const byCode = new Map<string, LouwNidaDomainRow>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as RawNode;

    const code = typeof node.Code === "string" ? node.Code.trim() : "";
    if (/^\d{3,}$/.test(code) && !byCode.has(code)) {
      const label = englishLabel(node);
      if (label) {
        byCode.set(code, { code, level: levelOf(code), label, parentCode: parentOf(code) });
      }
    }

    for (const child of Object.values(node)) {
      if (child && typeof child === "object") walk(child);
    }
  };

  walk(json);
  return Array.from(byCode.values());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/louwNida.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```powershell
git add lib/louwNida.ts tests/unit/lib/louwNida.test.ts
git commit -m "Add flattenLouwNidaDomains taxonomy helper"
```

---

## Task 4: `lib/louwNida.ts` — `resolveTokenDomains` helper (TDD)

**Files:**
- Modify: `lib/louwNida.ts`
- Test: `tests/unit/lib/louwNida.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/lib/louwNida.test.ts`:
```ts
import { resolveTokenDomains } from "@/lib/louwNida";

describe("resolveTokenDomains", () => {
  const labels = new Map<string, string>([
    ["033", "Communication"],
    ["033006", "Speak, Talk"],
    ["010", "Geographical Objects"]
  ]);

  it("pairs each ln ref with its subdomain and parent domain label", () => {
    const senses = resolveTokenDomains(["33.38"], ["033006"], labels);
    expect(senses).toEqual([
      { ref: "33.38", domainCode: "033006", domainLabel: "Communication", subdomainLabel: "Speak, Talk" }
    ]);
  });

  it("handles multi-sense tokens by index alignment", () => {
    const senses = resolveTokenDomains(["10.24", "33.19"], ["010002", "033006"], labels);
    expect(senses).toHaveLength(2);
    expect(senses[1]).toMatchObject({ ref: "33.19", domainLabel: "Communication", subdomainLabel: "Speak, Talk" });
    expect(senses[0]).toMatchObject({ ref: "10.24", domainLabel: "Geographical Objects", subdomainLabel: null });
  });

  it("tolerates missing labels and length mismatches", () => {
    const senses = resolveTokenDomains([], ["099999"], labels);
    expect(senses).toEqual([
      { ref: null, domainCode: "099999", domainLabel: null, subdomainLabel: null }
    ]);
  });

  it("returns an empty array when the token has no domain codes", () => {
    expect(resolveTokenDomains([], [], labels)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/louwNida.test.ts`
Expected: FAIL — `resolveTokenDomains` is not exported.

- [ ] **Step 3: Implement `resolveTokenDomains`**

Append to `lib/louwNida.ts`:
```ts
export type TokenDomainSense = {
  ref: string | null;          // ln reference for display/citation, e.g. "33.38"
  domainCode: string;          // MARBLE numeric code, e.g. "033006"
  domainLabel: string | null;  // Level-1 label, e.g. "Communication"
  subdomainLabel: string | null; // Level-2 label, e.g. "Speak, Talk"
};

/**
 * Pair each token domain code (lnDomain[i]) with its ln reference (louwNida[i])
 * and resolve labels from a code->label map. The Level-1 domain label is the
 * 3-digit prefix; the subdomain label is the full code (null when the code is
 * only domain-level). Index `i` is the same sense in both arrays.
 */
export function resolveTokenDomains(
  louwNida: string[],
  lnDomain: string[],
  labels: Map<string, string>
): TokenDomainSense[] {
  return lnDomain.map((domainCode, i) => {
    const parent = domainCode.length > 3 ? domainCode.slice(0, 3) : domainCode;
    return {
      ref: louwNida[i] ?? null,
      domainCode,
      domainLabel: labels.get(parent) ?? null,
      subdomainLabel: domainCode.length > 3 ? (labels.get(domainCode) ?? null) : null
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/louwNida.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```powershell
git add lib/louwNida.ts tests/unit/lib/louwNida.test.ts
git commit -m "Add resolveTokenDomains label-resolution helper"
```

---

## Task 5: `scripts/import-louw-nida.ts` — reference-table import

**Files:**
- Create: `scripts/import-louw-nida.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Write the import script**

Create `scripts/import-louw-nida.ts`:
```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { flattenLouwNidaDomains } from "../lib/louwNida";

const prisma = new PrismaClient();

const DATA_FILE = path.join(
  process.cwd(),
  "data/louw-nida/UBSGreekNTDicLexicalDomains-v1.1-en.JSON"
);

async function main() {
  const json = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const rows = flattenLouwNidaDomains(json);
  if (rows.length === 0) {
    throw new Error(`No Louw-Nida domain rows parsed from ${DATA_FILE}`);
  }

  const batchSize = 500;
  let applied = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await prisma.$transaction(
      batch.map((row) =>
        prisma.louwNidaDomain.upsert({
          where: { code: row.code },
          create: row,
          update: { level: row.level, label: row.label, parentCode: row.parentCode }
        })
      )
    );
    applied += batch.length;
  }

  console.log(`Upserted ${applied} Louw-Nida domain rows.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add after `import:macula-glosses`:
```json
    "import:louw-nida": "tsx --env-file=.env scripts/import-louw-nida.ts",
```

- [ ] **Step 3: Run it against the dev Neon branch**

Run:
```powershell
npm run import:louw-nida
```
Expected: prints `Upserted <N> Louw-Nida domain rows.` with N in the hundreds-to-low-thousands. Re-running prints the same count (idempotent).

- [ ] **Step 4: Spot-check a known domain**

Run:
```powershell
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.louwNidaDomain.findFirst({where:{code:'033'}}).then(r=>{console.log(r);return p.$disconnect();})"
```
Expected: a row with `label: "Communication"` (Louw-Nida domain 33), `level: 1`, `parentCode: null`.

- [ ] **Step 5: Commit**

```powershell
git add scripts/import-louw-nida.ts package.json
git commit -m "Add import:louw-nida reference-table import script"
```

---

## Task 6: `parseMaculaTsv` — parse ln/domain into arrays (TDD)

**Files:**
- Modify: `scripts/import-open-bible.ts` (`ParsedMaculaRow` ~`29-40`, `parseMaculaTsv` ~`636-695`)
- Test: `tests/unit/scripts/import-open-bible.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/scripts/import-open-bible.test.ts` inside a new `describe`:
```ts
describe("parseMaculaTsv Louw-Nida columns", () => {
  const header = [
    "ref", "english", "gloss", "text", "after", "lemma", "normalized", "morph", "domain", "ln"
  ].join("\t");

  const row = (cells: Record<string, string>) =>
    ["ref", "english", "gloss", "text", "after", "lemma", "normalized", "morph", "domain", "ln"]
      .map((c) => cells[c] ?? "")
      .join("\t");

  it("parses a single domain/ln pair into one-element arrays", () => {
    const tsv = [
      header,
      row({ ref: "JHN 1:1!1", text: "λόγος", lemma: "λόγος", domain: "033006", ln: "33.38" })
    ].join("\n");
    const rows = parseMaculaTsv(tsv);
    expect(rows[0].lnDomain).toEqual(["033006"]);
    expect(rows[0].louwNida).toEqual(["33.38"]);
  });

  it("splits multiple space-separated codes", () => {
    const tsv = [
      header,
      row({ ref: "MAT 1:1!2", text: "γενέσεως", lemma: "γένεσις", domain: "010002 033003", ln: "10.24 33.19" })
    ].join("\n");
    const rows = parseMaculaTsv(tsv);
    expect(rows[0].lnDomain).toEqual(["010002", "033003"]);
    expect(rows[0].louwNida).toEqual(["10.24", "33.19"]);
  });

  it("treats '-' and empty cells as no codes, and keeps letter suffixes", () => {
    const tsv = [
      header,
      row({ ref: "MAT 1:1!3", text: "Ἰησοῦ", lemma: "Ἰησοῦς", domain: "-", ln: "93.169a" }),
      row({ ref: "MAT 1:1!4", text: "χριστοῦ", lemma: "Χριστός", domain: "", ln: "" })
    ].join("\n");
    const rows = parseMaculaTsv(tsv);
    expect(rows[0].lnDomain).toEqual([]);
    expect(rows[0].louwNida).toEqual(["93.169a"]);
    expect(rows[1].lnDomain).toEqual([]);
    expect(rows[1].louwNida).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/scripts/import-open-bible.test.ts -t "Louw-Nida columns"`
Expected: FAIL — `rows[0].lnDomain` is `undefined` (field not yet on `ParsedMaculaRow`).

- [ ] **Step 3: Extend `ParsedMaculaRow`**

In `scripts/import-open-bible.ts`, add to the `ParsedMaculaRow` type (after `gloss`):
```ts
  gloss: string | null;
  louwNida: string[];
  lnDomain: string[];
```

- [ ] **Step 4: Parse the columns in `parseMaculaTsv`**

In `parseMaculaTsv`, after the existing `const morphIdx = col("morph");` line, add:
```ts
  const domainIdx = col("domain");
  const lnIdx = col("ln");
```
Then add a splitter helper just above the `const rows: ParsedMaculaRow[] = [];` line:
```ts
  const splitCodes = (raw: string | undefined): string[] =>
    (raw ?? "").trim().split(/\s+/).filter((code) => code && code !== "-");
```
Inside the row loop, after `const lemma = ...`, add:
```ts
    const louwNida = splitCodes(cells[lnIdx]);
    const lnDomain = splitCodes(cells[domainIdx]);
```
And in the `rows.push({ ... })` object, add the two fields after `gloss`:
```ts
      gloss,
      louwNida,
      lnDomain
```

- [ ] **Step 5: Update the existing PA-override fixtures (they now lack required columns)**

`col("domain")`/`col("ln")` throw when the column is absent, so the existing
`describe("parseMaculaTsv Pericope Adulterae overrides")` fixtures break. Fix them once in the shared
helpers (not per test). Change the shared `header` (currently ending `…\tmorph`) to append the two columns:
```ts
  const header =
    "xml:id\tref\trole\tclass\ttype\tenglish\tmandarin\tgloss\ttext\tafter\tlemma\tnormalized\tstrong\tmorph\tdomain\tln";
```
And change the shared `row(...)` helper to append two trailing (empty) cells so column indices stay aligned:
```ts
    `id\t${ref}\t\t\t\t\t\t\t${text}\t${after}\t${lemma}\t${normalized}\t\t${morph}\t\t`;
```
(`col` resolves by column name, so appending `domain`/`ln` at the end is sufficient — their real-file
position between `morph` and the end does not matter for the fixture.)

- [ ] **Step 6: Run the new and existing parseMaculaTsv tests to verify they pass**

Run: `npx vitest run tests/unit/scripts/import-open-bible.test.ts`
Expected: PASS — the 3 new "Louw-Nida columns" tests and all existing PA-override and `parseUsfm` tests.

- [ ] **Step 7: Commit**

```powershell
git add scripts/import-open-bible.ts tests/unit/scripts/import-open-bible.test.ts
git commit -m "Parse MACULA ln/domain columns into token code arrays"
```

---

## Task 7: Persist code arrays through all three MACULA write paths

**Files:**
- Modify: `scripts/import-open-bible.ts` (`importMaculaGreekGlosses`: `updates` type ~`339`, insert/upsert ~`353-384`, overridden-verse refresh ~`396-406`, batched update ~`423-430`)

> No unit test here (these are direct Prisma writes); Task 9's integration test verifies the codes land on real tokens — including a MACULA-only/PA token. There are **three** write paths, not two; the easy-to-miss one is the `if (!token)` insert/upsert that backfills tokens MorphGNT never shipped (e.g. Pericope Adulterae). Mirror the existing `gloss` handling exactly in each.

- [ ] **Step 1: Carry arrays in the MACULA-only insert/upsert path (`if (!token)`)**

In the `prisma.token.upsert({ ... })` call, add the two fields to **both** the `update` and `create` blocks, after `gloss: row.gloss`:
```ts
          update: {
            surface: row.surface,
            normalized: row.normalized ?? row.surface,
            lemma: row.lemma,
            morphCode: row.morph,
            partOfSpeech: row.partOfSpeech,
            gloss: row.gloss,
            louwNida: row.louwNida,
            lnDomain: row.lnDomain
          },
          create: {
            corpusId: corpus.id,
            bookId: book.id,
            chapter: row.chapter,
            verse: row.verse,
            wordIndex: row.wordIndex,
            surface: row.surface,
            normalized: row.normalized ?? row.surface,
            lemma: row.lemma,
            morphCode: row.morph,
            partOfSpeech: row.partOfSpeech,
            gloss: row.gloss,
            louwNida: row.louwNida,
            lnDomain: row.lnDomain
          }
```

- [ ] **Step 2: Carry arrays in the overridden-verse refresh path (`if (inOverriddenVerse)`)**

In that block's `prisma.token.update({ data: { ... } })`, add the two fields after `gloss: row.gloss`:
```ts
            gloss: row.gloss,
            louwNida: row.louwNida,
            lnDomain: row.lnDomain
```

- [ ] **Step 3: Widen the `updates` array type and carry arrays in the batched path**

The `updates` array is **explicitly typed** (around line 339). Change:
```ts
    const updates: { id: string; gloss: string | null }[] = [];
```
to:
```ts
    const updates: { id: string; gloss: string | null; louwNida: string[]; lnDomain: string[] }[] = [];
```
Change the `updates.push(...)` from:
```ts
      updates.push({ id: token.id, gloss: row.gloss });
```
to:
```ts
      updates.push({
        id: token.id,
        gloss: row.gloss,
        louwNida: row.louwNida,
        lnDomain: row.lnDomain
      });
```
And change the batched update from:
```ts
          prisma.token.update({ where: { id: u.id }, data: { gloss: u.gloss } })
```
to:
```ts
          prisma.token.update({
            where: { id: u.id },
            data: { gloss: u.gloss, louwNida: u.louwNida, lnDomain: u.lnDomain }
          })
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: exits 0. (If it errors on `updates`, the explicit type annotation in Step 3 was not widened.)

- [ ] **Step 5: Run the MACULA import against the dev Neon branch**

Run:
```powershell
npm run import:macula-glosses
```
Expected: completes without error; existing gloss/refresh/insert counts log as before.

- [ ] **Step 6: Spot-check a normal token and a MACULA-only/PA token**

Run:
```powershell
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();Promise.all([p.token.findFirst({where:{lemma:'λόγος',book:{osisId:'John'},chapter:1,verse:1},select:{surface:true,louwNida:true,lnDomain:true}}),p.token.findFirst({where:{book:{osisId:'John'},chapter:7,verse:53},orderBy:{wordIndex:'asc'},select:{surface:true,louwNida:true,lnDomain:true}})]).then(([a,b])=>{console.log('John 1:1',a);console.log('PA John 7:53',b);return p.$disconnect();})"
```
Expected: the John 1:1 `λόγος` token has non-empty arrays; the John 7:53 Pericope-Adulterae token `Καὶ` (wordIndex 1, inserted via the `if (!token)` path) shows `louwNida: [ '91.1' ]` and `lnDomain: [ '091001' ]` — the exact upstream MACULA values, proving the insert path persists the parsed arrays (not just the `@default([])` empty array).

- [ ] **Step 7: Commit**

```powershell
git add scripts/import-open-bible.ts
git commit -m "Persist Louw-Nida code arrays through all MACULA import write paths"
```

---

## Task 8: Reader popover — resolve and display domain labels

**Files:**
- Modify: `lib/search.ts` (`getReaderPassage` ~`269-356`)
- Modify: `components/MorphologyPopover.tsx` (`ReaderToken` ~`14-28`, dl block ~`179-188`)

- [ ] **Step 1: Select the code columns and resolve labels in `getReaderPassage`**

In `lib/search.ts`, import the helper at the top (with the other imports — only the helper is needed; the sense type is inferred into the returned token shape):
```ts
import { resolveTokenDomains } from "@/lib/louwNida";
```
The token `findMany` in `getReaderPassage` uses `include: { book: true, notes, highlights }`, so `louwNida`/`lnDomain` are already returned (no `select` to extend). After the `Promise.all([...])` that produces `tokens` and before `const tokensByVerse = ...`, add a batched label lookup:
```ts
  const domainCodes = new Set<string>();
  for (const token of tokens) {
    for (const code of token.lnDomain) {
      domainCodes.add(code);
      if (code.length > 3) domainCodes.add(code.slice(0, 3));
    }
  }
  const domainLabelRows = domainCodes.size
    ? await prisma.louwNidaDomain.findMany({
        where: { code: { in: Array.from(domainCodes) } },
        select: { code: true, label: true }
      })
    : [];
  const domainLabels = new Map(domainLabelRows.map((row) => [row.code, row.label]));
```

- [ ] **Step 2: Thread `domains` into the mapped token shape**

In the `tokens: (tokensByVerse[verse.verse] ?? []).map((token) => ({ ... }))` object, add after `gloss: token.gloss,`:
```ts
        gloss: token.gloss,
        domains: resolveTokenDomains(token.louwNida, token.lnDomain, domainLabels),
```

- [ ] **Step 3: Extend the `ReaderToken` type**

In `components/MorphologyPopover.tsx`, add `Fragment` to the existing React import (it groups each sense's `dt`/`dd` pair under one key) and add a type-only import for the sense type:
```ts
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TokenDomainSense } from "@/lib/louwNida";
```
Add to `ReaderToken` after `gloss`:
```ts
  gloss: string | null;
  domains: TokenDomainSense[];
```

- [ ] **Step 4: Render the domain rows in the popover (separate Domain / Subdomain rows, per the approved mock)**

In `MorphologyPopover`, in the `<dl>` block, after the `Gloss` `<dt>/<dd>` pair, add a `Domain` row and (when present) a `Subdomain` row per sense — matching the spec mock:
```
Domain       Communication
Subdomain    Speak, Talk (33.38)
```
```tsx
        <dt className="text-slate-500">Gloss</dt>
        <dd>{token.gloss ?? "Not supplied"}</dd>
        {token.domains.map((sense, index) => (
          <Fragment key={`${sense.domainCode}-${index}`}>
            <dt className="text-slate-500">Domain</dt>
            <dd>
              {sense.domainLabel ?? sense.domainCode}
              {!sense.subdomainLabel && sense.ref ? (
                <span className="text-slate-400"> ({sense.ref})</span>
              ) : null}
            </dd>
            {sense.subdomainLabel ? (
              <>
                <dt className="text-slate-500">Subdomain</dt>
                <dd>
                  {sense.subdomainLabel}
                  {sense.ref ? <span className="text-slate-400"> ({sense.ref})</span> : null}
                </dd>
              </>
            ) : null}
          </Fragment>
        ))}
```
A token with no domain data renders nothing here (the `.map` over an empty array). A multi-sense token
renders a `Domain`/`Subdomain` pair per sense, in order.

- [ ] **Step 5: Type-check and build**

Run:
```powershell
npx tsc --noEmit
```
Expected: exits 0 — the `getReaderPassage` token shape now structurally includes `domains: TokenDomainSense[]`, matching `ReaderToken` used by `BibleReader`.

- [ ] **Step 6: Manual smoke check**

Run `npm run dev`, open `http://localhost:3000/read` (sign in via dev credentials), click the Greek word `λόγος` in John 1:1. Expected: the popover shows a `Domain` row (e.g. `Communication`) and a `Subdomain` row (e.g. `Speak, Talk (33.38)`).

- [ ] **Step 7: Commit**

```powershell
git add lib/search.ts components/MorphologyPopover.tsx
git commit -m "Resolve and display Louw-Nida domain labels in the reader popover"
```

---

## Task 9: Integration test — codes on tokens + reference table seeded

**Files:**
- Create: `tests/integration/louw-nida.test.ts`

> Runs via `npm run test:integration` against the Neon test branch (`.env.test`). It assumes the base SBLGNT corpus has been imported from MorphGNT, but **not** previously enriched by MACULA for John 7:53. The Pericope Adulterae regression must exercise the `if (!token)` MACULA insert path, so use a fresh test branch or a MorphGNT-only baseline where `John 7:53` has zero SBLGNT tokens before running the MACULA import.

- [ ] **Step 1: Seed the test branch from a MorphGNT-only baseline**

Run (with `.env.test` pointing at a fresh test branch, or a branch reset to the MorphGNT-only SBLGNT baseline):
```powershell
npx prisma migrate deploy --schema prisma/schema.prisma
tsx --env-file=.env.test scripts/import-louw-nida.ts
```
Expected: migration applied; domain rows upserted.

Before the MACULA import, verify the insert-path precondition:
```powershell
node --env-file=.env.test -e 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();p.token.count({where:{corpus:{abbreviation:"SBLGNT"},book:{osisId:"John"},chapter:7,verse:53}}).then(async c=>{console.log(c);await p.$disconnect();})'
```
Expected before import: `0`. If this count is non-zero, the PA regression would hit the refresh path, not the insert path; use a fresh test branch or restore the MorphGNT-only baseline before continuing.

Then run the MACULA import:
```powershell
tsx --env-file=.env.test scripts/import-open-bible.ts --macula-greek-url https://raw.githubusercontent.com/Clear-Bible/macula-greek/main/SBLGNT/tsv/macula-greek-SBLGNT.tsv
```
Expected: MACULA import completes.

- [ ] **Step 2: Write the integration test**

Create `tests/integration/louw-nida.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

const itDb = process.env.DATABASE_URL ? it : it.skip;

describe("Louw-Nida enrichment (integration)", () => {
  itDb("seeds the LouwNidaDomain reference table with domain 33 = Communication", async () => {
    const domain = await prisma.louwNidaDomain.findUnique({ where: { code: "033" } });
    expect(domain?.label).toBe("Communication");
    expect(domain?.level).toBe(1);
    expect(domain?.parentCode).toBeNull();
  });

  itDb("attaches domain/ln codes to John 1:1 λόγος", async () => {
    const token = await prisma.token.findFirst({
      where: { lemma: "λόγος", book: { osisId: "John" }, chapter: 1, verse: 1 },
      select: { louwNida: true, lnDomain: true }
    });
    expect(token).not.toBeNull();
    expect(token!.lnDomain.length).toBeGreaterThan(0);
    expect(token!.louwNida.length).toBeGreaterThan(0);
  });

  itDb("supports GIN array-membership queries on lnDomain", async () => {
    const count = await prisma.token.count({ where: { lnDomain: { has: "033006" } } });
    expect(count).toBeGreaterThan(0);
  });

  // Regression for the MACULA-only insert/upsert path. This test must run on a
  // branch where John 7:53 had zero SBLGNT tokens before the MACULA import,
  // because MorphGNT omits the Pericope Adulterae and MACULA inserts it. The upstream MACULA row for
  // 7:53!1 (Καὶ) carries domain 091001 / ln 91.1, so asserting the EXACT values proves the
  // insert path wrote the parsed arrays through — not merely the schema's @default([]) empty
  // array (which an Array.isArray check would pass even if the insert forgot the fields).
  itDb("persists parsed code arrays on inserted Pericope Adulterae tokens", async () => {
    const token = await prisma.token.findFirst({
      where: { book: { osisId: "John" }, chapter: 7, verse: 53, wordIndex: 1 },
      select: { surface: true, louwNida: true, lnDomain: true }
    });
    expect(token).not.toBeNull();
    expect(token!.lnDomain).toContain("091001");
    expect(token!.louwNida).toContain("91.1");
  });
});
```

- [ ] **Step 3: Run the integration suite**

Run: `npm run test:integration`
Expected: PASS (4 new tests, alongside the existing ownership suite). If the `033006` membership count is 0, adjust the code in that test to one the import actually produced (confirm with the spot-check query from Task 7 Step 6).

- [ ] **Step 4: Commit**

```powershell
git add tests/integration/louw-nida.test.ts
git commit -m "Add Louw-Nida enrichment integration tests"
```

---

## Task 10: Documentation

**Files:**
- Modify: `README.md`, `docs/PROJECT_STATE.md`, `docs/HiFi-exegesis-nt-roadmap.md`, `docs/security-register.md`

- [ ] **Step 1: README — import + display + attribution**

In `README.md` "Open Text Imports", add a `import:louw-nida` step (run before re-running `import:macula-glosses`), note the popover now shows semantic-domain labels, and add a line crediting the UBS dataset under CC-BY-SA 4.0 (point at `data/louw-nida/NOTICE.md`). In the data-sources table, add a row for the UBS lexical-domains dataset.

- [ ] **Step 2: PROJECT_STATE — Phase 5a status**

In `docs/PROJECT_STATE.md`, under "Milestone 3", mark Phase 5a done: new `Token.louwNida`/`lnDomain` columns + GIN index, `LouwNidaDomain` table + migration, `scripts/import-louw-nida.ts`, popover domain display. Add the migration to the migrations list and the new tests to the test-surfaces list. Update the snapshot date line at the top.

- [ ] **Step 3: Roadmap — mark Phase 5 (5a) progress**

In `docs/HiFi-exegesis-nt-roadmap.md`, mark Phase 5 as in progress / 5a done, and update the reconciliation row "Louw-Nida domains" in §A from "present in MACULA TSV source, not imported" to imported (popover display landed; retrieval/search = 5b).

- [ ] **Step 4: Security register — CC-BY-SA obligation**

In `docs/security-register.md`, add a licensing note: the vendored UBS Louw-Nida dataset is CC-BY-SA 4.0; attribution lives in `data/louw-nida/NOTICE.md` and `README.md`; ShareAlike applies to redistribution of the data or an adapted database of it.

- [ ] **Step 5: Commit**

```powershell
git add README.md docs/
git commit -m "Document Phase 5a Louw-Nida enrichment"
```

---

## Task 11: Full verification gate

- [ ] **Step 1: Run the unit + coverage gate**

Run:
```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run verify
```
Expected: lint + tsc + build + coverage all pass (exit 0). Coverage thresholds 80/80/75/65 hold (the new pure helpers in `lib/louwNida.ts` are well covered by Task 3/4 tests).

- [ ] **Step 2: Run integration + acceptance**

Run:
```powershell
npm run test:integration
npm run test:acceptance
```
Expected: both exit 0. If `scripts/acceptance-test.js` asserts corpus counts, confirm they still match (Phase 5a adds columns, not token rows — counts should be unchanged; update only if an assertion keys off enriched content).

- [ ] **Step 3: Final review and push**

Run:
```powershell
git log --oneline main..HEAD
git push -u origin milestone-3/phase-5-louw-nida
```
Then open a PR. Per project memory: review any Codex automated PR comments and fix valid findings before merging.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Tasks 1 (sourcing + CC-BY-SA), 2 (schema/array+GIN+ref table, explicit `@default([])`), 3–7 (import pipeline incl. **all three** MACULA write paths + reference seed + existing-fixture fix), 8 (popover display, separate Domain/Subdomain rows incl. multi-sense), 9 (integration incl. PA insert-path regression), 10 (docs incl. security register). Phase 5b (retrieval + search) is intentionally out of this plan.
- **Code-array alignment:** `louwNida[i]` ↔ `lnDomain[i]` is asserted in Task 4's multi-sense test and relied on by `resolveTokenDomains`. Both arrays are built from the same MACULA row in column order (Task 6).
- **Type consistency:** `TokenDomainSense` is defined once in `lib/louwNida.ts` and consumed by both `getReaderPassage` (Task 8 Step 2) and `ReaderToken` (Task 8 Step 3). `flattenLouwNidaDomains` returns `LouwNidaDomainRow`, consumed by `import-louw-nida.ts` (Task 5) and matching the `LouwNidaDomain` model fields (Task 2).
- **Open item from spec §"Open items 1":** the batched `LouwNidaDomain` lookup is one query per passage (Task 8 Step 1), not per token.
