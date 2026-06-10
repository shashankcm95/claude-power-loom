---
status: DRAFT — pending user review + per-wave /verify-plan gates
created: 2026-06-10
author: principal-synthesis session 2026-06-10 (USER vision + 6-analyst recon workflow + this plan)
scope: arc-level program charter (Track 3); each wave writes its own per-wave plan before build
amends: NOTHING — v6 stays LOCKED; the program RFC (P1) is a forward design candidate per the v3.5-RFC precedent
related:
  - packages/specs/plans/2026-06-08-shadow-to-live-beta-roadmap.md (the approved v3.7-v3.9 arc this track runs BESIDE)
  - packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md (field/concept reuse basis: R1-R4, `assertion_class`, `faithfulness_status`)
  - packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md (the static-animation constraint)
  - packages/specs/adrs/0014-memory-root-pointer.md (INV-26/INV-27; the P6 wiring decision)
  - packages/specs/plans/2026-06-02-contract-instinct-binding.md (the standing bench-before-bridge decision P2 honors)
lifecycle: persistent
---

# Track 3 — the Predictive-Persona program (P0-P7)

> **REVIEW-CORRECTION BANNER (2026-06-10 — supersedes any contrary framing below).** This charter
> was adversarially reviewed by a 20-agent workflow and is now the **post-beta Track 3** of the
> combined roadmap [`2026-06-10-combined-roadmap.md`](./2026-06-10-combined-roadmap.md) (which
> supersedes the earlier unified-vision charter for sequencing). The review **confirmed the design
> kernel SURVIVES** but mandated these framing corrections — they govern over any older wording in the
> body:
>
> 1. **Lineage (was "inheritance, not invention" — RETCON).** Ground truth SP-6:
>    `causal-recall-graph-rfc.md:554` ("Predictive recall via causal-graph at pre-spawn") is a
>    one-line DEFERRED BACKLOG BULLET with **zero design body**, and `:299` is a SEPARATE post-hoc
>    mechanism. Honest framing: **S4 is net-new; it PICKS UP a deferred RFC direction and REUSES the
>    dream-cycle promotion invariant (`:289`, verifiable).** Not "realizes Phase-4."
> 2. **Sequencing.** P1 (RFC + ADRs, docs-only) runs beside v3.7. P3a/P3b are **held as an intuition,
>    NOT pre-committed into v3.8b scope** (pre-loading a lean approved phase violates
>    cumulative-coherence). P4-P7 land post-beta. v3.8b stays the approved OQ-21 calibration + gates.
> 3. **The 4 P0.2 "kernel hygiene" items are re-graded LOW** (correctness/defense-in-depth chips,
>    fail-open in the cooperative single-uid model — NOT P0 blockers); they ship as a standalone
>    hygiene PR. See the re-graded P0 section.
> 4. **persona-as-corpus is a HYPOTHESIS, not a destination** (the single A/B showed
>    legibility-not-coverage, RP-14); P2/P7 are the experiments that TEST it.
> 5. **Citation fixes:** RP-14 (the deferral source is this program's SCOPE + the standing MEMORY
>    "bench-before-bridge" rule, NOT `contract-instinct-binding.md:98`, which says role-briefs =
>    `runtime/personas/`); RP-17 (the hook path is `hooks/lifecycle/prompt-enrich-trigger.js`, not
>    `hooks/userprompt/`); the `synthid.js` agent-md doc-rot (it reads `runtime/personas/` — fold the
>    1-line header fix into P0.3 doc-currency, beside Drift-note 4).
>
> The combined roadmap also folds the parent's E-INFRA (the treatment-vs-baseline A/B harness must be
> BUILT — it EXTENDS the existing scenario-aware `runner.sh`, it is not a from-scratch build) and
> E-EXT (the external-codebase validation run, post-beta at P7).

> **One-sentence thesis.** (The persona-is-a-corpus claim is a HYPOTHESIS tested by P2/P7 — the one
> A/B to date showed legibility-not-coverage, RP-14.) The persona is a file corpus the model animates;
> the orchestrator pre-registers a prediction before every delegation, compares it against
> kernel-attested outcomes at spawn close, hardens beliefs ONLY on world-anchored evidence, and turns
> surprises into human-gated, cue-recalled, extinction-pruned lessons — so trust becomes MEASURABLE
> PR-by-PR (world-anchored calibration); the loop is demonstrated once (EC6), not yet systematically
> accrued-into-decisions (the verb is "measured + exercised once," NOT "accrues").

## Context

The 2026-06-10 deep-dive session converged four design commitments that the substrate's existing
machinery records about but does not yet execute: (1) the **persona-as-corpus** model (identity in
files, model as interchangeable animator) has no animation bridge — 0/18 `agents/*.md` carry instinct
content and nothing injects it (ADR-0012 makes injection impossible; the bridge must be compile-time);
(2) the **predictive loop** (pre-registered `predicted_envelope` -> close-compare -> calibration ->
lesson) does not exist — no predicted-vs-actual compare is in the code; (3) the **evidence-typing law**
(model-vs-model matches never harden beliefs) is implicit in v6 0a.3.1 but unenforced for any future
hardening consumer; (4) the **memory-surfaces split** (plugin-level static index + dynamic anchors vs
persona-level corpus + calibration + lessons) is held in the user's head, not in a canonical doc. This
program builds all four, shadow-first, as a parallel track beside the approved v3.7-v3.9 arc.

## Routing Decision

Verbatim `route-decide.js` output (truncated to scored dims; full JSON reproducible via the probe in
Verification Probes):

```json
{
  "task": "Design and build the Predictive-Persona program: persona corpus compile bridge into agents/*.md, predicted_envelope pre-registration with spawn-close comparison, evidence-typing law for confirmation hardening, lesson recall hook, calibration ledger, memory surfaces consolidation — multi-wave kernel+runtime+lab substrate work with security-sensitive data-mutation stores",
  "recommendation": "root",
  "confidence": 0.75,
  "score_total": 0.075,
  "scores_by_dim": { "compound_weak": { "matched": ["design"], "raw": 1, "weight": 0.075, "contribution": 0.075 } },
  "weights_version": "v1.2-dict-expanded-2026-05-07"
}
```

**Escalated to route by judgment** per the standing MEMORY rule ("scores substrate work root on a
stakes-lexicon miss — escalate by judgment"): this is multi-wave kernel + lab data-mutation work.
Recorded as Drift-note 1 (another dictionary-gap data point).

## HETS Spawn Plan

Per-wave lens assignments (read-only personas for verify/review; builders along the dependency DAG):

| Wave | VERIFY (pre-build) | BUILD | VALIDATE (post-build) |
|---|---|---|---|
| P0 | architect (probe-pack design) | node-backend | code-reviewer + hacker + honesty-auditor (kernel fixes = 3-lens class) |
| P1 | architect + honesty-auditor (RFC/ADR claims) | n/a (docs) | honesty-auditor (claim-vs-evidence on the RFC) |
| P2 | architect (bench design pre-registration) | node-backend (harness) | honesty-auditor (decision-rule honored?) |
| P2b | architect | node-backend | code-reviewer + hacker (generated-content injection surface) |
| P3 | architect + hacker (binding/spoofing surface) | node-backend | code-reviewer + hacker + honesty-auditor (resolver touch = kernel class; hacker RE-PROBES BUILT code per workflow.md Rule 2a) |
| P4 | architect | node-backend | code-reviewer + hacker + honesty-auditor (data-mutation store class) |
| P5 | architect + confused-user (recall UX) | node-backend | code-reviewer + hacker |
| P6 | architect | node-backend (generator) | code-reviewer |
| P7 | architect (experiment design) | n/a (bench run) | honesty-auditor + /phase-close 3-lens |

## Runtime Probes (firsthand current-state grounding)

Every claim below was probed against the merged tree at `1e57c0a` (post-#286) on 2026-06-10, via a
6-analyst recon workflow + direct reads. Implementers MUST NOT re-derive these from prose; they are
the probed reality this plan builds on.

| # | Claim | Probe -> observed |
|---|---|---|
| RP-1 | No instinct content reaches spawns | grep across `agents/*.md` -> 0/18 carry instinct fields or blocks; instincts live only in `packages/runtime/personas/NN-*.md` `## Mindset` (all 16) + `contracts/*.contract.json` `interface.instincts` slugs |
| RP-2 | No generated-section fence exists in `agents/` | grep GENERATED/DO-NOT-EDIT -> no matches |
| RP-3 | Slug derivation is single-sourced | `packages/runtime/orchestration/_lib/instinct-slug.js:16-60` (`slugifyInstinct`/`mindsetInstinctSlugs`/`duplicateSlugs`); parity validator at `contracts-validate.js:1323-1403`, CI-time, SET-compare |
| RP-4 | No model identifier anywhere | `spawn-record.js:387-390` reads only tool_name/tool_input/tool_response/session_id/cwd; identity records (`registry.js:365-393`) and verdict store have no model field; `synthid.js:21-39` hashes the persona DEFINITION and excludes the LLM by design |
| RP-5 | `updatedInput` is inert on Agent/Task | ADR-0012 + `hooks.json:61` tombstone; `contract-reminder-on-agent-spawn.js:292-300` still emits it (its header overclaims — trust the ADR) |
| RP-6 | PreToolUse payload carries `tool_use_id` + `tool_input` | route-decide hook `:82-85`; contract-reminder `:251-253`. `tool_use_id` is a stable PreToolUse<->PostToolUse key (prior firsthand probe, MEMORY) |
| RP-7 | The natural close-compare insert point | `spawn-close-resolver.js:474-556` (`recordSpawnProvenance`) already derives the ACTUAL file set (`status --porcelain` `:499`) and tree hash (`:506-507`) before `appendRecord` (`:520`) |
| RP-8 | Resolver journal is additive JSONL | shadow verdict line schema at `spawn-close-resolver.js:622-638`; journal file `resolver-journal-<agentId>.jsonl` keyed by harness agentId (durable join key — run_id rotates at compaction) |
| RP-9 | spawn-record `spawn_id` and resolver `agentId` DO NOT join directly | `spawn-record.js:248` (`<ts>-<uuid>`) vs `tool_response.agentId` (`:255`); only the session-derived run dir is shared. Joins must key on `tool_use_id` or `agentId` |
| RP-10 | Lab-store conventions | base `LOOM_LAB_STATE_DIR \|\| ~/.claude/lab-state/<name>/ledger.jsonl`; advisory `withLabLock` (never exits); `enum-validate.js` (`normalizeAsciiEnum`/`validateEnum`) + `free-string-checks.js` shared; content-address re-derive on read (`isAuthenticProposal` pattern, kernel `readById` #273) |
| RP-11 | `op_type` enum is closed + additive-safe | `manage-proposal/enums.js:28` frozen `['quarantine','content-dedup','cull','merge']`; additive op recipe = enum entry + thin `manage-ops.js` wrapper + (only if promotable) `promote.js:53` OP_MAP entry |
| RP-12 | Evidence-class-as-kernel-field is an INERT control by design | the 0a.3.1 firewall holds by LAYER-ABSENCE (which store a record lives in), not a field — `manage-proposal/store.js:14-19`. The world-vs-model distinction must stay structural |
| RP-13 | `memory-root.js` has ZERO production importers | grep `require.*memory-root` -> tests only; lab stores resolve `LOOM_LAB_STATE_DIR` directly |
| RP-14 | The instinct->agents bridge was deliberately deferred pending a bench | This program's P2 SCOPE (bench-before-bridge) + the standing MEMORY "bench the instinct->agents/*.md bridge before building"; A/B (1 task) found instincts added LEGIBILITY not COVERAGE. CITATION CORRECTION (2026-06-10 review): do NOT cite `contract-instinct-binding.md:98` as the agents/ deferral — `:98` says ROLE-BRIEFS (`runtime/personas/`) are not touched and never mentions `agents/*.md` |
| RP-15 | v3.6 is PHASE-CLOSED 2026-06-10 (CLOSEABLE x3) | `docs/ROADMAP.md:262,290-298`; current frontier = v3.7 delta-promote per the approved shadow-to-live plan; v3.7 carry-list at ROADMAP `:288` |
| RP-16 | Bench infra exists | `packages/specs/bench/EXPERIMENT-LOG.md` (the v2.6.0 TDD-treatment experiment precedent lives there) |
| RP-17 | Advisory-text channels: UserPromptSubmit context-injection via PLAIN TEXT written to stdout is PROVEN (`packages/kernel/hooks/lifecycle/prompt-enrich-trigger.js:431,436` — path corrected per the 2026-06-10 review, NOT `hooks/userprompt/`; `process.stdout.write`, NOT a JSON `additionalContext` envelope; a JSON-envelope variant would itself be unproven); PostToolUse `decision:'block'+reason` is proven interactive (kb-citation-gate, observed live this session) but does NOT reliably propagate headless (GAP-D, contract-reminder header `:40-44`); PreToolUse:Agent advisory-approve text channel is UNPROVEN | -> P0 probe PR-2 |
| RP-19 | `tool_use_id` IS present in the PostToolUse:Agent close payload (`kb-citation-gate.js:143` reads `input.tool_use_id` on the same event) but `spawn-close-resolver.js` never reads it (grep = 0 hits — `main()` `:683-701` reads only tool_response-derived fields). P3b must THREAD it: `main()` extraction + `resolveAndJournal` -> `recordSpawnProvenance` signature changes, not just an insert | grep + kb-citation-gate evidence; PR-3 re-confirms empirically |
| RP-20 | Lessons CANNOT be manage-proposals: `validateTargets` (`manage-proposal/store.js:166-189`) throws unless `target_records` is a non-empty array of 64-hex kernel txids, and `computeProposalId` (`:92-94`) content-addresses ONLY `[opType, ...targets]` — a lesson's cues/claim would be outside its own identity basis. Lessons need a DEDICATED store | firsthand read 2026-06-10 (verify-panel premise-probe) |
| RP-18 | Session-audit kernel findings (this session, firsthand-verified) | route-decide hook hardcodes `~/.claude/packages/...` (`route-decide-on-agent-spawn.js:39`) — inert under plugin install; `_resolveForAtomicWrite` follows symlink chains with no containment check (`atomic-write.js:82-98`); record-store read paths return unfrozen rows (`record-store.js:440-456`); `validate-no-bare-secrets.js:286-317` unbounded `readFileSync` |

## Design laws (non-negotiable; every wave inherits these — juniors: read FIRST)

1. **L1 — World-anchored hardening only (the evidence-typing law, ADR-0017).** A predicted-vs-actual
   MATCH may harden a belief (calibration hit, reputation input, lesson extinction) ONLY when the
   actual side derives from a kernel-attested artifact: the resolver journal's git-derived file set /
   tree hash, record-store transactions, test-exec results, or a human disposition. A comparison whose
   actual side is LLM prose is stored (audit) but NEVER feeds a hardening projection. Enforced
   STRUCTURALLY per RP-12: by which store/projection may be consumed, plus a closed `rhs_source` enum
   on lab calibration records (lab-side field is fine; kernel-side field is forbidden).
2. **L2 — Static animation (ADR-0012/ADR-0018).** Nothing is injected per-spawn. The persona corpus
   reaches the model ONLY via compile-time generation into `agents/<name>.md`. No PreToolUse
   `updatedInput` anywhere in this program.
3. **L3 — Advisory tier stays advisory (A3b, 0a.3.1).** Predictions, calibration, lessons are Lab
   artifacts: they may narrow/inform, never gate a kernel decision, never widen K9, never become
   `evidence_refs` (INV-27: derived views are never evidence-linkable — lessons are advisory by
   construction and must stay un-indexable as kernel evidence).
4. **L4 — Closed enums, exact sets, content-address on read.** Every new enum is frozen + validated
   via `enum-validate.js` (NFC/homoglyph defense). File-set comparison is EXACT-SET (missing[] +
   unexpected[]), never subset `.includes` (the W2a CRITICAL class). Every store re-derives its
   record id on read (the #273 / `isAuthenticProposal` pattern).
5. **L5 — Join discipline.** Cross-artifact joins key on `tool_use_id` (Pre<->Post) or `agentId`
   (durable), NEVER `run_id` (rotates at compaction) and never spawn-record `spawn_id` (RP-9).
6. **L6 — Fail-soft in hooks, fail-closed in stores.** Hook paths exit 0 on every error (ADR-0001);
   store reads reject malformed/forged rows to null. Predictions sealed from spawns (trivially true
   per L2 — assert it in tests anyway).
7. **L7 — Idempotency carries the run.** Any record mintable across runs folds the resolved runId
   into its writer identity (the W2c `writer_spawn_id` pattern) — a shared cross-run key is
   identity-erasing.
8. **L8 — Ship gates with the code.** Any new `.js` => regenerate `docs/SIGNPOST.md` (CI string-equality
   check); any new doc => doc-path gate + bidirectional `related:`; new smoke tests use the
   `|| TNN_EXIT=$?` errexit-safe pattern; ASCII-only; zero `eslint-disable`.

## The dependency DAG

```
P0 (probes + hygiene)
  -> P1 (RFC-PP + ADR-0017 evidence law + ADR-0018 static animation)
       -> P2 (bridge bench)  --conditional--> P2b (compile bridge)
       -> P3a (prediction store, lab-only) -> P3b (binding hook + close-compare, kernel touch)
            -> P4 (calibration store + lesson store)        [P3a parallel with P2]
                 -> P5 (lesson recall + extinction)
       -> P6 (memory-surfaces map + auto-index + memory-root decision)   [after P1; parallel]
P7 (corpus-dominance A/B + /phase-close)  [needs P2b + P4]
```

Coordination with the approved arc: P3's resolver touch is ADDITIVE (new journal line kind only — no
behavior change to the verdict path) and must rebase cleanly over v3.7 work; P4/P5 leave the entire
manage-proposal store, `promote.js` OP_MAP, and the breaker SOURCES untouched (lessons live in a
dedicated store and are never kernel-promotable). If v3.8a un-darkening lands mid-program, P3-P5
re-verify against its resolver diff.

## Phases

### P0 — Ground-truth probe pack + kernel hygiene (1 PR; ~250 LoC code + spike record)

**P0.1 Probe pack** (throwaway probes; results recorded in
`packages/specs/spikes/2026-06-XX-p0-predictive-persona-probes.md` with claim/probe/observed tuples):

| Probe | Question | Method | Pre-registered fallback if negative |
|---|---|---|---|
| PR-1 | Does any hook payload (PreToolUse or PostToolUse Agent) carry a model identifier? Does the env (`CLAUDE_*`)? | temp debug hook dumping full stdin JSON + `env` during a `claude -p` Agent spawn | `animating_model` becomes an orchestrator-DECLARED field on the prediction artifact (model-asserted, labeled as such; `agents/*.md` `model:` tier recorded beside it) |
| PR-2 | Does a PreToolUse:Agent advisory approve (`{decision:'approve'}` + reason/systemMessage) surface text to the orchestrator, interactive AND headless? | temp hook emitting a marker string; observe both modes | lesson recall (P5) rides UserPromptSubmit `additionalContext` (PROVEN channel, RP-17) |
| PR-3 | Is `tool_use_id` present + stable Pre<->Post for Agent spawns in the CURRENT harness? | the same debug hook pair writing `{tool_use_id, phase}` lines; join them | binding falls back to (task_hash, close-time nearest-match) with a recorded ambiguity counter; if ambiguity > 0 in dogfood, P3 blocks on a design revisit |

**P0.2 Kernel hygiene — re-graded LOW; PULLED OUT into a standalone hygiene PR** (per the 2026-06-10
review: all four are firsthand-verified, RP-18, but each is fail-open in the cooperative single-uid
threat model — correctness/defense-in-depth chips, NOT P0 blockers; each ships with a red->green test):

1. `packages/kernel/hooks/pre/route-decide-on-agent-spawn.js` — resolve `route-decide.js` relative to
   the hook's own location (`path.join(__dirname,'../../algorithms/route-decide.js')`) with the legacy
   `~/.claude/packages/...` path as fallback; keep fail-open. Tests: resolution order; resolution
   holds from BOTH the in-repo layout AND a simulated plugin-install dir layout (verify-panel fix —
   the install copies `packages/` wholesale, so the relative offset should hold; assert it).
2. `packages/kernel/_lib/atomic-write.js` — after `_resolveForAtomicWrite`'s loop, a **uid-ONLY
   ownership check** (verify-panel code-reviewer fix: do NOT import `isSafeExecStat` from
   `safe-resolve.js` — its group-writable rejection is exec-policy and would false-refuse legitimate
   write targets): `lstat` the resolved path; exists AND `uid !== currentUid()` (with the Windows
   `selfUid===null` skip per the #283 lesson) -> return the original `filePath` unresolved. Tests:
   symlink-to-foreign-target refused; legacy library symlink still followed; group-writable
   self-owned target still written. **Scope honesty (hacker LOW):** this defends FOREIGN-uid
   redirection only; same-uid symlink redirection of lab-state dirs remains conceded (OQ-E NO-GO,
   closes at the ContainerAdapter).
3. `packages/kernel/_lib/record-store.js:440-456` — deep-freeze returned rows on ALL read paths via a
   NEW `packages/kernel/_lib/deep-freeze.js` pure recursive utility (verify-panel fix: no `deepFreeze`
   exists anywhere in `_lib/` — naming it prevents a junior shipping a shallow `Object.freeze`, the
   exact #266 class). Tests: the read-back/dedup/update immutability suite over `listByRun`/`readBy*`,
   asserting NESTED array mutation throws.
4. `packages/kernel/validators/validate-no-bare-secrets.js:286-317` — cap on-disk read at 2MB
   (over-cap -> skip scan, warn line, approve; consistent with its stdin cap). Test: over-cap fixture.

**P0.3 Doc currency** (no code): bump or pin-note `plugin.json` (decision for USER: bump to the real
shipped line vs an explicit "pinned at 3.4.0" README note); README "Enforced" list — move
promote-gate/serial-spawn/write-scope to a "shadow / opt-in (`LOOM_RESOLVER_ENFORCE`)" line; K1
Live->Dormant in README + ARCHITECTURE tables; marketplace.json drop "threshold-based auto self-improve
loop" (retired 2026-05-30).

**Probes/exit:** spike record merged with all three PR verdicts; `bash install.sh --hooks --test` green;
full kernel suite green; signpost regenerated; the 4 fixes each carry a red->green test.

### P1 — Canon: the program RFC + two ADRs (docs-only PR)

1. `packages/specs/rfcs/2026-06-XX-predictive-persona-rfc.md` — forward design candidate, frontmatter
   `amends: NOTHING — v6 stays LOCKED` (the v3.5-RFC convention). MUST cite v6 anchors by subject AND
   number (the F6 citation discipline): A1/A2/A3a/A3b/A6; 0a.3.1 no-amplification; 4.2 envelope;
   5a.1 lifecycle-as-projection; v6 11-item-21 (semantic faithfulness) + 11-item-27 (context-assembly
   traversal — read-side stays fail-closed-prohibited); OQ-E (v3.5 RFC `:324-336` — writer identity
   un-attested; all program writers inherit the fail-closed default). Contents: the four commitments,
   the predicted_envelope/calibration/lesson schemas (below), the L1-L8 laws, explicit REUSE of
   `assertion_class`/`faithfulness_status`/`claimed_*`-vs-kernel-derived (R1) /closed-enum (R4) from the
   v3.5 RFC rather than re-minting.
2. `packages/specs/adrs/0017-confirmation-hardening-requires-world-anchored-evidence.md` — tier
   technical; THREE invariants: `INV-28-WorldAnchoredHardening` ("no projection consumed by a
   hardening decision — reputation, persona selection, lesson extinction — may include a comparison
   row whose `rhs_source` is not in the closed WORLD_ANCHORED set {resolver-journal, record-store,
   test-exec, human-disposition}; `rhs_source` is INGEST-RE-DERIVED, never read from a journal
   line"); `INV-29-CoverageVisibleHardening` ("no consumer may read a hit-rate without its
   `coverage_rate` in the same row; sub-floor coverage is flagged low-coverage" — the selection-bias
   guard); `INV-30-ExtinctionIsProvenanceJoined` ("`prevented` attribution requires a
   surfaced-breadcrumb join, never cue-coincidence"). Lab-side fields; kernel-side field forbidden
   (RP-12). Also pins: sharpness-weighted scoring (vacuous = "so wide it cannot miss"), and the
   audit-only status of un-scored prediction fields.
3. `packages/specs/adrs/0018-persona-animation-is-compile-time.md` — tier technical; extends ADR-0012:
   corpus->`agents/*.md` generated block between `loom:generated:instincts` fences; SynthId rotation on
   corpus recompile is INTENDED semantics (a corpus change IS a persona version change — `synthid.js`
   already hashes `agent_md_hash`); records the P2 bench gate as the build precondition.
4. ROADMAP: add "Track 3 — Predictive-Persona (P-track)" section mirroring Track 2's format.

**Probes/exit:** markdownlint + doc-path gate green; `contracts-validate.js` asymmetric-related-link =
0; honesty-auditor VALIDATE pass on the RFC (claim-vs-evidence, esp. that no section overclaims
"enforced" for shadow machinery).

### P2 — Bridge bench (honors the standing bench-before-build decision, RP-14)

Pre-registered experiment (design frozen in the per-wave plan BEFORE running — this program's own
medicine): scenario set n>=6 drawn from `packages/specs/bench/` precedent, 2 arms x 3 personas
(architect, code-reviewer, hacker): **arm A** current `agents/*.md`; **arm B** the same file with a
hand-compiled instinct block (the exact output P2b's generator would produce). Planted-defect rubric
per scenario. Metrics: (m1) planted-defect classes caught; (m2) named-instinct citation in findings
(legibility); (m3) output-contract compliance.

**Pre-registered decision rule (unit pinned per verify panel):** the unit of analysis is the
(scenario, persona) pair, persona held fixed across arms. A pair counts FOR arm B iff arm B's findings
cover a planted-defect class that the same persona's arm A findings do not, where "covers" = names the
defect location AND the failure mode per the rubric. BUILD P2b iff >=2 (scenario, persona) pairs count
for arm B; **regression guard:** any pair where arm B MISSES a class arm A caught is a strike — >=2
strikes vetoes the build regardless of wins. Otherwise P2b DEFERS (re-bench after P4 calibration data
exists to enrich the corpus) and the program proceeds P3->P7 without the bridge (P7's corpus arm then
uses the hand-compiled blocks). Result recorded in `packages/specs/bench/EXPERIMENT-LOG.md`.

### P2b — The compile bridge (CONDITIONAL on P2)

1. `packages/runtime/orchestration/compile-instincts.js` — deterministic, idempotent generator:
   reads `personas/NN-<name>.md` `## Mindset` via `_lib/instinct-slug.js` (single source, RP-3),
   emits a sorted, ASCII-only block into `agents/<name>.md` between
   `<!-- loom:generated:instincts:begin -->` / `:end` fences (RP-2: fences are net-new). Idempotent:
   second run = byte-identical. `--check` mode for CI.
2. Freshness validator: new key in `contracts-validate.js`'s auto-enumerated validators dictionary
   (the persona-instinct-reconcile pattern, RP-3): recompute expected block vs on-disk block ->
   violation `instinct-block-stale` / `instinct-block-tampered`. CI-blocking.
3. Tests: golden-file per one fat + one thin agent shape (RP-1: both shapes exist — the generator
   appends the block without disturbing either); drift detection; markdown-emphasis discipline of
   generated content (underscore tokens backticked).

**Probes/exit:** `node compile-instincts.js --check` green in CI; `bash install.sh --hooks --test`
green; SynthId rotation observed once + `pendingSynthIdDrift` semantics documented in ADR-0018.

### P3a — the prediction store (shadow; lab-only, zero kernel touch)

**Schema** (`prediction-v1`, validated at write; closed enums per L4):

```json
{
  "prediction_id": "<sha256 of canonical body — content-addressed, re-derived on read>",
  "schema_version": "prediction-v1",
  "task_hash": "<sha256 of NFC-normalized Agent prompt text>",
  "subagent_type": "<agentType string — part of the pending key>",
  "registration_nonce": "<orchestrator-minted random hex — binding anti-theft, see P3b>",
  "animating_model": "<per P0 PR-1: harness-sourced, else orchestrator-declared + flagged>",
  "predicted": {
    "files": ["<path globs, K7-canonicalized; universal matchers (** or bare *) REJECTED>"],
    "file_count_band": [1, 4],
    "delta_loc_band": [10, 200],
    "expects_tests": { "value": true, "audit_only": true },
    "expected_sections": { "value": ["<headings>"], "audit_only": true }
  },
  "confidence": 0.7,
  "created_at": "<iso>"
}
```

`audit_only` fields are pre-registered but NEVER scored (the close-compare derives only git-checkable
facts); they exist for a future `test-exec` rhs and are excluded from hit/Brier math — no downstream
consumer may treat them as world-anchored (verify-panel honesty fix).

1. `packages/lab/prediction/store.js` + `cli.js` (`register`/`list`) — lab conventions per RP-10:
   pending key = `pending/<task_hash>-<subagent_type>.json` (the verify-panel fan-out fix: the
   3-lens pattern spawns near-identical prompts to DIFFERENT personas concurrently — task_hash alone
   silently strands 2 of 3 predictions); atomic-write, `withLabLock` advisory, enum-validate +
   free-string-checks, content-address re-derived on read.
2. **Sharpness floor (the Goodhart guard, hacker fix — width, not presence):** a prediction is stored
   `vacuous:true` (kept, never scored) when `files` is empty AND either band is wider than the caps
   (`file_count_band` width > 6; `delta_loc_band` width > 500), or when any glob is a universal
   matcher. Scoring weights hits by SHARPNESS: a wide-band hit contributes near-zero (Brier-style over
   `confidence`, extended by band-width weight) — a confident always-matching prediction earns nothing.

**Tests (TDD):** content-address re-derive on read (forged id -> null); vacuous classification edges;
universal-glob rejection; sharpness weights; symlinked store file refused (uid-ownership, P0.2 pattern).

**Probes/exit:** store fully unit-tested in isolation; signpost regenerated. No kernel file touched.

### P3b — binding hook + close-compare (shadow; the kernel touch)

1. **Binding — a NEW sibling PreToolUse:Agent hook** `packages/kernel/hooks/pre/prediction-bind.js`
   (NOT folded into route-decide: SRP + isolates failure + keeps the spawn-admission path lean —
   verify-panel architect fix). Fast-path: `existsSync(pending/<task_hash>-<subagent_type>)` BEFORE
   any lock — the common unpredicted case costs one stat. On hit: move -> `bound/<tool_use_id>.json`
   carrying the `registration_nonce`. **Fail-closed collision rule (hacker fix):** >1 unconsumed
   pending file for the same `(task_hash, subagent_type)` -> bind NONE, journal
   `prediction-binding-ambiguous`, increment a collision counter — never latest-mtime-wins (an
   attacker-precomputable task_hash + mtime-wins = binding theft). Hook fail-open, <=50ms budget.
2. **Close-compare in `recordSpawnProvenance`** (RP-7) with `tool_use_id` THREADED (RP-19: extract in
   `main()` alongside `agentId`, pass through `resolveAndJournal` -> `recordSpawnProvenance` — two
   signature changes + the `:750` call site, not a bare insert). The actual file set: the current
   `:499` porcelain call is a dirty-BOOLEAN only and discards paths (verify-panel code-reviewer fix)
   — capture and parse the porcelain output to an exact path list. Compare EXACT-SET predicted globs
   vs actual paths -> `{files_missing[], files_unexpected[], count_band_hit, loc_band_hit}`; append
   journal line `{kind:'prediction-compare', tool_use_id, agentId, prediction_id,
   registration_nonce, error:{...}, hit, compared_at}`; move bound -> `compared/`.
   **Coverage denominator (architect fix — selection-bias):** on EVERY Agent close, also append
   `{kind:'prediction-coverage', agentId, subagent_type, predicted: true|false}` — so P4 can compute
   how selective the orchestrator's predicting was. Resolver verdict path UNCHANGED (L3); fail-soft
   (L6). Note: the journal line does NOT carry `rhs_source` — P4's ingest DERIVES it (hacker
   INV-28 fix; a self-asserted source field on a forgeable line is worthless).
3. Orchestrator-side discipline ships as dogfood instruction only (a `/predict-spawn` skill +
   workflow.md sub-rule are deferred to /self-improve AFTER P4 produces evidence).

**Tests (TDD):** concurrent fan-out (3 pending for the same prompt across {architect, code-reviewer,
hacker} -> each binds its own, zero false-absence); ambiguous-collision fail-closed; exact-set compare
(superset-decoy fixture — the W2a class); band edges; glob canonicalization (`..`/absolute rejected via
K7); missing-prediction -> coverage line only; malformed/forged prediction -> `prediction-unreadable`
journal line; nonce mismatch at close -> refused; resolver never exits non-zero.

**Probes/exit:** dogfood — one REAL spawn end-to-end produces `prediction-compare` + a coverage line
(the v3.3 Wave-0 un-darkening standard); 3-lens VALIDATE + hacker re-probe of the BUILT binding/compare
path (Rule 2a); suite + signpost green.

### P4 — Calibration store + lesson candidates (shadow; lab)

1. `packages/lab/calibration/store.js` + `ingest.js` + `projections.js` + `cli.js` — ingest reads
   `prediction-compare` journal lines (the `enrich-from-spawn-state.js` precedent). **`rhs_source` is
   RE-DERIVED by ingest, never read from the line (hacker CRITICAL fix — the journal is same-uid
   forgeable):** ingest independently re-verifies the actual side against kernel artifacts (re-read
   the spawn's record-store transaction by agentId — content-address-verified per #273 — and recompute
   the EXACT-SET compare itself from the recorded actuals); only a line whose compare ingest can
   reproduce is stamped `rhs_source:'resolver-journal'`; an unverifiable line ingests as
   `rhs_source:'unverified'` (stored, NEVER hardening-eligible). Same-uid forgery of the underlying
   git/record state itself remains the conceded OQ-E residual (named in Out-of-Scope). Ledger row:
   `{calibration_id (content-addressed), prediction_id, tool_use_id, agentId, subagent_type,
   animating_model, rhs_source (closed enum: resolver-journal|test-exec|human-disposition|unverified),
   error, hit, sharpness_weight, recorded_at}`. Idempotency folds (prediction_id, runId) per L7.
2. Projections: per-`subagent_type` rolling hit-rate (window 50) + Brier-style score over
   `confidence` vs `hit`, sharpness-weighted (P3a); **every projection row CARRIES
   `coverage_rate = predicted_spawns / total_spawns`** (from the P3b coverage lines) so no consumer
   can read a hit-rate without seeing how selective the sample was (architect fix — a world-anchored
   hit-rate over a self-selected sample is still misleading); **the only export consumable by any
   selection/reputation logic filters `rhs_source` to the WORLD_ANCHORED set AND flags
   `coverage_rate < 0.5` rows low-coverage (INV-28 + INV-29)** — test-enforced with forged-row +
   low-coverage fixtures.
3. Lesson candidates — **a DEDICATED store** `packages/lab/lesson/store.js` (+ thin cli) (RP-20:
   manage-proposal's `validateTargets` requires 64-hex kernel txids and its proposal_id does not bind
   cues/claim — reuse is mechanically impossible AND identity-unsound; hacker CRITICAL).
   `lesson_id = sha256(canonicalJsonSerialize([schema_version, trigger_cues_canonical, claim]))` —
   the content-address covers the ENTIRE recalled body, so a same-uid edit of either invalidates the
   id and the row is skipped on read (the #273 invariant). Record: `{lesson_id, trigger_cues[]
   (globs + keywords; K7-canonicalized), claim (free-string-checked, 512B cap, PLUS an
   instruction-shape rejector at mint — see P5), evidence_pointer (journal-line ref — advisory; by
   construction NEVER a kernel evidence_refs entry; L3/INV-27), disposition (pending|approved|
   rejected — the manage-proposal disposition PATTERN mirrored, human-gated, writer-unauthenticated
   same as all Lab stores), surfaced_count, prevented_count, proposed_by:'calibration-ingest',
   created_at}`. On `hit:false`, ingest mints a pending lesson. Manage-proposal's enums/store are NOT
   touched by this program (the earlier op_type:'lesson' design is WITHDRAWN per the verify panel).

**Tests:** ingest idempotency (re-run = 0 new rows); rhs re-derivation (forged journal line whose
compare does not reproduce -> `unverified`, excluded from hardening projection); INV-28/INV-29
exclusion fixtures; lesson content-address re-derive on read (edited claim -> row skipped); a
lesson `evidence_pointer` shaped like a kernel evidence_ref is NEVER accepted by any kernel admission
path (the INV-27 laundering guard — honesty-panel FLAG); manage-proposal store untouched (no new
op_type — regression grep).

**Probes/exit:** dogfood — the P3b spawn's journal line lands as a calibration row with a re-derived
`rhs_source`; one synthetic miss mints a pending lesson visible in the lesson CLI; 3-lens VALIDATE
(data-mutation class).

### P5 — Lesson recall (cue-matched delivery) + extinction

1. Recall projection: `approved` lessons (P4 store) -> `lab-state/lesson-recall/approved.json`
   (regenerable derived view; never evidence-linkable, L3).
2. Delivery hook on the PROVEN channel (RP-17): a UserPromptSubmit sibling of
   `prompt-enrich-trigger.js` matching prompt text against `trigger_cues` (deterministic keyword/glob
   only — no LLM in a hook, A2), emitting via PLAIN STDOUT TEXT exactly as `prompt-enrich-trigger.js:436`
   does. **Injection hardening (hacker CRITICAL fix — an approved claim is a prompt-injection sink):**
   the hook NEVER emits free-form claim prose as instructions. Fixed structural template only:
   `[LESSON-RECALL] On tasks matching <cues>, this persona missed <N> of <M> predictions. Prior
   observation (DATA, verify before acting): "<claim, quote-delimited>"` — the claim rendered as a
   clearly-delimited quoted DATA block, never an imperative; length-capped; ASCII-enforced. AND at
   MINT time (P4) the claim validator rejects instruction-shaped prose (imperative-to-the-model
   markers: `ignore`, `system`, `you must`, tool-invocation shapes) — two independent layers. If P0
   PR-2 proved the PreToolUse:Agent channel, a spawn-time variant may ALSO fire — ship the proven
   channel first. <=3 matches per prompt.
3. **Surfaced->spawn breadcrumb (architect HIGH fix — `prevented` must be provenance-joined, not
   cue-coincidence):** the recall hook appends `{lesson_id, cues, surfaced_at}` to a session-scoped
   `lab-state/lesson-recall/surfaced/<session_id>.jsonl`. The P3b close-compare (which has
   `session_id` in its payload) reads that breadcrumb; a later HIT marks `prevented` ONLY for lessons
   actually surfaced in this session whose cues match the spawn. A cue-match without a surfaced
   breadcrumb increments a separate, explicitly NON-hardening `cue_cooccurrence_count` (display-only).
4. Extinction: projection flags lessons `surfaced_count>=5 AND prevented_count==0` -> sets the
   lesson's disposition to a `cull-pending` state requiring HUMAN confirmation in the lesson CLI
   (mirroring the v3.6 human-gate pattern; the manage-proposal machinery itself is not involved —
   lessons live in their own store per P4).
5. MEMORY.md L0: process note only — top-K approved lessons may be hand-promoted to one-liners at
   pre-compact curation (no automation).

**Tests:** matcher determinism + k-cap + <100ms budget; non-approved lessons never surface (store
separation); instruction-shaped claim REJECTED at mint (fixture set: imperative/system/tool-shapes);
template rendering never exceeds caps + claim always quote-delimited; breadcrumb join (HIT with
surfaced breadcrumb -> prevented; HIT with cue-match but no breadcrumb -> cooccurrence only);
extinction state math; hook fail-soft; ASCII output.

**Probes/exit:** dogfood — an approved synthetic lesson surfaces on a matching prompt in a real
session; an extinguished one stops; 2-lens VALIDATE (code-reviewer + hacker on the BUILT injection
surface per Rule 2a: adversarial claims attempting template escape).

### P6 — Memory-surfaces map + auto topic index + the memory-root decision

1. `docs/concepts/memory-surfaces.md` — canonical 2-level map: PLUGIN level (CLAUDE.md stateless
   signpost -> MEMORY.md dynamic anchors -> library narrative/schematic stores) vs PERSONA level
   (corpus = personas/*.md + contracts + compiled agents-block; calibration; lessons;
   identity/reputation). Per surface: owner, write path, read path, lifecycle, what it must NEVER do
   (e.g. CLAUDE.md never holds state; lessons never become evidence). Bidirectional `related:` links
   (the kb gate fixpoint discipline).
2. Auto topic->location index: extend `packages/kernel/recall/signpost.js` with a topic-index section
   (topic -> path, derived from layer/subgroup + header purposes) emitted into `docs/SIGNPOST.md`;
   freshness rides the EXISTING CI `--check` string-equality gate (RP/F5) — no new gate machinery.
3. **memory-root decision (forced, both options costed; USER picks at the per-wave plan):**
   (a) WIRE minimally — the three new lab stores resolve their base dir through
   `resolvePointer().manifests` with env-var precedence preserved (first production importers;
   un-darkens ADR-0014; INV-26 atomic updates); or (b) RETIRE per the K6 precedent (zero importers,
   RP-13, YAGNI). Recommendation: (a) — three real consumers now exist, the discovery problem
   ADR-0014 names is real for per-project scoping, and the cost is ~30 LoC.

**Probes/exit:** doc-path gate + asymmetric-link = 0; signpost `--check` green post-regen; if (a),
`memory-root.test.js` extended with the consumer path.

### P7 — Corpus-dominance A/B + program phase-close

The load-bearing experiment for the persona thesis (pre-registered design frozen before running):
matrix {corpus block ON/OFF (P2b fences toggled)} x {model tier A/B (`model:` opus vs sonnet on the
same personas)} over a fixed scenario set (>=8 tasks); outcomes: (o1) calibration hit-rate (from P4 —
world-anchored), (o2) planted-defect coverage, (o3) contract compliance. Variance read: corpus
main-effect vs model main-effect per outcome.

**Pre-registered decision rule (statistic + threshold pinned per verify panel):** main-effect = the
mean per-cell outcome delta (corpus ON minus OFF, averaged over both model tiers; model A minus B,
averaged over both corpus arms). Verdict CONFIRMED-directionally iff the corpus main-effect exceeds
the model main-effect by >= a pre-registered minimum (default: 10% of the outcome's observed range)
on >=2 of 3 outcomes; a corpus edge below the minimum on all outcomes = **NO DIRECTIONAL SIGNAL**
(not "confirmed" — a 0.001 edge must not round up); honest label regardless: small-n, self-run,
single-user. Else -> corpus-content rework precedes any further persona investment. EXPERIMENT-LOG
entry either way; the rule text is frozen in the P7 per-wave plan BEFORE the first run.

**Then `/phase-close` Track 3** (PM=honesty-auditor + Principal-SDE + architect) against the ECs:

| EC | Criterion |
|---|---|
| EC1 | Prediction loop live-in-shadow end-to-end on a REAL spawn (journal line + calibration row) |
| EC2 | No model-asserted hardening path exists (INV-28 test-enforced; honesty lens re-verifies) |
| EC3 | Lesson lifecycle closed on >=1 real lesson: mint -> human approve -> recall -> extinguish-or-survive |
| EC4 | P2 + P7 bench verdicts recorded with their PRE-REGISTERED decision rules honored (no post-hoc rule edits) |
| EC5 | Memory-surfaces map merged; P0.3 doc currency shipped; recall hook adds zero always-on context tax beyond its <=3-match advisory |
| EC6 | ONE world-anchored calibration hit demonstrably narrows ONE downstream decision end-to-end (dogfood, advisory-only — e.g. a low-hit-rate + adequate-coverage persona surfaces an advisory note at selection time). Without this the thesis verb ("trust ACCRUES") is never exercised — measurement without consumption does not close the loop (verify-panel honesty HIGH) |

## Files To Modify (arc-level; per-wave plans carry the authoritative diffs)

| Path | Wave | Action | Risk |
|---|---|---|---|
| `packages/kernel/hooks/pre/route-decide-on-agent-spawn.js` | P0.2, P3 | fix path; add binding | medium (hook blocking path) |
| `packages/kernel/_lib/atomic-write.js` | P0.2 | containment check | medium (every store write) |
| `packages/kernel/_lib/record-store.js` | P0.2 | deep-freeze reads | low (additive freeze) |
| `packages/kernel/validators/validate-no-bare-secrets.js` | P0.2 | size cap | low |
| `plugin.json`, `README.md`, `docs/ARCHITECTURE.md`, `.claude-plugin/marketplace.json` | P0.3 | currency | low (docs) |
| `packages/specs/rfcs/2026-06-XX-predictive-persona-rfc.md` | P1 | NEW | low |
| `packages/specs/adrs/0017-*.md`, `0018-*.md` | P1 | NEW | low |
| `docs/ROADMAP.md` | P1, each wave | Track 3 section | low |
| `packages/specs/bench/EXPERIMENT-LOG.md` | P2, P7 | entries | low |
| `packages/runtime/orchestration/compile-instincts.js` (+ validator key in `contracts-validate.js`) | P2b | NEW | medium (touches all 18 agents/*.md) |
| `agents/*.md` (generated fenced block) | P2b | generated | medium (SynthId rotation — intended) |
| `packages/kernel/_lib/deep-freeze.js` | P0.2 | NEW pure utility | low |
| `packages/lab/prediction/{store,cli}.js` | P3a | NEW | medium (new store) |
| `packages/kernel/hooks/pre/prediction-bind.js` + `hooks.json` | P3b | NEW sibling hook | medium (spawn-admission path; fail-open + fast-path) |
| `packages/kernel/hooks/post/spawn-close-resolver.js` | P3b | thread `tool_use_id` (main + 2 signatures) + additive compare/coverage journal lines | **high** (kernel resolver — 3-lens + hacker re-probe) |
| `packages/lab/calibration/{store,ingest,projections,cli}.js` | P4 | NEW (ingest re-derives `rhs_source`) | medium |
| `packages/lab/lesson/{store,cli}.js` | P4 | NEW dedicated store (manage-proposal NOT touched) | medium |
| `packages/kernel/hooks/lifecycle/lesson-recall.js` (UserPromptSubmit) + `hooks.json` | P5 | NEW hook | medium (always-on path; fail-soft + budget) |
| `packages/kernel/recall/signpost.js`, `docs/SIGNPOST.md`, `docs/concepts/memory-surfaces.md` | P6 | extend + NEW | low |
| `packages/kernel/_lib/memory-root.js` consumers (option a) | P6 | wire or retire | low |
| `tests/unit/{kernel,lab,runtime}/...` | all | NEW per wave | — |

## Verification Probes (aggregate)

| # | Probe | Pass criterion |
|---|---|---|
| 1 | `bash install.sh --hooks --test` | all numbered tests pass, 0 failed (every wave) |
| 2 | `find tests/unit/kernel tests/unit/lab tests/unit/runtime -name '*.test.js' -print0 \| xargs -0 -n1 node` | all green (every wave) |
| 3 | `node packages/runtime/orchestration/contracts-validate.js` | 0 violations incl. new `instinct-block-*` (P2b+) |
| 4 | `node scripts/generate-signpost.js --check` | clean (every wave adding .js) |
| 5 | `node scripts/validate-doc-paths.js` | clean (P1, P6) |
| 6 | Dogfood spawn end-to-end | `prediction-compare` journal line + calibration row from ONE real spawn (P3/P4 exit; EC1) |
| 7 | INV-28 fixture | forged `rhs_source` row never reaches the hardening projection (P4+; EC2) |
| 8 | Lesson lifecycle | mint->approve->recall->extinguish on a real lesson (P5; EC3) |
| 9 | Bench logs | P2 + P7 EXPERIMENT-LOG entries with pre-registered rules verbatim (EC4) |
| 10 | Per-wave gates | `/verify-plan` before each build; 3-lens VALIDATE on P0.2/P3/P4; hacker re-probe of built P3; `/phase-close` at P7 |

## Out of Scope (Deferred — honest discipline)

- **The OQ-27 read-side graph walker** — recall stays keyword/glob L1; traversal remains fail-closed
  PROHIBITED (v6 11-item-27).
- **Semantic predictions** ("the approach will be correct") — only kernel-checkable envelope facts are
  scored; semantic rungs await the OQ-21 calibration owed from v3.5.
- **Reputation consumption of calibration** (persona-selection weighting) — the projection ships;
  wiring it into selection waits for >=1 window of dogfood data + a dedicated plan.
- **Writer authentication** for prediction/lesson stores — inherits OQ-E NO-GO; all writers are
  un-attested; fail-closed defaults per L1/L3 (advisory-only) bound the exposure, same as every Lab store.
- **Persona corpus sharing/export** — MemMorph-class poisoning surface; needs signed-lineage design first
  (one-line reservation in the RFC only).
- **Rule/skill promotion** (`/predict-spawn`, workflow.md sub-rule) — after evidence, via `/self-improve`.
- **ContainerAdapter interactions** — Track 2 unchanged; this track is sandbox-independent by being advisory.

## What this DOESN'T claim to fix

The loop measures and recalls; it does not make the model smarter, does not authenticate writers
(OQ-E — ingest re-derivation narrows journal forgery but same-uid tampering with the underlying
git/record state remains conceded), does not validate lesson semantic faithfulness (v6 11-item-21),
and the corpus-dominance verdict is single-user/small-n — directional evidence, not proof. The recall
channel's headless propagation is bounded by GAP-D until PR-2 says otherwise. And beyond EC6's single
dogfood narrowing: the loop MEASURES world-anchored calibration but does not yet CONSUME it in
production selection/reputation decisions (deferred per Out-of-Scope) — trust is measured, and
exercised once, not yet systematically accrued-into-decisions.

## Drift Notes

- **Drift-note 1**: route-decide scored this program `root` at 0.075 — the substrate-meta dictionary
  gap recurring on a maximal instance (kernel+lab+security tokens all missed). Dictionary-expansion
  candidate; counted toward the standing `[ROUTE-META-UNCERTAIN]` evidence.
- **Drift-note 2**: the F4 recon agent (Explore type) failed StructuredOutput twice — schema-forcing
  works reliably on codebase-analyzer but not Explore in this run; workflow-authoring note.
- **Drift-note 3**: plan-template.md prose ("Mandatory sections") diverges from the validator's
  actual tiers (F5) — doc-fix candidate, separate from this program.
- **Drift-note 4**: the contract-reminder hook's header still claims `updatedInput` works (RP-5) —
  P0.3 should add the tombstone comment to the hook header (1-line doc fix, folded into P0).

## Principle Audit

- **SRP**: each new store does one thing (prediction registry / calibration ledger / recall
  projection); compare logic lives in one pure module consumed by the resolver, not embedded.
- **OCP**: new capability lands as NEW stores + NEW hooks + new validator dictionary keys — zero
  edits to manage-proposal enums/OP_MAP/breaker (the lesson store is additive-by-separation);
  signpost extended, not forked.
- **DRY**: `instinct-slug.js` stays the single slug source (P2b reuses, never re-implements);
  enum-validate/free-string-checks reused (the #267 consolidation); the W2c idempotency idiom reused.
- **KISS**: bands + exact-sets, not semantic diffing; keyword/glob recall, not embeddings; UserPromptSubmit
  (proven) over novel channels.
- **YAGNI**: no graph walker, no embeddings, no auto-rule-promotion, no reputation wiring until data
  exists; memory-root wired ONLY because three real consumers now exist (else retire).
- **Dependency rule**: all new stores are lab-tier importing only `kernel/_lib`; the resolver touch is
  kernel-internal; no kernel->lab import anywhere.

## Pre-Approval Verification

**Panel (2026-06-10, parallel read-only spawns):** architect APPROVE-WITH-FIXES · code-reviewer
APPROVE-WITH-FIXES · hacker NEEDS-REVISION (3 CRITICAL) · honesty-auditor APPROVE-WITH-FIXES.
All CRITICAL/HIGH findings were premise-probed firsthand against source before folding (per the
async-review-gate discipline); every fold is marked "verify-panel ... fix" inline above.

| # | Lens | Sev | Finding (condensed) | Disposition |
|---|---|---|---|---|
| 1 | hacker | CRITICAL | Lesson-as-manage-proposal mechanically impossible (`validateTargets` HEX64-requires; `proposal_id` does not bind cues/claim) | FOLDED — dedicated `lab/lesson` store, full-body content-address (RP-20; P4.3 rewritten; manage-proposal untouched) |
| 2 | hacker | CRITICAL | Approved-lesson `claim` is a prompt-injection sink into UserPromptSubmit context | FOLDED — fixed structural template, claim as quote-delimited DATA, mint-time instruction-shape rejector, length caps (P5.2) |
| 3 | hacker | CRITICAL | INV-28 void if ingest trusts the forgeable journal's self-asserted `rhs_source` | FOLDED — ingest RE-DERIVES `rhs_source` by reproducing the compare against record-store/git; unverifiable lines -> `unverified`, never hardening-eligible (P4.1); same-uid residual conceded explicitly |
| 4 | arch+cr+hon (convergent) | HIGH | `tool_use_id` never read by the resolver today; join-key asserted not verified | FOLDED — RP-19 added (kb-citation-gate `:143` proves the field exists at close); P3b specifies the threading (main + 2 signatures + call site); PR-3 re-confirms empirically |
| 5 | architect | HIGH | task_hash-only binding strands predictions in the canonical 3-lens same-prompt fan-out | FOLDED — pending key = (task_hash, subagent_type); concurrent fan-out TDD case (P3a/P3b) |
| 6 | architect | HIGH | Selective non-registration biases calibration toward easy tasks | FOLDED — coverage line on EVERY close; `coverage_rate` rides every projection row; INV-29 (P3b.2, P4.2, ADR-0017) |
| 7 | architect | HIGH | `prevented` extinction signal was cue-coincidence, not provenance | FOLDED — surfaced-breadcrumb session join; non-joined matches demoted to display-only co-occurrence; INV-30 (P5.3) |
| 8 | hacker | HIGH | Vacuous floor gamed by finite-but-huge bands; mtime-wins binding theft | FOLDED — width caps + universal-glob rejection + sharpness-weighted scoring (P3a.2); fail-closed ambiguous-collision + registration nonce (P3b.1) |
| 9 | code-reviewer | MEDIUM | `isSafeExecStat` reuse would false-refuse group-writable write targets; no `deepFreeze` exists in `_lib` | FOLDED — uid-only check spelled out; NEW `_lib/deep-freeze.js` (P0.2) |
| 10 | architect | MEDIUM | Binding overloaded route-decide hook (SRP); P3 too big for one PR | FOLDED — NEW sibling `prediction-bind.js` hook; P3 split into P3a/P3b |
| 11 | honesty | HIGH+MED | Thesis verb ("accrues") exercised by no EC; channel mislabeled `additionalContext`; un-scored schema fields straddle; P7 rule unfalsifiable at the `>=` razor edge | FOLDED — EC6 added; RP-17 corrected to stdout-text; `audit_only` markers; P7 statistic + minimum-threshold + no-signal band; thesis-gap line in What-this-DOESN'T-fix |
| 12 | arch/hacker/hon | MED/LOW/FLAG | P2 rule unit ambiguity; P2b generated-block markdown injection; lesson evidence-laundering guard; plugin-layout resolution test; same-uid concession wording | ALL FOLDED — (scenario,persona) unit + regression strikes (P2); generator strips structure + validator rejects `tools:`/`model:` keys in block (P2b); INV-27 laundering test (P4); both P0.2 test additions |

**Withdrawn by this verification:** the original `op_type:'lesson'` manage-proposal design (P4.3) —
replaced by the dedicated lesson store. **Net verdict after folds: ready for USER review.** Each wave
still runs its own `/verify-plan` against its per-wave plan before build (this table verifies the ARC,
not the per-wave diffs).
