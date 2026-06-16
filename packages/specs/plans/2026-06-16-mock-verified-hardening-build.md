# Mock-verified hardening build — prove the FORK-6 mechanism internally (MECHANICS, not TRUST)

> Status: **SCOPING** (pre-build, VERIFY-folded). Answers the USER reframe: "if hardening depends on an
> external signal, can we MOCK it and confirm that when the signal arrives, hardening occurs as
> expected?" — **YES**, per the beta-internal-verification mandate + the v3.10-W2 mock-swap precedent.
> Builds on FORK-6 (`2026-06-16-fork6-world-anchored-observable.md`) + the A+B scope.
> 3-lens VERIFY (`wf_2acc91cf-69b`) folded below — it caught 2 CRITICAL laundering paths pre-build.

## Goal

Build + **internally mock-verify** the FORK-6 hardening gate (`lesson_merge_lift`): prove that **when an
external-merge signal of a given shape arrives, the cell hardens (or correctly withholds) as designed**.
The real beta later swaps the mock for a true signal with the **gate logic unchanged** (the poller is
the only new component, validated when it lands). **This proves MECHANICS, never TRUST** (OQ-NS-6) — a
mock NARROWS; it hardens no real lesson. Honest only if the mock is physically quarantined.

## The chain to mock-verify (and where MV-W1 stops)

```
[synthetic arm-counts + mock confirmed-by edges, source='mock']   ← MV-W1's only inputs
   → the LML harden-gate (a PURE fn: counts+edges+verifyKey → verdict)
   → HARDEN | WITHHOLD | INSUFFICIENT-N verdict          ← MV-W1 STOPS HERE (gate verdict only)
   ┄┄ MV-W2: verdict → trust-weight → reputation-gate's ADVISORY recommendation (the honest ceiling) ┄┄
   ┄┄ a live scrutiny-skip is a SEPARATE future enforcement wave; NOT in scope ┄┄
```

**MV-W1 does NOT import or call `reputation-gate.js`** (honesty MED) — it ends at the gate verdict. The
advisory-boundary effect is MV-W2. A green MV-W1 matrix is NOT evidence the advisory recommendation moved.

## Where it lives + factoring (architect)

- The gate = a **new pure module** `packages/lab/causal-edge/lesson-merge-lift.js` (mirroring
  `consolidateLessons`'s pure shape) — NOT a `_spike` (it is the load-bearing swap target), NOT inside
  `lesson-consolidate.js` (SRP — different reason-to-change).
- Wilson score interval = a **small pure module** `packages/lab/causal-edge/wilson.js` with its own
  deterministic unit tests over known reference values (no Wilson helper exists in the repo today).
- The mock signal emitter sits **behind a FROZEN poller interface** the real forge-poller will later
  implement (drop-in swap; gate logic unchanged).

## The HARDEN predicate — a 3-valued verdict (condition 0 = the N-floor)

`evaluateHardenGate({ armCounts, edges, verifyKey, maintainers, avoided, placeboSignature, lessonSignature })`
→ `HARDEN | WITHHOLD | INSUFFICIENT-N`. **Admission first, then the conjunction:**

- **Condition 0 (N-floor, precedence over all):** each of treatment / control / placebo arm N ≥
  `PER_ARM_FLOOR` (a named constant; reuse the corpus collision-gate discipline). Below floor in ANY arm
  → **INSUFFICIENT-N** (NOT a withhold — "no data" is not a demonstrated decline; honesty LOW).
- **Admission (condition 3 as the SOLE eligibility filter, hacker MED):** the lesson is admitted ONLY if
  `authenticatedEdgeIds(edges, { verifyKey }).has(node_id)` — the C-W1 signed lane. An unsigned-but-
  confirmed lesson (present in the co-forgeable `confirmedNodeIds`) is **EXCLUDED at admission**, never
  late-ANDed. A missing/unloadable verify key → `authenticatedEdgeIds` is fail-closed empty → excluded
  (never "skip condition 3"). The gate **never** derives eligibility from `confirmedNodeIds` /
  `canEnterPredictorLane`.
- Then ALL must hold → **HARDEN**, else **WITHHOLD**:
  1. **Disjoint Wilson95**: `treatment.lower > control.upper` AND `treatment.lower > placebo.upper`
     (strict `>`; ties → WITHHOLD).
  2. **Auth not-us**: the merge actor is NOT on the self-denylist (mock-supplied in MV-W1 — see boundary).
  3. *(admission, above)*.
  4. **Multi-maintainer**: ≥2 **distinct** authenticated, not-us merging logins among the treatment
     merges (a dataset repeating ONE login N times must NOT satisfy this).
  5. **Gotcha AVOIDED**: the deterministic site-predicate (LLM-as-judge FORBIDDEN) — in MV-W1 supplied
     synthetically; the real predicate is MV-W3.
  - **Placebo independence**: `placeboSignature !== lessonSignature` — a placebo whose signature equals
    the treatment's is REJECTED as non-independent (the gate verifies it, never trusts the arm label).

## `## Statistical spec` (architect HIGH — pin the ambiguity)

- **Wilson score interval**, WITHOUT continuity correction (state it; the variant is fixed + cited in
  `wilson.js`), 95% (z=1.96). Pure `wilson(successes, n) → {lower, upper}`; tested vs known references.
- **Disjoint-above** = strict `>` on the bounds (tie at equality → not disjoint → WITHHOLD).
- **`PER_ARM_FLOOR`** = a named constant applied to ALL THREE arms independently (reconciles FORK-6's
  "both arms" with the 3-arm/placebo design — placebo is in the floor because it is in the disjoint test).
- **Multi-maintainer** = `new Set(treatmentMerges.filter(notUs).map(m => m.actor)).size >= 2`.
- **difficulty-bucket** = a documented deterministic fn (diff-size + file-contestedness proxy) so cells
  are reproducible (MV-W1 may stub it to a fixed bucket for the gate-logic matrix; the real bucketer is MV-W3+).

## Quarantine — bind to the EXISTING firewalls (architect HIGH-1 + hacker CRITICAL-1/2)

The quarantine store I'd proposed ALREADY EXISTS — do not fork a weaker copy:

- **Mock confirmed-by EDGES → a physically separate `recall-edge-mock/` dir** (reuse `recall-edge-store`
  with `opts.dir`; sign with an opts-injected throwaway key via C-W1 `signEdgeId`). **The mock path NEVER
  calls `runConsolidationPass` against the real/default edge dir** — closes the hacker CRITICAL-1
  laundering chain (`runConsolidationPass`→`confirmedNodeIds`[source-blind]→`recurrence_count_confirmed`
  →`retrieve-signature.opts.weights`). `recurrence_count_confirmed` is computed ONLY over real-dir,
  real-source edges. **Matrix row proves it: a mock edge present → the real-dir weight is unchanged.**
- **Any persisted mock outcome/signal → mirror `hardening-signal-store.js` faithfully** (source folded
  INTO the content-address via `deriveSignalId([..., source, ...])`; verify-on-read rejects
  `source!=='mock'`; read/write `recorded_at`-format parity per CodeRabbit #323; ENV-before-require). A
  bare field check is bypassable (hacker CRITICAL-2, the #273 "verify the field not the minter" class).
  **MV-W1's gate is PURE (counts in, verdict out) → it persists nothing**, so the only quarantine surface
  in MV-W1 is the mock EDGE dir; the signal-store mirror is named here for MV-W2+ when a verdict persists.
- **Key separation (hacker HIGH):** the MV-W1 test signing/verify keypair is injected via `opts`
  (`generateEdgeKeypair`), **NEVER** via `LOOM_EDGE_SIGNING_KEY`/`LOOM_EDGE_VERIFY_KEY`, and is a
  throwaway distinct from any real key — else a mock-signed edge passes the real verify path post-swap.

## The harden/withhold verification matrix (the deliverable that answers the USER's question)

Drives the pure gate with **synthetic arm-counts** (no live interleaver — that is MV-W4 / a live beta):

| Case | Input shape | Expected |
|---|---|---|
| qualifying | floor-met · admitted(signed) · disjoint-above control+placebo · not-us · ≥2 distinct maintainers · avoided · placebo≠treatment | **HARDEN** (gate verdict only) |
| overlapping | treatment Wilson overlaps control (at n=floor) | WITHHOLD |
| below floor (small-N p-hack) | a would-be-disjoint 2/2-vs-0/2 split, any arm N < `PER_ARM_FLOOR` | **INSUFFICIENT-N** (the floor defeats small-N p-hacking; NOT counted as a demonstrated withhold) |
| self-merge | merge actor on the self-denylist (Set OR array — coerced) | WITHHOLD |
| one login ×N / whitespace / case-variant | multi-maintainer fed one principal's repeats/variants | WITHHOLD (distinct-count <2 after trim+lowercase normalization) |
| wrong subject | edges signed for node A, gate queried for node B | **EXCLUDED** at admission |
| replay forge | a valid {edge_id,edge_sig} with a swapped from_node_id | **EXCLUDED** (authenticatedEdgeIds re-derives — MV-W1 VALIDATE CRITICAL) |
| non-independent placebo | `placeboSignature == lessonSignature` | WITHHOLD (rejected) |
| gotcha present | site-predicate = not-avoided | WITHHOLD |
| **unsigned admission** | lesson has a co-forgeable `confirmedNodeIds` edge, NO valid sig | **EXCLUDED at admission** (structural, not a late WITHHOLD) |
| **no verify key** | `verifyKey` absent | **WITHHOLD/excluded** (fail-closed; never HARDEN, never error) |
| **mock-edge isolation** | a mock confirmed-by edge in `recall-edge-mock/` | `recurrence_count_confirmed` over the REAL dir UNCHANGED (mock unreachable from the live weight) |
| **source tamper-on-read** | a persisted mock record hand-edited `source→real` | store returns `null` on load (content-address rejects) |
| **re-derived source forgery** | a fully self-consistent `source!=='mock'` record | rejected on both write and read |

Passing this IS the internal proof: harden-on-qualifying, withhold/exclude otherwise, INSUFFICIENT-N
distinct from withhold, and **mock can never launder into real trust**.

## Boundaries (carry to every PR + the ROADMAP)

- **MECHANICS not TRUST.** Every claim = "the machinery responds correctly to a signal of shape X" —
  never "a lesson is trusted." A mock NARROWS (OQ-NS-6). The C-W1 minter does not "harden" (its own
  header) — signed-lane eligibility is a CONDITION, not hardening.
- **Quarantine is content-bound** (`source` in the content-address) + physically separate dirs; a mock
  artifact must be physically unable to reach a real-trust consumer (the #273 / OQ-7 discipline).
- **MV-W1 ends at the gate verdict** — it does not touch `reputation-gate.js`; the advisory effect is
  MV-W2 (and a mock-derived weight must never carry reputation-gate's `source==='verdict-attestation'`
  mis-wire marker — the `source:'mock'` tag is the discriminator).
- **auth-not-us + multi-maintainer prove WIRING, not identity-authenticity** in MV-W1 (mock-supplied
  logins). The authenticated forge identity-set (OQ-NS-8a) is an MV-W4 prerequisite.
- **Swap contract:** the gate logic is unchanged across the mock→real swap; the poller is the only new
  component, validated when it lands (downgraded from "zero new machinery validation" — an unbuilt
  poller cannot yet be proven to need zero validation; honesty LOW). The swap changes the SIGNAL source
  + the key material only.

## `## Runtime Probes` (firsthand, gating the build)

1. Firewall references — read `hardening-signal-store.js` (`deriveSignalId` source-in-basis) +
   `recall-graph-store.js` (OQ-7 verify-on-read) before writing any quarantine code; mirror, don't re-derive.
2. The laundering path — confirm `runConsolidationPass`→`confirmedNodeIds`(source/sign-blind)→
   `recurrence_count_confirmed`→`retrieve-signature.opts.weights` (hacker traced it firsthand); the build
   must keep the mock edge dir off this path + add the mock-edge-isolation matrix row.
3. `authenticatedEdgeIds` end-to-end — opts-injected key: signed edge admitted, unsigned excluded,
   no-key → empty (fail-closed). (Already covered by C-W1 tests; re-assert in the gate's admission.)
4. Wilson reference values — `wilson.js` unit-tested vs known (successes,n)→(lower,upper) pairs.

## VERIFY board fold (2026-06-16 — `wf_2acc91cf-69b`)

architect + hacker **needs-revision** (NOT for the thesis — honesty graded the mechanics-not-trust
framing A-/airtight); all folded above:

| Lens | Sev | Finding | Fold |
|---|---|---|---|
| hacker | CRITICAL | mock confirmed-by edge launders into the real weight via `confirmedNodeIds` | mock edges → separate `recall-edge-mock/` dir; never consolidate vs real; mock-edge-isolation matrix row |
| hacker | CRITICAL | quarantine source-gate must be content-bound, not a field check | mirror `hardening-signal-store` `deriveSignalId` (source in content-address) + tamper/forgery matrix rows |
| architect | HIGH | the quarantine store already exists — don't fork | reuse `recall-edge-store` (mock dir) + mirror `hardening-signal-store`; cite both as references |
| architect | HIGH | condition-3 composition unpinned (no-key = skip?) | condition 3 = SOLE admission filter; no-key → exclude (fail-closed); opts-injected key |
| architect | HIGH | statistical gate under-specified | added `## Statistical spec` (Wilson variant, disjoint tie-break, floor on all arms, multi-maintainer rule, bucket fn) + a tested `wilson.js` |
| hacker | HIGH | test-key/real-key bridge via env | key injected via opts only, never env; throwaway, distinct from real |
| hacker | MED | predicate gameable (p-hack small-N, fake maintainers, non-independent placebo) | floor on all arms + small-N-flip row + distinct-login row + placebo≠treatment check/row |
| hacker | MED | unsigned lesson via `confirmedNodeIds` | admission filter = `authenticatedEdgeIds` only; structural exclusion row |
| honesty | MED | matrix "qualifying" row claimed "advisory reflects" (that's MV-W2) | MV-W1 stops at the gate verdict; row says HARDEN-verdict-only; reputation-gate untouched |
| honesty | LOW | "zero new machinery validation" asserted | downgraded to "gate logic unchanged; poller validated when it lands"; poller interface pinned |
| honesty | LOW | INSUFFICIENT-N not in the predicate | 3-valued verdict; condition 0 = N-floor; below-floor row not counted as a withhold |
| architect | MED | placement unanswered | `lesson-merge-lift.js` in `causal-edge/` (pure), not `_spike`, not in `lesson-consolidate` |
| arch/hacker | LOW | ENV-before-require dir hazard | quarantine dir via `opts.dir`; document the discipline |

## VALIDATE board fold (2026-06-16 — `wf_6930b01e-3b5`)

Post-build 3-lens (code-reviewer + hacker re-probed the BUILT code with live scripts + honesty).
**The hacker found a CRITICAL via Rule-2a live re-probe that the 12-test matrix missed** (it only fed
store-loaded edges — the mock-green-vs-real-path gap). honesty: **ship** (mechanics-not-trust airtight,
grade A-); code-reviewer + hacker **fix-then-ship** (the build is shadow/advisory so the forge can't
gate yet, but the fix must land before MV-W2 wires the verdict toward reputation-gate). All folded:

| Lens | Sev | Finding | Fold |
|---|---|---|---|
| hacker | CRITICAL | signature-replay forge: `authenticatedEdgeIds` verified the sig over `edge_id` but never re-derived it, so a valid `{edge_id,edge_sig}` with a SWAPPED `from_node_id` admitted an arbitrary target → HARDEN | `authenticatedEdgeIds` now `deriveEdgeId(e)!==e.edge_id → continue` (binds `from_node_id`); + a forge red-test in `lesson-confirm.test.js`. Hardens C-W1 too. |
| hacker | HIGH | admission soundness rested on an unstated "edges must be store-loaded" caller contract | the re-derive fix makes the lane self-defending for ANY array source (closes it) |
| code-reviewer | HIGH | a non-Set `selfDenylist` silently dropped → self-merge bypass | coerce array→Set (normalized); + a test |
| code-reviewer/hacker | MED | whitespace/case-variant logins inflated the distinct-maintainer count | normalize `trim().toLowerCase()` on maintainers + denylist; reject empty-after-trim; + tests |
| code-reviewer | LOW | no "wrong subject" (signed-for-A, queried-B) coverage | added the EXCLUDED-at-admission test |
| code-reviewer | LOW | `wilson(5,0)` / null inputs unasserted | added to the invalid-input battery |
| honesty | LOW | the isolation test name said `recall-edge-mock/` but used an anonymous tmp dir | point `mockDir`/`realDir` at literal `recall-edge-mock/`·`recall-edge/` paths |
| honesty | LOW | the plan's "small-N flips" matrix row wasn't built | reconciled the plan matrix to what's proven (below-floor INSUFFICIENT-N + overlap WITHHOLD) + added the replay/wrong-subject rows |
| hacker | LOW | DoS / small-N p-hack / mock→real isolation | CONFIRMATORY — all held (no change); the floor defeats the small-N p-hack, mock→real laundering disproven structurally |

## Recommended next step

Build **MV-W1** per the folded plan: TDD the pure `lesson-merge-lift` gate + `wilson.js` + the mock-edge
harness (separate dir, opts key) + the full verification matrix (incl. the laundering-isolation rows),
consuming the shipped C-W1 authenticated lane as the admission filter. Then 3-lens VALIDATE (hacker
re-probes the BUILT quarantine with live laundering attempts) → gate → PR (USER merge gate).
