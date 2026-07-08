# Resume anchor — Power Loom toolkit (read after `MEMORY.md`)

> The **episodic** tier for THIS repo (the in-repo half of the "episodic = BOTH" decision): one section per
> live workstream, each holding that workstream's session status and pointing to its verbatim library
> snapshot(s) + its `docs/` anchor. `MEMORY.md` is the thin ROUTER that points HERE (one line per workstream);
> this file holds the session-grain detail; `docs/ROADMAP.md` + `docs/phases/` hold the durable PHASE status.
>
> **Anti-accretion discipline** (the lesson from PACT's 841-line `_SESSION-RESUME.md`): a per-workstream
> section is FROZEN once its wave closes — new state is a NEW dated line or a new library snapshot, not an
> in-place rewrite of an old one. When a section outgrows a screen, demote its older lines to the workstream's
> library snapshot and keep only the live head here. Consolidation (session-close) rolls the `MEMORY.md`
> router pointer; phase-close reconciles `docs/`.

## Toolkit — MEMORY-system v2 restructure

Snapshot: `~/.claude/library/.../session-snapshots/volumes/2026-07-05-memory-restructure-v2.md` · design: [packages/specs/research/2026-07-05-memory-restructure-design.md](packages/specs/research/2026-07-05-memory-restructure-design.md) · phase status: [docs/ROADMAP.md](docs/ROADMAP.md).

**▶ 2026-07-05 (IN PROGRESS) — MEMORY-SYSTEM v2 restructure.** USER: MEMORY.md mashes all workstreams; wants repo/workstream session memory DISTINCT + referenced HIERARCHICALLY; scars need a CACHE (cold-fetch by EXACT block pointer, LRU). **Design DONE → `research/2026-07-05-memory-restructure-design.md`** (3-tier ROUTER→EPISODIC[reuse library snapshots]→SEMANTIC[2a `docs/` anchor + 2b lessons]; §3.6 FOLD = router DEFERS phase-status to `docs/`, consolidation FEEDS phase-close = ONE anti-drift loop). **Phase 0 = PR #515: `scripts/memory.js` HARDENED via 2 review boards (VERIFY-on-plan + VALIDATE-re-probing-BUILT-code) + CodeRabbit; CI-green, eslint/md 0, 25 tests (was 11), READY FOR MERGE.** Boards caught+fixed: symlinked-sidecar write-through · TOCTOU · sequential-demote pointer-absorption (would've corrupted live memory in Phase 1); the CLI now = within-root containment (incl. DERIVED heat path) + atomic two-phase demote + `## Demoted`-section pointers + `verify-preserved` WHOLE-LINE gate; §8/§8.1 record both boards + the one documented TOCTOU residual. USER decisions: episodic=BOTH; DEFER ARC(Phase-3). **BACKUP (38 files, byte-identical) → `memory-backup-2026-07-05/`.** NEXT = **USER MERGES #515 → then Phase 1 (de-mash router + `docs/`-wire, `verify-preserved`-gated) + Phase 2 (scars anchors + fix dup `24.` + split-by-origin + LRU).** New SCARs (session snapshot): DERIVED-path-is-unvalidated (containment must cover every write, not just the arg) · a POINTER spliced in-place is absorbed by the block-parser into a sibling → dedicated section · a diff-audit must be WHOLE-LINE not `.includes()` substring.

**▶ 2026-07-06 — Phase 0 MERGED (#515); Phase 1 (this de-mash) IN PROGRESS.** MEMORY.md Current-status split into a thin per-workstream router; each workstream's status prose moved verbatim to its section here (gated by a fresh byte-identical backup `memory-backup-pre-phase1-2026-07-06/` + `verify-preserved` whole-line). Next after Phase 1 = Phase 2 (scar block-cache).

## Toolkit — autonomous-SDE lifecycle gap-map (Gap-7 / Gap-8 / Gap-9 + the internal ladder)

Snapshot: `2026-07-05-gap7b-gap9-terminal-block-disposal.md` · gap-map: [packages/specs/research/2026-06-25-autonomous-sde-lifecycle-gap.md](packages/specs/research/2026-06-25-autonomous-sde-lifecycle-gap.md) + `research/2026-07-04-*` · detail: `[[weight-gate-rfc-arc]]`.

**▶ 2026-07-05 — Gap-7 Part-B + Gap-9 disposal SHIPPED #514** (after #513): terminal-block classifier (ANCHORED `^repos/o/r/pulls$`, ZERO kernel touch, tri-state) + `disposeCandidate` (content-addressed disposal store + record-then-TOMBSTONE, tombstone-ONLY). ALL SHADOW/dormant/byte-inert. **Tombstone lane #273 same-uid co-forge residual → named forward-contract + `minted-already-tombstoned` canary (GAP-MAP).** colophon#27 SHELVED (collaborators-only) → [[colophon-issue27-fix-held]]. NEXT = item-8 Part B (HELD) · Gap-8 review-loop · Gap-9 bg-expiry. New SCARs #33-35 (CodeRabbit rate-limited false-green RECURRED #29 · test-fn hoisting-collision · lab `opts.dir` isolate) → [[scars-graduate-candidates]]; snapshot `2026-07-05-gap7b-gap9-terminal-block-disposal`.

**▶ 2026-07-07 — Gap-9 bg-expiry SHIPPED #523 + Gap-8 review-loop Wave A-1 SHIPPED #524** (after #514). **#523** (Gap-9 2nd half — dormant/SHADOW AGE-based sweep): `expirePendingLessons` (`live-expiry.js`) disposes stale never-merged `live_pending` nodes via #514's `disposeCandidate`; mtime-as-age (write-once node → mtime ~= capture time; a NAMED lower-bar #273 residual, arming-close = a content-sealed `captured_at`), `readNodeVerified` refactor (mtime off the SAME fstat'd fd), `maxPerSweep` cap + oldest-first sort, tombstone-only, NO live caller. **#524** (Gap-8 rung 1 — review INGESTION, SHADOW): read-only-GET `review-observer.js` (`--jq`-projected, prose never leaves GitHub) + content-addressed append-only `review-outcome-store.js` (keyed `(repo,pr_number,review_id,state)`, re-derives `node_id` on read) + cli `observe-reviews`; **C1-as-scoped insider gate** (`author_association ∈ {OWNER,MEMBER,COLLABORATOR}` — a review's `state` is REVIEWER-supplied unlike GitHub-computed `merged`), **NO kernel join-key read** (a 3rd reader would breach its 2-reader `REQUIRE_ALLOWLIST`), gates nothing (import-graph dam). Scope: `research/2026-07-07-gap8-review-loop-scope.md` (architect+hacker pressure-tested). **NEXT = Gap-8 Wave A-2** (the `changes-requested` breaker HALT — global-only, re-establish is-this-ours before gating, narrow to {OWNER,COLLABORATOR}) · item-8 Part-B HELD · Gap-9 scheduler-arming. New SCARs #38-41 (source-dam-needs-literal-call · validator-boundary-must-match-domain · read-pipeline-transform-launders-gated-shape · owns-basis-store-re-derives-id-on-read) → [[scars-graduate-candidates]]; snapshots `2026-07-07-gap9-bg-expiry` + `2026-07-07-gap8-review-loop-wave-a1`.

## Phase-3.2 — LIVE-BETA (③.2)

Detail: `[[phase-3.2-live-beta-arc]]` + `[[weight-gate-rfc-arc]]` (SCAR #30) · phase status: [docs/ROADMAP.md](docs/ROADMAP.md). The egress KERNEL invariants + the `/etc/loom` operator-only SECURITY constraint from this workstream are PROMOTED to `MEMORY.md` → Load-bearing invariants (they stay hot).

**▶▶ ③.2 LIVE-BETA (charter #341; PATH-1 human-sole-gate, lab weights SHADOW).** **spec-kitty#2137 = FIRST WORLD-ANCHORED ext-maintainer merge** (`stijn-dejongh` 2026-06-25; autonomous delivery via fork-emit UNDER BUILD). Item-8 Part A MECHANISM-COMPLETE (#479-#487, Part B HELD); fork-emit F-W1..W4-M2 + verify-container VC MERGED (#488-#499, ALL SHADOW/dormant `forkRepo`-never-populated; F-W4=OPERATOR arming). **SECURITY (load-bearing): Claude NEVER touches `/etc/loom`/`/opt/loom`, sets an arming flag, or runs `--attested-cross-uid` — operator-only; `task_d722450d` review-carefully. #273 NARROWS-not-closed** (same-uid co-forge until Part-B/F-W4 arms a deployed+attested cross-uid broker). Detail → [[phase-3.2-live-beta-arc]] + [[weight-gate-rfc-arc]] (SCAR #30).

## PACT — separate repo (pointer only)

**▶ PACT (SEPARATE memory scope) — latest: P2 sigma-root signer W1 DESIGNED + MERGED #64** (binding-aware broker gate; **KEY SEPARATION not the `_type` tag defuses cross-protocol sig reuse**; NS-7 no-Claude-operator). Prior: live Option-A deploy = PACT's 5th world-anchored signal (#53-#55). PACT SCARs #31 (Workflow schema'd-agent retry-cap burns design fan-outs→free-text) / #32 (plan-only-on-origin absent from stale local→fetch) in-file. Detail → PACT `_SESSION-RESUME.md` + its snapshots.

## Embers — separate repo (pointer only)

Detail → `[[gin-lessons-ledger-design-arc]]` (EMBERS lessons-commons, SEPARATE repo `~/Documents/embers/`, SHADOW): **P0-P6 done** (transparency log + root-anchored minter reusing PACT's attested root; client-side fork-detection; SHADOW/NARROWS-only). **RESUME = OPERATOR/HARDEN only** (gossip transport + N-of-M witness roster + cross-uid signer).

## v3.1-v3.9 — historical + standing gates (phase-closed)

Durable phase record: `docs/ROADMAP.md` + the per-phase `vX-close` library volumes. The invariant CARRIES below are also pinned in `MEMORY.md` → Load-bearing invariants.

**v3.1-v3.9 — HISTORICAL / standing gates** (`vX-close` vols): Phase 2 RELEASED (K1–K14 exc K3.b-dormant/K6-RETIRED/K8-CANCELLED). Invariant carries: ADR-0015 `failure_signature` FROZEN · v3.4 [[verdict-attestation-subject-is-builder-spawn]] · v3.8 **Rule 4** (Lab-track) · v3.9 Rule-2a-corollary (mock-green≠real-path) · K1-K14/#215 → [[kernel-record-store-invariants]] · OQ-21 don't-hook-`WorktreeCreate` · `/phase-close` #226 = 3-lens phase gate.
- **Deferred-by-design** (detail in `vX-close` vols): R13 net-enforcer→v4.x · K13 spawn-id concurrency · close-path git-SYNC (#191) · agentId-uniqueness probe (INV-22 rests on it). **R12 ContainerAdapter residuals (RELEVANT to PR-A2 signer):** sandbox MUST close host-path/absolute-write escape (H1) + output-DoS bound + process-GROUP reaping.
