# Autonomous-SDE Lifecycle: Vision-to-Product Gap Map

Status: research (as-is map for v-next planning). Firsthand codebase audit (8-agent workflow) with an
honesty-auditor pass; findings cross-checked against this session's live egress run (spec-kitty#2137).
Date: 2026-06-25.

> **STATUS ACCRETION (2026-06-29 — post phase-close of the capture-wire arc):** Items 1, 2, 3 + the
> item-3-live sub-ladder are now **BUILT (SHADOW, weight-inert)** — this map's original "MISSING (grep=0)"
> ratings for them are SUPERSEDED, not rewritten (the original analysis stands as the pre-build snapshot).
> Built via #447 (egress join-key) -> #451 (gh-verified merge-observer) -> #452 (rebind + unify mint) ->
> #454 (live-solve capture) -> #455 (mint-side captured floor) -> #456 (emit-side attest-from-capture
> producer) -> #457 (leg 1, the real `claude -p` deriver; `lessonLegFn` null->real on the live-run path).
> The whole arc stays production-INERT: `LIVE_SOURCES=Object.freeze([])`, the edge is UNSIGNED, no weight
> reads the captured signal. **STILL GENUINELY MISSING** [**STATUS CORRECTION 2026-07-03**: ~~item 4~~ was
> a STALE listing — item 4 (issue->persona classifier + materializer) was ALREADY built + merged in **#443
> `2a4c1d7`** when this MISSING list was written (a `drift:recon-depth` self-catch); it is SHADOW-wired behind
> `LOOM_PERSONA_MATERIALIZE` (off), behavioral activation deferred. The open item-4 delta = classifier
> signal-coverage + a telemetry aggregator (this wave). STILL missing:]
> item 5's authenticated cross-uid edge signer (**PR-A2** — the real #273 close; RFC-premature per OQ-2
> until a lab-derived weight names a real gate), item 8 (production scheduler). Phase-close sign-off:
> `docs/ROADMAP.md` + library `toolkit/phase-close/capture-wire-close`.

## Why this exists

The thesis under test (USER): *"most underlying components are built; they need to be wired together so the
PR lifecycle runs issue ingestion -> persona mapping (skills + KB) -> thoughts/memories as lessons + file
deltas captured -> the final merge backtracks to harden/narrow/discard the substrate."* This maps the lifecycle
stage by stage with an evidence-required maturity rating, to separate what is built from what only looks built,
and to name the specific wires that are missing.

## Headline

The thesis is **half-true, and the wrong half is load-bearing.** The per-stage *pieces* mostly exist as real,
CI-tested code, and the EGRESS arc is genuinely built and proven live. But:

1. **Two stages are not "unwired components", they are grep-confirmed MISSING**: the Stage-2 issue->persona
   classifier, and the Stage-6 merge-event ingestor plus the egress join-key. These are the load-bearing finding.
2. **The learning substrate's inertness is partly DELIBERATE.** `weight-source-gate.LIVE_SOURCES = Object.freeze([])`
   and the backtest-only provenance firewall are intentional dams built to keep mock signals out of production until
   a world-anchored merge exists (OQ-NS-6). That is discipline (observe-first, harden-later), not incompleteness.
3. **The live loop mints zero lessons and carries no persona.** So the net state: the substrate can **act** (emit a
   real PR) but cannot **learn from the world**, and it is open exactly where the north-star says trust must be
   earned, the return path from a maintainer merge.

So "wiring alone" cannot close the loop: there is no return path from a merge, no live lesson to harden, and no
persona attribution on the live solve.

## The lifecycle at a glance

| Stage | Status | One-line |
|---|---|---|
| 1. Issue ingestion | PARTIAL | `pullLiveCorpus` is real + hardened, but **no production entry point calls it**; live runs use a hand-authored seed manifest. |
| 2. Persona mapping | **MISSING** (classifier) + PARTIAL (injector) | **No issue->persona classifier exists** (grep=0); the live actor gets a bare prompt with no `agentType`. |
| 3. Solve + lessons + deltas | PARTIAL | File **delta is real** on the live path (`captureActorDiff`); the live loop mints **zero lessons** (lesson machinery runs only in the sealed backtest harness). |
| 4. Grade / verdict | PARTIAL | Real oracle-bearing grader exists for the sealed corpus only; the live grade is an **honest shadow marker** (`behavioral: UNAVAILABLE`) consumed by nothing. |
| 5. Memory / recall | PARTIAL | Persist works (backtest nodes on disk, verify-on-read, OQ-7 firewall); **retrieve-and-apply never reaches the external-issue actor**. |
| 6. Merge -> harden/narrow/discard | **MISSING** + mock-by-design | **No merge ingestor, no egress join-key** (grep=0); the harden gate runs on synthetic counts; the terminal admit-set is frozen-empty by design. |

## Genuinely BUILT (real code on a live path)

- **Egress arc** (`packages/kernel/egress/`, 16 files): `emitPR` -> `armedEmit` -> `ghEmit` -> broker-sign + custody
  verify. **Live and proven** (spec-kitty#2137, the first live network egress, this session). Caveat: it persists
  **no** lesson / node / persona join-key, and its in-repo comments are stale (see Caveats).
- **`captureActorDiff`** (`_clone-lifecycle.js:297`): hardened git-plumbing file-delta capture; the one genuinely-live
  Stage-3 product.
- **Live puller** (`live-puller.js:212` `pullLiveCorpus`): real, security-hardened (GET-pin, slug guard, license /
  PR-capable / unassigned filters). Built; see PARTIAL for the missing caller.
- **Recall-graph populator + store** (`attribution/recall-graph.js`, `recall-graph-store.js`): content-addressed node
  minting, the v3.11 lesson layer, verify-on-read, the OQ-7 backtest-only firewall. Real, exercised by the backtest path.
- **3-legged grader** (`calibration-issue.js:174` `scoreAttempt`): genuine fix-oracle (leg-A behavioral over
  `test_patch`/`fail_to_pass`), over the sealed corpus only.
- **Verdict-attestation store + reputation projection** (`verdict-attestation/store.js`, `reputation/project.js`):
  built, hardened, fed by a live producer (Rule-4 record-review on **delegated HETS builds**). MECHANISM proven; the
  DATA is the gap. Subject is a delegated builder spawn, structurally disjoint from the live external solve.
- **`route-decide.js`**: built + used as a `route`/`root` team-spawn gate. It does **not** emit a persona identity and
  is never consulted on the issue->persona path.

## PARTIAL / MOCK (built but unwired, or inert by design)

Split the "mock" cases, because they are not the same thing:

**Mock-by-design (deliberate dams, a sign of discipline):**
- `weight-source-gate.LIVE_SOURCES = Object.freeze([])` (`:37`): frozen-empty so **no production source admits a
  weight** until an authenticated world-anchored signal exists. Intentional.
- `gradeLiveIssueSemantic` (`live-grade.js`): honestly oracle-free (`behavioral: UNAVAILABLE`, `shadow: true`, never a
  gate). A truthful absence-of-oracle marker, not a placeholder.
- `hardening-signal-store.js`: physically rejects any non-`mock` source on write AND read. The mock-only firewall.

**Partial (built, but not wired into the live lifecycle):**
- `pullLiveCorpus` + `runLiveDraftLoop`: reachable only from tests and `_spike/live-draft-dogfood.js`; **no production
  entry point**. `runLiveDraftLoop` feeds the record to a **bare actor** (`buildActorPrompt(record)` with no persona).
- `composeArm` (`arm-compose.js:69`): the one persona injector, exercised by the A/B/C experiment over the SEALED
  corpus with a **hardcoded** persona; never threaded on the live path, and it injects only the thin delegation stub.
- `buildGroundingSlice` (recall retrieval): real, but reaches an actor only via the A/B experiment, never the
  external-issue actor.

## MISSING (grep-confirmed zero, the load-bearing findings)

1. **Issue->persona classifier** (`issueToPersona`/`selectPersona`/`classifyIssue`): grep = 0. `route-decide` emits
   `route`/`root`, not a persona.
2. **Persona-prompt materializer**: a component that **inlines** the persona brief + skills + instincts into the
   contained actor's prompt. The contained tool-restricted `claude -p` has no Agent-tool resolution and cannot Read the
   thin `agents/*.md` stubs, so injection-by-reference (`composeArm`) is insufficient. This is the INSTINCT GAP
   (0/19 `agents/*.md` carry instincts).
3. **Egress join-key attestation**: `emitPR` persists no `(pr_url/issueRef -> built_by, node_id, lesson_signature,
   base_sha)` record. grep `node_id|lesson_signature|built_by` over `kernel/egress` = 0. **A merged PR has nothing to
   key back to.**
4. **Merge-event ingestor / world-anchor consumer**: grep `merged_at|prMerged|onMerge|maintainer.merge` over
   `packages/` = 0 non-comment hits. The entire return path of the loop does not exist.
5. **Live lesson minting on the live loop**: `runLiveDraftLoop` never calls `captureLessons`; the diff is graded
   (shadow) and emitted, then discarded.
6. **`live`/`world_anchored` provenance + a live recall store**: `ENUMS.provenance = ['backtest']` only
   (`corpus.js:47`); a world-anchored lesson has no legal persistence path.
7. **Authenticated edge minter** (signed / kernel-writer edges): required before any live source can safely enter
   `LIVE_SOURCES` (integrity is not provenance; a same-uid sidecar+edge co-forge inflates the shadow weight, #273).
8. **Production entry point / scheduler**: nothing drives `pullLiveCorpus -> runLiveDraftLoop` on a persistent path.

## The wiring gaps, ranked

- **[BLOCKER] Stage 6 -> Stage 5 (merge -> harden):** no merge ingestor + no egress join-key, so a maintainer merge is
  structurally un-observable and un-attributable. The loop is open exactly where OQ-NS-6 says trust is earned.
- **[BLOCKER] Stage 1 -> Stage 2 (issue -> persona):** no classifier; the record wires straight into a bare tool-less
  `claude -p`, the exact "NOT a bare headless claude" anti-pattern the vision names.
- **[MAJOR] Stage 2 -> Stage 3 (persona -> activated solve):** even with a selected persona, the only injector feeds a
  stub the contained actor cannot follow; the instincts are never injected. Needs the materializer.
- **[MAJOR] Stage 3 -> Stage 5 (live solve -> lesson):** zero lessons minted; three firewalls (sealed-oracle
  eligibility, backtest-only provenance, unauthenticated `built_by`) keep lessons off the live track.
- **[MAJOR] Stage 5 -> Stage 3 (retrieve -> future solve):** the external actor receives zero retrieved memory.
- **[MAJOR] Stage 4 -> trust ledger:** the live shadow verdict is never recorded; the bare actor produces no
  `agentId`, which `recordVerdict` requires.
- **[MAJOR] harden -> production ranking:** `LIVE_SOURCES` empty by design; needs a live token **and** the
  authenticated minter.
- **[MINOR] harden -> spawn selection:** `reputation-gate.recommendNarrowing` has no live caller; the breaker is shadow.
- **[MINOR] no production trigger:** the cheapest standalone unlock.

## The two questions, answered firsthand

**Q1, manual merge-notify as the observer.** Yes, it is the correct MVP and the highest-leverage cheapest unlock,
**but it requires the egress join-key first** (gap #3). The blocker is not the harden math (`evaluateHardenGate` is
built); it is that a merged PR has nothing to key back to. Sequence: (1) make `emitPR` write the join-key attestation
at emit time (additive, on the already-live egress path); (2) a human-invoked `record-merge --pr <url> --outcome
merged|closed` CLI that joins on it. No webhook or poller needed. Two honest caveats: `LIVE_SOURCES` stays empty until
the authenticated minter exists (so the observer records honestly but the signal stays shadow, which is the desired
observe-first posture), and the first merges will have a `built_by`/`base_sha` attestation but no `lesson_signature`
yet (because the live loop mints no lessons), which is fine, it proves the return wire on real data and surfaces the
next gap empirically.

**Q2, persona vs headless.** It is an **unbuilt wire, not a deliberate choice**, with one architectural nuance: a
top-level `claude -p` cannot take an `agentType` (Agent-tool persona resolution fires only for sub-agent spawns,
ADR-0012), so you cannot enable personas with a flag. Three distinct pieces are missing: the **classifier**
(issue -> agentType, does not exist), the **selection wire** (never threaded on the live path; `composeArm` is wired
only in the experiment with a hardcoded persona), and the **activation depth** (the INSTINCT GAP, the `agents/*.md`
are thin stubs a contained actor cannot Read). Closing it properly needs a classifier plus a persona-prompt
materializer that inlines brief/skills/instincts, not merely a new call site, otherwise the persona is nominal, not
activated.

## The bridge plan (dependency-ordered)

1. **Egress join-key attestation.** `emitPR` persists `(pr_url/issueRef -> built_by, node_id, lesson_signature,
   base_sha)` at emit time. Additive, on the live egress path. Prerequisite for every world-anchored signal. Unblocks Q1.
2. **Manual merge-notify observer (the Q1 MVP).** `record-merge` CLI joining on #1, writing a real merge-outcome
   record. Depends on 1.
3. **Live lesson minting.** Call `captureLessons` in `runLiveDraftLoop`; add a `live`/`world_anchored` provenance enum,
   a live recall store, and an oracle-free eligibility path. First world-anchored learnable artifact. Depends on 1, 2.
4. **Issue->persona classifier + persona-prompt materializer.** Closes the Stage-2 classifier and the INSTINCT GAP so a
   lesson attributes to a real (not nominal) persona. Depends on 3.
5. **Authenticated edge minter + ship a live token into `LIVE_SOURCES`.** The #273 close; only after this does HARDEN
   actually harden. Depends on 2, 3.
6. **MV-W4 live arm-count interleaver + wire reputation/breaker into production spawn selection.** Turns the manual
   observer into a continuous differential producer and lets a hardened reputation change spawn decisions. Depends on
   1, 2, 4, 5.

## STATUS ACCRETION (2026-07-04) — three world-contact rungs (7-9), from the colophon live dogfood

The 6-rung plan above is the *internal* mechanics (issue -> solve -> emit -> observe-merge -> lesson -> persona).
The `schmug/colophon#27` dogfood (shipped `live-solve-one`, SHADOW/dry) + the blocked manual submission surfaced
**three rungs the map never had, because they only exist at the contact surface with the outside world.** Each
blocks the north-star apex signal (an external maintainer's merge) for ordinary repos. Full findings + evidence:
[`2026-07-04-live-dogfood-lifecycle-gaps.md`](2026-07-04-live-dogfood-lifecycle-gaps.md).

7. **INTAKE — PR-acceptance precheck.** Status: **GAP, unscheduled (drafted).** A repo that blocks external PRs
   (collaborators-only) can never produce the apex merge; today we learn it only at the `CreatePullRequest` step,
   after a full solve (the colophon dead-end). The interaction limit is admin-only/unreadable; the discriminator is
   *external-merged-PR history* (colophon: 0; spec-kitty: 5). Design (a readable intake heuristic + a submit-time
   fail-fast-and-dispose): [`2026-07-04-intake-pr-acceptance-gate-design.md`](2026-07-04-intake-pr-acceptance-gate-design.md).
   Cheapest fix; the natural first build. Feeds rung 9 (dispose on terminal-block) + the deferred issue-dataset.
8. **REVIEW LOOP — external review -> persona.** Status: **GAP, unscheduled (sketched).** A maintainer/bot review on
   the emitted PR has no ingestion path; only the `merged` boolean flows back (`merge-observer.js`), nothing reads
   `/pulls/N/reviews`, `emitPR` is create-only, the outcome enum is frozen `['merged']`. On the critical path
   (maintainers review before merging). Needs: a review-observer + `reviewContext` through the materializer + an
   `emitPR` UPDATE path; reviewer prose is untrusted (the #273 scrub invariant). Depends on 1-6 + the emit-update seam.
9. **DISPOSAL — of never-merged candidates.** Status: **GAP, unscheduled (sketched).** "Only merged is retained" is
   implemented as *non-promotion*, not disposal: an un-merged candidate is never promoted but never disposed (the
   ephemeral container/clone IS reaped; durable `draft-*.json` + ledger residue persists). Needs an explicit
   disposal/expiry, and a terminal-block (rung 7, or a closed issue) should dispose *immediately*. Observable, never a
   silent delete. Depends on 7 (the terminal-block signal).

**Tracking note:** rungs 7-9 are the external-contact layer; the internal 1-6 are mechanism-complete (SHADOW). All
nine are mirrored in [`docs/PRD.md`](../../../docs/PRD.md) §6. Only a world-anchored merge hardens any of it (OQ-NS-6).

## Caveats (honesty pass)

- **The egress in-repo comments are stale and actively misleading.** `emit-pr.js:20/39/51/352` still say "armedEmit
  throws by construction / zero bytes this wave"; the actual `armedEmit` (`:334`) delegates to `ghEmit` and we proved
  it live this session. The honesty auditor was itself misled by these comments into doubting the egress. **Cleaning
  them is a real correctness concern, not cosmetics.**
- **Disk-state counts are point-in-time, not invariants.** "11 backtest nodes / 0 confirmed-by edges" are observations
  of `$LOOM_LAB_STATE_DIR` from a prior run; the STRUCTURAL fact (backtest-only firewall) is what is load-bearing, the
  counts can drift.
- **The deliberate dams are discipline, not half-bakedness.** The empty `LIVE_SOURCES`, the oracle-free live grade, and
  the mock-only hardening store are intentional observe-first gates per the beta-internal-verification mandate. Do not
  read them as "unfinished".
- **`loom-recall` (kernel `L_global` library recall) is a distinct axis** (the toolkit's own session-memory), not the
  autonomous-SDE lesson recall. Do not conflate.
