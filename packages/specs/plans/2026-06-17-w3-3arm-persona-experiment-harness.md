---
lifecycle: persistent
phase: ③.1-W3
date: 2026-06-17
status: PLAN (VERIFIED 2026-06-17 — NEEDS-REVISION folded; READY)
---

# ③.1-W3 — the 3-arm persona experiment harness (subject-agnostic apparatus)

The dry-run's first real experiment. It tests the inference behind ClawSouls' "soul"
concept, restated against our substrate: **a persona anchored to its ground truth (the
experience graph) should behave measurably differently from the bare base model AND from
archetype-prose-only styling.** This wave builds the APPARATUS that measures that delta —
subject-agnostic (testable with fixtures); the Python persona + real issue corpus that flows
through it is the NEXT wave (③.1-W4). SHADOW; trust moves ZERO (OQ-NS-6 — the dry-run
NARROWS, only a real maintainer-merge HARDENS); version held 3.11 (mechanics-freeze pre-live).

## The experiment (4 locked decisions — USER, 2026-06-17)

| Decision | Locked choice | Rationale |
|---|---|---|
| **Arm contrast** | 3-arm, grounding-isolated. **A=bare** (base + task only); **B=styled** (A + persona `agents/*.md` archetype prose); **C=grounded** (B + the persona's CONFIRMED-lesson slice). | The B→C delta is ONLY grounding; A→B is the whole persona apparatus. |
| **"context"** | The harness composes each arm's prompt DIRECTLY (NOT via the `/build-team` → `build-spawn-context.js` path), so the generic toolkit KB/ADR prefix is EXCLUDED from all arms. The **test-repo/task context is a given, identical in all 3 arms**. | Cleaner than "held constant" — the only variables are (archetype, earned-slice); toolkit ADRs are noise for an external Python bug. |
| **Outcome metric** | F7 **trace signals primary** (recall-retrieval count, graph-write accrual, agent↔agent convergence). `grade`/BEHAVIORAL_PASS is captured as a *traced event* (it is the gate that confirms lessons), NOT the headline scoreboard. | USER: focusing on pass-rate too early would miss the underlying substrate flow. Pass/fail is observed because the confirmed-lesson lane hinges on it, not optimized for. |
| **Grounding slice** | Confirmed (PREDICTOR-lane) lessons ONLY. | Cleanest "earned" signal; sidesteps provisional/hazard-lane noise + the heaviest provenance surface. |

Export of a "grounded persona bundle" is **DEFERRED to a later phase** (USER: revisit once we
see real persona growth — no point shipping a bundle format before its contents matter).

## Routing Decision (verbatim `route-decide.js`)

```json
{
  "task": "design and build the ③.1 dry-run 3-arm persona experiment harness (subject-agnostic apparatus): deterministic arm-prompt composer for bare/styled/grounded arms, F7 live trace emitters for persona-spawn/recall-retrieval/solve/grade/graph-write, arm-aware query aggregation, confirmed-lesson grounding-slice builder with C2 persona-key normalization-on-read; multi-file kernel+lab substrate via HETS orchestration",
  "recommendation": "root",
  "confidence": 0.833,
  "score_total": 0.05,
  "signals_matched": ["experiment", "design", "multi-file", "orchestration"],
  "counter_signals": ["experiment"],
  "counter_signal_contribution": -0.25,
  "reasoning": "Score 0.050 → root: domain_novelty (+0.150, 'experiment'), compound_weak (+0.075, 'design'), scope_size (+0.075, 'multi-file'), counter-signals (-0.250, 'experiment'), context (+0.000, mult=0.5).",
  "weights_version": "v1.3-dict-expanded-2026-06-12",
  "substrate_meta_detected": false
}
```

**Judgment escalation (overrides the gate):** `root` here is a lexicon miss — "experiment" is
a counter-signal (−0.25) the scorer treats as low-stakes exploration, and no `stakes` token
covers "builds the apparatus a trust-experiment runs on." The wave is genuinely architect-shaped
(novel multi-file `lab` apparatus, non-obvious tradeoffs below) and the per-wave workflow MANDATES
an architect VERIFY regardless. Escalated → architect VERIFY via `/verify-plan`. (Drift-note 1.)

## HETS Spawn Plan

| Persona | Role | Lens | Why |
|---|---|---|---|
| 04-architect | VERIFY (pre-build) | design | pressure-test the 4 design forks below; recommend the W3a/W3b split |
| 03-code-reviewer | VERIFY (pre-build) | correctness | concrete-bug pass on the proposed module contracts |
| 03-code-reviewer | VALIDATE (post-build) | correctness | arm-compose determinism, slice correctness, arm-query aggregation, no vacuous fixtures |
| 01-hacker | VALIDATE (post-build) | adversarial-security | grounding-slice reads the #273-surface causal-edge store (verify-on-read); does the slice leak/inject; does `canonicalPersonaKey` open a laundering path; CWE-22 on run-ids; live-probe the BUILT slice builder |
| (PM) honesty-auditor | VALIDATE (post-build) | claim-vs-evidence | does the harness ACTUALLY measure the delta (not a vacuous stub)? real-shaped fixtures? deferrals labeled? |

(VALIDATE is the full 3-lens tier: the harness reads the causal-edge store + composes prompts
that flow into live spawns — adjacent to the data-mutation/security class.)

## Open design forks (for the architect VERIFY to resolve)

1. **`canonicalPersonaKey` direction (C2).** Two shapes exist: bare `node-backend` (the Agent-tool
   `agentType`, the Rule-4 producer convention, what persona-selection reasons about) vs numbered
   `13-node-backend` (the identity registry's canonical key). The slice builder must normalize BOTH
   to ONE form on READ or it slices a disjoint subgraph. **Proposed: bare-`agentType`-canonical**
   (it is the spawn selector), with a registry-derived numbered→bare map. **READ-side normalization
   ONLY this wave** — the full store reconcile / record migration / record-time enforcement stays
   in ③.1-W4 (the subject wave) per the USER scope call. Architect: confirm the canonical direction
   and that read-only-normalize is the right minimal cut.
2. **Metric encoding: scalar `attrs` vs array `state_delta`.** `query.js summarize` can't aggregate a
   scalar (counts + dur-by-event only); `diff` unions only ARRAY-valued `state_delta`. So the
   convergence ratio either rides `attrs` (needs a NEW arm-query helper) or is encoded as an
   array-valued `state_delta` field (reuses `diff`'s accrual machinery). **Proposed: a new
   `arm-query.js` (additive; leaves the W2a `query.js` frozen contract untouched) that reads scalars
   from `attrs` + groups by `attrs.arm`.** Architect: confirm vs the encode-as-array alternative.
3. **Emitter seam placement.** The 5 dormant components (`persona-spawn`/`recall-retrieval`/`solve`/
   `grade`/`graph-write`) become LIVE here, emitted at the `arm-loop` seams via `traceEmit` directly
   (no schema change — all 5 are already valid components; probe-confirmed). **Proposed: `arm-loop`
   owns the emits; `solveFn` is an INJECTED seam (dependency-inversion, mirrors the kernel's
   `resolveParentFn`)** — a stub solver in tests, the real `claude -p` driver in ③.1-W4. Architect:
   confirm the injected-seam boundary keeps the apparatus subject-agnostic.
4. **Wave split.** Proposed **W3a = construction** (pure: `arm-compose` + `grounding-slice` +
   `canonical-persona-key`) / **W3b = run + measure** (`arm-loop` + `arm-query` + `cli`). W3b depends
   on W3a; each is <400 LoC + reviewable (mirrors the W2a/W2b split the architect made). Architect:
   confirm or re-cut.

## Runtime Probes (firsthand, 7-agent sweep against main @ `e887ac3`)

(Architect VERIFY FLAG folded: all probe paths corrected to full repo-relative form so the
builder greps the right tree + the doc-path CI gate resolves them.)

| Claim | Probe | Result |
|---|---|---|
| the persona instinct layer is INERT at spawn — grounding CANNOT be injected via a hook | read `scripts/generate-persona-agents.js:143-145`, `packages/runtime/orchestration/identity/lifecycle-spawn.js:76-82,179-186`, ADR-0012 | CONFIRMED — the `runtime/personas/NN` body is read ONLY for SynthId hashing; 0/16 inject. **→ arm C grounding MUST be prepended as PROMPT TEXT by the harness** (ADR-0012), not a hook. |
| arm B (styled) ≈ today's spawn; the generic prefix is a separate confound | `packages/runtime/orchestration/build-spawn-context.js:5-9`, `packages/skills/commands/build-team.md:63-76`, `packages/kernel/spawn-state/spawn-record.js:305` | CONFIRMED — a spawn carries archetype prose + a GENERIC KB/ADR prefix (no experience grounding); reputation only recorded post-hoc. **→ harness composes prompts DIRECTLY to exclude the generic prefix.** |
| the F7 emitter has only `close-path` wired; 5 components are declared-but-DORMANT | `packages/lab/trace-emitter/trace-schema.js:18-26`, `packages/lab/trace-emitter/ingest-close-path.js:48-50` | CONFIRMED — `persona-spawn`/`recall-retrieval`/`solve`/`grade`/`graph-write` are valid frozen components with NO live emitter; `traceEmit` CAN emit them today (no schema change). **→ harness wires the 5 live emitters at its loop seams.** |
| convergence is capturable WITHOUT a schema bump but is NOT yet measurable | `packages/lab/trace-emitter/trace-schema.js:34-35,77`, `packages/lab/trace-emitter/query.js:13-45` | CONFIRMED (PARTIAL) — scalar metrics ride the free-form `attrs` bag (validator doesn't police it); but `summarize`/`diff` can't aggregate a scalar. **→ needs a new arm-aware query helper (fork 2).** |
| the C2 persona-key is FRAGMENTED end-to-end | `packages/lab/verdict-attestation/store.js:163-179`, `packages/lab/reputation/project.js:62-136`, `packages/runtime/orchestration/identity/registry.js:88-111` | CONFIRMED — free-form `subject.persona`, no roster check, projection does NOT reconcile, registry canonicalizes only the numbered form. **→ slicing a persona's experience returns disjoint sets without `canonicalPersonaKey` (fork 1).** |
| confirmed lessons are live + SHADOW + read-gated | `packages/lab/attribution/recall-graph.js:153-220`, `packages/lab/attribution/recall-edge-store.js:106-123`, `packages/lab/causal-edge/lesson-confirm.js:99-101`, `packages/lab/causal-edge/lesson-consolidate.js:111-117` | CONFIRMED — PREDICTOR lane = node with a `confirmed-by` edge (evidence-backed, verify-on-read); weight is SHADOW/advisory (narrows the retriever, never gates). **Provenance residual:** integrity ≠ provenance; an exported slice has integrity only (the ed25519 minter EXISTS but is not wired into live consolidation) — irrelevant this wave (slice is READ for a prompt, not a trust input), relevant to the deferred export. |
| no persona-experiment / bundle apparatus exists | grep `export\|bundle\|persona-experiment\|arm`, `packages/skills/library/skill-forge/SKILL.md` | CONFIRMED — net-new; ~0 apparatus. Reuse: `traceEmit` (W2a), `readTimeline`/`diff` (W2b), `agents/*.md` SOURCE read, causal-edge confirmed-lesson read, `atomic-write`. |

## Files To Modify (all NEW under a new `packages/lab/persona-experiment/` module — net-additive)

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/lab/persona-experiment/canonical-persona-key.js` | NEW | medium | C2 read-side normalize (fork 1) — bare↔numbered map; the laundering-lever seam (hacker lens) |
| `packages/lab/persona-experiment/arm-compose.js` | NEW | low | pure prompt composer per arm; reads `agents/<name>.md` SOURCE |
| `packages/lab/persona-experiment/grounding-slice.js` | NEW | medium | slice PREDICTOR-lane confirmed lessons → bounded earned-instincts block; reads causal-edge store (verify-on-read) |
| `packages/lab/persona-experiment/arm-loop.js` | NEW | medium | loop scaffold; injected `solveFn` seam; emits the 5 live F7 components per seam |
| `packages/lab/persona-experiment/arm-query.js` | NEW | low | arm-aware aggregation: per-arm process signals + scalar convergence; reads `readTimeline` |
| `packages/lab/persona-experiment/cli.js` | NEW | low | `run` / `compare` (per-arm summary + cross-arm delta); lab-CLI convention |
| `tests/unit/lab/persona-experiment/*.test.js` | NEW | low | TDD-first; fixture persona + fixture confirmed-lessons + stub solver |
| `docs/SIGNPOST.md` | regen | low | new module headers (CI doc-path gate) |

## Build (TDD, per proposed sub-wave — architect may re-cut)

**W3a (construction):** tests-first for `canonical-persona-key` (bare↔numbered both directions;
unknown → null, never a silent wrong-key), `arm-compose` (A/B/C determinism; the generic prefix is
absent; task context identical across arms), `grounding-slice` (only PREDICTOR-lane lessons; bounded
size; deterministic order; a fragmented-key persona still slices the full subgraph via the
canonicalizer; an empty-experience persona → empty block, not a crash).

**W3b (run + measure):** tests-first for `arm-loop` (each seam emits its F7 component with
`attrs.arm`; the injected stub `solveFn` is the only spawn; a failing solve degrades to a traced
`grade` event, never aborts the run), `arm-query` (groups by `attrs.arm`; per-arm recall count +
graph-write accrual + scalar convergence; a 3-arm compare = the cross-arm delta table), `cli`.

**VERIFY folds (NEEDS-REVISION → folded into the build spec):**
- **(HIGH, code-reviewer F8) `attrs` scalar-only is a CONTROL, not a convention.** Each `traceEmit`
  in `arm-loop` constructs `attrs` from a numeric/bounded allow-list AT THE CALL SITE (never spreads
  caller/`solveFn` output into `attrs`/`state_delta`). W3b adds a NEGATIVE ORACLE: assert no `attrs`
  value is a string over a small cap, and the stub solve text appears in NO trace record. Hardened
  HERE because W4 (real stranger-repo content) is one `solveFn`-plug away — "scalar-only" must be
  enforceable at the seam, not a comment.
- **(MEDIUM, F1 / K12) `canonical-persona-key` must NOT import from `runtime`** (a lab→runtime
  sideways coupling; `DEFAULT_ROSTERS` is module-private anyway). Derive the map K12-safely: strip the
  `^\d+-` numbered prefix, then VALIDATE the bare result against the persona set globbed from
  `agents/*.md` (the same SOURCE read `arm-compose` already does); unknown/unvalidatable → null (no
  silent wrong-key). Hacker VALIDATE probes this map for a laundering path (a crafted string folding
  two identities into one slice).
- **(MEDIUM, F5) zero-denominator.** `arm-query` convergence ratios return `null` (never NaN/throw)
  when the denominator is 0; W3b test includes arm A with zero recall/solve events.
- **(MEDIUM, F4) emit catch-isolation.** Every `traceEmit` inside `arm-loop` is wrapped in try/catch
  (mirrors `ingest-close-path.js` batch-isolation) → a schema rejection degrades to a logged skip,
  never aborts the run; W3b oracle covers a poisoned emit.
- **(LOW, F2/F3) bounded + edge-cased.** `grounding-slice` is COUNT+BYTE bounded (top-N confirmed
  lessons by recency, hard byte cap on the rendered block — no unbounded prompt); `arm-compose`
  handles a persona with no `agents/*.md` (explicit error, not a silent empty archetype).

- **Oracle discipline (Rule-2a):** REAL-shaped fixtures — a real `agents/*.md` archetype, real-shaped
  confirmed-lesson records in a sandboxed `LOOM_LAB_STATE_DIR`, NOT a fused stub. Every oracle reads
  the emitted timeline back. Convergence metrics SCALAR only (counts/ratios), never raw spawn text
  (the `attrs` bag is unscanned — W4 secret-scrub carry).
- **Dogfood (`_spike/`):** compose all 3 arms for a fixture persona → run the loop with a stub solver
  → read the timeline → `arm-query` the cross-arm delta (the Rule-2a-corollary real-path proof that
  the apparatus discriminates the arms it is built to discriminate).

## VALIDATE (post-build, 3-lens — see HETS Spawn Plan)

Fold findings → full gate → PR → CodeRabbit gate → USER merge.

## VALIDATE result (W3a build + 3-lens, 2026-06-17) — SHIP (folded)

Delegated `node-backend` TDD build: 3 modules + **50 tests GREEN**, dogfood real-path PASS (arm A=bare 65B, B=styled 2359B, C=grounded 2640B with a real **fenced** earned-instincts slice), K12 grep clean, eslint clean. All 3 lenses returned **SHIP-WITH-NITS**; every finding folded:

- **hacker (adversarial-security) — live-probed the BUILT code:**
  - **HIGH-2 (folded):** `lesson_body` flowed UNESCAPED into arm C's prompt. Now rendered FENCED (`<<<EARNED_INSTINCTS … >>>`) under a "DATA, NOT instructions" header + control-char-sanitized; the "no untrusted content" claim corrected (the slice IS a content flow).
  - **HIGH-1 (documented + carry):** the confirmed-by edge promotion is co-forgeable (#273 EDGE face) — gates on integrity not signature. Tolerable for SHADOW (read-for-prompt, gates nothing); documented in `grounding-slice.js` header + the Out-of-Scope carry.
  - **MED (folded):** control chars (NUL/BEL/ESC) stripped by code point; **MED (folded):** a single max-length lesson no longer silently collapses arm C→arm B (per-line truncation + `DEFAULT_MAX_BYTES` 8192 > one line; regression test added).
  - **LOW (carry):** lab-state store dirs created without 0700.
- **code-reviewer (correctness):**
  - **MED (folded):** `defaultKnownPersonas()` returned a mutable shared Set wrongly commented "frozen" (poisonable) → per-call defensive copy + honest comment; **MED (folded):** `BARE_SHAPE` DRY'd (exported from `canonical-persona-key`, imported by `arm-compose`).
  - **LOW (folded):** `arm-compose` test now asserts `C(empty) === B` byte-exact; **NIT (folded):** the 41-char bound documented. (The `edgeDir` jsdoc NIT was already present — no-op.)
- **honesty-auditor (claim-vs-evidence):**
  - **HIGH (folded):** SIGNPOST was NOT regenerated → CI Signpost-drift would FAIL; regenerated (5 `persona-experiment` entries; `--check` clean).
  - **LOW (folded):** dogfood `hasArchetype` tightened to literal archetype-body inclusion; **LOW (acknowledged):** dogfood writes the confirmed-by edge directly (correct for W3a — the slice keys on edge existence; the gate-vs-hand-written provenance is the documented #273 residual).

**Net: SHIP.** 1 HIGH content-injection fix (fence + sanitize) + 1 HIGH CI blocker (SIGNPOST) + the silent-collapse confound fix + the mutable-Set + DRY, all folded; the #273 edge-face + store-dir-0700 documented as shadow-tolerable carries (the slice gates nothing).

## Verification Probes

| Probe | Pass criterion |
|---|---|
| 1 | `bash install.sh --hooks --test` → all green (eslint/yaml/markdownlint) |
| 2 | full kernel + lab unit suites → green (`find tests/unit/{kernel,lab} -name '*.test.js' -print0 \| xargs -0 -n1 node`) |
| 3 | dogfood: 3-arm run on a fixture persona → `arm-query` shows arm C with recall-count>0 + graph-write accrual, arm A with recall-count=0 (the apparatus discriminates) |
| 4 | `canonical-persona-key`: `node-backend` and `13-node-backend` resolve to ONE key; an unknown persona → null (no silent wrong-key) |
| 5 | K12: no `packages/lab/persona-experiment/**` import of `packages/kernel/hooks` (grep clean) |
| 6 | SIGNPOST regen clean; doc-path gate green |
| 7 | negative oracle: no `attrs` value is a string over the cap; the stub solve text appears in NO trace record |
| 8 | `arm-query` returns `null` (not NaN/throw) for a zero-denominator convergence ratio (arm A, zero recall/solve) |
| 9 | a poisoned `traceEmit` inside `arm-loop` degrades to a logged skip; the run completes + the timeline stays intact |
| 10 | `canonical-persona-key` does NOT import `packages/runtime/**` (grep clean — derived via `agents/*.md` glob, K12-safe) |

## Out of Scope (Deferred)

- **The test subject** — the Python persona + real issue corpus + the real `claude -p` solve driver → ③.1-W4 (the injected `solveFn` is the seam it plugs into).
- **C2 full reconcile** — store record migration + record-time roster enforcement → ③.1-W4 (this wave is READ-side normalize only).
- **Grounded persona EXPORT / bundle format** → a later phase (USER: revisit at observed persona growth).
- **Pass-rate as a headline metric** → not this wave (trace signals primary; grade is observed-not-optimized).
- **`attrs`/`state_delta` secret-scrub** → W3b/W4. CORRECTION (hacker HIGH-2): the grounding-slice IS a content flow — externally-derived `lesson_body` lands in arm C's prompt. W3a now renders it FENCED as DATA + control-char-sanitized + bounded (defensive even with fixtures); W4's real `claude -p` content gets the same framing + the scrub. The blanket "no untrusted content flows" was imprecise.
- **lab-state store dirs at 0700** — `recall-graph-store` / `recall-edge-store` `mkdirSync` without a restrictive mode → a carry (same class as the v3.0-W4 per-uid-0700 tracker hardening). Owned by the store modules, not W3a; low-severity now (the slice gates nothing in SHADOW, so a same-uid foreign-writer plant changes only a read-for-prompt block).
- **Signed/authenticated confirmed-by lane for the slice (#273 EDGE face)** — the slice gates on `confirmedNodeIds` (integrity) not `authenticatedEdgeIds` (signature), so a co-forged edge can launder a hazard lesson into the slice. Tolerable for SHADOW (read-for-prompt, gates nothing); documented in `grounding-slice.js`. Switch to the signed lane the moment a slice gates/ranks or feeds a live persona (the minter exists). Subsumes the prior "signed-edge provenance wiring" deferral.
- **Secret-scrub carries** (AWS `{40}`→`{40,}`; Slack `xox[abprs]`→`xox[abeprs]` + `xoxe[.-]`) → ③.2 PR-egress wave (probe found these; not a dry-run blocker — no real secrets in ③.1).

## Drift Notes

- **Drift-note 1:** route-decide scored `root` (0.05) because "experiment" is a counter-signal (−0.25) and there is no `stakes` token for "builds the apparatus a trust-experiment runs on." Novel-apparatus substrate work is under-weighted by the gate → escalated by judgment. Dictionary-expansion candidate (a `stakes`/`infra` token for experiment-apparatus / measurement-harness work).
- **Drift-note 2:** the brainstorm input was another chat's prose; 2 of its load-bearing substrate claims were stale/wrong (signed-edges "deferred" — actually in-tree; gitlab-PAT regex "broken" — actually fixed this wave). The 7-probe firsthand sweep flipped both. Reinforces: plan prose absorbed from an external source is a PREMISE to probe, never a fact.
- **Drift-note 3:** the architect VERIFY response was missing the H.9.20.0 `## KB Sources Consulted` section → the `kb-citation-gate` PostToolUse hook fired. Proceeded under the hook's option (b): the architect's analysis was directly CODE-grounded (grep + line-refs against live source, not KB recall), so substance stands; a re-spawn would reproduce the same content for a procedural heading. Pattern: a read-only VERIFY-against-live-code pass structurally leans on code probes, not KB docs — the KB-section contract fits design/recall passes better than code-verify passes. Candidate to note for the agent-contract owner.

## Pre-Approval Verification (architect + code-reviewer, parallel, 2026-06-17)

Both VERIFY personas (read-only) returned **NEEDS-REVISION** — no redesign; all 4 forks confirmed; 5 concrete pre-build fixes. All folded above → **READY**.

### Architect (design) — NEEDS-REVISION → folded
- Findings coverage / sub-wave ordering / YAGNI deferrals / subject-agnostic boundary / K12 — **PASS** (K12 decisive: `grep require(...kernel/hooks)` across `packages/lab` = 0 matches).
- Runtime-claim probes — **PASS (semantics) / FLAG (paths)**: all 6 substrate claims verified TRUE against code (emitter-dormancy, traceEmit-emits-5-no-schema-change, C2 fragmentation, convergence-not-aggregatable, instinct-inert, confirmed-lesson read-gated); 3 path citations were bare filenames. **Fixed**: all probe paths corrected to full repo-relative form.
- **Forks → all CONFIRM proposed**: (1) bare-`agentType` canonical, read-side-only normalize is the right minimal cut; (2) scalar `attrs` + new `arm-query.js` (encoding a ratio as array-`state_delta` abuses `diff`'s accrual semantics — false economy); (3) arm-loop owns the 5 emits w/ injected `solveFn` (mirrors kernel `resolveParentFn`); (4) W3a/W3b split real + each <400 LoC.
- Verdict: **NEEDS-REVISION** (sole blocker = path citations) → **Fixed → READY**.
- Procedural: missing `## KB Sources Consulted` (drift-note 3) — **Acknowledged**, analysis is code-grounded.

### Code-reviewer (correctness) — NEEDS-REVISION → folded
- **F8 (HIGH)** `attrs` scalar-only is a convention with no control/oracle → **Fixed**: call-site allow-list construction + negative oracle (Verification Probe 7).
- **F1 (MEDIUM)** `DEFAULT_ROSTERS` module-private; lab→runtime import is a layer concern → **Fixed**: K12-safe derive via `^\d+-` strip + `agents/*.md`-glob validate; unknown → null (Verification Probe 10).
- **F5 (MEDIUM)** division-by-zero in convergence ratio → **Fixed**: return `null` on zero denominator; arm-A-zero-recall test (Verification Probe 8).
- **F4 (MEDIUM)** `traceEmit` throw-in-loop not catch-isolated → **Fixed**: per-emit try/catch, degrade-to-skip (Verification Probe 9).
- **F2/F3 (LOW/PASS)** missing-`agents/*.md` edge case + unbounded slice → **Fixed**: explicit error + COUNT/BYTE-bounded slice.
- F6 (CWE-22 `assertSafeRunId` on the critical path) / F7 (SRP module split) — **PASS**.
- Verdict: **NEEDS-REVISION** (1 HIGH + 3 MEDIUM) → all **Fixed → READY**.

**Net: READY.** All forks resolved to the proposed options; 5 fixes folded into the build spec + Verification Probes; K12 clean; apparatus confirmed subject-agnostic.
