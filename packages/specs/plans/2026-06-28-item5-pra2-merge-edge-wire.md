---
phase: autonomous-sde-ladder
title: Item 5 PR-A.2 - the merge -> world-anchored-by edge MINT WIRE (SHADOW, unsigned)
status: planning
lifecycle: persistent
date: 2026-06-28
---

# Ladder item 5, PR-A.2 - the merge -> `world-anchored-by` edge mint WIRE (SHADOW)

Parent arc + ratified design: `packages/specs/plans/2026-06-27-item5-world-anchor-authenticated-edge-mint.md`
(D1/D2/D3/D5). PR-A.1 (the store firewall) is MERGED (#444, `3a0efd2`). PR-A.2 is the thin WIRE that makes a
REAL maintainer-merge actually mint a `world-anchored-by` edge, completing the structural item3->item5 loop.

## Scope (one focused change)

`cli.js mintFromAttestation`: after the world_anchored NODE mint succeeds (`m.ok`), mint ONE `world-anchored-by`
edge binding that node to the merged diff, via the already-validated `writeWorldAnchorEdge` store (#444). The
edge is **UNSIGNED by default** (SHADOW; the off-host signer is the SEPARATE PR-A2 vehicle). The edge gates
NOTHING (`LIVE_SOURCES` frozen-empty; no consumer admits `WORLD_ANCHOR_SOURCE`; an unsigned edge never enters
the authenticated lane). This wave proves the wire fires on a real merge + the lane composes end-to-end
internally (W3d-lite).

## The honest line

PR-A.2 moves trust ZERO. It makes a merge PRODUCE a signable edge; with the edge unsigned (no vehicle) and no
admitted source (PR-B not done), it gates nothing. #273 is NOT closed (the env-PEM default is same-uid-
forgeable; the wire does not even sign). PR-A2 (off-host signer) only NARROWS #273 to the same-uid co-forge
residual; only a DEPLOYED cross-uid/kernel-owned minter the host cannot `read()` + accumulated world-anchored
merges HARDEN (OQ-NS-6) - merged code only narrows.

## Runtime Probes (firsthand this session)

| Claim | Probe -> observed |
|---|---|
| the mint path: `runRecordMerge` -> `mintFromAttestation`, which reads the VERIFIED attestation + mints the node | [cli.js:91-159](../../lab/world-anchor/cli.js); `mintFromAttestation` is PRIVATE, gated on EXACT `outcome==='merged'` + a recorded confirmation |
| `att.diff_hash` is available + HEX64 (a valid `to_delta_ref`); read from the content_hash-sealed attestation | `att = store.readAnchor(...)` already in `mintFromAttestation`; `validateAttestation` enforces `diff_hash` HEX64 ([world-anchor-store.js:125](../../lab/world-anchor/world-anchor-store.js)) |
| the node mint returns `m.node_id` (the `from_node_id` for the edge) | `mintWorldAnchoredNode(...) -> { ok, node_id }` (cli.js:148) |
| `writeWorldAnchorEdge(rec, {dir, signer})` is the store writer; unsigned when `signer` is undefined | #444 `world-anchor-edge-store.js`; `WORLD_ANCHOR_EDGE_TYPE = ['world-anchored-by']` |
| cli.js is INSIDE `packages/lab/world-anchor/`, so importing the edge store does NOT trip the shadow dam | the dam forbids importers OUTSIDE world-anchor/ + zero callers of the READER/deriver; the wire calls the WRITER only |

## Routing Decision

```json
{ "recommendation": "root", "score_total": 0, "judgment_override": "route",
  "rationale": "substrate-meta stakes-miss again; escalated by judgment - this touches the merge-ingestion data-mutation path in the #273 family (Rule 2: data-mutation diffs get the full 3-lens VERIFY), though the surface is thin (a hook into already-validated code)." }
```

## Design (RATIFIED from the parent plan + the 3-lens VERIFY board folds)

### D1 - the hook (att.diff_hash binding + stable recorded_at + unsigned-by-default)
In `mintFromAttestation`, AFTER the node mint, mint ONE `world-anchored-by` edge:
- `from_node_id = m.node_id`; `edge_type = WORLD_ANCHOR_EDGE_TYPE[0]`.
- **`to_delta_ref = att.diff_hash`** read from the in-scope VERIFIED + content_hash-sealed `att` (`const att`
  at cli.js:123 - NO re-read, no TOCTOU; H1/A-4/H6). **Explicit guard: `isHex64(att.diff_hash)` BEFORE the
  write**, else refuse with `edge_reason:'bad-diff_hash'` + emit. NEVER `merge_sha` - `merge_sha` is an
  UNTYPED CLI arg (the tests use 8-char short SHAs like `cafef00d`/`d91785ea`, NOT 40-hex), so a 64-hex
  `--merge-sha` would pass `isHex64` and FORGE the node<->diff binding off a caller field (hacker H1).
- **`recorded_at = confirmed_at`** - the STABLE per-anchor confirmation timestamp threaded from `runRecordMerge`
  (`opts.now` or the `confirmed_at` it already computes at cli.js:97), NOT a fresh `new Date()` (architect A-5:
  `recorded_at` is OUTSIDE the `edge_id` basis but INSIDE `bodiesEqual`, so a non-deterministic value makes a
  re-merge COLLIDE-refuse instead of dedup).
- **`signer: opts.edgeSigner`** - a SIGNER FUNCTION `(id)->string|null|undefined` (the store's `signer` arg,
  NOT a PEM key; A-3). **Production passes `signer: undefined` -> UNSIGNED** (literally omit it; NEVER
  `resolveSigner({})`, whose env-fallback reads `LOOM_EDGE_SIGNING_KEY` and would let a same-uid host self-sign
  into the lane - hacker H2). PR-A2's off-host vehicle supplies the function with NO cli.js call-site edit.
- Edge dir: `opts.edgeDir` (tests) or the store `DEFAULT_DIR`.

### D2 - the edge is ADDITIVE to the node (structural guard, not prose; A-1/H3)
- **Compute the node result object FIRST** (`const nodeResult = { minted:true, node_id:m.node_id,
  deduped:!!m.deduped }`), THEN mint the edge, THEN `return { ...nodeResult, edge_minted, edge_id,
  edge_deduped, edge_signed, edge_reason }` (a FRESH spread, never mutate `nodeResult`). An edge-mint failure
  returns `nodeResult` byte-identical (node `minted:true` untouched) + `edge_minted:false` + `edge_reason`.
  `writeWorldAnchorEdge` is TOTAL (returns `{ok:false,reason}` on every refuse; `ensureStoreDir`/`currentUid`
  throws caught inside), so the edge call cannot throw out of `mintFromAttestation` - but the structure makes
  that a guarantee, not a dependency.
- **`edge_signed:false`** is a FIRST-CLASS field (honesty H1): `edge_minted:true` means "an integrity-only,
  UNSIGNED, SHADOW edge file exists; admitted by NO authenticated lane; gates nothing" - NOT a trusted edge.
- Tests (non-vacuous, A-1/H3): (a) the byte-identical-node test - the `nodeResult` fields are identical across
  edge-success and an injected edge-FAILURE (foreign-owned `edgeDir`), with `edge_minted:false` + a surfaced
  reason + an emitted alert; the failure test must FAIL RED against an unwired cli.js first (honesty H4).

### D3 - keep mintFromAttestation PRIVATE; test through runRecordMerge only (H4/A-2)
- The edge mint adds NO new caller and does NOT export `mintFromAttestation` (the cli.test.js:303
  "mintFromAttestation is NOT exported" assertion stays GREEN). All wire tests drive the PUBLIC `runRecordMerge`.
- The wire calls ONLY the WRITER (`writeWorldAnchorEdge`); it adds ZERO production caller of
  `authenticatedWorldAnchorIds`/`deriveWorldAnchorSource` (the shadow-dam zero-caller assertion stays green).

### D4 - the W3d-lite composition test (SCOPE: it proves WIRING, not production hardening; honesty H2)
The test proves the chain WIRES correctly given THREE injected-only inputs (an ephemeral `edgeSigner`, a
`verifyKey`, and `liveSources:['world-anchor']`) - ALL of which are frozen-off/absent in production
(`signer:undefined`, no verifyKey, `LIVE_SOURCES=Object.freeze([])`). It does NOT prove a real merge yields a
TRUSTED edge. Positive arm: signed edge -> `authenticatedWorldAnchorIds` -> `deriveWorldAnchorSource`
=`'world-anchor'` -> `buildRankingWeights({liveSources:['world-anchor']})` -> `retrieveBySignature` ranking
flip, over isolated rig nodes. NEGATIVE arm: the production (unsigned, no-key, frozen-LIVE_SOURCES) path ->
`'mock'` -> `admitWeightForRanking`=0 -> inert. Real lab-state dirs snapshotted before / byte-unchanged after /
temp root burned (the #444 W3d-lite pattern). Lives under `tests/` (outside the `packages/` zero-caller grep).

## Files
| File | Change | ~LoC |
|---|---|---|
| `packages/lab/world-anchor/cli.js` | import `writeWorldAnchorEdge` + `WORLD_ANCHOR_EDGE_TYPE`; mint the edge after the node mint in `mintFromAttestation` (node-result-first spread, D2); `to_delta_ref=att.diff_hash` + `isHex64` guard; `recorded_at=confirmed_at`; `signer:opts.edgeSigner` (undefined in prod); thread `now`/`edgeDir`/`edgeSigner` from `runRecordMerge`; surface `edge_minted`/`edge_id`/`edge_deduped`/`edge_signed`/`edge_reason` | ~40 |
| `tests/unit/lab/world-anchor/item5-merge-edge-wire.test.js` (NEW) | via the PUBLIC `runRecordMerge` only: merge -> unsigned edge happy (`edge_signed:false`); edge DEDUPS on re-merge (proves `recorded_at=confirmed_at` stability - asserts `edge_deduped:true`, NOT a collision); **byte-identical-node** test (edge-success vs injected foreign-`edgeDir` failure -> `nodeResult` fields identical, `edge_minted:false` + reason + alert, node `minted:true`; FAILS RED first); **`to_delta_ref===att.diff_hash` NEVER `mergeSha`** (a 64-hex `--merge-sha` != att.diff_hash -> edge binds att.diff_hash); **`LOOM_EDGE_SIGNING_KEY`-set-yet-UNSIGNED** regression (+ `authenticatedWorldAnchorIds` rejects it); the W3d-lite composition (3 injected seams) + the unsigned NEGATIVE arm | tests |
| `tests/unit/lab/world-anchor/cli.test.js` | extend: assert the new `edge_*` fields on the merged path; KEEP the `mintFromAttestation`-is-NOT-exported assertion GREEN; a structural assert that `cli.js` source never references `resolveSigner`/`LOOM_EDGE_SIGNING_KEY` (H2) | small |
| `docs/SIGNPOST.md` | regenerate if needed (no new file; likely no-op) | gen |

## Phases (TDD)
1. Plan -> 3-lens VERIFY (architect + hacker + honesty) -> fold.
2. TDD: the wire tests FIRST (red) -> delegated `node-backend` build to green.
3. 3-lens VALIDATE (code-reviewer + hacker live-reprobe + honesty) -> fold.
4. Gate (suite + eslint + the 4 drift gates by hand) -> PR -> CodeRabbit -> USER merge.

## HETS Spawn Plan
- **VERIFY (3-lens):** `architect` (the hook placement; does it weaken the confirmation-mint-only gate; the
  edge-as-additive-to-node boundary; the forward-contract to PR-A2/B) + `hacker` (can the wire be driven to
  mint an edge without a real merged confirmation; is `to_delta_ref` truly the verified `diff_hash`; does the
  production path ever sign with the env key; observability of the refuse) + `honesty-auditor` (any over-claim;
  is the unsigned-SHADOW line held; does `edge_minted` read as "trust gained").
- **VALIDATE (3-lens, Rule 2a):** `code-reviewer` + `hacker` live-reprobe of the BUILT wire (the real lab-state
  dirs untouched after a composition run; the env-key-set-yet-unsigned proof) + `honesty-auditor`.

## Out of scope
- The off-host edge VEHICLE (PR-A2) and the `LIVE_SOURCES` token flip (PR-B, deployment-gated).

## Drift Notes
- I initially told the user "NEXT = PR-A2 (vehicle)" but the parent plan's dependency order is WIRE (this) ->
  VEHICLE -> token-flip; the wire produces the edges the vehicle signs, so it is the correct next step.
- route-decide `root` on the substrate-meta stakes-miss again; escalated by judgment (thin surface, but the
  merge-ingestion + #273 family warrants the 3-lens VERIFY).

## Pre-Approval Verification (3-lens board `wf_30e31f5e-05f`, 2026-06-28)

**Verdict: PROCEED-WITH-FOLDS (architect + hacker + honesty). No CRITICAL. All folds applied above.**
- **architect** A-1 (node-result-first structural guard + byte-identical-node test, not prose); A-2 (composition
  test under `tests/`, wire calls the WRITER only, zero-caller dam stays green); A-3 (`edgeSigner` is a SIGNER
  FUNCTION, prod `signer:undefined`); A-4 (read `att.diff_hash` from the in-scope sealed `att`, no re-read);
  **A-5 (the sharp one): `recorded_at=confirmed_at` (stable per-anchor), else a re-merge COLLIDES not dedups**;
  A-6 (optional helper extraction - deferred, YAGNI for ~40 LoC).
- **hacker** **H1: bind `to_delta_ref=att.diff_hash` + `isHex64` guard, NEVER `mergeSha` (an untyped CLI arg, a
  64-hex one would forge the binding)**; **H2: prod `signer:undefined`, the env-key-set-yet-unsigned regression
  + a structural `cli.js` no-`resolveSigner`/`LOOM_EDGE_SIGNING_KEY` assert**; H3 (distinct `edge_*` fields,
  non-vacuous foreign-dir red-test, no `edge_minted:true` on a node-only path); H4 (keep `mintFromAttestation`
  private, test via `runRecordMerge`); H5 (composition test-only + the unsigned negative arm); H6 (the edge
  binds the two sealed records - test it).
- **honesty** H1 (`edge_signed:false` first-class; `edge_minted:true` == an integrity-only unsigned edge, not
  trust); H2 (the composition test proves WIRING given 3 injected-only seams, not production hardening - scope
  it); H3 (the honest line: PR-A2 NARROWS #273, only a DEPLOYED cross-uid minter + accumulated merges HARDEN);
  H4 (at VALIDATE, show the additive red-test FAILING first - "additivity proven", not "by construction").

## VALIDATE result - PR-A.2 (3-lens board `wf_bfecabb7-724`, 2026-06-28)

**Verdict: SHIP-WITH-FOLDS (code-reviewer + hacker live-reprobe + honesty). Zero CRITICAL/HIGH, zero bypass.**
The hacker ran **11 live probes** driving the public `runRecordMerge` (binding-forgery, env-key self-sign,
additive-failure, dedup/replay, gate-bypass, ranking-reach, real-store containment); ALL 6 load-bearing
invariants held: `to_delta_ref`=`att.diff_hash` (never `mergeSha`; a same-PR-attestation launder is refused
`ambiguous`); production ignores ambient `LOOM_EDGE_SIGNING_KEY` and mints UNSIGNED; an edge-mint failure never
reverts `minted:true` (no throw escapes); re-merge dedups on the stable `confirmed_at`; `mintFromAttestation`
stays private; the real `~/.claude/lab-state` tree is byte-unchanged. Folds applied:
- **hacker H1 / honesty H1 (MED): `edge_signed` was fail-silent** - computed from `typeof opts.edgeSigner`
  (signer SUPPLIED), so a supplied-but-failing signer reported `edge_signed:true` over an UNSIGNED on-disk edge.
  NOT an auth bypass (the lane keys on persisted truth, admits 0), but a lying field load-bearing under PR-A2.
  **Fixed: `edge_signed` now re-reads the persisted edge (`loadWorldAnchorEdge(...).sig_alg`)** - on-disk truth,
  not the input. + a regression test (a garbage signer -> `edge_signed:false`). Suite 6 -> 7.
- **code-reviewer F1 (LOW):** `mintWorldAnchorEdge(node_id, diffHash, opts = {})` default param (the totality
  claim is now provable from the body, not caller discipline).
- **code-reviewer F2 (LOW):** `runRecordMerge` `@param` JSDoc updated with `edgeDir`/`edgeSigner`.
- **code-reviewer F3 / honesty F4 (LOW) - DIVERGENCE NAMED:** the plan's D1 explicit `isHex64(att.diff_hash)`
  guard with a distinct `bad-diff_hash` token was SUBSUMED by the store's `bad-to-delta-ref` re-validation
  (the path is unreachable - `att.diff_hash` is attestation-sealed-HEX64 on write AND content_hash-re-verified
  on read). No code change; the store IS the guard, surfaced as `edge_reason`.
- **honesty F2 (LOW) - red-first recorded:** the byte-identical-node/additive test FAILED RED against the
  unwired cli.js (`r.edge_minted` was `undefined`) before the wire landed - additivity is PROVEN, not "by
  construction" (the build agent logged this).
- **honesty F3 (LOW):** suites RUN green by code-reviewer + hacker: `item5-merge-edge-wire` 7, `cli.test` 21,
  `world-anchor-edge-store` 31, full world-anchor suite + siblings green; eslint clean.

**Gate after folds:** world-anchor suite (7 + 21 + 31 + siblings) all green; eslint + ASCII clean; the 4 drift
gates clean. (`judge-labeler-armed-guard.test.js` 4 fails are PRE-EXISTING on clean main - the #435/#436
sandbox SCAR, unrelated to this wire.)
