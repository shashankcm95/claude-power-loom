# Part B — R0: edge custody-verify cwd neutralization (parity to #480)

> **SHADOW hardening. Zero live blast radius.** Edge-parity to the merged #480 (`3567ff9`),
> which neutralized the operator-cwd dependency of the cross-uid ACTOR custody probes but
> touched only `loom-actor-custody-verify.js`. R0 completes the symmetry for the EDGE custody
> verifier. Part B rung 0 (`packages/specs/research/2026-07-01-item8-part-b-live-crossing-scope.md`).

## The confirmed gap (firsthand)

- `loom-edge-custody-verify.js:200` runs the C3 cross-uid sign-probe as `signer(probeBasis, ctx)`.
- The signer is `crossUidLoomEdgeSigner(...)` (was inline in `main()` at `:278`), which wires
  `loomBrokerSigner` (`loom-edge-launch.js:60`).
- `loomBrokerSigner`'s `spawnOpts` (`loom-broker-client.js:76`) was `{ timeout, maxBuffer, env,
  stdio, input }` — **no `cwd`** — so `execFileSync` inherited the process cwd.
- Consequence (identical to #480's actor finding): run the edge custody-verify from a directory
  the edge-signer uid cannot traverse (a repo checkout under a 0700 home) and the wrapper's
  `/bin/sh` fails at startup with `getcwd: cannot access parent directories` (EACCES) ->
  `sig` null -> C3 FAILs misleadingly. A custody property must not depend on WHERE the operator
  ran the verify from.
- **Why the vehicle differs from #480:** the actor probe calls `spawnSync` DIRECTLY inside
  `gatherActorCustodyFacts`, so #480 put `cwd: NEUTRAL_PROBE_CWD` on that spawn. The edge probe
  calls an injected `signer` FUNCTION that hides the spawn two layers down in `loomBrokerSigner`,
  so the neutral cwd must be THREADED from the probe -> launcher -> client.

## Scope decision (evidence-driven)

- **IN: the EDGE path (SHADOW).** `crossUidLoomEdgeSigner` has no live production caller — its two
  callers are `loom-edge-custody-verify.js` (the probe) and `edge-signer-resolve.js:66` (SHADOW,
  arm-gated, passes no cwd). Zero live blast radius.
- **DEFERRED sibling: the BROKER custody-verify.** `loom-custody-verify.js:174` has the identical
  gap through `crossUidLoomBrokerSigner` (`:251`) -> the same `loomBrokerSigner`. But
  `crossUidLoomBrokerSigner` is ALSO the LIVE approval-signing launcher (`approve-cli.js:230,263` —
  the emitPR-chokepoint human approval). Under MECHANICS-FREEZE-pre-live, threading cwd through the
  live approval launcher is a USER call, not a silent expansion of an approved SHADOW item. R0 lands
  the shared-client enabling change; the broker follow-up then reduces to two lines (thread cwd
  through `crossUidLoomBrokerSigner` + set neutralizeCwd in `loom-custody-verify.js`'s CLI) and
  reuses R0's client change. NAMED residual, surfaced to the user.

## Fix (3 files, additive) — as built

1. **`loom-broker-client.js` (`loomBrokerSigner`)** — added a module const `NEUTRAL_CWD = '/'` and a
   STRICT-boolean opt `neutralizeCwd` (`opts.neutralizeCwd === true`). Inside the `sign` closure:
   `if (neutralizeCwd) spawnOpts.cwd = NEUTRAL_CWD;` — set ONLY when engaged, so an un-engaged
   caller's `spawnOpts` has NO `cwd` own-key (byte-identical to today for every existing caller,
   the live approval path included). **Boolean not raw cwd string** (VERIFY 2-lens convergence): the
   client owns the value, so a cross-uid sudo launcher never exposes a caller-settable path channel;
   the "only value is `/`" invariant becomes structural, not conventional.
2. **`loom-edge-launch.js` (`crossUidLoomEdgeSigner`)** — forwards `neutralizeCwd: opts.neutralizeCwd`
   into `loomBrokerSigner({...})`. keyFile/env FORBID guards unchanged.
3. **`loom-edge-custody-verify.js`** — extracted `runEdgeCustodyCheck(opts, deps)` from `main()`
   (mirrors `approve-cli.js:runApprove`), `deps.signerFactory` default `crossUidLoomEdgeSigner`, and
   constructs the signer with `neutralizeCwd: true`. `main()` keeps all argv/verify-key-read/print/exit
   (behavior-preserving). Exported `runEdgeCustodyCheck`.

## Byte-identity / freeze-safety argument (verified)

- Node probe confirmed `execFileSync` `cwd:undefined === no-cwd` (both inherit parent) and `cwd:'/'`
  neutralizes; the "only-set-when-present" design makes the live path's `spawnOpts` object literally
  key-identical. Live approval suite (`approve-cli.test.js`) stayed green (17 pass), as did the broker
  (`loom-custody-verify` 18) and actor (`loom-actor-custody-verify` 34) suites.
- `crossUidLoomBrokerSigner` / `loom-custody-verify.js` / `approve-cli.js` NOT edited in R0.

## Runtime probes

- `spawnOpts` lacked cwd: `loom-broker-client.js:76` (Read) -> `{ timeout, maxBuffer, env, stdio, input }`.
- Edge C3 calls injected signer: `loom-edge-custody-verify.js:200` (Read) -> `signer(probeBasis, ctx)`.
- Actor fix was actor-only: `git show --stat 3567ff9` -> `loom-actor-custody-verify.js` (+test) only.
- Node `cwd:undefined === no-cwd`, `cwd:'/'` neutralizes: `node -e` `execFileSync /bin/pwd` -> identical:true.
- Broker sibling shares the gap: `loom-custody-verify.js:174,251` (grep) -> signer via `crossUidLoomBrokerSigner`.
- Live approval uses the broker launcher: `approve-cli.js:230,263` (grep) -> `crossUidLoomBrokerSigner`.

## Test plan (TDD; real-path where possible)

- `loom-broker-client.test.js`: a REAL fake-broker records `process.cwd()`; (a) `neutralizeCwd:true` ->
  child cwd `/`; (b) absent -> child inherits the parent cwd (default, `notStrictEqual '/'` = non-vacuity).
- `loom-edge-launch.test.js`: the REAL stub-sudo (`shift 3; exec "$@"`, preserves cwd) + a wrapper that
  records `process.cwd()`; (a) `neutralizeCwd:true` -> `/`; (b) absent -> parent cwd. Proves the launcher
  FORWARDS (the middle hop the actor precedent never had).
- `loom-edge-custody-verify.test.js`: `runEdgeCustodyCheck({...}, { signerFactory: spy })` asserts the
  factory received `neutralizeCwd:true` (no real cross-uid spawn).
- **Non-vacuity revert-proof executed:** disabling the fix line (`neutralizeCwd = false`) turned exactly
  the two `neutralizeCwd:true` tests RED (broker-client + edge-launch), then restored.

## Named residual (architect VERIFY LOW-5, carried honestly)

The unit tests prove the neutral cwd THREADS to the spawn (the child reports `/`). They do NOT reproduce
the original `getcwd: EACCES` cure, which requires a real 0700-home cross-uid box — identical to #480's
evidence basis (its `NEUTRAL_PROBE_CWD` comment records the symptom was found by operator dogfood
"failed from ~/Documents/claude-toolkit, passed cleanly from /tmp", not a unit test). The EACCES cure is
provable only by the operator dogfood at Part B rung 2. VALIDATE must not over-claim the unit suite as
proof of the cure.

## Pre-Approval Verification (3-lens VERIFY)

- **code-reviewer: SHIP** (0 CRIT/HIGH/MED; 4 advisory LOWs — keep the cwd mutation after the spawnOpts
  literal; top-of-function const; note the seam defaults; confirmed byte-identity + all 3 callers).
- **hacker: SHIP** (7 attacks, 0 bypasses; cwd is behaviorally inert for the sign path — no PATH hijack,
  no relative-read, wrapper absolute + stdin + wrapper-owned env; `/` world-traversable-not-writable;
  garbage cwd fails CLOSED via `catch -> null`; `cwd:'/'` can only remove a spurious FAIL, never
  manufacture a false PASS; live path untouched). LOW: prefer the boolean over a raw string.
- **architect: DESIGN-READY** + **MED** (folded): `runEdgeCustodyCheck` did not exist -> EXTRACT it from
  `main()` mirroring `approve-cli.js:runApprove` (done, behavior-preserving). LOWs (folded): boolean over
  raw string (done); name the EACCES-cure-only-provable-by-dogfood residual (done, above).

## SHADOW-safety invariants

No `/etc/loom` read/write; no `--attested-cross-uid`; no arm-flag set; no deploy action; no live approval
path edited. Built in a worktree off fresh `origin/main`; explicit named `git add`; the untracked PACT doc
stays unstaged; USER merges.

## VALIDATE result

(pending — 3-lens VALIDATE on the BUILT diff below.)
