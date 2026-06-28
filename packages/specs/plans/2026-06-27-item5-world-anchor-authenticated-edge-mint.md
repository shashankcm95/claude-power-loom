---
phase: autonomous-sde-ladder
title: Item 5 (PR-A) - world-anchor merge -> SIGNABLE world-anchored-by edge (SHADOW; gates nothing; #273 NOT closed)
status: planning
lifecycle: persistent
date: 2026-06-27
---

# Ladder item 5, PR-A - the world-anchor -> SIGNABLE `world-anchored-by` edge lane (SHADOW)

## What item 5 actually is (the recon reframing)

The gap-map (`packages/specs/research/2026-06-25-autonomous-sde-lifecycle-gap.md` L151-152) names item 5 as
*"Authenticated edge minter + ship a live token into `LIVE_SOURCES`. The #273 close; only after this does HARDEN
actually harden."* A 5-subsystem recon (`wf_934101aa-f7c`) + a 3-lens VERIFY board (`wf_fa6ae443-644`) + the ratified
minter RFC (`packages/specs/rfcs/2026-06-18-authenticated-minter-provenance-close.md`) + the MV-W3 plan + the
broker-vehicle plan (`2026-06-22-phase-3.2.5b-loom-broker-vehicle-plan.md`) reframe item 5 as a **multi-PR arc**:

1. **PR-A (THIS plan) - the SIGNABLE edge lane + the MINT WIRE.** Close the structural item3->item5 gap: a
   maintainer-merge currently mints a world_anchored NODE ONLY, never an EDGE, so a world-anchored node can earn NO
   trust-weight source **by construction**. PR-A adds a NEW `world-anchored-by` edge lane (its own store + its own
   authenticated reader + its own source token) and wires the merge confirmation to mint one, **signable through the
   already-frozen `resolveSigner` seam** (the off-host vehicle plugs in later with no call-site edit). SHADOW:
   `LIVE_SOURCES` stays frozen-empty, the new token is admitted by NO production consumer, the full chain is proven
   INTERNALLY (ephemeral key + injected allow-set, the W3d-lite pattern). Split into two sub-PRs (A-HIGH-2):
   - **PR-A.1 - the FIREWALL (build first):** the new `world-anchor-edge-store.js` + `authenticatedWorldAnchorIds`
     reader + `deriveWorldAnchorSource` + the shadow-import-graph dam extension + store/co-forge/replay tests.
     Gets its OWN dedicated 3-lens VALIDATE on the verify-on-read predicate (the entire #273 surface lives here).
   - **PR-A.2 - the WIRE:** the thin `cli.js` mint hook (`mintFromAttestation`) + the W3d-lite composition test.
2. **PR-A2 (deferred) - the off-host edge VEHICLE.** The cross-uid / kernel-owned edge signer the same-uid host
   cannot `read()`. Mirrors ③.2.5b's `loom-broker`; "closes nothing until DEPLOYED cross-uid + attested."
3. **PR-B (deferred, deployment-gated) - the TOKEN FLIP.** A NEW reviewed frozen literal adds `WORLD_ANCHOR_SOURCE`
   to `LIVE_SOURCES` + wires `deriveWorldAnchorSource` into the live ranking driver + relaxes the shadow dam for
   exactly that consumer. The confirmed-by lane + its frozen `EDGE_TYPE` are NEVER touched. This is the Rubicon.

## The honest line (carry into PR title / ROADMAP / MEMORY verbatim)

**PR-A moves trust ZERO.** It builds a SIGNABLE edge + the wire that an authenticated minter will sign; with no
off-host vehicle (PR-A2) and no admitted source (PR-B not done), the edge gates nothing. **The #273 same-uid co-forge
is NOT closed by PR-A** - the env-PEM default signer is same-uid-readable (Option A; RFC §3c), and key-possession that
matches the verifier's key is INTEGRITY, not PROVENANCE. PR-A defeats only the REPLAY forge (re-derive before trust);
the CO-FORGE (a key-holder mints a fresh valid edge) is the standing residual, tolerable ONLY because the lane gates
nothing. Only a DEPLOYED cross-uid vehicle (PR-A2) + accumulated world-anchored merges (PR-B) + the operator's
out-of-band uid attestation harden. (OQ-NS-6: merged code NARROWS; deployment + the world-anchored signal HARDENS.)

## Runtime Probes (firsthand-verified against the repo this session - NOT prose)

| Claim | Probe -> observed |
|---|---|
| a maintainer-merge mints a NODE ONLY; `world-anchor/` imports NONE of the edge modules | recon agent 3 grep `deriveEdgeId\|signEdgeId\|authenticatedEdgeIds\|confirmed-by` over `packages/lab/world-anchor/` = 0 |
| the merge wire today: `runRecordMerge` -> `mintFromAttestation` -> `mintWorldAnchoredNode` returns `m.node_id` | [cli.js:91-159](../../lab/world-anchor/cli.js) - mint gated on EXACT `outcome==='merged'` + a recorded confirmation; `mintFromAttestation` is PRIVATE (confirmation-mint-only) |
| `confirmed-by` edge basis HARD-requires a NON-EMPTY `fail_to_pass`; `deriveItemSource`/`authenticatedEdgeIds` are `confirmed-by`-ONLY | `isValidFtp`+`verifyEdge` ([recall-edge-store.js:71-74,109](../../lab/attribution/recall-edge-store.js)); the lane filters `edge_type!=='confirmed-by'` ([lesson-confirm.js:114](../../lab/causal-edge/lesson-confirm.js)) - **so a new `world-anchored-by` edge CANNOT reach `deriveItemSource` (A-CRIT-1); it needs its OWN reader + source deriver** |
| `to_delta_ref` must be HEX64; the world-anchor attestation carries `diff_hash` (HEX64) + `approval_hash` (HEX64); NO `fail_to_pass`; `merge_sha` is 40-hex | `validateAttestation` ([world-anchor-store.js:118-129](../../lab/world-anchor/world-anchor-store.js)); `diff_hash` qualifies as `to_delta_ref`, `merge_sha` does NOT |
| Fork A (synthesize `fail_to_pass=[issueRef]`) is a LIVE firewall breach, not a smell | hacker Probe 6: `writeEdge({to_delta_ref:diff64,edge_type:'confirmed-by',fail_to_pass:['2097']})` -> `{ok:true}`; `confirmedNodeIds`/`authenticatedEdgeIds` then ADMIT it into the REAL corpus predictor lane |
| edge signing seam is frozen; the env-PEM default is same-uid-readable (Option A; co-forgeable) | `writeEdge(rec,{signer})` ([recall-edge-store.js:148-164](../../lab/attribution/recall-edge-store.js)); `resolveSigner(opts.signer)` precedence then `loadPrivateKey`->`LOOM_EDGE_SIGNING_KEY` ([edge-attestation.js:58-64,99-111](../../kernel/_lib/edge-attestation.js)) |
| `LIVE_SOURCES = Object.freeze([])` - a frozen ARRAY (not Set); EXACT `.includes`, zero coercion | [weight-source-gate.js:37,42-47](../../lab/causal-edge/weight-source-gate.js); growth = a NEW frozen literal, NEVER a runtime `.add` |
| the SHADOW import-graph dam is BASENAME-specific (`world-anchor-store`,`live-recall-store`) - a NEW store has NO matcher | hacker H2 + honesty H1: `shadow-import-graph.test.js:47,54` IMPORT_RE hardcoded; the new store's reader is UNDAMMED until PR-A extends it |
| the verify-on-read predicate the new store must copy | `live-recall-store.js:202-247` (O_NOFOLLOW+fstat-same-fd, reject non-regular/foreign/oversize BEFORE read, re-derive id, exact-set closed-shape, emit on refuse) |
| the replay-forge defense the new lane reader must copy | `lesson-confirm.js:116-121` (`if (deriveEdgeId(e) !== e.edge_id) continue;` before trusting `from_node_id`) |
| `recall-edge-store.writeEdge` does NOT emit on refuse (silent `{ok:false}`) - the NEW store must emit like the world-anchor stores instead | honesty H4: `recall-edge-store.js:148-179` no `alert` import; `world-anchor-store.js`/`live-recall-store.js` emit on every refuse |

## Routing Decision

```json
{
  "task": "add a world-anchored-by edge lane + wire the merge confirmation to mint one (item 5 PR-A)",
  "recommendation": "root",
  "confidence": 0.4,
  "score_total": 0,
  "judgment_override": "route",
  "rationale": "route-decide scored 0 on the documented substrate-meta stakes-lexicon miss (route-decide.js:11-13). Escalated by judgment per H.7.16: a kernel/security trust-boundary change in the #273 family, multi-file, new content-addressed store. -> the full 3-lens VERIFY board (run: wf_fa6ae443-644, PROCEED-WITH-FOLDS x3)."
}
```

## The design (PR-A) - RATIFIED post-VERIFY

### D1 - WHERE the edge mint hooks in (PR-A.2)
In `cli.js` `mintFromAttestation`, AFTER `liveStore.mintWorldAnchoredNode` returns `m.ok`, mint a `world-anchored-by`
edge with `from_node_id = m.node_id`, inside the existing confirmation-mint-only gate (private; `outcome==='merged'`
+ recorded confirmation + node mint). **NON-VACUOUS + OBSERVABLE (H6):** an edge-mint failure emits a distinct
`mint_reason` (`edge-write-failed`/`edge-self-inconsistent`/`bad-diff_hash`), is surfaced in the `runRecordMerge`
return (`edge_minted:false` + `edge_reason`), and NEVER flips the node's `minted:true` into an implied "edge present".
A TDD red-test injects an edge-write failure (a foreign-owned edge dir) -> the refuse fires RED + emits, then revert.

### D2 - the edge basis (`to_delta_ref`)
`to_delta_ref = att.diff_hash` (HEX64) read from the VERIFIED attestation via `readAnchor` (NEVER a caller field -
the hacker-H2 discipline). NOT `merge_sha` (40-hex -> `isHex64` reject -> silent non-mint). **Scope note (H7/honesty
H6):** `diff_hash` is in the `anchor_id` basis AND the `content_hash` seal, so the binding is tamper-bound (cannot be
in-place-swapped). It does NOT establish that `diff_hash` is the REAL merged PR's diff - the attestation is same-uid
co-forgeable; world-anchor provenance is the open #273 residual closed only by PR-A2. The edge authenticates the
node<->diff binding; `merge_sha` world-evidence is sealed on the NODE, not the edge basis.

### D3 - the SIGNER: UNSIGNED-BY-DEFAULT (RATIFIED, A-MED-2 / honesty H2)
The edge is signable via `writeWorldAnchorEdge(rec, { signer })`. In production PR-A passes **`signer: undefined`**
(NOT `resolveSigner({})`, whose env fallback reads `LOOM_EDGE_SIGNING_KEY`) -> an UNSIGNED, integrity-only edge,
byte-identical to having no edge-sig. Tests inject an ephemeral `generateEdgeKeypair` signer. **A regression test
sets `LOOM_EDGE_SIGNING_KEY` in env and asserts the production wire still mints an UNSIGNED edge** (proving the live
path never reads it). **Signer-failure observability:** when an injected signer IS present but yields no valid sig,
the writer emits `emitEgressAlert('world-anchor-edge-sign-failed', ...)` (so a future PR-A2 vehicle failure is
observable, not a silent degrade to integrity-only).

### D4 - the STORE: RATIFIED Fork B (a NEW separate store; A-MED-1 / H5)
A NEW `packages/lab/world-anchor/world-anchor-edge-store.js`, sibling to `recall-edge-store` but with its OWN basis +
predicate (information-hiding: the edge-type decision is each store's secret). **Why Fork B and not A/C (SECURITY,
not auditability):** Fork A (synthesize a `fail_to_pass`) makes a world-anchor edge ENTER the real `confirmed-by`
predictor lane via `confirmedNodeIds`/`authenticatedEdgeIds` (a cross-lane firewall breach, hacker Probe 6); Fork C
mutates the frozen one-way-door `EDGE_TYPE` every existing edge_id is keyed on. Both rejected.

- **Basis:** `deriveWorldAnchorEdgeId(rec) = sha256(canonical([from_node_id, to_delta_ref, edge_type]))`. `edge_type`
  is this store's OWN frozen set `Object.freeze(['world-anchored-by'])` (NOT the causal-edge `EDGE_TYPE`). No
  `fail_to_pass`. No free-prose field, so the derived id IS the tamper-seal (no separate `content_hash` needed - the
  recall-edge-store rationale).
- **Crypto-agnostic store (A-MED-3):** the store persists the signer's OPAQUE output + shape-checks only (sig_alg pin
  + canonical-base64); it NEVER crypto-verifies. Crypto PROVENANCE is the reader's sole job (keeps an integrity-valid
  edge from being dropped on key rotation; the store stays key-free).
- **verify-on-read predicate (ENUMERATED, H1) - every check, each with a TDD red-test:**
  (a) `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` open + `fstat` the SAME fd;
  (b) reject non-regular / foreign-owned (`isForeign`) / `st.size > MAX` (16 KB - an edge is tiny) BEFORE `readFileSync`;
  (c) parse JSON; reject any key OUTSIDE the exact stored set (closed-shape exact-set, not subset);
  (d) `from_node_id` + `to_delta_ref` HEX64 (strict `typeof==='string'` BEFORE the regex - the #273 coercion guard);
  (e) `edge_type` in the frozen `['world-anchored-by']` set;
  (f) `recorded_at` a valid ISO string;
  (g) `edge_id` HEX64 == filename == `deriveWorldAnchorEdgeId(rec)`;
  (h) if a sig is present: `sig_alg==='ed25519'` + `isCanonicalBase64(edge_sig)` (SHAPE only, no crypto);
  (i) EVERY refuse path emits `emitEgressAlert` (mirror the world-anchor stores, NOT recall-edge-store's silent
  returns - honesty H4).
- **Header residual block (H3):** the store + the reader carry the SAME honest residual `lesson-confirm.js:103-125` /
  `item-source.js:19-24` carry: "INTEGRITY + key-possession-matching-the-verifier, NOT PROVENANCE; the same-uid
  co-forge is NOT defeated, only the REPLAY forge is; tolerable ONLY because no consumer admits this lane; the
  authenticated cross-uid/kernel minter is PR-A2."

### D5 - the lane reader + source deriver (the CORRECTED chain, A-CRIT-1)
A `world-anchored-by` edge does NOT and MUST NOT flow through `deriveItemSource`/`authenticatedEdgeIds` (confirmed-by
only). PR-A adds a PARALLEL, orthogonal lane that leaves the confirmed-by lane untouched:
- **`authenticatedWorldAnchorIds(edges, { verifyKey }) -> Set<from_node_id>`** (in the new store): fail-closed-EMPTY
  with no/empty `verifyKey`; for each edge RE-DERIVE `deriveWorldAnchorEdgeId(e) !== e.edge_id -> skip` (the
  replay-forge defense, H4), pin `sig_alg==='ed25519'` + `typeof edge_sig==='string'`, then `verifyEdgeSig(e.edge_id,
  e.edge_sig, { publicKeyPem: verifyKey, allowEnvFallback: false })`; add `e.from_node_id` only on a valid sig.
- **`deriveWorldAnchorSource(node, worldAnchorEdges, { verifyKey }) -> 'world-anchor' | 'mock'`** (mirrors
  `item-source.js` exactly): ENV-BLIND (require a non-empty `opts.verifyKey` BEFORE delegating, else `'mock'`);
  whole-body try/catch -> `'mock'` (auth-class fails CLOSED); `node_id in authenticatedWorldAnchorIds(...)` ->
  `WORLD_ANCHOR_SOURCE='world-anchor'`, else `'mock'`.
- **The W3d-lite composition test (PR-A.2)** proves the CORRECTED chain over ISOLATED rig nodes with an EPHEMERAL key:
  `signed world-anchored-by edge -> authenticatedWorldAnchorIds -> deriveWorldAnchorSource='world-anchor' ->
  buildRankingWeights({liveSources:['world-anchor']}) -> retrieveBySignature ranking flip`; and the NEGATIVE: an
  UNSIGNED edge -> `'mock'` -> gated to 0 -> inert. The real `~/.claude/lab-state` dirs are snapshotted before any
  require, asserted byte-unchanged after, and the temp root `rm -rf`-burned in a `finally`.
- **SHADOW stays STRUCTURAL (H2/honesty H1):** PR-A.1 EXTENDS `shadow-import-graph.test.js` with a THIRD matcher for
  `world-anchor-edge-store` (no importer outside `packages/lab/world-anchor/`) AND asserts `deriveWorldAnchorSource` /
  `authenticatedWorldAnchorIds` have ZERO production callers (the composition TEST is the only reader). Absent that
  assertion the SHADOW guarantee is unbacked. `LIVE_SOURCES` is NOT edited; `deriveItemSource` is NOT touched.

## Files

### PR-A.1 (the firewall - build first; dedicated 3-lens VALIDATE on the predicate)
| File | Change | ~LoC |
|---|---|---|
| `packages/lab/world-anchor/world-anchor-edge-store.js` (NEW) | `deriveWorldAnchorEdgeId`, `writeWorldAnchorEdge(rec,{dir,signer})` (crypto-agnostic, signer-failure-emit), the enumerated verify-on-read `loadWorldAnchorEdge`/`listWorldAnchorEdges`, `authenticatedWorldAnchorIds(edges,{verifyKey})` (re-derive + crypto-verify), `deriveWorldAnchorSource`, `WORLD_ANCHOR_SOURCE`, `WORLD_ANCHOR_EDGE_TYPE`; the residual-block header | ~190 |
| `tests/unit/lab/world-anchor/world-anchor-edge-store.test.js` (NEW) | verify-on-read red-test per (a)-(i); the co-forge red-test (exported deriver + sidecar -> integrity-valid but NOT in the authenticated lane); the replay red-test (kept sig + swapped from_node_id -> excluded); fail-closed-no-key; signer-failure-emit | tests |
| `tests/unit/lab/world-anchor/shadow-import-graph.test.js` | ADD the third matcher (`world-anchor-edge-store`) + the zero-production-caller assertion for the reader/deriver | +~25 |
| `docs/SIGNPOST.md` | regenerate (new `.js` file - the #260 drift gotcha) | gen |

### PR-A.2 (the wire - after A.1 merges)
| File | Change | ~LoC |
|---|---|---|
| `packages/lab/world-anchor/cli.js` | `mintFromAttestation` mints the edge after `m.ok` (D1/D2/D3); observable refuse; `edge_minted`/`edge_reason` in the return | ~30 |
| `tests/unit/lab/world-anchor/item5-mint-wire.test.js` (NEW) | the wire + the W3d-lite composition (ephemeral key, injected allow-set, real-dir byte-unchanged, burn) + the non-vacuous edge-refuse red-test + the `LOOM_EDGE_SIGNING_KEY`-set-yet-unsigned regression | tests |

## Phases (TDD - >=80 LoC substrate change with a security contract)
1. Plan -> 3-lens VERIFY (DONE: `wf_fa6ae443-644`, PROCEED-WITH-FOLDS x3, folded above).
2. **PR-A.1:** TDD the store FIRST (red: the verify-on-read per-check red-tests + co-forge + replay) -> delegated
   `node-backend` build to green -> 3-lens VALIDATE (the store's verify-on-read/co-forge predicate gets the dedicated
   adversarial pass) -> fold -> full gate (eslint + units + the 4 drift-gates by hand) -> PR -> CodeRabbit -> USER merge.
3. **PR-A.2:** TDD the wire + composition -> build -> 3-lens VALIDATE (Rule-2a: the BUILT real-dir-untouched probe) ->
   fold -> gate -> PR -> CodeRabbit -> USER merge.

## HETS Spawn Plan
- **VERIFY (pre-build, 3-lens):** DONE - architect + hacker + honesty, `wf_fa6ae443-644`, all PROCEED-WITH-FOLDS.
- **VALIDATE (post-build, per sub-PR, 3-lens, Rule-2a live re-probe):** `code-reviewer` + `hacker` (PR-A.1: forge a
  byte-valid edge against the BUILT store, prove the authenticated lane excludes the unsigned/replayed/co-forged edge,
  the real lab-state dirs untouched after a composition run) + `honesty-auditor`.

## Out of scope (PR-A)
- **The off-host edge VEHICLE -> PR-A2.** Mirrors ③.2.5b's `loom-broker` (its OWN edge-domain key file, NEVER the
  egress `LOOM_BROKER_*` nor an ambient `LOOM_EDGE_VERIFY_KEY` - the H2 dead-pin lesson).
- **The TOKEN FLIP + the shadow-dam relax -> PR-B (deployment-gated).** A NEW reviewed frozen literal adds
  `WORLD_ANCHOR_SOURCE` to `LIVE_SOURCES` + wires `deriveWorldAnchorSource` into the live ranking driver. The Rubicon.
- **`built_by` attribution + `ORCHESTRATOR_LESSONS`** - still deferred (item 4 residual).

## Forward-Contract
1. **PR-A2** = the off-host edge signer behind the `resolveSigner` seam (no PR-A call-site edit).
2. **PR-B** = `LIVE_SOURCES` += a NEW frozen literal with `WORLD_ANCHOR_SOURCE` + the live-driver wiring of
   `deriveWorldAnchorSource`, leaving the `confirmed-by` lane + its frozen `EDGE_TYPE` UNTOUCHED (A-HIGH-1: orthogonal
   lanes, never an `EDGE_TYPE` mutation).
3. The new store's basis + `authenticatedWorldAnchorIds` + `deriveWorldAnchorSource` are the contract PR-B consumes.

## Drift Notes
- route-decide scored `root` on the substrate-meta stakes-miss again (the documented catch-22); escalated by judgment.
- VERIFY A-CRIT-1 caught that my first D5 chain (a `world-anchored-by` edge through `deriveItemSource`) was impossible
  - the confirmed-by lane is hard-filtered. The corrected design adds a parallel lane; the board converted a CRITICAL
  design bug pre-build into a clean orthogonal-lane decomposition.
- The fail_to_pass-misfit fork is the SAME class MV-W3 W3c resolved (separate store); ratified Fork B on the SECURITY
  ground (Fork A is a live cross-lane breach, hacker Probe 6), not just auditability.

## Pre-Approval Verification (3-lens board `wf_fa6ae443-644`, 2026-06-27)

**Verdict: PROCEED-WITH-FOLDS (architect + hacker + honesty). All folds applied above.**
- **architect** A-CRIT-1 (the deriveItemSource-impossible chain -> the parallel `authenticatedWorldAnchorIds` lane);
  A-HIGH-1 (PR-B unification = a new token, never an EDGE_TYPE mutation); A-HIGH-2 (split store/wire into PR-A.1/A.2);
  A-MED-1 (ratify Fork B as SECURITY); A-MED-2 (unsigned-by-default + signer-failure emit); A-MED-3 (crypto-agnostic store).
- **hacker** H1 (enumerate the full verify-on-read predicate + per-check red-tests); H2 (extend the shadow dam for the
  new store/reader); H3 (the integrity!=provenance residual block in the new store/reader); H4 (re-derive before trust
  in the new lane reader); H5 (Fork A is a live corpus-pollution breach - lock Fork B); H6 (non-vacuous + observable
  edge-mint refuse); H7 (the diff-not-merge scope note).
- **honesty** H1 (make the no-consumer SHADOW guarantee a green test, not prose); H2 (the no-env-key claim conditional
  on signer:undefined + a env-key-set regression test); H3 (retitle: world-anchored-by, SHADOW, #273-NOT-closed);
  H4 (recall-edge-store does NOT emit on refuse - the new store must); H5/H6 (Fork-B pre-decision named; diff-scope note).

## VALIDATE result - PR-A.1 (3-lens board `wf_11d59d91-51f`, 2026-06-27)

**Verdict: SHIP-WITH-FOLDS (code-reviewer + hacker live-reprobe + honesty). Zero CRITICAL, zero security bypass.**
The hacker ran **26 live probes** against the BUILT store (Rule 2a): co-forge (the documented key-possession!=provenance
residual, P2), replay defeated (re-derive, P3), wrong/no-key + env-blind (P4/P5/A3), the full verify-on-read predicate
a-i, auth-lane bypass (A1-A7, incl. `__proto__` no-pollution), dedup/TOCTOU collision, and dam containment (zero
production callers, `LIVE_SOURCES` frozen-empty -> a forged edge cannot reach a ranking). All held. Folds applied:
- **CR-1 (HIGH):** the `collision` refuse branch had ZERO test coverage -> added a non-vacuous collision test (unsigned-
  then-signed same dir -> `{ok:false,reason:'collision'}` + emit, original file untouched). Suite 30 -> 31.
- **CR-2 / CR-3 (LOW):** `buildBody` now a single spread (no local mutation; also cleared the TS `edge_sig` hint); signer
  JSDoc widened to `string|null|undefined`.
- **hacker H4 (LOW):** added `isHex64(e.to_delta_ref)` to `authenticatedWorldAnchorIds` (defense-in-depth: the lane's
  input contract now matches the store read contract even for a non-store feeder).
- **honesty H2 (LOW):** the `deriveWorldAnchorSource` no-key test was vacuous (queried `edge_id`, never a `from_node_id`)
  -> now queries the genuine `from_node_id` subject so it fails RED if the fail-closed were removed.
- **SIGNPOST (MED, all 3 lenses):** regenerated `docs/SIGNPOST.md` (the new `.js` file; the recurring CI-blocking SCAR)
  + ran the 4 drift gates by hand (signpost/release-surface/contracts/doc-paths) all clean.
- **hacker H2 (MED) - NO PR-A.1 change; the standing HARD GATE for PR-B:** the same-uid co-forge is REAL + honestly
  documented; do NOT add `WORLD_ANCHOR_SOURCE` to `LIVE_SOURCES` until PR-A2 lands the off-host minter the same-uid host
  cannot read(). Carry the residual block verbatim through PR-B review.
- **hacker H3 (LOW) - accepted:** the dam regex misses template-literal/concat/createRequire import forms (same as the
  sibling matchers); the load-bearing guard is the call-graph zero-caller assertion, which is present + passing.

**Gate after folds:** world-anchor suite 31 + 10 (+ siblings) all green; eslint clean; the 4 drift gates clean.
