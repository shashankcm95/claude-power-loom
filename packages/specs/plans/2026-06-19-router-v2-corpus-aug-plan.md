# Router-V2 — corpus-augmentation prerequisite (WAVE plan)

- **Status:** VERIFIED (2-lens board; architect READY-WITH-NOTES + honesty-auditor CLOSEABLE-WITH-NOTES, all findings folded). Build-ready pending USER approval of OQ-CA1 (the labeling-effort fork). See `## VERIFY board result`.
- **Phase:** Router-V2 (the prerequisite that gates W3 curation + W4 weight-refit; W1 lexicon-as-data MERGED #366).
- **Mechanism:** branch `feat/router-v2-corpus-aug` off `main` (7729c32); plan -> VERIFY -> TDD build -> 3-lens VALIDATE -> PR. **Split into PR-1 (mechanical) + PR-2 (labeling)** per CA-7.
- **Design seeds:** `plans/2026-06-19-router-v2-phase-plan.md` (the corpus-aug prereq) · the v3.9 calibration bootcamp (`rfcs/2026-06-13-v3.9-retrospective-calibration-bootcamp.md`) · the north-star OQ-NS-6 (`rfcs/2026-06-11-north-star-autonomous-sde-trust.md`).

## Context / Goal

W3 (lexicon curation + the `experiment` double-count de-dup) and W4 (the weight refit) both change `score_total` — and need a way to verify a change does not REGRESS known-task routing before it ships behind the existing advisory gate. This wave builds that: **(a) a labeled `{task -> correct_route}` eval set** distilled from the 766-row `route-decide-log`, and **(b) a shadow-eval harness** that runs old-vs-new `scoreTask` over the labeled set and gates on regression. Per OQ-NS-6 this **NARROWS only** (picks which change to ship behind the advisory gate); it can NEVER harden the scorer into a blocker.

### The honest reframing (recon-forced + VERIFY-sharpened — do not skip)

The naive premise ("label the log -> a routing benchmark") is **false in four ways the recon + VERIFY proved firsthand**, and the deliverable must be scoped accordingly:

1. **The corpus is BIASED toward the substrate's own board spawns.** ~680/766 rows are VERIFY/VALIDATE/phase-close/build spawns from genuine v3.x dev; ~60-80 are bench fixtures; ~5 smoke/dev stubs. The orchestrator had **already decided to route** every board spawn — so the 311 "borderline" rows are mostly **FALSE-borderline = should-be-route the lexicon under-scored** (the `experiment`/substrate-meta lexicon-gap class). **This eval set is a REGRESSION SET for the known under-scoring class, NOT a representative routing benchmark.** It can prove "a change moves under-scored tasks toward route WITHOUT breaking the genuine-root/route anchors" — but ONLY as strongly as the (minority) anchor count allows (CA-4/HON-MED-5); the over-routing-catch is gated on `N_genuine_root` and reports `INSUFFICIENT-ROOT-ANCHORS` below a floor rather than silently claiming a clean check.
2. **The stored unit is a 200-char prefix; the LIVE score was computed on 4000 chars (HON-HIGH-1 / arch CA-1 — load-bearing).** The hook scores `taskText.slice(0,4000)` with NO `--context` (`route-decide-on-agent-spawn.js:112,143`) and stores only `task_excerpt = taskText.slice(0,200)` (`:170`) + only `{recommendation,confidence,score_total}` of the verdict. So **re-running `scoreTask(task_excerpt)` does NOT reproduce the live decomposition** — it scores the 200-char prefix, which diverges from the live `score_total` whenever route-bearing tokens sit past char 200 (or the short-prompt penalty spuriously fires on the prefix). Consequence (the build contract): the **200-char `task_excerpt` is the CANONICAL UNIT** — byte-identical for the label, the old-score, and the new-score; the harness computes a self-consistent **old-vs-new delta over that prefix** (a valid regression signal FOR THE PREFIX), records `score_reproduces_live` per row (re-scored-prefix vs stored live `score_total`), and **excludes divergent rows from any claim tied to LIVE routing behavior**.
3. **~30-40% of rows are UNLABELABLE from the stored field** (16 pure HETS-YAML frontmatter, ~23 "You are spawned as ... Your task:" boilerplate, setup-truncation). The full prompt is NOT stored, so these are FILTERED OUT (flagged `unlabelable`, with reasons), not labeled. **The unlabelable classifier itself inherits the 200-char truncation bias** (it drops long-prompt board spawns), so the surviving candidate set is even MORE biased toward short-prompt tasks than the raw 766 — disclosed in `prep-report.json`, not silent.
4. **The labeling has circularity traps.** Blinding the labeler to the scorer verdict closes the **anchoring** risk ONLY. The **same-family shared-prior** risk (the LLM labelers and the scorer's route/borderline/root design philosophy are both Claude-family) is **NOT closed by blinding** — it is the v3.9 `SELF_GRADED_OPTIMISTIC` residual (RFC §3.1); it is DISCLOSED, error-barred wider, and where feasible cross-checked by a different-family / different-config labeler on the load-bearing subset. Inter-labeler agreement among same-family labelers is a shared-prior-inflated UPPER bound, never correctness; the human spot-check is the only independent-ish anchor.

## Routing Decision (substrate-meta catch-22)

```json
{ "task": "build the Router-V2 corpus-aug prerequisite: a labeled route eval set + a narrows-only shadow-eval harness",
  "scorer_self_score": "LOW/root — detectSubstrateMeta fires on route-decide/keyword/lexicon tokens; the scorer under-scores its own meta-work",
  "emits": "[ROUTE-META-UNCERTAIN]",
  "decision": "route (override by judgment — a multi-file build with non-obvious methodology tradeoffs: blind labeling, dedup, measured agreement, narrows-only honesty).",
  "rationale": "Every Router-V2 task force-routes (the catch-22). This one is genuinely architect-shaped." }
```

## Runtime Probes (probed firsthand: recon Workflow + the 2-lens VERIFY board, 2026-06-19)

| Claim | Probe | Result |
|---|---|---|
| "the log is a labelable task->route corpus" | read `route-decide-on-agent-spawn.js:164-173` + `jq` | **PARTIAL.** 766 rows (311 borderline / 272 root / 181 route + ~2 degenerate). Stores ONLY a 200-char `task_excerpt` + `{recommendation,confidence,score_total}`. |
| "re-running scoreTask recovers the live decomposition" | `route-decide-on-agent-spawn.js:112,143,170` vs `route-decide.js:411-485` | **FALSIFIED (HON-HIGH-1).** Live = `slice(0,4000)`, no `--context`; stored = `slice(0,200)`. Re-scoring the prefix != the live score for any long prompt. -> the prefix is the canonical unit; report `score_reproduces_live`; old-vs-new delta over the prefix only. |
| "borderline rows = genuine ambiguity" | inspect samples | **FALSE.** Mostly FALSE-borderline (should-be-route board spawns). Biased toward one root cause. |
| "the 200-char excerpt is enough to label" | frontmatter/boilerplate/truncation | **~60-70% only;** the rest UNLABELABLE -> filtered (counted), and the filter is itself truncation-biased. |
| "766 distinct tasks" | normalize + estimate | **~600-680 unique.** De-dup on a SEPARATE normalized `dedup_key` (strip `bench/runs/<ts>` + HETS frontmatter + "(unproven tier)") — the canonical `task_excerpt` is NEVER mutated (arch CA-1). |
| "scoreTask is a fixed oracle" | `route-lexicon.json` `lexicon_version` + W3 curates it | **NO (arch CA-3).** The scorer is a MOVING oracle across W3/W4. Pin `scorer_lexicon_version`+`scorer_weights_version` per row; band/scorer_* are a build-time SNAPSHOT against a pinned `(code,lexicon,weights)` triple; the harness "old" leg loads the SAME pinned version (extend the W1 `git show <ref>` pattern to the artifact). |
| "the eval can live with the scorer" | `kernel/algorithms/README.md:21-39` | **NO.** A4-pure; eval/harness are OFFLINE -> `packages/specs/bench/router-v2/`. |
| "a backtest can harden the scorer" | OQ-NS-6 (`north-star:76,122-127,344-348`) | **NO — RATIFIED LAW.** Narrows only (picks which change ships behind the ADVISORY gate); the scorer stays fail-open. |

## Design

### Step 1 — corpus-prep (deterministic, testable; PR-1)

A pure `prep-corpus.js` that reads the raw log and emits labeling candidates:
- **Filter** smoke + dev stubs + bench fixtures (task-content match) + degenerate `skipped` rows.
- **Drop-and-flag `unlabelable`** (pure-YAML / boilerplate-only / setup-truncated) to `unlabelable.jsonl` WITH reasons — counted, not silent; disclose the filter's own truncation-bias in `prep-report.json`.
- **De-dup on a SEPARATE `dedup_key`** (normalized); the canonical `task_excerpt` is carried VERBATIM, byte-identical, never mutated (arch CA-1). Record `dup_count`.
- **Attach the band SNAPSHOT** by re-running `scoreTask(task_excerpt)` against the PINNED `(code, lexicon_version, weights_version)` — recording `scorer_route`/`scorer_score`/`score_reproduces_live` (vs the stored live score) + the pinned versions (arch CA-3 / HON-HIGH-1).
- **Anchor strata (CA-4):** classify each candidate's SCORER band (root/borderline/route) and report `N_genuine_root`, `N_genuine_route`, `N_borderline`. Genuine-root + genuine-route are the MINORITY class and the gate's discriminating power — they are labeled in FULL (not sampled); borderline-first within the remaining budget.
- **Output TWO files (structural blinding, arch CA-6):** `candidates-blind.jsonl` (`id` + `task_excerpt` ONLY — the labeler's input; physically cannot leak the band) and `candidates-scored.jsonl` (`id` + band/score/versions — joined back by `id` AFTER labeling). Plus `prep-report.json` (stage counts).

### Step 2 — blind labeling pass (the judgment core; PR-2)

A labeling Workflow over `candidates-blind.jsonl`. Load-bearing mitigations (each maps to a named risk):
- **Structurally BLIND:** the labeler reads `candidates-blind.jsonl` (no band field exists in that file). Anti-anchoring is a file boundary, not a promise (CA-6).
- **Per-criterion rubric** (route = architect-shaped / uniquely-justifies-HETS; root = trivial / mechanical / answer-directly; borderline = genuinely escalate). Sources: `route-decide.js:41,354-384,566-578` + `workflow.md:202-204`.
- **N independent labelers -> CHANCE-CORRECTED agreement** = Fleiss' kappa (N>=3 categorical), NOT raw percent (chance-inflated on a 3-way label — arch CA-5). A small pure `kappa.js` helper (the `wilson.js` shape). `wilson.js` is used ONLY for the per-accuracy binomial CI, never for inter-labeler agreement.
- **Same-family shared-prior is DISCLOSED, not closed** (HON-HIGH-2): kappa among same-family labelers is a shared-prior-inflated UPPER bound; the human SPOT-CHECK sample is the only independent-ish anchor — report `spot-check-vs-labeler` agreement SEPARATELY as the closest thing to a correctness bar. Where feasible, a different-family/config labeler cross-checks the load-bearing (anchor) subset.
- **Provenance per row:** `label_provenance` (`model-blind-N3` / `human-adjudicated` / `human-spotcheck-confirmed`) + `labeler_kappa` + the `correct_route` oracle, kept distinct from the `task_excerpt` input (the issue-corpus `splitRecord` pattern).
- Output: `route-eval-set.jsonl` — `{id, task_excerpt, correct_route, label_provenance, labeler_kappa, scorer_route, scorer_score, score_reproduces_live, band, dup_count, scorer_lexicon_version, scorer_weights_version}`.

### Step 3 — the shadow-eval harness (mechanical; PR-1, fixture-tested)

`shadow-eval.js` — a PURE predicate + a thin `require.main` CLI (the `bootcamp-gates.js` shape), built + tested in PR-1 against a small HAND-CRAFTED fixture eval-set (needs only the FORMAT, not the real labels):
- Loads the eval set, imports `scoreTask` from the kernel **read-only**, loads the pinned-version "old" leg (the W1 `git show <ref>` pattern, extended to the lexicon artifact).
- Scores the SAME `task_excerpt` prefix for old AND new (self-consistent delta). Per row: `old_route`, `new_route`, `correct_route`.
- **The regression GATE is two-tier (CA-2 / HON-MED-4):** the LOAD-BEARING signal is **per-task** — exit non-zero iff any labeled task moves AWAY from its `correct_route` (old-was-right -> new-wrong). The aggregate "net-toward-label below baseline" is a SECONDARY tripwire, explicitly labeled a regression trigger NOT a correctness score. Reports per-band accuracy-vs-label with **Wilson intervals** + a confusion matrix; `INSUFFICIENT-N` / `INSUFFICIENT-ROOT-ANCHORS` below the committed floors (the `recall-graph.js` floor pattern).
- **Narrows-only is an ENFORCED gate, not prose (CA-2):** an `auditReportWording(reportText)` predicate (modeled on `bootcamp-gates.js:auditWording`) FAILS the build if the report co-locates a trust/score/correctness token with a pass-rate number. Runs as a self-check before the report is emitted. Per-run output is ephemeral (git-ignored).

### Location + firewall

- `packages/specs/bench/router-v2/{prep-corpus.js, shadow-eval.js, kappa.js, route-eval-set.jsonl, fixtures/, README.md}` — committed input+oracle; per-run reports git-ignored.
- **Firewall = LOCATION (arch CA-8):** the live scorer imports nothing from `bench/`; the dependency arrow is harness->scorer only. That physical separation IS the firewall. A `provenance` STRING tag is self-asserted decoration (the integrity!=provenance lesson) — demoted to docs-only; the real structural check (optional) is a CI grep asserting no file outside `bench/router-v2/` imports `route-eval-set.jsonl`.

## Wave decomposition (RESOLVED: split — arch CA-7)

| PR | Sub-steps | Scope | Review lens |
|---|---|---|---|
| **PR-1 (mechanical)** | S1 prep-corpus + S2 shadow-eval harness | the deterministic filter/dedup/flag/snapshot pipeline + the harness, TDD against a hand-crafted fixture eval-set | code-reviewer + hacker (firewall / fail-closed / the blinding file-split actually holds) |
| **PR-2 (labeling)** | S3 blind labeling + S4 report | the blind-labeling Workflow -> the real `route-eval-set.jsonl` + the kappa measurement + the human spot-check + the honest report | honesty-auditor LEAD (labeling soundness + the agreement statistic + the narrows-only/biased-corpus claims) |

## Load-bearing constraints

- **The 200-char `task_excerpt` is the canonical unit** — byte-identical for label / old-score / new-score; dedup uses a SEPARATE `dedup_key`; `score_reproduces_live` flags prefix-vs-live divergence; no live-routing claim on divergent rows.
- **Structural blinding** (the labeler's input file has no band column), not a discipline promise.
- **Chance-corrected agreement (Fleiss kappa)**, not raw percent; agreement is necessary-not-sufficient and shared-prior-inflated — the spot-check is the only correctness-ish anchor.
- **Pin `(code, lexicon_version, weights_version)`** per eval row; the "old" leg loads the pinned version.
- **Anchor strata labeled in full**; the gate reports INSUFFICIENT-ROOT-ANCHORS below a floor.
- **Narrows-only is an enforced `auditReportWording` gate + a per-task away-from-label regression gate**, not prose; the scorer stays advisory/fail-open (never a blocker).
- **A4-purity:** `route-decide.js` imported read-only; the eval/harness are offline `bench/` tooling.
- **No silent drops** (every filter counted; the unlabelable filter's own truncation-bias disclosed). **Re-count at build** (the log is append-only + growing).

## Open questions

- **OQ-CA1 — RESOLVED (USER 2026-06-19): option (b)** — blind LLM labeling (N=3) + the USER adjudicates the contested (low-kappa) rows + confirms a gold spot-check. So PR-2's labeling Workflow emits a `contested.jsonl` (the low-consensus rows) for human adjudication + a `spotcheck-sample.jsonl`, and the final `route-eval-set.jsonl` carries `label_provenance` per row (`model-blind-N3` / `human-adjudicated` / `human-spotcheck-confirmed`). (Options (a) autonomous and (c) human-gold-subset were the alternatives.)
- **OQ-CA2 — N + the contested floor:** N=3 blind labelers; a row with kappa-implied <2/3 consensus is `contested -> needs human`. (Refine at build.)
- **OQ-CA4 — RESOLVED:** label ALL genuine-root + ALL genuine-route anchors (minority class = discriminating power) + borderline-first within budget; the gate reports INSUFFICIENT-ROOT-ANCHORS below a committed floor.

## HETS Spawn Plan

- **VERIFY (this plan):** `architect` + `honesty-auditor` — DONE (see below).
- **PR-1 BUILD:** S1 + S2 via `node-backend` (TDD; the hand-crafted fixture eval-set is the harness oracle). **VALIDATE:** code-reviewer + hacker (firewall / fail-closed / blinding-split).
- **PR-2 BUILD:** S3 blind-labeling Workflow (N independent labelers, schema'd, reading `candidates-blind.jsonl`) + S4 report. **VALIDATE:** honesty-auditor lead + code-reviewer.

## VERIFY board result (2026-06-19)

2-lens VERIFY (read-only). **architect READY-WITH-NOTES** + **honesty-auditor CLOSEABLE-WITH-NOTES (Grade B)** — the decomposition, the blind-labeling shape, the A4-purity/firewall, and the biased-corpus reframing were all confirmed sound ("unusually honest"); every finding folded above.

| ID | Lens | Sev | Finding | Resolution (folded) |
|---|---|---|---|---|
| CA-1 / HON-HIGH-1 | both | HIGH | the 200-char-stored vs 4000-char-live re-score gap — re-running scoreTask on the excerpt does NOT reproduce live; and the labeled/scored/normalized string identity wasn't pinned | The 200-char excerpt is the CANONICAL UNIT (byte-identical label/old/new); dedup on a separate `dedup_key`; `score_reproduces_live` per row; claims scoped to the old-vs-new prefix delta. |
| HON-HIGH-2 | honesty | HIGH | "circularity mitigations close the named risks" overstates — blinding closes ANCHORING only; the same-family shared-prior is left open + undisclosed | Disclosed as the open residual; kappa = shared-prior-inflated upper bound; spot-check = the correctness anchor; different-family cross-check on the anchor subset where feasible. |
| CA-2 / HON-MED-4 | both | HIGH/MED | "narrows-only enforced in report text" is half prose; the aggregate gate is itself a pass-rate | Two-tier gate (per-task away-from-label load-bearing; aggregate secondary) + an enforced `auditReportWording` gate (the `bootcamp-gates.js:auditWording` pattern). |
| CA-3 | architect | MED | scoreTask is a MOVING oracle (lexicon versioned; W3 curates it) — a stale band re-anchors | Pin `(code, lexicon_version, weights_version)` per row; band is a build-time snapshot; the "old" leg loads the pinned version. |
| CA-4 / HON-MED-5 | both | MED | OQ-CA4 unresolved; the biased corpus is thin in genuine-root anchors so the over-routing-catch is weak | Resolved: label ALL root+route anchors; gate reports INSUFFICIENT-ROOT-ANCHORS below a floor; value-claim scoped to the under-scoring direction. |
| CA-5 / HON-MED-3 | both | MED | raw inter-labeler percent-agreement is chance-inflated on a 3-way label; `computeJudgeAgreement` reuse is a category slip (no independent oracle leg) | Fleiss' kappa (`kappa.js`); `wilson.js` only for per-accuracy CI; agreement reported as necessary-not-sufficient; spot-check-vs-labeler reported separately. |
| CA-6 | architect | LOW | blinding via "don't read the present column" is a promise, not structural | Two files: `candidates-blind.jsonl` (no band) vs `candidates-scored.jsonl` (id-join after labeling). |
| CA-7 | architect | LOW | OQ-CA3 is decidable -> split | PR-1 (S1+S2 mechanical) / PR-2 (S3+S4 labeling), different review lenses. |
| CA-8 | architect | LOW | the `provenance` tag is self-asserted decoration, not the firewall | Location IS the firewall (harness->scorer only); tag demoted to docs; optional CI import-grep. |
| HON-LOW-6 | honesty | LOW | cited reusables verified to exist; no missing-artifact; the unlabelable filter inherits the truncation bias | Disclosed the filter's truncation-bias in `prep-report.json`. |

**Board conclusion:** no CRITICAL; the HIGH findings are sharpenings of the build contract (now folded). Build-ready for PR-1 pending the USER's OQ-CA1 choice (which only affects PR-2's labeling step; PR-1 is mechanical + unblocked).

## PR-1 build — dogfood finding + producer widening (2026-06-19)

**Built:** `packages/specs/bench/router-v2/{_schema.js, kappa.js, prep-corpus.js, shadow-eval.js, fixtures/fixture-eval-set.jsonl, README.md, .gitignore}` + `tests/unit/bench/router-v2/{schema,kappa,prep-corpus,shadow-eval}.test.js` (44 tests). Auto-gated by the CI `aux-unit-tests` catch-all (no new CI job). Gate: install.sh 125/0, kernel suite green.

**The Rule-2a dogfood earned its keep — two things the green mock suite could not show:**

1. **A real bug (fixed):** the harness git-loader set `process.env.ROUTE_LEXICON_PATH = undefined`, which JS coerces to the STRING `'undefined'` → the new scorer then tried to load a lexicon at path `'undefined'`. Fixed by writing the ref's scorer + lexicon at the kernel-relative layout (`algorithms/` + `_lib/`) so the old scorer resolves its OWN `DEFAULT_LEXICON_PATH` — no global env (which would also re-point the new scorer). The pinned (code, lexicon) pair travels together (CA-3); a pre-W1 ref fails-soft (inline keywords, no lexicon file).
2. **A material finding (HON-HIGH-1, quantified):** scoring the stored 200-char prefix lands **681/706 candidates `root`, 25 `borderline`, 0 `route`**; only **257/706 (36%) reproduce the live band**. The route signal lives past char 200. **Consequence:** for the already-logged rows the eval set is a **root-class regression guardrail** ("don't break what works"), NOT a route-fix benchmark — the prefix lacks the very tokens a W3 fix would add, so the harness cannot reward the under-routing fix on those rows. The harness already handles this honestly (`score_reproduces_live` flags it; the live-tied subset is reported; the gate's per-task signal stands on the reproducing rows).

**Producer widened (USER-approved):** `route-decide-on-agent-spawn.js` now stores `TASK_EXCERPT_LEN = 1000` chars (was 200) so NEW log rows are route-representative; the eval set strengthens as they accumulate (it does not retroactively fix the existing 768 rows). This is the root-cause fix bundled into PR-1.

**PR-2 (labeling) re-scoped honestly:** the eval set is a root-class guardrail today; it grows toward a route-fix benchmark as 1000-char rows accumulate. Same blind-N3 + kappa + human-adjudicate-contested method (OQ-CA1=b).

## PR-1 VALIDATE board result (2026-06-19)

3-lens (kernel hook + a code-executing git-loader = the high-stakes class). **code-reviewer PASS-WITH-NITS · hacker PASS-WITH-NOTES (0 exploit) · honesty-auditor CLOSEABLE-WITH-NOTES (B+).** All findings folded; gate re-green (install.sh 125/0, kernel green, 46 bench tests).

| ID | Lens | Sev | Finding | Resolution (folded) |
|---|---|---|---|---|
| H-2 | hacker | MED | an inherited `ROUTE_LEXICON_PATH` makes BOTH legs read the same lexicon -> false NO-REGRESSION | CLI `delete process.env.ROUTE_LEXICON_PATH` at startup; the git-loader writes the ref's (code, lexicon) at the kernel-relative layout so each leg resolves its OWN default — no env. |
| H-3 / HON-MED-2 | both | MED | the harness printed "safe to ship" even when under-powered; on today's corpus route anchors=0 so it is ALWAYS under-powered | a distinct `UNDER-POWERED` verdict + exit 4; `pass = !regression && !underPowered`. The fixture dogfood now returns UNDER-POWERED, not a green. |
| H-1 | hacker | MED | git option-injection: a `-`-leading `--old-ref` (`-O<file>`) reaches git's parser = a file-read/write oracle | `SAFE_REF` charset rejects a `-`-leading / metachar ref before the `git show`. |
| HON-MED-1 / L-1 | both | MED/LOW | "enforced narrows-only gate" overclaims — `auditReportWording` only scans the harness's OWN report, not human prose; and its regex missed ratio/accuracy phrasings | README + code scope the claim (machine report only; human framing is a review responsibility); regex broadened (kappa/ratio/accuracy/N-of-N). |
| C-1 / LOW-1 | both | LOW | stale "200-char" comments (producer now 1000); `dedup_key` described as a stored field (it's a computed local) | comments updated; `dedup_key` clarified as a computed normalized key, not a stored field. |
| C-2 / L-2 | both | LOW | the git-loader `/tmp` dirs leaked; an unbounded excerpt was carried | `process.on('exit')` rmSync cleanup; `MAX_EXCERPT_LEN` (8000) drops oversized rows as degenerate (counted). |
| C-3 | code-reviewer | LOW | the unlabelable threshold (150) was tuned for 200-char rows | DEFERRED to PR-2 (revisit when 1000-char rows accumulate; disclosed). |

**Board conclusion:** no CRITICAL / no exploit (the git-loader code-exec is by-design + bounded to operator-run + now ref-validated). The honesty board called the dogfood disclosure "exemplary." PR-1 ready for the USER merge gate.
