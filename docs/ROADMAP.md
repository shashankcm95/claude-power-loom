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
- **`route-decide` dictionary-expansion architect pass** — `drift:dictionary-gap` converged (3) via `/self-improve` 2026-06-07: the scorer dictionary is `v1.2-dict-expanded-2026-05-07` and contains **none** of the v3.3/v3.4 Lab vocabulary (E1–E12, `decompose-run`, circuit-breaker, reputation, attestation, canonical-json, evolution-snapshot, K12–K14), so substrate-meta tasks under-route. Keyword-set/weight changes are LOAD-BEARING (`route-decide.js:11-13`) and **require a new architect pass** with a re-validation of the weighted formula — do NOT hand-edit the keyword sets. Bump `WEIGHTS_VERSION` on landing. [self-improve]

Durable record: the `toolkit/phase-close/v3.4-close` library volume.

---

## 🔄 v3.5 — Memory Manage-Layer + Causal-Recall Graph (in progress)

*RFC: [`packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md`](../packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md) — merged as recorded design; **amends nothing**. Scope: [`2026-06-07-v3.5-memory-manage-scope.md`](../packages/specs/plans/2026-06-07-v3.5-memory-manage-scope.md). SHADOW throughout (advisory; never gates K9).*

The first **Memory Manage-Layer** code: a *manage layer* (manage-operations over memory) + a typed causal-edge graph, re-grounded onto the v6 consistency model. The same cumulative-coherence discipline that reshaped v3.3/v3.4 governs each wave — derive from the PROBED reality of the layers below, not the blueprint. Waves 0–2 are MERGED; the manage **write** half (Wave 3) is underway.

- **Wave 0 — the read/project half** (`#259`) — the deterministic-manage PROJECTIONS (`mark-stale` + `retention-archive`) + the provenance-edge VIEW: pure projections over a passed-in record set that emit NO record (v6 §5a.1). [provenance-projections](../packages/kernel/_lib/provenance-projections.js).
- **Wave 1 — the spikes / GO-NO-GO** (`#261`) — **OQ-E NO-GO**: the record-store + wal-append are both writer-unauthenticated, so the kernel-attested-writer primitive defers to v3.6 (exposure LATENT — no live destructive emitter); OQ-27 GO (the read-side walker is tractable); OQ-21 GO-advisory (a real-`claude -p` rung-2 calibration is owed). [spikes](../packages/specs/spikes/2026-06-07-v3.5-wave1-spikes-oqe-oq27-oq21.md).
- **Wave 2 — the causal-edge graph loop** (`#262`) — the advisory `packages/lab/causal-edge/` store (**D1**: a dedicated advisory Lab store, v6-conformant via §10b/OQ-24 — NOT a kernel schema-branch) + the OQ-27 read-side walker (R3 FILTER-THEN-INDEX) + the faithfulness rung-2 fail-closed injectable judge. The first producer→consumer loop, function-level. **C1** (the 3-lens durable): `updateEdgeStatus` flips R3 eligibility UNAUTHENTICATED = the writer-unauthenticated Lab model — DOCUMENTED-not-enforced (ADR-0012 inert-theater), bounded by narrowing-safety. [plan](../packages/specs/plans/2026-06-07-v3.5-wave2-causal-edge-graph-loop.md).
- **Wave 3a — `flag-conflict`, the manage WRITE half's first op** *(this wave)* — a cumulative-coherence pass found Wave 2 ABSORBED scope-W3.2 (R3/R4), collapsing the planned "W3 security spine" to its **manage-write-layer**. `flagConflict` is a thin validated CREATE over the Wave 2 store (relation pinned to `contradicts`, born `unvalidated`/AUDIT-ONLY — the candidate safety-tag), plus the `conflicted` LAB projection (**D2**: a Lab projection, NOT a kernel lifecycle state — the kernel cannot read Lab/K12), the function-level flag→candidate→rung-2→confirmed loop, a `flag-conflict` CLI subcommand, and the rung-2 judge-prompt SPEC. CREATE-only; SHADOW. [plan](../packages/specs/plans/2026-06-08-v3.5-wave3a-flag-conflict-manage-op.md).

**Named-deferred:** **Wave 3b** — the destructive-proposal / candidate-record ops (`content-dedup`→SUPERSEDE-proposal, `cull`→TOMBSTONE-proposal, `merge`, `quarantine`); the destructive class stays a PROPOSAL in v3.5 (live enforcement = the v3.6 leave-shadow event). **v3.6** — the OQ-E kernel-attested-writer primitive + R1 kernel-derivation + live destructive enforcement + un-darkening the loop into live K4 recall.

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
