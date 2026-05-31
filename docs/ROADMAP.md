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

- **Live:** K1 (worktree), K2 (spawn-record envelope + K2.b), K3 (lineage), K4 (recall), K7 (path-canonicalize), K9 (promote-deltas), K10 (escape hatch), K13 (serial enforcer), K14 (write-scope enforcer) — atop the pre-existing K5 validators.
- **Dormant** (ships with no production importer; a CI gate enforces it): **K3.b** context envelope — first consumer is v3.1 personas.
- **Advisory** (warns, never blocks): **K12** layer-boundary lint.
- **Deferred** to later phases: K6, K8 (→ v3.1), K11 (→ v3.2), K2.c (→ v3.1).

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

## 🟡 v3.1 — Runtime Foundation (in progress)

*Original est. ~24–36h; **re-scoped 2026-05-31** — see [ADR-0012](../packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md).*

The first phase to build on the kernel. **Shipped so far:**

- ✅ **R1–R4** — two-tier persona contracts + capability traits + 18-contract migration (PR #179).
- ✅ **K6** (capability subset-check) + **K3.b `buildEnvelope`** + the **agent.md↔contract reconciliation validator** — the static capability layer (PR-2a).

**Re-scoped (ADR-0012):** empirical probes proved a PreToolUse hook's `updatedInput` is **inert for Agent/Task spawns** (the Agent input has no `tools` field; tool/prompt rewrites are not honored). So **K8 — capability injection at spawn-init — is DROPPED** (its mechanism does not exist), and the inert `pre-spawn-tool-mask` is unregistered. **Capability enforcement is STATIC**: the agent.md frontmatter `tools:` (which the harness honors) + the reconciliation validator (build-time). K3.b's per-spawn context delivery is deferred (no injection channel exists).

- ⬜ Still planned: R13 idempotency-key enforcer; K2.c per-tool-call observability; extend the reconciliation validator to the **network axis** (closes the restriction `pre-spawn-tool-mask` falsely claimed to enforce).

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
