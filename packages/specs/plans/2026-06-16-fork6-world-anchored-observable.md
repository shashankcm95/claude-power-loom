# FORK-6 resolution — the world-anchored lesson observable

> Status: **RESOLVED (design) / OPEN (measurement)**. Produced by the `fork6-observable-design`
> workflow (`wf_023829f8-59f`: 4 candidate angles + an honesty-auditor adjudication) 2026-06-16.
> Feeds the north-star RFC (`2026-06-11-...`) honest-gaps 4+5 + OQ-NS-6/8, and the `ab-cobuild-scope`
> plan's FORK-6. NOT a build.
>
> **Workflow honesty note:** 2 of the 4 "candidate" designs were byte-identical reframes (the
> system-horizon angle == the counterfactual design; the honest-skeptic angle == the attribution
> design). The adjudicator caught this and did NOT count the reframes as corroboration. There were
> really 2 distinct designs. (Lesson: parallel design agents under a shared schema can collapse onto
> the same artifact; an explicit dedup/honesty check on the design SET is essential.)

## The question

What observable connects an INJECTED LESSON to a real external-maintainer-merge (the apex), such that
the lesson's contribution counts as HARDENING trust (OQ-NS-6) — not internal hit-rate, which only NARROWS?

## The verdict: DESIGN-solved, MEASUREMENT-inert (n=0)

- **The design question IS solved.** A correct world-anchored observable exists (below).
- **The measurement question is NOT solvable now** and is **inert by construction**: every
  world-anchored seam it needs is shadow/spike, fail-closed-empty, or unbuilt — n=0. It becomes
  measurement-solvable only with a **live external-PR beta** accruing a slow, sparse, multi-maintainer
  apex corpus over **months** — and even then only a FEW cells ever harden; the majority sit at
  INSUFFICIENT-N or overlapping-intervals indefinitely.

## The recommended observable — `lesson_merge_lift` (LML) + a deterministic site-probe

A **maintainer-judged differential A/B** (the only design whose dependent variable is the apex, and
whose contrast structure defeats the OQ-NS-6 trap by construction), with the attribution design's
**deterministic site-predicate** folded in as a mandatory in-arm correctness check.

- **Unit:** a `(lesson_signature × task-cell)` pair, where a cell is `(repo-family × trigger_class ×
  difficulty-bucket)` — the Fractal-trust reputation key lifted to the lesson level. NOT per-task (n=1
  is noise — the #86 finding) and NOT per-lesson-global (laundering cross-domain credit).
- **The contrast:** on a stream of real inbound external issues for a cell, interleaved **pre-registered**
  arms — TREATMENT (the blind `claude -p` actor with the retrieved lesson injected into `extraContext`),
  CONTROL (identical actor, no lesson), and a **PLACEBO** arm (an irrelevant lesson — kills the
  "tried-harder"/presence confound). Each arm's PR is opened on the real external repo (AI provenance
  disclosed) and the **apex event** (`external_maintainer_merge`) is read from the forge's authenticated API.
- **The observable:** the three-way merge-outcome delta — merge-rate lift (Wilson95), merge-latency
  (right-censored survival), revision-rounds. A cell **HARDENS** ONLY when treatment's Wilson95 is
  DISJOINT-above control AND placebo, the merge actor is authenticated **not-us**, the lesson rode the
  **signed** (`authenticatedEdgeIds`) lane, AND the lift holds across **multiple maintainers** (OQ-NS-8b).
  A positive lift with OVERLAPPING intervals **NARROWS** (consistent with no effect) — reported as such.
- **The in-arm correctness check (folded from Design 2 — the strongest anti-laundering mechanism):** a
  **deterministic site-predicate** over the merged diff + the corpus `fail_to_pass` decides whether the
  lesson's gotcha was AVOIDED. **LLM-as-judge is FORBIDDEN** for the AVOIDED call (the
  evaluation-under-nondeterminism discipline: safety-shaped calls use deterministic classifiers).

## Why it world-anchors (and where it would launder if mis-built)

It replaces `measureDiscrimination`'s `signature_hit_rate@1` (a same-system, model-graded number that
can only NARROW) with the **maintainer's merge decision** (external + adversarially-independent). The
DIFFERENTIAL is load-bearing: an absolute treatment merge-rate is contaminated by cell base-difficulty;
only the DELTA vs a real control arm on the same cell isolates the lesson's contribution. **The single
most dangerous over-claim** is letting the signed-edge + attribution machinery launder an internal
hit-rate (or a backtest, or a co-forgeable `confirmedNodeIds` edge) into a "hardening" claim — so LML
consumes ONLY the `authenticatedEdgeIds` lane (the first place a lesson weight GATES an action: which
lesson is injected → per security.md, the authenticated writer becomes mandatory there).

## Phased protocol

- **PHASE 0 — now (the honest fallback, the only runnable thing):** keep `measureDiscrimination` as a
  SHADOW **NARROWING** signal, honestly labeled. It is collision-gated (INSUFFICIENT-N below floor). Do
  NOT wire `authenticatedEdgeIds` into ranking/consolidation (forbidden until C-W2 re-mints under a key).
- **PHASE 1 — build (shadow), in this rough order:** (a) the **forge-observability component** (RFC
  honest-gap 4, UNBUILT) — poll `{open,merged,closed,changes-requested}`, classify non-merges (OQ-NS-1:
  merged / rejected-with-correction / ignored=right-censored / closed-for-scope), keyed on the durable
  PR-URL + head-sha anchor (never `run_id` — rotates at compaction, OQ-NS-3); (b) a **provisioned
  ed25519 signing key** + re-mint so `authenticatedEdgeIds` is non-empty; (c) a **kernel-owned injection
  minter** that signs an `injected-into` edge (the C-W1 edge primitive exists; the injector does NOT);
  (d) Design-2's **deterministic site-predicates** for the 3 D1-floor gotcha-classes (validated against
  known-good/known-bad merges; a bad predicate fakes avoidance); (e) promote `retrieve-signature.js`
  from `_spike` to a live retrieval seam.
- **PHASE 2 — measure (ONLY when a live beta opens real PRs at volume):** the cell-keyed interleaved
  C/T/Placebo A/B; aggregate per cell at N≥floor in BOTH arms; emit HARDEN only on the disjoint +
  authenticated-not-us + signed-lane + multi-maintainer gate. Feed the trust-weight ONLY on a HARDEN
  verdict, never raw merge count. Record null/overlapping results AS the result (no re-roll).

## Can claim / cannot claim

**CAN:** LML's contrast is (at the limit) the FIRST lesson-chain observable whose DV is the apex → can
HARDEN per OQ-NS-6; the deterministic site-probe is a real anti-laundering mechanism; the runnable-now
`measureDiscrimination` may be claimed as a **NARROWING** signal; a cell that clears all gates earns
"validated-external (n=1-cell)" — a FLOOR licensing reduced scrutiny on that exact injection.

**CANNOT:** claim FORK-6 hardens anything **today** (n=0, every seam shadow/unbuilt); claim the C-W1
minter "hardens" (its own header says it only raises the forgery bar); claim the `#316` real-e2e path
supplies external-merge data (it's a **backtest** → narrows); claim a single merge / positive
point-estimate hardens (the #86 single-draw fallacy); claim mechanism/line-level attribution
(provenance is spawn-level; WHY needs the unbuilt blame-retrace); claim cross-cell transfer or a global
skim from a hardened cell (harden is cell-local by construction).

## Prerequisites (the binding one is the live beta)

A **LIVE external-PR substrate** (the v3.9-style GitHub-issue→PR beta opening real PRs on real
third-party repos, AI-disclosed, at volume — RFC honest-gap 5); the forge-observability component
(gap 4); a provisioned signing key + re-mint; a kernel-owned injection minter; `retrieve-signature`
promoted to live; deterministic site-predicates authored + validated; an authenticated forge
identity-set (assert merge actor not-us, OQ-NS-8a); a multi-maintainer noise floor; a cell
pre-characterization step (cells confirmed failure-boundary by repeated cold draws before the A/B is valid).

## Strategic implication (the load-bearing finding for the phase)

**The binding constraint on the entire trust-hardening north-star is the LIVE EXTERNAL-PR BETA + forge
observability — NOT more lesson-layer machinery.** Per OQ-NS-6, the A+B "live pathway" (W3-W5) is
shadow machinery that only NARROWS; the TRUST that HARDENS (W6 / FORK-6) is gated on a months-scale,
world-facing capability that does not exist yet (RFC honest-gaps 4+5).

**The MECHANISM vs the TRUST (USER reframe 2026-06-16 — the decisive refinement).** The above is about
TRUST, not the MECHANISM. The hardening MECHANISM is **build-and-mock-verifiable NOW**, per the
beta-internal-verification mandate ("feature WORKS = proven INTERNALLY; live signal ONLY hardens TRUST;
MECHANICS FREEZE pre-live") and the v3.10-W2 precedent ("mock signal, `source==='mock'`, swaps for a
real one with ZERO new machinery validation"). We CAN feed the LML gate a MOCKED, quarantined external-
merge signal and internally prove: a QUALIFYING signal (disjoint Wilson95 treatment > control+placebo +
auth-not-us + signed-lane + multi-maintainer) flips the cell to HARDENED **as designed**, and a
non-qualifying signal (overlapping / self-merge / unsigned / single-maintainer) correctly WITHHOLDS.

Three boundaries keep this honest: (1) a mock proves **MECHANICS, never TRUST** — it NARROWS (OQ-NS-6);
the `source==='mock'` quarantine must prevent it ever being recorded as a real hardening or
contaminating the trust ledger (OQ-7 / #273 firewall). (2) The mock verifies only **up to the advisory
boundary** — the harden-verdict CONSUMER (`reputation-gate.js`) is itself shadow/unwired ("production
stays OPEN until a future enforcement wave wires it into selection; NEVER a hard exclude"), so the chain
provable now is signal → LML gate → HARDEN verdict → trust-weight → the gate's *advisory* recommendation,
NOT a live scrutiny-skip. (3) Only a real beta can confirm real merges reflect quality (the irreducible
n=0 part). **So the updated posture: build + mock-verify the hardening mechanism now (proves the
machinery end-to-end, honestly quarantined), leaving the live beta to supply only the SIGNAL/TRUST with
zero new machinery validation — better than pausing.** See the mock-verified-hardening build plan.
