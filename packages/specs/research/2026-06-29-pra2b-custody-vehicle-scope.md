# PR-A2b — Cross-UID World-Anchor Edge Signer: Scope + Custody-Vehicle Decision

**Status**: RATIFIED (user 2026-06-29 — Vehicle B confirmed; scope refined to build-ready) — pre-build; per-wave build pending
**Date**: 2026-06-29 (refined 2026-06-29 post-ratify)
**Author**: architect (read-only recon; no code changed) — refined by orchestrator after user ratify
**Origin**: 10-agent recon + custody-vehicle judge-panel Workflow (5 recon readers + 3 vehicle proposals + honesty-auditor judge + architect synth)

---

## 0. Ratified decisions (user 2026-06-29) — the build contract

All §8 open questions are now RESOLVED (see §8 for the per-item rationale). The build contract:

1. **Vehicle = B** — a dedicated edge-signing broker (Loom-domain sibling of `loom-broker-*`), its OWN ed25519 edge key under a **dedicated `loom-edge-signer` uid** (distinct from broker-610 + actor-611), recompute-inside via a new `loom-edge-bind.js`, injected through the frozen `opts.edgeSigner` seam. (A/C rejected — §4.)
2. **Scope = the EDGE-signer vehicle ONLY.** The *weight* mint + the gate that verifies it (RFC §5.5 step 3 → §7 item 4 = the parked weight-gate RFC Phase 3-4) is **PR-B**, out of scope.
3. **`from_node_id` recompute contract = the edge is a NARROW, non-authoritative signal** (§7 + §8.6). The edge broker recompute-binds the `edge_id` ONLY (closes the sign-arbitrary-64-hex oracle); the FULL `(merge, lesson, node)` value-commitment is the **weight-minter's** job (PR-B), per the weight-gate arc's Rev-1 CRITICAL resolution ("the value-committing weight-minter, NOT the edge seam"). PR-A2b ships the edge as explicitly non-authoritative.
4. **PACT = mirror-the-pattern, never invoke as the live signer** (a Loom `edge_id` is not a PACT persona-frame). §8.4.
5. **Build is host-agnostic + ships SHADOW** (`signer:undefined` in production); the cross-uid deployment + out-of-band attestation is operator-owned and deferred. Prefer Linux/Docker for the eventual actor-confinement leg, but Vehicle B's KEY custody depends on none of the R12 residuals → independently shippable. §8.5.
6. **Build order (the gating precondition FIRST):** the store-signer widen `(edge_id) → (edge_id, edgeBody)` before anything else — recompute-inside is impossible without it (§5 item 1).

---

## 1. Context — where PR-A2b sits

- **PR-A2a (#462, `94762d9`) MERGED, SHADOW.** The mint-side INBOUND verify is live: `world-anchor-mint.js` reconstructs `approvalSigBasis` + `verifyRecordSig(broker_sig)` against the custody-pinned key (`allowEnvFallback:false`, fail-closed) and re-derives `computeLessonCommitment`. PR-A2b is its **OUTBOUND mirror** — the edge *signing* half.
- **#273 status today**: **NARROWED at PR-A2a, NOT closed.** The chain carries a cross-uid-verifiable `(approval_hash, lesson_commitment)` binding (SHADOW), but the `world-anchored-by` edge is **UNSIGNED** in production (`mintWorldAnchorEdge` passes `signer: opts.edgeSigner`, and `edgeSigner` is `undefined` in production — `world-anchor-mint.js:214`). A same-uid caller can still co-forge a byte-valid edge.
- **The open hole, named precisely**: the env-PEM default signer (`loadPrivateKey` reads `LOOM_EDGE_SIGNING_KEY` from the same process env the host owns) is **same-uid-readable** — Option-A-equivalent. Verify proves only key-possession (INTEGRITY), never that the legitimate off-host minter produced the edge (PROVENANCE).
- **OQ-NS-6 (load-bearing)**: merged code only **NARROWS** the trust surface. Only a **DEPLOYED** cross-uid signer the host cannot `read()` + a real out-of-band merge oracle **HARDENS** trust. PR-A2b's merge narrows; the deployment hardens.

---

## 2. The deliverable

PR-A2b stands up an **off-host / cross-uid ed25519 signer** whose private key the same-uid lab/host process **cannot `read()`**, injected through the frozen `opts.edgeSigner` seam, so that:

- the minted `world-anchored-by` edge carries a valid ed25519 signature over its derived `edge_id`, and
- the consumer `authenticatedWorldAnchorIds(edges, { verifyKey, allowEnvFallback:false })` **admits** it under a custody-pinned verify key the host did not author.

**Scope boundary (confirm in §8)**: PR-A2b is the **EDGE-signer vehicle** (the item-5 PR-A2 deferral). RFC §5.5 step 3 ("mint the world-anchor *weight* signed with the cross-uid key") is the **weight-gate RFC's Phase 3-4, NOT PR-A2b** — the two RFCs overlap on the label "PR-A2". PR-A2b delivers the signed *edge*; the *weight* mint is downstream.

PR-A2b ships **SHADOW** — production continues to pass `signer: undefined` (edges stay UNSIGNED) until a real deployment supplies the cross-uid signer. The consumer-arming + `LIVE_SOURCES` flip is **PR-B (out of scope)**.

---

## 3. The seam (frozen — verified firsthand)

The crypto seam is fully frozen and crypto-symmetric. PR-A2b needs **no change to the crypto leaf or the verify primitives** — the entire delta is the **key-custody vehicle** (plus one store-signature widen, §5).

- **Signer contract**: a function `(edge_id) -> canonical-base64 ed25519 sig | null`. The store calls `opts.signer(edge_id)` with the freshly-derived `edge_id`, accepts only a `typeof === 'string'` output passing `isCanonicalBase64`, persists it OPAQUELY as `edge_sig`, stamps `sig_alg = 'ed25519'`. Any other output (null/throw/non-canonical) → persist UNSIGNED + emit `sign-failed` (no crypto-verify, no data loss). `edge_sig`/`sig_alg` live OUTSIDE the `edge_id` basis, so a signed edge shares its unsigned twin's id.
  - *Verified*: `world-anchor-edge-store.js:208-218`; `mintWorldAnchorEdge` threading `world-anchor-mint.js:212-221`.
- **Crypto-agnostic store**: the store NEVER crypto-verifies on write — it persists the opaque signer output and shape-checks only.
- **Consumer**: `authenticatedWorldAnchorIds` is fail-closed-empty on missing/empty `verifyKey`, **re-derives `deriveWorldAnchorEdgeId(e) === e.edge_id` BEFORE trusting `from_node_id`** (replay defense), pins `sig_alg === 'ed25519'`, requires `edge_sig` a string + all endpoints HEX64, then `verifyEdgeSig(..., { allowEnvFallback:false })`.
  - *Verified*: `world-anchor-edge-store.js:396-412`.
- **Crypto leaf**: `signRecordId` / `signEdgeId` (identity alias) sign ANY 64-hex string, input-gated `isHex64` only, output-gated canonical-base64 + 64-byte length; `verifyRecordSig` / `verifyEdgeSig` fail-closed. **`signRecordId` is DOMAIN-AGNOSTIC: it does NOT recompute-bind** (`edge-attestation.js:118-120`, verified). The default `resolveSigner` closure self-guards `isHex64` (`edge-attestation.js:103-110`) — but it is otherwise a blind signer of any hex64. **This is the open hole and the §5.2 signing-oracle risk.**

---

## 4. Custody-vehicle decision

### Decision

**RATIFIED (user 2026-06-29): VEHICLE B — a dedicated edge-signing broker.** A Loom-domain *sibling* of the live egress `loom-broker-*` modules, with its OWN ed25519 edge-domain key under a **dedicated `loom-edge-signer` uid** (distinct from egress broker uid-610 and actor uid-611), recompute-inside via a new `loom-edge-bind.js`, injected through the frozen `opts.edgeSigner` seam.

### Why custody soundness is the decisive axis

A vehicle whose private key the **same-uid host can still `read()`** is a NON-STARTER for #273 — it only NARROWS. The three proposals split exactly here:

- **Vehicle B (chosen)** rests the `read()`-denial entirely on the only real boundary: **uid-separation + a 0600 owner-only key + a root-locked wrapper.** It asserts NO code-provable custody, reuses the proven egress primitives WITHOUT reusing the egress KEY (the H2 dead-pin lesson), and isolates the edge-signer into a disjoint fault domain. Lowest extra R12 dependency (its key custody depends on none of the H1/output-DoS/C1-C2 residuals — those gate only actor confinement).
- **Vehicle A (rejected — strong runner-up, score 7)**: generalize the *existing* egress broker with a second edge arm. Identical custody model, but it leans toward bolting a second arm onto the **live emit-gating approval broker** — a god-CLI / Single-Responsibility risk and a larger blast radius on the chokepoint that already gates production PR egress. B keeps the edge fault domain disjoint.
- **Vehicle C (rejected — score 4)**: sandbox/actor-uid signing. **Fails structurally as a key vehicle**: `docker-backend.js:91-98` runs the container as the SAME host uid (`$(id -u):$(id -g)`), so the namespace isolates the *process* but does NOT deny the host `read()` of a 501-owned bind-mounted key (integrity-not-provenance, identical to the env-PEM hole). It also self-identifies a CRITICAL inversion (signing AS uid-611, the untrusted actor domain) and introduces a net-new docker-group-is-root-equivalent precondition. C's *containment* is the right tool for the ACTOR, not for the KEY.

### HARDENS or only NARROWS?

- **As MERGED SHADOW code: NARROWS only.** It raises the forgery bar from "anyone who can call the exported `deriveWorldAnchorEdgeId` + read `LOOM_EDGE_SIGNING_KEY`" to "a holder of the edge-domain private key." With `signer: undefined` in production, the edge stays UNSIGNED — #273 stays NARROWED.
- **To HARDEN, ALL of (none code-provable)**: (a) a genuinely separate uid the host cannot `read()`; (b) the operator's out-of-band uid attestation (`loom-custody-verify` reports `hostObservableChecksPassed` + `requiresOutOfBandUidConfirmation`, NEVER `custodyVerified` — `loom-custody-verify.js:110-122`, verified); (c) PR-B arming the consumer against a custody PUBLIC key the host did not author; (d) accumulated REAL world-anchored merges — the only world-anchor that carries trust.
- **Hard ceiling (OQ-NS-6)**: even fully deployed, the edge signer proves PROVENANCE (the legitimate off-host minter signed THIS `edge_id`), **NOT** that the diff genuinely merged. The merge-oracle is a separate out-of-band axis the signer vehicle does not supply. **PR-A2b turns INTEGRITY into PROVENANCE; it does NOT turn PROVENANCE into world-anchored TRUST.**

---

## 5. Dependency-ordered work

Residuals/preconditions FIRST, then the signer, then wiring. Mark: **[now]** buildable SHADOW now / **[deploy]** deployment-blocked (HARDENS only here, none code-provable).

1. **[now] WIDEN the store's signer signature — the gating precondition for the non-oracle property.** Today `writeWorldAnchorEdge` calls `opts.signer(edge_id)` with ONE arg, NO body (`world-anchor-edge-store.js:215`, verified). Recompute-inside is IMPOSSIBLE until this widens to `opts.signer(edge_id, { from_node_id, to_delta_ref, edge_type })` so the broker can recompute-and-refuse. This is a #273-adjacent lab-store contract change → TDD-treatment + full 3-lens VALIDATE. **Build this first.**
2. **[now] BUILD `loom-edge-bind.js` (recompute-inside)** over the `edge_id` preimage (NOT the approval basis): re-derive `deriveWorldAnchorEdgeId({from,to,type})` from the stdin body inside the trust domain, refuse unless `=== argv edge_id`. Prove it NON-VACUOUSLY: inject a mismatched body, watch the bind refuse RED, then revert. Without this, the vehicle is a sign-arbitrary-64-hex oracle gated only by WHO.
3. **[now] BUILD `loom-edge-sign.js` (key-holder CLI)** — sibling of `loom-broker-sign.js`, reusing verbatim: O_RDONLY|O_NOFOLLOW|O_NONBLOCK key open, fstat-on-fd swap-immune, **`& 0o077` owner-only vet** (`loom-broker-sign.js:106`), bounded+deadlined stdin, sign via `signRecordId` (the identical leaf), stdout-sig-only. Edge-domain key file, NEVER the `LOOM_BROKER_*` keys.
4. **[now] BUILD `crossUidLoomEdgeSigner` launcher + the one-arg adapter** — sibling of `loom-broker-launch.js` (validated `sudo -n -u <user> <wrapper>`, USERNAME_RE flag-injection guard, absolute/no-dotdot/no-control-char wrapper). Adapter closes over the edge body and presents the store's `(edge_id, body)` call as the broker client's `(basis, ctx)` shape. Reuse `loom-broker-client.js` env-from-scratch IPC + output re-gate. The store signer call is SYNC (`opts.signer(edge_id)`) and the broker client is `execFileSync` SYNC — compatible.
5. **[now] BUILD a `loom-edge-custody-verify` twin** — the existing C3 liveness leg signs an APPROVAL basis (`loom-custody-verify.js`), so an edge twin must sign a probe EDGE_ID (bare hex64) and verify via `verifyEdgeSig`. Else the operator attests the approval arm and ASSUMES the edge arm.
6. **[now] ASYMMETRIC-PARSE the arming flag** (security.md): the flag ENABLING the cross-uid edge signer must STRICT-parse (typo fails CLOSED to unsigned); a deployed-signal must LENIENT-parse (garbage like `ture` fails CLOSED to refuse). FUZZ with typos/garbage, not just valid on/off.
7. **[now] BUILD the deploy helper + runbook (dry-run default, `--apply` requires root, PRINTS sudoers)** — `scripts/loom-edge-signer-deploy-*.sh` + `docs/deployment/loom-edge-signer.md`, mirroring the existing `loom-broker`/`loom-actor` helpers. Buildable; `--apply` is an operator act, never run in-substrate.
8. **[deploy] PROVISION the third uid + key + wrapper + sudoers**: separate `loom-edge-signer` uid; edge ed25519 keypair (production provenance is operator-owned — `generateEdgeKeypair` is dev/test only); private half 0600 owned by the signer uid; key DIR 0755 root-owned (so C2 owner-disambiguation takes the denial leg, not fail-closed-on-owner-unknown); root:root non-host-writable wrapper (C2.5 privesc); sudoers `env_reset,!setenv` (SUDO_UID unforgeable) authorizing only the mint uid, **uid-611 EXCLUDED**.
9. **[deploy] PROVISION the custody PUBLIC verify key** where the host did not author it (root-owned), so PR-B's consumer pins it `allowEnvFallback:false`. (Keypair provenance is *decided* here; consumer *arming* is PR-B.)
10. **[deploy] OUT-OF-BAND ATTESTATION**: run `loom-edge-custody-verify` as the host uid, then the operator `id` / `ls -l` / `cat -> Permission denied`. Re-attest after reboot / key or wrapper rotation — the process↔uid bind is point-in-time.

> **R12 sandbox residuals (H1 / output-DoS / C1-C2)**: gate only the **actor-confinement** leg (keeping the autonomous actor structurally unable to invoke the signer), NOT Vehicle B's key custody. All three are CLOSED on the Docker backend (`docker-backend.js`), weaker on macOS sandbox-exec (H1 absolute-write-escape OPEN). **Prefer a Linux/Docker host**; on macOS the uid-611 sudoers exclusion is the sole actor-confinement and PACT's dogfood found the heap-read leg NARROWED-not-closed (shared staff group / `task_for_pid` coarseness).

---

## 6. In-scope vs deferred boundary (the OQ-NS-6 line)

| | PR-A2b delivers (MERGED SHADOW) | Only a real DEPLOYMENT provides | PR-B / out of scope |
|---|---|---|---|
| Edge | store-signer widen, `loom-edge-bind` recompute-inside, `loom-edge-sign` key-holder, launcher + adapter, custody-verify twin, arming flag, deploy helper + runbook | separate uid + 0600 key + root-locked wrapper + sudoers + out-of-band attestation | — |
| Trust effect | **NARROWS** (forgery bar → key-holder; production stays UNSIGNED) | **HARDENS** the co-forge leg (host cannot `read()` the key) | accumulated real merges HARDEN trust |
| Consumer | — | — | `LIVE_SOURCES` flip + recall consumer arming (the **Rubicon**) |

**Do NOT flip `LIVE_SOURCES` (PR-B) onto any edge before the cross-uid signer is DEPLOYED + attested** — that wires a HARDEN gate onto a same-uid-forgeable input. PR-A2b is signer-only + SHADOW.

---

## 7. #273 close criteria

#273 **NARROWS at PR-A2b merge**, and **CLOSES (co-forge leg) only when ALL hold**:

1. PR-A2b merged (the signed-edge lane + `loom-edge-bind` recompute-inside + the off-host signer seam), AND
2. a **DEPLOYED** separate-uid edge signer whose private key the same-uid host cannot `read()` (kernel EACCES; key 0600 owned by the signer uid; root-locked wrapper; uid-611 excluded), AND
3. the operator's **out-of-band uid attestation** (the SOLE determiner — no code asserts it), AND
4. PR-B arming `authenticatedWorldAnchorIds` against a custody PUBLIC verify key the host did not author (`allowEnvFallback:false`).

**Residual even then (OQ-NS-6, never code-closeable)**: provenance ≠ world-anchored trust. A host-unreadable key proves the legitimate minter signed THIS edge; it does NOT prove the diff genuinely merged. World-anchored TRUST hardens only with **accumulated real merges** through the gate + a real out-of-band merge oracle.

**`from_node_id` recompute contract — RESOLVED (see §8.6): the edge is a NARROW, non-authoritative signal.** The edge broker recompute-binds the `edge_id` ONLY (`deriveWorldAnchorEdgeId({from,to,type}) === edge_id`), which closes the sign-arbitrary-64-hex oracle but does NOT prove `from_node_id` is a genuinely world-anchored node. `to_delta_ref` IS the kernel-sealed `approval_hash` (upstream-bound), which narrows it; full `(merge, lesson, node)` value-commitment is **deferred to the weight-minter (PR-B)** per the weight-gate arc's Rev-1 CRITICAL resolution ("the value-committing weight-minter commits the full tuple, NOT the edge seam"). PR-A2b therefore ships the edge as explicitly non-authoritative, and the PR-A2b store/consumer headers MUST state that a consumer may NOT treat `from_node_id` membership as authoritative without the weight-minter's full-tuple commitment. (This is a build-time documentation + design constraint, not a deploy-time decision.)

---

## 8. Resolved decisions (user-ratified 2026-06-29)

All seven are now RESOLVED; this section is the rationale ledger (see §0 for the contract summary).

1. **Custody vehicle direction — RESOLVED: Vehicle B** (dedicated `loom-edge-signer`-uid edge broker), over Vehicle A (second arm on the live egress broker) and Vehicle C (sandbox/actor-uid). Judge ranked B (8) > A (7) > C (4); the decisive axis is custody soundness + blast-radius isolation.
2. **Scope — RESOLVED: the EDGE-signer vehicle ONLY.** RFC §5.5 step 3 ("mint the world-anchor *weight* signed with the cross-uid key; the gate verifies that") is assigned by RFC §7 item 4 to "the parked weight-gate RFC's Phase 3-4" = PR-B, downstream. PR-A2b = the edge-signer vehicle (parent RFC `2026-06-18` §5.1 + the item-5 plans). The two RFCs reuse "PR-A2" for distinct deliverables — *probed firsthand*.
3. **Third uid vs reuse broker-610 — RESOLVED: a dedicated `loom-edge-signer` uid + its OWN edge-domain key.** A key compromise must not cross the approval↔edge domains, and the verifier must never be pointed at an ambient `LOOM_EDGE_VERIFY_KEY` (the H2 dead-pin lesson). Reusing 610 (coupling) is rejected.
4. **PACT — RESOLVED: mirror-as-pattern, never invoke-as-vehicle.** PACT is a deployable cross-uid broker sharing the same `edge-attestation` primitive, BUT a Loom `edge_id` is NOT a PACT persona-frame (PACT's require-frame gate would refuse it; its legacy mode is a blind oracle). Per the standing cross-substrate directive: mirror PACT's `broker-sign` / `broker-launch` / `custody-verify` shape + runbook; do NOT call PACT as the live edge signer.
5. **R12 sequencing + host — RESOLVED: build host-agnostic; deploy prefers Linux/Docker (operator-deferred).** Vehicle B's KEY custody depends on none of the R12 residuals → independently shippable, does NOT block on ContainerAdapter hardening. The actor-confinement leg prefers Linux/Docker (H1/output-DoS/C1-C2 closed) over macOS sandbox-exec; the production host class for the first cross-uid deploy is an operator-owned deploy-time decision.
6. **`from_node_id` recompute contract — RESOLVED: the edge is a NARROW, non-authoritative signal (see §7).** The edge broker recompute-binds the `edge_id` ONLY (closes the sign-arbitrary-64-hex oracle); the broker does NOT re-derive `node_id` from kernel inputs. The full `(merge, lesson, node)` value-commitment is the **weight-minter's** job (PR-B), per the weight-gate arc's Rev-1 CRITICAL resolution. PR-A2b ships the edge explicitly non-authoritative + documents that constraint in the store/consumer headers. (Build-time design + doc constraint, not a deploy-time decision — supersedes the recon's "decide before deploy".)
7. **Deployment ownership + attestation cadence — RESOLVED: operator-owned, deferred + named in the runbook.** The deployed cross-uid box, the keypair provenance, and the re-attestation trigger (after reboot / key-or-wrapper rotation — the process↔uid bind is point-in-time) are documented in `docs/deployment/loom-edge-signer.md` (built in §5 item 7) and executed out-of-band by the operator; none is code-provable in-substrate.

---

## ADR: PR-A2b cross-UID world-anchor edge signer vehicle

**Status**: Accepted (user-ratified 2026-06-29; promote to a numbered ADR under `packages/specs/adrs/` when the build wave opens)
**Context**: The world-anchor `world-anchored-by` edge is INTEGRITY-only (UNSIGNED in production); the env-PEM default signer is same-uid-readable, so a same-uid co-forge defeats #273. PR-A2a stood up the inbound verify; PR-A2b must stand up the outbound cross-uid signer.
**Decision**: Vehicle B — a dedicated edge-signing broker (Loom-domain sibling of `loom-broker-*`), its OWN ed25519 key under a third uid, recompute-inside via `loom-edge-bind.js`, injected through the frozen `opts.edgeSigner` seam. Ship SHADOW (`signer: undefined` in production); deployment + out-of-band attestation HARDEN.
**Consequences**: Lowest blast radius (disjoint fault domain from the live emit-gating approval broker); reuses proven egress primitives + the frozen crypto leaf; requires a one-arg→two-arg store-signer WIDEN before recompute-inside is possible; the HARDEN is fully deployment-blocked and not code-provable (correctly disclosed, per OQ-NS-6).
**Alternatives Considered**: Vehicle A (second arm on the egress broker) — rejected for god-CLI / Single-Responsibility risk + cross-domain key coupling + larger blast radius on the production egress chokepoint. Vehicle C (sandbox/actor-uid) — rejected: the Docker namespace runs as the SAME host uid (`docker-backend.js:91-98`) so it does not deny the host `read()` of the key; plus a uid-611 inversion risk + a docker-group-root-equivalent precondition. C's containment is for the ACTOR, not the KEY.
**Principle Audit**: Single Responsibility + KISS (a dedicated edge vehicle, not a god-CLI second arm) → **Modularity** (disjoint fault domain) + **Security** (defense in depth, least privilege via a separate uid + 0600 + root-locked wrapper; fail-closed everywhere). YAGNI (no new crypto — the seam is frozen; the delta is custody, not algorithm). **Conflict surfaced**: maximal reuse (Vehicle A) vs fault-domain isolation (Vehicle B) — resolved toward Security/Modularity over reuse, because the edge domain must not share the approval broker's emit-gating surface or key.
**Sources**: `kb:architecture/crosscut/single-responsibility`; `kb:security-dev/auth-patterns`

---

## KB Sources Consulted

- `kb:architecture/crosscut/single-responsibility` — informed the Vehicle B vs A split (dedicated edge vehicle over a second arm on the approval broker / god-CLI risk).
- `kb:security-dev/auth-patterns` — informed the custody model (uid-separation + 0600 owner-only + root-locked wrapper as the real boundary; least privilege; fail-closed; the integrity-vs-provenance distinction).
- `kb:architecture/discipline/trade-off-articulation` — informed the HARDENS-vs-NARROWS framing and the OQ-NS-6 ceiling (merged code narrows; only deployment + a real merge oracle hardens).
- `kb:architecture/crosscut/information-hiding` — informed the frozen `opts.edgeSigner` seam + crypto-agnostic store boundary (the signer holds the key; the store persists opaque output).

## Requirements Checklist

| # | Requirement | Disposition |
|---|---|---|
| 1 | §1 Context — PR-A2b after #462; #273 narrows-at-A2a, closes-at-A2b+deployed | ADDRESSED §1 |
| 2 | §2 Deliverable — minted edge carries a cross-uid sig a custody-pinned `authenticatedWorldAnchorIds` accepts | ADDRESSED §2 |
| 3 | §3 The seam — `edgeSigner` contract, crypto-agnostic store, consumer pins `verifyKey` `allowEnvFallback:false` | ADDRESSED §3 |
| 4 | §4 Custody-vehicle decision — RECOMMENDED + WHY (custody soundness decisive) + 1-line rejections + HARDENS/NARROWS + deployment-to-harden | ADDRESSED §4 |
| 5 | §5 Dependency-ordered work — residuals/preconditions FIRST, then signer, then wiring + consumer verify-key custody; each marked now/deploy | ADDRESSED §5 |
| 6 | §6 In-scope vs deferred — MERGED SHADOW vs DEPLOYMENT (OQ-NS-6 line); PR-B out | ADDRESSED §6 |
| 7 | §7 #273 close criteria — precise condition | ADDRESSED §7 |
| 8 | §8 Open questions — custody direction, PACT reuse, R12 sequencing | ADDRESSED §8 |
| 9 | Read-only recon; no edits; no private-key bytes / custody-file contents printed | ADDRESSED — paths + perms only; no key reads |