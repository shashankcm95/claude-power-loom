# Power Loom (claude-toolkit) — Full-System Research Report

> **Deliverable 1 of the system review.** An exhaustive, evidence-first deep-read of every folder and file in the repository: a per-folder / per-file / per-function map, plus bugs, logical fallacies, and optimization opportunities surfaced at the function, file, component, and substrate levels. Produced 2026-06-18 by a 48-agent orchestration (deep-read → adversarial verification → architect synthesis) over the merged tree at branch `feat/w4b-async-real-solve`.
>
> The per-module deep-reads live under [`_sections/`](_sections/) (36 files, ~7,900 lines). This document is the **synthesis + consolidated findings register + reading guide** over them.

---

## Abstract

Power Loom is a **deterministic state-management substrate for stochastic (LLM) agents** — it wraps non-deterministic agent execution in transaction boundaries and pure-function verification gates so that the *validated, in-scope filesystem delta* (never the model's prose) is the unit of truth. The codebase is **~51,000 lines of JavaScript across 240 modules** (kernel 100 · runtime 40 · lab 100), plus 19 agent personas, 14 slash commands, 9 always-on rule files, 105 skill/KB documents, 26 human-facing docs, 344 specification artifacts, and 239 test files — **1,197 tracked files** in total.

This review parsed all of it. The headline: the substrate is **unusually well-hardened for its stage** — the deep-read found **zero CRITICAL defects** and only **11 HIGH-severity findings** across the whole tree, of which adversarial verification **confirmed 10** (4 remaining HIGH after honest re-rating, 1 refuted). The documented security disciplines (content-address verify-on-read, exact-set authorization, path/symlink/TOCTOU guards, fail-closed hashing, deep-frozen read-backs) are present and correctly implemented in the load-bearing kernel paths. The real risk surface is **(a)** a small number of *enforcement-theater* and *broken-wiring* bugs where a comment claims a behavior the code no longer delivers, and **(b)** one **substrate-wide architectural residual** — *integrity ≠ provenance* — that is safe only as long as every advisory weight stays shadow/narrowing, and which **must** close before the upcoming live external-PR beta lets any weight gate a real action.

---

## Table of contents

1. [Methodology](#1-methodology)
2. [Repository map](#2-repository-map)
3. [How the system comes together (substrate architecture)](#3-how-the-system-comes-together-substrate-architecture)
4. [Integration map (cross-module data & control flow)](#4-integration-map-cross-module-data--control-flow)
5. [Consolidated findings register](#5-consolidated-findings-register)
6. [Per-module section index](#6-per-module-section-index)
7. [Recommended next steps](#7-recommended-next-steps)
8. [Limitations & honesty notes](#8-limitations--honesty-notes)

---

## 1. Methodology

The report was produced by a deterministic multi-agent workflow, not a single pass, so that coverage is exhaustive and the bug-findings are adversarially filtered rather than taken on faith:

- **Phase 1 — Analyze (36 parallel agents).** The 1,197-file tree was decomposed into 36 work-units (28 code clusters + 8 doc/config/test areas). Each agent read **every file in its unit in full**, wrote a section document to [`_sections/`](_sections/) containing a directory tree, a per-file purpose/imports/consumers breakdown, a **per-function table** (name · kind · consumes · writes · state changes), and a findings table — and returned its findings as structured data. Every agent carried this repo's own documented bug-class checklist (exact-set-vs-subset authorization, content-address verify-on-read, integrity ≠ provenance, read-path immutability leaks, path/symlink/TOCTOU, secret-scrub gaps, mock ≠ real-path, async correctness, single-level-glob assumptions).
- **Phase 2 — Verify (adversarial re-probe).** Every `CRITICAL`/`HIGH` finding was handed to an independent `hacker` (security) or `code-reviewer` (correctness) agent instructed to **refute it unless the code concretely supports the claim**, and to re-rate severity honestly. This is how 4 of the 11 HIGH findings were down-rated and 1 was refuted; the GitHub-Actions injection finding was reproduced **end-to-end with a working PoC**.
- **Phase 3 — Synthesize (architect).** A final architect agent read all 36 section files and the confirmed findings to produce the substrate-level architecture narrative, the integration map, and the cross-cutting findings that no single-module review can see.

**Totals:** 48 agents · ~5.9M tokens · 1,009 tool calls · ~39 min wall-clock. **378 findings** were recorded in all (see the register). Severity reflects *post-verification* rating for the HIGH tier and *as-found* rating for MEDIUM and below (those were not individually re-probed — see [§8](#8-limitations--honesty-notes)).

---

## 2. Repository map

Power Loom is a **microkernel in four concentric tiers** with a strict inward-only dependency rule (`lab → runtime → kernel`; never the reverse). Only the kernel is *enforced*; everything outer is best-effort instruction-following.

| Tier | Path | Files (JS) | Responsibility | Trust posture |
|---|---|--:|---|---|
| **1 — Kernel** | `packages/kernel/` | 100 | Enforced hooks + the content-addressed record-store spine + pure transaction primitives. MAJOR-version-protected. | The **only enforced layer** (pure-function gates, no LLM in the blocking path). |
| **2 — Runtime** | `packages/runtime/` | 40 | HETS orchestration: personas, decomposition, verify→test pipeline, the route-decision scorer, the identity/reputation registry. | Best-effort; consumes kernel primitives (the legal inward edge). |
| **3 — Lab** | `packages/lab/` | 100 | The advisory/SHADOW evolution experiments: verdict/negative attestation, reputation, circuit-breaker, manage-proposal, causal-edge + lesson layer, issue-corpus bootcamp, the ③.1 persona-experiment, F7 trace-emitter. | **Advisory only** — reaches the kernel solely via the A6 reputation snapshot. |
| **4 — Skills/agents/rules** | `packages/skills/`, `agents/` | (markdown) | The 19 Agent-tool persona definitions, 14 slash commands, 9 always-on rules, 105 skill/KB docs. | Best-effort discipline (instruction-following). |
| **Specs** | `packages/specs/` | (344 docs) | ADRs (18), RFCs (11), the per-wave plan spine (158), research (28), bench (62), spikes (42), findings (14). | Canonical decision record (ADRs/RFCs immutable; plans living). |
| **Tests** | `tests/` | 239 | 200 `node:assert` unit suites + 13 `smoke-*.sh` shell suites + fixtures. | The pre-push + CI gate. |

**File-type census (tracked):** 486 `.js` · 481 `.md` · 125 `.json` · 26 `.sh` · 24 `.patch` · 21 `.txt` · 5 `.yaml` · 4 `.py`. **Root build/CI substrate:** `install.sh`, `eslint.config.js`, the two `.claude-plugin/` manifests, `packages/kernel/hooks.json` (the hook registration), and three GitHub Actions workflows.

---

## 3. How the system comes together (substrate architecture)

### How Power Loom comes together: four tiers, one spawn lifecycle, one advisory loop, one trust model

Power Loom ("claude-toolkit") is a fault-tolerance layer for probabilistic (LLM-driven) software engineering, organized as four concentric tiers with a strict inward-only dependency rule (`packages/lab` -> `packages/runtime` -> `packages/kernel/_lib`; never the reverse). Only one tier is *enforced*; the rest are best-effort instruction-following. The whole system is currently in a deliberate SHADOW posture — the most consequential machinery records and advises but does not yet gate — converging toward the North-Star of an externally-merged autonomous-SDE PR.

#### Tier 1 — Kernel (the only enforced layer)

The kernel splits into (a) the **enforced hook chain** (`packages/kernel/hooks.json` registers ~27 PreToolUse/PostToolUse/lifecycle scripts the harness runs around every tool call) and (b) the **record-store spine** plus pure primitives under `packages/kernel/_lib/`. The hook chain's job is admission control and observability: `config-guard.js`, `fact-force-gate.js` (Read-before-Edit), `validate-no-bare-secrets.js` (the lone fail-CLOSED gate), `validate-yaml-frontmatter.js`/`validate-kb-doc.js`/`validate-frontmatter-on-skills.js` (write-time schema blocks), `route-decide-on-agent-spawn.js` (advisory routing), and the PostToolUse observers (`spawn-record.js`, `spawn-close-resolver.js`, `kb-citation-gate.js`, `error-critic.js`, `network-egress-audit.js`). Per ADR-0001 every hook fail-soft approves on error so a hook crash never bricks a session.

The spine is the **content-addressed transaction-record store** (`record-store.js`) backed by pure hashing primitives in `transaction-record.js` (`computeTransactionId`/`computePostStateHash`/`computeContentHash`/`computeIdempotencyKey`) over a depth+node-bounded `canonical-json.js`. The load-bearing invariant (INV-22, MERGED #273) is **content-address-verify-on-read**: `loadRecordFile` rejects any record unless its filename txid == its `transaction_id` field == a re-hash of its body (S5-on-read), with a terminal `deepFreeze` of read-back rows. Shared I/O leaves — `atomic-write.js` (tmp+rename + foreign-uid containment), `wal-append.js` (append-only JSONL), `lock.js` (PID file-lock), `deep-freeze.js`, `jsonl-read.js` (bounded) — are the most-reused modules in the whole substrate (40+ call sites each). Around the store sit the K9 promote/journal/path-guard trio, the K14 write-scope quartet, `quarantine-promote.js` (squash a worktree delta into a genesis record via a throwaway temp index, never touching the user's HEAD), `integrate-merge.js`/`integration-record.js`/`reject-event-store.js` (the ordered integrator's primitives), `manage-op-record.js`, and `edge-attestation.js` (an ed25519 signed-edge minter — the partial answer to the standing provenance gap).

#### Tier 2 — Runtime (HETS orchestration, best-effort)

`packages/runtime/orchestration/` is the construction + measurement substrate: ADR management (`adr.js`), the agent-identity/reputation registry (5-module `identity/` split: `registry`/`trust-scoring`/`verdict-recording`/`verification-policy`/`lifecycle-spawn`), the route-decision scorer (`algorithms/route-decide.js`, a deterministic keyword-weighted class-1 advisory), the contract cross-validator (`contracts-validate.js`, ~22 independent validators wired into CI), the verify->decompose pipeline (R9 `leaf-criteria.js` -> R11 `verify/spawn-verify.js` -> R12 `test-runners/node-runner.js`; R6 `trampoline.js` -> R7 `todo-checkpoint.js` -> R10 `budget-tracker.js`), the chaos-aggregate report rollers, and the doctor health-probes. The runtime *consumes* kernel primitives heavily (`record-store.appendRecord`, `transaction-record.compute*`, `runState`, `lock`, `atomic-write`, `path-canonicalize`) — the legal inward direction. It produces real transaction records (the trampoline mints an ABORTED record on budget-exhaust; `decompose-run.js` writes an outbox the lab ingests).

#### Tier 3 — Lab (the advisory/shadow Evolution experiments)

`packages/lab/` is where the trust loop is being *measured before it is enforced*. It has five intertwined sub-systems: (1) **evidence ledgers** — `verdict-attestation/store.js` (records the fact-of-emission of an advisory verdict about a delegated builder spawn, evidence-linked via `agentId`->`transaction_id` by the PULL enricher) and its structural sibling `negative-attestation/store.js` (wraps a frozen ADR-0015 `failure_signature`); (2) **derived trust signals** — `reputation/project.js` (per-persona verdict distribution, materialized off-hot-path into a content-hashed snapshot the kernel spawn-record hook reads O(1) via the A6 contract) and `circuit-breaker/project.js` (a stateless windowed denial-rate breaker, the only lab signal with a live runtime consumer — `manage-proposal/promote.js`); (3) the **manage-proposal** human-disposable op layer (quarantine/dedup/cull/merge proposals, with the one live-mutating path `promote.js` gated behind `LOOM_MANAGE_ENFORCE=1`); (4) the **causal-edge + experience layer** (the lesson taxonomy, capture/confirm/consolidate pipeline, the recall graph, candidate-sidecar, and the issue-corpus bootcamp that clones a stranger's repo, runs its real pytest suite inside Seatbelt/Docker containment, and grades against sealed oracles); and (5) the ③.1 **persona-experiment** (a 3-arm A/B/C apparatus measuring whether earned grounding changes how an agent solves a real issue) plus the F7 **trace-emitter** telemetry spine.

#### Tier 4 — Skills / agents / rules (best-effort discipline)

`agents/*.md` are the Agent-tool persona definitions — Layer 1 of the canonical, do-not-dedup 3-layer split (`agents/<name>.md` capability floor -> `runtime/personas/NN-<name>.md` identity brief -> `contracts/NN-<name>.contract.json` verification checks). Per ADR-0012 the agent frontmatter `tools:` is the single source of capability truth (statically honored; `contract-verifier.js` + `contracts-validate.js` reconcile it). `packages/skills/` holds the always-on rule SOURCE, slash commands, and the KB the architect persona cites.

#### The spawn lifecycle (route-decide -> spawn -> contract -> close-path resolver -> integrator -> record-store)

A non-trivial task first hits `route-decide.js` (orchestrator-driven, also fired advisorily by the `route-decide-on-agent-spawn.js` hook) which recommends route/borderline/root. On `route`, a persona is spawned via the Agent tool; its `tools:` floor and contract are statically resolved (ADR-0012: a PreToolUse `updatedInput` is INERT on Agent spawns, so the `contract-reminder-on-agent-spawn.js` prompt-mutation never reaches the sub-agent — the real binding is the static agent.md). The harness allocates an `isolation:worktree`; at `PostToolUse:Agent` close, `spawn-record.js` captures a bounded, secret-scrubbed envelope (embedding the lab reputation snapshot as a read-only axiom) and `spawn-close-resolver.js` OBSERVES the worktree (OQ-21: `tool_response.worktreePath`/`worktreeBranch`/`agentId` appear only for delta-bearing spawns), runs the kernel `resolve()` decision spine (`post-spawn-resolver.js`: INV-20 closure -> K14 write-scope -> K9 promote dispatch -> K13 release) in SHADOW, and records read-only provenance into the content-addressed store. The human-gated ordered `integrator.js` (invoked only via `integrate-cli.js`, never a hook) folds candidate deltas onto `loom/integration` with one terminal CAS, minting chained provenance records or content-addressed reject-events. The whole chain bottoms out in the record-store, which everything else reads.

#### The advisory evolution loop (trace -> lesson/causal-edge -> attribution/reputation -> persona-experiment)

The F7 trace-emitter records a per-run timeline (digests, never raw content). A delegated build's verdicts are recorded (workflow Rule 4) into `verdict-attestation`, enriched to a kernel `transaction_id`, projected by `reputation/project.js`, and materialized into the A6 snapshot the next spawn reads. The issue-corpus bootcamp + recall-graph populate worked-example nodes; `lesson-capture`/`lesson-confirm`/`lesson-consolidate` turn graded attempts into a hazard->predictor lesson lane (the `(failure,lesson)--confirmed-by-->(delta)` edge). The persona-experiment's grounding-slice renders confirmed lessons back into arm C's prompt. None of these gate — they NARROW a future decision; per OQ-NS-6 only a world-anchored merge HARDENS trust.

#### The trust model (integrity vs provenance; shadow/advisory vs enforced)

The recurring, codified discipline across every store is **integrity != provenance** (the #273 family, third face). Every content-addressed store (`record-store`, `reject-event-store`, `verdict-attestation`, `negative-attestation`, `causal-edge/store`, `manage-proposal/store`, the three attribution stores, the authorship/hardening-signal stores) verifies that a record is self-CONSISTENT on read (re-derive the content-address, re-hash the body). NONE of them — except the ed25519 `edge-attestation` signed lane — authenticate the legitimate PRODUCER. In an open-writable `$LOOM_LAB_STATE_DIR`, any same-uid writer can CO-FORGE a byte-indistinguishable record via the same exported derivation functions, inflating an advisory weight. This is tolerable *today* precisely because every such weight is SHADOW/advisory and gates nothing (the monotonic-narrowing safety argument: a forged signal can only over-halt, never grant). The moment any weight gates a real action, an authenticated minter (the signed/kernel-owned writer) becomes mandatory — the system knows this, names the exit, and is staging `edge-attestation` toward it.

---

## 4. Integration map (cross-module data & control flow)

### Cross-module data/control flow

#### Record-store: who writes, who reads

**Writers (4 live producers, all SHADOW-gated)**: `hooks/post/spawn-close-resolver.js` (read-only provenance on COMPLETED+clean spawns), `spawn-state/stage-candidate.js` (`LOOM_STAGE_CANDIDATES`), `spawn-state/integrator.js` (chained integration records), and `runtime/orchestration/trampoline.js` (ABORTED budget-exhaust records). Plus the kernel manage-mint via `lab/manage-proposal/promote.js` (`LOOM_MANAGE_ENFORCE`). All go through `appendRecord` which content-address-verifies and INV-22-dedups.

**Readers**: kernel `record-locate.js`/`record-scan.js`/`provenance-walk.js`/`provenance-projections.js`/`route-decide.js`; runtime `trampoline.js`/`decompose-run.js`; lab `manage-proposal/{promote,crossrun-load,lifecycle,recall-suppression}.js`, `verdict-attestation/enrich-from-spawn-state.js` (reads the kernel resolver-journal as a DATA file, never imports kernel state — the canonical K12 PULL boundary).

#### Satellite ledgers and the A6 cross-layer contract

`reject-event-store` (written by the integrator, scanned by `record-scan.js` for the circuit-breaker). The A6 reputation snapshot is the one place a lab signal crosses INTO the kernel hot path: `lab/reputation/materialize.js` writes a content-hashed snapshot at `evolution-snapshot-read.resolveSnapshotPath()`; the kernel `spawn-state/spawn-record.js` reads it O(1) as a file (write-then-witness provenance via `appendSnapshotWitness`). Writer and reader share one path/hash formula in `kernel/_lib/evolution-snapshot-read.js` so they cannot drift.

#### hooks.json wiring (event -> script -> role)

- **SessionStart**: `session-reset.js` (stale-tracker sweep), `catalog-reconcile-session.js` (drift backstop — the one lifecycle hook that mutates the library catalog).
- **UserPromptSubmit**: `prompt-enrich-trigger.js` (vagueness gate). (Note: `session-self-improve-prompt.js` is NOT wired — dead-in-substrate despite an active-behavior docstring.)
- **PreToolUse**: `redirect-plan-mode-in-headless.js` (EnterPlanMode deny), `verify-plan-gate.js` (ExitPlanMode), `route-decide-on-agent-spawn.js` + `contract-reminder-on-agent-spawn.js` (Agent|Task), `fact-force-gate.js` (Read|Edit|Write), `config-guard.js` + 5 validators (Edit|Write), `validate-config-redirect.js` (Bash).
- **PostToolUse**: `error-critic.js` + `network-egress-audit.js` (Bash), `kb-citation-gate.js` + `spawn-record.js` + `spawn-close-resolver.js` (Agent|Task), `validate-plan-schema.js` + `catalog-reconcile-write.js` (Edit|Write).
- **PreCompact**: `pre-compact-save.js`. **Stop**: `console-log-check.js`, `auto-store-enrichment.js`, `session-end-nudge.js`, `context-size-warn-stop.js` (last).

#### Runtime consumes kernel; lab consumes runtime+kernel

Runtime imports kernel `_lib` (record-store, transaction-record, runState, lock, atomic-write, path-canonicalize, frontmatter, toolkit-root, kernel-algorithms-audit). Lab imports kernel `_lib` directly (atomic-write, deep-freeze, canonical-json, jsonl-read, lock, path-canonicalize, enum-validate, free-string-checks, edge-attestation, provenance-walk/projections, record-store/locate, evolution-snapshot-read) AND reads runtime/kernel state as DATA files (the decompose-run outbox, the spawn-state journal). The one inverted edge is a bug: `kernel/validators/contract-verifier.js:766` reaches UP into `runtime/orchestration/identity/lifecycle-spawn` (and the path is broken — always MODULE_NOT_FOUND).

#### SHADOW vs LIVE seams

**LIVE (enforced)**: the PreToolUse validator gates (`validate-no-bare-secrets` fail-closed; config/frontmatter/kb-doc blocks); `fact-force-gate`; the CI gate set; the route-decide advisory. **SHADOW (records, does not gate)**: the entire spawn-close resolver path (default OFF behind `LOOM_RESOLVER_ENFORCE`/`LOOM_STAGE_CANDIDATES`), the integrator (human-CLI only), all reputation/breaker/verdict/negative-attestation/causal-edge/manage-proposal/persona-experiment/trace machinery, the A6 snapshot read (advisory axiom). **DORMANT (built, unit-tested, zero production importer)**: `context-envelope.js` (K3.b, CI-asserted dormant), `worktree-allocator.js` (K1, CI-asserted dormant), `k13-serial-enforcer.js`'s admission hook, `lineage.js` (dead code with a stale "Used by K9" header), `weight-source-gate.js` + `item-source.js` (signed-lane, prod `LIVE_SOURCES` frozen-empty), `reputation-gate.js` (no production consumer). The two legacy install manifests (`settings-reference.json` vs `hooks.json`) have drifted: the legacy path wires ~11 hooks vs the canonical ~27, plus a non-existent hook — a materially weaker chain.

---

## 5. Consolidated findings register

### 5.1 Rollup

**378 findings** total — **0 CRITICAL · 11 HIGH · 82 MEDIUM · 166 LOW · 119 INFO.**

| By type | n | | By level | n |
|---|--:|---|---|--:|
| bug | 52 | | function | 198 |
| logical-fallacy | 23 | | file | 112 |
| security | 15 | | component | 34 |
| optimization | 61 | | substrate | 34 |
| smell | 227 | | | |

> **Reading the register.** The HIGH tier below carries *post-verification* corrected severity. MEDIUM and LOW/INFO are *as-found* (the section files hold the full per-finding detail with line numbers). "Level" answers the user's framing directly: `function` / `file` / `component` / `substrate`.

### 5.2 HIGH-severity findings (adversarially verified)

All 11 originally-HIGH findings, each independently re-probed. Four hold at HIGH; the rest were honestly down-rated or refuted.

| Corrected | As-found | Verdict | Module | Type | Location | Finding |
|---|---|---|---|---|---|---|
| **HIGH** | HIGH | confirmed | `18-kernel-hooks-pre-post` | logical-fallacy | `packages/kernel/hooks/pre/contract-reminder-on-agent-spawn.js:25-44,289-300` | contract-reminder hook depends on updatedInput prompt-mutation that ADR-0012 proved inert on Agent spawns |
| **HIGH** | HIGH | confirmed | `19-kernel-validators` | bug | `packages/kernel/validators/contract-verifier.js:766` | contract-verifier requires a module path that never resolves; persona-md drift wiring is dead |
| **HIGH** | HIGH | confirmed | `22-runtime-identity-aggregate-probes` | bug | `packages/kernel/validators/contract-verifier.js:766` | Broken cross-tier require silently dead-codes persona-.md SynthId drift |
| **HIGH** | HIGH | confirmed | `40-scripts-and-bin` | bug | `scripts/refresh-skill-status.js:26-28` | refresh-skill-status.js points at three v4-deleted directories and crashes on every run |
| **MEDIUM** | HIGH | confirmed | `22-runtime-identity-aggregate-probes` | bug | `packages/runtime/orchestration/doctor/probes/partition-sentinel.js:22-23` | partition-sentinel probe checks a path that diverges from the canonical sentinel |
| **MEDIUM** | HIGH | confirmed | `3a-lab-verdict-negative-attestation` | bug | `packages/lab/verdict-attestation/store.js:336 and packages/lab/negative-attestation/store.js:226` | Read-back immutability leak: listVerdicts/listAttestations return unfrozen parsed rows |
| **MEDIUM** | HIGH | confirmed | `41-root-config-ci-install` | security | `.github/workflows/auto-release-on-tag.yml:104` | GitHub Actions script injection via tag annotation in auto-release |
| **MEDIUM** | HIGH | refuted | `57-tests-coverage` | smell | `tests/unit/runtime/ (absent) vs packages/runtime/orchestration/*.js` | Runtime orchestration engine core untested under tests/ (only in-package \_h70-test.js) |
| **LOW** | HIGH | confirmed | `35-lab-reputation-breaker` | logical-fallacy | `packages/lab/circuit-breaker/project.js:118-127` | No enrichment gate on the breaker's default verdict-fail source (asymmetric with reputation) |
| **LOW** | HIGH | confirmed | `54-docs-tree` | bug | `docs/reference/project-structure.md` | project-structure.md documents the pre-v3 flat layout |
| **LOW** | HIGH | confirmed | `54-docs-tree` | smell | `docs/development/README.md` | development/README.md cites non-existent flat paths + stale CI prose |


**Detail (with verifier rationale):**

#### contract-reminder hook depends on updatedInput prompt-mutation that ADR-0012 proved inert on Agent spawns

- **As-found / corrected severity:** HIGH → **HIGH** · **verification verdict:** confirmed
- **Type / level:** logical-fallacy / file · **Module:** `18-kernel-hooks-pre-post`
- **Location:** `packages/kernel/hooks/pre/contract-reminder-on-agent-spawn.js:25-44,289-300`
- **What it is:** The hook's entire enforcement mechanism — mutating the sub-agent prompt via hookSpecificOutput.updatedInput.prompt — is inert on Agent/Task spawns per accepted ADR-0012 (two claude -p probes: the sub-agent ran the ORIGINAL prompt, rewrites not honored). The header still claims 'deterministic compliance' and the hook is registered + actively firing at hooks.json:76. Same dead-mechanism class that retired pre-spawn-tool-mask. Net effect: a registered, log-writing hook whose load-bearing side effect never reaches the harness — enforcement theater. Reduce to observability-only or remove.
- **Verifier (adversarial re-probe):** The finding is confirmed by firsthand reading of three artifacts. ADR-0012 (packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md, lines 36-44) documents two empirical claude -p probes that proved updatedInput.prompt is INERT on Agent/Task spawns — the sub-agent ran the ORIGINAL prompt, not the hook's replacement. The ADR has status: accepted and is unambiguous: "a PreToolUse hook's updatedInput is INERT for Agent/Task spawns." The hook at packages/kernel/hooks/pre/contract-reminder-on-agent-spawn.js lines 289-300 emits exactly this mechanism: [code] The hook header (lines 3-4, 19-23) still asserts "DETERMINISTIC contract enforcement via prompt mutation" and claims the sub-agent will "literally see the reminder as part of its initial task — deterministic compliance." This claim is directly falsified by ADR-0012's empirical probes. packages/kernel/hooks.json li …

#### contract-verifier requires a module path that never resolves; persona-md drift wiring is dead

- **As-found / corrected severity:** HIGH → **HIGH** · **verification verdict:** confirmed
- **Type / level:** bug / function · **Module:** `19-kernel-validators`
- **Location:** `packages/kernel/validators/contract-verifier.js:766`
- **What it is:** require('./identity/lifecycle-spawn') resolves relative to packages/kernel/validators/, but the module actually lives at packages/runtime/orchestration/identity/lifecycle-spawn.js. The require always throws MODULE\_NOT\_FOUND (confirmed by probe); the catch returns null, so \_agentMd is permanently null. The comment at lines 762-763 (persona .md changes now participate in drift detection) is not true in the code — the Phase-0 kernel-side move broke the sibling-relative path and validateSuffix never sees agentMd. Premise-not-probed plus comment-contradicts-code.
- **Verifier (adversarial re-probe):** The claim is confirmed by direct code inspection and filesystem probing. /packages/kernel/validators/contract-verifier.js:766 contains: [code] require with a relative path resolves relative to the requiring file's directory: packages/kernel/validators/. The path packages/kernel/validators/identity/ does not exist — the directory is absent entirely. The actual module is at packages/runtime/orchestration/identity/lifecycle-spawn.js. Filesystem probe confirms this: - ls packages/kernel/validators/identity/ → No such file or directory - find packages/ -name lifecycle-spawn.js → packages/runtime/orchestration/identity/lifecycle-spawn.js only The require therefore always throws MODULE\_NOT\_FOUND. The catch at line 768 silently swallows it and returns null, so \_agentMd is permanently null at runtime. \_agentMd flows into validateSuffix → computeContentHash at /packages/kernel/\_lib/synthid.js …

#### Broken cross-tier require silently dead-codes persona-.md SynthId drift

- **As-found / corrected severity:** HIGH → **HIGH** · **verification verdict:** confirmed
- **Type / level:** bug / function · **Module:** `22-runtime-identity-aggregate-probes`
- **Location:** `packages/kernel/validators/contract-verifier.js:766`
- **What it is:** require('./identity/lifecycle-spawn') resolves against packages/kernel/validators/, where no identity/ dir exists (verified absent). Wrapped in try/catch returning null, so \_readPersonaMd never loads and agentMd is always null — the persona-.md drift branch the v2.8.0.x MEDIUM-1 fix added is dead in this path, and the adjacent comment claiming persona .md participates in drift detection is false. Correct path: ../../runtime/orchestration/identity/lifecycle-spawn.
- **Verifier (adversarial re-probe):** The finding is confirmed by firsthand code inspection. At /packages/kernel/validators/contract-verifier.js:766, the require path './identity/lifecycle-spawn' resolves against the validators directory (packages/kernel/validators/), where no identity/ subdirectory exists — confirmed by ls showing only .js files at that level and a repo-wide find for any identity/ directory under packages/kernel returning nothing. The real module lives at packages/runtime/orchestration/identity/lifecycle-spawn.js and exports \_readPersonaMd at line 566. The correct relative path from the validators directory is ../../runtime/orchestration/identity/lifecycle-spawn (confirmed by path arithmetic). The IIFE at lines 764-769 wraps the require in try { ... } catch { return null; }, so the MODULE\_NOT\_FOUND error is silently swallowed on every invocation and \_agentMd is always null. The comment at lines 762-763  …

#### refresh-skill-status.js points at three v4-deleted directories and crashes on every run

- **As-found / corrected severity:** HIGH → **HIGH** · **verification verdict:** confirmed
- **Type / level:** bug / file · **Module:** `40-scripts-and-bin`
- **Location:** `scripts/refresh-skill-status.js:26-28`
- **What it is:** CONTRACTS\_DIR/SKILLS\_DIR/COMMANDS\_DIR resolve to swarm/personas-contracts, skills/, commands/ — all removed in the v4 restructure (now packages/runtime/contracts/, packages/skills/library/, packages/skills/commands/). main() calls fs.readdirSync(CONTRACTS\_DIR) unguarded, throwing an uncaught ENOENT on every invocation (verified). The script is dead-on-arrival; the drift it closes is no longer wired anywhere. This is the exact doc/path-rot class validate-doc-paths.js was built to catch, but that gate only scans docs, not scripts/\*.js.
- **Verifier (adversarial re-probe):** The finding is confirmed by direct execution and code inspection. Three factual claims all hold: 1. \*\*Paths are stale.\*\* Lines 26-28 of /Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/scripts/refresh-skill-status.js set: - CONTRACTS\_DIR = path.join(REPO\_ROOT, 'swarm', 'personas-contracts') — directory does not exist - SKILLS\_DIR = path.join(REPO\_ROOT, 'skills') — directory does not exist - COMMANDS\_DIR = path.join(REPO\_ROOT, 'commands') — directory does not exist The v4-restructured canonical paths (packages/runtime/contracts/, packages/skills/library/, packages/skills/commands/) all exist and contain files. 2. \*\*Hard crash on every invocation.\*\* main() at line 89 calls fs.readdirSync(CONTRACTS\_DIR) with no existsSync guard. Running node scripts/refresh-skill-status.js --check produces an uncaught ENOENT with a non-zero exit code. This was empirically verifi …

#### partition-sentinel probe checks a path that diverges from the canonical sentinel

- **As-found / corrected severity:** HIGH → **MEDIUM** · **verification verdict:** confirmed
- **Type / level:** bug / function · **Module:** `22-runtime-identity-aggregate-probes`
- **Location:** `packages/runtime/orchestration/doctor/probes/partition-sentinel.js:22-23`
- **What it is:** Probe hard-codes sentinel ~/.claude/library/sections/agents/stacks/identities/.partition-complete and consolidated ~/.claude/agent-patterns.json, but registry.\_isBulkheadActive() and pattern-recorder.js both call libraryPaths.partitionSentinelPath() = ~/.claude/library/.partition-complete. The probe reports sentinel:absent even when bulkhead mode is genuinely active and never sees a real sentinel; should call libraryPaths.partitionSentinelPath()/persona-store.isPartitioned instead of re-deriving paths.
- **Verifier (adversarial re-probe):** The path divergence is real and concrete. The probe at /packages/runtime/orchestration/doctor/probes/partition-sentinel.js:22 hardcodes: [code] This resolves to ~/.claude/library/sections/agents/stacks/identities/.partition-complete. The canonical partitionSentinelPath() in /packages/kernel/\_lib/library-paths.js:196-198 returns: [code] Both registry.\_isBulkheadActive() (registry.js:65-68) and pattern-recorder.\_isBulkheadActive() (pattern-recorder.js:45-48) call libraryPaths.partitionSentinelPath() — they check ~/.claude/library/.partition-complete. The probe checks a path five directory levels deeper than the file that is actually written and that the runtime actually reads. The sentinel will never exist at the hardcoded path on any correctly migrated install, so the probe will always report sentinel:absent / emit a spurious WARN even when bulkhead mode is genuinely active. The claim  …

#### Read-back immutability leak: listVerdicts/listAttestations return unfrozen parsed rows

- **As-found / corrected severity:** HIGH → **MEDIUM** · **verification verdict:** confirmed
- **Type / level:** bug / component · **Module:** `3a-lab-verdict-negative-attestation`
- **Location:** `packages/lab/verdict-attestation/store.js:336 and packages/lab/negative-attestation/store.js:226`
- **What it is:** readLedger -> readJsonlBounded returns raw JSON.parse objects with no freeze; the Object.freeze in recordVerdict/recordAttestation only protects the write-path return, never records read back from disk. listVerdicts/listAttestations hand consumers fully-mutable rows (incl. nested evidence\_refs, subject, verifier, failure\_signature, identity.tags). Current consumers are read-only, but any future consumer mutating a returned row corrupts the in-process ledger view. This is the documented #266 read-back-immutability class the repo's testing rule mandates covering.
- **Verifier (adversarial re-probe):** The claim is confirmed by direct firsthand reading of the code. The asymmetry is real and precisely located. Write-path: recordVerdict (verdict-attestation/store.js:214-228) constructs its record with nested Object.freeze calls on subject, verifier, and evidence\_refs. recordAttestation (negative-attestation/store.js:180-193) does the same for identity. Both return frozen objects. Read-path: listVerdicts (store.js:336) and listAttestations (negative-attestation/store.js:226) both call readLedger(), which calls readJsonlBounded(). The terminal return in readJsonlBounded (jsonl-read.js:127-129) is: [code] JSON.parse returns fully mutable plain objects. No freeze is applied at any layer between JSON.parse and the caller. The existing immutability test (store.test.js:210-215) only validates the write-path return from recordVerdict — it does not test that a row recovered via listVerdicts is f …

#### GitHub Actions script injection via tag annotation in auto-release

- **As-found / corrected severity:** HIGH → **MEDIUM** · **verification verdict:** confirmed
- **Type / level:** security / file · **Module:** `41-root-config-ci-install`
- **Location:** `.github/workflows/auto-release-on-tag.yml:104`
- **What it is:** TITLE="${{ steps.title.outputs.title }}" (and TAG="${{ steps.tag.outputs.tag\_name }}" at :102) interpolate an expression derived from a freeform git tag annotation first line directly into the run: shell. A pushed tag whose annotation begins with '"; <cmd>; "' escapes the quoted assignment and runs arbitrary shell in a job holding contents:write + GITHUB\_TOKEN. Fix: pass via env: and reference "$TITLE" instead of ${{ }} in the script body. Canonical GHA injection anti-pattern.
- **Verifier (adversarial re-probe):** CONFIRMED — genuine GitHub Actions script injection (CWE-94, the canonical untrusted-input-into-run: anti-pattern). The vulnerable chain in .github/workflows/auto-release-on-tag.yml: (1) line 63 ANNOTATION=$(git for-each-ref --format='%(contents)' "refs/tags/$TAG\_NAME") pulls the freeform, attacker-controlled tag annotation verbatim; (2) line 87+92 extract its first non-blank line into TITLE with NO sanitization (FIRST\_LINE=$(grep -m1 -v '^[[:space:]]\*$' "$FILE"), then TITLE="$TAG — ${FIRST\_LINE#...}"); (3) line 94 writes it to $GITHUB\_OUTPUT; (4) the CITED SINK at line 104, TITLE="${{ steps.title.outputs.title }}", performs GHA expression substitution which is TEXTUAL at template-compile time, before the shell parses the script — so a payload "; <cmd>; " breaks out of the quoted assignment. The job holds contents:write (line 26) + GH\_TOKEN (line 99), so the injected commands run w …

#### Runtime orchestration engine core untested under tests/ (only in-package \_h70-test.js)

- **As-found / corrected severity:** HIGH → **MEDIUM** · **verification verdict:** refuted
- **Type / level:** smell / component · **Module:** `57-tests-coverage`
- **Location:** `tests/unit/runtime/ (absent) vs packages/runtime/orchestration/*.js`
- **What it is:** ~24 orchestration-engine modules (aggregate, budget-tracker, tree-tracker, pattern-recorder, doctor, weight-fit, kb-resolver, spawn-recorder, identity/\*) have no \*.test.js under tests/. They are covered only by packages/runtime/orchestration/\_h70-test.js, which the four tests/-rooted CI jobs (find tests/unit/runtime) do NOT discover. A regression in that runner's wiring would pass the documented runtime gate. Either include \_h70-test.js in CI discovery or document it as the canonical engine gate.
- **Verifier (adversarial re-probe):** The finding's central claim is factually wrong on two counts, and the severity is overstated. CLAIM 1 — "only covered by \_h70-test.js, which the CI jobs do NOT discover": Wrong. tests/unit/runtime/ exists with 17 test files. The CI runtime-contracts-tests job (ci.yml line 240) runs find "$GITHUB\_WORKSPACE/tests/unit/runtime" -name '\*.test.js' recursively — it discovers all 17. Modules like budget-tracker.js (4 unit refs, budget-tracker-depth.test.js directly imports it), trampoline.js (6 unit refs), doctor.js (6 unit refs in tests/unit/scripts/), contracts-validate.js (9 unit refs), aggregate.js/hierarchical-aggregate.js (2 unit refs each via leaf-criteria.test.js), and registry.js (15 unit refs) all have test coverage that CI runs. CLAIM 2 — "\_h70-test.js is the only coverage for ~24 modules": Wrong. \_h70-test.js covers only agent-identity.js (plus route-decide-export, frontmatter, …

#### No enrichment gate on the breaker's default verdict-fail source (asymmetric with reputation)

- **As-found / corrected severity:** HIGH → **LOW** · **verification verdict:** confirmed
- **Type / level:** logical-fallacy / component · **Module:** `35-lab-reputation-breaker`
- **Location:** `packages/lab/circuit-breaker/project.js:118-127`
- **What it is:** The verdict-fail source .list wraps listVerdicts({filter: fail}) in dedupBySubject but applies NO transaction\_id != null (INV-W1) filter. projectReputation (reputation/project.js:90) DROPS un-enriched rows; the breaker counts them. recordVerdict only requires a non-empty agentId STRING (verdict-attestation/store.js:152), never that it resolve to a real spawn, so a detached/backtest fail feeds the DEFAULT breaker and can OVER-halt a live persona. Documented as the v3.9-bootcamp CRITICAL and deferred, not fixed. Narrowing-safe (over-halt only) but the two trust signals disagree on what counts.
- **Verifier (adversarial re-probe):** The asymmetry is real and confirmed by direct code reads. Evidence confirming the finding: 1. Breaker source (circuit-breaker/project.js:124-126) — the verdict-fail list function applies no transaction\_id != null guard: [code] 2. Reputation projection (reputation/project.js:89-94) — explicitly enforces INV-W1, dropping any row where refs.transaction\_id == null (unenriched records). 3. Store write path (verdict-attestation/store.js:220-225) — transaction\_id is always written as null; enrichment is a separate out-of-band step. So any fail record that has not been enriched (backtest rows, hand-written rows, records whose enricher run failed) has transaction\_id: null and will be counted by the breaker but excluded by reputation. 4. recordVerdict validates only that agentId is a non-empty string (store.js:151-153) — it never verifies the agentId resolves to a live kernel spawn. A caller c …

#### project-structure.md documents the pre-v3 flat layout

- **As-found / corrected severity:** HIGH → **LOW** · **verification verdict:** confirmed
- **Type / level:** bug / file · **Module:** `54-docs-tree`
- **Location:** `docs/reference/project-structure.md`
- **What it is:** Pre-v3 flat layout (rules/, hooks/scripts/, commands/, skills/, swarm/personas/, scripts/agent-team/) replaced by ADR-0008; five top-level dirs gone, all counts v2.x-era vs live.
- **Verifier (adversarial re-probe):** The claim is confirmed by firsthand evidence. /Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/docs/reference/project-structure.md (lines 8-42) documents a flat pre-v3 layout: top-level rules/, hooks/scripts/, commands/, skills/, swarm/personas/, and scripts/agent-team/. All six of these paths are confirmed MISSING in the live repo. ADR-0008 (accepted 2026-05-26, at packages/specs/adrs/0008-\*.md) introduced the pnpm workspace layout that replaced them with packages/kernel/, packages/runtime/, packages/lab/, packages/skills/, and packages/specs/. The content now lives at e.g. packages/skills/rules/, packages/kernel/hooks/, packages/skills/commands/, packages/runtime/personas/. Git log shows the file was last touched at 2693c32 (a v2.0.1 hotfix), well before ADR-0008 landed. The severity should be downgraded from HIGH to LOW: this is stale reference documentation with zero i …

#### development/README.md cites non-existent flat paths + stale CI prose

- **As-found / corrected severity:** HIGH → **LOW** · **verification verdict:** confirmed
- **Type / level:** smell / file · **Module:** `54-docs-tree`
- **Location:** `docs/development/README.md`
- **What it is:** Cites gone build-plan/plan-template/agent-team paths; CI prose stale (markdown-lint excludes, '12/12 hook tests').
- **Verifier (adversarial re-probe):** The finding is confirmed on both sub-claims, but the original HIGH severity is over-rated for what is purely documentation rot with no runtime impact. \*\*Sub-claim 1 — stale paths (confirmed, 5 broken links):\*\* All four Plan-mode tooling links in /Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/docs/development/README.md resolve to non-existent files: - Line 8: ../../commands/build-plan.md — path does not exist - Line 9: ../../skills/build-plan/SKILL.md — path does not exist - Line 10: ../../swarm/plan-template.md — path does not exist - Line 11: ../../skills/agent-team/patterns/plan-mode-hets-injection.md — path does not exist - Line 31: ../../skills/agent-team/BACKLOG.md — path does not exist These paths were not moved; they are simply absent from the current tree. \*\*Sub-claim 2 — stale CI prose (confirmed, partially):\*\* Line 18 reads: smoke — runs 'bash install.sh …


### 5.3 Substrate-level findings (cross-cutting — no single-module review can see these)

These come from the architect synthesis over all 36 sections. They are the most important part of the report for "how the whole system comes together."


#### [HIGH] Integrity != provenance is a substrate-wide residual, not a per-store flaw

Confirmed across ~10 content-addressed stores (record-store, reject-event, verdict-attestation, negative-attestation, causal-edge/store, manage-proposal/store, recall-graph/edge/authorship/hardening-signal stores). Every one verifies a record is self-CONSISTENT on read but NONE except the ed25519 edge-attestation lane authenticates the producer. In the open-writable $LOOM\_LAB\_STATE\_DIR a same-uid writer co-forges a byte-valid record via the same exported derivation fns, inflating any advisory weight (reputation distribution, confirmed-lesson count, HARDEN weight, grounding slice). Tolerable ONLY because every weight is SHADOW/narrowing and gates nothing — but it is the single load-bearing precondition that MUST close (authenticated/kernel-owned writer) before the v-next live external-PR beta lets any weight gate an action. No single module review can see that this is one systemic gap, not nine local ones.

#### [HIGH] Two confirmed kernel->runtime broken-require bugs silently disable advertised behavior

contract-verifier.js:766 does require('./identity/lifecycle-spawn') which resolves under packages/kernel/validators/ where no identity/ dir exists -> always MODULE\_NOT\_FOUND -> caught -> agentMd permanently null. The persona-.md SynthId-drift detection the comment claims is 'now participating' is dead; the correct path is ../../runtime/orchestration/identity/lifecycle-spawn AND that is itself an illegal inverted (kernel->runtime) dependency. Independently, doctor/probes/partition-sentinel.js hard-codes a sentinel path that diverges from libraryPaths.partitionSentinelPath() the registry actually uses, so the health probe reports 'absent' even when bulkhead mode is active. Both are premise-not-probed comment-contradicts-code bugs that decouple an observable signal from the code it claims to monitor.

#### [HIGH] GitHub Actions script injection in auto-release-on-tag.yml

TITLE="${{ steps.title.outputs.title }}" (and TAG) interpolate a value derived from the first line of a freeform git tag annotation directly into the run: shell, in a job holding contents:write + GITHUB\_TOKEN. A pushed tag whose annotation begins with a quote-break sequence executes arbitrary shell. Canonical GHA injection anti-pattern; fix by passing through env: and referencing "$TITLE". Severity tempered by requiring tag push access, but this is the most dangerous concrete vuln in the build cluster.

#### [MEDIUM] Default circuit-breaker source counts un-enriched fails that reputation correctly excludes

The breaker's verdict-fail source applies dedupBySubject but NO INV-W1 enrichment gate, while reputation/project.js DROPS un-enriched rows. recordVerdict only requires a non-empty agentId STRING, never a resolvable transaction\_id. So a detached/backtest fail feeds the DEFAULT breaker and can over-halt a live persona. The two derived trust signals disagree on what counts as a denial -- documented as the v3.9-bootcamp CRITICAL, deferred not fixed. Narrowing-safe today but an asymmetry that will surface the moment the breaker gates.

#### [MEDIUM] Read-back immutability leak in the two attestation ledgers

verdict-attestation and negative-attestation listVerdicts/listAttestations return raw JSON.parse rows (via readJsonlBounded) with NO deep-freeze; the Object.freeze in recordVerdict/recordAttestation only protects the write-path return. Consumers get fully-mutable nested rows (evidence\_refs, subject, verifier, failure\_signature, identity.tags). The repo has been bitten by this exact shallow-freeze-of-parsed-row class twice (#266); the causal-edge/recall stores fixed it by deep-freezing on read, so the two attestation ledgers are the outliers. Current consumers happen to be read-only, but the contract is violated.

#### [MEDIUM] Contract-drift between PRs: stale path/count premises across the substrate

Phase-0 (ADR-0008) moved everything into packages/\* but stale citations persist: contracts-validate.js extractCommandSuffix still matches the pre-migration hooks/scripts/ path -> 0/27 commands match -> false hook-not-deployed violations on a real install (masked in CI by placeholder-vs-placeholder comparison). build-spawn-context.js prints swarm/adrs/ (ADRs now in packages/specs/adrs/). lineage.js/integrate-merge.js carry stale 'Used by K9'/'DORMANT' headers. CLAUDE.md signpost says 16 personas/20 contracts/18 agents; actual is 17/19/19 (all drifted +1 when python-backend #353 landed). settings-reference.json drifted to ~11 hooks vs hooks.json's ~27 incl. a non-existent hook reference. None visible to a single-module review.

#### [MEDIUM] Accumulated dead/dark code in the enforced kernel

The enforced tier carries non-trivial dormant/dead modules: lineage.js (no production consumer, false header), context-envelope.js (K3.b CI-asserted dormant), worktree-allocator.js (K1 dormant), k13-serial-enforcer.js admission hook (built, never wired), the contract-reminder-on-agent-spawn.js prompt-mutation (inert per ADR-0012 but registered and firing -- enforcement theater), kb-citation-gate.js decision:block (doesn't propagate in headless -> observability-only). K10's combinedBypass/deny action (the whole F10/CWE-284 reason for the module) has NO enforcement consumer. The honest residual is that several 'enforced kernel' controls are inert by harness reality, and the docstrings sometimes still assert they enforce.

#### [MEDIUM] Sync close-path latency and unbounded append O(n^2) on hot audit paths

The close-path git work is SYNCHRONOUS (spawn-record.js double-writes the envelope per close; spawn-close-resolver.js runs read-only git serially). k9-journal.appendJournalEntry and wal-append.appendWalRecord are read-modify-rewrite O(file) per append -> O(n^2) over a ledger lifetime, AND unlocked concurrent appends silently lose an audit entry (the K9 undo-ledger durability gap). trace-store.nextSeq re-reads the whole timeline per append. ARCH-PC-4 (real close-path wall-time/drop-rate) is the named carry; the documented lever is a background materializer. This is a real beta risk: the live external-PR arc adds heavier real-LLM close paths.

#### [MEDIUM] Secret-scrub gap on the trace timeline and the persona-experiment real path

The F7 trace store does NOT scan state\_delta/attrs free-form bags; ingest-close-path copies entry.kind into attrs.source\_kind unscrubbed; persona-experiment defers real-content secret-scrub to W4 while real-solve.js is now W4-live. With the ③ live external-PR beta about to flow real stranger-repo content, a same-uid-planted token in a kernel journal entry (or actor output) rides into the timeline unredacted. The ③.0-W2 secret-scrub factory exists but is not wired pre-persist on these egress paths. Plus real-solve.js's SSRF residual (assertSafeRepo admits any https host, clone unsandboxed) is a HARD precondition for any non-committed corpus.

#### [LOW] Layering and DRY pressure: cross-tier reaches and duplicated leaves

Beyond the broken kernel->runtime require, several DRY/coupling smells recur: byte-identical parseArgs/tally across the verdict/negative/reputation/breaker CLIs (a lab/\_lib/cli-args.js leaf is the established fix); 4 copies of applyEdit across validators (one omits $-sanitization -> the MEDIUM secrets bug); duplicated quality-factor formulas across pattern-recorder and quality-factors-backfill; five local 64-hex regexes vs the shared provenance-walk.HEX64; two divergent severity-section parsers in the aggregators; lab-state store dirs created without 0700 mode. Individually minor; collectively they are the maintenance-debt surface a phase-close lens is positioned to catch.


### 5.4 MEDIUM-severity findings (re-adjudicated)

The 82 as-found MEDIUM findings were each independently re-probed (workflow `w3pw86olg`, one verifier per module reading its section file + the real code, refute-by-default). Outcome: **79 confirmed · 4 refuted · 4 uncertain**; corrected severity **45 hold at MEDIUM · 40 → LOW · 2 → INFO** (none rose to HIGH). Module codes match the [§6 index](#6-per-module-section-index).

**The 45 that hold at MEDIUM** (the real, confirmed, non-trivial issues):

| Module | Verdict | Location | Finding — why it holds at MEDIUM |
|---|---|---|---|
| `10` | confirmed | `packages/kernel/_lib/transaction-record.js:330-448` | **validateTransactionRecord exceeds 50-line function ceiling (~119 lines)** — The function runs from line 330 to line 448, confirmed at 119 lines by direct count — more than double the 50-line ceiling in the project's own fundamentals rule. It genuinely mixes at least five distinct concerns: (1) test-chain-marker rej |
| `10` | confirmed | `packages/kernel/_lib/transaction-record.js:152-159` | **computeContentHash false-merge defense rests on unprobed agentId uniqueness premise** — The code and its own comment (lines 152-159) explicitly acknowledge that the false-merge defense depends on writerSpawnId (the harness agentId) being unique per spawn, and flag this as 'not a written guarantee' and a 'deferred Runtime-Claim |
| `11` | confirmed | `packages/kernel/_lib/lineage.js:1-13, 97-100` | **DEAD CODE + STALE COMMENT — lineage.js has no production consumer and a false 'Used by' header** — Firsthand grep confirms zero production imports of lineage.js anywhere in packages/: grep -rn 'require.\*lineage \|buildLineageEntry \|isAcyclicChain' packages/ --include='\*.js' (excluding the module itself and test files) returns no resul |
| `13` | confirmed | `packages/kernel/_lib/k9-journal.js:182-205` | **appendJournalEntry non-atomic read-modify-rewrite with no lock** — The implementation is confirmed at lines 190-204: readFileSync reads the prior journal content, concatenates a new entry, then calls writeAtomicString (tmp+rename) — a classic non-atomic read-modify-rewrite critical section with no lock or |
| `14` | confirmed | `memory-root.js (whole file) + settings-resolution.js (whole file)` | **memory-root.js and settings-resolution.js are untested on the real spawn/FS path (mock-green only)** — Confirmed firsthand: an exhaustive grep for require calls of both modules across the entire non-test codebase returns zero results — only tests/unit/kernel/\_lib/memory-root.test.js and tests/unit/kernel/\_lib/settings-resolution.test.js ev |
| `16` | confirmed | `packages/kernel/spawn-state/integrator.js:144-155 (resolveOrderedCandidates) + packages/kernel/_lib/quarantine-promote.js:256-259 (sanitizeAgentId)` | **sanitizeAgentId collision — two distinct raw ids collapse to one safeId, silently losing the first producer's** — The code at quarantine-promote.js:256-259 confirms sanitizeAgentId replaces every [^A-Za-z0-9\_-] with \_, and the comment at lines 247-252 explicitly states 'NOT collision-free / NOT injective: agent.001 and agent-001 both map to agent\_00 |
| `17` | confirmed | `packages/kernel/hooks/lifecycle/context-size-warn-stop.js:349 and pre-compact-save.js:102, prompt-enrich-trigger.js:378, session-self-improve-prompt.js:72-73` | **Hardcoded author/install paths in user-facing forcing instructions across multiple lifecycle hooks** — All four instances are confirmed by direct source inspection. context-size-warn-stop.js:349 embeds the literal string 'node ~/Documents/claude-toolkit/scripts/library.js' in a REQUIRED ACTIONS user-facing forcing instruction — on any non-au |
| `18` | confirmed | `packages/kernel/hooks/pre/verify-plan-gate.js:93-116,176` | **findActivePlan uses newest mtime as proxy for active plan** — Reading lines 93-116 of verify-plan-gate.js confirms the implementation exactly: candidates.sort((a, b) => b.mtime - a.mtime) picks the newest-mtime .md in PLAN\_DIR with no session correlation. The default PLAN\_DIR is ~/.claude/plans (lin |
| `19` | confirmed | `validate-no-bare-secrets.js:323,333` | **Edit/MultiEdit post-image missing $-pattern sanitization in validate-no-bare-secrets.js** — The finding is confirmed by direct inspection. Lines 323 and 333 of /Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/kernel/validators/validate-no-bare-secrets.js use raw result.replace(e.old\_string, e.new\_string) a |
| `1a` | confirmed | `enforcement/k10-escape-hatch.js:48-64 vs worktree/worktree-allocator.js:112-119` | **K10 combined-bypass deny/outOfScopeAllowed fields computed but have no enforcement consumer** — Verified firsthand. worktree-allocator.js line 112-113 calls evaluateEscapeHatches(env) and then only checks hatch.worktreeDisabled — neither hatch.action, hatch.combinedBypass, hatch.outOfScopeAllowed, nor hatch.denyCombinedInCi is consume |
| `20` | confirmed | `contracts-validate.js:705-708 (extractCommandSuffix)` | **Stale hooks/scripts/ regex in extractCommandSuffix causes false hook-not-deployed violations** — Confirmed firsthand. grep -c 'hooks/scripts/' packages/kernel/hooks.json returns 0; all 54 hook commands follow packages/kernel/hooks/{lifecycle,pre,post}/... with ${CLAUDE\_PLUGIN\_ROOT} prefix. The regex /hooks /scripts /(.+)$/ matches no |
| `20` | confirmed | `budget-tracker.js:228-273 (cmdExtend)` | **cmdExtend does read-modify-write without withBudgetLock, creating a lost-update race with cmdRecord** — Confirmed firsthand. cmdExtend (lines 228-273) performs loadBudgets -> entry.extensionsUsed += 1 -> extensionsLog.push(...) -> writeBudgetsAtomic with no withBudgetLock wrapper. By contrast, cmdRecord (lines 163-183) explicitly wraps its id |
| `21` | confirmed | `packages/runtime/orchestration/quality-factors-backfill.js:101` | **Missing store.identities validation in quality-factors-backfill.js** — Confirmed firsthand. readStore() (lines 40-46) only checks file existence and calls JSON.parse(fs.readFileSync(...)) with no structural validation of the returned object. Line 101 then calls Object.entries(store.identities) with no guard on |
| `21` | confirmed | `packages/runtime/orchestration/verify-plan-spawn.js:106` | **Non-atomic plan-file write in verify-plan-spawn.js** — Confirmed firsthand. Line 106 is fs.writeFileSync(planPath, updated) — a direct non-atomic overwrite with no tmp-then-rename. The file imports only fs and path; it does not import the cluster's shared kernel/\_lib/atomic-write helper. Every |
| `21` | confirmed | `packages/runtime/orchestration/weight-fit.js:214` | **Math.abs silently flips negative empirical weight in analyzeConvergence** — Confirmed firsthand. Line 214: const proposedEmpirical = proposedRaw === null ? theoryWeight : Math.abs(proposedRaw). The comment reads 'convergence\_agree\_pct is positive by construction' — but this is a claim about the theory weight (0.1 |
| `22` | confirmed | `packages/runtime/orchestration/identity/lifecycle-spawn.js:120-153` | **cmdAssign round-robin index drift when specialization branch fires** — The code at lines 141-142 uses idx2 = store.nextIndex[args.persona] \|\| 0 to index into best[] — a filtered subset of liveRoster that may contain 1..N elements — while lines 150-153 unconditionally advance the shared counter modulo liveRos |
| `22` | confirmed | `packages/runtime/orchestration/doctor/probes/env-inheritance.js:92` | **valueSample emits first 3 chars of every checked env var into probe output** — Line 92 confirms: checks.push({ ..., valueSample: value ? value.slice(0, 3) + '...' : null }). The checks array is nested inside details which doctor.js emits verbatim — in --json mode via JSON.stringify(result) to stdout (line 147), and in |
| `30` | confirmed | `calibration-issue-run.js:202` | **cloneRoot not threaded through runIssueCalibration to scoreIssueCalibration** — Verified firsthand. At /packages/lab/causal-edge/calibration-issue-run.js line 202, scoreIssueCalibration is called as scoreIssueCalibration(records, attemptsPerIssue, legs, { patchFor, tierOf, trajectoryFor: trajFor }) — cloneRoot is absen |
| `36` | confirmed | `grounding-slice.js:32-38, 132-138` | **Integrity != provenance (documented, SHADOW-tolerated)** — The claim is fully substantiated by the code. buildGroundingSlice at lines 130-139 calls confirmedNodeIds(edges) which returns a Set of from\_node\_id values extracted from edges that pass verify-on-read content-address checks — this proves |
| `36` | confirmed | `cli.js:46-55, 18-22` | **--solve <path> is arbitrary in-process code execution** — resolveSolveFn at lines 47-54 calls require(abs) on a caller-supplied absolute path with no domain allowlist, content validation, or sandboxing — the resolved module executes top-level code at load time and its exported function runs in-pro |
| `36` | confirmed | `real-solve.js:36-37, 153` | **SSRF residual: assertSafeRepo admits any https host and the actor clone is unsandboxed** — Verified in \_clone-lifecycle.js:57: assertSafeRepo returns repo for any https?:// URL without domain restriction — if (/^https?:///.test(repo)) return repo. At real-solve.js:153 this check fires before git clone which runs unsandboxed on t |
| `39` | confirmed | `packages/lab/issue-corpus/_spike/containment-spike.js:384-408` | **Case 8 git-hook vector is vacuous (post-checkout in source .git/hooks is never transferred on clone)** — Confirmed firsthand at lines 384-408. The hook is written into hostile/.git/hooks/post-checkout of the source repo, then prepareClone is called on that source repo. Git never copies a source repo's .git/hooks/ directory to the clone's check |
| `3a` | confirmed | `packages/lab/verdict-attestation/store.js (whole file) + packages/lab/negative-attestation/store.js (whole file)` | **Integrity != provenance — open-writable Lab ledgers with no read-side re-verification** — Confirmed firsthand: listVerdicts (store.js:333-339) and listAttestations (negative-attestation/store.js:223-229) perform no content-address re-verification on read; every JSONL line is trusted as-is after readJsonlBounded parses it. A same |
| `3a` | confirmed | `packages/lab/negative-attestation/record-from-decompose.js:54 (readOutbox)` | **Unbounded outbox read — JSON.parse(fs.readFileSync(...)) with no byte cap** — Confirmed firsthand at line 54: readOutbox calls JSON.parse(fs.readFileSync(outboxPath, 'utf8')) with no byte cap, while the sibling enricher in enrich-from-spawn-state.js guards its journal reads with MAX\_JOURNAL\_BYTES=4MB and lstat over |
| `40` | confirmed | `scripts/generate-persona-agents.js:38-130` | **PERSONAS roster in generate-persona-agents.js omits 17-python-backend** — Verified firsthand: the PERSONAS array at lines 38-130 contains exactly 13 entries (IDs 01, 02, 05-11, 13-16); 17-python-backend is absent. Both agents/python-backend.md and packages/runtime/personas/17-python-backend.md exist on disk (conf |
| `40` | confirmed | `scripts/library-migrate.js:226,238` | **symlinked array computed but never verified in the real (non-dry-run) migrate path** — Verified firsthand: the symlinked array is built at line 226 and used only at lines 229 (count in the log line) and 238 (listed under --dry-run). In the live non-dry-run code path, which begins at line 246, symlinked is never referenced aga |
| `40` | confirmed | `scripts/library-migrate.js:819` | **cmdFixSymlinks writes library target with plain fs.writeFileSync instead of writeAtomicString** — Verified firsthand: line 819 is fs.writeFileSync(targetPath, legacyContent) — confirmed by grep. Every other library-target write in this file uses writeAtomicString or writeAtomic (lines 254, 276, 361, 307, 465). The risk is partially miti |
| `41` | confirmed | `packages/kernel/settings-reference.json:1-183 vs packages/kernel/hooks.json:1-295` | **Two hand-maintained hook manifests have drifted (settings-reference.json vs hooks.json)** — Directly verified by counting "type": "command" entries: settings-reference.json has 14 hook commands vs 27 in hooks.json. The gap is concrete — the reference omits the entire PostToolUse chain (spawn-record, spawn-close-resolver, validate- |
| `41` | confirmed | `install.sh:111-304 (install_hooks)` | **install\_hooks function is ~190 lines — well over the 50-line guideline (KISS/SRP)** — Verified by reading lines 111-304: the install\_hooks function spans 193 lines from the opening { to the closing }. It mixes 7+ distinct copy phases (kernel hooks, validators, \_lib, recall/spawn-state/algorithms/schema, kernel JSON, runtim |
| `41` | confirmed | `package.json:7-9 + packages/*/package.json` | **pnpm -r test is a coverage no-op — all per-package test scripts are echo-and-exit stubs** — All five per-package test scripts were verified by reading each package.json: kernel prints '(kernel tests TBD...)'; lab prints '(lab unit tests run via the CI lab-tests job...)'; runtime prints '(runtime tests TBD)'; skills prints '(skills |
| `51` | confirmed | `packages/skills/commands/{prune,research,chaos-test,build-team,evolve,build-plan,forge}.md` | **7 of 14 commands hard-code author-specific absolute path** — Verified firsthand: exactly the 7 named commands hard-code ~/Documents/claude-toolkit/... or $HOME/Documents/claude-toolkit/... (e.g. prune.md:20-22, research.md:62-66, chaos-test.md:18-86, build-team.md:35-162, evolve.md:48, build-plan.md: |
| `52` | confirmed | `contract-format.md:10 and :18` | **Stale pre-v4-restructure paths in a CANONICAL spec** — Both stale paths are real. contract-format.md:10 reads "persona": "string (optional, references swarm/personas/{persona}.md)" and ls swarm/personas returns 'No such file or directory'; personas now live at packages/runtime/personas/NN-name. |
| `53` | confirmed | `*/SKILL.md (runtime-path citations)` | **Three inconsistent runtime-path citation conventions across skills (~/Documents/claude-toolkit, ~/.claude/pack** — Verified firsthand via grep across the cited files. The non-portable ~/Documents/claude-toolkit/... form appears in agent-swarm:12, build-plan:44, tech-stack-analyzer:37/59/62/127/131, skill-forge:21/22/65/78, and self-improve:125 — all 5 s |
| `54` | confirmed | `docs/hooks/README.md, docs/hooks/overview.md` | **Hooks count drift: docs say 24 registrations / 1 SessionStart / 5 PostToolUse but hooks.json has 27 / 2 / 7** — Verified firsthand. node parse of packages/kernel/hooks.json yields 27 total command entries (SessionStart 2, UserPromptSubmit 1, PreToolUse 12, PostToolUse 7, PreCompact 1, Stop 4). docs/hooks/README.md:3 and :16 state '24 hook registratio |
| `54` | confirmed | `docs/agents/README.md, docs/agents/overview.md` | **Agents docs: stale swarm/\* source paths (gone) and stale count (Agents (5) vs 19 live)** — Verified firsthand. docs/agents/README.md:10-11 cite swarm/personas/\*.md and swarm/personas-contracts/\*.contract.json; both directories do not exist (ls -d returns 'No such file or directory'). The live equivalents are packages/runtime/pe |
| `54` | confirmed | `docs/skills/README.md, docs/skills/overview.md` | **Skills docs: stale top-line source glob (skills/\*/SKILL.md gone) and stale count (17 vs 21)** — Verified firsthand. docs/skills/README.md:9 cites skills/\*/SKILL.md as the Source; that glob has no matches (flat skills/ dir gone). The live location packages/skills/library/\*/SKILL.md has 21 files (confirmed by ls \| wc -l), but README: |
| `54` | confirmed | `docs/reference/commands.md` | **Commands doc: header 'Commands (13)' but only 8 tabled; live source has 14** — Verified firsthand. docs/reference/commands.md:5 reads 'Commands (13)'; the table (lines 11-18) lists exactly 8 commands (/review, /plan, /security-audit, /self-improve, /forge, /evolve, /prune, /chaos-test). The actual source packages/skil |
| `54` | confirmed | `docs/reference/rules.md` | **Rules doc: header 'Rules (8)' / 8 tabled but source has 9 (omits workspace-hygiene); workflow row is supersede** — Verified firsthand. docs/reference/rules.md:5 reads 'Rules (8)' and the table (lines 11-18) lists 8 rows; the source find packages/skills/rules -name '\*.md' returns 9 (core: fundamentals, prompt-enrichment, research-mode, security, self-im |
| `55` | confirmed | `packages/specs/rfcs/v6-substrate-synthesis.md:3,5` | **Status-marker drift on the canonical blueprint** — Verified firsthand: line 3 reads '# v6 Substrate Synthesis — Power Loom (LIVE-DRAFTING)' and line 5 reads '\*\*Status\*\*: v6 LIVE-DRAFTING (Round 1 of 3 ... Supersedes v5.4 BLUEPRINT-LOCKED upon Round-3 completion)'. The MEMORY index entry |
| `55` | confirmed | `rfcs/2026-06-13-v3.9-*.md, rfcs/2026-06-15-v3.11-experience-layer.md, rfcs/2026-05-30-v3.5-*-DRAFT.md, rfcs/2026-06-11-north-star-*.md` | **Systemic status: staleness across forward RFCs** — All four frontmatter status fields verified stale vs shipped phases: 2026-06-13-v3.9 line 3 'status: Proposed' (MEMORY: v3.9 PHASE-CLOSED, released 3.9.0 #315); 2026-06-15-v3.11 line 4 'status: Proposed (REVISED post-VERIFY-board...)' (MEMO |
| `55` | confirmed | `packages/specs/architecture-substrate/prompt-enrichment-architecture.md:71-73` | **Broken path citations (pre-Phase-0) — prompt-enrichment-architecture.md** — Verified firsthand. The 'Hook architecture wiring' table at lines 71-73 cites 'hooks/scripts/prompt-enrich-trigger.js', 'hooks/scripts/auto-store-enrichment.js', and 'scripts/prompt-pattern-store.js' — ls confirms NONE exist. The report's c |
| `55` | confirmed | `packages/specs/architecture-substrate/auto-loop-infrastructure.md:35-37,48` | **Broken path citations (pre-Phase-0) — auto-loop-infrastructure.md** — Verified firsthand. Lines 35-37 cite 'node ~/.claude/scripts/self-improve-store.js ...'; the actual repo source is packages/kernel/spawn-state/self-improve-store.js (find confirms it is the only copy). Line 48 cites 'node scripts/library.js |
| `specs-plans-research-bench` | confirmed | `packages/specs/research/plan-template.md (cross-references §)` | **Broken cross-reference paths.** — Verified firsthand. plan-template.md lines 178-182 link via ../commands/build-plan.md, ../skills/build-plan/SKILL.md, ../skills/agent-team/patterns/plan-mode-hets-injection.md, ../agents/planner.md, ../rules/core/workflow.md. From packages/ |
| `specs-plans-research-bench` | confirmed | `packages/specs/kb-architecture-planning/README.md (lines 7, 22)` | **Stale location prose.** — Verified firsthand. README line 7 states the working files 'live here in swarm/ (the substrate's working area...)' but they actually live under packages/specs/kb-architecture-planning/ (confirmed: that dir exists; swarm/kb-architecture-plan |
| `57` | confirmed | `packages/kernel/validators vs tests/unit/kernel/validators` | **Validators test dir under-populated; validate-plan-schema has no dedicated suite** — Verified: 8 validators exist under packages/kernel/validators/ (contract-verifier, validate-adr-drift, validate-frontmatter-on-skills, validate-kb-doc, validate-plan-schema, validate-yaml-frontmatter, validate-config-redirect, validate-no-b |


**Down-rated / refuted (42)** — re-rated below their as-found MEDIUM; full detail in the corresponding `_sections/` file:

| Module | MED → | Verdict | Finding |
|---|---|---|---|
| `10` | LOW | confirmed | scanCommittedOps returns unvalidated rec.transaction\_id |
| `11` | LOW | confirmed | STALE 'DORMANT / no production importer' header in integrate-merge.js |
| `14` | LOW | confirmed | extractFromJson leaks raw JSON keys/values into catalog briefing surface |
| `14` | LOW | confirmed | validatePointer accepts relative project\_context despite documenting absolute-path contract |
| `16` | LOW | confirmed | quarantineCandidate unconditionally overwrites an existing loom-promote/<safeId> branch before surfacing the overwrite in the run- |
| `17` | LOW | confirmed | session-self-improve-prompt.js not registered in hooks.json — dormant hook with stale active-behavior docstring |
| `17` | LOW | confirmed | console-log-check.js reads every changed JS/TS file with no size cap on every Stop event |
| `18` | LOW | confirmed | kb-citation-gate emits decision:block from PostToolUse — block does not propagate; presents false enforcement impression |
| `1a` | LOW | confirmed | WEIGHTS sum comment claims 1.00 but actual sum is 1.15 |
| `1a` | LOW | confirmed | Three inconsistent dimension counts in one file (7 vs 9 vs 8 actual) |
| `1a` | LOW | confirmed | maxAttempts:0 silently clamps to DEFAULT\_MAX\_ATTEMPTS=3 instead of zero attempts |
| `20` | LOW | confirmed | canonicalJson / deepEqual have no recursion depth bound; deeply-nested contract input would crash |
| `21` | LOW | confirmed | Dead \_theoryWeightSign parameter in normalizeToWeightScale |
| `22` | LOW | confirmed | registry.js exceeds 800-line file ceiling |
| `22` | LOW | confirmed | Hook-match uses JSON.stringify blob substring search — false-positive prone |
| `31` | LOW | confirmed | Field divergence on dedup in runConfirmationPass |
| `32` | LOW | confirmed | No temp-dir cleanup: mkdtempSync leaks w1-dogfood-\* on every run |
| `32` | LOW | confirmed | main() invoked bare with no .catch() — unhandled promise rejection on async failure |
| `35` | LOW | confirmed | snapshot and verify-snapshot have no try/catch |
| `35` | LOW | confirmed | show --persona inconsistency with --personas (bare-flag / multi-persona UX smell) |
| `35` | LOW | uncertain | Computed-but-unconsumed signal (recency\_decay\_factor, distinct\_spawns, last\_seen) |
| `35` | LOW | confirmed | No require.main === module guard on top-level-executable spike |
| `36` | LOW | refuted | Secret-scrub gap (deferred) |
| `37` | LOW | confirmed | Secret-scrub gap on the timeline egress: state\_delta/attrs free-form bags not scanned |
| `39` | LOW | confirmed | dogfood.js main() missing try/finally — fixture dir leaks on adapter.run() throw |
| `39` | LOW | uncertain | recall-graph written to world-readable os.tmpdir() and never cleaned up |
| `39` | LOW | confirmed | add-to-manifest.js trusts self-asserted verified===true in open-writable verdict file |
| `39` | LOW | confirmed | stage-from-pr.js --id flows unvalidated into a host write path (path traversal) |
| `3a` | LOW | confirmed | Dead production code — enrichRecord single-record path never called outside tests |
| `3a` | LOW | confirmed | Inconsistent and duplicated --expires-after-days validation between record and record-review subcommands |
| `41` | LOW | uncertain | settings-reference.json references session-self-improve-prompt.js not in canonical hooks.json |
| `50` | LOW | confirmed | Stale persona counts in CLAUDE.md signpost |
| `51` | LOW | confirmed | Inconsistent command metadata: only phase-close.md carries YAML frontmatter |
| `51` | LOW | uncertain | Staleness: chaos-test.md narrates v2.8.x-era motivation and cites legacy counter artifacts |
| `52` | LOW | confirmed | The "Filesystem layout" section documents swarm/thoughts/ as the RPI artifact home |
| `53` | LOW | confirmed | self-improve/SKILL.md ## The Loop — duplicated/non-monotonic section heading numbering (### 3 and ### 4 each appear twice) |
| `53` | LOW | confirmed | Four-way overlap: fullstack-dev duplicates next-js/react/typescript/deploy-checklist material |
| `specs-plans-research-bench` | LOW | confirmed | Stray committed test fixtures. |
| `57` | LOW | confirmed | Mis-filed validator tests under tests/unit/hooks/ |
| `57` | LOW | refuted | 12 of 19 production hooks have no unit test |
| `31` | INFO | refuted | Shared raw edge references in conflictedBlocks returned Map |
| `specs-plans-research-bench` | INFO | refuted | Duplicated plan pair. |


### 5.5 LOW / INFO findings (285, as-found)

Enumerated in full inside each section file. By type: 182 smell · 58 optimization · 23 bug · 16 logical-fallacy · 6 security. The dominant themes are: by-convention-only safety contracts (lock-held-by-caller, fail-soft/fail-closed composition), duplicated leaf logic ripe for extraction (CLI arg parsers, `applyEdit`, 64-hex regexes, quality-factor formulas), `O(n)`/`O(n²)` append and re-scan patterns on cold paths, and `mkdir` mode foot-guns (`0o700` not always set). None are load-bearing individually; collectively they are the maintenance-debt surface a `/phase-close` lens is positioned to catch.

---

## 6. Per-module section index

Each row links to the full deep-read for that cluster (directory tree + per-file + per-function tables + findings). Columns `C/H/M/L/I` are the finding counts at each severity.

| # | Section file | Files | C | H | M | L | I | Summary |
|---|---|--:|--:|--:|--:|--:|--:|---|
| 10 | [`10-kernel-lib-record-core.md`](_sections/10-kernel-lib-record-core.md) | 10 | 0 | 0 | 3 | 6 | 4 | Analyzed the kernel \_lib content-addressed record store + hashing core (10 files): the run-scoped transaction-record store (append + 3 readers + list |
| 11 | [`11-kernel-lib-provenance.md`](_sections/11-kernel-lib-provenance.md) | 9 | 0 | 0 | 2 | 4 | 4 | Analyzed the nine kernel \_lib provenance/integration/chain-edge leaves: the chained-record + manage-op + reject-event minters, the git merge primitiv |
| 12 | [`12-kernel-lib-security-paths.md`](_sections/12-kernel-lib-security-paths.md) | 9 | 0 | 0 | 0 | 5 | 5 | Analyzed the nine kernel \_lib security and path primitives (path-canonicalize, safe-exec, safe-resolve, sanitize, secret-patterns, network-egress-det |
| 13 | [`13-kernel-lib-guards-k9-k14.md`](_sections/13-kernel-lib-guards-k9-k14.md) | 9 | 0 | 0 | 1 | 9 | 2 | Analyzed the K9 (path-guard, journal, promote-deltas) and K14 (symlink-guard, snapshot, tail-window, write-scope) mandatory-split guard clusters plus |
| 14 | [`14-kernel-lib-stores.md`](_sections/14-kernel-lib-stores.md) | 8 | 0 | 0 | 3 | 7 | 2 | Analyzed the eight kernel \_lib storage/discovery primitives: the per-persona bulkhead store (persona-store), the library catalog triad (paths/catalog |
| 15 | [`15-kernel-lib-misc.md`](_sections/15-kernel-lib-misc.md) | 7 | 0 | 0 | 0 | 3 | 7 | Analyzed seven kernel \_lib leaf modules (recency-decay, synthid, context-envelope, frontmatter, route-decide-export, kernel-algorithms-audit, layer-b |
| 16 | [`16-kernel-spawn-state.md`](_sections/16-kernel-spawn-state.md) | 10 | 0 | 0 | 2 | 5 | 4 | Analyzed the 10-file kernel/spawn-state cluster: the human-gated ordered integrator + its CLI, the data-driven post-spawn resolver, the two close-path |
| 17 | [`17-kernel-hooks-lifecycle.md`](_sections/17-kernel-hooks-lifecycle.md) | 9 | 0 | 0 | 2 | 0 | 0 | Nine lifecycle hooks analyzed; details in section file. |
| 18 | [`18-kernel-hooks-pre-post.md`](_sections/18-kernel-hooks-pre-post.md) | 14 | 0 | 1 | 2 | 6 | 3 | Analyzed the 14 kernel pre/post tool-use hook scripts and their hooks/\_lib shared primitives — the enforced layer Claude Code invokes around every to |
| 19 | [`19-kernel-validators.md`](_sections/19-kernel-validators.md) | 8 | 0 | 1 | 1 | 5 | 5 | Analyzed the 8 kernel validator scripts in packages/kernel/validators/: seven are deterministic write-time hooks wired into packages/kernel/hooks.json |
| 1a | [`1a-kernel-enforcement-recall-route.md`](_sections/1a-kernel-enforcement-recall-route.md) | 7 | 0 | 0 | 4 | 6 | 3 | Analyzed seven kernel-tier files spanning enforcement (K10 escape-hatch, K13 serial-enforcer), recall (loom-recall, signpost), worktree allocation (K1 |
| 20 | [`20-runtime-orch-core-a.md`](_sections/20-runtime-orch-core-a.md) | 10 | 0 | 0 | 3 | 5 | 4 | Exhaustive per-file analysis of 10 runtime-orchestration-core files (ADR CLI, agent-identity dispatcher, architecture-relevance detector, budget track |
| 21 | [`21-runtime-orch-core-b.md`](_sections/21-runtime-orch-core-b.md) | 10 | 0 | 0 | 4 | 5 | 4 | Analyzed the 10 in-scope runtime-orchestration files plus the transitively-read \_lib/safe-segment.js. They split into a learning/telemetry family (pa |
| 22 | [`22-runtime-identity-aggregate-probes.md`](_sections/22-runtime-identity-aggregate-probes.md) | 14 | 0 | 2 | 4 | 7 | 3 | Analyzed the runtime identity/aggregate/doctor-probe/\_lib cluster (14 files): the HETS per-identity reputation store (5-module split — rosters, verdi |
| 23 | [`23-runtime-verify-testrunners.md`](_sections/23-runtime-verify-testrunners.md) | 6 | 0 | 0 | 0 | 3 | 5 | Analyzed the runtime verification tier (R9/R11/R12) and the dormant v3.1 trait-resolve primitive across 6 files. spawn-verify.js (R11) routes a decomp |
| 30 | [`30-lab-causal-edge-core-a.md`](_sections/30-lab-causal-edge-core-a.md) | 10 | 0 | 0 | 1 | 4 | 5 | Analyzed the lab causal-edge calibration/faithfulness/wilson cluster (10 files, all advisory/shadow tier). The pure deterministic scorers (calibration |
| 31 | [`31-lab-causal-edge-core-b.md`](_sections/31-lab-causal-edge-core-b.md) | 13 | 0 | 0 | 2 | 4 | 4 | Analyzed the 13-file lab causal-edge (B) cluster: the advisory causal-edge graph (store/walker/projections/manage-ops), the v3.11 lesson experience la |
| 32 | [`32-lab-causal-edge-spike.md`](_sections/32-lab-causal-edge-spike.md) | 4 | 0 | 0 | 2 | 5 | 3 | Analyzed the four causal-edge spike drivers — the lab's manual verification/dogfood tier (all @loom-layer: lab, advisory/shadow, OUT of CI) that exerc |
| 33 | [`33-lab-manage-proposal.md`](_sections/33-lab-manage-proposal.md) | 9 | 0 | 0 | 0 | 3 | 5 | The manage-proposal cluster is the Lab (advisory/SHADOW) substrate for human-disposable manage ops (quarantine/content-dedup/cull/merge) over kernel m |
| 34 | [`34-lab-attribution.md`](_sections/34-lab-attribution.md) | 10 | 0 | 0 | 0 | 6 | 5 | The lab/attribution cluster is the Evolution Lab's advisory/shadow "experience layer": a pure node populator (recall-graph.js), three content-addresse |
| 35 | [`35-lab-reputation-breaker.md`](_sections/35-lab-reputation-breaker.md) | 7 | 0 | 1 | 4 | 3 | 2 | Analyzed the Lab advisory/shadow trust-signal cluster: E4 reputation (project/materialize/cli/reputation-gate + the out-of-CI diagnostic spike) and E1 |
| 36 | [`36-lab-persona-experiment.md`](_sections/36-lab-persona-experiment.md) | 10 | 0 | 0 | 4 | 5 | 3 | Analyzed the full ③.1 persona-experiment cluster (10 files): the 3-arm controlled-variable apparatus (arm-compose/arm-loop/arm-query/canonical-persona |
| 37 | [`37-lab-persona-consumer-trace.md`](_sections/37-lab-persona-consumer-trace.md) | 13 | 0 | 0 | 1 | 5 | 5 | Analyzed the two lab-tier clusters: persona-consumer (v3.10 WHO-built-it credit experiment — authorship ledger, mock hardening-signal store, and the p |
| 38 | [`38-lab-issue-corpus-core.md`](_sections/38-lab-issue-corpus-core.md) | 6 | 0 | 0 | 0 | 4 | 6 | Analyzed the lab-tier issue-corpus core cluster: corpus.js (pure PUBLIC/SEALED partition + manifest hash), container-adapter.js (pure lifecycle + Seat |
| 39 | [`39-lab-issue-corpus-spikes.md`](_sections/39-lab-issue-corpus-spikes.md) | 11 | 0 | 0 | 5 | 6 | 2 | Analyzed the 11 manual \_spike scripts under packages/lab/issue-corpus/\_spike (two adversarial containment spikes for macOS sandbox-exec and Docker, |
| 3a | [`3a-lab-verdict-negative-attestation.md`](_sections/3a-lab-verdict-negative-attestation.md) | 7 | 0 | 1 | 4 | 4 | 2 | Analyzed the lab advisory/shadow attestation cluster: two structurally-parallel append-only JSONL ledgers (verdict-attestation + negative-attestation) |
| 40 | [`40-scripts-and-bin.md`](_sections/40-scripts-and-bin.md) | 12 | 0 | 1 | 3 | 6 | 1 | Analyzed all 11 scripts/ files plus bin/migrate-to-plugin.sh — the operator + CI tooling tier (none enforced; CI drift gates, library memory-organizer |
| 41 | [`41-root-config-ci-install.md`](_sections/41-root-config-ci-install.md) | 14 | 0 | 1 | 4 | 5 | 4 | Analyzed the build/CI/plugin substrate: install.sh, eslint.config.js, package.json, pnpm-workspace.yaml, the two .claude-plugin manifests, kernel hook |
| 50 | [`50-agents-personas.md`](_sections/50-agents-personas.md) | 19 | 0 | 0 | 1 | 4 | 2 | Cataloged all 19 Agent-tool persona definitions in agents/\*.md — the top layer of the canonical 3-layer persona split (agents/ -> runtime/personas/NN |
| 51 | [`51-skills-commands-rules.md`](_sections/51-skills-commands-rules.md) | 23 | 0 | 0 | 3 | 4 | 2 | Cataloged all 14 slash commands in packages/skills/commands/ and all 9 rule files in packages/skills/rules/ (7 core + typescript/style + web/react-nex |
| 52 | [`52-skills-library-agent-team.md`](_sections/52-skills-library-agent-team.md) | 85 | 0 | 0 | 2 | 3 | 3 | Cataloged all 85 files of packages/skills/library/agent-team/: 4 top-level skill docs (SKILL.md, USING.md, contract-format.md canonical; BACKLOG.md a |
| 53 | [`53-skills-library-skills.md`](_sections/53-skills-library-skills.md) | 20 | 0 | 0 | 3 | 4 | 2 | Cataloged all 20 in-scope skills under packages/skills/library/ (the agent-team subtree was excluded as covered separately), splitting them into 11 pr |
| 54 | [`54-docs-tree.md`](_sections/54-docs-tree.md) | 27 | 0 | 2 | 1 | 2 | 1 | Cataloged the docs/ tree: 26 human-facing docs + the SIGNPOST generator + 30 in-flight report sections. The deep-substrate canon (ARCHITECTURE/ROADMAP |
| 55 | [`55-specs-adr-rfc.md`](_sections/55-specs-adr-rfc.md) | 31 | 0 | 0 | 4 | 5 | 3 | Cataloged all 31 files in packages/specs/{adrs,rfcs,architecture-substrate}: 16 numbered ADRs + 2 scaffolding files, 11 RFCs (the v3.3→v6 synthesis ch |
| 56 | [`56-specs-plans-research-bench.md`](_sections/56-specs-plans-research-bench.md) | 310 | 0 | 0 | 4 | 5 | 2 | Cataloged the 310-file packages/specs/ historical corpus across six areas: plans/ (158, the v3.0→phase-③ per-wave roadmap spine, living-not-immutable) |
| 57 | [`57-tests-coverage.md`](_sections/57-tests-coverage.md) | 239 | 0 | 1 | 3 | 3 | 2 | Cataloged the entire tests/ tree: 239 tracked files — 200 standalone node:assert \*.test.js suites, 13 install.sh-sourced smoke-\*.sh shell suites, 7 |


---

## 7. Recommended next steps

Prioritized for discussion (from the architect synthesis; the first is the load-bearing precondition for the North-Star live-external-PR beta):

1. PRIORITIZE the integrity!=provenance close before the live external-PR beta: decide the authenticated-minter design (extend edge-attestation's ed25519 signed lane to a kernel-owned writer the caller cannot invoke) for any weight that will gate, and keep every still-shadow weight explicitly narrowing-only. This is the single load-bearing precondition the North-Star depends on.
2. FIX the two confirmed broken-require / divergent-path bugs (contract-verifier.js:766 kernel->runtime require; partition-sentinel.js hard-coded path) and add a CI assertion (or the doc-path gate widened to require()) that catches a require resolving to MODULE_NOT_FOUND so 'comment claims X, code does null' cannot recur. Decide whether the persona-.md SynthId-drift signal belongs in a kernel _lib helper both tiers import.
3. REMEDIATE the GHA script-injection in auto-release-on-tag.yml (pass tag annotation via env:, reference "$TITLE"); audit phase-tag/version-check fail-open and the legacy-install GITHUB_OUTPUT single-line form at the same time.
4. RECONCILE the breaker-vs-reputation denial asymmetry: either add the INV-W1 enrichment gate to the verdict-fail breaker source or document the intentional over-halt; this disagreement will bite the moment the breaker gates and is the cleanest cross-store correctness fix.
5. DEEP-FREEZE the read-back path in verdict-attestation and negative-attestation listVerdicts/listAttestations (parity with the causal-edge/recall stores) and add the read-back/dedup/update immutability tests the workspace rule mandates.
6. RUN a phase-close-style sweep over the cross-PR drift class before the beta: refresh the CLAUDE.md persona counts (17/19/19), fix contracts-validate's stale hooks/scripts/ suffix premise, reconcile settings-reference.json against hooks.json (or retire the legacy manifest), and strip/relabel the stale DORMANT/Used-by headers (lineage.js, integrate-merge.js).
7. ADDRESS the sync close-path latency + secret-scrub gap together as the beta-readiness work: wire the ③.0-W2 secret-scrub factory pre-persist on the trace timeline (state_delta/attrs) and the persona-experiment real path, add the SSRF host-allowlist to real-solve.js, and prototype the background close-path materializer with a real wall-time/drop-rate probe (ARCH-PC-4).
8. TRIAGE the dead/dark kernel code: decide retire-vs-wire for lineage.js, k13 admission hook, K10 combined-bypass enforcement, and the inert contract-reminder/kb-citation enforcement theater — at minimum correct the docstrings that assert enforcement that ADR-0012/headless reality has made inert, so the 'enforced kernel' label stays honest.
9. EXTRACT the recurring shared leaves (lab/_lib/cli-args.js, a shared applyEdit with $-sanitization that the secrets validator MUST adopt to close the MEDIUM bug, a single quality-factor deriver, a shared severity-section parser) — small, mechanical, and they remove a class of silent-divergence bugs.
10. HARDEN the O(n^2)/unlocked-append audit paths that become load-bearing under the beta's heavier close paths: lock the K9 journal RMW (an undo ledger that silently loses entries is the worst durability failure to ship), and bound/segment the whole-file rewrite cadence on k9-journal/wal-append/trace-store.


---

## 8. Limitations & honesty notes

- **HIGH and MEDIUM were both adversarially re-verified; LOW/INFO were not.** The 11 HIGH findings each got an adversarial second opinion (4 down-rated, 1 refuted). The 82 MEDIUM findings were then re-adjudicated module-by-module (§5.4) — 45 held, the rest down-rated/refuted. So the HIGH and MEDIUM tiers are trustworthy. The 285 LOW/INFO findings remain single-analyzer judgments — treat them as *leads with line numbers*, enumerated in the section files.
- **Static read, not execution.** Findings are from reading the code (plus targeted probes where a verifier ran `node`/`git`/`ls`). Dynamic behavior under real `claude -p` close-paths, real Docker/Seatbelt containment, and real GitHub ingestion was reasoned about from the code and the specs, not exercised end-to-end here (one exception: the GHA injection was reproduced).
- **Specs/tests/library were cataloged structurally, not line-by-line.** For the 344-file spec corpus, the 239-file test tree, and the 105 library docs, the agents enumerated every file with a purpose and went deep on the load-bearing/canonical ones — the right altitude for a historical/decision corpus, but not the same function-level depth as the 240 code modules.
- **Severity is contextual to *this* substrate's posture.** Several findings are rated lower than they would be in a production-gating system precisely because the relevant path is currently SHADOW/advisory and "can only over-halt, never grant." Those ratings flip upward the moment a weight starts gating — which is exactly the §5.3 integrity-vs-provenance story.
- **The tree is mid-flight.** The review was taken at `feat/w4b-async-real-solve` with uncommitted changes in the `persona-experiment` cluster (the ③.1-W4 async `real-solve` work). A few findings there describe in-progress code.
