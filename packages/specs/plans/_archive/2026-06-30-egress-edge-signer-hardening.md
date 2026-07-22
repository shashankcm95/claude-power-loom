---
lifecycle: ephemeral
topic: pra2b-w2b, egress-edge-signer, coderabbit-fold, test-hardening
---

# 2026-06-30 — Egress edge-signer hardening (3 CodeRabbit findings on merged #466 edge files)

Follow-up PR to the W2b arc (#466-#469, all merged). Three premise-probed-useful CodeRabbit
findings on #466's MERGED edge files. Out of #469's broker/actor scope, so its OWN PR. All SHADOW
+ weight-inert (`LIVE_SOURCES = Object.freeze([])`) — no live-path behavior change.

## Findings (each grounded against the merged code at `fa3a241`)

- **F2 (correctness, defensive)** — `packages/kernel/egress/loom-edge-sign.js`. Two bails use a
  bare `fail(...)` while the file's OWN documented convention (lines 114-116) is `return fail(...)`
  ("the explicit return keeps the bail-here signal if fail() is ever refactored to throw"):
  - `:85` `if (!rd.ok) fail('ctx channel: ' + rd.reason);` → add `return`.
  - `:135` `if (!sig) fail('sign failed ...');` → add `return`.
  Safe today (`fail()` calls `process.exit`), but if `fail()` ever throws/async, `:85` falls through
  to `presentedCtxRaw = undefined` and `:135` writes `undefined + '\n'` to stdout — the exact failure
  the convention prevents. Align both with the convention.

- **F4 (test strength)** — `tests/unit/kernel/egress/loom-edge-custody-verify.test.js:205`. The D4
  forbidden-import regex `/require\(\s*['"]\.\/approval['"]\s*\)/` misses `require('./approval.js')`,
  so the test stays green if the dependency comes back with an explicit extension. Broaden to
  `\.\/approval(?:\.js)?`.

- **F5 (test strength)** — `tests/unit/kernel/egress/loom-edge-launch.test.js:117-125`. The "never
  spawns" test only asserts the null return; a regression that still spawns sudo/the wrapper and then
  returns null would pass. `writeStubWrapper(dir, body)` already accepts a custom body → make the stub
  write a marker file when spawned, then assert the marker does NOT exist after the invalid-basis call.

## Deferred (premise-probed, NOT folded)

- **F1** (marginal): reject `spawn()` failures immediately in `loom-edge-sign.test.js:186` — a failed
  spawn emits `error` then `close`, so the promise could sit to the 6s timeout. Marginal (the stub
  always spawns cleanly in CI); not worth the test-harness churn this PR.
- **F3** (template-wide): Windows skip-accounting in the custom runner double-counts `passed` when a
  `WIN` guard fires. Real but TEMPLATE-WIDE (every egress test file shares the runner) — a separate
  cross-file cleanup, not this edge-scoped PR.

## Non-vacuity proofs (the discipline: a strengthened guard must demonstrably catch what it targets)

- **F4** — prove OLD regex MISSES `require('./approval.js')` (stays green) AND NEW regex CATCHES it
  (would fail), via a synthetic-src probe against both regexes.
- **F5** — prove the marker-writing stub DOES write the marker when actually spawned (happy path), so
  the new assertion is non-vacuous; the invalid-basis path must leave the marker absent.

## Verify / gate

- Full affected suites green: `loom-edge-sign`, `loom-edge-custody-verify`, `loom-edge-launch`.
- Full kernel suite green; `bash install.sh --hooks --test` (eslint/yaml/markdownlint) green.
- New `.js`? No — only existing files touched. (No signpost regen needed.)
- Lens: code-reviewer (primary). F2 is a dead-code-today defensive return + F4/F5 are test-only — no
  new input/auth surface, so the hacker lens adds little; reason it out explicitly at VALIDATE.
