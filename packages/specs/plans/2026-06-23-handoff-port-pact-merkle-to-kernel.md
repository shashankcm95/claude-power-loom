---
lifecycle: persistent
created: 2026-06-23
status: ASSESSED 2026-06-23 (toolkit session) — verdict DEFER / available-when-needed (NO present consumer); port-ready recipe + re-open triggers in the "Adoption assessment" section at the bottom
origin: cross-substrate sync directive (PACT ↔ Power Loom); authored from the PACT session that shipped the source
---

# Handoff — port PACT's RFC-6962 `merkle.js` into the toolkit kernel `_lib/`

> **This is a HANDOFF BRIEF, not a finished plan.** A separate Loom session should pick this up and run the
> toolkit's own per-wave discipline (route-decide → plan → `/verify-plan` → TDD → multi-lens VALIDATE → PR). It was
> authored from the *PACT* session that built + merged the source, to avoid drifting toolkit work into that session.
> Cross-reference the standing memory `pact-toolkit-cross-substrate-sync` (the entanglement directive + the map).

## The one-line ask

PACT shipped a **PURE, crypto-only, dependency-light RFC-6962 / RFC-9162 Merkle module** built deliberately
**portable**. The toolkit kernel has the **same structural gap** (only a linear `post_state_hash` hash-chain, no
Merkle / inclusion-consistency / STH). **Borrow it, don't rebuild it** — adopt `merkle.js` (+ its test vectors)
into `packages/kernel/_lib/` as the toolkit's Merkle floor, IF/WHEN the toolkit has a real consumer for it (see
"YAGNI gate" below — do not port a floor primitive with no consumer just because it exists).

## Source artifacts (PACT repo — all at the merged commit)

- **Repo:** https://github.com/shashankcm95/PACT
- **PR (merged):** https://github.com/shashankcm95/PACT/pull/11 — merge commit `b96294c`
- **THE module to port:** `v0/src/lib/merkle.js` — `leafHash`/`nodeHash` (raw-byte 0x00/0x01 domain-separated),
  `merkleRoot`, `inclusionProof`/`verifyInclusion` (RFC-9162 §2.1.3.2 — child order from the index bits, NO caller
  flag), `consistencyProof`/`verifyConsistency` (RFC-9162 §2.1.4.2 — m=0 refused, m=n trivial), `sthBasis`/`verifySTH`
  (freshness-bound STH).
- **Port the tests too:** `v0/test/unit/merkle.test.js` — 35 tests; the **external oracle** is the published RFC-6962
  CT roots (empty-tree root, `sha256(0x00)` leaf, the n=2 + n=8 reference roots) + the full non-vacuity RED set
  (forged leaf / order-swap / length / range / rewrite / m=0 / replay / proof-length cap). These vectors are the
  contract — reuse them verbatim against the toolkit copy.
- **Design + both review boards:** `plans/15-merkle-ct-log-layer.md` — §2 the design, §8 the VERIFY board, §10 the
  3-lens VALIDATE board (hacker CLEAN ~496 live probes 0-bypass; honesty CLEAN; reviewer CHANGES all folded) + the
  documented deferred residuals.
- **The stateful consumer (PACT-specific — do NOT port verbatim):** `v0/src/audit/audit-log.js` — the per-receiver
  ordered leaf log over PACT's record-store. The toolkit's stateful analog would be different (its own state model
  over `transaction-record` / `record-store`), so port the PURE `merkle.js` floor first; the stateful log is a
  separate design question for the toolkit's actual need.

## Why the port is clean (dependency check — done from the PACT side, re-probe before trusting)

- The RFC primitives (`leafHash`…`verifyConsistency`) depend on **`crypto` only** — drop-in.
- Only `sthBasis`/`verifySTH` import two siblings: `./canonical-json` and `./edge-attestation`. **The toolkit has
  BOTH** — `packages/kernel/_lib/canonical-json.js` and `packages/kernel/_lib/edge-attestation.js`. PACT's
  `canonical-json` was itself *derived byte-identically* from the toolkit's (see PACT `v0/TRANSFER-PROVENANCE.md`),
  so `sthBasis` will be byte-compatible. **Re-probe these two imports against the current toolkit `_lib/` before
  building** (Runtime-Claim Probe discipline — paths/exports may have drifted).
- The STH freshness basis (`sha256(canonical({root,tree_size,timestamp,nonce}))`) was itself **borrowed FROM the
  toolkit** (`packages/kernel/egress/approval.js` `approvalSigBasis`) — so the pattern already lives in the toolkit;
  the Merkle `verifySTH` aligns with it. First concrete bidirectional borrow, now round-tripping.

## Load-bearing design notes for the toolkit wave

- **Two substrate chains — DON'T conflate.** The toolkit's `packages/kernel/_lib/transaction-record.js` is a linear
  `post_state_hash` chain (the chain edge is `post_state_hash`, NOT `transaction_id` — INV-22 family). The Merkle
  layer is an ORTHOGONAL structure (an ordered log with inclusion/consistency proofs). Adopt it ALONGSIDE, do not
  rewire the existing chain into it.
- **SHADOW / additive.** In PACT this gates nothing (NS-8). In the toolkit it should likewise start as a floor
  primitive + an additive, observable path — no kernel decision should gate on a Merkle proof on first landing.
- **`audited:true` is INTEGRITY, not PROVENANCE** (the deferred residual carried from PACT §10): a single node can
  self-sign a consistent STH over an alternate log. Anti-equivocation only HARDENS with independent cross-node STH
  collection (gossip/witness) — out of scope for a first port; keep the `detectFork` sound-half + the residual
  documented.

## YAGNI gate (be honest about the motivating consumer)

Porting a floor primitive **with no consumer** is speculative. Before building, name the toolkit consumer that
actually needs Merkle anti-equivocation — candidates: (a) tamper-evident inclusion proofs over the kernel
transaction chain; (b) STH-style attestations for `egress/` / `loom-broker` records; (c) a CT-style log for the
attribution/reputation lab. If none is real yet, record the borrow as **available-when-needed** (this brief + the
memory) and do NOT build. If one is real, that consumer is the wave's motivating use case and shapes the stateful
analog.

## Recommended wave shape (for the toolkit session)

1. `route-decide.js --task "port PACT RFC-6962 merkle.js into kernel/_lib as the Merkle floor"` (substrate-meta;
   likely force-route / architect-shaped).
2. Plan in `packages/specs/plans/` with a `## Runtime Probes` section confirming the two `_lib/` imports exist +
   naming the real consumer (the YAGNI gate).
3. `/verify-plan` (architect + code-reviewer).
4. TDD: drop in `merkle.js` + `merkle.test.js` (the RFC vectors red→green FIRST), re-pointing the two imports at the
   toolkit `_lib/`.
5. Multi-lens VALIDATE (kernel/crypto diff ⇒ the full 3-lens tier: code-reviewer + hacker re-probe of the BUILT
   module + honesty), then the kernel suite + `install.sh --hooks --test`, then PR for the user's merge gate.

## Adoption assessment (2026-06-23, toolkit session — probe + plan, NOT a build)

A 5-agent assessment ran the YAGNI gate the handoff sets for itself (3 consumer-survey analysts + an architect
design lens + an honesty/YAGNI lens). **Verdict: DEFER — record the borrow as available-when-needed; do NOT build
now.** The port is clean and cheap; there is simply no present consumer, and the toolkit's own YAGNI / OQ-NS-6
discipline forbids engineering a property that hardens nothing.

### Premises — probed firsthand (all TRUE)
- PACT `v0/src/lib/merkle.js` is pure RFC-6962/9162, crypto-only; the only non-crypto deps are `./canonical-json`
  (`canonicalJsonSerialize`) + `./edge-attestation` (`verifyRecordSig`). The toolkit `_lib/` has **both**, with
  **signature-exact** call shapes (`canonicalJsonSerialize(value)`; `verifyRecordSig(recordId, sigB64, {publicKeyPem})`).
  The port is a **2-line require re-point**, no call-site edits.
- The kernel has **no Merkle** today (only the linear `post_state_hash` chain in `transaction-record.js`) — gap real.
- The STH freshness pattern Merkle would port (`sthBasis`) **already lives in the toolkit** as
  `egress/approval.js` `approvalSigBasis` — so `verifySTH` would *duplicate* an existing primitive, not add one.
- canonical-json byte-compat is **benign**: `sthBasis` canonicalizes a depth-1 4-scalar object, far under the
  toolkit's `MAX_CANONICAL_DEPTH/NODES`; the bound only THROWS on a pathological field (a strictly-safer
  fail-closed divergence on attack input, never a compat break on honest input).

### Consumer survey — all three candidates: NOT-A-CONSUMER-NOW
| Candidate | Verdict | Why |
|---|---|---|
| (a) kernel transaction chain | not-a-consumer | linear chain + content-address-verify-on-read meet every present need; sole reader is the integrator's FIRST-PARTY parent-resolver; no third-party verifier / no append-only proof obligation. |
| (b) egress + loom-broker | not-a-consumer | no append-only ORDERED log (approval store = content-hash-keyed one-shot files; etiquette = in-process Set); the STH primitive already exists (`approvalSigBasis`); the open residual is provenance, closed by the cross-uid signed broker, not Merkle. |
| (c) lab attribution/reputation ledger (strongest) | not-a-consumer **now** | a GENUINE no-rewrite gap exists (a same-uid writer could silently rewrite the JSONL ledgers, undetected) — **but it is ADVISORY-ONLY**: `recommendNarrowing` has **zero production callers** ("the weight gates nothing"). A consistency proof over a log that gates no action closes no present, named risk. |

**The cross-cutting finding:** the substrate's one *actual* named open residual is **PROVENANCE (who-minted — the
`#273` family / the v-next SIGNED-edges arc)**, which Merkle does **NOT** provide. Integrity (verify-on-read) is
already implemented in every store; anti-equivocation has no referent in a single-host/single-writer substrate
(no cross-node STH gossip). So a full Merkle port advances the substrate's real open question by **zero**.

### YAGNI verdict (honesty lens — grade A, NO-OVERCLAIM)
**available-when-needed; realConsumer = None.** Building now would NARROW (engineer a property) without HARDENING
anything that gates (OQ-NS-6). The handoff is honest + correct to gate on a consumer — a clean port with no
consumer is still YAGNI. (Architect floated a minority "port the cheap pure floor now to freeze the byte contract"
view; rejected as primary because PACT already holds the frozen reference + test vectors at the merged commit, and
the cross-substrate directive is reconcile-at-point-of-use — there is no urgency to freeze a second copy before a
consumer, and an unused `_lib/merkle.js` adds a status-decay "is this wired?" surface.)

### Re-open triggers (build the moment ANY fires)
1. A lab weight begins **gating a real action** (not advisory) **AND** the threat model adds an untrusted /
   multi-observer log surface (then consistency/anti-equivocation earn their keep).
2. The external-PR trust arc grows a **cross-node or external-auditor** requirement needing **inclusion proofs**
   (a third party must verify "record X is in the loom log" without holding the whole log).
3. A **CT-style log over the attribution/reputation lab** is named as a real deliverable (its own consumer +
   threat model — a separate assessment, not a present need).

### Ready port recipe (for the session that picks this up when a trigger fires — so it isn't re-derived)
1. Drop `merkle.js` into `packages/kernel/_lib/`; re-point its two requires to the sibling `_lib/` modules; add an
   `@loom-layer: kernel` banner.
2. **Port-time hardenings the toolkit already paid for** (do NOT skip): thread `allowEnvFallback:false` through
   `verifySTH`'s `verifyRecordSig` call (the `approval.js:117` VERIFY-hacker H1 precedent — an ambient-env verify
   key is an attacker-controllable pin); state the **integrity≠provenance** caveat in the banner (mirror
   `approval.js:22-25` / `edge-attestation.js:8-9`) so no reader launders "in the log" into "authentically authored".
3. Port PACT's `v0/test/unit/merkle.test.js` **verbatim** (the published RFC-6962 CT vectors are the external
   oracle); ADD a golden-vector test (one fixed `{root,tree_size,timestamp,nonce}` → expected basis hex) to freeze
   the byte contract; re-confirm the two `_lib/` exports + the STH/approval overlap before wiring.
4. Adopt **ALONGSIDE** the linear chain — do **not** rewire `transaction-record.js` (that would couple INV-22's
   idempotency-dedup substrate to an unproven primitive). The floor is additive + SHADOW (gates nothing).
5. The **stateful analog** (an append-only ordered leaf-log over `record-store`/`transaction-record`,
   leaf = `leafHash(content_hash)`, ~4-op deep module, kernel-owned writer / lab-readable proofs, an incremental
   cached tree to avoid the O(n) `mth` recompute per append) is a **separate future RFC** keyed to the real
   consumer — design it then, not as part of the floor.

### Disposition
Recorded as **port-ready / deferred** in the `pact-toolkit-cross-substrate-sync` memory map. No build this session.
