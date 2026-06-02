---
date: 2026-06-02
researcher: root + Workflow(gstack-llmwiki-v6-hybrid-research; 7 agents, 3-lens adversarial review)
git_commit: 48abab9
branch: main
repository: power-loom
topic: "Persona-depth (gstack) + LLM-wiki (Karpathy) fold-in to Power Loom v6 — optimal hybrid + shipped-vs-future phase safety"
tags: [research, design-synthesis, persona-depth, llm-wiki, memory, derived-view, cross-validation, workflow-orchestrated]
status: complete (3-lens adversarial review folded in)
lifecycle: persistent
last_updated: 2026-06-02
related:
  - packages/specs/research/2026-06-01-gstack-comparison-and-cross-model-review.md  # prior doc (rubric + advisory invariants adopted)
  - packages/specs/research/2026-06-02-persona-depth-llmwiki-RESEARCH-FINDINGS.md   # companion: the 3 raw verified findings (per honesty-auditor HA-1)
  - packages/specs/rfcs/v6-substrate-synthesis.md                                    # LOCKED
  - packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md          # DRAFT (memory candidate scope)
---

> **Genre + provenance.** Design-synthesis / hand-off artifact (not documentary research), produced by a 7-agent research workflow: 3 parallel web-research agents independently verified gstack + Karpathy's llm-wiki + ~8 similar systems against primary sources, an architect synthesized the hybrid, and a 3-lens adversarial review (architect / honesty-auditor / hacker) hardened it. **Not an approved plan.** The three raw verified research findings are committed as the companion `…-RESEARCH-FINDINGS.md` so the "VERIFIED" borrow tags are independently re-checkable (honesty-auditor HA-1). Runtime-state claims (the OQ-E roster probe, the persona-contract F-slots, the v6 line anchors) were probed at `48abab9`; re-probe per OQ-HYBRID-7 — the v3.5 RFC is a DRAFT and may move.
>
> **3-lens verdict: all APPROVE-WITH-CHANGES.** Corrections folded into **§B.4a** (two HARD launch preconditions + 5 lower-sev corrections) and the **Part-D provenance caveat** (phase-label fix). Full findings in **Part G**.

# Optimal Hybrid Architecture: Persona-Depth + LLM-Wiki Fold-In to Power Loom v6

> **Genre.** A design-synthesis / hand-off artifact in the proposal-flavored format of `2026-06-01-gstack-comparison-and-cross-model-review.md` (the "prior doc"). It adopts that doc's Part C field-survey rubric (**Gap / Proposed mechanism / v6 anchor / target release / effort / pillar**) and its advisory-only invariants verbatim. **Not an approved plan.** Every v6 anchor below was read directly from `v6-substrate-synthesis.md` / the v3.5 RFC at the cited line; runtime-state claims are flagged for re-probe in OQ-7. This draft will immediately face a 3-lens adversarial review (architect / honesty-auditor / hacker), so VERIFIED and SPECULATIVE borrows are separated explicitly throughout.

## TL;DR

1. **Persona-DEPTH → HETS verification lenses (gstack item 2 + item 1): per-finding grounded-confidence gate + doc-gen-from-contract.** This is a **REFRAME**, not a v6 change — it is the *same* attestation-vs-stochastic-content split (GPT-1.C, `v6:504`) the prior doc already rode for cross-model review, now applied to *internal* HETS findings. gstack independently shipped "a finding must cite resolvable code lines or be force-suppressed" — external corroboration that the grounding-as-sanitizer shape is right. **Shipped-phase safety: SAFE** — personas are Runtime (`packages/runtime/`), zero kernel touch; targets v3.2.

2. **LLM-wiki → MEMORY read-side (the hybrid): the wiki is a DERIVED VIEW (Deterministic-Theorem-class projection) over the immutable chain, re-derivable, never canonical, never read-as-fact.** This is a **REFRAME** of A8 + §0a.3.1 — the wiki is *exactly* the "persona-memory summary/dashboard projection" §0a.3.1 already names as a derived view (`v6:171`). It lands on OQ-27 (the "deepest under-specified concern", v3.5 RFC `:294`) as the read-side **projection layer**, composing *with* — not replacing — the v3.5 typed causal-graph. **Shipped-phase safety: SAFE** — read-side, unbuilt below the v3.5-RFC-candidate line (NOT a locked v6 §6 phase — see Part D). ⚠️ The wiki-**WRITE** (SUPERSEDE-edit) path is SAFE *only because unbuilt*: it is a memory-poisoning surface and MUST NOT ship before kernel-attested writer identity (OQ-E) — see §B.4a.

3. **The single hard constraint that makes #2 legal: edits express as SUPERSEDE-as-sibling-write (§5a.1, `v6:916`), never bare in-place mutation.** Taken literally, Karpathy's "revise the entity page in place" is a **bare UPDATE** that §5a.1 categorically forbids — it would break A8, break concurrent-reader consistency, and destroy the audit trail (`v6:926`). The reconciliation is non-negotiable: SUPERSEDE + projection, or reject.

4. **Convergent external validation (similar-sources sweep): Power Loom's append-and-reference write-side is field consensus; its gap is the read-side.** Five independent systems (Anthropic multi-agent, native memory tool, Letta, Cline, Devin) converge on "externalize memory, pass references, retrieve on demand." Zep/Graphiti's **invalidate-don't-delete** is the closest external analog to A8 and hands us a concrete bi-temporal edge schema. **REFRAME** (validates existing axioms) — except Zep's edge-validity *mechanics*, which are a genuine **borrowable addition** to the v3.5 causal-edge schema.

5. **Security is load-bearing, not decorative (memory-poisoning literature = a constraint, not a system).** MINJA/A-MemGuard/Schneider independently land on Power Loom's exact posture — trace every entry to a trusted source, separate data from instructions, sanitize-before-persist. This converts the four-class split + A10 from "a design opinion" into "the empirically-recommended defense." The wiki's "file a good Q&A answer as a page with no evidence" is an A10 violation **and** a poisoning surface — rejected.

6. **Nothing requires revisiting a shipped phase.** Every borrow folds into v3.2 (persona-depth), v3.3 (Lab consensus / lint-as-dream-cycle), or v3.5 (wiki projection + causal-edge schema). The v3.0-alpha kernel and v3.1 Runtime Foundation are untouched. The one item that *would* touch shipped code if mis-implemented — the wiki as canonical mutable markdown — is on the explicit DO-NOT-FOLD list (Part F).

---

## PART A — Persona DEPTH → HETS

**The axis correction up front (reconciling with the prior doc's C5).** The prior doc filed "more gstack roles" under **C5 — breadth** (adding *delivery-org* lenses: CEO / Designer / Release Manager), explicitly low-priority. This part proposes the orthogonal axis: **DEPTH** — making each *existing* verification lens internally more rigorous. Breadth adds *new* personas; depth deepens the *protocol inside* a persona's role-brief + JSON-contract. They do not compete; C5 stays deferred, Part A is additive. The load-bearing distinction the research surfaced: **gstack's borrowable depth is everything that makes a *review protocol* self-honest** (structured gates, grounded-confidence floors, deterministic escalation triggers, scout-not-gate outside-voice). Everything tied to gstack's *browser runtime* or *ship pipeline* serves a delivery org and is deferred or rejected.

How a HETS persona is structured today (read directly from `04-architect.md` + `04-architect.contract.json`): a **role-brief** (`packages/runtime/personas/NN-name.md` — Identity / Mindset / Focus area / Output format / Constraints) delegated-to by a thin `agents/*.md`, paired with a **JSON contract** (`packages/runtime/contracts/NN-name.contract.json`) carrying `functional[]` checks (F1-F6: frontmatter, length-min, keyword-presence, `kb_scope_consumed`), `antiPattern[]` (A1-A3: similarity, padding, fallback-ack), and `interface.output_schema`. **This is precisely gstack's `.tmpl` + source-metadata + generated-`SKILL.md` shape — Power Loom already has the richer half (machine-checkable contracts); it lacks the generation half.** The depth-borrows below extend *this existing structure*.

### A1 — Per-finding grounded-confidence gate (VERIFIED borrow; HIGH value)

- **What it is:** gstack's `/plan-eng-review` forces every finding to a 1-10 confidence; a finding that cannot quote the specific code lines motivating it is **capped at confidence 4-5 and suppressed from the main report** (verified against `plan-eng-review/SKILL.md`, Finding 2). This is a self-honesty floor: ungrounded findings don't reach the reader.
- **Maps onto:** the `code-reviewer` / `hacker` / `honesty-auditor` contracts' `functional[]` array — add an `F7: findingGroundingFloor` check requiring each emitted finding to carry `{file, line_start, line_end, cited_text}` resolvable against the in-scope delta, else the finding self-grades to a capped tier and moves to an `audit_only` block. This is the **identical pure-function sanitizer** the prior doc specified for *cross-model* findings (B1, `verifyGrounding`) — now applied to *internal* findings.
- **v6 anchor:** GPT-1.C attestation-vs-stochastic-content split (`v6:504`) — *the fact that a finding was emitted with a citation is an Attestation (deterministic); the claim is a Stochastic Sample.* The grounding check verifies the attestation half. Also A10 evidence-linked admission (`v6:453`) as the conceptual parent.
- **Layer:** Runtime (the producer/persona) + a pure-fn sanitizer that *may* live kernel-adjacent (same placement debate the prior doc resolved: sanitizer is pure, dispatch is Runtime). **Personas are Runtime, never Kernel** (Axiom 2).
- **Release:** v3.2 (Runtime decomposition — the advisory-producer arc the prior doc's C1 also targets).
- **Effort:** **S** — it is the prior doc's already-designed sanitizer, re-pointed at internal findings; the contract-check is one `functional[]` entry.
- **Pillar:** Pillar 2 (Byzantine — grounded inputs) + Pillar 3 (auditable findings).
- **Honesty note:** gstack's variant is *softer* (force-to-low-confidence, advisory) than a hard drop. That softness is **advisory-compatible** and arguably the right shape — a low-confidence-but-surfaced finding preserves more signal than a silent drop. Recommend the soft floor for internal findings, the hard drop only for cross-vendor (where the prior doc's T6 flooding threat is sharper).

### A2 — Doc-gen-from-contract + CI freshness gate (VERIFIED borrow; HIGH value — strengthens prior-doc C3)

- **What it is:** gstack generates `SKILL.md` for 8 hosts from one `commands.ts` source via `gen-skill-docs.ts`; CI runs `gen --dry-run` + `git diff --exit-code` and **fails on drift**; skill-parser tests round-trip every command from generated bash blocks against the registry (verified against `ARCHITECTURE.md` + `CONTRIBUTING.md`, Finding 1). The **depth lens strengthens prior-doc C3**: C3 proposed the dry-run; gstack proves the *round-trip-test* pattern on top.
- **Maps onto:** Power Loom's persona↔contract **reconciliation validator** (the existing build-time enforcement layer — MEMORY confirms it is "the real build-time enforcement"). Today the validator *checks* `agents/*.md` against `*.contract.json` but **generates nothing**. Borrow: generate the deterministic *scaffolding* of a persona.md (the capability table, tool list, contract-derived F-check audit checklist) FROM the `.contract.json`, leaving only the cognitive brief (Identity / Mindset) hand-written. CI freshness-gate fails on drift. Directly addresses the #183/#184 doc-drift class.
- **v6 anchor:** persona contracts are **Axiom-class** (`v6:508` — "content-hashed + semver-versioned"); generating docs from the axiom-class source is consistency-preserving by construction. No new axiom.
- **Layer:** Runtime + build/CI tooling. Zero kernel touch.
- **Release:** v3.2 or **opportunistic** (low-risk, high-leverage — the prior doc's C3 disposition holds).
- **Effort:** **S-M** — Power Loom has the validator culture; this adds a generator + a dry-run gate.
- **Pillar:** operational hygiene (no direct pillar; reduces honesty-drift surface — same as C3).
- **Honesty note:** ROI is *lower* for Power Loom than gstack. gstack amortizes over 8 hosts × 50 skills; Power Loom has 16 bespoke personas. Borrow the *round-trip-freshness-test*; be cautious about over-templating bespoke personas (YAGNI — the cognitive brief is the valuable, un-generatable half).

### A3 — Deterministic forcing-functions embedded in the lens contract (VERIFIED borrow; MED-HIGH value)

- **What it is:** gstack bakes hard structural triggers into the skill — "Complexity Smell: 8+ files or 2+ new classes → STOP before Section 1, force a scope-reduction question"; "Regression Rule: a diff breaking existing behavior adds a regression test, no negotiation" (verified, Finding 4). These are *deterministic escalation thresholds*, not model judgment.
- **Maps onto:** the `code-reviewer` contract + the prior doc's **`stakes-decide.js`** classifier (C2). A deterministic "is this load-bearing?" trigger is the *same genus* as "8+ files → escalate." Encode escalation thresholds into the lens contract as a deterministic pre-check (changed-file-count, new-public-surface-count) that *forces* a scope-challenge finding.
- **v6 anchor:** §0a.3.1 pillar-grounding test (`v6:219`) — deterministic triggers are convention+advisory unless they serve a pillar; this is advisory escalation, so it ships as convention (the K12 pattern). Composes with the prior doc's C2.
- **Layer:** Runtime (advisory escalation). Kernel gates stay pure and separate (Axiom 3a — a stochastic finding never gates promote).
- **Release:** v3.2 (pairs with C2 `stakes-decide.js`).
- **Effort:** **S-M.**
- **Pillar:** Pillar 2 + Pillar 3 (cost-bounded advisory).
- **Honesty note:** the *pattern* (deterministic thresholds in the contract) is borrowable; the *specific thresholds* (8 files, 2 classes) are gstack-tuned and **not portable** — Power Loom must derive its own. SPECULATIVE on threshold values; VERIFIED on the pattern.

### A4 — Scout-not-gate outside-voice discipline (VERIFIED borrow; HIGH value — direct corroboration of prior-doc B2)

- **What it is:** `/plan-eng-review`'s "Outside Voice" dispatches to Codex for an independent challenge and **"never auto-incorporates findings without explicit user approval"** (verified, Finding 3). This is *external corroboration* of the prior doc's "a finding is a scout, not a gate" invariant (B2) — gstack independently arrived at advisory + explicit-approval.
- **Maps onto:** the `architect` / `honesty-auditor` review tier + the prior doc's cross-model-review design (C1). **Borrow the contract, not the placement:** gstack embeds the LLM call *inline in the skill*; Power Loom must keep dispatch in Runtime per ADR-0012 / Axiom 2 (no LLM in kernel). The discipline (advisory + explicit-approval, never auto-apply) is already the prior doc's design — this is confirmation, not new work.
- **v6 anchor:** Axiom 3b (advisory may be LLM-mediated) + the prior doc's `INV-CMR-NoLiveReputationRead` (B2). A finding can *motivate* a separate pure A3a gate but can never *be* one (the "scout" framing, prior doc B2).
- **Layer:** Runtime.
- **Release:** v3.2 (rides C1).
- **Effort:** **S** (already designed; this is corroboration).
- **Pillar:** Pillar 2.
- **Honesty note:** this item adds *confidence*, not *scope* — it is an independent external data point that the prior doc's central invariant is sound. Worth recording precisely because adversarial review values external corroboration.

### A5 — Typed-artifact lifecycle handoff between lenses (VERIFIED pattern; MED value — Power Loom does it better)

- **What it is:** gstack lenses hand off via shared state artifacts — `/plan-eng-review` writes a test-plan to `~/.gstack/projects/`, `/qa` auto-picks-it-up; `/autoplan` chains CEO→Design→Eng (verified, Finding 5). Plus the CrewAI **role/goal/backstory** declarative triple from the sweep (item 8) as a compact persona-contract schema.
- **Maps onto:** Power Loom's **transaction-record envelope** (`v6:526`) as the inter-persona handoff medium — one persona's frozen output feeds the next via the chain, not free-text. The prior doc's proposed `verification` envelope field is exactly this.
- **v6 anchor:** §4.2 transaction-record (`v6:526`); the envelope is the typed handoff. CrewAI's declarative-roles validates Power Loom's `interface.output_schema` + `declared_scope` (`04-architect.contract.json:47-59`).
- **Layer:** Runtime (envelope is kernel-emitted, but persona handoff is Runtime orchestration).
- **Release:** v3.2.
- **Effort:** **M** (the envelope exists; wiring lens-to-lens handoff through it is new).
- **Pillar:** Pillar 3 (auditable handoff) + Pillar 4 (role-separation).
- **Honesty note:** **Power Loom does this *better* than gstack** — gstack's loose `~/.gstack/projects/` JSON has *no transaction/provenance guarantee*; Power Loom's record-store gives content-addressed, replayable handoff. This is *inspiration confirming the existing design*, not a mechanism to copy. The sweep's caution applies: reject **AutoGen-style emergent conversational handoff** (item 8) — non-deterministic, un-replayable, violates Axiom 1/A6 in any gating path.

### Depth that is NOT borrowable (verified rejections)

- **`/careful` `/freeze` `/guard` prompt-level guards** — verified prompt-level-only (mechanism "opaque/absent"). Power Loom's *mechanism-based* containment (static `tools:` + K9/K14 + reconciliation validator) already closes this deterministically. Borrowing prompt-guards would be a **regression**. (Finding: NOT borrowable.)
- **The 6-layer browser prompt-injection stack** — defends a browser-sidebar runtime Power Loom deliberately lacks (B5 REJECTED the browser gate). **One transferable atom:** the L1-L3 **datamarking / trust-boundary-envelope** primitive ("untrusted bytes as data, never instructions") is already captured as the prior doc's **T2** reviewer-injection defense. Borrow that one layer into the Runtime cross-model producer; reject the rest.
- **Delivery-org roles** (`/ship`, `/canary`, `/design-*`, `/office-hours`) — these are *delivery* lenses, prior-doc C5 breadth, explicitly out of depth scope. They deepen no verification lens.

---

## PART B — LLM-WIKI → MEMORY (the hybrid)

### B.0 The cleanest reconciliation with A8 (the load-bearing answer)

**The wiki is a DERIVED VIEW — a Deterministic-Theorem-class projection over the immutable chain: re-derivable, never canonical, never read-as-fact.** Not an alternative store; not a new state class; a *projection layer*.

This is the single most important finding, and it is a **REFRAME of existing v6 text, not a change**. §0a.3.1 (`v6:171`) already enumerates "persona-memory *summary/dashboard* projections" as a canonical example of a derived view. A Karpathy wiki page IS that: an LLM-rendered summary surface laid *on top of* the canonical chain for informational navigation. The four-class table (`v6:509`) lists "endorsement-view projection" as a Deterministic-Theorem — a wiki page re-derived by chain-replay is the *same kind of object, one level up*.

**Why the wiki taken literally is an A8 *violator* (the clash that must be reconciled):** Karpathy's wiki mutates synthesis pages **in place** — "updating entity pages, revising topic summaries" (Finding 2). That is a **bare UPDATE**, which §5a.1 categorically forbids (`v6:916`): "No bare UPDATE; SUPERSEDE writes a sibling record." §5a.1 spells out the exact cost of violating it (`v6:926`): bare UPDATE would "(a) break A8 (chain ceases to be content-addressed because record content can change underneath its `transaction_id`), (b) make concurrent readers see inconsistent states, (c) eliminate the audit-trail property." So the wiki's *write* model is rejected; only its *read/navigation* model is borrowed.

**The reconciliation (3 mechanical steps, all on existing primitives):**

1. **Every wiki "edit" → a SUPERSEDE transaction.** "Revise topic summary" = append a SUPERSEDE record whose `affected_records` points at the prior summary's `transaction_id` (`v6:916`, `:922`). The predecessor stays in the WAL (immutable); the wiki page is the **latest non-superseded projection**. This is *exactly* the v3.5 RFC's `supersede (new info)` manage-op (`v3.5 RFC:163`).
2. **The rendered wiki page → a re-derivable projection.** Computed by `walkChain()` skipping `superseded`/`tombstoned`/`NOT_APPLICABLE` (`v6:568`, `:939`), governed by §0a.3.1's No-Amplification constraints. The §5a.1 lifecycle-state machinery (`active`/`superseded`/`tombstoned`, `v6:930`) is *already* a derived-view projection — the wiki page is the same object shape.
3. **Cache invalidation → the existing `DERIVED-VIEW-INVALIDATE` signal** (`v6:538`, `:924`). The wiki's "lint pass found a contradiction → re-render the page" maps onto invalidate-then-recompute. Crucially, DERIVED-VIEW-INVALIDATE is **NOT state-changing** (`v6:459`, carries `commit_outcome: NOT_APPLICABLE`, MAY carry empty `evidence_refs`) — so re-rendering the wiki cache costs no A10 evidence-link.

**Verdict:** Adopting the wiki does **NOT require violating A8 — provided it is a projection/cache over the chain, re-derivable, never canonical, edits as SUPERSEDE.** The wiki's own substrate choice ("just a git repo of markdown files", Finding A) makes the compliant path natural — git is itself content-addressed + append-only + mutable-HEAD, structurally the same shape as the chain + Memory Root Pointer (§5a.9). The wiki's "LLM revises pages in place" framing makes the *non*-compliant path tempting. **Choose SUPERSEDE + projection.**

### B.1 Four-class placement (a wiki entry decomposes by sub-part)

A wiki "entry" is not one class — getting the decomposition right IS the answer (grounded against `v6:506-511`):

| Wiki construct | Power Loom class | Why (v6 anchor) |
|---|---|---|
| Raw source document | **Axiom** | Immutable input the LLM "reads but never modifies" = "Irreducible, deterministic inputs… immutable per A8" (`v6:508`). Clean 1:1. |
| `log.md` (append-only ingest/query record) | **Attestation** | "Action witnesses; verifiable proofs that something happened" (`v6:511`). The WAL *is* Power Loom's `log.md`. Clean 1:1. |
| Synthesis *content* of an entity/concept page (LLM prose) | **Stochastic Sample** | LLM re-rendering; "re-derived on demand; never authoritative" (`v6:510`). **Reading this back as ground truth is the exact category error §0a.3.1 + A10 exist to prevent.** |
| The wiki page *as materialized artifact* (index.md, rendered page) | **Deterministic Theorem (derived view)** — iff pure + re-derivable | "pure functions of axioms… recoverable trivially on miss" (`v6:509`). Re-derivable-by-replay ⇒ legitimate view (like `endorsement-view projection`). Hand-edited-not-re-derivable ⇒ NOT a theorem, forbidden as canonical. |
| Cross-reference / "contradicts" link | **Stochastic Sample** (content) + **Attestation** (emission) | This IS the v3.5 RFC **semantic causal edge**: "LLM-asserted… canonical CREATE record… start `candidate`, carry stochastic-content tagging" (`v3.5 RFC:224-226`). Inherits `faithfulness_status=unvalidated` (R1 fail-closed default, `v3.5 RFC:180`). |

**The load-bearing placement verdict:** a wiki entry is **NOT Axiom-class** (the human *source* is the axiom; the synthesis is not). Its content is a **Stochastic Sample**; its materialized page is a **Deterministic-Theorem-class derived view**, admissible *only* if re-derivable from the chain. **Power Loom would refuse to store a Karpathy wiki page as canonical memory** — it stores the evidence + transitions in the chain (Axioms + Attestations) and **re-derives the wiki page as a cache.**

### B.2 Which gap does this address? — OQ-27 read-side (the most valuable finding)

**It addresses the admitted READ-SIDE gap (OQ-27), as a *retrieval strategy*, not a storage model.** It is **NOT** an alternative to the v3.5 causal-graph — it **composes with** it.

Power Loom's own RFC concedes the read-side is under-built: "the read-side traversal algorithm (OQ-27 — v6's 'deepest under-specified concern')" (`v3.5 RFC:294`); "K4 tri-signal ranker… addresses neither" (`:316`). The wiki's entire mechanism — "read `index.md` first to locate relevant pages, then drill into full pages" — **is** context-assembly, i.e. the OQ-27 problem.

- **Relevance: YES, meaningfully — at moderate scale.** The wiki contributes **nothing** to the write-side (Power Loom's A8/A9/A10 WAL is strictly more rigorous). It contributes a concrete, RAG-free **read-side discipline** Power Loom lacks below the v3.5 line.
- **Hybrid, not alternative (the clean composition):**
  - The **v3.5 causal-graph** answers *"what is connected to what, and is the connection trustworthy?"* — typed-edge traversal with a hard trust gate (R3: `unvalidated`/`surface_overlap_only` edges are "AUDIT-ONLY — invisible to read-side context-assembly", `v3.5 RFC:128-139`).
  - The **wiki** answers *"how do I assemble a readable, pre-synthesized context window cheaply without embeddings?"* — index-and-summary navigation.
  - **Composition:** the wiki's **`index.md` + per-page summaries become the OQ-27 traversal's seed-and-rank surface** (the RFC flags the seed policy as open — "OQ-B… read-side seed + edge-walk policy — still open", `:316`), while the wiki's **synthesis pages become Deterministic-Theorem derived views** that the causal-graph edges point into. The causal graph supplies the **trust gating + typed relations** the wiki entirely lacks; the wiki supplies the **cheap, human-legible, compounding navigation surface** the causal graph lacks. **Adopt the wiki as the OQ-27 read-side projection layer; keep the causal graph as the trust-gated edge substrate underneath.**

**Honest scaling caveat:** the RAG-free claim holds at the wiki's stated scale (~100 sources / hundreds of pages, Finding A). Power Loom's persona-memory chain at maturity may exceed that, at which point the wiki's own escape hatch (optional BM25/vector) re-introduces the embedding infra it claimed to avoid — and Power Loom's **OQ-24 compaction** lever (`v3.5 RFC:307`) becomes relevant. The wiki helps OQ-27 *at moderate scale*; it does not retire retrieval-at-scale.

### B.3 Concrete mechanism (where it hangs off the substrate)

- **Storage:** nothing new. Axioms (sources) + Attestations (the WAL at `~/.claude/checkpoints/attestation-log.jsonl`, `v6:955`) are the substrate. The wiki is a **projection materialized into a cache** (a read-through view), invalidated via `DERIVED-VIEW-INVALIDATE`.
- **`index.md` projection:** a Deterministic-Theorem view = `walkChain()` filtered to `active` records, grouped by topic/entity, emitting a catalog. Re-derivable ⇒ A8-clean. This is the OQ-B seed surface.
- **Per-entry summary projection:** pre-synthesized summary lines as Theorem-class views reducing read-time token cost. **Must be re-derivable** — if a summary is LLM-authored-and-frozen, it is a Stochastic Sample and must be tagged as such, surfaced advisory-only, and excluded from any state-transition input (§0a.3.1, `v6:175`).
- **Lint pass:** maps onto the v3.5 RFC **stochastic-manage dream cycles** (`v3.5 RFC:50-56`) — contradiction/stale/orphan detection ships **strictly as advisory (A3b)**, non-blocking, audit-logged. A flagged contradiction emits a `flag-conflict` semantic-edge CREATE (`v3.5 RFC:164`) that starts `candidate`/`unvalidated` and **MUST NOT remove either record from the OQ-27 walk** without R2 authority (`v3.5 RFC:193`) — the wiki has no such guardrail, so this is where Power Loom *hardens* the borrow.

### B.4 v6 anchors / release / effort

- **v6 anchors:** A8 (`v6:424-434`); §5a.1 SUPERSEDE + no-bare-UPDATE (`v6:914-941`); §0a.3.1 No-Amplification + the A6-snapshot carve-out (`v6:169-187`); four-class state (`v6:506-511`); A10 evidence-linked admission + bootstrap sentinels (`v6:453-467`); `DERIVED-VIEW-INVALIDATE` semantics (`v6:459`, `:538`). v3.5 RFC: R1-R4 spine (`:80-152`), semantic-edge schema (`:217-261`), OQ-27/OQ-B (`:294`, `:316`), dream-cycle manage (`:50-56`).
- **Target release:** **v3.5** for the wiki-as-read-side projection layer (it *is* the memory-manage / OQ-27 phase); the `index.md` + summary projections can prototype in **v3.3** as Lab-tier derived views (the Evolution Lab is where derived views first land — `v6:215`). Sequence: causal-edge substrate (v3.5) → wiki projection on top (v3.5).
- **Effort:** **M-L.** The projection logic (index + summary derived views) is M; the dream-cycle lint integration is M (composes with the v3.5 manage layer); getting the SUPERSEDE-edit discipline + cache-invalidation right is the careful part. No kernel change ⇒ no high-risk surface.
- **Pillar:** Pillar 3 (auditable derived view) — and it materially advances OQ-27, the read-side hole.

### B.4a — Launch preconditions + adversarial-review corrections (the 3-lens pass)

> Folded in from the architect / honesty-auditor / hacker review. The two HARD gates (H1/H2) are **not deferrable open questions — they gate the first wiki build**.

1. **WRITE-path gate (hacker H1, HIGH — kernel-attested writer identity / OQ-E).** The SUPERSEDE-edit discipline (B.0 step 1) is security-meaningless without kernel-attested writer identity. **Probed 2026-06-02: it does not exist** — `grep kernel:gc-sweep|kernel:retention|KERNEL_WRITERS|isKernelWriter packages/kernel/**` returns empty, and `writer_persona_id` is input-derived (`spawn-record.js`, from `toolInput.subagent_type||…`). So any spawn can field-stuff `writer_persona_id: kernel:source-trust` and author a **poison SUPERSEDE** (the MINJA memory-poisoning class, 95%+ ASR with few records). The wiki *amplifies* this by normalizing high-volume LLM-authored writes. **No wiki-write path ships before OQ-E.** Interim (fail-closed): non-privileged writer class + `faithfulness_status=unvalidated`; NO destructive SUPERSEDE/TOMBSTONE against an `active` record from a wiki path (R2 collapses to kernel-personas-only). **INV-22 (shipped) closes forged-key record-*suppression* but NOT writer-*authentication* — do not conflate** (hacker AFFIRM-2). Restate B's "SAFE" as **"SAFE only because unbuilt; UNSAFE the moment it ships without OQ-E."**

2. **READ-path gate (hacker H2, HIGH — datamarking before peer-context entry).** §0a.3.1's "MUST NOT be propagated as instruction-text into peer LLM contexts" (`v6:175`) is **normative prose with ZERO runtime enforcement today** (probed: no datamarking at the read/assembly boundary). The wiki's entire value is to **be** the read-side context-assembly surface (B.2) — placing attacker-influenceable LLM prose on exactly the path that clause is meant to guard (MemMorph read-back-as-instructions). **The wiki read-projection MUST NOT enter a peer spawn's instruction context until a datamarking / trust-boundary envelope wraps wiki prose as untrusted DATA, never instructions** — the L1–L3 atom Part A already names as borrowable (prior-doc T2), here wired into Part B where it is load-bearing. (R3's faithfulness gate, also unbuilt, is the complementary edge-level control; the B.2 "wiki seeds, K4 ranks, R3 trust-gates" composition **assumes R3 enforcement that does not yet exist** — re-probe at plan time.)

3. **EGRESS guard (hacker H3, MED — C1/C3).** C1 (Graphiti-style edge extraction) and C3 (Letta-style background materializer) re-introduce an LLM pass over memory content. As **local/Anthropic-only** steps they add no egress surface (a fair LOW). **But if either is ever wired to a non-Anthropic vendor, it inherits the prior doc's T1 launch requirements VERBATIM** — fail-closed pre-egress secret scrubber on the content read + data-governance opt-in — because the egress audit is Bash-verb-only (evadable via interpreter/MCP) and the worktree is not a sandbox (p-writescope). The "no new egress surface" claim holds ONLY while extraction stays local.

4. **CAPABILITY guards (hacker H4, MED — persona depth).** (a) **A2** — the generated capability/tool table is a **DISPLAY projection, NEVER the capability source of truth**; static `tools:` frontmatter + the reconciliation validator (ADR-0012) remain the only authority; the generator is strictly one-directional (contract→doc-scaffold) and CI must assert it can never be the input to capability assignment. (b) **A5** — a handoff artifact is a derived-view-shaped object, bound by §0a.3.1 "MUST NOT widen K6/K8 scope" (`v6:175`): may narrow, never widen the receiving spawn's capability.

5. **LAYER correction (architect F4, MED).** The `index.md` + summary projections (B.4) are **Runtime/memory-layer derived views** (Pillar 3, composing with K4 recall + the v3.5 causal-graph), **NOT Evolution-Lab E-primitives**. The draft's "the Evolution Lab is where derived views first land — `v6:215`" was a misread: `v6:215` is a Pillar-Coverage-Table row (E-primitives serve Pillar 3 when snapshotted); it is not a law that derived views are Lab-tier. E14 is one derived view that happens to live in `packages/lab/`, not a layer rule. They may prototype cheaply, but the **owning layer is Runtime/memory**.

6. **A1 OQ-E scope (architect F8, MED).** A1's grounding floor verifies **CONTENT-resolvability** (`{file, line_start, line_end, cited_text}` vs the in-scope delta — delta-anchored, OQ-E-independent, so A1 is **not** blocked by OQ-E). But the **EMITTER-identity** half of the GPT-1.C attestation stays OQ-E-gated: `spawn_id` is kernel-minted (attested); `writer_persona_id` is input-derived (not). A1 leans on `spawn_id` for any identity claim and must not read the persona label as kernel-attested until OQ-E resolves.

7. **Wording nits (honesty-auditor).** The wiki is **a strong CANDIDATE** OQ-27 read-side projection layer, not "THE" layer (OQ-27/OQ-B are OPEN; fail-closed default = no traversal until an R3-honoring walker lands) (HA-3). A1's new contract check is **`F8`** (`03-code-reviewer.contract.json` already uses `F7` for the Principle-keyword check); the `functional[]`/`antiPattern[]` counts vary per persona (HA-2).

### B.5 REJECT list (what about a "wiki" must be refused to preserve the axioms)

1. **In-place mutation of synthesis pages as canonical.** "Updating entity pages, revising topic summaries" as byte-rewrites. **Rejected: violates A8** (`v6:426-428`) + §5a.1 no-bare-UPDATE (`v6:916`). Replace with SUPERSEDE-as-sibling + projection (B.0). Non-negotiable.
2. **LLM-authored wiki prose read back as fact.** The wiki treats synthesis pages as the trusted thing you consult. **Rejected: violates §0a.3.1 No-Amplification** + four-class "Stochastic Samples never authoritative" (`v6:510`). Content stays Stochastic-Sample-tagged; only the evidence-linked re-derivable projection is consumable, and even then it "MUST NOT enter as input to any state transition that writes a kernel-canonical record" and "MUST NOT be propagated as instruction-text into peer LLM contexts" (`v6:175`).
3. **Unevidenced entries.** The wiki lets the LLM "file a good Q&A answer as a new page" with no evidence. **Rejected: violates A10** — "Every memory transaction MUST carry non-empty `evidence_refs`" (`v6:455`). A wiki write must carry `evidence_refs` or a bootstrap sentinel (`v6:461-467`); a free-floating LLM page is rejected at K9 pre-commit.
4. **"Contradiction notes" used to suppress/gate without a trust model.** The wiki lint-flags contradictions but applies no faithfulness gate before *relying* on a link. **Rejected as-is: violates R3** — semantic edges must be `advisory_llm_checked`+ to be traversal-eligible; `surface_overlap_only` is AUDIT-ONLY (`v3.5 RFC:128`). Borrow the contradiction-*detection*; reject *unconditional reliance*. (And per R2-note `v3.5 RFC:193`, a flagged contradiction must not bury either record from the OQ-27 walk — the wiki has no equivalent, so it would enable exactly the "spurious contradiction buries a legitimate record" failure the RFC closes.)
5. **"The model doesn't care about structure, it just reads text"** (the *blog's* framing B2, NOT the gist's). **Rejected** — incompatible with Power Loom's class-precise, evidence-linked, schema-validated discipline; structure (the chain, the four classes, the contracts) IS the value. The gist actually *agrees* with Power Loom that the schema/structure is the mechanism.
6. **Memory-poisoning surface (from Finding 3 + the sweep).** "File a good answer as a page" + "LLM-extracts-facts-stored-as-memory" (Mem0/Graphiti pattern) is the **MINJA attack class** — injected instructions persisting across sessions, 95%+ injection success, detectors miss ~66% (`similar-sources Finding 6`). **Rejected** unless every entry is provenance-traced + sanitized-before-persist + trust-scored-at-retrieval — which is exactly A10 + four-class + R3. The defense IS the architecture; the wiki lacks it.

---

## PART C — OTHER BORROWS (from the similar-sources sweep) + convergent signals

Tight rubric. **All five convergent signals are REFRAMES that *validate* existing axioms** — except the two concrete schema borrows (C1, C2), which are genuine additions.

### C1 — Zep/Graphiti invalidate-don't-delete + bi-temporal edge validity (VERIFIED borrow; HIGH value)

- **Gap:** the v3.5 causal-edge schema has lifecycle states (`active`/`superseded`) but no explicit *validity-interval* representation for "this edge was true from T1 to T2."
- **Proposed mechanism:** borrow Zep's bi-temporal edge-validity *mechanics* (validity intervals; conflicting facts invalidated via `t_invalid`/`t_expired`, **never discarded**) as additive fields on the v3.5 semantic-edge schema. This is the closest external analog to A8 append-only — it shows how to represent "no longer current" *without mutation*.
- **v6 anchor:** §5a.1 SUPERSEDE (`v6:916`) — invalidate-don't-delete IS SUPERSEDE-as-sibling. v3.5 semantic-edge schema (`v3.5 RFC:217-261`).
- **Layer:** Runtime/Lab (the edge producer is advisory; the schema is kernel-adjacent). **Conflict guard:** Graphiti uses an LLM to *extract* edges at write time — in Power Loom that extraction is **Stochastic, not fact** (four-class), so it must be a Runtime-advisory producer feeding the graph through the A10 gate, never a kernel-trusted write. Borrow the *edge-validity mechanics*; quarantine the *LLM extraction* to Runtime-advisory.
- **Release:** v3.5. **Effort:** **S-M** (additive schema fields + validity-projection logic). **Pillar:** Pillar 3.
- **Caution (verified):** Zep's benchmark numbers (94.8% DMR, +18.5% LongMemEval) are vendor-published on self-selected evals — at least in a peer-reviewable arXiv paper (more credible than Mem0's blog-only claims), but **cite as *claimed*, never established**. The *architectural pattern* is the borrow, not the leaderboard.

### C2 — Cline typed-file load-order as the OQ-27 seed schema (VERIFIED borrow; MED value — composes with Part B)

- **Gap:** OQ-B (read-side seed policy) is open (`v3.5 RFC:316`); no deterministic "what to load and in what dependency order."
- **Proposed mechanism:** borrow Cline Memory Bank's typed-file hierarchy with strict load order (`projectbrief` → `productContext`/`systemPatterns` → `activeContext`/`progress`) as the *ontology* for the wiki's `index.md` seed surface (Part B). A deterministic load-order IS the projection layer Power Loom lacks.
- **v6 anchor:** composes with Part B's `index.md` projection; §0a.3.1 derived-view (`v6:171`).
- **Layer:** Runtime (read-side projection). **Conflict guard:** Cline *rewrites these files in place* — borrow the **schema/ontology of file types, NOT the rewrite-in-place lifecycle**. Tag by provenance class or it collides with the four-class split.
- **Release:** v3.5 (with Part B). **Effort:** **S.** **Pillar:** Pillar 3.

### C3 — Letta sleeptime as the background "manage" actor model (VERIFIED pattern; MED value — validates v3.5)

- **Gap:** the v3.5 manage layer + background materializer needs an actor model.
- **Proposed mechanism:** Letta's sleeptime (a background agent that reflects offline and writes "learned context, **not ground truth**") is the model for Power Loom's deferred v3.5 dream-cycle / background materializer. Letta is *explicit* the output is derived-insight-not-truth — independently agreeing with the four-class split.
- **v6 anchor:** v3.5 dream-cycle manage (`v3.5 RFC:50-56`, `:162` merge starts `candidate`). The MEMORY-noted "close-path git is synchronous → decouple to a background materializer" is exactly this lever.
- **Layer:** Runtime/Lab. **Conflict guard (verified):** Letta sleeptime "*can modify the memory blocks of the primary agent*" — in-place block mutation, an **A8 violation if taken literally**. Implement the *intent* (offline consolidation) as **append a derived-record + SUPERSEDE edge**, never an in-place rewrite. Memory-blocks-as-mutable-RAM is the core disagreement.
- **Release:** v3.5. **Effort:** **M** (composes with the deferred background-materializer work). **Pillar:** Pillar 3.

### C4 — Memory-poisoning defense triad as the v3.5 manage-layer security contract (VERIFIED constraint; HIGH value)

- **Gap:** the v3.5 manage layer's write path needs a stated threat model.
- **Proposed mechanism:** adopt the MINJA/A-MemGuard/Schneider defense triad — **(1) trace every entry to a trusted source, (2) separate data from instructions, (3) sanitize-before-persist** — as the explicit security contract. This is *near-verbatim* Power Loom's content-addressing + A10 + four-class split; it converts the posture from "design opinion" to "empirically-recommended defense."
- **v6 anchor:** A10 (`v6:453`), §0a.3.1 (`v6:169`), four-class (`v6:506`), R1-R4 spine (`v3.5 RFC:80-152`).
- **Layer:** cross-cutting (kernel A10 + Runtime sanitizer). **Release:** v3.5. **Effort:** **S** (largely documentation + wiring existing gates; the architecture already implements the triad). **Pillar:** Pillar 2 + Pillar 3.
- **Note:** this is a *constraint, not a system* — it confirms Power Loom's append-only-with-provenance bet is the safety-correct direction. The strongest external endorsement in the sweep.

### Convergent signals (what multiple independent systems agree on — all REFRAMES)

1. **Externalize memory + pass references, not content.** Anthropic multi-agent + native memory tool + Letta + Cline + Devin all converge. **Validates** Power Loom's append-to-store-and-reference shape is field consensus — and pinpoints the gap is *read/projection*, not the store. (REFRAME.)
2. **Supersede, don't destroy.** Zep/Graphiti invalidate-don't-delete is closer to A8 than the mutate-in-place camp. Power Loom is on the right side; Zep gives the concrete edge-schema (C1). (REFRAME + the C1 borrow.)
3. **Background/offline consolidation as a separate actor is emerging standard.** Letta sleeptime + LangMem background managers + Mem0 async. **Validates** the deferred v3.5 manage layer + background materializer (C3). (REFRAME.)
4. **Declarative top-down roles beat emergent chat for verification.** CrewAI (role/goal/backstory, cheaper) vs AutoGen (emergent) — efficiency data favors declarative. **Validates** Power Loom's deterministic verification-board over conversational swarms (A5). (REFRAME.)
5. **Provenance + "memory content untrusted by default" is the security consensus.** Memory-poisoning literature + Anthropic memory-tool guidance. **Validates** content-addressing + four-class (C4). (REFRAME.)

---

## PART D — V6 IMPACT + PHASE SAFETY


> **Release-label provenance (architect F1 — important correction).** The v6 §6 **LOCKED** release plan enumerates phases only through **v3.4** (§6.8 v3.3 = Evolution Lab Foundation E1–E4; §6.9 v3.4 = Evolution Lab Full; §6.10 = Deferred v3.5+: ContainerAdapter, Dream-Lite E13). The "v3.3 dream-cycle / v3.5 memory-manage / wiki-projection" phase language used in this doc is borrowed from the **separate v3.5-memory-RFC DRAFT**, whose own header says it "amends NOTHING; v6 stays LOCKED" and "is NOT a claim anything ships before v3.3." **Read the memory-side release labels (Part B, C1, C2) as aspirational v3.5-RFC-CANDIDATE scope — post-v3.4, pending a scope decision the RFC itself has not made — NOT committed v6 phases.** Persona-depth (Part A) is the exception: it is genuinely **v3.2-shaped** (Runtime decomposition, §6.7, a locked phase). The safety verdict (nothing touches shipped v3.0-alpha/v3.1) is unaffected and independently verified (architect F2).
>
> **Buildable set vs validation set (architect F6).** Genuinely new build work = **A1** (the F8 grounding check), **A2** (contract→doc-scaffold generator + CI freshness test), **A3** (deterministic-trigger-in-contract pattern), **C1** (bi-temporal edge-validity schema fields), **C2** (typed-file seed ontology). The rest — **A4, A5, C3, C4** — is **external corroboration that validates existing design, not scoped build work** (itemized with effort rows for completeness; do not mistake for backlog). Honest net-new surface: five items, three of them small.

| Borrow | Change or Reframe | Layer | Touches shipped phase? (v3.0-alpha / v3.1) | Target future phase | Risk |
|---|---|---|---|---|---|
| A1 — per-finding grounded-confidence gate | **Reframe** (GPT-1.C split `v6:504`) | Runtime persona + pure-fn sanitizer | **NO** — personas live in `packages/runtime/`; sanitizer is new, not a kernel edit | v3.2 | **LOW** |
| A2 — doc-gen-from-contract + CI freshness | Reframe (contracts are Axiom-class `v6:508`) | Runtime + CI tooling | **NO** — additive generator + CI gate; no kernel touch | v3.2 / opportunistic | **LOW** |
| A3 — deterministic forcing-functions in contract | Reframe (pillar-grounding test `v6:219`) | Runtime advisory | **NO** — contract-additive | v3.2 | **LOW** |
| A4 — scout-not-gate outside-voice | Reframe (corroborates prior-doc B2) | Runtime | **NO** | v3.2 | **LOW** |
| A5 — typed-artifact lens handoff | Reframe (§4.2 envelope `v6:526`) | Runtime orchestration | **NO** — envelope already shipped; handoff-wiring is new | v3.2 | **LOW** |
| B — wiki as derived-view read-side projection | **Reframe** (§0a.3.1 already names it `v6:171`) | Runtime/Lab read-side | **NO** — read-side is unbuilt below v3.5 | v3.3 proto / v3.5 | **LOW** |
| B (mis-implemented: canonical mutable markdown) | *Would be a CHANGE* | *Would touch kernel A8* | *Would be YES — see Part F* | — | **HIGH if mis-built** → DO-NOT-FOLD |
| C1 — Zep bi-temporal edge validity | Change (additive schema) | Runtime/Lab + schema | **NO** — v3.5 schema unbuilt | v3.5 | **LOW** |
| C2 — Cline typed-file load-order | Reframe (OQ-B seed) | Runtime read-side | **NO** | v3.5 | **LOW** |
| C3 — Letta sleeptime background actor | Reframe (validates v3.5 manage) | Runtime/Lab | **NO** | v3.5 | **LOW** |
| C4 — memory-poisoning defense triad | Reframe (validates A10 + four-class) | cross-cutting | **NO** — largely doc + existing gates | v3.5 | **LOW** |

**The verdict (honest and specific): NOTHING requires revisiting a shipped phase. It ALL folds into v3.2 / v3.3 / v3.5.**

- **v3.0-alpha (kernel) — UNTOUCHED.** No borrow edits kernel code. The wiki rides A8/§5a.1/§0a.3.1 as a *consumer* of primitives that already shipped; the four-class taxonomy and SUPERSEDE discipline are pre-existing. Schema-additive changes (C1 edge-validity fields, the `verification` envelope field from the prior doc) land in `INV-K2-SchemaForwardCompat`'s tolerance window (`v6:528`) — additive, not breaking.
- **v3.1 (Runtime Foundation) — UNTOUCHED.** Personas + contracts (Runtime) are *extended* (A1-A5 add `functional[]` checks, a generator, handoff-wiring), never restructured. The capability layer (R1-R4) is untouched. **One forward-coupling to flag (not a blocker):** A1's grounded-finding sanitizer and B's faithfulness gating both *lean on* `writer_persona_id` being kernel-attested — which the v3.5 RFC R1-caveat (`v3.5 RFC:84-98`) flags as NOT yet kernel-attested in the shipped envelope (`spawn-record.js` derives the persona label from input). This is a *pre-existing v3.5 open question (OQ-E)*, not a regression these borrows introduce — but the borrows inherit its fail-closed default (`assertion_class` defaults to `stochastic_sample` on an un-attested writer, `v3.5 RFC:91`). Flag it so the plan phase doesn't assume attested writer identity.

**The single sharp edge:** the wiki is LOW-risk *as designed* (derived view) and HIGH-risk *only if mis-implemented* as canonical mutable markdown. That failure mode is the difference between "rides A8" and "violates A8." It is on the DO-NOT-FOLD list (Part F) precisely because the temptation is real (Karpathy's framing invites it) and the cost is the whole moat.

---

## PART E — OPEN QUESTIONS for the plan phase

1. **OQ-HYBRID-1 — Soft floor vs hard drop for internal grounded-confidence (A1).** gstack's variant force-suppresses to confidence 4-5 (soft); the prior doc's cross-model sanitizer hard-drops. **Decision path:** recommend **soft floor for internal HETS findings** (preserves signal, advisory-compatible), **hard drop for cross-vendor** (sharper T6-flooding threat). Confirm with the code-reviewer persona owner; encode the chosen behavior in the `F7` contract check.

2. **OQ-HYBRID-2 — Wiki projection materialization: lazy vs eager (B.3).** Is the wiki page computed on-demand (lazy, always-fresh, higher read latency) or materialized-into-cache + invalidated (eager, faster reads, invalidation-correctness burden)? **Decision path:** start **lazy** (YAGNI — re-derive on read; the wiki's own "just read index + pages" is lazy at its scale); promote to cached-with-`DERIVED-VIEW-INVALIDATE` only if read-latency profiling at v3.5 scale demands it (ties to OQ-24 compaction).

3. **OQ-HYBRID-3 — `writer_persona_id` attestation dependency (the cross-cutting one).** A1's sanitizer and B's faithfulness gate both want kernel-attested writer identity, which is v3.5 OQ-E (un-attested today, `v3.5 RFC:84-98`). **Decision path:** adopt the v3.5 R1 **fail-closed default** (un-attested writer ⇒ `stochastic_sample`, no auto-promotion) for both borrows; do NOT block these borrows on OQ-E, but do NOT assume attested identity. Re-probe OQ-E status at plan time.

4. **OQ-HYBRID-4 — Where does the wiki projection sit relative to K4 recall?** K4 is the deterministic tri-signal ranker (`v6:509`); the wiki `index.md` is a competing/complementary seed surface. **Decision path:** the wiki feeds the OQ-27 *walk seed*, K4 ranks *within* a result set — frame them as composed (wiki seeds, K4 ranks, R3 trust-gates), not competing. Confirm against the OQ-B seed-policy decision when v3.5 specs the walker.

5. **OQ-HYBRID-5 — Zep edge-validity fields: additive to the v3.5 semantic-edge schema, or a separate validity-projection? (C1)** **Decision path:** prefer **additive fields** (DRY — the semantic-edge record already inherits the §4.2 envelope; add ~2 validity-interval fields per the `v3.5 RFC:234` "~6 new fields, not a shadow schema" precedent) over a parallel structure. Validate against R4 closed-enum + K5 canonicalization (`v3.5 RFC:144-152`).

6. **OQ-HYBRID-6 — Doc-gen scope: which persona sections are generatable? (A2)** Over-templating bespoke personas is YAGNI-negative. **Decision path:** generate ONLY the deterministic scaffolding (capability table, tool list, F-check audit checklist) from the contract; **never** generate Identity / Mindset / Focus (the un-generatable cognitive brief). Pilot on one persona; measure drift-reduction before fleet rollout.

7. **OQ-HYBRID-7 — Runtime-state re-probe (state moves).** Re-verify at plan-time commit: `spawn-record.js` persona-label derivation (the OQ-E dependency); the persona/contract reconciliation validator's current generation-vs-check behavior (A2 target); the v6 line anchors cited here (`:171` §0a.3.1, `:424` A8, `:504` GPT-1.C, `:506` four-class, `:916` §5a.1, `:455` A10) after any v6 re-numbering; the v3.5 RFC's DRAFT status (it is a DRAFT — confirm R1-R4 + OQ-27/OQ-B haven't moved). **Decision path:** a one-line `grep`/`ls` probe per claim per the Runtime-Claim Probe discipline; this doc's anchors were read at the current HEAD but the v3.5 RFC is explicitly a draft.

---

## PART F — EXPLICIT NON-GOALS / DO-NOT-FOLD

Each cites the axiom/pillar it would violate.

1. **The wiki as canonical, in-place-mutated markdown files.** The literal Karpathy implementation. **Violates A8** (`v6:426`) + §5a.1 no-bare-UPDATE (`v6:916`) — forfeits content-addressing, concurrent-reader consistency, and the audit trail (`v6:926`). This is the *whole moat*. The wiki is admissible *only* as a SUPERSEDE-edited derived-view projection (Part B). **The single most important non-goal in this document.**

2. **Reading LLM-authored wiki prose back as fact.** **Violates §0a.3.1 No-Amplification** (`v6:175`) + four-class "Stochastic Samples never authoritative" (`v6:510`). Synthesis content stays Stochastic-Sample-tagged; it MUST NOT enter any kernel-canonical state transition or propagate as instruction-text into peer LLM contexts.

3. **Unevidenced wiki writes ("file a good answer as a page").** **Violates A10** (`v6:455`) — every memory transaction needs non-empty `evidence_refs` (or a bootstrap sentinel). Also the **MINJA memory-poisoning surface** (Finding 3 + sweep C4).

4. **LLM-extracted "facts" stored as canonical memory (Mem0 / Graphiti write-time extraction).** **Violates the four-class split** — extracted content is Stochastic, not fact (`v6:510`); it must be a Runtime-advisory producer through the A10 gate, never a kernel-trusted write. This IS the MINJA attack class (95%+ injection success).

5. **Cross-model / outside-voice findings gating promote/reject.** **Violates Axiom 3a** (gating must be pure) — a stochastic label blocking the path. Carried from the prior doc; restated because A1/A4 introduce more grounded findings and the temptation to "promote a high-signal finding into a blocker" grows. A finding is a **scout**, not a gate (prior doc B2); any resulting gate must stand on its own pure legs.

6. **AutoGen-style emergent conversational coordination in any gating path.** **Violates Axiom 1 / A6** — "agents converse until resolved" is non-deterministic + un-replayable (sweep item 8). Fine for generation/brainstorm; never for the verification board. Borrow CrewAI's declarative roles instead.

7. **gstack's prompt-level guards (`/freeze` `/guard`) as a containment mechanism.** **Regression vs Pillar 4** — Power Loom's static `tools:` + K9/K14 + reconciliation validator are *mechanism-based*; prompt-level discipline is strictly weaker (verified: gstack's mechanism is "opaque/absent").

8. **The browser/runtime-execution gate (re-stated, do not re-litigate).** **Violates Axiom 1/3a + A6** — already REJECTED (prior doc B5). The one transferable atom (L1-L3 datamarking) is already captured as T2; the rest serves a delivery org.

9. **Same-vendor review recorded as cross-vendor; degraded verification recorded as full.** **Violates Pillar 3 (auditable honesty)** — carried from the prior doc's C4; a degraded-but-honest verdict outranks a fake green check.

---

## KB Sources Consulted

- `kb:architecture/crosscut/information-hiding` — informed the wiki-as-derived-view boundary: synthesis content (Stochastic) is hidden behind a re-derivable projection interface; callers consume the view, never the raw LLM prose, mirroring §0a.3.1's read-time constraints.
- `kb:architecture/crosscut/single-responsibility` — informed keeping the grounded-confidence sanitizer (pure-fn) separate from the persona producer (Runtime), and the stakes-classifier as a sibling module rather than a `route-decide` axis (Part A3/A5; prior-doc MED-2 precedent).
- `kb:architecture/discipline/trade-off-articulation` — informed surfacing the sacrifice in every borrow (the wiki gives cheap navigation but sacrifices nothing only if SUPERSEDE-disciplined; doc-gen has lower ROI for bespoke personas than gstack's fleet).
- `kb:architecture/ai-systems/rag-anchoring` — informed the OQ-27 composition (wiki index-first navigation as a RAG-free seed surface that composes with, not replaces, the trust-gated causal graph; and the honest moderate-scale caveat where embeddings re-enter).
- `kb:design-pushback/_index` — scanned the borrow set for known anti-patterns at intake (in-place mutation, unevidenced writes, LLM-content-as-fact all flagged → routed to the Part F DO-NOT-FOLD list).

---

**Files referenced (absolute paths):**
- `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/specs/research/2026-06-01-gstack-comparison-and-cross-model-review.md` (prior doc — rubric + advisory invariants adopted)
- `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/specs/rfcs/v6-substrate-synthesis.md` (A8 `:424`, four-class `:506`, §0a.3.1 `:169`, §5a.1 `:914`, A10 `:453`, §4.2 envelope `:526`, GPT-1.C `:504`)
- `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md` (R1-R4 `:80`, semantic-edge schema `:217`, OQ-27/OQ-B `:294`/`:316`, dream-cycle `:50`)
- `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/runtime/personas/04-architect.md` + `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/runtime/contracts/04-architect.contract.json` (the persona role-brief + JSON-contract DEPTH being extended)

---

## PART G — HETS Cross-Validation Appendix (3-lens adversarial review)

Three read-only lenses ran in parallel against the synthesis draft (architect / honesty-auditor / hacker). **All three verdicts: APPROVE-WITH-CHANGES** — the core reframe (wiki-as-derived-view, A8-reconciled; persona-depth as verification-lens rigor) survived all three; the changes (folded into §B.4a + the Part-D caveat above) harden unbuilt enforcement into launch preconditions and correct the phase labels. Full finding bodies below.

### verify:honesty-auditor — **APPROVE-WITH-CHANGES**

> Every v6/v3.5-RFC line anchor verifies against source and the shipped-phase-safety claim is sound; the one real overclaim is the opening "all three research findings verified" sentence, which launders "I verified the v6 citations" into "I verified the findings" — and the three upstream findings are not present in-repo to cross-check, so all borrow-level "VERIFIED" tags inherit an unverifiable-by-this-reviewer caveat.

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| HA-1 | HIGH | LAUNDERING — the synthesis opens 'All three research findings' v6 citations are verified against the source' and 'I have all the grounding I need', then tags borrows A1/A2/A4/C1/C2 as 'VERIFIED borrow'. This conflates two different verification acts: (a) verifying the v6/v3.5-RFC LINE ANCHORS (which I independently con… | Reword the opening to: 'All v6/v3.5-RFC LINE ANCHORS are verified against source; the borrow descriptions are faithful to the three upstream research findings, which are NOT yet committed to packages/specs/ — a downstream reviewer cannot independently re-verify the findings' verdicts until they are.' Re-label every bor… |
| HA-2 | LOW | FACTUAL IMPRECISION in the 'maps onto existing structure' claim. The synthesis states HETS contracts carry 'functional[] checks (F1-F6 ...)' and 'antiPattern[] (A1-A3 ...)', and A1 proposes adding 'an F7: findingGroundingFloor check' to the code-reviewer contract. The actual code-reviewer contract already runs F1-F7 (F… | Change 'add an F7: findingGroundingFloor' to 'add an F8: findingGroundingFloor (F7 is already the Principle-keyword check in 03-code-reviewer.contract.json:140-149)'; soften 'F1-F6 / A1-A3' to 'F1-F7 / A1-A4 (varies per persona)'. Cosmetic, but it is a load-bearing 'this slots into existing machinery' claim, so the slo… |
| HA-3 | LOW | REFRAME framing is slightly stronger than the evidence on the OQ-27 placement. TL;DR and B.2 say the wiki 'lands on OQ-27 (the deepest under-specified concern) as the read-side projection layer' and 'Adopt the wiki as the OQ-27 read-side projection layer'. OQ-27/OQ-B are OPEN in the v3.5 RFC; the wiki is a candidate co… | Soften to 'a strong CANDIDATE read-side projection layer for OQ-27 (OQ-B is still open; fail-closed default is no-traversal until a walker honoring R3 lands)'. Keep the B.2 scaling caveat as-is — it is the right hedge. |
| HA-4 | AFFIRM | SHIPPED-PHASE SAFETY is honestly supported, not asserted. The repeated claim 'nothing requires revisiting a shipped phase; v3.0-alpha kernel + v3.1 Runtime Foundation are UNTOUCHED' was checkable and checks out. | AFFIRM as-is. No change needed; this is the synthesis's strongest and most rigorously-supported claim. The reviewer should explicitly credit it so the downstream plan-phase does not re-litigate phase safety. |
| HA-5 | AFFIRM | The core v6/v3.5-RFC citations are source-accurate — the synthesis's genuine strength, distinguishing it from the prior gstack doc's corrected overclaim. The reframe-not-change discipline is mostly earned. | AFFIRM as-is. Preserve the explicit VERIFIED-vs-SPECULATIVE separation and the reframe-not-change labeling — it is the disciplined improvement over the prior gstack doc. No change. |
| HA-6 | AFFIRM | The cross-cutting writer_persona_id / OQ-E dependency is honestly inherited (not buried), and effort/release estimates are honestly hedged as estimates — both targets the spawn prompt asked me to check. | AFFIRM as-is. The OQ-E inheritance and the OQ-HYBRID-7 re-probe list are exactly the right hedges; no change. (Belt-and-suspenders: the downstream plan phase should still run OQ-HYBRID-7's probes at commit-time since the v3.5 RFC is explicitly a DRAFT and may move.) |

### verify:hacker — **APPROVE-WITH-CHANGES**

> The synthesis grounds its defense correctly on real v6 axioms (§0a.3.1, four-class, A10, §5a.1 SUPERSEDE all verified accurate), and the derived-view reframe genuinely prevents trust-laundering AT THE DESIGN LEVEL — but it materially understates that every fail-closed default it relies on is unbuilt RFC prose, not shipped enforcement. Two exploitable gaps must be promoted from buried OQ to launch-blocking preconditions: (H1) the wiki's anti-poisoning story rests entirely on kernel-attested writer identity that does NOT exist in shipped code (no roster check; persona label is input-derived), so a field-stuffed kernel-writer poison record is admissible today; (H2) the §0a.3.1 instruction-text-…

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| H1 | HIGH | MEMORY-POISONING via unattested writer identity (the linchpin the wiki's whole anti-poisoning story rests on is UNBUILT). The synthesis (Part B.5 item 6, Part F item 3/4, OQ-HYBRID-3) correctly identifies that every wiki write must be 'provenance-traced + sanitized-before-persist + trust-scored-at-retrieval' and routes… | Promote OQ-HYBRID-3 from 'do not block on OQ-E' to a HARD launch precondition for ANY wiki-write path: the wiki SUPERSEDE-edit discipline (B.0 step 1) MUST NOT ship before kernel-attested writer identity (OQ-E) lands, because the whole SUPERSEDE-not-bare-UPDATE reconciliation is security-meaningless if any spawn can au… |
| H2 | HIGH | READ-BACK-AS-INSTRUCTIONS (MemMorph) — the §0a.3.1 'MUST NOT be propagated as instruction-text into peer LLM contexts' prohibition is the ONE control standing between an LLM-rendered wiki page and prompt-injection-via-memory, and it has ZERO runtime enforcement. The synthesis quotes v6:175 verbatim (Part F item 2: 'MUS… | Add a launch precondition to Part B: the wiki read-side projection MUST NOT enter a peer spawn's instruction context until a datamarking/trust-boundary envelope (the prior-doc T2 atom the synthesis already identifies as 'borrowable' in Part A's browser-stack rejection) is applied at the assembly boundary — wiki prose i… |
| H3 | MEDIUM | EGRESS/SECRET surface — the synthesis claims (Part D, TL;DR 6) the hybrid adds NO outbound or secret-adjacent surface 'like the cross-model-review T1 did,' and rates every borrow LOW risk. This is mostly TRUE for the wiki-as-local-projection (it is read-files-render-locally, no vendor egress) — a fair AFFIRM. BUT two b… | Add a one-line egress clause to Part F: C1 edge-extraction and C3 sleeptime/background-materializer MUST run on the local/Anthropic channel only; if either is ever wired to a non-Anthropic vendor (cross-model edge validation, external summarizer), it inherits the prior-doc T1 launch requirements VERBATIM (fail-closed p… |
| H4 | MEDIUM | PERSONA-DEPTH capability-widening / self-promotion path. The synthesis is mostly well-defended here (A1-A5 are Runtime, zero kernel touch; it explicitly cites Axiom 2 'personas are Runtime never Kernel,' INV-A6-NonAuthorizing, and Part F item 5 forbids findings gating promote/reject). That is a strong AFFIRM on the hea… | Add to Part A: A2's generator is STRICTLY one-directional (contract→doc-scaffold) and the generated capability/tool table is a DISPLAY projection, NEVER the capability source of truth — the static tools: frontmatter + reconciliation validator (ADR-0012) remain the only authority; CI must assert the generator cannot be … |
| AFFIRM-1 | AFFIRM | The core reframe is correct AND its anchors are real, not hallucinated. The synthesis's central security claim — that adopting the wiki does NOT require violating A8 because it is a re-derivable derived-view projection with SUPERSEDE-as-sibling edits, never bare in-place mutation — is sound at the design level, and (cr… | AFFIRM. No change to the reframe itself. The design-level reconciliation is the strongest part of the document and survives adversarial probing. The required changes (H1-H4) are about making the UNBUILT enforcement a blocking precondition rather than a deferrable note — they do not undermine the reframe, they protect i… |
| AFFIRM-2 | AFFIRM | The shipped INV-22 idempotency-key hardening already defends the one poisoning sub-vector the synthesis does NOT need to re-solve: record-SUPPRESSION via a forged key. transaction-record.js:258-284 (deriveIdempotencyKey) re-derives the key from the record body so a poison record carrying a victim's idempotency_key but … | AFFIRM the write-side rigor claim as scoped. Recommend the plan phase cite this explicitly so the H1 gap is not mistaken for a write-side weakness in general — the write-side defeats forged-key suppression today; it is specifically WRITER IDENTITY that is unattested. |

### verify:architect — **APPROVE-WITH-CHANGES**

> Architecturally sound on the load-bearing claims: the wiki-as-derived-view A8 reconciliation is correct, layer placement is mostly disciplined, and no borrow touches shipped v3.0-alpha/v3.1 — but the SHIPPED-VS-FUTURE phase labels are wrong (the v6 §6 plan ends at v3.4 / Evolution Lab; "v3.3 dream-cycle" and "v3.5 memory-manage" come from a DIFFERENT doc, the v3.5 RFC DRAFT) and one layer-boundary justification (v6:215 = "Lab is where derived views land") misreads a Pillar Coverage Table row, mis-siting the wiki read-projection in the Evolution Lab.

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | HIGH | PHASE-SPLIT MISLABELING (Part 3 check). The draft's TL;DR #6, Part D, and Part B repeatedly assert borrows fold into 'v3.2 (persona-depth), v3.3 (Lab consensus / lint-as-dream-cycle), or v3.5 (wiki projection + causal-edge schema).' But the v6 §6 release plan I read does NOT contain those phases. §6.8 (v3.3) is EVOLUTI… | Do NOT block — the underlying SAFETY claim (nothing touches shipped v3.0-alpha/v3.1) is CORRECT and independently verified (see F2). But REWORD every phase target. The honest framing: persona-depth (Part A) is genuinely v3.2-shaped (Runtime decomposition, §6.7); the wiki + causal-edge work (Part B, C1, C2) is 'v3.5-RFC… |
| F4 | MEDIUM | LAYER-BOUNDARY MISREAD: v6:215 does NOT say 'the Evolution Lab is where derived views first land' (Part 1 check — the exact bug class the prior doc caught). Part B.4 justifies prototyping the wiki index.md + summary projections 'in v3.3 as Lab-tier derived views (the Evolution Lab is where derived views first land — v6… | Fix the citation and the layer claim. The wiki read-projection should be framed as a Runtime/memory-layer derived view (Pillar 3, composing with K4 recall + the v3.5 causal-graph), NOT an Evolution-Lab E-primitive. Drop the 'Evolution Lab is where derived views first land' justification entirely — it is unsupported by … |
| F8 | MEDIUM | THE writer_persona_id ATTESTATION DEPENDENCY IS CORRECTLY SURFACED BUT UNDER-WEIGHTED. Both A1 (grounded-finding sanitizer) and B (faithfulness gating) lean on kernel-attested writer identity, which the draft correctly flags as v3.5 OQ-E (un-attested today — spawn-record.js derives the persona label from input, not ker… | Elevate the OQ-E dependency from a flag to an explicit precondition note on A1 specifically. The grounding-check still works (it verifies {file,line,cited_text} resolvability against the delta, which is independent of writer identity) — so A1 is not blocked. But add: 'A1's grounding floor verifies CONTENT-resolvability… |
| F6 | LOW | YAGNI / SCOPE-DISCIPLINE is mostly strong, with two soft spots. The draft is admirably YAGNI-aware overall: A2 self-flags doc-gen ROI is LOWER for Power Loom (16-18 bespoke personas) than gstack (8 hosts x 50 skills) and recommends round-trip-freshness-test only, NOT full templating; OQ-HYBRID-2 recommends lazy project… | Minor tightening, not a blocker. Recommend explicitly demoting A5, C3, C4 from 'borrow' to 'AFFIRM (external corroboration; no new build)' so the plan phase doesn't mistake them for scoped work. Keep A1 (genuine new F7 check), A2 (genuine generator+freshness-test), A3 (genuine deterministic-trigger pattern), C1 (genuin… |
| F2 | AFFIRM | SHIPPED-PHASE SAFETY IS CORRECT (Part 3 core claim). Despite the mislabeling in F1, the load-bearing safety assertion — 'nothing requires revisiting shipped v3.0-alpha (kernel) or v3.1 (Runtime Foundation)' — verifies as TRUE. Every Part A borrow is additive to Runtime persona contracts (new functional[] check, a gener… | AFFIRM. The phase-safety verdict is sound; only its phase LABELS need correcting (F1). The distinction matters: the draft is right that the moat is preserved, wrong about which release-number the additive work attaches to. |
| F3 | AFFIRM | A8 RECONCILIATION OF THE WIKI IS CORRECT (Part 2 core check). The central architectural claim — 'the wiki is a Deterministic-Theorem-class derived view (re-derivable projection over the immutable chain), NOT canonical mutable state; edits express as SUPERSEDE-as-sibling-write, never bare UPDATE' — is verified sound aga… | AFFIRM strongly. This is the document's best work. The A8-violator-unless-projection framing is exactly right and the no-bare-UPDATE constraint (TL;DR #3) is correctly called 'non-negotiable.' The four-class decomposition table in B.1 (source=Axiom, log=Attestation, synthesis-content=Stochastic, materialized-page=Theor… |
| F5 | AFFIRM | PERSONA-DEPTH LAYER PLACEMENT IS DISCIPLINED (Part 1). Part A correctly keeps personas in Runtime ('Personas are Runtime, never Kernel — Axiom 2') and correctly splits the grounded-confidence GATE into a pure-fn sanitizer (kernel-adjacent, like the prior doc's verifyGrounding) vs the producer/dispatch (Runtime). A4 exp… | AFFIRM. Part A's layer hygiene is correct. The only soft note (already self-flagged by the draft as SPECULATIVE): the specific gstack thresholds (8 files, 2 classes in A3) are not portable; the draft correctly says VERIFIED-on-pattern, SPECULATIVE-on-values. |
| F7 | AFFIRM | THE DO-NOT-FOLD LIST (Part F) IS THE RIGHT DESIGN INSTINCT and correctly anchored. Every non-goal cites the specific axiom it would violate, and the citations check out: F.1 (wiki as canonical mutable markdown → A8/§5a.1, v6:426/916), F.2 (LLM prose read as fact → §0a.3.1 No-Amplification, v6:175), F.3 (unevidenced wri… | AFFIRM. Part F is model-grade hand-off discipline. No change needed beyond ensuring the F1-corrected phase labels don't leak into Part F's release assumptions (they don't — Part F is release-agnostic). |
| F9 | AFFIRM | OQ-27 READ-SIDE COMPOSITION IS ARCHITECTURALLY CORRECT (Part 2, secondary). The framing — 'the wiki is the OQ-27 read-side PROJECTION layer, composing WITH (not replacing) the v3.5 typed causal-graph: wiki seeds + summarizes, causal-graph supplies trust-gating + typed relations, K4 ranks within the result set' — is a s… | AFFIRM. The wiki-seeds / graph-trust-gates / K4-ranks composition is the right decomposition and respects R3's AUDIT-ONLY invariant. One small note for the plan phase (already partly in OQ-HYBRID-4): be explicit that the wiki index.md, being a derived-view seed surface, must itself only surface records whose edges are … |

**Net disposition:** every HIGH folded into §B.4a / the Part-D provenance caveat; MED/LOW captured in §B.4a items 3–7; the AFFIRMs (A8 reconciliation correct, shipped-phase-safety verified, v6 anchors source-accurate, INV-22 closes record-suppression, DO-NOT-FOLD list correctly anchored) are recorded as the doc's load-bearing strengths and should not be re-litigated.


---

## ADDENDUM — User-intent recalibration (2026-06-02, post-review)

The user clarified that the intended scope for the memory direction is **narrower** than Part B explores, and the clarification **changes the OQ-E dependency**:

- **Intended scope:** borrow the *essence* of llm-wiki — a navigable graph over doc structure that maps memory optimally to **avoid bloat**, layered on our existing **causal continuity across files** (the v3.5 typed causal-edge graph) and **semantic similarity within files**. Fold the surgical strength into the memory manager; do **not** build a wiki subsystem. If our model is stronger, borrow surgically and move on.
- **OQ-E is NOT pulled forward under this scope.** The §B.4a/H1 write-path gate (kernel-attested writer identity) only bites the *write* path — LLM-authored canonical pages, a new privileged-write surface. A **read-side projection / navigation graph over already-committed memory adds no write surface**, so the poisoning gate never engages. OQ-E stays a v3.5-manage-layer concern, relevant only if/when LLM-authored *manage*-writes are added (a separate decision).
- **The surgical borrow that survives:** "navigable-index-as-derived-view for bloat control" (the OQ-27 read-side) — re-derivable, OQ-E-free; we already run a manual lite version (`MEMORY.md` index → topic files → library snapshots). Across-file causal continuity we already have, and it is stronger (typed + trust-gated). **Within-file semantic similarity is the genuine gap — but it is the embedding / derived-index fork** (§10b: rejected as canonical, permitted as a v3.5+ cache), a deliberate decision, not a free borrow.
- **Net:** Part B's "blocked on OQ-E" framing applies to the maximalist wiki-as-memory-store reading, which the user did not intend. The intended surgical read-side borrow is OQ-E-free and folds into the v3.5-RFC-candidate read-side (OQ-27). Treat Part B's heavier wiki machinery (SUPERSEDE-edited synthesis pages, dream-cycle lint writes) as out of the current scope unless that scope is explicitly re-expanded.
