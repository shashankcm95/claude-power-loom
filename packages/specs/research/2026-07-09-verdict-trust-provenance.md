# Design: verdict-trust provenance (closing the self-inflation bypass)

Status: DESIGN / proposed. Surfaced by the multi-lens bug-bounty audit
(runtime-orchestration lens, CONFIRMED). The live arm is **operator-only**
(key provisioning + arming), so this is a plan, not a shipped fix.

## The finding

`packages/runtime/orchestration/identity/verdict-recording.js` `cmdRecord` is the
sole appender to a persona-identity's `verdicts` / `quality_factors_history`. It
accepts `--verdict pass|partial|fail` and an arbitrary `--quality-factors-json`
blob directly from CLI argv, with **no check on who/what invoked it**. Any process
with the same filesystem + Bash access as the orchestrator — including a spawned
actor persona that has the Bash tool — can call it directly for its own identity:

```
node identity/verdict-recording.js record --identity <own-identity> --verdict pass \
  --quality-factors-json '{"findings_per_10k":10,...}'
```

Once the accumulated verdicts push `passRate >= 0.8`, `tierOf` (trust-scoring.js:70)
returns `high-trust`, and `verification-policy.js` begins recommending
`spot-check-only` with `spawnChallenger:false` for that identity's future work —
reducing the very review depth the multi-lens / challenger discipline exists to
guarantee, on the basis of unauthenticated, self-reported data.

This is the `#273` family's core lesson (`integrity != provenance`): a record's
mere existence in an open-writable store proves self-consistency, never that the
*legitimate producer* minted it.

## Blast radius (why this is a plan, not a P0)

The consumer is **advisory**, not a kernel gate. `verification-policy` emits a
*recommendation*; `contract-verifier --skip-checks` is an orchestrator-supplied
flag, not a hook that blocks a spawn. So a self-inflated tier degrades the
best-effort oversight signal the orchestrator LLM reads — it does not silently
bypass an enforced control. That is the same "tolerable ONLY because the weight is
advisory and gates no live action" boundary the `#273` family draws. The moment
this tier gates a live action (an enforced skip, an auto-merge, a spend), the
authenticated minter below becomes mandatory, not optional.

## Threat model

Single-uid. The orchestrator and every spawned actor run as the **same OS user**
with the same filesystem access; the actor persona may hold the Bash tool. There
is therefore **no ambient signal** — no uid, no path permission, no
process ancestry — that distinguishes a genuine orchestrator-recorded verdict from
an actor forging one for itself. Any structural guard (a self-verdict prohibition,
a "distinct recorder" rule, an existence/rate check) is bypassable by a caller who
simply re-labels itself. **The only durable discriminator is a secret the actor
does not hold** — i.e. a signing key.

## Design: attested verdicts

Reuse the existing kernel primitive `packages/kernel/_lib/edge-attestation.js`
(ed25519 sign/verify, alg-pinned, canonical-base64, fail-soft), which already
"closes the `#273` co-forge: a record becomes unforgeable by a writer who lacks
the minter's private key."

1. **Mint (producer side).** When the orchestrator records a verdict, it signs the
   canonical verdict tuple `(identity, verdict, task, quality_factors, spawn_txid)`
   with an orchestrator-held private key and stores the signature alongside the
   verdict. `spawn_txid` binds the verdict to a real spawn record (the Lab
   verdict-attestation store's `agentId -> kernel txid` enrichment is the evidence
   anchor) so a verdict cannot be minted for a spawn that never happened.

2. **Verify (consumer side).** `tierOf` counts a `pass` toward trust elevation
   **only if** its signature verifies against the pinned public key. Unsigned or
   unverifiable verdicts still record (the store stays append-only and honest) but
   are **inert for elevation** — they can never raise the tier.

3. **Fail closed + observable.** A signature-verify failure on a verdict that
   claims elevation emits a high-visibility alert (a tamper attempt or a
   misconfigured anchor), never a silent drop (the `fail-closed-must-be-observable`
   invariant).

### Consumer-side default (the buildable-now half)

Independent of minting, the consumer default should be **fail-closed**: until a
verdict carries a verified attestation, `verification-policy` must NOT reduce
oversight below the baseline. With no signed verdicts yet, this means the tier
elevation simply does not fire — the safe default (more verification), not less.
This half needs **no key and no arming**; it is a pure "don't trust unauthenticated
self-reports" change to trust-scoring / verification-policy, guarded by a flag so
current behavior is preserved until the operator opts in.

## Options

| Option | Closes the bypass? | Needs operator arming? | Notes |
|---|---|---|---|
| A. Do nothing | No | — | The advisory signal stays forgeable. |
| B. Structural guards (self-verdict ban, rate/dedup) | No | No | Bypassable in a same-uid model; security theater. |
| C. Consumer fail-closed default (flag-gated) | Partially | No | Disables tier-based oversight *reduction* until attestation exists. Buildable now. Safe default. |
| D. Attested verdicts (mint + verify), live | **Yes** | **Yes** (key + arming) | The real close. Reuses edge-attestation. Operator provisions the key. |
| **C + D (recommended)** | **Yes** | D half only | Ship C (fail-closed default) + the *verification* mechanism now, SHADOW; arm minting when the operator provisions the key. |

## Recommendation

**C + D, sequenced.** Build the verify-side mechanism and the consumer fail-closed
default now (SHADOW / flag-gated, byte-identical to today when the flag is off, no
key required). Leave the *minting* arm — which requires an operator-provisioned
signing key — as the named residual. This mirrors the substrate's own SHADOW-first,
arming-gated pattern (world-anchor, PACT broker) and the standing "authenticated
minter is arming-gated" position: the mechanism is internally buildable now; the
live arm is an operator action.

## Operator residual (why this cannot be completed autonomously)

The live close requires an orchestrator signing key that the actor cannot read.
Provisioning that key (e.g. under `/etc/loom`, root-owned), setting any arming
flag, and running the armed path are **operator-only** actions per the standing
`③.2` security invariant — Claude never touches those. So the minting arm (step 1
above) is deliberately out of scope for an autonomous change and is handed to the
operator with this design.

## Scope of a follow-up implementation PR (the C + shadow-D half)

- `trust-scoring.js` / `verification-policy.js`: a flag-gated
  `LOOM_REQUIRE_ATTESTED_VERDICTS` that, when set, makes tier *elevation* count
  only verified verdicts and otherwise holds oversight at baseline (fail-closed).
- `verdict-recording.js`: optionally attach a signature when an orchestrator
  signing key is present (absent -> record unsigned, exactly as today).
- A verify helper reusing `edge-attestation.js`; unit tests proving a forged /
  unsigned verdict is inert for elevation while a signed one elevates; the
  flag-off path is byte-identical to today.
- Docs: an `ACTIVATION-LEDGER` entry naming the operator key-provisioning residual.

## References

- `packages/kernel/_lib/edge-attestation.js` — the ed25519 primitive to reuse.
- `packages/lab/verdict-attestation/` — the evidence-linked (agentId -> txid) track.
- `~/.claude/.../security.md` "Authorization & post-condition checks" —
  `integrity != provenance`, authenticated-minter, fail-closed-observable.
- The `#273` family (exact-set / verify-on-read / integrity-not-provenance).
