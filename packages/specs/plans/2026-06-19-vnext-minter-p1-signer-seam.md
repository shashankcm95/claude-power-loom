# v-next minter P1 (step 1) — the signer-resolution seam (trust-domain interface freeze)

- **Status:** PLANNED → build
- **Scope:** authenticated-minter RFC P1, smallest-honest increment (USER-scoped 2026-06-19). SHADOW.
- **Branch:** `feat/vnext-minter-p1-signer-seam` (off `origin/main` `c40b2a2`)

## Goal

RFC P1 (§5.1/§7) = move the signing key out of the same-uid env into a trust domain the same-uid caller cannot `read()` — the Option-A→B step. Recon (2026-06-19) established: **(a)** P1 is buildable now (NOT ContainerAdapter-blocked — the broker is "independently shippable", OQ-1); **(b)** P1 is **purely additive** (one seam: `edge-attestation.js` `loadPrivateKey`/`signRecordId`); **(c)** the honest *containment vehicle* (broker / Docker, recompute-inside) is heavy + YAGNI until ③.2's gate.

**This wave = STEP 1 ONLY: freeze the Option-B INTERFACE.** Widen the sign seam from "resolve a PEM into the host process" to "resolve a SIGNER FUNCTION"; env-PEM stays the default; `opts.signer` overrides. Pure, additive, CI-safe, zero behavior change, **no theater**. The actual key-custody vehicle (a recompute-inside broker / Docker namespace) plugs in behind this seam at ③.2.

## What this is NOT (honest scope — no over-claim)

- **NOT** the key-custody move itself (no broker, no second uid, no Docker minter) — that's the ③.2-era vehicle.
- Does **NOT** close the same-uid co-forge: the default signer still reads the env PEM (Option-A-equivalent, unchanged). It makes the close **pluggable**.
- Does **NOT** unblock the beta gate: the OQ-3 basis-migration + the P2 flip are downstream; nothing gates a minted weight until ③.2.

## Runtime Probes (firsthand, recon 2026-06-19)

| Claim | Probe | Result |
|---|---|---|
| one sign-side key seam | grep callers of `signRecordId`/`signEdgeId` | CONFIRMED — `loadPrivateKey(opts)` at `edge-attestation.js:50-56` is the ONLY key-resolution point; 2 prod signers (`weight-minter.js:209`, `lesson-confirm.js:145`) funnel through it |
| additive (no call-site edits) | read both signers | CONFIRMED — both pass `opts` through; a new source behind the seam reaches both |
| verify side unaffected | read `verifyRecordSig` + consumers | CONFIRMED — P1 is sign-side-only; verify needs only the public key (ships); `signEdgeId`/`verifyEdgeSig` are IDENTITY aliases |
| nothing gates today | grep `verifyMintedWeight`/`mintWeight` consumers | CONFIRMED — zero production consumers; SHADOW |
| env fallback untested | read the 5 minter test files | CONFIRMED — every test injects `opts.privateKeyPem`; the `LOOM_EDGE_SIGNING_KEY` branch has NO coverage → this wave ADDS it |
| default sig is canonical base64 | ed25519 64-byte sig → `toString('base64')` round-trips | CONFIRMED → output-validation adds NO regression to the default path |

## Design (`edge-attestation.js`)

1. Add `resolveSigner(opts)` → a signer function `(hex64) -> base64 | null`, or `null` if no signer:
   - `typeof opts.signer === 'function'` → return it (the injected trust-domain vehicle: broker / namespace);
   - else → load the ed25519 PEM (`loadPrivateKey`, unchanged) → return a closure that `crypto.sign`s in-process (today's behavior, the default);
   - a non-function `opts.signer` is IGNORED → fall through to the PEM default (fail-safe).
2. Rewrite `signRecordId(recordId, opts)`: validate `isHex64(recordId)` **first** (preserves the input gate); resolve the signer; call it inside try/catch (an injected signer may throw → `null`); **validate the OUTPUT** via `isCanonicalBase64` (an injected signer is UNTRUSTED to return a well-formed sig) → else `null`. The default path is unchanged (a genuine ed25519 sig is canonical base64).
3. `signEdgeId = signRecordId` (identity alias) unchanged → the edge lane gets the seam too.
4. Update the header comment (`:8` "the private key stays in env — a future deployment precondition") → document the P1 seam: `opts.signer` routes signing into a trust domain the host cannot read; default = env-PEM (honestly Option-A-equivalent until a vehicle is injected at ③.2).
5. Export `resolveSigner` (the seam — for a future vehicle + tests).

## Security invariants the seam MUST preserve (the VALIDATE board checks these)

- **INPUT validation before the signer** (`isHex64`) — never hand an unvalidated id to an injected signer. The seam still signs only a HEX64 id; `mintWeight` still recomputes `minted_id`. The seam does NOT widen what gets signed → it is **not** an oracle. (The recompute-inside, so a caller can't get an arbitrary `minted_id` signed via a brokered oracle, remains the VEHICLE's job at ③.2 — documented, not regressed.)
- **OUTPUT validation** (`isCanonicalBase64`) — an injected signer can't emit garbage / non-canonical a lenient downstream mis-handles.
- **Fail-soft/closed preserved** — no signer → `null`; throwing signer → `null`; never throws.
- **Zero behavior change for the default (PEM/env) path** — every existing signer + the verify round-trip stays byte-identical.

## Tests (TDD — `edge-attestation.test.js`)

- default path (`opts.privateKeyPem`) round-trips (regression, unchanged).
- NEW: `opts.signer` (stub → valid base64) is USED; takes PRECEDENCE over `opts.privateKeyPem`.
- NEW: `opts.signer` receives the VALIDATED `recordId` (assert the arg).
- NEW fail-closed: `opts.signer` returns non-base64 / `''` / non-string → `signRecordId` `null`.
- NEW fail-soft: `opts.signer` throws → `null` (never throws).
- NEW: non-canonical base64 from `opts.signer` (whitespace-injected) → `null` (malleability gate).
- NEW: non-function `opts.signer` → falls through to the PEM default.
- NEW (closes the recon gap): the env default (`LOOM_EDGE_SIGNING_KEY`) signs + verifies (set+restore env within the test).
- NEW: `signEdgeId` alias honors `opts.signer`.

## Process

SHADOW kernel-security seam. Build TDD; **3-lens VALIDATE** (code-reviewer + hacker + honesty-auditor; the hacker re-probes the BUILT seam — can an injected signer become an oracle / bypass the output gate / fork verify?). Gate: full kernel suite + `install.sh --hooks --test`. PR for the USER merge.

## Build + VALIDATE result

Built TDD in an isolated worktree off `origin/main` `c40b2a2`. **Gate:** `install.sh --hooks --test` **125/0** · full kernel **81/81** · full lab **81/81** (the edge `signEdgeId` lane unaffected — a real ed25519 sig is 64 bytes, so the M1 output gate is a no-op for it). edge-attestation **21/21** (12 original + 9 P1 + the F1/M1 cases), weight-minter **30/30** (+ the H1 case).

**3-lens VALIDATE** (the hacker live-probed the BUILT seam per Rule 2a):

- **code-reviewer → PASS** (1 LOW, folded): the seam is correct + zero-regression — the `isCanonicalBase64` output gate is a confirmed no-op for the default ed25519 path; every invariant (alg-pinning, input-gate-before-signer, fail-soft, the identity aliases, verify byte-identical) preserved.
- **honesty-auditor → PASS / Grade A**: no overclaim — the SHADOW / Option-A-equivalent / interface-freeze-only framing is consistent across code, header, plan, and tests; every promised test exists in the transcript. (Flagged: the Runtime-Probe line-ref for `loadPrivateKey` decayed post-build — it now lives just below `resolveSigner`, not the pre-build `:50-56`; the claim holds, only the locator drifted.)
- **hacker → FLAG**, three folds taken:
  - **H1 (HIGH, latent — folded):** `mintWeight` forwarded `opts` WHOLE → a caller-injected `opts.signer` would DOWNGRADE the kernel key to a caller-chosen key (proven live; contained only because `mintWeight` has zero callers — SHADOW). Fix: `mintWeight` now allowlists the signer opts (`signRecordId(mintedId, { privateKeyPem: opts.privateKeyPem })`) — the minter's signer is kernel-owned, never caller-chosen (symmetric with F2/F3). JSDoc updated; H1 regression test added.
  - **M1 (MEDIUM — folded):** the output gate accepted any canonical base64, not the 64-byte ed25519 shape → a malformed injected signer could persist a dead "signed" record (safe direction, but a ③.2-broker footgun). Fix: the output gate now also requires the decoded sig to be exactly 64 bytes (emit↔verify symmetric); tests added.
  - **F1 (LOW — folded):** the exported `resolveSigner` default closure didn't self-guard `isHex64` → a direct caller bypassed `signRecordId`'s input gate. Fix: the closure self-guards `isHex64`; test added.

**Net:** the seam is built, green, backward-compatible, and the folds closed the one real (latent) downgrade the seam introduced at the `mintWeight` boundary. The honest scope is unchanged: P1-step-1 freezes the Option-B interface in SHADOW; it does NOT close the same-uid co-forge (default still env-PEM) and gates nothing — the recompute-inside broker/Docker vehicle is the ③.2 step this unblocks.

**Status: VALIDATED — build-ready for the USER merge gate.**
