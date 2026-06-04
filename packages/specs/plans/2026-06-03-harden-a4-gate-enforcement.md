---
lifecycle: persistent
topic: a4-gate, ci-integrity, security-hardening
created: 2026-06-03
status: DRAFT — pre-existing bypass hardening (GH #228/#229/#230), insider-only
---

# Harden the A4-binding gate's enforcement against insider bypass

Closes the pre-existing (Wave-0, NOT #227-introduced) bypass surface surfaced by the
Wave-3 hacker VALIDATE. All require a committer who can place files in
`packages/kernel/algorithms/` (assume-breach insider); each is fail-closed for the
normal case. GH issues: #228 (CI grep), #229 (scan evasions), #230 (kb-resolver — separate, not in this PR).

## Runtime Probes (all CONFIRMED 2026-06-03, throwaway, cleaned up)

| Bypass | Probe | Result |
|---|---|---|
| #1a `\| tee` swallows exit code | `node -e "process.exit(1)" \| tee x; echo $?` | `0` — swallowed |
| #1b unanchored grep false-green | `touch "algorithms/x Total violations: 0 .js"`; run gate \| grep | real summary `Total violations: 1` but `grep -qE 'Total violations: 0'` **MATCHED** → CI green |
| #2 `.mjs` + subdir slip the scan | drop `evil.mjs` + `sub/evil.js`; run gate | exit 0, **0 unregistered findings** — both bypass |
| #3 export-name-only-in-comment | `auditAlgorithmLibrary` w/ injected src `{ // secretFn\n realFn }` | `export-missing flagged? false` — **false-pass** |
| install.sh `--test` exit honesty | read `install.sh:387-391` | returns 1 on failure, 0 on pass — `pipefail` will propagate |

## Fixes

### #1 — CI: gate on the exit code, anchor the grep (`.github/workflows/ci.yml`)
BOTH steps have the `| tee`-then-`grep` anti-pattern (smoke L46-48 + contracts L52-53).
Uniform fix, defense-in-depth: `set -o pipefail` **+** an anchored `^...$` grep.
**VALIDATE correction (hacker H-1):** GH Actions' default shell already runs `-eo pipefail`,
so the `| tee` exit-swallow was NOT exploitable in CI (only in a bare local shell) — the
validator/install exit code (`contracts-validate.js:1501` / `install.sh:391`) was always the
primary gate. So this fix is honest as **insurance** (explicit `pipefail` vs a future `shell:`
override that drops it) + **defense-in-depth** (the anchored grep hardens the otherwise-redundant
content check against substring-injection), NOT an exploitable-CI-vuln closure. Comments corrected.
- smoke: `grep -qE '^[[:space:]]*Results: [0-9]+ passed, 0 failed$'`
- contracts: `grep -qE '^Total violations: 0$'`

### #2 — Unregistered-scan: flag-unless-allowlisted (`checkUnregistered`)
Replace the `if (!name.endsWith('.js')) continue` skip (which silently allowed
`.mjs`/`.cjs`/subdir-names/non-`.js` symlinks) with: skip dotfiles + the
`{manifest.json, README.md}` allowlist + registered `.js`; **flag everything else**.
Closes .mjs/.cjs/subdir/non-.js-symlink (the task's stated vectors). Live repo stays green
(route-decide.js registered; manifest.json/README.md allowlisted; .DS_Store dotfile-skipped).
**VALIDATE upgrade (hacker H-2):** added an `lstatSync` TYPE check (deps gains `lstatSync`) — a
symlink (even `.js`-NAMED / even a registered name) and a subdirectory are now flagged BY TYPE,
which CLOSES the `.js`-named-symlink vector I'd originally deferred. Residual is now only the
symlink's **target escape** (where the link points) → ContainerAdapter fs-sandbox, out of scope.

### #3 — Static-export false-pass (`exportBlock` + `checkAlgorithmIntegrity`)
- `exportBlock`: strip `//` and `/* */` comments BEFORE the regex → a name only in a
  comment no longer counts as exported.
- `checkAlgorithmIntegrity`: **VALIDATE upgrade (hacker M-1):** instead of a `{`-only check,
  validate the block against a POSITIVE flat-identifier grammar (`^[\s,A-Za-z0-9_$]*$`) →
  `algorithm-export-nonflat`. This catches nested objects, `key: value`, AND string/template
  values (the bare comment-strip mishandled those) in one check; flat identifier lists pass.
- **Residual (honesty-auditor M-1):** the export check is a regex over the flat-export
  *convention*, not an AST parse. Non-object-literal export forms (`module.exports.x = …`,
  `Object.assign(module.exports, …)`) are **fail-closed** (declared names flag as missing) but
  not modeled — deferred. The gate's completeness depends on the README flat-export convention.

## TDD

Tests-first in `tests/unit/kernel/algorithms/kernel-algorithms-audit.test.js`:
- unregistered: a `.mjs` entry → flagged; a subdirectory name → flagged; (keep the existing
  "manifest.json/README.md/.DS_Store NOT flagged" green).
- export: name-only-in-a-comment → `algorithm-export-missing`; nested literal →
  `algorithm-export-nested`.
- (ci.yml is not unit-tested; verified by the probes + a post-fix re-probe in VALIDATE.)

## Verify / Validate

No pre-build architect VERIFY — the design is given by the task + confirmed by probes; the
risk is implementation completeness, caught by the post-build adversarial re-probe.

**VALIDATE DONE (2026-06-03) — full 3-lens** (read-only: hacker + code-reviewer + honesty-auditor,
per the kernel/security rule). All 3 bypasses re-probed CLOSED. Findings folded: H-1 (CI
mental-model corrected — pipefail redundant-under-GHA-default, framed as insurance+defense), H-2
(lstat TYPE check added → `.js`-symlink closed), M-1 (positive flat-grammar → `algorithm-export-nonflat`,
catches string/template too), +`.cjs`/symlink/template/nonflat + an M-1-regression test. Honesty
residual (export-form convention-dependence) disclosed above. Verdicts post-fold: hacker no-CRITICAL,
code-reviewer warn(.cjs-test)→added, honesty MINOR-OVERCLAIMS→addressed.

## Done when
- All 3 probes re-run → bypass CLOSED.
- `kernel-algorithms-audit.test.js` green (+ new cases); A4 gate 0 violations (live repo);
  full kernel suite; `bash install.sh --hooks --test` green.
- PR for the USER merge gate. Do NOT auto-merge. Edit source only.
