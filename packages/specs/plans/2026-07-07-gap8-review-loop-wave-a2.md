# Gap-8 review-loop — Wave A-2: the `changes-requested` circuit-breaker source (the HALT)

Third world-contact rung, second slice. Wave A-1 (#524) landed the INGESTION (review-observer + content-addressed
review-outcome store, SHADOW, gates nothing). Wave A-2 is the first CONSUMER: a `changes-requested` denial SOURCE in
the circuit-breaker registry that turns recorded insider `CHANGES_REQUESTED` reviews into a HALT signal (halt-only
NARROWS). Still SHADOW/opt-in — it does not auto-gate.

> **Design settled after the 3-lens VERIFY board (2026-07-07):** the source is a **STATE-count, not a rate-count**
> (a code-reviewer HIGH — see §Pre-Approval Verification). It reports one denial per currently-blocked PR with
> `recorded_at = nowMs`, uses NO record mtime, and therefore touches the merged #524 store **not at all**. This section
> reflects the settled design; the board record + the pre-board design are in §Pre-Approval Verification.

## Context

Scope authority: `research/2026-07-07-gap8-review-loop-scope.md` §"Wave A" (A3) + the store header of
`packages/lab/world-anchor/review-outcome-store.js` (lines 22-36). The scope's A3 sketched "a `changes-requested`
circuit-breaker SOURCE, GLOBAL-only, mtime-windowed, dismissal-aware, opt-in". The VERIFY board REVISED "mtime-windowed"
to a **state-count** (mtime-windowing silently ages out a still-blocking review — see §Pre-Approval Verification CR-1).

## Routing Decision

```json
{"task":"Gap-8 Wave A-2: the changes-requested circuit-breaker SOURCE — a new SOURCES entry in circuit-breaker/project.js with a dismissal-aware state-count projection over the review-outcome store, author_association narrowed to OWNER/COLLABORATOR, global-only, SHADOW/opt-in/starved","recommendation":"root","score_total":0.30,"substrate_meta_detected":true,"substrate_meta_tokens":["reject-event","circuit-breaker","breaker source","manage-promote"],"meta_forcing":"ROUTE-META-UNCERTAIN"}
```

**Escalation judgment**: `root` bare score, but `[ROUTE-META-UNCERTAIN]` fired (substrate-meta: circuit-breaker /
breaker-source) AND this is the Rule-2 class — a security-relevant change to an **availability surface** (the breaker
gates spawn rate), consuming an UNTRUSTED external signal (reviewer button-press), with a live auth-narrowing decision
(`{OWNER,MEMBER,COLLABORATOR}` → `{OWNER,COLLABORATOR}`) and a provenance fork (is-this-ours). Full 3-lens VERIFY +
VALIDATE tier by judgment (architect + hacker + code-reviewer). Board ran 2026-07-07 → PROCEED-WITH-FOLDS (all folds baked in below).

## Runtime Probes (firsthand-verified — the load-bearing build decisions rest on these)

| Claim | Probe | Result |
|---|---|---|
| A source is a `SOURCES` registry entry `{id, starved, list:(nowMs, srcOpts)=>[{persona, recorded_at}]}` | `circuit-breaker/project.js:125-194` | CONFIRMED — the template. A state source emits `recorded_at = new Date(nowMs).toISOString()` so an active block is always in the counting window. |
| `starved: true` makes a `requireLive` gating consumer THROW (fail-closed-LOUD) | `project.js:36-43` (G2) + `:410-412` | CONFIRMED — `negative-attestation` ships `starved:true` because "a clear read is NOT a safety signal". The SAME mechanism encodes "not safe to GATE on yet" (dormant-until-armed + provenance-unestablished) with no `evaluate()` change. **The throw message hardcodes "(its producer is probe-dead)" — FALSE for this source; generalize it (F1).** |
| A constant-persona source must NOT use a `kernel:`-prefixed shape | `project.js:176-178` (the v3.6 W2a IDOR class) | CONFIRMED — the source uses the bare id `changes-requested`. Global-only; per-persona degenerate. |
| The existing `listReviewOutcomes` suffices (NO mtime needed for a state-count) | `review-outcome-store.js:266-286` | CONFIRMED — a state-count uses record PRESENCE (active = a `CHANGES_REQUESTED` record with no same-review_id `DISMISSED`), not any timestamp. **No mtime-lister, no store change** (the pre-board mtime plan is dropped — CR-1). |
| A review_id's state is ASSUMED monotonic (`CHANGES_REQUESTED` → maybe `DISMISSED`, never a cycle) | ASSUMPTION — the GitHub review model (a dismissal is terminal for a review_id; a re-request is a NEW review_id); UNEXECUTED, no live probe | ASSUMED (not firsthand-probed) — the presence-based pairing needs no time ordering. Its failure direction is UNDER-halt (§0a.3.1-safe). |
| The store records NO reviewer login (prose) | `review-outcome-store.js:80-83` (`STORED_KEYS` — no `login`) | CONFIRMED — the projection is per-`review_id`, NOT per-reviewer (GitHub's per-reviewer latest-state is uncomputable without login). A reviewer re-approving via a NEW review_id does NOT clear an old CR → a NAMED over-halt residual (halt-only NARROWS → safe). |
| The store ADMITS a `__proto__`-bearing repo segment | `review-outcome-store.js:110` (`validateRecord` accepts any 2-segment `O/R`); hacker probe readback `repos: __proto__/foo` | CONFIRMED — the grouping accumulators MUST be `new Map()` with composite STRING keys, never a nested plain object split on `/` (H3; mirror `project.js:108,313`). |
| Importing the store into the breaker makes A-2 the FIRST store consumer (the #524 dam flips) | `review-outcome-shadow.test.js` (import-graph dam) + Wave A-1 plan line 36 | CONFIRMED-by-design — the dam admits exactly this reader. A-2 evolves it from "zero readers" to "exactly one reader: the breaker source (starved, non-gating)"; keep the planted-importer non-vacuity probe. |

## The central design fork — is-this-ours provenance (BOARD-RESOLVED)

The store carries NO join field; the kernel join-key store is allowlist-locked to 2 readers; merge-outcome is
post-merge-only; the A0 map is Wave-B. **Board ruling (3/3): Posture 1** — build the source counting insider
`{OWNER,COLLABORATOR}` active reviews, mark it `starved: true` so a `requireLive` GATING consumer refuses it until
arming lands the join; is-this-ours = named arming-gate. Rationale the board confirmed firsthand:

- **Halt-only NARROWS (§0a.3.1)** — counting a non-ours review is a self-inflicted over-halt (availability), NEVER a
  capability grant. Integrity-safe by construction.
- **The residual cannot fire on real data this slice** — the A-1 observer is dormant until armed emission + a real
  external review coincide (scope probe, lines 24/37); the store holds no live producer records. The over-halt residual
  becomes real only at arming, which is exactly where the join becomes the gate.
- **While SHADOW + same-uid, is-this-ours grants nothing a same-uid actor lacks** (they can halt trivially anyway); it
  is a CROSS-UID concern that materializes at arming.
- Postures 2 (inert dam — a #524-store schema migration or A0) and 3 (build A0 first — Wave-B-sized) both violate "safe
  minimal Wave A-2" and touch the merged store the scope deferred.

## Files To Build / Modify

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/lab/circuit-breaker/project.js` | modify | **medium** | (a) Add the `changes-requested` `SOURCES` entry (`starved: true`). `require('../world-anchor/review-outcome-store')` at module-load (ENV-BEFORE-REQUIRE; lab→lab, acyclic — the store does not import the breaker). The entry's `list` is a THIN call to a NAMED module-level helper (F2, mirror `dedupBySubject`). (b) The helper `activeChangesRequestedDenials(records, nowMs)`: filter to `author_association ∈ CR_HALT_ASSOCIATIONS` (a NEW own frozen 2-element constant `['OWNER','COLLABORATOR']` — a deliberate 3rd duplication, NOT a derived filter of the store's `INSIDER_ASSOCIATIONS`; CR-LOW) applied to BOTH `CHANGES_REQUESTED` and `DISMISSED` records BEFORE pairing (H2); group by `(repo, pr_number, review_id)` [case-folded repo] in a `new Map()` (composite string key; H3 + VALIDATE HIGH — pairing by `review_id` ALONE let a cross-PR `DISMISSED` cancel an unrelated block); a tuple is ACTIVE iff it has a `CHANGES_REQUESTED` record and NO `DISMISSED` record for the SAME tuple; collapse ACTIVE tuples to one denial per `(repo, pr_number)` [case-folded] (a `new Map()` keyed by a `JSON.stringify([repo.toLowerCase(), pr_number])` composite; H3); emit `{persona: 'changes-requested', recorded_at: new Date(nowMs).toISOString()}` per blocked PR. Constant persona = bare `'changes-requested'` (NOT `kernel:`). Global-only. (c) Generalize the `requireLive` throw parenthetical at `:411` from "(its producer is probe-dead)" to a source-agnostic truth (e.g. "its producer is not a live safety signal") that reads honestly for BOTH `negative-attestation` and `changes-requested` (F1/H4). One-line string change; NO control-flow / view-shape change. |
| `tests/unit/lab/circuit-breaker/changes-requested-source.test.js` | **NEW** | low | State-count: a `CHANGES_REQUESTED`+`DISMISSED` pair for one review_id → NOT blocked; a MEMBER `CHANGES_REQUESTED` → NOT counted; a non-`{OWNER,COLLABORATOR}` `DISMISSED` does NOT cancel an insider CR (H2); 2 active reviews on one PR → 1 denial; `recorded_at = nowMs` (always in-window); `starved:true` (`evaluate({source:'changes-requested', requireLive:true})` THROWS with the generalized message); default source stays `verdict-fail`; `__proto__`-bearing repo does not poison the accumulator (H3); the forged-DISMISSED under-halt asserted as KNOWN behavior (H1); empty store / only-COMMENTED / DISMISSED-without-CR edge cases. |
| `tests/unit/lab/world-anchor/review-outcome-shadow.test.js` | modify | low | Evolve the import-graph dam: from "ZERO gating consumer" to "exactly ONE reader — the breaker `changes-requested` source, `starved:true` (non-gating under requireLive)". Assert no OTHER `listReviewOutcomes` reader; assert the source is registered starved; keep + re-verify the planted-importer non-vacuity probe (a planted 2nd reader still trips the scan). |

## Phases

1. **The `changes-requested` source + the named projection helper** (`circuit-breaker/project.js`, TDD: tests first). The `CR_HALT_ASSOCIATIONS` own constant; the both-states-narrowed, `new Map()`-grouped, per-review_id dismissal-aware, per-PR-deduped state projection; `recorded_at = nowMs`; `starved:true`; the generalized throw message. **Probe**: a `CHANGES_REQUESTED`+`DISMISSED` for one review_id → the PR is NOT blocked; a MEMBER CR → NOT counted; a MEMBER `DISMISSED` does NOT cancel an insider CR; two CRs on one PR → 1 denial; `requireLive` throws; the default source is still `verdict-fail`.
2. **The shadow dam evolution + signpost** (`review-outcome-shadow.test.js`). **Probe**: the dam admits exactly the breaker source (starved), rejects any other reader; the planted-2nd-reader non-vacuity probe still trips; `generate-signpost --check` clean.

## Verification Probes

| Probe | Pass criterion |
|---|---|
| 1 | `find tests/unit/lab -name '*.test.js' -print0 \| xargs -0 -n1 node` → all green (the new suite + the modified dam + the 62 pre-existing; the #524 store suite UNCHANGED — no store edit) |
| 2 | dismissal-aware: a review_id with a same-review_id `DISMISSED` is NOT active; the projection is per-review_id (login-free), presence-based (no time ordering) |
| 3 | auth-narrow BOTH states: a MEMBER `CHANGES_REQUESTED` is NOT counted; a MEMBER `DISMISSED` does NOT cancel an insider `CHANGES_REQUESTED` (H2) |
| 4 | `starved:true`: `evaluate({source:'changes-requested', requireLive:true})` THROWS (generalized message, honest for both sources); an advisory read (no requireLive) counts blocked PRs |
| 5 | opt-in: with no `LOOM_BREAKER_SOURCE`, the default resolves to `verdict-fail` (the source is inert unless explicitly selected) |
| 6 | global-only: the constant persona is bare `changes-requested` (no `kernel:`); the global cap gates |
| 7 | poison-key: a stored record with `repo='__proto__/foo'` does NOT corrupt the grouping accumulator (H3) |
| 8 | dam: the review-outcome store has EXACTLY one reader (the starved breaker source); no gating consumer under requireLive; the non-vacuity probe still trips a planted 2nd reader |
| 9 | full kernel suite green; `install --hooks --test` (minus the pre-existing plugin-cache drift); eslint/markdownlint/yaml 0; signpost + release-surface clean |

## Security invariants (from the scope's board + the VERIFY board, carried into this slice)

1. **C1-narrowed — the HALT authority is `{OWNER,COLLABORATOR}`, applied to BOTH states** (H2). The store keeps MEMBER for display/Wave-B; the BREAKER narrows. The narrow filters BOTH the `CHANGES_REQUESTED` and the paired `DISMISSED` — a non-`{OWNER,COLLABORATOR}` `DISMISSED` must NOT cancel an insider `CHANGES_REQUESTED`.
2. **Halt-only NARROWS (§0a.3.1)** — integrity-safe. Availability (DoS) is mitigated by global-only + opt-in/non-default + the existing windowed global cap + `starved` (no live GATING until armed).
3. **Two SYMMETRIC same-uid residuals, both back-to-baseline + §0a.3.1-safe while SHADOW, both re-examined at arming (cross-uid foreign-write refusal + the join are the gate):**
   - **over-halt** — an advisory read could count a non-ours review (is-this-ours unestablished).
   - **under-halt (H1)** — a same-uid writer plants a valid insider `DISMISSED` for a real `CHANGES_REQUESTED` review_id → the halt is suppressed. Confirmed live (both records coexist append-only; `state` is in the identity basis). A test asserts this KNOWN behavior.
4. **is-this-ours = named arming-gate** — `starved:true` refuses any `requireLive` gating consumer until arming lands the join.
5. **No prose, no back-date surface** — the source consumes only closed-enum GitHub-computed scalars; it uses NO timestamp for counting (state-count → `recorded_at=nowMs`), so `submitted_at`/mtime back-dating is irrelevant this slice.
6. **Poison-key safe (H3)** — `new Map()` accumulators, composite string keys (the store admits a `__proto__`-bearing repo segment).

## Out of Scope (Deferred)

- **Arming** — wiring the producer live + landing the is-this-ours join + flipping `starved:false`. Operator/deploy-gated. This slice ships SHADOW/starved.
- **Global-cap tuning (H5 / OQ-3)** — the DEFAULT global cap (10/window) is likely wrong for a SPARSE maintainer-review stream: ~10 legitimate insider `changes-requested` across the fleet would trip the global plane and self-DoS. MUST be tuned via `LOOM_BREAKER_GLOBAL_MAX_DENIALS` at arming. Separately, `listReviewOutcomes` has no record-count cap (unlike E1's `MAX_LEDGER_RECORDS`) — a record-count cap is an arming-time consideration. Both are inert while SHADOW.
- **Rung A0 / Wave B — per-persona halting** — needs the `join_key_id`→persona map (the persona is UNreachable from the join-key today). Global-only here.
- **Wave C — the re-solve Rubicon** — arming-gated; prose-containment = tool-inertness, NOT the secret-scrub. Far deferred.
- **Reviewer-supersession awareness** — clearing an old `CHANGES_REQUESTED` when the SAME reviewer re-approves via a NEW review_id. Needs the reviewer login (deliberately not stored — prose). The over-halt residual is NAMED + halt-only-safe.

## Drift Notes

- The scope's A3 said "mtime-windowed"; the VERIFY board showed mtime-windowing silently ages out a still-blocking review (the dedup-freeze — CR-1). Revised to a **state-count** (`recorded_at=nowMs`, presence-based), which is faithful to GitHub's merge-block state, simpler, and touches the merged store not at all. A plan-honesty correction driven by a firsthand code probe.
- `starved: true` is REPURPOSED (original semantic: "producer probe-dead"; here: "dormant-until-armed AND provenance-unestablished"). The board ruled: keep the boolean (KISS; a distinct `unprovenanced` flag is YAGNI — zero behavioral difference), generalize the throw message (F1).

## Pre-Approval Verification (3-lens VERIFY board — 2026-07-07)

`architect` + `hacker` + `code-reviewer` on the concrete plan (read-only). **All three: PROCEED-WITH-FOLDS; Posture 1: SOUND (3/3).** The board confirmed Posture 1 is the right minimal call (halt-only-NARROWS makes an un-provenanced over-halt integrity-safe; the store has no live producer this slice; `starved`+`requireLive` is the arming gate) and did NOT escalate. Folds baked into the settled design above:

- **CR-1 (code-reviewer, HIGH) — mtime freezes at first-observation.** A re-poll of a still-`CHANGES_REQUESTED` review DEDUPS without touching the file (`review-outcome-store.js:240-245`, `bodiesEqual` node_id-only), so its mtime never refreshes; an mtime-window ages out a genuinely-still-blocking review after ~one window. **Fold: make the source a STATE-count** — `recorded_at = nowMs` for each currently-blocked PR (CR's fold (a): "blocked as of this read", touches nothing in the merged A-1 store). This also drops the mtime-lister + the store change entirely and eliminates the back-date surface.
- **CR-2 (code-reviewer, HIGH) — the dam regex.** The pre-board plan added `listReviewOutcomesWithMtime`, which the dam's `READER_CALL_RE` (`/\blistReviewOutcomes\s*\(/`) would NOT match (silently vacuous). **Fold: MOOT** — the state-count uses the existing `listReviewOutcomes`, which the regex DOES match. The dam still evolves from zero readers to exactly-one-reader; the planted-2nd-reader non-vacuity probe is re-verified.
- **F1 / H4 (architect MEDIUM / hacker LOW) — the `requireLive` throw message** hardcodes "(its producer is probe-dead)", false for this source. **Fold: generalize the parenthetical** to a source-agnostic truth; keep the `starved` boolean (no distinct flag — YAGNI).
- **F2 (architect MEDIUM) — extract the projection** as a named module-level helper (mirror `dedupBySubject`), not a fat inline arrow in the `SOURCES` literal (SRP: the registry vs the algorithm). **Folded.**
- **H1 (hacker MEDIUM) — the forged-DISMISSED under-halt residual is unnamed.** A same-uid insider `DISMISSED` for a real `CHANGES_REQUESTED` review_id suppresses the halt; confirmed live (both coexist append-only). **Fold: named in §Security invariant 3 (symmetric to over-halt); a test asserts the KNOWN behavior.**
- **H2 (hacker LOW) — the `{OWNER,COLLABORATOR}` narrow must apply to BOTH states before pairing** (a non-insider `DISMISSED` must not cancel an insider `CHANGES_REQUESTED`). **Folded into the helper + a test.**
- **H3 (hacker LOW) — `new Map()` for grouping** (the store admits `repo='__proto__/foo'`); composite string keys, never a nested plain object split on `/`. **Folded + a poison-key test.**
- **H5 (hacker LOW) — arming-time global-cap self-DoS + uncapped store scan (OQ-3).** **Folded into §Out-of-Scope** as a named arming-time tuning.
- **CR-LOW — the `{OWNER,COLLABORATOR}` set is its own independently-declared frozen constant** (a 3rd deliberate duplication alongside `live-puller`'s `PR_INSIDER_ASSOCIATIONS` + the store's `INSIDER_ASSOCIATIONS`), NOT a derived filter. **Folded.**
- **F3 (architect LOW) — mtime-tuple freeze discipline: MOOT** (no mtime-lister in the settled design).
- **F4 (architect LOW) — rate-not-state naming: RESOLVED** by being an explicit state source.

## VALIDATE result (post-build 3-lens board — 2026-07-07)

`code-reviewer` + `hacker` (Rule 2a: 9 LIVE probes against the built modules) + `honesty-auditor` on the BUILT code. **All three: PASS-WITH-FOLDS.** The live-probe pass caught one HIGH the VERIFY board + the 16-test suite both missed — the Rule-2a value (a green suite is a hypothesis, not proof). Controls that HELD under probe: the remote off-switch (the store rejects a raw-written non-insider record on READ — `non-insider` alert — so it never reaches the breaker), the `__proto__` poison-key, and the generalized throw. Folds applied (build + tests re-green: source 19, lab suite 147/0):

- **HIGH (code-reviewer + hacker, both live-probed) — cross-PR `review_id` collision.** `byReview` was keyed on `String(review_id)` ALONE; the store does not enforce review_id-uniqueness across PRs (`node_id = hash(repo,pr,review_id,state)`). Probe: a `DISMISSED` for an UNRELATED `(repo,pr)` sharing a review_id dropped a real block 1→0; two active PRs sharing a review_id collapsed to 1. **Fix: key the pairing by `[repo.toLowerCase(), pr_number, review_id]`** (the store's full identity). Tests 17 (cross-PR dismissal does not cancel) + 18 (two shared-review_id PRs = 2 denials) lock it in. **SCAR-class: a grouping key NARROWER than the store's identity basis launders a cross-key.**
- **LOW (hacker) — repo case-variance inflate.** `Acme/Widgets` vs `acme/widgets` counted as 2 PRs (over-halt, §0a.3.1-safe). **Fix: case-fold the repo in BOTH keys** (folded into the HIGH fix). Test 19.
- **MEDIUM (code-reviewer) — the hysteresis latch is degenerate** (`latched === tripped`) because `recorded_at = nowMs`. This is CORRECT for a state source (no past threshold-crossing to hold; the halt clears when the block clears — no over-halt grace). **Fold: documented as intentional** in the helper comment (not a code change).
- **LOW folds (honesty-auditor):** the `evaluate()` return doc-enum now lists `changes-requested`; the G2 module header notes `starved` now carries two meanings; the monotonicity Runtime Probe row is relabelled an ASSUMPTION (failure = under-halt); test 8 now asserts the advisory-read COUNT, not just `source_starved`.
- **LOW (hacker) — the `LOOM_DISABLE_CIRCUIT_BREAKER` bypass wins over `requireLive`** for this source too (the documented CR-F3 operator override, byte-identical to all sources). No code change for SHADOW; an arming-time note: restrict who can set that env for the gating consumer (the same operator-only posture as the arming flags — folded into §Out-of-Scope arming).
