---
lifecycle: persistent
---

# item-3-live leg 1 — the real `claude -p` live-lesson deriver (SHADOW, weight-inert)

## What & why

The autonomous-SDE wire is mechanism-complete but **doubly production-inert**: `LIVE_SOURCES=Object.freeze([])`
AND the captured floor is empty because the live-lesson deriver leg is `null` (`live-draft-run.js:238`
`lessonLegFn = (ctx.deps && ctx.deps.lessonLegFn) || null`). The PURE deriver (`deriveLiveLesson` + the
injected `deriveFn` seam, `causal-edge/live-lesson-derive.js`, #454) already shipped + is unit-tested. **Leg 1
builds the impure `deriveFn` itself** — the real host-guarded **tool-less** `claude -p` map that turns the
bounded, public-safe leg input into `{trigger_class, gotcha_class, corrective_class, lesson_body}`, and wires
it in as the default (on the real-run path only) so capture **actually happens** (lessons land in the
`live_pending` lane). It stays weight-inert: the lane gates no weight, `LIVE_SOURCES` is still empty. Plus the
two named hardenings this adversarial-text surface requires: a **delimiter-fence on the untrusted
`_diagnostic` leg input** (prompt-injection defense), and a **non-vacuous echo-canary rail** that replaces the
structurally-vacuous `lessonLeaks` no-op on the live path.

## Honest scope / trust posture (down-rated to what the artifacts support)

- **Stays SHADOW + weight-inert.** Capturing into `live_pending` gates no weight (`weight-source-gate.js:37`
  keys on `source`; `LIVE_SOURCES` is empty). This makes capture **reachable, not trusted**. OQ-NS-6 holds: an
  engineered signal NARROWS; only a maintainer merge HARDENS.
- **#273 (authorization) unchanged — but leg 1 ADDS a FIFTH host-side `claude -p` chokepoint** over
  attacker-influenced public-issue text. The lever is the SPAWN, not the lesson weight. It MUST route through
  `assertHostClaudeAllowed` (armed-refusal, fail-closed) AND the `verifyToollessRuntime` preflight, and the
  `#430` CI armed-guard invariant (`tests/unit/lab/causal-edge/judge-labeler-armed-guard.test.js`) MUST be
  extended to cover it. The fence + echo-rail are **correctness / anti-injection, NOT authorization**. PR-A2
  (the authenticated cross-uid edge minter) is the hard #273 close — out of scope here.
- **The echo-canary rail catches NAIVE/accidental verbatim echo only.** It reuses `lessonLeaks`, whose own
  doc (`lesson-signature.js:100-107`) states its residuals — (a) a verbatim run < `RUBRIC_LEAK_MIN`=12
  normalized-alnum chars slips under; (b) cross-script homoglyphs break the run — **require the leg to be
  adversarial, which here it IS.** So the rail is **non-vacuous ONLY when the diagnostic needle has >=12
  normalized-alnum chars**; empty/short-needle records run it vacuously. It does **NOT** defend an adversarial
  leg, and it is **NOT** a secret-leak guard (the needle is already-public issue text). Framing: **narrowed,
  not closed.** The closed-enum OUTPUT axes (off-floor -> null) + body bound + coarse scrub are the actual
  containment; the fence is best-effort prompt-hardening, not a parser boundary. The digest-only
  problem-statement echo stays uncatchable (no text needle). The authenticated minter is the eventual close.

## Files

### 1. `packages/lab/causal-edge/live-lesson-derive.js` (PURE-ish, existing — ADD prompt builder + needle + rail + emit seam)

- **`buildLiveDerivePrompt(legInput, { nonce })` (NEW, exported).** Builds the STRICT-JSON prompt. The
  untrusted `_diagnostic` strings are wrapped in a **nonce-delimited fence**; the impure leg supplies a real
  `crypto.randomBytes(8).toString('hex')` nonce per call (injected in tests for determinism). The three
  friction AXES are SANITIZED before interpolation — `safeEnumKey(legInput.friction.friction_class,
  FRICTION_CLASS)` etc. (import `FRICTION_CLASS/FRICTION_PHASE/DETECTION_LEG` from `trajectory-friction.js`;
  export them if not already) — so a direct caller that skips the eligibility gate cannot smuggle an
  attacker-controlled axis into the trusted metadata line OUTSIDE the fence (hacker MEDIUM, fence-bypass).
  Carries ONLY: the closed-enum floor (`JSON.stringify(TRIGGER/GOTCHA/CORRECTIVE_CLASS)`), the
  problem-statement DIGEST (a hash), the candidate_patch_sha (a hash), the SANITIZED friction axes, and the
  bounded `_diagnostic` free-text **inside the fence**. NEVER a raw clone path, API key, lab-state path, raw
  problem statement, or `accepted_diff` (a live issue has none). **Break-out defenses:** (1) the per-call
  unguessable nonce — an attacker `_diagnostic` cannot forge the END marker; (2) belt-and-suspenders, strip
  any `LOOM_UNTRUSTED_` token from each bounded diagnostic string before fencing, **case-insensitive**
  (`/loom_untrusted_/gi`). The fence is BEST-EFFORT — state in the header that the load-bearing containment is
  the closed-enum output validation + bound/scrub, not the fence.
- **`diagnosticNeedle(legInput)` (NEW, exported helper).** Returns `[d.human_message, d.expected, d.observed]
  .filter(Boolean).join('\n')` from `legInput.friction._diagnostic` — the SAME bounded text the leg saw (so
  the scan and the prompt can never diverge). Exported so the rail + tests use one definition.
- **The non-vacuous echo-canary rail inside `deriveLiveLesson` (single-build dataflow).** `deriveLiveLesson`
  builds `legInput = buildLegInput(input)` ONCE (already does, line 103), passes it to `deriveFn(legInput)`,
  then derives `const needle = diagnosticNeedle(legInput)` from that SAME object. Order:
  **bound body -> echo-rail(raw body vs needle) -> on echo REJECT (return null) + emit -> scrub clean body
  -> return.** This is a NEW rail (not a mirror of the backtest, which has no scrub and hard-rejects on leak).
  `if (lessonLeaks(body, needle)) { emitFn('live-lesson-echo-rejected', { detail: 'body-echoes-diagnostic' });
  return null; }` — REUSE `lessonLeaks` from lesson-signature (DRY; same RUBRIC_LEAK_MIN run + normalizer).
  A leaking body is rejected, so scrub runs only on a clean body. **Honest:** a secret span absent from the
  needle still rides through coarsely-scrubbed only (named residual REMAINS).
- **Emit seam (OBSERVABLE fail-closed reject).** Extend `deriveLiveLesson(input, deriveFn, { emitFn =
  emitEgressAlert } = {})` — additive/backward-compatible (existing 2-arg calls unaffected). The benign nulls
  (no leg / empty output / off-floor axis / over-bound body) stay SILENT (coverage-narrowing); the ECHO null
  EMITS (security.md: a fail-closed security decision must be OBSERVABLE). **`emitFn` is a TEST-ONLY seam —
  NO production caller threads it** (the default `emitEgressAlert` is the production binding), the same blessed
  posture as `isEmitArmedFn` (host-claude-guard.js:39-42). The alert detail rides a NON-`reason` key
  (alert.js positional-reason precedence). Update the module header: "PURE except an injected observable emit
  on the security-reject path (DIP seam, default emitEgressAlert; emit is node-core-leaf, no cycle)".

### 2. `packages/lab/causal-edge/live-lesson-derive-run.js` (NEW, impure — `// @loom-layer: lab` header)

Mirrors `_spike/lesson-capture-rerun.js`'s `makeLessonDeriver`. Exports
`makeLiveLessonDeriver({ bin, timeout, maxBudgetUsd, spawnFn })` returning the `lessonLegFn`
(`(legInput) => {trigger_class,gotcha_class,corrective_class,lesson_body}|null`):

- Generate a per-call unguessable nonce (`crypto.randomBytes(8).toString('hex')`).
- `const prompt = buildLiveDerivePrompt(legInput, { nonce });` (the PURE builder, imported).
- **CRITICAL — exact `claudeOnce` contract.** Import `{ claudeOnce, resolveClaude }` from
  `calibration-issue-run.js` (already a dependency of live-draft-run; zero new coupling; the host-guarded
  single-home). Its signature is **POSITIONAL**: `claudeOnce(bin, prompt, timeout, extraArgs=[],
  maxBudgetUsd=null, { isEmitArmedFn, spawnFn, judgeLauncherFn })`. Call it EXACTLY:
  `claudeOnce(bin, prompt, timeout, toollessArgs(true), maxBudgetUsd, { spawnFn })`.
  **Tool-less is NON-OVERRIDABLE** — `toollessArgs(true)` hardcoded, NO `toolless` param (this leg ingests
  adversarial text; it must never run un-pinned; stronger than the judges' optional `toolless`).
- `claudeOnce` does: `assertHostClaudeAllowed` (armed-refusal) -> `resolveJudgeLaunch` (cross-uid routing) ->
  tool-less `claude -p` -> whole-output fence-strip -> `JSON.parse` -> fail-closed `{ok:false,reason}`.
  `--model` PINNED (`JUDGE_MODEL`), `maxBudgetUsd` cost-cap. On `!r.ok` -> return null (-> the PURE
  `deriveLiveLesson` benign null).
- Return `{trigger_class, gotcha_class, corrective_class, lesson_body}` from `r.obj` or null.
- The cost cap is FINITE-BY-DEFAULT (`DERIVE_MAX_BUDGET_USD = 0.5`) so `--max-budget-usd` ALWAYS rides on the
  wired `makeLiveLessonDeriver({})` path (non-bypassable; VALIDATE HIGH fold). (No `--dry` stub leg — YAGNI
  fold: the unit test drives an injected `spawnFn` spy; no in-module no-network stub is needed.)
- Add the `node scripts/generate-signpost.js` entry (CI Test 121 SIGNPOST-drift — a NEW `.js`).

### 3. `packages/lab/persona-experiment/live-draft-run.js` (WIRING — flip on, real-run path only)

- In `runLiveDraftLoop`, build the leg ONCE (next to the judges, after the `judgesInjected` calc at line 339),
  **guarded by `!judgesInjected`** so the test path never builds/spawns a real leg (architect HIGH — the
  existing `loopDeps()` injects judges but not `lessonLegFn`; keep the preflight skip keyed on `judgesInjected`
  UNCHANGED):
  `const lessonLegFn = Object.prototype.hasOwnProperty.call(deps, 'lessonLegFn') ? deps.lessonLegFn : (!judgesInjected ? makeLiveLessonDeriver({}) : null);`
  (a PRESENCE check, NOT `||`, so an explicit `deps.lessonLegFn` including `null` = "no leg" always wins - the
  null-preserving contract, VALIDATE fold 4.)
  Then thread it: pass `deps: { ...deps, lessonLegFn }` into `solveGradeDraftOne` (line ~362-365). Built once
  (`resolveClaude()` at build time), shared across records. **No `realClaudeInjected` / preflight change** —
  because the real leg exists only when `!judgesInjected`, which is exactly when the preflight already runs.
- Update `solveGradeDraftOne` line 238 comment (the leg is now PRESENT on the real path).
- Import `{ makeLiveLessonDeriver }` from `../causal-edge/live-lesson-derive-run`.

### 4. `tests/unit/lab/causal-edge/judge-labeler-armed-guard.test.js` (EXTEND — cover the 5th chokepoint)

Add a case asserting `makeLiveLessonDeriver`'s leg routes through `assertHostClaudeAllowed` (armed -> refuse,
no spawn). Mirror the existing judge/labeler cases. (honesty HIGH-2 + hacker MEDIUM — the new chokepoint must
be under the #430 armed-window CI invariant.)

## Tests (TDD-treatment — write first)

**Pure (`tests/unit/lab/causal-edge/live-lesson-derive.test.js`, extend):**
- `buildLiveDerivePrompt`: fence brackets ONLY the diagnostic; floor enums present; digest/sha present
  (hashes); friction axes SANITIZED (an off-enum axis -> 'INVALID', never echoed raw); no clone-path/accepted.
- **break-out (NON-VACUOUS, two independent proofs):** (a) a `_diagnostic` carrying a full `..._END` marker
  with a WRONG nonce stays INSIDE the fence; (b) a `_diagnostic` carrying the literal `LOOM_UNTRUSTED_` token
  -> stripped (case-insensitive). Neither vacuous.
- echo-rail: body echoing a >=12-char run of the needle -> null + `emitFn` called with `live-lesson-echo-rejected`;
  off-floor axis -> null + `emitFn` NOT called (benign); clean general-principle body that merely shares
  vocabulary -> mints (document the >=12-contiguous-alnum FP boundary).
- **vacuous case (codify the limit):** empty/short (<12) diagnostic needle -> rail CANNOT fire -> the
  off-floor/scrub/bound rails are the only backstop (asserts the honest residual, not a blanket guarantee).
- backward-compat: existing 2-arg `deriveLiveLesson(input, leg)` calls still pass.

**Impure leg argv (`tests/unit/lab/causal-edge/live-lesson-derive-run.test.js`, NEW — injected `spawnFn`, no real claude):**
- **CRITICAL argv-assertion (Rule 2a):** inject a `spawnFn` spy; assert the spawned argv CONTAINS
  `--tools`, `''`, `--strict-mcp-config`, `--disallowedTools`, `LSP` AND `--max-budget-usd` — proves the
  tool-less pin + cost cap actually rode (a green parse test does NOT prove this; the silent-drop is the bug).
- prompt-on-stdin carries the fenced diagnostic; fail-closed mapping (nonzero exit / parse-failure -> null).

**Wiring (`tests/unit/lab/persona-experiment/live-draft-run.test.js`, extend):**
- judges injected + `lessonLegFn` absent -> NO real leg built, NO spawn, preflight SKIPPED (H5 contract
  intact). Confirm H5:232/238/247/253 still pass.

The impure `-run.js` real-claude path runs only on a live dogfood (no real spawn in CI; the `.test.js` uses the
injected `spawnFn` spy exclusively).

## Runtime Probes (verified 2026-06-28)

- `grep -n 'function claudeOnce' calibration-issue-run.js` -> `:128` POSITIONAL `(bin,prompt,timeout,extraArgs,maxBudgetUsd,{opts})`. (CRITICAL contract.)
- `grep -n 'FRICTION_CLASS|FRICTION_PHASE|DETECTION_LEG' trajectory-friction.js` -> `:254/:259/:260` (axis enums + `safeEnumKey` sanitization at `:314`).
- `judge-labeler-armed-guard.test.js` EXISTS at `tests/unit/lab/causal-edge/` -> extend (4th file above).
- `live-draft-run.js:20` imports `makeBlindSemanticJudge` from `calibration-issue-run` -> importing `claudeOnce` from there = zero new coupling.
- live-draft-run.js seam line 238 (lessonLegFn), judge defaults ~329-330, preflight ~335-348, `judgesInjected` at 339 — confirmed by the VERIFY board.

## Gates (pre-PR)

- kernel suite green; `bash install.sh --hooks --test` (eslint/yaml/markdownlint) green.
- `node scripts/generate-signpost.js --check` (NEW `.js`) + `node scripts/validate-release-surface.js --check`.
- New + touched lab suites green; source confirmed pure-ASCII (the prompt/fence is a prime smart-quote risk —
  use ASCII `<<<` markers only).
- CodeRabbit on the PR (un-draft for one review; premise-probe + fold).

## VERIFY board folds (all 22 findings)

| Finding (lens) | Resolution |
|---|---|
| CRITICAL claudeOnce signature drop (hacker, honesty) | Import positional `claudeOnce` from calibration-issue-run; call `(bin,prompt,timeout,toollessArgs(true),maxBudgetUsd,{spawnFn})`; tool-less NON-OVERRIDABLE; NON-VACUOUS argv-assertion test |
| HIGH preflight regresses H5 test (architect) | Build leg only on `!judgesInjected`; preflight skip stays `judgesInjected` UNCHANGED; no `realClaudeInjected` |
| HIGH leak-rail order/needle false "mirrors backtest" (hacker, honesty) | Reframed: NEW rail, echo-canary not secret-leak; explicit order bound->rail->reject+emit->scrub |
| HIGH rail still vacuous <12 / empty needle (hacker) | Stated non-vacuous ONLY for >=12-char needle; added vacuous-case test codifying the residual |
| HIGH "#273 / no new attack lever" under-analyzed (honesty) | Reframed: a 5th host-claude chokepoint; armed-guard + preflight + CI-invariant coverage made explicit |
| MED leak-rail over-claim (architect) | Reframed as anti-injection canary; "narrowed, not closed"; FP boundary documented + tested |
| MED OQ4 claudeOnce coupling (architect) | Resolved: import (zero new coupling); `_lib/claude-once.js` extraction = out-of-scope follow-up |
| MED buildLegInput needle dataflow (architect) | Single-build `legInput`; `diagnosticNeedle(legInput)` exported helper; one definition |
| MED friction axes fence-bypass (hacker) | `safeEnumKey`-sanitize the 3 axes in buildLiveDerivePrompt |
| MED emitFn non-bypassable (hacker) | Documented TEST-ONLY; production uses default; CI assertion; non-`reason` detail key |
| MED preflight covers real-leg (hacker) | Subsumed by the HIGH `!judgesInjected` fix; test: judges-injected -> no leg, preflight skipped |
| LOW OQ answers (architect) | OQ1 nonce-injectable; OQ2 emitFn-seam; OQ3 default-on (real path); OQ4 import; OQ5 diagnostic-only |
| LOW build-once (architect) | Built once in runLiveDraftLoop, threaded via deps spread |
| NIT @loom-layer header (architect) | Added to the new -run.js |
| LOW nonce strip case/unicode + fence best-effort (hacker) | `/loom_untrusted_/gi`; fence stated best-effort, closed-enum is containment |
| LOW OQ1 non-determinism non-issue (honesty) | Resolved: nonce injected in tests; leg already non-deterministic |
| MED unprobed line numbers (honesty) | Added the Runtime Probes section above |
| MED break-out test vacuity (honesty) | Two independent non-vacuous proofs (wrong-nonce END + literal-token strip) |
