# Roadmap

How Power Loom got to where it is, and where it goes next. This document is **appended as each phase lands** — completed phases stay as the achievement record; planned phases carry honest effort estimates and may shift.

**Legend:** ✅ shipped · 🟡 in progress · ⬜ planned · 📄 draft/RFC.

The authoritative design record is [`packages/specs/`](../packages/specs/) (the v6 synthesis RFC, the ADRs, and the per-phase plans). This roadmap is the readable summary.

---

## ✅ Phase 0 — Workspace Restructure

*Plan: [`packages/specs/plans/2026-05-25-phase-0-workspace-restructure.md`](../packages/specs/plans/2026-05-25-phase-0-workspace-restructure.md) · ADR-0008 · PR #158.*

A careful, mostly-mechanical repository restructure that gave the three-layer architecture a **filesystem boundary**. It established internal package boundaries via pnpm workspaces — `kernel / runtime / lab / skills / specs` — aligning the previously flat repo (`hooks/`, `scripts/`, `swarm/`, …) with the kernel/runtime/lab model.

Why it mattered:

- It gave v3.0-alpha real directories to add ~900–1,300 LoC of kernel code into, and gave the K12 lint actual layer boundaries to check.
- **Move-don't-change**, with one acknowledged exception: introducing `packages/kernel/_lib/` and rewriting ~20 `require` statements to fix a genuine `kernel → runtime` back-edge (kernel hooks had been importing `scripts/agent-team/_lib/*`). That refactor is semantic, not pure `git mv` — honestly re-estimated from ~4–5h to ~8–15h.
- Non-goals: no physical repo split, no plugin-distribution change, no public-API renames.

---

## ✅ Phase 1-alpha — The Pure Kernel Transaction Loop

*Plan: [`packages/specs/plans/2026-05-27-phase-1-alpha-v3.0-alpha-kernel.md`](../packages/specs/plans/2026-05-27-phase-1-alpha-v3.0-alpha-kernel.md) · ADRs 0009 / 0010 / 0011.*

The substrate-fundament implementation: **11 kernel primitives + a property-test harness + 3 ADRs**, building the core loop *spawn → isolated worktree → delta → verify → promote/reject → spawn-record*. Shipped as a major version bump (v3.0.0-alpha) because the kernel surface changes incompatibly with v2.9 readers ([ADR-0009](../packages/specs/adrs/0009-major-bump-rationale.md)).

### What shipped

See [ARCHITECTURE §5](ARCHITECTURE.md#kernel-primitives) for what each primitive does. The honest accounting:

- **Live:** K2 (spawn-record envelope + K2.b), K3 (lineage), K4 (recall), K7 (path-canonicalize), K9 (promote-deltas), K10 (escape hatch), K13 (serial enforcer), K14 (write-scope enforcer) — atop the pre-existing K5 validators.
- **Dormant** (ships with no production importer; a CI gate enforces it): **K3.b** context envelope — first consumer is v3.1 personas; **K1** worktree-allocator — *superseded — the harness owns worktree creation; the kernel observes via `tool_response.worktreePath` at the v3.1 PR-3b spawn-close hook rather than allocating, so K1 gains no importer and `dormancy-assertion-k1` stays (the K3.b dormant-twin precedent, not "first-import flips the gate").*
- **Advisory** (warns, never blocks): **K12** layer-boundary lint.
- **Deferred** to later phases: **K6** (→ v3.1 — shipped dormant), **K8** (DROPPED — [ADR-0012](../packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md); `updatedInput` inert on Agent/Task spawns), **K11** (→ v3.2), **K2.c** (→ v3.3).

### Sub-PR cadence

| PR | What | State |
|---|---|---|
| #167 | ADRs 0009/0010/0011 + K3 lineage + K3.b context envelope (dormant) + bug-fix bundle | ✅ merged |
| #169 | K1 + K7 + K10 + K13 + pre-spawn-tool-mask + harness extensions | ✅ merged |
| #172 | K9 promote-deltas (ships dormant; mandatory 3-module split) | ✅ merged |
| #173 | K14 write-scope enforcer (split) + spawn-record envelope field + K13 provenance/retry (dormant) | ✅ merged |
| #174 | post-spawn-resolver + recovery-sweep + K9 `rollbackPromotion` + F20 — **first production importer of K9/K13/K14** (they go live) | ✅ merged |
| #175 | K12 layer-boundary advisory lint + non-blocking CI job | 🟡 draft, green CI, pending merge |

### How it was built

The discipline chain is part of the achievement: each PR ran route-decide → `/verify-plan` (HETS pair-review: architect + code-reviewer + security + honesty lenses) → TDD-treatment (failing tests written first as the behavioral spec) → impl-to-green → 3-lens review → harden → **independent Runtime-Claim-Probe verification** (re-run the tests/lints yourself; never trust agent self-report) → commit → user merge gate. Several PRs were built via multi-agent **workflows**; the HETS-persona approach (named-archetype lenses instead of generic agents) repeatedly surfaced orthogonal issues a single pass would miss.

---

## ✅ v3.1 — Runtime Foundation

*Plan: [`2026-05-31-phase-2-v3.1-runtime-foundation.md`](../packages/specs/plans/2026-05-31-phase-2-v3.1-runtime-foundation.md) · [ADR-0012](../packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md) · PRs #179/#180, #185–#191, #192–#197, #198, #199. Original est. ~24–36h; re-scoped 2026-05-31.*

The first phase to build on the kernel — the persona/capability runtime + the live (shadow-default) transaction loop, plus in-substrate idempotency. **What shipped:**

- ✅ **R1–R4** — two-tier persona contracts + capability traits + 18-contract migration (PR #179).
- ✅ **The static capability layer** (PR-2a) — the **agent.md↔contract reconciliation validator** is the *live* build-time enforcement (it does its own write/subprocess containment set-math). **K6** (`checkSubset`) + **K3.b `buildEnvelope`** ship **dormant** (zero production importer — a CI dormancy gate enforces it); their intended first consumer was K8, dropped below, so they await a v3.2+ runtime-subset consumer. *(Known-debt: the validator re-implements containment inline rather than calling K6 — converge or retire per the known-debt list.)*
- ✅ **Network axis** — decomposes into tool-mediated egress (`WebFetch`/`WebSearch`/MCP — enforced via agents/`<name>.md` `tools:`) + Bash-subprocess egress (now **audited**, advisory, by `network-egress-audit.js` on `PostToolUse:Bash`). Static reconciliation of a `network` axis is *not viable* (no `tools:` referent); egress *prevention* is ContainerAdapter-tier (see below).
- ✅ **The spawn-close transaction loop is WIRED, proven end-to-end on real git (in-process tests), AND dogfood-proven LIVE in a real session (2026-06-02)** — fired across all three dispatch arms (shadow / enforcing / candidate), HEAD untouched in every arm, an INV-22 provenance record written. The registered `PostToolUse:Agent|Task` close hook OBSERVES the harness `isolation:worktree` at close and runs `resolve()`: in **SHADOW** (the live default — journal-only, no git mutation; PR-3b) or, behind a strict `LOOM_RESOLVER_ENFORCE=1` (default OFF; PR-3c-b), in **ENFORCING-QUARANTINE** — the real `k9.promoteDelta` applies the spawn's materialized delta onto a `loom-promote/<agentId>` branch in a **throwaway out-of-repo staging worktree**. The user's working tree + HEAD are **never written**; all mutation is confined to the staging worktree + a deletable `loom-promote/*` ref *a human reviews and merges*. Genesis passes K9's **structural** gate (not a provenance check) and K14 scope detection is a **deliberate no-op** — human review of the staged branch is the only provenance + scope gate. **Auto-merge-to-HEAD stays deferred** (it needs the provenance layer). The P3 arc (#192–197) adds the parallel `integrateCandidates` assembler — N pinned per-spawn deltas folded in declared order onto `loom/integration`, criss-cross-safe, also never touching HEAD.

**Re-scoped (ADR-0012):** empirical probes proved a PreToolUse hook's `updatedInput` is **inert for Agent/Task spawns** (the Agent input has no `tools` field; tool/prompt rewrites are not honored). So **K8 — capability injection at spawn-init — is DROPPED** (its mechanism does not exist), and the inert `pre-spawn-tool-mask` is unregistered. **Capability enforcement is STATIC**: the agent.md frontmatter `tools:` (which the harness honors) + the reconciliation validator (build-time). K3.b's per-spawn context delivery is deferred (no injection channel exists).

- ✅ **INV-22 in-substrate idempotency** (PR #198 + hardening #199). Recon split the roadmap's "R13" into the buildable **in-substrate key** (shipped) vs the **network-side-effect enforcer** (re-slotted, below). `idempotency_key` is now wired into the record producers + **deduped on append** (a replay returns the existing `transaction_id`, no new record — fixes the F-01 re-fired-close duplicate at the write step). The key is a **verified content-address** (`deriveIdempotencyKey` re-derives it from the body → forged keys rejected/skipped, closing a record-suppression surface in the non-sandbox store), and `canonicalJsonSerialize` is **depth- + node-bounded** with the validator type-complete (closing a deep/wide-field crash/DoS). Built design-first: recon → /verify-plan board → TDD → 3-lens review → 2× hacker re-verify → CI.

**Re-scoped out of v3.1 (tracked, not dropped):**

- **K2.c per-tool-call observability → v3.3** — its only consumer is A6 reputation (v3.3); it is also the prerequisite for the network enforcer's `tool_calls[]`. (Was nominally v3.1; deferred to ship with its consumer.)
- **R13 Idempotency-Key Enforcer (network-side-effecting tool calls) → v3.5+** — gates a surface dormant through v3.1 (K6 denies network tools by default) and ADR-0012 forbids kernel wrapping of a spawn's tool calls; building it now ships inert dead code. Lands with the ContainerAdapter / network-egress work.
- **Carry-forward #4 (K13 spawn-id provenance under concurrency + `RESOLVER_TABLE`↔`SWEEP_DISPOSITIONS` reconcile) → v3.2** — K13 is serial-only, so the concurrency case is largely precluded; the two-map reconcile is internal-consistency robustness, not a correctness gap.

- ✅ **Architect-gate** (v6 §6.6 in-scope) — satisfied by the per-PR `route-decide` → `/verify-plan` → 3-lens board discipline; every PR in this phase ran it.

### Phase-close sign-off (2026-06-02)

Closed following the cadence: a **PM lens** (honesty-auditor — claim-vs-evidence + scope delivery) and a **principal-engineer lens** (architect — architectural soundness) both reviewed the merged phase. Both returned **CLOSEABLE** with doc-only accounting fixes (now applied) and **no code blocker**: 12/13 committed items shipped or legitimately re-slotted with a documented rationale (K8-drop = premise-falsification per ADR-0012; R13→INV-22 = recon disambiguation; K2.c→v3.3, #4→v3.2 = articulated deferrals); the never-touch-HEAD invariant is structurally enforced across all four mutating paths; the INV-22 content-address hardening verified. PM grade: **B+ (honest accounting; the overclaims were verb-tense, now corrected)**.

### v3.1 known-debt (tracked, none blocking)

- **K6/validator DRY** — two write/subprocess-containment implementations coexist (the dormant `checkSubset` engine vs the reconciliation validator's inline set-math). Converge on K6 when a runtime subset-check consumer lands (v3.2/v3.3), or retire K6 if none does (YAGNI across three phases).
- **`12-security-engineer` write-floor gap** — the one write-capable persona the reconciliation validator skips (no frontmatter write-floor bound). Close in v3.2.
- **`spawn-close-resolver.js` dispatch growth** — a 3-arm (shadow / enforce-quarantine / stage-candidate) env-flag branch; extract a data-driven `resolveDispatch` table before v3.2 adds a 4th consumer (Open/Closed).
- **Synchronous close-path git** — the close hook blocks on git (timeout-bounded + read-only in shadow; heavier in the gated enforcing path). Decouple to a background materializer; re-probe latency before enforcing goes default-on.
- **Carry-forward #4 ↔ the agentId-uniqueness probe are coupled** — both rest on K13 being serial-only; deferring both should be ONE explicit decision, and **#4 graduates from robustness to a v3.2-blocker the moment sibling concurrency goes live**.
- Minor: `SCHEMA_VERSION='v3'` is a string literal in 3+ modules (DRY).

---

## ⬜ v3.2 — Runtime Decomposition

*~16–22h.*

HETS decomposition disciplines (trampolines, leaf criteria, budget envelope, spawn-verify dispatcher, test-runner adapters) + **K11** kernel algorithm library — the point at which Axiom A4 (algorithmic discipline is kernel work) becomes binding.

---

## ⬜ v3.3 / v3.4 — Evolution Lab

*~14–20h / ~35–55h + substantial human-authored seed content.*

The Lab layer comes online: negative attestations (E1), derived-policy extraction (E2), a policy-axiom store fed through the A6 reputation snapshot (E3), reputation extension (E4) — then attribution graphs, convergence metrics, evolve/forge triggers, and reference test suites. This is where Axiom A5 (the substrate measures and evolves itself) is realized.

---

## 📄 v3.5 — Memory Manage-Layer (draft)

*RFC: [`packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md`](../packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md) — merged as recorded design; **amends nothing**.*

A forward design candidate (pre-scope-decision): a *manage layer* (manage-operations-as-transactions) + a typed causal-edge schema, re-grounding the older causal-recall-graph RFC onto the v6 consistency model. Carries an authority spine (R1–R4) from its security review and open questions (OQ-E/F/G) with fail-closed defaults.

---

## ⬜ Deferred / field-survey debt (v3.5+)

Explicitly out of v3.0-alpha scope, tracked for later:

- **ContainerAdapter** — pluggable Docker/Firecracker/E2B isolation under `packages/adapters/` (the reserved fourth layer).
- **Blocking-grade prompt-injection defense** and kernel-layer **network-egress policy**.
- **Hash-chained tamper-evidence** — v3.0-alpha is local-trust-anchored and does *not* defend against host-level filesystem tampering.
- A 10-item field-survey debt list (Policies-on-Paths, SAGA envelope-signing, MI9 drift detection, DeltaBox cherry-pick benchmarks, AGENTS.md interop, …) catalogued under [`packages/specs/research/`](../packages/specs/research/).

---

## Appending to this roadmap

When a phase ships, move it above the line with a ✅, link its plan + ADRs + merged PRs, and record the honest primitive/feature accounting (live / dormant / advisory / deferred). Keep estimates on planned phases marked as estimates. The design record in `packages/specs/` is authoritative; this file is the readable digest.
