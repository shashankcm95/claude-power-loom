---
title: "Low correctness chips (B1-B4) — the Fable-review hygiene PR"
plan_id: low-correctness-chips-2026-06-10
created: 2026-06-10
status: accepted — probes done by the Fable-review workflow; USER chose "standalone hygiene PR now"
scope: 4 LOW correctness/defense-in-depth chips surfaced by the 2026-06-10 adversarial review
related:
  - packages/specs/plans/2026-06-10-combined-roadmap.md   # the parent review; these are its NOW hygiene grafts
lifecycle: persistent
---

# Low correctness chips (B1-B4)

## Context

The 2026-06-10 adversarial review of Fable-5's plans firsthand-confirmed four kernel findings. All four
are REAL but all **LOW** severity in the cooperative, trusted-local-fs, single-uid, human-in-loop
threat model the substrate declares — correctness / defense-in-depth chips, NOT the P0 blockers Fable
framed. The USER chose to ship them as one standalone hygiene PR before v3.7.

## Runtime Probes (firsthand — from the review workflow's 4 `hacker` probers against v3.6.0)

| # | Claim | Probe result | Severity |
|---|---|---|---|
| B1 | `route-decide-on-agent-spawn.js:39` hardcodes an `os.homedir()`-rooted `.claude/packages/` path with no `__dirname`-relative fallback | CONFIRMED. Ships in 3.6.0; not fixed by #281/#282. Hook is fail-OPEN consultation-visibility plumbing (always emits `approve`) — inert only on a clean plugin-install; costs log lines + silent over/under-routing. | LOW |
| B2 | `atomic-write.js:82-98` `_resolveForAtomicWrite` follows symlinks with no containment check | CONFIRMED (live probe: write followed a symlink out). DESIGNED (FIX-H3); all callers pass kernel-derived constants; same-uid-only. | LOW |
| B3 | `record-store.js` read paths return unfrozen rows | CONFIRMED. The leak is at the `loadRecordFile:313` chokepoint (all read paths funnel through it — broader than Fable's `:440-456`). #273 added verify-on-read, not freeze. The #266 shallow-freeze class. | LOW |
| B4 | `validate-no-bare-secrets.js:286-326` unbounded `readFileSync` on the Edit post-image | PARTIAL. The read is genuinely uncapped — but Fable's "inconsistent with a stdin cap" is FALSE (neither path is capped; the validator fail-opens on error). Robustness chip. | LOW |

## The fixes (each mechanical, < 80 LoC; standard test-the-new-path, not full TDD-treatment)

- **B1** — resolve `route-decide.js` across candidates via the EXISTING `safe-resolve.js`
  `resolveExecCandidate` (#282 pattern): `__dirname`-relative FIRST (under a plugin install
  `../../algorithms/route-decide.js` resolves to `${CLAUDE_PLUGIN_ROOT}/packages/kernel/algorithms/`),
  then the legacy homedir mirror. Bonus: the #282 symlink/uid exec-safety hardening the sibling
  resolvers already apply. Add a `require.main === module` guard + export `resolveRouteDecidePath` for
  the test.
- **B2** — after `_resolveForAtomicWrite` resolves, if a symlink was followed (`current !== filePath`)
  AND the resolved target is FOREIGN-owned (`lstat().uid !== currentUid()`, POSIX; Windows `uid=null`
  skips), return the ORIGINAL `filePath` (refuse the redirection; write a regular file in the intended
  user-owned dir). uid-ONLY (NOT the `safe-resolve` group-writable exec policy, which would
  false-refuse legitimate write targets — verify-panel code-reviewer note). Same-uid symlinks (the
  legit library-volume case) still follow. Defends FOREIGN-uid only; same-uid stays conceded (OQ-E).
- **B3** — NEW pure `packages/kernel/_lib/deep-freeze.js` (recursive, cycle-safe); deep-freeze the
  parsed record at `loadRecordFile`'s single `return` so ALL read paths (`readById` / `readBy*` /
  `listByRun`) serve immutable rows. Named (not an inline shallow `Object.freeze`) to prevent the #266
  re-ship.
- **B4** — cap the Edit post-image disk read at 2MB (`statSync().size` precheck); over-cap returns null
  -> the caller falls back to the new_string-only scan (the same fail-open path as an unreadable file).

## Files To Modify

| Path | Action |
|---|---|
| `packages/kernel/_lib/deep-freeze.js` | NEW pure utility |
| `packages/kernel/_lib/record-store.js` | freeze the `loadRecordFile` return |
| `packages/kernel/_lib/atomic-write.js` | `_foreignOwned` helper + containment in `_resolveForAtomicWrite` |
| `packages/kernel/hooks/pre/route-decide-on-agent-spawn.js` | `resolveExecCandidate` + export + main-guard |
| `packages/kernel/validators/validate-no-bare-secrets.js` | 2MB capped Edit-read helper |
| `tests/unit/kernel/_lib/deep-freeze.test.js` | NEW |
| `tests/unit/kernel/_lib/record-store.test.js` | B3 read-back immutability assertions |
| `tests/unit/kernel/_lib/atomic-write-containment.test.js` | NEW (B2) |
| `tests/unit/kernel/hooks/route-decide-resolve.test.js` | NEW (B1) |
| `tests/unit/kernel/validators/secrets-readcap.test.js` | NEW (B4, subprocess integration) |

## Verification

- Each chip ships with a red->green test. Full kernel suite green
  (`find tests/unit/kernel -name '*.test.js' -print0 | xargs -0 -n1 node`).
- `bash install.sh --hooks --test` green (eslint + yaml + markdownlint). SIGNPOST regenerated (new `.js`).
- VALIDATE: `code-reviewer` on all 4 + `hacker` re-probe on B2 (the containment is security-adjacent).
  3-lens is NOT required (LOW, not the kernel/security/data-mutation high-stakes class); one builder
  lens + the B2 adversarial re-probe is proportionate.
