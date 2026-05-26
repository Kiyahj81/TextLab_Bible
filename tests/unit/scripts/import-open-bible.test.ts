import { describe, expect, it } from "vitest";
import { parseMaculaTsv, parseUsfm } from "@/scripts/import-open-bible";

describe("parseUsfm", () => {
  it("captures a single-line verse", () => {
    const usfm = [
      "\\id ROM Romans",
      "\\c 16",
      "\\v 1 I commend to you Phoebe."
    ].join("\n");

    const verses = parseUsfm(usfm);
    expect(verses).toHaveLength(1);
    expect(verses[0]).toMatchObject({
      book: "Rom",
      chapter: 16,
      verse: 1,
      text: "I commend to you Phoebe."
    });
  });

  it("accumulates continuation text across a \\p paragraph break (Romans 16:20 shape)", () => {
    // Romans 16:20 in the WEB USFM splits across two lines:
    //   \v 20 ... feet.
    //   \p ... grace ... you.
    // The second sentence is part of v.20, not v.21. Prior to this fix,
    // the parser dropped everything after the first line.
    const usfm = [
      "\\id ROM Romans",
      "\\c 16",
      "\\v 20 \\w And|strong=\"G1161\"\\w* the God of peace will quickly crush Satan under your feet.",
      "\\p \\w The|strong=\"G1722\"\\w* grace of our Lord Jesus Christ be with you.",
      "\\p",
      "\\v 21 Timothy greets you."
    ].join("\n");

    const verses = parseUsfm(usfm);
    expect(verses).toHaveLength(2);

    const v20 = verses.find((v) => v.verse === 20);
    expect(v20).toBeDefined();
    expect(v20!.text).toContain("crush Satan under your feet");
    expect(v20!.text).toContain("The grace of our Lord Jesus Christ be with you");

    const v21 = verses.find((v) => v.verse === 21);
    expect(v21!.text).toBe("Timothy greets you.");
  });

  it("respects chapter boundaries when a verse precedes \\c (John 7:53 → 8:1 shape)", () => {
    // Around the Pericope Adulterae, the WEB USFM uses:
    //   \v 53 Everyone went to his own house,
    //   \c 8
    //   \nb
    //   \v 1 but Jesus went to the Mount of Olives.
    // 7:53 must flush before \c 8 increments the chapter so that v.1 is
    // tagged as chapter 8, and 7:53 must not absorb 8:1's text.
    const usfm = [
      "\\id JHN John",
      "\\c 7",
      "\\v 53 Everyone went to his own house,",
      "\\c 8",
      "\\nb",
      "\\v 1 but Jesus went to the Mount of Olives.",
      "\\p",
      "\\v 2 Now very early in the morning, he came again into the temple."
    ].join("\n");

    const verses = parseUsfm(usfm);
    expect(verses).toHaveLength(3);

    const seven53 = verses.find((v) => v.chapter === 7 && v.verse === 53);
    expect(seven53).toBeDefined();
    expect(seven53!.text).toBe("Everyone went to his own house,");

    const eight1 = verses.find((v) => v.chapter === 8 && v.verse === 1);
    expect(eight1).toBeDefined();
    expect(eight1!.text).toBe("but Jesus went to the Mount of Olives.");
    expect(eight1!.text).not.toContain("Everyone went");

    const eight2 = verses.find((v) => v.chapter === 8 && v.verse === 2);
    expect(eight2!.text).toContain("very early in the morning");
  });

  it("does not fold continuation text across the next \\v marker", () => {
    const usfm = [
      "\\id ROM Romans",
      "\\c 1",
      "\\v 1 Paul, a servant of Christ Jesus,",
      "\\v 2 which he promised beforehand through his prophets."
    ].join("\n");

    const verses = parseUsfm(usfm);
    expect(verses).toHaveLength(2);
    expect(verses[0].text).toBe("Paul, a servant of Christ Jesus,");
    expect(verses[0].text).not.toContain("which he promised");
    expect(verses[1].text).toBe("which he promised beforehand through his prophets.");
  });

  it("strips USFM word-level markers via cleanUsfmText", () => {
    const usfm = [
      "\\id JHN John",
      "\\c 1",
      "\\v 1 \\w In|strong=\"G1722\"\\w* \\w the|strong=\"G1722\"\\w* \\w beginning|strong=\"G746\"\\w*."
    ].join("\n");

    const verses = parseUsfm(usfm);
    expect(verses[0].text).toBe("In the beginning.");
  });

  it("ignores blank lines and standalone paragraph markers", () => {
    const usfm = [
      "\\id ROM Romans",
      "\\c 1",
      "",
      "\\p",
      "\\v 1 First.",
      "\\p",
      "",
      "\\v 2 Second."
    ].join("\n");

    const verses = parseUsfm(usfm);
    expect(verses).toHaveLength(2);
    expect(verses[0].text).toBe("First.");
    expect(verses[1].text).toBe("Second.");
  });

  it("preserves a space across consecutive markers (Rev 2:1 \\wj* \\p \\wj shape)", () => {
    // In WEB Revelation, the letters to the seven churches are formatted as:
    //   \v 1 \wj "...Ephesus \+w write|...\+w*:\wj*
    //   \p \wj "\+w He|...\+w* who holds the seven stars...
    // Three markers (\wj*, \p, \wj) run in sequence with only single spaces
    // between them. The marker-stripping regex used to eat each marker plus
    // its trailing whitespace, leaving `write:"He` glued into one token.
    // Replacing markers with a space (then collapsing) preserves separation.
    const usfm = [
      "\\id REV Revelation",
      "\\c 2",
      "\\v 1 \\wj “\\+w To|strong=\"G3004\"\\+w* the angel of the assembly in Ephesus \\+w write|strong=\"G1125\"\\+w*:\\wj*",
      "\\p \\wj “\\+w He|strong=\"G3588\"\\+w* who holds the seven stars in his right hand\\wj*"
    ].join("\n");

    const verses = parseUsfm(usfm);
    expect(verses).toHaveLength(1);
    expect(verses[0].text).toContain("write: ");
    expect(verses[0].text).toContain("write: “He");
    expect(verses[0].text).not.toContain("write:“He");
  });

  it("preserves a space when the continuation paragraph begins with quoted speech (Acts 15:23 shape)", () => {
    const usfm = [
      "\\id ACT Acts",
      "\\c 15",
      "\\v 23 \\w They|strong=\"G2532\"\\w* \\w wrote|strong=\"G1125\"\\w* these things by their \\w hand|strong=\"G5495\"\\w*:",
      "\\p “\\w The|strong=\"G2532\"\\w* apostles, the elders, and the brothers"
    ].join("\n");

    const verses = parseUsfm(usfm);
    expect(verses).toHaveLength(1);
    expect(verses[0].text).toContain("hand: “The apostles");
    expect(verses[0].text).not.toContain("hand:“The");
  });

  it("flushes the final verse at end of input", () => {
    const usfm = [
      "\\id ROM Romans",
      "\\c 16",
      "\\v 27 to the only wise God, through Jesus Christ.",
      "\\p be the glory forever! Amen."
    ].join("\n");

    const verses = parseUsfm(usfm);
    expect(verses).toHaveLength(1);
    expect(verses[0].text).toContain("to the only wise God");
    expect(verses[0].text).toContain("be the glory forever! Amen.");
  });
});

describe("parseMaculaTsv Pericope Adulterae overrides", () => {
  // Minimal MACULA-shaped TSV fixture covering one passing token, two
  // missing-punctuation overrides, one wrong-punctuation override, and the
  // corrupted-text override (8:10!14, where MACULA's raw `text` is "εἰσιν;;").
  const header =
    "xml:id\tref\trole\tclass\ttype\tenglish\tmandarin\tgloss\ttext\tafter\tlemma\tnormalized\tstrong\tmorph";

  const row = (
    ref: string,
    text: string,
    after: string,
    lemma = "",
    normalized = "",
    morph = ""
  ) =>
    `id\t${ref}\t\t\t\t\t\t\t${text}\t${after}\t${lemma}\t${normalized}\t\t${morph}`;

  it("patches missing high stop after 7:53 αὐτοῦ (·, not ,)", () => {
    const tsv = [header, row("JHN 7:53!7", "αὐτοῦ", ",")].join("\n");
    const rows = parseMaculaTsv(tsv);
    expect(rows[0].surface).toBe("αὐτοῦ·");
  });

  it("patches missing comma after 8:6 κύψας", () => {
    const tsv = [header, row("JHN 8:6!14", "κύψας", " ")].join("\n");
    const rows = parseMaculaTsv(tsv);
    expect(rows[0].surface).toBe("κύψας,");
  });

  it("corrects wrong period to comma after 8:6 γῆν", () => {
    const tsv = [header, row("JHN 8:6!20", "γῆν", ".")].join("\n");
    const rows = parseMaculaTsv(tsv);
    expect(rows[0].surface).toBe("γῆν,");
  });

  it("strips embedded ;; from 8:10 εἰσιν and capitalizes Ποῦ / Οὐδείς", () => {
    const tsv = [
      header,
      row("JHN 8:10!13", "ποῦ", " "),
      row("JHN 8:10!14", "εἰσιν;;", " "),
      row("JHN 8:10!18", "σου", " "),
      row("JHN 8:10!19", "οὐδείς", " ")
    ].join("\n");
    const rows = parseMaculaTsv(tsv);
    expect(rows[0].surface).toBe("Ποῦ");
    expect(rows[1].surface).toBe("εἰσιν");
    expect(rows[2].surface).toBe("σου;");
    expect(rows[3].surface).toBe("Οὐδείς");
  });

  it("leaves non-PA tokens alone", () => {
    const tsv = [header, row("JHN 1:1!1", "Ἐν", " ")].join("\n");
    const rows = parseMaculaTsv(tsv);
    expect(rows[0].surface).toBe("Ἐν");
  });
});
