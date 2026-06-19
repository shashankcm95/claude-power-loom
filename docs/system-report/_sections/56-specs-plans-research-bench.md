# 56 — Specs: plans, research, bench, spikes, findings, kb-architecture-planning (historical corpus)

## Role

`packages/specs/` is Power Loom's **engineering-record substrate** — the written trail of
how the kernel/runtime/lab tiers were designed, probed, built, and verified. This section
covers six sibling areas (310 tracked files):

- `plans/` (158) — per-wave/per-phase implementation plans; **living, not immutable** (they
  accrete `## Runtime Probes` / `## Pre-Approval Verification` / `## VALIDATE result` /
  `## Phase-close sign-off` as work proceeds). The bulk of the corpus and the spine of the
  v3.x roadmap narrative.
- `research/` (28) — documentary research artifacts (the `/research` lifecycle), the
  Hardening-Track (HT) audit set, plus a handful of **canonical reference docs**
  (`plan-template.md`, `path-reference-conventions.md`, `measurement-methodology.md`).
- `bench/` (62) — the plugin-verification harness (5 scenarios + lifecycle + interactive
  checklist) plus the baseline-vs-TDD experiment log and historical control-run data.
- `spikes/` (42) — empirical harness/kernel probe records + their captured fixtures
  (the firsthand-probe discipline made durable).
- `findings/` (14) — historical chaos-test / orchestration finding logs (H.4–H.7 era).
- `kb-architecture-planning/` (6) — authoring-prep working files for an architectural KB.

Sibling canonical artifacts (`adrs/`, `rfcs/`, `architecture-substrate/`) are out of scope
here; this section is the **non-canonical, mostly-historical** layer. The narrative arc the
set encodes: Hardening-Track (H.x, May) → workspace restructure → v3.0-alpha kernel →
v3.1 runtime → v3.2 decomposition → v3.3–v3.6 Evolution Lab (attribution / reputation /
breaker / manage-proposal) → v3.7–v3.8 ledger/breaker-source → v3.9 retrospective-calibration
bootcamp → v3.10 WHO-built axis → v3.11 experience layer → v-next mock-verified hardening →
phase ③ live-external-PR beta (the current frontier).

## Directory contents & nesting

```text
packages/specs/
├── plans/                         158 files — per-wave/phase plans (living)
│   ├── README.md                  canonical: living-not-immutable contract + frontmatter spec
│   ├── 2026-05-24 … 2026-06-18    ~111 active dated plans (v3.0 → phase ③)
│   └── _archive/                  45 archived plans (H.x Hardening-Track + superseded charter)
├── research/                      28 files
│   ├── README.md / SKILL.md / orchestrator.md / super-agent.md  (process + chaos-orch docs)
│   ├── plan-template.md           CANONICAL plan schema (consumed by validate-plan-schema.js)
│   ├── path-reference-conventions.md / measurement-methodology.md  canonical refs
│   ├── learnings-INDEX.md / thoughts-INDEX.md / HT-state.md / HT.2.5-…  HT-era state
│   └── 2026-05-09 … 2026-06-15    15 dated documentary-research artifacts
├── bench/                         62 files
│   ├── README.md / COVERAGE-MAP.md / EXPERIMENT-LOG.md           canonical harness docs
│   ├── runner.sh / run-all.sh / lifecycle-test.sh / collect.js / _snapshot.js   the harness
│   ├── scenarios/01..05/          5 scenario dirs (task.md + fixture/ + expected.json + validate.js)
│   ├── control-runs/              v2.8.x baseline/treatment metrics + aggregate.py
│   └── portfolio-bleed-2026-05-23/  stray committed k8s test fixtures (see Findings)
├── spikes/                        42 files
│   ├── p-*-findings.md            empirical probe-result records (OQ21 / P-PROV / writescope …)
│   ├── p-oq21-capture.jsonl / p-prov-harness-payload-capture.jsonl   raw probe captures
│   ├── 2026-06-04 … 2026-06-07    dated design/reachability spikes
│   └── fixtures/                  spike input/output fixtures (p1-*.txt, outputs/, scripts)
├── findings/                      14 files — H.4–H.7 chaos/orchestration finding logs (historical)
└── kb-architecture-planning/      6 files — _PRINCIPLES / _TAXONOMY / _NOTES / _SOURCES / _routing + README
```

## Catalog by category

### plans/ — canonical / charter-level (go deep)

- `plans/README.md` — **load-bearing.** Codifies the living-not-immutable contract (a plan
  edit is the workflow, not an immutability violation), the filename convention
  (`YYYY-MM-DD-<slug>.md`), the frontmatter spec (`title` / `plan_id` / `created` / `status` /
  `scope` / `related` / `lifecycle`), and where plans come from (`/plan` vs `/build-plan`).
  Governs how every other file in the dir should be treated; mirrored by `.coderabbit.yaml`
  and the root `CLAUDE.md` to prevent the recurring "you edited an immutable path" false
  positive.
- `plans/2026-06-10-combined-roadmap.md` — **THE canonical forward charter.** `status: accepted`;
  the single sequencing spine for the v3.x+ arc. Produced by a 20-agent adversarial review of
  the Fable-5 plans; `supersedes` the archived `2026-06-10-unified-vision-synthesis.md`. Cited
  by MEMORY.md as "charter". Consumes the shadow-to-live spine + the north-star RFC.
- `plans/2026-06-08-shadow-to-live-beta-roadmap.md` — **the inherited spine** (`status: accepted`,
  USER-approved); the unchanged arc the combined-roadmap wraps. Drives execution from v3.6 W1.
- `plans/2026-06-16-test-phase-live-beta-charter.md` — phase ③ charter (live external-PR beta;
  ③.0 hardening → ③.1 dry-run → ③.2 gated real-PR). The current-frontier governing doc;
  matches MEMORY's "charter #341".
- `plans/2026-06-10-predictive-persona-program.md` — Track-3 (corrected) post-beta parallel
  track; `status: DRAFT` pending review + per-wave gates.

### plans/ — active phase-③ / v-next wave plans (current frontier, mostly recent)

These carry rich in-place `status:` strings (BUILT / VALIDATED / PR-pending) per the living
contract; most are recent (mtime < 14d) so not archive candidates. One-liners:

- `2026-06-18-w4b-async-real-solve.md` — ③.1-W4b: async seam + real `claude -p` solve+grade
  driver (current HEAD work; on branch `feat/w4b-async-real-solve`).
- `2026-06-18-w4-real-run-earned-grounding.md` — ③.1-W4: real-corpus run, earned grounding arm.
- `2026-06-18-w3b-arm-loop-query.md` — ③.1-W3b run+measure layer (BUILT + 3-lens SHIP).
- `2026-06-17-w3-3arm-persona-experiment-harness.md` — ③.1-W3a 3-arm apparatus (VERIFIED/READY).
- `2026-06-17-w2-f7-trace-emitter.md` / `-w2b-close-path-ingester.md` / `-w2-secret-scrub-beta-classes.md`
  — ③.1-W2 trace-emitter (F7) + close-path ingester + secret-scrub beta classes.
- `2026-06-17-w1-kernel-close-path-latency.md` / `-w1-session-reset-deadwrite-and-roadmap-signoff.md`
  — ③.0-W1 close-path latency hardening + dead session-reset removal.
- `2026-06-17-w3-concurrency-and-instruction-honesty.md` / `-w4-tracker-toctou-hardening.md`
  — ③.0 concurrency + per-uid 0700 tracker TOCTOU hardening (both BUILT+VALIDATED).
- `2026-06-17-docker-backend-containeradapter.md` — DockerBackend behind the ContainerAdapter
  seam (`status: DRAFT — pre-VERIFY`; executes untrusted code → 3-lens VALIDATE mandatory).
- `2026-06-16-v-next-trust-hardening-phase.md` / `-mock-verified-hardening-build.md` /
  `-mv-w2-verdict-to-advisory-wire.md` / `-mv-w3-full-isolate-and-burn.md` — v-next
  mock-verified hardening wave set.
- `2026-06-16-fork6-world-anchored-observable.md` / `-carry-c-w1-authenticated-edge-minter.md` /
  `-ab-cobuild-scope.md` — fork-6 world-anchored observable + authenticated-edge-minter (#273
  carry) + A/B co-build scope.
- `2026-06-16-v3.11-bootcamp-corpus.md` (`status: IN-PROGRESS`, multi-session grind) /
  `-v3.11-w3-failed-attempt-capture.md` (VERIFY-board-folded).

### plans/ — v3.0 → v3.11 wave arc (historical-but-active-dir; per-file one-liners)

The roadmap spine in chronological order. All complete/merged; retained in the active dir
(not yet archived). Grouped by phase:

- **v3.0-alpha kernel (May 24–27)**: `2026-05-24-v3.0-multiphase-hets-execution-plan.md`
  (`status: draft` — the original multi-phase execution plan); `2026-05-25-phase-0-workspace-restructure.md`
  - `-v1.md` (duplicate pair — see Findings); `2026-05-27-phase-1-alpha-v3.0-alpha-kernel.md`
  (`status: draft`).
- **v3.1 runtime foundation (May 31 – Jun 02)**: `2026-05-31-phase-2-v3.1-runtime-foundation.md`,
  `-network-egress-audit.md`, `-pr3b-spawn-close-resolver.md`, `-pr3c-enforcing-quarantine-promote.md`;
  `2026-06-01-pr-p1-record-store.md`, `-pr-p2a-producer-primitives.md`, `-pr-p2b-live-shadow-producer.md`,
  `-pr-p2b1-git-timeout-telemetry.md`, `-p3-design-integration-branch.md`, `-p3c-a-stage-candidate.md`,
  `-p3c-b-ordered-integrator.md`, `-pr3c-b-staging-promote.md`; `2026-06-02-p3c-c-minting-followup.md`,
  `-pr4-inv22-idempotency.md`.
- **v3.2 decomposition (Jun 02–04)**: `2026-06-02-v3.2-runtime-decomposition-scope.md`;
  `2026-06-03-v3.2-wave0-k11-a4-gate.md`, `-wave1-decomposition-primitives.md`,
  `-wave2-{k6-retire,r11-spawn-verify,r12-test-runners,r9-leaf-criteria}.md`,
  `-wave3-a4-enforcing-flip.md`; `2026-06-04-v3.2-integration-wave-decompose-run.md`;
  plus the A4-gate hardening pair `2026-06-03-harden-a4-gate-enforcement.md`.
- **v3.3–v3.4 Evolution Lab (Jun 04–07)**: `2026-06-04-v3.3-evolution-lab-foundation-scope.md`,
  `-v3.3-wave1-e1-negative-attestation.md`; `2026-06-04-v3.4-wave{0-determinism,1-evidence-record,
  2-e4-reputation,3-a6-snapshot-mediator,4-e11-circuit-breaker,6-verdict-undarken}.md`;
  `2026-06-05-v3.4-w1-store-hardening.md`; `2026-06-07-v3.4-a6-advise-read-consumer.md`,
  `-v3.4-e11-rescue-verdict-fail-consumer.md`.
- **v3.5 memory-manage (Jun 07–08)**: `2026-06-07-v3.5-memory-manage-scope.md`,
  `-v3.5-wave2-causal-edge-graph-loop.md`; `2026-06-08-v3.5-wave3a-flag-conflict-manage-op.md`,
  `-wave3b-destructive-proposal-scope.md`, `-wave3b1-proposal-store-quarantine.md`,
  `-wave3b2-destructive-proposal-ops.md`.
- **v3.6 manage-lifecycle (Jun 08–10)**: `2026-06-08-v3.6-wave1-manage-lifecycle-consumer.md`,
  `-wave2a-destructive-mint.md`; `2026-06-09-v3.6-wave2b-multitarget-supersede.md`;
  `2026-06-10-v3.6-wave2b2-promote-breaker.md`, `-wave2c-cross-run-mints.md`.
- **v3.7–v3.8 ledger/breaker (Jun 10–13)**: `2026-06-10-v3.7-delta-promote.md`
  (`status: WAVES COMPLETE`); `2026-06-11-v3.8-reject-event-breaker-source.md`;
  `2026-06-12-v3.8a-{route-decide-dictionary-expansion,w3-k4-live-recall,w4-verdict-routine-undarken}.md`,
  `-v3.8b-{w1-e11-graduation-gates,w2-a6-snapshot-provenance,w3-oq21-rung2-calibration}.md`.
- **v3.9 bootcamp (Jun 13–14)**: `2026-06-13-v3.9-w0-corpus-forward-contract.md`,
  `-w1-containeradapter-sandbox-exec.md`, `-w2-three-legged-scorer.md`, `-w3-trajectory-friction.md`,
  `-w4-recall-graph-phase-close.md`; `2026-06-14-v3.9.x-bootcamp-corpus-80.md`,
  `-ab-retrieval-rider-86.md`, `-recall-retrieval-test.md`.
- **v3.10 WHO-built (Jun 14–15)**: `2026-06-14-v3.10-w0-retrieval-foundation.md`;
  `2026-06-15-v3.10-w{1-persona-consumer,2-shared-memory,3-reputation-decision-loop}.md`.
- **v3.11 experience layer (Jun 15)**: `2026-06-15-v3.11-w{1-experience-organ,2-confirmation-gate}.md`.

### plans/ — standalone hygiene / hardening / infra (per-file one-liners)

- `2026-06-02-contract-instinct-binding.md` — instinct→contract binding (COMPLETE, ephemeral).
- `2026-06-02-contracts-validate-env-findings.md` — contracts-validate env findings (COMPLETE, ephemeral).
- `2026-06-02-kb-gaps-single-lens.md` — KB-gap harvest single-lens pass (COMPLETE, ephemeral).
- `2026-06-03-library-catalog-rerot-root-cause.md` — library-catalog re-rot RCA (ephemeral).
- `2026-06-03-phase-close-skill-ghost-tiein.md` — phase-close skill + ghost-protocol tie-in.
- `2026-06-04-...` various carries; `2026-06-07-stabilize-migration-rot.md` — migration-rot stabilization.
- `2026-06-08-consolidate-lab-validators.md` — lab-validator consolidation.
- `2026-06-09-harden-script-resolvers.md` / `-precompact-store-resolver-fix.md` /
  `-registry-roster-fallback-merge.md` — three COMPLETE/ephemeral resolver hardening passes.
- `2026-06-10-low-correctness-chips.md` — standalone hygiene PR (accepted).
- `2026-06-10-skills-currency-sweep.md` — skills-currency sweep (`status: in-progress`, ephemeral).

### plans/_archive/ — 45 archived plans (historical; one-liners by group)

- **Hardening Track HT.0–HT.3 (May 09–11)**: HT.0 master + HT.1 refactor backlog (`HT.1.3`–`HT.1.15`
  — agent-identity split, install-sh extraction, regex compilation, slopfiles pattern, safe-exec
  adoption, etc.); HT.2 doc-lag methodology sweep (`HT.2.1`–`HT.2.5`); HT.3 ADR tier taxonomy
  (`HT.3.1`–`HT.3.3`).
- **H.9.x lint/CI hardening (May 11–12)**: `H.9.0`–`H.9.16` — markdownlint/shellcheck/jsonlint/
  yamllint local-verification, eslint baseline, atomic-write DRY, principles enforcement,
  component-D flip, chaos-findings + drift-notes closure.
- **Misc**: `2026-05-09-H.8.7-batch-h1-h5-chaos-fixes.md`, `2026-05-24-v2.9.1-test3-blockers.md`,
  `2026-06-10-unified-vision-synthesis.md` (the superseded Fable charter, correctly archived;
  survivors absorbed into the combined-roadmap).

### research/ — canonical reference docs (go deep)

- `research/plan-template.md` — **load-bearing canonical.** The plan schema `/build-plan`
  produces and `validate-plan-schema.js` enforces (Tier-1 `## Context` + `## Files To Modify`|`## Phases`
  - `## Verification Probes`; Tier-2 `## Routing Decision` + `## HETS Spawn Plan`). Self-documenting
  with placeholder examples. Consumed by the PostToolUse plan-schema hook and the `/verify-plan` gate.
- `research/path-reference-conventions.md` — canonical path-citation conventions
  (`${CLAUDE_PLUGIN_ROOT}` placeholder semantics, etc.); underpins the CI doc-path gate.
- `research/measurement-methodology.md` — canonical measurement-methodology codification
  (HT.2.1 product); how bench/experiment metrics are to be measured/reported.
- `research/README.md` — the `/research` documentary-artifact contract (frontmatter spec +
  "describe-what-exists, do-NOT-critique" discipline).

### research/ — HT (Hardening-Track) state + audits (historical)

- `research/HT-state.md` — large (925 lines) Hardening-Track running-state ledger (historical).
- `research/HT.2.5-soak-gate-readiness.md` — soak-gate readiness assessment.
- `research/learnings-INDEX.md` — index/contract for an append-only substrate-build learnings log
  (manual, replacing the empirically-broken auto-loop). **Note**: describes a `YYYY-MM-DD-{slug}.md`
  per-learning convention, but the actual dated docs in `research/` are documentary audits, not
  learnings — see Findings (the indexed corpus appears to live elsewhere / be aspirational).
- `research/thoughts-INDEX.md` — index of `/research`-lifecycle thoughts.
- `research/2026-05-09-HT.0.{1-8}-*.md` — the 8-part HT.0 substrate audit (hooks, scripts, slash
  commands, personas/contracts, kb-patterns, skill-md, adr-system, tests/ci, cross-cutting).
- `research/2026-05-26-self-improve-loop-empirically-broken.md` — the diagnosis (0/47 promotions in
  21 days) that retired the auto-loop; cited by MEMORY + the self-improvement rule.

### research/ — persona-depth / recall research (Jun 02–15)

- `2026-06-02-archetype-persona-skillvector-model.md` — archetype→skill-vector model design
  (cited by MEMORY's persona-depth DEFERRED note).
- `2026-06-02-persona-depth-llmwiki-v6-hybrid.md` — the persona-depth/LLM-wiki v6-hybrid design
  (cited by ROUTER-V2 carry + cross-model-review NOT-planned note).
- `2026-06-02-persona-depth-llmwiki-RESEARCH-FINDINGS.md` — the supporting research findings.
- `2026-06-02-persona-instinct-kb-gap-harvest.md` — persona-instinct KB-gap harvest.
- `2026-06-15-recall-graph-experience-layer.md` — recall-graph / experience-layer research (v3.11 input).

### research/ — chaos-orchestration docs (apparently mislocated)

- `research/SKILL.md` — "Chaos Swarm Orchestrator" skill body (multi-persona toolkit pressure-test).
- `research/orchestrator.md` — "Hierarchical Chaos Orchestrator" (HETS consumer).
- `research/super-agent.md` — "Super Agent — top-of-tree consolidator" (HETS root role).
- `research/policy-deviation-003-006-007-hets-challenger-required.md` — HETS challenger-required
  policy deviation record.
- `research/v3.1-v3.2-field-survey-debt.md` — field-survey debt log spanning v3.1→v3.2.

These three (`SKILL.md` / `orchestrator.md` / `super-agent.md`) read as chaos-test/HETS
operational docs, not documentary research; their placement under `research/` is anomalous
(see Findings).

### bench/ — the verification harness (go deep on canonical docs)

- `bench/README.md` — **canonical.** Documents the v2.4.0 scenario-aware harness: quick-start,
  architecture, the 5 scenarios + per-scenario `validate.js`, the two PASS-criteria layers
  (universal + scenario-specific), soft signals, and the coverage summary (~70% auto-verified,
  ~10% headless-impossible). The entry point for running/understanding the bench.
- `bench/COVERAGE-MAP.md` — full feature-coverage matrix (canonical companion to the README).
- `bench/EXPERIMENT-LOG.md` — **canonical experiment record.** Baseline-vs-TDD HETS-methodology
  experiment (hypothesis, design, decision criteria, measurements). Cited by `workflow.md`'s
  TDD-treatment sub-rule as the empirical basis ("spec clarity, NOT rework-loop reduction").
- `bench/runner.sh` / `run-all.sh` / `lifecycle-test.sh` — the runners (single scenario / aggregate
  / session-end + PreCompact hook coverage).
- `bench/collect.js` — metrics extractor + universal checks + dispatch to scenario `validate.js`.
- `bench/_snapshot.js` — `~/.claude/` state capture for pre/post diff.
- `bench/interactive-checklist.md` — manual verification for the 13 interactive slash commands
  (the headless-impossible residual).
- `bench/.gitignore` — ignores `runs/` (per-run transcripts/metrics) + `fixture/todos.json`.
- `bench/scenarios/01..05/` — five scenario dirs, each `task.md` + `fixture/` + `expected.json` +
  `validate.js`: 01 multi-feature-export, 02 security-audit, 03 library-substrate,
  04 hets-routed-plan, 05 error-recovery.
- `bench/control-runs/` — historical baseline/treatment metrics: README, `aggregate.py`,
  `brief.md`, `deps-lock.md`, `extract-run.sh`, `metrics-schema.json`, plus `test3/`,
  `v2.8.2-run1/`, `v2.8.3-run1/`, `v2.8.5-treatment/`, `v2.9.0-snapshots/` (each MANIFEST +
  metrics.json + notes; some with identities-pre / pre-flight-state).
- `bench/plugin-upgrade-over-probe.sh` — plugin-upgrade-over-install probe script.
- `bench/portfolio-bleed-2026-05-23/.../k8s-manifests/{pdb,service}.yaml` — stray committed k8s
  test fixtures (see Findings).

### spikes/ — empirical probe records (load-bearing as evidence)

These make the firsthand-probe discipline durable; several are cited by MEMORY as ground truth.

- `spikes/p-oq21-worktree-observability-findings.md` (+ `p-oq21-capture.jsonl`) — **OQ-21**: can a
  `PostToolUse:Agent` close hook observe the harness worktree. Underpins MEMORY's "Observe, don't
  allocate" invariant (worktreePath/Branch/agentId at close, delta-bearing spawns only).
- `spikes/p-prov-harness-payload-findings.md` (+ `p-prov-harness-payload-capture.jsonl`) — **P-PROV**:
  spawn-payload provenance (no `parent_tool_use_id` at close; every spawn genesis-from-main).
  Underpins ADR-0012 + the `resolve()`-immutable invariant.
- `spikes/p-writescope-findings.md` — Wave-(-1) write-isolation boundary probe (worktree ≠ sandbox;
  absolute-path writes escape). Underpins the `p-writescope` carry.
- `spikes/p-depthone-findings.md` — sub-agent available-tools observations.
- `spikes/p-snapshot-spec.md` — snapshot spec.
- `spikes/phase-1-probes.md` / `v3-entry-probes.md` — phase-1 + v3-entry probe sets.
- `spikes/2026-06-04-v3.3-orchestration-design-spike.md` — v3.3 orchestration design spike.
- `spikes/2026-06-04-v3.4-wave1-decompose-trigger-reachability.md` /
  `-wave1-kernel-shadow-verified-outcome.md` / `-wave3-a6-probe.md` — v3.4 reachability/outcome/A6 probes.
- `spikes/2026-06-07-v3.5-wave1-spikes-oqe-oq27-oq21.md` — v3.5 OQ-E/OQ-27/OQ-21 spike bundle.
- `spikes/wave-neg-1-evidence/` — Wave-(-1) evidence: `p-hookchain-agent-observation.txt`,
  `probe-inject-A-log.json`, `probe-inject-B-log.json` (the `updatedInput`-inert probe data).
- `spikes/fixtures/` — spike inputs/outputs: `p-measure-*` (build-sheet.js / queries.txt / score.js),
  `p-recall-queries.txt`, `p1-1..5.txt`, `p4-run-probe.sh`, and `outputs/` (run captures + answer key).

### findings/ — historical chaos/orchestration logs (one-liners)

All H.4–H.7 era; superseded by current memory/snapshots. No README.

- `CS-6-findings.md` — chaos-sim CS-6 findings.
- `H.4.3-findings.md`, `H.5.7-findings.md` — early chaos findings.
- `H.6.1-orchestration-test-findings.md` / `H.6.1-resume-findings.md` /
  `H.6.9-orchestration-cycle-findings.md` — orchestration test/resume/cycle findings.
- `H.7.0-findings.md` / `H.7.0-prep-self-test-findings.md` / `H.7.1`–`H.7.5-findings.md` — the
  H.7.x finding series.
- `markdownlint-debt-phase-0.md` — phase-0 markdownlint-debt log.

### kb-architecture-planning/ — KB authoring prep (one-liners)

- `README.md` — the planning-area contract (working files, 5-phase workflow, per-session protocol).
  **Note**: the README still describes the directory as living "in `swarm/`" — a stale path from
  the pre-restructure layout (see Findings).
- `_PRINCIPLES.md` — curation criteria + scope rules + quality bar ("read first").
- `_TAXONOMY.md` — target KB tree structure (slots to fill).
- `_NOTES.md` — the "load-bearing memory layer" — pattern notes from source ingestion.
- `_SOURCES.md` — log of sources processed + tier classification.
- `_routing.md` — routing notes for the KB.

## Findings

| Severity | Level | Type | Location | Description |
|---|---|---|---|---|
| MEDIUM | file | smell | `packages/specs/research/plan-template.md` (cross-references §) | **Broken cross-reference paths.** All links use `../commands/build-plan.md`, `../skills/build-plan/SKILL.md`, `../agents/planner.md`, `../rules/core/workflow.md` — from `packages/specs/research/` these resolve to `packages/specs/{commands,skills,agents,rules}/…`, none of which exist. Actual locations post-restructure: `packages/skills/commands/build-plan.md`, `packages/skills/library/build-plan/SKILL.md`, repo-root `agents/planner.md`, `packages/skills/rules/core/workflow.md`. The doc-path CI gate does not scan `packages/specs/research/`, so this rot is silent. |
| MEDIUM | file | smell | `packages/specs/kb-architecture-planning/README.md` (lines 7, 22) | **Stale location prose.** README says working files "live here in `swarm/` (the substrate's working area…)" but they actually live under `packages/specs/kb-architecture-planning/`. Pre-workspace-restructure path drift; the description no longer matches the tree. |
| MEDIUM | file | smell | `packages/specs/plans/2026-05-25-phase-0-workspace-restructure.md` + `…-v1.md` | **Duplicated plan pair.** Two phase-0 workspace-restructure plans (`-v1` suffix) coexist with no frontmatter `status`/`supersedes` to disambiguate which is canonical. Consolidation candidate: mark the superseded one and/or archive. |
| MEDIUM | file | smell | `packages/specs/bench/portfolio-bleed-2026-05-23/examples/orch-test-h6-resume/k8s-manifests/{pdb,service}.yaml` | **Stray committed test fixtures.** Two k8s manifests (the only files under `portfolio-bleed-2026-05-23/`) appear to be leaked output from an old orchestration-resume test (May 23). No README, no harness reference; dead weight in the bench tree. Deletion candidate. |
| LOW | file | smell | `packages/specs/plans/{2026-06-02-contract-instinct-binding,2026-06-02-contracts-validate-env-findings,2026-06-02-kb-gaps-single-lens,2026-06-03-library-catalog-rerot-root-cause}.md` | **Stale ephemeral plans (workspace-hygiene).** Flagged by `scan-stale-artifacts.js` (debt MEDIUM): `lifecycle: ephemeral` + age > 14d, all `status: complete`. Per the workspace-hygiene rule these should `git mv` to `plans/_archive/`. |
| LOW | substrate | smell | `packages/specs/plans/` (frontmatter coverage) | **Frontmatter convention not retroactively applied.** ~60 of ~111 active dated plans have no `status:` and no `lifecycle:` frontmatter (the README spec is recent; older v3.0–v3.5 wave plans predate it). Status is instead encoded ad-hoc in prose. Inconsistent machine-readability for hygiene tooling and audit replay. Low-priority backfill / accept-as-historical. |
| LOW | file | smell | `packages/specs/research/{SKILL.md,orchestrator.md,super-agent.md}` | **Mislocated docs.** These are chaos-test/HETS operational docs (a skill body + two orchestration role docs), not `/research` documentary artifacts. Their home under `research/` is anomalous relative to the README's stated purpose; candidates to relocate (e.g. under a chaos/HETS area) or document the exception. |
| LOW | file | logical-fallacy | `packages/specs/research/learnings-INDEX.md` | **Index-vs-corpus mismatch.** The doc defines an append-only `YYYY-MM-DD-{slug}.md` per-learning convention and says v3.3 Evolution Lab reads it as input, but no such learnings files exist in `research/` (the dated docs there are HT audits + persona research). Either the corpus moved (library/MEMORY absorbed it) or the index is aspirational; the doc does not say which, creating a dangling-reference smell. |
| LOW | substrate | smell | `packages/specs/findings/` | **No README + fully historical.** 14 H.4–H.7-era finding logs with no index and no lifecycle frontmatter; superseded by current MEMORY/library snapshots. Whole directory is a consolidation/archive candidate (it is effectively a frozen historical corpus with no entry-point doc). |
| INFO | substrate | optimization | `packages/specs/plans/` (active dir) | **Large active dir, archive cadence lag.** ~111 dated plans for completed phases (v3.0–v3.11) remain in the active dir; only H.x-era plans are archived. The README's "archive on phase close" discipline is not being applied to the v3.x phases. Bulk-archiving phase-closed wave plans (v3.0–v3.10) would shrink the active set ~3× and sharpen the active-vs-historical signal. |
| INFO | file | smell | `packages/specs/bench/README.md` (header) | **Version-label drift.** README is titled "v2.4.0" and frames the harness against v2.3.0; the project is now at phase ③ (post-3.11). The harness mechanics may still be accurate, but the version framing is stale relative to the current roadmap. Verify the 5-scenario set still matches current hook/agent names before relying on it. |
