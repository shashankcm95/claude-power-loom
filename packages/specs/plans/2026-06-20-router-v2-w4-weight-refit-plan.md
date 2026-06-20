---
lifecycle: persistent
topic: router-v2, w4, weight-refit, threshold-leak, overfitting-wall, oq-ns-6
date: 2026-06-20
---

# Router-V2 W4 — the "weight refit" wave (honest-minimal: there is no honest refit)

## Context / Goal

W4 is the named "weight refit — separate, architect-gated, highest-stakes (changes routing
decisions, not just match cost)" (phase plan). The MEMORY carry was: refit the `-0.25` /
`+0.15` / `0.20` magnitudes + close the `trust-scoring.js:126-128` hardcoded-threshold leak.

**Firsthand probing (below) shows there is NO honest corpus-driven weight refit** — the same
overfitting wall W3 hit, structurally WORSE. So W4 ships the parts that ARE honest and clear:
(1) the threshold-leak DRY fix, (2) a weights-coherence/comment-honesty fix (the weights sum
to 1.15, the comment falsely claims 1.00), (3) a documented deferral of the magnitude refit to
a world-anchored corpus (v-next). Per OQ-NS-6, an engineered signal NARROWS; only a
world-anchored corpus HARDENS — and this corpus is the substrate's own board-spawns.

## Routing Decision (substrate-meta catch-22)

Edits the routing scorer's consumer + a scorer comment — the live Router-V2 catch-22 (the
scorer scores its own change-class low). **Force-route.** `recommendation: route` (per-wave
multi-lens workflow: architect VERIFY -> TDD -> VALIDATE).

## Runtime Probes (firsthand, W4 worktree @ 54c1d3e, post-W3)

1. **The threshold leak is real AND the fix is already scaffolded.** `bucketTaskComplexity`
   (`trust-scoring.js:126-128`) hardcodes `score < 0.30 -> trivial; < 0.60 -> standard; else
   compound`. `route-decide-export.js` ALREADY re-exposes `ROOT_THRESHOLD`/`ROUTE_THRESHOLD`
   (its comment even says "the H.7.0 task-complexity bucketer uses ROUTE_THRESHOLD and
   ROOT_THRESHOLD directly") — but the consumer never wired them. Fix = read the exported
   thresholds. Boundary nuance: buckets use `<` (trivial `<0.30`, standard `<0.60`); routing
   uses `<=ROOT`/`>=ROUTE` — preserve the bucket's `<` semantics (no behavior change today).
2. **NO honest corpus-driven refit lever (the headline).** A weight refit can only move a row
   that already MATCHES a dim (`0 x any weight = 0`). On the 712-row eval set (firsthand
   re-score @ the W4 worktree 54c1d3e — NOT the stored `scorer_score` field, a stale
   200-char-prefix snapshot): **241/575 route-labeled rows match NOTHING** (score 0.0) ->
   reweight-UNREACHABLE; of the 334 that
   match >=1 dim, the histogram is {1 dim:249, 2:68, 3:14, 4:3} -> most score one weight
   (~0.10-0.25), nowhere near the 0.60 route threshold. Lifting them needs absurd weight
   inflation against the SAME correlated-by-construction corpus W3 declined. So a magnitude
   refit (a) can't touch 42% of the misclass at all, (b) overfits the rest. Same wall as W3,
   worse.
3. **Weights-sum coherence drift.** `WEIGHTS` sums to **1.15** (`0.25+0.15+0.15+0.075+0.20+
   0.075+0.15+0.10`), but the comment claims "Sums to 1.00 within decimal-precision tolerance
   after R1-R6 calibration." That is false. It is functionally fine (the score clamps to
   [0,1]; the thresholds are what's calibrated against the 1.15-max space; weights need not
   sum to 1.0), but the comment is a lie that would mislead a future refit.
4. **Renormalize-to-1.0 is a real refit, NOT a free coherence fix.** Dividing all weights by
   1.15 lowers every score ~13% (more rows -> root, MORE conservative — doesn't help the 555),
   and it would require RE-calibrating the 0.60/0.30 thresholds. The biased corpus can only
   regression-gate it, never validate it's better. Out of scope (-> deferral).

## Design (the honest-minimal build)

### Change 1 — close the threshold-leak (DRY, no behavior change)

`bucketTaskComplexity` reads `re.ROOT_THRESHOLD` / `re.ROUTE_THRESHOLD` (the export already
surfaces them) instead of the literals, with a defensive literal fallback only if the export
lacks them (version skew). Preserves the `<` bucket boundary. Single source of truth = the
scorer's thresholds, so a future refit that moves them can't silently desync the reputation
bucketer (the W3 bucket-probe / architect-flagged hazard).

### Change 2 — fix the false "sums to 1.00" comment (honesty)

State the true sum (1.15) + WHY it is fine (scores clamp to [0,1]; the thresholds are
calibrated against the weighted space; the dims are not a probability simplex). No weight
value changes.

### Change 3 — document the refit deferral (the wall)

A `WEIGHTS`-adjacent note + plan Out-of-Scope: the magnitude refit (-0.25 / +0.15 / 0.20 / the
thresholds) is DEFERRED to a world-anchored, non-substrate corpus (v-next) — the corpus here
cannot honestly drive it (Probe 2).

**The root-band ~551 misclass splits (firsthand re-score @ W4 worktree 54c1d3e), corrected
twice:** "W2 mitigates the 555" was FALSE for the whole set (VERIFY F1); "W2 mitigates none"
was equally imprecise (VALIDATE F4). The honest split: **W2 ESCALATES ~233** — the zero-signal
`uncertain` rows, where W2's `borderline-resolver` `uncertain` branch fires EVEN at `root` band
-> route; the remaining **~318 non-uncertain root rows pass through W2 untouched** and rely on
force-route discipline + substrate-meta `[ROUTE-META-UNCERTAIN]` detection. So W2 already covers
~42% of the root-band misclass operationally; the deferred refit is for the ~318 W2 can't reach.

### Scope boundary (do NOT)

- Do NOT change any weight magnitude or threshold value (that is the deferred refit).
- Do NOT renormalize to sum-1.0 (Probe 4 — a real refit the corpus can't validate).
- Do NOT chase the 555 (Probe 2 — reweight-unreachable + overfitting).

## Files To Modify

- `packages/runtime/orchestration/identity/trust-scoring.js` — Change 1 (the leak fix).
- `packages/kernel/algorithms/route-decide.js` — Change 2 (the WEIGHTS comment) + Change 3
  (the deferral note). Comment-only; ZERO scoring change.
- `tests/unit/runtime/identity/trust-scoring-bucket.test.js` — NEW: behavioral buckets +
  a DI-based DRY-linkage proof (mutate the exported thresholds, assert buckets follow).
- `packages/specs/plans/2026-06-20-router-v2-w4-weight-refit-plan.md` — this plan.

## HETS Spawn Plan

- **VERIFY (pre-build, read-only):** 1x `architect` — pressure-test THE conclusion: is there
  REALLY no honest refit lever (or am I under-delivering by deferring)? + the leak-fix
  correctness (DI seam, boundary `<` preserved, fallback) + the comment-honesty framing. If
  the architect finds an honest lever, fold it in.
- **BUILD:** root (orchestrator) — small DRY fix + comment + test, TDD.
- **VALIDATE (post-build, read-only):** 2-lens — `code-reviewer` (the DRY fix correctness,
  no-behavior-change, the DI test is real not vacuous) + `honesty-auditor` (is "no honest
  refit / defer" honest, or under-delivery dressed up? is the 1.15 comment now true?). NOT a
  kernel/data-mutation diff (trust-scoring is runtime; the route-decide change is a COMMENT),
  so the 3-lens tier is not required; the hacker lens is low-value (no new attack surface).

## Verification Probes

- **No-behavior-change proof:** the shadow-eval CLI (old=HEAD vs new=W4) -> 0 regressions AND
  the band distribution byte-identical (W4 changes no weight/threshold; route-decide change is
  a comment). Plus: bucket distribution over the 712 rows old-vs-W4 == identical (the DRY fix
  reads the same values).
- **DRY-linkage proof:** the new test mutates the exported `ROOT_THRESHOLD`/`ROUTE_THRESHOLD`
  and asserts `bucketTaskComplexity`'s boundary follows (proves it reads the export, not a
  hardcode).
- **Comment honesty:** `WEIGHTS` sum recomputed == 1.15 == the new comment.
- **Gate:** full kernel + runtime suites green; eslint 0.

## Out of Scope (Deferred)

- **The magnitude weight refit** (-0.25 / +0.15 / 0.20 / the 0.60/0.30 thresholds) -> v-next,
  a world-anchored non-substrate corpus (Probe 2/4). This is the bulk of what "weight refit"
  named; it is deferred because the corpus cannot honestly drive it, NOT forgotten.
- Renormalize-to-1.0 (Probe 4).
- The 555 misclass (W3's wall; reweight-unreachable here).

## VERIFY board result (2026-06-20, architect, read-only)

**Verdict: PASS** — the central conclusion ("no honest corpus-driven weight refit") SURVIVED
falsification: the architect attacked all three angles (internal miscalibration / mis-scaled
penalty / a narrowing magnitude move) and found NO honest lever; deferring the refit is
"architecturally sound, not a cop-out." Folds applied:

- **F1 (HIGH, honesty):** the "W2 mitigates the 555" claim was FALSE for the root-scored bulk
  (W2 passes `root` through untouched) -> reworded (Change 3): real mitigation is force-route +
  substrate-meta detection; W2 catches only the borderline/uncertain subset.
- **F2 (MEDIUM):** the export guard at `:117` covers only `scoreTask` -> the fallback MUST be a
  `typeof==='number'` guard (else a missing `re.ROOT_THRESHOLD` silently buckets ALL tasks
  `compound`); the test exercises the fallback path.
- **F3 (MEDIUM):** pin the strict `<` boundary (score==0.30 -> `standard` not `trivial`;
  0.60 -> `compound`) in the DI test.
- **F4 (MEDIUM):** the byte-identical-712 bucket check is an ASSERTION in the test (the eval
  set stores `scorer_score`; bucket each old-literal-vs-new-export, assert set-equality).

Q4 confirmed: NO code assumes the weights sum to 1.0 (grep-verified) -> the 1.15 comment fix is
safe, the sum is not a latent bug. No existing test breaks (the fix reads identical values).

## Build result (2026-06-20, TDD test->red->green)

**Shipped (honest-minimal, all 3 changes):**
- `trust-scoring.js`: `bucketTaskComplexity` reads `re.ROOT_THRESHOLD`/`re.ROUTE_THRESHOLD`
  (the export already surfaces them) with a `typeof==='number'` literal fallback (F2). Strict
  `<` boundary preserved.
- `route-decide.js`: COMMENT-ONLY — the false "sums to 1.00" -> the true 1.15 + why it's fine +
  the magnitude-refit deferral note. ZERO scoring change.
- `tests/unit/runtime/identity/trust-scoring-bucket.test.js`: NEW, 8 tests — DI-linkage
  (mutate the exported threshold, assert the bucket boundary follows: RED vs the old hardcode
  -> GREEN after the fix); exact `<` boundary (0.30->standard, 0.60->compound; F3);
  typeof-number fallback path (F2); byte-identical-to-old-literals across the boundary range
  (F4); real-scoreTask sanity.

**Verification probe results:**
- **shadow-eval (old=HEAD vs new=W4): `regressions:0`, `improvements:0`, NO REGRESSION** — the
  route-decide change is comment-only, so the scorer is byte-identical (the intended no-behavior
  -change proof). 
- **DI-linkage:** 2 tests RED against the hardcoded code (it ignores the mutated export) ->
  GREEN after reading the export. Proves the leak is closed.
- **Gate:** kernel suite green (EXCEPT `capability-free-claude.test.js` G3, which needs a live
  `claude -p` and exits 1 in this sandbox — touches none of W4's files, ENVIRONMENTAL, not a
  regression); runtime suite green; bucket test 8/8; eslint (Test 84) exit 0.

## VALIDATE board result (2026-06-20, 2-lens, read-only)

- **code-reviewer: PASS** (0 findings) — DRY fix correct (the `typeof==='number'` fallback
  prevents `score < undefined` -> all-compound; `re` guaranteed defined after the `:117`
  guard); strict `<` boundary preserved (0.30->standard, 0.60->compound); the DI test is REAL
  (mutating the exported threshold moves the bucket — RED vs the old hardcode); no consumer
  perturbed; route-decide change confirmed comment-only.
- **honesty-auditor: PASS-WITH-NOTES** (A-) — central thesis ("no honest refit; defer") rated
  HONEST, not under-delivery; deferral "architecturally sound, not a cop-out"; weights-sum 1.15
  + the no-unit-sum-assumption justification verified TRUE (no normalization in the scoring
  path). Two folds applied:
  - **F2 (provenance):** the 241 figure is now CITED as a firsthand re-score @ 54c1d3e (it
    matches exactly; the auditor's 285 came from the STALE stored `scorer_score` field).
  - **F4 (mild overclaim, premise-probed):** my F1 reword swung too far ("W2 mitigates none").
    Firsthand split: **W2 escalates 233** of the 551 root-band misclass (the `uncertain` branch
    fires at root band), **318 pass through untouched**. Reworded with the exact split (Change 3).
    The auditor was directionally right (their ~285 estimate -> the true 233).

Post-fold: no code change (both folds were plan-honesty); gate stays green (code-reviewer PASS).

## Drift Notes

- TWO Router-V2 waves in a row (W3, W4) hit the same wall: the eval corpus is the substrate's
  own board-spawns, so neither lexicon curation NOR weight refit can honestly improve routing
  against it — only NARROW (no-regression). The phase's remaining "improve the scorer" waves
  are blocked on a world-anchored corpus, not on more tuning. Worth surfacing at phase-close.
- The "sums to 1.00" comment is a second instance (after W3's `:85`/`:170`) of a load-bearing
  CODE COMMENT asserting a calibration fact that is false / decayed. Probe code-comment
  calibration claims, not just plan/MEMORY claims.
- **PROCESS INCIDENT (recovered, no work lost):** I ran `git stash` inside the worktree to
  test the pristine base; the backgrounded `claude -p` test it wrapped HUNG, stranding the
  stash behind an `index.lock`, and the forced recovery left the SHARED object store missing a
  tree (`git status` failed in BOTH the worktree AND the main checkout). Fixed with
  `git fetch origin --refetch` (re-downloads objects; no working-tree/index/ref mutation -> the
  other session was unaffected). **Lesson: NEVER `git stash` in a worktree to read base content
  — use `git show <ref>:file` (read-only, can't strand a stash). And never wrap a hang-prone
  `claude -p` call in a stash/pop sequence.** Codify-candidate for the git-conventions rule.
