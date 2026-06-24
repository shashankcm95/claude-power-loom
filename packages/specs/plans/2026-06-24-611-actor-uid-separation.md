# Plan — #412 close: uid-611 actor-uid-separation (the broker-symmetric arc)

- **Issue**: [beta-blocker] [#412](https://github.com/shashankcm95/claude-power-loom/issues/412) — Actor-uid-separation.
  The LITERAL close the issue names; pairs with #404 (broker deployed) to make the human-gate a *real*
  authorization boundary against a rogue actor. The #422 contained-actor egress guard (`a3085dd`) was the
  defense-in-depth layer that landed first; this arc is the deeper, structural close. #412 stays OPEN until the
  operator deploys + custody-verifies + dogfoods uid-611 (the out-of-band step, paralleling #404).
- **Branch**: `feat/611-actor-uid-separation` (off fresh `origin/main` @ 0162e0e).
- **Approach (USER-decided)**: build off fresh `origin/main`, plan-first, MIRROR the loom-broker vehicle arc.
  The actor runs as a SEPARATE non-allowlisted uid (`loom-actor`@611) so it is structurally excluded from the
  cross-uid signing broker (`loom-broker`@610) and cannot mint its own egress approval.
- **The structural barrier (firsthand, the load-bearing gate)**: the broker's sudoers is `operator ALL=(loom-broker)
  NOPASSWD: <wrapper>` ([loom-broker-deploy-macos.sh:199](../../../scripts/loom-broker-deploy-macos.sh)) — only the
  OPERATOR uid (501) may `sudo -u loom-broker`. 611 is not `operator`, so `sudo -n -u loom-broker` is denied by sudo
  itself, regardless of any env 611 controls. This is the always-holds, kernel-enforced gate. The broker's
  `LOOM_BROKER_ALLOWED_UIDS` caller-auth (501 only) is a SECOND, deploy-CONTINGENT layer (defense-in-depth):
  `loom-broker-caller-auth.js:13-14` documents that `SUDO_UID` is forgeable on a DIRECT non-sudo invoke, so the
  allowlist is load-bearing only under the deploy's `env_reset,!setenv`. The structural claim leans on the sudoers
  gate; caller-auth is the contingent belt. (Honesty + hacker VERIFY: do NOT present caller-auth as unconditional.)
- **Treatment**: kernel/security/egress diff -> 3-lens VERIFY (DONE — see Pre-Approval Verification) + TDD +
  4-lens VALIDATE (code-reviewer + hacker LIVE-probes the BUILT code per Rule 2a + honesty + architect) MANDATORY.

## Problem & threat model

On a single-uid box every host-side `claude -p` process runs as the operator uid (501), which the broker
allowlists. So a host-level `claude -p` over attacker-influenced text — IF it can reach a shell — can
`sudo -n -u loom-broker <wrapper>`, present an emission body it chose, and the broker signs an approval (its
bind-gate binds ctx<->basis, NOT human approval). That approval then satisfies `emitPR` -> the human
"sign-what-you-see" step is bypassed.

- **Adversary**: a `claude -p` subprocess (untrusted for provenance — the issue's explicit scope).
- **Trusted**: the human operator + the deterministic orchestration Node running as the operator (501).
- **Goal**: a `claude -p` subprocess must never be able to mint a broker approval — structurally, at the uid level.
- **The invariant the threat actually requires** (architect VERIFY HIGH): *no broker-allowlisted uid runs
  untrusted-influenced `claude -p`*. The resolution ACTOR (`runActorTrajectory`) is the named #412 target and the
  highest-value one; but the blind judge / reference teacher / friction labeler (`claudeOnce` / `claudePJudge`,
  firsthand at `trajectory-friction-run.js:131`, `calibration-issue-run.js:127`, `calibration-run.js:99`) are also
  host-side `claude -p` over attacker text running as 501, default `toolless=false` (Bash-capable). They are a
  SIBLING residual — named in this plan, scoped to a tracked follow-on (see Residual + PR-3 below), NOT silently
  folded into the "close."

**What #422 already delivers (defense-in-depth, shipped):** the host-level actor path
(`runActorTrajectory`) REFUSES to run while the egress is armed; the contained actor (#391) cannot reach the host
broker. uid-611 closes the actor's mint-ability at the uid level, independent of the armed-refusal timing and the
container boundary — the belt to #422's suspenders.

## The close + the honest residual

- **Structural close**: run the host resolution actor as `loom-actor`@611. The sudoers runas gate (above)
  structurally denies 611 any `sudo -u loom-broker`, so the actor — whenever/however it runs on the host path —
  cannot mint.
- **Composes with #422, does NOT relax it** (architect + hacker VERIFY ratified): the #422 armed-refusal stays
  UNCONDITIONAL (a shipped security guard; never weakened, and `isEmitArmed` reads custody the guard cannot prove
  is wired — so "611 ⇒ safe to run armed" would couple correctness to an unobservable deploy property). uid-611 is
  additive: in the disarmed window where the host actor legitimately runs (shadow grading / calibration), it runs
  as 611.
- **API-key custody**: 611 cannot read 501's environment (the cross-uid `sudo` does `env_reset`), so 611 needs its
  OWN `ANTHROPIC_API_KEY` from a custody file (`/etc/loom/actor-anthropic.key`, owned 611, 0600, 501-unreadable) —
  symmetric with the broker's `broker.key`. The key VALUE never touches argv/logs (NAME-only; `cat` from the
  custody file inside the 611 process; the deploy reads the value via STDIN, never `--api-key` argv — `ps` leaks).
- **Honest residual** (stated, not buried; same trust-class as the broker's custody-real model):
  1. The close is sound IFF the operator genuinely deploys uid-611 (a DEPLOYMENT property the custody-verifier
     checks the *necessary* conditions for + the operator attests out-of-band — NS-9). This arc ships the VEHICLE;
     the operator's deploy + dogfood is the close, exactly as #404 was for the broker. #412 stays OPEN; PR titles
     say "Part of #412", never "Closes".
  2. A host-COMPROMISE at uid-501 (a compromised orchestration, or the operator) can still mint — a DIFFERENT
     threat; #412 is scoped to the autonomous *actor*. PATH-1 (human-at-push) is the documented backstop.
  3. The judge / teacher / labeler sibling `claude -p` spawns still run as 501 (named above). Mitigation today:
     the human sign-what-you-see gate is the real authorization boundary (a pre-minted approval is hash-bound to a
     specific emission + TTL + nonce, and the human approves the emission they SEE); the live loop already pins the
     `--tools ""` recipe (③.2.2c). The armed-window judge gap + the disarmed-window judge-uid-611 routing are
     PR-3 / tracked-follow-on, not part of this vehicle PR's claim.

## Runtime Probes (firsthand, this session)

- **The cross-uid launcher to REUSE**: `crossUidSudoArgs({ brokerUser, wrapperPath, sudoPath })`
  ([loom-broker-launch.js:50](../../kernel/egress/loom-broker-launch.js)) returns
  `{ command: <sudoPath, default 'sudo' when sudoPath===undefined>, args: ['-n','-u',<user>,<wrapper>] }` with
  `USERNAME_RE` flag-injection validation (`:52`) + `assertAbsoluteNoDotDot` on the wrapper (`:55`). EXPORTED
  (`:77`). GENERIC (user+wrapper) — the actor launcher reuses it (DRY) and appends ONE validated `--model`.
- **The host-actor spawn (where the PR-3 seam goes)**: `runActorTrajectory`
  ([trajectory-friction-run.js:89](../../lab/causal-edge/trajectory-friction-run.js)) does
  `spawnSync(bin, ['-p','--output-format','stream-json','--verbose','--model',model,'--allowedTools',...], { cwd, input: prompt })`
  (`:107`) — NO `env:` option => INHERITS the parent env => `ANTHROPIC_API_KEY` flows from 501. The #422
  armed-refusal guard sits at the TOP of the function, lines **90-101** (comment 90-94, decision 95-97, refuse 98-101).
  Callers (all funnel through here): `real-solve.js:163`, `earned-grounding-run.js:366`, `calibration-issue-run.js:215`,
  and `_spike/*` (which pass `claudeBin` explicitly).
- **The sibling judge/labeler sites (the residual)**: `claudeOnce`
  ([trajectory-friction-run.js:131](../../lab/causal-edge/trajectory-friction-run.js)),
  `claudeOnce` ([calibration-issue-run.js:127](../../lab/causal-edge/calibration-issue-run.js)),
  `claudePJudge` ([calibration-run.js:99](../../lab/causal-edge/calibration-run.js)) — all `spawnSync(bin, …)` as
  501; `toolless` defaults to **false** (`makeBlindSemanticJudge:159`, `makeFrictionLabeler:156`) => Bash-capable
  by default.
- **The contained actor does NOT need uid-611**: `runActorInContainer`
  ([docker-actor-backend.js:150](../../lab/issue-corpus/docker-actor-backend.js)) runs claude INSIDE Docker (no
  host sudo => broker-unreachable); key rides `spawnEnv:{ANTHROPIC_API_KEY:apiKey}` (NAME-only argv, `:165`). uid-611
  is scoped to the HOST path only.
- **The deploy + custody-verify pattern to MIRROR**: `scripts/loom-broker-deploy-macos.sh` (create user; keypair
  0600 owned by the broker uid; root-owned wrapper; `assert_root_locked` ancestor-walk privesc gate on
  node/stage/wrapper `:75-94,114-118`; PRINT-only sudoers; dry-run default; `--apply` requires root) +
  `loom-custody-verify.js` (`assessCustody` PURE verdict — C0 not-root `:52`, C1 key-present non-vacuous `:58-67`,
  C2 host-read-denied + owner-differs disambiguation `:71-89`, C3 live-sign liveness `:91-95`, C2.5 wrapper
  integrity incl. host-owned check `:104`; `hostObservableChecksPassed` + `requiresOutOfBandUidConfirmation`,
  token `custodyVerified` appears NOWHERE).
- **stdin-through-sudo, un-truncated (architect MEDIUM + hacker M3 — the un-probed claim the seam relies on)**:
  PROBED firsthand this session — `python3 -c "'X'*200000" | sudo -n -u <self> cat` => in=200000 out=200000,
  HOLDS untruncated. The prompt can ride stdin through the cross-uid sudo to the actor wrapper. (Re-probe against
  the REAL deploy in PR 3; the mechanism is standard POSIX sudo stdin-forwarding.)
- **macOS home-dir wrinkle (NEW vs the broker)**: on the user's box `claude` lives in 501's home
  (`~/.local/bin/claude`) which 611 cannot read; it execs a node. The broker staged its code to `/opt/loom` +
  required a ROOT-OWNED node. The actor wrapper must exec a `claude` + node that are 611-reachable AND root-locked
  (so 501 cannot swap what runs as 611 = privesc). The custody-verifier asserts the wrapper's full exec chain is
  root-locked (C4, new — hacker H2).

## Design (REVISED — folds the 3-lens VERIFY board)

### Decomposition — 3 PRs, mirroring the broker (#400 vehicle -> #413 deploy -> wiring)

**PR 1 (THIS build) — the cross-uid actor VEHICLE, un-wired.** Purely additive: nothing in the always-on actor
path changes (no seam yet), so SHADOW by construction and H1 (the fail-open polarity) cannot arise here — it is a
PR-3 design problem, captured below so it is not lost. Mirrors broker #400 (the vehicle shipped before the wiring).

**PR 2 — the macOS deploy helper** (`scripts/loom-actor-deploy-macos.sh`). Mirrors broker #413.

**PR 3 — the routing seam + the armed-window judge close** (the behavior change; its own VERIFY/VALIDATE):
wire `runActorTrajectory` through `crossUidActorArgs`, **FAIL-CLOSED on a deployed-but-unconfigured box** (hacker
H1: a deployment marker — the presence of `/etc/loom/actor-anthropic.key`, or `LOOM_ACTOR_USER` set — makes an
unset/partial config REFUSE to spawn, NEVER silently direct-spawn as the privileged 501; only a clean dev/shadow
box direct-spawns unchanged); extract a shared `assertNotArmed` and apply it to the host-side judge/labeler sites
(the armed-window judge mint gap); an ordering-invariant test (the launcher fn is NEVER invoked when armed).

Then the operator deploys + custody-verifies + dogfoods (the actual #412 close).

### PR 1 — files

1. **`packages/kernel/egress/loom-actor-launch.js`** (NEW). `crossUidActorArgs({ actorUser, wrapperPath, sudoPath, model })`:
   - REUSE `crossUidSudoArgs({ brokerUser: actorUser, wrapperPath, sudoPath })` for the validated
     `sudo -n -u <actorUser> <wrapper>` base (DRY — same flag-injection + abs-path discipline).
   - Append ONLY `model`, validated by **exact-set membership** in a frozen `ALLOWED_ACTOR_MODELS` constant
     (#273: exact-set, NEVER prefix/`includes`; a non-member is REFUSED). No other passthrough — the wrapper
     hardcodes `-p --output-format stream-json --verbose --allowedTools <no-Bash>` and takes only `--model "$1"`,
     so the launcher's attacker-influenced surface is {actorUser, wrapper, model}, all validated. model lands ONLY
     in the `--model` value slot (a `--`-leading model cannot become a free claude flag).
   - Returns `{ command, args }`. Exported for direct assertion in tests.
2. **`packages/kernel/egress/loom-actor-custody-verify.js`** (NEW, MIRROR `loom-custody-verify.js` — bounded
   duplication, NOT a fork that edits the shipped broker verifier; same separate-trust-domain rationale as
   dedicated-broker-vs-pact-broker; an extract-to-shared-`_lib` DRY refactor is a possible later step the VALIDATE
   board can weigh):
   - `assessActorCustody(facts)` PURE: C0 not-root; C1 API-key-custody present + non-vacuous; C2 host-read of the
     API-key file DENIED (EACCES/EPERM) + owner-differs disambiguation (owner==runningUid => MODE not uid => FAIL);
     C2.5 wrapper integrity (root-owned, not group/world-writable, not host-owned); **C3 exec-liveness** = a live
     cross-uid `claude --version` as 611 via the launcher (proves the cross-uid exec path + the binary reachable
     WITHOUT the host reading anything; the API-key USE is proven by the operator dogfood, not here); **C4 (new, H2)
     exec-target root-lock** = the operator-supplied `claude` + node (`--claude-bin`/`--node-bin`) are root-owned,
     non-group/world-writable, with root-locked ancestors (port `assert_root_locked`'s full-ancestor lstat walk into
     a runtime check). The verifier checks the PASSED paths — the operator must pass the same binaries the wrapper
     execs; the verifier does NOT itself parse the wrapper. The CLI REQUIRES both flags so C4 is never skipped.
   - `gatherActorCustodyFacts` impure I/O (lstat + `O_NOFOLLOW|O_NONBLOCK` open for the denial leg + the live
     run-probe + the exec-target walk).
   - `hostObservableChecksPassed` + `requiresOutOfBandUidConfirmation` + residuals; NEVER asserts custody-real.
3. **`docs/deployment/loom-actor.md`** (NEW runbook, mirror loom-broker.md): the deploy steps (forward-ref PR 2),
   the sudoers (`operator ALL=(loom-actor) NOPASSWD: <wrapper>` + `env_reset, !setenv`), the macOS claude/node
   staging + root-lock, the verify+attest, the honest residual (all 3 points above), the composition with #404 +
   #422, and the PR-3 seam forward-contract (fail-CLOSED-on-deployed).
4. **Tests** (TDD — failing contract first):
   - `tests/unit/kernel/egress/loom-actor-launch.test.js` (NEW): arg-builder reuses crossUidSudoArgs shape;
     flag-injection actorUser REFUSED; non-abs / dotdot wrapper REFUSED; non-allowlisted model REFUSED
     (NON-VACUOUS — inject a bad model + a `--`-leading model + a bad user + a relative wrapper and watch each
     throw RED); happy-path argv exact.
   - `tests/unit/kernel/egress/loom-actor-custody-verify.test.js` (NEW): the synthetic cross-uid TRUE branch
     (facts a same-uid box cannot produce) PASSES; same-owner mode-000 key FALSE-PASS guard FAILS; host-readable
     key => FAIL; root => FAIL; host-owned wrapper => FAIL; **C4: a 501-owned/group-writable claude or node =>
     FAIL** (the privesc gate, non-vacuous); non-verifying live-probe => FAIL.

### PR 3 — the seam (planned; NOT this build) — H1 design captured

`runActorTrajectory` routes through `crossUidActorArgs` when uid-611 is deployed. The launcher resolver:
- `LOOM_ACTOR_USER` set => require `LOOM_ACTOR_WRAPPER` set + valid => cross-uid launch; else **REFUSE** (half-set
  is fail-closed).
- Neither set BUT a deployment marker present (`/etc/loom/actor-anthropic.key` exists, or
  `LOOM_ACTOR_REQUIRE_UID_SEP=1`) => **REFUSE** (deployed-but-unconfigured fails closed — H1).
- Neither set, no marker (clean dev/shadow/CI) => the EXISTING direct `spawnSync(bin, …)` path, byte-for-byte
  unchanged. The wrapper must `exec` claude (stdout fidelity — architect LOW). The #422 guard stays FIRST + the
  ordering-invariant test asserts the launcher fn is never invoked when armed.

## HETS Spawn Plan

- **VERIFY (pre-build, read-only, parallel 3-lens)** — DONE; verdicts + folds in Pre-Approval Verification below.
- **VALIDATE (post-build, read-only, parallel 4-lens)** — REQUIRED: `code-reviewer` + `hacker` (LIVE-probes the
  BUILT modules — throwaway node scripts driving `crossUidActorArgs` refuse-paths exact-set + the custody-verify
  synthetic-facts branches incl. C4) + `honesty-auditor` + `architect`.

### Routing Decision

```json
{ "recommendation": "route", "rationale": "kernel/egress security boundary (cross-uid actor separation); the 3-lens VERIFY + 4-lens VALIDATE tier is MANDATORY (security.md). route-decide returned root only on the low-signal substrate-meta catch-22; this is genuinely architect-shaped per the load-bearing route-decide comment." }
```

## Risks / drift notes

- **R1 — over-claiming the close.** Ships the VEHICLE; the operator's deploy + dogfood is the close. PR titles
  "Part of #412", never "Closes". The honesty lens gates this (VERIFY: Grade A, NO-OVERCLAIM).
- **R2 — the (future) seam regresses the always-on path.** PR 1 has NO seam => zero always-on change. PR 3 owns
  the SHADOW (unset/clean => byte-identical) + the H1 fail-closed-on-deployed design + its own regression suite.
- **R3 — duplicating crossUidSudoArgs / the broker verifier.** Launcher REUSES `crossUidSudoArgs` (DRY). The
  custody-verifier MIRRORS (bounded, intentional — separate trust domain; does not edit the shipped broker file);
  a shared-`_lib` extract is a later option.
- **R4 — macOS claude/node staging privesc.** C4 exec-target root-lock (verifier) + PR-2's `assert_root_locked`
  chain. The hacker lens gates this at VALIDATE (Rule 2a live re-probe).
- **R5 — the judge/labeler-as-501 sibling residual.** NAMED (Problem + Residual #3); the armed-window close +
  the disarmed-window judge-uid-611 routing are PR-3 / tracked-follow-on, with the human sign-what-you-see gate as
  the documented boundary today. Do NOT let the vehicle PR claim it closes the judge path.

## Drift Notes

- route-decide returned `root` (score 0, low-signal) on the bare task; escalated to the VERIFY board per the
  load-bearing route-decide judgment rule (a genuinely architect-shaped security arc the dictionary under-scores).
- The symmetric twin of the broker arc: the broker put the SIGNER on a separate uid (610); uid-611 puts the ACTOR
  on a separate uid (611). Same vehicle shape, same honesty model (custody-real is a deployment property attested
  out-of-band, never asserted by the tool).

## Pre-Approval Verification (3-lens VERIFY board — DONE this session)

Three read-only lenses (architect / hacker / honesty-auditor) ran in parallel against the v1 plan + the real
source. **All three: PROCEED-WITH-CHANGES.** Honesty graded the plan **A, NO-OVERCLAIM** (probes 7/7 behaviorally
correct). Load-bearing findings + how this v2 folds them:

- **[architect HIGH] single-chokepoint is incomplete** — the judge/labeler `claudeOnce`/`claudePJudge` also run as
  501. FOLDED: named as the SIBLING residual (Problem + Residual #3 + R5); the actor (`runActorTrajectory`) is the
  scoped #412 close; the armed-window judge close + disarmed-window judge-routing are PR-3 / follow-on. Probed the
  three sites firsthand (default `toolless=false` => Bash-capable).
- **[hacker HIGH H1] fail-open polarity** — a seam mirroring `defaultIsEmitArmed` (benign-on-unset) would
  silently run the actor as the privileged 501. FOLDED: PR 1 ships NO seam (purely additive — H1 cannot arise
  here); the PR-3 seam design is captured to FAIL-CLOSED on a deployed-but-unconfigured box (marker + half-set =>
  REFUSE).
- **[hacker HIGH H2 + architect LOW] custody exec-target check is net-new + under-specified** — FOLDED as C4 (the
  operator-supplied claude + node + their ancestors root-locked at verify time — the verifier checks the PASSED
  paths, and the CLI REQUIRES `--claude-bin`/`--node-bin` so C4 is never silently skipped), with a non-vacuous test.
- **[hacker M1 + honesty MEDIUM] caller-auth (b) presented as unconditional** — FOLDED: the structural claim now
  leans on the sudoers runas gate (a); caller-auth demoted to deploy-contingent defense-in-depth (mirrors
  `loom-broker-caller-auth.js:13-14`).
- **[architect MEDIUM + hacker M2] model passthrough** — FOLDED: exact-set `ALLOWED_ACTOR_MODELS` (#273); the
  wrapper hardcodes `--model "$1"` + the no-Bash toolset; non-vacuous refuse tests.
- **[architect MEDIUM/LOW + hacker M3] stdin-through-sudo + wrapper `exec`** — PROBED untruncated to 200KB this
  session (Runtime Probes); the wrapper-`exec` + re-probe-on-real-deploy are PR-3 build items.
- **[honesty FLAGs] citations** — FOLDED: #422 guard cited as 90-101; `crossUidSudoArgs` default is
  `sudoPath===undefined ? 'sudo'` (not `||`).
- **[architect FLAG / DRY] mirror-not-fork the verifier; 2->3 PR split** — FOLDED: bounded mirror (no edit to the
  shipped broker verifier); decomposition revised to 3 PRs (vehicle / deploy / seam) — the truer broker mirror.
- **[architect LOW] keep #422 unconditional** — RATIFIED (do not relax a shipped guard).

Agent IDs: architect `a628012efcc7597fe`, hacker `a6033115f10434055`, honesty `ad8438319918481ff`.

## VALIDATE result (post-build 4-lens board — DONE this session; PR 1 vehicle)

Four read-only lenses ran in parallel against the BUILT code. **hacker PASS-WITH-NITS (74 live probes through the
real modules, 0 bypasses)**; **architect PASS (no drift — every VERIFY fold present + correct; SHADOW-by-construction
grep-verified)**; **code-reviewer PASS-WITH-NITS**; **honesty PASS-WITH-NITS, Grade A-**. Folds applied this session:

- **[hacker MEDIUM] C4 silently skippable from the CLI** — `main()` required only `--key`/`--actor-user`/`--wrapper`,
  so omitting `--claude-bin`/`--node-bin` exited green with the load-bearing privesc gate un-evaluated. FOLDED: the
  CLI now REQUIRES both bins (C4 is never skipped — the vacuous-pass foot-gun is closed); the PURE function keeps
  NOTE-on-absent for programmatic callers (documented + tested).
- **[honesty MEDIUM] plan C4 verb over-stated the code** — "resolve the exec targets, do not trust a passed path"
  did not match the impl (it checks the operator-PASSED paths). FOLDED: the plan claim is aligned (above) to "checks
  the passed paths; the operator passes the same binaries the wrapper execs; the verifier does not parse the wrapper."
- **[hacker LOW] C2.5 unstatable-wrapper + `runningUid` NaN** — FOLDED: C2.5 now FAILs (not NOTEs) when `--wrapper`
  was supplied but unstatable (closes an exported-PURE-function forge path); C0 fails-closed on a non-integer uid.
- **[honesty MEDIUM-minus] `claudePJudge` residual label** — FOLDED: the runbook now says "tool-bearing by default
  (labeler + judge default `toolless=false`; `claudePJudge` sets no `--allowedTools` at all)".
- **[code-reviewer LOW] abs-path guard + parity test gaps** — FOLDED: `gatherExecTarget` returns `NOTABS` on a
  relative bin; added tests for C1 not-a-file, C1 EACCES->NOTE, C2.5 non-file + unstatable-FAIL, C0 NaN, C4 absent->NOTE.

**Carried residual (NOT a PR-1 blocker; tracked for PR 2):** the C4 ancestor-walk is LEXICAL (`path.dirname` +
`lstat`), not `realpath`-resolved — a ROOT-OWNED symlinked ancestor pointing into 501-writable space would evade it.
Hacker + architect both rated this NOT exploitable under the uid-501/611 threat model (planting a root-owned symlink
requires root). The PR-2 deploy helper's `assert_root_locked` uses `readlink -f`; keep the verifier symmetric there
if cheap. Gate at PR 1 close: launcher 8/8, custody-verify 18/18, full kernel/egress suite green, eslint + markdownlint clean.

VALIDATE agent IDs: code-reviewer `aba0ffb0e7e17014e`, hacker `a6a2a0695ca54bca4`, honesty `abe63ab881afe015e`, architect `a6ce5cacc819509cb`.
