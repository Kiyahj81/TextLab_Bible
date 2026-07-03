I asked Fable 5 to review the work we had been doing on PR 54 (now merged) and come up to speed because I needed it to help me improve the assistant functionality. I said the biggest issues are model routing/escalation and to a certain extent evidence retrieval. Fable 5 came up with the following: 
------
I've now got the full picture of routing and retrieval. Here's my assessment and suggested improvements.

  The structural problem with routing/escalation

  Two things jumped out reading modelRouter.ts, retrievalPlanner.ts, and the UI flow together:

  1. Escalation changes the writer, not the evidence. routeAssistantPrompt only swaps which model synthesizes -- the scholarly model receives the identical evidence packet and the same "use ONLY the retrieved evidence" rule. So for a deep question with thin retrieval, escalating buys you better prose about the same insufficient material (and a smarter model is arguably more tempted to reach past the evidence, which grounding then punishes). This is why your pain points 4 and 3 travel together: the ceiling on answer quality is usually the evidence packet, not the model. Any routing fix that doesn't also widen retrieval for complex questions will underwhelm.

  2. The complexity heuristic is a single-cue OR-gate, so it both over- and under-fires. Any one of: comparison intent, >=2 books, a cue-word regex, "why does...", >=3 concept words, or >30 words marks a question complex. Concretely:

  - Over-fires: "What does the fruit of the Spirit passage teach believers?" -- 4 concept words -- recommends scholarly, though it's a routine passage question. Any verbose-but-simple prompt over 30 words escalates on length alone. "Why did Paul write Romans?" escalates on the bare "why did".
  - Under-fires: "Is Romans 7 about Paul himself?" -- one book, "paul" filtered as proper noun, short prompt -- stays default, though it's one of the most contested interpretive questions in the NT.

  The five post-snapshot fix commits on this branch are all patches to individual cues -- that's the treadmill you're on.

  Suggested improvements, in the order I'd do them

  A. Score the cues instead of OR-ing them (small, deterministic, testable). Give each signal a weight (comparison +2, >=2 books +2, tension/harmonize cues +2, why-framing +1, concept density +1, length +1) and escalate at a threshold >=2. Solo weak cues (length, "why does", bare concept count) stop over-firing; combinations still escalate. This stays regex-based, so the eval gate and unit tests keep working, and it's tunable with one constant instead of whack-a-mole exclusions.

  B. Make escalation widen retrieval, not just swap models. When routing goes scholarly (manual or auto), pass a "deep" flag into runRetrievalPlan: raise SEMANTIC_HIT_LIMIT (5 --> ~10), allow a couple more planned calls, and enrich more passages. Right now MAX_PLANNED_CALLS = 8 and 5 semantic hits serve every question the same, whether it's "quote John 3:16" or "reconcile Paul and James on justification."

  C. Consider an LLM router instead of regexes (the structural fix). A single cheap classifier call (e.g. gpt-5-mini, ~200 tokens, temperature 0) returning {intent, complexity} would replace both detectIntent's regex ladder and the complexity heuristic, and would be robust to phrasing. Keep the regex path as the deterministic fallback when live mode is off, so the eval gate stays key-free. Costs ~100ms latency and a little nondeterminism -- but it ends the cue-patching treadmill. This is the biggest-lever option if A doesn't get you there.

  D. Revisit the default model itself. If the real complaint is "the default model's answers just aren't good enough," note DEFAULT_MODEL = "gpt-5-chat-latest" -- a chat-tuned model -- while scholarly is gpt-5.4. An option worth an eval:report A/B: make gpt-5.4 (or a mid-tier reasoning model) the default and reserve escalation for widened retrieval + longer output budget rather than model identity. That directly removes the "first answer is mediocre, click to re-ask" two-round-trip UX.

  For the retrieval misses (your "sometimes 3"):

  E. Dynamic English--lemma discovery via glosses. Topical retrieval currently lives or dies by the ~60-entry hand-curated ENGLISH_TO_GREEK_LEMMA map; anything unmapped falls back to WEB keyword FTS. You already have MACULA glosses per token -- a searchGloss(englishWord) step could discover candidate lemmas for any English content word (e.g. "neighbor" --> πλησίον) and then run the precise lemma search. That's the general fix for the love-neighbor-style thin-retrieval failures, without endless map curation.

  F. Give the refinement round real tools. The synthesis model can currently fetch only an adjacent passage (getPassage, one round). Letting it also call searchLemma/searchKeyword once would let it fill the exact gap it notices ("the question mentions the Good Samaritan but I have no Luke 10") instead of writing around it or importing unretrieved content. The grounding verifier still backstops everything, so the safety story is unchanged. (Your 2026-05-27 agentic-tool-calling spec is essentially this, deliberately shelved -- this would be a minimal, capped revival.)

  My recommendation: A + B are a quick, low-risk pair that directly target the misfires and the "scholarly didn't actually help" feeling; E is the highest-value retrieval fix; C/D are the deeper levers if the default model still disappoints after that.

  Two things would sharpen this a lot: a few real prompts where routing annoyed you (escalated when it shouldn't have, or vice versa), and whether the frustration is more "it escalates too eagerly/asks me to confirm too often" or "even the scholarly answers aren't worth it." Which direction do you want to take?


  My recommendation: merge PR 54 as-is, and do A+B+E as fresh follow-up work on top of main. Here's the reasoning:

  Why not add to PR 54:
  - It's already large (36 files, ~2,700 lines) and in a finished state: two external review passes addressed, npm run verify green, eval gate 20/20, acceptance synced, and -- most importantly -- a published before/after faithfulness measurement (0.64 --> 0.93) that describes exactly the code in the PR. Piling routing and retrieval changes on top invalidates the reviews and muddies what that snapshot measured.
  - A+B+E are behavior changes that deserve their own eval snapshot. The clean experiment is: Stage 1 merged = the new baseline; routing/retrieval work measured against it. If you mix them into PR 54, you can never tell which change bought what.
  - PR 54 is pure improvement over main already. Holding a merged-ready +0.30 faithfulness gain hostage to new work just delays shipping value and grows rebase risk.

  Why not wait to merge:
  There's no coupling that requires it. A+B touch modelRouter.ts/retrievalPlanner.ts, E touches signals/planner/search -- all files PR 54 already stabilized, so building on the merged result is strictly easier than stacking a branch on an unmerged branch.

  How I'd slice the follow-up:
  - PR (a): A+B -- scored escalation + deep-retrieval mode. These belong together: the score decides when to go deep, B defines what going deep means. Small, mostly unit-testable, quick to review.
  - PR (b): E -- gloss-based lemma discovery. Independent of routing, touches the search layer (new gloss lookup + planner integration), needs its own eval attention because it changes retrieval counts (and may touch the pinned acceptance assertions). Keeping it separate means a retrieval regression can't block the routing win, and each gets a clean before/after in eval:report.

  They're independent, so if you want speed we could even run them in parallel worktrees -- but sequential (A+B first, it's the smaller one and your primary pain) is the simpler default.

  So the concrete sequence: you merge PR 54 whenever you're ready (per your usual gate -- that's your call, not mine), then I'll start with A+B: brainstorm/spec the cue weights and the deep-retrieval knobs, write the plan, then implement. Want me to start drafting the A+B design now while you handle the merge?
------
  We were about to start working on A+B and E on new PRs (A+B together and then E). PR 54 merged and we were back on main.
  