---
lifecycle: persistent
topic: router-v2, w3, lexicon-curation, experiment-dedup, overfitting-wall, oq-ns-6
date: 2026-06-19
---

# Router-V2 W3 — lexicon curation (honest-minimal), de-dup + transferable adds

## Context / Goal

W3 is the offline lexicon-curation wave: "add high-signal / prune low-signal-FP,
bounded per dimension, shadow-eval vs the corpus. **Includes the `experiment`
double-count fix**" (phase plan). The phase-plan + MEMORY both framed the `experiment`
double-count as **the dominant-misclass root cause** for the 555 `route->root` rows.

**This wave's headline finding FALSIFIES that premise** (see Runtime Probes). The
`experiment` double-count is a real *coherence* bug but is **inert** on the corpus; the
555 misclass is a **coverage gap on the substrate's own internal vocabulary**, which
cannot be closed by curation without **overfitting** the scorer to Power Loom's
self-spawn logs. The USER chose **honest-minimal** scope (2026-06-19): ship the
coherence de-dup + a tiny set of *transferable* review/audit tokens, and **document the
overfitting wall** rather than chase the 555 number. Per OQ-NS-6, this NARROWS only.

## Routing Decision (substrate-meta catch-22)

This task edits `route-decide.js` + its lexicon — the routing scorer scores its OWN
change class low (the live Router-V2 catch-22; MEMORY START-HERE). **Force-route**;
the bare score is not trusted on a Router-V2 task. `recommendation: route` (per-wave
multi-lens workflow: architect VERIFY -> TDD build -> 3-lens VALIDATE on a kernel diff).

## Runtime Probes (firsthand-read 2026-06-19, the W3 worktree @ c4b62cb)

All figures below are firsthand from scoring the **committed 712-row
`route-eval-set.jsonl`** through the live `scoreTask` (throwaway harness, not memory).

1. **The `experiment` double-count is REAL but INERT on the corpus.** `experiment` +
   `prototype` are in BOTH `domain_novelty` (scored +0.15) AND `counter_signals`
   (global -0.25 single-fire penalty) — confirmed by set-intersection of
   `route-lexicon.json`. But only **12/712** excerpts contain those tokens, and
   removing them from `counter_signals`, from `domain_novelty`, or from both ALL
   produce a **byte-identical** band distribution (0 rows move). => the double-count
   does NOT drive the 555 misclass. The MEMORY/phase-plan "dominant-misclass root
   cause" framing is **falsified**.

2. **The MEMORY line refs (`:85`/`:170`) are STALE** — W1 (#366) moved the token sets
   OUT of `route-decide.js` into `route-lexicon.json` (lexicon-as-DATA). The arch-F5
   claim "the `:170` comment documents `counter_signals` as the intended home" is now
   **moot** — that inline comment no longer exists (the tokens are data, JSON has no
   comments). The de-dup direction is a fresh decision (see Design).

3. **The 555 misclass mechanism is a COVERAGE GAP, not a penalty.** Of the 575
   route-labeled rows: only **26** have ANY counter-signal hit (penalty explains <=26,
   not 555); **268** match NOTHING (zero scored signals, `score_total = 0.0`); NO
   route-labeled row reaches the 0.60 route threshold (max 0.550, median 0.075, p90
   0.200). Only **46/575 (8%)** are `substrate_meta_detected` => it is NOT primarily a
   substrate-meta-scoping problem either.

4. **Closing the gap requires substrate JARGON = overfitting.** The top uncovered
   vocabulary in the 252 non-meta zero-signal route rows is: `power, loom,
   claude-toolkit, plugin, kernel, substrate, wave, phase-close, verify-plan,
   claim-vs-evidence, honesty-auditor, code-reviewer, hacker, pre-build, board, lens,
   read-only, advisory`. These are Power Loom's INTERNAL terms — the eval corpus is the
   substrate's OWN board-spawns (the PR-2 "correlated-by-construction" reusable, made
   concrete). Bare `review` added to `audit_binary` lifts **43** route rows but
   **regresses 5 root anchors** (shadow-eval FAIL) and is pure overfit. Adding substrate
   jargon as route-signals teaches the scorer to memorize this repo, not to route.

5. **The de-dup DIRECTION, settled by the data:** of the 12 `experiment`/`prototype`
   rows, **11 route-labeled, 1 borderline, 0 root**. On this corpus these tokens
   co-occur with SUBSTANTIVE tasks => they are false-positive counter-signals. The
   evidence-correct direction is **remove from `counter_signals`, keep in
   `domain_novelty`** (opposite of the stale arch-F5 guess).

6. **Transferable adds measured (lift route-label off root / regress root-label off
   root, via shadow-eval-style diff):** `code review`/`code-review` (1/0),
   `design review` (1/0), `security review` (1/0), `architecture review`/`arch review`
   (1/0), `threat model`/`threat-model`/`threat modeling` (0/0). All high-precision
   review/audit COMPOUNDS — zero root regression, transferable to any repo.

7. **The lexicon is version-pinned, fail-closed.** `route-lexicon.json.lexicon_version`
   must EXACTLY equal `EXPECTED_LEXICON_VERSION` in `route-decide.js:92` (validated at
   `:125`, throws `LexiconError` on mismatch). Editing the lexicon content => bump BOTH
   in lockstep (else fail-closed boundary throws). Current: `v1-2026-06-19`.

8. **Doc-drift in the gate I rely on.** `shadow-eval.js:124-128` comment claims "the
   route axis has 0 anchors" — STALE (pre-PR-2). Post-PR-2 there are **575** route
   anchors, so `underPowered` is now FALSE and the gate CAN certify. Fix the comment
   (the gate W3 ships behind must not carry a false claim).

9. **(VERIFY-folded, arch HIGH) The W3 gate is band-only, but `bucketTaskComplexity`
   reads RAW `score_total`.** `trust-scoring.js:124-128` buckets `score_total` (trivial
   `<0.30` / standard `<0.60` / compound `>=0.60`) — a SEPARATE consumer the W3 gate
   (`shadow-eval.js:38-44`, recommendation-only) does not see. Measured firsthand on the
   FULL W3 lexicon over the 712 rows: **4 routing-band moves** (all `root->borderline`,
   the intended transferable lifts) and **4 reputation-bucket moves** (`trivial->standard`)
   — the **SAME 4 rows**; **0 bucket-moves invisible to the band gate**. The band and
   bucket ladders share the 0.30/0.60 cut points, so on this corpus they are perfectly
   correlated. => Change 2 is band-safe AND bucket-safe in W3. The divergence the
   architect flags is a REAL W4 hazard (when the refit MOVES the thresholds, the
   hardcoded `trust-scoring.js:126-128` copies desync and band!=bucket) — which is
   exactly why that leak is MANDATORY in W4's consumer list. W3 is safe BECAUSE it does
   not touch thresholds. **Claim qualified:** "zero ROUTING-BAND change" -> "4
   routing-band lifts + 4 reputation-bucket lifts (same rows, all route-labeled review
   tasks moving trivial->standard, the correct direction); 0 invisible moves."

## Design (the honest-minimal build)

### Change 1 — the coherence de-dup (latent-correctness, disclosed-inert)

Remove `experiment` + `prototype` from `counter_signals` (keep in `domain_novelty`).

- **Why this direction:** evidence (Probe 5: 11/12 route-labeled) + coherence (a token
  cannot both signal "novelty worth routing" and "triviality worth rooting") +
  **asymmetric risk** (counter_signals is a heavy -0.25 global single-fire penalty;
  mis-penalizing a substantive "experiment with X" task is costlier than mildly
  over-lifting (+0.15) a trivial "quick prototype"). The asymmetric-risk argument holds
  regardless of corpus, so the direction is defensible generally, not just here.
- **DISCLOSED inert:** changes 0 bands on the corpus (Probe 1). This is a coherence /
  latent-correctness fix for non-corpus tasks, NOT a number-mover. We do not claim it
  improves routing on the eval set.
- **VERIFY question:** is "remove from `counter_signals`" right, or is "remove from
  BOTH" (neutral, most conservative — loses the mild novelty signal) better? Architect
  to weigh; "remove from `domain_novelty`" is contraindicated by Probe 5.

### Change 2 — transferable review/audit adds (tiny, gated, narrows-only)

Add to `audit_binary` (the "ONLY fires on high-precision keywords" dim, weight 0.20):
`code review`, `code-review`, `design review`, `security review`,
`architecture review`, `arch review`, `threat model`, `threat-model`,
`threat modeling`.

- **Transferability filter:** each is a general-SDE review/audit COMPOUND, route-worthy
  in ANY repo — NOT substrate jargon (no `loom`/`honesty-auditor`/`verify-plan`).
- **Gated:** combined lift ~4 route rows, **0 root regression** (Probe 6) => the
  shadow-eval narrows-only gate PASSES. Bare `review` is EXCLUDED (43 lift but 5 root
  regressions => gate FAIL, and pure overfit).
- **Honest framing:** ~4 rows is tiny vs 555. We are NOT closing the misclass; we are
  taking the legitimate, transferable, zero-regression slice and stopping there.

### Change 3 — document the overfitting wall (USER-approved finding)

In `packages/specs/bench/router-v2/README.md`: the 555 misclass is a **corpus-bias
artifact** — the eval corpus is the substrate's own board-spawns; closing it requires
memorizing substrate jargon, which curation must not do. Operationally it is already
mitigated by W2's borderline-escalation + the force-route discipline. The shadow-eval
gate certifies **no-regression**, never general route-correctness (OQ-NS-6).

### Change 4 — version bump + gate doc-drift fix

- `lexicon_version` + `EXPECTED_LEXICON_VERSION`: `v1-2026-06-19` -> `v2-2026-06-19`
  (lockstep, Probe 7). **(VERIFY-folded LOW)** The other 9 `v1-2026-06-19` hits — the
  bench fixtures + every `route-eval-set.jsonl` row's `scorer_lexicon_version` — are
  INERT string data (`_schema.js` validates non-empty-string, NOT equality to
  `EXPECTED`), so the bench suite stays green and they are **deliberately NOT bumped**
  (bumping the eval rows would misrepresent which scorer version produced those scores).
- `shadow-eval.js` stale "0 route anchors" comment -> reflect the 575 post-PR-2 anchors
  (Probe 8).

### Scope boundary (do NOT over-claim / over-reach)

- W3 does NOT chase the 555 misclass (it can't, honestly — Probe 4).
- W3 does NOT add substrate-internal jargon as route-signals (overfitting).
- W3 does NOT touch WEIGHTS (the -0.25 / +0.15 / 0.20 magnitudes) — that is **W4**, the
  architect-gated refit. W3 is token-membership only.
- W3 does NOT touch the `route-eval-set.jsonl` corpus (frozen from PR-2).

## Files To Modify

- `packages/kernel/_lib/route-lexicon.json` — de-dup (Change 1) + transferable adds
  (Change 2) + `lexicon_version` bump (Change 4).
- `packages/kernel/algorithms/route-decide.js` — `EXPECTED_LEXICON_VERSION` bump (1 line).
- `packages/specs/bench/router-v2/shadow-eval.js` — stale comment fix (Change 4).
- `packages/specs/bench/router-v2/README.md` — the overfitting-wall finding (Change 3).
- `tests/unit/kernel/algorithms/route-decide-lexicon.test.js` — de-dup invariant
  (VERIFY-folded LOW: assert `counter_signals` is disjoint from the UNION of ALL scored
  dims, not just `domain_novelty` — broader guard against the next double-count) +
  audit_binary additions present + version-match still passes.
- `tests/unit/kernel/algorithms/route-decide.test.js` — behavioral: `code review` ->
  `audit_binary` fires (+0.20); `experiment` no longer counter-penalized.
- `packages/specs/plans/2026-06-19-router-v2-w3-lexicon-curation-plan.md` — this plan
  (accretes VERIFY / build / VALIDATE results).

## HETS Spawn Plan

- **VERIFY (pre-build, read-only):** 1x `architect` — pressure-test (a) the de-dup
  direction (remove-from-counter vs remove-from-both), (b) the transferability filter +
  the honest-minimal scope, (c) the version-bump + doc-drift correctness, (d) any missed
  build constraint (lexicon schema invariants, the `scored_and_detected_overlap`
  first-class field). Fold corrections before building.
- **BUILD:** root (orchestrator) — small data + 1-line const + tests, TDD (test->red->green).
- **VALIDATE (post-build, read-only, kernel diff => 3-lens tier):** `code-reviewer`
  (correctness: lexicon schema still valid, version lockstep, tests cover the de-dup
  invariant) + `hacker` (adversarial: does the version bump / new tokens weaken the
  fail-closed lexicon boundary or the `ROUTE_LEXICON_PATH` surface? re-probe BUILT code)
  + `honesty-auditor` (claim-vs-evidence: is "inert" disclosed, is the overfitting-wall
  doc honest, no over-claim of "fixed the 555"). Fold, then full gate, then PR.

## Verification Probes

- **Behavior-shift proof:** shadow-eval CLI old(`origin/main` lexicon) vs new(W3
  lexicon) over the 712-row set => expect `improvements >= 0`, **`regressions === 0`**,
  `pass: true` (narrows-only certified). Record the exact numbers.
- **De-dup invariant:** `domain_novelty INTERSECT counter_signals === {}` after the edit
  (new lexicon test).
- **Version lockstep:** `loadLexicon(DEFAULT)` does NOT throw (version match); a stale
  `v1-2026-06-19` lexicon against the bumped `EXPECTED` DOES throw `LexiconError`.
- **Inert-disclosure honesty:** the band cross-tab on the W3 lexicon == baseline EXCEPT
  the ~4 transferable lifts (no surprise band moves).
- **Full gate:** `bash install.sh --hooks --test` green + full kernel suite green +
  the bench/router-v2 suite green.

## VERIFY board result (2026-06-19, architect, read-only)

**Verdict: NEEDS-REVISION -> all folds applied -> build-ready.** The architect confirmed
the falsified-premise finding, the de-dup DIRECTION (remove-from-`counter_signals` right;
remove-from-BOTH "defensible but inferior"; remove-from-`domain_novelty` "dead"), the
schema safety of all edits (overlap field = `compound_strong INTERSECT substrate_meta`,
untouched), the version lockstep, and the honest-minimal scope (incl. excluding bare
`review` — also reverses a prior C-1 "removed review" decision per the lexicon provenance).

Folds applied:
- **HIGH (Finding 1)** — bucket-consumer coupling: PROBED (Probe 9). 0 invisible bucket
  moves; band==bucket on this corpus (shared thresholds). Claim qualified; W4 hazard noted.
- **LOW (Finding 3)** — de-dup test broadened to `counter_signals` disjoint from the UNION
  of all scored dims (Files To Modify, updated).
- **LOW (Finding 4)** — inert version-string fixtures noted (Change 4, updated).

Findings 2 (direction) + 5 (scope) were clean PASS — no change.

## Build result (2026-06-19, TDD test->red->green)

**Shipped (honest-minimal, all 4 changes):**
- `route-lexicon.json`: removed `experiment`/`prototype` from `counter_signals`; added 9
  transferable review COMPOUNDS to `audit_binary`; `lexicon_version` -> `v2-2026-06-19`;
  provenance comments updated (honest: bare `review` stays removed; the de-dup rationale).
- `route-decide.js`: `EXPECTED_LEXICON_VERSION` -> `v2-2026-06-19` (1 line, lockstep).
- `shadow-eval.js`: stale "0 route anchors" comment -> the 575-anchor reality + the
  persisting correlated-by-construction bound.
- `README.md`: the W3 overfitting-wall finding (Change 3).
- `route-decide-lexicon.test.js`: 6 W3 tests (de-dup union-invariant; direction;
  no-counter-penalty behavior; audit_binary adds; `code review` fires / bare `review`
  excluded; version lockstep). RED against v1 (6 fail) -> GREEN after edits (25/25).

**Verification probe results:**
- **shadow-eval narrows-only (old=HEAD v1 vs new=W3 v2, 712 rows): `regressions: 0`,
  exit 0, VERDICT NO REGRESSION.** Anchors sufficient (route=575, root=70, borderline=67)
  -> NOT under-powered (the doc-drift fix validated). **`improvements: 0` (HONEST):** the
  4 transferable lifts move route-labeled rows `root->borderline` (where W2's resolver
  escalates) — NOT `root->route`, so band-agreement-with-label is unchanged. A real,
  small OPERATIONAL win (4 rows now hit W2 escalation vs silent root), NOT a "fixed the
  555" claim. Per-band agreement identical old|new (route 0/575, root 65/70).
- **Bucket-consumer probe (Finding 1): 4 routing-band moves == 4 reputation-bucket moves
  (SAME 4 rows, all route-labeled, `root->borderline` / `trivial->standard`); 0 invisible
  bucket moves.** Band==bucket on this corpus (shared 0.30/0.60 thresholds). Change 2 is
  band- AND bucket-safe in W3.
- **Gate:** kernel suite green; bench/router-v2 suite green; lexicon suite 25/25; eslint
  (Test 84) exit 0; lexicon valid JSON; no `eslint-disable` added; `.md` files are
  markdownlint-excluded (`packages/specs`).

## VALIDATE board result (2026-06-19, 3-lens kernel-diff tier, read-only)

**All three PASS-WITH-NOTES — zero CRITICAL/HIGH, no blockers.** code-reviewer (correctness),
hacker (adversarial-security, live-probed the BUILT code), honesty-auditor (claim-vs-evidence,
Grade A-). Folds applied before PR:

- **hacker M1 (MEDIUM, FOLDED):** the de-dup invariant was TEST-ONLY — a tampered lexicon
  re-introducing the double-count loaded at exit 0 (score 0.30->0.05). Graduated to a
  **load-time, fail-closed check in `validateLexiconShape`** (`route-decide.js`): a token in
  both a scored dim AND `counter_signals` now throws `LexiconError`. New fail-closed test
  added. This permanently closes the class W3 fixes (a future curator can't silently
  re-introduce it). [security.md: fail-closed at the boundary, don't trust the data.]
- **honesty Finding 6 (MEDIUM, FOLDED):** the README per-row sub-stats (26/268/8%/histogram)
  are re-score-harness-derived, were presented bare -> added a provenance clause (the
  corpus-traceable anchors remain 555/575/70/67).
- **honesty Finding 4 (MEDIUM, FOLDED):** the "in BOTH" pre-state was shown by proxy (the
  auditor lacked Bash). Git-verified firsthand: `git show HEAD:route-lexicon.json` confirms
  `experiment`+`prototype` in BOTH `domain_novelty` AND `counter_signals` pre-change.
- **cr LOW-1 (FOLDED):** the de-dup behavioral test now uses an isolated task
  ("experiment with a fresh angle") so the no-counter-penalty assertion is unambiguous.
- **cr LOW-2 (FOLDED):** documented in the `audit_binary` provenance that
  `architecture review`/`design review` also fire `compound_weak` (+0.075) via their leading
  word (max 0.275 = still root) — for W4's calibration.

**Negative results recorded (hacker, live-probed):** L1 — the +0.20 audit_binary lift is FLAT
(binary, no amplification) and toward MORE scrutiny (route), so cannot be weaponized for
escalation; the spawn hook fail-opens anyway. L2 — no ReDoS/injection (the multi-word tokens
go through a literal `startsWith`+boundary matcher, no regex-from-data; 2 MB input -> 49 ms
linear). L3 — `scored_and_detected_overlap` exact-set intact (17===17). **honesty:** every
corpus-traceable number exact (555/575/70/67; 11/12 route-labeled; 12/712 token-bearing
case-insensitive); `improvements: 0` disclosed honestly (no "fixed" language anywhere; the
narrows-only OQ-NS-6 bound carried per-number).

**Post-fold gate:** lexicon suite 26/26; full kernel suite green; bench/router-v2 suite green;
shadow-eval 0 regressions; eslint (Test 84) exit 0; no `eslint-disable` added.

## Out of Scope (Deferred)

- The 555 misclass (corpus-bias artifact; not honestly curable — see Change 3).
- The weight refit (W4): the -0.25 / +0.15 / 0.20 magnitudes + the
  `trust-scoring.js:126-128` hardcoded-threshold leak (MANDATORY in W4's consumer list).
- A real external / non-substrate routing corpus (would let coverage curation be honest;
  v-next).

## Drift Notes

- **A plan/MEMORY-documented "root cause" was a premise, not a fact.** The `experiment`
  double-count was carried as "the dominant-misclass root cause" across the phase-plan
  AND MEMORY START-HERE; the firsthand probe falsified it in ~5 minutes (inert: 12/712
  rows, 0 band moves). Reinforces "plan prose about state is a premise to PROBE"
  (`drift:plan-honesty`) — extend it to MEMORY-carried causal claims, which decay the
  same way line-numbers do (the `:85`/`:170` refs were also stale post-W1).
- The de-dup direction in the phase plan (arch-F5: "counter_signals is the intended
  home" => remove from domain_novelty) was the OPPOSITE of the evidence-correct
  direction. An architect-blessed design claim, written before the PR-2 labeling flip,
  was overturned by new corpus evidence. Probe-the-premise cuts forward in time too.
