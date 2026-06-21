---
lifecycle: persistent
---

# Ghost Heartbeat W2-PR-C — bake the absolute judge binary into the scheduled task

> Closes go-live precondition (e), surfaced by the REAL launchd dogfood (2026-06-20 16:08):
> the scheduled drain runner fired, scanned 533 / audited 20, but emitted **zero** because the
> producer resolves `claude` via PATH and launchd runs the job with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`
> -- which excludes `~/.local/bin/claude`. Every judge call returned `spawn-error:ENOENT`.
> PR-3b baked the absolute **node** path for exactly this minimal-PATH reason but left the
> **claude** binary PATH-resolved. This bakes the absolute judge bin too (the symmetric fix).

## Runtime Probes (verified against the actual system this session)

| Claim | Probe | Result |
|---|---|---|
| The scheduled job fired but emitted nothing | `cat ~/.claude/checkpoints/ghost-heartbeat.log` + `ls .../ghost-heartbeat-state.json` | CONFIRMED — run.log shows `{"ok":true,"audited":[20 paths],"scanned":533}`; emitted-set file ABSENT (zero emit). |
| The failure is the JUDGE, not the digest | run-state `audited`: 20 entries, all with captured `sessionIds`, 0 `captureFailures` | CONFIRMED — digest succeeded on all 20; the judge is where it died. |
| The judge resolves `claude` via PATH | Read `capability-free-claude.js:36-44` (`resolveClaude`: `command -v claude` -> fallback `'claude'`) | CONFIRMED — PATH-dependent, with a `bin` arg override + it already reads `GHOST_HEARTBEAT_JUDGE_MODEL`. |
| launchd runs the job with a minimal PATH | `launchctl print gui/$(id -u)/com.powerloom.ghost-heartbeat` | CONFIRMED — `default environment` `PATH => /usr/bin:/bin:/usr/sbin:/sbin`. |
| `claude` is NOT on that PATH | `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin command -v claude` | CONFIRMED — `<NOT FOUND>` (claude is at `~/.local/bin/claude`). |
| The judge returns ENOENT under that PATH | `env -i PATH=... node -e 'runCapabilityFreeJudge(...)'` | CONFIRMED — `{"ok":false,"reason":"spawn-error:ENOENT"}`. |
| **The absolute claude path RUNS under the minimal PATH** (so baking the abs bin is SUFFICIENT, no node/PATH bake needed) | `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin $(command -v claude) --version` | CONFIRMED — `2.1.177 (Claude Code)`, exit 0. `claude` is a self-contained **Mach-O** executable (symlink -> versioned binary), NOT a node-shebang wrapper -> no `env node` dependency. |
| The plist bakes `GHOST_HEARTBEAT_EMIT=1` in `EnvironmentVariables` | Read `ghost-heartbeat-schedule.js:124-128` | CONFIRMED — the symmetric slot to add `GHOST_HEARTBEAT_JUDGE_BIN`. |
| The cron block bakes env inline | Read `ghost-heartbeat-schedule.js:152` (`GHOST_HEARTBEAT_EMIT=1 <node> <runner>`) | CONFIRMED — add `GHOST_HEARTBEAT_JUDGE_BIN='<abs>'` before the node arg. |

## The fix (two coordinated changes + one effect)

### 1. `capability-free-claude.js` -- `resolveClaude` reads `GHOST_HEARTBEAT_JUDGE_BIN`

Precedence (explicit-arg > env > PATH > bare), symmetric with the existing
`GHOST_HEARTBEAT_JUDGE_MODEL` model override:

```
function resolveClaude(bin) {
  if (bin) return bin;
  const envBin = (process.env.GHOST_HEARTBEAT_JUDGE_BIN || '').trim();
  if (envBin) return envBin;
  // ... existing `command -v claude` -> 'claude' fallback ...
}
```

`spawnSync(claudeBin, args, { shell: false })` -- `shell:false` means the bin is an exec target,
never a shell string, so no injection. The bin is the USER's own env (the drift threat model is
attacker-influenceable TRANSCRIPT content, NOT the operator's env); the existing `bin` param
already permits an arbitrary exec target (tests use `/bin/echo`), so this is consistent.

### 2. `ghost-heartbeat-schedule.js` -- bake the absolute judge bin into the artifact

- **New effect** `defaultEffects.resolveJudgeBin()`: `command -v claude` in the INSTALLING shell
  (where claude IS on PATH), trimmed; `''` if not found. Injectable for tests; read-only (no
  mutation) so it is safe in dry-run -- the dry-run artifact SHOWS the baked bin for `--diff`.
- **`buildLaunchdPlist` / `buildCronBlock`** take an optional `judgeBin`; when non-empty they
  `assertSafeArg('judgeBin', judgeBin)` (the SAME control-char + `%` reject as nodeBin) and emit:
  - plist: a second `EnvironmentVariables` entry `GHOST_HEARTBEAT_JUDGE_BIN` (xml-escaped).
  - cron: `GHOST_HEARTBEAT_JUDGE_BIN=<shellSingleQuote(judgeBin)>` before the node arg.
  An empty/undefined `judgeBin` emits NOTHING (back-compat: the existing artifact shape).
- **`install()`** resolves `judgeBin` (from `opts.judgeBin` or the effect); if non-empty AND
  unsafe (`assertSafeArg` throws), it SKIPS baking (logs `judge-bin-unsafe`, falls back to the
  PATH `claude`) rather than failing the whole install -- the bake is an enhancement, not
  load-bearing. The builder still asserts (strict for direct callers); install pre-sanitizes to
  `''` so the builder never sees an unsafe value.

### 3. Empty-resolution behaviour (no regression)

If `command -v claude` is empty at schedule time (claude not on the installing shell's PATH),
NOTHING is baked -> the runner falls back to PATH `claude` -> the same (failing) behaviour as
today, never worse. (Won't happen when the user schedules from inside Claude Code, where claude
is on PATH; the dogfood that surfaced this had claude on the interactive PATH.)

## Test plan (TDD)

- **capability-free** (`capability-free-judge-bin.test.js`, mirrors the model-override test):
  `GHOST_HEARTBEAT_JUDGE_BIN=/bin/echo` -> the spawn uses `/bin/echo` (observe the flags echoed to
  stdout); explicit `bin` arg WINS over the env; env WINS over the PATH fallback.
- **schedule** (extend `ghost-heartbeat-schedule.test.js`):
  - `buildLaunchdPlist({ judgeBin })` -> plist has the `GHOST_HEARTBEAT_JUDGE_BIN` entry; without
    it -> no such key (back-compat).
  - `buildCronBlock({ judgeBin })` -> cron has `GHOST_HEARTBEAT_JUDGE_BIN='<abs>'`.
  - an UNSAFE judgeBin (control char / `%`) -> the builder THROWS; `install` with an unsafe
    resolved bin -> SKIPS baking + still `ok:true` (no install failure).
  - `install` (dry-run) with an injected `resolveJudgeBin` -> the artifact bakes the abs path;
    with `resolveJudgeBin -> ''` -> no JUDGE_BIN key (no regression).
  - xml-escape / single-quote on a path with `&` / a space.
- **VALIDATE live probe (Rule 2a):** `runCapabilityFreeJudge({ bin: <abs claude> })` under
  `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin` returns NOT `spawn-error:ENOENT` (the real failing
  path now works) -- one real judge call.

## Out of scope

- Baking a broader `PATH` (the probe proved the abs claude bin is self-contained -> unnecessary).
- The realtime Stop-hook carrier path (it runs from the plugin cache, gated on `claude plugin
  update` / precondition (b) -- separate).
- Turning the heartbeat on (still default-OFF; the armed schedule stays the user's call).

## VERIFY board (pre-build)

Kernel + a spawn-target + executing-artifact generation -> 3-lens (architect + code-reviewer +
hacker). Hacker focus: can a crafted resolved `claude` path break out of the plist XML / cron
shell-quoting, or turn `GHOST_HEARTBEAT_JUDGE_BIN` into an exec/injection lever?

## Pre-Approval Verification

3-lens VERIFY (architect CLOSEABLE-WITH-NOTES, code-reviewer NEEDS-REVISION, hacker NEEDS-REVISION).
It caught TWO real security regressions + a dark-fix wiring gap. All folded before build:

| # | Lens | Sev | Finding | Disposition |
|---|---|---|---|---|
| 1 | arch | HIGH | The fix ships DARK: `install.sh` runs `node <mod> install` with NO opts, so a `o.judgeBin \|\| ''` wiring never fires the effect -> empty bake | **FIX**: `install()` calls `c.effects.resolveJudgeBin()` as the DEFAULT when `opts.judgeBin` is undefined, INSIDE the build try, AFTER the runner-absent guard. PROBE `node <mod> install --dry-run` shows the entry before build. |
| 2 | CR | HIGH | `stubEffects()` lacks `resolveJudgeBin` -> 8 existing install tests TypeError | **FIX**: add `resolveJudgeBin: () => ''` to `stubEffects()` first. |
| 3 | hack | HIGH | The new env-precedence DEFEATS the G3 sentinel-leak guard: a leaked `GHOST_HEARTBEAT_JUDGE_BIN` makes G3's no-bin call spawn the env bin -> vacuous pass | **FIX**: (a) the new judge-bin test uses save/restore/finally-delete; (b) HARDEN G3 — delete `GHOST_HEARTBEAT_JUDGE_BIN` from the env + assert unset before the no-bin spawn (fail loud, never vacuous). |
| 4 | hack | MED(->treat HIGH) | Schedule-time `command -v claude` bakes PATH[0] into a persisted EMIT=1 launchd/cron artifact -> moves resolution from run-time (sanitized minimal PATH) to install-time (poisonable PATH) + persists it = a reboot-surviving exec foothold | **FIX**: `resolveJudgeBin` VETS the path via `vetJudgeBinPath` — absolute + `statSync`-resolves-to-a-regular-file + the bin's dir is NOT world-writable (`mode & 0o002`); else `''`. Residual (attacker already owns your PATH/profile = pre-existing code-exec) documented. |
| 5 | CR | MED | `resolveJudgeBin` must NOT copy resolveClaude's bare-`'claude'` fallback (would bake `JUDGE_BIN=claude`, worse than nothing) | **FIX**: return `''` on miss, explicit. |
| 6 | CR | MED | Unspecified WHERE in `install()` the effect runs (runner-absent test asserts `eff.calls` empty) | **FIX**: inside the build try, after the runner-absent guard (folded into #1). |
| 7 | arch+hack | LOW+MED | Empty/unsafe-skip returns `{ok:true}` silently -> install.sh greps `"ok":true` -> green while the heartbeat is permanently inert (the exact silent-zero this PR fixes) | **FIX**: `install()` returns `judgeBinBaked:<bool>`; `install.sh` prints an advisory NOTE when `false`. |
| 8 | arch | MED | Cron path is symmetry-inferred (the dogfood + every probe row is launchd) | **FIX**: cron row marked symmetry-inferred below; a builder test asserts `JUDGE_BIN='...'` placement (after the schedule fields + EMIT, before node). |
| 9 | arch | MED | The dry-run smoke test (T126) doesn't assert JUDGE_BIN -> a silently-empty bake passes ALL tests | **FIX**: a `command -v claude`-gated smoke assertion that the REAL dry-run bakes JUDGE_BIN (self-skip when claude absent, like G3). |
| 10 | arch+CR | LOW | The `--version` probe + the bin-arg-only VALIDATE don't prove a REAL judge run nor the ENV path | **FIX** (VALIDATE): a real `ok:true` judge call under `env -i PATH=minimal` via BOTH the bin-arg AND the `GHOST_HEARTBEAT_JUDGE_BIN` env path. |
| 11 | arch | LOW | `resolveJudgeBin` should bake only an ABSOLUTE path (alias/multi-line/relative -> `''`) | **FIX**: folded into `vetJudgeBinPath` (#4). |
| 12 | CR+arch | NIT | env tests need save/restore; `/bin/echo`-as-bin can't echo its own path -> observe via `ok:true` vs a bogus-bin `spawn-error` | **FIX**: withEnv save/restore; assert `ok:true` + the echoed flags for the env bin, `spawn-error` for a bogus bin. |
| - | hack | LOW | The injection chain (shellSingleQuote / xmlEscape / assertSafeArg `%`+ctrl) is SOUND for judgeBin (18 live probes held) — same guards as nodeBin | **NOTE** (no change): keep the guards symmetric; the unguarded env-override path is safe ONLY because `shell:false` makes the bin a non-injection exec target (comment it). |

**Design deltas (supersede the sketch where they differ):**
- `defaultEffects.resolveJudgeBin()` = `command -v claude` (first line, must start `/`) -> `vetJudgeBinPath()` -> a vetted absolute path OR `''` (never bare `claude`).
- exported pure-ish `vetJudgeBinPath(p, { statSync })`: absolute + safe (`assertSafeArg`) + `statSync(p).isFile()` (follows the claude symlink to its real binary) + `dirname(p)` not world-writable -> `p`, else `''`. (Bakes the `command -v` SYMLINK path, which survives claude updates, not the version-pinned realpath.)
- `install()` returns `{ ok, ..., judgeBinBaked }`; on darwin/linux the bake is conditional on a non-empty vetted bin.
- `_resolve` passes `judgeBin: o.judgeBin` (undefined unless a test overrides); `install()` defaults it via the effect inside the build try.
- **cron row honesty**: the cron inline-env (`VAR='val' cmd`) is POSIX-correct + symmetry-inferred from the launchd dogfood; launchd is the empirically-confirmed surface. A builder test locks cron placement.

## VALIDATE result

Post-build 3-lens board (code-reviewer + hacker live-probe + honesty-auditor): **all three
CLOSEABLE-WITH-NOTES**, honesty Grade A. All 12 VERIFY dispositions confirmed in the built code;
the injection chain + the G3 hardening + shell:false held under live probes; back-compat intact.

**Live-probe results (pinned):**
- Dark-fix guard: `node ghost-heartbeat-schedule.js install --dry-run` -> BAKES
  `GHOST_HEARTBEAT_JUDGE_BIN=/Users/.../.local/bin/claude` (not dark).
- `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin <abs claude> --version` -> `2.1.177`, exit 0 (the
  abs bin runs under the minimal PATH).
- `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin <abs claude>` judge call -> failure CHANGED from
  `spawn-error:ENOENT` (pre-fix) to `exit-1` (binary found + executed) -> the PATH/ENOENT
  dimension is CLOSED.
- The `exit-1` is `claude -p ... -> 401 Invalid authentication credentials`, and it REPRODUCES in
  the FULL-PATH shell (`node -e runCapabilityFreeJudge(...)` -> `exit-1`; `<abs claude> -p ... ->
  401`) -> an ENVIRONMENT-level headless-auth issue, INDEPENDENT of PATH and of PR-C (the same
  inconclusive class G3 skips on). **PR-C scope: PATH/ENOENT only; the auth gate is separate**
  (recorded in the runbook (e); to be pinned as a Runtime Probe row when ③.2 takes up the auth gate).

| Sev | Lens | Finding | Disposition |
|---|---|---|---|
| MED | hacker | `vetJudgeBinPath` checked world-writability on the SYMLINK dir but not the resolved TARGET dir -> since claude IS a symlink, a world-writable target dir lets an attacker swap the frozen binary | **FIXED**: check world-writable on BOTH `dirname(p)` AND `dirname(realpath(p))`; regression test added. (World-ONLY, not group: `/usr/local/bin` is admin-group-writable on macOS Homebrew -> a group check would false-reject a legit claude.) |
| HIGH | CR | the G3 pre-condition assert sat OUTSIDE `test()` -> a crash, not a clean FAIL | **FIXED**: wrapped in `test('G3 pre-condition: ...')`. |
| MED | CR | the promised `&`/space judgeBin tests + an effectful-install `judgeBinBaked` assertion were missing | **FIXED**: added the `&`-xml-escape + space-single-quote builder test + the effectful darwin/linux `judgeBinBaked` + written-artifact test. |
| LOW | honesty | `install.sh` surfaced the empty-bake NOTE only on the real-install path, not the `--diff` preview | **FIXED**: the dry-run preview now greps the artifact + prints the NOTE on an empty bake. |
| NIT | CR/honesty | the dry-run filter comment didn't cite the disposition; the env-over-PATH precedence had no dedicated test; the vet comment scope wording | **FIXED**: comment cites disposition #1; a self-skip env-over-PATH test added; the vet comment notes the immediate-parent + world-only scope. |
| LOW | hacker/CR | run-time has no re-vet of the baked bin (snapshot semantics); `vetJudgeBinPath` swallows an EPERM dir-stat without a reason code | **ACCEPTED + documented**: snapshot semantics + fail-open-to-PATH-fallback are the module's stated advisory policy; a reason-code is a deferred debuggability nicety, not load-bearing. |

Post-fold: schedule 39/39, judge-bin 4/4, capability-free 3/3 (G3 skips on the 401-inconclusive),
model-override 3/3, full kernel green; eslint + ADR-0006 + shellcheck clean; smoke 125-128 green
(128 = the real-dry-run JUDGE_BIN dark-bake guard). The 2 install-gate reds are the known
not-mine artifacts. **Verdict: CLOSEABLE** -- PR-C closes the (e) PATH/ENOENT gap; the auth gate
is honestly carried separately.
