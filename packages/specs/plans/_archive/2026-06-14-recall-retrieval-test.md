---
lifecycle: ephemeral
---

# v3.9.x — the recall-graph RETRIEVAL test (#78, a v3.10-retriever spike)

**Goal.** The bootcamp *populated* worked-example nodes but nothing has ever *consumed* one. Test the
recall graph's actual value: **does retrieving a prior worked example help the blind actor solve a SIMILAR
issue?** This is a SPIKE toward the unbuilt v3.10 retriever (OQ-7), not a production module — it lives under
`_spike/`, keeps `provenance=backtest`, and is bootcamp→bootcamp (OQ-7's firewall only guards backtest→LIVE).

## The pair (both real, both post-cutoff, same class — ideal)

| | SOURCE (in store) | TARGET (to solve) |
|---|---|---|
| issue | `numeric_range.__reversed__` raises on an empty range | `numeric_range[::-1]` (slice, negative step) returns an empty range |
| repo | more-itertools | more-itertools |
| fix commit | `edb3346` (2026-04-10) | `a51da82` (2026-02-20) |
| buggy base_sha | `247e15b3…` | `1c21c3ae9c7991b73044fe16807b70d1cac61e0b` |
| fail_to_pass | `tests/test_more.py::NumericRangeTests::test_empty_reversed` | `tests/test_more.py::NumericRangeTests::test_get_item_by_slice` (the negative-step case, test added by `ebb0f00`) |
| strategy | reason carefully about the empty/boundary semantics of `numeric_range` | (same family — different method) |

Same `numeric_range` class, same empty/boundary theme, *different* method (`__reversed__` vs `__getitem__`
slice) — so the source's accepted diff is NOT the target's answer (no answer-leakage), but its *strategy*
plausibly transfers. That asymmetry is exactly what makes it a fair retrieval test.

## The load-bearing FINDING (already surfaced, pre-build)

A worked-example node carries only `WORKED_EXAMPLE_FIELDS = {issue_id, repo, problem_statement_digest,
candidate_patch_ref, behavioral_verdict, reference_divergence, contamination_tier}`, and
`problem_statement_digest` is a **SHA-256 hash** (`calibration-issue.js:50`) — opaque, exact-match-only, NOT
a similarity surface. **The recall graph is a content-addressed STORE, not a retrievable INDEX.** A
similarity retriever therefore has only two honest surfaces in the stored node: `repo` (coarse, same-repo)
and the descriptive `issue_id` slug (`more-itertools__numeric-range-reversed-empty` → tokens
`numeric-range`, `reversed`, `empty`). Both the slug and the new issue's title are available at retrieval
time, so matching new-slug↔stored-slug is legitimate (not leakage). **This gap — nodes are not
similarity-retrievable by problem text — is a primary v3.10 input** (it argues for the auto-generated
topic→node breadth index flagged in the agent-memory RFC §6, or a semantic field added to the node basis).

## Design (minimal, spike-grade)

1. **Retriever** (`retrieve.js`, pure): given a target `{repo, issue_id|title}`, score each stored node by
   `repo` match (gate) + Jaccard/overlap on slug tokens; return the top node (+ score). Lexical, not
   semantic — and the spike SAYS so. No embeddings (YAGNI).
2. **A/B harness** (reuses the #316 spike: the `claude -p` blind actor + the W1 `sandbox-exec` adapter +
   `pytest-runner.js` + the 3-leg grade). For the TARGET, run the actor **twice**:
   - **control** — problem statement only;
   - **treatment** — problem statement + the retrieved SOURCE rendered as *"a related problem you solved
     before: <source problem> — the approach that worked: <source strategy/patch ref>"* (strategy, never
     "here is the fix to copy").
   Grade each arm behaviorally in the sandbox (does `fail_to_pass` pass?). Compare: does treatment reach
   `BEHAVIORAL_PASS` more reliably / with a cleaner fix?
3. **Populate the first recall EDGE** if the target passes — the target node + a `source→target` edge
   (the retrieval graph's first consumed link), `provenance=backtest`.

## Validity guards (the VERIFY focus)

- **No answer-leakage**: source diff ≠ target answer (different method); treatment shows *strategy*, not the
  target patch. Confirm the rendered treatment prompt contains no `__getitem__`/slice fix.
- **Blind grade**: the sandbox grader runs the test; it never sees which arm produced the candidate.
- **Honest n**: 1 target, k samples/arm — ILLUSTRATIVE, not powered (the bootcamp INSUFFICIENT-N
  discipline). Report it as a mechanism demo + a directional signal, never a trust score (OQ-NS-6).
- **`claude -p` reusables** (from #316): STDIN prompt, whole-output-anchored fence-strip, `--model` pin;
  sandbox `TMPDIR`/`--basetemp`→`.loom-out` + `dont_write_bytecode`.

## Runtime Probes

- `Probe: problem_statement_digest = crypto.sha256(...).slice(0,16)` → confirmed OPAQUE (calibration-issue.js:50). Retriever matches slug+repo, not problem text.
- `Probe (build): apply ebb0f00 test to base 1c21c3ae → run test_get_item_by_slice → expect FAIL` (the bug is present on the base; if it already passes, the base/test pairing is wrong).
- `Probe (build): the default node store $LOOM_LAB_STATE_DIR/recall-graph-backtest/ is EMPTY` → the harness repopulates the SOURCE node itself (self-contained; verified this session).
- `Probe (build): WORKED_EXAMPLE_FIELDS has no problem text` → confirmed; the edge/test cannot rely on stored problem prose.

## Deliverables

- `packages/lab/attribution/_spike/recall-retrieval-test.js` (the retriever + A/B run, narrated).
- `packages/lab/attribution/_spike/retrieve.js` (the pure minimal retriever) + a small unit test.
- The empirical result (control vs treatment) + the surfaced retrievability finding, written to the plan +
  a short note for the v3.10 carry-list.

## VERIFY result (architect, REVISE → all 9 folded)

The original design had three paths to a vacuous result. Folded:

- **F1 (BLOCKING) — treatment was NULL.** The node has no renderable strategy (`problem_statement_digest`
  is an opaque sha256; `candidate_patch_ref` is an unreachable hash). → **Option B**: author an honest,
  inspectable `strategy_note` for the SOURCE ("reason about the empty/boundary semantics of `numeric_range`;
  the bug was an unhandled empty/boundary case in a sequence dunder") and render THAT as the treatment. Tests
  the v3.10 retrieval *premise* (a future retriever surfaces strategy), not the thin store-as-is.
- **F2 (BLOCKING) — slug gaming.** Derive BOTH slugs mechanically (one committed `slugify(title)`) from the
  REAL upstream titles ("Fix empty ranges in numeric_range.__reversed__" / "Fix numeric_range slicing with
  negative step returning empty range"); commit the titles. Claim two SEPARATE things: retriever *fires on*
  the sibling (weak) vs *picks it OVER distractors* (the real claim — needs F3).
- **F3 (BLOCKING) — top-1-of-1 tautology.** Seed 5-8 mechanically-slugged DISTRACTORS (mostly
  same-repo-different-topic: real more-itertools titles like `subfactorial`, `seekable.__getitem__`,
  `powerset`; ≥1 sharing an incidental token but not the topic; ≥1 different-repo from the synthetic corpus).
  Report retrieval as ONE discrimination over K with the FULL score vector printed (margin inspectable), NOT
  a rate.
- **F4 (BLOCKING) — arm confounds.** Held identical: model (`claude-sonnet-4-6`), sampling, base_sha
  `1c21c3ae`, **fresh clone + mkdtemp per sample** (the #316 spike clones once + edits in place — fixed),
  grader config; **interleave** arms (C,T,C,T). Print both full prompts; assert the diff is EXACTLY the
  example block.
- **F5 (SHOULD) — n + k.** k=10/arm, pinned UPFRONT (no peeking). Per-arm pass count + **Wilson interval** +
  overlap verdict (NOT a pass@k delta). Conclusion = mechanism **existence-proof**; an explicit "does NOT
  establish retrieval helps" sentence (n=1 target). SMOKE at k=1/arm first to prove wiring, then gate the
  k=10 spend.
- **F6 (SHOULD) — leak re-check.** Run the RENDERED treatment string through the existing `rubricLeaks`
  (≥12-char shared-alnum vs the TARGET's `accepted_diff`); ABORT if it fires. Print the treatment.
- **F7 (SHOULD) — finding wording.** Correct "only repo+slug" → "repo + slug + coarse semantic enums
  (`reference_divergence`, `behavioral_verdict`, `friction_signature_ref`)"; note the digest preimage is
  irrecoverable; the v3.10 semantic-index need is the spike's *output* (the distractor-discrimination
  margin), NOT a premise.
- **F8 (CONSIDER) — scope.** Hold lexical; resist building an embedding retriever — the spike MEASURES
  whether lexical suffices.
- **F9 (CONSIDER) — probe both halves.** Confirm the target test is RED on base `1c21c3ae`+test AND GREEN
  on base+test+the real accepted fix `a51da82` (else a BEHAVIORAL_PASS could be trivially green).

## Result + close decision (2026-06-14)

**The retriever (the headline) — PROVEN.** For the real target title, the minimal lexical retriever ranks
the true sibling at **0.429** (shared `numeric,range,empty`) over 7 distractors (next 0.091, rest 0.000),
slugs mechanically derived from real titles. `retrieve.test.js` 5/5.

**The end-to-end harness — VALIDATED via 3 smokes, each surfacing + fixing a real issue:**

- Smoke 1 (240s actor timeout) -> bumped the actor cap to 480s.
- Smoke 2 (actor ok ~328s, but grade `FALLBACK`) -> isolated: my `repo_local`=/tmp optimization is blocked
  by the W1 sandbox (`net`+`homeWrite` EPERM); the grade must clone from `target.repo` (the URL). Probed:
  URL grade of the *accepted fix* -> `issue_tests=PASS` (grading is sound).
- Smoke 3 (fixed): BOTH arms `actor=ok -> issue_tests=PASS` (`outcome_source=model`, a REAL grade). ~232s/sample.

**k=1 A/B (existence-proof):** control 1/1, treatment 1/1 -> Wilson95 intervals overlap -> consistent with
no effect at n=1 (expected). The blind actor recreated a passing fix for the slice bug in both arms.

**The CEILING-EFFECT finding (load-bearing):** the control arm PASSED -- the actor solved the target
*without* retrieval. On an issue the actor can already solve, retrieval has no room to move the outcome. A
"does retrieval help" signal can appear ONLY on **failure-boundary** issues (fails cold, succeeds with the
prior example). So the powered A/B is not "more samples of this pair" -- it needs difficulty-calibrated
issues, which #80's corpus selects for and a single hand-picked pair cannot.

**DECISION (USER-ratified):** #78 ships as the proven retriever + the validated harness + the
digest/retrievability + ceiling findings + the validity-folded design. The **powered k=10 A/B rides #80**
(the 20-30 batch), on failure-boundary issues where n and difficulty are both meaningful (full k=10 est.
~80 min; deferred as low-ROI at the n=1 ceiling). **v3.10 carry:** the recall-graph node carries no
similarity surface (opaque digest) -> a retriever needs the issue-slug/title or an auto-generated
topic->node index; the distractor-discrimination margin is the evidence for/against a semantic index.
