---
status: complete
research_artifact: null
lifecycle: ephemeral
---

# Plan — pre-compact-save self-improve-store resolver fix

## Context

`pre-compact-save.js`'s `resolveSelfImproveScript()` probes pre-v4-restructure paths for the self-improve store CLI. On a fresh install none resolve, so the compaction-time consolidation scan silently no-ops (best-effort swallow). Found during the 2026-06-09 skills-audit PR-3 recon; same silent-rot class as the #276 doc-path gate, but in code. User-approved chip (task_a59e44a1).

## Routing Decision

```json
{ "recommendation": "root-by-size, kernel-by-class", "note": "single kernel hook + new test; per-wave-lite with the kernel-mandated 3-lens VALIDATE (workflow fan-out)." }
```

## HETS Spawn Plan

- VERIFY (pre-build): `architect` — single focused pass on the seam design (top-level-return guard) + candidate order.
- VALIDATE (post-build): 3-lens parallel (code-reviewer + hacker + honesty-auditor) — REQUIRED: kernel-hook diff (workflow.md Rule 2).

## Runtime Probes

- Probe 1 (bug): `resolveSelfImproveScript()` candidates at `pre-compact-save.js:294-298` — `packages/kernel/scripts/` (`ls` → No such file or directory), `packages/kernel/hooks/scripts/` (absent), `~/.claude/scripts/self-improve-store.js` (LEGACY copy — present on this machine from old installs, absent on fresh).
- Probe 2 (canonical): `ls packages/kernel/spawn-state/ | grep self-improve` → `self-improve-store.js`. Installed twin at `~/.claude/packages/kernel/spawn-state/` (verified present).
- Probe 3 (reference mirror): `auto-store-enrichment.js:24-28` `resolveStoreScript()` — already updated to `__dirname/../../spawn-state`, `__dirname/../spawn-state`, `~/.claude/packages/kernel/spawn-state` for its own store CLI.
- Probe 4 (pattern audit, H.7.15): `grep -rn "'scripts'" packages/kernel/hooks/` → ONLY the three pre-compact-save lines. No sibling resolvers carry the stale class.
- Probe 5 (testability): the hook has NO `module.exports` / `require.main` guard — `let input=''` + `process.stdin.*` run at module top level (lines 328-388, contiguous to EOF). In-process require would execute the hook.

## Files To Modify

| File | Change | Risk |
|---|---|---|
| `packages/kernel/hooks/lifecycle/pre-compact-save.js` | New candidates (mirror Probe 3) + legacy last-resort; test seam: `module.exports` + the positive guard `if (require.main === module) { <runner, re-indented one level> }`. The runner body is re-indented (NOT zero-diff) but run-as-hook BEHAVIOR is byte-identical — `git diff -w main` shows the runner body unchanged. | medium (live PreCompact hook) |
| `tests/unit/kernel/precompact-store-resolver.test.js` | NEW — red-first | low |

## Design

Candidates become (order matters — repo-canonical first, installed twin, legacy last-resort):

```js
path.join(__dirname, '..', '..', 'spawn-state', 'self-improve-store.js'),
path.join(__dirname, '..', 'spawn-state', 'self-improve-store.js'),
path.join(os.homedir(), '.claude', 'packages', 'kernel', 'spawn-state', 'self-improve-store.js'),
path.join(os.homedir(), '.claude', 'scripts', 'self-improve-store.js'), // legacy pre-v4 installs
```

Test seam (REVISED per architect VERIFY Finding 1): `module.exports = { resolveSelfImproveScript, runSelfImproveScan }` + the repo-canonical **positive** guard `if (require.main === module) { <runner, re-indented> }` — matching the 8 existing seams incl. `self-improve-store.js:606` itself. The novel bare-return variant was rejected (zero precedent; unprobed lint premise). The hook execution path is byte-identical.

VERIFY folds (architect, 2026-06-09 — NEEDS-REVISION, all folded):
- Tests are **child-process only** with `HOME=<tmpdir>`; in-process require of this hook with real HOME is forbidden (the only load-time write-risk is logger init; probe: `_log.js:37` resolves `os.homedir()` at call time ✓).
- Install-layout probe (Finding 3): the plugin cache carries `packages/kernel/spawn-state/self-improve-store.js` alongside `hooks/lifecycle/` (verified: `~/.claude/plugins/cache/power-loom-marketplace/power-loom/3.4.0/packages/kernel/spawn-state/self-improve-store.js`) → `__dirname/../../spawn-state` resolves in-cache.
- Order test pins the EXACT expected absolute path (not "not-legacy"); listener-count probe runs in a child process; an all-miss fixture (hook + `_lib` copied to a tmpdir so `__dirname` candidates miss, clean HOME) proves `resolveSelfImproveScript() === null` AND `runSelfImproveScan() === null` without throwing (the fail-soft contract).
- Legacy candidate gets a clarifying comment (fires only on partial installs; fail-soft caps blast radius).

## Phases

- [x] 1. RED: child-process test with `HOME=<tmpdir>` (clean layout): `resolveSelfImproveScript()` → expect the EXACT repo `spawn-state` path. Plus: order (decoy legacy + homedir-twin present, repo canonical still wins). Plus: require-as-module adds zero stdin listeners (DELTA across the require — Node lazily attaches one internal `end` listener on a pipe, probed 2026-06-09, so absolute counts are baseline-dependent). Plus: all-miss fixture (hook + `_lib` copied to a tmpdir so `__dirname` candidates miss, clean HOME) → `resolveSelfImproveScript()`/`runSelfImproveScan()` both null, no throw (fail-soft). **RED mechanism (honest):** pre-fix the hook has NO `module.exports`, so `require(HOOK)` returns `{}` and the resolver call throws `TypeError` → child non-zero → all 4 RED (NOT "returns null" — the old resolver was never reachable as a module).
- [x] 2. GREEN: applied the candidate list + the positive-guard test seam.
- [x] 3. Gates: kernel suite green (57 files), `bash install.sh --hooks --test` 121/0, eslint clean, live run-as-hook smoke (SAVE_PROMPT suffix emitted).
- [x] 4. VALIDATE: 3-lens workflow on the diff (kernel class) → code-reviewer APPROVE, hacker APPROVE (live-probed: diff NARROWS homedir reliance, seam tight), honesty-auditor NEEDS-FIXES (all plan-prose/comment-accuracy, no code defects — folded here). PR next.

## Out of Scope (Deferred)

- `session-self-improve-prompt.js` references (unregistered hook; PR #278 already documents its retirement).
- Whether the compaction scan still produces useful candidates post-freq-capture-retirement (the scan is best-effort and harmless; semantic review belongs to the self-improve loop work, not this path fix).

## Drift Notes

- Same-class recurrence: v4 restructure path-rot in code resolved by grep-audit + canonical-mirror; the doc-path gate covers docs but no gate covers __dirname-relative candidate lists in hooks. Possible future validator: a "resolver candidates must exist at build time" smoke assertion.
