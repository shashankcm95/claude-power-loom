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

## PR-2 build plan — the blind labeling pass (2026-06-19)

Branch `feat/router-v2-corpus-aug-pr2` off `main` (2b94b79, post-#368). The deterministic aggregation tooling is TDD'd; the labeling judgment runs as a Workflow fan-out; the USER adjudicates the contested rows (OQ-CA1 = b).

### Runtime Probes (re-counted at build — the log is append-only + growing)

| Claim | Probe | Result |
|---|---|---|
| "the candidate count is ~706" | `node prep-corpus.js --out /tmp/...` on the live log | **774 raw -> 712 candidates** (1 dup, 2 unlabelable, 53 bench, 5 smoke/dev, 1 degenerate). |
| "the route axis is dark on the 200-char corpus" | band cross-tab of `candidates-scored.jsonl` | **687 root / 25 borderline / 0 route.** Confirmed at scale. 260/712 reproduce the live band. |
| "the excerpts are truncated prefixes" | length histogram of `candidates-blind.jsonl` | **708/712 at the 200-char cap;** only 4 are short/complete. The labeler reads a truncated prefix (same text the band snapshot scored). |
| "the blinding files exist + carry no band" | `head candidates-blind.jsonl` | confirmed `{id, task_excerpt}` only; the ALLOWLIST validator (`_schema.validateBlindRow`) rejects any extra key. |
| "kappa + majorityLabel already exist" | `kappa.js` read | confirmed (PR-1); `label-aggregate.js` consumes them — no re-implement. |

### Scope decision — label ALL 712 (no sampling)

OQ-CA4 anticipated a budget that forced sampling ("label all anchors + borderline-first within budget"). **Batching removes that constraint:** N=3 labelers x ~36 batches of 20 = ~108 spawns (well under the Workflow 1000-agent cap), so the whole candidate set is labeled — no sampling bias to disclose. The minority bands (borderline=25, route=0-by-scorer) are covered in full by construction.

### The DEEPER circularity (NEW disclosure — beyond PR-1's anchoring + shared-prior)

The labeler reads the **same 200-char prefix the band snapshot scored.** This is NOT total circularity — the labeler applies *semantic* judgment over the visible prefix while the scorer applies *lexicon* matching over the same text, so they **diverge where semantics beats the lexicon** (a prefix opening "Architect ... " / "Review ... design" reads route-shaped to a human even when the scorer's lexicon under-scores it — that divergence is exactly the under-scoring signal the eval set wants). The residual circle is only on prefixes with **no visible route signal** (genuinely trivial prefixes): there both the labeler and the scorer default to root, so a "root" label there is "what a 200-char-reading Claude guesses," correlated-by-construction with the scorer, NOT independent ground truth. **Honest claim:** the eval set is a guardrail against a W3/W4 change flipping rows a blind Claude-reading-the-prefix calls root/route — strictly narrower than "genuinely correct routing." Disclosed in the report + per-row provenance; the human spot-check (also prefix-limited) is the only break in the circle. This is layered ON the same-family shared-prior (HON-HIGH-2) and the truncation bias (S1 disclosure), not a replacement.

### Build — `label-aggregate.js` (pure + a thin CLI; TDD against fixtures)

- `aggregateLabels(labelerRuns, blindIds)` -> per-id `{id, ratings:[l1,l2,l3], majority, consensus, status}` where `status` in `consensus`(3/3) / `majority`(2/3) / `contested`(1-1-1, no majority) / `incomplete`(<3 ratings — a labeler dropped/hallucinated the id; counted, never silently 2-rater). Ignores ratings for ids not in `blindIds` (anti-hallucination); requires exactly the 3 labeler keys.
- `computeAgreement(aggregated)` -> Fleiss' kappa over the COMPLETE items only (via `kappa.js`); discloses the dropped-incomplete count.
- `assembleEvalSet({aggregated, scoredById, adjudications})` -> join by id; `correct_route` = the consensus/majority label, OR the human adjudication for a contested/over-ridden row; `label_provenance` = `model-blind-N3` (3/3 or 2/3) / `human-adjudicated` (contested -> user) / `human-spotcheck-confirmed` (gold sample the user confirmed); carries `labeler_kappa` + the joined scored fields; every row `validateEvalRow`-checked (fail-closed throw on a bad row).
- `splitContested(aggregated)` -> `contested.jsonl` (the rows needing the USER); `sampleSpotcheck(aggregated, n, seed)` -> a DETERMINISTIC (id-hash-seeded, no `Math.random`) sample of consensus rows -> `spotcheck-sample.jsonl` for the gold check.
- CLI: reads the 3 labeler-output files + `candidates-scored.jsonl` (+ an optional `adjudications.jsonl`), writes the eval set + contested + spotcheck + a kappa report. Per-run intermediates git-ignored; `route-eval-set.jsonl` committed.

### Run — the labeling Workflow (fan-out) + the user pause

1. `prep-corpus.js` -> the real `candidates-blind.jsonl` / `candidates-scored.jsonl` (git-ignored).
2. Workflow: 3 independent labeler agents (distinct framings/effort for partial de-correlation — disclosed still same-family) x ~36 batches of 20; each returns `{id, label}` per the schema (compact). The script joins to per-id ratings + returns them.
3. `label-aggregate.js` -> kappa report + `contested.jsonl` + `spotcheck-sample.jsonl`.
4. **PAUSE — surface `contested.jsonl` + `spotcheck-sample.jsonl` to the USER** (OQ-CA1 = b): they adjudicate the contested rows + confirm the gold sample.
5. Fold the adjudications -> the committed `route-eval-set.jsonl`; dogfood `shadow-eval.js` against it (expected verdict: `UNDER-POWERED`, route anchors still thin — the honest, non-green result).

### VALIDATE (post-build) — honesty-auditor LEAD + code-reviewer

The methodology + the agreement statistic + the narrows-only/circularity claims are the honesty lead's surface; the aggregation edge-cases (incomplete ratings, ties, the join, determinism) + the CLI are the code-reviewer's. No kernel/security mutation here (offline `bench/` tooling, A4-firewalled) -> the 2-lens tier, not the full 3-lens (no new adversarial attack surface beyond PR-1's already-validated git-loader).

## PR-2 VERIFY board result (2026-06-19)

Focused 2-lens board (read-only) on the PR-2 build plan BEFORE the labeling spawns. **architect READY-WITH-NOTES + honesty-auditor READY-WITH-NOTES (LEAD)** — no CRITICAL/HIGH; both clustered on two seams (the labeler-ingest join contract + the claim/statistic honesty). All folded below.

| ID | Lens | Sev | Finding | Resolution (folded into the build contract) |
|---|---|---|---|---|
| A1 | architect | MED | `incomplete` (<3 ratings) has no stated disposition + interacts with kappa's complete-only denominator; at 108 spawns a dropped id is HIGH-volume, not rare | An `incomplete` row can NEVER be `model-blind-N3`: it goes to an `incomplete.jsonl` sidecar (counted in the report, never silent), is EXCLUDED from the eval set + the kappa item-set. The RUN re-labels the missing (labeler,id) pairs once to fill before final aggregate. |
| A2 | architect | MED | the per-id ingest must guarantee EXACTLY nRaters per COMPLETE item or `fleissKappa` (kappa.js:32-33) THROWS — silent on dup-id-in-batch / out-of-order / cross-batch id / out-of-enum label | Ingest contract: assemble per-id ratings into a Map keyed by id (order-independent); accept AT MOST ONE rating per (labeler,id) — same-label dup collapses, CONFLICTING dup drops that labeler's vote (-> incomplete); reject a non-`ROUTE_VALUES` label AT INGEST (-> no vote); a complete item has exactly 3 ratings by construction. TDD each of (a)-(d). |
| A3 | architect | LOW | `sampleSpotcheck` determinism: a top-N-by-hash rank reshuffles under the append-only corpus | Per-id predicate: select iff `parseInt(sha256(id+seed)[:8],16)/0xffffffff < fraction` (each id independently in/out — stable under corpus growth); output sorted by id asc; same seed -> byte-identical file. No `Math.random`/`Date.now`. |
| A4 | architect | LOW | `majorityLabel` returns an iteration-order-dependent `.label` on a 1-1-1 tie — must never reach the oracle | `aggregateLabels` sets `majority=null` for a contested item; `assembleEvalSet` THROWS (fail-closed) if a contested id reaches the join with no matching adjudication entry. |
| A5 / HON-PR2-1 | both | MED | `label_provenance` collapses 3/3 and 2/3 into one `model-blind-N3` tag (evidence-laundering); + `labeler_kappa` disposition per provenance unstated | Add `model-blind-N3-majority` to the enum (3/3 -> `model-blind-N3`, 2/3 -> `model-blind-N3-majority`); also carry `consensus_fraction` per eval row. `labeler_kappa` = the pooled Fleiss value for model-blind rows, `null` for `human-adjudicated` (the ensemble disagreed). |
| HON-PR2-2 | honesty | MED | the deeper-circularity disclosure UNDER-STATES magnitude — the high-correlation regime is the MAJORITY (687/712 root-band, 452 non-reproducing), not an edge | Attach the firsthand numbers to the disclosure (below); state the discriminating signal lives in the ~25 borderline rows, NOT the 687 root rows; independence is strongest where rows are fewest (borderline) and absent where there are none (route). |
| HON-PR2-3 | honesty | MED | a single pooled kappa on a ~96%-root corpus is near-tautological (root-on-root); reads as "high agreement => high label quality" | `computeAgreement` reports kappa PER-BAND (partition complete items by majority band) alongside the pooled value; the report captions the pooled kappa "dominated by root-band agreement; the borderline-band figure is the meaningful one." |
| HON-PR2-4 | honesty | LOW | "the spot-check is the only break in the circle" over-promises — the human reads the same 200-char prefix (breaks the same-family circle, NOT the truncation circle) | Reworded (below): the spot-check breaks the same-family shared-prior circle but is itself prefix-limited; the truncation circle resolves only as 1000-char rows accumulate. |
| HON-PR2-5 | honesty | LOW | "the minority bands are covered in full by construction" — "in full" of 0 route anchors = zero discriminating power | Reworded (below): labeled in full, but route=0 / borderline=25 means near-zero power on the discriminating axis; the harness will (and should) return UNDER-POWERED per the route-anchor floor — foregrounded in the REPORT, not only the dogfood verdict. |

**Folded contract corrections (supersede the build-plan bullets above where they conflict):**

- **Magnitude-honest circularity (HON-PR2-2):** the high-correlation regime (labeler-defaults-root == scorer-defaults-root) covers the root-band MAJORITY (687/712 scorer-root; 260/712 reproduce the live band; 708/712 truncated at the cap). The eval set's independence-from-the-scorer is strongest precisely where it has fewest rows (borderline=25) and absent where it has none (route=0). The maximally honest claim: **a regression guardrail against a change flipping rows a prefix-reading Claude calls root** — the discriminating signal lives in the ~25 borderline rows, not the 687 root rows.
- **Spot-check scope (HON-PR2-4):** the human spot-check breaks the same-family shared-prior circle but is **itself prefix-limited**, so it does NOT break the truncation circle; that circle resolves only as 1000-char rows accumulate (the PR-1 producer widening).
- **Dark-axis foregrounding (HON-PR2-5):** the minority bands are labeled in full, but route=0 / borderline=25 = near-zero power on the discriminating axis; the harness returns **UNDER-POWERED** (the honest, non-green result) per the route-anchor floor — stated in the report itself.
- **Provenance granularity (A5/HON-PR2-1):** `LABEL_PROVENANCE_VALUES` gains `model-blind-N3-majority`; every eval row carries `consensus_fraction`; `labeler_kappa` is the pooled value for model-blind rows, `null` for `human-adjudicated`.
- **Ingest invariant (A1/A2):** the join keys by id (order-independent), accepts at most one rating per (labeler,id), drops conflicting-dup + out-of-enum votes to `incomplete`, and guarantees every complete item has exactly 3 ratings; `incomplete` -> sidecar (counted), excluded from the eval set + kappa, re-labeled once in the RUN.
- **Determinism (A3/A4):** contested `majority=null`; `assembleEvalSet` fail-closed-throws on a contested id with no adjudication. (A3 spotcheck REVISED at build — see the dogfood below: the real run flipped route from minority to majority, so the always-include-discriminating-bands design flooded; replaced by a deterministic STRATIFIED per-band cap.)

## PR-2 build result (2026-06-19) — labeling complete, eval set committed

**The label FLIP (the headline).** The N=3 cross-tier blind labelers (opus/sonnet/haiku, 108 spawns) reading the SAME 200-char prefixes the scorer scored call the **majority `route`** — the OPPOSITE of the scorer's 687-root bands. Cross-tab: **555 rows scored `root` but labeled `route`** (post the 3 haiku-drop re-labels). PR-1's "root-class guardrail / UNDER-POWERED route axis" prediction is SUPERSEDED: the eval set is an **under-scoring-class anchor set** (the corpus is the substrate's own board spawns the lexicon under-scores). This is honest GOOD news — it directly measures the bug W3/W4 fix.

**Aggregation:** 514 consensus / 175 majority / 23 contested / 0 incomplete (3 incomplete from a haiku drop were re-labeled to fill — all route). Pooled Fleiss κ **0.464**; per-band κ: route ≈ 0 (route-default near-tautology), root −0.18, **borderline −0.33** (the genuine disagreement zone). Final `route-eval-set.jsonl`: **712 rows, 0 invalid** — correct_route 575 route / 67 borderline / 70 root; provenance 514 `model-blind-N3` / 175 `model-blind-N3-majority` / 23 `human-adjudicated`.

**Contested resolution (USER, OQ-CA1=b):** all 23 contested (1-1-1 splits — tutorial-chapter critiques, Feature-B' component builds, recon/verify tasks) adjudicated -> `borderline` (a 1-1-1 split across three capable labelers IS the definition of borderline). **USER directive captured for W2:** *"ensure that borderline tasks are sent to HETS rather than route... rather than root"* — at runtime, borderline should ESCALATE to HETS, not default to root. This is the W2 (runtime-inference-@-borderline) routing-policy input; the cross-family check independently supports it (GPT calls the 23 contested 9 route / 13 borderline / **1 root** — almost never root).

**Cross-family independence check (USER-requested; `cross-family-check.json`).** A different model FAMILY (GPT-4o, via the TB_to_Tutorial OpenAI key — operator-run, key from env, never committed; a home-path scrub on vendor-sent text) labeled all 712 with the same rubric. Claude-ensemble-vs-GPT: **82% overall agreement, Cohen κ 0.466**, and **89% on the route labels (510/575)** — the under-scoring signal is **family-robust**, not a same-family shared-prior artifact (narrows HON-HIGH-2). Disagreement concentrates in the contested zone (root 47%, borderline 50%; GPT escalates MORE than Claude). Cross-family agreement does NOT close the corpus-bias (own board spawns) or the truncation circle.

**Dogfood (shadow-eval vs the committed eval set, old=new=main).** 0 regressions; NOT under-powered (route=575, root=70, borderline=67 ≥ floors); VERDICT NO REGRESSION (exit 0). Per-band accuracy of the CURRENT scorer: **route 0/575, borderline 0/67, root 65/70** — quantifies the under-routing W3/W4 must close (move route-band up from 0 WITHOUT breaking the 65 root anchors the regression gate protects).

**Committed:** `route-eval-set.jsonl` (the deliverable) · `label-aggregate.js` + its 25 tests · `_schema.js` (provenance enum split + `consensus_fraction`) · `cross-family-check.json` · README + this plan. **Git-ignored per-run intermediates:** `candidates-*`, `labels-{L1,L2,L3,GPT}.jsonl`, `label-report.json`, `contested.jsonl`, `incomplete.jsonl`, `spotcheck-sample.jsonl`, `adjudications.jsonl`.

## PR-2 VALIDATE board result (2026-06-19)

3-lens board (the eval set is an ORACLE a future W3/W4 gate will trust + a new cross-family vendor interaction). **honesty-auditor PASS-WITH-NOTES (B+) · code-reviewer PASS-WITH-NOTES · hacker PASS-WITH-NOTES (7 live probes, 0 exploit).** No CRITICAL; the core integrity boundary (fail-closed ingest, exact-3-rater guarantee, contested-throw, validateEvalRow on every row) passed all probes. All findings folded; gate re-green (84 bench tests, eslint 0, scrub band-invariant 0/712).

| ID | Lens | Sev | Finding | Resolution (folded) |
|---|---|---|---|---|
| H1 | hacker | HIGH | the committed `route-eval-set.jsonl` carried the absolute home path (OS username = PII) in **281/712** excerpts, and the GPT-egress scrub was UNVERIFIABLE from the diff (the labeling script is /tmp, git-ignored) | NEW committed `scrub.js` (`/Users/<name>/` → `~`) + its test; scrubbed the committed corpus (281 → 0 home paths) + PROVED routing-neutral (re-score all 712 scrubbed → identical band, 0 changed); the SAME scrub.js scrubs the vendor-bound text so the egress claim is now verifiable; `cross-family-check.json` caveat + README tightened. |
| M1 | hacker | MED | `candidates-scored.jsonl` re-read on the join WITHOUT `validateScoredRow`; `validateEvalRow` did not cross-check `label_provenance` ↔ `consensus_fraction` (a forged `model-blind-N3` costume on a 2/3 row passed) | CLI re-validates scored rows on READ (fail-closed, verify-on-read); `validateEvalRow` now enforces N3⟹cf=1, N3-majority⟹cf∈(0,1), human-adjudicated⟹cf=null ∧ kappa=null (4 new schema tests). |
| LOW-1 | code-reviewer | LOW | `assembleEvalSet` API footgun: a contested id in `spotcheckConfirmations` bypassed the adjudication throw + got the wrong kappa | extracted `resolveLabel`; a contested id in spotcheck now THROWS (tested). |
| L1 | hacker | LOW | provenance `N3` hardcoded regardless of rater count — a 2-labeler run would stamp `model-blind-N3` | `resolveLabel` asserts a model-blind item has EXACTLY 3 ratings before the N3 tag (tested). |
| HON-PR2-A-1 / L1 | both | LOW | the headline cross-tab "552" is actually **555** in the committed deliverable (post the 3 re-labels) — favorable-direction drift | corrected 552 → 555 in README + plan, with the re-label lineage noted. |
| HON-PR2-A-2 | honesty | LOW | `human-spotcheck-confirmed` listed inline with populated categories but carries 0 committed rows | README notes it is SUPPORTED-but-unused this build (0 rows; the spot-check produced no folded-back overrides). |
| LOW-2 | code-reviewer | LOW | `MODEL_BLIND_PROVENANCE` exported but unused (YAGNI) | removed. |
| LOW-3 | code-reviewer | LOW | `hashFraction` divisor `0xffffffff` could return exactly 1.0 (test asserted < 1) | divisor → `0x100000000` (range [0,1)); 500-iter range test added. |
| LOW-4 | code-reviewer | LOW | `assembleEvalSet` 55 lines (> the 50-line guideline) | the `resolveLabel` extraction brought it under. |

**Board conclusion:** no CRITICAL / 0 exploit. The single most important thing the wave got right (per the honesty lead): the build explicitly REFUSES the most damaging potential overclaim — it does NOT assert the route labels are independent routing-correctness ground truth, pinning them to "what a prefix-reading LLM calls route." Ready for the USER merge gate.
