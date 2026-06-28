---
phase: autonomous-sde-ladder
title: Item 3 (PR-3) - rebind to_delta_ref onto the kernel-sealed approval_hash + unify the mint onto the gh-verified lane
status: planning
lifecycle: persistent
date: 2026-06-28
---

# Ladder item 3 (PR-3) - rebind the `world-anchored-by` edge onto the kernel-sealed `approval_hash` + unify the mint onto the gh-verified lane (SHADOW)

Predecessors (all MERGED): item 3 node mint (#441), item 5 PR-A.1 signable edge lane (#444), item 5
PR-A.2 merge->edge mint WIRE (#445), item 1 egress join-key (#447), item 2 gh-verified merge-outcome
RECORD (#451). This PR is the natural CONSUMER of #451: it gives the merge-outcome record its first reader.

## Scope (one focused change)

Today the node/edge mint hangs off the LEGACY `record-merge` path: attestation-anchored, a PASTED `--merge-sha`,
and the edge's `to_delta_ref = att.diff_hash` (the *unauthenticated lab attestation's* diff hash). The
gh-verified item-2 lane (`observe-merge`) records the kernel-sealed `approval_hash` but mints nothing.

PR-3 moves the edge's trust anchor onto the kernel-authoritative, gh-verified join-key:

1. **NEW minter `world-anchor-mint.js`** consuming the gh-verified merge-outcome record (#451), binding the
   edge's **`to_delta_ref = outcome.approval_hash`** (the kernel-SEALED field) and the node's
   **`merge_sha = outcome.merge_commit_sha`** (gh-verified), instead of `att.diff_hash` + a pasted sha.
2. **`observe-merge` auto-mints** (additive): after `runMergeObserve` records a `merged` outcome, the cli
   arm calls the minter; a mint failure NEVER reverts the recorded outcome.
3. **Deprecate the legacy pasted-sha mint**: `record-merge` keeps recording the world-anchor-store
   confirmation but mints NO node/edge. The unsafe mint path (att.diff_hash + pasted sha) is removed, so
   there is EXACTLY ONE mint path (the gh-verified one).

SHADOW throughout: the edge stays UNSIGNED (no signer vehicle - that is the deferred PR-A2), no consumer
admits `WORLD_ANCHOR_SOURCE`, `LIVE_SOURCES` stays `Object.freeze([])`.

## The honest line

PR-3 moves trust from "anchored on an unauthenticated lab field" to "anchored on the kernel-authoritative
gh-verified join-key" - a genuine NARROWING of the #273 surface, NOT a close. The edge is still UNSIGNED
(same-uid co-forge of the merge-outcome record + attestation is still possible; the cross-check only catches
an HONEST divergence, not a coordinated plant), and it gates nothing. Per the ratified RFC
(`2026-06-18-authenticated-minter-provenance-close.md`, Option B) only a DEPLOYED cross-uid signer the host
cannot `read()` + accumulated world-anchored merges HARDEN (OQ-NS-6). Merged code only narrows. The signer
vehicle (PR-A2) and the `LIVE_SOURCES` flip (PR-B) stay deferred - and per the RFC's OQ-2 resolution they are
PREMATURE until ③.2 names a real gate on a lab-derived weight (③.2 is human-sole-gate today; lab weights SHADOW).

## Runtime Probes (firsthand this session)

| Claim | Probe -> observed |
|---|---|
| the merge-outcome record carries `approval_hash` (kernel-SEALED) + `merge_commit_sha` (gh-verified) + repo/pr_number/pr_url | [merge-outcome-store.js:88-91](../../lab/world-anchor/merge-outcome-store.js) `OUTCOME_KEYS`; `loadMergeOutcome(join_key_id)` returns the deep-frozen verified body |
| the observer records the SEALED approval_hash + returns `{ok, join_key_id, outcome, recorded, deduped}` | [merge-observer.js:98-110](../../lab/world-anchor/merge-observer.js); `approval_hash: jk.approval_hash` "the SEALED field (item-3 trust derives from THIS)" |
| today the edge binds `att.diff_hash` (lab attestation), merge_sha = a PASTED `--merge-sha` | [cli.js:213](../../lab/world-anchor/cli.js) `mintWorldAnchorEdge(m.node_id, att.diff_hash, opts)`; [cli.js:200](../../lab/world-anchor/cli.js) `merge_sha: mergeSha` from `args.mergeSha` |
| the attestation ALSO carries `approval_hash`, but it is LAB-WRITTEN (co-forgeable), NOT the authoritative one | [world-anchor-store.js:73](../../lab/world-anchor/world-anchor-store.js) `ATT_FIELDS`; backfill hardcodes it ([cli.js:66](../../lab/world-anchor/cli.js)) - use it ONLY as a defense-in-depth cross-check |
| the minter (a sibling INSIDE world-anchor/) needs NO dam relaxation | [shadow-import-graph.test.js:90,196-204](../../../tests/unit/lab/world-anchor/shadow-import-graph.test.js) skip files under WORLD_ANCHOR_DIR; a sibling importer is allowed |
| the kernel join-key dam STRUCTURALLY FORBIDS the minter from reading the join-key directly (forcing it onto the merge-outcome record) | [join-key-shadow.test.js](../../../tests/unit/kernel/egress/join-key-shadow.test.js) REQUIRE_ALLOWLIST = exactly {emit-pr.js, merge-observer.js}; a 3rd requirer FAILS the dam |
| `mintWorldAnchorEdge` is total (never throws); edge is UNSIGNED when signer undefined; `edge_signed` re-reads on-disk truth | [cli.js:141-158](../../lab/world-anchor/cli.js) (the PR-A.2 helper to relocate into the minter) |
| `resolveAnchorForPr({repo,pr_number,pr_url})` is the EXACT-set attestation join; `readAnchor` attaches the confirmation | [world-anchor-store.js:296-307,428-445](../../lab/world-anchor/world-anchor-store.js) |
| merge_commit_sha is HEX40 in the record; the legacy path passed arbitrary strings (8-char shorts in tests) to mintWorldAnchoredNode | [merge-outcome-store.js:130](../../lab/world-anchor/merge-outcome-store.js); BUILD must confirm `mintWorldAnchoredNode` accepts a HEX40 merge_sha |

## Routing Decision

```json
{ "recommendation": "root", "score_total": 0, "low_signal": true, "judgment_override": "route",
  "rationale": "substrate-meta stakes-miss again (the world-anchor lexicon is not in the routing dict); escalated by judgment - this is the #273-family merge-ingestion data-mutation path, so Rule 2 mandates the full 3-lens VERIFY (architect + hacker + honesty)." }
```

## Design (RATIFIED on the 3-lens VERIFY board folds)

### D1 - the new minter `world-anchor-mint.js` (the gh-verified-lane mint)
`mintFromMergeOutcome({ join_key_id }, opts)`:
- `loadMergeOutcome(join_key_id)` -> the verify-on-read'd record (or refuse `merge-outcome-unreadable` + emit).
- gate `record.outcome === 'merged'` (EXACT string; the record store only stores 'merged' today, but assert
  it - never a subset/includes).
- `resolveAnchorForPr({ repo, pr_number, pr_url })` from the RECORD's fields -> `anchor_id` -> `readAnchor` ->
  the VERIFIED `att` (or refuse `attestation-unreadable`/`no-match`/`ambiguous` + emit; resolveAnchorForPr
  already emits on 0/>1, but the minter ALSO emits its own `merge-outcome-unreadable`/`attestation-unreadable`
  at the minter layer so a triager sees "the minter refused", not just a store returning null - VERIFY M1).
- **ADVISORY cross-check (NOT a gate): `att.approval_hash === record.approval_hash`** -> on mismatch EMIT
  `approval-hash-divergence` (observable) but STILL mint, binding `to_delta_ref` to the KERNEL
  `record.approval_hash` regardless. `att.approval_hash` is lab-written + same-uid co-forgeable, so it is NEVER
  the binding source; a divergence must NOT block a legit mint - a fatal refuse would be BOTH over-strict (a
  legit merge whose attestation was written with a differently-computed `approval_hash` would never mint -
  architect A3) AND a same-uid DENIAL lever (plant a divergent attestation -> block all mints - hacker H1).
  Defense-in-depth = SURFACE the disagreement, never gate on the untrusted side.
- lesson lookup by the attestation's content_hash-SEALED `att.lesson_signature` from the orchestrator floor
  (`ORCHESTRATOR_LESSONS`, relocated here); no floor lesson -> refuse `no-floor-lesson` + emit. **TOTALITY
  (VERIFY M2): wrap `buildWorldAnchorLesson` in try/catch -> emit `lesson-build-failed` + return a refuse,
  NEVER throw** (the floor is frozen-validated today, but item 4 loads seeds at runtime; a throw here would
  crash the cli auto-mint arm). `mintFromMergeOutcome` is TOTAL end-to-end: every read is verify-on-read
  (returns null, never throws) and every refuse is a returned `{minted:false, reason}` + an emit.
- **node**: `mintWorldAnchoredNode({ anchor_id, merge_sha: record.merge_commit_sha, lesson_signature,
  lesson_body })` - merge_sha is now the GH-VERIFIED `merge_commit_sha`, NEVER a pasted arg.
- **edge** (node-result-first additive, the PR-A.2 D2 structure): `mintWorldAnchorEdge(node_id,
  record.approval_hash, { edgeDir, edgeSigner: undefined, now: record.observed_at })` -
  **`to_delta_ref = record.approval_hash`** (kernel-SEALED), `recorded_at = record.observed_at` (the stable
  per-record FIRST-WRITE timestamp read from `loadMergeOutcome`, NEVER a fresh `Date()`, so a re-mint DEDUPS;
  VERIFY L2), `signer: undefined` -> UNSIGNED.
- return `{ minted, node_id, deduped, mint_reason, edge_minted, edge_id, edge_deduped, edge_signed, edge_reason }`.
  **`edge_signed` is FIRST-CLASS HONESTY (VERIFY honesty MED-1): `false` is the PRODUCTION invariant (no signer).
  A consumer MUST read `edge_minted:true, edge_signed:false` as RECORDED-not-TRUSTED (an integrity-only, UNSIGNED,
  weight-inert edge), NEVER as a weight source. `minted`/`edge_minted` are RECORD events, not trust events.**

### D1a - the NAMED residuals (honest, deferred - the #273 family is observe-first)
- **The att-vs-record cross-check is defense-in-depth ONLY, not provenance** (hacker H1): both sides of a
  same-uid co-forge are set equal by construction (the forger writes both the merge-outcome record and the
  attestation via the same exported derivations). The cross-check catches an HONEST stale attestation / an
  uncoordinated divergence, NOT a coordinated plant. This must be commented verbatim in the minter header + at
  the cross-check site, so a future reader never mistakes it for the provenance gate. The provenance close is
  the deferred signer (PR-A2).
- **The node's lesson basis is a same-uid substitution lever once the floor grows (hacker H1a)**: the lesson is
  looked up by `att.lesson_signature` (a same-uid-forgeable attestation field) while the attestation is selected
  by the record's `(repo, pr_number, pr_url)` tuple. Today the floor is `LESSON_2137`-only, so the blast radius
  is one lesson; when item 4 makes the floor a runtime classifier map, a forger could bind the WRONG lesson to a
  real gh-verified merge. NAMED residual: when the floor grows past one entry, the lesson basis needs the same
  authenticated-minter treatment as the edge. Acceptable to defer (SHADOW, gates nothing) - but NAMED, not silent.
- **The node's `merge_sha` is gh-verified EVIDENCE, not authentication** (hacker H4): the EDGE (`to_delta_ref`),
  not the node, is the trust-anchor rebind target. The minter header must not over-claim node trust;
  `live-recall-store.js:24` already frames the merge SHA as world-evidence - keep that framing.

### D2 - the edge is ADDITIVE to the node (the PR-A.2 structural guard, carried verbatim)
Compute `nodeResult` FIRST, then mint the edge, then `return { ...nodeResult, ...edge }` (a FRESH spread,
never a mutation). `mintWorldAnchorEdge` is TOTAL (the store returns `{ok:false,reason}` on every refuse;
the helper re-reads the persisted edge for `edge_signed`). An edge-mint failure leaves the node `minted:true`
byte-identical + surfaces `edge_minted:false` + `edge_reason` + an emitted alert.

### D3 - observe-merge auto-mints in cli.js (NOT in merge-observer.js)
`mainObserveMerge`: after `runMergeObserve` returns `{ok:true, outcome:'merged', join_key_id}`, call
`mintFromMergeOutcome({join_key_id}, {dir, liveDir, edgeDir})` and merge the mint fields into the emitted
result. **merge-observer.js stays RECORD-only** (its "mints NO node/edge" header invariant + the
shadow-dam header test stay GREEN); cli.js (the orchestrator, inside world-anchor/) does the mint. A mint
failure does NOT change the `observe-merge` exit code from the record's success (additive); the mint reason
is surfaced + emitted.

### D4 - deprecate the legacy pasted-sha mint
`runRecordMerge` keeps `resolveAnchorForPr` + `recordConfirmation` (the world-anchor-store confirmation
sidecar ledger) but DROPS the `mintFromAttestation` call and the `minted`/`edge_*` result fields. Delete
`mintFromAttestation` + `mintWorldAnchorEdge` + `ORCHESTRATOR_LESSONS` from cli.js (relocate the edge helper
and the floor into `world-anchor-mint.js`). Update the cli.js header + USAGE: `record-merge` is
confirmation-only; `observe-merge` is the SOLE mint path (gh-verified, approval_hash-anchored, UNSIGNED SHADOW).

### D5 - the W3d-lite composition test (rehomed onto the new minter)
The PR-A.2 composition test proved the lane WIRES given 3 injected-only seams (`edgeSigner`, `verifyKey`,
`liveSources:['world-anchor']`), all frozen-off in production. Rehome it onto the new mint path: a
gh-verified merge-outcome record (injected gh runner) -> mint -> a signed edge ->
`authenticatedWorldAnchorIds` -> `deriveWorldAnchorSource`='world-anchor' -> `buildRankingWeights` flip,
over an ISOLATED rig; the production (unsigned, no-key, frozen-LIVE_SOURCES) arm -> 'mock' -> inert. Real
lab-state dirs snapshotted-before / byte-unchanged-after / temp root burned. Lives under `tests/` (outside
the `packages/` zero-caller grep).

## Security invariants (the #273 family - the load-bearing review surface)

- **`to_delta_ref` = the kernel-SEALED `record.approval_hash`** (read from the verify-on-read'd merge-outcome
  record), NEVER `att.approval_hash` (lab-written, co-forgeable) and NEVER `att.diff_hash` (the old
  unauthenticated anchor). The attestation's `approval_hash` is an ADVISORY defense-in-depth cross-check ONLY
  (emit-on-divergence, never a gate, never the binding source - see D1 + D1a).
- **`merge_sha` = the gh-verified `record.merge_commit_sha`**, NEVER a caller/CLI arg (the legacy pasted-sha
  forge surface is removed with the legacy mint).
- **EXACT-string outcome gate** (`=== 'merged'`), never a subset/includes (the manage-promote IDOR class).
- **The minter must NOT read the kernel join-key store** - it reads the merge-outcome record's already-sealed
  `approval_hash`. The kernel join-key dam (REQUIRE_ALLOWLIST = {emit-pr.js, merge-observer.js}) structurally
  ENFORCES this: a `require('.../join-key-store')` in `world-anchor-mint.js` would FAIL the dam. A test asserts
  the minter source carries no join-key-store require (belt + suspenders with the kernel dam).
- **Every refuse path OBSERVABLE** (emitEgressAlert) with a distinguishing reason in a non-`reason` key (the
  positional reason is clobbered by emitEgressAlert - the cli.js M1 lesson).
- **Verify-on-read everywhere**: the minter trusts only `loadMergeOutcome` (verify-on-read) + `readAnchor`
  (verify-on-read); it re-derives nothing from raw files.
- **edge_signed = on-disk truth** (re-read the persisted edge), never `typeof signer` (the PR-A.2 VALIDATE H1).

## Orphan disposition (ca648110 / spec-kitty #2137)

ca648110 has an attestation but NO kernel join-key (it predates #447), so `observe-merge` fails-closed on it
(no join-key) and it never reaches the new minter. With the legacy mint removed, ca648110 gets NO new node/edge
- it is a documented, forward-only grandfather (whatever node/edge it already has on disk stays; we do NOT
synthesize a fake join-key, which would be a #273 forgery + a fail-closed bypass). NO code carve-out.

## Files

| File | Change | ~LoC |
|---|---|---|
| `packages/lab/world-anchor/world-anchor-mint.js` (NEW) | `mintFromMergeOutcome({join_key_id}, opts)`; relocate `mintWorldAnchorEdge` + `ORCHESTRATOR_LESSONS`; D1-D2; to_delta_ref=record.approval_hash, merge_sha=record.merge_commit_sha; the approval_hash cross-check; node-result-first additive edge; every refuse observable | ~120 |
| `packages/lab/world-anchor/cli.js` | `mainObserveMerge` auto-mints after a merged record (D3); `runRecordMerge` loses the mint (D4, confirmation-only); delete `mintFromAttestation`/`mintWorldAnchorEdge`/`ORCHESTRATOR_LESSONS`; import the minter; header + USAGE update | ~ -60 / +25 |
| `packages/lab/world-anchor/merge-observer.js` | header note update - **REQUIRED, not doc-polish (architect A2 - it is a security-dam correctness claim)**: replace the stale ":27-29" line ("item 3 re-loads the join-key to obtain issueRef for the edge basis") with: item-3 reads `record.approval_hash` from the merge-outcome record; the edge basis carries NO issueRef, so NO join-key re-load occurs and the kernel REQUIRE_ALLOWLIST stays at two readers. A stale header would imply a (non-existent, dam-breaching) third join-key reader. | REQUIRED |
| `tests/unit/lab/world-anchor/world-anchor-mint.test.js` (NEW) | the minter: merged-record -> node+unsigned edge (`to_delta_ref===record.approval_hash`, `merge_sha===record.merge_commit_sha`); approval-hash-divergence EMITS but STILL MINTS (att != record -> binds `record.approval_hash`, NOT a refuse - D1/D1a); no-match/ambiguous/unreadable refuses (each emits); additive byte-identical-node on edge-failure (FAILS RED first); re-mint DEDUPS on record.observed_at; a join-key-store require absent (structural) | tests |
| `tests/unit/lab/world-anchor/item5-merge-edge-wire.test.js` | rehome the W3d-lite composition onto the new mint path (D5); the old record-merge mint assertions move/retire | tests |
| `tests/unit/lab/world-anchor/cli.test.js` | record-merge no longer mints (assert NO `minted`/`edge_*` on the merged path; confirmation still recorded); observe-merge now mints (assert the `minted`/`edge_*` fields on a merged record); keep the no-`resolveSigner`/`LOOM_EDGE_SIGNING_KEY` structural assert | tests |
| `docs/SIGNPOST.md` | regenerate (NEW .js file -> CI Test 121 SIGNPOST-drift otherwise) | gen |

## Phases (TDD)
1. Plan -> 3-lens VERIFY (architect + hacker + honesty) -> fold.
2. TDD: the minter + wire tests FIRST (red against the unwired code) -> delegated `node-backend` build to green.
3. 3-lens VALIDATE (code-reviewer + hacker live-reprobe of the BUILT minter + honesty) -> fold.
4. Gate (full lab/world-anchor + kernel suites + eslint + the 5 by-hand drift gates incl. signpost) -> draft
   PR -> un-draft for ONE CodeRabbit review -> premise-probe + fold -> USER merge.

## HETS Spawn Plan
- **VERIFY (3-lens, Rule 2):** `architect` (the minter placement + the observe-merge auto-mint boundary; is
  record-merge-confirmation-only the right deprecation vs full removal; does reading approval_hash from the
  merge-outcome record (vs re-loading the join-key) weaken provenance; the forward-contract to PR-A2/PR-B) +
  `hacker` (can the minter be driven to bind a non-kernel approval_hash; is the att-vs-record cross-check
  bypassable; can a pasted/forged field reach to_delta_ref or merge_sha; does the minter ever touch the
  join-key store; observability of every refuse) + `honesty-auditor` (is the "narrows not closes" line held;
  does `minted`/`edge_minted` read as trust gained; is the orphan disposition honest).
- **VALIDATE (3-lens, Rule 2a):** `code-reviewer` + `hacker` live-reprobe of the BUILT minter (drive the real
  `mintFromMergeOutcome` + observe-merge with planted records; the att-divergence refuse; the real lab-state
  byte-unchanged) + `honesty-auditor`.

## Out of scope
- The off-host cross-uid edge SIGNER vehicle (PR-A2) and the `LIVE_SOURCES` token flip (PR-B,
  deployment-gated). Both RFC-deferred-as-premature until ③.2 names a real gate on a lab-derived weight.
- Adding `approval_hash` to the NODE id basis (the node binds the lesson + the gh-verified merge_sha; the EDGE
  is the trust-anchor rebind target per the scoping decision).
- Re-loading the kernel join-key in the minter (the merge-outcome record's sealed approval_hash is sufficient;
  re-loading would force a kernel-dam relaxation for a SHADOW defense-in-depth - not worth the attack surface).

## Drift Notes
- MEMORY START-HERE + the gap-map "Still planned" both said "#441-446 are the OLD pre-join-key versions
  superseded by the join-key-anchored lane" - a status-decay bug. Git ground-truth: #441/#444/#445 are LIVE
  structural wires (items 3 + 5 PR-A.1/A.2), built BEFORE the join-key, NOT superseded. Fix MEMORY at PR close.
- route-decide `root` on the substrate-meta stakes-miss AGAIN (the world-anchor lexicon is absent from the
  routing dict) - the same miss every world-anchor plan hits; escalated by judgment per Rule 2.
- The merge-observer header `:27-29` anticipated "item 3 re-loads the join-key to obtain issueRef for the edge
  basis" - SUPERSEDED by this scope: the edge basis is `[from_node_id, to_delta_ref=approval_hash, edge_type]`,
  no issueRef, so no join-key re-load; the minter reads the merge-outcome record's sealed approval_hash. Update
  that header note.

## Pre-Approval Verification (3-lens board, 2026-06-28)

**Verdict: PROCEED-WITH-FOLDS (architect + hacker + honesty-auditor). Zero CRITICAL, zero HIGH design defect.**
All three independently confirmed the trust-rebind is sound and the "narrows not closes" line is honest. The
folds below are applied above (D1/D1a/Security invariants) + are the BUILD checklist for Phase 2.

**Design folds (applied above):**
- **A3 + H1 + honesty MED-2 (the load-bearing one): the att-vs-record `approval_hash` cross-check is ADVISORY
  (emit-on-divergence), NOT a fatal gate.** A fatal refuse is over-strict (a legit merge whose attestation
  carries a differently-computed approval_hash never mints) AND a same-uid denial lever. Bind `to_delta_ref` to
  the kernel `record.approval_hash` regardless; emit `approval-hash-divergence` on mismatch. (D1.)
- **H1a: NAMED residual** - the node's lesson basis (`att.lesson_signature`) is a same-uid substitution lever
  once item-4's runtime floor lands; today floor-size-1 bounds it. (D1a.)
- **H1 + H4: defense-in-depth + node-is-evidence-not-trust** commented verbatim in the minter header. (D1a.)
- **honesty MED-1: `edge_signed:false` is FIRST-CLASS** - RECORDED-not-TRUSTED, in the return-shape narration. (D1.)
- **M2: `mintFromMergeOutcome` is TOTAL** (lesson-build try/catch -> `lesson-build-failed`); the cli auto-mint
  arm treats a mint throw as observable-but-non-fatal (the record's success exit code stands). (D1 + D3.)
- **L2: `recorded_at = record.observed_at`** read from `loadMergeOutcome` (the persisted first-write value),
  never a fresh `Date()`. (D1.)
- **A2: the merge-observer header edit is REQUIRED** (security-dam correctness, not polish). (Files row.)
- **A7: state the orphan-by-id-basis-change explicitly** - existing world-anchor SHADOW nodes/edges are orphaned
  by the to_delta_ref + merge_sha basis change and intentionally NOT migrated (wipeable pre-live state).

**BUILD test obligations (Phase 2 checklist - architect A1 + hacker H2/H3/M1/M3):**
1. **Migrate (don't just delete) the mint-behavior coverage** into `world-anchor-mint.test.js`: identity-derives-
   from-the-VERIFIED-attestation-not-a-caller-field (H2); `no-floor-lesson` refuse; idempotent re-mint DEDUP on
   `record.observed_at`; additive byte-identical-node-on-edge-failure (FAILS RED against the unwired minter first).
2. **`item5-merge-edge-wire.test.js`: flip the `to_delta_ref` assertion** from `att.diff_hash` to
   `record.approval_hash` (rehome the W3d-lite composition onto the new mint path, D5).
3. **`cli.test.js`: assert record-merge no longer mints** - NOT just "no `minted` fields", but `mintFromAttestation`
   is no longer exported AND `record-merge --outcome merged --merge-sha <forged>` mints NOTHING (the legacy
   pasted-sha forge path is gone), while the confirmation IS still recorded.
4. **Structural test in `world-anchor-mint.test.js`: the minter source carries NO `join-key-store` require**
   (belt + suspenders with the kernel dam, which already fails on a third requirer - H2).
5. **Observable signals**, asserted: `approval-hash-divergence` EMITS but STILL MINTS (the load-bearing SHADOW
   signal; binds `record.approval_hash`, NOT a refuse - D1/D1a); the REFUSE paths `merge-outcome-unreadable`,
   `no-floor-lesson`, `lesson-build-failed`, `no-match`/`ambiguous` each emit AND return a refuse - all with a
   distinguishing token on a NON-`reason` key (M1).
6. **Auto-mint non-fatal** (M2): a planted off-floor / unreadable / foreign merge-outcome or attestation ->
   `observe-merge` still exits 0 with `edge_minted:false` + an emitted reason; the recorded outcome is untouched.
7. **HEX40 merge_sha** (honesty MED-3): exercise a real 40-hex `record.merge_commit_sha` flowing through
   `mintWorldAnchoredNode` unmodified (the node store accepts any bounded string; the HEX40 guarantee is UPSTREAM
   in `merge-outcome-store.js:130`, not the node store - do not claim the node enforces it).
8. **`resolveAnchorForPr` ambiguous (`>1`)**: covered as a fail-closed read-only refuse that does NOT touch the
   recorded merge-outcome (M3).

**Probe-row reword (honesty MED-3):** the merge_commit_sha row - "the node store accepts any bounded string
(`MAX.merge_sha=128`); the HEX40 guarantee is UPSTREAM in the record store. BUILD confirms a HEX40
`record.merge_commit_sha` flows through unmodified."

**LOW-3 closed firsthand:** `git log --oneline` confirms #441 (`84d5b72`), #444 (`3a0efd2`), #445 (`4780537`)
are MERGED commits (the live wires) - MEMORY's "#441-446 superseded" is the status-decay bug the drift note flags.
