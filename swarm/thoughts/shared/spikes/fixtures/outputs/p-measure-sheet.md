# P-Measure Blind Rating Sheet — v3.0 Phase 1 Wave D

**Instructions**:
- Read each query, then each of the 6 candidates beneath it.
- Rate each candidate as **useful** (Y) or **not useful** (N) for someone resuming work on that query.
- "Useful" = if you opened this artifact while working on the query, it would help you remember relevant prior decisions or context.
- Sources are sealed — do NOT open `p-measure-answer-key.json` until all 10 queries are rated.
- Replace each `[ ]` with `[Y]` or `[N]` inline; save the file when done.

**Corpus**: 25 markdown files under `~/.claude/library/sections/`.

---

## Q1. "what's the state of v3.0 phase 1 spike"

**Candidate A** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-v30-phase-1-waves-b-and-c-shipped.md`
*Title*: v3.0 Phase 1 — Waves B + C SHIPPED post-compact; 7/8 gate boxes green
*Excerpt*: Continuation of the same session_id post-compact. After confirming with the user that post-compact context is fresh-enough for Wave B (mechanical) and gracefully sufficient for Wave C (HETS-routed), proceeded with all four remaining probes. Only Wave D (P-Measure blind hit-rate)…
Useful? [ ]

**Candidate B** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-round-2-quick-wins-shipped.md`
*Title*: TB round-2 quick wins SHIPPED — 2026-05-24
*Excerpt*: - `main` at `542c962` (PR #22 merged) - 22 PRs total on `textbook-to-tutorial`; round-2-quick-wins = PR #22 - Local branch `feat/round2-quick-wins` deleted post-merge - 12 stale harness processes killed during the turn (see §"Process hygiene")
Useful? [ ]

**Candidate C** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-v30-phase-1-wave-a-shipped-p3-deferred.md`
*Title*: v3.0 Phase 1 — Wave A SHIPPED + P3 retired from gate
*Excerpt*: Short post-compact session that kicked off the v3.0 Phase 1 verification spike under plan mode, executed Wave A (2 probes done, 1 deferred), and tightened the Phase 1 acceptance gate via a user-instigated scope refinement.
Useful? [ ]

**Candidate D** — `toolkit/logbook.md`
*Title*: Logbook — toolkit
*Excerpt*: # Logbook — toolkit
Useful? [ ]

**Candidate E** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-to-tutorial-lazy-hybrid-chunking-shipped.md`
*Title*: Session checkpoint — pre-compact
*Excerpt*: Five PRs merged in sequence across the day. Repo state at `b0b50e2`.
Useful? [ ]

**Candidate F** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-v2.9.0-phase-B-shipped-pre-phase-C.md`
*Title*: v2.9.0 Phase B shipped — discoverability + format-spec hardening
*Excerpt*: Branch `h2.9.0-substrate-bundle` advanced from `1ba17e8` (Phase A) → `7c33bc5` (Phase B). Tag `v2.9.0-phase-B-discoverability` pushed to origin.
Useful? [ ]


## Q2. "how did we handle stacked PR base retargeting drift"

**Candidate A** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-sprint-c-phase-1-and-t3.5-parallel-ship.md`
*Title*: TB Sprint C Phase 1 + T3.5 — PARALLEL SHIP, 2026-05-24
*Excerpt*: - `origin/main` at `a682545` (PR #24 merge commit; HEAD) - PR #23 merged at `ad00279`, PR #24 merged at `a682545` - Two PRs landed in parallel in a single round; total elapsed ~25 min from spawn to both-merged - Local main not yet fast-forwarded — `git fetch` hung in harness con…
Useful? [ ]

**Candidate B** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-v291-shipped-v30-rfc-and-plan-locked.md`
*Title*: 2026-05-24 — v2.9.1 SHIPPED + v3.0 RFC & Plan LOCKED
*Excerpt*: Pair-reviewed → architect.theo + code-reviewer absorbed **11 flags** (1 CRITICAL + 5 HIGH + 4 MEDIUM + 1 LOW); **1 LIVE-bug catch** (Component B originally targeted non-existent `skills/claude-api/SKILL.md`).
Useful? [ ]

**Candidate C** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-v2.8.1-v2.8.3-pdf-shakedown-and-baseline-corrections.md`
*Title*: Session snapshot — 2026-05-22 — v2.8.1 → v2.8.3 ship cluster + PDF→Tutorial shakedown + baseline corrections
*Excerpt*: ``` v2.8.1 v2.8.0.x wiring 5 surfaces consume the SynthId substrate + Phase 4 pair-run absorbed (3 nits) v2.8.2 patch bundle Fix-2(a) merged-skip + Fix-2(b) doc + Fix-3 non-tautology + bumpBatch lock-collapse v2.8.3 baseline corrections CHAOS-SUB-1 false-positive closed + CHAOS-…
Useful? [ ]

**Candidate D** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-sprints-a-bv2-bv2.5-shipped.md`
*Title*: Session snapshot — 2026-05-24
*Excerpt*: - **GitHub**: `shashankcm95/textbook-to-tutorial` (NOT `TextBook_to_Tutorial_Converter` — renamed earlier today to uniform kebab-case) - **Local path**: `/Users/shashankchandrashekarmurigappa/Documents/TB_to_Tutorial_converter/` - **Main HEAD**: `1ff9599` (PR #21 — Sprint Bv2 + …
Useful? [ ]

**Candidate E** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-v2.9.0-phase-B-shipped-pre-phase-C.md`
*Title*: v2.9.0 Phase B shipped — discoverability + format-spec hardening
*Excerpt*: Branch `h2.9.0-substrate-bundle` advanced from `1ba17e8` (Phase A) → `7c33bc5` (Phase B). Tag `v2.9.0-phase-B-discoverability` pushed to origin.
Useful? [ ]

**Candidate F** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-v2.9.0-phase-A-shipped-pre-phase-B.md`
*Title*: v2.9.0 Phase A Shipped — Pre-compact handoff for Phase B
*Excerpt*: **Branch**: `h2.9.0-substrate-bundle` (based on `h2.8.6-design-pushback-kb`) **Tag**: `v2.9.0-phase-A-measurement-and-integrity` (commit `1ba17e8`) — pushed to origin **Plugin published**: `v2.8.5` — Phase A is on local branch only; `/plugin update` correctly reports 2.8.5 as la…
Useful? [ ]


## Q3. "what's the secret management plan for portfolio"

**Candidate A** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-v30-phase-1-wave-a-shipped-p3-deferred.md`
*Title*: v3.0 Phase 1 — Wave A SHIPPED + P3 retired from gate
*Excerpt*: Short post-compact session that kicked off the v3.0 Phase 1 verification spike under plan mode, executed Wave A (2 probes done, 1 deferred), and tightened the Phase 1 acceptance gate via a user-instigated scope refinement.
Useful? [ ]

**Candidate B** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-test3-phase2-w2-complete-pre-phase-3.md`
*Title*: test3 Phase 2 Wave 2 complete — TB_to_Tutorial_converter ready for feature phase
*Excerpt*: **Substrate side**: v2.9.0 SHIPPED + merged to main (PR #155, commit `d9ced49`, release tag `v2.9.0` + 5 phase sub-tags A-E). Plugin marketplace propagation pending.
Useful? [ ]

**Candidate C** — `toolkit/stacks/decisions/volumes/test-vol-bench.md`
*Title*: test-vol-bench
*Excerpt*: This is a bench-test artifact for scenario 03 verifying the library substrate plugin round-trip. Written via the library CLI write subcommand to confirm narrative form, topic, and entity metadata are preserved on read-back.
Useful? [ ]

**Candidate D** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-v30-phase-1-waves-b-and-c-shipped.md`
*Title*: v3.0 Phase 1 — Waves B + C SHIPPED post-compact; 7/8 gate boxes green
*Excerpt*: Continuation of the same session_id post-compact. After confirming with the user that post-compact context is fresh-enough for Wave B (mechanical) and gracefully sufficient for Wave C (HETS-routed), proceeded with all four remaining probes. Only Wave D (P-Measure blind hit-rate)…
Useful? [ ]

**Candidate E** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-v291-shipped-v30-rfc-and-plan-locked.md`
*Title*: 2026-05-24 — v2.9.1 SHIPPED + v3.0 RFC & Plan LOCKED
*Excerpt*: Pair-reviewed → architect.theo + code-reviewer absorbed **11 flags** (1 CRITICAL + 5 HIGH + 4 MEDIUM + 1 LOW); **1 LIVE-bug catch** (Component B originally targeted non-existent `skills/claude-api/SKILL.md`).
Useful? [ ]

**Candidate F** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-tb-sprint-d-e-shipped-pre-compaction.md`
*Title*: TB Sprint D + Sprint E — pre-compaction snapshot, 2026-05-25
*Excerpt*: - `origin/main` at `9b94866` (PR #30 merge — eval-harness QoL + figure-recall metric) - **PR #29 MERGED** at `abc5028` — Sprint E Tier 1 production-path bundle (5 changes, +195/−39, 6 files) - **PR #30 MERGED** at `9b94866` — Sprint E Tier 2 eval-harness QoL + figure-recall metr…
Useful? [ ]


## Q4. "TB feature B voice and anchor wave 3"

**Candidate A** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-test3-phase2-w2-complete-pre-phase-3.md`
*Title*: test3 Phase 2 Wave 2 complete — TB_to_Tutorial_converter ready for feature phase
*Excerpt*: **Substrate side**: v2.9.0 SHIPPED + merged to main (PR #155, commit `d9ced49`, release tag `v2.9.0` + 5 phase sub-tags A-E). Plugin marketplace propagation pending.
Useful? [ ]

**Candidate B** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-feature-a-plus-b-foundations-hets-validated.md`
*Title*: Session checkpoint — pre-compact (second half of 2026-05-24)
*Excerpt*: This snapshot covers everything since `2026-05-24-tb-to-tutorial-lazy-hybrid-chunking-shipped.md` (the lazy-hybrid-chunking arrival point earlier today).
Useful? [ ]

**Candidate C** — `toolkit/stacks/session-snapshots/volumes/2026-05-17-post-migrate-session.md`
*Title*: Session snapshot — 2026-05-17 post-v2.1.0-soak
*Excerpt*: **Context**: First compact since H.9.21 v2.1.0 ship + user-side production migration. Captures state for post-compact resume.
Useful? [ ]

**Candidate D** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-feature-b-wave-3-built-and-reviewed-pre-smoke.md`
*Title*: Session checkpoint — Wave 3 built + reviewed; smoke regen running
*Excerpt*: Picks up from `2026-05-24-tb-feature-a-plus-b-foundations-hets-validated.md`.
Useful? [ ]

**Candidate E** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-v30-phase-1-wave-a-shipped-p3-deferred.md`
*Title*: v3.0 Phase 1 — Wave A SHIPPED + P3 retired from gate
*Excerpt*: Short post-compact session that kicked off the v3.0 Phase 1 verification spike under plan mode, executed Wave A (2 probes done, 1 deferred), and tightened the Phase 1 acceptance gate via a user-instigated scope refinement.
Useful? [ ]

**Candidate F** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-v30-phase-1-waves-b-and-c-shipped.md`
*Title*: v3.0 Phase 1 — Waves B + C SHIPPED post-compact; 7/8 gate boxes green
*Excerpt*: Continuation of the same session_id post-compact. After confirming with the user that post-compact context is fresh-enough for Wave B (mechanical) and gracefully sufficient for Wave C (HETS-routed), proceeded with all four remaining probes. Only Wave D (P-Measure blind hit-rate)…
Useful? [ ]


## Q5. "HETS pair review caught security HIGHs"

**Candidate A** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-v30-phase-1-wave-a-shipped-p3-deferred.md`
*Title*: v3.0 Phase 1 — Wave A SHIPPED + P3 retired from gate
*Excerpt*: Short post-compact session that kicked off the v3.0 Phase 1 verification spike under plan mode, executed Wave A (2 probes done, 1 deferred), and tightened the Phase 1 acceptance gate via a user-instigated scope refinement.
Useful? [ ]

**Candidate B** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-v2.9.0-shipped-final.md`
*Title*: v2.9.0 SHIPPED — substrate bundle (5 phases, 10 fixes, 108 unit tests)
*Excerpt*: - **Branch**: `h2.9.0-substrate-bundle` at `f17c833` - **PR**: #155 against main — https://github.com/shashankcm95/claude-power-loom/pull/155 - **Release tag**: `v2.9.0` (annotated; comprehensive release notes) - **Phase sub-tags** (forensic granularity): - `v2.9.0-phase-A-measu…
Useful? [ ]

**Candidate C** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-v30-phase-1-waves-b-and-c-shipped.md`
*Title*: v3.0 Phase 1 — Waves B + C SHIPPED post-compact; 7/8 gate boxes green
*Excerpt*: Continuation of the same session_id post-compact. After confirming with the user that post-compact context is fresh-enough for Wave B (mechanical) and gracefully sufficient for Wave C (HETS-routed), proceeded with all four remaining probes. Only Wave D (P-Measure blind hit-rate)…
Useful? [ ]

**Candidate D** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-feature-b-wave-3-built-and-reviewed-pre-smoke.md`
*Title*: Session checkpoint — Wave 3 built + reviewed; smoke regen running
*Excerpt*: Picks up from `2026-05-24-tb-feature-a-plus-b-foundations-hets-validated.md`.
Useful? [ ]

**Candidate E** — `toolkit/stacks/session-snapshots/volumes/2026-05-20-v2.1.5-backlog-triage-ready.md`
*Title*: Session snapshot — 2026-05-20 — v2.1.5 SHIPPED, pre-compact ready, backlog reviewed
*Excerpt*: **Plugin**: power-loom v2.1.5 (latest); main at `0fd7efe`; 0 open PRs; 0 stale branches; auto-delete-on-merge live.
Useful? [ ]

**Candidate F** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-test3-phase2-w2-complete-pre-phase-3.md`
*Title*: test3 Phase 2 Wave 2 complete — TB_to_Tutorial_converter ready for feature phase
*Excerpt*: **Substrate side**: v2.9.0 SHIPPED + merged to main (PR #155, commit `d9ced49`, release tag `v2.9.0` + 5 phase sub-tags A-E). Plugin marketplace propagation pending.
Useful? [ ]


## Q6. "harness contention git fetch workaround"

**Candidate A** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-sprint-c-phase-2-radix-popover-quiz-shipped.md`
*Title*: TB Sprint C Phase 2 — Radix Popover + QuizSection celebration SHIPPED, 2026-05-24
*Excerpt*: - `origin/main` at `bdaace6` (PR #25 merge commit; HEAD) - 25 PRs shipped on `textbook-to-tutorial` since the kebab-case rename - `delete_branch_on_merge: true` now active (set during this session) — merged branches auto-delete on origin going forward
Useful? [ ]

**Candidate B** — `toolkit/stacks/decisions/volumes/test-vol-bench.md`
*Title*: test-vol-bench
*Excerpt*: This is a bench-test artifact for scenario 03 verifying the library substrate plugin round-trip. Written via the library CLI write subcommand to confirm narrative form, topic, and entity metadata are preserved on read-back.
Useful? [ ]

**Candidate C** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-sprint-c-phase-1-and-t3.5-parallel-ship.md`
*Title*: TB Sprint C Phase 1 + T3.5 — PARALLEL SHIP, 2026-05-24
*Excerpt*: - `origin/main` at `a682545` (PR #24 merge commit; HEAD) - PR #23 merged at `ad00279`, PR #24 merged at `a682545` - Two PRs landed in parallel in a single round; total elapsed ~25 min from spawn to both-merged - Local main not yet fast-forwarded — `git fetch` hung in harness con…
Useful? [ ]

**Candidate D** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-v30-phase-1-wave-a-shipped-p3-deferred.md`
*Title*: v3.0 Phase 1 — Wave A SHIPPED + P3 retired from gate
*Excerpt*: Short post-compact session that kicked off the v3.0 Phase 1 verification spike under plan mode, executed Wave A (2 probes done, 1 deferred), and tightened the Phase 1 acceptance gate via a user-instigated scope refinement.
Useful? [ ]

**Candidate E** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-v2.9.0-phase-B-shipped-pre-phase-C.md`
*Title*: v2.9.0 Phase B shipped — discoverability + format-spec hardening
*Excerpt*: Branch `h2.9.0-substrate-bundle` advanced from `1ba17e8` (Phase A) → `7c33bc5` (Phase B). Tag `v2.9.0-phase-B-discoverability` pushed to origin.
Useful? [ ]

**Candidate F** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-round-2-quick-wins-shipped.md`
*Title*: TB round-2 quick wins SHIPPED — 2026-05-24
*Excerpt*: - `main` at `542c962` (PR #22 merged) - 22 PRs total on `textbook-to-tutorial`; round-2-quick-wins = PR #22 - Local branch `feat/round2-quick-wins` deleted post-merge - 12 stale harness processes killed during the turn (see §"Process hygiene")
Useful? [ ]


## Q7. "RFC v3.2 four class state model attestations"

**Candidate A** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-v291-shipped-v30-rfc-and-plan-locked.md`
*Title*: 2026-05-24 — v2.9.1 SHIPPED + v3.0 RFC & Plan LOCKED
*Excerpt*: Pair-reviewed → architect.theo + code-reviewer absorbed **11 flags** (1 CRITICAL + 5 HIGH + 4 MEDIUM + 1 LOW); **1 LIVE-bug catch** (Component B originally targeted non-existent `skills/claude-api/SKILL.md`).
Useful? [ ]

**Candidate B** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-v2.9.0-shipped-final.md`
*Title*: v2.9.0 SHIPPED — substrate bundle (5 phases, 10 fixes, 108 unit tests)
*Excerpt*: - **Branch**: `h2.9.0-substrate-bundle` at `f17c833` - **PR**: #155 against main — https://github.com/shashankcm95/claude-power-loom/pull/155 - **Release tag**: `v2.9.0` (annotated; comprehensive release notes) - **Phase sub-tags** (forensic granularity): - `v2.9.0-phase-A-measu…
Useful? [ ]

**Candidate C** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-v2.8.1-v2.8.3-pdf-shakedown-and-baseline-corrections.md`
*Title*: Session snapshot — 2026-05-22 — v2.8.1 → v2.8.3 ship cluster + PDF→Tutorial shakedown + baseline corrections
*Excerpt*: ``` v2.8.1 v2.8.0.x wiring 5 surfaces consume the SynthId substrate + Phase 4 pair-run absorbed (3 nits) v2.8.2 patch bundle Fix-2(a) merged-skip + Fix-2(b) doc + Fix-3 non-tautology + bumpBatch lock-collapse v2.8.3 baseline corrections CHAOS-SUB-1 false-positive closed + CHAOS-…
Useful? [ ]

**Candidate D** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-v30-phase-1-wave-a-shipped-p3-deferred.md`
*Title*: v3.0 Phase 1 — Wave A SHIPPED + P3 retired from gate
*Excerpt*: Short post-compact session that kicked off the v3.0 Phase 1 verification spike under plan mode, executed Wave A (2 probes done, 1 deferred), and tightened the Phase 1 acceptance gate via a user-instigated scope refinement.
Useful? [ ]

**Candidate E** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-sprint-c-phase-2-radix-popover-quiz-shipped.md`
*Title*: TB Sprint C Phase 2 — Radix Popover + QuizSection celebration SHIPPED, 2026-05-24
*Excerpt*: - `origin/main` at `bdaace6` (PR #25 merge commit; HEAD) - 25 PRs shipped on `textbook-to-tutorial` since the kebab-case rename - `delete_branch_on_merge: true` now active (set during this session) — merged branches auto-delete on origin going forward
Useful? [ ]

**Candidate F** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-v30-phase-1-waves-b-and-c-shipped.md`
*Title*: v3.0 Phase 1 — Waves B + C SHIPPED post-compact; 7/8 gate boxes green
*Excerpt*: Continuation of the same session_id post-compact. After confirming with the user that post-compact context is fresh-enough for Wave B (mechanical) and gracefully sufficient for Wave C (HETS-routed), proceeded with all four remaining probes. Only Wave D (P-Measure blind hit-rate)…
Useful? [ ]


## Q8. "DDIA chunking lazy hybrid cost per chapter"

**Candidate A** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-test3-post-compact-phase3-mech-prep.md`
*Title*: test3 — Post-compact resume + Phase 3 mechanical prep
*Excerpt*: - Library snapshot `2026-05-22-test3-phase2-w2-complete-pre-phase-3.md` persisted ✓ (14,145 B, 19:01) - MEMORY.md test3 entry line 42 ✓ (points at parent snapshot above) - 3 synthesis docs in place at `claude-toolkit/swarm/run-state/test3-design/` ✓ - H.9.21 library substrate co…
Useful? [ ]

**Candidate B** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-feature-a-plus-b-foundations-hets-validated.md`
*Title*: Session checkpoint — pre-compact (second half of 2026-05-24)
*Excerpt*: This snapshot covers everything since `2026-05-24-tb-to-tutorial-lazy-hybrid-chunking-shipped.md` (the lazy-hybrid-chunking arrival point earlier today).
Useful? [ ]

**Candidate C** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-to-tutorial-lazy-hybrid-chunking-shipped.md`
*Title*: Session checkpoint — pre-compact
*Excerpt*: Five PRs merged in sequence across the day. Repo state at `b0b50e2`.
Useful? [ ]

**Candidate D** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-tb-sprint-d-e-shipped-pre-compaction.md`
*Title*: TB Sprint D + Sprint E — pre-compaction snapshot, 2026-05-25
*Excerpt*: - `origin/main` at `9b94866` (PR #30 merge — eval-harness QoL + figure-recall metric) - **PR #29 MERGED** at `abc5028` — Sprint E Tier 1 production-path bundle (5 changes, +195/−39, 6 files) - **PR #30 MERGED** at `9b94866` — Sprint E Tier 2 eval-harness QoL + figure-recall metr…
Useful? [ ]

**Candidate E** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-sprint-c-phase-2-radix-popover-quiz-shipped.md`
*Title*: TB Sprint C Phase 2 — Radix Popover + QuizSection celebration SHIPPED, 2026-05-24
*Excerpt*: - `origin/main` at `bdaace6` (PR #25 merge commit; HEAD) - 25 PRs shipped on `textbook-to-tutorial` since the kebab-case rename - `delete_branch_on_merge: true` now active (set during this session) — merged branches auto-delete on origin going forward
Useful? [ ]

**Candidate F** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-v2.9.0-phase-B-shipped-pre-phase-C.md`
*Title*: v2.9.0 Phase B shipped — discoverability + format-spec hardening
*Excerpt*: Branch `h2.9.0-substrate-bundle` advanced from `1ba17e8` (Phase A) → `7c33bc5` (Phase B). Tag `v2.9.0-phase-B-discoverability` pushed to origin.
Useful? [ ]


## Q9. "Mermaid versus structured figure components for textbook"

**Candidate A** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-sprint-c-phase-2-radix-popover-quiz-shipped.md`
*Title*: TB Sprint C Phase 2 — Radix Popover + QuizSection celebration SHIPPED, 2026-05-24
*Excerpt*: - `origin/main` at `bdaace6` (PR #25 merge commit; HEAD) - 25 PRs shipped on `textbook-to-tutorial` since the kebab-case rename - `delete_branch_on_merge: true` now active (set during this session) — merged branches auto-delete on origin going forward
Useful? [ ]

**Candidate B** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-tb-sprint-d-e-shipped-pre-compaction.md`
*Title*: TB Sprint D + Sprint E — pre-compaction snapshot, 2026-05-25
*Excerpt*: - `origin/main` at `9b94866` (PR #30 merge — eval-harness QoL + figure-recall metric) - **PR #29 MERGED** at `abc5028` — Sprint E Tier 1 production-path bundle (5 changes, +195/−39, 6 files) - **PR #30 MERGED** at `9b94866` — Sprint E Tier 2 eval-harness QoL + figure-recall metr…
Useful? [ ]

**Candidate C** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-test3-phase2-w2-complete-pre-phase-3.md`
*Title*: test3 Phase 2 Wave 2 complete — TB_to_Tutorial_converter ready for feature phase
*Excerpt*: **Substrate side**: v2.9.0 SHIPPED + merged to main (PR #155, commit `d9ced49`, release tag `v2.9.0` + 5 phase sub-tags A-E). Plugin marketplace propagation pending.
Useful? [ ]

**Candidate D** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-sprints-a-bv2-bv2.5-shipped.md`
*Title*: Session snapshot — 2026-05-24
*Excerpt*: - **GitHub**: `shashankcm95/textbook-to-tutorial` (NOT `TextBook_to_Tutorial_Converter` — renamed earlier today to uniform kebab-case) - **Local path**: `/Users/shashankchandrashekarmurigappa/Documents/TB_to_Tutorial_converter/` - **Main HEAD**: `1ff9599` (PR #21 — Sprint Bv2 + …
Useful? [ ]

**Candidate E** — `toolkit/stacks/session-snapshots/volumes/2026-05-20-v2.1.5-backlog-triage-ready.md`
*Title*: Session snapshot — 2026-05-20 — v2.1.5 SHIPPED, pre-compact ready, backlog reviewed
*Excerpt*: **Plugin**: power-loom v2.1.5 (latest); main at `0fd7efe`; 0 open PRs; 0 stale branches; auto-delete-on-merge live.
Useful? [ ]

**Candidate F** — `toolkit/stacks/session-snapshots/volumes/2026-05-22-v2.9.0-phase-A-shipped-pre-phase-B.md`
*Title*: v2.9.0 Phase A Shipped — Pre-compact handoff for Phase B
*Excerpt*: **Branch**: `h2.9.0-substrate-bundle` (based on `h2.8.6-design-pushback-kb`) **Tag**: `v2.9.0-phase-A-measurement-and-integrity` (commit `1ba17e8`) — pushed to origin **Plugin published**: `v2.8.5` — Phase A is on local branch only; `/plugin update` correctly reports 2.8.5 as la…
Useful? [ ]


## Q10. "why did self-improve never surface a real pattern"

**Candidate A** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-feature-a-plus-b-foundations-hets-validated.md`
*Title*: Session checkpoint — pre-compact (second half of 2026-05-24)
*Excerpt*: This snapshot covers everything since `2026-05-24-tb-to-tutorial-lazy-hybrid-chunking-shipped.md` (the lazy-hybrid-chunking arrival point earlier today).
Useful? [ ]

**Candidate B** — `toolkit/stacks/session-snapshots/volumes/2026-05-21-v2.4.3-pre-compact-bench-extension.md`
*Title*: Session snapshot — 2026-05-21 — v2.4.3 PR open; user called context overrun
*Excerpt*: The `self-improvement.md` rule says: "When context is getting large, proactively save... and consider compaction." This is INSTRUCTION-FOLLOWING ONLY. I didn't proactively notice. Same class of bug as GAP-A through GAP-E — text rules don't bind reliably.
Useful? [ ]

**Candidate C** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-sprint-c-phase-2-radix-popover-quiz-shipped.md`
*Title*: TB Sprint C Phase 2 — Radix Popover + QuizSection celebration SHIPPED, 2026-05-24
*Excerpt*: - `origin/main` at `bdaace6` (PR #25 merge commit; HEAD) - 25 PRs shipped on `textbook-to-tutorial` since the kebab-case rename - `delete_branch_on_merge: true` now active (set during this session) — merged branches auto-delete on origin going forward
Useful? [ ]

**Candidate D** — `toolkit/stacks/session-snapshots/volumes/2026-05-20-v2.1.5-backlog-triage-ready.md`
*Title*: Session snapshot — 2026-05-20 — v2.1.5 SHIPPED, pre-compact ready, backlog reviewed
*Excerpt*: **Plugin**: power-loom v2.1.5 (latest); main at `0fd7efe`; 0 open PRs; 0 stale branches; auto-delete-on-merge live.
Useful? [ ]

**Candidate E** — `toolkit/stacks/session-snapshots/volumes/2026-05-24-tb-round-2-quick-wins-shipped.md`
*Title*: TB round-2 quick wins SHIPPED — 2026-05-24
*Excerpt*: - `main` at `542c962` (PR #22 merged) - 22 PRs total on `textbook-to-tutorial`; round-2-quick-wins = PR #22 - Local branch `feat/round2-quick-wins` deleted post-merge - 12 stale harness processes killed during the turn (see §"Process hygiene")
Useful? [ ]

**Candidate F** — `toolkit/stacks/session-snapshots/volumes/2026-05-25-tb-sprint-d-e-shipped-pre-compaction.md`
*Title*: TB Sprint D + Sprint E — pre-compaction snapshot, 2026-05-25
*Excerpt*: - `origin/main` at `9b94866` (PR #30 merge — eval-harness QoL + figure-recall metric) - **PR #29 MERGED** at `abc5028` — Sprint E Tier 1 production-path bundle (5 changes, +195/−39, 6 files) - **PR #30 MERGED** at `9b94866` — Sprint E Tier 2 eval-harness QoL + figure-recall metr…
Useful? [ ]
