---
lifecycle: persistent
---

# CI shared per-file test-suite runner (dedup) — 2026-07-12

## Context

The null-delimited per-file `node "$f"` loop + `count -eq 0` vacuous-pass guard is now
copy-pasted **verbatim across 6 call sites**: 5 `.github/workflows/ci.yml` jobs
(kernel-property-tests, runtime-contracts-tests, lab-tests, aux-unit-tests, and the
integration-tests job that landed on `main` via #571) plus `tests/run-pkg-unit.sh`.
Both the Track-C1 VERIFY (architect F3) and VALIDATE (code-reviewer) flagged this as
real DRY/maintainability debt, deferred as out-of-scope at the time. This change
extracts the loop into one owned abstraction — `tests/run-suite.sh` — parameterized by
`(find-root, name-glob, excludes)`, and rewires all 6 call sites to it. **Pure infra
dedup: no test behavior changes** (same file set matched, same exit codes, same
never-`node --test` discipline). The key gate is the H.7.15 clean-CI-checkout dogfood.

## Routing Decision

Verbatim `route-decide.js` output (task string embedded the full scope):

```json
{
  "recommendation": "root",
  "confidence": 0.4,
  "score_total": 0,
  "low_signal": true,
  "uncertain": true,
  "substrate_meta_detected": true,
  "substrate_meta_tokens": ["test-runner"],
  "weights_version": "v1.3-dict-expanded-2026-06-12",
  "thresholds": { "route": 0.6, "root": 0.3 },
  "reasoning": "Score 0.000 -> root."
}
```

`[ROUTE-META-UNCERTAIN]` fired (substrate token `test-runner`). Judgment per the
H.7.16 rule: this is **mechanical implementation of an already-decided design** (a
pure infra dedup with a known target shape), so `root` is correct — no full HETS team.
The task nonetheless mandates the per-wave VERIFY/VALIDATE review pass, which is the
right rigor for H.7.15-class CI infra (runs only at CI time; a regression is invisible
until a fresh checkout). One architect (VERIFY) + one code-reviewer (VALIDATE).

## HETS Spawn Plan

N/A — single-perspective sufficient per `root`. VERIFY = 1 architect lens on this plan;
VALIDATE = 1 code-reviewer lens on the built diff. (Not the 3-lens kernel/security tier
— this touches no kernel/auth/data-mutation path; it is CI plumbing.)

## The 6 copies (parameter surface)

| # | Call site | find-root | glob | excludes | invocation |
|---|---|---|---|---|---|
| 1 | ci.yml `kernel-property-tests` | `$GITHUB_WORKSPACE/tests/unit/kernel` | `*.test.js` | — | job `run:` |
| 2 | ci.yml `runtime-contracts-tests` | `$GITHUB_WORKSPACE/tests/unit/runtime` | `*.test.js` | — | job `run:` |
| 3 | ci.yml `lab-tests` | `$GITHUB_WORKSPACE/tests/unit/lab` | `*.test.js` | — | job `run:` |
| 4 | ci.yml `aux-unit-tests` | `$GITHUB_WORKSPACE/tests/unit` | `*.test.js` | `*/tests/unit/{kernel,runtime,lab}/*` | job `run:` |
| 5 | ci.yml `integration-tests` | `$GITHUB_WORKSPACE/tests/integration` | `*.integration.js` | — | job `run:` |
| 6 | `tests/run-pkg-unit.sh` | `$repo_root/tests/unit/$pkg` | `*.test.js` | — | pnpm `-r test` |

The loop body (set-no-`-e` + `while IFS= read -r -d ''` + `node "$f"; rc=$?` +
`::group::` + `failed` accumulator + `count -eq 0 -> exit 2` guard + `exit $failed`) is
**byte-identical** across copies 1-5; copy 6 is functionally identical
(`node "$f" || failed=1` vs `rc=$?`, plus arg-parse + dir-check + repo-root resolution).

## Design — `tests/run-suite.sh`

One owned abstraction. Direct-call from every site (**no composite action** — see Out of
Scope for why a second wrapper abstraction is rejected). Interface:

```
run-suite.sh --root <dir> [--glob <pattern>] [--exclude <path-glob>]... [--label <text>]
```

- `--root` (required): absolute find root.
- `--glob` (default `*.test.js`): `-name` pattern. Integration passes `*.integration.js`.
- `--exclude` (repeatable, 0+): each appends a `-not -path <glob>` predicate, **in order**,
  preserving the exact aux predicate sequence. Empty-array-safe under `set -u` (guarded by
  a `${#excludes[@]} -gt 0` count check — bash 3.2 macOS-safe for local pnpm runs).
- `--label` (default `$root`): human string for the "Ran N file(s) under <label>" echo +
  vacuous-guard error. Cosmetic only.

Body preserves the CI copies exactly: `set -uo pipefail` (no `-e`, so a failing `node`
does not abort the loop — same net effect as the CI jobs' `set +e`), null-delimited
`find ... -print0` + `read -r -d ''`, `node "$f"; rc=$?`, `::group::`/`::endgroup::`,
`failed=1` on any non-zero, `count -eq 0 -> exit 2` vacuous-pass guard, `exit "$failed"`.
Never `node --test` (the CI comment ~ci.yml:144 documents that node:test false-greens on
imperative-assert files). find predicate order is `<root> -name <glob> -type f [-not -path
<e>]... -print0` — identical to every existing copy, and `-name/-type/-not` AND regardless
of order, so the matched set is invariant by construction.

`tests/run-pkg-unit.sh` becomes a thin wrapper: keep its `<pkg>` arg-parse + `$test_dir`
existence check + repo-root resolution (its public contract — 3 package.json `test`
scripts call it), then `exec bash "$script_dir/run-suite.sh" --root "$test_dir" --label
"tests/unit/$pkg"`. So local `pnpm -r test` and CI share the SAME loop file — the single
source of truth the current header comment only aspires to.

## Files To Modify

| Path | Action | Risk | Notes |
|---|---|---|---|
| `tests/run-suite.sh` | **create** | medium | the one owned abstraction; ~55 LoC bash; shellcheck-clean (Test 81 lints `*.sh`) |
| `.github/workflows/ci.yml` | modify | medium | 5 jobs: replace each ~20-line loop with a 1-line `bash tests/run-suite.sh …`; job names / checkout / setup-node UNCHANGED (no check-name churn) |
| `tests/run-pkg-unit.sh` | modify | low | delegate the loop to run-suite.sh; preserve arg/dir-check contract |
| `packages/specs/plans/2026-07-12-ci-shared-suite-runner.md` | create | none | this plan |

Load-bearing: `ci.yml` (CI-time-only; H.7.15 clean-checkout dogfood mandatory) and
`run-pkg-unit.sh` (3 package.json consumers — the `<pkg>` interface must not break).

## Phases

#### Phase 1 — build the abstraction
1. **Create `tests/run-suite.sh`** (~55 LoC). Probe: `bash -n tests/run-suite.sh` (parse
   OK) + `shellcheck tests/run-suite.sh` (0 findings) + `chmod +x`.

#### Phase 2 — rewire call sites
2. **Rewrite `tests/run-pkg-unit.sh`** to delegate. Probe: `bash tests/run-pkg-unit.sh
   kernel` green; `bash tests/run-pkg-unit.sh nonexistent` exits 2; missing-arg exits 2.
3. **Rewrite the 5 ci.yml jobs** to one-line `run:` each. Probe: `python3 -c yaml.safe_load`
   parses ci.yml; job names + `count`/glob/excludes unchanged per the table above.

#### Phase 3 — behavior-equivalence dogfood (H.7.15)
4. **File-set invariance**: for each of the 5 tuples, `diff` the sorted file list from the
   ORIGINAL inlined `find` (captured from `git show origin/main:.github/workflows/ci.yml`)
   vs run-suite.sh's find. Must be identical.
5. **Green/red parity**: run-suite.sh green on each real root; vacuous-pass path (`--root`
   at an empty/absent dir) exits 2; a planted failing test file makes it exit 1.
6. **Clean-checkout dogfood**: the worktree is a fresh `origin/main` checkout; the CI test
   jobs have NO install step, so these files run via bare `node` with zero node_modules —
   the worktree run mirrors CI exactly. Then **push the branch and confirm all 5 test jobs
   (+ smoke/markdown/json) go green on real CI** — the gold-standard H.7.15 signal.

## Verification Probes

| Probe | Pass criterion |
|---|---|
| 1 | `bash -n tests/run-suite.sh && shellcheck tests/run-suite.sh` → parse OK, 0 findings |
| 2 | `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` → parses |
| 3 | file-set `diff` (orig find vs run-suite find) → empty for all 5 roots |
| 4 | `bash tests/run-pkg-unit.sh kernel` → green; `… nonexistent` → exit 2; no-arg → exit 2 |
| 5 | run-suite.sh vacuous path → exit 2; planted-failing-file → exit 1; real roots → exit 0 |
| 6 | `bash install.sh --hooks --test` → all green (Test 81 shellcheck incl. run-suite.sh) |
| 7 | pushed-branch CI: all 5 per-file test jobs green on a clean runner checkout |

## Out of Scope (Deferred)

- **Composite GitHub Action / `workflow_call` reusable job** — considered and **rejected**.
  The loop LOGIC must live in `tests/run-suite.sh` because local `pnpm -r test`
  (run-pkg-unit.sh) must call the same file; a composite action's embedded bash is
  unreachable from pnpm. A composite action on top would be a *second* abstraction that
  merely wraps run-suite.sh (deduping only the per-job `setup-node` + the one-line `run:`),
  trading one abstraction for two + list-passing awkwardness for aux's excludes. That
  violates "one owned abstraction" (KISS/YAGNI). The remaining per-job lines (checkout +
  setup-node + a 1-line run) are irreducible GH-Actions scaffolding, not the duplicated
  block the task targets.
- `tests/smoke-h7.sh` — uses `read -r -d ''` but is a hand-written per-hook smoke sequence,
  NOT this loop abstraction. Not a 7th copy; left untouched.
- No change to which files run, test discovery semantics, or exit-code contract.

## Drift Notes

- **Premise decay caught at recon**: the task stated "6 copies … including integration-tests
  added in PR #571", but #571 was OPEN (not merged) at task start — `main` had only 5 copies.
  Surfaced to the user; #571 was merged first, then this dedup based on fresh `origin/main`
  (now 6 copies). Probe-the-premise (a plan claim about repo state is stale until re-probed).
- **route-decide `root` + `[ROUTE-META-UNCERTAIN]`**: substrate token `test-runner` detected;
  score 0. Honored `root` per H.7.16 (mechanical impl of a decided design) while still
  running VERIFY/VALIDATE per the task's explicit per-wave mandate.
- The unified "Ran N file(s) under <label>" echo differs cosmetically from the 5 per-job
  messages ("Ran N test files" / "Ran N integration files"). No downstream grep depends on
  these strings (the anchored greps are in the smoke + contracts jobs, not the per-file
  jobs), so this is log-cosmetic, not behavior.

## VERIFY + VALIDATE result

Two read-only lenses reviewed the built diff (CI plumbing — no kernel/security/auth path,
so 1 architect + 1 code-reviewer, not the 3-lens tier).

- **VERIFY (architect): SOUND-WITH-NITS.** Confirmed file-set invariance by construction vs
  the origin/main originals; `exit "$failed"` ≡ `exit $failed`; vacuous→2 matches all 5 CI
  copies AND run-pkg-unit.sh; `set -u` empty-array guard is bash-3.2-safe; find predicate
  order + aux's 3 in-order excludes preserved; `>-` folded YAML quotes survive to the shell;
  composite-action rejection "defensible and right" (loop must be pnpm-reachable). Also
  weighed a `matrix:` alternative and agreed keeping 5 discrete stable-named jobs is better
  for this repo.
- **VALIDATE (code-reviewer): LGTM** (0 CRITICAL/HIGH/MEDIUM). Independently re-derived the
  dogfood, verified `set -e` is NOT inherited across the `bash script.sh` boundary (so the
  originals' `set +e` is correctly unnecessary), verified bash-3.2 empty-array live against
  3.2.57, byte-diffed the aux 3-exclude find (identical), confirmed the integration glob
  correctly excludes the sibling `lint-gate-prepush.integration.sh`, and confirmed `exec`
  propagates the child exit code verbatim.
- **Shared LOW nit (both lenses), FIXED**: the arg-parser silently no-op'd a missing flag
  value (a valueless `--exclude` appended an empty match-nothing predicate; a flag-followed-
  by-flag misattributed). Not a regression (no caller hits it; it failed closed with exit 2),
  but a footgun on the new shared surface. Hardened to fail LOUD: each flag now requires a
  value (missing / `--`-prefixed → clear `::error::` + exit 2). Re-proved: full dogfood green
  + 3 new missing-value edge cases → exit 2, valid usage → exit 0.

## VALIDATE dogfood evidence (H.7.15)

Run in the fresh `origin/main` worktree (no `node_modules` — identical to a clean CI runner;
CI test jobs have no install step):

- **File-set equivalence** (real run-suite find+loop, `node` stubbed to no-op, processed set
  diffed vs each original inlined `find`): kernel 125 / runtime 30 / lab 159 / aux 49 /
  integration 1 — all IDENTICAL. Partition check: kernel+runtime+lab+aux == all 363
  `tests/unit` `*.test.js`, aux disjoint from the three (no double-run, no gap).
- **Exit-code mechanics** (dummy files): vacuous→2, missing-root→2, unknown-arg→2,
  missing-flag-value→2, 2-pass→0, pass+fail→1 (both grouped; loop continues past failure),
  `--glob` selectivity, `--exclude` drop. **Delegation**: run-pkg-unit.sh no-arg→2,
  nonexistent-pkg→2, real delegate→0 with correct label.
- **Static**: `bash -n` OK; `shellcheck` clean (default severity) on both scripts; YAML
  `yaml.safe_load` parses; local bash is 3.2.57 (the macOS-compat test ran for real).
- **Residual (the gold-standard H.7.15 signal)**: pushed-branch CI green on all 5 per-file
  test jobs on a clean runner checkout — confirmed post-push (see PR).
