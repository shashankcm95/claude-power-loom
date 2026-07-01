---
lifecycle: persistent
status: PLAN — pre-VERIFY
wave: PR-B B2 (the #273 condition-4 close; commitment-gated world-anchor admission)
tracks: autonomous-SDE lifecycle gap-map item 5 (first-HARDEN-gate); RFC weight-gate-arc
---

# PR-B B2 — commitment-gated world-anchor admission (`admitWorldAnchorNode`, SHADOW)

## Goal (one wave, SHADOW, no dam opens)

Add a NEW in-dir pure function `admitWorldAnchorNode(node, opts)` to `packages/lab/world-anchor/`
that decides whether a persisted `world_anchored` node's `'world-anchor'` source token is
**commitment-verified (trustworthy)** — by RE-verifying, at admission time, PR-A2a's STEP 1
(broker_sig) + STEP 2 (lesson-commitment binding) against the SEALED merge-outcome bundle.

B2 is the **#273 condition-4 close mechanism** (edge signer already DEPLOYED+attested = conds 2+3).
It is the ADMISSION TAG only. It does **not**:

- flip `LIVE_SOURCES` (stays `Object.freeze([])`),
- wire into the recall retriever / `buildRankingWeights` (that is **B3**),
- gain any production caller (the shadow-import-graph dam stays closed — asserted by a test).

Reachable-not-trusted: the full mechanism, unit-proven, inert in production.

## Why Option C (re-verify at admission), settled

`commitment_verified` is computed at MINT (`world-anchor-mint.js:474-520`) but returned as a
**record-event that never enters the node/edge schema** (line 519-520 JSDoc). So admission cannot
read a persisted flag. Three options were weighed (topic file `weight-gate-rfc-arc`):

- **A — persist `commitment_verified` into the node**: REJECTED (reopens the frozen node seal;
  a self-asserted boolean is exactly the integrity≠provenance anti-pattern — a co-forger sets it true).
- **B — re-derive the commitment only** (STEP 2 alone): REJECTED (drops STEP 1, the broker_sig
  provenance gate — the only thing an unauthorized writer cannot reproduce).
- **C — re-verify STEP 1 + STEP 2 at admission from the sealed bundle**: CHOSEN. The merge-outcome
  record is `content_hash`-sealed and carries the full bundle `{lesson_commitment, approvedAt, nonce,
  key_id, broker_sig, approval_hash}`; B2 re-runs the identical crypto the mint ran, independently of
  any transient flag.

## Runtime Probes (signatures confirmed firsthand 2026-07-01 against `1c1b87a`)

| Claim | Probe → observed |
|---|---|
| node body carries the join inputs | `live-recall-store.js:60-65` `BASIS_FIELDS=['anchor_id','provenance','merge_sha','lesson_signature','lesson_body']`, `STORED_KEYS=[...BASIS,'node_id','content_hash']` → `node.anchor_id`, `node.lesson_signature`, `node.lesson_body`, `node.node_id` all present |
| attestation supplies `{repo,issueRef,pr_number}` | `world-anchor-store.js:71-74` `ATT_FIELDS` includes `repo, issueRef, pr_number`; `readAnchor(anchor_id, opts)` exported (`:428`, `:481`) returns the verify-on-read frozen record |
| join-key basis | `join-key-store.js:148` `deriveJoinKeyId({repo,issueRef,pr_number,approval_hash,lesson_commitment})` = sha256 over those 5 (null→`''` coercion) |
| merge-outcome direct load + sealed bundle | `merge-outcome-store.js:362` `loadMergeOutcome(join_key_id, opts)` DIRECT (filename=join_key_id); `OUTCOME_KEYS` (`:108`) carries `approval_hash, lesson_commitment, approvedAt, nonce, key_id, broker_sig`; `content_hash`-sealed; **`join_key_id` is OPAQUE on read (no re-derive from body — `:302-304`)** |
| STEP 1 basis + verify | `approval.js:88` `approvalSigBasis({hash,approvedAt,nonce,key_id,lesson_commitment})`; `edge-attestation.js:142` `verifyRecordSig(recordId, sigB64, {publicKeyPem, allowEnvFallback})` fail-soft (never throws) |
| STEP 2 commitment | `lesson-commitment.js:37` `computeLessonCommitment({lesson_signature,lesson_body})` → 64-hex; **THROWS on empty/non-string** (`:39-41`) |
| signed-edge membership | `world-anchor-edge-store.js:406` `authenticatedWorldAnchorIds(edges,{verifyKey})` → `Set<from_node_id>`; re-derives edge_id + `verifyEdgeSig(..., allowEnvFallback:false)`; fail-closed on empty key. **Discards `to_delta_ref`** — B2 needs the edge, see §Edge-store extract |
| the mint's own STEP1/STEP2 | `world-anchor-mint.js:398-421` (STEP 1), `:463-492` (STEP 2). `record.lesson_commitment===''` → grandfather → STEP 2 SKIPPED, `commitmentVerified=false` (`:476-477`) |

## The unique join (resolves both B1-hacker HIGHs — no `approval_hash`-fanout, no `.find()` first-wins)

Given `node` (a verified world_anchored node), `edges` (world-anchored-by edges), `verifyKey`:

0. **env-blind guard (before any join work).** Require a non-empty `brokerVerifyKey` AND `edgeVerifyKey`
   up front (`typeof === 'string' && length > 0`), else short-circuit `{admitted:false, source:'mock',
   reason:'no-verify-key'}` + emit. A PRESENT-but-malformed PEM is NOT short-circuited here — it ENGAGES
   and fails closed downstream (`verifyEdgeSig`/`verifyRecordSig` return false on an unloadable key →
   `edge-sig-invalid`/`broker-sig-invalid`), mirroring the mint's asymmetric-parse (world-anchor-mint.js:388-393).
1. **Signed-edge membership + capture the edge (EXACT-ONE, not first-wins).** Filter `edges` to the
   AUTHENTICATED edges whose `from_node_id === node.node_id` (each re-derives its `edge_id` and passes
   `verifyEdgeSig(..., allowEnvFallback:false)` with **`edgeVerifyKey`**). Require **exactly one**; 0 →
   `no-authenticated-edge`, >1 → `ambiguous-edge`. Its `to_delta_ref` is the node's `approval_hash`.
   (Membership is necessary but NOT sufficient — the commitment re-verify below is what makes it so; the
   B1-hacker "signed-edge-alone" close.)
2. **Load the attestation** `att = readAnchor(node.anchor_id, {dir:anchorDir, selfUid})`; fail-closed
   if absent/tampered → `no-attestation`. `readAnchor(node.anchor_id)` transitively guarantees
   `att.anchor_id === node.anchor_id` (the read re-derives `deriveAnchorId({att.repo, att.issueRef,
   att.diff_hash}) === filename`), so the att is bound to the node's `anchor_id` — but that binding is
   itself same-uid-forgeable (see `## Residual`). Take `{repo, issueRef, pr_number}`.
2a. **att↔edge cross-bind (defense-in-depth).** Require `att.approval_hash === edge.to_delta_ref` →
   else `att-edge-approval-mismatch`. The attestation carries its OWN `approval_hash` (ATT_FIELDS); tying
   it to the edge's `to_delta_ref` binds the att, the edge, and (via step 7) the outcome to ONE
   approval_hash, so a co-forger cannot pair attestation-X's `{repo,issueRef,pr_number}` with an unrelated
   real merge's edge. (Does not close the same-uid quadruple co-forge — see `## Residual`.)
3. **Re-derive** `lc = computeLessonCommitment({lesson_signature:node.lesson_signature,
   lesson_body:node.lesson_body})` — per-step try/catch → fail-closed `bad-lesson-body` + emit (the
   primitive THROWS on empty/non-string, lesson-commitment.js:39-41). **Residual note:** `lc` is derived
   from the NODE body, not re-bound to the attestation's floor lesson the way the mint does
   (world-anchor-mint.js:463-492 re-derives over the sealed floor lesson) — the node body is same-uid-
   writable, so this proves body↔outcome consistency, NOT that the body is the merge's real lesson (see
   `## Residual`).
4. **Derive the UNIQUE join key** `jkid = deriveJoinKeyId({repo, issueRef, pr_number,
   approval_hash: edge.to_delta_ref, lesson_commitment: lc})`. The 5-tuple is unique per merge (no
   enumeration over an `approval_hash` that fans out to many PRs — the B1-hacker HIGH #1 close).
5. **Load the merge-outcome** `outcome = loadMergeOutcome(jkid, {dir:outcomeDir, selfUid})`;
   fail-closed if absent/tampered → `no-merge-outcome`. `loadMergeOutcome(jkid)` guarantees
   `outcome.join_key_id === jkid` (filename check) + `content_hash` seal, so the join_key_id FIELD is
   transitively bound — the ONLY unbound fields are the sealed-but-opaque `lesson_commitment`/
   `approval_hash`, cross-checked in step 7. Do NOT add a circular re-derive of jkid from the outcome body
   (the store deliberately refuses that, merge-outcome-store.js:302-305).
6. **STEP 1 re-verify (broker_sig, custody-pinned):** per-step try/catch wrapping BOTH
   `basis = approvalSigBasis({hash:outcome.approval_hash, approvedAt:outcome.approvedAt,
   nonce:outcome.nonce, key_id:outcome.key_id, lesson_commitment:outcome.lesson_commitment})` (THROWS on
   a non-string commitment, approval.js:90) AND
   `verifyRecordSig(basis, outcome.broker_sig, {publicKeyPem:**brokerVerifyKey**, allowEnvFallback:false})`
   → a throw → `auth-verify-error`; a false verify → `broker-sig-invalid`. Both emit. (Mirrors
   world-anchor-mint.js:398-412 exactly.)
7. **STEP 2 re-verify (body binding, non-circular cross-checks):** the merge-outcome store treats
   `join_key_id` as OPAQUE (does NOT re-derive it from the body), so a co-forger could plant a record
   at `jkid` whose sealed `lesson_commitment`/`approval_hash` FIELDS differ from what we hashed into
   `jkid`. Therefore require BOTH explicitly (these two are the ONLY body-field bindings left to B2):
   - `outcome.lesson_commitment === lc` → else `lesson-commitment-mismatch` (the node-body binding), AND
   - `outcome.approval_hash === edge.to_delta_ref` → else `approval-hash-mismatch` (the edge binding).
8. **Admit** iff 0-7 all pass → `{admitted:true, source:'world-anchor', commitment_verified:true}`.
   Any failure → `{admitted:false, source:'mock', commitment_verified:false, reason}` + an observable
   `emitEgressAlert('world-anchor-admit-<reason>')`. Whole-body outer try/catch as a final totality net
   (any unforeseen throw → `'mock'`, `reason:'admit-error'`), on TOP of the per-step named-reason catches.

### OQ3-5 grandfather — EXCLUDE (ratified; also the simpler impl)

A grandfather node (its merge-outcome carried `lesson_commitment===''`) has a REAL `lesson_body`, so
`lc` is non-empty, so `jkid` (step 4) is derived with a non-empty commitment and does **not** match the
`''`-derived join_key_id the grandfather's outcome was written at → `loadMergeOutcome` returns null →
fail-closed → NOT admitted as trustworthy. EXCLUDE is thus the STRUCTURAL default of the strict join:
no `''`-branch, no special-casing. (To ADMIT grandfathers would require a second `''`-join + a STEP-2
skip mirroring the mint — deliberately NOT built.) Consistent with the mint's own
`commitment_verified=false` for that class.

## Residual (#273 — B2 admission is INTEGRITY + key-possession, NOT provenance)

**Load-bearing, and the reason B2 is admission-tag-only + `LIVE_SOURCES` stays frozen-empty.** All three
VERIFY lenses converged here: `admitWorldAnchorNode`'s `commitment_verified:true` reads (by its name) as
more than it delivers. What it actually proves is that a (node, signed-edge, attestation, merge-outcome)
**quadruple is mutually self-consistent AND the sigs verify against the supplied keys** — i.e. INTEGRITY
+ key-possession-matching-the-verifier. It does NOT prove the legitimate producer minted them:

- Every join input is same-uid-writable: `node.anchor_id`, the attestation's `{repo, issueRef, pr_number,
  approval_hash}`, the edge's `to_delta_ref`, and the node body's `{lesson_signature, lesson_body}` are all
  lab-store fields an attacker who controls the stores can co-forge into a self-consistent quadruple. Every
  store re-verify (`readAnchor` content_hash, `readOutcomeRaw` content_hash, `verifyEdgeSig`, STEP 1
  `verifyRecordSig`, STEP 2 commitment) then PASSES — this is the #273 same-uid co-forge the mint header
  (world-anchor-mint.js:33-39) and edge-store header (:31-39) name as UNDEFEATED.
- **Trust-direction inversion vs. the mint:** the mint treats the attestation's `approval_hash` as ADVISORY
  and binds only the KERNEL-sealed `record.approval_hash` (world-anchor-mint.js:365-376). B2 derives its join
  FROM the attestation-supplied tuple + the edge-supplied `approval_hash`, both lab-written. The step-2a
  att↔edge cross-check + step-7 cross-checks make the quadruple internally rigid, but rigidity ≠ provenance.
- **What makes STEP 1 a REAL gate:** only a DEPLOYED cross-uid signing key the same-uid host cannot `read()`.
  The edge signer IS deployed + attested (uid 612 — #273 conds 2+3). Whether the APPROVAL `broker_sig` is
  ALSO cross-uid-custodial is a SEPARATE trust anchor (hence the split `brokerVerifyKey`) — probe the
  deployed topology before B3 arms. Until a live consumer admits this lane, the co-forge is reachable but
  gated by nothing (weight-inert).

B2 ships this residual OPENLY (this section) and PROVES it bounded with a hacker test (§TDD: the
co-forged-quadruple case admits `commitment_verified:true` — the documented SHADOW residual, asserted not
assumed). The close is PR-B5 arming gated on the deployed cross-uid broker + the operator's out-of-band uid
attestation (OQ-NS-6: merged code NARROWS, deployment HARDENS).

## Edge-store extract (the DRY-correct move — one predicate, shared not duplicated)

B2 needs the authenticated edge (for `to_delta_ref`), but `authenticatedWorldAnchorIds` discards it.
The edge-auth predicate is the SAME predicate (not a differing one), so SHARE it:

- Extract `authenticatedWorldAnchorEdges(edges, {verifyKey}) -> object[]` (the verified edges) in
  `world-anchor-edge-store.js`. **ALL of the current per-edge guards move VERBATIM** (world-anchor-edge-
  store.js:411-419): the object-shape guard, `edge_type` check, the `isHex64` triple on
  `from_node_id`/`to_delta_ref`/`edge_id`, the `sig_alg`+`edge_sig`-type check, the
  `deriveWorldAnchorEdgeId` re-derive-and-compare (replay defense), THEN `verifyEdgeSig` — a PARTIAL
  extract (moving only the sig verify, dropping the HEX64/shape checks) is a build-time slip the VALIDATE
  board must catch. The ONLY change is the return type: `Set<from_node_id>` → `object[]`.
- `authenticatedWorldAnchorIds` becomes
  `new Set(authenticatedWorldAnchorEdges(edges, opts).map(e => e.from_node_id))` — behavior-preserving
  (all existing edge-store tests MUST stay green; this is extract-and-delegate). RUN them, don't assume.
- **Dedup semantics differ (by design):** `authenticatedWorldAnchorIds` returns a Set (implicit
  `from_node_id` DEDUP across multiple valid edges to one node); `authenticatedWorldAnchorEdges` returns an
  ARRAY (no dedup — an array with two valid edges to one node is CORRECT, not a bug). B2's step-1
  "exactly-one edge for `node.node_id`" is what re-imposes uniqueness for B2's purposes — a one-line callout
  so the VALIDATE board doesn't mistake the array's potential duplicates for an extract defect.
- B2 consumes `authenticatedWorldAnchorEdges`, filters to `from_node_id===node.node_id`, requires
  exactly-one (0 → `no-authenticated-edge`, >1 → `ambiguous-edge`).

(This is NOT a deliberate-duplication case — that discipline is for DIFFERING verify predicates across
STORES; within one store, sharing the identical edge-auth predicate is correct DRY. Architect confirmed
the extract over a self-contained B2 filter.)

## Signature

```
admitWorldAnchorNode(node, {
  edges,                 // world-anchored-by edges (caller supplies; B2 does not read the edge store)
  edgeVerifyKey,         // ed25519 PUBLIC key for the world-anchored-by EDGE sig (loom-edge-signer, uid 612)
  brokerVerifyKey,       // ed25519 PUBLIC key for the merge-outcome broker_sig (the APPROVAL broker)
  anchorDir, outcomeDir, // opts-injected store dirs (test isolation / custody path)
  selfUid,               // opts-injected uid (test seam); resolves to currentUid() when omitted
}) -> { admitted: boolean, source: 'world-anchor'|'mock', commitment_verified: boolean, reason?: string }
```

- **TWO distinct trust anchors, NOT one** (architect/hacker LOW): the world-anchored-by EDGE is signed by
  the deployed cross-uid `loom-edge-signer` (uid 612); the merge-outcome `broker_sig` is the APPROVAL
  broker's sig. They may share a custody key in today's topology, but conflating them into one param bakes
  that in and makes a future key-separation a breaking change. Two explicit opts even if a caller passes
  the same value. Both are custody-pinned (`allowEnvFallback:false`); neither reads an ambient env key.
- **env-blind** (step 0): require BOTH keys non-empty up front → else `no-verify-key`; a present-but-
  malformed PEM ENGAGES + fails closed (never a silent degrade).
- **selfUid fail-CLOSED on null** (hacker MEDIUM): resolve `selfUid = opts.selfUid === undefined ?
  currentUid() : opts.selfUid`; if the resolved value is `null` (an untrusted caller passed null, or a
  no-uid platform), REFUSE `{admitted:false, source:'mock', reason:'no-uid'}` + emit — do NOT admit with
  the foreign-owned-file reject disabled. (security.md: a pinned guard is not a caller-overridable default;
  a trust gate fails closed where it cannot verify ownership.)
- **TOTAL** — per-step named-reason catches (mirroring the mint) PLUS an outer whole-body try/catch →
  fail-closed `'mock'` (`admit-error`); auth-class never throws to the caller.
- **observable** — every refuse path emits a namespaced `emitEgressAlert('world-anchor-admit-<reason>')`
  (security.md: no silent `{ok:false}`).
- **exact-set everywhere** — step 1 (exactly-one edge), step 7 (both cross-checks), never
  `.find()`/`[0]`/`.includes` for authz.
- **immutable** — fresh objects only; never mutate the caller's `node`/`edges`.
- **structure** — mirror `deriveWorldAnchorSource` (world-anchor-edge-store.js:434-447) verbatim: env-blind
  guard first, single outer try, `MOCK_SOURCE` constant reused (architect NIT — anchor to the proven sibling).

## SHADOW invariants (the dam stays shut)

- `LIVE_SOURCES` UNTOUCHED (`weight-source-gate.js:37` stays `Object.freeze([])`).
- NO production caller of `admitWorldAnchorNode` OR the new `authenticatedWorldAnchorEdges`. **The existing
  dam is VACUOUS for the new surface** (hacker HIGH #2): `shadow-import-graph.test.js`'s `READER_CALL_RE`
  (line ~168) matches only `authenticatedWorldAnchorIds|deriveWorldAnchorSource`. The MOD must EXTEND that
  regex to `/\b(?:authenticatedWorldAnchorIds|deriveWorldAnchorSource|authenticatedWorldAnchorEdges|admitWorldAnchorNode)\s*\(/`
  (or a sibling regex), else the no-caller guarantee ships as unbacked prose for `admitWorldAnchorNode` —
  the wave's whole point. NON-VACUOUS proof at build: inject a production caller of `admitWorldAnchorNode`,
  watch the test go RED, revert.
- B2 does NOT read any store itself for production — the caller injects `edges` + the store dirs; the
  only store reads B2 makes (`readAnchor`, `loadMergeOutcome`) are opts-dir-injectable and remain SHADOW.

## TDD-first test plan (`tests/unit/lab/world-anchor/admit-world-anchor-node.test.js`)

Write the test file FIRST (lab convention: `node <file>`, `node:assert`, light `test()` runner, env
save/restore, `emitEgressAlert` stderr capture). The failing set is the behavioral contract:

- **Happy path** — a fully-consistent (node, signed edge, attestation, sealed+broker-signed
  merge-outcome) admits `{admitted:true, source:'world-anchor', commitment_verified:true}`.
- **STEP 1 fails** — a tampered `broker_sig` / wrong `brokerVerifyKey` → `broker-sig-invalid`, not
  admitted + emit. Include a **garbage-PEM `brokerVerifyKey` variant** (distinct code path in
  `loadPublicKey` vs. a tampered-sig) → also `broker-sig-invalid` (code-reviewer LOW).
- **STEP 2 fails** — `outcome.lesson_commitment` ≠ node-body `lc` (planted record at the same jkid,
  divergent sealed commitment) → `lesson-commitment-mismatch`, not admitted + emit.
- **edge binding fails** — `outcome.approval_hash` ≠ `edge.to_delta_ref` → `approval-hash-mismatch`.
- **att↔edge cross-bind fails** — `att.approval_hash` ≠ `edge.to_delta_ref` → `att-edge-approval-mismatch`.
- **membership** — no signed edge for the node → `no-authenticated-edge`; two signed edges → `ambiguous-edge`.
- **grandfather EXCLUDE (exact token)** — a REAL outcome sits at the `''`-derived jkid; the node's
  re-derived `lc` is non-empty → the computed (non-empty-lc) jkid never matches → `loadMergeOutcome`
  returns null → `no-merge-outcome` (NOT `lesson-commitment-mismatch`). Assert there is **no fallback
  `''` lookup** (a "helpful" fallback would reopen the excluded path).
- **att-tuple-mismatch** — node's `anchor_id` points at a DIFFERENT `(repo,issueRef,pr_number)`
  attestation than the real outcome was recorded under → jkid mismatch → `no-merge-outcome` (code-reviewer
  HIGH: proves forging the attestation doesn't help — jkid is re-derived from cross-checked fields).
- **field-typing round-trip** — a real end-to-end (recordAttestation → join-key → recordMergeOutcome →
  mint) produces a node whose `readAnchor`-derived `{repo,issueRef,pr_number}` re-hashes to the SAME jkid
  the outcome sits at (guards the `issueRef` number-vs-`String()`-coercion, architect/code-reviewer LOW —
  a fail-CLOSED correctness bug if it diverges).
- **env-blind** — empty/missing EITHER key → `no-verify-key`, not admitted (never accept-all).
- **selfUid fail-closed** — `selfUid:null` does NOT admit a foreign-owned planted outcome → `no-uid`
  (hacker MEDIUM; a live foreign-owned plant, non-vacuous).
- **fail-closed totality** — an adversarial getter on node/edge → caught → `'mock'` `admit-error`, never throws.
- **attestation absent/tampered** → `no-attestation`.
- **exact-set, not subset** — a `[realEdge, poisonEdge]` set where the poison edge is unsigned/foreign
  must not launder membership.
- **#273 SHADOW residual (asserted, not assumed)** — a fully co-forged self-consistent quadruple
  (attacker-written node+edge+att+outcome, all sigs valid against the supplied keys) ADMITS
  `commitment_verified:true`. This is the DOCUMENTED residual (`## Residual`), proven bounded here — its
  close is B5 arming on the deployed cross-uid broker, not B2.
- **edge-store extract** — existing `authenticatedWorldAnchorIds` tests stay green (RUN the suite);
  `authenticatedWorldAnchorEdges` returns exactly the verified edges, preserving ALL per-edge guards
  (a poison edge failing ANY of shape/HEX64/edge_type/re-derive/sig is excluded), array (not Set) return.

## Files touched

- NEW `packages/lab/world-anchor/admit-world-anchor-node.js` (~150-200 LoC)
- MOD `packages/lab/world-anchor/world-anchor-edge-store.js` (extract `authenticatedWorldAnchorEdges`;
  delegate `authenticatedWorldAnchorIds`; export the new fn) — behavior-preserving
- NEW `tests/unit/lab/world-anchor/admit-world-anchor-node.test.js`
- MOD the shadow-import-graph test to assert B2 has zero production callers
- (signpost regen if a new `.js` file trips CI Test 121 — `node scripts/generate-signpost.js --check`)

## HETS Spawn Plan (VERIFY board — 3-lens, this is a #273/auth/security diff → Rule 2 mandates all 3)

Routing: `route` (security-critical auth admission, multi-file, #273-arc). Pre-build VERIFY over THIS
plan, in parallel:

- **architect** — design soundness: is Option C + the unique-join the right shape? Is the edge-store
  extract correct vs. a self-contained filter? Any join non-uniqueness / circularity left?
- **hacker** — adversarial: can a same-uid co-forge admit a node it shouldn't? Probe the opaque-jkid
  plant (step 7 cross-checks), the exact-one-edge bypass, env-key fallback, the grandfather path, a
  `[real, poison]` edge set, a node/edge/att/outcome field-swap.
- **code-reviewer** — correctness: fail-closed totality, emit-on-every-refuse, immutability, the
  extract's behavior-preservation, resource/edge cases.

NEEDS-REVISION on any substantive finding → fold → re-verify. Then TDD build → VALIDATE board
(code-reviewer + hacker re-probe the BUILT code, Rule 2a) → CodeRabbit → PR → USER merge.

## Runtime claims to re-probe at build (status-decay guard)

- The extract keeps every existing edge-store test green (RUN them, don't assume).
- `verifyEdgeSig` / `verifyRecordSig` `allowEnvFallback:false` truly refuses an ambient env key (probe
  it — a live negative test, non-vacuous).
- The shadow-import-graph test actually FAILS if a production caller is added (inject one, watch it go
  red, revert — non-vacuous dam).

## Pre-Approval Verification (3-lens board `wf_eb0b0a38-00e`, 2026-07-01)

VERDICT: all three NEEDS-REVISION, all "fold these then ship" (design core BLESSED — Option C is the
right shape, the join is genuinely unique, step-7 closes the opaque-plant, OQ3-5 EXCLUDE is structurally
sound, the extract is behavior-preserving DRY). Every finding folded above:

| Lens | Sev | Finding | Fold |
|---|---|---|---|
| hacker | HIGH | `anchor_id`-derived tuple unbound to the node's real merge → co-forged quadruple admits `commitment_verified:true`; B2 inverts the mint's ADVISORY-att trust direction | New `## Residual` (loud, integrity≠provenance); step-2a att↔edge cross-bind; #273-residual TDD case |
| hacker | HIGH | SHADOW dam VACUOUS — `READER_CALL_RE` misses `admitWorldAnchorNode`+`authenticatedWorldAnchorEdges` | §SHADOW invariants: extend the regex verbatim + non-vacuous probe on the NEW names |
| code-reviewer | HIGH | join-key type/tuple: forging the attestation to target an existing jkid; per-step throw-wrapping vs one flat catch | att-tuple-mismatch + field-typing TDD cases; steps 3/6 now specify per-step named-reason catches (mirror the mint) + outer totality net |
| architect | MED | `lc` re-derived from node body, not re-bound to the sealed attestation | Documented in step 3 + `## Residual`; #273 TDD case proves it bounded |
| hacker | MED | `selfUid:null` disables the foreign-owned reject | §Signature: fail-CLOSED `no-uid` on null; live foreign-plant TDD case |
| hacker/CR | MED | step-7 `outcome.join_key_id===jkid` is transitively given (don't add a circular re-derive); grandfather exact token | step 5 + step 7 notes; grandfather TDD asserts `no-merge-outcome`, no `''` fallback |
| architect | LOW | one `verifyKey` conflates edge-sig + broker-sig anchors | Split `edgeVerifyKey` / `brokerVerifyKey` |
| architect/CR | LOW | `pr_number` field-typing round-trip under-probed | field-typing round-trip TDD case |
| architect/CR | LOW | present-but-malformed PEM vs empty | §step 0 asymmetric-parse; garbage-PEM TDD variant |
| CR | MED | extract must preserve ALL per-edge guards, not just sig; Set→array dedup | §Edge-store extract: verbatim-guard note + dedup-semantics callout |
| architect | NIT | mirror `deriveWorldAnchorSource` structure | §Signature structure bullet |

Design core unchanged; folds are additive hardening + doc. Proceed to TDD build; the VALIDATE board
re-probes the BUILT code (Rule 2a live probes, incl. the #273 co-forge + non-vacuous dam).

## VALIDATE result (3-lens board `wf_79529955-f39`, 2026-07-01) — ALL SHIP

Post-build, over the BUILT diff (Rule 2 tier; Rule 2a live probes):

- **code-reviewer SHIP** — extract byte-behavior-preserving (every per-edge guard verbatim, only the return
  type changed; the Set form a pure delegate); no dangling `crypto`/`canonical-json`/`sha256hex` after the
  join-key-id move; fail-closed-total (outer catch + 8 named per-step refuses, all reachable, none vacuous);
  emit on every refuse; no caller mutation. Two informational notes (NaN `approvedAt` covered transitively by
  the store's verify-on-read `validateRecord`; refuse-reason ordering is fail-fast + fine) — no fix.
- **hacker SHIP** — 20 live probes (real ed25519 quadruples, dir-injected temp stores) attacking the built
  gate; EVERY vector held at the documented boundary: opaque-jkid plant → lesson-commitment-mismatch /
  approval-hash-mismatch; env-key fallback → refused (`allowEnvFallback:false`); two-signed-edges → ambiguous;
  grandfather → structural no-merge-outcome; replay-forge → rejected; adversarial getters / foreign-uid /
  prototype-pollution → fail-closed, never throws. The ONLY admitting case is the DOCUMENTED #273 co-forge
  residual — "NOT more permissive than that residual." Re-proved the dam non-vacuous (planted a
  `packages/kernel/` caller → RED → revert). Re-export seal-safe (`store.deriveJoinKeyId === _lib`'s).
- **honesty-auditor SHIP** — "Grade A, NO-OVERCLAIM"; every load-bearing claim traces to an artifact; SHADOW
  airtight (LIVE_SOURCES untouched, zero production callers, dam non-vacuous); the join IS unique; the #273
  residual is documented + ASSERTED (the co-forge test), not assumed; the VERIFY folds all landed in code.

Fold from VALIDATE: added a COERCION CAVEAT note to `kernel/_lib/join-key-id.js` (the hacker NIT — the
`String()` collision is unreachable through the stores, which int-type-gate; documented for a future non-store
consumer). No code-behavior change. B2 ships SHADOW.
