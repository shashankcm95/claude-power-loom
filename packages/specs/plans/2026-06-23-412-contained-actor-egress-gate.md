# Plan — #412 actor-uid-separation via the Docker-structural egress boundary

- **Issue**: [beta-blocker] #412 — Actor-uid-separation (the LAST launch blocker before #406, the first external PR)
- **Branch**: `feat/412-contained-actor-egress-gate` (off fresh `origin/main` @ c4ede0e)
- **Approach (USER-chosen, refined)**: Docker-containment as the boundary — **done STRUCTURALLY**, not via a
  host-written attestation file. The contained actor (#391 `runActorInContainer`) structurally cannot reach the
  host broker (no host `sudo`), so it cannot mint an approval; the human (uid 501) mints via approve-CLI. The new
  enforcement is a **non-bypassable guard**: the host-level (broker-reachable) actor path refuses to run when the
  egress is armed (the armed-emit driver itself is a forward-contract — Design §4). `emitPR` is **unchanged**.
- **Why this shape** (VERIFY-board v1 finding, folded): the host-written `<hash>.contained` attestation in the
  prior draft was CRITICAL-flawed — its producer runs on the host as uid-501, the very adversary, so the actor
  could forge it. This redesign removes the attestation entirely; the close is the STRUCTURAL container boundary
  (#391) + a guard, which a uid-501 *actor* cannot defeat (it has no host shell). Actor-uid-separation (uid 611)
  is a clean LATER defense-in-depth hardening, not a prerequisite.
- **Treatment**: kernel/security/egress-adjacent diff -> 3-lens VERIFY + 4-lens VALIDATE (hacker LIVE-probes the
  BUILT code, Rule 2a) MANDATORY. TDD-treatment applies (the guard changes the host-level actor's run contract).

## Problem & threat model

On a single-uid box the autonomous actor (`claude -p`) runs as the operator uid (501), which the broker
allowlists. So a host-level actor can `sudo -n -u loom-broker <wrapper>`, present an emission body it chose, and
the broker signs an approval (its WHAT-gate binds ctx<->basis, not human approval). That approval then satisfies
`emitPR` -> the human "sign-what-you-see" step is bypassed. Confirmed against the code (probes below).

**Adversary**: the `claude -p` actor subprocess (untrusted for provenance — the issue's explicit scope).
**Trusted**: the human operator + the deterministic orchestration Node code running as the operator.
**Goal**: the actor must never be able to mint a broker approval.

## The close (structural) + the honest residual

- **Structural close**: run the actor in Docker (#391). A container has no host `sudo` and no access to the host
  sudoers / the broker wrapper (separate namespace on Linux, separate VM on macOS), so the contained actor
  CANNOT invoke the broker -> cannot mint an approval. `attestActorContainment` already proves the container has
  no host-FS reach (write-boundary + binary-presence); this plan also asserts the no-broker-reach property.
- **The guard (new, non-bypassable by the actor)**: the host-level actor path (`real-solve` / `runActorTrajectory`,
  which IS broker-reachable) refuses to run when the egress is armed (killswitch disarmed). And the live emit path
  requires a green live `attestActorContainment` before arming. So while emit is armed, ONLY the contained
  (non-mintable) actor can run.
- **`emitPR` unchanged**: it still gates on the human-minted broker-signed approval (5a/5b/5c). The contained
  actor simply cannot mint a competing one. No new (forgeable) artifact enters the chokepoint.
- **Honest residual** (stated, not buried; identical trust-class to the broker's own custody-real model). The
  close is sound IFF (a) every host-level broker-reachable actor spawn carries the armed-refusal guard — delivered
  by placing it at the `runActorTrajectory` chokepoint (Design §1) — AND (b) the live-emit driver runs the actor
  ONLY via `runActorInContainer` (the forward-contract, Design §4). Beyond that: a uid-501 host process that is
  NOT the contained actor — a compromised orchestration, or the operator themselves — can still mint+emit. That is
  host-compromise, a DIFFERENT threat; #412 is scoped to the autonomous *actor*, which this close excludes from the
  broker (the actor does not choose its own containment — the trusted orchestration does, honoring the guard). The
  guard is uid-501-side, so a 501 compromise bypasses it — but the *actor* (a contained child / a guarded
  host-spawn) cannot. **Scope of claim**: this PR closes the *actor's* mint-ability; it does NOT deliver the
  literal uid-611 actor-uid-separation (a stronger, deferred hardening), so #412 stays open for that escalation and
  the PR does not claim an unqualified "closes #412". PATH-1 (human-at-push) remains the documented backstop.

## Runtime Probes (firsthand, this session)

- **emitPR armed gate, unchanged by this plan**: `emit-pr.js:392` `if (disposition.mode === 'live' && token &&
  !killswitchOn)` then `readVerifiedApproval` then `armedEmit`. We add NOTHING here.
- **Two actor paths, asymmetric reachability**: host-level `runActorTrajectory`
  (`trajectory-friction-run.js:74-86`, `spawnSync(claudeBin, ['-p', ...])`, inherits operator uid, default
  `allowedTools` includes `Bash`, broker-reachable) vs contained `runActorInContainer`
  (`docker-actor-backend.js:150`, Docker, no-Bash pinned, NOT broker-reachable). `attestActorContainment`
  (`docker-actor-backend.js:173`) returns `{attested, reason, scope, raw, report}` from a LIVE container
  self-check (write-boundary + binary-presence; `scope` explicitly notes network is ON).
- **The host-level actor drives GRADING, never emit**: `real-solve.js` `runActorSolve` calls
  `runActorTrajectory` and returns a VERDICT (`makeRealSolve` gates on `claudeBin` + `backend.containmentAttested`
  for the GRADER sandbox — NOT the actor). The actor's clone there is host-unsandboxed (comment lines 62-64).
- **The contained actor drives emit (dry-run today)**: `live-draft-run.js` `solveLiveIssueContained` uses
  `runActorInContainer` (`:81`), preflight-attests via `attestActorContainment` (`preflightEnv:68`,
  `att.attested === true`), then `emitFn({repo, issueRef, diff}, {})` (`:156`) — EMPTY opts -> dry-run.
- **No committed armed-emit driver**: the only `emitPR` caller is `live-draft-run.js` with empty opts; #403/#417
  armed runs were ad-hoc dogfoods. So arming is future; this plan makes "armed => contained actor" an enforced
  invariant before that.
- **The killswitch read the guard reuses**: `emit-pr.js:256` `isKillswitchOn({killswitchPath})` — env force-on,
  else a custody ARM file must contain the literal `ARMED`. Exported. A lab guard can require it (lab may import
  kernel).

## Design (REVISED — folds VERIFY board v2)

### 1. The host-level-actor guard — at the chokepoint `runActorTrajectory` (the new enforcement)

A small kernel/egress helper `isEmitArmed({ killswitchPath, custodyDispositionPath })` — true iff the killswitch
is DISARMED (`!isKillswitchOn`) AND the disposition resolves to `live` (reusing the existing `isKillswitchOn` +
`resolveDisposition`). Fail-safe: a missing/unset path => `false`. This is the single source of "is a live emit
currently possible".

The guard lives in **`runActorTrajectory`** (`trajectory-friction-run.js:74`) — the SINGLE chokepoint every
host-level (broker-reachable) `claude -p` actor spawn funnels through. (VERIFY-board v2 HIGH, confirmed by recon:
`runActorTrajectory` is called directly by `real-solve.js:163`, `earned-grounding-run.js:366`,
`calibration-issue-run.js:215`, and spikes — a `real-solve`-only guard leaks. Placing it at the chokepoint makes
the enforcement structural-against-the-actor, not per-caller-conventional; a new caller cannot silently bypass it.)

When `isEmitArmed()` is true, `runActorTrajectory` REFUSES to run: `{ ok:false, reason:'host-actor-refused-while-armed',
events:[] }` + a high-visibility `emitEgressAlert('host-actor-while-armed', ...)` (security.md: fail-closed must be
OBSERVABLE). **No override** (VERIFY-board v2 LOW): a caller-overridable softening violates "a guard must be
NON-BYPASSABLE". There is no legitimate reason to run a broker-reachable host actor while live emit is armed (you
are past shadow grading by then). The arm-state is supplied via an injected `isEmitArmedFn` (dependency-inversion,
testable) defaulting to reading the deployment's egress custody via the env convention
`LOOM_EGRESS_KILLSWITCH_PATH` + `LOOM_EGRESS_DISPOSITION_PATH`. Unset (tests / shadow / dev) => not armed => runs
normally (zero behavior change off a live deployment). The orchestration holds the env; the spawned actor child
cannot unset its parent's env, so the guard is sound against the *actor*.

### 2. A TESTED structural invariant (the load-bearing close, made auditable)

The real #412 close is structural: the contained actor cannot reach the broker. Make it a TESTED invariant, not a
prose claim — assert `buildActorRunArgs` (`docker-actor-backend.js`) carries `--cap-drop ALL` +
`--security-opt no-new-privileges`, mounts ONLY `/work` (no `docker.sock`, no host path), and uses a `bridge`
(never `host`) network; and note the broker is a sudo-only wrapper with NO network listener. (VERIFY-board v2
HIGH-3: "armed => contained" is otherwise CONVENTIONAL — the only genuinely structural barrier is "the contained
actor cannot sudo", so verify exactly that.)

### 3. `emitPR` — UNCHANGED

No new opts, no new gate, no DISPOSITION_KEYS change. `emitPR` already gates on the human-minted broker-signed
approval; a contained actor cannot mint a competing one. The close lives in (1)+(2)+the structural container
boundary. (Coupling note, VERIFY-board v2 FLAG: "emitPR unchanged" is safe IFF every host-level actor path is
guarded — which (1) delivers by sitting at the chokepoint.)

### 4. The armed-emit path is a FORWARD-CONTRACT (no vacuous gate)

There is NO committed armed-emit driver (`live-draft-run` only ever calls `emitFn(..., {})` = dry-run; `preflightEnv`
ALREADY fail-closes on un-attested containment). So this PR adds NO new live-draft gate (the prior section-2 gate
guarded a nonexistent path — VERIFY-board v2 MEDIUM). Instead: a documented FORWARD-CONTRACT — when an armed driver
is built, it MUST (a) route the actor only through `runActorInContainer`, (b) be reachable only under
`runActorTrajectory`'s armed-refusal (so the host-level actor stays excluded), and (c) be the SINGLE arm-source —
compute `isEmitArmed(opts)` once and pass it to `runActorTrajectory` via the `isEmitArmedFn` seam so the guard and
`emitPR` cannot silently de-correlate (VALIDATE-hacker MEDIUM: `emitPR` reads arm-state from `opts`, the guard's
DEFAULT from the env convention — the env default is only the fallback for non-injecting callers). `live-draft-run`
is UNCHANGED.

### 5. Observable-alert extraction (shared, small)

Extract `emitEgressAlert` (defined at `gh-emit.js:93`; invoked at many call-sites there) to
`packages/kernel/egress/alert.js` (node-core only, zero egress deps -> acyclic; gh-emit + the new guard both import
it). Extract STRICTLY the function + its doc comment — do NOT pull `ENV_ALLOWLIST` or any gh-emit constant.
Preserve the `[LOOM-EGRESS-ALERT]` prefix + the never-throw-from-telemetry guard VERBATIM (existing gh-emit
assertions are the regression guard).

## File-by-file change list (REVISED)

| File | Change | ~LoC |
|---|---|---|
| `packages/kernel/egress/alert.js` | NEW — extract `emitEgressAlert` verbatim (fn + doc only) | 12 |
| `packages/kernel/egress/gh-emit.js` | import alert.js, drop local def | -4/+2 |
| `packages/kernel/egress/emit-pr.js` | NEW export `isEmitArmed({killswitchPath, custodyDispositionPath})` (composes existing isKillswitchOn + resolveDisposition; fail-safe -> false) | 16 |
| `packages/lab/causal-edge/trajectory-friction-run.js` | the armed-refusal guard at `runActorTrajectory` + `isEmitArmedFn` seam + env-convention default + alert | 28 |
| `tests/unit/kernel/egress/alert.test.js` | NEW — prefix byte-identical + never-throw + stderr spy (non-vacuity) | 30 |
| `tests/unit/kernel/egress/emit-pr.test.js` | extend — `isEmitArmed` truth table | 40 |
| `tests/unit/lab/causal-edge/trajectory-friction-run.test.js` | NEW/extend — guard refuses (simulated armed) + runs (not armed) + alert fired; a non-_spike host caller audit | 70 |
| `tests/unit/lab/issue-corpus/docker-actor-backend.test.js` | extend — the structural-invariant assertion on `buildActorRunArgs` | 40 |
| `docs/deployment/loom-broker.md` | NEW section — the structural close + the armed-refusal guard + the env convention + the honest residual + the uid-611 future hardening | 35 |

Total impl ~55 LoC, tests ~180 LoC. `emitPR` essentially untouched (one export); `live-draft-run` unchanged.

## Test plan (TDD — failing contract first)

1. `isEmitArmed`: truth table — armed only iff `!killswitchOn` AND disposition `live`; killswitch-on => false;
   dry-run disposition => false; absent/unset custody paths => false (fail-safe default).
2. `runActorTrajectory` guard (NON-VACUOUS via a SIMULATED armed state, per the board): with `isEmitArmedFn: () => true`
   => `{ ok:false, reason:'host-actor-refused-while-armed' }` + exactly one `[LOOM-EGRESS-ALERT]` (stderr spy); with
   `isEmitArmedFn: () => false` (the common case) => runs normally (claudeBin injected/null short-circuit as today);
   no override exists (assert there is no param that re-enables the host actor when armed).
3. `alert.js`: the `[LOOM-EGRESS-ALERT]` prefix is byte-identical to the old gh-emit output; a throwing stderr
   never propagates (never-throw); a stderr spy proves non-vacuity.
4. Structural invariant: `buildActorRunArgs(...)` includes `--cap-drop ALL` + `--security-opt no-new-privileges`,
   mounts ONLY `/work` (no `docker.sock` / host path), network `bridge` not `host`.
5. RESIDUAL test (per the honest residual): a uid-501 process can still drive `emitPR` with a 501-minted approval
   (host-compromise) — asserted as ACKNOWLEDGED (the guard excludes the *actor*, not a 501-equivalent), so no
   over-claim of a full close.

## HETS Spawn Plan

- **VERIFY (pre-build, read-only, parallel 3-lens)** — REQUIRED:
  - `architect` — is the guard at the right altitude (real-solve vs runActorTrajectory)? does `isEmitArmed`
    compose cleanly? is the alert.js extraction acyclic? is anything over/under-built?
  - `hacker` — can the *actor* (contained) bypass the guard or reach the broker? does removing the attestation
    leave any fail-open path? is "armed => contained" actually enforced, or merely conventional? is the residual
    honest (no over-claim that this closes the 501-equivalent case)?
  - `honesty-auditor` — do the probes hold? does "closes #412" match what this delivers (the actor is excluded;
    the 501-host residual is documented, not closed)?
- **VALIDATE (post-build, read-only, parallel 4-lens)** — REQUIRED: `code-reviewer` + `hacker` (LIVE-probes the
  BUILT guard — throwaway scripts driving `isEmitArmed` + the real-solve refusal + the live-draft armed gate) +
  `honesty-auditor` + `architect`.

### Routing Decision

```json
{ "recommendation": "route", "rationale": "kernel/egress-adjacent security guard; the 3-lens VERIFY + 4-lens VALIDATE tier is mandatory for this class; ultracode ON." }
```

## Risks / drift notes

- **R1 — over-claiming the close.** Mitigation: the honest-residual section + a RESIDUAL test; the close excludes
  the ACTOR (in Docker), not a uid-501-equivalent orchestration. The hacker + honesty lenses gate this.
- **R2 — the guard breaks ③.1 shadow grading.** Mitigation: NO override (the guard is NON-BYPASSABLE per Design §1).
  It refuses ONLY when genuinely armed (live disposition + disarmed killswitch) — and ③.1 grading runs PRE-LIVE, so
  the egress is not armed then. There is no legitimate need to run a broker-reachable host actor while armed, so no
  exception path exists (CodeRabbit #422 Major: an override would contradict the non-bypassable contract).
- **R3 — alert.js extraction breaks gh-emit's grep/test contract.** Mitigation: verbatim extract; existing
  gh-emit `[LOOM-EGRESS-ALERT]` assertions stay green.
- **R4 — Docker dependency on the user's box.** USER-accepted (the chosen option's trade-off). Reuses #391.
- **Drift note**: actor-uid-separation (uid 611) is the literal #412 ask and a clean LATER defense-in-depth
  hardening (run the contained actor as a non-501 uid). This PR closes the actor's broker-reachability via the
  container boundary now; the uid-611 escalation is tracked, not silently dropped.
