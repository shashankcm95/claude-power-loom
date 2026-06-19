# Router-V2 — route-decide inference upgrade (PHASE plan)

- **Status:** VERIFIED (2-lens board; all HIGH folded) — W1 build-ready pending USER approval. See `## Pre-Approval Verification`.
- **Phase:** Router-V2 (queued after ③.1; closes `drift:dictionary-gap` convergence 4)
- **Design seed:** `packages/specs/research/2026-06-02-persona-depth-llmwiki-v6-hybrid.md` + the ROADMAP "Router-v2" deferred entry
- **Mechanism:** per-wave branches off `main`; each wave is its own plan→verify→TDD→3-lens-VALIDATE→PR arc.

## Context / Goal

`route-decide.js` today is a **pure A4 deterministic scorer**: a hardcoded `KEYWORDS` object literal (~250 tokens across 8 weighted dimensions + a ~70-token detection-only sentinel array), an **O(lexicon)** match (~90 word-boundary regex `.test()` calls per `scoreTask`, memoized), a borderline band + the `[ROUTE-DECISION-UNCERTAIN]`/`[ROUTE-META-UNCERTAIN]` forcing-instruction seam, consumed by the orchestrator-driven advisory hook (never blocks). Router-V2 upgrades it to: **lexicon-as-DATA** + an **O(task) phrase-aware invert** + a **Runtime inference layer** at the borderline seam + **offline lexicon curation**. **Keywords-first; weights architect-gated.** The A4 scorer stays pure (no LLM, no I/O) — the inference layer lives in Runtime, never the kernel.

## Routing Decision (the substrate-meta catch-22 — probed, not trusted-to-score)

```json
{ "task": "build Router-V2: lexicon-as-data + O(1) invert + runtime inference at the borderline seam",
  "scorer_self_score": "LOW / root — detectSubstrateMeta fires on route-decide/dictionary/keyword/lexicon tokens; the task scores against the OLD dictionary that does not yet contain Router-V2's own vocabulary",
  "emits": "[ROUTE-META-UNCERTAIN]",
  "decision": "route (OVERRIDE by judgment, architect-gated per route-decide.js:11-13 + the H.7.16 rule)",
  "rationale": "The scorer-scoring-its-own-change trap (documented for H.7.11/H.7.14 at route-decide.js:194-205). This wave is genuinely architect-shaped (a kernel-algorithm refactor + a new Runtime layer + a corpus). It is ALSO the exact motivation for the runtime-inference layer (which can reason past a stale dictionary). Every Router-V2 wave force-routes; the bare score is not the signal." }
```

## Runtime Probes — the corpus reality (the ROADMAP-mandated "characterize the corpus FIRST")

The charter premise — "the dry-run's routing decisions = the labeled corpus" — is **FALSIFIED**. Probed firsthand (3-reader recon, 2026-06-19):

| Claim | Probe | Result |
|---|---|---|
| "the ③.1 F7 traces are a routing corpus" | Read `trace-emitter/trace-schema.js` | **FALSE.** Schema frozen at 11 fields — no `task`, no `route`, no `route-decide` component (6 frozen components, none routing); content sha256-digested. **0 routing data points.** |
| "the dry-run emitted a labeled task→route dataset" | grep the ③.1 plan `## Routing Decision` blocks | **Only ~6 labeled pairs** — all in PLAN PROSE, all the same root cause (the `experiment` double-count), all one direction (false-`root`→route). A **validation seed, NOT a training set.** |
| "there is a richer routing log" | inspect `~/.claude/checkpoints/route-decide-log.jsonl` | **763 rows / 380KB** = `{200-char task_excerpt + AUTO-computed verdict}` — **UNLABELED** (no human correct-route); 311 borderline / 179 route / 272 root; only 39 rows in the ③.1 window (bulk is bench/dev telemetry). |
| "the lexicon is already a data artifact" | read `route-decide.js:66-184` | **FALSE.** Hardcoded `KEYWORDS` object literal + `SUBSTRATE_META_TOKENS` (`:215-252`); ~250 tokens; clean `const` literals, no logic interleaved → liftable verbatim. |
| "fixing the dominant misclass is a lexicon tweak" | read `route-decide.js:85` + `:170` | **`experiment` is in BOTH `domain_novelty` (+0.15) AND `counter_signals` (−0.25)** → nets architect-shaped experiment work to false-`root`. The single root cause of all 6 misclass + `drift:dictionary-gap` conv=4. But it is a **scoring change** (needs FP-regression validation). |

**Net:** the usable labeled set = ~6 same-root-cause validation pairs; the 763-row log is the richest raw source but needs a **labeling pass** (borderline-first) before it can validate prunes or a weight refit. **A corpus-augmentation prerequisite gates the corpus-dependent waves (W3/W4).**

## Phase decomposition

| Wave | Scope | Corpus-gated? |
|---|---|---|
| **W1** | lexicon → versioned **DATA artifact** + the **O(task) phrase-aware invert** (coupled — the artifact shape IS the invert). **Behavior-IDENTICAL** (scoring math constant; green against the 18 existing tests). Keywords-first → weights stay hardcoded constants. | **No** — mechanical, unblocked NOW |
| **(prereq) corpus-aug** | a labeling pass over the 763-row `route-decide-log` (borderline-first) → a structured `{task → correct-route}` eval set + the **shadow-eval harness** (OQ-NS-6: narrows-only — proves a prune does not REGRESS, never global correctness). | **builds the corpus** |
| **W2** | the **Runtime inference layer** at the borderline seam — fires ONLY on `recommendation==='borderline'` OR a fired forcing-instruction; reads the scorer's JSON + makes the semantic escalation. In **Runtime/orchestrator**, NEVER `kernel/algorithms` (A4 purity). Extends the forcing-instruction-as-abstraction pattern. | helped, not gated |
| **W3** | offline **lexicon curation** — add high-signal / prune low-signal-FP, bounded per dimension, shadow-eval vs the corpus. **Includes the `experiment` double-count fix** (a scoring change, FP-validated against the now-labeled corpus). | **gated on the corpus** |
| **W4** | the **weight refit** — separate, architect-gated, highest-stakes (changes routing decisions, not just match cost). | gated |

## Load-bearing constraints (the build contract — VERIFY-probed firsthand)

- **The artifact has FOUR structural roles, NOT 2 (cr-F1 + arch-F6 — load-bearing).** The lexicon is not "scored vs detection-only". A schema-valid 2-partition extract would silently misclassify the two special-path dims. The four roles: **(a) SCORED** — the 8 `WEIGHTS` dims that feed `scores_by_dim` directly; **(b) COUNTER-PENALTY** — `counter_signals` is in `KEYWORDS` but NOT `WEIGHTS`; it feeds a separate flat `−0.25` penalty path (`counterContribution`); **(c) INFRA-LIFT** — `infra_terms` is in `KEYWORDS` but NOT `WEIGHTS`; it feeds the `INFRA_IMPLICIT_STAKES_LIFT` path (including in the context pass); **(d) DETECTION-ONLY** — the `SUBSTRATE_META_TOKENS` sentinel array. The W1 artifact schema MUST represent all four explicitly, with **artifact-STRUCTURE tests** (not just behavioral-band tests) asserting `counter_signals`/`infra_terms` land in their correct slots.
- **PHRASE-AWARE invert — the EXACT boundary rule (cr-F3 + arch-F1).** The matcher is a literal-substring match anchored on non-word boundaries: `(?:^|[^a-zA-Z0-9_])<kw>(?=$|[^a-zA-Z0-9_])` (`route-decide.js:353`). So: **boundary = any char NOT in `[a-zA-Z0-9_]`** (hyphen AND space are boundaries; `_` is a word char, so `post_state_hash` is one token). Two consequences the invert MUST reproduce: (1) a hyphenated keyword matches as a **sub-phrase of a longer hyphenated compound** — `multi-file` matches inside `multi-file-system`; (2) a space-separated token requires the **exact literal single-space substring** — `rate limiting` does NOT match `rate&nbsp;&nbsp;limiting` (two spaces) or a newline-split. A naive whitespace-normalizing tokenizer breaks BOTH. The overlap illustration uses the real hyphenated token `verdict-attestation` (the space-form `verdict attestation` is NOT a token — cr-F8).
- **W1's correctness oracle is an EQUIVALENCE HARNESS, not "the 19 tests" (arch-F1 + cr-F2/F4/F6 — THE key fold).** The suite is **19 tests** (not 18), and it covers ZERO multi-space, hyphen-adjacency, case-fold, **context-pass**, or `compound_weak`-suppression inputs — so a divergence is reachable with every test green. The real oracle: a **throwaway equivalence harness** asserting `old-scoreTask(t)` === `new-scoreTask(t)` **byte-for-byte on `score_total` + the full `scores_by_dim` + `substrate_meta_tokens`** across all **763 rows of `route-decide-log.jsonl`** (corpus-FREE in the labeling sense — the old impl IS the oracle; no human labels) PLUS explicit adversarial/uncovered-path fixtures: multi-space-in-phrase, hyphen-prefix (`multi-file`→`multi-file-system`), case-fold, the **context pass** (3 behaviors below), and **`compound_weak` suppression** (below). Delete the harness after W1 lands.
- **The CONTEXT pass is untested + has its own semantics (cr-F2).** `route-decide.js:460-497` (the `--context` path) is exercised by NONE of the 19 tests, yet the invert must rewrite it (`:473-474`). Its asymmetries: it iterates **only `WEIGHTS` dims** (a `counter_signals` match in context applies NO penalty — intentional); `infra_implicit` via a separate block (`:486-495`); every contribution × `CONTEXT_WEIGHT_MULT` (0.5); it feeds the `borderline_promotion_applied` gate. W1 MUST add context-pass oracle tests.
- **`compound_weak` suppression-by-stakes is a cross-dim dependency (cr-F6).** `compound_weak`'s contribution is zeroed when `stakes` has ANY match (`route-decide.js:400-405`) — so dims are NOT independent; a per-dim invert that computes contributions independently scores `+0.075` too high for any stakes∧`compound_weak` task. Untested. W1 MUST add a suppression oracle test + document the rule in the artifact/scoring spec.
- **BACKWARD-COMPAT — a SHAPE *and* a SCORE-VALUE contract (arch-F2/F3).** The subprocess hook (`packages/kernel/hooks/pre/route-decide-on-agent-spawn.js:149-156` — full path; the bare path the recon implied doesn't resolve) parses `{recommendation, confidence, score_total}` from CLI stdout. The manifest enforces exports `[scoreTask, ROUTE_THRESHOLD, ROOT_THRESHOLD]` under `enforcement:'error'`. The in-process consumer `bucketTaskComplexity` (`packages/runtime/orchestration/identity/trust-scoring.js:111-128`) is a **SCORE-VALUE** dependency: it buckets `result.score_total` against HARDCODED `0.30`/`0.60` (duplicated magic numbers, NOT imported `ROOT/ROUTE_THRESHOLD`). So W1's bar is **`score_total` numerically preserved to the bucket boundary** (the equivalence harness covers it), not "shape preserved". **ADD fields, never remove/rename.**
- **SUBSTRATE-META CATCH-22 is live for every Router-V2 wave** (see Routing Decision). Force-route; never trust the bare score on a Router-V2 task.
- **The `experiment` double-count is W3, not W1 — but the FIX DIRECTION is known NOW (arch-F5).** `experiment` is in BOTH `domain_novelty` (`:85`, +0.15) AND `counter_signals` (`:170`, −0.25) — internally incoherent regardless of corpus; the `:170` comment documents `counter_signals` as the intended home. So the de-dup DIRECTION is decidable on coherence grounds today; the corpus is needed ONLY to bound the FP/regression blast-radius of the resulting score shift (shadow-eval, OQ-NS-6 narrows-only). It stays W3 (ANY change to which dim matches `experiment` breaks W1 behavior-identical).
- **Memo cache disposition (cr-F9).** `_keywordRegexCache` + `buildKeywordRegex` (`:349-356`) are module-level state; `detectSubstrateMeta` still uses `buildKeywordRegex`. W1 must state explicitly: the invert eliminates the per-keyword regex loop on the SCORING path, and the cache is either retired (if nothing else uses it) or retained for `detectSubstrateMeta` — a conscious, documented choice (tests don't cover perf).

## Open questions — resolved / sequenced

- **OQ1 — n-gram granularity** → **W1.** max-N = the longest lexicon phrase's word-count; reproduce the word-boundary semantics for n∈1..N. Resolved against the 18 tests (the oracle), not by a portable rule.
- **OQ2 — per-dimension prune bound** → **W3** (architect-gated tuning). VERIFIED-on-pattern, SPECULATIVE-on-value (per the research doc's A3 — don't hardcode a portable threshold).
- **OQ3 — shadow-eval harness** → **corpus-aug prereq.** OQ-NS-6: a prune must not REGRESS known-task routing; cannot prove global correctness. "Pass" = no regression on the labeled set.
- **OQ4 — lexicon artifact versioning/validation** → **W1, with PRECISE fail-closed semantics (arch-F4 + cr-F7).** The artifact carries a `lexicon_version`; the pure A4 scorer schema-validates it at the boundary (now untrusted data, not trusted-by-construction code). **"Fail-closed" = throw a typed error → the CLI exits non-zero (stderr, NO stdout JSON); `scoreTask` throws in-process — NEVER a fabricated exit-0 verdict** (a corrupt artifact returning root-on-exit-0 would silently route everything to root — the WORSE failure). Both consumers absorb the loud-fail safely (the hook treats non-zero exit as `route-decide-failed` → approves, by ADR-0001 fail-open; `bucketTaskComplexity`'s try/catch → `'standard'`). So: loud-fail at the kernel boundary, soft-absorb at the consumers. W1 test: a malformed/absent artifact → throw/exit≠0, NOT a silent all-root score (the existing `:112-118` empty-task test is a different case).
- **OQ5 — consumer contract is a SCORE-VALUE contract, not just load-path (arch-F2).** The in-process consumer `bucketTaskComplexity` (`trust-scoring.js:111-128`) buckets `score_total` against hardcoded `0.30`/`0.60` (a duplicated-magic-number leak — kb information-hiding). W1: preserve `score_total` numerically (the equivalence harness covers this) + no export rename. **Threshold-leak follow-up:** `trust-scoring.js:126-128` should import `ROUTE_THRESHOLD`/`ROOT_THRESHOLD` rather than hardcode them — a pure DRY fix (same values → still behavior-identical) safe to land opportunistically in W1, but **MANDATORY in W4's consumer list** (the refit changes the thresholds → the hardcoded copies silently desync). Also confirm the load-path (load-once-at-module vs per-call) preserves both consumers.
- **Probe-flag — RESOLVED (arch-F8).** The `2026-06-01-gstack-comparison-and-cross-model-review.md` source genuinely does not exist (glob-confirmed; state moved — OQ-HYBRID-7). **Treat `2026-06-02-persona-depth-llmwiki-v6-hybrid.md` as the SOLE authoritative design seed**; the 2026-06-01 reference is struck. No build depends on it.

## W1 — first-wave scope (build-ready after this plan's VERIFY)

1. **Extract** `KEYWORDS` + `SUBSTRATE_META_TOKENS` (`route-decide.js:66-184,215-252`) into a versioned data artifact (`lexicon_version`) whose schema encodes the **four roles** (scored-dim / `counter_signals`-penalty / `infra_terms`-lift / detection-only). Make the intentional scored∧detected overlap a **first-class field** (e.g. each entry `{token, scores:<dim>|null, detects:bool}` — one row, not a phrase duplicated across two lists; cr-F1 + arch-F6). Carry the architect-gate comment.
2. **Invert** `matchKeywords` (`:359-366`) + the per-dim caller (`:381-383`) + the **context pass** (`:460-497`) from the per-keyword regex loop to a **phrase-aware n-gram/trie** lookup that reproduces the EXACT boundary rule (`[^a-zA-Z0-9_]` boundaries; hyphen-prefix sub-phrase match; exact single-space literal). Preserve the `compound_weak`-suppression-by-stakes cross-dim rule (`:400-405`).
3. **Validate the artifact at the A4 boundary** (OQ4) — schema-check on load; throw/exit≠0 on malformed/version-mismatch, **never a fabricated exit-0 verdict**.
4. **The oracle = the EQUIVALENCE HARNESS** (not the suite alone): old-vs-new byte-identical `score_total` + `scores_by_dim` + `substrate_meta_tokens` over the 763-row log, PLUS targeted tests for the uncovered paths (multi-space, hyphen-prefix, case-fold, the 3 context-pass behaviors, `compound_weak` suppression, malformed-artifact). Keep weights hardcoded (keywords-first). The **19** existing tests (`route-decide.test.js` — incl. the near-miss `:206-212`, FP-guard `:149-157,223-241`, `WEIGHTS_VERSION` golden `:243-247`) stay green as a floor.
5. **Canonicalize the dimension count from the artifact** — there are FOUR live counts (`WEIGHTS`=8 / `scores_by_dim`=9 incl. the programmatic `infra_implicit` / `KEYWORDS`=10 / human-facing docs should say **8 weighted**). Regenerate `:4,:590,:710` from one definition (state whether `counter_signals`/`infra_terms` count as "dimensions" in user-facing text).
6. **Preserve both consumer contracts** — no export rename; `scoreTask(string)→object` intact; `score_total` numerically preserved (the `bucketTaskComplexity` score-value dependency). Document the **memo-cache disposition** (`_keywordRegexCache`/`buildKeywordRegex` — retired vs retained for `detectSubstrateMeta`).
7. **Re-probe the cited line numbers at build-time** — the recon drifted (test count 18→19; the hook path needed the full `kernel/hooks/pre/` prefix), so W1's first step re-confirms each load-bearing `file:line` against the live source before editing.

## HETS Spawn Plan

- **VERIFY (this plan, pre-build):** `architect` (the decomposition soundness — is W1 truly corpus-free + behavior-identical? is the W1/W3 split right for the `experiment` fix? are the OQ resolutions sound?) + `code-reviewer` (the phrase-aware-invert + backward-compat + boundary-validation constraints are correctly specified against the actual `route-decide.js`). Fold → `/verify-plan` record below.
- **W1 BUILD:** TDD — the existing 18 tests are the red/green oracle for behavior-identical; add artifact-validation + phrase-aware-invert edge tests (hyphen/underscore/space-near-miss). One `node-backend` builder (single coupled concern: the scorer + its artifact).
- **W1 VALIDATE:** 3-lens (code-reviewer correctness + the substrate-meta-aware `hacker` for the boundary-validation/fail-closed + honesty-auditor on the behavior-identical claim) over the diff; full gate; PR.
- Later waves (corpus-aug, W2, W3, W4) get their own plans.

## Pre-Approval Verification

2-lens VERIFY board (read-only; 2026-06-19) premise-probed this plan against the live `route-decide.js` + its test file + both consumers. **Verdicts:** architect **READY-WITH-NOTES** · code-reviewer **NEEDS-REVISION** (the W1 contract as-written would let a builder ship a subtly non-identical scorer). The decomposition, wave ORDER, substrate-meta-catch-22 handling, and A4-purity/inference-in-Runtime boundary were all confirmed sound — "the strongest part of the plan." Every finding folded above; the revised W1 contract now closes them.

| ID | Lens | Sev | Finding | Resolution (folded) |
|---|---|---|---|---|
| cr-F1 / arch-F6 | both | HIGH/LOW | the artifact has **4 structural roles**, not 2 (`counter_signals` + `infra_terms` are special-path, not scored) | Constraint + W1-step-1 rewritten to 4 roles; overlap a first-class schema field; artifact-structure tests. |
| arch-F1 / cr-F2,F3,F6 | both | HIGH | "the 19 tests are the oracle" is insufficient — context pass, hyphen-prefix, `compound_weak`-suppression, multi-space all uncovered | W1 oracle = an **old-vs-new equivalence harness over the 763-row log** (corpus-free) + targeted uncovered-path tests. |
| arch-F2 | architect | HIGH | OQ5 is a **score-VALUE** contract (`bucketTaskComplexity` buckets `score_total` vs hardcoded 0.30/0.60); W4 will desync the copies | OQ5 rewritten as score-value; threshold-leak fix = opportunistic-W1 / mandatory-W4-consumer. |
| cr-F4 / arch-F3 | both | HIGH/MED | test count is **19 not 18**; the hook path needs the `kernel/hooks/pre/` prefix | Corrected; W1-step-7 = re-probe every cited `file:line` at build. |
| arch-F4 / cr-F7 | both | MED | OQ4 "fail-closed" was ambiguous — could mean a silent all-root exit-0 | OQ4 made precise: throw → exit≠0, never a fabricated verdict; consumers fail-open-absorb. |
| arch-F5 | architect | MED | the `experiment`-fix framing over-stated corpus dependency | Reframed: DIRECTION (de-dup → `counter_signals`) is decidable now; corpus bounds only the FP blast-radius. Stays W3. |
| cr-F5 / arch-F7 | both | MED/LOW | there are **4** dimension counts (7/8/9/10), not 3 | W1-step-5 canonicalizes from the artifact (docs say 8 weighted). |
| cr-F8 | code-reviewer | LOW | `verdict attestation` (space) is NOT a token; only `verdict-attestation` (hyphen) is | Overlap illustration corrected. |
| cr-F9 | code-reviewer | LOW | the `_keywordRegexCache` disposition is unspecified (`detectSubstrateMeta` still uses it) | W1-step-6 documents the cache decision. |
| arch-F8 | architect | NIT | the 2026-06-01 design-seed doc genuinely does not exist | Probe-flag resolved: 2026-06-02 is the sole seed; the reference struck. |

**Board conclusion:** no CRITICAL; the phase shape is sound and the HIGH findings are all sharpenings of the W1 build contract (now folded). **The plan is build-ready for W1 pending USER approval.** W1 is the corpus-free, behavior-identical foundation; the equivalence harness makes "behavior-identical" an actual guarantee, not an assertion.

## W1 — Build + VALIDATE result (2026-06-19)

**Status: BUILT + 3-lens VALIDATE folded; gate green. Ready for the USER merge gate.**

### What shipped

- **`packages/kernel/_lib/route-lexicon.json`** (NEW) — the lexicon as a versioned DATA artifact (`lexicon_version: v1-2026-06-19`). Four explicit `roles` (8 SCORED dims / `counter_signals` penalty / `infra_terms` lift / `substrate_meta` detection) + a first-class, exact-set-checked `scored_and_detected_overlap` (17 tokens) + per-category `provenance`. Token arrays lifted VERBATIM (diff-verified deep-equal vs the old inline literals before deletion). Lives in `_lib` (not `algorithms/`) per `kernel-algorithms-audit` (the algorithms dir is registered-flat-`.js`-only).
- **`packages/kernel/algorithms/route-decide.js`** (REFACTOR) — loads + schema-validates + compiles the artifact at the A4 boundary, FAIL-CLOSED (typed `LexiconError` -> CLI exit 3 + NO stdout; in-process `scoreTask` throws — never a fabricated verdict; both consumers absorb the loud fail). The per-keyword regex matcher (`buildKeywordRegex`/`matchKeywords`/`_keywordRegexCache`) is RETIRED, replaced by a phrase-aware O(task) run-scan (`compileLexicon`/`matchLowerSet`) keyed by each token's leading word-run. Weights unchanged. Dim-count canonicalized (header + `--help` + manifest summary from `SCORED_DIMENSION_COUNT`); the one user-facing OUTPUT string (`:619` "9 dimensions" = scores_by_dim count) kept verbatim for behavior-identity, disclosed in-code (honesty MEDIUM-1). `loadLexicon` added to exports (flat-list, superset-allowed).
- **`tests/unit/kernel/algorithms/route-decide-lexicon.test.js`** (NEW, 19 tests) — artifact-structure (4 roles + overlap), the boundary rule (multi-space/tab/newline near-miss, hyphen-prefix sub-phrase, case-fold, underscore-unit, slash, space-vs-hyphen), the `--context` pass (3 behaviors), `compound_weak` suppression-by-stakes, and OQ4 fail-closed (absent / malformed / version-mismatch / bad-shape / tampered-overlap -> throw; the REAL CLI exit code -> non-zero + empty stdout).

### Behavior-identical — proven (not asserted)

- **GIT-PINNED equivalence harness: 800/800 FULL-output deep-equal**, old = `git show c40b2a2:...route-decide.js` (derived live from the base ref, provenance-pinned — closes honesty HIGH-1), new = worktree, over 762 real log tasks + 30 synthetic boundary-stressers + force/context/substrate COMBO inputs.
- **Independent adversarial fuzz (VALIDATE/hacker): 108,922 inputs vs a from-scratch re-implementation of the old regex -> 0 divergences** (provenance-independent corroboration).
- 19 pre-existing behavioral tests + 19 new W1 tests green; full kernel suite 82/82; `install.sh --hooks --test` 125/0; the in-process consumer (`bucketTaskComplexity`) preserved (`score_total` numeric, exports intact).

### 3-lens VALIDATE verdicts (read-only personas)

- **code-reviewer — PASS-WITH-NITS** (0 CRITICAL/HIGH/MED): invert fidelity verified per token shape; backward-compat clean. F1 (`WEIGHTS_VERSION` dual-form in output) + F2 (case-sensitive overlap check) — both documented; F1 is pre-existing behavior-identical.
- **hacker — PASS-WITH-NOTES** (0 CRITICAL/HIGH): equivalence fuzz held; every malicious-artifact class -> exit 3 + empty stdout (no fabricated verdict). M1 (matcher worst-case `O(runs x bucket)` unbounded-by-validation — NOT a regression, architect-gated-artifact-only) + L1 (`ROUTE_LEXICON_PATH` steers the advisory reputation bucket) — both documented.
- **honesty-auditor — CLOSEABLE-WITH-NOTES** (Grade B): HIGH-1 (golden provenance) FIXED via the git-pinned harness; MEDIUM-1 (`:619` undisclosed) FIXED via the in-code disclosure. Scope deferrals (threshold-leak -> W4, `experiment` double-count -> W3) confirmed honestly disclosed.

### Deferred (carried, not dropped)

- **Threshold-leak fix** (`trust-scoring.js:126-128` hardcoded 0.30/0.60 -> import `ROUTE/ROOT_THRESHOLD`) — opportunistic-W1 DEFERRED to keep the diff lexicon-focused; **MANDATORY in W4** (the refit desyncs the hardcoded copies). Plan OQ5 carries it.
- **Matcher complexity cap** (hacker M1) — defense-in-depth; the architect-gate is the real bound today. Revisit if the lexicon path becomes attacker-controllable.
- **`ROUTE_LEXICON_PATH` override** (hacker L1) — gate behind a test-only flag or remove when a lab-derived weight first GATES an action (the v3.x-③.2 precondition).
- **`experiment` double-count fix** -> W3 (direction known: de-dup to `counter_signals`; corpus bounds the FP blast-radius).
