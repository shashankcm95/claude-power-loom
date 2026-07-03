---
status: SCOPE
plan-of: VC-W2, the arming wave of verify-container — turn the DORMANT post-emit advisory seam (VC-W1b #495) into a PRE-emit BLOCK gate. A SCOPE artifact, not a build plan. REVISED per the 3-lens VERIFY, whose hacker lens found a CRITICAL that reshapes the wave: the current verdict grades on the candidate's OWN observed tests, never the SEALED regression set, so the gate is GAMEABLE — and the live pre-emit path has no sealed set, so a TRUSTWORTHY gate is BLOCKED on the whole-suite regression oracle (O-TESTS + O-DEPS). The async-gate decision resolves to Option C (an async pre-gate adapter; kernel emitPR stays sync + untouched).
---

# VC-W2 — arm the verify gate (mechanism half vs operator half)

VC-W1a (#493) built the QUALITY verifier + advisory sidecar; VC-W1b (#495) installed the DORMANT
post-emit injected-`verifyFn` SEAM (advisory, fail-open, discard-the-verdict, byte-identical). VC-W2
would turn dormancy into a live QUALITY GATE: a candidate whose tests FAIL does not open a PR. **The
3-lens VERIFY found this is a BIGGER lift than "just the async decision" — see the load-bearing blocker
below. No code is built by this document; no live step is run.**

## The LOAD-BEARING blocker (hacker VERIFY C1 — the gate grades on the WRONG oracle)

`verifyCandidate.verdictOf` (`verify-candidate.js:42-45`) computes `passed` from
`statuses.some((s) => s === 'pass')` over the `observed` map — it NEVER calls `evaluateOutcome`
(`container-adapter.js:172-178`), the ONLY function that checks the SEALED `failToPass`/`passToPass`
regression designation ("the designation comes from the SEALED corpus record, never the
attacker-controlled stdout"). So:

- **The gate is GAMEABLE.** A candidate ships a trivially-green `test_patch` (one asserting `true`),
  never runs the real regression id (it stays `missing`, inert for the `some(fail)` check), and emits a
  RED diff => `all-observed-pass` => EMIT. The SWE-bench "rewrite the test to pass" attack.
- **The live path has NO sealed set.** The VC-W1b seam passes `{repo, issueRef, base_sha,
  candidate_patch, approvalHash}` — no `test_patch`, no `test_ids`, no sealed `failToPass`/`passToPass`.
  The corpus path has a sealed designation; a live arbitrary issue does not (the VC-W1 scope named this
  as O-TESTS + O-DEPS).

**Consequence:** VC-W2 as a TRUSTWORTHY anti-cheat gate is BLOCKED on a real regression oracle — the
repo's EXISTING suite run WHOLE (O-TESTS, needs O-DEPS to install deps in a network-denied sandbox), or
loom's added tests kept SEPARATE from the candidate patch (R3 tamper-resistance) with a sealed FTP set.
Until that exists, the disposition-decider can HONESTLY gate ONLY on an HONEST red (`test-failed` on a
run whose sealed regression set was threaded) — it CANNOT catch a candidate that games its own tests.
This is not a reason to abandon VC-W2; it is the honest sequencing: **the anti-cheat gate depends on
O-TESTS/O-DEPS (hard, operator-adjacent), not merely on the async plumbing.** A weak "the candidate's
declared tests are red" heuristic is still worth blocking on (it catches HONEST failures), but the scope
must NOT over-claim it as an anti-cheat gate.

## The async-await BLOCK barrier — RESOLVED to Option C (architect VERIFY F1)

The VC-W1b seam is POST-emit + fire-and-forget. To BLOCK, the verify must run BEFORE the emit AND its
verdict be AWAITED — but `emitPR` is SYNCHRONOUS (`withLockSoft` releases when the sync closure returns).
The first draft framed this as Option A (async `emitPR`, gate in-kernel) vs Option B (caller passes a
verdict in). **The board rejected that binary. Option C dominates:**

- **Option C (async pre-gate ADAPTER; kernel `emitPR` UNCHANGED) — RECOMMENDED.** A thin async wrapper
  (`emitPRVerified`) at the lab/caller boundary runs `verifyCandidate` (async, OUTSIDE any lock) => the
  VC-W2a decider => on BLOCK, it NEVER calls `emitPR`; on EMIT, it calls the still-sync `emitPR`
  unchanged. The sole live caller (`live-draft-run.js:323`) ALREADY `await`s the emit fn, so there is
  ZERO kernel change + zero caller ripple. It is NOT Option B: no verdict crosses a trust boundary INTO
  the kernel (the verdict is consumed in the same async frame that produced it — nothing to forge).
- **Option A (async `emitPR`) — DOMINATED.** It async-ifies the sole in-process egress chokepoint
  (ripple to `armedEmit`, `withLockSoft`, every sync test) to buy an "in-kernel gate" property that its
  OWN lock-hold mitigation (verify-BEFORE-lock) already surrenders — the verify runs outside the locked
  section either way. QUALITY-not-TRUST means the in-kernel property is not load-bearing (a bypassed
  quality gate = a red DRAFT PR a human still declines, not a trust breach). KISS + YAGNI => C.
- **Option B (caller passes a verdict `emitPR` gates on) — REJECTED** (hacker M1): a caller-supplied
  verdict is a self-asserted field with no provenance binding (#273 family) — a forged `{passed:true}`
  from any compromised link in the `opts` assembly chain emits a red candidate. `emitPR` deny-lists an
  injected `verifyFn` (`DISPOSITION_KEYS`) precisely to avoid trusting actor-adjacent policy; a passed-in
  VERDICT has no such guard. Rejected.

## The split (the load-bearing artifact)

| Piece | Owner | Live? | What it is |
|---|---|---|---|
| VC-W2a disposition-decider | Claude | dormant | a PURE fn keyed on the `(result_class, reason, resolved)` triple (below); UNWIRED; the anti-bypass core; O-ASYNC-independent (build-first, no rework — architect F2) |
| VC-W2b async pre-gate adapter | Claude (Option C) | dormant | `emitPRVerified` at the lab boundary: verify => decider => on EMIT call sync `emitPR`; behind a STRICT flag; kernel UNCHANGED |
| O-TESTS the regression oracle | Operator-adjacent | LIVE | the whole-suite mode (run the repo's EXISTING suite) OR sealed loom-added FTP, so EMIT gates on `resolved`, not gameable `observed-pass`. THE load-bearing blocker (C1) |
| O1 the strict arming flag | Operator | LIVE | strict explicit-truthy (a typo fails CLOSED per security.md) |
| O2 the Docker/Linux host | Operator | LIVE | the only fully-contained backend for untrusted execution (macOS H1-open) |
| O3 dep-provisioning | Operator | LIVE | the network-denied-sandbox dep model (O-DEPS; enables O-TESTS) |

**Security boundary (unchanged):** Claude scopes + builds the dormant mechanism (VC-W2a now; VC-W2b once
the oracle + flag exist); the operator provisions the oracle, the Docker host, the deps, and the flag,
and flips it. Claude NEVER flips an arming flag or runs an untrusted candidate on a live host.

## The disposition-decider (VC-W2a — the anti-bypass table, folded)

Keyed on the `(result_class, reason, resolved)` triple — NOT `passed` alone (honesty VERIFY: `passed=null`
COLLIDES across loom-side EMIT-advisory and candidate-side BLOCK causes). DEFAULT fail-CLOSED (BLOCK); a
can't-verify state is exactly what an adversary manufactures. EMIT gates on `resolved===true` (every
sealed FTP flips AND no sealed PTP regressed via `evaluateOutcome`), NOT gameable `observed-pass` (C1):

| result_class | reason / signal | disposition | why |
|---|---|---|---|
| CONTAINED_RESULT | `resolved===true` (sealed FTP flip + no PTP regress) | **EMIT** | the ONLY trustworthy pass — needs a sealed/whole-suite set (O-TESTS) |
| CONTAINED_RESULT | `test-failed` (an honest sealed-set red) | **BLOCK** | the gate's purpose |
| CONTAINED_RESULT | `no-observed-tests` (passed=null) | **BLOCK** (`zero-observed-signal`) | a one-line gate-skip (remove tests); fail-closed forces BLOCK (architect F3a + hacker H1) |
| CONTAINED_RESULT | `all-observed-pass` but NO sealed set threaded | **BLOCK** (`unsealed-pass`) | gameable (C1) — an observed-pass without a sealed regression set is NOT trustworthy; do NOT EMIT on it |
| KILLED_FOR_DOS | `resource-bound` | **BLOCK** | anti-bypass — a candidate that DoS'd its own verify does not emit |
| SETUP_FAILURE | `containment-uncertain` | **BLOCK** | the candidate's run never started the sentinel; candidate-attributable |
| SETUP_FAILURE | `candidate-patch-apply-failed` (a split-out of `backend-threw` on the applyPatch phase) | **BLOCK** | the candidate authored the patch that threw; candidate-attributable (architect F3b + hacker H2) |
| SETUP_FAILURE | `no-attested-backend` (no Docker host, pre-candidate) | **EMIT (advisory)** | the ONLY provably-loom-side infra fault; fail-open so infra gaps don't block legit candidates |
| any | unrecognized / undefined / missing reason | **BLOCK** | fail-CLOSED default; enumerate on the triple with a default-BLOCK switch, assert NON-VACUOUSLY (inject garbage, watch BLOCK fire) |

Note the two DEPENDENCIES this table now carries: (1) EMIT requires a SEALED regression set (O-TESTS) —
without it, every "pass" is `unsealed-pass` => BLOCK, so VC-W2 CANNOT EMIT on the live path until O-TESTS
lands; (2) `backend-threw` must be SPLIT in the adapter into an infra-phase throw (clone/attest =>
loom-side) vs a candidate-phase throw (applyPatch => candidate-side) — a container-adapter change, a
VC-W2 dependency (today `backend-threw` conflates them, `container-adapter.js:267-268`).

## Open questions (need the board / operator before ANY arming)

- **O-TESTS (THE blocker — hacker C1):** the sealed/whole-suite regression oracle. Without it EMIT is
  never trustworthy (observed-pass is gameable). Options: whole-suite mode (repo's existing suite; needs
  O-DEPS) OR loom's added FTP kept separate from the candidate patch (R3). Operator-adjacent + hard.
- **O-DEPS:** deps in a network-denied sandbox (two-phase / base-images / zero-dep-first) — enables O-TESTS.
- **O-BASE (hacker M2):** bind the base ONCE; verify AND emit against that pinned base; reject if it moved
  (operate on the handle, not the name — CWE-367). When `requestedBaseSha` is present the moved-base gate
  (`gh-emit.js:807`) fail-closes on divergence; the empty-`requestedBaseSha` path inherits the residual and
  the verdict is advisory-only.
- **backend-threw split:** the container-adapter must distinguish an infra-phase throw from a
  candidate-phase (applyPatch) throw before the SETUP_FAILURE row can fail-open safely.

## Recommended first sub-wave

Build **VC-W2a — the disposition-decider** dormant (a PURE fn + tests, in `packages/lab/verify-container/`,
UNWIRED): the folded anti-bypass table above, keyed on the `(result_class, reason, resolved)` triple,
fail-CLOSED default, EMIT ONLY on `resolved===true` (so an unsealed observed-pass BLOCKs — the C1 fix
baked in). It needs NO operator decision and NO async restructure (O-ASYNC-independent — architect F2),
and it FORCES the C1/O-NULL/backend-threw decisions into a pure, unit-testable, non-vacuous surface.
Defer VC-W2b (the Option-C pre-gate adapter) until O-TESTS + the flag exist; O-TESTS/O-DEPS/the Docker
host wait on the operator. **Honest headline: VC-W2a is buildable now, but VC-W2 cannot ARM a trustworthy
gate until O-TESTS lands — the decider will BLOCK every live candidate (unsealed-pass) until then.**

## Security invariants (carry verbatim)

- verify-container stays QUALITY, not TRUST: a PASS is advisory evidence for the human approver, never a
  trust weight / `world_anchored` / `LIVE_SOURCES` (OQ-NS-6; #273-disjoint).
- ANTI-BYPASS: the disposition DEFAULT is fail-CLOSED (BLOCK); EMIT requires a SEALED-regression
  `resolved===true`, never a gameable `observed-pass`. A can't-verify state (DoS, containment-uncertain,
  candidate-patch-apply-failed, unrecognized, unsealed-pass) does NOT emit. Only `no-attested-backend`
  (provably loom-side, pre-candidate) fails open.
- Option C keeps the kernel `emitPR` UNCHANGED (no async, no passed-in verdict); a verdict NEVER crosses a
  trust boundary into the kernel (rejecting Option B's forged-verdict hole).
- the arming flag is STRICT explicit-truthy (a typo fails CLOSED); flag-off => byte-identical.
- Claude scopes + builds the dormant mechanism; the operator provisions O-TESTS/O-DEPS/the Docker host +
  the flag and flips it. Claude NEVER flips an arming flag or runs an untrusted candidate on a live host.

## VERIFY result (3-lens board, 2026-07-03 @ this scope pre-build)

- **honesty-auditor: SOUND** — 7/7 current-state claims TRUE (grade A, NO-OVERCLAIM): `emitPR` sync in
  `withLockSoft`, the `runLiveLoop` manual-async-lock precedent (EMIT-OFF), the verdict/reason vocabulary,
  the container-adapter taxonomy, the moved-base gate `:807`, and the dormancy (zero prod `verifyFn`
  injectors). Build-note folded: key the decider on `(result_class, reason)` not `passed` alone.
- **architect: NEEDS-REVISION** — O-ASYNC is a false binary; **Option C** (async pre-gate adapter, kernel
  unchanged) dominates A (which surrenders its in-kernel property via its own lock-hold mitigation) and B
  (forgeable verdict). VC-W2a is O-ASYNC-independent (build-first, no rework). Two table gaps: O-NULL =>
  BLOCK, `backend-threw` over-broad. All folded above.
- **hacker: NEEDS-REVISION** — **C1 (CRITICAL):** the decider grades EMIT off the candidate's `observed`
  map, never the sealed `evaluateOutcome`; a green-test candidate emits a red diff, and the live path has
  no sealed set => O-TESTS is the load-bearing blocker. H1 (O-NULL => BLOCK), H2 (`backend-threw` split),
  M1 (reject Option B), M2 (bind base once, handle-not-name), L1 (triple-key, non-vacuous). All folded.

Verdict after fold: the scope now (1) leads with the C1 oracle blocker (VC-W2 arming needs O-TESTS, a hard
operator-adjacent dependency), (2) recommends Option C (kernel unchanged), (3) gates EMIT on `resolved`
never `observed-pass`, (4) resolves O-NULL + `backend-threw` to BLOCK, (5) pins the base binding. VC-W2a
(the dormant decider) is the buildable first slice; VC-W2 cannot ARM a trustworthy gate until O-TESTS lands.
