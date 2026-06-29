# Plan — OQ-3 W1: the lesson commitment + capture-before-emit reorder (SHADOW, lab-only, inert)

- **Date:** 2026-06-29
- **RFC:** [`2026-06-29-oq3-kernel-seal-lesson-provenance.md`](../rfcs/2026-06-29-oq3-kernel-seal-lesson-provenance.md) (Rev 2, board-verified). This is W1 of 3.
- **Scope:** lab-only. NO kernel change. The whole change is **inert**: `emitPR` ignores an unknown data field, and `runLiveDraftLoop` is not armed (dry-run, empty custody opts). W1 establishes the commitment primitive + the ordering that W2/W3 build on.

## Goal

1. A single-source `computeLessonCommitment({ lesson_signature, lesson_body })` helper (the basis W2's approval binding + W3's join-key seal + PR-A2's gate re-derive will all use — defined once now so the security-critical hash can never drift).
2. `captureLiveLesson` returns an **always-a-string** `lesson_commitment` (a 64-hex digest on the captured branch; `''` on every fail-soft branch).
3. `solveGradeDraftOne` runs `captureLiveLesson` **before** `emitFn` and threads `lesson_commitment` into the emit data.

## Runtime probes (verified firsthand, 2026-06-29)

- `emitPR` ignores an unknown data field: `assertDataIsPolicyFree` (`emit-pr.js:192-201`) throws only on a `DISPOSITION_KEYS` member; `lesson_commitment` is not one; the draft is built only from `repo`/`issueRef`/`diff` (`emit-pr.js:440-446`). Probe: read `emit-pr.js` -> confirmed an extra data key passes and is never read.
- The reorder is mechanical: `solveGradeDraftOne` has `candidate` at `live-draft-run.js:265`, `verdict` at `:280-282`, `emitFn` at `:288`, `captureLiveLesson` at `:313`. All capture inputs precede the emit call.
- `runLiveDraftLoop` calls `emitFn(data, {})` with empty opts (`live-draft-run.js:288`) -> dry-run, no join-key, no cap/etiquette gate -> **no OQ3-4 pre-check needed in W1** (deferred to arming).
- The captured lane persists `lesson_signature` + `lesson_body` verbatim (`live-pending-store.js:71`, `buildBody` `:139`); the world-anchored node carries both (`live-recall-store.js:61`) -> the commitment over `{lesson_signature, lesson_body}` round-trips on both sides.

## Files

1. **NEW `packages/lab/causal-edge/lesson-commitment.js`** (small, pure). Exports `computeLessonCommitment`.
   - `computeLessonCommitment({ lesson_signature, lesson_body })` -> `sha256(canonicalJsonSerialize({ lesson_signature, lesson_body }))` (64-hex).
   - **Strict inputs (the undefined footgun, RFC §5.1):** both must be non-empty strings, else **throw** (`computeLessonCommitment: lesson_signature/lesson_body must be a non-empty string`). The helper never sees `undefined` silently — it is called only on a validated lesson; the `''` no-lesson sentinel is the caller's concern, never produced by this helper.
   - Imports: `crypto` + `kernel/_lib/canonical-json` (lab -> kernel legal). A 5th by-hand drift-gate concern: a new `.js` file -> run `node scripts/generate-signpost.js` (CI Test 121).
2. **`packages/lab/persona-experiment/live-draft-run.js`** — `captureLiveLesson` + `solveGradeDraftOne`.
   - `captureLiveLesson`: import `computeLessonCommitment`; return `lesson_commitment` on **every** branch.
     - Every fail-soft early return (`no-candidate`, `ineligible`, `derive-threw`, `off-floor`, `store-refused`): add `lesson_commitment: ''`.
     - Captured branch (after `writeFn` `ok:true`, `:225`): compute the commitment over the **same** `lesson.lesson_signature` + `lesson.lesson_body` the store just persisted (the byte-identical round-trip, RFC §5.1). Wrap in try (the never-throw contract): on the (store-validated, so practically impossible) throw, `emitEgressAlert('live-pending-capture-commitment-threw', ...)` and return `lesson_captured: true, lesson_reason: 'captured', lesson_commitment: ''` (degraded but observable — the node was written).
   - `solveGradeDraftOne`: **reorder** — run `captureLiveLesson` immediately after `verdict` is computed (`:282`) and **before** `emitFn` (`:288`). Then:
     - **Destructure, do NOT spread the whole capture object (VERIFY architect HIGH-1).** The live success terminus spreads `...capture` (`:316`); since `captureLiveLesson` now returns a third field, an unchanged `...capture` would leak `lesson_commitment` onto the outcome + artifact. Split it: `const { lesson_commitment: capCommit, lesson_captured, lesson_reason } = capture;` thread `capCommit` into the emit data; carry only `{ lesson_captured, lesson_reason }` onto outcomes. `lesson_commitment` stays OFF the outcome (it is an emit-threading value, not a draft-record field).
     - **Carry the capture-observability fields onto EVERY post-capture terminus, not just success (VERIFY hacker HIGH-3).** Because capture now precedes emit, an eligible record whose emit/artifact then FAILS (`emit-threw :290`, `emit:reason :293`, `UNEXPECTED-EMISSION :296`, `artifact-write-failed :308`) would otherwise mint a `live_pending` lesson but return an outcome with no `lesson_captured`/`lesson_reason` — a **minted-but-unobserved lesson** (the exact provenance gap OQ-3 closes). Capture `const captureFields = { lesson_captured, lesson_reason };` at the capture point and spread `...captureFields` onto all five post-capture `recordOutcome` calls (the four failure termini + the success). The pre-capture early returns (`parse :259`, `solve :271/:274`, `symlink :278`) stay unchanged (capture never ran).
     - Thread the commitment: `emitFn({ repo: ref.slug, issueRef: ref.issueRef, diff: solveRes.candidate, lesson_commitment: capCommit }, {})`. Capture stays fail-soft (never blocks emit); on capture failure the emit proceeds with `lesson_commitment: ''`.

## Tests (`tests/unit/lab/...`)

Per TDD-treatment: **rewrite the affected assertions FIRST** (describe the new shape), run red, then implement. A red pre-existing test here is expected, not a build mistake.

- **`lesson-commitment.test.js`** (new): determinism (same input -> same 64-hex); key-order independence (the canonical-json property); a `lesson_body` reword changes the digest; field-swap distinctness (swapping the two field values changes the digest — commits BOTH fields); **the undefined footgun** — `undefined`/empty/non-string input **throws** (never silently hashes `undefined`); a known-vector assertion so a future canonical-json change is caught.
- **Update the existing exact-shape assertion (VERIFY architect HIGH-2).** `live-draft-run.test.js:385` does `deepStrictEqual(r, { lesson_captured: false, lesson_reason: 'ineligible' })` on a direct `captureLiveLesson` return — adding `lesson_commitment: ''` breaks it. Update it (and **grep the whole suite for any other `deepStrictEqual` on a `captureLiveLesson` return**) to the new exact shape. The per-field `strictEqual` assertions (e.g. `:281`, `:351`) survive an additive field and need no change.
- **`live-draft-run` capture tests** (extend): `captureLiveLesson` returns `lesson_commitment: ''` on each fail-soft branch and a 64-hex on the captured branch; **the byte-identical round-trip** — mint a `live_pending` node from the captured lesson and assert `computeLessonCommitment` over the **stored** node's `{lesson_signature, lesson_body}` `===` the value `captureLiveLesson` returned.
- **`solveGradeDraftOne` reorder tests** (extend): capture runs before emit (an injected `emitFn` sees `data.lesson_commitment` = the captured 64-hex, or `''` when capture is ineligible); a capture failure does NOT block the emit (fail-soft); **the minted-but-observed fix (HIGH-3)** — an eligible solve + a FAILING `emitFn` yields an outcome that still carries `lesson_captured: true`/`lesson_reason: 'captured'` AND the `live_pending` node exists; **an exact-key outcome-shape assertion** (not a positive spot-check) on the success terminus proving `lesson_commitment` is NOT a key of the outcome/artifact (catches the HIGH-1 leak).
- **Also re-run `live-draft-persona-wire.test.js`** (VERIFY architect LOW): it exercises `solveGradeDraftOne` artifact/classify wiring and the reorder moves the capture call relative to `writeArtifact`; it has no `deepStrictEqual` on a capture return (no regression) but must stay green.

## Out of scope + named asymmetries (so a reviewer does not flag a gap)

- The approval-layer binding (W2) + the join-key seal (W3) — `emitPR` ignores the field in W1.
- The cap/etiquette pre-check (OQ3-4) — lands at arming, not W1 (the loop has no cap state).
- Arming the loop (custody opts + disposition live) — lifecycle gap-map item 8, separate.
- **Deriver-on-emit-fail cost (VERIFY hacker MEDIUM, accepted).** The reorder runs the `claude -p` deriver on graded-eligible records even when the subsequent emit dry-run / artifact write fails (previously the deriver ran only post-success). Acceptable: the deriver is independently cost-capped (`DERIVE_MAX_BUDGET_USD`, finite-by-default, non-bypassable) + armed-guarded + fail-soft, and shares no ledger/budget side-effect with `emitFn`. No W1 code change; named so a reviewer does not treat it as a regression.
- **The captured-but-empty-commitment asymmetry (VERIFY architect LOW).** The degraded branch (the practically-impossible store-validated `computeLessonCommitment` throw) returns `lesson_captured: true` with `lesson_commitment: ''` — a captured lesson riding the no-lesson sentinel. Inert today; once W3 seals the commitment, the W3/PR-A2 gate behavior for it is defined adjacent to RFC OQ3-5 (the static-floor no-commitment case). W1 makes it observable via `emitEgressAlert` and names it here; no further W1 code.

## Verification

- Per-wave: 2-lens VERIFY (architect design + round-trip/footgun; hacker the commitment-as-future-seal-basis) on this plan; delegated TDD build (node-backend, `isolation:worktree` per Rule 4); 2-lens VALIDATE (code-reviewer + hacker Rule-2a re-probe of the built helper + the reorder). W1 is lab-inert (not a kernel/security/auth diff), so the full 3-lens tier is reserved for W2/W3.
- Pre-push: `bash install.sh --hooks --test` + the full kernel + lab suites; `node scripts/generate-signpost.js --check` (the new `.js` file).
