---
lifecycle: persistent
---

# F-W4 M2 — `expectedForkOwner` from a custody file (Q-M2=c); SHADOW/dormant

**Status:** BUILT + 3-lens VALIDATE SHIP → PR pending USER merge. Kernel-egress security diff (Rule 2 → architect + code-reviewer + hacker at VERIFY; code-reviewer + hacker + honesty-auditor at VALIDATE). SHADOW/dormant/byte-identical.

## Context

F-W4 arms the fork→cross-repo-PR path. `expectedForkOwner` binds the fork write to LOOM's
bot identity (C1). Today it would arrive as an `armedEmit` arg; per #273 (integrity is not
provenance) a value the actor can influence must not steer the write, so M2 reads it from a
source OUTSIDE the actor envelope. **Q-M2 RESOLVED (c) — a custody file co-located with the
token** (USER-decided 2026-07-03): a `custodyForkOwnerPath` sibling to `custodyTokenPath`,
read via a `resolveExpectedForkOwner` reader that mirrors `resolveToken` exactly. Same custody
trust root as the token; matches the module's existing convention (token / disposition /
verify-key all resolve from a `custody*Path`).

**What M2 is NOT (honesty — hacker VERIFY H-LOW on the prior scope):** this NARROWS the surface
(removes the owner from actor-supplied bytes) but is NOT a trust anchor. A custody/deploy value
is still SAME-UID co-forgeable per the repo's #273 canon; `expectedForkOwner` only BINDS the
write target to a claimed owner login. It is defense-in-depth. The authorization roots stay the
signed approval (`approvalHash`) + the token capability; M2 does not change that.

## Runtime Probes (verified against the tree 2026-07-03)

- **P1 — `validateForkIdentity` runs on EVERY path; its owner assertion is `!== undefined`-gated.**
  Probe: `gh-emit.js:759` calls `validateForkIdentity({upstreamRepo, forkRepo, expectedForkOwner})`
  unconditionally; `:500` = `if (expectedForkOwner !== undefined && forkOwner !== String(expectedForkOwner).toLowerCase()) throw`.
  → On the non-fork path (`forkRepo` undefined ⇒ `resolvedForkRepo === upstreamRepo` ⇒ `forkOwner === upstreamOwner`),
  passing a bot login as `expectedForkOwner` THROWS `fork-identity-mismatch` (upstreamOwner ≠ bot).
  **The dormancy invariant: `expectedForkOwner` and `forkRepo` are both-present (armed) or both-absent (dormant).**
- **P1a — THE `null` TRAP (caught at design time).** `:500` checks `!== undefined`, and `null !== undefined` is TRUE.
  So a reader that returned `null` on absence (the `resolveToken` convention) would make `expectedForkOwner: null`
  ⇒ `String(null).toLowerCase() === "null"` ⇒ `forkOwner !== "null"` ⇒ **THROW on the non-fork path** = a
  dormancy-breaking regression. → **`resolveExpectedForkOwner` MUST return `undefined` (not `null`) on
  absent/unreadable/empty/invalid.** This mirrors the existing `requestedBaseSha: apprRequestedBaseSha` thread
  (already passed as possibly-`undefined` on the prod call), which the sibling moved-base gate handles the same way.
- **P2 — the C1 MANDATORY enforcement ALREADY EXISTS; M2 only SUPPLIES the value.** Probe:
  `ensureFork` (`gh-emit.js:594`) is called ONLY under `isForkMode` (`:767`); `:597` fail-closes
  (`fork-owner-required`) when `expectedForkOwner` is absent/empty in fork mode; `verifyForkRepo`
  (`:550`) re-checks the API's ACTUAL owner `=== expectedForkOwner`. → M2 builds NO new mandatory
  gate; it wires the custody source. A half-arm (`forkRepo` set, custody file forgotten) fails
  closed at `:597`.
- **P3 — prod is dormant.** Probe: the prod `armedEmitFn(...)` call (`emit-pr.js:545`) passes
  `{draft, token, ghConfigDir, approvalHash, requestedBaseSha}` — neither `forkRepo` NOR (after M2)
  `custodyForkOwnerPath`. → prod passes no `custodyForkOwnerPath` ⇒ reader returns `undefined` ⇒
  byte-identical. Arming is the operator's O3 (deploy the custody file) + O4 (add both opts).
- **P4 — the reader template + shared regex are in-module.** Probe: `resolveToken`
  (`emit-pr.js:354-361`) = `readFileSync(path,'utf8').trim()`, null on absent/unreadable.
  `OWNER_RE = /^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/` (`emit-pr.js:119`, already exported); GitHub login
  max = 39 (`gh-emit.js:72 MAX_OWNER_LEN`, a stable platform fact). `emitEgressAlert` imported at
  `emit-pr.js:41`. → the reader lives in emit-pr.js with zero new deps.

## The change (all in `packages/kernel/egress/emit-pr.js` + tests; no new .js file)

1. **New reader `resolveExpectedForkOwner({ custodyForkOwnerPath })`** (near `resolveToken`):
   returns `undefined` when the path is absent / unreadable / empty (P1a — NOT `null`); on a
   PRESENT-but-malformed value (fails `OWNER_RE` or exceeds the login-max) emits an OBSERVABLE
   `fork-owner-custody-invalid` alert (operator-misconfig vs the downstream attack-shaped
   `fork-owner-unsafe`; security.md "fail-closed must be OBSERVABLE") and returns `undefined`
   (fail-closed — downstream `ensureFork:597` still fail-closes when armed). Returns the trimmed
   login otherwise (casing preserved; downstream lowercases both sides).
2. **Thread it** — resolve `const expectedForkOwner = resolveExpectedForkOwner({ custodyForkOwnerPath: opts.custodyForkOwnerPath })`
   near the other resolves (`emit-pr.js:490`), and pass `expectedForkOwner` into the `armedEmitFn(...)`
   call (`:545`), positioned exactly like the sibling `requestedBaseSha`.
3. **Deny-list** — add the SINGLE camelCase `custodyForkOwnerPath` to `DISPOSITION_KEYS` (the
   3-spelling convention applies to actor-supplied VALUE vocabulary like `forkRepo`, NOT to a
   `*Path` opts-plumbing key the orchestrator sets — code-reviewer VERIFY F1; matches every existing
   `custody*Path` key). Belt-and-suspenders: the actor controls `data`, the reader reads `opts`, but
   the deny-list guarantees `data` cannot even NAME the policy key.

**Dormancy proof:** prod passes no `custodyForkOwnerPath` ⇒ reader returns `undefined` ⇒
`armedEmitFn({..., expectedForkOwner: undefined})` ⇒ `validateForkIdentity:500` `undefined !== undefined`
is false ⇒ skipped ⇒ identical to today. The `requestedBaseSha` sibling already establishes that a
possibly-`undefined` value threaded into that call is byte-identical (no key iteration downstream —
`armedEmit` / `ghEmit` / `validateForkIdentity` only destructure).

## Test plan (`tests/unit/kernel/egress/emit-pr.test.js`, additive)

- **Reader:** absent path → `undefined`; `typeof custodyForkOwnerPath !== 'string'` → `undefined`;
  unreadable → `undefined`; empty/whitespace file → `undefined`; valid login → the trimmed value
  (mixed-case preserved); malformed (`a/b` slash, `>39` chars, `bad*char`, leading `-`) → `undefined`
  plus a `fork-owner-custody-invalid` alert observed.
- **P1a null-trap regression (load-bearing):** `resolveExpectedForkOwner` returns `=== undefined`
  (assert NOT `null`) on absence — the guard for `validateForkIdentity:500` byte-identity.
- **Dormancy:** an `emitPR` with NO `custodyForkOwnerPath` threads `expectedForkOwner: undefined`
  into an injected `armedEmitFn` (assert the received arg is `undefined`), and does not throw.
- **Armed threading:** `emitPR` with `opts.custodyForkOwnerPath` → the injected `armedEmitFn`
  receives `expectedForkOwner === <the custody value>`.
- **Deny-list:** the single camelCase `custodyForkOwnerPath` is covered by the existing EC1b.3 test,
  which iterates `E.DISPOSITION_KEYS` → `data` carrying it → `emitPR` rejects (`policy key`).

## HETS Spawn Plan (3-lens VERIFY — kernel-egress security diff, Rule 2)

Read-only lenses in parallel over THIS plan (pre-build):
- **architect** — the reader/thread factoring, the `undefined`-not-`null` contract, whether M2
  should add an explicit `forkRepo`⇔`expectedForkOwner` coupling guard or rely on the existing
  fail-closed net (P2), the reader-validates-vs-DRY tension.
- **code-reviewer** — correctness of the null-trap avoidance, the deny-list spelling parity, error
  handling, the dormancy byte-identity claim, edge cases (empty file, symlink parity with
  `resolveToken`).
- **hacker** — can an actor influence `expectedForkOwner` despite the custody read? deny-list
  bypass (spelling/casing/prototype)? a custody value that is valid `OWNER_RE` but a wrong/attacker
  login (the co-forge H-LOW — is M2 honestly scoped as defense-in-depth, not a trust anchor)?
  the half-arm hazards (P2), and any path where the reader returning `undefined` silently drops the
  binding on the ARMED path.

## Routing Decision

```json
{ "recommendation": "route", "rationale": "kernel-egress security-sensitive diff (#273-adjacent, the sole emitPR chokepoint); Rule 2 mandates the 3-lens VERIFY tier for kernel/security/egress changes regardless of size." }
```

## Disposition

SHADOW/dormant, byte-identical in prod. M2 is the last mechanism-side F-W4 piece; the operator
half (O3 deploy the custody file, O4 the arming edit) stays operator-owned. On the user's go after
VERIFY: TDD build → 3-lens VALIDATE (hacker live-probes the built reader/thread) → PR → USER merge.

## VERIFY result (3-lens, pre-build)

All three lenses **SOUND** — 0 CRITICAL, 0 HIGH, 0 dormancy break, 0 exploitable bypass (hacker: 7 probes).

Folds applied to the build:
- **[cr F1 > architect F6, adjudicated] Single-spelling `custodyForkOwnerPath`** in `DISPOSITION_KEYS`
  (every existing `custody*Path` key is single-spelling; 3-spelling is the actor-supplied *value* class only).
- **[hacker M3 / architect F2 / cr F2] Strict `undefined` (never `null`) on ALL FIVE reader branches** —
  the P1a load-bearing contract, extended by the hacker to the *malformed* branch specifically.
- **[hacker M1] Explicit `> GITHUB_LOGIN_MAX_LEN` clause** distinct from `OWNER_RE` (which is length-blind — a
  40-char value passes it).
- **[architect F4 / cr F3] Extracted `39` → `GITHUB_LOGIN_MAX_LEN`** in emit-pr.js, shared with the existing
  `assertSafeRepoRef` hardcode (correctness-neutral; the reverse import from gh-emit would cycle).
- **[architect F3] NO coupling guard** — the both-present/both-absent invariant is enforced by two disjoint
  fail-closed gates (`ensureFork:597` + `validateForkIdentity:500`); a pointer comment at the thread-site instead.
- **[architect F5] Bounded alert payload** (`.slice(0,80)` on the path + `length`; the raw malformed value is
  NEVER echoed).
- **[architect F2] Dormancy test** asserts `'expectedForkOwner' in seen && seen.expectedForkOwner === undefined`
  (explicit-undefined ≡ key-omission under destructuring). The `requestedBaseSha` analogy demoted (its absence
  fails at a shape-guard, not the identity-equality — asymmetric).
- Honesty: the plan's "mirrors resolveToken *exactly*" softened to "mirrors the read pattern, returns `undefined`
  not `null`".

### Build note — a VERIFY-fold CORRECTION (the BOM/trim finding)

The code-reviewer's F5 claim ("`.trim()` does NOT strip a BOM") was **empirically wrong**: `String.prototype.trim()`
DOES strip U+FEFF (it is ECMAScript WhiteSpace / ZWNBSP). Confirmed by probe: `'\uFEFFLoomBot'.trim() === 'LoomBot'`.
So a *leading* BOM in the custody file resolves to the clean login `LoomBot` (accepted — tolerant of an editor
artifact; SAFE, the trimmed value carries no BOM to inject). A *mid-string* BOM (`'Loom\uFEFFBot'`) survives trim,
fails `OWNER_RE`, and fail-closes with the alert — the correct behavior. The reader is safe under both; the tests
were corrected to match the real trim semantics (the leading-BOM case moved to the valid-login test; a mid-string
BOM added to the malformed set). This is the "a green TDD suite is not proof; probe the real path" discipline paying
off at build time.

Tests: emit-pr 79/0, gh-emit 65/0, full kernel suite 116 files / 0 failures; eslint clean; 0 irregular-whitespace.

## VALIDATE result (3-lens, post-build over the BUILT diff)

- **hacker (Rule 2a — LIVE-probed the built reader): SHIP-WITH-NOTES.** ~90 probe inputs across 8 harnesses;
  **0 exploitable-now bypasses, 0 auth bypasses.** Found ONE real bug the unit suite missed (only a multi-MB
  live probe surfaced it): **the length cap ran AFTER `OWNER_RE`**, so a >8.4 MB all-alnum custody file made
  `OWNER_RE`'s `(?:-?[A-Za-z0-9])*` stack-overflow → an unguarded `RangeError` ESCAPED the reader (no alert),
  violating the "never throws, always undefined" P1a contract (contained by emitPR's outer catch + prod-dormant,
  but latent for the exported reader + an arming-time observability break). **FOLDED — reorder to cap-first
  (`raw.length > GITHUB_LOGIN_MAX_LEN || !OWNER_RE.test(raw)`), proven byte-identical; + a 12 MB regression test
  (undefined + alert, no throw).** Findings 2 (valid-shape wrong-bot login) + 3 (symlink-follow) = by-design
  defense-in-depth gaps, correctly downstream-anchored (`verifyForkRepo:550` / `ensureFork:597,605`) — no change;
  symlink is the same same-uid surface as `resolveToken` (an arming-time O_NOFOLLOW decision for ALL four custody
  readers, not this wave).
- **code-reviewer: SHIP.** All 7 VERIFY folds confirmed applied (per-fold table); const-swap correctness-neutral;
  byte-identical dormancy confirmed by trace; suites green; eslint clean. 2 LOW (a canonical VERIFY-fold record +
  F5-correction propagation) — both covered by this `## VERIFY result` section.
- **honesty-auditor: CLAIMS-SOUND (grade A).** Byte-identical dormancy is PROVEN not asserted; defense-in-depth-
  not-trust-anchor framed honestly (no #273-close implied); the C1 gates exist; the BOM correction disposed
  honestly (both directions tested); symlink honestly framed as untested-convention. 1 MED = two stale plan-prose
  lines (§"The change" item 3 + §"Test plan") that still said 3-spelling — **FOLDED** (corrected to single-spelling).

Post-fold tests: emit-pr 80/0 (incl. the 12 MB regression), full kernel suite 116/0; eslint clean; the 12 MB
direct probe returns `undefined` + the `fork-owner-custody-invalid` alert, no throw. SHADOW/dormant/byte-identical.
