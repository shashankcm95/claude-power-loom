# Plan — PR-A2b W2a: edge-id relocation + `loom-edge-bind` recompute-inside (the security core; SHADOW)

/ lifecycle: persistent (per-wave plan; accretes VERIFY/VALIDATE/CodeRabbit records)

## Context

PR-A2b W1 (#463, merged) widened the edge-store signer to `opts.signer(edge_id, edgeBody)`. W2 builds the cross-uid edge broker (Vehicle B). To keep the security-dense surface reviewable, W2 is split:

- **W2a (this wave) — the security core:** relocate the canonical `deriveWorldAnchorEdgeId` recipe to a shared `kernel/_lib` module (so the kernel broker can recompute it without importing lab — the W1-flagged carry), and build `loom-edge-bind.js`, the **recompute-inside WHAT gate** that re-derives the edge_id from the presented body and refuses unless it `===` the caller-asserted basis. This closes the sign-arbitrary-64-hex oracle.
- **W2b (next) — the transport:** `loom-edge-sign.js` (key-holder CLI) + `crossUidLoomEdgeSigner` launcher (reusing the exported `crossUidSudoArgs`) + the one-arg→`(basis,ctx)` adapter + `loom-edge-custody-verify` twin.

SHADOW throughout: `loom-edge-bind` has no production caller until W2b wires the sign CLI; production auto-mint still passes `edgeSigner: undefined`.

## The W1-flagged carry this wave resolves (the kernel↛lab constraint)

`loom-edge-bind` lives in `kernel/egress/` and must reproduce `deriveWorldAnchorEdgeId` EXACTLY, but that fn lives in the lab store, and the shadow-import-graph dam (`shadow-import-graph.test.js`, the `EDGE_IMPORT_RE` matcher) **forbids any module outside `packages/lab/world-anchor/` from importing `world-anchor-edge-store`** (probed firsthand). Decision: **move the canonical recipe to a shared `kernel/_lib` module** (option (a) from the W1 plan) — single source of truth, byte-parity by construction (NOT a re-implementation + parity test). `lab → kernel/_lib` is the legal direction (the store already imports `kernel/_lib/canonical-json`); `kernel/egress → kernel/_lib` is intra-kernel. The dam is satisfied (the bind imports `kernel/_lib`, never the lab store basename).

## Files

| File | Change | ~LoC |
|---|---|---|
| `packages/kernel/_lib/world-anchor-edge-id.js` (**NEW**) | the relocated canonical recipe: `deriveWorldAnchorEdgeId(rec) = sha256hex(canonicalJsonSerialize([from_node_id, to_delta_ref, edge_type]))` (null→'' coerced, String-wrapped — verbatim from the store), internal `sha256hex`, imports `canonicalJsonSerialize` from `./canonical-json`. Exports `deriveWorldAnchorEdgeId`. Header notes it is the ONE canonical edge-id seal, imported by BOTH the lab store (writer/verifier) and the kernel edge-bind (recompute) so they cannot drift. | ~30 |
| `packages/lab/world-anchor/world-anchor-edge-store.js` | remove the local `deriveWorldAnchorEdgeId` + `sha256hex` defs; `require` `deriveWorldAnchorEdgeId` from `../../kernel/_lib/world-anchor-edge-id`; **re-export it unchanged** (`module.exports` keeps `deriveWorldAnchorEdgeId` so the store's public API + every existing test are stable). Remove the now-unused `const crypto = require('crypto')` IF `sha256hex` was its only use (probe: confirm no other `crypto.*` in the store before removing — else eslint `no-unused-vars` fails). | ~ -18 |
| `packages/kernel/egress/loom-edge-bind.js` (**NEW**) | the recompute-inside WHAT gate, mirroring `loom-broker-bind.js` but simpler (one derive, no hash→basis two-step, no freshness fields). `CTX_KEYS = ['from_node_id','to_delta_ref','edge_type']`; `validateCtxShape` (exact-3-key, never coerce: from_node_id + to_delta_ref are lowercase-HEX64, edge_type a non-empty string); `authorizeRequest({claimedBasis, presentedCtxRaw})` → parse ctx, shape-gate, `recomputed = deriveWorldAnchorEdgeId(ctx)`, **deny unless `recomputed === claimedBasis`** (`basis-mismatch`); a deny NEVER carries `basisToSign` (null). Imports `deriveWorldAnchorEdgeId` from `../_lib/world-anchor-edge-id`. | ~85 |

## The bind contract (mirrors `loom-broker-bind.authorizeRequest`)

- Input: `{ claimedBasis }` (the argv edge_id, HEX64) + `{ presentedCtxRaw }` (the stdin JSON body `{from_node_id, to_delta_ref, edge_type}`).
- Output: `{ decision: 'allow'|'deny', reason, basisToSign }`. `allow` → `basisToSign = recomputed` (`=== claimedBasis` by the gate; sign the RECOMPUTE, never the argv claim). `deny` → `basisToSign: null`, fail-closed.
- Deny reasons (each fail-closed): `claimed-basis-not-hex64`, `no-ctx-presented`, `ctx-unparseable`, `ctx-not-an-object`, `ctx-shape-mismatch` (missing/extra key), `from_node_id-not-hex64`, `to_delta_ref-not-hex64`, `edge_type-not-nonempty-string`, `basis-uncomputable` (canonical serializer throws), `basis-mismatch`.
- **HONEST SCOPE (mirror broker-bind's NS-9 note):** the recompute binds ctx↔basis CONSISTENCY (the signer won't sign a 64-hex with no matching `{from,to,type}` preimage), it does NOT prove `from_node_id` is a genuinely world-anchored node — that is the PR-B weight-minter's full-tuple commitment (scope §8.6). Document this in the header so it is not over-read as the close.

## Why the edge bind is SIMPLER than the broker bind

The broker recomputes a TWO-step `computeEmissionHash(body)` then `approvalSigBasis({hash, approvedAt, nonce, key_id, lesson_commitment})` (5 freshness/binding fields). The edge id is a ONE-step `deriveWorldAnchorEdgeId({from,to,type})` over a 3-field positional array — no freshness, no hash-of-hash. So `loom-edge-bind` has one recompute and a 3-key shape gate. **The shape gate + per-field checks are LOAD-BEARING, not stylistic (VERIFY F1/F2):** the derive ignores extra keys, so a bare `recomputed === claimedBasis` is bypassable by an extra-key ctx (it recomputes to the same id) — the exact-3-key `keys.length + every-hasOwnProperty` gate is the real defense; and a non-hex `from_node_id` / number `edge_type` String-coerce through the derive to a valid hex, diverging the signable-id space from the store-acceptable space — the per-field `HEX64` / non-empty-string checks close that. Pinning `edge_type` to the literal `'world-anchored-by'` is deliberately NOT done (it would duplicate the lab `WORLD_ANCHOR_EDGE_TYPE` one-way-door set into the kernel; the non-empty-string check + the recompute bind the exact value).

## Tests (TDD-treatment — security core; write the deny/allow contract first, run red, then implement)

1. **`tests/unit/kernel/_lib/world-anchor-edge-id.test.js` (NEW)** — `deriveWorldAnchorEdgeId` produces a lowercase HEX64; **byte-parity**: a known `{from,to,type}` hashes to the SAME value the lab store produced pre-move (pin a hardcoded expected digest so a future recipe change is a deliberate test-break); null/undefined fields coerce to `''`; key-order-insensitive (positional array). 
2. **`tests/unit/kernel/egress/loom-edge-bind.test.js` (NEW)** — mirror `loom-broker-bind`'s test: ALLOW on a matching ctx (`basisToSign === claimedBasis`, decision allow); **DENY (non-vacuous, the security core) on `basis-mismatch`** — a ctx with a forged `from_node_id` (or swapped `to_delta_ref`) whose recompute ≠ the claimed edge_id → deny + `basisToSign:null` (inject the mismatch, watch it deny RED, then confirm a matching ctx allows); DENY on each shape miss (4-key ctx, missing key, extra key, non-HEX64 from/to, non-string/empty edge_type, unparseable JSON, empty/absent ctx, non-hex claimedBasis). Assert a deny NEVER carries a non-null `basisToSign`.
3. **Lab regression sweep:** `world-anchor-edge-store.test.js` (the re-exported `deriveWorldAnchorEdgeId` still drives every existing test green) + `world-anchor-mint.test.js` + `item5-merge-edge-wire.test.js` + `shadow-import-graph.test.js` (the dam still passes — the bind imports `kernel/_lib`, not the store) + the full kernel suite.

## Drift gates (MANDATORY this wave — 2 NEW `.js` modules)

- **`node scripts/generate-signpost.js --check`** — 2 new modules (`kernel/_lib/world-anchor-edge-id.js`, `kernel/egress/loom-edge-bind.js`) → CI Test 121 SIGNPOST-drift FAILS unless the signpost is regenerated. Run `generate-signpost.js` (no `--check`) to update, then `--check` to confirm. **Do this before push.**
- eslint clean (esp. the removed `crypto` import in the store — confirm no other use), ASCII-only, zero eslint-disable.
- release-surface `--check` (docs/new-module push).

## Out of scope (W2b / later)

- `loom-edge-sign.js` (key-holder CLI — drains ctx, WHO gate, calls `loom-edge-bind` as the WHAT gate, opens the EDGE key with the `& 0o077` owner-only vet, signs via `signEdgeId`), `crossUidLoomEdgeSigner` launcher (reuse the exported `crossUidSudoArgs`), the `(edge_id, edgeBody)→sign(basis,ctx)` adapter (NOT a blind passthrough — routes through this bind), `loom-edge-custody-verify` twin (C3 signs a probe EDGE_ID, verifies via `verifyEdgeSig`). The arming flag + deploy helper + runbook = W3. Deployment + attestation = operator.

## Runtime probes (verified firsthand, 2026-06-29)

- `Probe: grep crossUidSudoArgs export → ` `module.exports = { crossUidLoomBrokerSigner, crossUidSudoArgs, USERNAME_RE }` — generic + exported, reusable by the W2b edge launcher.
- `Probe: shadow-import-graph.test.js → ` `EDGE_IMPORT_RE` forbids any module outside `lab/world-anchor/` importing `world-anchor-edge-store` — CONFIRMS kernel↛lab for the derive → relocation required.
- `Probe: ls kernel/_lib | grep edge → ` only `edge-attestation.js` (the sig primitives); no edge-id helper exists → `world-anchor-edge-id.js` is net-new.
- `Probe: read loom-broker-bind.js → ` the exact mirror: `validateCtxShape` exact-key + per-field type gate, `authorizeRequest` recompute-and-`===`-gate, deny carries `basisToSign:null`.
- `Probe: grep deriveWorldAnchorEdgeId → ` defined once (store :109), used at store :160/:218/:327/:431, exported at :463. Moving it + re-exporting keeps all call sites + tests stable.

## Drift notes

- Security-dense (the recompute that closes the sign-arbitrary-64-hex oracle) → full per-wave board rhythm (3-lens VERIFY + 3-lens VALIDATE with a hacker re-probe that builds a live `basis-mismatch` attempt against the BUILT bind) despite `route-decide → root` (substrate-meta lexicon miss; Rule 2 mandates the tier for an auth-adjacent diff).
- The relocation is a pure refactor (byte-identical derive); its risk is an import/export miss or the unused-`crypto` eslint trip — both caught by the regression sweep + eslint.

## Verification

- 3-lens VERIFY (architect + hacker + honesty) on this plan BEFORE build.
- Delegated TDD build (node-backend, isolation:worktree).
- 3-lens VALIDATE (Rule 2a) on the built diff — hacker builds a live probe: a forged-body ctx must `basis-mismatch` deny (non-vacuous); the relocated derive byte-matches; the dam still green.
- signpost regenerated; CodeRabbit pre-PR + post-PR fold.

## VERIFY board folds (hacker SHIP + honesty SHIP; architect lens re-run separately — build directives, authoritative)

The board ran 10 live probes against the real derive + a faithful shape-gate reimplementation. SHIP, 0 CRITICAL. The findings SHARPEN the security framing — fold all:

- **F1 (hacker HIGH) — the exact-3-key shape gate is LOAD-BEARING, NOT redundant.** `deriveWorldAnchorEdgeId` reads ONLY the 3 named positional props and SILENTLY IGNORES extra keys — probed: `derive({from,to,type}) === derive({from,to,type,EVIL:'x'})`. So an extra-key ctx recomputes to the SAME edge_id and would pass `recomputed === claimedBasis`. **Port `loom-broker-bind.js:48-51`'s `keys.length !== CTX_KEYS.length || !CTX_KEYS.every(hasOwnProperty)` check VERBATIM** (it also rejects `__proto__`/`constructor` as own-enumerable → length-4 → mismatch). **Re-frame the plan's "Why simpler" section: the shape gate is the load-bearing defense, do NOT document it as redundant/stylistic.** Test: extra-key→deny AND missing-key→deny as non-vacuous RED.
- **F2 (hacker MEDIUM) — per-field checks are REQUIRED for soundness, not stylistic.** A non-hex `from_node_id` (`'../../etc/passwd'`) String-coerces through the derive to a valid 64-hex (probed), and `edge_type:123` derives identically to `'123'` (probed). Without the per-field gate the signable-id space DIVERGES from the store-acceptable space (the store gates `isHex64` on write/read). **Port all three: `from_node_id`/`to_delta_ref` `typeof===string && HEX64.test`; `edge_type` `typeof===string && length>0`.** Add a **number-valued `edge_type` deny test** (the number-vs-string flip the broker suite probes).
- **F3 (hacker MEDIUM + honesty LOW) — byte-parity test: import the serializer + pin the exact digest, multiple vectors.** The byte-parity test MUST (a) `require` `canonicalJsonSerialize` from `./canonical-json` (NOT reimplement); (b) pin the HARDCODED digest captured from the current store: `from='a'.repeat(64), to='b'.repeat(64), type='world-anchored-by'` → `8a238c9d201c0cb373c06dc1effed63466fe202694187104a3af163a6adfa028`; (c) keep null→'' + `String()` coercion verbatim; (d) add ≥1 more input vector (not just the one).
- **F4 (hacker LOW) — fail-closed ordering + the crypto removal.** In `loom-edge-bind.authorizeRequest`, gate `isHex64(claimedBasis)` FIRST (`claimed-basis-not-hex64`) before touching the ctx — mirror `loom-broker-bind.js:75-107`. After moving `sha256hex`, remove the store's now-unused `const crypto = require('crypto')` (`:47`) — confirmed `crypto.*` is used ONLY by `sha256hex` (`:90`); else `no-unused-vars` fails (ADR-0006). Run `generate-signpost.js` (2 new modules) before push.
- **F5 (honesty MEDIUM) — the deny-reason set's source of truth is the TEST, not the plan prose.** Two reasons were renamed from the broker mirror (`nonce-not-nonempty-string` → `from_node_id-not-hex64`, etc.). The `loom-edge-bind.test.js` enumeration is authoritative; ensure the test asserts the FINAL deny-reason for each path (so a future reader trusts the test, not the prose).
- **(honesty LOW, no code fold) — scope-doc §3 staleness:** the scope doc still describes the PRE-W1 one-arg signer contract. Out of W2a scope (the builder works from THIS plan), but refresh the scope doc §3 to the two-arg post-W1 shape opportunistically so it doesn't mislead.

**Architect lens (SHIP, doubly-confirmed — design folds, all LOW):**

- **F6 (architect) — mark the re-export as a single-source seam at the store's `module.exports`.** A bare re-export invites a future reader to treat the store as the canonical home again (the drift the relocation removes). Add a one-line comment at the store's `deriveWorldAnchorEdgeId` export marking it a RE-EXPORT of the `kernel/_lib/world-anchor-edge-id` canonical (with the path) — "external consumers import it from here; do not drop."
- **F7 (architect) — `loom-edge-bind`'s no-caller SHADOW status is prose/review-asserted until W2b (deliberate choice).** Unlike the lab store's functions (the dam structurally asserts zero production callers), there is no structural pin that `loom-edge-bind.authorizeRequest` stays uncalled. This MIRRORS `loom-broker-bind` (which has a real caller, `loom-broker-sign`, and no such assertion) — so it is not a regression. **Decision: accept prose-only SHADOW for the bind this wave** (W2b lands the sole caller, `loom-edge-sign`, in the same arc); note it explicitly in the bind header. No zero-caller test this wave.
- **F8 (architect) — the new module's internal `sha256hex` is local by design.** Header note: "internal `sha256hex` is local (the deliberate-duplication-for-independent-auditability convention); do not consolidate" — so a future reader does not couple the id-seal to an unrelated shared-crypto change.
- **F9 (architect, NEW) — name the bind-accept ≠ store-accept asymmetry in the bind header.** The bind accepts ANY non-empty `edge_type` string (the deliberate no-pin decision), but the lab store gates exact membership (`WORLD_ANCHOR_EDGE_TYPE.includes`, i.e. `'world-anchored-by'` only). So a bind-ALLOWED edge over a different type would be REFUSED at store write/read — **bind-allow does NOT guarantee a persistable edge.** Harmless under SHADOW (no caller), but the bind header MUST state this scope boundary (the bind binds ctx↔basis CONSISTENCY; the lab store remains the edge-type-set authority) so a W2b integrator does not assume bind-allow ⇒ persistable. Distinct from the HONEST-SCOPE (from_node_id-provenance) note.

## Build + VALIDATE result (3-lens, Rule 2a — built diff in worktree `agent-a2874fd4f1bfe3e34`)

Delegated TDD build (node-backend, isolation:worktree, agentId `a2874fd4f1bfe3e34`; did NOT crash). TDD red (MODULE_NOT_FOUND) → green. 2 new kernel modules (`kernel/_lib/world-anchor-edge-id.js` 47L, `kernel/egress/loom-edge-bind.js` 97L) + store edit (-24/+16: removed the local derive + `sha256hex` + the now-orphaned `crypto` AND `canonical-json` imports — both probed unused; re-exports the relocated fn with the F6 comment) + 2 new test suites + SIGNPOST. **All F1-F9 implemented** (verified firsthand in the built `loom-edge-bind.js`: claimedBasis-first, exact-3-key gate, strict no-coerce per-field, recompute-from-single-source `===`-gate, deny-null-basis, the 3 header scope notes). Orchestrator firsthand-verified (Rule-2a): node --check clean; the re-export produces the EXACT pinned digest `8a238c9d…adfa028` (relocation byte-identical); `crypto`/`canonicalJsonSerialize` genuinely unused (only prose comments remain); edge-id 6 / loom-edge-bind 15 / edge-store 42 / mint 29 / item5 6 / shadow-import-graph 15 / **kernel 110 files 0 failed**; eslint exit 0; signpost up to date.

**3-lens VALIDATE: SHIP / SHIP / SHIP**, 0 CRITICAL/HIGH/MEDIUM.

- **code-reviewer** SHIP, 0 findings — relocation byte-identical, re-export correct, removed imports unused, `loom-edge-bind` a faithful mirror, tests non-vacuous.
- **hacker** SHIP — 20+ live Rule-2a probes + a **5000-iteration randomized sweep** (exactly 2500 allows, ZERO where `basisToSign` ≠ the real recompute or `claim` ≠ real); F1 extra-key collision is real at the derive but the exact-key gate DENIES it; F2 coercion (number/non-hex) all DENY; basis-mismatch denies null-basis; claimedBasis-first proven; byte-parity to the pin + byte-identical to the pre-relocation recipe across 6 exotic vectors (0 mismatches); the dam holds (bind imports `kernel/_lib`, not the store); prototype-pollution / duplicate-key / regex-anchor / whitespace-pad protocol abuse all DENY. 3 LOW (no W2a change).
- **honesty** SHIP — 2 LOW (no W2a change): F7 SHADOW-no-caller is prose/review-asserted (the architect's deliberate choice, mirrors loom-broker-bind); the `basis-uncomputable` guard is unreached on a validated ctx (genuinely unreachable post-shape-gate — a defensive total-contract catch, mirrors the broker bind's identical guard; accepted, not forced-vacuous).

No VALIDATE folds required. Drift gates green (signpost regenerated, eslint, ASCII).

**W2b carries (from VALIDATE — acceptance criteria for the sign caller):**
- (hacker LOW1) **`loom-edge-sign.js` MUST drain stdin with a BOUNDED + DEADLINED reader** — mirror `loom-broker-sign.js`'s `readStdinBounded({maxBytes, deadlineMs})`, scaled tight (the edge ctx is ~200 bytes → a ~16 KiB cap matching the lab store's `MAX_EDGE_BYTES`), NEVER an unbounded `fs.readFileSync(0)`. The pure bind has no length bound (template-consistent — the bound lives in the caller); a 50 MB `edge_type` hashes in ~200ms today, so an unbounded reader would open a DoS. Re-probe the real stdin path at W2b VALIDATE (a mocked-stdin unit suite won't catch an unbounded real read).
- (hacker LOW2) no downstream consumer may read bind-ALLOW as a persistence/validity verdict (the store's verify-on-read is the sole "is this a real world-anchored-by edge" authority); optionally narrow the bind's `edge_type` to the closed set if the bind ever gates a decision beyond "what to sign."

## CodeRabbit pre-PR fold (1 Major, premise-probed + folded — the 12th straight wave CodeRabbit complemented the board)

`coderabbit review --base main` on the secret-free tree (BEFORE the PR opened) returned 1 Major (Security): **freeze the exported shape policy.** `CTX_KEYS` in `loom-edge-bind.js` is exported AND is the fail-closed authorization policy (`validateCtxShape` keys against it), but the exported array was MUTABLE — an in-process consumer could `CTX_KEYS.push('x')` and a 4-key forged ctx would then pass the length + every-hasOwnProperty gate (a runtime policy-widening / authorization-bypass vector). Premise-probed: confirmed `CTX_KEYS` is the only mutable-policy export (the new `world-anchor-edge-id.js` exports only a function). Folded: `const CTX_KEYS = Object.freeze([...])` (no behavior change) + a non-vacuous test (`Object.isFrozen` + a `push` throws + length stays 3). 15 edge-bind tests green, eslint exit 0.

**Sibling (extend-the-fix discipline):** the LIVE broker `loom-broker-bind.js:28` has the IDENTICAL pre-existing unfrozen-exported-`CTX_KEYS`. NOT folded here (it's a live egress module, pre-existing, out of W2a's edge scope) — flagged via a spawn_task for its own focused 3-lens hardening PR. (W2a stays scoped to the edge; the sibling is tracked, not ignored.)

**Post-PR bot fold (1 Major, premise-probed + folded — `e1f637d`→fold commit):** the post-PR CodeRabbit bot posted 1 NEW Major (Stability) at `loom-edge-bind.js:97`: **fail closed when `authorizeRequest` receives `null`.** The `opts = {}` default only catches `undefined`, so `authorizeRequest(null)` threw a TypeError (probed firsthand) instead of fail-closed denying — a fail-closed gate must not crash. Folded: normalize a null / non-object / array opts to `{}` at the top (`const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {}`; mirrors `world-anchor-mint.js`), so a bad call DENIES `claimed-basis-not-hex64`. Non-vacuous test added (`doesNotThrow` + denies on null/non-object/array). 16 edge-bind tests green. The broker sibling `loom-broker-bind` has the SAME null-throw → added to the broker hardening tasks (non-overlapping with the started CTX_KEYS task). All 11 CI checks (incl CodeRabbit) were green on the pre-fold commit; the fold push re-triggers them.
