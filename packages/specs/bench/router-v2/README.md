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
| `fixtures/fixture-eval-set.jsonl` | a synthetic eval set for the harness CLI smoke (no real task content) |
| `route-eval-set.jsonl` | the labeled eval set (produced + committed by **PR-2**) |

## Two-file structural blinding (CA-6)

`prep-corpus.js` emits `candidates-blind.jsonl` (`id` + `task_excerpt` ONLY — the labeler's input; it *physically* carries no scorer band) and `candidates-scored.jsonl` (`id` + band/score, joined back AFTER labeling). The labeler cannot anchor to the scorer's verdict because the band is not in the file it reads.

## The 200-char-prefix finding (HON-HIGH-1, dogfood-confirmed)

The live scorer scored up to 4000 chars; the log historically stored only 200. On the existing rows the 200-char prefix scores ~all candidates `root` (the route signal lives deeper) and only ~36% reproduce the live band. So for already-logged rows the eval set is a **root-class regression guardrail** ("don't break what works"), not a route-fix benchmark. The producer (`route-decide-on-agent-spawn.js`) is now widened to store 1000 chars, so **new** rows are route-representative and the eval set strengthens as they accumulate. `score_reproduces_live` (band-level) flags rows whose prefix diverges from the live band; the harness reports the live-reproducing subset and never ties a non-reproducing row to live behavior. On today's corpus the route axis has **0 anchors**, so the harness returns **`UNDER-POWERED`** (a distinct non-zero verdict — never a green "safe to ship") and certifies no-regression only once enough anchors accumulate.

## Run

```sh
# S1: distill the local log into labeling candidates (per-run output; git-ignored)
node prep-corpus.js                 # reads ~/.claude/checkpoints/route-decide-log.jsonl

# S2: gate a candidate scorer change against the eval set (old = a git ref, new = worktree)
node shadow-eval.js --eval-set route-eval-set.jsonl --old-ref <pre-change-ref>
# exits 1 on a per-task regression (a labeled task moving AWAY from its correct route).
```

## Labeling (PR-2, OQ-CA1 = option b)

N=3 blind LLM labelers read `candidates-blind.jsonl`, apply the route/borderline/root rubric, never see the band. Kappa measures agreement (a shared-prior-inflated UPPER bound among same-family labelers — NOT correctness; the human spot-check is the only independent anchor). Low-consensus rows land in `contested.jsonl` for **human adjudication**; a gold sample is human-spot-checked. Each row carries `label_provenance`.
