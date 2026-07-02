# Part B — R0b: broker custody-verify cwd neutralization (the named R0 sibling)

> **The deferred sibling from R0 (#485).** R0 neutralized the EDGE custody-verify's C3 probe cwd and
> landed the shared-client enabling change (`loomBrokerSigner` `neutralizeCwd` boolean). R0b applies the
> identical fix to the BROKER custody-verify — the third and last of the three cross-uid custody verifiers
> (actor #480, edge #485, broker here). Part B rung 0, completing #436-parity across all three.

## The confirmed gap (firsthand, from R0's probe)

- `loom-custody-verify.js:251` constructs the C3 signer via `crossUidLoomBrokerSigner(...)`, whose
  `loomBrokerSigner` (`loom-broker-launch.js:74`) forwards `{command, args, timeoutMs, maxBytes}` with
  **no `neutralizeCwd`** -> the broker custody-verify C3 sign-probe inherits the operator's cwd, identical
  to the edge gap R0 fixed. From a 0700-home checkout the wrapper's `/bin/sh` trips `getcwd:EACCES` -> a
  spurious C3 FAIL.

## The ONE higher-stakes difference vs R0 (the load-bearing crux)

`crossUidLoomBrokerSigner` is NOT SHADOW like the edge launcher was — it is the **LIVE approval-signing
launcher**: `approve-cli.js:230` (`makeSigner` default) + `:263` call it as `crossUidLoomBrokerSigner({
brokerUser, wrapperPath, sudoPath})` — the emitPR-chokepoint human-approval signer. So the byte-identity
of the live path is the load-bearing property this wave must prove: the passthrough is additive and
`approve-cli.js` passes NO `neutralizeCwd`, so (like the R0 edge launcher, VALIDATE-proven byte-identical)
its `loomBrokerSigner` call is literally key-identical. R0b engages `neutralizeCwd` ONLY in the broker
custody-verify CLI (an operator diagnostic), NEVER in `approve-cli.js`.

## Fix (2 files, additive) — mirrors R0 exactly

1. **`loom-broker-launch.js` (`crossUidLoomBrokerSigner`)** — forward `neutralizeCwd: opts.neutralizeCwd`
   into the `loomBrokerSigner({...})` call (+ JSDoc). `approve-cli.js` passes none -> byte-identical.
2. **`loom-custody-verify.js`** — extract `runCustodyCheck(opts, deps)` from `main()` (mirrors
   `loom-edge-custody-verify.js:runEdgeCustodyCheck` + `approve-cli.js:runApprove`), `deps.signerFactory`
   default `crossUidLoomBrokerSigner`, constructs the signer with `neutralizeCwd: true`. `main()` keeps
   argv-parse / verify-key-read / print / exit unchanged. Export `runCustodyCheck`.

`approve-cli.js` is NOT edited. `loom-broker-client.js` (the shared client) is NOT edited — R0 already
landed `NEUTRAL_CWD` + the `neutralizeCwd` boolean; R0b only threads it through the broker launcher.

## Byte-identity / freeze-safety argument

- The LIVE approval path `approve-cli.js:263 -> crossUidLoomBrokerSigner({brokerUser,wrapperPath,sudoPath})
  -> loomBrokerSigner` passes no `neutralizeCwd`. With the R0 client's "only-set-when-present" design,
  `spawnOpts` stays `{timeout,maxBuffer,env,stdio,input}` exactly. The passthrough is inert unless engaged,
  and only the broker custody-verify CLI engages it (never `approve-cli.js`).
- Regression gate: `approve-cli.test.js` + `loom-custody-verify.test.js` + `loom-broker-launch.test.js`
  must stay green.

## Runtime probes

- broker launcher forwarded no cwd pre-build: `loom-broker-launch.js:74` (Read) -> `{command,args,timeoutMs,maxBytes}`;
  post-build the forward is at `:79` (`neutralizeCwd: opts.neutralizeCwd`).
- broker custody-verify C3 via the launcher: pre-build `loom-custody-verify.js:251` (in `main()`); post-build the
  signer is constructed inside the extracted `runCustodyCheck` at `:247`, with the lazy `crossUidLoomBrokerSigner`
  default require at `:244` (honesty VALIDATE LOW-1: probe lines refreshed against the built artifact).
- LIVE approve-cli passes no neutralizeCwd: `approve-cli.js:263` (grep) -> `{brokerUser,wrapperPath,sudoPath}` only.
- R0 client change present on base: `grep NEUTRAL_CWD loom-broker-client.js` = 3 hits (base `2d8a217`).

## Test plan (mirrors R0; real-path where the harness allows)

- `loom-broker-launch.test.js`: if the harness has a stub-sudo+wrapper (like loom-edge-launch.test.js), add
  the same real-chain cwd test — `crossUidLoomBrokerSigner({..., neutralizeCwd:true})` -> child from `/`;
  absent -> parent cwd (non-vacuity pair). If not, add a signer-forwarding assertion.
- `loom-custody-verify.test.js`: `runCustodyCheck({...}, {signerFactory: spy})` asserts the factory received
  `neutralizeCwd:true` (no real cross-uid spawn), mirroring R0's runEdgeCustodyCheck test.
- The client-level cwd honoring is ALREADY proven by R0's `loom-broker-client.test.js` (same loomBrokerSigner)
  -> not re-tested.
- Non-vacuity revert-proof: disable the forward -> the forwarding/`neutralizeCwd:true` tests go red; restore.

## Named residual (carried from R0)

Unit tests prove the neutral cwd THREADS to the spawn; the actual `getcwd:EACCES` cure is provable only by
operator dogfood on a 0700-home cross-uid box (same evidence basis as #480/#485). Now ALL THREE custody
verifiers (actor/edge/broker) are cwd-neutralized -> the rung-2 attestation is robust from any cwd.

## SHADOW-safety invariants

No `/etc/loom` read/write; no `--attested-cross-uid`; no arm-flag set; no deploy action; `approve-cli.js`
(the live approval path) NOT edited. Built in a worktree off fresh `origin/main` (post-R0 `2d8a217`);
explicit named `git add`; the untracked PACT doc stays unstaged; USER merges.

## Freeze-safety — the load-bearing fact (architect F4)

The freeze cost was ALREADY PAID by R0: the live `approve-cli -> crossUidLoomBrokerSigner -> loomBrokerSigner`
path ALREADY flows through the R0-modified shared client (`neutralizeCwd` merged at base `2d8a217`), and R0's
VALIDATE proved the live approval suite byte-identical WITH that client change present. R0b only adds ONE more
inert forwarding hop (`crossUidLoomBrokerSigner`), structurally identical to the already-blessed
`crossUidLoomEdgeSigner` hop. There is no safer factoring — a dedicated broker-only client fork would add attack
surface for zero boundary; the strict-boolean design keeps the neutral-cwd value client-owned, not caller-settable.

## Pre-Approval Verification (3-lens VERIFY)

- **code-reviewer: SHIP** — 5 LOW confirmations, no defects. Forwarding shape matches the R0 edge mirror; the
  runCustodyCheck extraction is behavior-preserving; caller census = exactly 2 (`approve-cli.js` live +
  `loom-custody-verify.js` probe); `loom-broker-launch.test.js` lacked the stub-sudo harness (now added).
- **architect: DESIGN-READY** — no CRIT/HIGH. Folds applied: F1 explicit `neutralizeCwd: opts.neutralizeCwd`
  key (never `...opts`); F2 `runCustodyCheck` takes an already-read `verifyKeyPem`, moves the lazy
  `require('./loom-broker-launch')` into the `signerFactory` default, `main()` has no dead binding; F3 lazy
  require in the default; F4 freeze-note above; F5 real stub-sudo chain test over a mock.
- **hacker: SHIP** — 9 attacks, 0 bypasses; live-path byte-identity EMPIRICALLY proven (`spawnOpts` deep-equal
  to pre-R0b, no `cwd` own-key; explicit 3-key literal at `approve-cli.js:263`, no spread; no CLI flag sets
  `neutralizeCwd`). **LOW-1 (folded): `runCustodyCheck` MUST forward `sudoPath` too** (dropping it would break
  the operator `--sudo` override) — done, and the test asserts BOTH `sudoPath` AND `neutralizeCwd:true`. LOW-2:
  VALIDATE re-probe owed on the built diff (below).

## VALIDATE result — 3-lens on the BUILT diff, UNANIMOUS SHIP

- **hacker: SHIP** — 7 live /tmp probes against the REAL modules, 0 bypasses. Live approval-path byte-identity
  EMPIRICALLY proven on the actual `execFileSync` spawn: with the live `approve-cli` opts shape (no `neutralizeCwd`)
  the child inherits the parent cwd and `spawnOpts` has NO `cwd` own-key; with `neutralizeCwd:true` it runs from `/`.
  sudoPath forwarded verbatim; `runCustodyCheck` total on a bogus keyFile; exit-code-never-greener preserved; no
  raw-cwd-string channel (strict `=== true` + `NEUTRAL_CWD` constant); `approve-cli.js` unedited + cannot route
  through `runCustodyCheck`.
- **code-reviewer: SHIP** — 0 findings. Independently re-ran the non-vacuity revert-proof (disabling the forward
  reddens EXACTLY the `neutralizeCwd:true` real-chain test); all 7 touched + live-adjacent suites green; full kernel
  suite 0 failures; eslint clean.
- **honesty-auditor: Grade A / SHIP** — 6/6 load-bearing claims CONFIRMED (byte-identity, freeze-cost-paid-by-R0,
  approve-cli-untouched, thread-proof-not-cure-proof residual, non-vacuity, sudoPath fold). LOW-1 (folded above):
  the Runtime Probes cited pre-extraction line numbers; refreshed against the built artifact. LOW-2: suites-green
  is the orchestrator's firsthand attestation (done: all green + revert-proof executed).

Gates: full kernel suite 0 failures; eslint clean on all 4 touched files; signpost + release-surface clean.
Non-vacuity revert-proof executed twice (orchestrator + code-reviewer). Root-built -> Rule 4 records nothing.
