# RFC — Authenticated Minter: closing `integrity != provenance` before the live external-PR beta

- **Date:** 2026-06-18
- **Status:** DRAFT — decision ratified by maintainer 2026-06-18 (**Option B**: the full same-uid close lands *before* the ③ live external-PR beta).
- **Author:** full-system review, deliverable (b). See [`docs/system-report/`](../../../docs/system-report/README.md) §5.3 substrate findings.
- **Supersedes / extends:** the `edge-attestation.js` ed25519 lane (v-next Carry C W1) and the A6 witness ledger (v3.8b W2). Tied to [ADR-0010](../adrs/0010-write-scope-enforcement.md) (write-scope), [ADR-0012](../adrs/0012-capability-enforcement-is-static-not-runtime-injected.md) (capability is static), and the ContainerAdapter / Track 2 work.

## 1. Summary

Every content-addressed store in the substrate verifies a record is **self-consistent on read** (re-derive the content-address, re-hash the body) — this is **integrity**. None except the `edge-attestation` ed25519 lane authenticates the **producer** — this is the **provenance** gap. In the open-writable `$LOOM_LAB_STATE_DIR`, a **same-uid** writer can **co-forge** a byte-valid record via the same exported derivation functions, inflating any advisory weight. It is safe *today* only because every such weight is SHADOW/advisory and **monotonically narrowing** (a forged signal can over-halt, never grant).

The ③ live external-PR beta will let a weight **gate** a real action. At that moment "narrowing-only" no longer holds — a forged record *grants*. This RFC specifies an **authenticated minter** that closes the gap for any gating weight, with the **same-uid** close included (Option B), so the beta does not ship a forgeable trust input.

## 2. The gap, precisely

- **Integrity (have):** `record-store.loadRecordFile` rejects a record unless `filename-txid == transaction_id field == sha256(canonical(body))`; `evolution-snapshot-read.readEvolutionSnapshot` recomputes `content_hash` and rejects a mismatch; the lab stores deep-freeze and re-derive on read (the `#273` discipline). A *hand-edited* record fail-softs to null.
- **Provenance (missing):** the derivation functions are **exported** — `computeContentHash` / `computeIdempotencyKey` / `computeTransactionId` / `computePostStateHash` (`transaction-record.js`), `deriveEdgeId` / `deriveNodeId` (lab). Anyone who can write the state dir can mint a record that passes every read check. Integrity proves *well-formed*, not *who made it*.
- **Why safe now:** the gating consumers are all SHADOW. `circuit-breaker/project.js` "halts nothing yet"; `reputation` feeds an advisory axiom; the resolver runs journal-only unless `LOOM_RESOLVER_ENFORCE=1`. A forged record can only **narrow** (over-halt). The §0a.3.1 monotonic-safety argument holds *because nothing gates*.
- **Why it must close before the beta:** the beta's premise is that a signal **hardens trust** enough to gate (route eligibility → DRAFT → gated real PR). A gating weight read from a co-forgeable store is a trust-laundering lever: a same-uid (or, in the beta, an in-sandbox) writer fabricates the weight that admits the action.

## 3. What exists today (and its honest limits)

- **`edge-attestation.js`** — a clean ed25519 minter/verifier: algorithm-pinned (refuses RSA/EC), canonical-base64-checked, **fail-closed on verify** (no key → `false`). It raises the forge bar from *"anyone who can call `deriveEdgeId`"* to *"a holder of the private key."* **Limits:** (a) wired to exactly one lane (the causal-edge `confirmed-by` edges); (b) **no production minter** — `LOOM_EDGE_SIGNING_KEY` is unset, so nothing is trusted-by-signature yet; (c) the key is read from the **same-uid process env** (`LOOM_EDGE_SIGNING_KEY`), so it closes a *different-uid / remote* forge but **not a same-uid** one; (d) it signs `edgeId` only, not arbitrary record content-addresses.
- **The A6 witness ledger** (`evolution-snapshot-read.js`) — `appendSnapshotWitness` / `verifySnapshotProvenance` give an *order-of-materialize* trail with per-row id re-derivation (`#273`). Its own header states the honest scope: *"same-uid is BOTH a forge axis AND a denial axis ... `witnessed` != authentic-beyond-same-uid (closes at the ContainerAdapter)."* So the witness proves integrity + ordering, **not same-uid provenance**.

**Reading:** the primitive and the contract both already exist and both already name the same gap. The work is not invention — it is (i) a real signing **trust domain** and (ii) making the gating consumers depend on it fail-closed.

## 4. Decision

**Option B — the full same-uid close before the beta.** Recorded alternatives:

| Option | What it closes | Why not (for the beta) |
|---|---|---|
| A — env-key signed records | the **different-domain** forge (e.g. in-sandbox stranger code) | leaves the **same-uid host** co-forge open; honest only if "same-uid host is trusted" is acceptable — maintainer rejected that for the beta. |
| B — **authenticated minter in a separated trust domain** | **same-uid** co-forge too — the complete close | larger project (privilege separation / namespace + a minter service); the beta waits on it. **CHOSEN.** |
| C — gate only on kernel-minted records | provenance by construction (no lab self-assertion in the gate path) | a strong *floor* but does not let a *lab-derived* weight gate; B subsumes C as the minter's policy. Adopt C's invariant **inside** B. |

## 5. Design — the authenticated minter

### 5.1 The load-bearing precondition: a real trust-domain separation

The minter's private key MUST live in a trust domain the **same-uid caller cannot read**. Acceptable vehicles, in order of fit with the existing roadmap:

1. **The ContainerAdapter namespace (preferred).** The architecture already commits to the ContainerAdapter as the same-uid close. The minter runs *inside* the container (separate mount/uid namespace); the key is injected into the container only; the host same-uid process cannot `read()` it. This makes the minter a service *of* the ContainerAdapter rather than a parallel mechanism.
2. **A separate-uid broker daemon.** A `loom-minter` system user owns the key `0600`; the lab/host process requests a signature over a unix socket. Classic privilege separation; heavier to provision on a single-dev box.
3. **OS keychain / Secure Enclave with a binary-scoped ACL.** Strong, but same-uid keychain access is often permissive; treat as defense-in-depth, not the primary close.

**If the key ends up in the same-uid env, this is Option A, not B** — the RFC's correctness hinges on (5.1) being real. State it as a hard precondition and gate the beta on it.

### 5.2 The minter is NOT a signing oracle

A separated key is necessary but not sufficient: if the minter signs **arbitrary caller-supplied bytes**, the lab simply asks it to sign a forged body (a signing-oracle bypass). Therefore:

- The minter exposes `mintWeight(kind, subject)`, **never** `sign(bytes)`.
- Internally it **re-derives** the weight from **kernel-authenticated inputs only** — the content-verified transaction chain (`record-store`) + the witness ledger — applies the **published gating policy** (the same pure function a reviewer can audit), and signs the *result*. The lab's advisory stores are *inputs to the policy*, never the signed value verbatim.
- This folds **Option C's invariant inside B**: the gating value is a function of kernel-minted records, so even the minter cannot be made to launder a lab-only assertion into a grant.

### 5.3 Interface

- Extend `edge-attestation` with `signRecordId(recordId, opts)` / `verifyRecordSig(recordId, sig, opts)` — generalize the existing `signEdgeId` from "edge" to "any 64-hex content-address" (≈10 lines; the crypto is unchanged).
- Add a minter module (kernel-owned, runs in the separated domain) exposing `mintWeight({kind, subject})` → `{kind, subject, value, basis_digest, minted_at, sig}` where `basis_digest = sha256(canonical(authoritative inputs))` and `sig = signRecordId(basis_digest)`.
- Gating consumers call `verifyMintedWeight(weight)` and **fail closed** (`verifyRecordSig` already fails closed on no-key/bad-sig) — an unsigned or unverifiable weight is treated as *absent*, which (by the narrowing-safety property) can only over-halt, never grant.

### 5.4 The gating set (mint before the beta) vs the advisory remainder

Only the weights that will **gate** in the beta need minting first. From the integration map, the gating-candidate set is small:

- **The A6 reputation snapshot** — the one lab→kernel hot-path input (`spawn-record.js` reads it). Mint it; `readEvolutionSnapshot({verifyProvenance:true})` already has the fail-closed hook (`provenance !== 'witnessed'`) — replace the witness check with `verifyMintedWeight` for the gating call.
- **The circuit-breaker denial decision** (`circuit-breaker/project.js`) — if it gates promotion in the beta, the *decision* (not the raw verdict rows) is minted.
- **Route/admission eligibility** — if the beta gates spawn admission on a lab-derived eligibility, that eligibility is minted.

Everything else (the full reputation distribution, lesson confirmed-weights, the grounding-slice count, manage-proposal dispositions) **stays advisory/unsigned** — they narrow, they do not gate, and the narrowing-safety argument continues to cover them. **Do not over-sign**: minting a weight that does not gate is cost with no security gain.

### 5.5 Consumer semantics

- **Fail-closed** everywhere a minted weight gates: absent/invalid signature → the weight is `absent` → the gate denies (the safe direction).
- **No silent downgrade:** a gating consumer must never fall back to the unsigned advisory form "because the signature was missing." Missing signature == deny.

## 6. Threat model & residuals

- **Closes:** same-uid host co-forge of a *gating* weight (the Option B goal) — the key is unreadable to the same-uid caller, and the minter recomputes from authoritative state so it cannot be used as a blind oracle.
- **Does NOT close (disclosed):** (a) compromise of the minter's trust domain itself (container escape / broker-uid compromise) — out of scope, the standard "trust the TCB" boundary; (b) **denial** — a same-uid flooder can still make a legit weight read as absent (over-halt); acceptable because over-halt is the safe direction and re-mint heals; (c) the *advisory* (unsigned) stores remain co-forgeable, tolerable because they only narrow.
- **Signing-oracle risk:** addressed by 5.2 (no `sign(bytes)`; recompute-from-authoritative). This is the single most important design constraint — a careless `mintWeight` that signs caller input reopens the whole gap.
- **Key provisioning & rotation:** `generateEdgeKeypair` provisions; the public verify key ships with the kernel; rotation needs a key-id field on the minted weight + a verify-key set (a small additive change — out of scope for the first cut, but reserve the `key_id` field now).

## 7. Phasing

1. **P0 — primitive + invariant (no trust-domain dependency).** Generalize `signEdgeId` → `signRecordId`/`verifyRecordSig`; add `mintWeight` with the recompute-from-authoritative policy; adopt Option C's invariant (gating reads only kernel-minted records + a minted weight). Land it SHADOW (mint + verify wired, but the gate still doesn't fire) so the mechanics freeze before the beta.
2. **P1 — trust-domain separation (the load-bearing precondition).** Stand up the minter inside the ContainerAdapter namespace (or the separate-uid broker); move the key out of the same-uid env. This is the step that makes it Option B rather than Option A; gate the beta on it.
3. **P2 — flip the gating consumers fail-closed** on `verifyMintedWeight` for the A6 snapshot (and any other beta gate). Add the read-back/dedup/update immutability tests the workspace rule mandates.

## 8. Open questions

- **OQ-1 (custody vehicle):** ContainerAdapter namespace vs separate-uid broker for the first cut? The ContainerAdapter ties the timeline to Track 2; the broker is independently shippable. Recommendation: broker if the beta predates a hardened ContainerAdapter, else fold into the ContainerAdapter.
- **OQ-2 (gating set freeze):** confirm the *exact* set of weights that gate in ③.1/③.2 so the mint set is minimal and complete. The DRY-RUN (③.1) is DRAFT-only — does anything actually gate before ③.2?
- **OQ-3:** does `mintWeight`'s policy need to read the *full* lab distribution, or only the kernel chain + a bounded advisory summary? The narrower the authoritative basis, the smaller the oracle surface.
- **OQ-NS-6 reminder:** none of this *hardens* trust in the world-anchored sense — it removes a *forgery* lever. Only a world-anchored merge hardens. The minter makes a gating weight *trustworthy-to-compute-from-honest-inputs*, not *correct*.

## 9. References

- `packages/kernel/_lib/edge-attestation.js` — the ed25519 lane (the primitive to extend).
- `packages/kernel/_lib/evolution-snapshot-read.js` — the A6 bridge + witness ledger (the gating consumer to flip).
- `packages/kernel/_lib/transaction-record.js` / `record-store.js` — the authoritative kernel chain the minter recomputes from.
- `docs/system-report/README.md` §3 (trust model), §5.3 (the substrate finding), §7 (next steps).
- `~/.claude/.../memory/MEMORY.md` — `[[beta-internal-verification-mandate]]`, OQ-NS-6, the `#273` family.
- ADRs [0010](../adrs/0010-write-scope-enforcement.md), [0012](../adrs/0012-capability-enforcement-is-static-not-runtime-injected.md); the `docs/ARCHITECTURE.md` threat-model section.
