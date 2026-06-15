---
lifecycle: ephemeral
---

# #86 — the A/B retrieval rider (the #78 question, on #80's real failure-boundary data)

**Goal.** #78 proved the retriever and the harness but hit a **ceiling effect**: its target passed cold, so
retrieval had no room to move the outcome. #78's close decision: the powered A/B needs a **failure-boundary**
issue (fails cold, a sibling node exists) — which #80's corpus is **proposed** to supply (this A/B is what
TESTS whether it actually does). #86 runs that A/B on the current candidate: **does retrieving a prior worked
example help the blind actor solve a SIMILAR issue it failed cold?**

This is a v3.10-retriever SPIKE (OQ-7), bootcamp->bootcamp, `provenance=backtest`, OUT of CI. It reuses the
#78 harness (`recall-retrieval-test.js` + `buildActorPrompt` extraContext + the W1 sandbox grade) plus the
**#80 source-only-grade fix** (strip the actor's own test edits before grading — the dominant #80 bug).

## The pair (both real, both post-cutoff, same subsystem, the failure-boundary CANDIDATE)

| | SOURCE (node in store) | TARGET (to solve) |
|---|---|---|
| issue | virama with Mc width is capped at 2, **also** (#225) | Cap grapheme final width at 2 (foot, ghostty) (#224) |
| repo | wcwidth | wcwidth |
| fix commit | `e4f76d5cc2` | `99e538b4b5` |
| buggy base_sha | `99e538b4b5` (== the target's FIX) | `c7fc868b95` |
| bucket / #80 outcome | lt1hr — **PASSED cold** -> node `ec90174ff895` | gt4hr — **FAILED cold** (1133s of 1500s) |
| fail_to_pass | `test_core.py::test_balinese_script` | `test_devanagari_script`, `test_tamil_script`, `test_virama_conjunct[...]` |

The node `ec90174ff895` (virama-mc, BEHAVIORAL_PASS) is **live in the store** — verified. The target's
RED/GREEN is **VERIFIED** in the #80 corpus (the accepted fix greens `fail_to_pass` on `c7fc868b95`; empty is
red). This is the failure-boundary candidate #78 lacked (the smoke result below assesses whether it behaves
as a clean floor — it did not, see the SMOKE RESULT section).

## The CENTRAL design question (the leak/transfer boundary — what the VERIFY board must arbitrate)

The SOURCE's `base_sha` **is** the TARGET's `fix_sha`: #225 (virama-mc) was committed **directly on top of**
#224 (grapheme-cap). So the two fixes are entangled — and that creates a real validity trap:

- **#224 (target)** is the BIG fix: it introduces a `cluster_width` accumulator that caps a grapheme
  cluster's total at 2, with flush-at-boundary logic across `_wcswidth.py` / `_width.py` / `_clip.py`.
- **#225 (source)** is a SMALL follow-on: it only adds explicit virama-state branch ordering
  (`elif ucs in _ISC_VIRAMA_SET: prev_was_virama = True` before the Mc branch). It **inherited** the
  accumulator from #224; it did **not** teach it.

Two failure modes for the treatment block:

1. **Dishonest/leaky** — attribute #224's lesson ("represent the cluster's width as one value capped at 2")
   to the #225 node. That is (a) **not what the #225 node represents**, and (b) the target's implementation
   **approach** (the goal "cap at 2" is already in the target's problem statement, so only the *approach*
   can leak). REJECT.
2. **Honest-narrow** — render what #225 **actually taught**: virama-state tracking + branch ordering for
   Indic combining clusters. This is **on-topic** (the target's `fail_to_pass` is entirely
   virama/Devanagari/Tamil) yet does **not** hand over the broad accumulator restructure the target needs to
   pass. Whether this partial, on-topic hint lifts a gt4hr cold failure is a **genuinely open** empirical
   question — the right kind of A/B.

A second, standalone finding (independent of the run): **lexical retrieval picks the leak-entangled sibling.**
For the target slug (`cap grapheme final width...`), virama-mc shares the token `width`; the leak-*independent*
combining-mark sibling prepended-concatenation-mark (#176, built on #174, not #224) shares **no** token. So
the most token-similar prior example is the one most entangled with the target — a direct v3.10 input (a
retriever needs similar-but-independent examples; the bootcamp's sibling-clusters are entangled by
construction).

### Candidate treatment strategy_note (RECOMMENDED = honest-narrow; board to confirm)

> RELATED PRIOR EXAMPLE (retrieved from your worked-example memory). In this same library you previously
> resolved a related issue, graded BEHAVIORAL_PASS. It concerned Indic combining marks: a halant (virama)
> followed by a consonant must keep extending the SAME on-screen cluster rather than being counted as a
> separate unit. The approach that worked was to track, as explicit state, whether the previous codepoint
> was a halant, and to resolve that case before the generic spacing-combining-mark case — the defect was in
> the state and ordering of cluster continuation, not in the per-character width values.

- No code identifiers (`cluster_width`, `prev_was_virama`, `_ISC_VIRAMA_SET`, `bisearch`) appear — prose only.
- Mechanical leak guard: run the RENDERED block through `rubricLeaks` (>=12-char shared alnum run vs the
  target `accepted_diff`); ABORT if it fires. (Authoring target: zero shared >=12-char runs.)
- Hacker-lens check (the board): does the prose disclose the **accumulator/cap-at-2 approach**? It should
  not — it describes only virama state+ordering, which #225 owns and #224 inherited.

## Design (reuse #78; the only deltas are the pair, the note, and the source-only grade)

1. Adapt `recall-retrieval-test.js` -> a `wcwidth` variant: TARGET #224, SOURCE node #225 (honest-narrow
   note), wcwidth distractors (same-repo-different-topic: center-padding, OSC-hyperlink, default-ignorable,
   textwrap; +>=1 different-repo). Confirm the lexical retriever surfaces virama-mc over the distractors AND
   print the full score vector (the "picks the entangled sibling" finding, inspectable).
2. **k samples/arm, INTERLEAVED (C,T,C,T...)**, FRESH clone + mkdtemp per sample, model pinned
   (`claude-sonnet-4-6`), base `c7fc868b95`, generous actor cap (gt4hr bucket -> 1500s, matching #80 — do
   NOT choke the actor; a timeout-driven fail is underfit-in-disguise, the #80 USER directive).
3. **Source-only grade (the #80 fix)**: strip the actor's own test/conftest/config edits; grade the SOURCE
   diff only against the hidden `fail_to_pass`. A real grade (`outcome_source==='model'`) or it does not
   count (an A2 `harness_fallback` is NOT a pass).
4. Behavioral grade in the W1 sandbox, **blind to the arm**. Pass == `issue_tests==='PASS' && outcome_source==='model'`.
5. Report per-arm pass count + **Wilson95** + overlap verdict. Conclusion = a mechanism existence-proof on
   ONE failure-boundary target; explicitly **NOT** "retrieval helps" / NOT a trust score (n=1; OQ-NS-6
   narrows-only). Print the inspectable note so the reader judges transfer-vs-leak.

## Validity guards

- **Source-only grade** (the #80 dominant bug): the blind actor writes its own tests; grading the full diff
  fallback-poisons the result. Strip test-infra paths; grade source only.
- **Leak guard** (F6, #78): `rubricLeaks(renderedBlock, target.accepted_diff)` must NOT fire.
- **Blind grade**: the sandbox runs `fail_to_pass`; never sees the arm.
- **Honest n**: 1 target, k/arm — ILLUSTRATIVE, never powered/ a trust score.
- **Timeout-as-underfit** (#80 USER): gt4hr cap = 1500s. A genuine fail, not a choke.
- **`claude -p` reusables** (#316/#80): STDIN prompt, whole-output-anchored fence-strip, `--model` pin;
  sandbox `TMPDIR`/`--basetemp`->`.loom-out` + `dont_write_bytecode` (already in `pytest-runner.js`).

## Runtime Probes

- `Probe: node ec90174ff895 (virama-mc, BEHAVIORAL_PASS) live in ~/.claude/lab-state/recall-graph-backtest/`
  -> CONFIRMED (listNodes: 3 wcwidth nodes incl. virama-mc).
- `Probe: target #224 redgreen` -> **VERIFIED** in the #80 corpus (RED on base+test, GREEN on base+test+fix).
- `Probe: #80 grapheme-cap outcome` -> BEHAVIORAL_FAIL, 1133s/1500s, node=null (a real cold failure, NOT a
  timeout artifact).
- `Probe: target/source diffs pulled` -> `/tmp/loom-86/target-224-accepted.diff` (249 ln, 3 files) +
  `source-225-accepted.diff` (42 ln, 2 files). The source's `cluster_width=2` lines are CONTEXT (inherited),
  confirming the entanglement.
- `Probe: grapheme-cap problem_statement` -> "...Make the width of such a grapheme cluster cap at 2 cells."
  (the GOAL is already disclosed to the actor; only the APPROACH can leak.)
- `Probe: lexical retriever surfaces virama-mc over distractors` -> TO RUN in the smoke (print the vector).

## Deliverables

- `packages/lab/attribution/_spike/recall-retrieval-test-wcwidth.js` (or a parameterized variant of the #78
  harness) — the adapted A/B.
- The empirical result (control vs treatment Wilson intervals) + the two findings (honest-vs-transferable
  entanglement; lexical-picks-the-entangled-sibling) written to this plan + the v3.10 carry-list.
- A `source->target` recall EDGE if the target passes under treatment (the first CONSUMED link).

## VERIFY result (3-lens board, 2026-06-14 — architect REVISE, honesty REVISE, hacker BLOCK; all folded)

The board was decisive and surfaced two BLOCKING code-level defects (hacker) + a base-rate/conclusion-bound
problem (architect) + the load-bearing on-topic-by-construction confound (honesty). All firsthand-probed
before folding (the "probe the premise, not the finding" discipline). Net redesign: **2 arms -> 3 arms**
(add a placebo), **wire the source-only strip**, **rephrase the note + add a semantic gate**, **re-bound the
conclusion to NULL-as-primary**.

### Folds (each premise-probed)

1. **[hacker BLOCKING, CONFIRMED] The source-only-grade strip is ABSENT from the #78 harness.** Probe:
   `recall-retrieval-test.js:157-159` grades the WHOLE `git diff`; no test-infra strip; the pass predicate
   never reads `test_tree_mutated`. **Correction to the hacker's exploit narrative**: the blind firewall
   means the actor does NOT see `fail_to_pass` (`splitRecord.public = {id, repo, base_sha,
   problem_statement}`, probed) -> the *false-pass* path is largely closed. The REAL #80 bug is
   *fallback-poisoning*: the actor writes its OWN tests -> they conflict with `test_patch` on apply ->
   `harness_fallback` (a non-grade) -> the comparison is poisoned. **Fold: wire the #80 source-only strip**
   (`srcF = touched.filter(f => !isTestInfraPath(f))`) before grading, as #80's `bootcamp-seq.js` already does.
2. **[hacker BLOCKING, CONFIRMED] `rubricLeaks` FALSE-POSITIVE-aborts the original note.** Probe:
   `rubricLeaks(original note) === true`, colliding on "spacing-combining-mark" vs the target diff's
   *inherited comment* `# Spacing Combining Mark (Mc)`. The guard fires on benign English in a comment.
   **Fold: rephrased the note** (drops that token; probe: `rubricLeaks(new note) === false`).
3. **[hacker BLOCKING + architect BLOCKING — A3, CONFIRMED] `rubricLeaks` is a token-copy TRIPWIRE, not the
   semantic leak gate.** The only leak that matters is the *implementation approach* (the `cluster_width`
   accumulator) — semantic, sharing no 12-char run with the code. **Fold: added an explicit
   SEMANTIC-APPROACH gate** — the rendered treatment note is asserted to contain none of
   {`accumulat`, `cap...at 2 as one/single value`, `flush`, `total width`, `pending/carry width`}; ABORT if
   present. `rubricLeaks` is demoted to "identifier tripwire (necessary, not sufficient)".
4. **[hacker SHOULD — H4 + honesty SHOULD — HO2] Effort/presence confound + on-topic-by-construction.** The
   treatment block's mere presence (~80 words of on-topic encouragement) confounds "the RIGHT content" with
   "more text -> try harder", AND the note names the exact failing family (the target's `fail_to_pass` is all
   virama/Devanagari/Tamil). **Fold: added a PLACEBO arm** — a REAL retrieved node (center-padding #188,
   different subsystem, non-transferable), same "related prior example" framing, same length-class. Arms:
   **control / placebo / treatment**. `treatment > placebo` isolates content-transfer from
   presence/effort. The residual (on-topic-naming vs transfer) is un-separable at n=1 -> CAVEAT, not claim.
5. **[architect BLOCKING — A1/A2 + honesty SHOULD — HO3/HO4] Re-bound the conclusion; NULL is primary.**
   #80's single FAIL is one Bernoulli draw, not a base rate — the CONTROL arm IS the base-rate estimate.
   **Fold: the conclusion is re-bounded** — honest outcomes are (a) intervals DISJOINT -> a directional
   signal worth powering at a batch, or **(b) intervals OVERLAP -> no detectable transfer at this n,
   consistent with "the hint is on-topic but mechanistically insufficient (it teaches virama state+ordering;
   the target needs the accumulator restructure the source's 42-line diff provably lacks)".** (b) is the
   *a-priori-likely, first-class reportable* outcome. NOT an "existence-proof" (the #78 plumbing proof is
   already banked); NOT "retrieval helps"; NOT a trust score (OQ-NS-6). The model version is PRINTED in the
   result. The `source->target` EDGE is created ONLY on a real treatment pass (`outcome_source==='model'`);
   its ABSENCE is the recorded result — no silent re-roll of the note/k to chase a pass.
6. **[architect SHOULD — A4, RESOLVED] Toolset baseline match.** Probe: `runActorTrajectory` defaults to
   Bash-ON, but #80's grapheme-cap cold-fail ran **no-Bash** (`['Read','Grep','Glob','Edit','Write']`).
   **Fold: #86 uses the same no-Bash toolset** -> the control arm reproduces the #80 baseline exactly.
7. **[architect SHOULD — A5] k + smoke gate + wall-clock abort.** **Fold: k=1 smoke first** (3 samples,
   one/arm) gated on {retriever surfaces virama-mc; `rubricLeaks` clean; semantic gate clean; F4 prompt-diff
   assertions; one real `outcome_source==='model'` grade; `isTestInfraPath` keeps the 3 source files /
   strips a test file}. Then scale to a modest k (decided post-smoke), with a hard cumulative wall-clock abort.
8. **[architect CONSIDER — A6] Explicit ABORT conditions** (named, not post-hoc): (i) >1 `harness_fallback`
   in any arm; (ii) control all-pass OR all-fail at full k (ceiling/floor -> report "not on the boundary at
   this toolset/cap", no effect claim); (iii) treatment note fails fold-2/3 gates.
9. **[honesty CONSIDER — HO5, CONFIRMED + sharpened] "Lexical picks the entangled sibling" — now COMPUTED.**
   Probe (real slugs): virama-mc ranks TOP (0.071, shared `width`) and the leak-INDEPENDENT sibling #176
   shares ZERO tokens (0.000). **Sharpened finding**: the margin is RAZOR-THIN — virama-mc (0.071) barely
   edges default-ignorable #174 (0.067), both on the generic token `width` alone. Lexical retrieval here is
   near-random; the "pick" is a hair above a pure distractor. Report the full printed vector; this is a
   durable v3.10 input independent of the A/B outcome.

### What the board confirmed is RIGHT (kept)
The honest-narrow note over the leaky #224-accumulator note is correct and diff-proven: the source's 42-line
diff genuinely does not contain the accumulator, so attributing that lesson to node `ec90174ff895` would be
fabrication. The "lexical picks the entangled (thin-margin) sibling" finding is the most durable thing #86
produces, independent of the run.

## SMOKE RESULT + close decision (2026-06-14, USER-ratified "bank the honest finding")

Ran the k=1 smoke (3 interleaved samples, one/arm); the scale to k=3/arm was started then stopped before
adding data (USER call — do not burn ~2h on a target already showing a ceiling). Gates all GREEN.

| arm | result | actor time | diff | note |
|---|---|---|---|---|
| control | **PASS** (issue_tests=PASS, model) | 1403s | 8251b | cold solve, slow + large |
| placebo | **PASS** (issue_tests=PASS, model) | 627s | 3575b | irrelevant-but-present hint; still solved |
| treatment | **FAIL** (issue_tests=FAIL, model) | 622s | 2236b | the ON-TOPIC hint present; the ONLY arm that failed |

Wilson95: control/placebo [0.21,1.00], treatment [0.00,0.79] -> all OVERLAP. At n=1 this is **noise, not
signal** (exactly the board's a-priori-likely first-class outcome). **No edge minted** (treatment did not
pass -> its absence IS the recorded result; no silent re-roll).

### Findings (what #86 actually delivered)

1. **The 3-arm harness is VALIDATED on the real path.** Source-only-grade strip FIRED on every sample
   (`stripped 1 test edit` each) and was **load-bearing** — without the hacker's H1 fold all three would
   have been `harness_fallback` (the dominant #80 bug), not gradeable. Leak gate (rubricLeaks tripwire +
   semantic-approach gate) + no-Bash (#80 baseline) + interleave + blind grade all held. The #78 harness's
   missing strip (the hacker's BLOCK) is closed in this variant.
2. **The target is a HIGH-VARIANCE near-CEILING issue, NOT a floor.** #80 cold-FAILED grapheme-cap (1133s);
   #86's control cold-PASSED (1403s) and placebo passed too. The issue is solvable cold a meaningful fraction
   of the time -> retrieval has little room to move the outcome (the #78 ceiling lesson, reconfirmed on the
   corpus's *best* failure-boundary candidate).
3. **THE DURABLE META-FINDING — single-draw "FAILED cold" labels do NOT identify failure-boundary issues.**
   grapheme-cap was tagged gt4hr/cold-fail on ONE #80 draw; on a fresh draw the cold actor passes it. A true
   floor (needed for any powered A/B) requires **repeated** cold draws per issue. This is the gating input
   for v3.10's retriever-eval design and falsifies the implicit "#80 labels = difficulty truth" premise.
4. **lexical-retrieval-picks-the-entangled-sibling — COMPUTED, near-random.** virama-mc 0.071 barely edges
   default-ignorable #174 0.067 (both on the generic token `width`); the leak-INDEPENDENT sibling #176 =
   0.000. The corpus's most-similar siblings are leak-entangled by construction -> a v3.10 retriever needs a
   semantic surface, not slug-lexical (reinforces #78's digest-opacity finding).
5. **Anchoring HYPOTHESIS (n=1, NOT a conclusion).** treatment failed fast + small (622s/2236b) vs control's
   slow + large pass (1403s/8251b) — consistent with the on-topic-but-INCOMPLETE hint anchoring the actor on
   the narrow virama-ordering fix the note described, so it stopped before the broad accumulator restructure
   the target needs. To be tested on a true-floor target in v3.10 — a partial hint may MISLEAD, not just fail
   to help.

### Decision

#86 ships as: the **validated 3-arm leak-gated harness** + findings 2-5. The **powered A/B is DEFERRED to
v3.10**, GATED on first (a) multi-draw-confirming a TRUE floor (an issue that fails cold reliably) and (b)
sourcing a leak-INDEPENDENT sibling node (the entangled-by-construction problem). n=1 + a ceilinged target
cannot answer "does retrieval help"; forcing more samples here would buy wide overlapping intervals at real
cost. The honest answer to #86's question on THIS data is: **undetermined — and the reason is itself the
finding (the target isn't a floor; the labels that said it was are single-draw noise).**
