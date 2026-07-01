# Item 8 — The Arming Wave: grounded scope (2026-07-01)

Status: SCOPE (pre-plan). Firsthand 5-probe codebase re-audit (post PR-A2 + PR-B B1-B5), superseding the
2026-06-25 gap-map's frozen ratings for the world-anchor path. This is the scoping pass the USER gated
behind "its own scope + explicit go-ahead"; it is NOT yet an approved build plan and it authorizes NO live
crossing. The build plan + the live-crossing gate are separate, later artifacts.

> **Why this doc exists / decay caveat.** The gap-map (`2026-06-25-autonomous-sde-lifecycle-gap.md`) froze
> its "MISSING (grep=0)" ratings on 2026-06-25, BEFORE PR-A2 (signer) and PR-B B1-B5 (arming) landed. Three
> of its ratings have since decayed (see "Decay corrections"). This doc is the re-probed replacement for the
> world-anchor slice; the gap-map stands as the pre-build snapshot for the rest.

## Headline

**"The arming wave" is not one wave — it is two decisions that must be authorized separately:**

- **Part A — the live-loop scheduler (BUILDABLE NOW, fully SHADOW).** A persistent driver for
  `pullLiveCorpus -> runLiveDraftLoop -> observe-merge -> mint`. Grep-confirmed absent (twice). This is a
  real, substantial, in-substrate build that crosses NOTHING live: emit stays gated, the arm flags stay off,
  every minted edge stays unsigned/shadow. Dogfoodable internally.
- **Part B — the live crossing (THE actual Rubicon-2, deploy-gated).** Setting the arm flags on a
  DEPLOYED + ATTESTED cross-uid box so a real merge mints a SIGNED edge whose hardened weight is admitted.
  This is the first SHADOW->LIVE step of the whole north-star. It is blocked on prerequisites that are NOT
  code (headless auth, a deployed+attested broker, a #273 trust judgment) and needs its own explicit,
  per-step USER authorization. Per OQ-NS-6, only this step actually HARDENS trust.

**The full SHADOW mechanism is built and unit-proven end-to-end.** No missing module surfaced in any probe.
The residual is (Part A) a scheduler to drive the loop and (Part B) deployment + arming.

## Safety reframe (load-bearing — de-risks Part B)

An armed world-anchor weight's terminal sink is **prompt-enrichment text**, not an outward action. The chain:
a HARDEN verdict -> non-zero weight (via `LIVE_SOURCES`) -> a ranked instinct -> `build-spawn-context.js`
renders a `## Earned instincts` markdown block -> `/build-team` prefixes it onto spawned-persona prompts. It
influences **what a spawned actor reads**, and it is **fail-open enrichment** (`world-anchored-recall.js:130`
"recall is enrichment, not a gate"; `build-spawn-context.js:111-112` fails open to `[]`). It never reaches
the `emitPR` egress chokepoint (`build-spawn-context.js` imports no egress). So the worst case of a
forged / co-forged weight at go-live is a **poisoned instinct in a spawn prompt**, not a forged PR emission.
The `#273` same-uid co-forge residual therefore has a **small, non-egress blast radius** — a material input
to the Part B risk calculus. (This claim is the primary target of the adversarial verification pass below.)

## Current state — grounded (file:line)

### Built + unit-proven (SHADOW, weight-inert)

- **Emit-side join-key**: `emit-pr.js:510` `writeJoinKey(...)` persists the kernel-sealed
  `(repo, issueRef, pr_number, pr_url, approval_hash, base_sha, broker-sig bundle)` at emit-success; additive,
  non-reverting (`emit-pr.js:497-533`). The merge-observer is the sole production reader.
- **Merge observer**: `observe-merge` CLI arm (`world-anchor/cli.js:374`) -> `runMergeObserve`
  (`merge-observer.js:65`), six fail-closed steps with `emitEgressAlert` on each; `resolveJoinKeyForPr`
  exact-set match, refuses 0/>1 (`join-key-store.js:444-455`); `verifyMerge` gh `merged===true`
  (`merge-observer.js:89`); writes the shadow merge-outcome record carrying the sealed `approval_hash` + OQ-3
  broker-sig bundle.
- **Auto-mint**: on `merged`, `mintFromMergeOutcome` (`world-anchor-mint.js:301`) mints a node
  (`:496`) + a `world-anchored-by` edge (`:509`), `to_delta_ref = approval_hash`.
- **Cross-uid edge signer (built in-repo)**: `resolveEdgeSignerLaunch` returns a real signer only under
  `LOOM_EDGE_USER` + `LOOM_EDGE_WRAPPER` + strict `LOOM_EDGE_REQUIRE_UID_SEP` (`edge-signer-resolve.js:37-40`);
  `crossUidLoomEdgeSigner` does `sudo -n -u <edge-user>` to the key-holding wrapper `loom-edge-sign.js`
  (WHO gate on `SUDO_UID`, WHAT gate recompute-bind, ed25519 sign). Custody hardened owner-only `& 0o077`
  (`loom-broker-sign.js:106`, the CodeRabbit-Major fix now flowing back to PACT).
- **Admission gate**: `admitWorldAnchorNode` (`admit-world-anchor-node.js:93`) requires both custody keys, a
  non-null uid, exactly-one signed edge that ed25519-verifies over its re-derived id, att<->edge approval-hash
  bind, join-key re-derive + merge-outcome load, broker-sig re-verify, and the commitment cross-checks -> only
  then `{admitted:true, source:'world-anchor'}` (`:181`).
- **B5 arming (the two gates, one flag)**: `world-anchor-arming.js` is the single STRICT reader of
  `LOOM_WORLD_ANCHOR_ARM`. Armed flips (D1) `LIVE_SOURCES = ['world-anchor']` (`weight-source-gate.js:49`,
  frozen, closure-internal) and (D2) custody-key resolution of `/etc/loom/edge-verify.pem` +
  `/etc/loom/verify.pem` (`world-anchored-recall-cli.js:30-31,66-67`, fail-closed reader
  `custody-verify-key.js`). Un-armed = byte-identical pre-B5.
- **Recall consumer (live-wired, SHADOW-empty)**: `build-spawn-context.js:104-113` invokes the recall CLI as a
  subprocess for earned-instinct enrichment; yields `[]` while un-armed.
- **Live-loop lesson capture**: `runLiveDraftLoop -> solveGradeDraftOne` runs
  `captureLiveLesson -> mintLivePendingLesson` pre-emit via the real `claude -p` deriver
  (`live-draft-run.js:261-263,310-312`), weight-inert in the `live_pending` lane.

### Genuinely absent (the Part A build)

- **No live-loop scheduler / production entry point.** `runLiveDraftLoop` + `pullLiveCorpus` have only test +
  `_spike/live-draft-dogfood.js` (manual, env-var) callers. Grep over `packages/`, `scripts/`, `bin/`,
  `hooks/`, `kernel/hooks/` for a persistent driver = 0. `observe-merge` is operator-manual; no scheduler/hook
  invokes it.
- **The ghost-heartbeat is orthogonal** — it audits session transcripts for `drift:` signals every 4h
  (launchd, installed 2026-06-22); it does not touch the live PR-solving loop. And it currently emits ZERO:
  headless `claude -p` returns `401 Invalid authentication credentials` on this box
  (`docs/ghost-heartbeat-go-live.md`).

### Decay corrections to the 2026-06-25 gap-map

1. **Classifier + materializer now EXIST** (SHADOW). `issue-classifier.js` (`classifyIssue`, runs
   unconditionally) + `persona-prompt-materializer.js` (flag `LOOM_PERSONA_MATERIALIZE`, default off), both
   wired into `live-draft-run.js`. Gap-map rated the classifier grep=0 MISSING.
2. **The live loop mints a lesson now** (see above). Gap-map rated "zero lessons minted on the live loop."
3. **`record-merge` is deprecated** — confirmation-only, mints nothing; `observe-merge` is the mint path.

## The residual chain (armed -> a weight influences a spawn)

Every step is BUILT; each is currently gated off. For a real merge to influence a spawned prompt:

1. Edge signer armed: `LOOM_EDGE_USER` + `LOOM_EDGE_WRAPPER` + `LOOM_EDGE_REQUIRE_UID_SEP` on a box where the
   cross-uid signer is DEPLOYED (uid 612 is the intended custody holder per `admit-world-anchor-node.js:33`;
   whether a box is actually deployed+attested is B-block-2, still open) holding the edge key.
2. Custody keys deployed + attested: `/etc/loom/edge-verify.pem` + `/etc/loom/verify.pem` (provenance is a
   live-box fact, not a repo read).
3. Admission armed: `LOOM_WORLD_ANCHOR_ARM` flips `LIVE_SOURCES` (D1, admission-flag-alone); the custody keys
   resolve (D2) ONLY when ALSO signing-coherent (the A-W1 both-or-neither preflight). D1-armed-alone is inert
   (no signed edge -> `mock` -> weight 0).
4. A producer invokes `observe-merge` on real merged PRs (the Part A scheduler, or manual).
5. (Architect decision) whether the auto-mint arm threads `verifyKeyPem` so the PRODUCER refuses-on-absent,
   vs keeping the fail-closed boundary solely at the consumer (`world-anchor-mint.js:394-421` runs inbound auth
   only when `verifyKeyPem` present; the auto-mint arm passes none today).
6. Real merges accumulate — per OQ-NS-6, only accumulated real merges harden trust.

## Blockers to the LIVE crossing (Part B) — not code

- **B-block-1: headless auth (401).** The live loop cannot run headless on this box; the crossing cannot be
  dogfooded live until real `claude -p` auth works.
- **B-block-2: no deployed + attested cross-uid broker.** The signer code exists; no box is confirmed
  deployed with uid-separated custody + out-of-band attestation. Requires a live-box probe (Claude must NOT
  run `--attested-cross-uid`).
- **B-block-3: the #273 same-uid co-forge residual.** Closes only when a deployed+attested cross-uid broker
  signs live edges. On a same-uid box the co-forge survives — tolerable ONLY because the blast radius is
  fail-open prompt-enrichment (safety reframe above), never egress. A go-live trust judgment, not a
  documentary one.

## Architect decisions to settle in the build plan

- **A single deterministic arm preflight** asserting the two-flag couple (`LOOM_EDGE_REQUIRE_UID_SEP` AND
  `LOOM_WORLD_ANCHOR_ARM`) is both-or-neither. Today the AND contract lives only in a comment
  (`world-anchor-arming.js:21-24`); nothing enforces that arming admission without arming signing (or vice
  versa) fails closed.
- **Verify-at-mint (residual 5)** — thread `verifyKeyPem` into the `observe-merge` auto-mint arm so a
  merge that cannot be authenticated refuses at the producer, not silently mints an unauthenticated shadow
  edge the armed consumer then rejects.
- **Scheduler shape** — cron/launchd vs CI-hook vs operator-manual for the merge->mint trigger, and whether
  Part A's loop-driver emits at all in its first form (recommend: emit OFF, pull->solve->draft->grade only,
  to dogfood the scheduler with zero outward action).

## Recommendation

- **Authorize Part A (the SHADOW live-loop scheduler) as the next build wave** — subject to a normal build
  plan + 3-lens VERIFY. It is in-substrate, crosses nothing live, and turns the manual dogfood into a
  persistent driver whose real data surfaces the next gap empirically. Recommend its first form runs
  emit-OFF (pull -> solve -> draft -> grade -> mint-unsigned-shadow), so even a bug cannot emit or arm.
- **Do NOT authorize Part B (the live crossing) yet.** It is gated on B-block-1/2/3, which are deployment +
  trust decisions, not code. Part B should be its own scope with explicit per-step go-aheads, AFTER Part A is
  built + dogfooded, the 401 is resolved, and a broker is deployed + attested.
- **Sequencing note:** the two architect decisions (arm preflight, verify-at-mint) are cheap hardening that
  can land WITH Part A (they make the eventual crossing safer at no live cost), so fold them into the Part A
  plan rather than deferring to Part B.

## Runtime probes (evidence index)

All claims above are grounded by a 5-probe read-only audit (2026-07-01); representative file:line anchors:
`emit-pr.js:497-533`, `merge-observer.js:65-124`, `world-anchor/cli.js:322-368`, `world-anchor-mint.js:301-513`,
`edge-signer-resolve.js:37-76`, `admit-world-anchor-node.js:93-186`, `weight-source-gate.js:46-75`,
`world-anchor-arming.js:8-40`, `world-anchored-recall.js:65-95,130,178-182`, `build-spawn-context.js:104-298`,
`live-draft-run.js:261-424`, `issue-classifier.js`, `persona-prompt-materializer.js`,
`reputation/reputation-gate.js` (recommendNarrowing, test/_spike-only).

## Pre-Approval Verification (3-lens adversarial panel, 2026-07-01)

Ran the Rule-2 high-stakes tier (trust/security-class decision) as an adversarial panel, each lens tasked to
REFUTE its assigned premise against the code. **Result: all three CONFIRMED, high-confidence, zero
refutations.** The go/no-go below is unchanged; the refinements are for the Part A BUILD plan, not the
decision.

- **Safety premise (hacker) — CONFIRMED.** An armed OR co-forged world-anchor weight's only production sink is
  sanitized `## Earned instincts` prompt text; `build-spawn-context.js` imports no egress, does no file write,
  and `emitPR` is prompt-independent + unreachable (its only caller consumes no recall weight). The arming flip
  is a frozen module constant, STRICT-fail-closed, no injection seam.
- **Readiness premise (honesty-auditor) — CONFIRMED.** Every "built + unit-proven" module verified present
  with a passing test; the three decay corrections confirmed firsthand; blockers honestly surfaced.
- **Decomposition premise (architect) — CONFIRMED.** No path found by which a Part-A build arms a flag, signs
  an edge, resolves a custody key, or emits. Both arm flags STRICT default-off (typo fails CLOSED); the signer
  is not even constructed without three flags + a deployed wrapper + passwordless sudo; the SHADOW guarantee is
  STRUCTURAL (import-graph dam test: exactly one production consumer, no injection). Verify-at-mint is a
  distinct producer-side refusal (not a duplicate of the consumer gate), correctly Part-A scoped.

### Refinements to fold into the Part A build plan (non-blocking)

1. **Emit-off lives at the loop call-site, not a flag (architect, MEDIUM).** `runLiveDraftLoop` already calls
   the real `emitPR`, gated OFF only by the hardcoded `{}` opts at `live-draft-run.js:323` (dry-run
   disposition + killswitch-on-default + null token). Part A CONSTRAINT: the scheduler must DRIVE
   `runLiveDraftLoop`, never call `emitPR` directly; add a non-vacuous test asserting the scheduler threads no
   custody paths (so the gate can fire).
2. **B1/B5 are independently armable today — benign but real (architect, MEDIUM).** An operator can set
   `LOOM_EDGE_*` (arming signing) without `LOOM_WORLD_ANCHOR_ARM` (admission). Currently inert (a B1-only
   signed edge is dropped by the `LIVE_SOURCES` + custody double-gate), but this is the exact justification for
   making the both-or-neither arm preflight a Part-A deliverable, not a Part-B one.
3. **Name emitPR's human-approval gate as the Part-B backstop (hacker, MEDIUM).** The co-forge blast radius is
   a bounded, sanitized prompt-injection surface reaching Bash/Write/Edit builder personas; its load-bearing
   mitigation is `emitPR`'s prompt-unforgeable human-approval gate, which the Part-B trust judgment should name
   explicitly rather than resting on "small blast radius."
4. **Correct the stale-optimistic code comment (honesty-auditor, MEDIUM).** `admit-world-anchor-node.js:33`
   reads present-tense "the edge signer IS deployed+attested, uid 612" — contradicting B-block-2. Correct it so
   a future reader does not treat it as a go-live green light.
5. **Note the in-flight `task_d722450d` merge-seam (honesty-auditor, LOW).** The trust-anchor extract touches
   the LIVE `approve-cli` path; orthogonal to Part A but a potential seam if it lands concurrently.
6. **Verify-at-mint's key stays `null` un-armed (architect nuance).** Threading `verifyKeyPem` into the
   auto-mint arm must draw from the same B5-gated custody resolution, so Part A (un-armed) keeps the
   unauthenticated-skip path unchanged — preserving the no-live-cost guarantee.

## Open questions for the plan phase

- Does Part A's scheduler belong in `packages/lab/` (experiment substrate) or `packages/kernel/spawn-state/`
  (alongside the ghost-heartbeat scheduler)? The heartbeat precedent argues kernel/spawn-state.
- Is the 401 headless-auth fix a Part A prerequisite (the scheduler is useless without it) or a parallel
  track? Probe: the scheduler's unit/integration tests do not need live headless; only a real dogfood does.
- What is the acceptance bar for Part A "done" — a green integration test of the full pull->mint chain against
  a fixture repo, plus a single manual real dogfood once 401 is resolved?
