import { describe, expect, it } from "vitest";
import {
  ENGLISH_TO_GREEK_LEMMA,
  detectDomainQuery,
  detectGreekWords,
  detectIntent,
  detectMorphCodes,
  detectPhraseLemmas,
  detectReferences,
  detectTopicWords,
  detectConceptWords,
  extractSignals
} from "@/lib/ai/signals";

describe("detectReferences", () => {
  it("parses a bare book + chapter", () => {
    expect(detectReferences("Romans 7")).toEqual([{ book: "Rom", chapter: 7 }]);
  });

  it("parses a single verse", () => {
    expect(detectReferences("Rom 7:1")).toEqual([{ book: "Rom", chapter: 7, verseStart: 1 }]);
  });

  it("parses a verse range with a hyphen", () => {
    expect(detectReferences("Rom 7:1-6")).toEqual([
      { book: "Rom", chapter: 7, verseStart: 1, verseEnd: 6 }
    ]);
  });

  it("parses a verse range with an en-dash", () => {
    expect(detectReferences("Rom 7:1–6")).toEqual([
      { book: "Rom", chapter: 7, verseStart: 1, verseEnd: 6 }
    ]);
  });

  it("parses a numbered book", () => {
    expect(detectReferences("1 Cor 13")).toEqual([{ book: "1Cor", chapter: 13 }]);
  });

  it("parses numbered John books before the Gospel of John", () => {
    expect(detectReferences("1 John 4")).toEqual([{ book: "1John", chapter: 4 }]);
    expect(detectReferences("2 John 1")).toEqual([{ book: "2John", chapter: 1 }]);
  });

  it("parses John 3:16", () => {
    expect(detectReferences("John 3:16")).toEqual([{ book: "John", chapter: 3, verseStart: 16 }]);
  });

  it("parses multiple references in one prompt", () => {
    expect(detectReferences("In Romans 7 and 1 Cor 13")).toEqual([
      { book: "Rom", chapter: 7 },
      { book: "1Cor", chapter: 13 }
    ]);
  });

  it("does not match book aliases embedded in other words", () => {
    expect(detectReferences("romance languages")).toEqual([]);
    expect(detectReferences("from the start")).toEqual([]);
  });

  it("parses a cross-chapter range", () => {
    expect(detectReferences("2 Cor 4:16-5:10")).toEqual([
      { book: "2Cor", chapter: 4, verseStart: 16, chapterEnd: 5, verseEnd: 10 }
    ]);
  });

  it("parses a cross-chapter range with an en dash", () => {
    expect(detectReferences("Rom 7:25–8:4")).toEqual([
      { book: "Rom", chapter: 7, verseStart: 25, chapterEnd: 8, verseEnd: 4 }
    ]);
  });

  it("keeps a same-chapter range free of chapterEnd", () => {
    expect(detectReferences("Rom 8:1-4")).toEqual([
      { book: "Rom", chapter: 8, verseStart: 1, verseEnd: 4 }
    ]);
  });
});

describe("detectGreekWords", () => {
  it("extracts a single Greek word", () => {
    expect(detectGreekWords("What does νόμος mean?")).toEqual(["νόμος"]);
  });

  it("extracts multiple Greek words", () => {
    expect(detectGreekWords("compare λόγος and σάρξ")).toEqual([
      "λόγος",
      "σάρξ"
    ]);
  });

  it("drops single-character Greek runs", () => {
    expect(detectGreekWords("the word ὁ")).toEqual([]);
  });

  it("deduplicates repeated Greek words", () => {
    expect(detectGreekWords("νόμος and νόμος")).toEqual(["νόμος"]);
  });
});

describe("detectMorphCodes", () => {
  it("treats a full code as exact", () => {
    expect(detectMorphCodes("find V-PAI-3S forms")).toEqual([{ code: "V-PAI-3S", mode: "exact" }]);
  });

  it("treats a complete nominal parse as exact", () => {
    expect(detectMorphCodes("show N-NSM forms")).toEqual([{ code: "N-NSM", mode: "exact" }]);
  });

  it("treats a short partial code as a prefix", () => {
    expect(detectMorphCodes("V-P verbs")).toEqual([{ code: "V-P", mode: "prefix" }]);
  });

  it("returns nothing when there are no codes", () => {
    expect(detectMorphCodes("no codes here")).toEqual([]);
  });

  it("does not treat hyphenated words like COVID-19 as morph codes", () => {
    expect(detectMorphCodes("the COVID-19 pandemic")).toEqual([]);
  });
});

describe("detectTopicWords", () => {
  it("keeps content words and drops stopwords and book names", () => {
    expect(detectTopicWords("What is the role of law in Romans?")).toEqual(["law"]);
  });

  it("drops describe as a framing verb instead of a topic word", () => {
    expect(detectTopicWords("How does Paul describe love?")).toEqual(["love"]);
  });

  it("drops proper nouns and common verbs", () => {
    expect(detectTopicWords("How does Paul use πίστις?")).toEqual([]);
  });

  it("keeps satan as a topic word so named-entity questions retrieve evidence", () => {
    expect(detectTopicWords("what does the bible teach about satan")).toContain("satan");
  });

  it("keeps core biblical entities as retrievable topic words", () => {
    expect(detectTopicWords("verses about Jesus and God in Jerusalem")).toEqual(["jesus", "god", "jerusalem"]);
  });

  it("removes only 'just' from STOP_WORDS; give/form/forms stay filtered", () => {
    // `just` is the one word made searchable: there is no inflected substitute for the
    // adjective, so the bare word must surface verses about God being *just*.
    expect(detectTopicWords("verses about God being just")).toContain("just");
    // `give`/`form`/`forms` stay stop words. `give` is the request verb ("give me ...");
    // `form`/`forms` collide with morphology prompts ("verb forms", "aorist forms"). As
    // topic words they would inject unrelated keyword/semantic searches. Their real topics
    // stay reachable via inflected forms that were never stop words: giving/gives, formed.
    expect(detectTopicWords("give")).toEqual([]);
    expect(detectTopicWords("form")).toEqual([]);
    expect(detectTopicWords("forms")).toEqual([]);
    expect(detectTopicWords("give me verses about love")).toEqual(["love"]);
    expect(detectTopicWords("verses about giving")).toContain("giving");
    expect(detectTopicWords("Christ formed in us")).toContain("formed");
  });
});

describe("ENGLISH_TO_GREEK_LEMMA", () => {
  it("maps core entity topics to SBLGNT lemma forms", () => {
    expect(ENGLISH_TO_GREEK_LEMMA).toHaveProperty("jesus");
    expect(ENGLISH_TO_GREEK_LEMMA).toHaveProperty("christ");
    expect(ENGLISH_TO_GREEK_LEMMA).toHaveProperty("god");
    expect(ENGLISH_TO_GREEK_LEMMA).toHaveProperty("lord");
    expect(ENGLISH_TO_GREEK_LEMMA).toHaveProperty("jerusalem");
  });

  it("maps satan and devil to their SBLGNT lemma forms", () => {
    expect(ENGLISH_TO_GREEK_LEMMA.satan).toBe("Σατανᾶς");
    expect(ENGLISH_TO_GREEK_LEMMA.devil).toBe("διάβολος");
  });

  it("maps jerusalem to both NT lemma forms (Hebraic and Hellenized)", () => {
    expect(ENGLISH_TO_GREEK_LEMMA.jerusalem).toEqual(["Ἰερουσαλήμ", "Ἱεροσόλυμα"]);
  });

  it("contains no multi-word (underscore) keys, which can never match a topic word", () => {
    expect(Object.keys(ENGLISH_TO_GREEK_LEMMA).some((key) => key.includes("_"))).toBe(false);
  });

  it("every key is reachable as a topic word (not shadowed by a stop word, proper noun, or book alias)", () => {
    const unreachable = Object.keys(ENGLISH_TO_GREEK_LEMMA).filter(
      (key) => !detectTopicWords(key).includes(key)
    );
    expect(unreachable).toEqual([]);
  });
});

describe("detectPhraseLemmas", () => {
  it("maps a known multi-word phrase to its Greek lemma", () => {
    expect(detectPhraseLemmas("teaching on the second coming")).toEqual(["παρουσία"]);
  });

  it("matches case-insensitively and tolerates extra whitespace", () => {
    expect(detectPhraseLemmas("The Second   Coming of Christ")).toEqual(["παρουσία"]);
  });

  it("does not match a phrase embedded in a larger word", () => {
    expect(detectPhraseLemmas("secondhand comings")).toEqual([]);
  });

  it("returns nothing when no phrase is present", () => {
    expect(detectPhraseLemmas("what does grace mean")).toEqual([]);
  });
});

describe("detectDomainQuery", () => {
  it("detects an anchored domain number", () => {
    expect(detectDomainQuery("show me everything in domain 33 in John")).toEqual({ kind: "domain", code: "033" });
    expect(detectDomainQuery("Louw-Nida 1 words")).toEqual({ kind: "domain", code: "001" });
    expect(detectDomainQuery("LN 93 terms")).toEqual({ kind: "domain", code: "093" });
  });
  it("detects an anchored LN reference (ln wins over domain)", () => {
    expect(detectDomainQuery("uses of LN 33.55")).toEqual({ kind: "ln", ref: "33.55" });
    expect(detectDomainQuery("Louw-Nida 93.169a in Matthew")).toEqual({ kind: "ln", ref: "93.169a" });
  });
  it("does NOT fire on bare numbers, chapter.verse refs, or topical domain words", () => {
    expect(detectDomainQuery("what does John 3.16 mean")).toBeUndefined();
    expect(detectDomainQuery("Paul's view on communication in the church")).toBeUndefined();
    expect(detectDomainQuery("33.55")).toBeUndefined();
    expect(detectDomainQuery("domain 200 is out of range")).toBeUndefined();
  });
  it("does NOT fire on an out-of-range LN ref (domain part > 93)", () => {
    // The LN branch validates 1..93 like the domain-number branch, so an
    // out-of-range marker falls back to normal retrieval instead of an empty LN search.
    expect(detectDomainQuery("LN 99.1")).toBeUndefined();
    expect(detectDomainQuery("Louw-Nida 94.2 in Matthew")).toBeUndefined();
  });
});

describe("extractSignals domainQuery", () => {
  it("attaches domainQuery and keeps it out of topic words", () => {
    const signals = extractSignals("show me domain 33 in John");
    expect(signals.domainQuery).toEqual({ kind: "domain", code: "033" });
    expect(signals.topicWords).not.toContain("domain");
  });

  it("attaches an LN-ref domainQuery", () => {
    const signals = extractSignals("uses of LN 33.55 in John");
    expect(signals.domainQuery).toEqual({ kind: "ln", ref: "33.55" });
  });

  it("leaves an out-of-range domain marker out of domainQuery and intact for topic extraction", () => {
    const signals = extractSignals("what does domain 200 of the law mean");
    expect(signals.domainQuery).toBeUndefined();
    expect(signals.topicWords).toContain("law");
  });

  it("leaves an out-of-range LN marker out of domainQuery and intact for topic extraction", () => {
    const signals = extractSignals("what does LN 99.1 of love mean");
    expect(signals.domainQuery).toBeUndefined();
    expect(signals.topicWords).toContain("love");
  });
});

describe("detectIntent", () => {
  it("classifies a meaning question as word-study", () => {
    expect(detectIntent("What does νόμος mean?")).toBe("word-study");
  });

  it("keeps a passage-meaning question as passage-study, not word-study", () => {
    // The generic "what does X mean" form must not hijack passage interpretation
    // into the lexical answer path when X is a passage reference.
    expect(detectIntent("What does John 3:16 mean?")).toBe("passage-study");
    expect(detectIntent("What does Romans 8 mean?")).toBe("passage-study");
  });

  it("still classifies a lemma meaning question as word-study even with a reference", () => {
    expect(detectIntent("What does νόμος mean in Romans 7?")).toBe("word-study");
  });

  it("classifies an explicit recite/show request as passage-recite", () => {
    expect(detectIntent("Show me Romans 7")).toBe("passage-recite");
    expect(detectIntent("What does John 3:16 say?")).toBe("passage-recite");
    expect(detectIntent("What is written in Matthew 6:9?")).toBe("passage-recite");
  });

  it("keeps explanatory passage questions as passage-study (no forced quote)", () => {
    expect(detectIntent("Explain Romans 8 in plain language")).toBe("passage-study");
    expect(detectIntent("What are the different senses in which Paul uses the word 'law' in Romans 7?")).toBe(
      "passage-study"
    );
    expect(detectIntent("What does Romans 8 say about suffering?")).toBe("passage-study");
  });

  it("classifies a verses-about request as topic-survey", () => {
    expect(detectIntent("Find verses about love")).toBe("topic-survey");
  });

  it("classifies a grammar request as morphology", () => {
    expect(detectIntent("imperatives in 1 Peter")).toBe("morphology");
  });

  it("classifies a difference request as comparison", () => {
    expect(detectIntent("difference between νόμος and χάρις")).toBe("comparison");
  });

  it("falls back to general", () => {
    expect(detectIntent("Tell me about God")).toBe("general");
  });
});

describe("detectConceptWords (routing-stable, decoupled from search stoplist)", () => {
  it("counts concepts from the frozen base, ignoring a search-only stoplist edit", () => {
    // detectTopicWords honors a caller-supplied search stoplist (the search path) ...
    expect(detectTopicWords("grace mercy peace", new Set(["grace"]))).not.toContain("grace");
    // ...but the routing concept words use the frozen base only, so the same word still counts.
    expect(detectConceptWords("grace mercy peace")).toContain("grace");
  });

  it("still excludes generic framing words so they don't inflate routing", () => {
    // "within"/"context" live in the base list, so this stays a single-concept prompt.
    expect(detectConceptWords("Explain Romans 8:28 within the broader context of Romans 8")).toEqual(["broader"]);
  });
});

describe("extractSignals", () => {
  it("composes all detectors for a word study with a reference", () => {
    const signals = extractSignals("What does νόμος mean in Romans 7?");
    expect(signals).toEqual({
      references: [{ book: "Rom", chapter: 7 }],
      greekWords: ["νόμος"],
      topicWords: [],
      morphCodes: [],
      intent: "word-study",
      book: "Rom",
      phraseTerms: []
    });
  });

  it("routes a phrase to a Greek lemma, exposes the English phrase term, and drops its component words from topicWords", () => {
    const signals = extractSignals("what does the bible teach about the second coming");
    expect(signals.greekWords).toContain("παρουσία"); // Greek lemma → deterministic searchLemma
    expect(signals.phraseTerms).toContain("second coming"); // English term → FTS keywords + gate
    expect(signals.topicWords).not.toContain("second");
    expect(signals.topicWords).not.toContain("coming");
  });

  it("resolves bare numbered-book prompts using the longest matching alias", () => {
    const signals = extractSignals("love in 1 John");
    expect(signals.book).toBe("1John");
    expect(signals.topicWords).toEqual(["love"]);
  });

  it("removes parsed references and book labels before topic-word extraction", () => {
    const signals = extractSignals("love in 1 Corinthians 13");
    expect(signals.references).toEqual([{ book: "1Cor", chapter: 13 }]);
    expect(signals.topicWords).toEqual(["love"]);
  });

  it("keeps entity-only topical prompts retrievable", () => {
    const signals = extractSignals("verses about Jesus");
    expect(signals.topicWords).toEqual(["jesus"]);
    expect(signals.greekWords).toEqual([]);
  });

  it("removes explicit morphology codes before topic-word extraction", () => {
    const signals = extractSignals("find V-PAI-3S forms in 1 Peter");
    expect(signals.morphCodes).toEqual([{ code: "V-PAI-3S", mode: "exact" }]);
    // The morph code is stripped before extraction, and "forms" is a stop word (it
    // collides with grammar/morphology prompts), so no topic word leaks out — a
    // morphology request does not spawn a stray keyword/semantic search.
    expect(signals.topicWords).toEqual([]);
  });

  it("preserves quoted English phrases as phrase terms for FTS", () => {
    const signals = extractSignals('verses about "new creation"');
    expect(signals.phraseTerms).toContain('"new creation"');
    expect(signals.topicWords).toEqual([]);
  });
});
