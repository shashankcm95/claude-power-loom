---
lifecycle: persistent
topic: fork-emit, F-W2b, kernel-egress, approvalSigBasis, requestedBaseSha, moved-base, signed-basis, dormant
plan-of: the third wave of the fork-emit path — bind the approver-intended base into the signed basis (moved-base invalidation)
status: SHIP — 3-lens VERIFY + TDD build + 3-lens VALIDATE (all SAFE-TO-SHIP) complete; see the VALIDATE result section
---

# F-W2b — `requestedBaseSha` into `approvalSigBasis` (moved-base invalidation), DORMANT / byte-identical

The third wave of the fork-emit path (F-W1 two-identity axis MERGED as `ffa4e67`, PR #488; F-W2 fork lifecycle
MERGED as `65142bc`, PR #489). F-W2b binds the **approver-intended base commit** into the SIGNED freshness basis so
a moved upstream base **invalidates the approval** at the emit gate — closing the standing #405 forward-contract
residual (for a MODIFY, the emitted bytes are `live-base + approved-hunks`; the inter-hunk gap/tail come from the
base the approver never rendered, so a moved base silently rebuilds the post-image against a tree the approver did
not review). It is the F-W2-plan / scope-doc "deferred `baseCommitSha` -> `approvalSigBasis`" item, split out as
its own wave because it is a cross-cutting **signed-basis** change (the exact shape of the OQ-3 W2
`lesson_commitment` binding).

## The architect's F-W1 correction (the load-bearing framing — do NOT regress it)

The scope doc's original Q3 said "`baseCommitSha` INTO `emissionAxiom`". **That is TEMPORALLY IMPOSSIBLE and this
plan does NOT do it.** The live base commit sha does not EXIST at approval time — it is resolved live inside
`ghEmit` (`gh-emit.js:735`, `refObj.object.sha`) AFTER the human approved + the broker signed. `emissionAxiom`
(`approval.js:53-60`) is hashed at approval time; a value that does not yet exist cannot enter it.

**What CAN be bound at approval time is the `requestedBaseSha`** — the base the approver INTENDED / reviewed the
diff against (known at approval time). It goes into `approvalSigBasis` (the freshness-bound preimage the broker
signs), EXACTLY as `lesson_commitment` (OQ-3 W2) did — a **basis-only** field, NEVER in the emission hash. Then at
emit time `ghEmit` resolves the LIVE base and REFUSES if `liveBase !== requestedBaseSha` (fail-closed; re-approve
against the moved base). `computeEmissionHash` / `emissionAxiom` are UNTOUCHED (the approval stays keyed to
`{repo, issueRef, diff}`; a base-sha change never re-keys a standing approval's content address).

## Design — mirror `lesson_commitment` EXACTLY (the proven OQ-3 W2 template)

`requestedBaseSha` is `''` (no base constraint — the DORMANT default) or a full lowercase git sha. It is:

- **ALWAYS in the basis** (coerced `undefined -> ''`, shape-gated `'' | <hex-sha>`, THROW on non-string) — the
  same always-a-string discipline `lesson_commitment` uses (`approval.js:88-91`): canonicalJsonSerialize emits the
  literal token `undefined` for an undefined-valued key, so undefined / '' / key-absent would be THREE distinct
  bases and the broker would sign a different string than the human approved.
- **ALWAYS persisted** in the approval body by `recordApproval` (default `''`).
- **REQUIRED in the body** by `verifyApproval` (a DISTINCT fail-closed reason if absent — mirror
  `no-body-lesson-commitment`, NOT coerced: a legacy/absent body field must never launder a pre-F-W2b approval
  into a no-base match), folded into the basis re-derive, and EXPOSED in the returned `body` for the emit gate.
- **Checked at the emit gate** by `ghEmit`: the moved-base refusal fires ONLY when `requestedBaseSha` is non-empty.

**DORMANT / byte-identical:** the production mint path (`approve-cli` WITHOUT the new optional `--base-sha`) writes
`requestedBaseSha = ''`, so the emit gate never fires and the EMITTED gh argv/bodies (the golden-bytes regression)
stay byte-identical to `65142bc`. The mechanism ships inert; auto-capture (approve-cli resolving the live upstream
tip at mint) is a later flip gated with the F-W3 live-head arming (F-W4 precondition #5: F-W2b MUST precede F-W3).
NOTE: the approval STORE format changes (the body gains `requestedBaseSha`, so the sig changes) — that is internal
to custody, NOT emitted; "byte-identical" is scoped to the EMIT path (the golden-bytes argv/bodies), as in F-W1/F-W2.

## The signed-basis ripple surface (firsthand-probed on `65142bc`)

| # | Site | File:line | Change |
|---|---|---|---|
| 1 | `approvalSigBasis` DEFINE | `approval.js:88-92` | add `requestedBaseSha` param; coerce `undefined->''`; shape-gate; add to the hashed object (6th field) |
| 2 | `verifyApproval` re-derive | `approval.js:130-153` | shape-gate `body.requestedBaseSha` (distinct fail-closed if absent/malformed); fold into the basis re-derive at `:149`; already returns `body` |
| 3 | `recordApproval` MINT | `approval-store.js:100-145` | accept `requestedBaseSha` opt; coerce+shape-gate BEFORE the basis; fold into `approvalSigBasis` `:128`; add to the signFn ctx `:129`; persist in `body` `:142` |
| 4 | `loom-broker-bind` recompute | `loom-broker-bind.js:33,51-68,105-114` | `CTX_KEYS` 5->6; `validateCtxShape` adds the type+shape gate; fold into `recomputedBasis` |
| 5 | `loom-custody-verify` C3 probe | `loom-custody-verify.js:172-173` | the probe ctx + basis add `requestedBaseSha: ''` (the no-base sentinel — matches what recordApproval signs for a no-base approval) |
| 6 | `ghEmit` EMIT-GATE | `gh-emit.js:705,735-738` | accept `requestedBaseSha` arg; after resolving the live `baseCommitSha`, if non-empty && `!== baseCommitSha` -> `emitEgressAlert('moved-base')` + throw (BEFORE any tree/commit/PR write) |
| 7 | `emit-pr` threading | `emit-pr.js:425,440,517-534` | `emitPR` reads `appr.body.requestedBaseSha` from the verified approval; `armedEmit` accepts it + passes to `ghEmit` |
| 8 | `approve-cli` MINT CAPTURE | `approve-cli.js:264-265` | accept an OPTIONAL `--base-sha` (defaults `''`); pass to `recordApproval` |

**UNCHANGED (must survive):** `emissionAxiom` / `computeEmissionHash` (`approval.js:53-70`) — NEVER gains
requestedBaseSha (the temporal-impossibility invariant); `join-key-store.js` — it SHAPE-validates the broker-sig
bundle but NEVER recomputes the basis (`:53` "holds no verify key, by design"), so requestedBaseSha does not enter
it; the env-sanitization killswitch; #273 body-verify / verify-on-read; the fail-closed base+hunk applier; the
kernel-constant envelope + `draft:true`; every F-W1/F-W2 identity guard.

## The emit-gate semantics (`ghEmit`)

After `gh-emit.js:735-738` resolves `baseCommitSha`, BEFORE the base-tree/contents fetch + any write:

```js
// F-W2b — moved-base invalidation. requestedBaseSha (the approver-intended base, bound into the SIGNED basis and
// carried on the verified approval body) must equal the LIVE upstream base. A non-empty mismatch => the upstream
// advanced since approval => the approved hunks would rebuild the post-image against a tree the approver never
// reviewed (#405). Fail CLOSED + observable; re-approve against the new base. Empty '' (the dormant default) skips.
if (requestedBaseSha && requestedBaseSha !== baseCommitSha) {
  emitEgressAlert('moved-base', { requested: requestedBaseSha.slice(0, 16), live: baseCommitSha.slice(0, 16) });
  throw new Error('ghEmit: upstream base moved since approval (requestedBaseSha != live base) — fail-closed');
}
```

The value threads `emitPR (verified body) -> armedEmit -> ghEmit` (a named arg, NEVER read from `draft` — draft is
hash-bound; a requestedBaseSha in it would be an unsigned co-forgeable steering field, the C2 #273 trap, the same
reason `forkRepo` is a named arg in F-W1). It rides on the VERIFIED approval body (sig-covered via the basis), so
it is provenance-bound to the broker signature, not actor-supplied.

## Open questions for the VERIFY board (recommendations inline)

- **Q-A (shape).** `requestedBaseSha` = `''` or `/^[0-9a-f]{40}$/` (SHA-1, GitHub today) — OR `/^[0-9a-f]{40}$/ |
  /^[0-9a-f]{64}$/` for SHA-256 forward-compat? The live `baseCommitSha` from `git/ref/heads/{base}` is a full
  40-hex today; the compare is exact-string. **Recommend 40-or-64-hex lowercase** (forward-compatible, no cost).
- **Q-B (dormant vs active-now).** Ship DORMANT (optional `--base-sha`, default `''`, byte-identical) — OR make
  approve-cli AUTO-capture the live upstream tip at mint so the moved-base check is active for ALL emits now (a
  same-owner behavior change: a moved base would begin refusing)? **Recommend DORMANT** — consistent with the
  F-W1/F-W2 incremental-dormant discipline + the byte-identical gate; auto-capture activates with F-W3 fork arming.
- **Q-C (gate placement).** The moved-base check belongs in `ghEmit` (the ONLY place the live base is resolved),
  not `emit-pr` (which never resolves the base). **Recommend `ghEmit`** — confirm.
- **Q-D (ADD-only vs MODIFY).** For an ADD-only diff the base CONTENT is not consumed by hunks, but the commit
  still parents the resolved base + the merge context is base-specific. **Recommend fire for ALL emits when
  requestedBaseSha is set** (simplest, safest; the approver's intent is base-specific) — flag if the board wants
  it scoped to MODIFY-bearing diffs.
- **Q-E (verifyApproval body-absence treatment).** Mirror `lesson_commitment`: an absent `body.requestedBaseSha`
  is a DISTINCT fail-closed reason, NOT coerced to '' (never launder a pre-F-W2b approval). Since the egress is
  SHADOW/emit-OFF there is no production approval store of old-format approvals, so this is a forward safety
  property, not a live migration. **Recommend distinct fail-closed** — confirm.

## TDD test list (tests FIRST, red, then build to green — TDD-treatment: the 5-field basis becomes 6)

New/updated tests across `tests/unit/kernel/egress/` (approval, approval-store, gh-emit-two-identity, emit-pr,
loom-broker-bind, loom-custody-verify) + the approve-cli:

1. **`approvalSigBasis` 6-field** — a populated `requestedBaseSha` changes the basis vs `''`; `undefined` coerces
   to `''` (=== the '' basis); a non-string THROWS. (The always-a-string canonical-hash footgun.)
2. **basis is order-independent + stable** — the 6-field basis is byte-stable across key-insertion order (reuse
   canonical-json), and a legacy 5-field-style hand-built object does NOT collide with the 6-field '' basis.
3. **`recordApproval` persists + signs** — the written body carries `requestedBaseSha`; the sig verifies over the
   6-field basis; an absent opt defaults `''`; a malformed sha THROWS before any wx write (never poison the slot).
4. **`verifyApproval` — populated match** — a body with `requestedBaseSha` + a sig over the 6-field basis verifies;
   the returned `body` exposes `requestedBaseSha`.
5. **`verifyApproval` — absent body field fails closed** — a body WITHOUT `requestedBaseSha` => the distinct
   fail-closed reason (never coerced to '' — no pre-F-W2b laundering). NON-VACUOUS (inject the absence, watch it fire).
6. **`verifyApproval` — in-place edit flips the sig** — editing `body.requestedBaseSha` after mint => `sig-invalid`
   (it is basis-covered).
7. **`loom-broker-bind` — CTX 6-key shape** — a 5-key ctx (missing requestedBaseSha) => `ctx-shape-mismatch`; a
   6-key ctx recomputes the basis matching recordApproval's; a malformed requestedBaseSha => its shape reason.
8. **`loom-custody-verify` C3 probe** — the probe basis carries `requestedBaseSha: ''` and matches a no-base
   recordApproval sign (the probe still verifies against the pinned key).
9. **`ghEmit` moved-base refusal** — a non-empty `requestedBaseSha !== liveBase` => `moved-base` alert + throw,
   ZERO tree/commit/ref/PR writes. NON-VACUOUS.
10. **`ghEmit` base-match proceeds** — `requestedBaseSha === liveBase` => proceeds normally (writes fire).
11. **`ghEmit` empty requestedBaseSha = byte-identical** — `''` (or absent) => the golden-bytes argv/bodies are
    UNCHANGED vs `65142bc` (the dormant/byte-identical acceptance gate).
12. **`emit-pr` threads the verified body's requestedBaseSha** — `emitPR` reads `appr.body.requestedBaseSha` and
    passes it through `armedEmit -> ghEmit` (assert via an injected `armedEmitFn` / ghEmit mock).
13. **`approve-cli` optional `--base-sha`** — supplied => recordApproval receives it; absent => `''`.
14. **Golden-bytes STILL byte-identical** — re-run the existing gh-emit golden assertions; a no-base emit is
    unchanged (the emit-path byte-identity gate).

## HETS Spawn Plan

kernel/egress signed-crypto-core + security => FULL 3-lens tier REQUIRED at VALIDATE (Rule 2): code-reviewer
(correctness) + hacker (Rule 2a — LIVE probes against the BUILT basis: forge attempts, field-ordering,
edit-flips-sig, moved-base bypass) + honesty-auditor (claim-vs-evidence: byte-identity, the temporal-impossibility
framing, dormant-ness). PRE-BUILD: 3-lens VERIFY (architect + code-reviewer + hacker) on THIS plan — architect
confirms the basis-only (not emissionAxiom) framing + the 5-site consistency + the dormant boundary; hacker probes
the co-forge / laundering surface on the new signed field + the moved-base gate placement; code-reviewer probes the
coercion/shape-gate consistency across the 5 sites. Routing: substrate kernel-egress security, non-trivial => route
(route-decide scored `root` on a stakes-lexicon miss — the substrate-meta catch-22; overridden to route by judgment
per the H.7.16 rule, same class as F-W1/F-W2).

## Runtime Probes (claims this plan makes)

- The 8-site line numbers + the `emissionAxiom` / `approvalSigBasis` / `verifyApproval` shapes -> firsthand reads
  of `approval.js`, `approval-store.js`, `loom-broker-bind.js`, `loom-custody-verify.js`, `gh-emit.js`, `emit-pr.js`,
  `approve-cli.js` on `65142bc` (this session, above).
- `join-key-store` does NOT recompute the basis -> firsthand grep (`:53` "holds no verify key, by design"); it
  shape-validates broker_sig only. So requestedBaseSha does not enter join-key. Confirmed, not assumed.
- The live base is resolved in `ghEmit`, not `emit-pr` -> firsthand (`gh-emit.js:735`); the temporal-impossibility
  premise rests on this (the sha does not exist until this line runs, after the signature).

## Drift Notes

- F-W2b is DORMANT like F-W1/F-W2, but via a DIFFERENT lever: not "the field is never populated" (forkRepo) but
  "the production mint writes the empty sentinel" (requestedBaseSha=''), so the emit gate is inert until a later
  flip auto-captures the base. Same incremental-mechanism discipline; flag for the board that the dormant-ness is
  honest (no live dependency this wave; the golden-bytes gate proves the emit path is unchanged).
- The OQ-3 W2 `lesson_commitment` binding is the template — this plan mirrors it site-for-site for sites 1,3,4,5;
  **site 2 (`verifyApproval`) is a PARTIAL mirror** (see the Pre-Approval fold D1 — no request param, a body field
  only). Coercion, always-a-string, distinct-fail-closed-on-absent, CTX_KEYS growth, custody-probe sentinel are the
  shared shape — a known-good review surface, not a novel crypto design.

## Pre-Approval Verification (3-lens VERIFY board, 2026-07-02)

**Board: architect (NEEDS-REVISION) + code-reviewer (NEEDS-REVISION) + hacker (DESIGN-READY-with-mandates), read-only,
parallel.** UNANIMOUS that the crypto core is sound: the basis-only (NOT `emissionAxiom`) framing is CORRECT +
COMPLETE (no path re-enters the content hash — the temporal-impossibility argument is airtight), `requestedBaseSha`
is the right thing to bind, and `join-key-store` is correctly OUT (it shape-validates the sig bundle, never
recomputes the basis; its `base_sha` is the OBSERVED live base, orthogonal to the INTENDED `requestedBaseSha` — do
NOT conflate them). NEEDS-REVISION only for the emit-side wiring + shape-pinning + one design-altitude asymmetry. **All
folds below are AUTHORITATIVE build directives; they SUPERSEDE any contradicting body prose above.**

**RULINGS on the open questions:**
- **Q-A (shape): `/^([0-9a-f]{40}|[0-9a-f]{64})$/` lowercase, or `''`.** Forward-compatible (SHA-256) at zero cost.
- **Q-B: DORMANT** (clear architecture call). Active-now would smuggle a live-path behavior change (a moved base
  would begin refusing the same-owner PATH-1 beta emits) into a byte-identical wave. Auto-capture arms WITH F-W3.
  **Stated trade-off (honest):** the #405 moved-base residual stays OPEN for the current same-owner live path until
  F-W3 arms — the correct trade (a same-owner moved base rebuilds against an operator-re-reviewable tree; small blast).
- **Q-C: `ghEmit`** (the only defensible placement — `emit-pr` never resolves the live base; SRP).
- **Q-D: fire for ALL emits when `requestedBaseSha` is set** (NOT scoped to MODIFY). Even an ADD-only diff PARENTS
  the resolved base (`gh-emit.js:739`), so the reviewed post-image is base-relative for every emit shape. KISS.
- **Q-E: distinct fail-closed, MANDATE (not recommend).** An absent/non-string `body.requestedBaseSha` => a DISTINCT
  reason (`no-body-requested-base-sha`); the BODY is NEVER coerced (coerce only the request/mint side). Mirrors
  `no-body-lesson-commitment`.

**CRITICAL / HIGH build directives:**

- **D1 — `verifyApproval` is a PARTIAL mirror, NOT exact (architect §5 HIGH — the asymmetry both other lenses missed).**
  `lesson_commitment` at emit time HAS an actor-influenceable request analog (`verifyApproval` gained a
  `requestedLessonCommitment` param, cross-checked against the body — `emit-pr.js:517`). `requestedBaseSha` has NO
  legitimate emit-time request analog — its "expected" value is the LIVE upstream base, not an actor claim. So
  `verifyApproval` gets **NO new request parameter**: it ONLY (a) shape-gates `body.requestedBaseSha` via
  `isSafeBaseSha` on the BODY (distinct fail-closed `no-body-requested-base-sha` if absent/non-string/malformed —
  never coerce the body), (b) folds `body.requestedBaseSha` into the basis re-derive at `:149`, (c) exposes it on
  the already-returned `body`. A builder must NOT add a `requestedBaseSha` request arg + a matching-check (nothing
  legitimate to match against). This corrects the "mirror EXACTLY" body prose for site 2.

- **D2 — the emit-side thread is THREE edits, not one (hacker HIGH + architect §3 — the Rule-2a-corollary dead-guard).**
  Site 7 must edit all three atomically or the gate is silently DEAD on the only live path while every unit/golden
  test passes: (a) `armedEmit`'s destructure (`emit-pr.js:425`) accepts `requestedBaseSha`; (b) `armedEmit`'s inner
  `ghEmit({...})` call (`:440`) forwards it; (c) **the PRODUCTION `emitPR -> armedEmitFn` call at `emit-pr.js:534`
  passes `requestedBaseSha: appr.body.requestedBaseSha`** — add `requestedBaseSha` to the `:529` verified-body
  destructure (alongside `approvedAt`/`nonce`/`key_id`/`sig`). TDD test 12 MUST be END-TO-END: drive `emitPR`
  (killswitch-off, injected `armedEmitFn`) against a REAL `recordApproval`-minted approval carrying a populated
  `requestedBaseSha`, and assert the stub RECEIVES the exact body value — not merely that direct-`armedEmit` works.

- **D3 — the moved-base gate mandate (hacker HIGH — laundering).** The gate is `if (requestedBaseSha && requestedBaseSha
  !== baseCommitSha) { emitEgressAlert('moved-base', ...); throw }`. Because `&&` treats `''`/`undefined`/`null` as
  no-constraint, the whole check pivots on D1's distinct fail-closed for an absent body field — that is what stops a
  pre-F-W2b (5-field) body laundering through as a no-base approval. Non-vacuous test: a hand-built 5-field body
  fails with the distinct reason, never as a no-base match.

- **D4 — `requestedBaseSha` is a NAMED arg from the VERIFIED body ONLY, never `draft`, never a defaultable `ghEmit`
  param (hacker MED + the C2 #273 trap).** Mirror `forkRepo`'s F-W1 discipline. Add a test asserting a
  `requestedBaseSha` planted in `draft` is IGNORED (only the sig-covered verified-body value steers the gate). State
  that `''`-as-disable is the standing same-uid co-forge residual (NARROWS, not closes — consistent with
  `approval-store.js:19-22`), so the honesty lens does not flag an over-claim.

- **D5 — shared `BASE_SHA_RE` / `isSafeBaseSha`, defined ONCE (architect §5 MED + code-reviewer HIGH + hacker MED —
  the cross-domain-compare defect, one ruling).** Export `BASE_SHA_RE = /^([0-9a-f]{40}|[0-9a-f]{64})$/` +
  `isSafeBaseSha(v)` (`v === '' || (typeof v === 'string' && BASE_SHA_RE.test(v))`) from `approval.js` (mirror
  `LESSON_COMMITMENT_RE`/`isSafeLessonCommitment` at `:37-38`), and IMPORT it at every site: `approval.js`
  (basis + verify), `approval-store.js` (mint), `loom-broker-bind.js` (`validateCtxShape`), `approve-cli.js`
  (`--base-sha` CLI boundary — fail-fast, not only at `recordApproval`), AND **the `gh-emit.js:736` live-base check
  — TIGHTEN it from `/^[0-9a-f]{7,64}$/` to the full `BASE_SHA_RE` domain** (both operands of the moved-base `===`
  in the same full-hex domain; GitHub returns a full 40-hex today so this is byte-identical on the real path). If the
  live base is not full-hex => throw `base-sha-malformed` (fail LOUD, never a silent false-reject). Six independently-
  driftable regexes otherwise; one hiding-point for "what is a valid base sha".

- **D6 — `verifyApproval` reason-ordering (code-reviewer MED — the F1 fold).** The `body.requestedBaseSha` shape-gate
  runs immediately AFTER the existing `lesson_commitment` checks and BEFORE the nonce/approvedAt/TTL/body-hash/sig
  block, so a malformed/absent value returns `no-body-requested-base-sha` (its own reason) rather than falling
  through to a generic `sig-invalid`. TDD asserts the EXACT reason string per failure mode (observability —
  `security.md` fail-closed-must-be-observable).

- **D7 — `loom-broker-bind` type-check-before-shape (code-reviewer LOW — the F4 fold).** `validateCtxShape` checks
  `typeof ctx.requestedBaseSha !== 'string'` FIRST (distinct reason), THEN `isSafeBaseSha` — same order as the
  `lesson_commitment` F4 fold, so a non-string never reaches the shape test. `CTX_KEYS` 5->6 (add `requestedBaseSha`).

- **D8 — `DISPOSITION_KEYS` deny-list (code-reviewer HIGH + hacker MED).** Add `requestedBaseSha`, `requested_base_sha`,
  `requested-base-sha`, `baseSha`, `base_sha`, `base-sha` (case-folded 3-spelling variants, matching the F-W1
  `forkRepo`/`baseRepo` convention) to `DISPOSITION_KEYS` in `emit-pr.js`. Test: `assertDataIsPolicyFree({requestedBaseSha:
  'x'})` (+ variants) THROWS. Defense-in-depth: the field must never arrive via untrusted `data`.

- **D9 — custody-probe two edits (architect §5 LOW — confirm).** `loom-custody-verify.js` adds `requestedBaseSha: ''`
  to BOTH the probe `ctx` object (`:172`) AND the `approvalSigBasis(...)` call (`:173`), or the probe basis won't
  match what `recordApproval` signs for a no-base approval (breaks the C3 self-test).

- **D10 — byte-identity test MECHANISM (code-reviewer MED).** Tests #11/#14 are NON-VACUOUS: re-run the existing
  recorded `deps.runGh` argv-sequence fixture(s) with `requestedBaseSha: ''` (or omitted) and assert the captured
  call sequence (args + POST bodies) is IDENTICAL in content AND count vs pre-F-W2b — not merely "the old tests pass".

- **D11 — atomic-bind note (hacker LOW).** The base is resolved ONCE at `:735` and pinned into every downstream fetch
  (`:739`/`:774`) + the commit parent (`:836`); the moved-base check sits adjacent to the single resolution point.
  Add a one-line `gh-emit.js` comment stating the base is a captured snapshot (so a future re-resolve-HEAD regression
  is visible) and a test asserting the commit-parent + contents fetches use the frozen sha verbatim.

**FORWARD-CONTRACT (architect §4 — F-W3 note, NOT fixed here):** F-W2b correctly unblocks F-W3's live-head arming
(F-W4 precond #5): it lays the inert signed rail; F-W3 arms it by auto-capturing the live upstream tip at mint. **F-W3
author must document** that mint-capture -> emit-resolve spans the full approval TTL (24h), so a fast-moving upstream
will make short-TTL emits routinely fail-closed + require re-approval — a UX/operability consequence of arming, to be
surfaced in the F-W3 trade-off section, not silently discovered. F-W2b introduces no such hazard (dormant).

**Disposition:** crypto core DESIGN-READY (all three lenses); the folds D1-D11 are mechanical + bounded (none touch the
signed-basis design). Build against this section. VALIDATE (post-build) = full 3-lens (code-reviewer + hacker Rule-2a
live probes on the BUILT basis + honesty-auditor).

## VALIDATE result (post-build 3-lens board, 2026-07-02)

Built by a delegated `node-backend` builder (TDD, tests-first: the 5-field basis becoming 6 was the RED spec). The
BUILT diff (7 source + 8 test files) got the full 3-lens VALIDATE (Rule 2; Rule 2a — the hacker ran 8 LIVE node
probes that `require` the built modules + attack them with minted ed25519 approvals + a mock gh):

- **code-reviewer: SAFE-TO-SHIP** — 476 assertions green; all 11 folds landed + threaded IDENTICALLY across the 5
  basis sites; the D2 three-edit thread reaches the `emitPR:534` production call (the dead-guard is NOT present);
  D1's partial-mirror (no request param) correctly implemented; join-key correctly untouched. 1 LOW + 1 PRINCIPLE.
- **hacker: SAFE-TO-SHIP** — 8 live probes (co-forge, laundering, edit-flips-sig, exact-compare, draft-injection,
  TOCTOU, observability), NO bypass. Laundering a pre-F-W2b 5-field body fails with the DISTINCT
  `no-body-requested-base-sha`; editing `body.requestedBaseSha` flips the sig; a draft-planted value is IGNORED;
  the base is captured once + pinned; `emissionAxiom` byte-identical to `65142bc`. 1 HIGH (POSITIVE — the D2 thread
  is verified live) + 1 MEDIUM (the co-forge residual, documented) + 1 LOW.
- **honesty-auditor: SAFE-TO-SHIP, grade A** — 11/11 folds CODED (grepped + read each), explicitly NOT the F-W2
  comment-not-a-gate trap; byte-identity backed by a real full-body `deepStrictEqual` (not "old tests pass");
  temporal-impossibility honest (`emissionAxiom`/`computeEmissionHash` genuinely untouched); dormant honest
  (`''`-default mint). 2 LOW + 1 PRINCIPLE (positive attestation).

**Folds applied post-VALIDATE (this diff):**
- **ghEmit consumer-boundary guard (hacker LOW + code-reviewer PRINCIPLE, convergent).** The moved-base gate
  coerced only `undefined`; a `null`/`0`/`false` would be falsy and SILENTLY SKIP the gate (the unsafe direction).
  Added `isSafeBaseSha` at the `ghEmit` entry -> `emitEgressAlert('requested-base-malformed')` + throw, symmetric
  with the mint side. NON-VACUOUS test (each malformed input fires; zero writes). Unreachable live, load-bearing at
  F-W3 arming.
- **join-key-store forward-contract comment (code-reviewer LOW + honesty LOW, convergent).** `:55` documented the
  future PR-A2 broker-sig recompute as the 5-field basis; F-W2b made it 6. Refreshed to name `requestedBaseSha` so
  PR-A2 recomputes the basis `recordApproval` actually signs (else every non-empty-base verify fails-closed).
  Comment-only (the store stays code-untouched — the OUT ruling holds). Status-decay discipline.
- **leg-(b) coverage test (honesty LOW).** The inner `armedEmit -> ghEmit` forward was inspection-verified only;
  extended the interception test to drive a populated `requestedBaseSha` through the REAL `armedEmit` and assert it
  reaches the `ghEmit` args — so a dropped forward is caught by a unit test, not only the un-exercised network path.

**NOT fixed (documented residual):** the `''`-as-disable authority rests on the broker signature (integrity, not
provenance); under the standing same-uid co-forge residual, a co-forger can mint a `requestedBaseSha=''` approval
that disables the moved-base gate — but this adds NO new capability (the co-forge already mints ANY approval) and
is the pre-existing #273 family residual (NARROWS, not closes). **F-W4 forward-note:** the moved-base gate becomes
provenance-bound only when the deployed cross-uid broker signs the basis — add to the F-W4 arming preconditions.

**F-W3 forward-note (architect §4, NOT fixed here):** when F-W3 arms auto-capture, the mint-capture -> emit-resolve
span is the full approval TTL (24h), so a fast-moving upstream will make short-TTL emits routinely fail-closed +
require re-approval — a UX/operability consequence to surface in the F-W3 trade-off section, not silently discovered.

**Gate (post-fold, independently re-run):** full egress suite (23 files) + full kernel suite (116 files) green;
eslint clean, zero eslint-disable; `node --check` clean on all 7 sources; the emit-path golden-bytes byte-identical
(`''` vs omitted: argv + every POST body + call count `deepStrictEqual`). **DISPOSITION: SHIP** (SHADOW, emit-OFF,
byte-identical; the moved-base gate is DORMANT — production mint writes `''`; arms with F-W3).
