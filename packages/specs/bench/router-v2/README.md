# Router-V2 corpus-aug — labeled route eval set + narrows-only shadow-eval

Offline tooling that distills the `route-decide-log` into a labeled `{task -> correct_route}` eval set and gates Router-V2 W3 (lexicon curation) / W4 (weight refit) changes on **regression**. Plan: [`2026-06-19-router-v2-corpus-aug-plan.md`](../../plans/2026-06-19-router-v2-corpus-aug-plan.md).

**NARROWS only (OQ-NS-6).** This backtest picks WHICH change ships behind the *existing advisory* gate; it can never harden the scorer into a blocker, and it does not measure global route-correctness. `route-decide.js` stays A4-pure and is imported read-only — the live scorer imports nothing from here (the firewall is the directory boundary).

The `auditReportWording` self-check guards the harness's *machine* report against a trust / pass-rate framing; narrows-only discipline in *human-authored* summaries (this README, the plan, a PR description) remains a review responsibility, not a mechanical gate.

## Files

| File | Role |
|---|---|
| `_schema.js` | the candidate / scored / eval row validators (the canonical unit is the stored `task_excerpt`, byte-identical across label / old-score / new-score) |
| `kappa.js` | Fleiss' kappa (chance-corrected inter-labeler agreement) + `majorityLabel` (contested-row flagging) |
| `prep-corpus.js` | S1 — filter bench/smoke/dev, drop+flag unlabelable, de-dup on a separate key, snapshot the band; emits **two** files (structural blinding) + `prep-report.json` |
| `shadow-eval.js` | S2 — old-vs-new `scoreTask` over the eval set; the two-tier regression gate + an `UNDER-POWERED` verdict when anchors are too thin + an `auditReportWording` drift-guard on the harness's OWN report |
| `label-aggregate.js` | S3 — aggregate the N=3 blind-labeler runs (fail-closed ingest), pooled + per-band Fleiss kappa, split contested/incomplete, a deterministic stratified gold spot-check, and assemble the eval set with provenance |
| `cross-family-check.json` | the committed independence record — a different model FAMILY (GPT-4o) labeled the same candidates; the per-band agreement hardens the same-family shared-prior residual |
| `scrub.js` | the PII redactor (`/Users/<name>/` → `~`); strips the OS-username home path from the committed corpus + the vendor-bound text (routing-neutral, VALIDATE H1) |
| `fixtures/fixture-eval-set.jsonl` | a synthetic eval set for the harness CLI smoke (no real task content) |
| `route-eval-set.jsonl` | the labeled eval set (produced + committed by **PR-2**) |

## Two-file structural blinding (CA-6)

`prep-corpus.js` emits `candidates-blind.jsonl` (`id` + `task_excerpt` ONLY — the labeler's input; it *physically* carries no scorer band) and `candidates-scored.jsonl` (`id` + band/score, joined back AFTER labeling). The labeler cannot anchor to the scorer's verdict because the band is not in the file it reads.

## The 200-char-prefix finding + the PR-2 label FLIP (HON-HIGH-1, dogfood-confirmed)

The live scorer scored up to 4000 chars; the log historically stored only 200, so `score_reproduces_live` (band-level) flags rows whose prefix re-score diverges from the stored live band (260/712 = 37% reproduce). PR-1 predicted the eval set would be a *root-class* guardrail (the scorer scores 687/712 root on the prefix) and that the route axis would be `UNDER-POWERED` (0 route anchors).

**PR-2's actual labeling flipped that prediction.** The three blind labelers, reading the SAME 200-char prefixes the scorer scored, call the **majority `route`** (575 of 712): the corpus is dominated by genuine board spawns ("Architect VERIFY…", "Hacker VALIDATE…", "Phase-close…") that the scorer's lexicon under-scores to `root`. The cross-tab headline: **555 rows scored `root` but labeled `route`** (post the 3 haiku-drop re-labels) — the under-scoring class the whole Router-V2 phase exists to fix. So the eval set is an **under-scoring-class anchor set**, NOT a root guardrail; both anchor floors are satisfied (route=575, root=70 ≥ 8) so the harness returns a real verdict, not `UNDER-POWERED`. The dogfood against the current scorer is stark: **route-band accuracy 0/575, borderline 0/67, root 65/70** — the scorer is excellent at trivia and gets zero of the route-labeled board spawns right.

**Honest scope (unchanged):** the corpus is the substrate's OWN board spawns, so `route` is de-facto-correct (they *were* routed) but correlated-by-construction — this is a **regression guardrail for the under-scoring class, not an independent routing-correctness test**; genuine-novel-task coverage is ~0; the truncation circle (a labeler reading the same 200-char prefix) is not broken until 1000-char rows accumulate (the PR-1 producer widening).

**PII scrub (VALIDATE H1).** ~39% of the raw excerpts embed an absolute home path (the OS username is PII). `scrub.js` redacts it (`/Users/<name>/` → `~`, temp roots → `<tmp>`); the **committed** `route-eval-set.jsonl` carries no home path (self-verifiable: `grep -c /Users/ route-eval-set.jsonl` → 0), and the scrub is provably **routing-neutral** (re-scoring the scrubbed text yields the identical band for all 712 rows — the scorer's lexicon matches no path token). The same `scrub.js` was applied to the GPT-bound text, so the egress claim is verifiable from the committed function + test, not asserted by a throwaway script.

## Run

```sh
# S1: distill the local log into labeling candidates (per-run output; git-ignored)
node prep-corpus.js                 # reads ~/.claude/checkpoints/route-decide-log.jsonl

# S2: gate a candidate scorer change against the eval set (old = a git ref, new = worktree)
node shadow-eval.js --eval-set route-eval-set.jsonl --old-ref <pre-change-ref>
# exits 1 on a per-task regression (a labeled task moving AWAY from its correct route).
```

## Labeling (PR-2, OQ-CA1 = option b)

N=3 cross-tier blind LLM labelers (opus + sonnet + haiku) read `candidates-blind.jsonl`, apply the route/borderline/root rubric, never see the band. `label-aggregate.js` does a fail-closed ingest (at most one rating per labeler/id; conflicting-dup + out-of-enum drop to `incomplete`; every complete item has exactly 3 ratings), classifies each id `consensus`(3/3) / `majority`(2/3) / `contested`(1-1-1) / `incomplete`(<3), and assembles the eval set. Provenance is split so a consumer can down-rate the weaker rows: `model-blind-N3` (unanimous), `model-blind-N3-majority` (2/3 split), `human-adjudicated` (contested → the USER). A fourth value, `human-spotcheck-confirmed`, is **supported but unused in this build** (0 committed rows — the gold spot-check ran but produced no overrides to fold back); a downstream gate may never read a finer field than `correct_route` without first cross-checking `label_provenance` ↔ `consensus_fraction` (which `validateEvalRow` now enforces — VALIDATE M1).

Outcome (2026-06-19): 514 consensus / 175 majority / 23 contested / 0 incomplete; pooled Fleiss κ **0.464**; per-band κ route ≈ 0 (route-default near-tautology), root −0.18, **borderline −0.33** (the genuine disagreement zone). The 23 contested were adjudicated to `borderline` (a 1-1-1 split across three capable labelers IS the definition of borderline).

**Cross-family independence check** (`cross-family-check.json`): a different model family (GPT-4o) labeled all candidates with the same rubric. Claude-ensemble-vs-GPT agreement is **82% overall (Cohen κ 0.466)**, and crucially **89% on the route labels (510/575)** — the under-scoring signal is *family-robust*, not a same-family artifact. Disagreement concentrates in the contested zone (root 47%, borderline 50%, GPT escalating *more* than Claude); GPT calls the 23 contested 9 route / 13 borderline / 1 root (almost never root). Kappa among same-family labelers remains a shared-prior-inflated UPPER bound, and cross-family agreement narrows the shared-prior residual but does NOT close the corpus-bias (the corpus is the substrate's own board spawns) or the truncation circle.
