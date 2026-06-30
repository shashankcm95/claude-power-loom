---
lifecycle: persistent
---

# PR-A2b W2b sibling-hardening — align LIVE broker + actor egress with the merged edge-signer idiom

**Status:** in-progress (branch `fix/egress-broker-actor-align-w2b`)
**Relation:** sibling to PR #466 (W2b cross-uid edge-signer transport). The two fixes below were
folded into the NEW SHADOW edge-signer files in #466 after CodeRabbit flagged them; the SAME two
patterns exist verbatim in the LIVE/deployed broker + actor egress chain and were intentionally NOT
touched in the SHADOW edge wave to keep that diff scoped. This wave applies the aligned fixes to the
deployed code. Each is low-impact but a real correctness/robustness improvement.

## Scope (exactly two fixes, three source files + one test)

### FIX 1 — effective-uid for the C2 owner check (functional correctness of a security verifier)

- Files: `packages/kernel/egress/loom-custody-verify.js` (`gatherCustodyFacts`) AND
  `packages/kernel/egress/loom-actor-custody-verify.js` (`gatherActorCustodyFacts`).
- Both returned `runningUid: ruid` (the REAL uid), but `assessCustody`/`assessActorCustody` document
  that POSIX perms use the EFFECTIVE uid; the C2-denied open() is evaluated against euid. On a
  setuid/seteuid launch (euid != ruid) the owner-disambiguation compares against the wrong uid and
  misclassifies file-mode lockdown vs real cross-uid separation.
- Fix (mirror merged `loom-edge-custody-verify.js`): add
  `const runningUid = Number.isInteger(euid) ? euid : ruid;` and return `runningUid` (not
  `runningUid: ruid`). Keep `isRoot = ruid === 0 || euid === 0`.

### FIX 2 — keep-draining after the stdin size cap (avoid EPIPE on a streaming caller)

- File: `packages/kernel/egress/loom-broker-sign.js` (`readStdinBounded`).
- The too-large branch did `return finish({ ok:false, reason:'too-large' })` immediately, pausing
  stdin mid-stream; a streaming caller still writing can EPIPE/short-write.
- Fix (mirror merged `loom-edge-sign.js`): `let tooLarge = false;`; onData MARKs + keeps DISCARDING
  (`chunks.length = 0`) past the cap; onEnd refuses iff `tooLarge`. Memory stays bounded; the deadline
  still bounds time.

## Runtime Probes (claim → probe → result)

- Claim: the merged edge idiom is exactly as described. Probe: read
  `loom-edge-custody-verify.js:150-157` + `loom-edge-sign.js:46-71` in the #466 worktree. Result:
  confirmed verbatim.
- Claim: no external consumer reads `gather*CustodyFacts().runningUid`. Probe: `grep runningUid` over
  egress + tests. Result: only internal gather→assess; pure-assess tests inject `runningUid`
  synthetically, so swapping the gather value source keeps them green.
- Claim: the euid≠ruid branch is not unit-testable (vacuous on a normal box). Probe: euid===ruid
  without a setuid binary; W2b added no euid-gather test. Result: match precedent (no vacuous test).
- Claim: the broker oversized test is vacuous w.r.t. the drain (junk basis). Probe: read
  `loom-broker-sign.test.js:145-154`. Result: confirmed — strengthen to a MATCHING basis so the
  size-cap is the sole possible refusal reason (mirrors edge-sign's D5(i) reasoning).

## Verification plan (full per-wave rigor — DEPLOYED security code)

3-lens VERIFY (architect/code-reviewer/hacker on the planned diff) → TDD build → full kernel suite +
`install.sh --hooks --test` → 3-lens VALIDATE (code-reviewer/hacker/honesty-auditor on the built
diff) → CodeRabbit pre-PR (secret-free tree) → PR, no auto-merge.

## Pre-Approval Verification (3-lens VERIFY on the planned diff)

architect / code-reviewer / hacker — all **SHIP-WITH-NITS**. Folded:
- M1 (hacker MEDIUM): broker `assessCustody` C0 lacked the `!Number.isInteger` guard its actor + edge twins
  carry; a forged `NaN` runningUid would C0-PASS then C2 false-PASS. Brought to parity + a NaN->FAIL test.
- Comment-porting (architect/hacker L1/L2): ported the euid + keep-drain rationale comments alongside the
  one-liners.

## VALIDATE result (3-lens on the BUILT diff + CodeRabbit)

- **code-reviewer: SHIP** (0 findings) — all 48 egress tests pass; non-vacuity of both new guards real.
- **hacker: SHIP** — 12 live probes against the built code, 0 bypasses. Confirmed firsthand: the WHAT/
  recompute-bind gate runs ONLY on a fully-drained `ok:true` body; `tooLarge` is monotonic; the cap is strict
  (no off-by-one signing an oversized body); a 10MB stream under a 64MB heap does not OOM; no EPIPE crash;
  multibyte UTF-8 cannot undercount. 1 LOW (below).
- **honesty-auditor: SHIP** — 2 NITs, both folded: (1) broker `assessCustody` JSDoc wrapper shape was missing
  `ownerUid:number` (the C2.5 code reads it; the actor + edge twins declare it) -> added, completing the
  twin-parity; (2) the strengthened oversized test asserted only `r.ok===false` -> added
  `assert.match(r.stderr, /too-large/)` so "size-cap is the sole refusal reason" is true by assertion, not only
  by the matching-basis construction.
- **CodeRabbit: 2 minor** — both premise-probed firsthand and SCOPED OUT (see below).

### Scoped-out (deliberate, documented): the C2/C2.5 forged-`NaN` surface

CodeRabbit (CR-1 runningUid axis, CR-2 ruid-fallback) + the hacker-LOW (ownerUid axis) all flag the same latent
pattern: a forged non-integer fact (`NaN`) flows past the `typeof === 'number'` guards at C2/C2.5, producing a
misleading per-check PASS line. NOT folded, because:
1. **No security impact** — the overall verdict is already fail-closed for `NaN`: C0 FAILs -> `hostObservableChecksPassed:false` -> CLI exit 1 ("NOT VERIFIED"). The per-check PASS lines never flip the verdict, and the report headline + the C0 FAIL line are right there. Probed firsthand.
2. **Unreachable via the real path** — `gather*CustodyFacts` derives `runningUid` from `getuid()/geteuid()` (int|null, never NaN) and `ownerUid` from `lstatSync().uid` (always int). Only a synthetic-facts direct caller can produce it.
3. **Shared verbatim with the merged twins** — `loom-edge-custody-verify.js:99/126` uses the identical `typeof === 'number'` pattern. Hardening only the broker would CREATE the cross-verifier divergence this wave exists to remove. CR-2's proposed `Number.isInteger(ruid) ? ruid : null` is also a false positive (ruid is never a non-integer) and would diverge from the merged `Number.isInteger(euid) ? euid : ruid` idiom.

Right home: a separate cross-verifier hardening pass that converts `typeof === 'number'` -> `Number.isInteger`
at C2/C2.5 across all three verifiers (broker + actor + edge) together, if desired. Tracked, not done here.

## SHADOW/LIVE note

`loom-broker-sign.js` is LIVE/deployed (the broker key-loader). The two custody-verify tools are
operator-run out-of-band verifiers. None of these three is on the inert `LIVE_SOURCES` weight path;
the fixes are correctness/robustness, no behavior change to the approval/emission decision.
