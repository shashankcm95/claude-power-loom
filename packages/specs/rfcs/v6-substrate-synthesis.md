<!-- v6 DRAFT IN PROGRESS — §0/§0a/§3 at v6; §4+ still at v5.4 pending Rounds 2-3 -->

# v6 Substrate Synthesis — Power Loom (LIVE-DRAFTING)

**Status**: v6 LIVE-DRAFTING (Round 1 of 3 — §0/§0a/§3 at v6 quality; §4+ pending). Supersedes v5.4 BLUEPRINT-LOCKED upon Round-3 completion. v5.4 provenance preserved below; v6 changelog inlined at §0.v6.
**Branch**: `feat/v3.0-phase-1-verification-spike` (no-merge spike).
**Version provenance chain**:
- v1 (initial synthesis) → Round-1 pair-review (3 reviewers; 5 CRITICAL + 21 HIGH)
- v2 (Round-1 absorbed) → Round-2 lighter-touch (PUBLISHABLE-AS-DRAFT)
- v2 + external GPT analysis → **v3** (three-layer formalization + MVP staging) → Round-3 deep pair-review (3 reviewers; **6 CRITICAL** + ~20 HIGH)
- v4 = v3 + Round-3 absorptions + user-direct concerns
- v4.1 = Wave -1 P-WriteScope FAIL forced K14 + A1 restatement
- v4.2 = Round-5 architect absorbed (BLUEPRINT-READY): A7 promoted; K9↔K14 §6.5.1; OQ-11/16 closed; effort 40-70h / abort 140h; ADR renumber
- v4.3 = external research brief absorbed (3 verified citations, 2 misquotes rejected): K9 rollback scope §6.5.2; K8 read-only path mask criterion; OQ-17 added
- v5 = field-survey triage absorbed (Round-6 architect; ext-research-agent): R13 idempotency promoted to v3.1; K3.b context envelope NEW in v3.0-alpha; §10b "Considered and Rejected"; container adapter / prompt-injection / network-egress deferred to v3.5+ with v3.1 stopgaps; OQ-18 P-Snapshot probe; per-tool-call observability vs gating split
- v5.1 = vision-pillar alignment analysis absorbed (Round-7 architect `a6def7d4996a71b24`): K12 DOWNGRADED from mandatory CI enforcement to convention + advisory after empirical-zero-drift finding (6 months on spike branch, zero cross-layer drift observed; `_lib/` extraction pattern yields acyclic-by-construction without K12); OQ-19 added (upgrade trigger: ≥3 drift events); v3.0-alpha effort -100-120 LoC / -2h
- v5.2 = §0a Four Vision Pillars map added as load-bearing alignment test for all future amendments; M1 reframed as Pillar 2 EXTENSION (inputs-as-Byzantine); M2 reframed as Pillar 1+3 EXTENSION (rollback-completeness); pillar-grounding test codified for future amendments (principle-tier → convention+advisory; pillar-tier → mandatory). Full alignment (11/11) with vision-pillar analysis achieved.
- v5.3 = external GPT v5.2 review + architect pair-review (`ab188213c13a2f8cd`) + independent web research absorbed. **3 amendments applied**: (1) §0 audience-specific framings (CI/CD-moved-earlier; databases→CI/CD→Loom reliability lineage; production wager marked AS a wager not a fact; human-org one-liner); (2) §0c Organizational Engineering Analogy section — full mapping table with release-availability per row + "physical embodiment / K13" framing + honest org-structure gap acknowledgment; (3) §6.13 Operational Invariants — 15 executable property contracts, per-primitive naming (`INV-{Primitive}-{Property}`), version-gated per activation release, with field-standard terminology notes (POLA, Temporal-replay-relaxation, ACID atomicity, Nix hermetic builds, GitHub required-checks). Architect rewrites incorporated: K4 corrected to K5/K7/K9-pre (K4 is recall not a gate); syntactic-vs-semantic atomicity caveat per §6.5.2; 6 missing invariants added (INV-K2-SchemaForwardCompat, INV-K2-SpawnRecordSchemaValid, INV-K3-LineageAcyclicity, INV-K14-PostDetectionEnforcement, INV-K13-SerialOnly, INV-R13-IdempotencyKeyUniqueness); INV-A6-PolicyVersionedReplay flags a schema-additive K2 update for v3.0-alpha (`policy_version` field, ~5 LoC) to prevent v3.3 envelope-schema break. Independent web verification confirmed all field-survey citations (Microsoft Agent Governance Toolkit 2026/04, Praetorian verbatim "leaf node" sub-agent quote, arxiv 2603.16586 "Policies on Paths" matching K9↔K14 framing, MI9 arxiv 2508.03858 runtime-only-risk framing, SAGA arxiv 2504.21034, Temporal "complexity cliff", LangGraph durable-execution docs) — no fabrications detected this round.
- **v6 (this document, LIVE-DRAFTING)** = MAJOR-tier **design** amendment to v5.4 (implementation budget believed-but-not-yet-proven to remain within envelope per GPT-2.F honest framing). Drivers (full text in §0.v6 below): (D1) file-based memory as DB requires explicit consistency model → +A8/A9/A10 axioms; (D2) C0 endorsements decision — derived view not primitive → +E14 Lab spec + 3 invariants; (D3) Pillar 3 anti-amplifier clause refined post-3-FAIL → §0a.3.1 normative text; (D4) Memory Root Pointer Convention → §5a.9 + INV-26/27. **Net additions (LOCK-honest counts after HD-1 + GPT-2.A + Gemini-3.1-Pro GP1 fixes)**: +3 axioms (7→10), **ZERO new K-primitives** (Kernel total unchanged at 14; earlier-draft "K15 DeltaRef" + "K16 Memory-Read-Audit" were phantom claims, removed per LOCK-review HD-1), +1 Lab spec (E14), **+14 invariants (15→29)** spanning C0 (3: INV-16/17/18), consistency model (8: INV-19..25 + INV-A9-RecoverySweepIdempotent), Memory Root Pointer (2: INV-26/27), K13×K14 tail-window interlock (1: INV-28-K13K14SerialClosure per Gemini 3.1 Pro v6 LOCK Patch GP1), +1 new section (§5a Memory Consistency Discipline), +2 ADRs (ADR-0013, ADR-0014), +2 §10b reject-entries. v3.0-alpha through v3.4 release-cycle hour ranges are CLAIMED unchanged at the row totals; HD-3 disclosure (§6.11) acknowledges that v3.0-alpha and v3.3 row totals were not explicitly updated for v6 additions — v3.x LOCK reviews may need row expansion. K2 reservation PR (~180-285 LoC, ~6-9h) for memory-root.js reader + transaction-record envelope schema additions is intended to sit inside v3.0-alpha envelope but **the budget reconciliation is asserted, not proven** (GPT-2.D); full v6 consistency model (transaction-record shape + WAL semantics + recovery sweep + pointer reader + property tests) still requires explicit reconciliation against v3.0-alpha at LOCK time. Two-round cross-artifact composition review GO verdict + LOCK review (architects `abeab45aa7a080a27` + `a441e3cbe874c2209` + `a0bf0cd9` + GPT external + Gemini Flash external + Gemini 3.1 Pro external — Gemini 3.1 Pro surfaced 3 load-bearing findings missed by all prior reviewers: K14/K13 tail-window concurrency gap → GP1+INV-28; MRP migration race → GP2 + INV-25 update (removed unsafe "exception"); A10 vs DERIVED-VIEW-INVALIDATE → GP4 reclassification, 2026-05-27).
- **v5.4** = deep mechanism-level read of 8 academic papers + 7 industry artifacts (NOT verification — actual mechanism analysis). **3 Category-A positioning fixes**: (1) §0 industry-category positioning corrected — Power Loom slots into Work-Bench's "Agent Runtime" Execute+Constrain pillars (alongside E2B/Modal/AuthZed), NOT Cleanlab's "Reliability Stack" (output-scoring vendors); also explicit "NOT durable execution" (Temporal/LangGraph is a different layer). (2) §0 honest value-claim per SWE-EVO arxiv 2512.18470 empirical finding — long-horizon coding gap is model-capability-bound (47.8pp gap, scaling curves clean, context ablations modest); substrate delivers containment/recovery/reproducibility, NOT better outcomes. Marketing "fixes long-horizon coding" overclaims. (3) §10a.1 NEW direct prior art on K9-style pattern: DeltaBox (arxiv 2605.22781, OS-overlayfs implementation, 14ms checkpoint strict perf superior to git-cherrypick) + Hermes Agent (NousResearch, shipping product implementing K1+K9 combo). Acknowledges K9-as-pattern is shared prior art; what remains genuinely novel: K1+K9+K14 triple, K2 envelope synthesis, E1 typed failure artifacts, A6 reputation snapshot, honest K12-advisory framing. **Category-B field-survey debt** (Σ session state vs Policies-on-Paths; K2 envelope signing vs SAGA C3; A6-as-observer-only ADR vs TVP arxiv 2510.18563; MI9 goal-conditioned drift detection; TRiSM multi-agent correlation accounting; AGENTS.md interop; K9 cherry-pick latency benchmarks vs DeltaBox baseline; Praetorian 5-role HETS template; LangGraph concurrency-strategy naming; policy-DSL pluggability vs AGT) captured in `swarm/thoughts/shared/backlog/v3.1-v3.2-field-survey-debt.md` with target releases and effort estimates. **BLUEPRINT LOCKED at v5.4. No further amendments before Phase 0.**
- v1/v2/v3 preserved at `v3.3-substrate-synthesis-v{1,2,3}.md` for diff

**Honest meta-pattern observed across versions**: each LLM-driven revision absorbs prior findings BUT can introduce new aspirational claims under cover of new structure. v3 added "delete before add" rhetoric (actually 1 real deletion vs +17 net primitives), buried v2→v3 time regression (+27-50h overhead admitted as "obsolete framing"), inflated GPT source-class. **v4 corrects these and admits the meta-pattern.** Further document iteration has diminishing returns; Wave -1 entry-probe = first real empirical validation.

---

## 0. Executive Summary

**v3.2-LOCKED RFC** established four-class state model + parent-records pivot. **Phase 1 spike** validated 7 of 8 load-bearing claims (Wave D pending).

**v4 substrate framing** (project identity):
> *"Deterministic state management for stochastic agents."*
> The substrate makes state transitions deterministic given non-deterministic LLM trajectories. Same category as database transaction managers, CI gates, BFT consensus wrappers, iOS sandboxes.

**Audience-specific framings of the identity above** (NEW v5.3 — onboarding aid; same identity, different reader):
- *Systems architect*: "CI/CD moved one level earlier — from validating final commits to governing the agent execution path that creates those commits."
- *Reliability lineage*: "Databases gave us transactions to make unreliable writes durable. CI/CD gave us gates to make unreliable releases verifiable. Power Loom gives us **both** — transaction boundaries AND verification gates — around unreliable AI execution." (The four pillars: Pillar 1 = transactional truth; Pillar 2 = verification.)
- *Honest value-claim* (NEW v5.4 — Category A honesty fix per SWE-EVO arxiv 2512.18470 empirical finding): "The substrate makes long-horizon agent failures **cheap, observable, and reversible**. It does NOT make the underlying LLM smarter on long-horizon tasks." SWE-EVO empirically shows the 47.8pp long-horizon-coding gap is model-capability-bound (scaling curves clean across gpt-5/mini/nano; context ablations modest). Power Loom delivers containment, recovery, reproducibility — not better outcomes. Marketing "fixes long-horizon coding" overclaims; marketing "makes long-horizon failures recoverable" is what we actually ship.
- *Production wager* (forward-looking thesis, NOT a fact): "We bet that as LLMs become more capable, the bottleneck shifts from generation to **governance and containment of failure**. The substrate's value-claim depends on this being true." (Marked as a wager per §0a pillar-grounding test — Round-7 honesty discipline.)
- *Human-org analogy*: "Apply the proven control model of software engineering orgs — scoped tasks, bounded ownership, artifact review, CI gates, merge discipline, post-failure learning — to LLM agents treated as independent execution nodes." (Full mapping in §0c.)

**Industry-category positioning** (NEW v5.4 — corrects the v5.3 "reliability lineage" framing that risked slotting Power Loom alongside output-scoring vendors): Power Loom lives in **Work-Bench's "Agent Runtime" four-pillar taxonomy** (per [work-bench.com/post/the-rise-of-the-agent-runtime](https://www.work-bench.com/post/the-rise-of-the-agent-runtime)): we slot into **Execute** (worktree isolation, K1/K9/K14) and **Constrain** (capability subset + injection, K6/K8/K13) — same engineering category as E2B, Modal, Daytona, Northflank, AuthZed, Cerbos, Permit.io. We are **NOT** in Cleanlab's "Reliability Stack" framing (post-hoc output scoring). We touch **Observe** (K2 envelope, K2.c per-tool-call observability) but are not primarily an observability product. We will touch **Improve** at v3.3+ (E1 negative attestations, A6 reputation, E4 evolution) but not as our v3.0-alpha identity. **Do not market Power Loom as durable execution** (that bucket is Temporal/LangGraph — different layer, workflow continuity through process death, not effect containment of nondeterministic edits).

**Three-layer architecture** (per GPT external analysis; sharpened in v4):
- **Loom Kernel** (microkernel): minimal, deterministic, **enforced-isolated from Runtime/Lab** (NEW: enforcement mechanism is mandatory in v3.0-alpha)
- **Loom Runtime**: HETS + personas + decomposition disciplines
- **Loom Evolution Lab**: experimental adaptive cognition (Phase 3+ deliverables)

**MVP-staged release plan**:
- Wave -1 entry probe (expanded scope per Round-3 planner)
- v3.0-alpha — **PURE KERNEL TRANSACTION LOOP** (cut per user concern #2: capability injection/check moved to v3.1)
- v3.1 — RUNTIME FOUNDATION (persona migration + capabilities)
- v3.2 — RUNTIME DECOMPOSITION
- v3.3 — EVOLUTION LAB FOUNDATION
- v3.4 — EVOLUTION LAB FULL
- v3.5+/Phase 4 deferrals

**Honest effort target (Round-3 planner-calibrated)**: **~141-209h + ~100-160h human-authored seed content** across the 5 micro-releases.

v3's optimistic "~85-129h" estimate was 65-95% low per Round-3 planner calibration anchored to shipped Phase 1 code (`spawn-record.js` 388 LoC, `validate-no-bare-secrets.js` 375 LoC, persona contracts 138 LoC avg). v4 adopts the honest number.

**Trade-off honest framing (replacing v3's "obsolete comparison" rhetoric)**:
- v2: ~58-79h, single monster release, all-or-nothing blast radius
- v4: ~141-209h, 5 micro-releases, per-release rollback discipline
- **The trade is +63-130h total time for vastly smaller per-release blast radius + per-release rollback** — that's a real trade with real costs and real benefits, not a "regression hidden by reframing."

**Key empirical anchors** (Phase 1 spike):
- P1: re-spawn semantic equivalence at default temperature (NOT temp=0; inferred a fortiori)
- P2: plugin sub-agents cannot ship hooks/mcpServers/permissionMode
- P4: delta budget p50 ~7 KB / p99 ~660 KB
- P5: Agent spawns produce ZERO new claude/node PIDs
- P-Proto: spawn-record.js HETS-reviewed; 3 HIGH security findings absorbed
- P-Persona: state_interface field schema-additive
- P-Recall: tri-signal ranker returns real paths on 10/10 queries

---

## 0.v6 — v6 Motivation & Changelog (NEW v6, supersedes nothing in v5.4 § ordering)

v5.4 was BLUEPRINT-LOCKED with the explicit gate "no further amendments before Phase 0." Phase 0 has now landed (PR #158 merged 2026-05-27); v6 is the first post-Phase-0 amendment. Four load-bearing drivers warrant the MAJOR version bump, not a PATCH.

### Driver 1 — File-based memory as DB requires a consistency model

v5.4 specifies the four-class state model (Axioms/Theorems/Samples/Attestations) and the parent-records pivot, but treats persona memory as **schema-shaped files** without specifying the underlying consistency model. Working through the v3.0-alpha implementation surfaced that the kernel transaction loop (Spawn → worktree → delta → verify → promote/reject → spawn-record) is itself a **database transaction**, and the substrate has been silently relying on `git stash` + atomic file ops without making the consistency story explicit. v6 makes the model load-bearing:

- **A8 Memory-as-Content-Addressed-State-Machine** — replay of the transaction chain IS the canonical state; in-place mutation of canonical state is forbidden.
- **A9 Memory-Transaction-Atomicity** — two-phase commit at spawn boundaries with explicit `intent_recorded_at` / `committed_at` + WAL recovery sweep for crash-mid-spawn.
- **A10 Evidence-Linked Admission** — every transaction carries `evidence_refs` to kernel-emitted records that exist in the chain; K9 pre-commit rejects forged refs (syntactic-layer false-memory defense).

These three axioms compose with v5.4's A1 + A7 (transactional determinism + write-scope detection) to form a coherent transactional substrate. Without them, the v3.0-alpha kernel would ship with implicit consistency assumptions that block clean v3.1+ extension.

### Driver 2 — Endorsements decision (C0)

The v5.4 → v3.3 plan had `E14 Endorsement primitive` on the roadmap with 4-5 invariants and 5 security launch-blockers. C0 architect decision (HETS-routed spawn 2026-05-27; full text in `/tmp/c0-decision-summary.md`) concluded that endorsements are a **derived view**, NOT a first-class primitive. Six load-bearing reasons:

1. §0a pillar-grounding test fails for the primitive option (principle-tier, not pillar-tier; K12 v5.1 precedent applies).
2. v5.4 K2 envelope + R13 advisory-findings + A6 reputation already contain every field needed; a primitive duplicates data.
3. SRP violation in the primitive option (two writers for the same evidence class).
4. DIP cleaner in the derived-view (E4 → kernel records, not E4 → endorsement-records → kernel records).
5. **Security cost asymmetry — load-bearing**: the 5 launch-blockers exist BECAUSE the primitive creates the attack surface; removing the primitive removes the surface.
6. The only unique enabler the primitive offers (endorser-side reputation) IS the Trust-Vulnerability Paradox amplifier B3 forbids.

v6 ships `E14: Endorsement-as-derived-view` (Lab layer, `packages/lab/_lib/endorsement-view.js`) with 3 invariants (INV-16/17/18) replacing the 4-5 the primitive would have needed. Endorser-side reputation is out of scope indefinitely.

### Driver 3 — Pillar 3 anti-amplifier clarification (refined post-3-FAIL)

Three property tests against the draft Pillar 3 clause FAIL'd (counterfactual-brittle test, trust-by-tenure recency-smuggling gap, "authorize promotion" underspecification). The refined clause (§0a.3.1) is pillar-tier normative text that:

- Defines derived views as pure projections over kernel-emitted records.
- Permits reorder / surface / recommend / monotonic-narrow.
- Forbids capability-widen / state-transition-input / instruction-text propagation / non-evidence-linked trust.
- Composes with A10 (syntactic-layer) as a two-layer false-memory defense. Transitive amplification is closed by the clause's own "MUST NOT widen K6/K8 capability scope" prohibition (no separate invariant required).

The clause is not itself a derived view — it is normative text WITHIN Pillar 3, governing what derived views may and may not do.

### Driver 4 — Memory Root Pointer Convention (operational discovery primitive)

v5.4 hard-codes discovery paths across hooks, validators, and recall-CLI. v6 introduces `memory-root.json` as the single discovery artifact, with explicit per-user vs per-project scope precedence, atomic-write discipline (INV-26), canonical-only indexing (INV-27 — prevents derived views from being selected as `evidence_refs`), and explicit non-scope (no custom binary format, no mmap, no free-block tracking). The pointer is **discovery-only** — the `active_state_hash` field was dropped per user-lock (Patch 1) so A8's single-source-of-truth property is preserved (state is always computed by walking the WAL tail).

### Honest scope of the v5.4 → v6 jump

- **Three new axioms** (A1-A7 → A1-A10).
- **Zero new K-primitives**. Kernel total UNCHANGED at 14 (K1-K14). v6's load-bearing additions are implemented as **disciplines + invariants + schema additions to existing primitives**: K2 envelope gets the §4.2 transaction-record-shape extension; K9 gains §6.5.1 pre-commit evidence-link gating (A10) and §5.2 two-phase commit responsibility; K14 gains §5.2 phase-2 validation responsibility; `_lib/atomic-write.js` is reused for `memory-root.json` writes (§5a.2). **Honest disclosure (LOCK-review HD-1 fix)**: an earlier draft of this §0.v6 list named "K15 DeltaRef" and "K16 Memory-Read-Audit" as new kernel primitives. Those names were aspirational placeholders that never received body-level specifications — no table entry, no LoC budget, no schedule. Per Round-3 LOCK review (architect `a0bf0cd9` + honesty-auditor `abf4a296`), both removed. v6 ships ZERO new K-primitives; all consistency-model additions are inside existing K1-K14 surfaces.
- **One new Lab-layer spec** (E14 endorsement-view; Lab not Kernel).
- **Fourteen new invariants** (15 → 29). Numbered INV-16..INV-28 plus INV-A9-RecoverySweepIdempotent. Spanning C0 (3: INV-16/17/18), consistency model (8: INV-19/20/21/22/23/24/25 + INV-A9), Memory Root Pointer (2: INV-26/27), K13×K14 interlock (1: INV-28-K13K14SerialClosure added per Gemini 3.1 Pro v6 LOCK Patch GP1). Honest disclosure trail: the locked drafting bundle counted 27; Round 2 surfaced INV-A9 (→28); Gemini 3.1 Pro external review surfaced INV-28-K13K14SerialClosure (→29).
- **One new §5a section** (Memory Consistency Discipline; 9 subsections).
- **Two new ADRs** (ADR-0013 endorsement-derived-view; ADR-0014 memory-root-pointer).
- **One new §10b entry** (endorsement-records-as-primitive rejected, with reasoning).

This is honestly a MAJOR-tier change. v6 is not a PATCH amendment to v5.4; it is the substrate's first integrated transactional-memory specification. **v3.0-alpha K2 reservation PR honest scope (Round-3d update per 5-persona pair-review C1)**: ~260-405 LoC / ~8-12h — includes memory-root.js reader (130-205) + transaction-record envelope schema-additive fields (~50-80) + K2.b settings.json resolution (~80-120). The prior "~180-285 LoC / ~6-9h" figure omitted K2.b. Either ship K2.b as a sibling PR (lower bound stays at ~180 for the pointer-only PR) OR bundle K2.b into the K2 reservation PR (260-405 honest). Full v3.0-alpha through v3.4 hour ranges intended unchanged from v5.4 BLUEPRINT-LOCKED, but HD-3 disclosure (§6.11) acknowledges v3.0-alpha row may need expansion at v3.0-alpha LOCK.

### v6 IS / v6 is NOT

**v6 IS**:
- Implementation-grade blueprint for v3.0-alpha through v3.4 with consistency model explicit.
- Source for RFC v3.3 amendment (drafted after v6 acceptance).
- Supersedes v5.x synthesis lineage upon Round-3 LOCK.

**v6 is NOT**:
- Final Phase-1-alpha implementation specification (algorithm signatures + contract schemas are v3.0-alpha through v3.4 deliverables).
- A primitive-implementation document (e.g., reverse-cherrypick journal format is still a v3.0-alpha deliverable, not specified at blueprint level).
- Free of open questions (~17-19 OQs after v6 absorptions; see §11).
- **A defense against local filesystem tampering** (Round-3d explicit declaration per 5-persona pair-review C5): v3.0-alpha assumes a trusted local filesystem. An attacker with local filesystem write access CAN rewrite WAL records, replace `memory-root.json`, or insert forged COMMITTED records — and v3.0-alpha will NOT detect this. Tamper-evidence (cryptographic chain anchoring, signed WAL records, or external-anchor hash log) is OQ-20, deferred to v3.1 threat-model ADR. The honest threat model for v3.0-alpha is: local-trust-anchored; defends against agent-level out-of-scope writes and partial-failure recovery, NOT against host-level filesystem tampering.

---

## 0a. The Four Vision Pillars (NEW v5.1 — load-bearing alignment test for all future amendments)

The substrate's vision is "deterministic state management for stochastic agents." Operationally, this decomposes into **four pillars** — load-bearing properties the substrate exists to deliver. Every axiom, primitive, and amendment in this document MUST map to at least one pillar. The check "does this serve a pillar concretely?" is now an explicit gate for adding new mechanisms.

### Pillar 1 — Filesystem-Delta-as-Truth / State Determinism

> The substrate's unit of truth is the in-scope filesystem delta. Out-of-scope writes are policy violations. Transactions are verifiable by replaying their inputs.

**Served by**: A1 (Transactional Determinism), A7 (Write-Scope Detection), K1 (Worktree), K9 (Promote-deltas), K14 (Write-Scope Enforcer), K7 (Path canonicalize), §6.5.1 (K9↔K14 sequencing contract), §6.5.2 (K9 rollback scope clarification).

### Pillar 2 — Byzantine Treatment of LLM (Outputs AND Inputs)

> LLM outputs are untrustworthy by construction; verified against external ground truth. LLM-mediated inputs to the orchestrator (web content, retrieved docs, tool results) are equally untrustworthy and require boundary defense.

**Served by**: A3a (Gating verification pure), A3b (Advisory LLM-mediated), K6 (Capability subset check), K8 (Capability injection + read-only path mask), R-primitives that handle untrusted content. **v3.5+ extension**: blocking-grade prompt-injection defense + content-source tagging.

### Pillar 3 — Deterministic / Auditable Execution

> Spawns are replayable from their recorded envelope. Reputation snapshots make Lab→Kernel data flow deterministic. Per-tool-call traces make replay verifiable. Cross-spawn determinism requires explicit context propagation.

**Served by**: A6 (Reputation snapshot), K2 (spawn-record envelope), K2.b (settings.json resolution), K2.c (per-tool-call observability), K3 (lineage), K3.b (context envelope), K13 (serial-only spawn — defends against TOCTOU on shared state), R13 (idempotency-key for external side effects), advisory CI lint (K12 v5.1).

#### §0a.3.1 — Derived-View No-Amplification Clause (v6, NEW; pillar-tier normative)

> A **derived view** is a pure projection over kernel-emitted records (K2 spawn-records, R13 advisory-findings, A6 reputation snapshots, K3 lineage; see §6.4 endorsement-view spec for the canonical shape). Derived views include — but are not limited to — reputation aggregates, endorsement views, persona-memory *summary/dashboard* projections, archetype-grouping summaries, tier-progression histories, and skill-vector morph aggregates. Chain-replay producing the canonical kernel-state itself is NOT a derived view in the sense of this clause; it is the realization of A8. Derived views are projections layered ON TOP of the canonical state for informational use (reordering, surfacing, ranking, recommending), distinct from the state itself.
>
> Derived views MAY reorder candidate sets, MAY surface evidence to the orchestrator or to a human reviewer, and MAY recommend actions to the orchestrator. They MAY narrow K6/K8 capability scope (narrowing composes with INV-K6-CapabilityMonotonic and is monotonically safe).
>
> Derived views MUST NOT widen K6/K8 capability scope; MUST NOT enter as input to any state transition that writes a kernel-canonical record (K9 promote-deltas, memory promotion L_spawn→L_persona, persona-contract update, capability assignment); MUST NOT be propagated as instruction-text into peer LLM contexts; and MUST NOT grant trust that is not evidence-linked to a kernel-emitted record of verified outcome (i.e., no trust-by-tenure, no trust-by-recency-alone, no trust-by-frequency-alone).
>
> This clause is normative text within Pillar 3; it is not itself a derived view. Transitive amplification — a derived view recommending a spawn whose K8 grant then widens capability — is forbidden by this clause directly: the "MUST NOT widen K6/K8 capability scope" prohibition closes the chain at the K8 widen point regardless of whether the upstream input was a derived view's recommendation. No separate invariant is required.
>
> **A6-snapshot mediation carve-out (v6 LOCK Patch G1)**: The "MUST NOT enter as input to any state transition that writes a kernel-canonical record" prohibition has ONE canonical exception: the A6 snapshot mechanism. A6 promotes a live derived view (e.g., E4 reputation) to **axiom-class** by capturing it into the spawn's `axioms.evolution_snapshot` block at spawn-init (per §3 A6). Once snapshotted, the value is no longer a "live derived view" — it is an axiom-class input frozen at spawn-init, immutable for the spawn's lifetime per A1+A8. The snapshot mediation IS the boundary that makes derived-view → spawn-input deterministic: the spawn reads the snapshotted axiom, not the live view. Live derived views still MUST NOT be read mid-state-transition; only snapshotted forms may enter. This carve-out is structural (A6 is the unique snapshot mediator) and does NOT generalize — derived views that are NOT snapshotted via A6 remain bound by the prohibition.

**Composes with**:
- A10 Evidence-Linked Admission (§3) — A10 is the syntactic-layer false-memory defense (K9 pre-commit rejects forged `evidence_refs`); §0a.3.1 is the semantic-layer defense (read-time rules on how views may be used). Two-layer defense.
- INV-A6-NonAuthorizing (per `packages/specs/research/v3.1-v3.2-field-survey-debt.md` §B3) — reputation cannot widen capability; this clause generalizes that constraint to all derived views.
- INV-27-PersonaIndexCanonicalOnly — `persona_memory_index` indexes ONLY kernel-canonical records; derived views cannot backdoor into evidence-link via the index.
- §6.4 E14 Endorsement-as-Derived-View spec — first concrete derived view; reads as kernel-record projection; cannot re-enter K9 as canonical-record input.

**Test (refined post-3-FAIL)**: a derived view is anti-amplification-compliant iff every action it enables can be traced to a kernel-emitted record of verified outcome that is structurally accessible via `evidence_refs` at admission time. "Trust by tenure" (long-lived persona implicit-trust), "trust by recency" (recent endorsement weighted higher), and "trust by frequency" (often-recommended persona promoted) ALL fail the trace test and are explicitly forbidden.

### Pillar 4 — TDD / Role-Separation Contracts

> Persona contracts define preconditions / path-constraints / postconditions. Planner generates failing tests (contract); Builder makes them pass (with read-only access to tests). Role separation enforced via capability injection, not persona discipline.

**Served by**: R1 (two-tier persona contracts), R2 (16-persona migration), R3 (capability traits), R4 (trait composition), K8 read-only path mask (v4.3 acceptance criterion), HETS pair-review (architect + code-reviewer convergence framing), R12 (test-runner adapter; v3.2).

### Pillar Coverage Table — Quick Reference

| Primitive | Pillar 1 | Pillar 2 | Pillar 3 | Pillar 4 |
|---|---|---|---|---|
| A1, A7 | ✅ | | | |
| A2, A3a, A3b | | ✅ | | |
| A4 | ✅ | | ✅ | |
| A5 | | | | ✅ |
| A6 | | | ✅ | |
| K1, K7, K9, K10, K14 | ✅ | | | |
| K2, K2.b, K2.c | | | ✅ | |
| K3, K3.b | | | ✅ | |
| K4 (recall) | | | ✅ | ✅ |
| K6, K8 | | ✅ | | ✅ |
| K12 (v5.1 convention) | | | (advisory only) | |
| K13 | ✅ | | ✅ | |
| R1-R4 | | | | ✅ |
| R11 (HETS) | | | | ✅ |
| R12 (test-runner) | | | | ✅ |
| R13 (idempotency) | | | ✅ | |
| E-primitives (v3.3+) | | | ✅ (snapshotted) | ✅ (Lab learns contracts) |

### Pillar-grounding test for future amendments

When proposing any new primitive, axiom, or mechanism, the proposal MUST answer: "Which pillar does this serve concretely?" If the answer is "none directly, but it serves an architectural principle (e.g., dependency-rule, KISS, single-responsibility)," then the proposal is **principle-tier**, not **pillar-tier**, and SHOULD ship as convention + advisory (the K12 v5.1 pattern), NOT as mandatory enforcement. Mandatory enforcement is reserved for pillar-serving mechanisms.

This test would have surfaced the K12 over-engineering in v4 (which Round-7 architect caught only in v5.1). It is now the load-bearing structural test for v5.2+ amendments.

### Things this section does NOT do

- Does NOT validate that the substrate IS deterministic — that's empirical (Wave -1 probes + future test fixtures).
- Does NOT replace `kb:` references — principle-tier `kb:` citations remain valid for design discussions.
- Does NOT preclude novel primitives — it just demands honest framing about WHY they ship.

---

## 0c. Organizational Engineering Analogy (NEW v5.3 — onboarding aid; binds no new mechanism)

The substrate applies a proven control model — software engineering organizations — to LLM agents treated as independent execution nodes. The mapping is direct enough to be load-bearing onboarding documentation. Each row includes release-availability so the analogy is not misread as describing capability we don't have yet.

| Human engineering org | Power Loom substrate | First available |
|---|---|---|
| Product requirement | User task / root prompt | v3.0-alpha |
| Jira epic/story | Spawn plan / decomposed task | **R8/R9/R10 — v3.2+** (v3.0-alpha has NO decomposition; root spawn only) |
| Junior engineer | Agent/persona/node | v3.0-alpha |
| Senior engineer review | Deterministic (A3a / K5+K7+K9-pre-cherrypick gates) + advisory (A3b / R-primitives) verification | v3.0-alpha |
| Pull request | Filesystem delta (K9 input) | v3.0-alpha |
| CI checks | Pure-function gates (K5/K7/K9-pre-cherrypick) + advisory CI lint (K12 v5.1 convention) | v3.0-alpha |
| Code review comments | Advisory findings (R-primitives — A3b output) | v3.0-alpha |
| Merge approval | Promote-deltas (K9) | v3.0-alpha |
| Incident/postmortem | Negative attestation (E1) | **v3.3+** (until then, incidents surface only as honesty-auditor advisory findings) |
| Team reputation | Reputation store (E4) + snapshot mechanism (A6) | **v3.3+** (A6 is the snapshot mechanism, NOT the store) |
| Engineering process improvement | Evolution Lab (E2/E3/E4) | v3.3+ |

### Subtle differences that justify substrate machinery

Humans bring implicit accountability that LLM agents lack. The substrate must supply each missing structure explicitly:

| Missing in LLM agents | Substrate replacement | First available |
|---|---|---|
| Stable professional identity | Persona identity + reputation | E4 — v3.3+ |
| Accountability trail | Spawn records + lineage | K2 + K3 — v3.0-alpha |
| Judgment review | Verification gates + pair review | K9 + HETS — v3.0-alpha (HETS at v3.1+) |
| Work boundaries | Capability scope + write-scope detection | K6/K8 v3.1; K14 v3.0-alpha |
| Memory of mistakes | Negative attestations | E1 — v3.3+ |
| Promotion authority | Deterministic promote/reject | K9 — v3.0-alpha |
| Organizational learning | Evolution metrics | E2/E3 — v3.3+ |
| **Physical embodiment (one person, one place, one task)** | **Bounded-concurrency via serial-only enforcement** | K13 — v3.0-alpha |

The last row is load-bearing. A human can only be in one meeting at a time; this constraint is "free" — orgs don't need extra machinery to enforce it. LLM agents have no such natural constraint — Anthropic can spawn them arbitrarily. **K13 serial-only is the substrate-supplied equivalent of physical embodiment**, and that framing justifies why K13 ships in v3.0-alpha despite looking like a "discipline" rather than a hard primitive.

### Honest gap: no org-structure modeling

Human orgs treat **team structure** as a first-class concept — team ownership, on-call rotations, escalation paths, manager-of-manager chains. **Loom has personas but does not model persona-team grouping or ownership scope at the kernel layer.** This is deliberate (YAGNI argues against premature org-modeling at the current substrate scale; persona-level granularity is sufficient), but it is a real gap. Future hosted-multi-tenant deployments (v3.5+) may need org-mapping primitives; until then, the gap is intentional and called out honestly here so readers don't infer 1:1 coverage.

### Why this analogy is load-bearing (not decorative)

The substrate is not novel because it has multi-agent systems. It is novel because it applies the proven engineering-organization control model — scoped work, bounded ownership, artifact review, CI gates, merge discipline, post-failure learning — to non-deterministic LLM agents. **The architecture's claims to trustworthiness flow from this analogy holding under stress.** If a critique can produce an org-engineering scenario where the substrate's equivalent mechanism gives a worse answer than the human practice, that critique surfaces a real substrate gap.

---

## 1. Architecture Overview — Transactional Agent Runtime

```
                    ORCHESTRATOR (deterministic kernel)
                              │
              ┌───────────────┴───────────────┐
              │                               │
       agent spawn (non-det)            agent spawn (non-det)
              │                               │
              │ writes deltas to              │ writes deltas to
              │ isolated worktree             │ isolated worktree
              ▼                               ▼
       ┌─────────────────────────────────────────┐
       │       INTERFACE BOUNDARY (kernel)         │
       │  Pure-function gates only:                │
       │  - Schema / path / test-suite / lint /    │
       │    contract-verifier (functional keys)    │
       │  - Spawn-record envelope capture          │
       │  - Layer-boundary enforcer (NEW v4)       │
       │  - Serial-only spawn enforcer (NEW v4)    │
       └─────────────────────────────────────────┘
                              │
                              ▼
                  HOST CODEBASE (validated state)
```

---

## 2. Three-Layer Architecture (CONVENTION + ADVISORY in v3.0-alpha; v5.1 DOWNGRADE from mandatory)

Per GPT recommendation + user concern #1: layer separation must be **enforced**, not documented. Round-3 architect HIGH explicitly flagged that an unenforced layer separation is cosmetic labeling.

### Layer 1 — Loom Kernel (microkernel)

**Property**: minimal, deterministic, portable-by-design (adapter layer TBD). MAJOR-bump-protected.
**Verification surface**: pure-function gates only. No LLM in trust path.
**Boundary enforcement (NEW v4)**: see §2.4 below.

### Layer 2 — Loom Runtime (operational)

**Property**: HETS + decomposition + personas. MAJOR-bump-protected APIs; persona contracts MINOR-additive.
**Verification surface**: kernel gates (blocking) + advisory (non-blocking, audit-logged).

### Layer 3 — Loom Evolution Lab (experimental)

**Property**: adaptive cognition; explicitly isolated from kernel. Iterates within PATCH versions.
**Verification surface**: advisory only. Outputs feed reputation asynchronously.
**Critical constraint (NEW v4 per Round-3 architect CRITICAL-1)**: Lab writes that flow into Kernel-read corpora (e.g., E3 policy-axiom store → K4 recall-CLI) MUST go through the A6 snapshot mechanism. See §3.6.

### 2.4 Layer-Boundary Convention (v5.1 — DOWNGRADED from mandatory enforcement)

**Round-7 architect findings absorbed (verdict B; agent `a6def7d4996a71b24`)**: 6 months on `feat/v3.0-phase-1-verification-spike` produced **zero observed cross-layer drift**. Existing cross-directory imports cluster around the `_lib/` substrate-extraction pattern (H.7.14, per `kb:architecture/crosscut/acyclic-dependencies`) — i.e., the codebase is acyclic-by-construction without enforcement. K12 mandatory CI gate was preemptive over-engineering against a problem that hasn't occurred. v5.1 downgrades to convention + advisory; upgrade trigger captured in OQ-19.

**v3.0-alpha mechanism (convention + advisory; ~50-80 LoC)**:

1. **Filesystem convention** (unchanged):
   - Kernel: `packages/kernel/**` (post-Phase-0)
   - Runtime: `packages/runtime/**` (post-Phase-0; includes 16 persona contracts)
   - Lab: `packages/lab/**` (post-Phase-0)
   - Adapter: `packages/adapters/**` (v3.5+)

2. **Per-file frontmatter marker** (unchanged):
   - Every source file declares `// @loom-layer: kernel|runtime|lab|adapter` at top
   - Files without marker emit ADVISORY warning at CI time (not blocking)

3. **Advisory CI lint** (~50-80 LoC; ships in v3.0-alpha as K12):
   - Parses imports across the workspace
   - Warns on cross-layer violations as PR comments (does NOT block merge)
   - Emits structured violation record to `spawn-state.advisory_findings[]` per A3b
   - Pre-commit hook prints warning to stderr (does NOT block commit)

**Why advisory not blocking (v5.1 rationale)**:
- **Empirical**: 6 months, zero observed drift. The codebase's existing `_lib/` extraction pattern already enforces acyclic-by-construction without K12.
- **Pillar grounding**: K12 enforces a STRUCTURAL property (no cross-layer imports), not a determinism / Byzantine / audit / contract property. None of the four vision pillars depend on it. It serves `kb:architecture/crosscut/dependency-rule` — a foundational principle (real value) but principle-tier, not pillar-tier.
- **Cost asymmetry**: 150-200 LoC mandatory enforcement + per-commit friction + `.loom/override-budget` bureaucracy for a problem that hasn't occurred is the wrong shape. Convention + advisory (~50-80 LoC) preserves 80% of the value (visible labels + visible warnings on drift) at ~30% of the cost.
- **Reversibility**: convention + advisory is upgradable to mandatory. Going mandatory now is the irreversible direction (KISS/YAGNI apply per `kb:architecture/crosscut/single-responsibility`).

**Upgrade trigger** (OQ-19): when ≥3 distinct cross-layer drift events are observed across v3.1-v3.3 (each requiring post-hoc cleanup commits), upgrade to mandatory CI blocking + add `.loom/override-budget`. Until then, convention + advisory is the v3.x default.

**Without this**, every subsequent release accumulates layer-violation drift debt. v3.0-alpha is the only time this is cheap to enforce — later, refactoring violations across 16 personas + Lab code is expensive.

OQ-14 is **deleted** from open-question list; it's now mandatory work in v3.0-alpha.

---

## 3. The Ten Axioms (v6 expansion: A8/A9/A10 added per Memory Consistency Discipline)

**v4.2 architectural note (2026-05-26, per Round-5 architect CRITICAL-1)**: in v4.1 we restated A1 with a footnote saying "the kernel MUST detect out-of-scope writes." That made A1 contingent on K14 — i.e., a theorem dependent on a primitive, not a true axiom. v4.2 fixes this by introducing **A7 (Write-Scope Detection)** as a co-equal kernel invariant. A1 remains pure ("validated in-scope filesystem deltas are the substrate's unit of truth"); A7 carries the load that out-of-scope writes are detected post-hoc and treated as policy violations. Together, A1 + A7 form the transactional-determinism story; neither depends on the other's implementation.

**v6 architectural note (2026-05-27, NEW)**: v5.4's seven axioms specified the kernel transaction loop but did not specify the consistency model under which persona memory writes commit. A8/A9/A10 close this gap. A8 makes the transaction chain (not in-place file contents) the source of truth; A9 specifies two-phase commit with explicit intent/commit timestamps and a recovery sweep for crash-mid-spawn; A10 makes evidence-link admission a kernel pre-commit gate, composing with the §0a.3.1 Derived-View No-Amplification Clause to form a two-layer false-memory defense. These three axioms are NOT contingent on A1-A7 and vice versa — they are co-equal kernel invariants for transactional memory consistency. The Memory Root Pointer Convention (§5a.9) is the operational discovery artifact that makes A8 implementable without hard-coded paths.

### Axiom 1 — Transactional Determinism (Kernel)

> Validated **in-scope** filesystem deltas (or contract-conformant text outputs) are the substrate's unit of truth. LLM trajectories are non-deterministic by construction and recoverable-by-resampling. **In-scope** = writes inside the spawn's allocated worktree, captured deterministically via `git stash create`. Out-of-scope writes are governed by A7.

### Axiom 2 — Kernel / User-Space / Interface Boundary (Kernel)

> Kernel = hooks + validators + recall-CLI + contract-verifier (pure functions, deterministic). User-space = agent spawns. Interface = filesystem deltas + contract-conformant text outputs.

**Forbids**: LLMs writing to kernel paths; kernel code calling LLMs in verification; agents bypassing interface.

### Axiom 3a — Gating Verification Must Be Pure AND Semantically Adequate (Kernel)

> Verification gates that BLOCK promotion/merge/cherrypick are pure functions whose semantics are *adequate* for the property being verified. Surface-keyword checks are FORBIDDEN in the blocking path.

### Axiom 3b — Advisory Verification May Be LLM-Mediated (Runtime)

> Advisory verification IS permitted as LLM-judgment, provided it cannot block, emits audit records, and optionally informs reputation per Axiom 6.

### Axiom 4 — Algorithmic Discipline is Kernel Responsibility (Kernel; **v4 fix: scope to v3.2+**)

> Where A2 says "LLMs SHALL NOT write to kernel paths," A4 says "kernel scope SHALL include algorithmic logic." Deterministic operations live in kernel code with unit tests — not as prose discipline or embedded pseudocode for LLM execution.

**Round-3 architect CRITICAL-2 fix**: A4 is in force from **v3.2** (when K11 kernel algorithm library ships). v3.0-alpha and v3.1 do NOT yet need the full algorithm library — they need only `subset_check.js` (K6 in v3.1) and `path_canonicalize.js` (K7 in v3.0-alpha). A4 is **scoped to v3.2+** to avoid silently violating it in v3.0-alpha. This is honest scoping, not weakening the axiom.

### Axiom 5 — Substrate Evolution is Designed-First-Class (Evolution Lab; v3.3+)

> The substrate IS DESIGNED TO measure its own components' quality and IS DESIGNED TO use those measurements to evolve. **All evolution infrastructure is v3.3 and v3.4 work; this axiom describes design intent, not current capability.**

**Round-2 caveat preserved**: cross-persona test review is itself LLM-judged signal subject to recursive Goodhart drift. Phase 3 must include out-of-band ground-truth signal OR honest framing that ConvergenceRate is a proxy.

### Axiom 6 — Reputation as Snapshotted Axiom (cross-cutting; bridges Lab → Kernel)

> When Lab signals (reputation, policy-axioms, KB freshness) influence spawn-routing or kernel decisions, they are captured into the spawn's `axioms` block at spawn-init as `axioms.evolution_snapshot`. Re-spawn-from-axioms produces deterministic routing.

**v4 EXTENSION (per Round-3 architect CRITICAL-1)**: A6 explicitly covers Lab-written corpora that Kernel reads, including:
- E4 reputation (Lab) feeding kernel routing
- **E3 policy-axiom store (Lab) being read by K4 recall-CLI (Kernel)** — `policy_axioms_snapshot` field captures the policy-axiom state at spawn-init; K4 reads from snapshot, not live store
- E9 TDD-craft KB (Lab) being read by K4 recall-CLI — same snapshot pattern

Without this extension, the E3 → K4 closed loop violates kernel determinism. v4 makes the snapshot mechanism universal across Lab→Kernel data flows.

**Sibling-wave semantics**: within a single orchestrator dispatch wave, all sibling spawns share the same `evolution_snapshot`. Updates apply to spawns initiated *after* the wave closes.

**Transitive-path explicit**: advisory_findings (from A3b) feed reputation asynchronously. Reputation is snapshotted at spawn-init per A6. **Kernel never reads live advisory_findings in a gating decision.**

**Pattern B (v3.5+) caveat**: orchestrator carries snapshot envelope to each Task tool call within a wave. Implementation detail (OQ-15 added to §11).

### Axiom 7 — Write-Scope Detection (Kernel; NEW v4.2 per Wave -1 P-WriteScope FAIL)

> Anthropic-native worktree isolation (`isolation: "worktree"`) is a git-mechanism boundary, **not** a filesystem sandbox. Sub-agents can write anywhere the user account can reach (parent project, sibling repos, /tmp, etc.). Therefore: the kernel SHALL detect out-of-scope writes via filesystem-layer instrumentation (K14) and treat any detected violation as a policy failure — spawn-state = REJECTED (pre-promote) or REJECTED-POST-PROMOTE (with K9 rollback). Out-of-scope writes are NEVER silently incorporated into the transaction.

**Empirical basis**: Wave -1 P-WriteScope (`swarm/thoughts/shared/spikes/p-writescope-findings.md`) — 8 tests, all 8 SUCCESS for cross-scope writes via Write tool + Bash. Worktree was NOT a sandbox.

**Forbids**: silently accepting out-of-scope writes; relying on tool-layer hooks alone (Bash bypasses them); inferring scope from `pwd` alone (symlinks + absolute paths defeat this).

**Override**: `LOOM_ALLOW_OUT_OF_SCOPE_WRITES=1` audit-logged escape hatch, per K10's pattern.

### Axiom 8 — Memory-as-Content-Addressed-State-Machine (Kernel; v6, NEW)

> The authoritative memory of a persona at time T is defined as the deterministic replay of the chain of transactions terminating at T. The chain — not any in-place file contents — is the source of truth. In-place mutation of canonical state is forbidden. Every transition produces a sibling record in the chain referencing its predecessor by content-hash.

**Forbids**: in-place edits to canonical persona-memory records; treating any single file's current bytes as authoritative; bootstrap procedures that infer state from filesystem scan when the WAL is present.

**Enables**: deterministic replay-from-record (Pillar 3); bisect-style debugging of memory-state transitions; principled migration via SUPERSEDE-as-transaction (§5a.8).

**Implementation contract**: the `prev_state_hash` field on every transaction record (§4.2 transaction-record shape) is what binds the chain. The genesis sentinel (§4.3) defines the well-defined empty-chain state. The Memory Root Pointer (§5a.9) is discovery-only — it does NOT cache the active state hash (per Patch 1 user-lock; eliminates dual-write inconsistency surface).

**Served by**: Pillar 1 (chain replay produces canonical state) + Pillar 3 (replay determinism).

### Axiom 9 — Memory-Transaction-Atomicity (Kernel; v6, NEW)

> State transitions commit at spawn boundaries via two-phase commit: (phase 1) intent recorded in WAL with `intent_recorded_at` and `commit_outcome: PENDING`; (phase 2) commit consummated with `committed_at` and `commit_outcome: COMMITTED` after K14 write-scope validation, atomic file rename, and fsync(2). On recovery sweep, any record with `commit_outcome: PENDING` for which no subsequent state transition exists is reclassified `ABORTED` with `abort_reason: "recovery-sweep-orphan"`. K9 promote-deltas + K14 write-scope-enforcer compose to implement this two-phase commit.

**Forbids**: single-phase commits that conflate intent with completion (cannot distinguish "crashed-after-write" from "decided-not-to-write"); recovery procedures that replay COMMITTED records as if they were PENDING; silent acceptance of orphan-PENDING records.

**Enables**: principled crash recovery (per §5a.5 recovery sweep); idempotent replay (per §5a.6); bounded reasoning about partial-failure states.

**Composes with**:
- A1 + A7 — A9 specifies WHEN the in-scope delta becomes durable; A1 specifies that it IS the unit of truth; A7 specifies the out-of-scope detection that gates phase 2.
- R13 Idempotency-Key Enforcer — idempotency keys dedupe at the intent-record phase; two-phase commit handles partial-failure recovery. Orthogonal mechanisms; both required.
- §5a.9 Memory Root Pointer — recovery sweep presupposes pointer resolution (Patch 2); pointer must be resolved before sweep can locate the WAL.

**Implementation contract**: K9 owns the cherrypick + journal; K14 owns the write-scope validation; both compose at the K9↔K14 sequencing contract (§6.5.1) which is now load-bearing for A9. The WAL itself lives at `manifests.attestation_wal` per §5a.9 (default `~/.claude/checkpoints/attestation-log.jsonl`).

**Served by**: Pillar 1 + Pillar 3.

### Axiom 10 — Evidence-Linked Admission (Kernel; v6, NEW)

> Every memory transaction MUST carry non-empty `evidence_refs` to kernel-emitted records that exist in the chain at `prev_state_hash`. K9 pre-commit MUST reject any transaction whose `evidence_refs` point to records not present in the chain (forgery detection at syntactic layer). This composes with the §0a.3.1 Derived-View No-Amplification Clause (semantic layer at read-time) to form the two-layer false-memory defense.

**Forbids**: state-changing transactions with empty `evidence_refs` (EXCEPT bootstrap-exception below); transactions whose evidence-refs point to derived views (per INV-27 `persona_memory_index` indexes ONLY kernel-canonical records); transactions whose evidence-refs point to records outside the chain at `prev_state_hash` (forgery detection — even a record that exists in some other chain at some other time fails the in-chain check).

**Scope clarification (v6 LOCK Patch GP4, per Gemini 3.1 Pro external review)**: "state-changing" in A10's context means `operation_class ∈ {CREATE, APPEND, SUPERSEDE, TOMBSTONE}` — operations that advance `post_state_hash`. `DERIVED-VIEW-INVALIDATE` is **NOT state-changing** — it is a cache-management signal that does not advance the canonical state hash. DERIVED-VIEW-INVALIDATE records carry `commit_outcome: NOT_APPLICABLE` (per §4.2 sub-tension 1 resolution; same classification as spawn-init records and GC events), MAY carry empty `evidence_refs`, and are skipped by chain-replay's state computation. K9 pre-commit applies A10's empty-evidence-refs check ONLY to state-changing operation_classes, not to DERIVED-VIEW-INVALIDATE. This resolves the A10 vs §5a.1 apparent contradiction that Gemini 3.1 Pro flagged — DERIVED-VIEW-INVALIDATE is structurally informational, not transactional.

**Bootstrap exception (v6 LOCK Patch GPT-1.B)**: the first state-changing transaction in any chain (where `prev_state_hash == GENESIS_HASH` per §4.3) has no in-chain predecessors to reference. For this case, the transaction MAY carry one of three canonical bootstrap-evidence sentinels in `evidence_refs`:

- **`USER_INTENT_AXIOM:<sha256(canonical_json(user_request))>`** — for transactions derived from a user-initiated request; the SHA pins the request content as the axiomatic input.
- **`GENESIS_EVIDENCE:<schema_version>:<scope>`** — for substrate-bootstrap transactions (e.g., first persona-memory write on a fresh install); the value equals the GENESIS_HASH for that chain's `(schema_version, scope)` pair.
- **`ROOT_TASK_RECORD:<task_id>`** — for transactions derived from an orchestrator-initiated task that itself has no transaction predecessor (e.g., first task in a new project); the task_id pins the task spec as the axiomatic input.

These three sentinels are the ONLY admissible empty-chain bootstrap-evidence forms. K9 pre-commit accepts them at the first-transaction position only (when `prev_state_hash == GENESIS_HASH`); subsequent transactions MUST carry kernel-emitted-record `evidence_refs` per the standard rule. The bootstrap exception preserves A10's two-layer false-memory defense by binding the first transaction to a verifiable axiomatic input (the user request, the schema-version genesis, or the task spec) rather than allowing unevidenced first writes.

**Enables**: kernel-layer false-memory defense at WRITE time (syntactic); §0a.3.1's semantic defense at READ time becomes the second layer.

**Composes with**:
- §0a.3.1 Derived-View No-Amplification Clause — two-layer defense; A10 syntactic, §0a.3.1 semantic.
- INV-A6-NonAuthorizing — A6 reputation is consumable as an `evidence_ref` (it is a kernel-emitted record), but per INV-A6-NonAuthorizing it cannot widen capability — so even valid evidence-link cannot route around the capability discipline.
- INV-27-PersonaIndexCanonicalOnly — `persona_memory_index` indexes ONLY kernel-canonical records; derived views are never indexable and therefore never selectable as `evidence_refs`. INV-27 closes the path by which derived views could backdoor into evidence-link.

**Implementation contract**: K9 pre-commit gate runs after K5/K7 schema validation, before atomic rename. Algorithm: for each `evidence_ref` in the proposed transaction, walk the chain from `prev_state_hash` backward; reject if any ref is not found. Performance: O(|evidence_refs| × |chain-depth|); chain-depth is bounded by R10 budget envelope + serial-only K13.

**Debuggability — `abort_detail` field on K9-rejected records (Round-3d Patch per persona-Maya M3, ~10 LoC schema-additive)**: when K9 pre-commit rejects with `commit_outcome: ABORTED, abort_reason: "k9-pre-commit-rejected"`, the substrate MUST also populate an `abort_detail` block with structured diagnostic data:

```yaml
abort_detail:
  rule_violated: "INV-21-EvidenceLinkPreCommit" | "INV-A10-BootstrapSentinelMismatch" | "INV-K2-SchemaForwardCompat" | ...
  failing_ref: "<id of the evidence_ref that failed validation>" | null
  failing_field: "evidence_refs" | "prev_state_hash" | "operation_class" | ...
  chain_depth_walked: <integer>
  detection_phase: "schema-validate" | "evidence-link" | "bootstrap-sentinel" | "chain-walk"
  human_message: "<one-sentence human-readable explanation>"
```

Without `abort_detail`, a developer debugging a v3.0-alpha spawn failure has only the string `"k9-pre-commit-rejected"` and must re-read source to figure out WHY K9 rejected. With `abort_detail`, the WAL itself answers the diagnostic question. The field is schema-additive (per INV-K2-SchemaForwardCompat); v3.0-alpha emits it; older readers tolerate it as an unknown field.

**Served by**: Pillar 1 (false-memory at write boundary) + Pillar 3 (evidence-link is auditable).

---

## 4. State Model — Four-Class + Transaction-Record Shape (v6 RENUMBER: was Primitives by Layer; primitive grouping moved to §6)

**v6 structural note (2026-05-27)**: in v5.4 (and earlier), §4 was "Primitives by Layer" — a catalog of K/R/E primitives. v6 promotes §4 to the **State Model** that the primitives operate on. This is the load-bearing reframe: v5.4 specified the kernel transaction loop (Spawn → worktree → delta → verify → promote/reject → spawn-record) without making the state representation it transacts ON explicit. v6 closes that gap. The primitive catalog moves to §6.1 (kernel / runtime / lab tables); MVP-staged release plan moves to §6.3+ (Round 3 will complete the §6 full renumber per architect Tension 5).

### 4.1 — Four-Class State (folded from causal-recall RFC v3.2 §"The Four-Class State Model")

Every piece of **persistent persona-memory state** in the v6 substrate lands in exactly one of four classes. This taxonomy is the load-bearing foundation that A8/A9/A10 build atop — without a class-precise vocabulary, "memory consistency" devolves into hand-waving about files. **Scope clarification (v6 LOCK Patch G10)**: this taxonomy classifies persistent persona-memory state, NOT runtime OS-level state (active locks, live PIDs, transient configuration, `LOOM_MONITORED_SIBLINGS` env state, ephemeral worktree references). Runtime OS state is outside v6 scope and governed by K1/K13 lifecycle primitives + standard OS semantics. The "four classes" claim is exhaustive for persona memory, not exhaustive for everything the substrate touches.

**Advisory-finding content/emission split (v6 LOCK Patch GPT-1.C)**: R-primitive advisory findings (per A3b) have a load-bearing class ambiguity that deserves explicit treatment. The **content** of an advisory finding (the LLM-judged claim — "this looks like a security issue", "this naming feels inconsistent") is a Stochastic Sample (non-deterministic; would differ on re-sampling). The **fact that the finding was emitted** at a specific spawn-record with a specific timestamp is an Attestation (deterministic; verifiable from the chain). E14 (and any future derived view consuming R13 advisory-findings as evidence) MUST distinguish: the evidence-link is to the EMISSION ATTESTATION (which is grounded), not to the FINDING CONTENT (which is stochastic). A derived view that treats finding content as if it were attested fact is making a Stochastic Sample look like an Attestation — a category error that A10 + INV-27 are designed to prevent at the boundary, but readers need this disambiguation to apply the discipline correctly.

| Class | Definition | Storage discipline | Examples |
|---|---|---|---|
| **Axioms** | Irreducible, deterministic inputs to a transaction. | Persistent; durable; **immutable** (per A8, in-place mutation forbidden). | ADRs, KB anchors, persona contracts (content-hashed + semver-versioned), input prompts, model IDs, `parent_state_id`, `evolution_snapshot` (A6), `policy_version` (A6 + INV-A6-PolicyVersionedReplay). |
| **Deterministic Theorems** | Pure functions of axioms (graph walks, recall, set operations). | Memoized opportunistically; recoverable trivially on miss (re-derive from axioms). | `recall(topic)` over snapshot, `causal_chain(node_id)`, K6 subset-check result, K7 path-canonicalize result, K5 schema-validate verdict, endorsement-view projection (§6.4 E14). |
| **Stochastic Samples** | LLM-derived re-renderings; not deterministic by construction (per A1). | Memoized per-spawn at most; explicit "draw from distribution conditioned on axioms" framing in any CLI surface. | Agent reasoning traces (re-derived on demand; never authoritative), dream-consolidated insights (sibling-output, awaiting promotion), advisory findings from R-primitives (A3b — non-blocking). |
| **Attestations** | Action witnesses; verifiable proofs that something happened on the filesystem or in an external system. | Persistent; small; chained via `prev_state_hash` per A8; verifiable via §4.2 transaction-record shape. | K9 promotion records, K14 violation records, filesystem deltas (`git stash` SHA or path-list sha256), bounded outputs, K2 spawn-record envelopes, R13 idempotency-key records, GC events. |

**Class invariants** (referenced throughout §5a):

1. **Axioms are not theorems** — an axiom is an input you cannot derive; a theorem is a function output you can re-derive. The boundary is what makes A1 + A8 implementable: replay walks the chain of attestations applied to axioms; theorems are by-products of replay, not state.
2. **Theorems and stochastic samples are NOT the same thing** — theorems memoize cleanly (same inputs → same outputs); stochastic samples "memoize" only in the sense of caching one drawn sample. CLI surfaces that conflate the two violate Pillar 3 (audit honesty).
3. **Attestations are the chain** — A8's "deterministic replay of the chain of transactions" is precisely the replay of the attestation sequence applied to the axiom snapshot at `prev_state_hash`. The transaction-record shape in §4.2 is the on-disk encoding of an attestation.

**Composes with**:
- Pillar 1 (Filesystem-Delta-as-Truth): attestations include filesystem deltas; the delta IS the canonical attestation of in-scope filesystem-state change.
- Pillar 3 (Deterministic/Auditable): every spawn's behavior is replayable from its axioms + attested predecessors; stochastic samples are honestly labeled as such, never as "the truth."
- A6 (reputation snapshot): captured into `axioms.evolution_snapshot` at spawn-init; Lab→Kernel data flow is mediated by axiom-class storage, not by live reads.

**Cite**: this taxonomy moves verbatim from `packages/specs/rfcs/causal-recall-graph-rfc.md` §"The Four-Class State Model". See §4.4 for which other sections of the causal-recall RFC fold in vs. remain referenced.

### 4.2 — Transaction-Record Shape (v6, NEW; K2 envelope extension)

Every kernel-emitted record in the chain is a **transaction-record**: an envelope extending K2's spawn-record shape with 17 fields that make A8/A9/A10 implementable. The schema is **additive at v3.0-alpha** — existing K2-v2 readers see the new fields as forward-compat-tolerant unknowns (INV-K2-SchemaForwardCompat); v3.0-alpha+ readers consume the fields per A9's two-phase commit semantics.

```yaml
# v6 transaction-record envelope (extends K2-v2 spawn-record)
transaction_id:           <sha256(canonical_json(record_minus_this_field))>
prev_state_hash:          <sha256>                # chains to predecessor; GENESIS_HASH for chain root (§4.3)
post_state_hash:          <sha256> | null         # state hash after this transaction; null in phase-1 intent records
writer_persona_id:        <persona-name>          # the persona that authored this transaction
writer_spawn_id:          <spawn_id>              # the spawn that performed the work
parent_state_id:          <prior spawn_id>        # K3 lineage (unchanged from v5.4)
operation_class:          CREATE | APPEND | SUPERSEDE | TOMBSTONE | DERIVED-VIEW-INVALIDATE
affected_records:         [<block_id>, ...]       # the records this transaction touches
evidence_refs:            [<kernel_record_id>, ...] # per A10; non-empty for state-changing transactions
schema_version:           <v2|v3|...>             # K2 envelope schema version
policy_version:           <hash>                  # per INV-A6-PolicyVersionedReplay; v3.0-alpha schema-additive
intent_recorded_at:       <iso>                   # phase 1 of A9 two-phase commit
committed_at:             <iso> | null            # phase 2; null while PENDING
commit_outcome:           PENDING | COMMITTED | ABORTED | ROLLED-BACK | NOT_APPLICABLE
abort_reason:             <string> | null         # populated only when commit_outcome ∈ {ABORTED, ROLLED-BACK}
idempotency_key:          <sha256(canonical_json({writer_persona_id, operation_class, content_hash, prev_state_hash}))>
references_transaction_id: <transaction_id> | null # NEW v6 Round-2 Tension 6: phase-2 commit-records reference their phase-1 intent-record by transaction_id; null for intent-records and standalone records
```

**Field-by-field semantics**:

- `transaction_id` is the content hash of the record itself (minus the `transaction_id` field — fixed-point computation). Two records with identical content have the same `transaction_id`; this is what makes A10 evidence-link checks O(1) per lookup.
- `prev_state_hash` is the load-bearing chain pointer. For the first transaction in any `(schema_version, scope)` chain, it MUST equal the genesis sentinel (§4.3). Subsequent transactions MUST set it to the `post_state_hash` of the most recent COMMITTED transaction in the chain — never to an ABORTED or PENDING predecessor (would violate A8's "chain of transactions terminating at T").
- `evidence_refs` are validated by K9 pre-commit (per A10). Empty `evidence_refs` is rejected for any state-changing `operation_class` (CREATE/APPEND/SUPERSEDE/TOMBSTONE). DERIVED-VIEW-INVALIDATE MAY carry empty `evidence_refs` because invalidation is a cache-clear, not a state-change (still informational; still attested).
- `idempotency_key` is derived deterministically from the four fields shown. Two records with the same idempotency key are the same transaction — replay is a no-op (§5a.6). The key composes with R13 Idempotency-Key Enforcer (v3.1) which adds `(spawn_id, tool_use_id)`-derived keys for external side effects; the in-substrate idempotency-key in §4.2 is broader (covers all transactions, not only external-side-effecting ones).
- `references_transaction_id` (v6 Round-2 Tension 6 disclosure): the phase-2 commit-record's pointer back to its phase-1 intent-record. The bundle's original Artifact 3 envelope did not include this field; it is necessary for the two-phase WAL contract in §5.2 (separate-entry-per-phase decision) to be implementable. Default `null`; populated only on commit-records that resolve a prior PENDING intent. Storing the linkage in `evidence_refs` instead was rejected because `evidence_refs` is A10-load-bearing (forgery detection) and intent→commit linkage is a different semantic — overloading would weaken both. Dedicated field is the SRP-cleaner choice.

**Resolved sub-tension 1 (do ALL K2 records carry the full envelope?)**: **Yes — schema-additively at v3.0-alpha, with a sentinel `commit_outcome: NOT_APPLICABLE` for purely-informational entries.**

The argument for "yes":
- DRY: one envelope shape across all K2-emitted records; readers handle one schema, not two.
- SRP / Single-Source-of-Truth: the chain is THE source of truth (A8); fragmenting K2 emissions into "real transactions vs. informational entries" creates a second source readers must consult.
- Forward-compat: v5.4's `INV-K2-SchemaForwardCompat` already requires K2-v2 readers to tolerate unknown fields; adding the transaction-record fields is exactly the case that invariant was designed to handle.

The honest accommodation: **K2 emits some records that are NOT state transitions** — e.g., `spawn-init` records (pre-K14, pre-K9), GC events (`gc_sweep_complete`, `lock_recovered`), advisory findings dropping into `spawn-state.advisory_findings[]`. These records DO carry the full envelope (DRY), but their `commit_outcome` is set to the sentinel value **`NOT_APPLICABLE`**, signaling to readers "this record is informational, not a state transition; do NOT include it when walking the chain to compute `post_state_hash`."

Chain-replay semantics: `walkChain(start_hash)` skips `commit_outcome ∈ {NOT_APPLICABLE, PENDING, ABORTED}` entries; COMMITTED is the only outcome that advances state. PENDING records are visible to the recovery sweep (§5a.5) but not to canonical-state replay. ABORTED and NOT_APPLICABLE records are audit-trail-only.

This resolution keeps A8's single-source-of-truth property cleanly: every record lives in the chain, but only COMMITTED state-transition records contribute to the canonical state. NOT_APPLICABLE is the explicit sentinel that distinguishes audit-only entries from gated-out partial-failure ones.

**Composes with**:
- A8 (chain is canonical) — chain includes all envelope-emitted records; canonical state is the COMMITTED subset.
- A9 (two-phase commit) — `intent_recorded_at` / `committed_at` / `commit_outcome` enum implement the two phases.
- A10 (evidence-linked admission) — `evidence_refs` is the syntactic enforcement point at K9 pre-commit.
- INV-K2-SchemaForwardCompat (v5.4) — the schema-additive at v3.0-alpha lands exactly in this invariant's tolerance window.
- INV-R13-IdempotencyKeyUniqueness (v3.1) — the `idempotency_key` field is the storage location for R13's per-tool-call dedup keys; R13 derives, INV checks, K9 enforces non-collision.

### 4.3 — Genesis Sentinel (v6, NEW)

The empty-chain (pre-first-transaction) state is defined as the deterministic empty replay. Without an explicit sentinel, `prev_state_hash` for the first transaction in any chain would be either undefined (forces nullable handling) or zero (collides across schema versions and scopes — two fresh per-user chains under different schema versions would have identical first-transaction hashes, breaking content-addressability).

**Sentinel definition**:

```
GENESIS_HASH = sha256('GENESIS|' + schema_version + '|' + scope)
```

where `scope ∈ { "per-user", "per-project" }` (per §5a.9 Memory Root Pointer scope precedence).

**The first transaction in any chain MUST set `prev_state_hash = GENESIS_HASH`** for that chain's `(schema_version, scope)` pair. This:
- Binds the chain root to the schema version. Schema migration re-anchors the chain (per §5a.8 — schema migration is itself a SUPERSEDE transaction, and the SUPERSEDE's successor chain is anchored to the new schema_version's genesis).
- Disambiguates per-user vs per-project chains so identical `idempotency_key`s cannot collide at fresh-bootstrap (the only point of natural collision — both chains are at length-zero with no prior records to differentiate).
- Provides a well-defined `active_state_hash` for empty chains (computed as `GENESIS_HASH`, NOT `undefined`). This is what makes A8 implementable for fresh installs: the substrate's "canonical state at install-time" is the deterministic empty replay, hash-pinned.

**Example computation** for the canonical `("v6.0", "per-user")` chain:

```
input  = 'GENESIS|v6.0|per-user'
sha256 = (computed by reference implementation; pinned in test suite for INV-23 + INV-A8)
```

Implementations MUST canonicalize whitespace and use lowercase hex; reference implementation will pin the expected 64-char hex in the v3.0-alpha test suite.

**Forbids**:
- `prev_state_hash = null` or `prev_state_hash = "0x0000…"` on the first transaction — both forms are ambiguous; the sentinel is the only well-defined form.
- Cross-scope chain merging — a per-project chain's first record cannot reference a per-user chain's `post_state_hash` as its `prev_state_hash`, because the scopes are partitioned by genesis sentinel. Mediation between scopes is via the Memory Root Pointer (§5a.9), not via chain-merging.

**Composes with**:
- A8 (chain is canonical) — sentinel is the well-defined empty-replay anchor.
- §5a.8 (schema migration as transaction) — sentinel re-anchoring on schema version bump is what makes migration auditable.
- §5a.9 (Memory Root Pointer bootstrap) — bootstrap writes no WAL record; the WAL remains empty until the first real transaction, whose `prev_state_hash` is the sentinel for the bootstrapped `(schema_version, scope)` pair.

### 4.4 — Causal-Recall Graph (fold-in from RFC v3.2; architecturally-load-bearing sections only)

**Resolved sub-tension 2 (fold-in scope)**: **fold in architectural-load-bearing sections; reference implementation-detail sections.** Rationale: a full fold-in pushes v6 from ~2,500 LoC to >5,000 LoC and duplicates content that already has a durable home in `causal-recall-graph-rfc.md`. The fold-in target is the **architectural substrate** that v6 depends on; the **implementation specifics** (cherry-pick algorithm, on-disk file layouts, sweep scheduling, dream-prompt designs) remain in the standalone RFC where they belong.

**Folds in (architecturally-load-bearing — restated or summarized within v6 §4)**:

1. **Four-class state model** (causal-recall RFC §"The Four-Class State Model") → v6 §4.1 (above; canonical class definitions are now part of v6).
2. **L_spawn invocation-level semantics** → v6 §4 invariant: spawn-records capture invocation-level events only; sub-step-level capture is out of scope (plugin runtime limitation).
3. **Filesystem-as-shared-observable** → v6 §4 invariant: the filesystem delta is the canonical attestation; reasoning is private (theorem/sample class).
4. **Dream-lite cycle definition** (causal-recall RFC §"Dreaming Integration — Three Cycles") → v6 §4 covers ONLY the architectural property that all dream cycles enforce **immutable-input + sibling-output discipline**. Concrete prompts, cost caps, schedule specifics remain in the standalone RFC.
5. **GC split policy** (causal-recall RFC §"Spawn Lifecycle + GC + Retention") → v6 §4 covers ONLY the architectural split: **GC-Process** (PID-addressable; signal-based recovery) vs **GC-Spawn** (contractual; "stop waiting" recovery). Specific triggers, schedule cadences, recovery contracts remain in the standalone RFC.
6. **Attestation-log format** (causal-recall RFC §"New attestation types") → v6 §5.1 (WAL at `~/.claude/checkpoints/attestation-log.jsonl`; one record per line; fsync per write).

**References (NOT folded in; remain in the standalone RFC)**:

- Specific dream-prompt designs (cost caps, schedules, 4-phase Orient→Gather→Consolidate→Prune) — implementation detail.
- Per-scope causal-graph index format (`~/.claude/library/_meta/causal-graph-{scope}.json`) — discoverable via §5a.9 Memory Root Pointer's `manifests.causal_recall` entry; file format is implementation detail.
- CLI verb specifications (`loom recall`, `loom causal-chain`, `loom dream`, etc.) — implementation detail.
- Sweep scheduling specifics (Stop hook 50ms, PreCompact 8s hard limit, daily 10s budget) — implementation detail, governed by the `hooks.json` budgets.
- TOCTOU defense algorithm for lock recovery (`(pid, mtime, inode)` tuple check) — implementation detail.
- The four verification probes in causal-recall RFC §Phase 1 — superseded by the v6 Wave -1 probe list.

**Pointer**: v6 readers wanting full causal-recall implementation detail consult `packages/specs/rfcs/causal-recall-graph-rfc.md` directly. v6 is the architectural substrate; the causal-recall RFC is the implementation-detail durable artifact.

**Honest reason for split**: v6 aims to stay ≤2,500 LoC as the single architecturally-load-bearing substrate spec. The causal-recall RFC is already 660 LoC of locked-and-reviewed text; duplicating its implementation specifics into v6 would (a) push v6 past its size budget, (b) create dual sources of truth (drift inevitable), (c) require re-review of content that's already been through 4 review rounds. KISS + YAGNI both argue for fold-in-by-reference at the architectural seam, not fold-in-by-copy.

---

## 6.1 Primitives by Layer (v6 RENUMBER: was §4 — primitive tables kept verbatim below pending Round 3 full reorganization)

### 6.1.1 Loom Kernel Primitives (14 total — was 11; K12+K13 added v5.1, K14 added v4.1; K14 full spec at §6.5.K14)

| # | Primitive | Source / Mechanism | Shipping release |
|---|---|---|---|
| K1 | Worktree integration | `isolation: "worktree"` declarative (Anthropic native) | v3.0-alpha (after Wave -1 probe) |
| K2 | Spawn-record envelope (v2 schema) | `PostToolUse:Agent\|Task`; v2 schema w/ `parent_state_id` + forward-compat tolerance | v3.0-alpha (port + extend + forward-compat per Round-3 architect HIGH) |
| K3 | Lineage primitives | `parent_state_id` chain (~15 LoC under serial-only) | v3.0-alpha |
| K4 | Recall-CLI deterministic tri-signal ranker | `0.5·kw + 0.3·tag + 0.2·surface` over snapshot (not live store) | v3.0-alpha (port from Phase 1) |
| K5 | Schema validators | YAML frontmatter, secrets, config-guard, contract-verifier | Existing (Phase 1 hardened) |
| K6 | Capability subset check | Deterministic set-subset | **v3.1** (was v3.0-alpha; moved per user concern #2 — needs persona contracts) |
| K7 | Path canonicalization validator | Rejects `..`, absolute, symlink-escape | v3.0-alpha |
| K8 | Capability injection at spawn-init | `PreToolUse(Agent).updatedInput` (CONDITIONAL on Wave -1) | **v3.1** (was v3.0-alpha; moved per user concern #2 — needs personas to inject into) |
| K9 | Promote-deltas (cherrypick + path-rewrite + atomicity + reverse-cherrypick journal for rollback) | New PostToolUse hook | v3.0-alpha (**dedicated security review per user concern #3**) |
| K10 | LOOM_DISABLE_WORKTREE escape hatch | Operator-set env var | v3.0-alpha |
| K11 | Kernel algorithm library | `scripts/kernel/algorithms/*.js` | v3.2 (where A4 first becomes binding) |
| K12 | Layer-boundary convention (v5.1 DOWNGRADED from mandatory) | Per-file `// @loom-layer:` frontmatter markers + advisory CI lint that warns (does NOT block) on cross-layer imports (~50-80 LoC). Upgrade trigger captured as OQ-19. | v3.0-alpha (convention + advisory) |
| **K13** | **Serial-only spawn enforcer (NEW v4)** | Active rejection or queue of concurrent spawns; spawn-init detects active spawns via lock file + **PID-staleness check + orphan-lock recovery on Claude-Code-crash-mid-spawn** (lock file includes PID + start_at; reaping stale locks via `kill -0` + age threshold) (~150-220 LoC honest per Round-4 architect HIGH; was 80) | **v3.0-alpha (mandatory per user concern #4)** |
| **K14** | **Write-Scope Enforcer (NEW v4.1 per Wave -1 P-WriteScope FAIL)** | Filesystem-layer write-scope detection (out-of-scope writes detected post-hoc → REJECTED or ROLLED-BACK per A7); composes with K9 at §6.5.1 K9↔K14 sequencing contract; full spec at §6.5.K14 | **v3.0-alpha (mandatory per Wave -1 probe + A7 axiom; was inadvertently omitted from this table — added v6 LOCK per GPT-2.B)** |

**Kernel total**: 14 top-level primitives (K1-K14). K14 row added to this table per v6 LOCK-review GPT-2.B (previously specified in detail at §6.5.K14 but missing from this catalog table — HD-2 follow-on).

**Compound primitive disclosure (Round-3d per persona-Alex A2)**: while the top-level count is 14, the K2 primitive has grown into a **compound surface** through v4-v6 evolution:

| K2 sub-component | Shipping release | LoC | Purpose |
|---|---|---|---|
| K2 spawn-record envelope (v2 schema) | v3.0-alpha | base — Phase 1 port + ~50-80 schema-additive v6 fields | core envelope + transaction-record-shape extension (§4.2) |
| K2.b settings.json resolution walk | v3.0-alpha | ~80-120 LoC | per-precedence permissions snapshot into envelope |
| K2.c per-tool-call observability | v3.1 | ~100-200 LoC | per-tool-call event capture for replay |
| `references_transaction_id` field | v3.0-alpha | ~5-10 LoC | phase-1 ↔ phase-2 linkage in two-phase commit |
| `abort_detail` field (Round-3d M3) | v3.0-alpha | ~10 LoC | structured K9-rejection diagnostics |

Future readers consulting "K-primitive count" should understand this expansion — the headline number stays at 14 (no new top-level K-letter introduced) but K2's surface has materially grown. Honest disclosure prevents the K15/K16 phantom-primitive class of fabrication caught at LOCK-review HD-1.

**Verification surface**: pure functions only. **Stability**: MAJOR-bump-protected.

### 6.1.2 Loom Runtime Primitives (13 total — unchanged)

| # | Primitive | Layer | Shipping release |
|---|---|---|---|
| R1 | Two-tier persona contracts (interface + defaults) | Runtime | v3.1 |
| R2 | 16-persona migration (4 parallel sub-waves) | Runtime | v3.1 |
| R3 | Capability traits as mixins | Runtime | v3.1 |
| R4 | Trait composition rules (intersection/union/error) | Runtime | v3.1 (~50 LoC) |
| R5 | HETS hierarchical supervision pattern | Runtime | Phase 1 SHIPPED (extends in v3.1) |
| R6 | Pattern A — Persona-internal trampoline | Runtime | v3.2 |
| R7 | TodoWrite-as-checkpoint primitive | Runtime | v3.2 |
| R8 | Decomposition disciplines (tdd/spec-driven/exploratory) | Runtime | v3.2 |
| R9 | Leaf criteria (5 deterministic conditions) | Runtime | v3.2 |
| R10 | Budget envelope (tokens + wallclock + recursion depth) | Runtime | v3.2 |
| R11 | Spawn-verify dispatcher | Runtime | v3.2 |
| R12 | Test-runner adapter library | Runtime | v3.2 |
| R13 | Advisory verification path | Runtime | Phase 1 SHIPPED (extends in v3.2) |

### 6.1.3 Loom Evolution Lab Primitives (13 total — unchanged structure; E2 spec sharpened)

| # | Primitive | Status | Shipping release |
|---|---|---|---|
| E1 | Negative attestation Class-4 witness (`failure_signature` block) | Designed | v3.3 |
| E2 | Class-1 derived-policy extraction function (~180-250 LoC honest per Round-3 planner; was 120) | Designed | v3.3 |
| E3 | Policy-axiom store + recall integration (via A6 snapshot, NOT live read) + drain CLI | Designed | v3.3 |
| E4 | Reputation extension (per-persona × per-task-type × per-quality-axis) | Designed | v3.3 |
| E5 | Attribution graph (~250-400 LoC honest per Round-3 planner; was 120) | Designed | v3.4 |
| E6 | Convergence metrics CLI verb | Designed | v3.4 |
| E7 | Evolve/forge triggers + trigger-side circuit-breaker | Designed | v3.4 |
| E8 | Cross-persona test review + out-of-band ground-truth (OQ-12 must close first) | Designed | v3.4 (or whenever Pattern B ships if multi-spawn needed) |
| E9 | TDD-craft KB seed authoring + self-growth wiring | Human + Designed | v3.4 |
| E10 | Reference test suites (96-160h human work for meaningful suites) | Human-authored | v3.4 |
| E11 | Circuit-breaker on denials | Designed | v3.4 |
| E12 | Pattern B — Multi-spawn trampoline | Designed | DEFERRED (trigger: real depth-3+ workflow) |
| E13 | Dream-Lite cycles | Designed | DEFERRED to Phase 4 |

**TOTAL primitives across all layers**: 39 (K:13 + R:13 + E:13). **Honest count**: this is +2 from v3's 37 due to K12 + K13 additions (mandatory enforcement per user concerns). NO compression vs v3 in primitive count.

**"Delete before add" v4 honest verdict**: v4 explicitly does NOT claim compression. Two primitives added; zero deleted. Compression rhetoric removed.

---

## 5. WAL + Spawn-Boundary Semantics (v6 NEW SECTION)

This section specifies the Write-Ahead Log (WAL) format and the two-phase commit semantics by which A9 (Memory-Transaction-Atomicity) becomes implementable. §5 is purely architectural — concrete file paths and persistence details live under §5a.3 + §5a.9 (Memory Root Pointer's `manifests.attestation_wal`); algorithms for chain-walk, evidence-link check, and recovery sweep are v3.0-alpha implementation deliverables, not v6 spec content.

### 5.1 — Append-only WAL

**Format**: JSONL (one record per line; UTF-8; LF-terminated). Each record is a transaction-record envelope per §4.2.

**Location**: `~/.claude/checkpoints/attestation-log.jsonl` per §5a.3, **discovered via** the Memory Root Pointer's `manifests.attestation_wal` entry (§5a.9). No path is hard-coded in hooks/validators beyond the pointer-resolution sequence; the WAL's literal path is configuration, not contract.

**Write discipline**:
- One record per `fsync(2)` call. Multi-record batches are FORBIDDEN — a partial batch on crash leaves the WAL in an indeterminate state that A9's recovery sweep cannot disambiguate.
- Append-only by file mode (`O_APPEND`-equivalent — on Node.js, `fs.appendFileSync` with `fsync` post-write; on the eventual native runtime, `open(O_APPEND)` + `write()` + `fsync()`).
- **NO in-place mutation of any WAL record, ever.** This is the load-bearing realization of A8 at the WAL layer: state transitions are SUPERSEDE (sibling write referencing the predecessor by content-hash), never bare UPDATE. See §5.2 for how two-phase commit composes with this constraint.

**Example records** (illustrative; one COMMITTED, one PENDING):

```jsonl
{"transaction_id":"a1b2…","prev_state_hash":"0fc9…","post_state_hash":"7e3d…","writer_persona_id":"04-architect","writer_spawn_id":"sp-2026-05-27T10:00:00Z-arch-0001","parent_state_id":null,"operation_class":"CREATE","affected_records":["spawn-state-001"],"evidence_refs":["axiom-prompt-001"],"schema_version":"v2","policy_version":"pv-2026-05-27a","intent_recorded_at":"2026-05-27T10:00:00.123Z","committed_at":"2026-05-27T10:00:01.456Z","commit_outcome":"COMMITTED","abort_reason":null,"idempotency_key":"e5f6…","references_transaction_id":null}
{"transaction_id":"b2c3…","prev_state_hash":"7e3d…","post_state_hash":null,"writer_persona_id":"03-code-reviewer","writer_spawn_id":"sp-2026-05-27T10:01:00Z-cr-0001","parent_state_id":"sp-2026-05-27T10:00:00Z-arch-0001","operation_class":"APPEND","affected_records":["spawn-state-002"],"evidence_refs":["sp-2026-05-27T10:00:00Z-arch-0001"],"schema_version":"v2","policy_version":"pv-2026-05-27a","intent_recorded_at":"2026-05-27T10:01:00.789Z","committed_at":null,"commit_outcome":"PENDING","abort_reason":null,"idempotency_key":"f6a7…","references_transaction_id":null}
```

The first record shows a COMMITTED transaction (both `intent_recorded_at` and `committed_at` populated); the second shows a PENDING transaction awaiting its phase-2 commit-record (which would itself carry `references_transaction_id: "b2c3…"`).

**Composes with**:
- A8 (chain is canonical) — the WAL IS the chain's on-disk encoding; chain-walk = WAL-walk (modulo `commit_outcome` filtering per §4.2 resolved sub-tension 1).
- §5a.1 (no bare UPDATE; SUPERSEDE writes a sibling) — WAL append-only is the implementation of §5a.1 at the WAL layer.
- INV-19-WALAppendOnly (§6.13 v3.0-alpha+ activations) — property test: after N transactions, the WAL file has exactly N lines (no in-place edits detectable via mtime + line-count drift).

### 5.2 — Two-phase commit (v6, NEW)

A9 specifies two-phase commit at spawn boundaries. v6 implements both phases as **separate WAL entries**, NOT as a single entry that gets mutated. This preserves A8's single-source-of-truth property AND §5a.1's "no bare UPDATE" discipline.

**Decision: separate-entry-per-phase**. The intent-record and the commit-record are sibling WAL entries linked by shared `references_transaction_id`. Rationale below.

**Phase 1 — Intent record (spawn-init)**:

At spawn-init, the kernel emits a WAL entry with:
- `transaction_id`: computed from the proposed transaction content.
- `prev_state_hash`: the `post_state_hash` of the most recent COMMITTED entry in the WAL (or the genesis sentinel for an empty chain).
- `post_state_hash`: **null** (not yet known; depends on K14 verdict).
- `intent_recorded_at`: current ISO timestamp.
- `committed_at`: null.
- `commit_outcome`: `PENDING`.
- `references_transaction_id`: null.
- All other §4.2 fields populated per the proposed transaction.

The intent-record is fsync'd before the spawn dispatches. If the kernel crashes after this fsync but before phase 2, the PENDING record is what the recovery sweep (§5.3) reclassifies.

**Phase 2 — Commit-or-Abort record (spawn-close)**:

After K14 write-scope validation and (per §6.5.1 K9↔K14 sequencing contract) the K9 cherrypick-or-reject decision, the kernel emits a SECOND WAL entry — **never mutating the phase-1 record**:

- `transaction_id`: a NEW hash for the commit-record itself (it has different content from the intent-record).
- `references_transaction_id`: the phase-1 record's `transaction_id` — this is the linkage primitive.
- `prev_state_hash`: same as the intent-record's `prev_state_hash` (commit-record applies the same proposed transition).
- `post_state_hash`: populated (computed from the now-known final state).
- `intent_recorded_at`: copied verbatim from the phase-1 record (audit trail).
- `committed_at`: current ISO timestamp.
- `commit_outcome`: `COMMITTED` (if K14 PASS + K9 PASS) or `ABORTED` (if K14 FAIL pre-K9, or K9 reject) or `ROLLED-BACK` (if K14 FAIL post-K9 — see K9↔K14 contract).
- `abort_reason`: populated for ABORTED / ROLLED-BACK; null for COMMITTED.

**Why separate-entry-per-phase, not single-entry-mutated**:
- §5a.1 normatively forbids bare UPDATE; mutating a WAL entry to flip `commit_outcome` from PENDING → COMMITTED is EXACTLY the bare UPDATE pattern the discipline forbids.
- A8's "chain of transactions" is the chain of WAL entries; if entries are mutable, the chain is not content-addressable (the `transaction_id` of a record changes when its bytes change). Mutability breaks A8 at the storage layer.
- Append-only files are trivially safe under concurrent readers (any reader sees a consistent prefix); in-place-mutated files require reader synchronization that the substrate has no machinery for and no Pillar-grounded reason to add.
- Audit trail: the phase-1 record's `intent_recorded_at` and the phase-2 record's `committed_at` together give the COMPLETE spawn duration AND prove that intent preceded commit. A single mutated record can fake this (mtime-revisable); two records cannot (phase-2's content references phase-1's `transaction_id`, which IS phase-1's content hash).

**Composes with**:
- A9 (two-phase commit) — this IS the implementation.
- §6.5.1 K9↔K14 sequencing contract — K14 runs first; K9 runs second; both inputs feed the phase-2 `commit_outcome` decision.
- INV-20-TwoPhaseCommitClosure (§6.13) — property test: for every PENDING record, there exists either (a) a subsequent commit-record referencing it, OR (b) the WAL ends and recovery sweep will reclassify it ABORTED. No PENDING record may be permanently orphan-in-the-middle-of-the-WAL.

**Chain-walk semantics with two-phase commit**: when computing `active_state_hash` by walking the WAL tail, `walkChain()` consumes commit-records (not intent-records) — the intent-record's `post_state_hash` is null and cannot advance the state. The commit-record's `post_state_hash` is what advances the chain. Intent-records are visible to the recovery sweep and to audit-trail consumers; they are invisible to canonical-state replay (filtered by `commit_outcome` per §4.2 sub-tension 1 resolution).

### 5.3 — Recovery sweep (v6, NEW)

On substrate startup, after pointer resolution per §5a.9, the kernel runs the recovery sweep against the resolved WAL.

**Algorithm** (architectural; v3.0-alpha implementation owns the concrete code):

1. **Resolve pointer** — read `memory-root.json` per §5a.9; locate `manifests.attestation_wal`.
2. **Walk WAL from tail backward** until either (a) the file head is reached, or (b) a COMMITTED transaction's content-hash matches the in-memory snapshot's `last_known_committed_hash` (substrate's prior state-pin from its own snapshot, if any). The tail-walk bounds the sweep's work.
3. **For each PENDING intent-record encountered during the tail-walk**, check if a subsequent commit-record exists in the WAL with `references_transaction_id` matching this PENDING record's `transaction_id`.
4. **If a commit-record exists** (any outcome — COMMITTED, ABORTED, ROLLED-BACK), the intent-record is already resolved; sweep takes no action.
5. **If no commit-record exists** (orphan-PENDING), the sweep MUST first perform **filesystem reconciliation** (v6 LOCK Patch GPT-1.A — load-bearing) before marking ABORTED:
   - Compute actual filesystem/worktree state hash via `git stash create` (without applying) against the parent branch at the orphan PENDING's `prev_state_hash`.
   - **If actual filesystem state equals `prev_state_hash`** (no filesystem changes survived the crash): proceed to step 6 — safe to emit ABORTED.
   - **If actual filesystem state differs from `prev_state_hash`** (filesystem may contain partial-promoted changes): emit a `RECOVERY_DIVERGENCE` attestation FIRST (carrying `expected_hash`, `actual_hash`, `orphan_transaction_id`, `divergence_at: <iso>`), then either (a) rollback the filesystem via the chosen K9 snapshot strategy (per §6.5.2 + OQ-18 P-Snapshot probe outcome), OR (b) mark the workspace `QUARANTINED_REQUIRES_MANUAL_RECONCILE` and refuse to start new spawns until a human operator resolves. **The sweep MUST NOT silently emit ABORTED while filesystem state is unverified.**
   - Only after filesystem reconciliation completes successfully, emit a NEW commit-record with:
     - `references_transaction_id`: the orphan PENDING's `transaction_id`.
     - `commit_outcome`: `ABORTED`.
     - `abort_reason`: `"recovery-sweep-orphan"` if filesystem matched, OR `"recovery-sweep-orphan-with-rollback"` if rollback happened, OR `"recovery-sweep-orphan-quarantined"` if workspace is now in manual-resolve state.
     - `committed_at`: current ISO timestamp (the recovery moment).
     - All other §4.2 fields per the orphan-PENDING (copied verbatim where applicable; `post_state_hash` set to `prev_state_hash` since no canonical state change ultimately occurred).
6. **fsync** after every emitted ABORTED record AND every emitted `RECOVERY_DIVERGENCE` attestation. Recovery is durable.
7. **Worktree pruning (v6 LOCK Patch G4)**: for each emitted ABORTED record whose `operation_class` involved a K1 worktree, attempt to prune the associated worktree directory via `git worktree remove --force`; if removal fails, log a `worktree-prune-failed` attestation and continue (pruning is best-effort; failure does not block startup, but accumulating prune-failures should trigger operator attention per K1 lifecycle invariant).

**Operator runbook for `QUARANTINED_REQUIRES_MANUAL_RECONCILE` state (Round-3d Patch per persona-Sam S5)**: when recovery sweep emits a `RECOVERY_DIVERGENCE` attestation and marks the workspace QUARANTINED, the substrate refuses to start new spawns. The operator unquarantine procedure for v3.0-alpha (until a `loom recovery` CLI ships at v3.1 per OQ-23-adjacent):

1. **Inspect**: `cat ~/.claude/checkpoints/attestation-log.jsonl | tail -50` to find the latest `RECOVERY_DIVERGENCE` record. Read `expected_hash`, `actual_hash`, `orphan_transaction_id`, and `divergence_at`.
2. **Diagnose**: compare the on-disk filesystem state at the affected worktree against the chain's expected `prev_state_hash`. If the filesystem matches an OLDER chain hash, the substrate likely crashed mid-commit (partial-failure recovery case). If it matches NEITHER expected nor older, manual intervention is required (corruption / external tampering / unclean shutdown).
3. **Resolve** (choose one):
   - **Accept current filesystem state**: emit a manual ABORTED record closing the orphan PENDING with `abort_reason: "operator-resolved-divergence"`; reset the workspace's `last_known_committed_hash` to a new sentinel (operator-attested).
   - **Rollback to expected state**: run K9's reverse-cherrypick (when v3.0-alpha ships) against the orphan transaction's reverse-journal to restore the filesystem to `prev_state_hash`, then emit ABORTED.
   - **Wipe and rebuild**: if divergence is irrecoverable (worktree corrupted), delete the worktree, emit a `workspace-wiped` attestation, and let the next spawn re-create from genesis sentinel.
4. **Unquarantine marker**: emit a `quarantine-resolved` attestation to the WAL with `references_transaction_id` pointing at the original `RECOVERY_DIVERGENCE` record. Substrate startup-checks for this marker and admits new spawns.

This runbook is the v3.0-alpha interim discipline; v3.1+ should ship a `loom recovery` CLI verb that wraps these steps with safety guards.

**Resolved sub-tension 3 (recovery-sweep idempotency)**: codified as the testable property contract below.

**INV-A9-RecoverySweepIdempotent** (P3; codification of A9's recovery clause):

> Walking the WAL twice during recovery produces identical state. Specifically: if `recoverySweep(WAL_path)` is invoked at time T1, completes, and then is invoked again at time T2 > T1 with no intervening writes to the WAL, the second invocation MUST emit zero new ABORTED records (every prior orphan-PENDING was already resolved by T1's sweep; there are no NEW orphan-PENDING records to find).
>
> Property test: synthesize a WAL with K orphan-PENDING records; run sweep; assert K ABORTED records emitted. Run sweep again with no other writes; assert zero ABORTED records emitted. Run sweep a third time; assert zero again.

This invariant is the formal statement of "orphan-PENDING reclassification is idempotent on re-run." It composes with §5a.6 (idempotency: replaying a transaction with an existing `idempotency_key` is a no-op) — the recovery sweep IS a special case of idempotent replay, where the "transaction" being replayed is "reclassify orphan to ABORTED."

**Forbids**:
- Replaying COMMITTED records as if they were PENDING. The sweep filters by `commit_outcome` first, then walks; COMMITTED records are skipped at the filter stage.
- Modifying ABORTED records to COMMITTED post-hoc. Once a record's `commit_outcome` is set, it is immutable (A8 + §5a.1). If a previously-aborted transaction needs to be retried, a NEW intent-record is emitted with a new `transaction_id` — never mutation of the old one.
- Recovery-sweep emission of records other than commit-record-with-ABORTED. The sweep is a single-purpose reclassifier; it does not retry, does not roll forward, does not synthesize new intents. Retries are a Runtime concern, not a Kernel-recovery concern.

**Composes with**:
- A9 (two-phase commit, recovery clause) — implements the "reclassify orphan PENDING as ABORTED with reason: recovery-sweep-orphan" requirement.
- §5a.5 (recovery sweep on substrate startup) — §5a.5 governs the WHEN; §5.3 governs the HOW.
- §5a.9 (pointer resolution precondition) — sweep CANNOT run before pointer resolution; the sweep needs `manifests.attestation_wal` to know which file to read.
- INV-A9-RecoverySweepIdempotent (above) — the testable contract.
- INV-20-TwoPhaseCommitClosure (§6.13) — every PENDING resolves, eventually.

### 5.4 — Spawn-boundary commit semantics

Spawn-execution boundaries map to A9's two-phase commit transitions concretely.

**At spawn-init** (PreToolUse:Agent|Task fires):
- Kernel writes phase-1 intent-record per §5.2.
- `commit_outcome: PENDING`; spawn dispatch proceeds.
- K13 serial-only enforces that no other spawn is in PENDING state — at most one PENDING transaction per persona at any time. Concurrent spawn attempts are rejected or queued (per K13 v3.0-alpha mandatory enforcement). This composes with INV-K13-SerialOnly.

**At spawn-close** (PostToolUse:Agent|Task fires):
- K14 runs first per §6.5.1 — produces SCOPE_OK or VIOLATION verdict.
- If K14 PASS, K9 cherrypicks per §6.5.1 — produces PROMOTED or REJECTED verdict.
- Kernel writes phase-2 commit-record per §5.2:
  - K14 PASS + K9 PASS → `commit_outcome: COMMITTED`.
  - K14 PASS + K9 REJECT (e.g., schema validation failure) → `commit_outcome: ABORTED`, `abort_reason: "k9-pre-commit-rejected"`.
  - K14 FAIL pre-K9 → `commit_outcome: ABORTED`, `abort_reason: "out_of_scope_writes_detected"`.
  - K14 FAIL post-K9 (tail-window detection) → `commit_outcome: ROLLED-BACK`, `abort_reason: "out_of_scope_writes_tail_window"`.

**R10 budget envelope composition** (v3.2+ activation): budget exhaustion mid-spawn produces a phase-2 commit-record with `commit_outcome: ABORTED`, `abort_reason: "budget-exhausted"`. The kernel's spawn-watchdog detects budget exhaustion and emits the abort record exactly as if K14/K9 had reached a reject verdict — the WAL doesn't care WHY the spawn ended, only that it ended with one of the four outcomes.

**K13 serial-only composition** (v3.0-alpha mandatory): at most ONE PENDING transaction per persona at any time. The spawn-init check for "is any spawn currently in PENDING state for this persona?" is implemented as a WAL tail-scan for the most recent intent-record without a corresponding commit-record. If found, K13 rejects or queues the new spawn-init. This composes with INV-K13-SerialOnly and is what makes the recovery sweep bounded — there is at most one orphan-PENDING per persona to reclassify on crash recovery, never an unbounded fan-out.

**Memory-candidate flow (v6 Round-3c — per cross-reviewer convergence finding from GPT external review)**: the spawn-boundary commit semantics above implement what GPT framed as the **memory-candidate discipline** — `observation → memory candidate → evidence check → parent endorsement → committed memory`. Mapping the GPT flow to v6 primitives:

- **observation**: the spawned agent's filesystem deltas + tool outputs during the spawn lifetime (raw stochastic samples per §4.1 class taxonomy).
- **memory candidate**: phase-1 intent-record with `commit_outcome: PENDING` (per §5.2); the proposed transaction exists in the WAL but has not yet advanced the canonical state. Equivalently, the block is in lifecycle state `candidate` (§5a.1).
- **evidence check**: K9 pre-commit's A10 enforcement (every state-changing transaction MUST carry evidence_refs to in-chain records OR a bootstrap-sentinel per the §3 A10 exception). Rejects candidates with forged or empty evidence.
- **parent endorsement**: the orchestrator-spawn relationship is the structural endorsement primitive — the spawning parent persona reviews via K9/K14 outcomes; promotion-status (COMMITTED vs ABORTED) IS the endorsement record. For L_persona promotion specifically (per causal-recall RFC), parent endorsement is a separate kernel transaction emitted by the orchestrator after observing the child's spawn-record outcomes.
- **committed memory**: phase-2 commit-record with `commit_outcome: COMMITTED` (per §5.2); block transitions to lifecycle state `active`. The canonical state hash advances; future spawns see the new state via §5a.4 MVCC snapshot pinning.

This flow is the v6 enforcement primitive that distinguishes "agent wrote a note" (candidate) from "kernel-validated durable memory" (active). The candidate stage is NOT a separate primitive in v6 — it's the PENDING phase of A9's two-phase commit. Naming it explicitly makes the discipline legible to readers consulting §5a in isolation.

**K13 × K14 tail-window interlock (v6 LOCK Patch GP1, per Gemini 3.1 Pro external review)**: K14's tail window (`LOOM_K14_TAIL_WINDOW_MS`, default 3000ms per §6.5.K14) extends past spawn-close to catch backgrounded out-of-scope writes. K13 MUST NOT unblock next-spawn dispatch until the prior spawn's K14 tail window has officially closed (i.e., `now() ≥ prior_spawn.committed_at + LOOM_K14_TAIL_WINDOW_MS`). Without this interlock, the next spawn's worktree-init overlaps with the prior spawn's tail-window observation period, and any out-of-scope write detected during the overlap becomes **unattributable** — which spawn produced it? Attribution-ambiguity defeats the audit-trail property A8/A9 are designed to deliver. The honest trade: serial-only K13 + 3s tail-window K14 imposes a fixed 3-second-per-spawn throughput cost in v3.0-alpha. This cost is the price of unambiguous attribution and is acknowledged as a v3.0-alpha design constraint. **v3.1+ event-stream K14 variant** (per §6.5.K14) closes the tail window structurally (real-time write detection during spawn; no polling tail-window needed), at which point the K13-blocks-on-tail-window interlock can be relaxed. Codified as **INV-28-K13K14SerialClosure** (§6.13).

**Composes with**:
- A9 (two-phase commit at spawn boundaries) — the spawn boundary IS the commit boundary.
- §6.5.1 K9↔K14 sequencing contract — defines WHICH outcomes feed the phase-2 record.
- R10 budget envelope — budget-exhaust composes as a valid abort cause; no new commit_outcome enum value needed.
- K13 serial-only — bounds the PENDING set to ≤1 per persona at any time; makes recovery O(personas), not O(WAL size).
- INV-K13-SerialOnly, INV-R10-BudgetMonotonic (both in §6.13) — testable contracts on the spawn-boundary properties.

---

## 5a. Memory Consistency Discipline (v6 NEW SECTION)

This section codifies the discipline by which axioms A8/A9/A10 become operational. Each subsection is a normative rule that primitives implementing the kernel transaction loop MUST follow. Most subsections are short — the discipline is precise but not voluminous.

### 5a.1 — CRUD taxonomy: no bare UPDATE

> **Normative**: the CRUD taxonomy for canonical-state writes is **CREATE | APPEND | SUPERSEDE | TOMBSTONE | DERIVED-VIEW-INVALIDATE**. No bare UPDATE; **SUPERSEDE writes a sibling record and references the predecessor by content-hash**.

The taxonomy is what makes A8's content-addressed state machine implementable. Each operation_class has well-defined semantics:

- **CREATE** — first record in a chain or first record for a previously-non-existent `affected_records` entry. Predecessor is the genesis sentinel (§4.3) or another COMMITTED record; no predecessor on the affected record itself.
- **APPEND** — adds new content without invalidating predecessor content. The predecessor remains canonical for its content; the new record extends it.
- **SUPERSEDE** — replaces a predecessor's content. The predecessor is still in the WAL (immutable per A8) but is no longer canonical for the `affected_records` it covered. Readers walking the chain see the predecessor's `superseded_by` field pointing to this record.
- **TOMBSTONE** — explicit deletion. The predecessor remains in the WAL; the tombstone record marks it removed from the canonical-state view. Tombstoned records are skipped by `loom recall` and chain-replay's state computation, but are visible to audit-trail consumers.
- **DERIVED-VIEW-INVALIDATE** — cache-clear signal for derived views (§0a.3.1). NOT a state-change; carries empty `evidence_refs` legitimately; informs readers that any cached projection MUST be recomputed before next use.

**Why "no bare UPDATE" matters**: bare UPDATE (in-place mutation of a record's content) would (a) break A8 (chain ceases to be content-addressed because record content can change underneath its `transaction_id`), (b) make concurrent readers see inconsistent states, (c) eliminate the audit-trail property (history can be rewritten by mutating an entry). SUPERSEDE-as-sibling-write is the discipline that preserves all three properties.

**Block lifecycle states (v6 Round-3c — per cross-reviewer convergence finding from GPT external review)**: the CRUD taxonomy above defines **transitions** (verbs); the substrate also recognizes derived **lifecycle states** (nouns) computed from the chain of COMMITTED transitions for a given `affected_records[*]` entry:

| State | Computed from |
|---|---|
| `candidate` | latest transition is `commit_outcome: PENDING` (intent recorded, awaiting commit) |
| `active` | latest COMMITTED transition is CREATE or APPEND; NO subsequent SUPERSEDE or TOMBSTONE references this record |
| `superseded` | a later COMMITTED SUPERSEDE references this record's `transaction_id` via `affected_records` |
| `tombstoned` | a later COMMITTED TOMBSTONE references this record's `transaction_id` |
| `aborted` | latest transition is `commit_outcome: ABORTED` or `ROLLED-BACK` (recovery-sweep-emitted or K9-rejected) |
| `informational` | record has `commit_outcome: NOT_APPLICABLE` (spawn-init, GC event, DERIVED-VIEW-INVALIDATE — not state-changing) |

These lifecycle states are NOT stored anywhere — they are PURE PROJECTIONS over the chain, computable at any point in O(chain-depth) per record. The states compose: a `candidate` becomes `active` on COMMIT; an `active` becomes `superseded` if a later record updates it; a `superseded` block remains audit-visible in the WAL but is filtered from canonical-state replay. This explicit lifecycle framing helps readers reason about block state without conflating it with operation_class. The lifecycle projection is itself a derived-view-shape and is bound by §0a.3.1's constraints — lifecycle-state computations MUST NOT widen capability scope, propagate as instruction-text, or grant non-evidence-linked trust.

**Cross-reference**: composes with INV-24-NoBareUpdate (§6.13). Implementation guidance: any K-primitive that wants to "update" a record must instead emit a SUPERSEDE record. The K9 implementation has had this discipline since v5.4; v6 codifies the discipline at the substrate level so future primitives (R-tier and E-tier) inherit it.

### 5a.2 — Atomic-write discipline

> **Normative**: all canonical writes use tmp-write + fsync + atomic-rename.

The pattern is the v5.4 K1/K9 atomic-write primitive (`_lib/atomic-write.js` in the implementation), reused unchanged. The three-step pattern guarantees that readers never see a half-written file: either the rename succeeds (new content visible atomically) or it doesn't (old content remains visible). The fsync between write and rename is what makes the durability of the new content load-bearing — without it, a crash between write and rename could leave the old name pointing to truncated content.

**Implementation guidance**: every K-primitive that writes to a canonical path (WAL, snapshot index, derived-views-cache invalidation marker, Memory Root Pointer per §5a.9) MUST use the shared `_lib/atomic-write.js` helper. Direct `fs.writeFile`/`fs.appendFile` to canonical paths is FORBIDDEN at the kernel layer. Runtime layer primitives that write to spawn-scratch are exempt (scratch is per-spawn and discarded at spawn-close per K1 worktree teardown).

**Cross-reference**: composes with A9 (atomicity), §5a.9 (Memory Root Pointer writes use this primitive), INV-K9-SyntacticAtomicity (§6.13 — K9 cherrypick is atomic at git-state level via this primitive).

### 5a.3 — WAL location and write cadence

> **Normative**: the WAL is `~/.claude/checkpoints/attestation-log.jsonl` (append-only, fsync per write), **discovered via §5a.9 Memory Root Pointer's `manifests.attestation_wal`**.

The default path is what fresh installs initialize the pointer to; existing installs may have the WAL elsewhere if a per-project pointer overrides per-user (per §5a.9 scope precedence). Hooks and validators MUST resolve via the pointer; hard-coding the default path is FORBIDDEN.

Append-only and per-write fsync are restated here (§5.1 already covers the format and write discipline) so that §5a stands alone as the discipline reference — readers consulting §5a in isolation get the complete WAL contract without needing to cross-read §5.

**Cross-reference**: §5.1 (full WAL spec); INV-19-WALAppendOnly (§6.13); §5a.9 (pointer discovery).

### 5a.4 — MVCC snapshot isolation at spawn boundary

> **Normative**: MVCC snapshot isolation at spawn boundary — each spawn reads from a `prev_state_hash`-pinned view; concurrent spawns see independent views.

At spawn-init, the kernel captures the current `prev_state_hash` (the `post_state_hash` of the most recent COMMITTED record). Throughout the spawn's lifetime, any read against the chain (e.g., `loom recall`, evidence-link lookups, persona-memory queries) is mediated through this pinned hash. Subsequent COMMITTED records added to the WAL during the spawn's lifetime are INVISIBLE to that spawn.

Under K13 serial-only (v3.0-alpha mandatory), this is degenerate — only one spawn is active at a time, so "concurrent spawns see independent views" is trivially satisfied. The invariant exists for forward-compat: when K13 relaxes to bounded-concurrency in v3.5+/Phase 4, MVCC snapshot isolation is what preserves A1 (transactional determinism) under concurrent spawn dispatch. v6 ships the discipline now so the implementation has it from the start; the K13-relax milestone gets MVCC for free.

**Implementation guidance**: pin `prev_state_hash` in the spawn's `axioms.evolution_snapshot` block (per A6 mechanism). All reads against the chain consult the snapshot, never the live WAL tail.

**Cross-reference**: A1 (transactional determinism); A6 (evolution_snapshot mechanism); INV-23-MVCCSnapshotPinned (§6.13).

### 5a.5 — Recovery sweep precondition

> **Normative**: recovery sweep on substrate startup walks WAL, reclassifies orphan PENDING records, never replays already-COMMITTED records. **Recovery sweep presupposes pointer resolution per §5a.9** (Patch 2): the pointer must be resolved before the sweep can locate the WAL.

The full algorithm is in §5.3; §5a.5 captures the precondition discipline. The startup ordering is:

1. Resolve `memory-root.json` per §5a.9 (read existing or bootstrap).
2. Resolve `manifests.attestation_wal` from the pointer.
3. Run recovery sweep against the resolved WAL.
4. Substrate is ready to accept new spawn-inits.

Steps 1-3 are sequenced; no parallel-with-other-startup-work is permitted. If pointer resolution fails (corrupt pointer, schema-version below floor), the substrate refuses to start — DOES NOT attempt to run the sweep against a guessed default path. Failing closed on pointer-resolution error is what makes the rest of the substrate's invariants composable; failing open would allow the sweep to operate on the wrong WAL and silently corrupt the chain.

**Cross-reference**: §5.3 (sweep algorithm); §5a.9 (pointer resolution); INV-A9-RecoverySweepIdempotent (§5.3); error-handling per `kb:architecture/discipline/error-handling-discipline` (fail-closed).

### 5a.6 — Idempotency

> **Normative**: replaying a transaction with an existing `idempotency_key` is a no-op (INV-R13-IdempotencyKeyUniqueness; extended in v6 to cover all transactions, not only external-side-effecting ones).

Two transactions with the same `idempotency_key` (per §4.2 derivation: sha256 of `{writer_persona_id, operation_class, content_hash, prev_state_hash}`) are semantically the same transaction. The kernel's intent-record-write step (§5.2 phase 1) checks the WAL for an existing record with the proposed `idempotency_key`; if found, the new intent-record is NOT emitted, and the kernel returns the existing record's `transaction_id` to the caller.

This composition is what makes recovery and retry safe:
- Recovery sweep can be invoked multiple times without producing duplicate ABORTED records (idempotency at the sweep level — INV-A9-RecoverySweepIdempotent).
- External callers retrying a network operation (R13 in v3.1) cannot accidentally double-commit — the second retry's idempotency_key matches, kernel returns existing transaction_id, no second WAL write.
- Replay of a recorded chain (e.g., for debugging or audit reconstruction) is safe — replaying a transaction whose idempotency_key already exists is a no-op.

**Cross-reference**: R13 (v3.1 implementation owner); INV-R13-IdempotencyKeyUniqueness (§6.13); §5.3 (recovery sweep idempotency).

### 5a.7 — Sibling-output discipline for derived views

> **Normative**: derived views write to sibling paths, never in-place over canonical records.

Per §0a.3.1 (Pillar 3 Derived-View No-Amplification Clause), derived views are pure projections over kernel-emitted records. The sibling-output discipline is the storage-layer corollary: when a derived view is materialized (e.g., the E14 endorsement-view cache), it MUST write to a sibling path discovered via §5a.9's `manifests.derived_views_cache` directory — never overwriting a kernel-canonical record.

Sibling-output is what makes derived views safely invalidatable: a DERIVED-VIEW-INVALIDATE record (per §5a.1 CRUD taxonomy) signals "discard the cached sibling; recompute on next read." If derived views shared paths with canonical records, invalidation would risk eating canonical data.

**Implementation guidance**: every derived-view producer reads canonical records from the chain (via §5a.4 pinned-snapshot view), computes its projection, writes to a sibling path under `manifests.derived_views_cache`, and indexes the sibling under an input-hash key. Readers re-verify the input-hash before consuming the sibling (per the C0 cache-discipline rule).

**Cross-reference**: §0a.3.1 (Pillar 3 clause); §6.4 E14 endorsement-view spec; §5a.9 (`manifests.derived_views_cache`); INV-17-EvidenceLinkRequired.

### 5a.8 — Schema-version migration as transaction (with pointer-migration exception)

> **Normative**: schema-version migration is itself a transaction (SUPERSEDE with `operation_class=SUPERSEDE, affected_records=[<schema-record-id>]`). **Exception**: `memory-root.json`'s own schema migration is NOT executed as an A9 transaction (it is the precondition of A9); see §5a.9 self-migration clause.

The general rule: when the substrate's schema_version advances (e.g., v6.0 → v6.1), the migration that re-anchors the chain to the new genesis sentinel is itself an A9 transaction. It emits intent-record + commit-record per §5.2; it carries `operation_class=SUPERSEDE` with `affected_records=[<schema-record-id>]`; it carries non-empty `evidence_refs` to the prior schema's most recent canonical record (per A10). After commit, the new chain's first real transaction's `prev_state_hash` is the new schema_version's genesis sentinel.

This composition makes schema migration auditable: the WAL records a clear "schema v6.0 → v6.1 migration committed at T with content-hash X" entry, replayable from the chain.

**Pointer self-migration follows standard A9 two-phase commit (v6 LOCK Patch GP2, per Gemini 3.1 Pro external review)**: An earlier v6 draft treated pointer self-migration as an A9 exception emitting a single COMMITTED record after atomic rename. Gemini 3.1 Pro caught the race: if process crashes between atomic rename and WAL emission, the new pointer is live on disk but the audit record is lost forever — violating A8 replayability. **The exception is REMOVED in this LOCK patch.** Pointer migration is now a regular A9 transaction following the DB catalog-migration pattern:

1. **Phase 1 — Intent record (in the OLD pointer's WAL, before rename)**: emit `memory_root_schema_migrating` intent with `commit_outcome: PENDING`, carrying `from_schema_version`, `to_schema_version`, `from_content_hash` (pre-rename pointer SHA), `to_content_hash` (proposed post-rename pointer SHA), `intent_recorded_at`. fsync the WAL.
2. **Phase 1.5 — Atomic rename**: tmp-write the new pointer; fsync; atomic-rename. The rename is the storage-layer commit point but A9-level commit comes next.
3. **Phase 2 — Commit record (in the NEW pointer's WAL, after rename)**: emit `memory_root_schema_migrated` commit with `references_transaction_id` matching the intent record, `commit_outcome: COMMITTED`, `committed_at`. fsync the WAL. **Fd-lifecycle discipline (Round-3d Patch M2a per persona-Maya)**: phase-2 commit uses a FRESH pointer-resolve+open sequence, NOT a held fd from phase-1. Any fd opened against the OLD WAL is closed before atomic rename; the NEW WAL is opened fresh via the post-rename pointer resolution. This avoids POSIX rename-with-open-fd semantics where the fd would continue pointing at the renamed inode regardless of the new pointer state.

**Cross-mount EXDEV handling (Round-3d Patch M2b per persona-Maya — load-bearing for per-user ↔ per-project pointer migration)**: when migrating between per-user (`~/.claude/...`) and per-project (`<cwd>/.loom/...`) scopes, the source and destination paths may sit on different filesystems (host volume vs project-mounted volume; user-home on a different mount than the working directory). POSIX `rename(2)` returns `EXDEV` (cross-device link) and fails atomically. The substrate MUST handle this case:

1. Detect: attempt `rename(2)`; if `EXDEV` returned, fall through to the cross-mount fallback.
2. Cross-mount fallback algorithm: (a) emit a `memory_root_cross_mount_migrating` intent record with `commit_outcome: PENDING` to BOTH the OLD pointer's WAL AND the destination filesystem's WAL stub (a marker file). (b) Copy the new pointer content to a tmp file on the destination filesystem; fsync the tmp file; atomic-rename within the destination filesystem (same-mount rename, guaranteed atomic). (c) Emit phase-2 commit to the NEW pointer's WAL. (d) Unlink the old pointer from its source filesystem; emit a corresponding `memory_root_cross_mount_old_pointer_unlinked` attestation to the NEW WAL.
3. Recovery on crash during cross-mount: both pointers may exist on disk during the windowed-PENDING state. Recovery sweep reads both filesystems' WALs; if BOTH pointers exist AND the intent record is still PENDING on either WAL, the substrate falls-closed (refuse to start; manual operator intervention required per §5.3 QUARANTINED workspace handling).
4. The cross-mount migration is materially more expensive than same-mount (~10× the IO; documented honestly so operators can choose to keep scopes on the same volume when feasible).

**Crash-recovery semantics** (the load-bearing property): on next startup, recovery sweep finds the orphan PENDING intent record. The sweep then probes the pointer file on disk:
- If pointer's content-hash equals `to_content_hash` from the intent record → rename happened pre-crash; recovery sweep emits the missing commit-record with `commit_outcome: COMMITTED`, `abort_reason: null`, closing the intent.
- If pointer's content-hash equals `from_content_hash` from the intent record → rename did NOT happen; recovery sweep emits a commit-record with `commit_outcome: ABORTED`, `abort_reason: "recovery-sweep-orphan-rename-pre-crash"`, closing the intent. The substrate is left at the original schema_version.
- If pointer's content-hash matches neither (partial-write, corruption, or third-party tampering) → recovery sweep emits `commit_outcome: ABORTED`, `abort_reason: "recovery-sweep-orphan-pointer-divergence"`, AND emits a `RECOVERY_DIVERGENCE` attestation; substrate refuses to start (fail-closed; manual operator intervention required, consistent with §5a.5).

**Chicken-and-egg resolution (the original concern, now properly handled)**: the intent record lives in the OLD pointer's WAL (which is resolved via the OLD pointer at startup); the commit record lives in the NEW pointer's WAL (resolved via the new pointer post-rename). Recovery walks the OLD pointer's WAL first, finds the orphan PENDING, probes the on-disk pointer, then walks whichever WAL (OLD or NEW) corresponds to the actual on-disk state. The audit trail is preserved across the rename boundary — both WALs contain the migration record (intent in OLD, commit in NEW); chain-replay can traverse the migration cleanly.

**Implementation guidance**: the `memory_root_schema_migrating` / `memory_root_schema_migrated` records carry:
- `from_schema_version`: the pre-migration pointer's schema_version.
- `to_schema_version`: the post-migration pointer's schema_version.
- `from_content_hash`: sha256 of the pre-migration pointer file content.
- `to_content_hash`: sha256 of the post-migration pointer file content.
- Standard A9 two-phase fields: `intent_recorded_at`, `committed_at`, `commit_outcome`, `references_transaction_id`.

**INV-25 update (v6 LOCK Patch GP2)**: INV-25-SchemaMigrationIsTransaction (§6.13) no longer carries the "exception" clause. All schema migrations — including pointer schema migrations — are regular A9 two-phase commit transactions. The only thing that distinguishes pointer migration from other migrations is the cross-WAL phase-1/phase-2 placement.

**Cross-reference**: §5a.9 (pointer convention and self-migration clause); INV-25-SchemaMigrationIsTransaction (§6.13 — with the §5a.8 exception documented); §5a.2 (atomic-write primitive).

### 5a.9 — Memory Root Pointer Convention (v6, NEW; canonical from Artifact 4)

The Memory Root Pointer is the substrate's single discovery artifact for locating persona memory. It is **discovery-only** — the `active_state_hash` field was dropped per user-lock (Patch 1) to preserve A8's single-source-of-truth property. The active state hash is always computed by walking the WAL tail; the pointer's job is to tell the substrate WHERE the WAL lives, nothing more.

**Canonical schema**:

```json
// ~/.claude/loom/memory-root.json  (per-user)
// .claude/loom/memory-root.json    (per-project, when present)
{
  "schema_version": "v6.0",
  "scope": "per-user" | "per-project",
  "project_context": "/Users/.../my-project",
  "manifests": {
    "causal_recall":         "~/.claude/library/_meta/causal-graph-{scope}.json",
    "attestation_wal":       "~/.claude/checkpoints/attestation-log.jsonl",
    "persona_memory_index":  "~/.claude/library/_meta/persona-blocks-index.json",
    "derived_views_cache":   "~/.claude/library/_meta/derived-views/"
  },
  "schema_compat_floor": "v5.4"
}
```

**Discovery**: the kernel locates persona memory by reading `memory-root.json` first. No path is hard-coded in hooks/validators beyond the root pointer location itself.

**Scope precedence**: when a per-project `memory-root.json` exists at `<cwd>/.claude/loom/memory-root.json` AND its `project_context` matches CWD, it overrides the per-user pointer at `~/.claude/loom/memory-root.json`. Otherwise the per-user pointer is canonical. This permits project-scoped substrate state (e.g., a sandboxed dev environment) without breaking the per-user default.

**Per-project path discipline (v6 LOCK Patch G9)**: when `scope: per-project`, the `manifests.*` paths MUST be project-local (e.g., `<project_context>/.loom/attestation-log.jsonl`); per-user-style `~/.claude/...` paths in a per-project pointer are a CONFIGURATION ERROR and MUST be rejected by the reader as schema-invalid. Without this discipline, a per-project pointer that copies per-user manifests verbatim would write to the user-global database, defeating the sandboxing purpose of `scope: per-project`. The reader enforces the discipline via path-prefix check: per-project manifests MUST resolve under `project_context` after `~` expansion.

**Project pointer trust policy (v6 LOCK Patch GPT-3.D)**: a per-project `memory-root.json` shipped inside a project repository is **untrusted input** until validated. A malicious or compromised project could carry a pointer that redirects the substrate to attacker-controlled WAL/index paths (config-injection vector). Exact CWD matching of `project_context` is NOT a security boundary on its own. The reader MUST apply a project-trust policy before adopting a per-project pointer:

- **(a) Owner check**: the per-project `memory-root.json` MUST be owned by the same user running the substrate (filesystem `stat` check). Files owned by other users are rejected as untrusted.
- **(b) Project-context CWD invariant**: `project_context` MUST equal the resolved real-path of CWD (no symlink chicanery — use `fs.realpath`).
- **(c) Operator-approved repos** (v3.1+): optional allowlist at `~/.claude/loom/trusted-projects.json` listing project_context paths the user has explicitly approved for per-project pointer adoption. When the allowlist exists, projects NOT on the list fall back to per-user pointer regardless of presence of a per-project file.
- **(d) Fail-closed default**: if any check fails OR the per-project pointer is malformed, the substrate MUST fall back to the per-user pointer + emit a `per-project-pointer-rejected` advisory attestation. No silent adoption of untrusted pointer state.

This discipline composes with `kb:architecture/discipline/error-handling-discipline` (fail-closed) and prevents the Memory Root Pointer from becoming a capability-bearing config-injection vector (per GPT external review §3.D + Alt 4).

**Operator-recovery procedure for `per-project-pointer-rejected` (Round-3d Patch per persona-Sam S3)**: when the substrate emits this attestation and falls back to the per-user pointer, the operator's options for v3.0-alpha (until `loom trust add <project>` ships per OQ-23):

1. **Inspect the rejection reason**: `grep per-project-pointer-rejected ~/.claude/checkpoints/attestation-log.jsonl | tail -5` shows which trust-check failed (owner mismatch / realpath divergence / allowlist miss / schema-invalid).
2. **If the per-project pointer is legitimate** (you trust the project): edit `~/.claude/loom/trusted-projects.json` (create if absent) to add the project's `project_context` to the allowed list:
   ```json
   {
     "schema_version": "v6.0",
     "trusted_project_contexts": [
       "/Users/yourname/Documents/trusted-project-1",
       "/Users/yourname/Documents/trusted-project-2"
     ]
   }
   ```
   The file MUST be owned by the user running the substrate (owner check enforced on read). Next substrate startup will admit the per-project pointer.
3. **If the per-project pointer is suspect**: leave the per-user fallback in place. The substrate continues to operate against the per-user WAL; the per-project pointer's existence is ignored until trust is granted.
4. **If the project is no longer trusted**: remove the project from `trusted-projects.json`. Next startup falls back to per-user without warning (no quarantine for revocation; the previously-trusted per-project WAL retains its history but stops being canonically read).

This procedure is the v3.0-alpha interim; v3.1+ should ship a `loom trust add <project>` and `loom trust list` CLI per OQ-23.

**Atomicity**: updates to `memory-root.json` use tmp-write + fsync + atomic-rename per §5a.2 (composes with A9 and §5a.2). Codified as INV-26-MRAtomicWrite.

**Startup ordering (Patch 2)**: (1) resolve `memory-root.json` (read existing or bootstrap); (2) resolve `manifests.attestation_wal`; (3) run A9 recovery sweep against the resolved WAL. The pointer is a precondition of the sweep — see §5a.5.

**Bootstrap/recovery**: if `memory-root.json` is missing, the kernel reconstructs it by scanning the well-known default paths and writes a fresh pointer. If the file is present but schema-invalid (e.g., missing required field, unparseable JSON, schema_version below schema_compat_floor of the running substrate), treat as missing — do not half-parse. On bootstrap, the active state is the deterministic empty replay; the first real transaction's `prev_state_hash` MUST equal the genesis sentinel for that `(schema_version, scope)` pair (see §4.3). Bootstrap writes no WAL record; the WAL remains empty until the first real transaction.

**Index scope (Patch 3)**: `persona_memory_index` indexes ONLY kernel-canonical records (K2/K3/K9 chain entries, R13 advisory-findings, A6 snapshots). Derived views MUST NOT be indexed here; they live in `derived_views_cache` and are discoverable separately. Indexing derived views in `persona_memory_index` would allow them to be selected as `evidence_refs`, violating A10 and Pillar 3. Codified as INV-27-PersonaIndexCanonicalOnly.

**Pointer self-migration (v6 LOCK Patch GP2 — supersedes earlier "exception" framing)**: `memory-root.json` schema migrations ARE executed as standard A9 two-phase commit transactions, following the DB catalog-migration pattern. Phase 1 (intent) is written to the OLD pointer's WAL before atomic rename; phase 2 (commit) is written to the NEW pointer's WAL after atomic rename. See §5a.8 for the full algorithm, including recovery semantics (probe on-disk pointer content-hash to determine whether rename completed pre-crash; close orphan PENDING accordingly). The earlier draft's single-COMMITTED-record "exception" was unsafe — it lost the audit trail entirely if the process died between rename and WAL emission. The two-phase approach preserves A8 replayability across the rename boundary.

**What this convention does NOT add** (explicit non-scope):
- No custom binary format.
- No byte-offset allocation or block-pointer tables.
- No mmap of memory-root.json.
- No free-block tracking.
- No state caching beyond what the WAL + content-addressed chain already provide.

**Cross-reference**: A8 (chain is canonical; pointer is discovery-only); A9 (pointer resolution precedes recovery sweep); §5a.2 (atomic-write primitive shared); §5a.5 (recovery sweep precondition); §5a.8 (self-migration exception); INV-26-MRAtomicWrite, INV-27-PersonaIndexCanonicalOnly (§6.13 invariants 26 + 27).

**Honest scope** (from Artifact 4):

| Component | LoC / hours |
|---|---|
| `memory-root.js` reader (resolve scope, parse, schema-validate) | 50-80 LoC |
| Atomic-write helper invocation (reuse existing primitive) | 10-15 LoC |
| Bootstrap/recovery sweep on missing or corrupt | 30-50 LoC |
| INV-MR-AtomicWrite property test | 40-60 LoC |
| ADR-0014 (memory-root convention, scope rules, what-NOT-to-add) | 3-4h pair-reviewed text |
| **TOTAL** | **130-205 LoC / 4-6h** |

Sits inside v3.0-alpha K2 reservation PR scope without expanding that PR's budget envelope.

---

## 6.2 Capability Model (v6 RENUMBER: was §5)

**v4 clarification per user concern #2**: capability injection (K8) and subset check (K6) are NOT in v3.0-alpha. They land in v3.1 when persona contracts have capabilities to inject/check. v3.0-alpha kernel ships without these enforcement primitives because the PURE MVP (worktree → delta → verify → promote/reject → spawn-record) doesn't require them.

**Phase 2 (v3.1+) enforcement matrix**:

| Capability axis | Declared in contract | Enforcement |
|---|---|---|
| Read | Broad allowlist | None (audited post-hoc) |
| Write | Sandbox-only | **Worktree filesystem scope** (Anthropic native, v3.0-alpha) |
| Network | Explicit allowlist | None (advisory; Phase 4 candidate) |
| Subprocess | Scoped command whitelist | Settings.json `permissions.allow` per-Claude-Code-invocation (advisory at persona level) |

**Trait composition rules** (per R4, v3.1):
- Narrowing-direction (subprocess, write): intersection (tightest wins)
- Broadening-direction (read, recall): union (widest wins)
- Same-direction conflicts: contract-load-time error

---

## 6.4 E14 Endorsement-as-Derived-View (Lab layer; v6, NEW)

**Status**: APPROVED per C0 architect decision 2026-05-27 (HETS-routed spawn; full text in `/tmp/c0-decision-summary.md`; ADR-0013 codifies the decision).

**Headline**: Endorsements are a **derived view** computed from K2 spawn-records + R13 advisory-findings + A6 reputation snapshot + K3 lineage. **NOT a first-class persistent primitive.** This is a v6 reversal of the v5.4 → v3.3 roadmap, which had `E14 Endorsement primitive` on the schedule with 4-5 invariants and 5 security launch-blockers. The 6 load-bearing reasons (priority order):

1. **§0a pillar-grounding test fails for the primitive option**. K12 v5.1 precedent applies: principle-tier not pillar-tier → ship as convention + advisory, not mandatory enforcement / new persisted record.
2. **Data already captured**: v5.4 K2 envelope + R13 advisory-findings + A6 reputation already contain every field needed to derive endorsement-equivalent signal. A derived view is a pure projection; a primitive is duplication.
3. **SRP violation in the primitive option**: two writers for evidence-about-persona-N-performed-task-T (existing K2/R13/A6 + new endorsement-record duplicate). Derived-view preserves single-writer-per-evidence-class.
4. **DIP cleaner in derived-view**: E4 reputation depends on kernel record abstractions directly (Lab → Kernel). Primitive creates horizontal Lab-layer coupling.
5. **Security cost asymmetry — load-bearing**: the 5 security launch-blockers exist BECAUSE the primitive creates the attack surface. Removing the primitive removes the surface. Endorsement-records-as-primitive is structurally a Trust-Vulnerability Paradox amplifier (B3 field-survey debt; arxiv 2510.18563).
6. **Only unique primitive-enabler is endorser-side reputation** — which IS the Trust-Vulnerability Paradox amplifier B3 explicitly forbids. Negative disambiguator.

### Architectural framing — Lab not Kernel (per C0 reason #4 DIP cleanliness)

E14 lives in the **Loom Evolution Lab** layer (`packages/lab/_lib/endorsement-view.js`, sibling of E4 reputation aggregator), NOT in Loom Kernel. The derived-view's inputs are all kernel-emitted records (K2/R13/A6/K3); the projection itself is Lab-layer code that depends ON kernel record abstractions. This is the correct DIP direction — Lab depends on Kernel, not vice versa. The primitive option would have introduced horizontal Lab-layer coupling (E4 reputation aggregator consuming endorsement-records that themselves depend on K2/R13/A6 — three-hop indirection through a duplicating intermediate).

### Spec location

`packages/lab/_lib/endorsement-view.js` (sibling of E4 reputation aggregator at `packages/lab/_lib/reputation-aggregator.js` once E4 lands in v3.3 per §6.8).

### Core query pseudo-code (verbatim from C0; ~80-120 LoC)

```js
function deriveEndorsements({ k2Records, r13Findings, a6Snapshot, k3Lineage, filter }) {
  return k2Records
    .filter(r => r.parent_state_id != null)
    .filter(r => r.spawn_id !== r.parent_state_id)
    .filter(r => r.promotion_status !== 'pending')
    .map(spawn => ({
      endorser_persona_id: lookupParent(k3Lineage, spawn.parent_state_id).persona_id,
      endorsed_persona_id: spawn.persona_id,
      skill_scope: { task_type, quality_axis, repo_area },
      grade: deriveGrade(spawn, r13Findings),
      evidence_refs: [spawn.spawn_id, spawn.k9_journal_id, ...r13Findings.matching(spawn).map(f=>f.id)],
      policy_version: spawn.policy_version,
      derived_at: now(),
    }))
    .filter(matchesFilter(filter));
}
```

### Grade rubric

| Condition | Grade |
|---|---|
| K9 promoted + zero R13 findings | strong |
| K9 promoted + low-severity findings only | adequate |
| K9 promoted + higher-severity findings | weak |
| not-promoted (K9 REJECT, K14 violation, budget abort, etc.) | inadequate |

`deriveGrade(spawn, r13Findings)` reads the spawn's `commit_outcome` (per §4.2 transaction-record shape) and the `r13Findings.matching(spawn)` severities and returns one of the four labels above. Pure function; same inputs always produce the same grade.

### Cache discipline

The view IS a pure function. The view MAY be cached as a perf optimization at `manifests.derived_views_cache` (per §5a.9 Memory Root Pointer; default `~/.claude/library/_meta/derived-views/endorsement-view.json`) keyed by an input-hash:

```
cache_key = sha256(k2_records_sha + r13_findings_sha + a6_snapshot_sha + k3_lineage_sha)
```

**Cache contract** — readers MUST re-verify the input-hash before consuming a cached projection. A stale cache (inputs have changed since cache write) is silently re-computed; the cache is never trusted blindly. This composes with §5a.7 sibling-output discipline and with the §5a.1 DERIVED-VIEW-INVALIDATE operation_class.

### Invariants (3; replace 4-5 that the primitive would have needed)

Per §6.13 (full property-test sketches in invariant tables):

- **INV-16-EndorsementViewDeterministic** (P3): pure function; byte-equal output across calls (modulo `derived_at` timestamp) for fixed inputs.
- **INV-17-EvidenceLinkRequired** (P3): every derived endorsement carries ≥1 evidence_ref to a kernel-emitted record that exists in the input.
- **INV-18-NoSelfEndorsement** (P2): `endorser_persona_id != endorsed_persona_id` enforced at query-time, not at record-write-time.

**Collapsed from the primitive option** (no separate invariants needed for the derived-view): nonce-uniqueness, acyclic chain, chain-depth-bound, external-evidence-required — all moot under derived-view semantics; INV-17 absorbs external-evidence-required (input domain IS kernel-emitted evidence).

### Boundary discipline

- **E4 reputation MAY consume** the endorsement view as a read shape (Lab→Lab projection composition).
- **E4 reputation MAY NOT cause** the endorsement view to be persisted as canonical state.
- **INV-A6-NonAuthorizing** (per `packages/specs/research/v3.1-v3.2-field-survey-debt.md` §B3) is preserved — the view is read-only; cannot widen K6/K8 capability scope. The §0a.3.1 Derived-View No-Amplification Clause closes any routing path.
- **Endorser-side reputation use case is explicitly out of scope indefinitely**. Triggers for revisit captured in ADR-0013.

### LoC + hours budget (Round-3 planner-calibrated)

| Component | Honest |
|---|---|
| Core `deriveEndorsements` function | 80-120 LoC |
| Grade rubric + threshold tuning | 40-60 LoC |
| Integration glue with E4 aggregator | 50-80 LoC |
| Invariant property tests (3 × ~50 LoC: INV-16/17/18) | 180-250 LoC |
| ADR-0013 (endorsement-as-derived-view rationale + scope discipline) | 3-4h pair-reviewed text |
| **TOTAL** | **350-510 LoC / 8-12h** |

### v3.3 budget impact

E14 (~350-510 LoC / 8-12h) is intended to fit within v3.3's slack against the upper envelope bound (~500-750 LoC / 14-20h per §6.8). **Honest framing (HD-5 fix)**: v5.4's §6.8 listed E14 as a roadmap entry with "4-5 invariants and 5 security launch-blockers" but no itemized LoC budget; there is no concrete "primitive budget" being reallocated. The substantive savings vs the rejected primitive path come from eliminating the 5 launch-blocker security workstream (anti-gaming + external-evidence + acyclic-chain + idempotency + restraint-type), each of which would have been its own multi-hour effort. v3.3's §6.11 effort summary table has NOT been updated for v6 (HD-3 cleanup deferred); if E14's LoC pushes against the existing E1-E4 line items, v3.3 budget expansion is the honest disclosure at v3.3 LOCK time.

### Composes with

- §0a.3.1 Derived-View No-Amplification Clause — E14 is the first concrete derived view; serves as the worked example for the pillar-tier clause.
- §4.2 transaction-record shape — E14 reads `commit_outcome` and `evidence_refs` directly from kernel-emitted records; no schema additions required.
- §5a.7 sibling-output discipline — E14 cache writes go to `derived_views_cache`, never to canonical paths.
- §5a.9 Memory Root Pointer — `manifests.derived_views_cache` is the discovery point.
- INV-27-PersonaIndexCanonicalOnly — derived views are NEVER indexed in `persona_memory_index`; the endorsement view cannot backdoor into evidence-link via the index.
- A10 Evidence-Linked Admission — the endorsement view's `evidence_refs` are pre-validated by virtue of being derived from kernel-emitted records.

### Cross-reference

- C0 architect decision: `/tmp/c0-decision-summary.md`.
- ADR-0013 (endorsement-derived-view) at `packages/specs/adrs/0013-endorsement-derived-view.md`.
- §6.13 invariants 16/17/18 (testable property contracts).
- §6.8 v3.3 release plan (E14 ships inside the existing envelope).

---

### 6.3 PURE Minimum Viable v3 Definition (v6 RENUMBER: was §6.0; sharpened per user concern #2)

**Round-3 renumber bridge**: §6.1 catalogues the primitives; §6.2 specifies the capability model; §6.4 specifies the first concrete derived view (E14). §6.3 through §6.13 schedule WHICH primitives ship in WHICH release. The collision between Round-2's new §6.1/§6.2 (Primitives + Capability Model) and Round-1's old §6.0 through §6.13-OLD (release scope) is resolved by promoting the release-plan subsections to §6.3 through §6.13. The old `## 6. MVP-Staged Release Plan` top-level heading is removed; §6 is a single section with four sub-blocks (primitives → capability model → first concrete derived view → release plan).

> **The smallest deterministic transaction loop:**
> **Spawn → isolated worktree → capture delta → deterministic verify (path + schema only) → promote or reject → write spawn record.**

**Capability injection and subset checking are NOT in the PURE MVP.** They land in v3.1 when contracts exist to check/inject against. v3.0-alpha proves the transaction loop works with the existing Phase 1 architect contract as the single test spawnee.

### 6.3a Wave -1 — Entry-Gate Probe (v6 RENUMBER: was §6.0a; ~6-9h on spike branch; EXPANDED per Round-3 planner HIGHs)

**Probes (5 total — was 3)**:
- **P-Inject** (~1h): `PreToolUse(Agent).updatedInput` rewrites Agent tool_input. Size limits.
- **P-Worktree** (~1h): `isolation: "worktree"` honored for plugin agents. `git worktree list` shows allocation. Composes with `git stash`-based delta capture.
- **P-DepthOne** (~1h): Claude Code's depth-1 constraint for plugin sub-agents under v3.1 persona contract shape.
- **P-Settings** (NEW per planner HIGH; ~1h): settings.json `permissions.allow` actually applies to spawn-init's PreToolUse hook context for spawned sub-agent.
- **P-EscapeHatch** (NEW per planner HIGH; ~1h): LOOM_DISABLE_WORKTREE actually bypasses K1 as documented.
- **P-HookChain** (NEW per planner HIGH; expansion of P-Inject; ~1h): K8 composes with existing PreToolUse(Agent) hooks (contract-reminder, route-decide) — hook execution order + cumulative-rewrite semantics.
- **P-WriteScope** (NEW per architect MEDIUM; ~1h): spawned agent attempting to write outside its allocated worktree fails / is blocked / is detected.

**Exit gate**: empirical evidence on disk in `swarm/thoughts/shared/spikes/v3-entry-probes.md` + ~1-2h write-up time. If any probe fails, v3.0-alpha plan revises BEFORE any code lands.

**Scope**: ~140 LoC of probe scripts + write-up. **6-9h total.**

### 6.5 v3.0-alpha — PURE KERNEL TRANSACTION LOOP (v6 RENUMBER: was §6.1 release-scope; v6 HD-4 note: heading carries stale v3-era figures ~20-28h, ~900-1,300 LoC; canonical post-v4.2 figures are ~2,225-3,550 LoC / ~41-71h per §6.11 effort summary; v6 K2 reservation PR honest scope ~260-405 LoC / ~8-12h per Round-3d C1 reset; v3.0-alpha total post-Round-3d ~52-87h per §6.11 update)

**Per user concern #2**: K6 + K8 removed; v3.0-alpha is the absolute smallest kernel that proves the deterministic transaction loop.

**Round-3d v3.0-alpha additions (per 5-persona implementation pair-review)**

The following items are net-NEW in v3.0-alpha scope per the 5-persona implementation pair-review (Round-3d):

- **`pre-spawn-tool-mask.js` hook (NEW per persona-Sam S4 + Round-3d C2 — THE ONE THING)** (~30-50 LoC, ~+1h): a PreToolUse(Agent) hook that strips `WebFetch` + network-Bash patterns (`curl|wget|gh|aws|nc|ssh`) + MCP tools (`mcp__*`) from the spawned agent's tool list at K1/spawn-init, **regardless of persona contract**. This enforces the v3.0-alpha network-side-effecting tool prohibition at the kernel layer (Pillar-2 Byzantine-treatment-of-LLM) rather than via persona-contract discipline (Pillar-4 TDD/role-separation) which is honor-system. Without this hook, v3.0-alpha ships the central security claim "no network side effects" with no kernel-layer mechanism backing it — the §2.4 "enforce, not document" anti-pattern. Composes with v3.1 K8 capability injection (K8 narrows further; this hook is the v3.0-alpha-before-K8-ships safety net).
- **Property-test harness + clock-injection infra (NEW per persona-Tess T1/T2 + Round-3d C3+C4)** (~+500-1000 LoC / ~+10-15h): the §6.13 invariants require property tests; the harness LoC was rolled into per-primitive estimates but the cross-cutting infrastructure (synthetic-WAL fixture builder for INV-A9-RecoverySweepIdempotent; injectable-clock + injectable-fs-watch sources for INV-28-K13K14SerialClosure to avoid wallclock-bounded test flakiness; kernel-crash-mid-write injection for INV-26-MRAtomicWrite) is NOT budgeted in any prior §6.5 line item. Honest disclosure: v3.0-alpha LOCK ships ~10-12 invariants with property tests + ~8-10 invariants with manual-verification or deferred-to-v3.0-alpha-patch tests. Implementation may choose to add multi-OS CI matrix (~+6-10h additional) here OR explicitly caveat per persona-Tess T4.

**In scope** (10 items — K6/K8 removed; K12/K13 added; **K14 added v4.1 per P-WriteScope FAIL**; **K9 + K14 hardened in v4.2 per Round-5 architect**; **2 Round-3d additions above per 5-persona pair-review**):
- K1 Worktree integration (declarative)
- K2 Spawn-record envelope v2 (port + parent_state_id + forward-compat tolerance per Round-3 architect HIGH)
  - **K2.b settings.json resolution walk (NEW v4.2 per Round-5 HIGH-4)**: ~80-120 LoC; resolves user-global → project-local → project-local-untracked precedence; emits `axioms.permissions_snapshot` into spawn-record envelope at spawn-init. K2 owns this because the hook payload exposes only `permission_mode` (P-Settings finding); allow/deny lists are NOT propagated. K2.b is an honest sub-primitive, not a footnote.
- K3 Lineage primitives (parent_state_id chain ~15 LoC under serial-only; session_id injected via prompt because no env propagation per P-DepthOne finding)
  - **K3.b Context Envelope (NEW v5 per field-survey O3 + Cognition "Don't Build Multi-Agents" critique)**: ~80-150 LoC; schema-additive block carried in K8's `updatedInput` payload. Structure: `context_envelope: {parent_state_id, parent_axioms_subset, constraints[], adr_refs[], kb_refs[], prior_decisions[{topic, verdict, rationale_sha256}]}`. v3.0-alpha ships the schema + K8 plumbing; v3.1 personas opt in by declaring `consumes_context_envelope: true` in their contracts. Rationale: Cognition's #1 critique is that parallel/spawned agents don't share parent's context — without structured context-passing, every persona reinvents this ad-hoc as free-form prompt prepending, violating §2.4 "enforce, not document" principle. K3.b lands in v3.0-alpha because retrofitting across 16 persona contracts in v3.1 is materially more expensive than building it once now.
- K4 Recall-CLI port from Phase 1 spike to main (~1-2h port work per Round-3 planner MEDIUM)
- K7 Path canonicalization validator (~60 LoC)
- K9 Promote-deltas with cherrypick + path-rewrite + atomicity + **reverse-cherrypick journal for rollback** (~500-750 LoC honest per Round-3 planner; CWE-22 surface; **+150-300 LoC for K14 violation-reconciliation hook**; **semantic-invalidity test fixtures ≥4 (one per class: dangling imports, unresolved types, broken test fixtures, stale generated artifacts) per Round-5 MEDIUM-1**)
- K10 LOOM_DISABLE_WORKTREE escape hatch with explicit bypass semantics + audit-log Class-4 event
- **K12 Layer-boundary convention (v5.1 DOWNGRADED from mandatory per Round-7 architect empirical-zero-drift finding)** — frontmatter markers + advisory CI lint (~50-80 LoC). Original v4 mandatory enforcement was preemptive against a problem that hasn't occurred in 6 months of spike branch work. Convention + advisory retains 80% of the value at ~30% of the cost; upgrade trigger to mandatory captured in OQ-19.
- **K13 Serial-only spawn enforcer (NEW; mandatory per user concern #4)** — kernel actively rejects or queues concurrent spawns; spawn-init detects active spawns via lock file or spawn-state directory scan (~80 LoC)
- **K14 Write-Scope Enforcer (HARDENED v4.2 per Round-5 CRITICAL-2)** — see §6.5.K14 below for full spec. Honest LoC: **500-900** (not 200-400 as v4.1 claimed).
- ADR-0008 + ADR-0009 + **ADR-0010 (write-scope enforcement rationale + P-WriteScope evidence + K9↔K14 sequencing contract)** (~5-6h pair-reviewed text per Round-3 planner LOW)

### §6.5.K14 — Write-Scope Enforcer detailed spec (v6 RENUMBER: was §6.5.K14; v4.2; CRITICAL-2 fix)

**Scope**: parent's worktree root (`git rev-parse --show-toplevel` on parent) + an explicit `LOOM_MONITORED_SIBLINGS` env-var-configured whitelist (default empty). NOT the full user home directory — bounded by what the agent is plausibly likely to touch.

**Filesystem-watch primitive**:
- **macOS**: FSEvents API via the `fsevents` npm package (or platform-native equivalent). Real-time event stream during spawn lifetime.
- **Linux**: `fanotify` (root-required) or `inotify` (per-process). Real-time event stream.
- **Fallback**: spawn-bookended snapshot (mtime+size+sha256 of parent's tree at spawn-init and at spawn-close+3s tail-window). Use when fsevents/inotify unavailable.
- v3.0-alpha ships the snapshot fallback (deterministic, no native dep); v3.1 adds the real-time event-stream variant under a feature flag.

**Bash backgrounded-write window**: spawn-close triggers a +3s tail-window where K14 continues monitoring for late writes (Bash subprocesses that completed AFTER the Agent tool returned but BEFORE the parent shell reaped). Configurable via `LOOM_K14_TAIL_WINDOW_MS` (default 3000).

**Hash strategy**: mtime+size diff finds 90%+ of changes cheaply. For files where mtime changed but size did NOT, K14 computes sha256 to catch same-size in-place edits (detection cost paid only on suspect files, not whole tree).

**Symlink + TOCTOU surface**: symlinks resolved via `fs.realpath` before scope check; symlink target swaps detected as a write to the link itself. K14 inherits K9's CWE-22 hardening (path canonicalization + symlink-race detection) — shared `_lib/path-canonicalize.js` (K7).

**Performance budget**: parent worktrees with ≤50K files complete snapshot in ~500ms p99. Serial-only spawn cadence (K13) means snapshot cost does not compound across concurrent spawns. For trees >50K files, K14 emits a warning at spawn-init and recommends scoping `LOOM_MONITORED_SIBLINGS` more tightly.

**Override**: `LOOM_ALLOW_OUT_OF_SCOPE_WRITES=1` env var bypasses K14 detection entirely; audit-logged Class-4 event with the env-var value as the audit reason. Same pattern as K10.

**Honest LoC breakdown**:
- Snapshot algorithm + sha256 fallback: ~200 LoC
- fsevents/inotify integration (v3.1, behind flag): ~150 LoC
- Tail-window timer + concurrency primitives: ~80 LoC
- Symlink + TOCTOU hardening (shared with K7): ~80 LoC
- Path-whitelist config resolution: ~60 LoC
- Audit-log + Class-4 event emission: ~80 LoC
- Test fixtures (4 violation classes × 3 transports = 12 fixtures minimum): ~250 LoC
- **Total: ~900 LoC (honest range 500-900 depending on platform variance)**

### §6.5.1 — K9 ↔ K14 sequencing contract (v6 RENUMBER: was §6.5.1; NEW v4.2; Round-5 CRITICAL-3 fix)

Both primitives touch post-spawn state-resolution. Without an explicit contract they grow ad-hoc cross-references and violate kernel single-responsibility (§2).

**Sequencing**:
1. **K14 runs FIRST** (immediately after spawn-close, before K9 begins cherrypick).
2. **K14 PASS path**: spawn-state = SCOPE_OK → K9 cherrypicks in-scope delta → K9 writes journal entry on success → spawn-state = PROMOTED.
3. **K14 FAIL pre-K9**: spawn-state = REJECTED with reason `out_of_scope_writes_detected`; K9 does NOT execute; no journal entry; out-of-scope files captured in `spawn-state.violations[]` for audit.
4. **K14 FAIL post-K9** (tail-window detects backgrounded write that completed after K9 ran): spawn-state = REJECTED-POST-PROMOTE; K9.rollback consumes the journal entry to revert; audit log gets BOTH K14 violation record AND K9 rollback record.
5. **K14 FAIL during K9** (event-stream variant only; v3.1+): K9 receives `SIGTERM_EQUIVALENT` (in-process abort signal), atomic-cherrypick rolls back via existing journal mechanism, spawn-state = REJECTED.

**Audit-record ownership**:
- K14 owns the violation record (`spawn-state.violations[]` schema: `{path, kind, transport, detected_at_phase, sha256_pre, sha256_post}`).
- K9 owns the journal record (`spawn-state.journal[]` schema: existing K9 cherrypick + rollback events).
- The audit log is the UNION of both — emitted by whichever primitive ran last.

**Override interaction**: if `LOOM_ALLOW_OUT_OF_SCOPE_WRITES=1`, K14 still RECORDS violations but does NOT cause REJECTED state. K9 proceeds normally. This preserves audit while honoring the escape hatch.

**Effort**: ~1-2h to write the contract section in ADR-0010 + ~50 LoC of state-machine glue in K9 to handle the rollback-from-K14-violation path.

### §6.5.2 — K9 rollback scope clarification (v6 RENUMBER: was §6.5.2; NEW v4.3; per external research brief absorption)

**K9 rollback restores FILESYSTEM state only.** Reverse-cherrypick reverts the cherrypicked delta; it does NOT undo external side effects that the spawned agent performed during its run. Specifically, the following CANNOT be rolled back by K9:
- HTTP POSTs to external APIs (issue creation, deploys, payments)
- `npm install` (modifies global `node_modules` cache outside the worktree)
- AWS S3 / cloud uploads
- Email / Slack / webhook side effects
- `git push` (already-pushed commits are durable on the remote)
- Any Bash subprocess that called `curl`, `aws`, `gh`, etc.

**Implication — the "semantic rollback attack" surface (per ACRFence, arxiv 2603.20625)**: when a spawn is re-executed from a snapshot after K9 rollback, the agent has no memory of the side effects it caused on the prior run and MAY repeat them. The user pays twice; the deploy fires twice; the issue is created twice.

**v3.0-alpha mitigation**: K6 capability subset check (v3.1) is the FIRST line of defense — by default, spawns are denied network-side-effecting tools entirely. v3.0-alpha lacks K6, so v3.0-alpha agents are NOT allowed to perform external side effects at all (enforced via persona contracts + audit). This is an honest scoping decision, not a hole.

**v3.1+ mitigation (OQ-17 CLOSED v5 → R13 ships in v3.1)**: when network-side-effecting tools are enabled via K6, **R13 Idempotency-Key Enforcer** (~150-250 LoC; parallel sub-wave with K6/K8) wraps such calls and requires an explicit idempotency key derived from `spawn_id + tool_use_id`. Closes the ACRFence semantic-rollback-attack surface at the moment K6 opens network tools. See §11 OQ-17 + §6.6 v3.1 scope.

**K9 dedicated security discipline (per user concern #3 + Round-4 architect MEDIUM on fixture taxonomy)**:
- MANDATORY: architect + code-reviewer + security-auditor pair-review (3-actor; already in v3 plan, reaffirmed)
- NEW: dedicated test suite for path-traversal cases (CWE-22) — **5-category fixture taxonomy × 4 instances minimum = 20+ fixtures**: (1) classic `..`/absolute paths, (2) symlink races + TOCTOU, (3) encoded paths (URL-encoded, unicode normalization), (4) control characters + null bytes, (5) path-length / canonicalization edge cases
- NEW: fuzz testing on path inputs as part of unit tests — **Round-3d pin per persona-Tess T5**: `fast-check`-based property tests with ≥1000 random path inputs per case (mixed encoding: ASCII / UTF-8 / Unicode normalization edge cases / control chars / null bytes / path-length boundary / URL-encoded), ≤30s per run; ~+3-5h implementation
- NEW: security-auditor explicit pre-merge approval gate (advisory finding required to be addressed, not just acknowledged)
- NEW: K9 is the only v3.0-alpha primitive that requires dedicated post-merge soak (1 week with `delete_branch_on_merge` watching for any path-related drift)
- NEW: **reverse-cherrypick journal format + recovery algorithm are v3.0-alpha implementation deliverables** (not specified at blueprint level — explicit acknowledgment that "designed mechanism" ≠ "specified mechanism" per Round-4 honesty MEDIUM)
- **K9 semantic-invalidity caveat (added 2026-05-26 per Gemini external review)**: reverse-cherrypick restores *syntactic* state — the same bytes are in the same files after rollback. It does NOT guarantee *semantic* correctness across the codebase. A reverted delta may leave dangling imports, unresolved type references, broken test fixtures, or stale generated artifacts elsewhere in the tree that were updated in subsequent deltas. **Caller contract**: after any K9 rollback, the caller MUST re-run the verification gates (typecheck + lint + tests) before treating the post-rollback state as valid. K9 owns the git operation; semantic validity is a higher-layer (Runtime gate) responsibility. v3.0-alpha test suite must include at least one fixture demonstrating "git revert succeeds + typecheck fails" to make the boundary empirical.
- **K9 TOCTOU-immunity clarification (v6 LOCK Patch G-TOCTOU, per Gemini external review + architect spot-check `aa4d5c9a`)**: K9 cherry-pick reads from `.git/objects/<sha>` (the content-addressed git object database), NOT from the live filesystem at cherry-pick time. The post-snapshot SHA is sealed by `git stash create` during spawn-close (same PostToolUse:Agent phase as K14, before K9 begins). A symlink swap during the K14→K9 window — including a backgrounded write inside `LOOM_K14_TAIL_WINDOW_MS` — CANNOT redirect what K9 applies to the parent branch, because content-addressed storage is immutable by construction once the SHA exists. The residual narrow window (symlink swap concurrent with `git stash create` itself) is bounded by (a) git's symlink semantics — `git stash create` stores symlinks as link-typed blobs and does NOT dereference them to capture target content, and (b) K1 worktree isolation — any symlink the spawned agent creates points at paths the agent already had write capability for. The v3.1+ event-stream K14 variant (per §6.5.K14) closes even this residual window by detecting writes during the snapshot-capture phase. **This is documented as a non-vulnerability so future readers do not retrace the same investigation.** Out-of-scope but worth tracking: P-Snapshot probe should add a symlink-during-snapshot sub-case (~+30 LoC fixture, ~+15min run) to make the symlink-blob discipline empirical.

**Rollback story per primitive (per user concern + Round-3 planner HIGH)**:
- K1 (worktree): LOOM_DISABLE_WORKTREE bypasses
- K2 (spawn-record): no rollback needed; pure additive write
- K3 (parent_state_id): no rollback needed; nullable field
- K4 (recall-CLI): no rollback needed; read-only
- K7 (path-canonicalize): bypass by reverting validator file
- K9 (promote-deltas): **reverse-cherrypick journal** enables rollback of already-promoted deltas; LOOM_DISABLE_PROMOTE env var bypasses
- K10 (escape hatch): is itself the rollback
- K12 (layer-enforcer): bypass via comment marker `// @loom-layer-override: <justification>` (logged; requires post-hoc review)
- K13 (serial enforcer): bypass via `LOOM_ALLOW_CONCURRENT_SPAWNS=1` env var (logged; requires post-hoc review)

**Out of scope (deferred to v3.1+)**:
- K6 capability subset check (needs persona contracts to check)
- K8 capability injection (needs personas to inject into)
- ANY persona contract changes
- ANY decomposition disciplines
- ANY evolution wiring
- Kernel algorithm library beyond K7 (rest deferred to v3.2)

**Effort honest (v4.2 per Round-5 architect HIGH-2 line-item calibration)**: ~40-70h. Was 20-28h in v4, 26-40h in v4.1; v4.2 increases again because K14 is honestly 500-900 LoC (not 200-400), K2.b adds ~80-120 LoC, K9 semantic-invalidity fixtures × 4 add ~1-2h, K9↔K14 contract glue adds ~50 LoC, and pair-review hours (architect + code-reviewer + security-auditor) scale with the K9+K14 scope (~6-10h). This is the THIRD upward revision; v4.2 overshoots deliberately to break the optimism-pattern §0/§12 flagged. Line-item calibration table:

| Primitive | LoC | Hours @ 60 LoC/h |
|---|---|---|
| K1 (worktree + retry + cleanup + session-root) | 150-220 | 3-4 |
| K2 (envelope) + K2.b (settings.json walk) | 480-620 | 8-10 |
| K3 lineage | 15-30 | 0.5 |
| K4 recall-CLI port | 50-100 | 1-2 |
| K7 path canonicalize | 60-120 | 1-2 |
| K9 (cherrypick + journal + CWE-22 + K14 hook + ≥4 semantic-invalidity fixtures) | 650-1,050 | 12-18 |
| K10 escape hatch | 40-60 | 1 |
| K12 layer convention + advisory lint (v5.1 downgrade) | 50-80 | 1-2 |
| K13 serial enforcer | 150-220 | 3-4 |
| K14 (honest spec; see §6.5.K14) | 500-900 | 9-15 |
| ADRs 0008/0009/0010 (pair-reviewed text) | n/a | 6-8 |
| Pair-review cycles (architect + code-reviewer + security-auditor on K9 + K14) | n/a | 6-10 |
| **TOTAL** | **2,245-3,520 LoC** | **53-78h** (round to 40-70h with parallelism savings) |

**Abort trigger (v4.2)**: if v3.0-alpha actual effort exceeds **140h wall-clock (2× the v4.2 upper estimate)**, STOP and re-evaluate scope before pushing through. Symptoms to fire early: K14 fsevents/inotify integration requires native build chain; K9↔K14 contract grows ad-hoc cross-references beyond the §6.5.1 spec; K14 fixture taxonomy expands past 20 cases; K9 path-traversal fixture taxonomy expanding past 30 cases; K12 import-graph check requiring custom AST work beyond a 200-LoC budget; K9 reverse-cherrypick journal algorithm requiring its own spec round. Rationale: the value proposition (Lab adaptive cognition, reputation tracking) doesn't land until v3.3-v3.4 — burning the entire budget on substrate scaffolding is the dominant failure mode. Hitting this trigger is a re-plan signal, not a failure; the spike's job is to expose mis-scoping.

**Acceptance**: Wave -1 PASSED → 10 real spawns through full pure-MVP loop (architect spawning architect with existing Phase 1 contract is acceptable here since K6/K8 are not in scope) → 0 CRITICAL pair-review findings → escape hatch + layer-enforcer + serial-enforcer all empirically verified.

### 6.6 v3.1 — RUNTIME FOUNDATION (v6 RENUMBER: was §6.2 release-scope; ~24-36h, ~2,550-3,150 LoC honest per Round-6 architect; was 18-26h / 2,300-2,700 in v4)

**v4 effort correction**: v3 estimated 800-1,200 LoC / 10-15h. Round-3 planner CRITICAL: 16 contracts × 138 LoC avg = ~2,200 LoC minimum just for content + traits + verifier work = ~2,300-2,700 LoC. v4 adopts honest estimate.

**v5 effort update (per Round-6 architect MUST-ABSORB + DEFER-with-stopgap)**: R13 Idempotency-Key Enforcer (+150-250 LoC / +3-5h) + K2.c per-tool-call observability (+100-200 LoC / +3-5h) → new range 24-36h / 2,550-3,150 LoC. Both ship as parallel sub-waves alongside K6/K8 (zero new dependencies); critical path unchanged.

**In scope**:
- R1 Two-tier persona contracts (interface + defaults)
- R2 16-persona migration in 4 parallel sub-waves
- R3 Capability traits as mixins
- R4 Trait composition rules + contract-verifier extension (~50 LoC + tests)
- K6 Capability subset check (~80 LoC; **moved here from v3.0-alpha per user concern #2**)
- K8 Capability injection at spawn-init (~150-200 LoC; **moved here from v3.0-alpha**; **v4.3 acceptance criterion added: K8 MUST support per-spawn `read_only_paths` mask** so that a Builder spawn can be given read-only access to `tests/**` while having write access to `src/**` — closes the "hallucinating tests" attack surface where Builder games the contract by editing the tests; per external research brief absorption)
- **R13 Idempotency-Key Enforcer (NEW v5 per Round-6 architect MUST-ABSORB; closes OQ-17 in v3.1 not v3.2)**: ~150-250 LoC; wraps any K6-permitted network-side-effecting tool call; requires explicit idempotency key derived from `spawn_id + tool_use_id` (both already in K2 / spawn-record envelope, zero new dependencies); rejects calls without the key. Parallel sub-wave with R3/R4 trait composition (no critical-path delay on K6/K8). Closes the ACRFence semantic-rollback-attack surface (arxiv 2603.20625) at the moment K6 opens network tools. KB anchor: `kb:architecture/crosscut/idempotency` Patterns 1+3.
- **K2.c Per-tool-call observability (NEW v5 per Round-6 architect; field-survey O2 split)**: ~100-200 LoC; extends K2 spawn-record envelope with `tool_calls[]` array populated via PostToolUse hook. Each entry: `{tool_name, tool_use_id, input_sha256, duration_ms, exit_code, output_excerpt_sha256}`. Non-blocking; observability-only; feeds A6 reputation asynchronously. Brings v3.1 to parity with LangSmith/Langwatch/Phoenix on telemetry foundations. Per-tool-call GATING (OAP-style blocking) remains deferred to v3.5+ — this is the cheap observability half, not the gating research problem.
- Architect-gate at Wave kickoff (1h)

**Rollback story for v3.1**:
- Multi-contract revert unit: **per-sub-wave** (4 contracts at a time, not all 16). Each sub-wave is its own merge unit + its own potential revert.
- Trait composition errors at contract-load time (R4) are caught BEFORE merge by contract-verifier; if a trait conflict surfaces post-merge, hot-fix via removing trait reference from one contract (no full revert needed).
- K6/K8 bugs: feature-flag via `LOOM_DISABLE_CAPABILITY_CHECK=1` and `LOOM_DISABLE_CAPABILITY_INJECTION=1` env vars (NEW; add to escape-hatch family).

### 6.7 v3.2 — RUNTIME DECOMPOSITION (v6 RENUMBER: was §6.3 release-scope; ~18-26h, ~1,200-2,200 LoC honest)

**OQ-11 forced to Wave -1 decision (per Round-3 planner HIGH)**: full-validators vs slim-predicates for leaf criteria — this is a 2-3× LoC swing on the single largest v3.2 component. **Cannot defer to v3.2 kickoff; decide at Wave -1 design session.**

**In scope** (assuming OQ-11 = slim predicates absorbed into spawn-verify):
- R6 Pattern A trampoline (uses TodoWrite + folder hierarchy)
- R7 TodoWrite-as-checkpoint contract enforcement
- R8 Decomposition disciplines (tdd/spec-driven/exploratory)
- R9 Leaf criteria (slim predicates ~400 LoC; OR full validators ~800-1,200 LoC if OQ-11 = full)
- R10 Budget envelope + recursion-depth tracking (~150 LoC)
- R11 Spawn-verify dispatcher (~600-750 LoC honest per Round-3 planner; **NOT 400 as v3 claimed**)
- R12 Test-runner adapters (jest/vitest/pytest, ~250 LoC)
- K11 Kernel algorithm library (~400-500 LoC; **A4 becomes binding here**)
- **Schema-freeze gate (NEW per Round-3 planner HIGH)**: R11 spawn-verify must lock `failure_signature` schema in v3.2 for E2 in v3.3 to consume. **ADR-0011 captures the freeze (v4.2 renumber per Round-5 MEDIUM-2; was ADR-0010 in v4.1 — collided with write-scope ADR).**

**Rollback story**: spawn-verify dispatcher routes by discipline; bypass via `LOOM_DISCIPLINE_OVERRIDE=spec-driven` env var (fall back to schema-only verification).

### 6.8 v3.3 — EVOLUTION LAB FOUNDATION (v6 RENUMBER: was §6.4 release-scope; ~14-20h, ~500-750 LoC honest)

**In scope**:
- E1 Negative attestation Class-4 witness (~60 LoC)
- E2 Class-1 derived-policy extraction function (**~180-250 LoC honest per Round-3 planner; NOT 120 as v3 claimed**)
- E3 Policy-axiom store + recall integration via **A6 snapshot mechanism (NOT live read)** + drain CLI (~30-50 LoC drain per Round-3 planner MEDIUM)
- E4 Reputation extension (~80 LoC; extends existing agent-identity.js)

**Rollback story**:
- E3 store can be drained via `loom policy-axiom drain --since <date>` if E2 produces malformed axioms
- E4 reputation: `loom reputation reset --persona <id> --task-type <type>` for false-positive cleanup

### 6.9 v3.4 — EVOLUTION LAB FULL (v6 RENUMBER: was §6.5 release-scope; ~35-55h code + ~96-160h human-authored seed content)

**v4 effort correction**: v3 estimated 30-50h / 360 LoC code. Round-3 planner CRITICAL: ratio is incoherent (5-8h per 60 LoC); E5 attribution graph at 120 LoC alone is laughable. **Honest: 800-1,200 LoC code.**

**In scope**:
- E5 Attribution graph + `scripts/loom-attribution.js` (~250-400 LoC honest)
- E6 Convergence metrics CLI verb (~80 LoC)
- E7 Evolve/forge triggers from reputation + trigger-side circuit-breaker (~150-200 LoC honest)
- E8 Cross-persona test review + out-of-band ground-truth (OQ-12 must close first; ~50 LoC + ground-truth design **ADR-0012; v4.2 renumber per Round-5 MEDIUM-2**)
- E9 TDD-craft KB seed authoring (~5h human work for shallow seed)
- E10 Reference test suites (HONEST: **6-10h × 16 personas = 96-160h human work**)
- E11 Circuit-breaker on denials (~120-180 LoC honest per Round-3 planner; NOT 50)

**Rollback story**:
- E7 evolve/forge triggers: manual-confirm gate prevents auto-fire; if triggered erroneously, no destructive action (just queue + notify)
- E11 circuit-breaker: `LOOM_DISABLE_CIRCUIT_BREAKER=1` env var bypasses

### 6.10 Deferred (v3.5+ / Phase 4) (v6 RENUMBER: was §6.6)

- E12 Pattern B multi-spawn trampoline
- E13 Dream-Lite cycles
- Hash-chained tamper-evidence (ADR for threat model)
- Liveness daemon
- Per-tool-call GATING (OAP-style blocking) — v5 split: per-tool-call OBSERVABILITY ships in v3.1 as K2.c; per-tool-call GATING remains v3.5+ research question
- Declarative workflow YAML
- Convergence dashboard
- Anthropic Dreams API integration
- **ContainerAdapter (NEW v5 framing per Round-6 architect C1/M3)**: pluggable isolation boundary replacing/complementing K1's worktree allocation. Implements the same K1+K14 contract via Docker / Firecracker / E2B / hosted-runtime. v3.5+ deliverable. Industry consensus (OpenHands V1 DockerWorkspace, E2B 15M sessions/mo, Devin cloud VMs, SWE-bench Docker-pinned). v3.0-alpha through v3.4 ship the Anthropic-native plugin-distribution path (worktree + K14 detection); v3.5+ ContainerAdapter ships the hosted-runtime path. **They are complementary, not competing**: K14's audit-record value persists even when containers enforce the boundary — containers replace K14's *enforcement* role, K14 still owns the audit-record producer role.
- **Blocking-grade prompt-injection / trust-boundary defense (NEW v5 per Round-6 M1; v3.5+) — Pillar 2 EXTENSION (inputs-as-Byzantine)**: v5.1 framing — this is NOT a new pillar; it is the principled extension of Pillar 2 (Byzantine treatment of LLM) from LLM OUTPUTS to LLM-MEDIATED INPUTS. v4.3's A3a/A3b axioms already treat LLM outputs as Byzantine (verified against external ground truth via pure gates); M1 extends the same treatment to LLM-mediated inputs reaching the orchestrator (WebFetch results, retrieved docs, MCP tool returns, user-pasted snippets). Same pillar; same epistemic frame; new boundary. Design choices: (a) dual-LLM gateway, (b) content-source tagging + K6 capability-attestation (untrusted content in context ⇒ K6 denies side-effecting tools), (c) deterministic content-classifier. **v3.1+ stopgap**: persona contracts that consume external content declare `consumes_untrusted_input: true`; K6 narrows their network-side-effecting capability set automatically. v3.0-alpha through v3.4 ship A3b-advisory LLM-mediated detection only (non-blocking, audit-logged). v3.5+ promotes to blocking-grade.
- **Kernel-layer network egress policy (NEW v5 per Round-6 M2; v3.5+) — Pillar 1 + Pillar 3 EXTENSION (rollback-completeness)**: v5.1 framing — without kernel-layer network egress control, K9 rollback's claim ("filesystem delta is the transaction unit") is dishonest. Network calls cannot be rolled back by K9 or any snapshot mechanism (Pillar 1 violation: out-of-scope side effects); they also leave no trace in the spawn-record envelope (Pillar 3 violation: replay-from-record produces different external state on re-execution). Preventing network calls at the kernel makes rollback-completeness a property of the substrate, not a hope. Implementation: iptables / netns / eBPF / Docker network policy — requires ContainerAdapter (see above), so kernel-layer egress lands as a ContainerAdapter responsibility in v3.5+, not a standalone kernel primitive. **v3.0-alpha through v3.1 stopgap**: K6 denies network-side-effecting tools by default at the persona contract layer; Bash can still curl, that residual gap closes in v3.5 via ContainerAdapter. R13 idempotency (v3.1) partially mitigates by making repeated side effects safe even when they occur.

### 6.11 Release-Cycle Effort Summary (v6 RENUMBER: was §6.7; Round-3 planner-calibrated; HONEST)

| Release | LoC (honest) | Hours (honest) | Pair-Review |
|---|---|---|---|
| Wave -1 | ~140 | 6-9 | architect (sniff) |
| v3.0-alpha | ~2,225-3,550 (v5.1: K12 downgrade -100-120 LoC) | 41-71 (abort 140) | architect + code-reviewer + security-auditor (×2 on K9+K14) |
| v3.1 | ~2,550-3,150 (v5: +R13 +K2.c) | 24-36 | architect (kickoff) + code-reviewer per-sub-wave |
| v3.2 | ~1,200-1,600 (OQ-11 closed: slim predicates) | 16-22 | architect + code-reviewer + honesty-auditor |
| v3.3 | ~500-750 | 14-20 | architect + code-reviewer + honesty-auditor |
| v3.4 | ~800-1,200 code + 96-160h human | 35-55 + human | architect + honesty-auditor (ground-truth ADR) |
| Release-cycle overhead | — | +30-45 (separately tracked) | 5 × per-release CHANGELOG/smoke/tag/cross-release-validation |
| **TOTAL through v3.4** | **~5,840-8,290 LoC + ~96-160h human** | **141-209h + human work** | 6 layered checkpoints |

**Honest comparison to prior versions** (no "obsolete framing" obfuscation):
- Original execution plan (2026-05-24): ~30h, no explicit LoC
- v1 synthesis: ~1,680 LoC / 36-47h (Round-1: 2-3× optimistic)
- v2 synthesis: ~4,500-5,400 LoC / 58-79h (Round-1 calibrated; single monster release)
- v3 synthesis: ~3,400-5,000 LoC / 85-129h (5 micro-releases; **65-95% optimistic per Round-3 planner**)
- v4 synthesis: ~5,840-8,290 LoC / 141-209h (Round-3 calibrated; 5 micro-releases)
- v4.2 synthesis: ~7,185-9,310 LoC / 161-228h (Round-5 architect-calibrated; v3.0-alpha bumped to 40-70h with K14 honest sizing + K2.b + K9 fixtures × 4; OQ-11 closed to slim predicates tightening v3.2 to 1,200-1,600 LoC)
- v5 synthesis: ~7,515-9,890 LoC / 169-237h (Round-6 architect; field-survey absorbed; v3.0-alpha +K3.b; v3.1 +R13 +K2.c; OQ-17 closed to v3.1; OQ-18 P-Snapshot probe added)
- v5.1 synthesis: ~7,415-9,770 LoC / 167-235h (Round-7 architect; vision-pillar alignment; K12 downgraded -100-120 LoC / -2h; OQ-19 upgrade-trigger added)
- **v5.2 synthesis: same LoC / hours as v5.1** (text-only amendment; §0a Four Vision Pillars map + M1/M2 reframing as pillar-extensions). Net effect: structural alignment test added; future amendments must pass "which pillar?" check.
- **v5.3 synthesis: same LoC / hours as v5.2** (§0 audience-specific framings + §0c Organizational Engineering Analogy + §6.13 Operational Invariants 15 executable property contracts — additive normative discipline, no v3.x release-scope code change).
- **v5.4 synthesis: same LoC / hours as v5.3** (Category-A positioning corrections — Power Loom-in-Work-Bench Execute+Constrain pillars; SWE-EVO honest value-claim; DeltaBox/Hermes prior-art acknowledgment; Category-B field-survey debt indexed to a backlog file outside v3.x scope).
- **v6 synthesis (LIVE-DRAFTING 2026-05-27)**: HD-3 honest framing **strengthened post-Gemini-3.1-Pro review**. v3.0-alpha and v3.3 row totals are CLAIMED to absorb v6 additions inside existing slack, but explicit math (per Gemini 3.1 Pro §2 honesty audit) tells a more complicated story:
  - **K2 reservation PR explicit math**: Memory Root Pointer reader (130-205 LoC) + transaction-record-shape schema-additive K2 envelope fields (~50-80 LoC) = ~180-285 LoC total. **But K2.b settings.json resolution (~80-120 LoC per existing v3.0-alpha §6.5 line item) is a separate concern shipping in the same K2 reservation PR**. 130 + 80 = 210 LoC — fits in the upper bound (285) but BLOWS PAST the lower bound (180). **Honest framing**: K2.b should either ship in a sibling PR OR the K2 reservation PR's headline range becomes 260-405 LoC, NOT 180-285. Either way, v3.0-alpha's row TOTAL (~2,225-3,550 LoC / ~41-71h) likely has the slack to absorb, but the K2-reservation-PR scope claim was understated.
  - **E14 framing correction**: E14 at 350-510 LoC is **47-102% of the entire existing v3.3 budget bound (500-750 LoC)**. Framing E14 as "fits inside the existing envelope" is spin; the honest framing is "E14 consumes ~70% of the remaining v3.3 budget at midpoint". E1-E4 line items in v3.3 (~350-460 LoC per §6.8 itemization) plus E14 (350-510) = ~700-970 LoC, which EXCEEDS the v3.3 envelope upper bound (750). v3.3 row WILL need expansion at v3.3 LOCK; the "absorbed" framing is forward-looking, not arithmetic.
  - **Net v6 structural delta**: +3 axioms, +14 invariants (per Gemini 3.1 Pro GP1 addition of INV-28), +1 §5a section, +1 E14 Lab spec, +2 ADRs (0013/0014), +3 §10b reject-entries (endorsement-primitive + active_state_hash + SQLite-as-canonical-ledger per Round-3c), +8 OQ entries (OQ-20..27 per LOCK reviews + Round-3c cross-reviewer convergence), **+2 v3.0-alpha scope additions (Round-3d per 5-persona pair-review): `pre-spawn-tool-mask.js` hook (~30-50 LoC / +1h) closing the network-prohibition enforcement gap + property-test harness infra (~+500-1000 LoC / +10-15h) covering fixture-build budget for 20 v3.0-alpha-activated invariants**. **Zero new K-primitives** (Kernel total stays at 14; K15/K16 were phantom claims in early drafts, removed per LOCK-review HD-1 fix).
  - **Round-3d v3.0-alpha budget impact (per 5-persona pair-review C2+C3)**: the Round-3d additions inflate v3.0-alpha by ~+11-16h relative to the §6.5 effort table's existing 41-71h envelope. New honest range: ~52-87h (still inside the 140h abort trigger). Implementation may choose to time-box P-Snapshot probe (per Round-3d OQ-25 update) to recover slack OR accept the inflation as the honest cost of v3.0-alpha LOCK-quality network-prohibition enforcement + property-test coverage.

**Honest trade-off statement**: v4 is +63-130h more total time than v2 in exchange for per-release blast radius reduction, per-release rollback, layer-enforcement, serial-only enforcement, and v3.4 deferral discipline. This is a real trade with real costs and real benefits — not a regression. v6 layers additional discipline (consistency model, evidence-link admission, derived-view anti-amplification) on top of v4's structural scaffolding — at zero net code cost claimed, with the table-update honesty caveat above.

### 6.12 Release Dependency Graph (v6 RENUMBER: was §6.8)

```
Wave -1 (entry gate; 5+ probes; OQ-11 decision)
   ↓ [empirical PASS]
v3.0-alpha (PURE KERNEL TRANSACTION LOOP; K12/K13 mandatory)
   ↓
v3.1 (RUNTIME FOUNDATION; K6/K8 land; 16-persona migration)
   ↓
v3.2 (RUNTIME DECOMPOSITION; A4 binding; schema-freeze gate ADR-0011)
   ↓
v3.3 (EVOLUTION LAB FOUNDATION; E2 consumes frozen schema)
   ↓
v3.4 (EVOLUTION LAB FULL; convergence; evolve/forge)
   ↓ [explicit decision gate]
Phase 4 (deferred; only if triggers fire)
```

---

### 6.13 Operational Invariants — Executable Property Contracts (v6 RENUMBER: was §6.13; NEW v5.3; v6 expansion adds INV-16..27 + INV-A9-RecoverySweepIdempotent)

This section converts the substrate's implicit guarantees into **testable property contracts**. Each invariant has (a) a primitive owner, (b) an activation release (cannot fire before its primitive lands), (c) a property-test sketch, and (d) field-standard terminology notes where relevant. **All 15 invariants pass the §0a pillar-grounding test** — every invariant maps to at least one of the Four Vision Pillars.

**Naming convention**: `INV-{primitive}-{Property}`. Per-primitive (not per-layer) naming makes invariants grep-able from any primitive's code and prevents the per-layer scheme from hiding which primitive owns each test.

**Discipline**: an invariant whose primitive does not ship until release vN is NOT testable before vN — it is aspirational until activation. Each invariant below names its activation release explicitly.

### v3.0-alpha activations (20 invariants — testable from first kernel release; v6 expansion: +10 from consistency model + memory-root-pointer + recovery-sweep)

| # | Name | Owner | Property test sketch | Pillar |
|---|---|---|---|---|
| 1 | **INV-K9-RejectFidelity** | K9 | For any spawn whose K9-pre gate returns FAIL, post-spawn host worktree state equals pre-spawn state byte-for-byte. | P1 |
| 2 | **INV-Replay-K5K7K9Equivalence** | K2 envelope + K5/K7/K9 | Replay of a recorded spawn envelope under the same `axioms.evolution_snapshot` reproduces the same K9 PASS/FAIL verdict AND the same K5/K7 validator outcomes. *Relaxation note*: this is weaker than Temporal-style command-trace determinism — we relax to **outcome-determinism** (same policy-relevant decisions, not necessarily same command sequence). Document the relaxation; do not let readers assume Temporal-strength equivalence. | P3 |
| 3 | **INV-A3a-A3b-Separation** | A3a / A3b boundary | Advisory findings (A3b / R-primitive output) cannot affect K5/K7/K9 PASS/FAIL outcomes. Property test: synthesize arbitrary `advisory_findings[]` entries into spawn-state; assert K9 promotion decision is unchanged. *Closest mainstream analogue*: GitHub "required vs optional status checks" — no formal term-of-art in the field. | P2 |
| 4 | **INV-K9-SyntacticAtomicity** | K9 | K9 promote-deltas are atomic at the git-state level. Property test: inject K9-mid-cherrypick abort signal; assert filesystem state ∈ {pre-K9, post-K9}, never partial-cherrypick. **Caveat per §6.5.2**: syntactic atomicity does NOT imply semantic validity; caller must re-run verification gates post-rollback. *Field references*: ACID atomicity (Haerder & Reuter 1983); long-running compensable variant = saga pattern + compensating transactions (Garcia-Molina & Salem 1987). | P1 |
| 5 | **INV-K2-SchemaForwardCompat** | K2 | K2-v2 envelopes can be parsed by K2-v3 readers without data loss. Property test: emit K2-v2 envelope → parse with forward-compat tolerant reader (per Round-3 architect HIGH) → assert all v2 fields round-trip. | P3 |
| 6 | **INV-K2-SpawnRecordSchemaValid** | K2 | Every spawn-record emitted by the K2 hook validates against the v2 JSON schema. Property test: random-spawn fuzz × N; assert every emitted envelope passes schema validation; assert envelopes that fail validation never reach K9 promotion. | P3 |
| 7 | **INV-K3-LineageAcyclicity** | K3 | The `parent_state_id` graph is a DAG (acyclic). Property test: from any spawn-record, walking `parent_state_id` links terminates at a root in ≤ depth bound; no node revisited. Under serial-only K13, cycles cannot form by construction — but the test still catches future bugs. Per `kb:architecture/crosscut/acyclic-dependencies`. | P1, P3 |
| 8 | **INV-K14-PostDetectionEnforcement** | K14 | If K14 detects an out-of-scope write and `spawn-state.status` is set to REJECTED, no subsequent K9 promotion executes. Property test: synthesize a K14 violation record; assert K9 path is not entered. Codifies §6.5.1's K9↔K14 sequencing contract as a testable assertion. | P1 |
| 9 | **INV-P-DepthOne** | (Anthropic platform contract) | A depth-2 spawn attempt either (a) emits no Agent/Task tool in the spawned context, OR (b) emits a hook-blocked Agent tool call. *Note*: we do NOT enforce this — Anthropic does (validated by Wave -1 P-DepthOne probe). The invariant tests that **our assumption holds**, so if Anthropic ever changes this, we notice. | P1, P3 |
| 10 | **INV-K13-SerialOnly** | K13 | At any moment t, at most one spawn is in the `spawn-active` state. Property test: attempt concurrent spawn; assert second spawn is rejected or queued, never both active. This IS the "physical embodiment" substrate-supplied equivalent (see §0c). | P1, P3 |
| 19 | **INV-19-WALAppendOnly** | WAL substrate (§5.1) | The WAL file at `manifests.attestation_wal` is append-only. Property test: after N transactions, the WAL has exactly N lines; mtime of any historical line equals its original write time (no in-place mutation). Synthesize: write 10 records → snapshot byte-length and per-line mtime → perform 5 more transactions → assert first-10-lines byte-prefix unchanged AND mtime sentinel preserved. *Field reference*: append-only log discipline (Kreps "The Log" 2013). | P3 |
| 20 | **INV-20-TwoPhaseCommitClosure** | A9 / K9+K14 | Every PENDING intent-record in the WAL has either (a) a subsequent commit-record with `references_transaction_id` matching it, OR (b) the WAL ends and recovery sweep will reclassify it on next startup. No PENDING record may be permanently orphan-in-the-middle-of-the-WAL. Property test: synthesize a WAL with K PENDING + K commit-records + 1 orphan PENDING in the middle (followed by COMMITTED records); run sweep; assert orphan PENDING gets a sweep-emitted ABORTED commit-record. *Field reference*: ACID atomicity (Haerder & Reuter 1983); two-phase commit (Gray 1978). | P3 |
| 21 | **INV-21-EvidenceLinkPreCommit** | A10 / K9 pre-commit | K9 pre-commit rejects any state-changing transaction (operation_class ∈ {CREATE, APPEND, SUPERSEDE, TOMBSTONE}) whose `evidence_refs` is empty OR points to records not present in the chain at `prev_state_hash`. Property test: emit transaction with empty `evidence_refs`; assert K9 rejects pre-commit. Emit transaction with `evidence_refs` pointing to a record in a DIFFERENT chain (different `(schema_version, scope)`); assert K9 rejects pre-commit. Emit transaction with valid `evidence_refs`; assert K9 accepts. | P3 |
| 22 | **INV-22-IdempotencyKeyUniqueness** | §4.2 idempotency_key derivation + §5a.6 | Replaying a transaction with an existing `idempotency_key` is a no-op (returns existing `transaction_id`, no new WAL record). Property test: emit transaction T1 → record T1.transaction_id → replay T1 verbatim; assert second emit returns T1.transaction_id and WAL line-count unchanged. Distinct from INV-R13-IdempotencyKeyUniqueness (R13's v3.1 narrower scope: external-side-effecting tool calls); INV-22 covers ALL transactions including in-substrate ones. | P3 |
| 23 | **INV-23-MVCCSnapshotPinned** | §5a.4 spawn-boundary MVCC | At spawn-init, the spawn's `prev_state_hash` is pinned in `axioms.evolution_snapshot`; all chain reads during the spawn's lifetime resolve against the pinned hash, not the live WAL tail. Property test: spawn S1 at t=0 with pinned hash H0; commit transaction T2 at t=1 advancing chain to H1; query chain from S1's context at t=2; assert result reflects H0 view (not H1). Under K13 serial-only this is degenerate (only one spawn at a time); the test still pins the contract for forward-compat to K13-relax in v3.5+. | P3 |
| 24 | **INV-24-NoBareUpdate** | §5a.1 CRUD taxonomy | No emitted transaction record has `operation_class = UPDATE` (the value is not in the enum). All updates flow through SUPERSEDE-as-sibling-write. Property test: enumerate all WAL records; assert `operation_class ∈ {CREATE, APPEND, SUPERSEDE, TOMBSTONE, DERIVED-VIEW-INVALIDATE}`; assert SUPERSEDE records reference a predecessor via `affected_records` AND emit a `superseded_by` pointer on the predecessor (computed at chain-walk time, not stored). | P3 |
| 25 | **INV-25-SchemaMigrationIsTransaction** | §5a.8 (uniform two-phase; v6 LOCK Patch GP2 removed prior exception) | All substrate schema migrations (including `memory-root.json`'s own schema migration) emit a regular A9 two-phase commit transaction with `operation_class = SUPERSEDE` and `affected_records = [<schema-record-id>]`. For pointer migrations specifically, phase 1 intent lands in the OLD pointer's WAL; phase 2 commit lands in the NEW pointer's WAL (cross-WAL placement per the DB catalog-migration pattern at §5a.8). Property test (general case): force a substrate schema_version bump; assert WAL contains intent-record + commit-record pair with `operation_class=SUPERSEDE, affected_records=[<schema-record-id>]`. Property test (pointer migration crash recovery): simulate process kill between atomic rename and phase-2 commit emission; assert recovery sweep probes on-disk pointer content-hash, identifies which side of the rename was reached, and emits the appropriate COMMITTED or ABORTED commit-record to close the orphan PENDING. | P3 |
| 26 | **INV-26-MRAtomicWrite** | §5a.9 Memory Root Pointer + §5a.2 atomic-write primitive | Updates to `memory-root.json` use tmp+fsync+rename atomic write pattern (reuses K1/K9 atomic-write primitive). Property test: simulate kernel-crash between tmp-write and atomic-rename; assert the old `memory-root.json` is still present and parseable (not truncated). Simulate crash between atomic-rename and `memory_root_schema_migrated` WAL emission; assert the new pointer is present AND substrate startup re-emits the missing attestation (or treats absence as "migration completed pre-crash" — both are recoverable). | P3 |
| 27 | **INV-27-PersonaIndexCanonicalOnly** | §5a.9 (Patch 3 index scope) | `persona_memory_index` indexes ONLY kernel-canonical records (K2/K3/K9 chain entries, R13 advisory-findings, A6 snapshots). Derived views are NEVER indexed there. Property test: enumerate all entries in `persona_memory_index`; assert every entry's `record_type` ∈ `{K2-spawn-record, K3-lineage, K9-promotion, R13-finding, A6-snapshot}`; assert NO entry has `record_type` ∈ `{endorsement-view, reputation-aggregate, persona-summary, …}` (derived-view types). Composes with A10 — derived views cannot be selected as `evidence_refs` via the index. | P3 |
| A9 | **INV-A9-RecoverySweepIdempotent** | A9 recovery sweep (§5.3) | Walking the WAL twice during recovery produces identical state. Invoke `recoverySweep(WAL_path)` at T1 → completes → invoke again at T2 > T1 with NO intervening writes to the WAL → assert second invocation emits zero new ABORTED records. Run sweep a third time; assert zero again. *Round-2 disclosure*: codified per sub-tension 3 resolution; not in the original Artifact 3 invariant list. Brings v6 total from 27 to 28. | P3 |
| 28 | **INV-28-K13K14SerialClosure** | K13 + K14 interlock (§5.4 K13×K14 tail-window interlock; v6 LOCK Patch GP1 per Gemini 3.1 Pro external review) | K13 MUST NOT unblock next-spawn dispatch until prior spawn's K14 tail window has closed (`now() ≥ prior_spawn.committed_at + LOOM_K14_TAIL_WINDOW_MS`). Property test: spawn S1 commits at t=0; attempt to spawn S2 at t=1000ms (within tail window); assert K13 rejects/queues with reason `tail-window-pending`. Spawn S3 at t=4000ms (past tail window); assert K13 admits. Tail-window cost: 3s/spawn throughput floor in v3.0-alpha; relaxable when v3.1+ event-stream K14 ships. Without this interlock, K14 tail-window observations would be unattributable across spawn boundaries, defeating A8/A9 audit-trail property. Brings v6 total from 28 to 29. | P1, P3 |

### v3.1+ activations (2 invariants — require K6/K8/R13 to ship)

| # | Name | Owner | Property test sketch | Pillar |
|---|---|---|---|---|
| 11 | **INV-K6-CapabilityMonotonic** | K6/K8 | Capability scope is monotonically non-widening across the spawn DAG: `capability_set(child) ⊆ capability_set(parent)`. *Terminology note*: "capability monotonic" is our term-of-art; field-canonical phrasing is **"monotonic attenuation of authority"** or **"no-amplification property"** (POLA / KeyKOS / EROS). Define on first use; cite POLA. | P2, P4 |
| 12 | **INV-R13-IdempotencyKeyUniqueness** | R13 | Idempotency keys derived from `(spawn_id, tool_use_id)` are unique across all network-side-effecting tool calls. Property test: enumerate all `tool_calls[]` entries with network side effects; assert no two share a key. Per `kb:architecture/crosscut/idempotency` Pattern 1 (Dedupe via Request ID). Closes the ACRFence semantic-rollback-attack surface concretely. | P2 |

### v3.2+ activations (1 invariant — requires R10 budget envelope)

| # | Name | Owner | Property test sketch | Pillar |
|---|---|---|---|---|
| 13 | **INV-R10-BudgetMonotonic** | R10 | Budget envelope cannot expand downstream: `sum(child_budgets) ≤ parent_budget` at every spawn boundary. Property test: instrument R10 budget-pass; assert no spawn boundary widens the budget. | P4 |

### v3.3+ activations (5 invariants — require Evolution Lab; INV-16/17/18 added v6 per E14 §6.4)

| # | Name | Owner | Property test sketch | Pillar |
|---|---|---|---|---|
| 14 | **INV-A6-SnapshotImmutability** | A6 + E4 | Reputation updates are asynchronous-only. A spawn's reputation snapshot at envelope-emit time is identical to what it sees throughout its execution. Property test: emit envelope at t=0 capturing reputation snapshot R0; mutate reputation store at t=1; assert spawn at t=2 still reads R0. | P3 |
| 15 | **INV-A6-PolicyVersionedReplay** | A6 + E3 | Derived policy cannot retroactively affect replay. Property test: replay an old spawn envelope under a newer policy version; assert it produces the same K9 verdict as the original. *Field analogue*: Nix derivations / Bazel hermetic builds — **input-addressed reproducibility**. **Schema implication for v3.0-alpha**: K2 envelope MUST include a `policy_version` field starting v3.0-alpha (~5 LoC schema-additive) to enable this invariant when E3 lands. Adding now is cheap; failing to add forces a K2-v2→v3 envelope-schema break in v3.3. **Recommended pre-Phase-0 update to §6.5 v3.0-alpha K2 spec**. | P3 |
| 16 | **INV-16-EndorsementViewDeterministic** | E14 (§6.4) | The endorsement view is a pure function: same `(k2Records, r13Findings, a6Snapshot, k3Lineage, filter)` inputs always produce byte-equal output (modulo the `derived_at` timestamp). Property test: call `deriveEndorsements(I)` → record output O1; call again with identical I → assert canonical-JSON-byte-equal to O1 modulo `derived_at`. Determinism is the load-bearing property that makes the view safely cacheable (§5a.7). | P3 |
| 17 | **INV-17-EvidenceLinkRequired** | E14 (§6.4) | Every derived endorsement output carries ≥1 `evidence_ref` pointing to a kernel-emitted record present in the input set. Property test: enumerate all outputs; assert `endorsement.evidence_refs.length ≥ 1`; for each ref, assert it resolves to a record in the input K2/R13/A6/K3 sets. Composes with A10 — the view's evidence-link is structurally a subset of A10's syntactic guarantee. | P3 |
| 18 | **INV-18-NoSelfEndorsement** | E14 (§6.4) | `endorser_persona_id != endorsed_persona_id` is enforced at query-time, not at record-write-time. Property test: synthesize K2 records where `spawn.persona_id == lookupParent(k3, spawn.parent_state_id).persona_id` (self-parented spawn); assert `deriveEndorsements` filters these out (zero endorsements emitted). Codifies the C0 reason-#5 security cost asymmetry — the primitive option would have needed an explicit write-time check; the derived-view forecloses it by construction at the projection. | P2 |

### Cross-reference: invariants vs Four Vision Pillars (§0a)

| Pillar | Invariants serving it (executable form) |
|---|---|
| Pillar 1 — Filesystem-Delta-as-Truth | INV-K9-RejectFidelity, INV-K9-SyntacticAtomicity, INV-K14-PostDetectionEnforcement, INV-K3-LineageAcyclicity, INV-P-DepthOne, INV-K13-SerialOnly |
| Pillar 2 — Byzantine Treatment of LLM | INV-A3a-A3b-Separation, INV-K6-CapabilityMonotonic, INV-R13-IdempotencyKeyUniqueness, INV-18-NoSelfEndorsement |
| Pillar 3 — Deterministic / Auditable Execution | INV-Replay-K5K7K9Equivalence, INV-K2-SchemaForwardCompat, INV-K2-SpawnRecordSchemaValid, INV-K3-LineageAcyclicity (dual), INV-P-DepthOne (dual), INV-K13-SerialOnly (dual), INV-A6-SnapshotImmutability, INV-A6-PolicyVersionedReplay, INV-19-WALAppendOnly, INV-20-TwoPhaseCommitClosure, INV-21-EvidenceLinkPreCommit, INV-22-IdempotencyKeyUniqueness, INV-23-MVCCSnapshotPinned, INV-24-NoBareUpdate, INV-25-SchemaMigrationIsTransaction, INV-26-MRAtomicWrite, INV-27-PersonaIndexCanonicalOnly, INV-A9-RecoverySweepIdempotent, INV-16-EndorsementViewDeterministic, INV-17-EvidenceLinkRequired |
| Pillar 4 — TDD / Role-Separation | INV-K6-CapabilityMonotonic (dual), INV-R10-BudgetMonotonic |

All four pillars get executable coverage. **§6.13 passes the §0a pillar-grounding test** — no invariant is a principle-tier mechanism dressed up as a pillar contract.

### Explicitly OUT of §6.13 (deferred or rejected)

The following were considered as invariants and deliberately excluded — recorded here so future amendments don't propose them again without context:

- **Per-tool-call gating invariants** — gating is v3.5+ per §6.10; v3.1 ships K2.c observability only, not gating. Don't propose invariants for unimplemented mechanisms.
- **Container-isolation invariants** — ContainerAdapter is v3.5+ per §10c. K14's audit-record property is what we test in v3.0-alpha; container-enforcement properties belong to the adapter.
- **Hash-chained tamper-evidence invariants** — OQ-3 threat model decision pending.
- **Cross-spawn convergence invariants** (ConvergenceRate stability) — v3.4+ Lab work; per §7 "treated as a signal, not a load-bearing exit criterion." Goodhart-prone.
- **Liveness invariants** (spawn completes within wall-clock T) — Phase 4 deferral per OQ-6. Adding here would be aspirational.
- **"Reputation drift bounded"** — requires ground-truth signal which OQ-12 explicitly says is unsolved. Cannot test what we cannot ground.

### Implementation guidance for v3.0-alpha builders

- The 10 v3.0-alpha invariants become **property-test targets** in v3.0-alpha implementation work. Suggested location: `packages/kernel/_lib/invariants/` test suite (Phase 0 workspace restructure places `_lib/` at the kernel acyclic-by-construction root per §10b K12 rationale).
- INV-A6-PolicyVersionedReplay's schema implication (add `policy_version` to K2 envelope in v3.0-alpha) is the only invariant that forces a v3.0-alpha primitive update. Recommend folding into K2 implementation work — schema-additive, ~5 LoC, prevents v3.3 envelope-schema break.
- Each invariant's property test should pin to its `INV-{Primitive}-{Property}` name in the test description for grep-ability.

---

## 7. Convergence / Success Criteria (per-release)

| Release | Exit criterion | Rollback story |
|---|---|---|
| Wave -1 | All 7 probes empirical PASS on disk; OQ-11 decision made | N/A (read-only probes) |
| v3.0-alpha | 10 real spawns through pure transaction loop; K12 advisory lint emits structured findings on synthetic cross-layer imports in tests (does NOT block per v5.1 downgrade; "rejection" wording corrected v6 LOCK per GPT-2.C); K13 serial-enforcer rejects concurrent spawn in tests; K9 security review passes with 0 CRITICAL CWE-22 findings | Per-primitive escape hatches documented; reverse-cherrypick journal verified |
| v3.1 | 16 personas migrated; K6+K8 functional; capability-spec validator passes | Per-sub-wave revert; trait conflict hot-fix path |
| v3.2 | Pattern A trampoline completes 3-leaf task within budget; 5 failing fixtures rejected by spawn-verify; A4 binding (algorithm library shipped) | `LOOM_DISCIPLINE_OVERRIDE` fallback |
| v3.3 | 5 failing fixtures produce structured negative-attestation; policy-axiom store recallable via A6 snapshot | `loom policy-axiom drain`; `loom reputation reset` |
| v3.4 | `loom convergence` returns stratified pass-rate; reputation triggers fire at threshold | Manual-confirm gate on triggers; circuit-breaker bypass |

**Convergence metric (v3.4+)**:
```
ConvergenceRate(t) = first_attempt_pass_rate(t) / first_attempt_pass_rate(rolling_prior_window)
```
Stratified by task-type. **Target value not specified** (Round-1 honesty: no prior-art anchor). To be calibrated against v3.2 baseline; treated as a *signal*, not a *load-bearing exit criterion*.

**Out-of-band ground-truth signal** required for v3.4 to mitigate ConvergenceRate's recursive Goodhart drift. OQ-12 must close before E8 ships.

---

## 8. Phase 2 Capacity Envelope (serial-only, ACTIVELY ENFORCED per user concern #4)

**Phase 2 (v3.0-alpha through v3.4) is SERIAL-ONLY by kernel enforcement (K13).** Not just policy documentation — kernel actively rejects or queues concurrent spawns.

**Concurrent-spawn capacity envelope** is deferred to v3.5+/Phase 4 when explicit need surfaces and the parent_state_id chain grows from ~15 LoC to ~80-120 LoC (file locking + atomic-CAS + cycle detection).

---

## 9. OOP Patterns Formalized

(Same as v3; see for detail. Layer assignments preserved.)

---

## 10. External Landscape Comparison

(Same as v3; source-confidence labels preserved per Round-1 honesty audit. **GPT-validated framing demoted to ☆ per Round-3 honesty CRITICAL.**)

| System ★/☆/✦ | They have we lack |
|---|---|
| Bernstein ★ | Hash-chained tamper-evidence; signed agent identity |
| Gas Town ★ | Active liveness daemon; durable cross-session work queue |
| Conductor ★ | Declarative YAML workflow as versioned artifact |
| OAP ☆ | Per-tool-call gate; arxiv-claimed adversarial-testbed delta (NOT directly fetched) |
| det-acp ☆ | Circuit-breaker on denial-rate (✓ adopted as E11) |
| Rookdaemon ★ | Identity-continuity-across-substrate-swap framing |
| Wascha ✦ | All specifics UNVERIFIED |
| **External GPT analysis ☆** | Three-layer formalization + MVP staging (BOTH ABSORBED; LLM source not ★) |

### 10a. Verified academic prior-art (NEW v4.3 per external research brief absorption)

The following papers were citation-verified and confirm independent convergence with v4.2's design. **None of these are load-bearing for our architecture** — they're cited as supporting literature showing the substrate tracks published patterns.

| Paper ★ | arxiv / venue | Convergence with v4.2 |
|---|---|---|
| Tian et al., "A WBFT Consensus Driven Trusted Multiple LLM Network" (2025) | arxiv 2505.05103 | Reputation-weighted voting on LLM outputs ≈ our A6 + E4. Independent convergence. |
| **ACRFence**: Preventing Semantic Rollback Attacks (2026) | arxiv 2603.20625 | Directly addresses the semantic-rollback-attack surface we now flag in §6.5.2 + OQ-17. **Recommended reading before implementing R13.** |
| Wu et al., "StateFlow" (COLM 2024) | arxiv 2403.11322 | Process-grounding via state machines ≈ our v3.0-alpha linear kernel loop. Independent convergence. |

**NOT cited** (problems discovered during verification):
- "CP-WBFT" (arxiv via AAAI 2026 — Zheng et al., "Rethinking Reliability of MAS") — the paper exists, but the popularly-quoted ">85% fault rate" figure is a misquote of the paper's specific tested condition (85.7% as a single data point). The actual fault-tolerance bound is not "agents can survive 85% Byzantine faults" — that would violate classical BFT theory (f < n/3). Do not cite as load-bearing.
- "PseudoAct" (arxiv 2602.23668) — the paper exists, but it's a pseudocode-synthesis planning framework, NOT a cyclic-DAG-with-tool-scoping framework as commonly miscited. Do not cite for the latter property.

**Caveat preserved**: independent convergence with published academic work is positive signal but does NOT validate v4.2's correctness. Wave -1 empirical probes (NOT literature alignment) are what give v4.2 its empirical grounding.

### 10a.1 Direct prior art on the K9-style pattern (NEW v5.4 — Category A field-survey absorption)

Two artifacts implement the **effect-containment-with-atomic-promotion** pattern that K9 implements. v5.3 treated §10a as complete; this is corrects that oversight. Honest acknowledgement of these does not weaken K9 — both are genuine prior art and one is a strict performance superior — but it does sharpen the positioning of what Power Loom uniquely offers.

| Artifact ★ | What it ships | Relationship to K9 |
|---|---|---|
| **DeltaBox** (arxiv 2605.22781, 2026) | OS-overlayfs-level delta containment + CRIU soft-dirty-page checkpoint/restore. **14ms checkpoint, 5ms restore** vs git-cherrypick ~100ms-1s. Evaluated on SWE-bench Verified and RL fan-out; MCTS state-management overhead drops from 47-77% to 3-6% of trajectory time. | **Strict perf superior to git-cherrypick K9 if OS-level dependency is acceptable.** Same effect-containment-with-atomic-promotion pattern. Same network-side-effect gap (neither solves rollback of sent HTTP requests). Requires root/CRIU privileges; ours runs in user-space git. **Implication**: K9's git-cherrypick implementation is one valid backend; OS-overlayfs is another. Future v3.x may swap K9 backends keeping the K9 interface stable. Phase 0 file moves are agnostic to backend choice (same as P-Snapshot OQ-18). |
| **Hermes Agent** (NousResearch) | Git-worktree isolation + automatic pre-destructive-op snapshots + rollback. **Most direct shipping-product prior art for K1+K9 combo.** | Power-Loom-in-the-small. Our differentiator vs Hermes is the broader substrate around K9 — K2 envelope (lineage + policy_version + capability set + reputation snapshot), A6 reputation snapshot for Lab→Kernel determinism, K12 layer-lint, HETS pair-review, four-pillar architecture, §6.13 invariants codified as property tests, three-layer Kernel/Runtime/Lab split, Evolution-Lab failure-memory loop. Not the worktree+rollback core. |

**Repositioning implication**: §10a previously claimed "none of these papers are load-bearing for our architecture." With DeltaBox now visible, that claim narrows. **DeltaBox does not invalidate K9** (different abstraction layer; same problem class), but Power Loom must position itself as **the broader substrate around the worktree-rollback pattern**, not as the inventor of the pattern. The novelty claims that survive scrutiny (per the Category A research review): (1) K1+K9+K14 as a coordinated triple where K14 audits the boundary K1 isolates; (2) K2 envelope as a synthesis (Temporal has narrower event-history; LangGraph has narrower checkpoint; AGT has policy-without-envelope); (3) E1 negative attestations as typed first-class artifacts (the field treats failure as a containment trigger, not structured output); (4) A6 reputation snapshot for Lab→Kernel determinism (no analogue in the field); (5) Layer-boundary advisory lint with honest "not mandatory" framing (rarer than it should be). The worktree+rollback pattern itself is shared prior art.

### 10b. Considered and Rejected (NEW v5 per Round-6 architect; field-survey divergences)

Industry consensus diverges from v4.3/v5 in three places. v5 records the divergences as deliberate, not oversights.

**Parallel multi-agent at the kernel layer (REJECTED)**:
- Industry consensus (LangGraph, CrewAI, AutoGen, Anthropic posture) favors parallel multi-agent dispatch.
- v5 rejects this AT THE KERNEL layer (K13 enforces serial spawn) for two stacked arguments:
  1. **Determinism (primary, load-bearing)**: A1+A7 require that the filesystem delta is a verifiable transaction. Concurrent spawns racing on the parent's working tree produce order-dependent merged deltas that cannot be replayed deterministically. K14's snapshot fallback (mtime+size+sha256 of parent's tree) requires a stable baseline across the spawn lifetime; concurrent spawns invalidate this assumption.
  2. **Empirical (secondary, corroborative)**: Cognition's "Don't Build Multi-Agents" (2026-Q1) documents context-sharing failures in parallel multi-agent setups.
- The determinism argument is sufficient alone; Cognition's empirical is corroborative, not load-bearing. If a future paper disproves Cognition's empirical, K13 still holds on A1+A7 grounds.
- **What Loom DOES support in parallel**: HETS pair-review (architect + code-reviewer as siblings), Pattern B sibling-wave (E12, deferred v3.5+). K13's "serial-only" stance is scoped to **kernel spawn dispatch within a single transaction**, not to all parallelism.

**K12 mandatory layer enforcement (DOWNGRADED in v5.1 to convention + advisory)**:
- v5 kept K12 mandatory on the conceptual argument that OpenHands V1's AgentController collapse was a *runtime* controller failure, not a build-time static-check failure.
- **v5.1 downgrades** because the conceptual distinction was correct but did not establish that K12 earns its keep. The Round-7 architect (`a6def7d4996a71b24`) asked the empirical question Round-6 didn't: in 6 months on `feat/v3.0-phase-1-verification-spike`, has any cross-layer drift been observed? Answer: **zero drift**. Existing cross-directory imports cluster around `_lib/` per the H.7.14 substrate-extraction pattern (`kb:architecture/crosscut/acyclic-dependencies`) — the codebase is already acyclic-by-construction without K12 enforcement.
- v5.1 retains the frontmatter convention + advisory CI lint (~50-80 LoC) because making layer labels visible has principle-grounded value per `kb:architecture/crosscut/dependency-rule`. What v5.1 removes is the mandatory-block, the `.loom/override-budget` bureaucracy, and the per-commit friction.
- **Upgrade trigger (OQ-19)**: ≥3 distinct cross-layer drift events observed across v3.1-v3.3 (each requiring post-hoc cleanup commits) triggers re-upgrade to mandatory CI blocking.
- **Where v5 was wrong**: Round-6 architect defended K12 on KB-citation grounds without asking the empirical question. Round-7 asked it; verdict B (downgrade) followed. The KB-citation defense is still valid for the *convention* tier; it does not justify the *mandatory enforcement* tier.

**K9 reverse-cherrypick journal (DEFERRED to P-Snapshot probe, NOT replaced)**:
- Industry signal: snapshot-restore dominates (Cursor zip, Hermes shadow-git, Aider `git reset HEAD`).
- v5 keeps reverse-cherrypick as the v4.3 design but adds OQ-18 + P-Snapshot probe to empirically choose among 3 implementations before v3.0-alpha K9 lands. Phase 0 file moves are agnostic to the choice.

**endorsement-records-as-primitive (REJECTED at C0 decision 2026-05-27)**:

- The v5.4 → v3.3 plan had `E14 Endorsement primitive` on the roadmap with 4-5 invariants and 5 security launch-blockers (anti-gaming, external-evidence, acyclic chain, idempotency, restraint type). C0 architect decision (HETS-routed spawn 2026-05-27; full text in `/tmp/c0-decision-summary.md`; codified in ADR-0013) rejected the primitive in favor of a derived view.
- **Six load-bearing reasons** (priority order): (1) §0a pillar-grounding test fails — principle-tier not pillar-tier; K12 v5.1 precedent applies. (2) Data already captured — v5.4 K2 envelope + R13 advisory-findings + A6 reputation already contain every field needed; the primitive duplicates. (3) SRP violation — two writers for evidence-about-persona-N-performed-task-T. (4) DIP cleaner in derived-view — E4 → kernel-records direct, not E4 → endorsement-records → kernel records. (5) **Security cost asymmetry — load-bearing**: the 5 launch-blockers exist BECAUSE the primitive creates the attack surface; removing the primitive removes the surface. Endorsement-records-as-primitive is structurally a Trust-Vulnerability Paradox amplifier (B3 field-survey debt; arxiv 2510.18563). (6) The only unique enabler the primitive offers (endorser-side reputation) IS the TVP amplifier B3 forbids.
- **What v6 ships instead**: §6.4 E14 Endorsement-as-Derived-View — pure projection over K2/R13/A6/K3 kernel-emitted records; lives in Lab layer at `packages/lab/_lib/endorsement-view.js`; ~350-510 LoC / 8-12h inside the existing v3.3 budget envelope; 3 invariants (INV-16/17/18) replacing the primitive's 4-5; endorser-side reputation explicitly out of scope indefinitely. Full ADR at `packages/specs/adrs/0013-endorsement-derived-view.md`.

**SQLite or LMDB as canonical memory ledger (REJECTED at v6 design; v6 Round-3c explicit documentation per GPT external Alt-2 + Gemini Pro Design Rec #4)**:

- **Considered by multiple external reviewers**: GPT Alt-2 proposed SQLite/LMDB for "ACID compliance for free, concurrent writes natural, recursive-CTE graph traversal, mature corruption detection." Gemini Pro Design Rec #4 echoed: "an on-disk SQLite database is still a 'file' on the client side, but gives ACID + concurrent writes + graph traversal for free."
- **The proposal**: replace the JSONL append-only WAL + Markdown memory blocks with a single embedded database file as the canonical source of truth for persona memory.
- **Pros (real, not strawman)**:
  - ACID compliance is genuinely free; A9's two-phase commit + recovery sweep would be replaced by SQLite's built-in WAL mode.
  - Concurrent reads natural; queries via SQL.
  - Recursive CTEs make graph traversal trivial (`WITH RECURSIVE chain AS (SELECT ... UNION ALL SELECT ...)`).
  - Corruption detection mature (PRAGMA integrity_check; sqlite_diff).
  - Indexing free (B-tree per column).
- **Cons (the reasons v6 rejected)**:
  - **Loss of Git-reviewability**: SQLite files are binary; `git diff` produces useless output. v6's vision-pillar commitment to filesystem-delta-as-truth (Pillar 1) is grounded in human-readable artifacts that survive any tool change.
  - **Loss of zero-dependency boot**: Node.js sqlite bindings require native compilation; substrate-bootstrap becomes platform-sensitive (cross-architecture pre-built binaries; ARM vs x86 vs WSL2 quirks).
  - **Loss of transparency**: `cat`, `grep`, `less`, and IDE syntax highlighting all stop working on memory state. Inspectability — the single highest-value property of file-backed memory — is lost.
  - **Couples to specific DB engine version**: SQLite file format is stable across versions, but migration discipline (PRAGMA user_version + schema migrations) becomes the substrate's burden anyway.
- **Decision rationale**: Power Loom's value proposition is "deterministic state management for stochastic agents WITH HUMAN-INSPECTABLE ARTIFACTS." SQLite gets the determinism for free at the cost of inspectability — defeating the load-bearing differentiator. The JSONL+Markdown design pays a higher implementation cost (we write a small WAL engine + recovery sweep + atomic-write primitive) but preserves the property that lets humans review agent memory the same way they review code.
- **Future compromise (NOT a rejection of indexing)**: a DERIVED SQLite index (regeneratable from the JSONL WAL at any time) is a legitimate v3.5+ performance optimization if WAL-walk startup costs become painful (composes with OQ-24). A derived index would NOT be canonical state; it would be a cache. The canonical state remains JSONL + Markdown. This is the standard "source of truth is the log; indices are derived" pattern from event-sourcing literature.
- **Composes with**: §5a.7 sibling-output discipline (derived views write to sibling paths, never in-place over canonical records); OQ-24 (WAL compaction); §0c Organizational Engineering Analogy (Git-reviewability of memory mirrors PR-review of code).

**`active_state_hash` dual-write field in memory-root.json (REJECTED per PB-1 user-lock 2026-05-27)**:

- Proposed Artifact 4 of the v6 drafting bundle initially included an `active_state_hash` field in `memory-root.json` as a cache of the WAL-tail-computed state hash. This was rejected at PB-1 user-lock review.
- **Why rejected**: would have re-opened the dual-write inconsistency surface the consistency model is designed to eliminate. The WAL tail is the canonical source of truth per A8; caching the active state hash in a separate file creates a SECOND source that can disagree (when the WAL advances but the cache wasn't updated, or when the cache is corrupted but the WAL is intact). Resolving the disagreement requires choosing one source over the other — and A8 already says the chain (WAL) is canonical. The cache would either always be authoritative-or-disregarded (in which case it has no value) or sometimes-disagree-with-WAL (in which case A8 is violated).
- **What v6 ships instead**: `memory-root.json` is **discovery-only** — it tells the substrate WHERE the WAL lives (`manifests.attestation_wal`), and nothing more. The active state hash is ALWAYS computed by walking the WAL tail. A8's single-source-of-truth property is preserved. Full discipline at §5a.9; rationale codified in ADR-0014.

### 10c. K1+K14 vs containers — complementary, not competing (NEW v5 per Round-6 architect C1)

The field consensus (container/microVM-per-agent: E2B 15M sessions/mo; OpenHands V1; Devin cloud VMs; SWE-bench Docker-pinned) is correct for hosted-runtime distribution. v5's K1+K14 is correct for Anthropic-native plugin distribution. **They are not competing strategies — they are complementary substrates of the same architecture.**

- **Containers enforce** the worktree boundary (filesystem cannot leak outside).
- **K14 audits** the worktree boundary (filesystem-event records for the spawn-record envelope).
- Both are needed regardless: even with container enforcement, you still want the audit record. v3.5+ ContainerAdapter (see §6.10) will retain K14 as the audit-record producer; containers replace its enforcement role.
- v5 ships K14 in v3.0-alpha because (a) plugin distribution can't assume Docker availability, (b) K14 is ~500-900 LoC vs ContainerAdapter + runtime-detection + fallback (~2,000+ LoC), (c) K14's audit value persists when containers ship.

---

## 11. Open Questions / Decisions Pending (v4 — OQ-14 deleted, OQ-15 added)

1. **Atomicity cutoff value**: empirically tuned in Wave -1 calibration probe
2. **Pattern B trampoline trigger**: deferred to v3.5+; reactivate when real depth-3+ workflow appears
3. **Hash-chained tamper-evidence ADR**: threat model decision
4. **Cross-session durable work queue ADR**: out-of-scope vs deferred to Phase 4
5. **KB enrichment cadence**: per-spawn vs per-session vs per-week
6. **Liveness layer ADR**: production-blocking trigger
7. **Per-tool-call gate ADR**: OAP pattern adoption
8. **Circuit-breaker scope**: max_denials threshold; reset window; per-persona vs global
9. **Negative-attestation expiry policy**: default expires_after_n_spawns; per-failure-mode override
10. **Settings.json permissions per-Claude-Code-invocation vs per-spawn**: v3.1 enforcement design or post-hoc audit
11. ~~OQ-11~~ — **CLOSED v4.2: SLIM PREDICATES** (~250-400 LoC; v3.2 effort table tightened to 1,200-1,600 LoC). Per Round-5 HIGH-3: "provisionally resolved while keeping the LoC swing in published estimates" was forward-bundling; v4.2 closes it cleanly. Justification: P-HookChain proved K8 must be exclusive injector (no room for validator chains); P-WriteScope forced K14 to absorb scope detection (no need for validator-chain duplication). Slim predicates compose with K8+K14 cleanly.
12. **Out-of-band ground-truth signal for v3.4**: RLHF preference oracle vs honest proxy framing; decide before E8 ships
13. **Adapter-layer ADR**: when does kernel detach from Claude-specific assumptions
14. ~~Layer-boundary enforcement~~ — **DELETED**: now mandatory in v3.0-alpha per K12
15. **NEW v4**: A6 implementation mechanism for Pattern B sibling-wave snapshot carriage (when Pattern B ships in v3.5+)
16. **OQ-16 (per Wave -1 P-HookChain) — CLOSED v4.2 to option (b)-with-import** per Round-5 architect HIGH-1: K8 owns `updatedInput` exclusively; `contract-reminder-on-agent-spawn.js` is refactored into a pure-function module `contract-reminder-text.js` (exports `getReminderForSubagent(subagent_type)`) that K8 imports and prepends to its prompt-rewrite. Rationale: the existing 303-LoC contract-reminder is self-contained, well-documented, with GAP-A/D/E lineage comments — merging into K8 (option a) would bundle to ~600 LoC and kill that history. Option (b)-with-import is ~120 LoC of refactor that preserves history and yields KISS. The standalone `contract-reminder-on-agent-spawn.js` becomes a thin wrapper that calls the same module (during v3.1 transition) or is deleted once K8 ships. Captured in ADR-0010.

17. ~~OQ-17~~ — **CLOSED v5 to option (b) shipping in v3.1, NOT v3.2** per Round-6 architect MUST-ABSORB-PRE-PHASE-0. Rationale: v3.1 introduces K6 capability subset check. The MOMENT K6 enables network-side-effecting tools, the ACRFence semantic-rollback surface opens. Deferring R13 to v3.2 ships v3.1 with a known hole AND asks persona authors to enforce idempotency by discipline — which violates §2.4's "enforce, not document" principle. **R13 Idempotency-Key Enforcer** (~150-250 LoC) ships in v3.1 alongside K6+K8, as a parallel sub-wave (zero new dependencies — uses K2's spawn_id + tool_use_id, already in v3.0-alpha). Idempotency key shape derived per `kb:architecture/crosscut/idempotency` Patterns 1+3 (Dedupe-via-Request-ID + Conditional Write). v3.1 effort estimate updates: +150-250 LoC, +3-5h, total ~2,550-3,150 LoC / 24-36h. v3.0-alpha is unaffected (no K6 yet, so persona contracts forbid network-side-effecting tools entirely).

18. **NEW v5 (per Round-6 architect C2/O4)**: K9 implementation choice — reverse-cherrypick journal vs snapshot-restore. Field consensus is snapshot-restore (Cursor zips, Hermes content-addressable shadow git, Aider `git reset HEAD`); estimated 400-700 LoC simplification vs v4.3's reverse-cherrypick (650-1,050 LoC). Three implementation candidates:
    - **(a)** Reverse-cherrypick journal (current v4.3 design): ~650-1,050 LoC; preserves per-cherrypick audit granularity (`spawn-state.journal[]`).
    - **(b)** Spawn-bookended zip snapshot (Cursor-style): ~200-300 LoC; bigger disk; simpler atomic rollback.
    - **(c)** Content-addressable shadow git (Hermes Agent pattern): ~300-500 LoC; smaller disk via dedup; more storage indirection.
    - **Decision deferred to v3.0-alpha kickoff via P-Snapshot probe**: implement all 3 on toy fixtures; run §6.5.1's 5 K14-sequencing sub-cases through each; measure LoC + disk + correctness under semantic-invalidity. Phase 0 file moves are agnostic to which implementation lands. Probe spec lives in `swarm/thoughts/shared/spikes/p-snapshot-spec.md` (TBD).

19. **NEW v5.1 (per Round-7 architect K12 downgrade)**: K12 upgrade trigger to mandatory CI enforcement. The v5.1 downgrade is empirically grounded (zero observed drift in 6 months) but is NOT a permanent decision — it's a defer-until-evidence stance. **Re-upgrade to mandatory CI blocking when ≥3 distinct cross-layer drift events are observed across v3.1-v3.3**, each requiring post-hoc cleanup commits. Track in `swarm/drift-events.jsonl` (NEW; ~20 LoC append-only log). At threshold, the convention + advisory tier becomes mandatory enforcement (~+100-120 LoC; aligns with v4 original K12 spec). Until then: convention + advisory is the v3.x default.

20. **NEW v6 (per GPT external review §3.A)**: **Tamper-evidence model for the content-addressed chain**. A8 makes the chain canonical, but if a local actor can rewrite the WAL, rewrite `memory-root.json`, or replace the persona index, content-addressing alone does not protect integrity unless the root hash is anchored somewhere outside the mutable store. Options: (a) hash-chained tamper-evidence with periodic anchoring to an immutable external store (git refs with signing; cloud-hosted hash log; user-keychain-stored root hash); (b) explicit threat-model declaration that v3.x assumes a trusted local filesystem and defers tamper-evidence to v3.5+ when ContainerAdapter ships; (c) sign individual WAL records using a substrate-internal key + verify chain integrity on every read. **Decision deferred until v3.x threat-model ADR is drafted** (no current target release; flag for v3.1 design).

21. **NEW v6 (per GPT external review §3.C)**: **Semantic claim-faithfulness third layer for memory promotion**. A10 + §0a.3.1 + INV-27 form a strong syntactic/procedural defense against forged evidence-links and derived-view amplification. None prove that a memory claim faithfully **summarizes** the evidence it references — e.g., a memory could cite a real failed auth test but falsely claim "frontend caused it" when backend caused it. A10 would pass syntactically; no-amplification would not catch the misattribution. Options: (a) deterministic-where-possible semantic admission review (e.g., template-conformance check: memory text mentions the same files/lines as evidence_refs); (b) advisory LLM-judged semantic-faithfulness check (Pillar 2 inputs-as-Byzantine application; advisory only per A3b); (c) human-in-the-loop review for L_persona promotions only. **Decision deferred to v3.5+ alongside Pillar 2 blocking-grade prompt-injection defense + content-source tagging**.

22. **NEW v6 (per GPT external review §3.E)**: **Task-selection anti-gaming for derived-view-driven routing**. §0a.3.1 forbids trust-by-frequency, but does not define anti-gaming for task allocation. A derived view that repeatedly routes easy tasks to a favored persona can inflate that persona's future evidence (high promotion rate) without directly widening capability. Options: (a) require derived-view-driven routing to log counterfactual alternatives + task difficulty/selection basis at routing time; (b) periodic randomized routing (e.g., 5% of tasks routed to non-top-ranked candidate) to break feedback loops; (c) explicit task-difficulty oracle ground-truth source (Pillar 2 v3.5+ blocking-grade input-byzantine defense). **Decision deferred to v3.5+**.

23. **NEW v6 (per GPT external review §3.D + Alt 4)**: **Memory Root Pointer as capability-bearing config object — formal trust policy**. Patch G9 + GPT-3.D landed an interim trust policy (owner check + realpath CWD invariant + optional allowlist + fail-closed default) in §5a.9. Open: should `memory-root.json` be cryptographically signed (substrate-key signature; verified on read)? Should per-project pointer adoption require explicit `loom trust add <project>` operator command (interactive approval)? **Decision deferred to v3.1 pointer-trust-policy ADR**; current v3.0-alpha enforcement is the fail-closed interim discipline at §5a.9.

24. **NEW v6 (per Gemini 3.1 Pro external review §1.3)**: **WAL compaction / snapshotting strategy**. A8 + §5a.9 explicitly forbid caching `active_state_hash` in `memory-root.json` (correctly — per PB-1 user-lock that prevents dual-write inconsistency). However, walking the entire WAL tail on every substrate startup is O(N) where N grows monotonically. A long-lived install with millions of transactions will see startup time degrade linearly. Options: (a) periodic checkpoint snapshots — write a checkpoint record to the WAL at intervals containing the state-hash at that point; recovery walks back only to the most recent checkpoint, not to genesis; this preserves A8 single-source-of-truth (the checkpoint IS in the chain) while bounding startup work. (b) Compact-and-archive: roll the WAL into a new file after N records; keep archived WAL files for audit but exclude from default startup walk. (c) Per-persona WAL sharding to bound per-persona walk to per-persona chain length. **Decision deferred to v3.5+ when WAL size becomes empirically painful**; current v3.0-alpha-through-v3.4 walks remain O(N) with explicit acknowledgment that the linear-startup-time cost is real and accepted.

25. **NEW v6 (per Gemini 3.1 Pro external review §5)**: **K14 snapshot-fallback performance for large repos**. K14's mtime+size+sha256 snapshot fallback (per §6.5.K14) scans the entire project tree before and after every spawn. For repos with 50k+ files, the 500ms p99 claim is unverified. Options: (a) empirical P-Snapshot probe sub-case measuring K14 snapshot cost across repo sizes (1k / 10k / 50k / 100k files); (b) lazy/incremental snapshot via `fs.watch` real-time event stream (the v3.1+ event-stream variant); (c) git-status-based delta detection that piggy-backs on git's already-indexed file metadata. **Decision deferred to v3.0-alpha P-Snapshot probe** (per OQ-18); if the polling fallback proves unacceptable, v3.0-alpha may need to ship the event-stream variant earlier than v3.1. **P-Snapshot probe time-box (Round-3d per persona-Tess T3)**: the probe is allotted **≤8h of investigation time**; if no implementation candidate clearly wins within that budget, v3.0-alpha ships reverse-cherrypick journal (current v4.3 default) and revisits at v3.1 kickoff. The time-box prevents probe-creep from blowing the v3.0-alpha 140h abort trigger.

26. **NEW v6 (per Gemini 3.1 Pro external review §5)**: **Node.js fsync correctness across OS/filesystems**. A9 + §5a.2 lean heavily on `_lib/atomic-write.js` (tmp-write + fsync + atomic-rename) for durability. Gemini 3.1 Pro flagged that Node.js `fsync` behavior varies across OS/filesystem combinations (notably ext4 delayed allocation, APFS soft-sync semantics, NTFS journaling). The partial-write corruptions A9 is designed to prevent could be reintroduced if fsync doesn't actually flush to durable storage. Options: (a) empirical fsync-correctness probe across common host environments (macOS APFS, Linux ext4, Linux btrfs, WSL2); (b) explicit `fsync(parent_dir)` after rename (POSIX requires this for rename durability — easy to forget in JS implementations); (c) substrate-level write-amplification mitigation (group commits to reduce fsync count). **Decision deferred to v3.0-alpha implementation gate**; the atomic-write test suite must include cross-OS fsync correctness fixtures before K9 ships. **Cross-OS CI matrix declaration (Round-3d per persona-Tess T4)**: v3.0-alpha CI MUST run the atomic-write fsync correctness fixtures on macOS Darwin + Linux ext4 + WSL2 at minimum (~+6-10h CI matrix setup). ALTERNATIVELY, if multi-OS CI is not feasible in v3.0-alpha timeframe, v3.0-alpha SHIPS with an explicit caveat: "v3.0-alpha tests fsync correctness on macOS only; Linux/WSL2 cross-OS correctness is community-contribution-validated; INV-26-MRAtomicWrite carries a known-untested-on-non-macOS caveat for v3.0-alpha LOCK." The current v3.0-alpha plan does not specify which path is taken — implementation gate decision.

27. **NEW v6 Round-3c (per cross-reviewer convergence finding from GPT + Gemini Pro)**: **Context-assembly traversal algorithm**. v6 specifies the storage layer (deeply: WAL, transactions, two-phase commit, recovery, MRP, atomic writes) and the admission layer (deeply: A10, evidence-link, A6 snapshot mediation), but the **consumption layer** — how the substrate decides which memory blocks to load into the active LLM context for a given task — is unspecified beyond §0a.3.1 (what derived views may/may-not do) and INV-27 (canonical-records-only indexing). Per Gemini Pro: *"the logic for deciding which edges to follow becomes the hardest part of the system."* Three orthogonal sub-questions are unresolved at v6 LOCK:
    - **(a) Traversal start point**: from what seed node does context assembly begin for a given spawn? Candidates: (i) current spawn's pinned `prev_state_hash` (the MVCC view) + a topic-keyword seed; (ii) the orchestrator-task spec itself (treat task as axiom; assemble evidence reachable from it); (iii) the persona's most-recent COMMITTED L_persona promotion (the "where did I leave off" anchor). The choice depends on whether the spawn is task-fresh, continuation-of-prior-spawn, or memory-recall-only.
    - **(b) Edge-walk policy**: which edge types are followed (`prev_state_hash` chain backward / `evidence_refs` graph outward / `parent_state_id` lineage upward / `affected_records` reverse-lookup), with what bounds (`max_depth`, `max_nodes`, `max_tokens`, `allowed_types`, `freshness_threshold`)? Per GPT: "if graph traversal is too broad, you are back to dumping too much context."
    - **(c) Ranking + truncation**: when retrieved nodes exceed the context budget, how is pruning done? Recency (newer wins)? Evidence-grade (COMMITTED beats ABORTED)? §0a.3.1-anti-amplification-compliant ranking (no trust-by-frequency)? Per-spawn vs per-persona caching?
    
    **Options for v3.x**: (1) defer to v3.0-alpha K4 recall-CLI as the first concrete algorithm sketch (current K4 is tri-signal `0.5·kw + 0.3·tag + 0.2·surface` over snapshot — a starting point but does NOT address (a)/(b) above); (2) explicit per-spawn traversal-config in the K2 envelope (`traversal_policy: {start: ..., bounds: ..., ranking: ...}`); (3) leave entirely to Runtime persona-contract discipline (each persona declares its traversal preferences).
    
    **Decision deferred to v3.0-alpha implementation gate**: the first concrete context-assembly algorithm should appear in v3.0-alpha P-Recall fixture suite (extends Phase 1 spike's K4 implementation), NOT in v6 spec text. v6 acknowledges that context assembly is the deepest under-specified concern and that the traversal algorithm IS load-bearing (it's the read-side of the entire memory system; "the hardest part" per Gemini Pro). The OQ is named explicitly so v3.0-alpha designers know they own the choice; v6 LOCK is honest about not having pre-empted it.

---

## 12. Source Honesty (v4 — GPT downgraded; meta-pattern admitted)

**Strong sources (verified — primary docs read)**:
- Phase 1 spike outcomes — `swarm/thoughts/shared/spikes/phase-1-probes.md`
- Bernstein architecture (GitHub README full-read)
- Gas Town architecture (Yegge Medium + GitHub README full-read)
- Microsoft Conductor (Microsoft blog announce May 2026)
- Rookdaemon (GitHub README full-read)
- Anthropic native primitives — `code.claude.com/docs/en/{hooks,worktrees,sub-agents,plugins,settings,agent-teams,agent-view}` (docs only; **end-to-end behavior verification IS Wave -1**)
- Original execution plan baseline

**Weak / single-source (☆ flagged)**:
- Dave Wascha "Agent OS" specifics ✦ — UNVERIFIED; re-research agent ran in background
- OAP / aport.io ☆ — arxiv 2603.20953 NOT directly fetched
- WBFT arxiv 2507.14928 ☆
- det-acp ☆ — single blog source
- Archon ☆ — single blog source
- **External GPT analysis ☆ (DOWNGRADED in v4 per Round-3 honesty CRITICAL)** — one LLM's opinion; substrate's own A1 axiom forbids treating LLM self-reports as ground truth, which extends to external LLM as reviewer. Treated as adversarial design input that surfaced two good ideas (three-layer + MVP staging); ideas adopted on merit, not on GPT's authority.

**Inferences explicitly marked**:
- P1 "re-spawn equivalence at temp=0" — actually measured at default temperature; temp=0 is *a fortiori* inference
- "v4 ~141-209h" — per Round-3 planner calibration; +63-130h more than v2 in exchange for staged-release discipline (honest trade, not regression)
- v3.4 ConvergenceRate threshold — no prior-art anchor
- Phase 4 deferral effort estimates — projections, not measurements

**v4 honest meta-pattern admission (NEW)**:
Each LLM-driven revision absorbs prior findings BUT can introduce new aspirational claims under cover of new structure. v3 added "delete before add" rhetoric (Round-3 honesty CRITICAL found 1 real deletion vs +17 net primitives) and buried v2→v3 time regression. v4 explicitly:
- Drops "delete before add" framing (v4 adds K12 + K13; +2 primitives, zero deletions)
- States the v2→v4 time trade honestly (+63-130h for staged-release discipline)
- Demotes GPT to ☆ source
- Acknowledges further document iteration has diminishing returns; Wave -1 entry-probe is the first real empirical validation, not another review round

---

## 13. What This Document IS / SUPERSEDES (v6 — refreshed from v4)

**v6 IS** (refreshed for v6 LOCK-readiness):
- Implementation-grade blueprint for v3.0-alpha through v3.4 with consistency model explicit (§3 A8/A9/A10 + §5 WAL + §5a Memory Consistency Discipline)
- Source for RFC v3.3 amendment (drafted after v6 LOCK)
- Supersedes v1 + v2 + v3 + v4 + v4.1 + v4.2 + v4.3 + v5 + v5.1 + v5.2 + v5.3 + v5.4 of this synthesis lineage + original execution plan §C2 sections + the "single monster Phase 2" framing
- Acknowledges full review trail: Round-1/2/3 deep pair-reviews (6 CRITICAL + ~20 HIGH absorbed in v4); Round-5 architect (v4.2 + ADR renumber); external research brief (v4.3, 3 verified citations); Round-6 architect + field-survey triage (v5); Round-7 architect vision-pillar alignment (v5.1); v5.2 pillars-grounding test; v5.3 audience-framings + §6.13 invariants; v5.4 positioning corrections + Category-A fixes; v6 Round-1+2+3 drafting + LOCK review (architect `a0bf0cd9` + honesty-auditor `abf4a296`, HD-1 K15/K16 fabrication caught and removed)
- Adopts ~141-209h as honest effort target through v3.4; v6 additions claimed inside existing envelope with HD-3 disclosure for v3.x LOCK reviews

**v6 is NOT**:
- Final RFC v3.3 (that comes after acceptance + RFC-format conversion)
- Implementation specification (algorithm signatures + contract schemas are v3.0-alpha through v3.4 deliverables; ADRs 0009-0012 stubs are v3.0-alpha deliverables not yet written)
- Free of all open questions (~17-19 OQs remain across §11; OQ-14 deleted, OQ-15/16/17 closed)
- Free of all honesty debts — Round-3b cleanup remains: HD-3 (§6.11 effort summary table v6 envelope explicit math), HD-4 (§6.5 stale LoC figures reconciliation), T-7 (§5/§5a vs §6.1/§6.2 in-file ordering deferred to v6.1)

**Next step** (post-v6-LOCK):
- (a) Lock v6, open PR against main, begin v3.0-alpha K2 reservation PR (Task #10) — the K2 envelope schema-additive extension that ships the §4.2 transaction-record-shape reservation + `memory-root.js` reader stub + ADR-0013/0014 references
- (b) After K2 reservation PR merges, begin Phase 1-alpha (v3.0-alpha kernel) implementation (~30h)
- (c) Round-3b cleanup at any point (non-blocking)

Honest recommendation: **(a) then (b)**. Round-3b cleanup is cosmetic; it should not block K2 reservation PR or v3.0-alpha implementation.
