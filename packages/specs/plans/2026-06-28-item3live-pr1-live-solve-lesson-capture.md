---
phase: autonomous-sde-ladder
title: Item-3-live PR-1 - draft-time live-solve lesson CAPTURE + the live_pending lane (SHADOW)
status: planning
lifecycle: persistent
date: 2026-06-28
---

# Item-3-live, PR-1 - draft-time live-solve lesson CAPTURE + the `live_pending` lane (SHADOW)

The gap-map's "live lesson minting on the live loop" (gap #5): `runLiveDraftLoop` solves real issues but
DISCARDS the graded solve - it mints ZERO lessons. This PR captures a SHADOW lesson HYPOTHESIS from each live
solve into a new `live_pending` lane. **PR-2 (separate) is the merge connection** (world-anchor the captured
lesson at merge-time, replacing the static `LESSON_2137` floor) - split per the design pass (combined >400 LoC;
PR-2 touches the just-shipped #452 mint + WIDENS #273, so it is isolated for a focused high-stakes VALIDATE).

## Scope (PR-1 only)

A LIVE solve produces a lesson HYPOTHESIS, persisted weight-inert. NO merge wire, NO consumer reads the lane yet.

1. **NEW `deriveLiveLesson` + `isLiveLessonEligible`** (`packages/lab/causal-edge/live-lesson-derive.js`) - an
   ORACLE-FREE lesson deriver (a live solve has no sealed `accepted_diff`): it maps the `gradeLiveIssueSemantic`
   shadow verdict's friction block + `semantic_supported` onto the EXISTING frozen lesson taxonomy
   (trigger/gotcha/corrective) via an INJECTED `claude -p` leg; reuses `lessonClusterKey` + `LESSON_BODY_MAX`.
2. **NEW `live-pending-store.js`** (`packages/lab/world-anchor/`) - the `live_pending` provenance lane, templated
   on `live-recall-store.js` (verify-on-read, content_hash seal, observable refuse, exact-set shape).
3. **`runLiveDraftLoop` capture branch** - at the solve+grade success terminus, gate on `isLiveLessonEligible`,
   derive, write to the live-pending store. FAIL-SOFT (a capture failure is one observable field on the outcome,
   never aborts the record).
4. **A new SHADOW import-graph dam entry** for the live-pending store.

## The honest line (the trust framing - honesty pre-design HIGH-1/2/3)

- **CAPTURE, never "learn".** The lesson is ORACLE-FREE (`behavioral: 'UNAVAILABLE'`) + weight-inert. It is an
  unvalidated HYPOTHESIS, not a learned/validated behavior change. The verb is `capture`/`record`; never
  `learn`/`train`/`improve`. The store header restates the live-grade discipline: NEVER a proof-of-fix, NEVER a gate.
- **`provenance: 'live_pending'` IS the honesty marker** - "captured at draft, pending a merge-confirmation."
  Plus the live-grade `behavioral: 'UNAVAILABLE'` framing rides into the store header so a future reader cannot
  mistake a captured hypothesis for a graded lesson (honesty HIGH-1).
- **Coverage is narrow, not "every solve"** (honesty MED-2): only a SUCCESSFULLY-solved-and-graded record whose
  derived lesson maps onto the frozen taxonomy floor mints. A no-candidate / off-floor / ineligible record mints
  nothing - and the non-mint reason is OBSERVABLE (honesty MED-3).
- **Forward-contract to PR-2 (honesty HIGH-2/3, named NOW):** PR-2 will world-anchor the captured lesson at
  merge-time. That WIDENS #273 - it swaps the human-vetted static `LESSON_2137` floor for an attacker-derived
  (issue-text + model-solve) + same-uid co-forgeable captured floor; the substitution lever grows from 1 to N.
  Tolerable ONLY while weight-inert; the authenticated edge minter (item 5 / RFC Option B) is the HARD
  predecessor to any `LIVE_SOURCES` flip. And a world-anchored merge proves DIFF-ACCEPTANCE, not
  LESSON-CORRECTNESS (proven by `packages/lab/world-anchor/lesson.js:57-62`, where the maintainer's review CORRECTED the lesson body).
  PR-1 itself stays SHADOW/inert; this contract is stated so PR-2 cannot ship as "more real" without the residual.

## Runtime Probes (firsthand this session)

| Claim | Probe -> observed |
|---|---|
| `runLiveDraftLoop` mints ZERO lessons; the graded solve terminates at the draft artifact | recon: [live-draft-run.js](../../lab/persona-experiment/live-draft-run.js) `solveGradeDraftOne` terminus ~:218-228 (writeArtifact); grep `captureLessons` in the file = 0 |
| the oracle-free grade is `gradeLiveIssueSemantic` (`behavioral:'UNAVAILABLE'`, `semantic_supported` tri-state, `friction`, `shadow:true`) | [live-grade.js](../../lab/causal-edge/live-grade.js) (canonical path = `causal-edge/`, NOT `persona-experiment/` - both design agents corrected this) |
| `deriveLesson` CONTRASTS candidate vs `accepted_diff` (absent for a live solve) + `lessonLeaks` early-returns on empty accepted (vacuous for live) | `packages/lab/causal-edge/lesson-derive.js:45-46` (deriveLesson) / `packages/lab/causal-edge/lesson-signature.js:110-118` (lessonLeaks) - so a NEW oracle-free deriver is required |
| the friction block shape = `{friction_class, friction_phase, detection_leg, _diagnostic.human_message}`; a DIFFERENT enum space from the lesson taxonomy | [trajectory-friction-run.js](../../lab/causal-edge/trajectory-friction-run.js) `buildResolutionFriction` |
| the frozen lesson taxonomy (trigger/gotcha/corrective) + `lessonClusterKey` + `LESSON_BODY_MAX` | `recall-graph.js` `attachLesson` / `lesson-signature.js` - reuse, never fork (the taxonomy-freeze invariant) |
| the three existing provenances all reject a draft-time live lesson: `backtest` firewall-bound, `world_anchored` merge-scoped, `live` reserved | `packages/lab/issue-corpus/corpus.js:47`, `packages/lab/attribution/recall-graph-store.js:56,76`, `packages/lab/world-anchor/live-recall-store.js:53,111` - so a NEW `live_pending` value + store is required |
| `live-recall-store.js` is the hardening template (O_NOFOLLOW+fstat, st.size cap, readBoundedText, exact-set, content_hash seal, observable refuse) | [live-recall-store.js](../../lab/world-anchor/live-recall-store.js) |
| SHADOW firewall: `LIVE_SOURCES=Object.freeze([])` keys on `source` not `provenance` | [weight-source-gate.js](../../lab/causal-edge/weight-source-gate.js) - a `live_pending` node is weight-inert |

## Routing Decision

```json
{ "recommendation": "root", "score_total": 0.075, "low_signal": true, "judgment_override": "route",
  "rationale": "substrate-meta stakes-lexicon miss (the lab/lesson lexicon is absent from the routing dict); escalated by judgment - a NEW content-addressed store + a deriver that consumes ATTACKER issue-text through an LLM leg = a hacker-lens surface; the full 3-lens VERIFY/VALIDATE tier applies (the new store is the kernel/security/data-mutation class)." }
```

## Design (RATIFIED from the design pass; folds at `## Pre-Approval Verification`)

### D1 - `deriveLiveLesson` + `isLiveLessonEligible` (the oracle-free deriver)
- `isLiveLessonEligible(verdict)` -> true IFF `verdict.semantic_supported === true && validateResolutionFriction(verdict.friction) != null`. Tri-state strict: `false`/`null` (a refused/thrown judge) BOTH drop (fail-closed). Lives in `live-lesson-derive.js`, NOT `recall-graph.js` (whose `isEligibleForPopulation` is the sealed-corpus gate - untouched).
- `deriveLiveLesson({ verdict, candidate_patch_sha, problem_statement_digest }, deriveFn)` -> `{trigger_class, gotcha_class, corrective_class, lesson_signature, lesson_body}|null`. The INJECTED `deriveFn` (a `claude -p` leg) maps the friction block + `semantic_supported` onto the frozen lesson axes; the output is VALIDATED against the frozen floor exactly as `deriveLesson` does (off-floor enum -> null). `lesson_signature = lessonClusterKey(...)` (the `lesson:`-prefixed key the mint matches in PR-2). `lesson_body` is the leg's 1-2 sentence prose, `scrubLabSecrets`'d + bounded by `LESSON_BODY_MAX`. PURE (the leg injected; no net/exec in the module).
- **NAMED residual (vacuous leak-guard):** with no `accepted_diff`, `lessonLeaks` is a no-op - the live deriver has one fewer rail than the backtest deriver. Mitigation: `scrubLabSecrets` + the body bound. Residual: a leg quoting the (already-public) problem statement verbatim is not caught. NAMED, not closed.
- **Attacker-text surface (VERIFY hacker H2 + M2):** the `deriveFn` input is built from UNTRUSTED issue text + the model solve + the friction block. The friction `_diagnostic.{human_message,expected,observed}` are UNBOUNDED attacker-influenceable free-text - they MUST be DIGEST'd or hard length-capped (a module const) BEFORE the leg (an LLM injection + cost-DoS surface; mirror `live-grade.js`'s `digest()` of the problem statement). The deriveFn input carries ONLY the digest + the bounded friction - NEVER the raw clone path, the API key, or any lab-state path. The OUTPUT axes are the frozen closed enum (off-floor -> null; never an echoed attacker span); `lesson_body` is MODEL PROSE from untrusted text (the closed-enum applies to the AXES only, NOT the body - honesty F2), guarded ONLY by `scrubLabSecrets` (coarse) + `LESSON_BODY_MAX`, which is the NAMED vacuous-leak-guard residual below.

### D2 - the `live_pending` store (`causal-edge/live-pending-store.js`)
- **LOCATION (VERIFY hacker H1 + architect #1/#2): `packages/lab/causal-edge/` (NOT `world-anchor/`).** The lane is the PRE-world-anchor lane; its inputs (lesson-signature, friction, live-grade) all originate in `causal-edge/`, and `persona-experiment -> causal-edge` is the import direction the capture site ALREADY uses. Placing a draft-time artifact in the merge-time `world-anchor/` dir + having `persona-experiment/` import it would trip the blanket "no external importer" dam. Still HARDENED-TEMPLATED on `live-recall-store.js` (the read-path discipline travels regardless of dir).
- `LIVE_PENDING = 'live_pending'` (a NEW provenance, defined HERE, never added to the backtest corpus enum - the backtest firewall stays untouched, mirroring `live-recall-store.js:52`).
- Body (exact-set, closed shape): `{ provenance:'live_pending', repo, issue_ref, candidate_patch_sha, lesson_signature, lesson_body, node_id, content_hash }`. `content_hash` seals the FULL body. **`node_id` BASIS_FIELDS (PINNED NOW - the PR-2 dedup forward-contract, architect #4): `['provenance','repo','issue_ref','candidate_patch_sha','lesson_signature']` - identity = "this solve, this lesson axis"; EXCLUDE the model-unstable `lesson_body` from the id basis (still sealed by content_hash), so a body reword is an observable collision-reject, never a silent duplicate node.**
- `mintLivePendingLesson(block, opts)` / `readLivePendingLesson(id, opts)` / `listLivePendingLessons(opts)` - templated VERBATIM on `live-recall-store.js`'s hardened read path: `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` + fstat-same-fd + foreign-uid reject + `st.size` cap BEFORE read + `readBoundedText` (cap+1) + closed-shape exact-set + re-derive `node_id`+`content_hash` + reject mismatch + deep-freeze. EVERY refuse path emits (`emitEgressAlert`, reason on a non-`reason` key). `listLivePendingLessons` is TOTAL (a single corrupt file is SKIPPED, never thrown - load-bearing for PR-2's runtime floor).
- The store is NOT a sandbox (#273): verify-on-read proves INTEGRITY, not PROVENANCE; a same-uid process can co-forge a body. Tolerated ONLY because weight-inert.

### D3 - the capture branch in `runLiveDraftLoop` (fail-soft, outcome-pure)
- In `solveGradeDraftOne`, at the solve+grade SUCCESS terminus (the same point holding `record`, `solveRes.candidate`, `verdict`, `classifyFields.persona`), AFTER the verdict: compute the deriver inputs (architect #3 - they are NOT computed anywhere today): **`candidate_patch_sha = sidecarSha(SCRUBBED candidate)`** (sha the SCRUBBED candidate, matching `lesson-capture.js`'s convention so the PR-2 join agrees on scrubbed-vs-raw) + **`problem_statement_digest = digest(record.problem_statement)`** (`digest` is exported from `live-grade.js`; the RAW problem statement NEVER reaches the deriveFn). Then `if (isLiveLessonEligible(verdict))` -> `deriveLiveLesson({verdict, candidate_patch_sha, problem_statement_digest}, deriveFn)` -> on non-null, `mintLivePendingLesson({...repo, issue_ref, candidate_patch_sha, lesson_*})`.
- FAIL-SOFT + OUTCOME-PURE (the D5/MED-2/MED-3 discipline): the capture runs inside the existing per-record try/catch; a derive/write failure NEVER aborts the record (the draft artifact still writes). The outcome gains additive observable fields: `lesson_captured: bool`, `lesson_reason: <closed-enum>` (`captured` | `ineligible` | `off-floor` | `derive-threw` | `store-refused` | `no-candidate`). Default behavior (no eligible lesson) leaves the existing artifact byte-compatible + the new fields additive-only (prove no `draft-${id}.json` consumer breaks).
- New injectable deps `lessonDeriveFn` / `lessonEligibleFn` / `lessonWriteFn` for tests (mirrors the existing `deps` seam).

### D4 - SHADOW + the new dam (D5 from the design)
- The `live_pending` node touches NO weight: `LIVE_SOURCES=Object.freeze([])` (unchanged); it is not even a `source` token. NO consumer reads the live-pending store in PR-1 (the merge-mint consumes it in PR-2).
- A NEW SHADOW import-graph dam for the `causal-edge/live-pending-store.js` (VERIFY hacker H1 + architect #1): an EXPLICIT FULL-PATH WRITER-ALLOWLIST (the #451 "EXACTLY-ONE-named-reader full-path `===`" pattern), NOT the blanket "zero external importers" matcher (which would reject the legitimate `persona-experiment/live-draft-run.js` writer). PR-1: the ONLY external importer admitted = `persona-experiment/live-draft-run.js` (the writer); ZERO READERS (no module calls `readLivePendingLesson`/`listLivePendingLessons`). PR-2 adds the world-anchor mint's floor-builder as the one allowlisted READER (the symmetric relaxation). Also assert `issue-corpus/corpus.js`'s provenance enum does NOT contain `live_pending` (M4) + `live_pending` is never a `source` token the weight gate admits.

## Security invariants

- **Verify-on-read store** (the #273 "the store is not a sandbox" discipline): content_hash seals the full body; re-derive `node_id` + `content_hash` on read, reject a mismatch + emit.
- **Every refuse OBSERVABLE** (fail-closed-must-be-observable): the store's refuses AND the capture branch's non-mint reasons emit with a distinguishing token on a NON-`reason` key.
- **Closed-enum output, never an echoed attacker span**: the lesson axes are the frozen taxonomy; `lesson_body` is scrub'd + bounded; the `deriveFn` input is bounded.
- **Exact-set closed shape** on the store body (an injected extra key never rides inside a verified record).
- **NON-OVERRIDABLE byte cap** on the body / the read path (a module-private const, no `opts` override).
- **Weight-inert**: PR-1 adds NO reader of the lane; `LIVE_SOURCES` untouched. The #273 residual (a captured, same-uid-co-forgeable lesson) is tolerable ONLY because inert; the authenticated minter is the close (forward-contract to item 5).

## Files (PR-1)

| File | Change | ~LoC |
|---|---|---|
| `packages/lab/causal-edge/live-lesson-derive.js` (NEW) | `deriveLiveLesson` (friction+semantic -> frozen taxonomy via an injected leg; scrub+bound; off-floor -> null) + `isLiveLessonEligible` (semantic_supported===true && valid friction) | ~90 |
| `packages/lab/causal-edge/live-pending-store.js` (NEW) | the `live_pending` lane: mint/read/list, templated on live-recall-store (hardened read path, content_hash seal, observable refuse, exact-set, TOTAL list); BASIS_FIELDS pinned (D2) | ~280 |
| `packages/lab/persona-experiment/live-draft-run.js` (MODIFY) | the capture branch in `solveGradeDraftOne` success terminus (compute sha+digest; fail-soft, outcome-pure additive fields); new `lessonDeriveFn`/`lessonEligibleFn`/`lessonWriteFn` deps | ~45 |
| `tests/unit/lab/causal-edge/live-pending-store-shadow.test.js` (NEW) | the dam: full-path WRITER-allowlist (`persona-experiment/live-draft-run.js` only) + ZERO readers (PR-1); corpus enum non-membership of `live_pending` | ~25 |
| `tests/unit/lab/causal-edge/live-lesson-derive.test.js` (NEW) | eligibility tri-state; friction->lesson mapping; off-floor leg output -> null; oversize body reject; friction-input bound; vacuous-leak-guard NAMED + the scrub still applies | ~120 |
| `tests/unit/lab/causal-edge/live-pending-store.test.js` (NEW) | full hardening parity with live-recall-store: verify-on-read, foreign-uid, oversize, exact-set, content_hash tamper (incl. an injected-extra-key co-forge reject), observable refuse, dedup-collision, TOCTOU, TOTAL list | ~200 |
| `tests/unit/lab/persona-experiment/live-draft-run.test.js` (MODIFY) | eligible -> lesson written; ineligible -> no write + `lesson_reason`; capture-throw stays fail-soft (draft still written); additive-only artifact | ~60 |
| `docs/SIGNPOST.md` | regenerate (2 NEW .js files) | gen |

## Phases (TDD)
1. Plan -> 3-lens VERIFY (architect + hacker + honesty) -> fold.
2. TDD: the deriver + store + capture-branch tests FIRST (red) -> delegated `node-backend` build to green + a REAL-path dogfood (one real contained solve -> captured lesson on disk; Rule-2a-corollary - mock-green != real path).
3. 3-lens VALIDATE (code-reviewer + hacker live-reprobe of the BUILT store/deriver + honesty) -> fold.
4. Gate (full lab + kernel suites + eslint + the 5 by-hand drift gates incl. signpost for 2 new .js) -> draft PR -> CodeRabbit -> USER merge.

## HETS Spawn Plan
- **VERIFY (3-lens, Rule 2):** `architect` (the deriver/store/capture-branch placement; the frozen-taxonomy reuse; the lab->causal-edge/world-anchor boundaries; the fail-soft contract) + `hacker` (the attacker-issue-text -> deriveFn -> lesson surface; the new store's verify-on-read + co-forge residual; observable refuses; weight-inertness; no echoed attacker span) + `honesty-auditor` (capture-not-learn held; coverage framing honest; the PR-2 #273-widening forward-contract named; provenance:'live_pending' honest).
- **VALIDATE (3-lens, Rule 2a):** `code-reviewer` + `hacker` LIVE-reprobe of the BUILT store + deriver (plant a co-forged live-pending file; drive the capture branch with a hostile verdict/issue; the real lab-state byte-unchanged) + `honesty-auditor`.

## Out of scope (PR-2 + deferred)
- **PR-2 - the merge connection**: thread the captured `lesson_signature` into the EMIT-time attestation + replace the mint's static `ORCHESTRATOR_LESSON_SEEDS` floor with a runtime floor (captured lessons + the `LESSON_2137` grandfather fallback). Touches `world-anchor-mint.js` (#452) + `world-anchor/cli.js`; WIDENS #273 (named above); gets its own focused 3-lens VALIDATE.
- The authenticated edge minter + the `LIVE_SOURCES` flip (item 5 / PR-B) - RFC-premature.
- An LLM-vs-deterministic choice for `deriveFn` beyond the injected-leg seam; the real-leg prompt tuning.

## Drift Notes
- route-decide `root` on the substrate-meta stakes-lexicon miss AGAIN; escalated by judgment (a new content-addressed store + an attacker-text LLM surface).
- Both design agents corrected the gap-map's stale `persona-experiment/live-grade.js` path -> the canonical module is `causal-edge/live-grade.js`. The runtime-claim-probe discipline caught it pre-plan.
- The persona MATERIALIZER (the other half of the original wave choice) is ALREADY BUILT + wired (#443); only behavioral ACTIVATION (a live A/B) remains - a validation effort, not this build.

## Pre-Approval Verification (3-lens board, 2026-06-28)

**Verdict: PROCEED-WITH-FOLDS (architect + hacker + honesty B+). Zero CRITICAL, zero NEEDS-REVISION.** All 6
honesty trust-framing requirements PASS on substance. The folds below are applied above (D1-D4 + the probe-path
fixes) + are the BUILD checklist for Phase 2.

**Design folds (applied above):**
- **hacker H1 + architect #1/#2 (the load-bearing one): the store moves to `causal-edge/`** + the dam is a
  full-path WRITER-allowlist (not the blanket "zero external importers", which would reject the legitimate
  writer). (D2 + D4.)
- **hacker H2 + M2: bound/digest the friction free-text input to the deriveFn** (an LLM-injection + cost-DoS
  surface); the deriveFn input carries only the digest + bounded friction, never the raw clone path / API key /
  lab-state path. (D1.)
- **architect #3: compute `candidate_patch_sha`(SCRUBBED) + `problem_statement_digest` at the capture site**
  (they are not computed anywhere today). (D3.)
- **architect #4: pin the `node_id` BASIS_FIELDS** = `['provenance','repo','issue_ref','candidate_patch_sha',
  'lesson_signature']` (exclude the unstable `lesson_body`). (D2.)
- **honesty F1: 5 stale probe paths corrected + re-anchored** (deriveLesson=`lesson-derive.js`;
  `issue-corpus/corpus.js`; `attribution/recall-graph-store.js`; `world-anchor/lesson.js`). (Runtime Probes.)
- **honesty F2: `lesson_body` is model prose from untrusted text** (closed-enum = AXES only, not the body),
  cross-referenced to the vacuous-leak residual. (D1.)
- **architect #5: `isLiveLessonEligible`'s friction re-validation is defensive-redundant** (live-grade already
  validated it); the load-bearing half is the `semantic_supported===true` tri-state. (D3, noted.)

**BUILD test obligations (Phase 2 checklist):**
1. **The dam (hacker H1):** the new `live-pending-store-shadow.test.js` allowlists EXACTLY
   `persona-experiment/live-draft-run.js` as the writer by full-path `===`, asserts ZERO readers, and asserts
   `issue-corpus/corpus.js` provenance enum has NO `live_pending` (M4).
2. **Verify-on-read parity + co-forge reject (hacker M3):** plant a same-uid co-forged file with an INJECTED
   extra key inside the content_hash seal -> rejected by the exact-set shape check (the live-recall-store
   `:275-276` discipline); the byte cap is a module const with NO `opts` override.
3. **TOTAL list (hacker L1):** plant a corrupt + a co-forged file; `listLivePendingLessons` skips them + returns
   the good ones, never throws (load-bearing for PR-2's runtime floor).
4. **Fail-soft + observable (hacker M1, honesty req 6):** every non-mint branch (ineligible / off-floor /
   derive-threw / store-refused / no-candidate) sets the observable `lesson_reason` outcome field AND the
   security-shaped paths (store-refused, derive-threw) ALSO `emitEgressAlert` on a NON-`reason` key; a capture
   throw leaves the draft artifact byte-compatible (the record still writes) - prove fail-soft RED-first.
5. **Friction-input bound (hacker H2):** a giant/injection-laden `_diagnostic.human_message` is digest/capped
   before the leg; assert the deriveFn never receives the raw clone path / API key.
6. **node_id basis (architect #4):** a body reword (same basis, different `lesson_body`) is a collision-reject
   (observable), NOT a silent duplicate node.
7. **REAL-path dogfood (Rule-2a-corollary):** one real contained solve -> a `live_pending` lesson on disk (the
   real lab-state byte-unchanged otherwise); mock-green is not proof.
8. **Weight-inertness:** grep the diff - the `live_pending` node never reaches `built_by`/reputation/
   `LIVE_SOURCES`; PR-1 adds NO reader of the lane.

## Real-path join-proof (VALIDATE fold 1 - honesty MED + code-reviewer Finding 2)

The in-suite tests exercise the capture branch with a SPY `lessonWriteFn`, so the capture -> REAL-store JOIN
(the actual `mintLivePendingLesson` content-address + verify-on-read) is not covered by the unit suite alone.
This dogfood drives the REAL `runLiveDraftLoop` capture path through the REAL `mintLivePendingLesson` (NO spy
writer). The ONLY injected seams are the contained-solve (a fixture candidate - no Docker in CI), the grade (an
eligible SHADOW verdict), and the `claude -p` LEG (a realistic on-floor fixture); the capture -> `deriveLiveLesson`
-> `mintLivePendingLesson` -> `readLivePendingLesson` chain is REAL end-to-end, in an isolated
`LOOM_LAB_STATE_DIR=$(mktemp -d)`. Verbatim output (throwaway script run + deleted, 2026-06-28):

```text
JOIN-PROOF: PASS (REAL runLiveDraftLoop -> REAL mintLivePendingLesson, no spy)
outcome      : {"ok":true,"reason":"draft-written","lesson_captured":true,"lesson_reason":"captured"}
node_id      : ebd7e3e881db8fe6e72cadd72b4f11ee2729f981029e66af6e7d97a2f69c6ad6
on-disk file : recall-graph-live-pending/ebd7e3e881db8fe6e72cadd72b4f11ee2729f981029e66af6e7d97a2f69c6ad6.json
readback body: {"provenance":"live_pending","repo":"https://github.com/octocat/hello-world","issue_ref":77,"candidate_patch_sha":"57e4185e519a04bc4a94b21a93196cbe443143e4db5d4b31add94ef236570cc4","lesson_signature":"lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly","lesson_body":"Guard the empty-array boundary before reducing; an empty input is a real case, not an exception.","node_id":"ebd7e3e881db8fe6e72cadd72b4f11ee2729f981029e66af6e7d97a2f69c6ad6","content_hash":"cbe4b78d3433a31ab795c041c09863b314aa16fb466806d11935ae72a4e78b56"}
frozen       : true
real lab-state byte-unchanged: true
```

Proven: a real `live_pending` record lands on disk under `recall-graph-live-pending/`; it verifies-on-read
(deep-frozen, content-addressed `node_id` re-derives, `content_hash` seal holds); the outcome is
`lesson_captured:true` / `lesson_reason:captured`; the real `~/.claude/lab-state` is byte-unchanged
(the isolate captured every write). The full Docker-contained-solve + real-`claude`-leg E2E (the live A/B)
stays a NAMED residual, NOT this dogfood.
