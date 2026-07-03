---
status: BUILD
plan-of: VC-W1b, the emit-pr injected-verifier SEAM half of the VERIFY-blessed VC-W1 (the lab slice VC-W1a merged as #493). A DORMANT, fail-open, throw-swallowing injected verifier fn wired into the emitPR chokepoint AFTER a successful emit (the additive join-key position); no verifier is injected in production, so the emitted bytes are byte-identical. Kernel stays lab-agnostic (injected fn, K12). SHADOW/advisory QUALITY, never TRUST (OQ-NS-6). The real Docker-backed run stays gated on O-INPUTS/O-DEPS/O-HOST (operator). REVISED per the 3-lens VERIFY (position flipped before->after; see the VERIFY result).
---

# VC-W1b — the emit-pr injected-verifier seam (dormant)

VC-W1a (#493 `1dc75fb`) built the lab slice: `verifyCandidate` (wraps `ContainerAdapter.run`,
MockBackend-default) + the advisory sidecar + the trust-axis structural exclusion dam. VC-W1b installs
the SEAM in the kernel egress chokepoint (`emit-pr.js`) so a verifier CAN be injected — dormant in
prod. Canonical contract + the 3-lens VERIFY that blessed the seam design:
`packages/specs/plans/2026-07-03-verify-container-scope.md`.

## Runtime probes (grounded 2026-07-03 @ `43af0a2`; re-confirmed by the VERIFY honesty lens 10/10)

- `emitPR(data, opts)` is at `emit-pr.js:467`; it builds a frozen `draft` (`{repo, issueRef, title,
  touched_paths, diff}`) at `:508` FROM the SCRUBBED diff (`scrubEmitDiff(data.diff)` at `:506`) +
  `normalizeRepo(data.repo)` at `:509`, and computes `approvalHash = computeEmissionHash(draft)` at `:517`.
- on the live+token+approved path: `const pr = armedEmitFn({draft, token, ghConfigDir, approvalHash,
  requestedBaseSha: apprRequestedBaseSha})` at `:545`; then cap/ledger/approval recording at `:546-548`;
  then the ADDITIVE, NON-REVERTING, throw-swallowing join-key write gated `if (... && pr && !pr.deduped)`
  at `:555-586`. The verify seam mirrors that join-key position + guard.
- `armedEmit -> ghEmit` returns `{pr_url, number, branch, base_sha}` (`gh-emit.js:993`), so `pr.base_sha`
  (the base the PR ACTUALLY opened against) is available post-emit — the honest base to grade (closes part
  of O-INPUTS the requested base does not: a moved base fails the emit closed at `gh-emit.js:807`, so on a
  SUCCESSFUL emit the base is well-defined; `pr.base_sha` is present even when the approval carried none).
- injected-fn precedent: `armedEmitFn = typeof opts.armedEmitFn === 'function' ? opts.armedEmitFn : armedEmit`
  (`:544`) — the pattern the verifier seam mirrors (K12: the kernel never hard-`require`s the lab).
- `emit-pr.js` imports NO `child_process` and does no clone today (diff-as-DATA only; explicit NOTE at
  `:43-45`). `emitPR` is SYNCHRONOUS (a plain `function`, not `async`; it returns `r.value` synchronously).
- `verifyCandidate` (`packages/lab/verify-container/verify-candidate.js`) is `async`, REQUIRES a
  `candidateId` (`assertSafeId` throws if absent), and self-records the sidecar keyed by `candidateId`. =>
  `opts.verifyFn` is NOT `verifyCandidate` directly: it is an ADAPTER the injector supplies that maps the
  seam payload to a `candidateId`. `approvalHash` (the content-address the emit is keyed to) IS that stable
  candidate identity — the seam passes it as the join.
- no current `emitPR` caller passes `verifyFn` (whole-repo grep: `verifyFn` appears only in this plan) —
  the dormancy premise holds by construction. `verifyFn` is NOT yet in `DISPOSITION_KEYS` (this wave adds it).

## Design (REVISED per VERIFY: after-emit position)

A new optional injected fn `opts.verifyFn`, called AFTER a successful, non-deduped emit (the additive
join-key position), ADVISORY — fail-open, throw-swallowing, and it NEVER alters/blocks/reverts the emit
or its bytes. Prod injects no `verifyFn` => the block is skipped => byte-identical. Mirrors `armedEmitFn`
(K12 lab-agnostic) and the join-key write's best-effort semantics.

```
// VC-W1b — the DORMANT post-emit verify SEAM (QUALITY, not TRUST — OQ-NS-6). ADVISORY: fail-open,
// throw-swallowing, NEVER alters/blocks/reverts the emit or its bytes. Placed AFTER a successful emit
// (the additive join-key position) so the verdict describes a candidate that actually SHIPPED and grades
// pr.base_sha (the base the PR opened against). Prod injects no verifyFn => byte-identical. Kernel stays
// lab-agnostic (injected fn, K12). approvalHash IS the candidate identity (the join to the sidecar
// candidateId; the injected verifier is an ADAPTER mapping approvalHash -> candidateId). Inputs are the
// SCRUBBED/normalized draft.* fields + pr.base_sha, NEVER the raw actor `data.*`. The detached async
// verify runs fire-and-forget OUTSIDE the released lock (W1-benign: reads nothing back, self-records);
// a concurrency/resource bound on a real (Docker) run is a NAMED VC-W2 precondition (R12 output-DoS).
if (typeof opts.verifyFn === 'function' && pr && !pr.deduped) {
  try {
    const vp = opts.verifyFn({ repo: draft.repo, issueRef: draft.issueRef,
                               base_sha: pr.base_sha, candidate_patch: draft.diff, approvalHash });
    // verifyCandidate is async + self-records; do NOT await (advisory, non-blocking). Swallow an async
    // rejection so a QUALITY verify can never surface as an unhandled rejection (no unhandledRejection
    // listener exists in egress -> this swallow is load-bearing). Inline no-ops (no undefined NOOP).
    if (vp && typeof vp.then === 'function') vp.then(() => {}, () => {});
  } catch (_verifyErr) {
    // documented fail-open (NOT a silent swallow): a QUALITY verify throw must never block/alter a
    // shipped emit. W1 has no verdict consumer; observability of a verify-seam throw is a VC-W2 concern.
  }
}
```

**Position (adjudicated by the VERIFY architect lens — flipped from the first draft's before-armedEmit):**
AFTER a successful, non-deduped emit (adjacent to the join-key write), NOT before `armedEmit`. Three
reasons the board gave: (1) the before-position de-risks nothing real — W2's cost is the async-await
BLOCK barrier (emitPR is sync), not the line number, and W1's fire-and-forget shape is the OPPOSITE of
W2's await-block shape, so W2 rewrites the body regardless; (2) before-`armedEmit` records verdicts for
candidates that then THROW during the emit (a PR that never opened) — a telemetry-truthfulness bug; the
after-position (`pr && !pr.deduped`) records only shipped candidates, the correct denominator; (3) after
can grade the honest `pr.base_sha` (the base the PR opened against), which before cannot (no `pr` yet).
After also matches the scope's literal "non-reverting / like the additive join-key write" wording.

## Dormancy / byte-identity proof

The seam is a single `if (typeof opts.verifyFn === 'function' && pr && !pr.deduped)` block AFTER the emit;
prod never passes `verifyFn`, so it is skipped entirely => the argv/bodies emitted are byte-identical
(the golden-bytes tests are unaffected). The verifier, when present, is fire-and-forget (not awaited) and
its return is NEVER read (`vp` is discarded) — so even an INJECTED verifier cannot change control flow,
the emit result, or the bytes.

## Test plan (TDD — new behavior first, RED, then impl; in `emit-pr.test.js`)

1. dormant/byte-identical: an emit with NO `verifyFn` behaves EXACTLY as today (existing emit tests +
   golden assertions unchanged).
2. seam fires post-emit: inject a sync mock `verifyFn`; assert it is called EXACTLY once with
   `{repo: draft.repo, issueRef, base_sha (=== the emitted pr.base_sha), candidate_patch (=== draft.diff), approvalHash}`.
3. fail-open on a SYNC throw: a `verifyFn` that throws synchronously => the emit STILL succeeds (same
   `pr`/result as without it); no throw escapes emitPR.
4. fail-open on an ASYNC rejection: a `verifyFn` returning a rejected promise => the emit succeeds and no
   unhandled rejection surfaces (assert via a temporary `unhandledRejection` listener that fires ZERO times).
5. non-altering + discard (hacker L1): the verifyFn's return (a fabricated verdict) is IGNORED — the emit
   result AND the join-key are identical whether verifyFn returns pass, fail, null, or a poison object.
6. only-on-shipped: `verifyFn` is NOT called on the awaiting-approval / cap-exceeded / not-live / DEDUPED
   paths (no fresh emit => nothing to verify).
7. scrubbed-not-raw (hacker M3): with a `data.diff` carrying a secret that `scrubEmitDiff` redacts (so
   `data.diff !== draft.diff`), assert `verifyFn`'s `candidate_patch === draft.diff` (the SCRUBBED bytes),
   NEVER `data.diff` — the raw actor input never reaches the new sink.
8. deny-list (hacker L2): a `verifyFn` planted in `data` is rejected by `assertDataIsPolicyFree` (throws)
   — `verifyFn` is in `DISPOSITION_KEYS`, so an actor cannot smuggle an opts-path fn via data.

## Security invariants (carry verbatim)

- verify-container is a QUALITY gate; the verdict is written ONLY to the dedicated advisory sidecar (by
  the injected verifier, VC-W1a), NEVER the join-key payload, world-anchor/lesson stores, reputation /
  verdict-attestation, or any `weight-source-gate` / `world_anchored` / `LIVE_SOURCES` consumer
  (OQ-NS-6; disjoint from the #273 axis). The seam DISCARDS the verifier's return (`vp` is never assigned
  to a consumer, returned, or written) — a seam-discard test (test 5) guards it, because the VC-W1a
  structural exclusion dam covers the LAB closure, NOT this kernel file (hacker L1).
- the seam passes the verifier ONLY the SCRUBBED/normalized `draft.*` fields (`draft.repo`, `draft.diff`),
  the emitted `pr.base_sha`, and `approvalHash` — NEVER the raw actor `data.*` (hacker M3). `approvalHash`
  is the candidate identity (the join to the sidecar `candidateId`).
- the kernel must not hard-`require` the lab (K12): the verifier is an INJECTED fn (`opts.verifyFn`),
  exactly like `armedEmitFn`. `emit-pr.js` gains NO new import. `verifyFn` is added to `DISPOSITION_KEYS`
  (symmetry with `armedEmitFn`, so an actor cannot plant it in `data`).
- the seam is fail-open + throw-swallowing + NON-blocking: a verify failure/throw/rejection NEVER blocks,
  reverts, or alters a human-approved emit or its bytes. (Quality, not a security gate — the fail-silent
  rule is about SECURITY rejects; a quality-verify throw is intentionally non-fatal.)
- the detached async verify runs fire-and-forget OUTSIDE the released lock (`withLockSoft` releases when
  the sync closure returns; the promise runs after). W1-benign (reads nothing back, self-records to its own
  dir). A concurrency / resource bound on a REAL (Docker) run — unbounded detached container runs are a
  resource-exhaustion lever — is a NAMED VC-W2 precondition (ties to the R12 output-DoS / process-group
  residual). NOT this wave (W1 defaults to MockBackend).
- prod injects no `verifyFn` => DORMANT => byte-identical. A real untrusted-execution run (Docker/Linux,
  the host-side clone surface, base reconciliation, dep provisioning) is operator-owned and gated on
  O-HOST/O-INPUTS/O-DEPS — NOT this wave.

## Open questions (named, not solved here)

- VC-W2 async gate: emitPR is SYNC; awaiting a verdict to BLOCK before emit requires making emitPR async
  OR a synchronous-verify contract, AND serializing the detached run (the M1 out-of-lock concurrency
  bound). Deferred to VC-W2 arming.
- O-INPUTS base reconciliation: the after-position grades `pr.base_sha` (the emitted base), closing the
  "verify graded a different commit" gap for W1; a real run's dep/enumeration inputs stay O-DEPS/O-TESTS.
- observability of a verify-seam throw (a VC-W2 concern once the verdict gates).

## VERIFY result (3-lens board, 2026-07-03 @ the plan pre-build)

Read-only 3-lens VERIFY over the FIRST draft of this plan (architect + hacker + honesty-auditor, parallel).

- **architect: NEEDS-REVISION** — adjudicated the position question: FLIP before-`armedEmit` -> AFTER
  (the before-position de-risks nothing real since W2 rewrites the body for the async barrier, records
  never-emitted candidates, and forecloses the honest `pr.base_sha`). Plus the `NOOP` ReferenceError and
  the unspecified `candidateId`/`approvalHash` join. K12 injected-fn CORRECT; byte-identity sound. ALL FOLDED.
- **honesty-auditor: SOUND** — 10/10 runtime claims TRUE at HEAD, grade A, NO-OVERCLAIM; the load-bearing
  `apprRequestedBaseSha` provenance chain fully backed (sign-then-verify; field in the signature pre-image).
  Flags: the `NOOP` build-obligation (folded via inline no-ops) + the loose `execFileSync` descriptor
  (reworded: emitPR is a plain sync function).
- **hacker: SOUND** — 12 attack paths, 0 bypasses; emit-alteration / actor-injection / trust-axis-leak /
  base-provenance / unhandled-rejection / host-exec / dormancy all HANDLED by design. Folds: M1 name the
  detached-run out-of-lock lifetime + defer a concurrency bound to VC-W2; M2 `NOOP` (folded); M3 source
  from `draft.*` not `data.*` (+ the scrubbed-not-raw test); L1 add a seam-discard test (the dam covers the
  lab, not the kernel seam); L2 add `verifyFn` to `DISPOSITION_KEYS`.

Verdict after fold: the seam is repositioned after-emit (grading shipped candidates on `pr.base_sha`),
fail-open/throw-swallowing/discard-the-verdict, dormant/byte-identical, K12 lab-agnostic, with `verifyFn`
deny-listed and the detached-run concurrency bound named as a VC-W2 precondition. Ready to build.

## VALIDATE result (3-lens board, 2026-07-03 @ the built diff)

Read-only 3-lens VALIDATE over the BUILT diff (code-reviewer + hacker-live-probe + honesty-auditor, parallel).

- **honesty-auditor: SHIP** — 10/10 VERIFY folds landed with locatable, non-vacuous artifacts (grade A,
  NO-OVERCLAIM). Dormancy PROVEN by construction (grep: zero prod `verifyFn` injectors); the seam honestly
  scoped as advisory-not-gate; the out-of-lock concurrency correctly named a VC-W2 precondition.
- **code-reviewer: SHIP** — 0 CRITICAL/HIGH/MEDIUM, 1 LOW. It EMPIRICALLY ran the real async-rejection case
  (a real rejecting Promise + a live `unhandledRejection` listener) => 0 unhandled, emit succeeded.
- **hacker (live-probe, Rule 2a): SHIP-WITH-NOTES** — 10 live probes, 0 exploitable bypasses. Every attack
  HELD: verdict-leak (discarded; `r.draft` frozen; no verdict on the join-key), block/alter (9 variants ===
  baseline), byte-dormancy (no-verifyFn === before), seam-unreachable-from-data, scrubbed-not-raw, real
  async-rejection-swallow (0 unhandled, control fired 1), deduped-skip, detached-lifetime, re-entrancy.

**Folds applied (this revision):**

- hacker M1: `'verify_fn'` + `'verify-fn'` added to `DISPOSITION_KEYS` (spelling-parity with the F-W1 fork
  keys; the deny-list's "no policy key in data" promise is now spelling-complete). The deny-list test asserts
  all spellings + casings. (Non-exploitable today — the seam reads only `opts.verifyFn` — a completeness fix.)
- hacker M2: the seam comment now documents that the synchronous `verifyFn()` CALL runs INSIDE the egress
  lock, so an injected `verifyFn` MUST return promptly (real work in its async body, as `verifyCandidate`
  does); deferring the call past the lock release is a NAMED VC-W2 precondition.
- code-reviewer + honesty LOW: added a REAL runtime async-rejection test (`Promise.reject` + a live
  `unhandledRejection` listener asserting ZERO) alongside the deterministic thenable-spy test.
- hacker L1 (SKIPPED): the arg object is not frozen, but a `verifyFn` mutating its own args is inert
  (`draft`/`pr` are frozen; `candidate_patch` is an immutable string; the verdict is discarded). No fix — the
  reviewer confirmed "no fix required."

**Board disposition: SHIP** (SHADOW/dormant, production byte-identical; the seam cannot alter/block/revert
the emit or leak the verdict; VC-W2 preconditions — the async-await gate, the defer-past-lock, the real-run
concurrency bound — are named, not solved). Tests after fold: emit-pr 74/0; full kernel 1620/0; pre-push 129/0.
