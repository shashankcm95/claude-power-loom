<!--
lifecycle: persistent
-->
# K9 CWE-22 fixture corpus

Data fixtures for `tests/unit/kernel/_lib/k9-path-guard.test.js` (and consumed by
`k9-promote-deltas.test.js` for the conflict-bailout abort path). These are **data
files**, not test runners — the CI `kernel-property-tests` job discovers tests via
`find tests/unit/kernel -name '*.test.js'`, so nothing under `tests/fixtures/` is
executed directly.

Single source of truth: `fixtures.json`. The test iterates the manifest so the
fixture corpus and the assertions never drift.

## Taxonomy (28 fixtures)

Per plan `2026-05-27-phase-1-alpha-v3.0-alpha-kernel.md` line 139
("5-category × 4 = 20 path-traversal + 4 semantic-invalidity + 6th conflict-bailout
category") plus the verify-plan ROUND-2 MEDIUM finding (raise conflict-bailout from
2 → 4 because it is the CWE-732 + INV-K9-SyntacticAtomicity abort path — the most
security-sensitive surface in K9).

| Category | Count | Verdict | What it pins |
|---|---|---|---|
| `dotdot-traversal` | 4 | reject | `..` segment escapes the worktree root (CWE-22) |
| `absolute-outside-root` | 4 | reject | absolute path pointing outside the scoped root |
| `null-byte` | 4 | reject | embedded `\0` truncation (CWE-158) |
| `symlink-escape` | 4 | reject | symlinked ancestor resolves outside the root (TOCTOU surface) |
| `encoded-traversal` | 4 | reject | encoded / mixed-separator `..` smuggling |
| `semantic-invalidity` | 4 | reject | well-formed path, malformed *request* (empty SHA, non-hex SHA, missing root, type error) |
| `conflict-bailout` | 4 | mixed | cherry-pick conflict → `git cherry-pick --abort` → host byte-for-byte; **NO** `.orig`/`.rej` remain |

Total: `5 × 4` (traversal) `+ 4` (semantic) `+ 4` (conflict-bailout) = **28**.

## No-secret discipline (F22 / F23)

No fixture carries a real-shaped secret (no AWS key prefixes, no `sk-` tokens, no
PEM blocks, no `ghp_` GitHub tokens). Traversal payloads target neutral system
paths (`/etc/hostname`, `/etc/shells`) — never `/etc/shadow`-style targets that a
secret-scanner would flag. SHAs in fixtures are obvious test patterns
(`a`/`b`/`c`-repeats, `deadbeef…`), never anything resembling a credential.

## Field schema (`fixtures.json[]`)

- `id` — stable kebab-case identifier, prefixed by category.
- `category` — one of the 7 categories above.
- `candidate_path` — the write target K9 would canonicalize/scope. Relative paths
  are resolved against `root` by the test; absolute paths are used as-is.
- `root` — the worktree-root the write must stay within (placeholder
  `<<ROOT>>` is substituted with the test's hermetic tmp root at load time).
- `verdict` — `"reject"` or `"accept"`.
- `reason` — expected `checkWithinRoot` reason token (`traversal-markers` /
  `absolute-outside-root` / `escapes-root`) for path cases, or a K9-level reason
  for semantic / conflict-bailout cases.
- `note` — human rationale.
- `conflict` (conflict-bailout category only) — `{ has_conflict, expect_abort,
  expect_no_orig_rej, expect_host_unchanged }`.
