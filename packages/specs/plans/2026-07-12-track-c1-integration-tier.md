# Track C1 — establish `tests/integration/` as a CI-run tier + the first real-component seam test

**Status:** planned 2026-07-12. Closes **C1** of the external-readiness checklist
(`2026-07-10-external-readiness-checklist.md`): the structural e2e/integration gap. Split from C2 (the gated
real-`claude -p` dogfood) for reviewability — C1 is CI-safe + self-contained; C2 follows as its own PR.

## Context

The checklist's "0 integration" claim was decayed: `tests/integration/` exists but holds a single orphan
(`lint-gate-prepush.integration.sh`) that is run by NO CI job and NO gate (it downloads eslint@9 via npx, so it
stays manual). C1 makes the integration tier a REAL, CI-run thing: a CI job that runs the self-contained
`tests/integration/*.integration.js` tier (mirroring the existing per-file-node + vacuous-pass CI jobs), plus
the FIRST genuine cross-module integration test — the A3 export seam end-to-end (mint -> attest -> export ->
on-disk bank-ready pair), driving REAL stores + REAL files, no mocks. This is the phase-close 3c bar: a
cross-module boundary flow gets a real-component integration test.

## Routing Decision

`route-decide.js` → (to run at build). This is test-infrastructure + one integration test — NOT a
kernel/security/data-mutation diff, so the 3-lens (with hacker) tier is NOT required. A proportionate 2-lens
VERIFY (architect for the CI-job shape + the H.7.15 clean-env failure mode; code-reviewer for the test
correctness + the vacuous-pass/false-green guards) is the right ceremony. The load-bearing validation of a CI
job is CI ITSELF running it against a clean checkout (the H.7.15 dogfood discipline) — so the push IS the
final gate.

## HETS Spawn Plan

- **VERIFY (pre-build, on this plan)** — 2 read-only lenses in parallel: `architect` (the CI-job shape vs the
  existing jobs; the H.7.15 clean-env + false-green + vacuous-pass concerns; unit-vs-integration boundary) +
  `code-reviewer` (the integration test's real-component correctness; the LOOM_LAB_STATE_DIR module-load
  capture; the imperative-assert + `process.exit(1)` convention the CI node-loop depends on).
- **VALIDATE (post-build)** — `code-reviewer` on the built diff + **CI itself** (the new job must go green on a
  clean CI checkout — the real clean-env proof). No hacker lens (no security surface).

## Files To Modify

| File | Change | Risk |
|---|---|---|
| `.github/workflows/ci.yml` | **NEW** `integration-tests` job — per-file `node "$f"` loop over `find $GITHUB_WORKSPACE/tests/integration -name '*.integration.js'` + the `count -eq 0 -> exit 2` vacuous-pass guard + `working-directory: $GITHUB_WORKSPACE`, byte-for-byte mirroring `lab-tests`. | med (CI infra — H.7.15; validated by CI running it) |
| `tests/integration/world-anchor-export-seam.integration.js` | **NEW** the first real-component integration test: set LOOM_LAB_STATE_DIR to a tmp base BEFORE require; `recordAttestation` -> `mintWorldAnchoredNode` -> drive `cli.main(['export-bank-pair', ...])` to a real out-dir -> re-read node.json + meta.json from disk -> assert the node round-trips `verifyNodeBody` (Embers would re-derive + accept) + the meta is the exact 3-key bank shape. Imperative-assert + `process.exit(1)` on failure (the CI node-loop contract). | low |
| `tests/integration/README.md` | **NEW** the tier convention: `*.integration.js` = CI-run + self-contained (no network/LLM/npx); `*.integration.sh` = manual (may need external tools, e.g. the npx-eslint lint-gate). | low |

## Phases

1. Write the integration test (real components; imperative-assert). Run it locally green.
2. Add the CI job (mirror `lab-tests` exactly). Confirm the `find` root matches + count>0 locally.
3. README + the drift gates (yaml-lint / markdownlint / signpost — a new `.js` under tests/ is NOT a signpost target, confirm). PR -> CI runs the new job on a clean checkout (the H.7.15 proof).

## Verification Probes

- `node tests/integration/world-anchor-export-seam.integration.js` -> exit 0, prints `<file>: N passed` (the repo convention; a failed assert throws before the summary line, so exit-code is the real signal).
- The CI job's `find` matches ≥1 file locally: `find tests/integration -name '*.integration.js' -type f | wc -l` ≥ 1 (else the vacuous-pass guard would exit 2 — a correct fail, but confirm the tier is non-empty).
- yamllint the workflow; markdownlint the README + plan.
- The FINAL gate: the pushed branch's CI shows the new `integration-tests` job GREEN on a clean ubuntu checkout.

## Runtime Probes (verified against the worktree off origin/main, 2026-07-12)

| Claim | Probe | Result |
|---|---|---|
| The A3 export seam is present off origin/main (recon saw the stale W1 branch) | `test -f export-bank-pair.js` + grep runExportBankPair | PRESENT; `runExportBankPair` x3 refs in cli.js |
| CI jobs use per-file `node "$f"` (never `node --test`) + `count -eq 0 -> exit 2` | read ci.yml:251-336 (lab-tests, aux-unit) | confirmed — the exact block to mirror |
| No CI job runs `tests/integration/` today | grep `integration` .github/workflows | 0 matches (the C1 gap) |
| `recordAttestation` / `mintWorldAnchoredNode` / `runExportBankPair` signatures | recon (world-anchor-store.js:193, live-recall-store.js:182, cli.js) | `recordAttestation(att,{dir})`, `mintWorldAnchoredNode(block,{dir})`, `runExportBankPair(args)` w/ `--node-id/--persona-id/--human-root/--out-dir` |
| Both stores capture LOOM_LAB_STATE_DIR at module load | recon (world-anchor-store.js:54, live-recall-store.js:55) | confirmed — set the env BEFORE require |

## Out of Scope (Deferred)

- **C2** — the gated real-`claude -p` + sandbox e2e dogfood (promote `_spike/real-e2e-actor-dogfood.js`): its own PR. Introduces the opt-in/gated pattern (no `workflow_dispatch`/`schedule` precedent exists) + a clean exit-2 skip + the SHADOW-dry `provenance=backtest` preservation; the "real `gh`" PR-observation half is a NAMED residual (absent from the spike).
- Migrating the existing `lint-gate-prepush.integration.sh` into CI (it needs npx eslint — stays manual; C1 documents it as the `.sh` manual tier).
- Broadening the integration tier to other cross-module flows (accretes over time; C1 establishes the tier + the first test).

## Drift Notes

- recon-depth win: the checklist's "0 integration" was decayed — `tests/integration/` already existed (with an orphan). Grepped the tree before building; the real gap is "not CI-run", not "absent". (`drift:recon-depth`.)
- **plan-honesty miss (VERIFY-caught):** my first draft claimed the seed test is "BROADER … which no unit test does" — FALSE. `export-cli.test.js:82-91` already does mint->attest->export(`--out-dir`)->re-read->`verifyNodeBody`, and `:155-167` already drives `cli.main([...])` in-process. I asserted novelty without probing the existing test (the Runtime-Claim-Probe discipline, on a plan premise). The re-scope (below) fixes it to a GENUINELY-distinct test.
- unit-vs-integration boundary (corrected): the unit tier calls `cli.main([...])` IN-PROCESS (monkeypatched stdout) and re-verifies with the toolkit's OWN `verifyNodeBody` (circular — the producer uses the same fn). The integration test does two things the unit tier STRUCTURALLY cannot: (a) spawn the REAL CLI subprocess (`execFileSync('node', [cliPath, …])` — real shebang / `require.main` / `process.argv` / `process.exit` / stdout pipe), and (b) re-derive `node_id`+`content_hash` via an INDEPENDENT canonical-json path (mimicking Embers' by-parity copy) and assert byte-parity — a non-circular cross-repo-hop simulation.
- DRY debt (VERIFY F3): C1 adds the 5th copy of the per-file-node + vacuous-guard CI block. Mirror now (right for scope); a future shared-runner generalization of `run-pkg-unit.sh` (parameterized `(root, suffix)`) is a noted follow-up chip, NOT a C1 blocker.

## Pre-Approval Verification

2-lens VERIFY board (architect + code-reviewer, parallel, read-only). Verdicts: architect **NEEDS-REVISION**;
code-reviewer **SOUND-WITH-NOTES**. Both CONVERGED that the CI-tier infrastructure is SOUND but the seed test
as first drafted is a near-duplicate of `export-cli.test.js` (a plan-honesty miss — folded into Drift Notes).

**Re-scope the seed test (F1, both lenses) — do what the unit tier STRUCTURALLY cannot:**
- (a) Spawn the REAL CLI as a SUBPROCESS: `execFileSync('node', [cliPath, 'export-bank-pair', '--node-id', …,
  '--persona-id', …, '--human-root', …, '--out-dir', …], {env: {...process.env, LOOM_LAB_STATE_DIR: base}})`.
  Assert the real exit code (0) + parse the piped stdout JSON `{ok:true, out_dir, note}`. This exercises the
  shebang / `require.main === module` / real `process.argv` / real `process.exit` / a real stdout pipe — none
  reachable via the unit tier's in-process `cli.main([...])`.
- (b) Re-derive `node_id` + `content_hash` from the re-read node.json via an INDEPENDENT `sha256(canonicalJson(…))`
  path (NOT the toolkit's own `verifyNodeBody` — that is circular, the producer uses it too), asserting
  byte-parity with the emitted node's sealed values. This is the non-circular Embers-side re-derivation sim.
- Subprocess-spawn also MOOTS the stdout-noise concern (F4-cr): execFileSync captures the child's stdout.

**Folded findings:**
- **[HIGH, F1-cr] no swallowing try/catch** — the CI loop keys off `node "$f"` exit code; sync assert-throw ->
  uncaught -> non-zero exit is the repo convention (NOT an explicit `process.exit(1)`, and NEVER a try/catch that
  swallows). The test's own assertions use bare `assert.*`; only the subprocess result is inspected explicitly.
- **[MED, F2-arch] reserve C2's slot** — C1's `find … -name '*.integration.js'` runs unconditionally every push;
  a gated C2 e2e named `*.integration.js` would be SWEPT (and its exit-2 skip read as a failure). The README
  reserves `*.e2e.js` (or a `tests/e2e/` dir) = GATED, NOT matched by the integration-tests job. C2 slots in additively.
- **[MED, F3-cr] fixture precondition** — the minted node's `lesson_signature` MUST equal the attestation's
  (`cli.js` `lesson-signature-mismatch` fail-closed); the test sets them equal + comments why.
- **[LOW, F4-arch] clean-env** — resolve the repo root from `__dirname` (`tests/integration` is 2 levels down ->
  `path.join(__dirname, '..', '..')`), never cwd; set `LOOM_LAB_STATE_DIR` (a fresh mkdtemp) BEFORE any require.
- **[LOW/NIT, F5] anti-vacuity + probe wording** — the test prints `<file>: N passed` (the repo convention, not
  "N passed, 0 failed") only AFTER a non-zero count of asserts pass; the VALIDATE reviewer confirms it reaches its
  assertions (a single-member tier has no sibling to catch a zero-assert vacuous green).
- **[LOW, F3-arch] DRY debt** — mirror the `lab-tests` block now (right for scope); the shared-runner
  generalization is a noted follow-up, not a C1 change.

**SOUND (keep, do not rework):** the CI-job shape (mirror `lab-tests`), the `*.integration.js` glob, the
`count -eq 0 -> exit 2` vacuous-pass guard (count=1 start is safe; later-empty exit-2 is a correct fail), the
C1/C2 reviewability split.

## VALIDATE result

Single-lens VALIDATE (`code-reviewer`, Rule 2a live probes on the built diff — C1 is test-infra, lowest
stakes, so one archetype lens per Rule 2). Verdict: **SOUND** (0 CRITICAL/HIGH/MED). The real clean-env proof
is CI running the new job on a fresh ubuntu checkout (below).

**Live probes run (not just a green read):**
- **False-green resistance** — mutated an assertion's expected value -> uncaught throw, `exit=1`; forced a
  setup assertion to fail -> `exit=1`. The CI `node "$f"; rc=$?` loop catches both. Reverted.
- **Independent re-derivation is genuine + non-vacuous** — grep-confirmed `embersDeriveNodeId`/
  `embersDeriveContentHash` never call `deriveLiveNodeId`/`verifyNodeBody`/`computeContentHash` (share only the
  low-level `canonicalJsonSerialize`, exactly as Embers' by-parity copy does); planted a node.json with a
  mutated lesson_body -> both re-derivations correctly MISMATCH.
- **Subprocess env-threading is load-bearing** — ran the CLI subprocess WITH the threaded `LOOM_LAB_STATE_DIR`
  (`ok:true`) vs STRIPPED (`ok:false, node-unreadable`) -> proves the subprocess reads the isolated store, not
  passing green for the wrong reason. Confirmed the real `require.main === module` + `process.exit` entrypoint.
- **Clean-env** — `__dirname/../..` resolves to the repo root from `tests/integration/`; the CI job is
  byte-for-byte the `lab-tests` shape; the `count -eq 0 -> exit 2` vacuous guard fires on an empty dir.
- **No state pollution** — before/after diff of `~/.claude/lab-state` identical (nothing leaked).

**Folded (1 of 2 LOW):** reworded the anti-vacuity guard's comment — it does NOT guard a setup throw (that
already exits non-zero); it catches a FUTURE edit that silently drops a `check()` call. **Not folded (noted):**
the CI-loop DRY debt (5th copy) — a pre-existing mirrored convention, spun off as a follow-up chip (a
`workflow_call`/composite-action generalization once a 6th tier appears), not a C1 change.

**Post-fold green:** `world-anchor-export-seam.integration.js` 6 passed · CI `find` matches 1 file (non-vacuous)
· ci.yml parses · markdownlint 0 · ASCII-clean (.js) · eslint clean. FINAL gate = the new `integration-tests`
job green on the pushed branch's clean CI run.
