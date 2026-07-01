# Live-loop scheduler — go-live runbook

The SHADOW live-loop scheduler runs `live-loop-run.js` on a schedule (launchd on macOS, cron on Linux). Each
fire drives `pullLiveCorpus -> runLiveDraftLoop` **emit-OFF**: it pulls live issues, solves + drafts them in a
container, grades, and captures a weight-inert `live_pending` lesson — **with zero outward action** (no PR is
emitted; the observe/mint half is Part B). This is the SHADOW dogfood of the full pipeline before any live
crossing.

## Ships DARK by default

Installing the schedule is **not** automatic. The runner's opt-in gate `LOOM_LIVE_LOOP_ENABLED` defaults OFF, so
a bare run does nothing. **Installing the schedule is the deliberate opt-in** — the plist/cron bakes
`LOOM_LIVE_LOOP_ENABLED=1`, exactly analogous to the ghost-heartbeat's `GHOST_HEARTBEAT_EMIT=1`. Emit stays
**structurally** off regardless (the loop's hardcoded `emitFn(data, {})` -> `emitPR`'s fail-closed defaults);
scheduling adds **no new authority and no arming** — no writer to any trust-bearing store.

## Preconditions (before `--schedule-liveloop`)

1. **The 401 headless-auth fix.** A real fire execs `claude -p` (the solve + judges). Until headless auth
   resolves, every fire fails-soft to nothing (inert). Confirm a headless `claude -p` returns a completion, not
   `401 Invalid authentication credentials`, before scheduling.
2. **A resolvable `claude` bin.** Under launchd/cron's minimal PATH, the runner resolves `claude` via a baked
   PATH (see below) or the `~/.local/bin/claude` fallback. Install from a shell where `command -v claude`
   resolves to a **real, non-world-writable** binary, or the schedule runs inert.
3. **Cost awareness.** A running fire does real container solves (`capUsd`-bounded per fire, 6h cadence by
   default). No outward action, but real API/compute spend. Schedule only when you intend to pay for the
   emit-OFF dogfood.
4. **Operator readiness.** The live crossing (arming + real emission) is **Part B**, gated separately. This
   scheduler never emits.

## Install / status / uninstall

```sh
# install (the deliberate opt-in; DARK until you run this):
bash install.sh --schedule-liveloop
# preview only, no mutation:
bash install.sh --diff --schedule-liveloop
# status:
node packages/lab/live-loop/live-loop-schedule.js status
# remove:
bash install.sh --unschedule-liveloop
```

Run these **from your repo checkout**. The live-loop is lab-tier (experiment substrate) and is **not** mirrored
to `~/.claude` (unlike the kernel heartbeat), so `install.sh` operates it from its own dir (`$SCRIPT_DIR`) and the
plist bakes the repo's absolute runner path — which persists while the checkout exists.

On install the module resolves + **VETS** the `claude` bin (`resolveJudgeBin` -> `vetJudgeBinPath`: absolute, a
real file, a non-world-writable dir + symlink target) and bakes the vetted dir into the scheduled task's `PATH`,
so run-time `command -v claude` resolves the **vetted** bin rather than the unvetted fallback. If the bin is not
vettable, the result carries `claudePathBaked:false` and the install surfaces a note — the schedule may then run
inert (no `claude` resolved). Re-run from a shell where `command -v claude` resolves, or ensure
`~/.local/bin/claude` is a real, non-world-writable binary.

## Off-switches

- **Pause without uninstalling:** `touch ~/.claude/checkpoints/live-loop.disabled` (resume: `rm` that file). The
  runner's touch-file killswitch is checked every fire (presence-only, `lstat` no-follow).
- **Remove the schedule:** `bash install.sh --unschedule-liveloop`.
- The env killswitch `LOOM_LIVE_LOOP_DISABLED` is **inert under launchd** (the scheduled minimal env does not
  source the shell profile) — the touch-file or `--unschedule-liveloop` are the working off-switches.

## Scope note

This is the last Part-A wave. It ships the schedule mechanism DARK. The actual SHADOW->LIVE crossing (arming a
world-anchor weight on a deployed+attested box, real emission through the egress kernel, the `#273` same-uid
trust judgment) is **Part B**, with its own scope and per-step operator go-aheads.
