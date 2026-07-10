---
title: "External Autonomous-SDE Pipeline — THE ANCHOR (reconciled blueprint)"
status: ANCHOR (canonical reconciled blueprint) — derives toward the north-star RFC; accretes as waves land
created: 2026-07-10
supersedes: packages/specs/research/2026-07-10-external-sde-pipeline-blueprint.md  # the pre-anchor draft, folded in
reconciled_against:
  - packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md            # the WHY / destination (OQ-NS series)
  - packages/specs/research/2026-06-25-autonomous-sde-lifecycle-gap.md           # the gap-map (rungs 1-6, Gap-7/8/9)
  - packages/specs/research/2026-07-09-live-dogfood-scoping.md                   # the Rung ladder + egress-armed emit
  - packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md
method: 4-lens parallel recon (2026-07-10) + firsthand read of all four sources
lifecycle: persistent
---

# External Autonomous-SDE Pipeline — THE ANCHOR

> Canonical reconciled blueprint for the external one-at-a-time autonomous-SDE pipeline: given an
> external code issue, drive it through ingest -> plan -> solve -> verify -> PR, then watch for the
> merge and turn the world's verdict into a lesson that improves the next run. This ANCHOR reconciles
> the USER-stated blueprint against the north-star RFC and the design record, resolves the open
> questions, marks every stage BUILT / NEW / MISSED with its owning module, and sequences the build.
> It derives toward the north-star (the WHY); it does not restate it.

## 0. Framing + the two USER corrections (load-bearing)

1. **World-anchored merges ALREADY EXIST.** `spec-kitty#2137` (first live external egress) and the PACT
   W5 sigma-root are real world-anchored signals. The pending milestone is NOT "the first world-anchored
   merge" - it is **the first merge driven end-to-end through THIS full pipeline** (with the architect-plan
   stage and the learning wire). Any "first world-anchored merge" phrasing anywhere is stale; correct it.
2. **Batch has no external value.** Batch was a useful internal stress-test (it found the timeout, the
   classifier, and the grade-oracle gaps). External repos run **ONE AT A TIME** so run N's confirmed
   lesson improves run N+1. **The learning-between-runs IS the point** - and its wire is the crux gap (§2, §7).

**The north-star law this whole doc serves (OQ-NS-6, RATIFIED):** the solve / grade / verify / emit
stack only **NARROWS** trust; **HARDENING** (a persona earning reduced scrutiny) comes ONLY from a
world-anchored merge (external maintainer, **or the USER**), post-PR. Every stage below honors this split.

## 1. The reconciled pipeline

Two phases. The synchronous phase is the Side-B factory (drives to emit); the asynchronous phase is the
Side-A merge signal (turns the world's verdict into a lesson). The seam between them is a durable,
PR-keyed attestation, not an in-memory handoff.

### Synchronous phase (one issue at a time)

```
target-select -> ingest -> architect PLAN -> review PLAN -> select+materialize PERSONA -> solve -> verify(FILTER) -> push PR
   (Gap-7)       (Stage-1)    (RFC Side-B step 2, NEW on live path)   (Stage-2: select BUILT / materialize MISSING)  (Stage-3)  (Stage-4)   (Stage-6 egress)
```

Two corrections to the draft's diagram, both load-bearing:

- **PERSONA is two steps, not one.** SELECT (a classifier exists, SHADOW) then MATERIALIZE (inline the
  brief + skills + instincts into the contained actor's prompt). A contained `claude -p` cannot resolve
  an `agentType` and cannot Read the thin `agents/*.md` stubs (ADR-0012: capability is static, resolved
  only for sub-agent spawns). Without the materializer the persona is **nominal, not activated** (the
  INSTINCT GAP: 0/19 `agents/*.md` carry instincts).
- **VERIFY is a FILTER, never a trust gate.** The actor cannot verify itself (circular). Verify =
  an INDEPENDENT read-only lens + a regression-check leg (the repo's own tests, a "doesn't-break" signal),
  and it only NARROWS. The REAL verify is the merge. This is the RFC's C1 clarity verbatim
  (filtering != hardening).

### Asynchronous phase (the merge is days-to-weeks later: a watch-loop, not a branch)

```
merge-observer (gh-verified, authenticated API, merger asserted NOT-us) reads the PR outcome:
   merged             -> CONFIRM the pending lesson (shadow); enter the correction-window
     (window elapses, still stable)  -> collapse-to-lesson + HARDEN-eligible (gated on the authenticated minter)
     (correction returns in-window)  -> RETRACE (the gold learning signal), NOT a tombstone
   changes-requested  -> REVISE / re-push (Rung-2; emitPR update seam) -> stays PENDING
   non-merge          -> CLASSIFY (OQ-NS-1): rejected-with-correction -> RETRACE
                                             ignored (missing data, NOT negative) -> DROP, no negative signal
                                             closed-for-scope (no signal)         -> DROP, no signal
```

The plan **cannot promise a merge** (honest-gap-1: the apex signal is slow, sparse, noisy). Claude drives
only to emit + engagement; the merge is the world's verdict.

## 2. The lesson lifecycle — reconciled (the biggest correction)

The draft's 2-state lifecycle (`PENDING -> CONFIRMED/HARDENED | DROPPED`) is **too coarse and hardens
too early**. Four reconciled corrections, each traced to a canon source:

- **CONFIRMED != HARDENED (gap-map `conflict-harden-vs-rung5`; #273).** A gh-verified merge makes a lesson
  **CONFIRMED (observed, shadow-recorded, honest)**. It does NOT **HARDEN** a production weight: the
  `weight-source-gate.LIVE_SOURCES = Object.freeze([])` firewall and the mock-only hardening store keep
  every live source out until the **authenticated edge minter** (item-5 / PR-A2) arms. Integrity is not
  provenance: a same-uid sidecar+edge co-forge inflates a shadow weight (#273), so a merge alone must
  never touch a weight. **merge -> CONFIRMED (shadow); HARDEN only post-arming.**
- **Split the evidence (north-star `OQ-NS-6-retrace-hardening`).** A corrected lesson is two layers:
  `bug = confirmed-external` (a maintainer fixed exactly these lines - may harden) and
  `attribution = inferred` (which decision produced them is a hypothesis - **NEVER** hardens as if it
  carried the maintainer's authority). The inferred layer may feed recall only as narrowing-only advisory.
- **The correction-window retention boundary (north-star `forgetting-correction-window`).** Retention is
  gated on the external signal SETTLING, not on the merge event: a clean merge can return with a
  correction weeks later, and the retrace needs the delta-trajectory breadcrumbs. Retain the trajectory
  (cheap, structural) while merged-but-in-window; collapse-to-lesson only at merged-AND-stable; route an
  in-window correction to RETRACE, not to a tombstone.
- **The non-merge classifier (north-star `honest-gap-1-nonmerge-classifier`; OQ-NS-1).** `terminal/stale
  -> DROP` conflates three classes. Only `rejected-with-correction` teaches (-> RETRACE); `ignored` is
  missing data (**not** a negative signal); `closed-for-scope` is no signal. A DROPPED lesson is never
  used as a negative signal.

Reconciled lifecycle (supersedes the draft's 2-state):

```
push -> PENDING
  merged -> CONFIRMED (shadow) --[window stable]--> collapse-to-lesson -> HARDEN-eligible (arming-gated)
                                --[in-window correction]--> RETRACE (bug=confirmed hardens; attribution=inferred narrows-only)
  changes-requested -> REVISE/re-push -> PENDING            (Rung-2)
  rejected-with-correction -> RETRACE
  ignored -> DROP (no negative signal)                      (observable tombstone, never a silent delete)
  closed-for-scope -> DROP (no signal)                      (observable tombstone)
```

**The retrace is UNBUILT-to-checkpoint (OQ-NS-5 caveat).** Blame localizes to the SPAWN (a squashed delta),
not to an intra-spawn checkpoint - per-create/change-point capture is a NEW mechanism. Until it is built,
the retrace anchors the maintainer's changed lines to the spawn, and stops there.

## 3. Stage-by-stage: BUILT / NEW / MISSED + owning module

| Stage | Canon identity | State | Owning module(s) |
|---|---|---|---|
| target-select (step 0) | Gap-7 intake PR-acceptance precheck | **NEW** (filter exists SHADOW/advisory; promote to a submit-time fail-fast) | `lab/issue-corpus/live-puller.js` (`hasExternalMergeHistory`); design `research/2026-07-04-intake-pr-acceptance-gate-design.md` |
| ingest | Stage-1 | **BUILT (live)** | `lab/persona-experiment/live-solve-one.js`, `fetchOneIssueRecord`, `live-puller.js` `pullLiveCorpus` |
| architect PLAN -> review PLAN | RFC Side-B step 2 | **NEW on the live path** (RFC already names it; live pipeline skips it). Reconcile replace-vs-feed vs the keyword classifier; review lens is read-only, never the actor | `/build-plan` + `/verify-plan`; independent review persona (read-only) |
| select PERSONA | Stage-2 classifier | **BUILT SHADOW** (behind `LOOM_PERSONA_MATERIALIZE`=off); low signal-coverage on the substrate class (D1) | `issue-classifier.js` (item-4, #443) |
| materialize PERSONA | Stage-2 materializer (INSTINCT GAP) | **MISSING** (contained actor cannot Read thin stubs) | needs a new inliner; `arm-compose.js` `composeArm` injects only the thin stub |
| solve | Stage-3 | **BUILT (live)** | `lab/persona-experiment/live-draft-run.js` (`prepareClone` -> `runActorInContainer` -> `captureActorDiff`); ContainerAdapter #346/#391 |
| verify (FILTER) | Stage-4 grade + RFC absorb-stack L0-3 + OQ-NS-7 | **PARTIAL**: shadow grade BUILT (consumed by nothing); regression-check leg **NEW**; independent review lens **NEW on live path** | `lab/persona-experiment/live-grade.js` (`gradeLiveIssueSemantic`, `behavioral:UNAVAILABLE`); regression-check runs inside the ContainerAdapter |
| push PR (Rung-1 same-owner) | Stage-6 egress | **BUILT (live, operator-armed)** | `kernel/egress/` (`emitPR` -> `armedEmit` -> `ghEmit`); same-owner flipped live in .2.5c |
| push PR (Rung-2 fork) | Stage-6 + F-W4 | **MISSING** (F-W1/2/3 DORMANT, F-W4 UNBUILT; `armedEmit` fail-closes on a populated `forkRepo`) | `emit-pr.js`, `gh-emit.js`; `OBJECT_SHARING_PROBE_RECORDED = false` (hard constant) |
| egress join-key (the seam) | rung-1 attestation | **BUILT (#447)** | `kernel/egress/` join-key (`pr_url/issueRef -> built_by, node_id, lesson_signature, base_sha`) |
| merge-observer -> CONFIRM | rung-2 / Stage-6; the Q1 MVP is a manual CLI (no poller) | **BUILT SHADOW** | `world-anchor/merge-observer.js`, `merge-outcome-store.js`; pending `live-pending-store.js` |
| disposal (DROP/tombstone) | Gap-9 | **PARTIAL** (today non-promotion, not explicit disposal; needs observable expiry) | `issue-corpus/terminal-block.js`, `causal-edge/live-disposal.js` |
| **learning wire (recall -> solve)** | Stage-5 -> Stage-3 [MAJOR] + rung-3 | **MISSING (the crux)**: recall machinery exists but no solve retrieves a lesson; `runLiveDraftLoop` has no recall step | `attribution/recall-graph.js`, `recall-graph-store.js`, `buildGroundingSlice` (built, reaches an actor only via the A/B experiment) |
| authenticated minter | item-5 / PR-A2 | **MISSING** (the #273 close; gates real HARDEN) | signed / kernel-writer edges; RFC-premature until a lab-derived weight names a real gate |
| production scheduler | item-8 Part-A | **MISSING** (nothing drives the one-at-a-time loop persistently) | none; `runLiveDraftLoop` reachable only from tests + `_spike/` |

## 4. The invariants the anchor encodes (hard rules, silent-in-the-draft)

Each is a rule the anchor MUST carry regardless of whether the draft named it.

- **A1 - Authenticated minter for CONFIRMED (H-ATK-1, #273).** The `PENDING -> CONFIRMED` transition is
  minted only by the authenticated merge-observer path (gh-verified / kernel-writer), never caller-asserted.
  A self-consistent-but-forged confirmed lesson must not enter recall.
- **A2 - Self-merge auth (OQ-NS-8a / H-ATK-4).** The merge event is read from the forge's AUTHENTICATED
  API with the merging actor asserted NOT-us; a self-merge or an unauthenticated "merged" state does not
  confirm. Sharpest for the fork-bot (the pushing identity must not be the merging actor).
- **A3 - Reference-class recall scope (individual x model x project x task-type).** A lesson confirmed on
  repo A / task-type T is eligible-to-harden only within (A x T). Cross-repo / cross-task it may inform a
  solve only as NARROWING-only advisory, never a hardening/skip. Separate general process lessons
  (target-select etiquette) from project-specific technical lessons in the recall index.
- **A4 - Durable attribution key (OQ-NS-3).** `issue -> spawn -> PR-URL/head-sha -> merge-event`, keyed on a
  durable anchor that survives `run_id` rotation + compaction (the async merge is days-to-weeks later).
  The pending-store and the merge-observer share this key.
- **A5 - Regression-check runs inside the ContainerAdapter (OQ-NS-7).** It executes untrusted external
  tests/build, safe only in the sandbox (#346/#391). Its output is a weak/gameable FILTER ("tests pass" =
  low in the Side-A hierarchy), never a hardening source.
- **A6 - Disposal is observable, never a silent delete (Gap-9).** Explicit expiry with a concrete
  staleness/timeout threshold; immediate dispose on a terminal-block; the tombstone is emitted, and it
  removes the durable `draft-*.json` + ledger residue (not just the ephemeral clone).
- **A7 - Recall targets the lab lesson axis, not kernel loom-recall.** The wire retrieves from
  `attribution/recall-graph` + `buildGroundingSlice` (the lab lesson layer), NOT the kernel `L_global`
  session-memory. The firewall + filter constraints attach to the recall-graph store.
- **A8 - The recall filter is ENFORCED, not advisory (OQ-NS-6).** The recall query hard-filters
  `lesson.state == CONFIRMED` and reference-class-scopes per A3. This single filter is what makes the
  learning wire OQ-NS-6-compliant. A `live` / `world_anchored` provenance enum must exist for a confirmed
  lesson to have a legal persistence path (today `ENUMS.provenance = ['backtest']` only).
- **A9 - Difficulty-weight the merge signal + a minimum-rigor floor (OQ-NS-2 / honest-gap-3 / OQ-NS-8d).**
  A merged 3-line typo teaches far less than a merged 200-line bugfix on a contested file; the confirmed
  signal is difficulty-weighted (diff size, file contestedness, issue labels). Target-select and verify
  never drop below a minimum stake-aware rigor floor, regardless of accrued track record.
- **A10 - Record the confirming signal-tier (OQ-NS-6 "or the USER").** USER-merge = strong (world-anchored,
  not independent); external-merge = apex (world-anchored + independent). Store the tier on the hardened
  lesson so a USER-confirmed lesson weights below an external-confirmed one. `validated-external (n=1)` is
  a floor, never proof.
- **A11 - Reviewer prose is untrusted, scrubbed per #273.** Maintainer/bot review text ingested on the
  revise loop is actor-adjacent untrusted input, scrubbed before it flows back through the materializer as
  `reviewContext`, never interpolated raw.
- **A12 - Claude / operator boundary (task_d722450d, verbatim).** Claude drives select / solve / stage /
  present ONLY. The operator alone arms (writes the custody ARM file, pins the custody token, signs the
  approval, runs the armed-emit entry) and merges. **Claude NEVER touches, reads, or stats `/etc/loom` or
  `/opt/loom`, sets an arming flag, writes the killswitch ARM file, or runs `--attested-cross-uid`.**
- **A13 - The four-way AND emit gate + shadow-dry-by-construction.** A live emit needs
  killswitch-off + custody token + disposition `live` + a valid signed human approval; `armedEmit`
  fail-closes on any populated `forkRepo`. The CLI path passes empty `opts` (`emitFn(data, {})`), so the
  pre-arm pipeline is `emitted:false` by construction: no argv/env can arm it. The signed approval binds
  `{repo, issueRef, diff}` at `approve-cli.js`, scoped to the exact diff.

**Design-record cross-checks (firsthand; the design-decisions recon lens returned a stub, gap-filled here):**
ADR-0012 (static capability) is the root of the materializer requirement (§3). OQ-21 observe-not-allocate:
the merge-observer OBSERVES the gh-verified event, never fabricates it (reinforces A1/A2). The
promote-disposition Option-B (human-gated, provisional, shadow-default) is why the whole HARDEN disposition
stays human-gated (reinforces A1). The review-board discipline supplies the "who verifies" answer (§5): the
plan-review + verify lenses are READ-ONLY personas, never the actor and never a Write-capable persona; a
diff touching kernel/security/auth/data-mutation gets the 3-lens tier, with the hacker re-probing the BUILT
diff at VALIDATE (a green suite is not proof).

## 5. Resolved open questions

- **Recall-filter enforcement (was MISSED #1).** RESOLVED: promoted to invariant A8 (hard-filter
  `state==CONFIRMED` + reference-class scope A3), backed by A1 (authenticated minter) and A7 (correct axis).
- **Who verifies + who reviews the plan.** RESOLVED: an INDEPENDENT read-only lens, never the actor
  (review-board discipline); high-stakes diffs get the 3-lens tier. At Rung-1 the **USER-reviewer IS the
  grade oracle** (the internal blind judges refuse unconfigured, per colophon); the regression-check is only
  a supplementary doesn't-break signal. Full autonomy / Rung-2 self-verify needs a configured out-of-band oracle.
- **Staleness / disposal policy (was MISSED #5).** RESOLVED: invariant A6 (observable expiry + concrete
  threshold + immediate dispose on terminal-block).
- **Fork gating (Rung-2).** RESOLVED as a sequenced prerequisite chain (§6/§7): operator-gated F-W3/F-W2
  sandbox probes -> record the object-sharing probe -> build F-W4; a classic `public_repo` PAT for the
  fork-bot (fine-grained PAT + GitHub App tokens cannot open a cross-repo PR); all build-when-arming.
- **One-persona vs a DAG-of-personas (north-star `thin-PM-bulkhead-factory-scope`).** RESOLVED for the beta:
  **one issue = one persona** is the deliberate MVP simplification, so the thin-PM bulkhead, the
  requirement->commit coverage ledger (OQ-NS-5), and the OQ-NS-7 assembled-tree gate are **explicitly
  out-of-scope for the external one-at-a-time pipeline** and are named as the multi-persona-factory
  escalation (a later phase). The cold-start amplification-control win the RFC attributes to the bulkhead
  is, in the one-persona case, covered by the verify FILTER + the review lens instead.
- **CONFIRMED vs HARDENED.** RESOLVED: invariant A8 + §2 - merge -> CONFIRMED (shadow); HARDEN is
  arming-gated on the authenticated minter (A1).

## 6. The rung ladder + the Claude/operator boundary

| Rung | What | Merge HARDENS? | New build for the emit? | Reachable |
|---|---|---|---|---|
| **0** | Keep SHADOW `live-solve-one` dogfoods running on real mergeable repos (free friction-finding) | no (shadow) | none | now; standing/always-on |
| **1** | Live emit to a **USER-owned** repo; the **USER merges** | **yes** (OQ-NS-6 "or the USER"; strong tier) | **none** (same-owner emit is BUILT) | now, on operator arming |
| **2** | Live emit to a **stranger** upstream; an **external maintainer merges** | **yes** (apex tier) | **F-W4 fork path** + revise loop + fork-bot PAT | deferred (build-when-arming) |

The draft framed the entire push-PR path as fork/external (Rung-2) and skipped Rung-1. **Corrected: Rung-1
(same-owner, USER merges, no fork, already built) is the reachable minimal-viable apex and sequences
first.** The `hasExternalMergeHistory` target gate, the revise loop, and the `public_repo` PAT are
Rung-2-only requirements, not universal. Rung-0 runs regardless of the rung-1/2 choice.

**Claude's autonomous boundary is steps 1-3 (select, solve, stage, present).** Everything from arming
onward is operator/world (A12).

## 7. The sequenced build

The ordering separates what is buildable in SHADOW now (no arming, no Rubicon) from what is arming-gated.
The rung-1 egress join-key (#447) is the already-built universal prerequisite for every world-anchored signal.

**Wave A - buildable in SHADOW now (the prerequisites for a real learning one-at-a-time run):**

1. **target-select / intake gate (Gap-7).** Promote `hasExternalMergeHistory` from a SHADOW/advisory filter
   to a submit-time fail-fast-and-dispose gate. Cheapest, unblocks everything, prevents the colophon
   dead-end. Feeds Gap-9 disposal.
2. **architect PLAN -> review PLAN (RFC Side-B step 2 on the live path).** Wire a plan stage before the
   contained solve; the plan informs persona selection (subsumes the low-signal keyword classifier). The
   review lens is an independent read-only persona.
3. **persona SELECT + MATERIALIZE (rung-4 both halves).** The classifier exists (SHADOW); build the
   materializer that inlines brief + skills + instincts into the contained actor's prompt (closes the
   INSTINCT GAP so the persona is activated, not nominal).
4. **the learning wire (the crux).** Mint a live lesson in `runLiveDraftLoop` (rung-3: `captureLessons` +
   a `live`/`world_anchored` provenance enum + a live recall store) AND retrieve CONFIRMED-only,
   reference-class-scoped lessons into the solve prompt (Stage-5 -> Stage-3). Enforced recall filter (A8),
   advisory/narrows-only until the authenticated minter arms.
5. **production scheduler (item-8 Part-A).** The one-at-a-time driver that sequences runs and threads run
   N's CONFIRMED lesson into run N+1. Internally buildable, SHADOW.
6. **merge-observer MVP as a manual `record-merge` CLI** joining on the #447 join-key (no poller/webhook),
   plus the non-merge classifier (OQ-NS-1) and observable disposal (A6). The retrace stage (spawn-granular
   until OQ-NS-5 checkpoint capture is built).

**Wave B - arming-gated / build-when-arming (HELD per the beta-internal-verification mandate):**

7. **authenticated edge minter (item-5 / PR-A2, the #273 close).** Only after this does HARDEN harden; ships
   a live token into `LIVE_SOURCES`. Build WHEN arming.
8. **the revise loop (Gap-8, Rung-2 prerequisite).** `emitPR` UPDATE seam + review-observer +
   `reviewContext` through the materializer (scrubbed, A11) + extend the frozen `['merged']` outcome enum.
9. **F-W4 fork path (Rung-2).** Operator-gated F-W3/F-W2 sandbox probes -> record the object-sharing probe
   -> build F-W4; provision the fork-bot `public_repo` PAT. Then the operator arms + merges.

Wave A is entirely SHADOW and dogfoodable at Rung-0 (dry) on real repos to surface friction before any
live emit. The live Rung-1 emit is the operator step at the end of Wave A; Rung-2 is Wave B.

## 8. Reconciliation ledger (provenance)

CONFLICT = the draft contradicts the canon; GAP = the canon raises what the draft omits; CONSTRAINT = a hard
rule the anchor encodes. Source: NS = north-star RFC, GM = gap-map, DF = dogfood-scoping.

| # | Class | Point | Anchor resolution | Src |
|---|---|---|---|---|
| C1 | CONFLICT | "merged -> HARDENED" is premature | §2 + A8/A1: merge -> CONFIRMED (shadow); HARDEN arming-gated | GM |
| C2 | CONFLICT | 2-state collapses the retrace evidence-split | §2: bug=confirmed hardens / attribution=inferred narrows-only | NS |
| C3 | CONFLICT | hardens/tombstones AT merge, no correction-window | §2: retain trajectory until merged-and-stable; in-window correction -> retrace | NS |
| C4 | CONFLICT | whole push-PR framed fork/external, skips Rung-1 | §6: Rung-1 (same-owner, built) sequences first | DF |
| C5 | CONFLICT | `hasExternalMergeHistory` applied universally | §6: Rung-2-only; Rung-1 the USER owns the repo | DF |
| C6 | CONFLICT | revise loop as a universal NEW build | §7 Wave B: Rung-2 prerequisite; Rung-1 first-shot-only | DF |
| C7 | CONFLICT | observer "polls the PR" | §7.6: manual `record-merge` CLI MVP (no poller) | GM |
| G1 | GAP | non-merge classifier (OQ-NS-1) | §2: rejected-with-correction/ignored/closed split | NS |
| G2 | GAP | thin-PM bulkhead / multi-persona factory dropped | §5: one-persona MVP; factory is a later escalation | NS |
| G3 | GAP | no difficulty-weighting (Goodhart) | A9 | NS |
| G4 | GAP | no confirming signal-tier | A10 | NS |
| G5 | GAP | persona MATERIALIZER / INSTINCT GAP | §3 + §7.3 | GM |
| G6 | GAP | #273 scrub on reviewer prose + 3 revise sub-parts | A11 + §7.8 | GM |
| G7 | GAP | join-key is the push-PR<->observer seam (BUILT #447) | §3 (named as the seam) | GM |
| G8 | GAP | live-solve trust-ledger / agentId unrecorded | §3: unrecorded-by-design until the persona/materializer wire lands | GM |
| G9 | GAP | production scheduler (item-8 Part-A) | §7.5 | GM |
| G10 | GAP | architect-PLAN is NEW; replace-vs-feed the classifier | §7.2 (plan-first subsumes the keyword classifier) | GM |
| G11 | GAP | Rung-0 (keep shadow dogfoods) omitted | §6 (standing/always-on) | DF |
| G12 | GAP | fork-bot needs a classic `public_repo` PAT | §7.9 | DF |
| G13 | GAP | F-W3/F-W2 + object-sharing probe precede F-W4 | §7.9 | DF |
| G14 | GAP | shadow-dry-by-construction not encoded | A13 | DF |
| A1-A13 | CONSTRAINT | see §4 | encoded in §4 | NS/GM/DF |

## 9. Method + provenance

Reconciled via a 4-lens parallel recon (2026-07-10): `architect` lenses over the north-star RFC, the
gap-map, and the dogfood-scoping doc; a `code-reviewer` lens over the design decisions. Three lenses
returned substantive findings (folded above). The design-decisions lens returned a schema-valid **stub**
(the flat schema enforced shape, not substance) despite doing the grep work; its target (#273, ADR-0012,
promote-disposition, OQ-21, review-board) was **doubly covered** by the north-star lens (`H-ATK-1`,
`OQ-NS-8a`) and the gap-map lens (`conflict-harden-vs-rung5`, reviewer-prose #273), with the residue
gap-filled firsthand (§4 cross-checks). Workflow-reliability note: a StructuredOutput schema validates
shape, not content - a critical lens needs a spot-check of its return, or a min-substance guard.

The USER-stated blueprint (folded in from the pre-anchor draft) was structurally sound: its sync/async
split, its "verify is a filter", and its "only confirmed lessons feed recall" instinct all survived every
lens. The reconciliation sharpened four things the draft under-modeled - the CONFIRMED/HARDENED split, the
retrace + correction-window, the non-merge classifier, and the Rung-1-first sequencing - and encoded the
13 invariants the draft was silent on.
