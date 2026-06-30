---
lifecycle: persistent
---

# PR-A2b W2b cross-verifier NaN-hardening — `typeof === 'number'` -> `Number.isInteger` at C2/C2.5 across all three custody verifiers

**Status:** prepared on an integration base (`main` + #466 + #467); PR HELD until #466 + #467 merge, then
rebased onto fresh `origin/main`.
**Relation:** the follow-up the #467 sibling-hardening plan deferred under its "Scoped-out" section
(`2026-06-30-pra2b-w2b-sibling-broker-actor-hardening.md`): "a separate cross-verifier hardening pass that
converts `typeof === 'number'` -> `Number.isInteger` at C2/C2.5 across all three verifiers (broker + actor +
edge) together." Depends on BOTH #466 (introduces the edge verifier) and #467 (broker/actor C0 + euid
realignment) being on `main` — otherwise the three cannot be hardened byte-identically in one pass.

## Problem

The C2 (owner-disambiguation) and C2.5 (wrapper-owner) checks guard with `typeof x === 'number'`, which is
TRUE for `NaN`. A synthetic-facts direct caller passing a forged non-integer (`NaN`) `keyStat.ownerUid`,
`runningUid`, or `wrapper.ownerUid` slips past the guard; the subsequent `x === runningUid` is then always
false, so the C2 denial leg falls through to its "owned by a DIFFERENT uid" **PASS** + sets
`denialLegTaken`/`requiresOutOfBandUidConfirmation`.

- For the `runningUid: NaN` axis the overall verdict is fail-closed at C0 (the `!Number.isInteger` C0 guard
  shipped in #466/#467), so it is only a dishonest per-check PASS LINE — no security bypass.
- For the `keyStat.ownerUid: NaN` axis (with a valid `runningUid`) C0 does NOT fire, so the WHOLE verdict
  `hostObservableChecksPassed` goes green on a forged key owner. Still not reachable in production — the real
  `gather*CustodyFacts` derives `ownerUid` from `lstatSync().uid` (always int) and `runningUid` from
  `getuid()/geteuid()` (int|null, never NaN) — so this is a synthetic-facts robustness/honesty fix, not a live
  bypass. But it is a stronger latent surface than a per-check-only line.

## Scope (exactly the `typeof -> Number.isInteger` swap; three source files + three test files)

`typeof X === 'number'` -> `Number.isInteger(X)` at the C2 + C2.5 guard sites, applied byte-identically so the
verifiers do not diverge (the whole point):

- `packages/kernel/egress/loom-custody-verify.js` (broker): C2 owner guard + C2.5 host-owned guard.
- `packages/kernel/egress/loom-actor-custody-verify.js` (actor): C2 owner guard + C2.5 host-owned guard.
  C4 exec-target `ownerUid` comparison (`t.ownerUid !== 0`) is ALREADY NaN-safe (`NaN !== 0` is true -> the
  target is pushed to `bad` -> C4 FAILs) — verified, left unchanged (no per-check false-PASS there).
- `packages/kernel/egress/loom-edge-custody-verify.js` (edge): C2 owner guard + C2.5 owner-unavailable rung
  (`typeof w.ownerUid !== 'number'` -> `!Number.isInteger(w.ownerUid)`) + C2.5 host-owned guard.

### What the swap fixes vs. what it aligns (honest scope)

- **C2 denial leg — genuine PASS -> FAIL flip** (all three). A forged NaN `keyStat.ownerUid` / `runningUid`
  now FAILs C2-denied ("key OWNER is unreadable") instead of falsely PASSing. This is the non-vacuous,
  RED-before test.
- **C2.5 host-owned guard (broker/actor) — consistency only.** The guard is a fail-IF-host-owned condition;
  `NaN === runningUid` is false under both `typeof` and `Number.isInteger`, so a NaN wrapper owner PASSes
  C2.5 either way (broker/actor C2.5 intentionally rejects only host-owned/writable, not unidentifiable
  owners — a pre-existing laxer contract than the edge's root-owned rung; NOT widened here, out of scope).
  The swap keeps the guard expression byte-identical with C2 and the edge idiom; no verdict change.
- **C2.5 edge owner-unavailable rung — message/rung change, not a verdict flip.** A NaN/float owner already
  FAILs the edge C2.5 (at the `w.ownerUid !== 0` root rung). The swap moves the FAIL to the clearer
  "owner uid unavailable" rung and aligns the `Number.isInteger` idiom.

## Test (non-vacuous, proven RED before the guard)

One forged-NaN C2 denial-leg test per suite (`tests/unit/kernel/egress/loom-*custody-verify.test.js`),
asserting `C2-denied` is FAIL (not PASS) and no false denial leg, on both the `keyStat.ownerUid: NaN` and
`runningUid: NaN` axes. Proven RED against the unhardened `typeof` guard, GREEN after the swap.

## Runtime Probes (claim -> probe -> result)

- Claim: `#466` + `#467` are both OPEN, neither on `main`; the edge verifier exists only on `#466`. Probe:
  `gh pr list` + `git cat-file -e origin/main:...loom-edge-custody-verify.js`. Result: confirmed — base must
  be `main` + both merges.
- Claim: `#467` does NOT touch the C2/C2.5 `typeof` lines (no collision). Probe:
  `git diff origin/main...origin/fix/egress-broker-actor-align-w2b` grep typeof/C2. Result: confirmed — it
  touches only C0 + the gather euid return.
- Claim: the merge of `#466` + `#467` is conflict-free. Probe: `git merge` both into a worktree off
  `origin/main`. Result: clean, no conflicts.
- Claim: forged `keyStat.ownerUid: NaN` yields a green verdict pre-fix (C0 does not catch it). Probe: the new
  C2 forged-NaN test run against the UNHARDENED guard. Result: CONFIRMED RED — each suite reported exactly 1
  failure (`'PASS' !== 'FAIL'` at C2-denied) before the swap; all other tests green (broker 12/1, actor 28/1,
  edge 16/1). After the swap: broker 13/0, actor 29/0, edge 17/0.

## Verification plan (DEPLOYED-adjacent security code, full per-wave rigor)

3-lens VERIFY (architect/code-reviewer/hacker on the planned diff) -> TDD build (RED then GREEN) -> full
kernel suite + `install.sh --hooks --test` -> 3-lens VALIDATE (code-reviewer/hacker/honesty-auditor on the
built diff) -> CodeRabbit pre-PR (secret-free tree) -> PR, no auto-merge, HELD until #466 + #467 merge.

## VALIDATE result (3-lens on the BUILT diff + CodeRabbit, on the integration base)

- **code-reviewer: SHIP** (0 findings). Swap closes the forged-NaN C2 false-positive with no regression; C2
  guard byte-identical across all three; edge C2.5 asymmetry (extra root-owned rung) intentional + correct;
  actor C4 `t.ownerUid !== 0` NaN-safe; the three new tests non-vacuous. 59/59 egress-verifier tests green.
- **hacker: SHIP** — 100+ forged-fact live probes across 6 `node` scripts against the BUILT modules, 0 bypasses.
  Every non-integer uid axis (`NaN`/`Infinity`/`"501"`/`{valueOf}`/`1.5`/`-Infinity`) now hard-FAILs C2-denied on
  all three; actor C4 fail-closed (only literal `0` passes); broker/actor C2.5 lax-PASS on a non-int owner is
  by-design (synthetic-only, unreachable via `lstatSync().uid`) and the edge twin fail-closes; legit cross-uid
  TRUE branch preserved. 2 LOW (out-of-scope, do-not-block) — see residuals.
- **honesty-auditor: SHIP-WITH-NITS** (A-, 7/7 load-bearing claims SUPPORTED). 2 LOW prose nits, both folded into
  the framing below: lead with the `keyStat.ownerUid: NaN` axis as THE fix (the only verdict flip), frame the
  `runningUid: NaN` axis as a per-check-line honesty fix already backstopped by C0, and KEEP the three-way
  honest-scope distinction (genuine flip / consistency-only / message-only) verbatim — do NOT compress to
  "hardened C2/C2.5 across all three" (that would silently over-claim the broker/actor C2.5).
- **CodeRabbit (uncommitted delta): 4 minor**, all one class — the `runningUid: NaN` test branch asserted only
  C2-denied, not the two verdict flags. FOLDED across all three suites (`hostObservableChecksPassed:false` +
  `requiresOutOfBandUidConfirmation:false` now asserted for the runningUid axis too). Re-ran green (13/29/17).

## Residuals (named, deferred by design)

- **Non-uid synthetic-facts axes (hacker LOW-1, out of scope).** The exported pure `assess*` fns also admit a
  forged `keyStat.size` (string/`Infinity`) or non-boolean `isFile` that can green the verdict. NOT uid guards,
  NOT this diff's scope, and unreachable via the real `gather*` path (`lstatSync()` returns a numeric `size` +
  boolean `isFile()`). A same-class `Number.isInteger(ks.size)` / `typeof ks.isFile === 'boolean'` pass would make
  the pure fns fully self-defending — a candidate follow-up, deliberately not bundled here (scope discipline).
- **Broker/actor C2.5 lax-PASS on a non-integer owner (hacker LOW-2)** is by-design (the rung asserts only
  "not the host uid"; a NaN owner provably is not the integer host uid). The edge twin's stricter
  `!Number.isInteger(w.ownerUid)` fail-close is the correct pattern where root-ownership is the contract; the
  asymmetry is intentional and documented. Not widened here.

## SHADOW/LIVE note

All three are operator-run out-of-band verifiers; none is on the inert `LIVE_SOURCES` weight path. The change
is correctness/honesty of the per-check report (and, for the `keyStat.ownerUid` axis, the synthetic-facts
verdict); no behavior change on any real gather path (`gather*CustodyFacts` derives `ownerUid` from
`lstatSync().uid` and `runningUid` from `Number.isInteger(euid) ? euid : ruid`, neither of which yields NaN).
