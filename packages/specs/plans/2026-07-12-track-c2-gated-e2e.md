# Track C2 — promote the real-`claude -p` spike into a GATED internal e2e + fire a real run

**Status:** planned 2026-07-12. Closes **C2** of the external-readiness checklist: the "validated end-to-end"
bar. The LAST external-readiness build before the 3-lens `/phase-close`. USER chose to also FIRE a real
`claude -p` run (env preflight-confirmed feasible: claude binary ✓, macOS+sandbox-exec ✓, python3+pytest ✓,
github+1.1.1.1 reachable unsandboxed ✓).

## Context

`packages/lab/issue-corpus/_spike/real-e2e-actor-dogfood.js` is a manual, out-of-CI spike: it feeds a BLIND
public problem statement to a real `claude -p` actor in a fresh clone, grades the actor's diff through the full
3-legged scorer (behavioral-in-sandbox + blind-semantic + reference), and populates the first REAL
worked-example recall node. Promoting it = making it a REAL, GATED, cleanly-skipping e2e at the reserved
`tests/e2e/*.e2e.js` slot (C1), with a correct exit contract + the SHADOW-dry invariant preserved, then firing
one real run to prove the promotion didn't break it (beta-internal-verification).

## Routing Decision

`route-decide.js` → **root** (0.037) — a refactor of proven code + a gate, not architect-shaped. A proportionate
2-lens VERIFY (architect for the gate/skip/exit-contract design + the SHADOW-dry preservation; code-reviewer for
the require-repathing + the tmpdir-mode fix + the doc-consistency completeness) is cheap insurance for the last
pre-phase-close build. NOT the 3-lens tier (no data-mutation/auth surface; the e2e is SHADOW/weight-inert).

## Files To Modify

| File | Change | Risk |
|---|---|---|
| `tests/e2e/real-e2e-actor-dogfood.e2e.js` | **NEW** the promoted gated e2e (logic from the `_spike` original). Requires resolved from `REPO = __dirname/../..`. + the gate + preflight-skip + exit contract + tmpdir fix + SHADOW comments (below). | med (real-actor path; SHADOW invariant) |
| `tests/e2e/fixtures/real-e2e/{test_patch,accepted_diff}.patch` | **COPIED** from `_spike/real-e2e/` (STEP A `real-e2e-dogfood.js` keeps its own copy — it still reads `_spike/real-e2e/`). | low |
| `tests/e2e/README.md` | **NEW** the gated tier: how to run (`RUN_E2E=1 node tests/e2e/*.e2e.js` on a macOS box w/ claude+network), the exit contract (2=skip · 0=ran+graded · 1=harness threw), the SHADOW-dry guarantee, the NAMED residuals (real-`gh` PR-observation; the true external merge). | low |
| `packages/lab/issue-corpus/_spike/real-e2e-actor-dogfood.js` | **DELETE** (promoted). | low |
| `docs/system-report/_sections/31-...md` + `38-...md` | repoint the consumer citation `issue-corpus/_spike/real-e2e-actor-dogfood.js` → `tests/e2e/real-e2e-actor-dogfood.e2e.js` (the doc-path CI gate scans `docs/`). | low |
| `docs/system-report/_sections/39-lab-issue-corpus-spikes.md` | remove the STEP-B catalog row + note it was PROMOTED to `tests/e2e/`. | low |
| `docs/phases/phase-external-readiness.md` | update the `_spike/... out of CI` framing (:53/:64) to reflect the gated promotion. | low |
| `tests/integration/README.md` | update the C1 reservation note (`promoted from _spike/...` → the new `tests/e2e/` path). | low |
| `packages/specs/plans/2026-07-10-external-readiness-checklist.md` | mark C2 ✅ DONE + PR link (at PR time). | low |
| `docs/SIGNPOST.md` | regenerated (`generate-signpost.js` picks up the moved `.js`). | low |

## The gate + skip + exit contract (the promotion's core)

- **Gate (opt-in):** `if (process.env.RUN_E2E !== '1') → SKIP exit 2` ("gated — set RUN_E2E=1 to run"). The
  file is `*.e2e.js` under `tests/e2e/`, OUTSIDE the C1 `integration-tests` find, so it is NEVER auto-run on a
  push; the env-gate is the second lock. NO CI job (it can only skip on a GitHub runner — no claude/macOS).
- **Preflight (exit 2 clean SKIP, mirroring the sibling `SKIP:` + `exit(2)` convention** — `actor-dogfood.js`,
  `containment-spike.js`, `dogfood.js`): claude binary absent → SKIP; non-darwin / no `sandbox-exec` → SKIP;
  network unreachable (a `git ls-remote` preflight w/ an `execFileSync` timeout) → SKIP. **This REPLACES the
  spike's current `exit(1)` aborts** (:56 `claude not found`, :59 `NO sandbox`) — an absent prerequisite is a
  clean SKIP (exit 2), not a FAILURE (exit 1).
- **Exit contract:** `2` = skipped (gated-off OR a prerequisite absent) · `0` = ran + graded (the actor's
  verdict is DATA, not a pass/fail gate — SHADOW) · `1` = the harness itself threw (the outer `.catch`).

## SHADOW-dry preservation (load-bearing invariant — must NOT regress)

- The recall node stays `provenance='backtest'` (baked into `populateRecallGraph`/`recall-graph.js`; it is IN
  the node_id content-address basis, so a backtest node can never collide with a live one) + written through
  `writeNode` (which REJECTS any non-`backtest` provenance — the OQ-7 firewall) + NO live consumer reads it.
  This is NOT `LIVE_SOURCES` (a separate world-anchor weight-gate subsystem). The promotion must NOT pass
  `{provenance:'live'}`, must keep `writeNode`, and must wire no retriever/weight consumer.
- **Fix the world-readable tmpdir (a MEDIUM from the system-report):** the spike writes the recall node to a
  FIXED `os.tmpdir()/loom-real-recall-graph` (world-readable). Replace with `fs.mkdtempSync(...)` (mode 0700,
  confirmed) so the produced node is not world-readable.

## Named residuals (honest, NOT faked — per the phase-close "true external-boundary e2e is a NAMED residual")

- **The real-`gh` half is ABSENT from the spike** (it touches only `git` clone + `claude -p`, never `gh`). The
  e2e stops at the recall node; the PR-observation / merge half is the operator's real-`gh` residual, named in
  the README, not stubbed.
- **The true external merge** (a maintainer merging the actor's PR) is the OQ-NS-6 hardener — unschedulable,
  never a test. Named, not faked.

## Phases

1. Move + repath the e2e (requires from REPO root); copy the fixtures; the gate + preflight-skip + exit contract + tmpdir fix + SHADOW comments.
2. `RUN_E2E` unset → exit 2 (skip); a synthetic non-darwin/no-claude probe → exit 2. Confirm the skip paths BEFORE the real run.
3. **FIRE the real run** (`RUN_E2E=1`, sandbox disabled for network) → observe the actor solve, the 3-leg grade, the SHADOW node written to a 0700 dir. Capture the verdict.
4. Doc updates (sections 31/38/39, phase doc, C1 README) + regen SIGNPOST + the drift gates (eslint/markdownlint/doc-path/signpost). VALIDATE + PR.

## Verification Probes

- `node tests/e2e/real-e2e-actor-dogfood.e2e.js` (RUN_E2E unset) → `SKIP` + exit 2.
- `RUN_E2E=1 node tests/e2e/real-e2e-actor-dogfood.e2e.js` on a non-darwin/no-claude synthetic → exit 2 (clean skip, not a throw).
- **The real run** (RUN_E2E=1, macOS, claude, network) → exit 0, a printed verdict, a SHADOW node written to a 0700 dir (`stat` the dir → `700`); assert `provenance=backtest`.
- `scripts/validate-doc-paths.js` green (no stale `_spike/real-e2e-actor-dogfood.js` citation); `generate-signpost.js --check` up to date; eslint + markdownlint clean.

## Runtime Probes (verified 2026-07-12)

| Claim | Probe | Result |
|---|---|---|
| The real run is feasible here | preflight: `command -v claude` / `uname` / `sandbox-exec` / `pytest` / curl github+1.1.1.1 | claude ✓ · Darwin+sandbox-exec ✓ · pytest 7.4.3 ✓ · github HTTP 200 + 1.1.1.1 reachable (UNSANDBOXED — my Bash sandbox blocks net; the real run needs sandbox disabled) |
| `mkdtempSync` creates 0700 | `node -e` stat probe | mode `700` ✓ (the tmpdir fix) |
| the sibling SKIP convention is `exit(2)` | grep `_spike/*.js` | `console.error('SKIP: …'); process.exit(2)` (actor-dogfood/containment/dogfood) ✓ |
| STEP A shares the fixtures | `real-e2e-dogfood.js:28,43-44` reads `_spike/real-e2e/` | confirmed → COPY the fixtures, don't move |
| the spike touches no `gh` | grep `gh` in the spike | absent (only `git` + `claude -p`) → the real-`gh` half is a named residual |
| exact-path citations that break on move | grep `_spike/real-e2e-actor-dogfood` in `docs/**` | sections 31/38 (consumer), 39 (catalog), phase doc, C1 README + SIGNPOST(auto) |

## Out of Scope (Deferred)

- A `workflow_dispatch` CI job for the e2e — it can only skip on a GitHub runner (no claude/macOS); the gate is
  the `RUN_E2E` env + the `*.e2e.js` slot + the operator invocation. (Notable as a future option, not built.)
- The real-`gh` PR-observation half + the true external merge — NAMED residuals (above), not this build.
- Promoting STEP A (`real-e2e-dogfood.js`, the deterministic control) — out of scope; the checklist names STEP B.

## Drift Notes

- recon-depth: the checklist said "0 integration/e2e" — C1 already showed the integration dir existed; here the
  spike's remembered gaps (sandbox-denies-TMPDIR, fenced-verdict JSON.parse) are CONFIRMED FIXED in the current
  tree (not re-introduced by the move).
- probe-the-premise: confirmed the real run is feasible HERE (not assumed) before committing to firing it —
  and that my Bash SANDBOX (not the environment) blocks network, so the real run runs with the sandbox disabled.

## Pre-Approval Verification

2-lens VERIFY board (architect + code-reviewer, parallel, read-only). Verdicts: architect **SOUND-WITH-NOTES**;
code-reviewer **NEEDS-REVISION**. Both converged on the gate/skip ordering + network-exit-code bugs; the
code-reviewer caught a factually-false plan claim (the doc-path gate). All folded into the revised design.

**Must-fix (folded):**
- **[HIGH, both] Gate ordering — the skip path can CRASH.** `record` + its two `fs.readFileSync` fixture reads
  run at MODULE TOP LEVEL (`:33-47`), BEFORE the async IIFE. So with `RUN_E2E` unset (or a mis-pathed fixture),
  `node …e2e.js` throws ENOENT at load — NOT the exit-2 skip. **Fix:** wrap ALL logic in `main()`; the gate +
  preflight are the FIRST statements; `record`/fixture-reads move INSIDE after the gate (mirroring
  `dogfood.js`/`actor-dogfood.js`, where `main()` wraps setup and the SKIP checks are first).
- **[HIGH, both] Network preflight exit code.** A `git ls-remote` preflight (an `execFileSync` w/ a Node
  `timeout` option — the RIGHT primitive, no OS `timeout` binary needed) THROWS on failure; unguarded it hits
  the outer `.catch` → exit 1, contradicting the "network-unreachable → skip 2" contract. **Fix:** its OWN
  try/catch, BEFORE the main try → `console.error('SKIP: network unreachable'); exit 2`.
- **[HIGH, architect] The sandbox exit-code SPLITS.** `backend.attest()` discriminates: `reason ===
  'no-sandbox-exec'` (non-darwin / binary absent) → SKIP exit 2; but `attested:false` with a
  containment-FAILED reason (sandbox PRESENT but containment broke on a capable host) → **FAIL exit 1** (a real
  regression, per the `actor-dogfood.js:54` precedent). My blanket ":59 → skip 2" was wrong. **Fix:** branch on
  `attest().reason`. (claude-absent `:56` → skip 2 IS correct.)
- **[CRITICAL plan-honesty, code-reviewer] The doc-path gate does NOT scan `docs/`.** `collectDocs()`
  (`validate-doc-paths.js`) scans ONLY `packages/skills/commands/*.md` + `library/*/SKILL.md` +
  `agent-team/{kb,patterns}/**` — NOT `docs/system-report`, the phase doc, or `tests/`. So the section-31/38/39,
  phase-doc, and C1-README updates are a MANUAL ACCURACY pass (docs-consistency 3b), NOT gate-enforced; Verification
  Probe #4 (doc-path-gate green ⇒ no stale citation) was FALSE-CONFIDENCE — struck. **Reframe:** do the doc
  updates for accuracy; don't cite the gate as enforcement. Historical `packages/specs/plans/**` citations are
  left as-is (git history is the record; not gated).
- **[MED, code-reviewer] SIGNPOST claim overstated.** `generate-signpost.js` scans ONLY `packages/`, so regen
  DROPS the stale `_spike/` entry (needed for `--check`) but NEVER indexes the new `tests/e2e/` file. **Reframe:**
  regen drops the stale ref (not "picks up the moved .js").

**Fold (MED/LOW):**
- **[MED, architect] Extract a pure `decideGate(...)`** → `{action:'skip'|'fail'|'run', code, reason}`, exported +
  unit-tested (all branches — this is where the skip/fail logic lives, deterministically testable without a real
  run). The heavy body (clone→actor→grade→populate) stays a move behind `if (action==='run')`. `main()` runs only
  under `require.main === module` so the unit test can require the file for `decideGate` without auto-running.
- **[MED, architect] Two sandboxes — disambiguate.** The real run disables the AGENT's network sandbox (for the
  clone/actor); the loom `sandbox-exec` CONTAINMENT (the behavioral leg) STAYS ON — do NOT set
  `LOOM_SANDBOX_BACKEND=none` (that runs stranger pytest uncontained; with the fixed exit-contract it now
  fail-1s). State this in the README + the real-run procedure.
- **[MED, architect] Clone cleanup on the error path** — the clone is `rmSync`'d only on the happy path; the
  outer `.catch` leaks a multi-MB checkout. try/finally cleanup mirroring `actor-dogfood.js`.
- **[MED, architect/cr] Ephemeral store dir** — write to a fresh `mkdtempSync` dir (NOT the `writeNode` DEFAULT,
  which is the real lab-state store → pollution); LOG the dir path (`out(...)`) so the 0700 probe is executable;
  assert `listNodes({dir:DEFAULT_DIR})` count unchanged after a run.
- **[MED, cr] DIR repoint** — `DIR = path.join(__dirname, 'fixtures', 'real-e2e')` (fixtures copied under
  `tests/e2e/fixtures/`).
- **[LOW, architect] tmpdir rationale reframed** — `writeNode` ALREADY chmods 0700; the real value of `mkdtemp`
  is eliminating the FIXED predictable path (pre-creation/symlink TOCTOU) + per-run isolation (not "world-readable").
- **[LOW/NIT] fixture COPY DRY** (note it), N=1 stochastic (tag the VALIDATE verdict "harness-liveness, not a
  capability claim"), the synthetic-skip probe mechanism (`PATH=/usr/bin:/bin node …` to hide claude).

**SOUND (keep):** the 7 require re-paths resolve under `REPO=__dirname/../..`; fixture COPY (STEP A keeps its own);
`tests/e2e/*.e2e.js` never swept by CI; no eslint `no-console`/`no-process-exit` rule; the SHADOW-dry chain
(provenance='backtest' in the node_id basis + `writeNode` non-backtest firewall) verified against the code.

### Revised Files To Modify (supersedes the table above)

| File | Change |
|---|---|
| `tests/e2e/real-e2e-actor-dogfood.e2e.js` | **NEW** promoted e2e: exported pure `decideGate(...)` + a `main()` (gate+preflight FIRST → `record`/fixtures INSIDE → clone in try/finally → actor → grade → SHADOW node to a LOGGED mkdtemp 0700 dir); `main()` under `require.main === module`. Requires from `REPO`. `DIR = __dirname/fixtures/real-e2e`. |
| `tests/e2e/fixtures/real-e2e/{test_patch,accepted_diff}.patch` | **COPIED** (STEP A keeps `_spike/real-e2e/`). |
| `tests/unit/e2e/real-e2e-gate.test.js` | **NEW** unit-test `decideGate` — every branch (gated-off→skip; claude-absent→skip; no-sandbox-exec→skip; unattested-but-present→FAIL; net-unreachable→skip; all-ok→run). Run by the aux-unit CI job. |
| `tests/e2e/README.md` | **NEW** gated tier: `RUN_E2E=1 node tests/e2e/*.e2e.js` on macOS+claude+network; the two-sandbox note; exit contract (2 skip · 0 ran+graded · 1 fail/harness-threw); SHADOW-dry; NAMED residuals (real-`gh`, the true merge). |
| `packages/lab/issue-corpus/_spike/real-e2e-actor-dogfood.js` | **DELETE.** |
| `docs/system-report/_sections/31,38,39` + `docs/phases/phase-external-readiness.md` + `tests/integration/README.md` | manual ACCURACY pass (repoint/annotate the promotion; NOT gate-enforced). |
| `packages/specs/plans/2026-07-10-external-readiness-checklist.md` | mark C2 ✅ (at PR time). |
| `docs/SIGNPOST.md` | regen DROPS the stale `_spike/` entry (does not index `tests/`). |

## VALIDATE result

**Build verified + the real run FIRED.**

**Skip/gate paths (deterministic, no real run):**
- `decideGate` unit test — **8/8** incl. the load-bearing sandbox SPLIT (present-but-unattested → FAIL exit 1,
  never a silent skip).
- `node …e2e.js` (RUN_E2E unset) → `SKIP` + **exit 2** (the Finding-1 fix: no ENOENT crash — `record`/fixtures
  now build INSIDE `main()` after the gate). eslint clean.

**The real run (RUN_E2E=1, agent net-sandbox disabled, loom `sandbox-exec` containment ON) — HONEST outcome:**
- **Exit 0; the harness ran END-TO-END**: clone → actor-launch → grade (fallback) → populate → SHADOW node
  step → a fresh **0700** mkdtemp store. The plumbing works.
- **The host-claude-guard FAIL-CLOSED the actor + judge launches** (`actor-launch-refused` /
  `judge-launch-refused`, `launchMode: deployed-unconfigured`). By env-elimination (no `LOOM_ACTOR_REQUIRE_UID_SEP`
  / `LOOM_JUDGE_REQUIRE_UID_SEP` set) the deployed-signal is the `/etc/loom/actor-anthropic.key` marker — this box
  carries the operator's ③.2 cross-uid arming groundwork. **Confirmed by elimination WITHOUT touching `/etc/loom`**
  (operator-only). So the actor refusal is the **security launch-gate working as designed**, not a harness bug.
- **The actual actor-solve did NOT run** — it is gated behind operator cross-uid arming (`LOOM_ACTOR_USER` +
  `LOOM_ACTOR_WRAPPER` + the judge flag). I did **not** bypass the gate (e.g. redirecting `LOOM_ACTOR_KEY_MARKER`
  to fake a clean box would circumvent a fail-closed security gate — forbidden). **NAMED RESIDUAL:** the
  end-to-end actor-solve requires operator arming on a deployed box (or a clean/un-deployed box for a direct run);
  the harness + the fail-closed gate are what this run proves. N=1, and a solve verdict would be a stochastic
  SHADOW datum anyway — never a capability claim.
- **SHADOW-dry held**: 0 nodes written (recall-ineligible — no candidate), the store dir is 0700, and the e2e
  writes only to the mkdtemp dir (the real `~/.claude/lab-state/recall-graph-backtest/` store is untouched).

**Net:** C2's deliverable — the promoted GATED e2e — is complete + verified (harness runs; the fail-closed launch
gate works; the skip/fail contract is unit-proven; SHADOW-dry preserved). The actor-solve success is an
operator-arming residual the security model correctly gates, surfaced honestly rather than bypassed.
