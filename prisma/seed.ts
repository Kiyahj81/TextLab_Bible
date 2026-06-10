import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type VerseSeed = {
  book: "John" | "Rom";
  chapter: number;
  verse: number;
  sblgnt: string;
  web: string;
};

type TokenSeed = {
  book: "John" | "Rom";
  chapter: number;
  verse: number;
  wordIndex: number;
  surface: string;
  normalized?: string;
  lemma?: string;
  morphCode?: string;
  partOfSpeech?: string;
  gloss?: string;
};

const verses: VerseSeed[] = [
  {
    book: "John",
    chapter: 1,
    verse: 1,
    sblgnt: "Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν, καὶ θεὸς ἦν ὁ λόγος.",
    web: "In the beginning was the Word, and the Word was with God, and the Word was God."
  },
  {
    book: "John",
    chapter: 1,
    verse: 2,
    sblgnt: "οὗτος ἦν ἐν ἀρχῇ πρὸς τὸν θεόν.",
    web: "The same was in the beginning with God."
  },
  {
    book: "John",
    chapter: 1,
    verse: 3,
    sblgnt: "πάντα διʼ αὐτοῦ ἐγένετο, καὶ χωρὶς αὐτοῦ ἐγένετο οὐδὲ ἕν. ὃ γέγονεν",
    web: "All things were made through him. Without him, nothing was made that has been made."
  },
  {
    book: "John",
    chapter: 1,
    verse: 4,
    sblgnt: "ἐν αὐτῷ ζωὴ ἦν, καὶ ἡ ζωὴ ἦν τὸ φῶς τῶν ἀνθρώπων·",
    web: "In him was life, and the life was the light of men."
  },
  {
    book: "John",
    chapter: 1,
    verse: 5,
    sblgnt: "καὶ τὸ φῶς ἐν τῇ σκοτίᾳ φαίνει, καὶ ἡ σκοτία αὐτὸ οὐ κατέλαβεν.",
    web: "The light shines in the darkness, and the darkness hasn't overcome it."
  },
  {
    book: "Rom",
    chapter: 3,
    verse: 21,
    sblgnt: "Νυνὶ δὲ χωρὶς νόμου δικαιοσύνη θεοῦ πεφανέρωται μαρτυρουμένη ὑπὸ τοῦ νόμου καὶ τῶν προφητῶν,",
    web: "But now apart from the law, a righteousness of God has been revealed, being testified by the law and the prophets;"
  },
  {
    book: "Rom",
    chapter: 3,
    verse: 22,
    sblgnt: "δικαιοσύνη δὲ θεοῦ διὰ πίστεως Ἰησοῦ Χριστοῦ εἰς πάντας τοὺς πιστεύοντας.",
    web: "even the righteousness of God through faith in Jesus Christ to all and on all those who believe."
  },
  {
    book: "Rom",
    chapter: 3,
    verse: 23,
    sblgnt: "πάντες γὰρ ἥμαρτον καὶ ὑστεροῦνται τῆς δόξης τοῦ θεοῦ",
    web: "For there is no distinction, for all have sinned, and fall short of the glory of God;"
  },
  {
    book: "Rom",
    chapter: 3,
    verse: 24,
    sblgnt: "δικαιούμενοι δωρεὰν τῇ αὐτοῦ χάριτι διὰ τῆς ἀπολυτρώσεως τῆς ἐν Χριστῷ Ἰησοῦ·",
    web: "being justified freely by his grace through the redemption that is in Christ Jesus,"
  },
  {
    book: "Rom",
    chapter: 3,
    verse: 25,
    sblgnt: "ὃν προέθετο ὁ θεὸς ἱλαστήριον διὰ πίστεως ἐν τῷ αὐτοῦ αἵματι.",
    web: "whom God sent to be an atoning sacrifice through faith in his blood, for a demonstration of his righteousness through the passing over of prior sins, in God's forbearance;"
  },
  {
    book: "Rom",
    chapter: 3,
    verse: 26,
    sblgnt: "πρὸς τὴν ἔνδειξιν τῆς δικαιοσύνης αὐτοῦ ἐν τῷ νῦν καιρῷ.",
    web: "to demonstrate his righteousness at this present time, that he might himself be just and the justifier of him who has faith in Jesus."
  },
  {
    book: "Rom",
    chapter: 4,
    verse: 1,
    sblgnt: "Τί οὖν ἐροῦμεν εὑρηκέναι Ἀβραὰμ τὸν προπάτορα ἡμῶν κατὰ σάρκα;",
    web: "What then will we say that Abraham, our forefather, has found according to the flesh?"
  },
  {
    book: "Rom",
    chapter: 4,
    verse: 2,
    sblgnt: "εἰ γὰρ Ἀβραὰμ ἐξ ἔργων ἐδικαιώθη, ἔχει καύχημα, ἀλλʼ οὐ πρὸς θεόν.",
    web: "For if Abraham was justified by works, he has something to boast about, but not toward God."
  },
  {
    book: "Rom",
    chapter: 4,
    verse: 3,
    sblgnt: "τί γὰρ ἡ γραφὴ λέγει; Ἐπίστευσεν δὲ Ἀβραὰμ τῷ θεῷ, καὶ ἐλογίσθη αὐτῷ εἰς δικαιοσύνην.",
    web: "For what does the Scripture say? \"Abraham believed God, and it was accounted to him for righteousness.\""
  },
  {
    book: "Rom",
    chapter: 4,
    verse: 4,
    sblgnt: "τῷ δὲ ἐργαζομένῳ ὁ μισθὸς οὐ λογίζεται κατὰ χάριν ἀλλὰ κατὰ ὀφείλημα·",
    web: "Now to him who works, the reward is not counted as grace, but as something owed."
  },
  {
    book: "Rom",
    chapter: 4,
    verse: 5,
    sblgnt: "τῷ δὲ μὴ ἐργαζομένῳ πιστεύοντι δὲ ἐπὶ τὸν δικαιοῦντα τὸν ἀσεβῆ λογίζεται ἡ πίστις αὐτοῦ εἰς δικαιοσύνην,",
    web: "But to him who doesn't work, but believes in him who justifies the ungodly, his faith is accounted for righteousness."
  },
  {
    book: "Rom",
    chapter: 4,
    verse: 6,
    sblgnt: "καθάπερ καὶ Δαυὶδ λέγει τὸν μακαρισμὸν τοῦ ἀνθρώπου ᾧ ὁ θεὸς λογίζεται δικαιοσύνην χωρὶς ἔργων·",
    web: "Even as David also pronounces blessing on the man to whom God counts righteousness apart from works:"
  },
  {
    book: "Rom",
    chapter: 4,
    verse: 7,
    sblgnt: "Μακάριοι ὧν ἀφέθησαν αἱ ἀνομίαι καὶ ὧν ἐπεκαλύφθησαν αἱ ἁμαρτίαι·",
    web: "\"Blessed are they whose iniquities are forgiven, whose sins are covered."
  },
  {
    book: "Rom",
    chapter: 4,
    verse: 8,
    sblgnt: "μακάριος ἀνὴρ οὗ οὐ μὴ λογίσηται κύριος ἁμαρτίαν.",
    web: "Blessed is the man whom the Lord will by no means charge with sin.\""
  },
  {
    book: "Rom",
    chapter: 12,
    verse: 1,
    sblgnt: "Παρακαλῶ οὖν ὑμᾶς, ἀδελφοί, διὰ τῶν οἰκτιρμῶν τοῦ θεοῦ παραστῆσαι τὰ σώματα ὑμῶν θυσίαν ζῶσαν.",
    web: "Therefore I urge you, brothers, by the mercies of God, to present your bodies a living sacrifice, holy, acceptable to God, which is your spiritual service."
  },
  {
    book: "Rom",
    chapter: 12,
    verse: 2,
    sblgnt: "καὶ μὴ συσχηματίζεσθε τῷ αἰῶνι τούτῳ, ἀλλὰ μεταμορφοῦσθε τῇ ἀνακαινώσει τοῦ νοός.",
    web: "Don't be conformed to this world, but be transformed by the renewing of your mind, so that you may prove what is the good, well-pleasing, and perfect will of God."
  },
  {
    book: "Rom",
    chapter: 12,
    verse: 3,
    sblgnt: "Λέγω γὰρ διὰ τῆς χάριτος τῆς δοθείσης μοι παντὶ τῷ ὄντι ἐν ὑμῖν μὴ ὑπερφρονεῖν.",
    web: "For I say through the grace that was given me, to everyone who is among you, not to think of yourself more highly than you ought to think; but to think reasonably, as God has apportioned to each person a measure of faith."
  },
  {
    book: "Rom",
    chapter: 12,
    verse: 4,
    sblgnt: "καθάπερ γὰρ ἐν ἑνὶ σώματι πολλὰ μέλη ἔχομεν, τὰ δὲ μέλη πάντα οὐ τὴν αὐτὴν ἔχει πρᾶξιν,",
    web: "For even as we have many members in one body, and all the members don't have the same function,"
  },
  {
    book: "Rom",
    chapter: 12,
    verse: 5,
    sblgnt: "οὕτως οἱ πολλοὶ ἓν σῶμά ἐσμεν ἐν Χριστῷ, τὸ δὲ καθʼ εἷς ἀλλήλων μέλη.",
    web: "so we, who are many, are one body in Christ, and individually members of one another,"
  },
  {
    book: "Rom",
    chapter: 12,
    verse: 6,
    sblgnt: "ἔχοντες δὲ χαρίσματα κατὰ τὴν χάριν τὴν δοθεῖσαν ἡμῖν διάφορα.",
    web: "having gifts differing according to the grace that was given to us: if prophecy, let's prophesy according to the proportion of our faith;"
  },
  {
    book: "Rom",
    chapter: 12,
    verse: 7,
    sblgnt: "εἴτε διακονίαν ἐν τῇ διακονίᾳ, εἴτε ὁ διδάσκων ἐν τῇ διδασκαλίᾳ,",
    web: "or service, let's give ourselves to service; or he who teaches, to his teaching;"
  },
  {
    book: "Rom",
    chapter: 12,
    verse: 8,
    sblgnt: "εἴτε ὁ παρακαλῶν ἐν τῇ παρακλήσει, ὁ μεταδιδοὺς ἐν ἁπλότητι.",
    web: "or he who exhorts, to his exhorting; he who gives, let him do it with generosity; he who rules, with diligence; he who shows mercy, with cheerfulness."
  }
];

const johnTokens: TokenSeed[] = [
  { book: "John", chapter: 1, verse: 1, wordIndex: 1, surface: "Ἐν", normalized: "ἐν", lemma: "ἐν", morphCode: "P", partOfSpeech: "Preposition", gloss: "in" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 2, surface: "ἀρχῇ", normalized: "ἀρχῇ", lemma: "ἀρχή", morphCode: "N-DSF", partOfSpeech: "Noun", gloss: "beginning" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 3, surface: "ἦν", normalized: "ἦν", lemma: "εἰμί", morphCode: "V-3IAI-S", partOfSpeech: "Verb", gloss: "was" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 4, surface: "ὁ", normalized: "ὁ", lemma: "ὁ", morphCode: "RANSM", partOfSpeech: "Article", gloss: "the" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 5, surface: "λόγος", normalized: "λόγος", lemma: "λόγος", morphCode: "N-NSM", partOfSpeech: "Noun", gloss: "word" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 6, surface: "καὶ", normalized: "καί", lemma: "καί", morphCode: "C", partOfSpeech: "Conjunction", gloss: "and" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 7, surface: "ὁ", normalized: "ὁ", lemma: "ὁ", morphCode: "RANSM", partOfSpeech: "Article", gloss: "the" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 8, surface: "λόγος", normalized: "λόγος", lemma: "λόγος", morphCode: "N-NSM", partOfSpeech: "Noun", gloss: "word" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 9, surface: "ἦν", normalized: "ἦν", lemma: "εἰμί", morphCode: "V-3IAI-S", partOfSpeech: "Verb", gloss: "was" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 10, surface: "πρὸς", normalized: "πρός", lemma: "πρός", morphCode: "P", partOfSpeech: "Preposition", gloss: "with" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 11, surface: "τὸν", normalized: "τόν", lemma: "ὁ", morphCode: "RAASM", partOfSpeech: "Article", gloss: "the" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 12, surface: "θεόν", normalized: "θεόν", lemma: "θεός", morphCode: "N-ASM", partOfSpeech: "Noun", gloss: "God" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 13, surface: "καὶ", normalized: "καί", lemma: "καί", morphCode: "C", partOfSpeech: "Conjunction", gloss: "and" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 14, surface: "θεὸς", normalized: "θεός", lemma: "θεός", morphCode: "N-NSM", partOfSpeech: "Noun", gloss: "God" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 15, surface: "ἦν", normalized: "ἦν", lemma: "εἰμί", morphCode: "V-3IAI-S", partOfSpeech: "Verb", gloss: "was" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 16, surface: "ὁ", normalized: "ὁ", lemma: "ὁ", morphCode: "RANSM", partOfSpeech: "Article", gloss: "the" },
  { book: "John", chapter: 1, verse: 1, wordIndex: 17, surface: "λόγος", normalized: "λόγος", lemma: "λόγος", morphCode: "N-NSM", partOfSpeech: "Noun", gloss: "word" },
  { book: "John", chapter: 1, verse: 2, wordIndex: 1, surface: "οὗτος", normalized: "οὗτος", lemma: "οὗτος", morphCode: "RDNSM", partOfSpeech: "Demonstrative Pronoun", gloss: "this one" },
  { book: "John", chapter: 1, verse: 2, wordIndex: 2, surface: "ἦν", normalized: "ἦν", lemma: "εἰμί", morphCode: "V-3IAI-S", partOfSpeech: "Verb", gloss: "was" },
  { book: "John", chapter: 1, verse: 2, wordIndex: 3, surface: "ἐν", normalized: "ἐν", lemma: "ἐν", morphCode: "P", partOfSpeech: "Preposition", gloss: "in" },
  { book: "John", chapter: 1, verse: 2, wordIndex: 4, surface: "ἀρχῇ", normalized: "ἀρχῇ", lemma: "ἀρχή", morphCode: "N-DSF", partOfSpeech: "Noun", gloss: "beginning" },
  { book: "John", chapter: 1, verse: 2, wordIndex: 5, surface: "πρὸς", normalized: "πρός", lemma: "πρός", morphCode: "P", partOfSpeech: "Preposition", gloss: "with" },
  { book: "John", chapter: 1, verse: 2, wordIndex: 6, surface: "τὸν", normalized: "τόν", lemma: "ὁ", morphCode: "RAASM", partOfSpeech: "Article", gloss: "the" },
  { book: "John", chapter: 1, verse: 2, wordIndex: 7, surface: "θεόν", normalized: "θεόν", lemma: "θεός", morphCode: "N-ASM", partOfSpeech: "Noun", gloss: "God" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 1, surface: "πάντα", normalized: "πάντα", lemma: "πᾶς", morphCode: "A-NPN", partOfSpeech: "Adjective", gloss: "all things" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 2, surface: "διʼ", normalized: "διά", lemma: "διά", morphCode: "P", partOfSpeech: "Preposition", gloss: "through" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 3, surface: "αὐτοῦ", normalized: "αὐτοῦ", lemma: "αὐτός", morphCode: "RPGSM", partOfSpeech: "Pronoun", gloss: "him" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 4, surface: "ἐγένετο", normalized: "ἐγένετο", lemma: "γίνομαι", morphCode: "V-3AMI-S", partOfSpeech: "Verb", gloss: "came into being" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 5, surface: "καὶ", normalized: "καί", lemma: "καί", morphCode: "C", partOfSpeech: "Conjunction", gloss: "and" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 6, surface: "χωρὶς", normalized: "χωρίς", lemma: "χωρίς", morphCode: "P", partOfSpeech: "Preposition", gloss: "apart from" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 7, surface: "αὐτοῦ", normalized: "αὐτοῦ", lemma: "αὐτός", morphCode: "RPGSM", partOfSpeech: "Pronoun", gloss: "him" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 8, surface: "ἐγένετο", normalized: "ἐγένετο", lemma: "γίνομαι", morphCode: "V-3AMI-S", partOfSpeech: "Verb", gloss: "came into being" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 9, surface: "οὐδὲ", normalized: "οὐδέ", lemma: "οὐδέ", morphCode: "C", partOfSpeech: "Conjunction", gloss: "not even" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 10, surface: "ἕν", normalized: "εἷς", lemma: "εἷς", morphCode: "A-NSN", partOfSpeech: "Adjective", gloss: "one" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 11, surface: "ὃ", normalized: "ὅ", lemma: "ὅς", morphCode: "RRNSN", partOfSpeech: "Relative Pronoun", gloss: "what" },
  { book: "John", chapter: 1, verse: 3, wordIndex: 12, surface: "γέγονεν", normalized: "γέγονεν", lemma: "γίνομαι", morphCode: "V-3XAI-S", partOfSpeech: "Verb", gloss: "has come into being" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 1, surface: "ἐν", normalized: "ἐν", lemma: "ἐν", morphCode: "P", partOfSpeech: "Preposition", gloss: "in" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 2, surface: "αὐτῷ", normalized: "αὐτῷ", lemma: "αὐτός", morphCode: "RPDSM", partOfSpeech: "Pronoun", gloss: "him" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 3, surface: "ζωὴ", normalized: "ζωή", lemma: "ζωή", morphCode: "N-NSF", partOfSpeech: "Noun", gloss: "life" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 4, surface: "ἦν", normalized: "ἦν", lemma: "εἰμί", morphCode: "V-3IAI-S", partOfSpeech: "Verb", gloss: "was" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 5, surface: "καὶ", normalized: "καί", lemma: "καί", morphCode: "C", partOfSpeech: "Conjunction", gloss: "and" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 6, surface: "ἡ", normalized: "ἡ", lemma: "ὁ", morphCode: "RANSF", partOfSpeech: "Article", gloss: "the" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 7, surface: "ζωὴ", normalized: "ζωή", lemma: "ζωή", morphCode: "N-NSF", partOfSpeech: "Noun", gloss: "life" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 8, surface: "ἦν", normalized: "ἦν", lemma: "εἰμί", morphCode: "V-3IAI-S", partOfSpeech: "Verb", gloss: "was" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 9, surface: "τὸ", normalized: "τό", lemma: "ὁ", morphCode: "RANSN", partOfSpeech: "Article", gloss: "the" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 10, surface: "φῶς", normalized: "φῶς", lemma: "φῶς", morphCode: "N-NSN", partOfSpeech: "Noun", gloss: "light" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 11, surface: "τῶν", normalized: "τῶν", lemma: "ὁ", morphCode: "RAGPM", partOfSpeech: "Article", gloss: "of the" },
  { book: "John", chapter: 1, verse: 4, wordIndex: 12, surface: "ἀνθρώπων", normalized: "ἀνθρώπων", lemma: "ἄνθρωπος", morphCode: "N-GPM", partOfSpeech: "Noun", gloss: "people" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 1, surface: "καὶ", normalized: "καί", lemma: "καί", morphCode: "C", partOfSpeech: "Conjunction", gloss: "and" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 2, surface: "τὸ", normalized: "τό", lemma: "ὁ", morphCode: "RANSN", partOfSpeech: "Article", gloss: "the" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 3, surface: "φῶς", normalized: "φῶς", lemma: "φῶς", morphCode: "N-NSN", partOfSpeech: "Noun", gloss: "light" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 4, surface: "ἐν", normalized: "ἐν", lemma: "ἐν", morphCode: "P", partOfSpeech: "Preposition", gloss: "in" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 5, surface: "τῇ", normalized: "τῇ", lemma: "ὁ", morphCode: "RADSF", partOfSpeech: "Article", gloss: "the" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 6, surface: "σκοτίᾳ", normalized: "σκοτίᾳ", lemma: "σκοτία", morphCode: "N-DSF", partOfSpeech: "Noun", gloss: "darkness" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 7, surface: "φαίνει", normalized: "φαίνει", lemma: "φαίνω", morphCode: "V-3PAI-S", partOfSpeech: "Verb", gloss: "shines" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 8, surface: "καὶ", normalized: "καί", lemma: "καί", morphCode: "C", partOfSpeech: "Conjunction", gloss: "and" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 9, surface: "ἡ", normalized: "ἡ", lemma: "ὁ", morphCode: "RANSF", partOfSpeech: "Article", gloss: "the" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 10, surface: "σκοτία", normalized: "σκοτία", lemma: "σκοτία", morphCode: "N-NSF", partOfSpeech: "Noun", gloss: "darkness" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 11, surface: "αὐτὸ", normalized: "αὐτό", lemma: "αὐτός", morphCode: "RPASN", partOfSpeech: "Pronoun", gloss: "it" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 12, surface: "οὐ", normalized: "οὐ", lemma: "οὐ", morphCode: "D", partOfSpeech: "Adverb", gloss: "not" },
  { book: "John", chapter: 1, verse: 5, wordIndex: 13, surface: "κατέλαβεν", normalized: "κατέλαβεν", lemma: "καταλαμβάνω", morphCode: "V-3AAI-S", partOfSpeech: "Verb", gloss: "overcame" }
];

const romansTokens: TokenSeed[] = [
  { book: "Rom", chapter: 3, verse: 21, wordIndex: 4, surface: "δικαιοσύνη", normalized: "δικαιοσύνη", lemma: "δικαιοσύνη", morphCode: "N-NSF", partOfSpeech: "Noun", gloss: "righteousness" },
  { book: "Rom", chapter: 3, verse: 21, wordIndex: 5, surface: "θεοῦ", normalized: "θεοῦ", lemma: "θεός", morphCode: "N-GSM", partOfSpeech: "Noun", gloss: "of God" },
  { book: "Rom", chapter: 3, verse: 22, wordIndex: 1, surface: "δικαιοσύνη", normalized: "δικαιοσύνη", lemma: "δικαιοσύνη", morphCode: "N-NSF", partOfSpeech: "Noun", gloss: "righteousness" },
  { book: "Rom", chapter: 3, verse: 22, wordIndex: 5, surface: "πίστεως", normalized: "πίστεως", lemma: "πίστις", morphCode: "N-GSF", partOfSpeech: "Noun", gloss: "faith" },
  { book: "Rom", chapter: 3, verse: 22, wordIndex: 9, surface: "πιστεύοντας", normalized: "πιστεύοντας", lemma: "πιστεύω", morphCode: "V-PAPAPM", partOfSpeech: "Verb", gloss: "believing" },
  { book: "Rom", chapter: 3, verse: 24, wordIndex: 1, surface: "δικαιούμενοι", normalized: "δικαιούμενοι", lemma: "δικαιόω", morphCode: "V-PPPNPM", partOfSpeech: "Verb", gloss: "being justified" },
  { book: "Rom", chapter: 3, verse: 25, wordIndex: 5, surface: "πίστεως", normalized: "πίστεως", lemma: "πίστις", morphCode: "N-GSF", partOfSpeech: "Noun", gloss: "faith" },
  { book: "Rom", chapter: 3, verse: 26, wordIndex: 4, surface: "δικαιοσύνης", normalized: "δικαιοσύνης", lemma: "δικαιοσύνη", morphCode: "N-GSF", partOfSpeech: "Noun", gloss: "righteousness" },
  { book: "Rom", chapter: 4, verse: 2, wordIndex: 6, surface: "ἐδικαιώθη", normalized: "ἐδικαιώθη", lemma: "δικαιόω", morphCode: "V-3API-S", partOfSpeech: "Verb", gloss: "was justified" },
  { book: "Rom", chapter: 4, verse: 3, wordIndex: 5, surface: "Ἐπίστευσεν", normalized: "ἐπίστευσεν", lemma: "πιστεύω", morphCode: "V-3AAI-S", partOfSpeech: "Verb", gloss: "believed" },
  { book: "Rom", chapter: 4, verse: 3, wordIndex: 10, surface: "ἐλογίσθη", normalized: "ἐλογίσθη", lemma: "λογίζομαι", morphCode: "V-3API-S", partOfSpeech: "Verb", gloss: "was credited" },
  { book: "Rom", chapter: 4, verse: 3, wordIndex: 13, surface: "δικαιοσύνην", normalized: "δικαιοσύνην", lemma: "δικαιοσύνη", morphCode: "N-ASF", partOfSpeech: "Noun", gloss: "righteousness" },
  { book: "Rom", chapter: 4, verse: 4, wordIndex: 6, surface: "λογίζεται", normalized: "λογίζεται", lemma: "λογίζομαι", morphCode: "V-3PPI-S", partOfSpeech: "Verb", gloss: "is credited" },
  { book: "Rom", chapter: 4, verse: 5, wordIndex: 4, surface: "πιστεύοντι", normalized: "πιστεύοντι", lemma: "πιστεύω", morphCode: "V-PAPDSM", partOfSpeech: "Verb", gloss: "believing" },
  { book: "Rom", chapter: 4, verse: 5, wordIndex: 8, surface: "δικαιοῦντα", normalized: "δικαιοῦντα", lemma: "δικαιόω", morphCode: "V-PAPASM", partOfSpeech: "Verb", gloss: "justifying" },
  { book: "Rom", chapter: 4, verse: 5, wordIndex: 11, surface: "λογίζεται", normalized: "λογίζεται", lemma: "λογίζομαι", morphCode: "V-3PPI-S", partOfSpeech: "Verb", gloss: "is credited" },
  { book: "Rom", chapter: 4, verse: 5, wordIndex: 16, surface: "δικαιοσύνην", normalized: "δικαιοσύνην", lemma: "δικαιοσύνη", morphCode: "N-ASF", partOfSpeech: "Noun", gloss: "righteousness" },
  { book: "Rom", chapter: 4, verse: 6, wordIndex: 10, surface: "λογίζεται", normalized: "λογίζεται", lemma: "λογίζομαι", morphCode: "V-3PPI-S", partOfSpeech: "Verb", gloss: "credits" },
  { book: "Rom", chapter: 4, verse: 6, wordIndex: 11, surface: "δικαιοσύνην", normalized: "δικαιοσύνην", lemma: "δικαιοσύνη", morphCode: "N-ASF", partOfSpeech: "Noun", gloss: "righteousness" },
  { book: "Rom", chapter: 4, verse: 8, wordIndex: 6, surface: "λογίσηται", normalized: "λογίσηται", lemma: "λογίζομαι", morphCode: "V-3AMS-S", partOfSpeech: "Verb", gloss: "may count" },
  { book: "Rom", chapter: 12, verse: 1, wordIndex: 1, surface: "Παρακαλῶ", normalized: "παρακαλῶ", lemma: "παρακαλέω", morphCode: "V-1PAI-S", partOfSpeech: "Verb", gloss: "I exhort" },
  { book: "Rom", chapter: 12, verse: 1, wordIndex: 10, surface: "παραστῆσαι", normalized: "παραστῆσαι", lemma: "παρίστημι", morphCode: "V-AAN", partOfSpeech: "Verb", gloss: "to present" },
  { book: "Rom", chapter: 12, verse: 2, wordIndex: 3, surface: "συσχηματίζεσθε", normalized: "συσχηματίζεσθε", lemma: "συσχηματίζω", morphCode: "V-2PMD-P", partOfSpeech: "Verb", gloss: "be conformed" },
  { book: "Rom", chapter: 12, verse: 2, wordIndex: 7, surface: "μεταμορφοῦσθε", normalized: "μεταμορφοῦσθε", lemma: "μεταμορφόω", morphCode: "V-2PPD-P", partOfSpeech: "Verb", gloss: "be transformed" },
  { book: "Rom", chapter: 12, verse: 3, wordIndex: 12, surface: "ὑπερφρονεῖν", normalized: "ὑπερφρονεῖν", lemma: "ὑπερφρονέω", morphCode: "V-PAN", partOfSpeech: "Verb", gloss: "to think too highly" },
  { book: "Rom", chapter: 12, verse: 7, wordIndex: 6, surface: "διδάσκων", normalized: "διδάσκων", lemma: "διδάσκω", morphCode: "V-PAPNSM", partOfSpeech: "Verb", gloss: "teaching" },
  { book: "Rom", chapter: 12, verse: 8, wordIndex: 3, surface: "παρακαλῶν", normalized: "παρακαλῶν", lemma: "παρακαλέω", morphCode: "V-PAPNSM", partOfSpeech: "Verb", gloss: "exhorting" }
];

async function main() {
  const sblgnt = await prisma.corpus.upsert({
    where: { abbreviation: "SBLGNT" },
    update: {},
    create: {
      name: "SBL Greek New Testament",
      abbreviation: "SBLGNT",
      language: "Greek",
      license: "Sample data for local MVP",
      sourceUrl: "https://sblgnt.com/"
    }
  });

  const web = await prisma.corpus.upsert({
    where: { abbreviation: "WEB" },
    update: {},
    create: {
      name: "World English Bible",
      abbreviation: "WEB",
      language: "English",
      license: "Public domain",
      sourceUrl: "https://ebible.org/details.php?id=engwebp"
    }
  });

  const books = {
    John: await prisma.book.upsert({
      where: { osisId: "John" },
      update: {},
      create: { osisId: "John", name: "John", order: 43 }
    }),
    Rom: await prisma.book.upsert({
      where: { osisId: "Rom" },
      update: {},
      create: { osisId: "Rom", name: "Romans", order: 45 }
    })
  };

  for (const verse of verses) {
    const book = books[verse.book];
    await prisma.verse.upsert({
      where: {
        corpusId_bookId_chapter_verse: {
          corpusId: sblgnt.id,
          bookId: book.id,
          chapter: verse.chapter,
          verse: verse.verse
        }
      },
      update: { text: verse.sblgnt },
      create: {
        corpusId: sblgnt.id,
        bookId: book.id,
        chapter: verse.chapter,
        verse: verse.verse,
        text: verse.sblgnt
      }
    });

    await prisma.verse.upsert({
      where: {
        corpusId_bookId_chapter_verse: {
          corpusId: web.id,
          bookId: book.id,
          chapter: verse.chapter,
          verse: verse.verse
        }
      },
      update: { text: verse.web },
      create: {
        corpusId: web.id,
        bookId: book.id,
        chapter: verse.chapter,
        verse: verse.verse,
        text: verse.web
      }
    });
  }

  for (const token of [...johnTokens, ...romansTokens]) {
    const book = books[token.book];
    await prisma.token.upsert({
      where: {
        corpusId_bookId_chapter_verse_wordIndex: {
          corpusId: sblgnt.id,
          bookId: book.id,
          chapter: token.chapter,
          verse: token.verse,
          wordIndex: token.wordIndex
        }
      },
      update: {
        surface: token.surface,
        normalized: token.normalized,
        lemma: token.lemma,
        morphCode: token.morphCode,
        partOfSpeech: token.partOfSpeech,
        gloss: token.gloss
      },
      create: {
        corpusId: sblgnt.id,
        bookId: book.id,
        chapter: token.chapter,
        verse: token.verse,
        wordIndex: token.wordIndex,
        surface: token.surface,
        normalized: token.normalized,
        lemma: token.lemma,
        morphCode: token.morphCode,
        partOfSpeech: token.partOfSpeech,
        gloss: token.gloss
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
