# Carry C — W1: authenticated `confirmed-by` edge minter (ed25519, shadow-complete)

> Phase: v-next trust-hardening (scope: [2026-06-16-v-next-trust-hardening-phase.md](2026-06-16-v-next-trust-hardening-phase.md)).
> User decisions (2026-06-16): **Carry C standalone first**; **ed25519 kernel-held key**;
> **shadow-complete** (accept both signed + unsigned; do NOT flip require-signed — that is W2, deferred).
> Workflow: this plan -> 3-lens VERIFY -> TDD build -> 3-lens VALIDATE -> gate -> PR (USER merge gate).

## Goal

**NARROW** the #273 provenance residual on the `confirmed-by` edge ledger by building + proving the
authenticated-edge MECHANISM end-to-end: a `confirmed-by` edge becomes **unforgeable by a file-writing
(`p-writescope`) attacker who does not possess the minter's private key** (an in-process
code-exec / memory-read attacker is out of scope and defeats any in-process scheme). Ship it
**shadow-complete**: the mechanism is internally provable, it changes NO downstream behavior, and it
accepts legacy unsigned edges.

**What this explicitly does NOT do (VERIFY hacker HIGH-1 — the honest scope):** it does NOT close the
co-forge of the *live* `recurrence_count_confirmed` weight. That weight's only producer
(`runConsolidationPass` -> `confirmedNodeIds` -> `listEdges`, `lesson-consolidate.js:121-123`) stays
UNCHANGED in shadow, so an attacker who simply OMITS `edge_sig` writes an unsigned edge that still passes
verify-on-read and still inflates the weight — no key needed (firsthand-reproduced by the VERIFY hacker).
W1 makes SIGNED edges unforgeable and provides the authenticated lane (`authenticatedEdgeIds`); switching
the live weight to authenticated-only is the W2 enforce-flip the user deliberately deferred. A red-test
PINS this residual so it is test-asserted, not prose-only. **The PR title + ROADMAP MUST NOT say
"close/closed" for #273 — use "narrows the W1 co-forge bar; in-process + unsigned-path residual stands,
deferred to W2/Design B."**

## Runtime Probes (run firsthand 2026-06-16 — not from prose)

| Claim | Probe | Result |
|---|---|---|
| The co-forge is LIVE, not theoretical | `/tmp/coforge-probe.js`: hand-build an edge (zero gate runs) -> `writeEdge` -> `listEdges` -> `confirmedNodeIds` | **CO-FORGE SUCCEEDED** — forged edge accepted, victim node entered PREDICTOR lane, `edge_id===deriveEdgeId(body)` (byte-indistinguishable). This is the **red-test** the minter must turn green. |
| ed25519 sign/verify available | `crypto.generateKeyPairSync('ed25519')` + `crypto.sign(null,..)/verify(null,..)` | works on **Node v22.22.0** (`crypto.sign`/`verify` with `null` algorithm = ed25519) |
| No kernel signing primitive to reuse | `grep -rnE 'createHmac\|createSign\|crypto\.sign\|ed25519\|HMAC' packages/kernel` | **zero** -> build `packages/kernel/_lib/edge-attestation.js` |
| Reusable kernel primitives | `ls packages/kernel/_lib` | `canonical-json`, `atomic-write`, `deep-freeze` present (lab->kernel import is legal) |
| `edge_sig` outside the id basis is non-orphaning | `deriveEdgeId` hashes `[from,to,type,normFtp(ftp)]` only (`recall-edge-store.js:65-73`); `recorded_at` is already a top-level non-basis field | adding `edge_sig`/`sig_alg` as top-level fields OUTSIDE the id basis keeps every existing edge_id stable (additive, NOT an in-place basis edit -> respects the one-way-door at `recall-edge-store.js:25-28`) |
| `crypto.verify(null,…)` follows the KEY type, not ed25519 (alg-confusion) | `crypto.verify(null, msg, rsaPubKey, rsaSig)` | **returns `true`** (an RSA key+sig verifies under `null`) -> `verifyEdgeSig` MUST pin `asymmetricKeyType==='ed25519'`; `sig_alg` is reject-filter-only |
| No production minter process exists yet (the process-boundary premise) | `grep -rn runConfirmationPass packages` (excl. its own file) | **zero** production callers (only the test) -> the "separate-process" unforgeability is a FORWARD deployment property, not a W1 deliverable; W1's honest claim is "any-file-writer -> private-key-holder" |

## Threat model (the crux — VERIFY this firsthand at the board)

The documented co-forge attacker is a **sub-agent doing `p-writescope` writes**: a *separate process*
that can write arbitrary bytes to absolute paths (incl. `~/.claude/lab-state/recall-edge/`) but
**cannot read the orchestrator/minter process's in-memory env**. ed25519 closes exactly this:

- The **verifier** (`verifyEdge`, on the lab read path) needs only the **public** key. It ships
  (committed default + `LOOM_EDGE_VERIFY_KEY` override).
- The **private** key MUST be kept in the legitimate minter's process env (`LOOM_EDGE_SIGNING_KEY`),
  out of any sub-agent-readable location. **This is a future deployment PRECONDITION, not a W1
  deliverable** (honesty MED-2): W1 ships the sign/verify mechanism + a test/dev keypair; production key
  provisioning/rotation is deferred (see "does NOT do"). The provable W1 property is narrower and IS
  internally testable: an edge signed by the kernel key verifies + enters the authenticated lane; an
  edge that *claims* a signature but fails to verify is rejected; an unsigned edge is excluded from the
  authenticated lane. A file-writing attacker cannot produce a valid signature over any `edge_id`
  without the private key.

**Why this is not the "same-process" weakness the scope-probe flagged**: that concern is a *malicious
lab module executing in the minter's own process* — already arbitrary-code-execution (an attacker who
runs code in the minter process has won regardless of crypto). The `p-writescope` model is **file
writes, not code execution**; a spawned sub-agent runs in its own process without the signing-key env.

**The unprobed-boundary caveat (VERIFY hacker MED + probed firsthand 2026-06-16):** `runConfirmationPass`
has **zero production callers today** (only the test invokes it) — so there is no production minter
process yet, and the "separate process" boundary is itself a FORWARD property of however the minter is
eventually deployed, not something W1 establishes. Honest as-shipped claim: W1 raises the bar from
"any file-writer who calls the exported `deriveEdgeId`" (trivial — proven live) to "a holder of the
kernel private key." Whether that holder is genuinely isolated from the file-writing actor is a
deployment-time property to re-probe when a real minter driver is wired (the W2/live boundary).

**Honest residual (state it in the PR + ROADMAP, do NOT paper over it)**: the boundary is "possession
of the private key." A strictly-stronger attacker who can read the minter process's memory/env, or who
can execute code in that process, can still sign — but that attacker already defeats any in-process
scheme. The hard separate-process / kernel-owned-writer boundary (Design B) remains available as a
future escalation **if/when the weight is ever promoted to gate an action** (it gates nothing in this
shadow phase). This W1 raises the bar from "anyone who can call the exported `deriveEdgeId`" (trivial,
proven live above) to "anyone who possesses the kernel-held private key" — a real, large narrowing.

## Design

### 1. New kernel primitive — `packages/kernel/_lib/edge-attestation.js`

Pure crypto, no lab deps (kernel layer). Exports:

- `generateEdgeKeypair()` -> `{ publicKeyPem, privateKeyPem }` (ed25519; for tests + provisioning).
- `signEdgeId(edgeId, opts)` -> base64 signature `| null`. Loads the private key from
  `opts.privateKeyPem` || `process.env.LOOM_EDGE_SIGNING_KEY`. **Returns `null` if no key** (the minter
  then writes an unsigned/shadow edge — fail-soft, never throws). `edgeId` must be HEX64 or it returns
  `null` (don't sign garbage).
- `verifyEdgeSig(edgeId, sigB64, opts)` -> `boolean`. Loads the public key from `opts.publicKeyPem` ||
  `process.env.LOOM_EDGE_VERIFY_KEY` || the committed default. Returns `false` on any malformed input
  (never throws). Signs/verifies over the **`edge_id` string** (the sha256 of the identity basis —
  binds the signature to the exact edge identity; the id already commits to from/to/type/ftp).
- A committed default public key constant (the private half is NOT in the repo). For internal
  dogfood/tests, a fresh keypair is generated and injected via opts/env.

**Crypto-correctness rules folded from the VERIFY hacker (load-bearing — `crypto.verify(null,…)` follows
the KEY type, NOT ed25519; reproduced firsthand: an RSA key + RSA sig verifies under `null`):**

- **PIN ed25519 on the KEY, never on the self-asserted `sig_alg`** (HIGH-2 / algorithm-confusion): in
  `verifyEdgeSig`, build the `KeyObject` and assert `keyObject.asymmetricKeyType === 'ed25519'` BEFORE
  verifying — reject otherwise. Reject any `LOOM_EDGE_VERIFY_KEY` override whose type is not ed25519
  (fail-closed, log). `sig_alg` is used ONLY as a forward-compat REJECT filter (`sig_alg !== 'ed25519'`
  -> reject), NEVER as an algorithm SELECTOR — it is an attacker-writable field (the #273 "verify the
  field, not the minter" trap in miniature).
- **Canonical base64 on `edge_sig`** (MED / parser-differential): reject unless
  `Buffer.from(edge_sig,'base64').toString('base64') === edge_sig` (Node's base64 decode is lenient —
  a whitespace-injected sig still decodes + verifies, yet `edge_sig` is outside the id basis so two
  byte-different sigs share an `edge_id`). Reject non-string / wrong-length sigs before verify.
- **Sign-over-`edge_id` is a deliberate coupling** (architect MED): the signature's binding is only as
  strong as `deriveEdgeId`'s collision-resistance + stability. A future basis-version bump (the
  `EDGE_TYPE`/basis one-way-door anticipates `contradicted-by` etc.) MUST be treated as a sig-semantics
  change (re-mint). Kept as-is for W1 (simplest, tamper-evidence holds via the existing
  `deriveEdgeId(rec)===rec.edge_id` re-check); this sentence documents the otherwise-invisible coupling.

### 2. Additive edge fields (OUTSIDE the `edge_id` basis)

`recall-edge-store.js` `normalize()` gains two top-level fields, like `recorded_at` (NOT in
`deriveEdgeId`):

- `edge_sig`: base64 ed25519 signature over `edge_id`, or absent (unsigned/legacy).
- `sig_alg`: `'ed25519'` when signed (forward-compat marker so a future alg swap is detectable).

`deriveEdgeId` is **UNCHANGED** -> existing edge ids stay stable, no orphaning.

### 3. `verifyEdge` shadow-complete contract

Extend the read/write predicate (`recall-edge-store.js:77-89`):

- `edge_sig` **absent** -> UNSIGNED (legacy/shadow). `verifyEdge` still returns the rec (accept-both).
- `edge_sig` **present** -> require `sig_alg==='ed25519'` (reject-filter only; an absent/unknown alg
  with a sig -> reject) AND canonical-base64 (reject malleated sigs) AND `verifyEdgeSig(edge_id,
  edge_sig)` true against an ed25519-pinned public key. All hold -> accept (authenticated). **Any fail
  -> REJECT (return `null`)**: you cannot claim signed and lie.
- A tampered basis field flips `edge_id` -> the existing `deriveEdgeId(rec)!==rec.edge_id` check
  already rejects it; the signature adds the provenance layer on top.
- `verifyEdge`/`loadEdge`/`listEdges` accept `opts.verifyKey` (threaded to `verifyEdgeSig`) so tests
  inject the matching public key.

### 4. The minter signs — `runConfirmationPass` (`lesson-confirm.js`)

The ONLY legitimate edge writer. After it builds the edge rec and computes the id (via `writeEdge` ->
`normalize`), it signs. Cleanest seam: `writeEdge(rec, { signer })` where `signer = (edgeId) => sigB64|null`.
If `signer` is provided and returns a sig, the stored rec carries `edge_sig`+`sig_alg`; else unsigned.
`runConfirmationPass` passes `signer = (id) => signEdgeId(id, { privateKeyPem: opts.signingKey })`
(real minter reads env; tests inject a test key). The store stays crypto-agnostic on the WRITE side
(it just stores the signer's opaque output) but OWNS the verify-on-read check (imports `verifyEdgeSig`)
— the "each store's verify predicate is security-load-bearing" ethos at `recall-edge-store.js:14-17`.
This is the correct SRP split: the gate mints/signs (an injected dependency), the store's verify
predicate is the security boundary (owns verification).

**Doc-sync in the same diff (architect LOW):** this wave EVOLVES the store header contract at
`recall-edge-store.js:19-23` — post-W1 `verifyEdge` proves integrity AND (when a sig is present)
provenance. Update that "proves INTEGRITY... NOT PROVENANCE" comment block in the same diff so the
documented contract matches the code (and note the residual: an UNSIGNED edge still proves only
integrity in shadow).

### 5. `authenticatedEdgeIds(edges, opts)` — the test + adversarial-probe seam (shadow, no consumer)

A NEW exported helper (alongside `confirmedNodeIds`) that filters to edges whose `edge_sig` verifies.
Its present-need justification is the **test + adversarial seam** (the KB's testability carve-out): the
red-test asserts an unsigned edge is EXCLUDED by it, and the VALIDATE hacker attacks it — NOT "what W2
switches to" (that is one candidate path; the other is W2 flipping `verifyEdge` to reject-unsigned, after
which every loaded edge is already authenticated — phase open-question 7). **W1 does NOT change
`confirmedNodeIds`** (still counts all valid edges -> zero downstream behavior change -> shadow).

- **Fail-closed (hacker LOW):** an edge is included by `authenticatedEdgeIds` ONLY when `edge_sig` is
  present AND `sig_alg==='ed25519'` AND `verifyEdgeSig` returns true against a successfully-loaded
  ed25519 public key. Absent sig -> excluded; present sig but unloadable/absent verify key -> excluded
  (NEVER accept-all). Test: with no loadable verify key, `authenticatedEdgeIds([signedEdge]) === []`.
- **Guard-rail comment at the export (architect LOW):** `// SHADOW-ONLY consumer surface —
  confirmedNodeIds intentionally still counts ALL valid edges; do NOT wire authenticatedEdgeIds into
  consolidation/ranking until W2 re-mints the corpus (phase cross-carry seam #1 / edge-basis trap #4).`

## What W1 explicitly does NOT do (deferred to W2 — out of this scope)

- Does NOT flip `verifyEdge` to REJECT unsigned edges (that retroactively invalidates every existing
  edge — needs a re-mint or clean-slate decision; open question 7 in the phase plan).
- Does NOT switch `confirmedNodeIds`/`runConsolidationPass` to authenticated-only (no downstream
  behavior change in shadow).
- Does NOT provision a production signing key / key-rotation ceremony (MECHANICS FREEZE pre-live per
  the beta mandate; the mechanism + a test/dev keypair are the W1 deliverable).
- Does NOT build the separate-process / kernel-owned-writer hard boundary (future escalation if the
  weight ever gates).

## HETS Spawn Plan — VERIFY board (security wave -> full 3-lens, read-only personas)

| Lens | Persona | Charge |
|---|---|---|
| Design / layering | `architect` | Is `edge-attestation` correctly kernel-layer (lab->kernel legal, no kernel->lab)? Is signing-over-`edge_id` sound? Is the additive-field / one-way-door discipline correct? Is the `signer`-injection seam the right factoring? |
| Adversarial-security | `hacker` | Pressure-test the threat model: does ed25519-env-key actually close the `p-writescope` co-forge, or is it enforcement-theater? Attack the design: wrong-key acceptance, sig-absent bypass downstream, `sig_alg` confusion, signing-garbage, key-absence fail-open, can a forger still inflate via the UNCHANGED `confirmedNodeIds` in shadow (and is that honestly scoped)? |
| Claim-vs-evidence | `honesty-auditor` | Does the plan over-claim "provenance closed"? Is the shadow/narrows-not-hardens framing honest (OQ-NS-6)? Is the "honest residual" complete? Does "shadow-complete" actually mean zero behavior change? |

Fold all board corrections into this plan BEFORE building. Re-spawn the **hacker at VALIDATE** to
re-probe the BUILT minter (Rule 2a — a green TDD suite is not proof; the adversary attacks the
implementation, builds live probes against the actual module).

## Test plan (TDD — write tests first, red, then green)

`tests/unit/kernel/edge-attestation.test.js` (new) + extend `tests/unit/lab/attribution/recall-edge-store.test.js`
+ `tests/unit/lab/causal-edge/lesson-confirm.test.js`:

The red-test goes green via the VERIFIER + the authenticated-consumer surface (NOT the minter):
`verifyEdge` rejects a lying signature; `authenticatedEdgeIds` excludes an unsigned edge.

1. **Red (the authenticated lane)**: an UNSIGNED hand-built edge is EXCLUDED by `authenticatedEdgeIds`;
   an edge that CLAIMS a signature but carries a garbage/wrong-key sig is REJECTED by `verifyEdge`
   (returns null). (Today both would pass — the failing spec.)
2. **Red (the residual is PINNED, hacker HIGH-1)**: assert that post-W1 an UNSIGNED forged edge STILL
   inflates `recurrence_count_confirmed` via the UNCHANGED `confirmedNodeIds`/`runConsolidationPass`
   path — i.e. the live-weight co-forge is open by design until W2. This test makes the residual
   test-asserted, not prose-only; it must PASS (documenting the shadow scope), and a comment cites W2.
3. **Sign/verify roundtrip**: `signEdgeId` then `verifyEdgeSig` -> true; minter-signed edge ->
   `verifyEdge` accepts AND `authenticatedEdgeIds` includes it.
4. **Wrong key**: edge signed by key X, verified against key Y -> `verifyEdge` null.
5. **Algorithm-confusion (hacker HIGH-2)**: an RSA-signed edge carrying `sig_alg:'ed25519'` -> reject; a
   verify key whose `asymmetricKeyType !== 'ed25519'` -> reject (NOT silent-accept).
6. **Base64 canonicalization (hacker MED)**: a whitespace/non-canonical `edge_sig` -> reject even though
   it would otherwise decode+verify.
7. **Authenticated filter fail-closed (hacker LOW)**: with no loadable verify key,
   `authenticatedEdgeIds([signedEdge]) === []` (excluded, never accept-all).
8. **Tamper**: flip a basis field on a signed edge -> `edge_id` changes -> sig mismatch -> reject.
9. **Shadow accept-both**: an unsigned legacy edge still loads via `verifyEdge`/`listEdges` (no behavior
   change); `confirmedNodeIds` still counts it (unchanged).
10. **Key absence**: `signEdgeId` with no key -> null -> minter writes an unsigned edge (fail-soft, no throw).
11. **Malformed**: `signEdgeId`/`verifyEdgeSig` with non-HEX64 id, non-string sig, absent inputs -> null/false, never throw.
12. **`sig_alg` discipline**: `edge_sig` present with absent/unknown `sig_alg` -> reject.

## Honest residual (carry to PR + ROADMAP)

W1 NARROWS (raises the forgery bar from trivial to "possess the private key"); it does NOT HARDEN trust
in any world-anchored sense (OQ-NS-6). The boundary is in-process key-possession; a code-execution /
memory-read attacker in the minter process is out of scope (and defeats any in-process scheme). The
separate-process hard boundary is a future escalation gated on the weight ever being promoted to gate
an action — it gates nothing today.

## VERIFY board fold (2026-06-16 — `wf_4d95c5fa-d1c`)

3-lens pre-build board (architect + hacker + honesty). **Verdict: needs-revision (hacker) — driven
SOLELY by a claim-honesty finding, NOT a crypto-correctness flaw; all three blessed the ed25519
mechanism + additive-field/one-way-door discipline.** Architect + honesty: closeable. All findings
folded above (the build proceeds from the folded plan):

| # | Lens | Sev | Finding | Fold |
|---|---|---|---|---|
| 1 | hacker | HIGH | Goal claims W1 "closes" the live-weight co-forge, but `confirmedNodeIds`/`runConsolidationPass` are unchanged -> an unsigned-omitted edge still inflates `recurrence_count_confirmed` (reproduced firsthand) | Goal rewritten to "NARROW + prove mechanism"; explicit "does NOT close the live weight" para; PR/ROADMAP forbidden from "close/closed"; residual PINNED by red-test #2 |
| 2 | hacker | HIGH | `crypto.verify(null,…)` follows the KEY type not ed25519 (RSA verifies under null — reproduced); `sig_alg` is attacker-writable | `verifyEdgeSig` PINS `asymmetricKeyType==='ed25519'`; `sig_alg` reject-filter-only, never a selector; test #5 |
| 3 | hacker | MED | base64 decode is lenient -> malleated `edge_sig` (outside id basis) | canonical-base64 round-trip check; test #6 |
| 4 | hacker | MED | process-boundary premise unprobed | probed: `runConfirmationPass` has zero production callers -> threat-model reframed to a forward deployment property; Runtime Probe row added |
| 5 | hacker | LOW | `authenticatedEdgeIds` could accept-all on absent key | fail-closed spec + test #7 |
| 6 | architect | MED | signing `edge_id` couples sig to `deriveEdgeId` stability | documented coupling note in §1 (kept edge_id signing for W1) |
| 7 | architect | LOW | `authenticatedEdgeIds` borderline-YAGNI | reframed as test/adversarial seam + SHADOW-ONLY guard-rail comment |
| 8 | architect | LOW | store header `:19-23` "NOT PROVENANCE" goes stale | doc-sync in the same diff (§4 note) |
| 9 | honesty | MED | Goal verb "Close" overclaims vs residual | folded with #1 (verb -> NARROW) |
| 10 | honesty | MED | "key lives ONLY in env, never on disk" overstates as-shipped posture | reframed as a future PRECONDITION (threat-model edit) |
| 11 | honesty | LOW/NIT | "what W2 switches to" / red-test phrasing | softened to "one candidate path"; red-test credited to verifier+consumer, not minter |

## VALIDATE result (2026-06-16 — `wf_75955d18-7e5`)

Post-build 3-lens board (code-reviewer + hacker re-probing the BUILT code per Rule 2a + honesty).
**Core security HELD**: the hacker ran 17 live forge scripts against the real modules — could NOT
forge into `authenticatedEdgeIds` without the private key via any of 9 vectors (own-key, RSA/EC
alg-confusion, base64 malleability, `sig_alg` spoof, sign-a-different-id, half-signed, array-coercion,
legit-sig-rebind) and found no DoS (8 malformed classes + a 20MB sig all fail-soft). Verdicts:
honesty **ship** (Grade A, no-overclaim); code-reviewer + hacker **fix-then-ship** (no re-board).

**The load-bearing fold — Design Y (store shape-only; crypto lives solely in the authenticated lane):**
the hacker's MED-1/MED-2 + LOW(retireEdges) + honesty NIT-3 all converged on one root: having
`verifyEdge` crypto-verify-and-drop creates a data-loss/un-prunability trap (a legit edge under a
rotated/wrong key VANISHES from `confirmedNodeIds` AND becomes un-prunable by `retireEdges`) and makes
"zero downstream change" config-conditional. **Fix:** `verifyEdge` now does SHAPE-only checks on a
present sig (`sig_alg`=ed25519 + canonical-base64); ALL crypto-verification lives in
`authenticatedEdgeIds` (fail-closed, the real boundary — unchanged, the hacker confirmed it holds).
This makes the store KEY-FREE (no edge is ever dropped on a key mismatch), makes "zero downstream
change" ABSOLUTE (not config-conditional), restores the store's original "integrity store; the lane
owns provenance" ethos, and keeps the security property 100% intact (a lying sig is accepted as an
UNAUTHENTICATED edge — exactly as powerless as an unsigned forged edge, the known residual). Closes
hacker MED-1, MED-2, LOW(retireEdges), honesty NIT-3 permanently (not deferred to W2).

**Other folds:**

- **honesty LOW (reversed Design decision, surfaced here per the no-buried-reversal rule):** Design §1
  said W1 ships "a committed default public key constant." The BUILD DROPPED it — a committed default
  with no real minter is exactly the security-theater the #273 rule warns against. `loadPublicKey`
  ships no default; an absent verify key fails CLOSED. This reverses the plan's Design §1; recording it
  here. (The code is the more-honest choice; only the contract was stale.)
- **code-reviewer LOW:** added the absent-`sig_alg` reject test (plan test #12) — `edge_sig` present +
  `sig_alg` absent -> reject (`undefined !== ed25519`).
- **code-reviewer LOW (write-path can't crypto-verify the sig it minted):** dissolved by Design Y —
  the store never crypto-verifies on read OR write; the write-path `verifyEdge` is shape-only (commented).

**Deferred to W2 (recorded, not folded now — out of W1 scope):**

- **hacker LOW (env-key trust):** `authenticatedEdgeIds` falls back to `LOOM_EDGE_VERIFY_KEY` when
  `opts.verifyKey` is omitted. Out-of-model today (no live consumer; the verify key is public-by-design
  and the lane has zero production consumers). When W2 wires a live consumer, require `opts.verifyKey`
  explicitly from a kernel-owned source (or pin the env key against a committed fingerprint).
- **key-rotation contract:** before any verify key is wired into a live read path, define the
  rotation/trust-set policy (Design Y means a stale-key edge degrades to unauthenticated rather than
  vanishing — already the safe behavior; W2 should still document the trust-set explicitly).
