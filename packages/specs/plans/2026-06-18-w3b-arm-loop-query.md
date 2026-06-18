---
lifecycle: persistent
phase: ③.1-W3b
date: 2026-06-18
status: BUILT + 3-lens VALIDATE SHIP (folded + security re-probed) 2026-06-18
---

# ③.1-W3b — the run + measure layer (arm-loop + arm-query + cli)

Second half of ③.1-W3. W3a (#350, merged `c505a64`) shipped the **construction** layer
(`canonical-persona-key` + `arm-compose` + `grounding-slice`). W3b is the **run + measure**
layer: a subject-agnostic loop scaffold that drives each arm through the experiment seams,
wires the 5 dormant F7 emitters LIVE, and an arm-aware query over the emitted timeline. Still
SHADOW; trust moves ZERO (OQ-NS-6 — the dry-run NARROWS); version held 3.11. The Python-persona
test subject + the real `claude -p` solve plug into the injected `solveFn` seam at ③.1-W4.

## Locked experiment design (carried from W3a — USER, 2026-06-17)

3-arm, grounding-isolated (**A** bare = task only / **B** styled = archetype prose + task /
**C** grounded = B + the confirmed-lesson slice); the generic toolkit prefix is excluded; the
outcome metric is **F7 trace signals** (recall-retrieval count, graph-write accrual, agent↔agent
convergence) — `grade`/BEHAVIORAL_PASS is captured as a *traced event*, never the scoreboard.

## Routing Decision (verbatim `route-decide.js`)

```json
{
  "task": "build the ③.1-W3b run+measure layer: arm-loop wiring the 5 dormant F7 emitters via an injected solveFn seam + arm-query arm-aware aggregation + cli",
  "recommendation": "root",
  "score_total": 0.075,
  "signals_matched": ["multi-file"],
  "counter_signals": [],
  "weights_version": "v1.3-dict-expanded-2026-06-12"
}
```

**Judgment escalation (overrides the gate):** `root` (0.075) — the same experiment-apparatus
under-scoring as W3a (no `stakes` token for "the apparatus a trust-experiment runs on"; this is
exactly the `drift:dictionary-gap` that **Router-v2** — now ROADMAP-anchored — will fix). The
wave is genuinely architect-shaped (live F7 wiring + a new scalar-aggregation query + the
injected-seam boundary) and the per-wave workflow MANDATES an architect VERIFY. Escalated → VERIFY
via `/verify-plan`. (Drift-note 1.)

## HETS Spawn Plan

| Persona | Role | Lens | Why |
|---|---|---|---|
| 04-architect | VERIFY (pre-build) | design | the emit-seam boundary, the scalar-vs-array metric encoding, the injected-`solveFn` contract |
| 03-code-reviewer | VERIFY (pre-build) | correctness | concrete-bug pass on the proposed module contracts |
| 03-code-reviewer | VALIDATE (post-build) | correctness | emit-per-seam correctness, arm-query aggregation, zero-denominator, no vacuous fixtures |
| 01-hacker | VALIDATE (post-build) | adversarial-security | the `attrs` scalar-only CONTROL (no raw `solveFn` output leaks into a record), CWE-22 on run-ids, a poisoned emit cannot corrupt/abort the run; live-probe the BUILT loop |
| (PM) honesty-auditor | VALIDATE (post-build) | claim-vs-evidence | does the apparatus ACTUALLY discriminate the arms (real emits, real arm-query), or a vacuous stub? deferrals labeled? |

(Full 3-lens VALIDATE: the loop composes prompts that will flow into live spawns at W4 + writes
the trace envelope — adjacent to the data-mutation/security class.)

## Runtime Probes (firsthand, against main @ `f7a7c73`)

| Claim | Probe | Result |
|---|---|---|
| the W3a construction layer is merged + exports what arm-loop consumes | `grep module.exports packages/lab/persona-experiment/{canonical-persona-key,arm-compose,grounding-slice}.js` | CONFIRMED — `composeArm`/`defaultLoadArchetype`/`ARMS`; `buildGroundingSlice`/`DEFAULT_MAX_*`/`LESSON_LINE_MAX`; `canonicalPersonaKey`/`BARE_SHAPE`. |
| `traceEmit` emits the 5 dormant components with NO schema change | read `packages/lab/trace-emitter/index.js:17-38` + `trace-schema.js:19-27` | CONFIRMED — `traceEmit({run_id, component, event, [ts], [dur_ms], [inputs_digest], [outputs_digest], [state_delta], [attrs]})`; store owns seq; `persona-spawn`/`recall-retrieval`/`solve`/`grade`/`graph-write` are valid frozen components (only `close-path` has a live emitter). |
| the privacy boundary: digest fields vs the free-form bags | `index.js:6` + `trace-store.js` header | CONFIRMED — `inputs_digest`/`outputs_digest` are 64-hex (the enforced boundary; caller `digest()`s content BEFORE passing); `attrs`/`state_delta` are UNSCANNED plain-object bags. **→ arm-loop puts ONLY scalar arm/convergence metrics in `attrs` (F8 control); any content is digested.** |
| `arm-query` can stay additive (leave `query.js` frozen) | `grep module.exports packages/lab/trace-emitter/query.js` → `{ summarize, diff }` | CONFIRMED — `readTimeline` lives in `trace-store.js`, NOT `query.js`. **→ arm-query consumes `trace-store.readTimeline`; `query.js`'s `{summarize,diff}` contract is untouched.** |
| the emit catch-isolation precedent (VERIFY fold F4) | read `packages/lab/trace-emitter/ingest-close-path.js:39-55` | CONFIRMED — `emitClosePath` wraps `traceEmit` in try/catch → a bad emit degrades to `skipped`, never aborts the batch. arm-loop mirrors this per seam. |
| run-id path-safety (CWE-22) | `trace-store.js` `assertSafeRunId` (W2a) | CONFIRMED exported + on the `timelinePath` critical path; arm-loop/arm-query reuse it (no new path-join surface). |

## Design (resolved forks from the W3a VERIFY — now BUILD, not open)

- **`arm-loop.js`** — the loop scaffold. `runArm({ run_id, arm, persona, task, solveFn, knownPersonas })` (and a `runExperiment` that runs A/B/C for one task) drives the seams and emits one F7 record each: `persona-spawn` (attrs `{arm, persona}` + scalar convergence metrics), `recall-retrieval` (arm C builds the slice → attrs `{arm, lesson_count}`; A/B emit count 0), `solve` (calls the injected `solveFn`; `dur_ms` = wall-time; `outputs_digest` = `digest(result)`, NEVER raw), `grade` (attrs `{arm, behavioral_verdict}` — observed-not-optimized), `graph-write` (accrual; `state_delta.lessons_written` as an ARRAY for `diff` accrual + attrs `{arm}`).
  - **Fork 3 (RESOLVED):** `solveFn` is an INJECTED seam (dependency-inversion, mirrors the kernel `resolveParentFn`) — a stub in tests, the real `claude -p` driver at W4. arm-loop owns ALL 5 emits; no other module calls `traceEmit`.
  - **Fold F8 (HIGH — CONTROL not convention):** each `traceEmit`'s `attrs` is constructed from a numeric/bounded allow-list AT THE CALL SITE; `solveFn` output NEVER spreads into `attrs`/`state_delta` — content is `digest()`d into `outputs_digest`. A negative oracle asserts no raw solve text in any record.
  - **Fold F4 (catch-isolation):** every `traceEmit` is wrapped in try/catch → a schema-rejected emit degrades to a logged skip; the run completes + the timeline stays intact.
- **`arm-query.js`** — arm-aware aggregation over `trace-store.readTimeline(run_id)`. `summarizeByArm(run_id)` → per-arm `{recall_count, graph_write_accrual, solve_count, grade_verdicts, convergence}`; `compareArms(run_id)` → the cross-arm delta table (A vs B vs C). **Fold F5:** a convergence ratio with a zero denominator (e.g. arm A, zero recall) returns `null`, never NaN/throw. Additive — does NOT touch `query.js`.
- **`cli.js`** — `run` (execute a 3-arm experiment; `solveFn` from an injected module path, defaulting to a stub), `compare <run_id>` (per-arm + cross-arm delta), `summarize <run_id>`. Lab-CLI convention (`// @loom-layer: lab`, `assertSafeRunId`, clean messages, exit 0/1).

## VERIFY folds (NEEDS-REVISION → folded into the build spec)

- **(code-reviewer FLAG-1) Double catch-isolation on the degraded-grade path.** When `solveFn` throws, the catch emits a `grade` record with `behavioral_verdict: 'error'` — and THAT emit is ITSELF try/catch-wrapped (the degraded grade could schema-reject and re-throw). Two-level isolation, mirroring `ingest-close-path.js:43-54`; the run never aborts.
- **(code-reviewer FLAG-2) Name the attrs cap; it is a test-enforced CONTROL, not a schema gate.** `attrs` values are scalars from a call-site allow-list; the negative oracle rejects any `attrs`/`state_delta` string longer than a named `ATTRS_STR_CAP` (128). Honest framing: the schema only checks `attrs` is a plain object — the scalar-only invariant is held by the call-site construction + the negative oracle, NOT the store. Real-content scrub is W4.
- **(architect + code-reviewer) Broaden the negative oracle to `state_delta` too.** `graph-write` writes `lessons_written` into `state_delta`, so "no raw solve text in any record" covers BOTH `attrs` AND `state_delta` (entries are 64-hex/short node-ids, never prose).
- **(code-reviewer FLAG-3) Name the missing-`attrs.arm` treatment.** A record with no valid `attrs.arm` is EXCLUDED from every per-arm rollup AND counted in a separate `unattributed` tally `arm-query` surfaces (loud — never silently bucketed into an `undefined` arm that would corrupt a ratio).
- **(code-reviewer FLAG-6, SRP) Split `arm-loop` functions.** `runExperiment` (the A/B/C driver), `runArm` (one arm's orchestration + timing), and a per-seam `emitSeam(...)` helper (the single catch-isolated `traceEmit` call site) are SEPARATE functions, each < 50 lines — the emit-protocol lives in one helper, not scattered across the loop.

## Build (TDD — test FIRST, red, then green)

- `arm-loop.test.js`: each seam emits its F7 component with `attrs.arm`; the injected stub `solveFn` is the only spawn; a THROWN `solveFn` degrades to a traced `grade` event (run does not abort); a poisoned emit degrades to a logged skip (catch-isolation); the NEGATIVE ORACLE — stub solve text appears in NO record + no `attrs` value is a string over a small cap.
- `arm-query.test.js`: groups by `attrs.arm`; per-arm recall/graph-write/convergence; arm A (zero recall) → convergence `null` (no NaN/throw); a mixed-arm + a missing-`attrs.arm` record handled; a 3-arm compare yields the delta table.
- Oracle discipline (Rule-2a): a stub `solveFn` + REAL W3a modules (real `composeArm`/`buildGroundingSlice` against a sandboxed `LOOM_LAB_STATE_DIR` with planted confirmed lessons) — emits read back from the real timeline. NO vacuous fused stub.
- Dogfood (`_spike/dogfood-run.js`): run a 3-arm experiment for a fixture persona with a stub solver → `arm-query` the cross-arm delta → assert arm C `recall_count > 0` + graph-write accrual, arm A `recall_count == 0` (the apparatus DISCRIMINATES the arms it exists to discriminate — the Rule-2a-corollary real-path proof).

## VALIDATE (post-build, 3-lens — see HETS Spawn Plan)

Fold findings → full gate → PR → CodeRabbit gate → USER merge.

## VALIDATE result (W3b build + 3-lens, 2026-06-18) — SHIP (folded)

Delegated `node-backend` TDD build: 6 modules + **GREEN suites** (persona-experiment 84 + trace-emitter regression 42; `cli.test.js` new = 9), dogfood DISCRIMINATES (arm C recall=2/accrual=2/`pass_rate_over_recall`=0.5; arm A recall=0/null; canary text on NO on-disk record), K12 grep clean, eslint clean. All 5 prior VERIFY folds genuinely implemented (honesty-auditor positively attested). 3-lens VALIDATE on the BUILT diff; every finding folded; the 2 security MEDIUMs RE-PROBED firsthand (a live `/tmp` adversarial script — Rule-2a):

- **hacker (adversarial-security) — NEEDS-REVISION → folded + re-probed:**
  - **MED:** subject `solveFn` verdict flowed verbatim into `attrs.behavioral_verdict` (a terminal-escape/log-injection sink — and at W4 that verdict is real `claude -p` output). Folded: a CLOSED `VERDICT_SET` (`observedVerdict`) collapses any out-of-set / control-char / injection verdict to `unknown`. **Re-probe: a `PWN<ESC>[2J<BEL>` verdict persists as `unknown`, zero control chars on disk.**
  - **MED:** untrusted verdict used as a raw `grade_verdicts` object key (`__proto__`/`constructor` → silently drop/corrupt the rollup). Folded: `Object.create(null)` + `hasOwnProperty`-safe accumulation. **Re-probe: forged `__proto__`/`constructor`/`toString` keys count as own-keys (1 each), all integer counts, `Object.prototype` unpolluted.**
  - **LOW (carry):** arm-query trusts unbounded forged metrics (integrity≠provenance); **LOW (carry):** `cli --solve` arbitrary-module-load; **NIT:** space/backslash run_id (POSIX-benign).
- **code-reviewer (correctness) — SHIP-WITH-NITS → folded:** **MED** `emitFn:null` silently dropped all 15 records → boundary guard + test; **LOW** no cli tests → `cli.test.js`; **LOW** `solve_count` doc; **NIT** solve:error `inputs_digest` → W4 decision.
- **honesty-auditor (claim-vs-evidence) — SHIP-WITH-NITS → folded:** **MED** the `convergence` name collision → the query-side ratio renamed `pass_rate_over_recall`, the emitted placeholder removed, agent↔agent convergence labeled W4; **LOW** graph-write accrual is a synthetic mirror of recall in W3b (noted in the dogfood); **LOW** the dogfood proves PLUMBING discrimination, not persona discrimination under nondeterminism (wording fixed); **NIT** the read-only lens couldn't run the suites → the orchestrator runs the full gate (below).

**Net: SHIP.** 2 security MEDIUMs (verdict-injection sink + object-key injection) + the convergence-honesty rename + the emitFn data-loss guard, all folded; the 2 security fixes re-probed firsthand on the built code.

## Verification Probes

| Probe | Pass criterion |
|---|---|
| 1 | `bash install.sh --hooks --test` → all green |
| 2 | full kernel + lab unit suites → green |
| 3 | dogfood: 3-arm run → arm C `recall_count>0` + accrual, arm A `recall_count=0` (discriminates) |
| 4 | negative oracle: stub solve text in NO trace record; no `attrs` value a string over the cap |
| 5 | `arm-query` returns `null` (not NaN/throw) for a zero-denominator convergence ratio |
| 6 | a poisoned `traceEmit` inside `arm-loop` → logged skip; run completes; timeline intact |
| 7 | K12: no `packages/lab/persona-experiment/**` import of `packages/kernel/hooks`; `arm-query` does not import `query.js` internals |
| 8 | SIGNPOST regen clean; doc-path gate green |

## Out of Scope (Deferred)

- **The test subject** — the Python persona + real issue corpus + the real `claude -p` `solveFn` → ③.1-W4 (the injected seam it plugs into).
- **C2 full reconcile** (store migration + record-time roster enforcement) → ③.1-W4.
- **`attrs`/`state_delta` secret-scrub of REAL content** → W4 (W3b uses a stub `solveFn`; the scalar-only CONTROL + the negative oracle are the W3b defense).
- **Router-v2 (route-decide inference upgrade)** → ROADMAP Deferred (anchored; queue after ③.1, fed by this experiment's routing corpus).
- **#273 EDGE signed-lane for the slice + lab-store-dir 0700** → carries (W3a hacker; shadow-tolerable — the slice/loop gates nothing).
- **arm-query trusts unbounded forged metrics from the open-writable store** (integrity≠provenance — a same-uid writer can plant a `recall-retrieval`/`graph-write` record inflating the cross-arm delta) → carry (W3b hacker; shadow-tolerable, the metric gates nothing). Before any arm-query metric GATES (W4+), the feeding records need an authenticated minter, not a store re-read — same conclusion as the W3a #273 carry.
- **`cli --solve <path>` require()s + executes an arbitrary local module at load** (operator-trust ACE surface) → carry. Fine for an operator-run CLI in W3b; if `--solve` is ever automation/config-fed at W4, confine resolution to a `solvers/` dir (`checkWithinRoot`) + an explicit opt-in.
- **W4 grade provenance:** in W3b the stub `solveFn` SELF-ASSERTS its `verdict` (the subject controls the grade). At W4 the behavioral grade MUST be HARNESS-computed (run the tests), NOT read from the subject's self-asserted verdict — the closed `VERDICT_SET` only bounds the injection surface, it does not make a self-asserted grade trustworthy.
- **O(1) seq-counter** (the W2a→W4 trace-store carry) — unchanged here.

## Drift Notes

- **Drift-note 1:** route-decide scored `root` (0.075) on W3b — the same experiment-apparatus under-scoring as W3a, the `drift:dictionary-gap` (convergence 3) that the now-ROADMAP-anchored Router-v2 wave fixes. Escalated by judgment.
- **Drift-note 2:** dogfooded the freshly-merged MD004 list-marker rule while authoring this plan (no wrapped line opens with a bare `+`/`-`/digit-dot marker).
- **Drift-note 3:** the architect VERIFY response again lacked a `kb:`-bearing `## KB Sources Consulted` section (it verified against repo CODE, not kb docs) → `kb-citation-gate` fired; proceeded under option (b) (code-grounded substance stands). Recurring on code-verify passes — the same pattern as the W3a verify (the contract fits design/recall passes, not code-verify).

## Pre-Approval Verification (architect + code-reviewer, parallel, 2026-06-18)

Architect (design) → **READY** (all 9 checks PASS, firsthand-verified against `f7a7c73`); code-reviewer (correctness) → **NEEDS-REVISION** (3 one-line spec gaps + 1 SRP advisory). All folded above → **READY**.

### Architect — READY
- Coverage / injected-seam / 5-emitter-no-schema-change / metric-encoding-split / privacy-boundary / YAGNI / K12 / runtime-claim-probes / sub-wave-shape — **all PASS**. Firsthand confirmations: `grep traceEmit packages/lab` shows no `persona-experiment` caller today (clean seam); `grep require(...kernel/hooks) packages/lab/persona-experiment` = 0 (K12); `query.js` exports `{summarize,diff}` only; `digest()` is the sha256-hex helper re-exported from `index.js`.
- Advisory: broaden the negative oracle to `state_delta` (graph-write writes the array there) — **folded**.

### Code-reviewer — NEEDS-REVISION → folded
- **FLAG-1 (folded):** the degraded-grade emit on a `solveFn` throw must be double catch-isolated.
- **FLAG-2 (folded):** name the `attrs` cap (`ATTRS_STR_CAP`=128) + state it's a test-enforced control, not a schema gate.
- **FLAG-3 (folded):** name the missing-`attrs.arm` treatment (exclude + `unattributed` tally).
- **FLAG-6 / PRINCIPLE (folded):** split `arm-loop` into `runExperiment`/`runArm`/`emitSeam`, each < 50 lines.
- PASS: `digest()` usage, CWE-22 (`assertSafeRunId` inherited), DRY reuse of W3a modules, no scope-creep (stub `solveFn` only).

**Net: READY.** No re-architecture — the scalar/array metric cut, the injected-`solveFn` seam, and the additive `arm-query` are confirmed sound; 5 plan-prose folds applied.
