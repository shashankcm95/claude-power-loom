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
- **Deferred** to later phases: **K11** (→ v3.2), **K2.c** (→ v3.3). **Retired/Dropped:** **K6** (shipped dormant v3.1; **RETIRED v3.2 Wave 2** once its K8 consumer never arrived), **K8** (DROPPED — [ADR-0012](../packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md); `updatedInput` inert on Agent/Task spawns).

### Sub-PR cadence

| PR | What | State |
|---|---|---|
| #167 | ADRs 0009/0010/0011 + K3 lineage + K3.b context envelope (dormant) + bug-fix bundle | ✅ merged |
| #169 | K1 + K7 + K10 + K13 + pre-spawn-tool-mask _(retired v3.2 Wave 2)_ + harness extensions | ✅ merged |
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
- ✅ **The static capability layer** (PR-2a) — the **agent.md↔contract reconciliation validator** is the *live* build-time enforcement (it does its own write/subprocess containment set-math). **K3.b `buildEnvelope`** ships **dormant** (zero production importer — a CI dormancy gate enforces it); its intended first consumer was K8, dropped below, so it awaits a v3.2+ injection channel. **K6** (`checkSubset`) was the dormant twin here but has since been **RETIRED** (v3.2 Wave 2, boundary #216 — no runtime-subset consumer emerged across three phases; the validator's inline set-math is the single live containment implementation, resolving the former K6/validator DRY debt).
- ✅ **Network axis** — decomposes into tool-mediated egress (`WebFetch`/`WebSearch`/MCP — enforced via agents/`<name>.md` `tools:`) + Bash-subprocess egress (now **audited**, advisory, by `network-egress-audit.js` on `PostToolUse:Bash`). Static reconciliation of a `network` axis is *not viable* (no `tools:` referent); egress *prevention* is ContainerAdapter-tier (see below).
- ✅ **The spawn-close transaction loop is WIRED, proven end-to-end on real git (in-process tests), AND dogfood-proven LIVE in a real session (2026-06-02)** — fired across all three dispatch arms (shadow / enforcing / candidate), HEAD untouched in every arm, an INV-22 provenance record written. The registered `PostToolUse:Agent|Task` close hook OBSERVES the harness `isolation:worktree` at close and runs `resolve()`: in **SHADOW** (the live default — journal-only, no git mutation; PR-3b) or, behind a strict `LOOM_RESOLVER_ENFORCE=1` (default OFF; PR-3c-b), in **ENFORCING-QUARANTINE** — the real `k9.promoteDelta` applies the spawn's materialized delta onto a `loom-promote/<agentId>` branch in a **throwaway out-of-repo staging worktree**. The user's working tree + HEAD are **never written**; all mutation is confined to the staging worktree + a deletable `loom-promote/*` ref *a human reviews and merges*. Genesis passes K9's **structural** gate (not a provenance check) and K14 scope detection is a **deliberate no-op** — human review of the staged branch is the only provenance + scope gate. **Auto-merge-to-HEAD stays deferred** (it needs the provenance layer). The P3 arc (#192–197) adds the parallel `integrateCandidates` assembler — N pinned per-spawn deltas folded in declared order onto `loom/integration`, criss-cross-safe, also never touching HEAD.

**Re-scoped (ADR-0012):** empirical probes proved a PreToolUse hook's `updatedInput` is **inert for Agent/Task spawns** (the Agent input has no `tools` field; tool/prompt rewrites are not honored). So **K8 — capability injection at spawn-init — is DROPPED** (its mechanism does not exist), and the inert `pre-spawn-tool-mask` was unregistered (and **removed in v3.2 Wave 2**, retired with K6). **Capability enforcement is STATIC**: the agent.md frontmatter `tools:` (which the harness honors) + the reconciliation validator (build-time). K3.b's per-spawn context delivery is deferred (no injection channel exists).

- ✅ **INV-22 in-substrate idempotency** (PR #198 + hardening #199). Recon split the roadmap's "R13" into the buildable **in-substrate key** (shipped) vs the **network-side-effect enforcer** (re-slotted, below). `idempotency_key` is now wired into the record producers + **deduped on append** (a replay returns the existing `transaction_id`, no new record — fixes the F-01 re-fired-close duplicate at the write step). The key is a **verified content-address** (`deriveIdempotencyKey` re-derives it from the body → forged keys rejected/skipped, closing a record-suppression surface in the non-sandbox store), and `canonicalJsonSerialize` is **depth- + node-bounded** with the validator type-complete (closing a deep/wide-field crash/DoS). Built design-first: recon → /verify-plan board → TDD → 3-lens review → 2× hacker re-verify → CI.

**Re-scoped out of v3.1 (tracked, not dropped):**

- **K2.c per-tool-call observability → v3.3** — its only consumer is A6 reputation (v3.3); it is also the prerequisite for the network enforcer's `tool_calls[]`. (Was nominally v3.1; deferred to ship with its consumer.)
- **R13 Idempotency-Key Enforcer (network-side-effecting tool calls) → v3.5+** — gates a surface that is empty by default (network tools are denied via agents/`<name>.md` `tools:` — the harness-honored static gate, 0/18 agents grant `WebFetch`/`WebSearch`/`mcp__*`; NOT a K6 runtime check, which never gated anything and is now retired) and ADR-0012 forbids kernel wrapping of a spawn's tool calls; building it now ships inert dead code. Lands with the ContainerAdapter / network-egress work.
- **Carry-forward #4 (K13 spawn-id provenance under concurrency + `RESOLVER_TABLE`↔`SWEEP_DISPOSITIONS` reconcile) → v3.2** — K13 is serial-only, so the concurrency case is largely precluded; the two-map reconcile is internal-consistency robustness, not a correctness gap.

- ✅ **Architect-gate** (v6 §6.6 in-scope) — satisfied by the per-PR `route-decide` → `/verify-plan` → 3-lens board discipline; every PR in this phase ran it.

### Phase-close sign-off (2026-06-02)

Closed following the cadence: a **PM lens** (honesty-auditor — claim-vs-evidence + scope delivery) and a **principal-engineer lens** (architect — architectural soundness) both reviewed the merged phase. Both returned **CLOSEABLE** with doc-only accounting fixes (now applied) and **no code blocker**: 12/13 committed items shipped or legitimately re-slotted with a documented rationale (K8-drop = premise-falsification per ADR-0012; R13→INV-22 = recon disambiguation; K2.c→v3.3, #4→v3.2 = articulated deferrals); the never-touch-HEAD invariant is structurally enforced across all four mutating paths; the INV-22 content-address hardening verified. PM grade: **B+ (honest accounting; the overclaims were verb-tense, now corrected)**.

### v3.1 known-debt (tracked, none blocking)

- **K6/validator DRY** — ✅ **RESOLVED (v3.2 Wave 2)**: K6 (`checkSubset`) was **retired** (YAGNI — no runtime subset-check consumer emerged across three phases; its only intended consumer K8 was dropped per ADR-0012), leaving the reconciliation validator's inline set-math as the single write/subprocess-containment implementation.
- **`12-security-engineer` write-floor gap** — the one write-capable persona the reconciliation validator skips (no frontmatter write-floor bound). Close in v3.2.
- **`spawn-close-resolver.js` dispatch growth** — a 3-arm (shadow / enforce-quarantine / stage-candidate) env-flag branch; extract a data-driven `resolveDispatch` table before v3.2 adds a 4th consumer (Open/Closed).
- **Synchronous close-path git** — the close hook blocks on git (timeout-bounded + read-only in shadow; heavier in the gated enforcing path). Decouple to a background materializer; re-probe latency before enforcing goes default-on.
- **Carry-forward #4 ↔ the agentId-uniqueness probe are coupled** — both rest on K13 being serial-only; deferring both should be ONE explicit decision, and **#4 graduates from robustness to a v3.2-blocker the moment sibling concurrency goes live**.
- Minor: `SCHEMA_VERSION='v3'` is a string literal in 3+ modules (DRY).

---

## ✅ v3.2 — Runtime Decomposition

*Plan: [`2026-06-02-v3.2-runtime-decomposition-scope.md`](../packages/specs/plans/2026-06-02-v3.2-runtime-decomposition-scope.md) · [ADR-0015](../packages/specs/adrs/0015-failure-signature-schema-freeze.md) · PRs #214–227 + #231/#232/#233 + #235–#237. Est. ~16–22h. · **Released 3.2.0** (2026-06-04).*

HETS decomposition disciplines (trampolines, leaf criteria, budget envelope, spawn-verify dispatcher, test-runner adapters) + **K11** kernel algorithm library — the point at which Axiom A4 (algorithmic discipline is kernel work) becomes binding.

**What shipped** (the HETS decomposition + verification tier, across three waves):

- **Wave 1 — primitives** (#214–219): R6 (Pattern-A serial trampoline) + R7 (todo-checkpoints) + R8 (disciplines vocabulary) + R10 (budget/recursion envelope), plus the `checkWithinRoot` pre-normalization trap-class fix (#215) and the `isSafePathSegment` single-source refactor (#217).
- **Wave 2 — verification tier** (#220–224): K6 retired (its K8 consumer never arrived); R12 test-runner adapters; R9 six-criteria leaf gate; R11 spawn-verify dispatcher → the ADR-0015 `failure_signature` frozen 8-field witness. The 5-fixture exit demo is met.
- **Wave 3 — A4 binding** (#227): the K11 A4-binding gate flipped `enforcement` from `warn` to `error`. Per the Option-B reclassification (architect-VERIFY + user-ratified), R9/R11 are **runtime** constants, not kernel algorithms (the Wave-1 boundary rule: derivation logic is kernel; a membership/threshold check or a subprocess-spawning routine is a runtime constant) — so `planned[]` is drained and the gate hard-enforces structural integrity + the unregistered-`.js` scan + no-park-and-forget.
- **Post-Wave-3 fixes:** the route-decide substrate-meta dictionary hybrid (#231); the A4-gate insider-bypass hardening (#232); the kb-resolver `kb:`-prefix tolerance (#233).

**Exit criteria — all MET:**

| # | Criterion | Evidence |
|---|---|---|
| 1 | A Pattern-A trampoline completes a 3-leaf task within budget (R6+R7+R10) | `trampoline.test.js` "EXIT DEMO"; CI Runtime-tests job |
| 2 | 5 failing fixtures rejected by spawn-verify (R9+R11+R12, incl. a node-runner fixture) | `spawn-verify.test.js` — 5 fixtures, EXIT #5 = the node-runner failing fixture |
| 3 | A4 is binding | `manifest.json` `enforcement:"error"` + drained `planned[]`; the gate is CI-wired (`contracts-validate.js`) + runtime-probed (exits 1 on a `planned-not-realized` error) |

The **deferred R10-per-leaf-attribution follow-up** (the reserved `budget-abort` + `schema` `failure_signature` producers) was firsthand-probed at close and **correctly deferred to v3.3+** — Pattern A has no per-leaf measurement boundary (one serial spawn processes a whole leaf-subtree; measurement is at spawn-close, not per-leaf), so lighting those producers now would ship an inert check (ADR-0012). Tracked: [#234](https://github.com/shashankcm95/claude-power-loom/issues/234). The unblock is Pattern B (per-leaf sub-spawn, v3.5+/E12) or a within-spawn per-leaf meter.

### Phase-close sign-off (2026-06-04)

Run per `/phase-close v3.2` (the first dogfood of the gate built in #226) — three independent full-context in-substrate lenses reviewed the **integrated** phase against its exit criteria. All three returned **CLOSEABLE**:

- **PM** (honesty-auditor) — Grade A / no-overclaim. All three exit criteria CONFIRMED; the A4 gate is genuinely CI-wired + runtime-probed (NOT merged-dark — it rides `contracts-validate.js`, source-executed in CI); the Option-B reframe is explicitly disclosed, not a goalpost-move.
- **Principal-SDE** (code-reviewer at phase altitude) — all four cross-PR seams clean (the ADR-0015 3-way enum set-equality fitness test is live + non-vacuous; R9→R12→R11 result-shape consistent; the K11 manifest ↔ route-decide ↔ A4-gate triangle green; the path-canonicalize single-source refactor complete).
- **Architect** — the architecture held across waves; the Option-B boundary rule is sound + consistent; the ADR-0015 `failure_signature` forward contract is genuinely ready for the v3.3 E2 consumer (the structural/diagnostic firewall holds across the two-source design; the reserved members are correct append-only forward-compat).

**Honest deployment posture (recorded per the architect's MEDIUM):** v3.2's "done" is **done-DARK** — all code is CI/unit-validated and the within-runtime 5-fixture demo exercises R9→R11→R12 end-to-end, but the **harness-integration** path (the trampoline under a real Agent spawn; spawn-verify firing from a live hook) has not yet run at runtime (the active plugin is the 3.1.0 cache; no `hooks.json` wiring). The version-bump + whole-substrate dogfood at the v3.2→v3.3 boundary is that first harness probe; v3.3 must not build on an assumed-live integration. Durable record: the `toolkit/phase-close/v3.2-close` library volume.

### v3.2 carry-list for v3.3 (none blocking)

- Honor serial-consistency of the new v3.3 E3/E4 shared-state writers (carry-forward #4 / K13) — graduates to a blocker only at Pattern-B/E12 concurrency (v3.5+).
- K2.c + A6 reputation (chartered v3.3 scope, not inherited debt).
- The R10-per-leaf-attribution producers — deferred v3.3+/v3.5 ([#234](https://github.com/shashankcm95/claude-power-loom/issues/234)).
- Low-severity gate findings (non-blocking): `manifest.exports[]` under-declaration, a stale barrel comment, an untested env kill-switch — remediated separately or carried.
- Canonical forward design: [`v3.3-substrate-synthesis-v3.md`](../packages/specs/rfcs/v3.3-substrate-synthesis-v3.md) (v2 superseded).

---

## ✅ v3.3 — Evolution Lab Foundation (Wave 0 + E1)

*Plan: [`2026-06-04-v3.3-evolution-lab-foundation-scope.md`](../packages/specs/plans/2026-06-04-v3.3-evolution-lab-foundation-scope.md) + the Wave-1 E1 plan + the [orchestration design-spike](../packages/specs/spikes/2026-06-04-v3.3-orchestration-design-spike.md) · [ADR-0015](../packages/specs/adrs/0015-failure-signature-schema-freeze.md) · PR #240. **RESHAPED** by a cumulative substrate-coherence pass to Wave 0 + E1; E2/E3/E4 → v3.4.*

The first **Layer-3 (Evolution Lab)** code. A cumulative-coherence pass (the discipline: *v6 is a blueprint, not the build — test that the WHOLE substrate up to the built point coheres, not just the phase; earlier-layer reality reshapes later design*) reshaped the chartered E1–E4 to **Wave 0 (un-darken) + E1 only** — E2/E3/E4 are volume-amplifiers (Jaccard clustering / recall ranking / EWMA) over a near-empty producer, deferred to v3.4 to be designed against real attestation distributions rather than 5 fixtures.

**What shipped:**

- **Wave 0 — the un-darkening:** `decompose-run` writes a result OUTBOX (`<run-state>/<run-id>/decompose-result.json`); the Lab **E1 ingest** reads it as a **data file** (no `runtime→lab` import — K12-clean; the Lab *pulls*, nothing pushes in) → records the rejected leaf's `failure_signature`. Live-dogfood-verified end-to-end: a real `code-reviewer` Agent spawn drove decompose-run → outbox → an E1 attestation on disk.
- **E1 — negative-attestation store** (`packages/lab/negative-attestation/`): the advisory Layer-3 witness — wraps the [ADR-0015](../packages/specs/adrs/0015-failure-signature-schema-freeze.md) `failure_signature` **verbatim** into a durable, wall-clock-expiring record; **accumulate-not-dedup** (the signature is content-hashed into the event id, so distinct failures at one leaf accumulate); `verifier_kind` preserved (**R1**: the future E4 weighs measured `test-run` ≠ declared `structural`). Lab-owned append ledger; advisory-only; zero kernel-state writes.

**Exit criteria — all MET:**

| # | Criterion | Evidence |
|---|---|---|
| 1 | A real spawn drives `decompose-run` → ≥1 `failure_signature` reaches E1 | MUST-PROBE + the live dogfood (the spawn-half, a one-time empirical probe); the outbox→ingest→E1 **machine-half is durably tested** (the decompose-run + ingest suites) |
| 2 | 5 deliberately-failing fixtures → structured, verbatim, `verifier_kind`-stratified records | `store.test.js` — the 5-criterion exit + the verbatim (8-field) check + the H1 accumulate-vs-replay lock |
| 3 | 0 CRITICAL pair-review findings | the 3-lens VALIDATE found AND fixed C1 (CRITICAL — `runId` path-traversal) + H1 (HIGH — dedup-collision); honesty-auditor Grade-A |

**Honest deployment posture:** v3.3 ships E1 **INERT** — there is no *new* production trigger (the decompose tier remains hook-unwired; the persona instinct-binding was deferred because a shipped general persona can't carry a substrate-internal path). v3.3 proves **module-composition-driven-by-a-real-spawn**, NOT Pattern-B (depth-1: a plugin-spawned persona has no Agent/Task tool, only Bash — it cannot sub-spawn), and the Lab can only learn *mechanical leaf-declaration* failures (the 4 structural enums; `semantically-cohesive` quality is advisory and never attested). The production decomposition trigger is v3.4 work.

### Phase-close sign-off (2026-06-04)

Run per `/phase-close v3.3` — three independent full-context lenses (PM = honesty-auditor; Principal-SDE = code-reviewer at phase altitude; Architect) reviewed the **integrated** phase against its exit criteria. **All three CLOSEABLE; 0 engineering must-fix.**

- **PM** — Grade A / no-overclaim. The phase prose systematically *rounds down* (the reshape itself cut three primitives and said so). All three exit criteria met against durable artifacts (EC1's spawn-half honestly marked a one-time MUST-PROBE, not a continuously-verified capability).
- **Principal-SDE** — all cross-layer seams clean (the runtime↔lab outbox data-contract is consistent end-to-end; the C1 `runId` guard is symmetric on both the outbox-write and the ingest-read; K12 = 0 findings).
- **Architect** — phase design sound; E1's frozen record is a forward-complete contract for the deferred v3.4 E2/E4 consumers.

The gate **earned its keep**: it caught this ROADMAP section's pre-reshape staleness (now corrected) + the `attestation_id` doc-decay (the as-built 3-component content-address `(run_id, leaf_ref, sig_hash)` vs the frozen 2-component §3c sketch — a strengthening from the H1 fix, now status-noted in the Wave-1 plan). Durable record: the `toolkit/phase-close/v3.3-close` library volume.

---

## ✅ v3.4 — Evolution Lab Full (closed at the advisory loop, in shadow)

*Est. ~30–55h + human-authored seed content. The deferred amplifiers + the production trigger.*

The Lab layer comes to volume.

**Shipped waves (all merged to `main`):**

- **Wave 0** — determinism carry-overs + the `canonical-json` `kernel/_lib` leaf (#242).
- **Wave 1** — the evidence-linked verdict-attestation store + the agentId→`transaction_id` enricher + the F4 kernel canary (#243).
- **Wave 2** — **E4** reputation derived-view (display-only projection over W1; INV-W1 enriched-only) + the shared `recency-decay` leaf (#244); the bounded JSONL-read deep-fix (#245).
- **Wave 3 — A6 snapshot mediator** *(this wave)* — the kernel **records** the lab-materialized reputation snapshot into `axioms.evolution_snapshot.reputation` at spawn-close (**records-not-injects**, ADR-0012), read O(1) as a data file (§3.6, K12-clean) + hash-self-verified (INV-22); **atomic-rename supersession** (no invalidation — v6:179/408); the `reputation materialize` / `snapshot` advisory read path — a CLI surface a future router would consume; nothing is wired to it yet (§0a.3.1 "MAY recommend"). **The kernel STAYS shadow** — A6 records + advises, never gates K9 (the "leave shadow?" decision, resolved NO). New leaf `kernel/_lib/evolution-snapshot-read` (4th extract-to-leaf). [Probe spike](../packages/specs/spikes/2026-06-04-v3.4-wave3-a6-probe.md).
- **Wave 4 — E11 circuit-breaker (shadow)** *(this wave)* — recon found the W0→W3 loop **inert** (0 production triggers → E2/E3 premature), so the disciplined next is the **un-darkening prerequisite**: a denial-rate circuit-breaker (`lab/circuit-breaker`), built **before** the thing it guards (design-input (a)). A pure sliding-window projection over E1's denials → per-persona + global breakers + an `evaluate` decision API. **§0a.3.1-safe by construction**: it only NARROWS/halts (v6:173 "monotonically safe") → no INV-W1 gate (unlike E4). OQ-8 resolved (per-persona + global; sliding window; `LOOM_DISABLE_CIRCUIT_BREAKER` bypass; env-thresholds capped *below* the ledger bound so they can't disable it). **SHADOW — halts nothing yet** (hooks.json 0-ref); wiring it live is a binding **GATE** on un-darkening the decompose tier. No `kernel/_lib` leaf (correctly resisted — no cross-layer consumer).
- **Wave 5 — the promote/merge identity RFC (decision, no code)** *(this wave)* — recon reframed the open "enforcing vs advisory" question: v6 already settles the broad split (A3a kernel-gates enforce / A3b LLM-mediated advises), so the genuinely-open question is the **disposition of a gate-PASSING delta** (shadow → enforce-quarantine → candidate-stage → auto-merge). RFC [`2026-06-04-enforcing-vs-advisory-identity`](../packages/specs/rfcs/2026-06-04-enforcing-vs-advisory-identity.md) (architect + honesty-auditor reviewed; honesty Grade A) **ratified Option B — human-gated promotion (PROVISIONAL)**: shadow stays default, the staging machinery becomes a supported opt-in ceiling (revert-toward-retire if unused within one release cycle), **auto-merge retired-until-ContainerAdapter**. Activation (docs + a promote-path breaker + picking the rung-2 mechanism) is a follow-up build.
- **Wave 6 — verdict→E4 dogfood un-darkening** *(this wave)* — the verdict-attestation→E4→A6 chain was built but had **no routine producer**; recon found the §0a.3.1 evidence-link is the **SUBJECT (delegated, delta-bearing) spawn**, so only delegated builds yield legal subjects. Closed the loop by **dogfooding on this wave's own build**: delegated the `record-review` CLI build to `node-backend` (a delta-bearing subject), 3-lens VALIDATEd it, then recorded the first real verdict-attestation linking its spawn → enrich → E4 (`13-node-backend`: 3 pass, R1-stratified) → A6 snapshot. NEW `record-review` batch subcommand ([cli.js](../packages/lab/verdict-attestation/cli.js)) + the recording convention in the agent-team reputation pattern. **Dogfood/self-measurement scope** (Axiom 5; advisory). The store-hardening the 3-lens hacker surfaced (H-1 silent-drop + M-1 input-screening) was completed in a follow-up (`#249`). [plan](../packages/specs/plans/2026-06-04-v3.4-wave6-verdict-undarken.md).
- **E11-rescue** (`#250`) — re-aimed the W4 breaker's DEFAULT denial-source from the starved E1 store to the LIVE verdict-`fail` stream (pluggable source registry; E1 opt-in via `LOOM_BREAKER_SOURCE`) + wired the orchestrator persona-selection **HALT-consumer** (`check --persona`). [plan](../packages/specs/plans/2026-06-07-v3.4-e11-rescue-verdict-fail-consumer.md).
- **A6-advise** (`#254`) — wired the orchestrator persona-selection **ADVISE-consumer** (`reputation snapshot --personas`: caller-order filter, `no-data` markers, prefer-stronger-DISTRIBUTION among same-lens candidates, tie-breaker-after-lens; NOT a score). **Closes the last E4/A6 dark edge** → the advisory loop is complete in shadow. [plan](../packages/specs/plans/2026-06-07-v3.4-a6-advise-read-consumer.md).

**Exit criteria (v3.4 close — RESHAPED to the advisory loop, mirroring the v3.3 reshape):**

The cumulative-coherence discipline that reshaped v3.3 applies again: v3.4 "Full" was over-chartered; the volume-/Pattern-B-gated remainder can't be built coherently yet (building it ships premature/inert code — ADR-0012). So v3.4 closes at the **complete advisory loop, in shadow**:

- **EC1 — Evidence-linked reputation:** the verdict-attestation store records emission-attestations evidence-linked (`agentId`→`transaction_id`) to kernel spawn-records; **E4** projects them into a per-persona advisory-verdict **DISTRIBUTION** (display-only; INV-W1 enriched-only; NOT a score).
- **EC2 — A6 mediation, kernel stays shadow:** the kernel **records** the lab-materialized reputation snapshot at spawn-close (records-not-injects, ADR-0012), O(1) data-file read + hash-self-verified (INV-22), atomic-rename supersession; reputation **never enters K9**.
- **EC3 — E11 denial circuit-breaker:** a pure sliding-window projection over the verdict-`fail` stream → per-persona + global breakers + an `evaluate` decision API; **§0a.3.1-safe by construction** (narrows-only); env-thresholds capped below the ledger bound.
- **EC4 — the advisory loop CLOSED (in shadow):** both consumers wired as orchestrator conventions — **E11 halt** (`circuit-breaker check --persona`) + **A6 advise** (`reputation snapshot --personas`). `produce → advise + halt → consume` complete; 0 `hooks.json` production triggers (shadow).
- **EC5 — §0a.3.1 coherence throughout:** derived views project over evidence-linked emission-attestations (no trust-by-frequency); advisory-only — never gates K9, never widens capability; the leave-shadow graduation gates (E11 G1 dedup-by-subject + G2 source-validation; A6 M1 snapshot-provenance) are TRACKED, not built (graduation is a separate phase).

**Deferred to v3.5+ — the volume-/Pattern-B-gated remainder (RESHAPED, NOT scope-cut; structural reasons, the same class v3.3 deferred):**

- **E2 / E3** (derived-policy extraction + policy-axiom store + K4 recall) — **premature**: gated on real attestation volume (≈ "≥N attestations across ≥M personas in normal use"), of which there is none. Tuning the amplifiers (Jaccard/recall/EWMA) to fixtures would fit the wrong distribution (the exact v3.3 lesson).
- **The production decomposition trigger** — a hard open design problem (depth-1: plugin-spawned personas have no Agent/Task tool; the general-persona-path constraint). It is the prerequisite for E2/E3 volume and naturally co-lands with Pattern B.
- **E5–E10** (attribution graphs · convergence-metrics CLI · evolve/forge triggers · cross-persona review · KB-seed · reference test suites) — the deep Axiom-A5 realization; also wants real volume.
- **R10-per-leaf** ([#234](https://github.com/shashankcm95/claude-power-loom/issues/234)) — blocked on **Pattern B** (per-leaf sub-spawn, v3.5+/E12); **K2.c** per-tool-call observability ships with its consumer.

**Earlier-layer decisions (v3.3 §4.5) — RESOLVED in-phase:** kernel shadow-permanence (W3 — stays shadow for A6; reputation never enters K9; leaving shadow is a separate `LOOM_RESOLVER_ENFORCE`-class phase); `computeRecencyDecay` activate-or-supersede (W2 — one shared leaf, two display consumers). Carried: reconsider the kernel per-spawn resolver-journal as a richer Lab input than decompose-run's low-volume per-leaf rejects.

### Phase-close sign-off (2026-06-07)

Run per `/phase-close v3.4` — three independent full-context lenses (PM = honesty-auditor; Principal-SDE = code-reviewer at phase altitude; Architect) reviewed the **integrated** phase against EC1–EC5. **All three CLOSEABLE.**

- **PM** — Grade A / no-overclaim. All five exit criteria honestly met against code (EC4 "loop closed in shadow" verified — `grep "lab/" packages/kernel/hooks.json` = ∅; EC1 evidence-link REQUIRED at `verdict-attestation/store.js:152`; INV-W1 enriched-only at `reputation/project.js:90`). The **reshape is structurally legitimate, not goalpost-moving** — the deferrals are volume-/Pattern-B-gated (the same class v3.3 deferred); the W4→W6 "real volume" is honestly scoped as **dogfood-only** (3 attestations, 1 spawn), never inflated to production. Graduation gates (E11 G1/G2, A6 M1) tracked as future-work. The phase systematically rounds DOWN.
- **Principal-SDE** — cross-PR contracts CONSISTENT (the verdict-attestation shape agrees across the E4 / E11 / A6 consumers; `VALID_VERDICTS` imported, not re-declared); the A6 snapshot shape single-sourced via the `evolution-snapshot-read` path+hash leaf; the four shared `kernel/_lib` leaves used consistently; K12 0 findings; shadow intact (0 `lab/` hooks). **FLAG-4 RESOLVED** — the reported `jest`-parallel "25 failures" was an artifact of a tool the project does not use (the lab-test runner is `find + node`, per `.github/workflows/ci.yml`; no jest dep/config); root cause was duplicate test copies in an **orphaned agent worktree**, now removed + `.claude/` gitignored. **FLAG-1 (cross-store integration test) RESOLVED IN-PHASE** — added `tests/unit/lab/cross-store-loop.test.js`: one seeded verdict store fans out to E4 + A6 + E11, asserting the advise + halt consumers cohere from one evidence base (4/4 green; the executable proof of EC4).
- **Architect** — the advisory loop coheres end-to-end as a layer (every Lab module imports only `kernel/_lib` pure leaves; the single Lab→Kernel edge is the §3.6 A6 mediation, records-not-injects); the **close-boundary is the right shippable unit** — nothing built needs a deferred item to be correct (the E11-rescue re-aim is what makes "complete loop" honest, not aspirational); the verdict-attestation + snapshot schemas are forward-complete Published Languages for the deferred E2/E3 readers (no v3.5 breaking reshape implied); kernel-stays-shadow is sound as a phase-permanent stance.

**v3.5 carry-list (named, non-blocking — from the phase-close lenses):**

- E11 D6 dedup-by-subject (`evidence_refs.agent_id`) **+ a half-open/hysteresis gate** — REQUIRED alongside E11 G1/G2 + A6 M1 before any leave-shadow gating phase [architect + SDE].
- Re-validate the ledger/field bounds (`MAX_FIELD_LEN`, `MAX_LEDGER_RECORDS`) against real E2/E3 volume [architect].
- G1/G2/M1 graduation-gate comment anchors in the lab code for traceability [SDE].
- The loop stays INERT (0 production triggers) — v3.5 inherits an empty store; the production decomposition trigger + Pattern B unblock E2/E3 volume [architect].
- **`route-decide` dictionary-expansion architect pass** — `drift:dictionary-gap` converged (3) via `/self-improve` 2026-06-07: the scorer dictionary is `v1.2-dict-expanded-2026-05-07` and contains **none** of the v3.3/v3.4 Lab vocabulary (E1–E12, `decompose-run`, circuit-breaker, reputation, attestation, canonical-json, evolution-snapshot, K12–K14), so substrate-meta tasks under-route. Keyword-set/weight changes are LOAD-BEARING (`route-decide.js:11-13`) and **require a new architect pass** with a re-validation of the weighted formula — do NOT hand-edit the keyword sets. Bump `WEIGHTS_VERSION` on landing. [self-improve] **→ DELIVERED v3.8a W2 (2026-06-12): the mandated architect pass ran; `WEIGHTS_VERSION → v1.3-dict-expanded-2026-06-12`; see the v3.8 section.**

Durable record: the `toolkit/phase-close/v3.4-close` library volume.

---

## ✅ v3.5 — Memory Manage-Layer + Causal-Recall Graph (COMPLETE — phase-closed 2026-06-08)

*RFC: [`packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md`](../packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md) — merged as recorded design; **amends nothing**. Scope: [`2026-06-07-v3.5-memory-manage-scope.md`](../packages/specs/plans/2026-06-07-v3.5-memory-manage-scope.md). SHADOW throughout (advisory; never gates K9).*

The first **Memory Manage-Layer** code: a *manage layer* (manage-operations over memory) + a typed causal-edge graph, re-grounded onto the v6 consistency model. The same cumulative-coherence discipline that reshaped v3.3/v3.4 governs each wave — derive from the PROBED reality of the layers below, not the blueprint. **The manage-WRITE layer is COMPLETE** — Waves 0–3b.2 + the validator-consolidation follow-up are MERGED (#259/#261/#262/#263/#264/#265/#267); phase-closed 2026-06-08 (sign-off below). Live destructive enforcement is the named v3.6 thrust.

- **Wave 0 — the read/project half** (`#259`) — the deterministic-manage PROJECTIONS (`mark-stale` + `retention-archive`) + the provenance-edge VIEW: pure projections over a passed-in record set that emit NO record (v6 §5a.1). [provenance-projections](../packages/kernel/_lib/provenance-projections.js).
- **Wave 1 — the spikes / GO-NO-GO** (`#261`) — **OQ-E NO-GO**: the record-store + wal-append are both writer-unauthenticated, so the kernel-attested-writer primitive defers to v3.6 (exposure LATENT — no live destructive emitter); OQ-27 GO (the read-side walker is tractable); OQ-21 GO-advisory (a real-`claude -p` rung-2 calibration is owed). [spikes](../packages/specs/spikes/2026-06-07-v3.5-wave1-spikes-oqe-oq27-oq21.md).
- **Wave 2 — the causal-edge graph loop** (`#262`) — the advisory `packages/lab/causal-edge/` store (**D1**: a dedicated advisory Lab store, v6-conformant via §10b/OQ-24 — NOT a kernel schema-branch) + the OQ-27 read-side walker (R3 FILTER-THEN-INDEX) + the faithfulness rung-2 fail-closed injectable judge. The first producer→consumer loop, function-level. **C1** (the 3-lens durable): `updateEdgeStatus` flips R3 eligibility UNAUTHENTICATED = the writer-unauthenticated Lab model — DOCUMENTED-not-enforced (ADR-0012 inert-theater), bounded by narrowing-safety. [plan](../packages/specs/plans/2026-06-07-v3.5-wave2-causal-edge-graph-loop.md).
- **Wave 3a — `flag-conflict`, the manage WRITE half's first op** (`#263`) — a cumulative-coherence pass found Wave 2 ABSORBED scope-W3.2 (R3/R4), collapsing the planned "W3 security spine" to its **manage-write-layer**. `flagConflict` is a thin validated CREATE over the Wave 2 store (relation pinned to `contradicts`, born `unvalidated`/AUDIT-ONLY), plus the `conflicted` LAB projection (**D2**: a Lab projection, NOT a kernel lifecycle state — the kernel cannot read Lab/K12). CREATE-only; SHADOW. [plan](../packages/specs/plans/2026-06-08-v3.5-wave3a-flag-conflict-manage-op.md).
- **Wave 3b.1 — the manage-proposal store + `quarantine`** (`#264`) — a dedicated advisory `packages/lab/manage-proposal/` store (**D1**: destructive proposals = a Lab store, NOT a kernel PENDING record — documentary-schema→inert per ADR-0012) + the `quarantine` op + the `quarantined` projection + `updateDisposition` + the dispose CLI. [plan](../packages/specs/plans/2026-06-08-v3.5-wave3b1-proposal-store-quarantine.md).
- **Wave 3b.2 — the destructive-proposal ops** (`#265`) — `content-dedup`/`cull`/`merge` as thin multi-target CREATE-into-Lab-only wrappers over the 3b.1 store (`op_type` the only semantic carrier; "destructive" NOTIONAL until v3.6). Closes the v3.5 manage-write-op set. [plan](../packages/specs/plans/2026-06-08-v3.5-wave3b2-destructive-proposal-ops.md).
- **Validator consolidation** (`#267`) — `kernel/_lib/free-string-checks.js` (`hasControlChars`+`nonEmptyString`) + causal-edge migrated onto the shared `enum-validate` leaf; behavior-preserving, byte-identical defenses. [plan](../packages/specs/plans/2026-06-08-consolidate-lab-validators.md).

**Named-deferred → v3.6:** the OQ-E kernel-attested-writer primitive + R1 kernel-derivation + **live destructive enforcement** (read `approved` proposals → mint kernel-attested COMMITTED `SUPERSEDE`/`TOMBSTONE`, with A10 `evidence_refs` derived at promotion) + un-darkening the loop into live K4 recall. The destructive ops are recorded-not-executed PROPOSALS in v3.5; live enforcement is the v3.6 leave-shadow event.

## Phase-close sign-off (v3.5, 2026-06-08)

`/phase-close v3.5` — three independent full-context lenses (PM=honesty-auditor + Principal-SDE=code-reviewer-at-phase-altitude + Architect) reviewed the INTEGRATED phase (#259/#261/#262/#263/#264/#265/#267) against EC1–EC5. **Verdict: CLOSEABLE** (all three).

| EC | Delivery |
|---|---|
| EC1 — auto-index regenerates + drift-tested | **MET** — `signpost.js --check` diffs + exits 1; pure generator. (Reframe note: indexes path/layer→location, not topic→concept.) |
| EC2 — deterministic manage, 4 states as pure projections, bounding-negative | **MET in substance** — `projectLifecycleState` pure / emits-no-record; bounding-negative present. Honest nuance: `stale`/`archived` are kernel projections, `conflicted`/`quarantined` are Lab projections; the v6 §5a.1 *table* was correctly NOT edited (the "no v6 amendment" win) — "added to §5a.1" = "as pure derivable projections", not a spec-row edit. |
| EC3 — spikes resolved + gate honored | **MET** (exemplary) — OQ-E NO-GO / OQ-27 GO / OQ-21 GO-advisory each firsthand-probed + recorded; NO-GO → reserve-the-schema (v3.6). |
| EC4 — graph loop closed in shadow | **MET** — `loop-and-exclusion.test.js`: produce→judge→promote→consume; AUDIT-ONLY excluded; conflicted-stays-eligible; homoglyph rejected. Function-level (honest). |
| EC5 — security defaults + shadow + 0 CRITICAL + no v6 amendment | **MET** — R1/R3 fail-closed; 0 live destructive path (proposals only, recorded-not-executed); `grep` deep-hook refs = 0; spec untouched. |

**Cross-PR findings the per-wave VALIDATE could not see (folded into this close):** (1) **integration-test gap** — no test exercised both Lab stores together → added `tests/unit/lab/v35-cross-store-coexist.test.js` (path separation, write isolation, cross-planted-record rejection, shared-leaf singletons, the composed `conflicted`×`quarantined` no-cross-talk seam, SHADOW); (2) **`listEdges` immutability asymmetry** (mutable read-back vs `listProposals`' freeze) → folded a return-boundary freeze; (3) doc-decay (this section + the stale `enum-validate.js` / `manage-ops.js` comments) → fixed.

**v3.6 carry-list (named, non-blocking — forward debt the lenses surfaced):** (a) the promotion pass must DERIVE A10 `evidence_refs` (the proposal carries prose `justification` + HEX64 `target_records`, not chain-existing `evidence_refs` — a v3.6 derivation, not a v3.5 defect); (b) `merge`'s structured-summary slot is an additive v3.6 reshape (rides `justification` for now); (c) faithfulness rung-1-skip → live K4 recall is high-precision/lossy-recall until the OQ-21 real-`claude -p` calibration; (d) the OQ-E kernel-attested-writer primitive is the prerequisite for moving `updateDisposition`/`updateEdgeStatus` from trusted-caller to attested.

---

## ✅ v3.6 — Human-gated destructive-manage enforcement (COMPLETE — phase-closed 2026-06-10)

*Plan: [`2026-06-08-shadow-to-live-beta-roadmap.md`](../packages/specs/plans/2026-06-08-shadow-to-live-beta-roadmap.md) (the v3.6 phase + EC1–EC4). The first **leave-shadow event**: an `approved` manage-proposal → a COMMITTED kernel `SUPERSEDE`/`TOMBSTONE`. Opt-in (`LOOM_MANAGE_ENFORCE=1`); shadow stays the default. Cooperative / trusted-local-fs / human-in-loop — the human approval is the intent trust anchor (the OQ-E attested-writer primitive stays deferred — autonomy-only).*

The v3.5 manage-WRITE layer RECORDED `approved` proposals; v3.6 ENFORCES them. Each wave derived from the probed reality of the layer below (cumulative-coherence), and the W2c recon corrected the phase's own framing — `evidence_refs` was already derived in W2a and the approve→execute TOCTOU was already closed by content-addressing, so EC1 was met earlier than the roadmap prose implied (architect adjudication at close).

- **W1 — the consumer-first lifecycle READER** ([#269](https://github.com/shashankcm95/claude-power-loom/pull/269)) — `manageLifecycleStatus` (kernel-lifecycle × approved-manage-intent), narrowing-safe, SHADOW; closes the v3.5 dark-producer edge. [lifecycle](../packages/lab/manage-proposal/lifecycle.js).
- **W2a — the MINT** ([#270](https://github.com/shashankcm95/claude-power-loom/pull/270)) — single-target `cull` → COMMITTED `TOMBSTONE`; the exact-SET post-condition; per-target IDOR eligibility; `evidence_refs = [USER_INTENT_AXIOM:sha256(canonical(approved-proposal))]` (the A10 genesis-bootstrap sentinel — EC1's derived A10-admissible evidence). [manage-op-record](../packages/kernel/_lib/manage-op-record.js).
- **W2b.1 — multi-target** ([#272](https://github.com/shashankcm95/claude-power-loom/pull/272)) + **`readById` content-verify-on-read** ([#273](https://github.com/shashankcm95/claude-power-loom/pull/273)) — `content-dedup`/`merge` → `SUPERSEDE`; exact-SET over the whole approved set; `loadRecordFile` content-address-verifies every read.
- **W2b.2 — the promote-path breaker (EC2)** ([#285](https://github.com/shashankcm95/claude-power-loom/pull/285)) — the E11 pattern over a cross-run record-scan source windowed on FS `mtime` (NOT the content-hashed `intent_recorded_at` — the C1 back-date lesson); §0a.3.1 halt-only. [record-scan](../packages/kernel/_lib/record-scan.js).
- **W2c — cross-run mints** ([#286](https://github.com/shashankcm95/claude-power-loom/pull/286)) — targets spanning runs partition per run (one mint each); per-(proposal,run) idempotency (runId → `writer_spawn_id`); the breaker goes PREDICTIVE on NET-NEW runs (closes the within-promotion overshoot); honest `partial-cross-run` (no rollback — §0a.3.1); the reader-side cross-run load. [crossrun-load](../packages/lab/manage-proposal/crossrun-load.js).

| EC | Delivery |
|---|---|
| EC1 — `approved` → recorded `SUPERSEDE`/`TOMBSTONE` with derived chain-valid `evidence_refs` + re-verify the approved content-hash vs approval-time | **MET** (architect-adjudicated at close). `evidence_refs` = the schema-canonical `USER_INTENT_AXIOM` genesis-bootstrap sentinel — **A10-ADMISSIBLE** (the validator enforces non-empty + the sentinel shape, NOT chain-existence; "chain-valid" here = the canonical genesis-bootstrap form, since a genesis-rooted op has no in-chain predecessor; the targets are real + chain-located in `affected_records`). The "re-verify content-hash" IS the content-addressed `proposal_id = sha256(canonical(op_type, target-set))`, re-derived + verified on every read — pinned by the EC1 TOCTOU tests (swap-keeping-id → `proposal-not-found`; re-derive → `not-approved`). NO explicit snapshot: `updateDisposition` is writer-unauthenticated, so a snapshot would be equally forgeable under the same-uid model — the content-address is strictly stronger. |
| EC2 — promote-path breaker halts on a rate threshold; `LOOM_*` opt-in; shadow default | **MET** — #285 (W2c made it predictive: refuses before the within-promotion overshoot). |
| EC3 — both residuals documented + R1/R3/R4 aborts verified | **MET** — residuals below; R1 fail-closed verified (the manage path REFUSES on every un-attested/un-approved/ineligible path: shadow-default, not-approved, unknown-id, IDOR kernel-owned/manage-op, breaker-open/would-exceed, post-condition-mismatch); R3/R4 deterministic enforcement unchanged. |
| EC4 — 3-lens VALIDATE clean (data-mutation + security tier); `/phase-close` CLOSEABLE | **MET** — every wave passed its 3-lens VALIDATE (code-reviewer + hacker re-probe + honesty-auditor); `/phase-close` sign-off below. |

**EC3 residuals (the honest threat-model boundary).**

- **(b) the approve→execute TOCTOU swap window — CLOSED for the load-bearing scope by content-addressed proposal identity.** `proposal_id` commits the approval to exactly (op_type, target-set); `isAuthenticProposal` re-derives + verifies it on every read; the promotion loads strictly by the approved id and asserts `approved`. A post-approval target swap either fails authenticity (→ `proposal-not-found`) or changes the id (→ the approved proposal is not-found; the swapped one is an unapproved distinct identity → `not-approved`). No row that hashes to the approved id can carry a different target-set than the human reviewed.
- **(a) hostile same-uid `approve`-automation — ACCEPTED (does NOT close in v3.6).** A same-uid persona authoring its own genuine proposal and `updateDisposition('approved')`-ing it is the writer-unauthenticated `approve` itself — the human is the *intent* anchor, not a kernel-attested writer. This is the same residual Option B accepts; it closes only at the **OQ-E attested-writer primitive / Track-2 ContainerAdapter sandbox**.
- **R-W2c-1/2/3 (cross-run) —** a partial cross-run promotion's already-minted records count toward the breaker window on a same-window retry (the predictive NET-NEW k unwedges the common case; a near-threshold retry waits out the window); re-invoke re-resolves runs (a concurrent same-uid run-move → a benign second tombstone, not a no-op); a single promotion can mint up to `min(#runs, threshold−denials)` at once (MAX_TARGETS=256 is the hard blast-radius cap).
- **R-W2c-4 (back-date storm) —** the breaker's `excluded_future` tamper signal is ONE-DIRECTIONAL: a forward-date storm is caught (fail-closed), a `utimes()` BACK-date storm is invisible and defeats the rate bound with no signal. Accepted under the cooperative / trusted-local-fs / same-uid model; closes at the sandbox.

**v3.7 carry-list (named, non-blocking):** the OQ-E attested-writer primitive (moves `updateDisposition` from trusted-caller to kernel-attested — the prerequisite to closing residual (a) + the back-date storm); the cross-run partial-failure resume-from-recorded-map API (robustness; a re-invoke recovers today); the kernel-test-runner speedup (the suite runs ~48s [measured locally, single run; CI-runner number TBD] > the 30s CI window — spawn-per-file; batch into one node process); the `promoteProposal` orchestrator extraction (~128 lines → a `runPreflight` helper, > the 50-line ceiling — accumulated wave debt); the cross-run enumeration DRY (record-scan/record-locate/crossrun-load share a hardened idiom → a shared `enumerateRuns(base, fn)`).

## Phase-close sign-off (v3.6, 2026-06-10)

`/phase-close v3.6` — three independent full-context lenses (PM=honesty-auditor + Principal-SDE=code-reviewer-at-phase-altitude + Architect) reviewed the INTEGRATED phase (#269/#270/#272/#273/#285/#286) against EC1–EC4. **Verdict: CLOSEABLE (all three); 0 engineering must-fix.**

- **PM (honesty)** — A−, MINOR-OVERCLAIMS: EC1–EC4 delivered with rare evidence-density (code + targeted tests for every load-bearing claim); flagged the "chain-valid" overword (→ corrected to A10-admissible) and that the header pre-graded the still-running gate (resolved by this verdict). The `evidence_refs`-already-derived reframe was verified GENUINE (built in W2a #270, not retro-claimed).
- **Principal-SDE (phase-altitude)** — the W2c `{mints:[...]}` contract migrated cleanly to every consumer; the W1↔W2c reader seam composes end-to-end (`loadRecordsForTarget` → `manageLifecycleStatus`); the `writer_spawn_id` runId-fold + the predictive-net-new-k breaker are coherent across PRs; accumulated debt = `promoteProposal` length + triplicated cross-run enumeration (→ v3.7 carry-list).
- **Architect** — coheres as a producer→bound→consumer layer (§0a.3.1 narrowing preserved across mint / breaker / partial-no-rollback); the close-boundary passes the v3.4 test (nothing built needs a deferred item to be correct — the human-in-loop trust primitive is fully present); forward-ready for v3.7 (the breaker `SOURCES` registry is the OCP seam v3.7's `stage-promote` extends; `USER_INTENT_AXIOM` is a pre-existing kernel A10 Published Language, not a v3.6 shape v3.7 must reshape; v3.6/v3.7 mutate disjoint state — memory records vs git refs).

**Cross-PR drift the per-wave VALIDATE structurally could not see (folded into this close):** (1) the W1 CLI test comment went stale when W2c wired `loadRecordsForTarget` → corrected + the seam documented; (2) the ROADMAP "chain-valid" overword → "A10-admissible"; (3) a comment anchor on `provenance-projections.js`'s HEX64 evidence filter (so a future un-darkening wave does not "fix" it to surface the non-edge `USER_INTENT_AXIOM` sentinel). The gate earned its keep. Durable record: the `toolkit/phase-close/v3.6-close` library volume.

---

## ✅ v3.7 — Delta-promote activation + the reject-event ledger (COMPLETE — phase-closed 2026-06-11)

*Plan: [`2026-06-10-v3.7-delta-promote.md`](../packages/specs/plans/2026-06-10-v3.7-delta-promote.md). The trust system's **foundational producer** (Layer-0 of the north-star filter stack — [`2026-06-11-north-star-autonomous-sde-trust.md`](../packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md)) + the RFC §7 owed activation discharged. Shadow stays the default throughout; NEVER-TOUCH-HEAD stays the invariant.*

v3.6 made the manage path live in its human-gated form; v3.7 did the analogous activation for the **delta-promote** path — and built the kernel-attested denial signal the v3.8 trust consumers will read. The W1 VERIFY reshape was the phase's design win: the original "absorb/reject ledger keyed on `post_state_hash`" framing was caught polluting the K9 chain-walk (A1-CRITICAL) and over-reading clean-merge as quality (C1) — the build shrank to the REJECT-only, NON-CHAIN, triple-isolated ledger.

- **W1 — the REJECT-event ledger** ([#293](https://github.com/shashankcm95/claude-power-loom/pull/293)) — `reject-event-store.js`: NON-CHAIN `reject-event-v1` records minted at the integrator's quarantine + provenance-reject (the kernel DECIDES, an agent cannot forge its outcome); content-addressed with `outcome` folded into the id; A1-isolated off the `post_state_hash` keyspace (subdir + filename namespace + field name); run-bound (a cross-run plant cannot inflate a run's reject-rate); fail-soft; FS-mtime temporal signal (no forgeable `recorded_at`). 19 TDD tests; 3-lens VALIDATE all-CLEAN (the hacker re-probed the BUILT mint with 7 live exploits — all HELD). [reject-event-store](../packages/kernel/_lib/reject-event-store.js).
- **W2 — honest activation framing + the threat model** ([#296](https://github.com/shashankcm95/claude-power-loom/pull/296)) — the README 3-tier honesty split (Enforced / **Shadow-opt-in-human-gated** / Best-effort; the promote gate REMOVED from the always-fires list); ARCHITECTURE §6 workflow + the threat-model declaration (same-uid mtime **back-date-into-past UNMITIGATED** — `excluded_future` is one-directional; `worktree ≠ sandbox`; both close at the ContainerAdapter). honesty-auditor VALIDATE: NO-OVERCLAIM, 9/9 claims verified.
- **W3 — the end-to-end demo, CI-guarded** ([#297](https://github.com/shashankcm95/claude-power-loom/pull/297)) — [`examples/delta-promote-demo.js`](../examples/delta-promote-demo.js) (hermetic; drives the REAL `stageCandidate` + `integrate-cli`; one absorbed → integration record + one quarantined → reject-event; HEAD byte-untouched; the human reviews + merges) + [`docs/delta-promote-walkthrough.md`](delta-promote-walkthrough.md) + the E2E test re-running the demo on every push.
- **W4 — the RFC §10 timer-reset amendment** ([#298](https://github.com/shashankcm95/claude-power-loom/pull/298)) — names that the original one-release-cycle revert timer ELAPSED unconsumed; resets it on the merits (the activation story §7 conditioned Option B on only shipped in v3.7); **the v3.9 phase close is the named decision point** — a real consumer (operationalized in the [activation ledger](ACTIVATION-LEDGER.md): ≥1 non-demo `integrate-cli` fold on real work, or an external adopter) materializes, or Option B reverts toward A.

| EC | Delivery |
|---|---|
| EC1 — a documented workflow stages a gate-passing delta; a human reviews + merges end-to-end | **MET** — the walkthrough + the demo (operator-dogfood of the CAPABILITY; the external-user consumer stays honestly undemonstrated → EC2/v3.9). CI-guarded so it cannot rot. |
| EC2 — capability-demo vs the §7 product-demand hinge; the timer reset with rationale | **MET** — the §10 amendment (the elapsed timer NAMED, not hidden; the breaker honestly producer-half-only; v3.9 = the decision point). |
| EC3 — the ledger minted at the integrator (anti-forgery, kernel-attested, content-addressed); NEVER-TOUCH-HEAD; `LOOM_*` opt-in; shadow intact; 3-lens clean; `/phase-close` CLOSEABLE | **MET** — every conjunct firsthand-verified at the close gate (see the sign-off below). |

**v3.8 carry-list (named, non-blocking):** the **reject-event breaker source** (the planned consumer of the W1 producer; needs a **cross-run enumerator** — `listRejectEvents` is per-run; add a `scanRejectEvents` reusing `record-scan.js`'s hardened gates — and either export `rejectEventFilePath` or add an mtime-bearing list variant for the FS-mtime windowing); the denial-source taxonomy is now tabled in the [activation ledger](ACTIVATION-LEDGER.md) so the 4th source wires without reconstructing it from code. Carried from v3.6 unchanged: the OQ-E attested-writer primitive, the kernel-test-runner speedup, the `promoteProposal` extraction, the cross-run enumeration DRY.

## Phase-close sign-off (v3.7, 2026-06-11)

`/phase-close v3.7` — three independent full-context lenses (PM=honesty-auditor + Principal-SDE=code-reviewer-at-phase-altitude + Architect) reviewed the INTEGRATED phase (#293/#296/#297/#298) against EC1–EC3, with a fresh evidence pass (kernel 70/70, runtime 17/17, lab 29/29, hooks 8/8, scripts 13/13 test files; the live demo exit-0; gate 124/0; contracts/signpost/doc-path clean). **Verdict: CLOSEABLE-WITH-NOTES (all three); 0 substance findings — every note was close-out work, folded into this release.**

- **PM (honesty)** — Grade A: all three ECs MET against firsthand evidence; the cross-doc story "unusually coherent — five docs, one story, zero contradiction" on demonstrated-vs-undemonstrated / breaker-producer-half-only / the v3.9 expiry; every deferral named in a durable doc (no silent drop). Notes = the stale user-facing version surface (README v3.4 badge/prose, the "v3.2+" pointers, the ARCHITECTURE v3.1 watermark, the root-layout claim) → **all fixed in this close-out**.
- **Principal-SDE (phase-altitude)** — integration seams CLEAN: the W1↔W3 schema seam fails loudly on drift; the E2E test is CI-picked-up with no flake surface; the complete version-bump set enumerated (plugin.json + CHANGELOG + ROADMAP + README — NOT marketplace.json/package.jsons) → **all shipped in this close-out**. Forward note: `rejectEventFilePath` unexported (v3.8 intake, named above).
- **Architect** — the chartered Layer-0 shape delivered with no scope drift (the C1/A1 reshape "the design win that keeps the foundation honest"); OQ-NS-6 carried to every point-of-use ("a v3.8 builder cannot build the consumer wrong from the docs alone"); the ContainerAdapter boundary consistent across all four surfaces; no architectural reason to delay the 3.7.0 bump. Notes (all LOW, folded): the denial-source taxonomy → tabled in the ledger; "a real consumer" → operationalized in the ledger; the cross-run reader → the v3.8 carry-list.

**Cross-PR drift the per-wave VALIDATE structurally could not see (folded into this close):** (1) the rung-1 `LOOM_RESOLVER_ENFORCE` ledger row still carried the OLD one-release-cycle timer phrasing while rung-2 + RFC §10 carried the v3.9 reset → aligned; (2) the user-facing version surface (README/docs index/ARCHITECTURE watermark) lagged three phases behind the substrate it documents — exactly the misrepresentation an honesty-themed release must not ship → the README rewritten (the Status wall → a phase table; the stale root-layout claim fixed), the docs index + watermark refreshed; (3) the breaker-source taxonomy existed only as a code literal + scattered ledger rows → tabled. The gate earned its keep. Durable record: the `toolkit/phase-close/v3.7-close` library volume.

---

## 🔶 v3.8 — The reject-event breaker source (IN PROGRESS)

v3.7 built the kernel-attested denial PRODUCER; v3.8 wires its consumers (Producer–Consumer Phasing: the consumer is owed in the immediately-next phase). Charter: the combined roadmap (`packages/specs/plans/2026-06-10-combined-roadmap.md`); each wave derives from the probed reality of the layer below (cumulative-coherence — v3.8a/b scope is NOT pre-loaded).

- **W1 — the `reject-event` breaker source** (MERGED #300 `97da5bd`; plan: `packages/specs/plans/2026-06-11-v3.8-reject-event-breaker-source.md`; 3-lens VERIFY all READY-WITH-NOTES, folds applied): `scanRejectEvents` in `record-scan.js` — a cross-run, FS-mtime-windowed enumerator with the same hardened gate as `scanCommittedOps` (DUPLICATED, not extracted — the architect inverted the draft's D1: rule-of-three unmet, and refactoring a shipped control risks under-count regression for BOTH sources; the rule-of-three trigger is recorded in the module header). The 4th `SOURCES` registration: constant persona `reject-event` (bare source id — NOT a `kernel:` shape), GLOBAL cap gates, OPT-IN (the default stays `verdict-fail`), reject-rate → trust-DOWN only (OQ-NS-6). Deliberate, test-LOCKED over-count-safety: no content-verify + no run-binding (§0a.3.1 halt-only — the v3.7 producer's per-run run-binding is INTENTIONALLY dropped; a cross-run plant only over-narrows); `run_id`/`reject_event_id` come from walk-known dir/filename, never the unverified body (no attacker-assertable identity surfaces downstream). **SHADOW** — the breaker still halts nothing; the GATING consumer (fail-CLOSED on `excluded_future`, promote.js-style) is **v3.9**. The v3.7-intake "export `rejectEventFilePath` or an mtime list variant" item COLLAPSED into the scan (it stats files itself).
- **W2 — the route-decide dictionary expansion** (plan: `packages/specs/plans/2026-06-12-v3.8a-route-decide-dictionary-expansion.md`; the MANDATED architect pass ran — READY-WITH-NOTES, the verdict IS the build contract): Tier 2c (32 detection tokens — the v3.3–v3.8 Lab/trust vocabulary) into `SUBSTRATE_META_TOKENS` + a 12-phrase zero-FP scoring subset into `compound_strong`, per the established hybrid (detection BROAD / scoring NARROW). **Weights + thresholds FROZEN** (re-validated by hand: the three arc calibration tasks land 0.150 root-with-advisory — the sentinel now fires where it was SILENT pre-expansion; negatives stay 0.000 root; the maximally-loaded route fixture stays 0.750 route). **Zero stakes additions** (every candidate rejected — the "writes-to-real-refs" gap closes via the sentinel-advisory escalate-by-judgment path, not scoring). Bare E/K-codes rejected (the substrate-noun phrases cover every real usage). `WEIGHTS_VERSION → v1.3-dict-expanded-2026-06-12`. The v3.5-carry intake item is DELIVERED.

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
