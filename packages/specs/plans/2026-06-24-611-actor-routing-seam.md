# Plan — #412 PR 3: the actor routing seam (run the host actor as uid-611)

- **Issue**: [#412](https://github.com/shashankcm95/claude-power-loom/issues/412) — PR 3 of 3 (vehicle #425 + deploy helper #426 merged). This wires `runActorTrajectory` to actually RUN the host actor as `loom-actor`@611 when uid-611 is deployed. After this + the operator's deploy + dogfood, #412 closes.
- **Branch**: `feat/611-actor-routing-seam` (off fresh `origin/main` @ 17475d2).
- **The delicate one**: PR 1 (vehicle) + PR 2 (deploy script) were additive / no-runtime-change. THIS modifies the always-on actor spawn path (`runActorTrajectory`). The load-bearing risk is the **H1 fail-open polarity trap** (PR-1 VERIFY): a seam mirroring `defaultIsEmitArmed`'s benign-on-unset would silently run the actor as the *privileged* uid-501 on a deployed box. So the launcher resolver is **FAIL-CLOSED on deployed-but-unconfigured**.
- **Treatment**: always-on runtime path + security boundary → 3-lens VERIFY + TDD-treatment (the spawn's run-contract changes) + 4-lens VALIDATE (hacker LIVE-probes the BUILT seam, Rule 2a) MANDATORY.

## What changes (one file: `packages/lab/causal-edge/trajectory-friction-run.js`)

Insert the routing decision AFTER the #422 armed-refusal guard (currently lines 95-101) and BEFORE the spawn
(currently 102-113). The #422 guard stays FIRST + UNCONDITIONAL (never relaxed by uid-611 — ratified PR-1 VERIFY).

### 1. `defaultActorLauncher()` — the env-convention resolver, FAIL-CLOSED polarity

Mirror `defaultIsEmitArmed`'s env-convention shape ([trajectory-friction-run.js:42](../../lab/causal-edge/trajectory-friction-run.js)) but invert the safety polarity (the H1 fix):

- `LOOM_ACTOR_USER` set => require `LOOM_ACTOR_WRAPPER` set (a non-empty abs path) => `{ mode:'cross-uid', actorUser, wrapperPath }`; a HALF-set config (`USER` without `WRAPPER`, or vice-versa) => `{ mode:'refuse', reason:'half-configured' }`.
- Neither set BUT a deployment marker present — `/etc/loom/actor-anthropic.key` EXISTS (the custody file the deploy installs) OR `LOOM_ACTOR_REQUIRE_UID_SEP=1` — => `{ mode:'refuse', reason:'deployed-unconfigured' }` (a deployed box that lost the env fails CLOSED, never silently runs as 501).
- Neither set, no marker (clean dev / shadow / CI — the common case) => `{ mode:'direct' }` (the EXISTING path, byte-for-byte unchanged).

The marker probe (`fs.existsSync('/etc/loom/actor-anthropic.key')`) is wrapped so any FS error => treat as present-and-unconfigured? NO — an FS error on the marker check must NOT brick dev/CI. Decision (for VERIFY): the marker default path is overridable via `LOOM_ACTOR_KEY_MARKER` (default `/etc/loom/actor-anthropic.key`); `existsSync` already returns false on error (never throws). A clean box has no such file => `direct`. Only a real deployed box (the file exists) trips the deployed-unconfigured refuse.

### 2. The injected seam + the routing in `runActorTrajectory`

Add an `actorLauncherFn` param (dependency-inversion, testable) defaulting to `defaultActorLauncher` — exactly mirroring the existing `isEmitArmedFn` seam. After the #422 guard:

```
const launch = (typeof actorLauncherFn === 'function' ? actorLauncherFn : defaultActorLauncher)();
if (launch.mode === 'refuse') {
  emitEgressAlert('actor-launch-refused', { spawn: 'runActorTrajectory', reason: launch.reason });
  return { ok: false, reason: 'actor-launch-refused', detail: launch.reason, events: [] };   // fail-closed + observable
}
```

Then build the spawn by mode:
- **direct** (unchanged): `const bin = claudeBin === undefined ? resolveClaude() : claudeBin; if (!bin) return actor-unavailable;` + the existing `args` + `spawnSync(bin, args, { cwd, input: prompt, ... })`.
- **cross-uid**: `const { command, args } = crossUidActorArgs({ actorUser: launch.actorUser, wrapperPath: launch.wrapperPath, model });` + `spawnSync(command, args, { cwd, input: prompt, shell:false, timeout, encoding:'utf8', maxBuffer: MAX_BUFFER })`. The prompt rides STDIN (sudo forwards it un-truncated — probed to 200KB in PR 1). `claudeBin`/`resolveClaude`/`allowedTools` are NOT used on this path: the wrapper has the staged claude and hardcodes the no-Bash toolset (the security pin — a caller's `allowedTools` is intentionally ignored cross-uid).

The result mapping (parse stream-json from `res.stdout`) is IDENTICAL for both paths — the cross-uid `res.stdout` is the wrapper's stdout, which is claude's stdout because the wrapper `exec`s claude (PR 2 / runbook). The `{ ok, events, stdout, cwd }` return shape is unchanged.

### 3. #422 ordering invariant (the de-correlation guard)

The launcher resolution is strictly AFTER the armed guard, so a cross-uid spawn is never built while armed. A TESTED invariant: with `isEmitArmedFn: () => true`, the `actorLauncherFn` is NEVER invoked (spy asserts zero calls) — tests the ORDERING (the de-correlation hazard a future refactor could introduce), not just the return reason.

## Runtime Probes (firsthand, this session)

- The seam target: `runActorTrajectory` ([trajectory-friction-run.js:89-114](../../lab/causal-edge/trajectory-friction-run.js)) — the #422 guard at 95-101, the direct spawn `spawnSync(bin, args, { cwd, input: prompt, ... })` at 107, the `{ ok, events, stdout, cwd }` return at 113. The `isEmitArmedFn` seam + `defaultIsEmitArmed` env-convention at 42-50 (the pattern to mirror, with inverted polarity).
- The launcher to wire in (merged #425): `crossUidActorArgs({ actorUser, wrapperPath, sudoPath, model })` ([loom-actor-launch.js](../../kernel/egress/loom-actor-launch.js)) returns `{ command, args }` = `sudo -n -u <actorUser> <wrapper> <model>`; exact-set model allowlist; exported.
- stdin-through-sudo un-truncated: probed to 200KB in PR 1 (the launcher plan's Runtime Probes).
- The marker the deploy installs: `/etc/loom/actor-anthropic.key` (0600 owned 611) — `scripts/loom-actor-deploy-macos.sh` step 2 / `docs/deployment/loom-actor.md`.

## Test plan (TDD — failing contract first)

1. `defaultActorLauncher` truth table (env injected via a thin wrapper or by setting/restoring process.env in the test): both unset + no marker => `direct`; `USER`+`WRAPPER` set => `cross-uid` (right fields); `USER` only / `WRAPPER` only => `refuse:half-configured`; marker present (a temp file via `LOOM_ACTOR_KEY_MARKER`) + no env => `refuse:deployed-unconfigured`. NON-VACUOUS (each refuse asserted).
2. The seam routing (injected `actorLauncherFn`): `direct` => the existing direct-spawn path (existing trajectory-friction-run tests stay green = the SHADOW regression guard); `cross-uid` => `spawnSync` is called with the `crossUidActorArgs` command/args (assert via an injected spawn or a stub bin); `refuse` => `{ ok:false, reason:'actor-launch-refused' }` + exactly one `[LOOM-EGRESS-ALERT]`.
3. The #422 ordering invariant: `isEmitArmedFn: () => true` => returns `host-actor-refused-while-armed` AND the `actorLauncherFn` spy is invoked ZERO times.
4. SHADOW: with no env + no marker + an injected `claudeBin` stub, the result is byte-identical to today (the existing suite is the guard).

## HETS Spawn Plan

- **VERIFY (pre-build, read-only, parallel 3-lens)** — REQUIRED:
  - `architect` — is the resolver's fail-closed polarity correct + complete (every deployed-but-unconfigured path refuses)? is the marker probe right (no dev/CI brick)? is the cross-uid-ignores-allowedTools/claudeBin behavior sound + documented? should the armed-window JUDGE close (extend the guard to `claudeOnce`/`claudePJudge`) be folded here or stay a tracked follow-on?
  - `hacker` — can the actor (the child) influence the launcher decision (it can't unset the parent's env, but probe)? any path where deployed-but-unconfigured silently direct-spawns as 501 (the H1 trap)? can a half/empty/whitespace env slip a cross-uid launch with a bad wrapper? does the cross-uid spawn leak the prompt to argv (it rides stdin)? the cwd/clone-as-611 access residual?
  - `honesty-auditor` — do the probes hold? does the plan over-claim (this is the seam; the operator deploy + dogfood still close #412)? is the SHADOW claim (unset+no-marker => byte-identical) real?
- **VALIDATE (post-build, read-only, parallel 4-lens)** — REQUIRED: `code-reviewer` + `hacker` (LIVE-probes the BUILT seam — drive `defaultActorLauncher` across env states + the routing + the ordering invariant) + `honesty-auditor` + `architect`.

### Routing Decision

```json
{ "recommendation": "route", "rationale": "modifies the always-on actor spawn path + is the load-bearing security seam (the H1 fail-open polarity trap); the 3-lens VERIFY + TDD + 4-lens VALIDATE tier is MANDATORY (security.md)." }
```

## Risks / drift notes

- **R1 — H1 fail-open (THE risk).** A deployed box that loses the env must FAIL CLOSED, not run as 501. Mitigation: the marker-probe refuse + the half-config refuse. The hacker lens gates it pre- + post-build.
- **R2 — SHADOW regression.** Unset + no marker => the existing direct path, byte-identical. The existing trajectory-friction-run suite + the #422 tests are the regression guard. (A clean dev/CI box has no `/etc/loom/actor-anthropic.key` => `direct`.)
- **R3 — cross-uid clone access (deployment residual, NOT this PR).** The throwaway clone the actor works in (cwd) is created by 501; uid-611 needs read/write access to it. That is a deploy-time perms property (like the Docker bind-mount) — documented as a residual for the operator dogfood, not solved in the seam.
- **R4 — the judge/labeler residual (NAMED, carried from PR 1).** `claudeOnce`/`claudePJudge` still run as 501 (the sibling spawns). The armed-window judge close (extend the guard) + the disarmed-window judge-uid-611 routing remain a tracked follow-on unless VERIFY says fold the armed-window close here. The human sign-what-you-see gate is the documented boundary today.

## Drift Notes

- This is the last BUILD leg of the uid-611 arc; the actual #412 close is the operator's deploy + dogfood (out-of-band).
- Mirrors `isEmitArmedFn`/`defaultIsEmitArmed` (the proven seam shape) with the H1 polarity inverted — the one deliberate divergence from the broker-arm pattern.

## VERIFY board folds (3-lens — DONE this session; supersedes §1-§2 where they conflict)

All three lenses PROCEED-WITH-CHANGES (honesty A-minus). Folds applied to the build:

- **[architect HIGH + hacker M2] empty/whitespace env = NOT "set".** The resolver normalizes each var: `const u = (process.env.LOOM_ACTOR_USER || '').trim()` and tests `u.length` for set-ness (mirrors `defaultIsEmitArmed`'s `typeof!=='string'||length===0`). A present-but-empty/whitespace var is treated as UNSET (never bubbled to a launcher throw). Test rows: `USER` set + `WRAPPER=''` and `WRAPPER='   '`.
- **[architect HIGH] pinned branch precedence.** (1) BOTH `USER`+`WRAPPER` non-empty => `cross-uid`. (2) EXACTLY-ONE non-empty => `refuse:half-configured`. (3) BOTH empty/unset => consult the deployed-signal: present => `refuse:deployed-unconfigured`, absent => `direct`. Test the marker+half-config overlap row (half-config wins — it is checked first).
- **[hacker M1 + honesty] the deployed-signal is the EXPLICIT flag PRIMARY + the marker as backstop.** deployed-signal = `LOOM_ACTOR_REQUIRE_UID_SEP === '1'` OR `fs.existsSync(LOOM_ACTOR_KEY_MARKER || '/etc/loom/actor-anthropic.key')`. The runbook is updated to make `LOOM_ACTOR_REQUIRE_UID_SEP=1` a MANDATORY deploy-checklist step (so "never silently runs as 501" holds by construction, not only on the default marker path) + an env-persistence step (launchd `EnvironmentVariables` / a profile export so env-loss is the abnormal case). `existsSync` never throws (false on error) => a clean dev/CI box with no flag + no marker => `direct` (SHADOW preserved).
- **[architect MEDIUM] crossUidActorArgs can THROW => wrap fail-closed.** The cross-uid branch wraps `crossUidActorArgs(...)` + `spawnSync` in try/catch => `emitEgressAlert('actor-launch-build-failed', {...})` + `return { ok:false, reason:'actor-launch-build-failed', events:[] }` (the cross-uid analog of the existing `catch => actor-spawn-failed`). Test: a deployed env with a dotdot wrapper => fail-closed result, NOT a thrown exception.
- **[honesty + architect LOW] alert sub-reason survives the clobber.** `alert.js` applies the positional `reason` LAST (`Object.assign({}, detail, {reason})`), so a `{reason: launch.reason}` detail is CLOBBERED. Pass the sub-reason under a distinct key: `emitEgressAlert('actor-launch-refused', { spawn:'runActorTrajectory', launchMode: launch.reason })`. Test asserts the emitted line carries `launchMode`.
- **[honesty — the SHADOW over-claim + architect Q4] inject a `spawnFn` seam.** The existing suite never reaches `spawnSync` (every not-armed test short-circuits on `claudeBin:null` => `actor-unavailable`), so "byte-identical direct path" was a STATED not SHOWN claim. Add a `spawnFn` injection seam (defaults to `spawnSync`). Tests assert the EXACT `[command, args, opts]` triple on BOTH arms: direct (`bin` + the legacy args) and cross-uid (the `crossUidActorArgs` command/args). The #422 ordering invariant strengthens to: armed => `spawnFn` is invoked ZERO times (not just the launcher spy).
- **[architect MEDIUM — RESOLVED] model allowlist covers current callers.** Probed: `earned-grounding` confirmModel default `claude-opus-4-8` + candidate-A default `claude-sonnet-4-6` are BOTH in `ALLOWED_ACTOR_MODELS`; real-solve/calibration use the default. So no cross-uid regression today. Document the intentional mode-divergence (a non-allowlisted model runs on `direct` but `refuse`s cross-uid — the allowlist is the security pin).
- **[hacker M3] name the R3 fail-signature.** A 0700/501 clone the actor (611) cannot enter => the actor runs but produces ZERO edits => `ok:true` with an empty trajectory (looks like a weak actor, NOT a perms bug). R3 + the runbook name this symptom so the operator dogfood catches it.
- **[architect Q5 + hacker L1] judge close STAYS a tracked follow-on** (do NOT fold into PR 3 — `claudeOnce`/`claudePJudge` are a different spawn; the judge verdict gates nothing/is read-only). File a tracked issue before #412 is declared closed. The human sign-what-you-see gate is the boundary today.
- **[honesty FLAG] PR-number citations** => the vehicle is `519f39d` (#425), the deploy helper `17475d2` (#426).

VERIFY agent IDs: architect `ae05970a88a575fdf`, hacker `a562517d05be39d21`, honesty `af595fa627e8c3987`.
