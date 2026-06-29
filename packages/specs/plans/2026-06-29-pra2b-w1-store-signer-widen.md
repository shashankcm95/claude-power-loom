# Plan — PR-A2b W1: widen the world-anchor edge signer to carry the recompute body (SHADOW, weight-inert)

/ lifecycle: persistent (per-wave plan; accretes VERIFY/VALIDATE/CodeRabbit records as the wave completes)

## Context

PR-A2b (the cross-uid edge-signer vehicle, Vehicle B — ratified 2026-06-29; scope doc `packages/specs/research/2026-06-29-pra2b-custody-vehicle-scope.md`) closes the #273 co-forge leg by signing the `world-anchored-by` edge with a key the same-uid host cannot `read()`. The **gating precondition** (scope §5 item 1) is this wave: the store signer is currently one-arg `opts.signer(edge_id)` with **no body** (`world-anchor-edge-store.js:213-215`), so the future cross-uid broker has **nothing to recompute-inside against** — `signRecordId`/`signEdgeId` is domain-agnostic and signs *any* hex64 (`edge-attestation.js:118-120`), so without the body a deployed signer is a sign-arbitrary-64-hex oracle gated only by WHO. Recompute-inside is impossible until the signer receives the edge body. **This wave widens that contract and nothing else.**

## Goal

Widen the crypto-agnostic signer call from `opts.signer(edge_id)` to `opts.signer(edge_id, edgeBody)`, where `edgeBody` is the exact identity basis `deriveWorldAnchorEdgeId` hashes — `{ from_node_id, to_delta_ref, edge_type }` (NOT `recorded_at`, NOT `edge_id`). A Wave-2 cross-uid broker will recompute `deriveWorldAnchorEdgeId(edgeBody) === edge_id` before signing; this wave only *delivers the body to the signer* and proves it arrives correctly. SHADOW: production passes `signer: undefined` (edges stay UNSIGNED); the new arg is additive and backward-compatible.

## The change (precise)

In `writeWorldAnchorEdge` (`world-anchor-edge-store.js`), inside the existing `typeof opts.signer === 'function'` guard:

- Construct a fresh, frozen `edgeBody = Object.freeze({ from_node_id: rec.from_node_id, to_delta_ref: rec.to_delta_ref, edge_type: rec.edge_type })` — the same three already-validated fields `deriveWorldAnchorEdgeId(rec)` consumed two lines above (the endpoints passed `isHex64`, the type passed `WORLD_ANCHOR_EDGE_TYPE.includes`). Immutability: a NEW object, never a reference to or mutation of the caller's `rec`.
- Call `opts.signer(edge_id, edgeBody)` (was `opts.signer(edge_id)`).
- Everything downstream (the `isCanonicalBase64` shape-gate, the `sign-failed` emit-on-bad-output, persist-UNSIGNED-on-failure) is unchanged. The store stays crypto-agnostic: it forwards the body, never inspects or trusts it.

## Backward-compatibility + SHADOW-safety (the load-bearing invariants)

- **A one-arg signer still works.** JS ignores extra positional args, so every existing `(id) => signEdgeId(id, ...)` signer (all current call sites are tests) behaves identically. No existing test should need a behavioral change to keep passing.
- **Production is byte-identical.** The sole production caller (`world-anchor-mint.js:212`, via `mintWorldAnchorEdge`) passes `signer: opts.edgeSigner`, and `edgeSigner` is `undefined` in production → the `typeof === 'function'` guard is false → `edgeBody` is never even constructed. Zero production behavior change; edges stay UNSIGNED/SHADOW.
- **The body excludes `recorded_at`.** `recorded_at` is deliberately OUTSIDE the `edge_id` basis (a re-record at a different time dedups), so it must NOT be in `edgeBody` — else a Wave-2 broker recomputing `deriveWorldAnchorEdgeId(edgeBody)` would mismatch the `edge_id`. The body is exactly the three id-basis fields.

## Files (production)

| File | Change | ~LoC |
|---|---|---|
| `packages/lab/world-anchor/world-anchor-edge-store.js` | the signer call widen (construct frozen `edgeBody`, call `opts.signer(edge_id, edgeBody)`); update the `@param signer` JSDoc type to `(id, edgeBody) => string|null|undefined`; refresh the crypto-agnostic header note (the signer now also receives the recompute body for the future Wave-2 broker; the store still never inspects it) | ~10 |
| `packages/lab/world-anchor/world-anchor-mint.js` | update the two `edgeSigner` JSDoc type annotations (`:201`, `:274`) from `(id: string) => ...` to `(id: string, edgeBody: {from_node_id,to_delta_ref,edge_type}) => ...`; `mintWorldAnchorEdge` passes `signer: opts.edgeSigner` UNCHANGED (a pure passthrough — the store now invokes it with two args). No behavioral change. | ~4 (doc) |
_(`cli.js` was considered but DROPPED per fold F2 — its `edgeSigner?: Function` JSDoc is already arity-agnostic, so the widen needs no change there: YAGNI.)_

No store schema change, no new module, no new export. The `opts.edgeSigner` plumbing through `mintFromMergeOutcome` → `mintWorldAnchorEdge` is untouched (a passthrough).

## Tests (TDD-treatment — write the new assertion first, run red, then implement)

In `tests/unit/lab/world-anchor/world-anchor-edge-store.test.js`:

1. **NEW (the contract): the signer receives `(edge_id, edgeBody)` with the exact id-basis body.** A spy signer captures both args; assert arg2 deep-equals `{ from_node_id, to_delta_ref, edge_type }` of the input `rec`, that `deriveWorldAnchorEdgeId(arg2) === arg1` (the body reproduces the id — the Wave-2 recompute precondition), and that `recorded_at`/`edge_id` are ABSENT from arg2. Run RED first (today arg2 is `undefined`).
2. **NEW (backward-compat, non-vacuous): a one-arg signer still signs.** A `(id) => signEdgeId(id, {privateKeyPem})` signer (ignoring arg2) produces a persisted, verifiable signed edge — proving the widen did not break the existing contract.
3. **NEW (immutability): the signer cannot mutate caller state through arg2.** Assert arg2 is frozen (a mutation attempt throws / is a no-op) and the persisted body is unaffected.
4. Confirm the existing signer tests (signed round-trip, sign-failed emit, throwing-signer fail-soft, replay/authenticated-lane) still pass unchanged (backward-compat regression sweep).

Touched-suite sweep: re-run `world-anchor-edge-store.test.js` + `world-anchor-mint.test.js` + `item5-merge-edge-wire.test.js` + `cli.test.js` + `full-arc-capture-flow.test.js` (`edge-store` / `item5` / `cli` / `full-arc` drive a signer; `world-anchor-mint.test.js` is a regression check — it passes none) + the full kernel suite. Drift gates: signpost (no new `.js` file → likely n/a, confirm), eslint, ASCII, release-surface.

## Out of scope (deferred to later PR-A2b waves / PR-B)

- **Wave 2** — `loom-edge-bind.js` (the recompute-inside: re-derive `deriveWorldAnchorEdgeId(ctx) === basis` inside the trust domain, refuse on mismatch) + `loom-edge-sign.js` (key-holder CLI) + `crossUidLoomEdgeSigner` launcher + the one-arg→`(basis,ctx)` adapter + `loom-edge-custody-verify` twin. This wave makes the body AVAILABLE; Wave 2 USES it.
- **Forward concern for Wave 2 (named, not solved here):** the bind must reproduce `deriveWorldAnchorEdgeId` EXACTLY, but it lives in `kernel/egress` (the broker) and `deriveWorldAnchorEdgeId` lives in `lab/world-anchor` — **kernel must not import lab.** Wave 2 must either (a) move the canonical derive recipe into a shared `kernel/_lib`, or (b) re-implement it in the bind with a cross-checked test asserting byte-parity. Decide in the Wave-2 plan.
- **The `from_node_id` non-authoritative framing** (scope §8.6): the store/consumer headers should state a consumer may NOT treat `from_node_id` membership as authoritative without the weight-minter's full-tuple commitment (PR-B). This is a header/doc accretion — land it WITH Wave 2's recompute-inside (where it becomes concrete), not in this signature-only wave, to keep W1 surgical. (Named so it is not lost.)
- **The arming flag, deploy helper, runbook, deployment + attestation** — later waves / operator.

## Runtime probes (verified firsthand, 2026-06-29)

- `Probe: grep writeWorldAnchorEdge callers → ` only `world-anchor-mint.js:212` in production; the rest are tests. Production passes `signer: opts.edgeSigner`, `edgeSigner` undefined.
- `Probe: read world-anchor-edge-store.js:208-218 → ` `const edge_id = deriveWorldAnchorEdgeId(rec); ... out = opts.signer(edge_id);` — one-arg, confirmed.
- `Probe: read deriveWorldAnchorEdgeId :109-116 → ` hashes exactly `[from_node_id, to_delta_ref, edge_type]` (null→'' coerced, String-wrapped); `recorded_at`/`sig`/`edge_id` are NOT in the basis. So `edgeBody` = those three fields.
- `Probe: grep signer test drivers → ` all are one-arg `(id) => signEdgeId(id, {privateKeyPem})` → backward-compatible with the widen (they ignore arg2).

## Drift notes

- The change is small (~15 LoC incl. doc) but auth-adjacent (the signer contract for the authenticated edge lane), so it carries the full per-wave board rhythm by judgment despite `route-decide → root` (the known substrate-meta lexicon miss; Rule 2 mandates the 3-lens VALIDATE for auth-adjacent diffs).
- TDD-treatment applies in spirit: the new behavior (signer gets the body) has no existing test, so write the asserting test first and run it RED (arg2 undefined) before implementing.

## Verification

- Touched lab suites + full kernel suite green; eslint + ASCII + release-surface clean; signpost (no new module) confirmed n/a.
- 3-lens VERIFY board (architect + hacker + honesty) on this plan BEFORE build.
- 3-lens VALIDATE board (Rule 2a, code-reviewer + hacker + honesty) on the BUILT diff — the hacker re-probes that arg2 cannot be a mutation/forge vector and that the body matches the id basis.
- CodeRabbit pre-PR (secret-free tree) + post-PR fold.

## VERIFY board folds (3-lens SHIP/SHIP/SHIP, 2026-06-29 — build directives, authoritative; override any contradicting plan-body line)

The board (architect + hacker + honesty) all SHIP, 0 CRITICAL/HIGH; the hacker ran 7 live probes (production `signer:undefined` → `edgeBody` never built; the widen cannot make an unsigned edge look signed, cannot change `edge_id`/dedup, opens no exfil — `edgeBody` is a strict SUBSET of the already-persisted body; a poison-mutating signer left the persisted edge + input `rec` untouched). Folds:

- **F1 (architect MED) — in-plan honesty guard against over-reading the widen.** Add to the impl/header prose: this wave only DELIVERS the body; it changes NO trust property in production (`signer:undefined`). A future broker's recompute-and-refuse (W2) closes the sign-arbitrary-64-hex oracle, but does NOT make `from_node_id` authoritative — that needs the PR-B weight-minter's full-tuple commitment (scope §8.6). Do not let "body delivered + recompute precondition met" read as "co-forge defeated."
- **F2 (architect MED + honesty LOW) — DROP the `cli.js` edit.** `cli.js:320` is a bare `edgeSigner?: Function` — already arity-agnostic, so the widen needs no change there (YAGNI; a no-op-risk edit). Scope is now TWO production files: `world-anchor-edge-store.js` + `world-anchor-mint.js`. The authoritative signer-contract type is the `@param signer` JSDoc at `world-anchor-edge-store.js:196-198` — widen THAT (the consumer `authenticatedWorldAnchorIds` is verify-side, takes edges not a signer → unchanged).
- **F3 (architect LOW) — test 1 pins the exact 3-key set on arg2.** Add `assert(Object.keys(arg2).sort()` deep-equals `['edge_type','from_node_id','to_delta_ref'])` alongside the deep-equal + `deriveWorldAnchorEdgeId(arg2) === arg1` + recorded_at/edge_id-absent checks. A future 4th field in `edgeBody` would NOT break the id-roundtrip (extra keys don't enter the positional array hash) but WOULD silently expand what the broker is handed — make that a deliberate test-breaking decision.
- **F4 (hacker LOW) — add `shadow-import-graph.test.js` to the touched-suite sweep + preserve the header tokens.** `shadow-import-graph.test.js:175-180` asserts `world-anchor-edge-store.js` retains `SHADOW`, `LIVE_SOURCES`, AND `#273` verbatim (9 occurrences live). Refreshing the crypto-agnostic header note must keep all three tokens, or that suite breaks. Add it to the sweep.
- **F5 (hacker LOW, W2 carry — not this wave) — the W2 one-arg→`(basis,ctx)` adapter must NOT be a direct passthrough** that hands the store's raw `(edge_id, edgeBody)` to a blind signer; W2's adapter routes through the recompute-binding broker. Named so W2 does not regress it.
- **F6 (honesty MED/LOW — prose hygiene) — consistent citations.** Use `world-anchor-edge-store.js:213-218` for the signer block consistently. `world-anchor-mint.test.js` is in the sweep for REGRESSION (it passes NO signer) — not because it drives a signer; correct the "all pass a signer" phrasing. The "TDD red first" line is a forward claim the build will demonstrate (run the new test RED before implementing), not a probed fact.

**Net build scope after folds: 2 production files** (`world-anchor-edge-store.js` signer-call widen + `@param`/header refresh; `world-anchor-mint.js` two `edgeSigner` JSDoc types) + the edge-store tests (new contract/back-compat/immutability tests with the exact-key-set assertion) + the touched-suite sweep incl. `shadow-import-graph.test.js`.

## Build + VALIDATE result (3-lens, Rule 2a — built diff in worktree `agent-aa634b6cce63f388a`)

Delegated TDD build (node-backend, isolation:worktree, agentId `aa634b6cce63f388a`; did NOT crash). TDD red-then-green confirmed (TEST A asserted arg2 deep-equals the basis → RED `actual: undefined` → impl → GREEN). 2 prod files (`world-anchor-edge-store.js` +27, `world-anchor-mint.js` +8) + test (+86); `cli.js` untouched (F2). Orchestrator firsthand-verified the disk (Rule-2a crash-salvage discipline): `node --check` clean, eslint exit 0, header tokens 11 (SHADOW/LIVE_SOURCES/#273 preserved, F4), F3 exact-3-key assertion present (test:150), edge-store 42 / mint 29 / shadow-import-graph 15 / kernel 108 all green.

**3-lens VALIDATE: SHIP / SHIP / SHIP.**

- **code-reviewer** SHIP, 0 findings — edgeBody is the exact 3-key basis (no recorded_at), fresh frozen, `buildBody` still reads `rec` not edgeBody, dedup/edge_id unchanged, 3 new tests non-vacuous.
- **hacker** SHIP — 20 live Rule-2a probes against the BUILT module, 0 broke a security property: a mutating signer (overwrite/add/delete a key) left the caller `rec` AND the on-disk body byte-identical with `Object.isFrozen(arg2)`; `deriveWorldAnchorEdgeId(arg2)===arg1` across 4 inputs; production-shape (no/undefined/non-function signer) builds NO edgeBody → persists UNSIGNED; no edge_id/dedup change, no unsigned-looks-signed, no exfil (arg2 is a strict subset of the already-persisted body). The sig basis is the edge_id string only (`edge-attestation.js:108`), so arg2 adds no signed material. 3 LOW forward-notes (no fix this wave): (a) the body delivery is inert this wave (honest); (b) shallow `Object.freeze` is sufficient ONLY because all 3 values are primitive strings — **switch to `deepFreeze` (already imported :52) if a future basis field is non-primitive** (W2 carry); (c) the W2 broker must itself recompute `deriveWorldAnchorEdgeId(arg2)===edge_id` and refuse-before-sign (the oracle close is W2, not this wave).
- **honesty-auditor** SHIP, grade A, NO-OVERCLAIM — the built diff delivers exactly the claimed scope; F1/F2/F3/F4 all confirmed in-artifact; TEST A non-vacuous (would fail RED if reverted to one-arg).

No VALIDATE folds required (all LOW, all forward-carries to W2). Drift gates: signpost n/a (no new `.js` module), eslint clean, ASCII clean, doc-path gate does not scan `packages/specs/`.

**W2 carries (from VALIDATE):** deepFreeze the recompute body if a non-primitive field is ever added; the W2 broker recompute-and-refuse over arg2 is the actual sign-arbitrary-64-hex oracle close; the W2 adapter must not be a blind passthrough (F5).

## CodeRabbit pre-PR fold (1 Minor, premise-probed + folded — the 11th straight wave CodeRabbit complemented the board)

`coderabbit review --base main` on the secret-free tree (BEFORE the PR opened) returned 1 Minor (Functional Correctness) on TEST C: it asserted `arg2` is frozen + the caller `rec` is unchanged, but never proved `edgeBody` is a SEPARATE object from the caller input — TEST C alone would pass even if the store froze `rec` in place and passed it. Premise-probed firsthand: TRUE for TEST C in isolation (TEST A's exact-3-key assertion would catch that regression, but TEST C should be self-sufficient, and "the caller input is NOT frozen as a side effect" was genuinely uncovered). Folded CodeRabbit's exact suggestion into TEST C: capture `seenBody`, then `assert.notStrictEqual(seenBody, input)` (freshness) + `assert.strictEqual(Object.isFrozen(input), false)` (no caller-input freeze side effect). 42 tests still green, eslint exit 0.

**Post-PR bot (3 Minor, all doc-consistency, all premise-probed + folded — `cad82ac`→fold commit):** the post-PR CodeRabbit bot posted 3 actionable Minor (Maintainability) comments, all DOC-only, all valid: (1) the Files table still listed `cli.js` though F2 dropped it → replaced with a struck note; (2) the test sweep said "all pass a signer somewhere" but `world-anchor-mint.test.js` passes none → corrected the wording (F6's body line was stale); (3) the scope doc §2 wrote `authenticatedWorldAnchorIds(edges, {verifyKey, allowEnvFallback:false})` implying `allowEnvFallback` is a consumer param, but the consumer signature is `(edges, {verifyKey})` and passes `allowEnvFallback:false` DOWN to `verifyEdgeSig` internally → corrected. Zero code touched (the code was already correct — these were doc-vs-code precision fixes). Confirms the prior-wave pattern: the async bot complements the board on doc-consistency too.
