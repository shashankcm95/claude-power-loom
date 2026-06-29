# Plan — OQ-3 W2: the approval-layer binding (kernel + the broker sign/verify; SHADOW, weight-inert)

- **Date:** 2026-06-29
- **RFC:** [`2026-06-29-oq3-kernel-seal-lesson-provenance.md`](../rfcs/2026-06-29-oq3-kernel-seal-lesson-provenance.md) (Rev 2). This is **W2 of 3** — the highest-rigor wave (kernel + the cross-uid broker sign/verify path).
- **Predecessor:** W1 (#459, merged) — `computeLessonCommitment` + an always-a-string `lesson_commitment` from `captureLiveLesson` + the capture-before-emit reorder.
- **Scope:** kernel egress. **SHADOW + weight-inert**: no consumer reads the binding for a weight (`LIVE_SOURCES` stays `Object.freeze([])`); the live loop is still unarmed (RFC §6 activation residual), so the seal does not reach a real join-key/approval yet. W2 binds the lesson into the broker-signed approval so a later authenticated minter can verify it.

## Goal

Bind `lesson_commitment` into the broker-signed egress approval so a **post-approval lesson swap** is refused: a same-uid process that hands `emitPR` a `lesson_commitment` the human + broker did not approve fails closed (`lesson-commitment-mismatch`), and an in-place edit of the persisted commitment breaks the broker sig (`sig-invalid`). The diff stays committed by `computeEmissionHash`; the lesson rides as approval-layer data the broker signs **alongside** the emission (RFC §4: NOT inside `computeEmissionHash` — the emission Forward-Contract stays byte-identical).

## Runtime probes (verified firsthand, 2026-06-29 — the RFC's §5.3 named 4 modules; recon found 6)

The basis the broker signs is `approvalSigBasis({hash, approvedAt, nonce, key_id})`. Extending it to include `lesson_commitment` ripples through **every** site that re-derives it. Probed all callers:

- `grep approvalSigBasis packages/ --include=*.js` (non-test) → **4 production re-derive/define sites**:
  - `approval.js:74` (definition), `approval.js:116` (`verifyApproval` re-derive).
  - `approval-store.js:118` (`recordApproval` sign basis).
  - **`loom-broker-bind.js:91`** — the cross-uid broker's WHAT-gate (`authorizeRequest`) **recomputes** the basis and requires `recomputedBasis === claimedBasis`, with an **exact-shape** ctx gate `CTX_KEYS = ['emission','approvedAt','nonce','key_id']` (`loom-broker-bind.js:27,48` — `keys.length !== CTX_KEYS.length` → `ctx-shape-mismatch`). **Probe:** read `authorizeRequest` → extending the basis host-side WITHOUT updating the broker makes `recomputedBasis` (4-field) `!==` the host `claimedBasis` (5-field) → **every real sign denies `basis-mismatch`**, and the new ctx field trips `ctx-shape-mismatch` first. This module is **load-bearing W2 scope** the RFC omitted (same class as the architect-HIGH that caught `approval-store.js` in the RFC board).
  - **`loom-custody-verify.js:155`** — the C3 live-sign custody probe (`gatherCustodyFacts`) builds the same `ctx`/`basis` and asks the broker to sign. **Probe:** read C3 → unchanged, it would present a 4-field ctx/basis to the now-5-field broker → `ctx-shape-mismatch` deny → custody reports broken. Must add `lesson_commitment: ''` to the probe ctx + basis.
- `loom-broker-client.js` (the host-side `signFn(basis, ctx)`) is **ctx-agnostic** — it `JSON.stringify(ctx)` wholesale onto the broker child's stdin (`loom-broker-client.js:74`). **No change** (it forwards whatever ctx `recordApproval` hands it; the broker re-validates).
- `emitPR` ignores an unknown data field today (W1 probe, still true): `assertDataIsPolicyFree` (`emit-pr.js:192-201`) rejects only `DISPOSITION_KEYS`; `lesson_commitment` is **not** one → it passes. W2 adds a positive shape-gate (64-hex-or-empty) and threads it.
- **Layer probe:** `approve-cli.js` is `@loom-layer: kernel` (`packages/kernel/egress/`); the W1 `computeLessonCommitment` is `@loom-layer: lab` (`packages/lab/causal-edge/lesson-commitment.js`). A kernel→lab import is a **layer violation**. `approve-cli` must compute the commitment from the lesson it renders (sign-what-you-see), so the helper must be **kernel-tier**. Probe (CORRECTED by the VERIFY board — the first count undercounted): **3 importers** of the W1 lab helper, not 2: `packages/lab/persona-experiment/live-draft-run.js:33`, `tests/unit/lab/causal-edge/lesson-commitment.test.js` (the relocating test), AND `tests/unit/lab/persona-experiment/live-draft-run.test.js:500` (used at :533/:553/:557). The delete+repoint MUST touch all three atomically (the lab suite is a pre-push gate) — **re-run the grep in the build before deleting** to confirm no 4th site.
- **No standing-approval corpus** (RFC §6 forward-contract churn): 24h TTL, no `.approved` files persisted on disk → changing the basis content-address breaks nothing standing. Probe: the custody approvals dir is host-deploy-only, empty in-repo.

## The lesson-commitment helper moves kernel-ward (recon finding — the RFC said "approve-cli records it" but not WHERE the recipe lives)

The security-critical commitment recipe must live **once** (W1's whole rationale). W2 reveals **both** layers compute it: lab capture (`captureLiveLesson`) and kernel approval (`approve-cli`, sign-what-you-see). So the single source must be kernel-tier (lab → kernel is legal; kernel → lab is not).

- **NEW `packages/kernel/_lib/lesson-commitment.js`** — the helper, verbatim from the W1 lab file (`computeLessonCommitment({lesson_signature, lesson_body})` → `sha256(canonicalJsonSerialize({lesson_signature, lesson_body}))`; STRICT — throws on a non-non-empty-string input). It belongs in `_lib` next to `canonical-json.js` (a pure content-address primitive, like `computeEmissionHash`).
- **`packages/lab/causal-edge/lesson-commitment.js`** → repoint: `packages/lab/persona-experiment/live-draft-run.js` imports from the kernel path; **delete** the lab file (no indirection) OR leave a 1-line re-export `module.exports = require('../../kernel/_lib/lesson-commitment')` (lower churn). **Decision: delete + repoint** (a security-critical single-source should be indirection-free; the re-export is the fallback if the board prefers minimal churn).
- **Move the test** `tests/unit/lab/causal-edge/lesson-commitment.test.js` → `tests/unit/kernel/_lib/lesson-commitment.test.js` (repoint the import; keep the frozen known-vector `9553275e3e16e84a850d3a8b9b323e9554d2e8fa95740739e983d7c33e3f77d4`).
- **Signpost:** a new kernel `.js` → `node scripts/generate-signpost.js` (CI Test 121); a deleted `.js` is also a signpost delta.

## The always-a-string / undefined-footgun invariant (RFC §5.1, board hacker MEDIUM — load-bearing)

`canonicalJsonSerialize` emits the literal token `undefined` for an `undefined`-valued key (`canonical-json.js:53`), so `undefined`, `''`, and key-absent are **three distinct basis strings**. The basis function is the single chokepoint: it **coerces `undefined` → `''`** and **throws on any other non-string** (a loud bug, never a silent third basis). Acceptance: `approvalSigBasis({...lesson_commitment: undefined})` `===` `approvalSigBasis({...lesson_commitment: ''})`. The data/store/CLI boundaries additionally shape-gate **64-hex-or-empty** so a malformed value never reaches the basis.

## Files (production)

### 1. `packages/kernel/egress/approval.js`

- **`approvalSigBasis`** — extend to `({ hash, approvedAt, nonce, key_id, lesson_commitment })`. Coerce: `const lc = lesson_commitment === undefined ? '' : lesson_commitment; if (typeof lc !== 'string') throw new Error('approvalSigBasis: lesson_commitment must be a string (64-hex or empty)');` then hash over `canonicalJsonSerialize({ hash, approvedAt, nonce, key_id, lesson_commitment: lc })`. (Key order is irrelevant — canonical-json sorts.)
- **`verifyApproval`** — add `requestedLessonCommitment` to the param object. The check goes **immediately after the `body.hash === requestedHash` check (`:103`), BEFORE the body-hash re-derive (`:110`) and BEFORE the sig verify (`:115-117`)** (VERIFY-hacker HIGH — order is load-bearing):
  - coerce **only the request**: `const reqLC = requestedLessonCommitment === undefined ? '' : requestedLessonCommitment;` (a non-string request → fail-closed `no-requested-lesson-commitment`).
  - require `typeof body.lesson_commitment === 'string'` **as a DISTINCT reason** (`no-body-lesson-commitment`) so a legacy/absent body is distinguishable from a swap. **Do NOT coerce the body field** — the body must carry a real string (only the *request* is coerced).
  - then `body.lesson_commitment === reqLC` else **`{ ok: false, reason: 'lesson-commitment-mismatch' }`** (the new observable fail-closed reason, mirroring `hash-mismatch`). Because this runs BEFORE the sig verify, a swapped commitment returns the precise `lesson-commitment-mismatch`, never the generic `sig-invalid`.
  - fold `body.lesson_commitment` into the re-derived basis (`:116`): `approvalSigBasis({ hash: body.hash, approvedAt: body.approvedAt, nonce: body.nonce, key_id: body.key_id, lesson_commitment: body.lesson_commitment })`. (A same-uid forger who edits BOTH the persisted body AND hands emit-pr the matching `requestedLessonCommitment` passes the equality check but then fails `sig-invalid` — the old sig does not cover the edited value. This is the ordinary same-uid co-forge path, fail-closed only because the forger lacks the broker key — the standing OQ-NS-6 cross-uid caveat; W2 NARROWS, does not close it.)
  - **return the verified body on success:** `return { ok: true, body };` (W3 needs `sig/approvedAt/nonce/key_id` to persist the provenance bundle; **emit-pr keeps reading only `appr.ok` in W2 — no W2 reader of `appr.body`**). The returned body is the VERIFIED-on-read body (post sig-check), so it is integrity-checked and safe for W3 to persist. This changes the success return shape `{ok:true}` → `{ok:true, body}` — additive (the existing approval.test.js asserts via `.ok`/`.reason` field access, so no rewrite there; only a `deepStrictEqual({ok:true})` would regress).

### 2. `packages/kernel/egress/approval-store.js`

- **`recordApproval`** — add `lesson_commitment` to the opts destructure (`:95`). Coerce + shape-gate: `const lc = lesson_commitment === undefined ? '' : lesson_commitment; if (!(lc === '' || HEX64.test(lc))) throw ...` (HEX64 already defined `:30`). Thread into:
  - the basis (`:118`): `approvalSigBasis({ hash, approvedAt, nonce, key_id: keyId, lesson_commitment: lc })`.
  - the **signFn ctx** (`:119`): `signFn(basis, { emission, approvedAt, nonce, key_id: keyId, lesson_commitment: lc })` — **this is what the broker recompute needs** (else `ctx-shape-mismatch`).
  - the persisted body (`:132`): `{ hash, emission, approvedAt, nonce, sig, key_id: keyId, lesson_commitment: lc }`.
  - the mint-boundary `verifyRecordSig` (`:128-131`) already verifies over `basis` (now extended) — no extra change.
- **`readVerifiedApproval`** — add `requestedLessonCommitment` to opts (`:56`), thread into `verifyApproval({ ..., requestedLessonCommitment })` (`:72`). It already returns `verifyApproval`'s result → now carries `body` on success (the W3 consumer).

### 3. `packages/kernel/egress/emit-pr.js`

- Add `assertSafeLessonCommitment(v)` (a PURE shape-gate near `assertSafeIssueRef`): coerce absent/undefined → `''`; accept `'' | /^[a-f0-9]{64}$/`; **throw** on any other (a present-but-malformed commitment is an influence attempt — fail-closed, not silent). Return the coerced string.
- In `emitPR` step 1 (after `assertEgressSafeDiff`): `const lessonCommitment = assertSafeLessonCommitment(data.lesson_commitment);`. (`lesson_commitment` is NOT a `DISPOSITION_KEY` → passes `assertDataIsPolicyFree`; confirm a test asserts it stays OUT of `DISPOSITION_KEYS`.)
- Thread into the read gate (`:455`): `readVerifiedApproval(opts.custodyApprovalsDir, approvalHash, { now, ttlMs, selfUid, verifyKeyPem, requestedLessonCommitment: lessonCommitment })`.
- **No** join-key change in W2 (that is W3 §5.4). `computeEmissionHash`/the draft/the emission Forward-Contract are **untouched** (§4).

### 4. `packages/kernel/egress/approve-cli.js`

- Import `computeLessonCommitment` from the **kernel** `_lib` (post-move). The draft JSON may optionally carry `lesson_signature` + `lesson_body` (the lesson the operator reviews).
- `validateDraft` — if `lesson_signature`/`lesson_body` are present, validate both are non-empty strings (bounded — reuse a sane cap, e.g. the existing draft-bytes bound covers it); absent → a no-lesson emission. They are not policy keys (pass `assertDataIsPolicyFree`).
- Compute `const lesson_commitment = (lesson_signature && lesson_body) ? computeLessonCommitment({ lesson_signature, lesson_body }) : '';`. **Sign-what-you-see for the lesson:** the commitment is derived from the SAME body rendered, so the operator cannot be shown body X while approving commitment Y.
- `reviewText` — render the lesson body + signature (OQ3-3, additive defense) when present, with a clear "lesson (rides this approval; not emitted in the PR)" header.
- `freezeScrubbed` stays `{repo, issueRef, diff}` (the lesson is NOT in the emission axiom). Thread `lesson_commitment` into `recordApproval(..., { ..., lesson_commitment })` (`:208`).
- **Confirm-token unchanged** — it binds the emission hash (sign-what-you-see for the diff); the lesson binds via the commitment in the signed basis. (A future wave MAY fold the commitment into the confirm token; out of scope — named so a reviewer does not flag it.)

### 5. `packages/kernel/egress/loom-broker-bind.js` (recon-found scope)

- `CTX_KEYS` (`:27`) → add `'lesson_commitment'` (the exact-set grows to 5).
- `validateCtxShape` (`:45`) → add `if (typeof ctx.lesson_commitment !== 'string' || !(ctx.lesson_commitment === '' || HEX64.test(ctx.lesson_commitment))) return { ok:false, reason:'lesson_commitment-not-hex64-or-empty' };` (a present-but-malformed commitment fails closed; the exact-shape gate already rejects absent/extra). HEX64 is defined `:23`.
- `authorizeRequest` recompute (`:91`) → fold `lesson_commitment: ctx.lesson_commitment` into the `approvalSigBasis` call (so `recomputedBasis === claimedBasis` again).

### 6. `packages/kernel/egress/loom-custody-verify.js` (recon-found scope)

- C3 probe (`:154-155`) → add `lesson_commitment: ''` to the probe `ctx` and `approvalSigBasis({ ..., lesson_commitment: '' })`. (A custody health-check carries no real lesson; `''` is the no-lesson basis the broker now expects.)

### 7. `packages/lab/persona-experiment/live-draft-run.js`

- Repoint the `computeLessonCommitment` import from `../causal-edge/lesson-commitment` → `../../kernel/_lib/lesson-commitment` (after the move; lab → kernel is legal). No behavior change.

## Tests (TDD-treatment — rewrite the regressing assertions FIRST, run red, then implement)

The named regressions (rewrite to the new shape before implementing):

- **`tests/unit/kernel/egress/loom-broker-bind.test.js`** — `ctxFor` (`:20`) is a **4-key** ctx; `basisFor` (`:22`) a 4-field basis; the "extra key → ctx-shape-mismatch" test (`:75`) and the "4-key exact set" comment (`:69`). Rewrite `ctxFor`/`basisFor` to **5-key** (add `lesson_commitment: ''` default); the extra-key test stays valid (a 6th key still mismatches). ADD: a non-hex/65-hex `lesson_commitment` → `lesson_commitment-not-hex64-or-empty`; a valid 64-hex commitment round-trips allow; a commitment present host-side but absent in ctx → `ctx-shape-mismatch`.
- **`tests/unit/kernel/egress/approval-store.test.js`** — the round-trip body-shape test (`:50-59`) asserts `body.hash/nonce/approvedAt/emission/sig/key_id`. ADD `assert.strictEqual(body.lesson_commitment, '<the 64-hex or "">')`. The `SIGN` helper (`:30`) signs `(h, body)` — confirm it still signs the basis the store passes (the store now passes the extended basis; SIGN is `signRecordId(h,...)` over `h` = the basis arg, so it is basis-agnostic — no change).
- **`tests/unit/kernel/egress/approval.test.js`** — any `verifyApproval(...)` assertion that `deepStrictEqual`s `{ ok: true }` regresses to `{ ok: true, body }`. Rewrite to assert `.ok === true` + `.body` shape. (grep first — the recon found no `ok: true` literal, so likely `.ok`-style; confirm.)
- **`tests/unit/kernel/egress/loom-custody-verify.test.js`** — if it asserts the C3 ctx/basis shape or a `sigVerifies` outcome with an injected signer, update the expected ctx to 5-key. (grep for `approvedAt`/`ctx`.)

New acceptance tests (RFC §7-W2):

- **approval.js** — the undefined-footgun: `approvalSigBasis({h,a,n,k, lesson_commitment: undefined})` `===` `approvalSigBasis({...lesson_commitment: ''})`; a non-string `lesson_commitment` → throws. `verifyApproval`: a body whose `lesson_commitment` matches the request → ok (+ returns body); a swapped request → `lesson-commitment-mismatch`; an edited `body.lesson_commitment` with the old sig → `sig-invalid` (basis re-derive breaks); a non-string request → `no-requested-lesson-commitment`.
- **approval-store.js** — `recordApproval` with a 64-hex `lesson_commitment` → the body persists it and the sig verifies over the extended basis (mint-boundary `verifyKeyPem` path); `readVerifiedApproval` with the matching `requestedLessonCommitment` → ok; with a swapped one → `lesson-commitment-mismatch`. A no-lesson (`''`) mint round-trips.
- **emit-pr.js** — `data.lesson_commitment` = 64-hex → accepted + threaded (assert via an injected gate / the awaiting-approval path); = non-hex / 65-hex → shape-reject (the emit fail-closes BEFORE the lock, an emitPR-level throw → `{ok:false}`); absent → coerced `''` (the existing no-lesson tests keep passing); `lesson_commitment` is NOT in `DISPOSITION_KEYS` (a direct assertion). A full round-trip: mint via `recordApproval` with commitment X + emit with `data.lesson_commitment` X (live+token+killswitch-off, injected `armedEmitFn`) → the gate passes; emit with commitment Y → `awaiting-approval` (the gate refused the swap).
- **approve-cli.js** — a draft with `lesson_signature`+`lesson_body` → the minted approval's `body.lesson_commitment` `===` `computeLessonCommitment({lesson_signature, lesson_body})` (sign-what-you-see round-trip); `reviewText` includes the lesson body; a draft without a lesson → `''` (current behavior preserved). The cross-uid sign path is dep-injected (the existing `makeSigner`/`deps` seam).
- **The cross-module round-trip (the load-bearing one):** mint through `recordApproval` with the **real** `signRecordId` signer over the **extended** basis → `readVerifiedApproval` with the matching `requestedLessonCommitment` → ok; the SAME approval read with a swapped `requestedLessonCommitment` → `lesson-commitment-mismatch`. AND the broker path: `authorizeRequest` over the 5-field ctx the (extended) `recordApproval` would thread → allow; a stripped/garbage `lesson_commitment` → deny. (Rule-2a: VALIDATE re-probes these against the REAL `signRecordId`/`verifyRecordSig`, not a mock.)

## Out of scope + named asymmetries (so a reviewer does not flag a gap)

- **W3 (the join-key seal + the broker-sig provenance bundle + propagation)** — `verifyApproval` returning the body is W2 (it is needed kernel-side now), but the *consumer* (emit-pr persisting `{approvedAt,nonce,key_id,broker_sig}` onto the join-key) is **W3 §5.4**. W2 makes the body available; it does not yet persist it. `emit-pr`'s `writeJoinKey` call is **untouched** in W2.
- **PR-A2** (the cross-uid authenticated minter that verifies the persisted sig + re-derives the commitment) — the follow-on, not W2.
- **`computeEmissionHash` + the emission Forward-Contract** — byte-identical after W2 (§4). Only `approvalSigBasis` + the broker ctx grow.
- **The confirm-token still binds the emission hash, not the lesson** — the lesson binds via the signed basis. Folding the commitment into the confirm token is a possible future hardening, out of W2 scope.
- **ACTIVATION residual (RFC §6)** — the seal is doubly-inert until the live loop is armed (gap-map item 8, unbuilt). W2 builds the mechanism SHADOW; "W2 merged" ≠ "the seal is live."
- **Same-uid co-forge of the lab body** — NOT closed by W2 (NARROWS, per OQ-NS-6 / #273). The broker sig proves a legitimate approval bound the commitment (provenance); body-correctness is never proven.
- **Wave size** — W2 touches 7 production files + 4-5 test files (~250-350 lines). Larger than the < 400-line guideline's comfort zone but **cohesive** (one logical change: the basis-extension ripple). Splitting would leave each half's acceptance round-trip incomplete (mint-side and read-side must land together). Kept as one wave; flagged here.

## Drift notes

- The RFC §5.3 named 4 modules; recon found 6 (the 2 broker recompute sites) + the kernel-ward helper move. This is the W1 SCAR paying off again: **recon verifies the world; boards verify the design** — the broker `basis-mismatch` ripple is invisible in the RFC prose but obvious on a `grep` of `approvalSigBasis` callers. Fold this into the VERIFY board's framing so it confirms the 6-module scope rather than re-deriving the 4.

## Verification

- Per-wave: **full 3-lens VERIFY** (architect design + scope completeness; hacker the swap/forge/footgun + the broker recompute ripple; honesty claim-vs-evidence on the inertness + provenance-not-correctness framing) on THIS plan — kernel/security diff, so the full tier (not W1's 2-lens). Delegated TDD build (node-backend, `isolation:worktree` per Rule 4). **Full 3-lens VALIDATE** (code-reviewer + hacker Rule-2a live probes against the REAL `signRecordId`/`verifyRecordSig` + honesty) on the built diff.
- Pre-push: `bash install.sh --hooks --test` + the full kernel suite (`find tests/unit/kernel -name '*.test.js' -print0 | xargs -0 -n1 node`) + the lab suite; `node scripts/generate-signpost.js --check` (the new + deleted `.js`); zero `eslint-disable`; ASCII-only.

## VERIFY board folds → Rev 2 (build directives — authoritative; override any contradicting plan-body line)

The full 3-lens board (architect SHIP; hacker + honesty NEEDS-REVISION) firsthand-CONFIRMED the design + the 6-module scope + the kernel-ward move + the byte-identical emission Forward-Contract. Zero CRITICAL, zero design flaws. The folds are precision/test-discipline:

**F1 (HIGH, hacker) — `verifyApproval` check order + the legacy-body reason.** Folded inline in Files §1: the lesson-equality check runs BEFORE the body-hash re-derive + sig verify; `no-body-lesson-commitment` is a DISTINCT fail-closed reason; the BODY field is required-string (never coerced — only the request coerces). Acceptance asserts the EXACT reason per path: swap → `lesson-commitment-mismatch`; edited-body-with-old-sig → `sig-invalid`; legacy/absent body → `no-body-lesson-commitment`; non-string request → `no-requested-lesson-commitment`.

**F2 (MEDIUM, architect+honesty) — import count is 3, not 2.** Folded inline in the helper-move probe. Build directive: repoint `live-draft-run.js:33`, `live-draft-run.test.js:500` (asserts at :533/:553/:557), and relocate `lesson-commitment.test.js` → `tests/unit/kernel/_lib/`; then DELETE the lab file. Re-run `grep -rn computeLessonCommitment packages/ tests/` and confirm zero references to the old lab path before deleting.

**F3 (MEDIUM, hacker) — the emit-pr swap acceptance test must be NON-VACUOUS.** `readVerifiedApproval` is reached only on the live armed path (`emit-pr.js:452`), and every `appr.ok === false` collapses to `reason: 'awaiting-approval'` (`:456-458`) — so a test asserting only `awaiting-approval` cannot distinguish a swap-refusal from "the gate never ran." Build directive: the round-trip test MUST (a) mint a REAL approval via `recordApproval` with commitment X over the **real `signRecordId`** (NOT a stub signFn) — only `armedEmitFn` is stubbed; (b) drive `emitPR` live+token+killswitch-off with `data.lesson_commitment = X` → **`emitted: true`** (the X-path emitting is what proves the gate ran — non-vacuous); (c) a second `emitPR` against the SAME minted approval with `data.lesson_commitment = Y` → `awaiting-approval` (the swap refused). **Observability add:** surface the underlying `appr.reason` into the awaiting-approval return (e.g. `approvalReason: appr.reason`) so a `lesson-commitment-mismatch` is debuggable at the emit layer rather than swallowed (security.md: a fail-closed decision must be observable). Keep it a plain reason token (no payload leak).

**F4 (MEDIUM, hacker) — lowercase-only HEX64 parity across ALL gates.** The four 64-hex gates (`approval-store.js:30` `/^[a-f0-9]{64}$/`, `loom-broker-bind.js:23` `/^[0-9a-f]{64}$/`, the new `emit-pr` `assertSafeLessonCommitment`, and the `approve-cli` path) MUST all be lowercase-only and byte-identical in intent — `computeLessonCommitment`/`computeEmissionHash` emit lowercase, so a mixed-case-tolerant gate at ONE site would let an uppercase variant launder past one boundary and fail another (a basis-divergence). Add a cross-gate test: an uppercase 64-hex (`A-F`) `lesson_commitment` is rejected consistently at every boundary. `validateCtxShape`'s new gate checks `typeof !== 'string'` FIRST (rejects null/number/undefined) then the hex-or-empty shape.

**F5 (MEDIUM, hacker) — per-field caps on the actor-writable draft lesson fields.** `approve-cli` now hashes `draft.lesson_signature`+`draft.lesson_body` kernel-side; the 8MB whole-file bound (`approve-cli.js:38`) does NOT bound an individual field. Add explicit caps in `validateDraft`: `lesson_signature` ≤ 256 chars, `lesson_body` ≤ a few KB (pick a sane constant, e.g. 8192). Defense-in-depth on the mint-time hash CPU; the broker sig is over the fixed 64-hex commitment so the basis size is already bounded. Keep the moved kernel helper's STRICT throw-on-empty/non-string **verbatim**; the frozen known-vector test (`9553275e3e16e84a850d3a8b9b323e9554d2e8fa95740739e983d7c33e3f77d4`) moves with it (catches a byte-drift in the moved file).

**F6 (MEDIUM, architect — confirms C3 both-sites).** `loom-custody-verify.js` C3 probe (`:154-155`) must add `lesson_commitment: ''` to **BOTH** the `ctx` object AND the `approvalSigBasis(...)` call — else the probe self-denies `ctx-shape-mismatch`/`basis-mismatch` and reports custody broken (a false-negative health check). Add a one-line comment that `''` is the no-lesson sentinel shared with real no-lesson emissions (the probe is distinguished by its synthetic emission body, not the commitment).

**F7 (LOW folds — apply, don't re-litigate):**
- `approve-cli` `validateDraft`: validate the lesson fields AFTER the emission-axiom validators (readable ordering, not security-ordered). Add a test asserting `lesson_signature`/`lesson_body` are NOT in `DISPOSITION_KEY_SET` (mirrors the `lesson_commitment`-not-a-disposition-key test).
- W3 contract note (carry forward, do NOT build in W2): the returned `body` is integrity-verified (post sig-check) → safe for W3 to persist; W3 adds the join-key/merge-outcome read-back paths where the workspace read-path freeze discipline (`testing-expectations`: freeze read-back/dedup/update returns) applies.
- Honesty tightenings (already applied inline in Files §1 + below): the edited-body path is the same-uid NARROWS case (not forge-proof); the "forward-contract churn" is acceptable as a property of the 24h TTL (any standing approval self-expires within a day; no corpus committed in-repo), NOT a verified absence of live host state.

**F8 (my test-recon, fold into TDD-treatment):**
- `tests/unit/kernel/egress/approval.test.js`: the real regression is the shared `approvalBody()` helper — it MUST include `lesson_commitment` and sign the **extended** basis, else every existing `verifyApproval` test fails `sig-invalid`/`no-body-lesson-commitment`. Existing `.ok`/`.reason` assertions are additive-safe once `approvalBody()` signs `lesson_commitment: ''` (and `verifyApproval` coerces a missing `requestedLessonCommitment` → `''`, so the existing calls that omit it still pass).
- `tests/unit/kernel/egress/loom-custody-verify.test.js`: `assessCustody` is tested via an INJECTED `facts` object, so the C3 `gatherCustodyFacts` ctx change is NOT auto-covered. Add a focused `gatherCustodyFacts` test that injects a `signer` and asserts it receives a **5-field ctx with `lesson_commitment: ''`** (non-vacuous proof the C3 probe wires the field).

## Out-of-scope tightenings (honesty folds, applied)

- The forward-contract churn is acceptable **because the 24h TTL means any standing approval self-expires within a day and no `.approved` corpus is committed in-repo** — it is a property of the TTL, not a verified claim about live host state (a deployed host holding a fresh approval re-approves after the basis change).
- W2 closes the **post-approval lesson swap** (untrusted-data path); it **NARROWS** the same-uid co-forge of a self-consistent body (fail-closed only because the forger lacks the cross-uid broker key — the standing OQ-NS-6 deployment caveat). It does NOT prove lesson-correctness.

## VALIDATE result (3-lens, Rule 2a — built diff @ `9683697`)

**Verdict: SHIP (unanimous).** code-reviewer SHIP, hacker SHIP, honesty SHIP. Zero CRITICAL/HIGH.

- **code-reviewer SHIP** — every fold (F1-F8) verified by line number: the `verifyApproval` reason chain is `no-body-lesson-commitment` → `lesson-commitment-mismatch` → `body-hash-mismatch` → `sig-invalid` (the lesson gate is genuinely BEFORE the sig verify, F1); the basis coerce-chokepoint, the broker `CTX_KEYS`→5 type-check-first, the C3 both-sites, the lowercase-only `assertSafeLessonCommitment`, the kernel-ward helper move + deletion + relocated known-vector. Full kernel suite **0 failures** (approval 27, emit-pr 55, approval-store 20, approve-cli 16, loom-broker-bind 11, loom-custody-verify 11, loom-broker-sign 8). The emit-pr round-trip is non-vacuous (real `signRecordId` mint; only `armedEmitFn` stubbed; X-path `emitted:true`, Y-path `seamCalls===0`).
- **hacker SHIP** — 9 live throwaway probes / 35+ attacks against the **real** ed25519 `signRecordId`/`verifyRecordSig` on the BUILT modules, all held: swap → `lesson-commitment-mismatch`; in-place body edit under old sig → `sig-invalid`; undefined/''/absent collapse to one basis + non-string throws; UPPERCASE rejected at all 3 gates (no laundering seam); broker recompute denies a 4-key strip + a forged `''`; armed `emitPR` refuses the swap (`armedEmit` invoked exactly once, only for the matching commitment); `computeEmissionHash` byte-identical to main. **3 gate-mutations each killed** (non-vacuous proof).
- **honesty SHIP** — Grade A, NO-OVERCLAIM. All four highest-stakes claims firsthand-verified (`computeEmissionHash` byte-identical; SHADOW/weight-inert; sign-what-you-see derives commitment from the same rendered object; the round-trip is real-signer non-vacuous). The builder's self-report is honest; the lab-failure scope claim (only the 3 environmental) is consistent with the diff's reach; the 7th-file deviation (`loom-broker-sign.test.js` ctx→5-key) is correctly characterized as a fail-closed test tightening.

**Named residuals (no W2 code change):**
- **(arming)** the mint-boundary sig verify is `--verify-key`-gated (optional); a value-swap signer without it writes a *dead* artifact that fails closed at the read gate (`sig-invalid`) — not exploitable (read gate authoritative), a *pre-existing* `approval-store` property. When the loop is ARMED (gap-map item 8), make `--verify-key` effectively mandatory so a value-swap is caught at mint, not wedging a hash's wx slot.
- **(migration)** pre-W2 standing `.approved` files become unreadable (`no-body-lesson-commitment`) and must be re-minted — security-correct (refuses to launder a pre-OQ-3 approval into a no-lesson match), moot under SHADOW (no standing corpus; 24h TTL). Note it in the PR body.
- **(optional, deferred)** add one test that parses the confirm token out of the actual `reviewText` output to close the render→confirm→mint loop in a single flow (the property is already covered by two independent halves).

## CodeRabbit fold (post-PR, 3 Major folded — async-bot complements the board, the SCAR continues)

CodeRabbit posted 3 Major (Security) + 1 nitpick; each premise-probed firsthand, all 3 VALID and folded (the nitpick — a plan-grep wording note on an already-executed step — skipped):

- **F-CR1 (`approval.js`)** — `verifyApproval` only `typeof`-checked `reqLC`/`body.lesson_commitment`, not the `''`|64-hex SHAPE the other 4 gates enforce; a direct verifier caller (it is exported; W3/PR-A2 consume it) could match on an arbitrary string. **Fix:** an `isSafeLessonCommitment` shape helper applied to both — verifyApproval is now the 5th consistent shape-gate. Tests: arbitrary-string request → `no-requested-lesson-commitment`; arbitrary-string body → `no-body-lesson-commitment`.
- **F-CR2 (`approve-cli.js`)** — the lesson fields are rendered verbatim on `/dev/tty` AND hashed into the signed commitment, so a `\r`/ANSI-ESC/`\n` could change what the operator SEES without changing the committed bytes (breaks sign-what-you-see). **Fix:** reject all control chars (`< 0x20` + DEL) in `lesson_signature`/`lesson_body` via `charCodeAt` (NOT a control-regex — ADR-0006; mirrors `isEgressDeniedPath`). Tests: ANSI-ESC / CR / newline-fake-line-injection each rejected.
- **F-CR3 (`emit-pr.js`)** — `assertSafeLessonCommitment` coerced explicit `null`→`''` (silently laundering a malformed actor value into no-lesson). **Fix:** only `undefined` coerces to `''`; `null` falls through to the throw (fail-closed). Test updated: `null` → throws.

Re-gates after the fold: full kernel suite **0 failures** (approval 28, approve-cli 17, emit-pr 55); zero non-ASCII / literal-control-byte / `eslint-disable`. Commit `<fold>` on the PR branch.
