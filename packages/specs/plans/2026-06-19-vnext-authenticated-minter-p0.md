# Plan — v-next Authenticated Minter, P0 (primitive + invariant, SHADOW)

- **Date:** 2026-06-19
- **Wave:** v-next P0 of the authenticated-minter provenance close (RFC `2026-06-18-authenticated-minter-provenance-close.md`, Option B ratified).
- **Scope:** kernel-security. SHADOW only — mint + verify wired, **no** gating consumer flips, **no** trust-domain (key custody is P1, consumer flips are P2).
- **Goal:** freeze the minter *mechanics* before the ③ live external-PR beta so the `integrity != provenance` close (#273 family, the load-bearing substrate residual) is mechanically ready. No weight gates in P0.

## Routing Decision

```json
{
  "task": "RFC Option-B P0: generalize signEdgeId->signRecordId/verifyRecordSig; add kernel-owned mintWeight (recompute-from-authoritative, not a signing oracle) + verifyMintedWeight; adopt Option-C invariant; land SHADOW",
  "route-decide": { "recommendation": "root", "score_total": 0.15, "substrate_meta_detected": true, "substrate_meta_tokens": ["attestation"], "meta_forcing_instruction": "[ROUTE-META-UNCERTAIN]" },
  "judgment_override": "route",
  "rationale": "The scorer fired [ROUTE-META-UNCERTAIN] (substrate-meta token 'attestation') — the documented catch-22 where the keyword dictionary under-scores kernel-security substrate work ('writes to refs / closes a forge lever' carries no stakes token). This is a kernel-ENFORCED trust primitive (ed25519 signing), MAJOR-version-protected, and THE #273-family close. Architect-shaped per route-decide.js:11-13. Escalated by judgment; full per-wave arc (plan -> architect VERIFY -> TDD -> 3-lens VALIDATE)."
}
```

## Runtime Probes (firsthand, against `main` @ `eb7b485`)

| Claim the plan rests on | Probe | Result |
|---|---|---|
| `signEdgeId`/`verifyEdgeSig` have live consumers I must not break | `grep -rn` across `packages/ tests/` | `lab/causal-edge/lesson-confirm.js:38,112,122,145` (signer + verify-set); 5 test files. `isCanonicalBase64`/`SIG_ALG` consumed by `lab/attribution/recall-edge-store.js:56,120`. **Generalization MUST preserve `signEdgeId`/`verifyEdgeSig`/`isCanonicalBase64`/`SIG_ALG`/`hasVerifyKey`/`generateEdgeKeypair` exports verbatim.** |
| No minter exists yet (clean slate) | `grep -rn "mintWeight\|weight-minter\|signRecordId\|verifyRecordSig\|verifyMintedWeight"` | **zero matches** — new surface, no collision. |
| The A6 gating consumer + its fail-closed hook | Read `evolution-snapshot-read.js` | `readEvolutionSnapshot({verifyProvenance:true})` sets `result.provenance = ...witnessed ? 'witnessed' : 'unwitnessed'` at `:338-342`; `spawn-record.js` calls it **bare** (no flag). This is the **P2** flip target (`verifyProvenance` -> `verifyMintedWeight`). **NOT touched in P0.** |
| The crypto primitive to extend | Read `edge-attestation.js` | `signEdgeId(edgeId,opts)` signs a HEX64 string with an ed25519 key (alg PINNED on the key — refuses RSA/EC); `verifyEdgeSig` fail-CLOSED (no key -> false), canonical-base64 checked. The id-shape is already "any 64-hex" — generalization is a rename + alias, crypto unchanged. |
| Test surface | `ls tests/unit/kernel/` | `edge-attestation.test.js` (5.5KB) exists — extend it for `signRecordId`/`verifyRecordSig`; new `weight-minter.test.js`. |
| Branch state | `git status` / `git log` | on `main` @ `eb7b485`, clean except untracked `packages/specs/findings/2026-06-19-handoff-*.md` (the carve-out handoff doc; NOT part of this PR). |

## Design — the P0 deliverables

### D1. Generalize the signing primitive (`edge-attestation.js`)

- Internal `signHex64(id, opts)` / `verifyHex64Sig(id, sig, opts)` (the existing body, renamed).
- Export **`signRecordId` / `verifyRecordSig`** as the generic names (any 64-hex content-address).
- Keep **`signEdgeId` / `verifyEdgeSig` as aliases** of the generic fns (backward-compat — the lab consumers + 5 test files keep working unchanged). All other exports (`SIG_ALG`, `generateEdgeKeypair`, `hasVerifyKey`, `isCanonicalBase64`) unchanged.
- Crypto, alg-pinning, fail-closed-on-verify, canonical-base64 are **unchanged** (the security-load-bearing rules in the header stay verbatim).

### D2. The minter (new kernel module `weight-minter.js`)

- **`mintWeight({ kind, subject }, opts)`** — accepts a `kind` + `subject` ONLY (**never** caller-supplied bytes or a caller-supplied value — this is the structural oracle defense, RFC §5.2 "the single most important design constraint").
  - Dispatches to a registered **pure policy** for `kind`. Unregistered `kind` -> `null` (mints nothing; cannot be coerced).
  - The policy reads **kernel-authoritative inputs only** (content-verified `record-store` chain; injected reader for testability — dependency inversion) and returns `{ value, basis }`.
  - `basis_digest = sha256(canonical(basis))`.
  - **Binding decision (see VERIFY OQ-A):** sign a `minted_id = sha256(canonical({ kind, subject, value, basis_digest, minted_at, key_id }))` so the signature commits to the **(value <- basis)** binding, not `basis_digest` alone (the RFC's literal `sig = signRecordId(basis_digest)` does not bind `value`; this is a proposed strengthening to surface at VERIFY). `sig = signRecordId(minted_id, opts)`.
  - Returns `{ kind, subject, value, basis_digest, minted_at, key_id, sig }` (or `null` fail-soft; never throws).
- **`registerWeightPolicy(kind, fn)`** + a built-in registry (Open/Closed — P2 adds the real gating policies without editing the core).
- **`verifyMintedWeight(weight, opts)`** -> boolean, **fail-CLOSED**: re-derive `minted_id` from the body fields and `verifyRecordSig(minted_id, weight.sig, opts)`; reject on any missing field / bad shape / absent verify key. An unsigned/unverifiable weight verifies `false` => treated as **absent** by a (future) gating consumer => can only over-halt, never grant (narrowing-safety preserved).
- **`key_id`** field reserved now (RFC §8 — rotation is a P-next additive change).

### D3. Option-C invariant, baked in

- The minter **only** reads kernel-authoritative inputs; it **never** signs a lab-asserted value verbatim. Document + test this as the structural invariant: there is no `mintWeight` code path that signs a value the caller supplied.

### D4. SHADOW landing

- Nothing in P0 makes a gate read a minted weight. `evolution-snapshot-read.js` is **untouched**. `LOOM_EDGE_SIGNING_KEY`/`LOOM_EDGE_VERIFY_KEY` stay unset in prod => `mintWeight` returns unsigned-null and `verifyMintedWeight` returns false by default (fail-closed). The mechanics are exercised only by tests with a generated keypair.

## Non-goals (explicit — do not build in P0)

- **P1:** trust-domain key separation (ContainerAdapter namespace / broker daemon). The key stays same-uid-env in P0 — which is honestly **Option A-equivalent until P1** (stated as the hard precondition; the beta gates on P1, RFC §5.1).
- **P2:** flipping `evolution-snapshot-read` / `spawn-record` / `circuit-breaker` to gate on `verifyMintedWeight`; the concrete reputation/circuit-breaker gating policies (OQ-2 must freeze the gating set first).
- The full reputation distribution as a signed value (RFC §5.4 "do not over-sign").

## Open questions for the architect VERIFY board

- **OQ-A (binding):** sign `minted_id` (commits `value`, D2) vs the RFC-literal `sig = signRecordId(basis_digest)` (commits only the basis; requires the verifier to re-run the policy to bind `value`). Recommend `minted_id` + keep `basis_digest` in the body so a paranoid verifier *can* re-run the policy. Confirm or correct.
- **OQ-B (concrete policy in P0?):** ship the registry mechanism with (α) zero real policies + a test-only reference policy, or (β) one genuinely-reusable kernel-chain policy (e.g. "attest a kernel `transaction_id` is present + content-valid", reusable by P2)? KISS/YAGNI leans α since OQ-2 (gating set) is open; β exercises the recompute path end-to-end with non-throwaway code. Architect to pick.
- **OQ-C (verify re-runs policy?):** should `verifyMintedWeight` optionally re-run the policy and require `value`/`basis_digest` to match (the strongest verify), or is sig-over-`minted_id` sufficient for P0 SHADOW (oracle defense lives entirely on the mint side)? Lean: sig-sufficient for P0, leave the policy-re-run as a documented P2 hardening hook.
- **OQ-D (module placement):** `weight-minter.js` in `packages/kernel/_lib/` (alongside `edge-attestation.js`) — confirm it is kernel-owned and imports nothing from lab/runtime (DIP: authoritative reader injected).

## HETS Spawn Plan

- **VERIFY (pre-build, parallel, read-only personas):**
  - `architect` — pressure-test the design against the RFC (oracle defense, Option-C invariant, the OQ-A/B/C/D decisions, SHADOW completeness, SOLID).
  - `hacker` — adversarial: can `mintWeight` be coerced into a signing oracle? can `verifyMintedWeight` be made to accept a forged/stale weight (canonical-base64 malleability, field-injection on `minted_id` derivation, `__proto__`/array coercion, alg-confusion via a non-ed25519 key)? does generalization open any bypass on the existing edge lane?
  - Fold corrections into this plan + a `## Pre-Approval Verification` section before building.
- **BUILD (TDD):** tests first (the failing behavioral spec for D1-D4), then implement to green. Decide delegate-vs-direct after VERIFY (kernel crypto — lean direct for tight control; if delegated, record the Rule-4 verdict-attestation board).
- **VALIDATE (post-build, 3-lens parallel — REQUIRED for kernel/security per workflow Rule 2):** `code-reviewer` (correctness) + `hacker` (re-probe the BUILT code with live probes per Rule 2a) + `honesty-auditor` (claim-vs-evidence: is it really SHADOW? is the oracle defense real or theater?). Fold, full gate, PR.

## Test plan (TDD spec — author RED first)

1. `signRecordId`/`verifyRecordSig` round-trip; alg-pinning (RSA key -> null sign, false verify); fail-closed (no key -> false); non-canonical sig -> false; `signEdgeId`/`verifyEdgeSig` aliases still pass the existing suite verbatim.
2. `mintWeight` with a registered test policy -> well-formed minted weight; `verifyMintedWeight` true on it.
3. `verifyMintedWeight` **false** on: tampered `value`, tampered `basis_digest`, tampered `subject`/`kind`, swapped `sig`, missing field, wrong verify key, absent key (fail-closed).
4. **Oracle defense:** there is no `mintWeight` signature that accepts caller bytes/value; an unregistered `kind` -> null.
5. SHADOW: with no key in env, `mintWeight` -> null and `verifyMintedWeight` -> false (default-deny).
6. The existing `edge-attestation.test.js` + the 5 lab consumer suites stay green (no regression).

## Pre-Approval Verification (2026-06-19 — architect + hacker board, both APPROVE-WITH-CHANGES)

Both read-only lenses pressure-tested the plan against the real code; the hacker confirmed each claim with throwaway `/tmp/probe*.js` scripts. **Unanimous OQ resolutions + folded findings below. All are now part of the build contract.**

### OQ resolutions (both lenses agree)
- **OQ-A → sign `minted_id`.** `minted_id = sha256(canonical({kind, subject, value, basis_digest, minted_at, key_id}))`; `sig = signRecordId(minted_id, opts)`. Keep `basis_digest` in the body (a paranoid P2 verifier can re-run the policy). The RFC-literal `sig=signRecordId(basis_digest)` is a **proven value-swap forgery** (hacker `/tmp/probe3.js`: keep a genuine `basis_digest`+`sig`, swap `value` 3→999, still verifies). Sign the full tuple.
- **OQ-B → ship the registry + ONE real kernel-chain policy (β).** Policy `kernel-record-attestation`: attest a kernel `transaction_id` is present + content-valid via the injected `record-store.readById` (the narrowest authoritative basis — kernel chain only, no lab; RFC OQ-3). A test-only stub would freeze mechanics whose load-bearing security property (recompute-from-authoritative, RFC §5.2) is never exercised (Rule-2a-corollary). Real reputation/circuit-breaker gating policies stay P2 (OQ-2 gating set still open).
- **OQ-C → sig-over-`minted_id` is sufficient for P0; verify does NOT re-run the policy.** Re-run would couple every gate to the chain reader (ISP). Reserve policy-re-run as a P2 hook. **COUPLED to OQ-A (F1/H-1):** sig-sufficient is safe ONLY because `minted_id` binds `value`.
- **OQ-D → `packages/kernel/_lib/weight-minter.js`, kernel-owned, reader injected (DIP).** Grep-assert zero `../lab`/`../../lab` imports. Keep `mintWeight` + `registerWeightPolicy` in one module (SRP: one reason to change). No registry split (classitis for one policy).

### INV-MINT (the load-bearing invariant — F1/H-1, HIGH, must-fix)
> The signed `minted_id` MUST commit to `value` (and `subject`, `kind`, `basis_digest`, `minted_at`, `key_id`). `verifyMintedWeight` re-derives `minted_id` from an **explicit field allowlist** of the body and verifies the sig over it; it does **NOT** re-run the policy. OQ-A and OQ-C are joined — sign-over-`minted_id` is what makes sig-sufficient-verify safe. Building the RFC-literal `basis_digest`-only signature while taking the sig-sufficient verify reintroduces the #273 forge-a-PASS hole on the verify side.

### Folded findings (build contract)
- **H-2 (HIGH):** `minted_id` re-derivation uses ONE shared `mintedIdBasis(weight)` pure fn (the explicit 6-field allowlist), imported by BOTH `mintWeight` and `verifyMintedWeight` (M1 forward-coupling, as `computeSnapshotHash` does). NOT `{...weight}`-minus-`sig` (mint/verify field-set drift). Test: an injected extra field does NOT change `minted_id`; a tampered allowlisted field DOES.
- **F2 (MEDIUM, must-fix):** the caller picks the `subject` (which record to attest) but never the `value`. `mintWeight` validates `subject` is a non-empty **string scalar** (reject object/array/`__proto__`); the policy further validates its expected shape (HEX64) and resolves ONLY against the content-verified kernel reader, never a lab store. Test: hostile `subject` (object/array/`__proto__`/non-hex) → `null`.
- **F3 (MEDIUM):** `key_id` is **minter-set** (never caller-supplied via opts), a fixed sentinel `'v0'` in P0, inside `minted_id`. `verifyMintedWeight` ignores it for key selection in P0 (single key) but it is signed, so P1 rotation (a key-set keyed on `key_id`) is additive, not signature-breaking. Test: tampering `key_id` → verify false; not caller-overridable.
- **F4 (MEDIUM):** SHADOW is **mechanically checkable** — a test grep-asserts NO file outside the test suite imports `weight-minter.js` (no kernel hook / spawn-state / enforcement / lab caller). Freeze == exercised by tests only.
- **F5 (LOW):** `signEdgeId`/`verifyEdgeSig` are **identity aliases** (`const signEdgeId = signRecordId;`), zero behavioral fork. `basis_digest` + `minted_id` use the existing depth-bounded `canonicalJsonSerialize`; a bounded-throw → `mintWeight` returns `null` (fail-soft), `verifyMintedWeight` returns `false` (fail-closed). Test: over-deep basis → null/false, never a throw.
- **M-1 (MEDIUM, hacker):** **stale-mint replay residual** — `minted_at` is signed but nothing checks it against a now-window, so a genuine mint verifies forever. **Inert in SHADOW** (nothing gates); becomes exploitable when a value gates. Recorded as an explicit **P2 acceptance criterion**: the P2 consumer flip MUST enforce a freshness window OR policy re-run. Field plumbing (`minted_at`) reserved now.
- **F6 (LOW) / erratum:** the `minted_id` divergence from RFC §5.3 is recorded as an **erratum block appended to the RFC** (additive; the RFC is DRAFT, not yet accepted-immutable) — not silently diverged. Surfaced to the user.
- **I-1 (INFO):** the same-uid "Option-A-equivalent until P1" disclosure is **accurate, not an over-claim** (hacker verified: with `LOOM_EDGE_SIGNING_KEY` in env, a same-uid attacker reads the key and signs directly, bypassing the mint API — so `mintWeight`'s oracle defense is defense-in-depth, NOT the same-uid close; only P1 trust-domain separation closes it). Disclosure stays prominent.

### Regression baseline (hacker-probed)
Crypto primitive solid under direct probing: alg-pinning refuses RSA (sign→null/verify→false), fail-closed holds, canonical-base64 rejects whitespace/padding-tweaked sigs, type-coercion guards reject array/Buffer/number ids. Existing kernel `edge-attestation.test.js` 9/9 green; lab consumers import the 6 must-preserve exports by name → identity-aliases keep them verbatim.

## VALIDATE result (2026-06-19 — 3-lens board on the BUILT diff; ALL APPROVE-WITH-NITS, 0 blockers)

`code-reviewer` (correctness) + `hacker` (7 live probes, Rule 2a) + `honesty-auditor` (claim-vs-evidence). **No CRITICAL/HIGH, no must-fix-before-PR.** The hacker confirmed on the BUILT code: value-swap fix HOLDS, no `minted_id` second-preimage / canonical-json injection, a hand-planted forged `record-*.json` is **NOT** attestable (`readById` S5-re-hashes on read → policy resolves null → mint null), every sig-bypass fails-closed, identity aliases are the same fn objects, no proto-pollution, depth+width DoS bounds catch over-deep/over-wide. Honesty graded **A** — SHADOW empirically true (only the test imports the minter), oracle defense real not theater, all INV-MINT/F1-F6/H-1/H-2/M-1 genuinely implemented.

**Folded (cheap hardening, now in the build + tests, 22/22 minter + 12/12 edge):**
- **CR-1 (MEDIUM):** `out.basis == null` (was `=== undefined`) — a `basis:null` would sign a constant `basis_digest` attesting "kernel-minted" while reading nothing. Now rejected. (+test)
- **CR-3 (LOW):** `opts.now.trim().length > 0` — a whitespace-only `now` falls back to a real timestamp (else a P2 freshness check NaN-crashes). (+test)
- **hacker-H1 (MEDIUM):** `registerWeightPolicy` is **append-only** — re-registering an existing kind throws. Closes a latent P2 privilege-escalation (a co-loaded module silently re-pointing the kernel policy inside a key-holding process). Per-call overrides still use the `opts.policies` seam. (+test)
- **CR-2 / CR-4 (LOW):** added the `value===0` round-trip contract + a test exercising `makeKernelRecordPolicy({readById})`'s injected-reader DIP seam (justifies the export, locks the Option-C "inject the reader" guarantee).
- **honesty H1/H2 (LOW/INFO):** fixed the `minted_at-set`→`minter-set` header garble; widened the F5 comment to "depth- AND width-bounded".

**Deferred to P2 (correctly out of P0 scope):** M-1 / hacker-H4 (stale-mint replay — `minted_at` signed but freshness unchecked; named P2 acceptance criterion); hacker-H2 (the `opts.policies` escape hatch mints arbitrary values but is **moot** — gated behind key possession, defense-in-depth, matches the I-1 same-uid disclosure).

## Drift Notes

- route-decide scored `root` (0.15) but `[ROUTE-META-UNCERTAIN]` fired on `attestation`; overrode to `route` by judgment. This is the recurring substrate-meta catch-22 (already codified) — noting the recurrence, not a new gap.
- The RFC's literal `sig = signRecordId(basis_digest)` under-specifies the value binding (OQ-A). If the architect agrees `minted_id` is correct, the RFC interface (§5.3) should get a one-line erratum — surface to the user, do not silently diverge from the canonical RFC.
