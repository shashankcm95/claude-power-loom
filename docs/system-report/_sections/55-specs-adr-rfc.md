# 55 — Specs: ADRs, RFCs, architecture-substrate (canonical decision records)

**Role.** This is the substrate's *durable decision memory*. Three sub-trees under
`packages/specs/` hold the institutional record of WHY the system is shaped the way it
is: **`adrs/`** (point-decisions with explicit trade-offs + machine-readable invariants +
drift detection), **`rfcs/`** (large design syntheses and forward-looking direction
documents), and **`architecture-substrate/`** (substrate-meta "how this toolkit works
internally" docs that ADR-0005 deliberately moved out of always-on rules). The set is
**append-only reference material** (`packages/specs/README.md` line 3: "No code; no deps;
never versioned"). ADRs are canonical/immutable — superseded via a new doc, never
rewritten; RFCs accrete provenance chains (v1 to v6) where later versions supersede
earlier ones in place but the earlier are kept "for diff".

**Narrative arc the set encodes.** Reading the ledger chronologically reconstructs the
project's whole history: (1) the H.* "Hardening Track" era codified hook + authoring
discipline (ADRs 0001-0007); (2) the **Phase-0 workspace restructure** (ADR-0008) moved
everything from `swarm/` into the `packages/{kernel,runtime,lab,skills,specs}` pnpm
layout — the single largest source of stale path citations in this set; (3) the
**v3.0-alpha kernel** (ADRs 0009-0012, 0015) built the transaction loop, write-scope
enforcement, and the load-bearing discovery that *capability enforcement is static, not
runtime-injected* (ADR-0012); (4) the RFC line traces the same spine — `v3.3-substrate-
synthesis-v1/v2/v3` to `v6-substrate-synthesis` (the locked blueprint) to the v3.5 / v3.9
/ v3.11 forward RFCs and the **North-Star** trust document that reframes the entire
program as a fault-tolerance layer for probabilistic software engineering.

---

## Directory contents & nesting

```text
packages/specs/
├── README.md                          (parent; the "@power-loom/specs" tier charter — context only, out of scope)
├── adrs/            (18 files)         architectural decision records + scaffolding
│   ├── _README.md                     ADR primitive: lifecycle, frontmatter schema, drift hook, CLI
│   ├── _TEMPLATE.md                   canonical ADR format
│   └── 0001..0016-*.md                16 numbered ADRs
├── rfcs/            (11 files)         large design syntheses + forward-direction docs
│   ├── v3.3-substrate-synthesis-v1/v2/v3.md
│   ├── v6-substrate-synthesis.md      THE locked blueprint (1944 lines)
│   ├── causal-recall-graph-rfc.md     v3.2-LOCKED memory/recall design
│   ├── gc-component-spec.md           focused GC spec (folded into causal-recall RFC)
│   └── 2026-*.md                      5 dated forward RFCs (v3.5 / north-star / v3.9 / v3.11 / identity)
└── architecture-substrate/  (2 files) substrate-meta "how the toolkit works" docs
    ├── auto-loop-infrastructure.md
    └── prompt-enrichment-architecture.md
```

File count in scope: **31** (16 ADRs + 2 ADR scaffolding + 11 RFCs + 2 architecture-substrate).

---

## ADR scaffolding (canonical — read first)

| File | Purpose |
|---|---|
| `adrs/_README.md` | The ADR **primitive spec**: lifecycle (proposed/accepted/seed/superseded/deprecated), the machine-readable frontmatter schema, the tier taxonomy, the `validate-adr-drift.js` PreToolUse drift hook, the `adr.js` CLI surface, and "when to write an ADR". Canonical. |
| `adrs/_TEMPLATE.md` | The canonical ADR body format (Context / Decision / Consequences / Alternatives / Status notes / Related work) with inline enum docs for `tier` and `status`. New ADRs copy this. |

**Load-bearing mechanics** (governs the whole ADR system): every ADR carries
`files_affected[]` + `invariants_introduced[]`. The kernel hook
`packages/kernel/validators/validate-adr-drift.js` (wired at `packages/kernel/hooks.json`
line 137, PreToolUse:Edit\|Write) reads all *active* ADRs (status `accepted` OR `seed`,
`superseded_by` null) at every Edit/Write; if the edited file is in any active ADR's
`files_affected`, it emits the `[ADR-DRIFT-CHECK]` advisory (Class-1, fail-open). The CLI
`adr.js` (`new`/`list`/`read`/`active`) lives at
`packages/runtime/orchestration/adr.js` (verified present). This is the consumer side:
the ADR frontmatter is *data* that the kernel hook + CLI read.

---

## ADRs — full catalog

All sixteen, grouped by the era/theme they belong to. **Tier** is `technical` (grep/lint
verifiable) / `governance` (institutional commitment) / `editorial` (authoring judgment),
per ADR-0004. **Status**: all are `accepted` or `seed` except 0013/0014 (`proposed`).

### Hook + authoring discipline (H.* hardening track)

| ID | Title (one-line decision) | Tier | Status |
|---|---|---|---|
| 0001 | Substrate hooks **fail open** with observability, never crash sessions (top-level try/catch + logger + approve-on-error) | technical | **seed** |
| 0002 | Bridge-script entrypoint criterion — split only when lifecycle-boundary crossed OR `>800 LoC` OR `>5` responsibilities | technical | accepted |
| 0003 | ADR-0001's fail-open discipline as a forward-looking **institutional commitment** (governance gate on new-hook PRs) | governance | accepted |
| 0004 | Codify the **ADR tier taxonomy** (technical/governance/editorial) at the frontmatter schema level | governance | accepted |
| 0005 | Adopt **slopfiles authoring discipline** — always-on context is presumptively `<important if>`-conditional; safety-critical content stays core-always | editorial | accepted |
| 0006 | **Fix-don't-suppress** — 0-finding lint baseline; `eslint-disable` PROHIBITED in substrate source (Test 84b greps for it) | governance | accepted |
| 0007 | Bump v2.9.0 as **MINOR** (substrate-fundament additions bump MINOR even without a breaking API change) | governance | accepted |

**Deeper note — ADR-0001 (the keystone).** Every fail-open invariant in the substrate
traces here; it is referenced by 0003, 0005, 0006, both architecture-substrate docs, and
the `_comment` blocks throughout `hooks.json`. Status `seed` = pre-existing discipline
codified retroactively across 14 hooks; it stays active for drift detection. ADR-0002 and
ADR-0006 are the most mechanically verifiable (grep/`wc -l`/Test-84b).

### Workspace + version structure

| ID | Title (one-line decision) | Tier | Status |
|---|---|---|---|
| 0008 | Adopt the **pnpm workspace layout** (`kernel/runtime/lab/skills/specs`) as the v3.3 foundation; cross-layer imports respect the DAG | technical | accepted |
| 0009 | Adopt **v3.0.0 MAJOR** bump for the Phase-1-alpha kernel (pure transaction loop K1..K14; K9 ships dormant) | governance | accepted |

**Deeper note — ADR-0008 (the relocation that orphaned many paths).** This is the
canonical record of moving everything out of `swarm/` into `packages/`. Its invariants ARE
the layer-DAG the K12 layer-enforcer convention checks (kernel = zero workspace deps;
runtime depends on kernel; lab on kernel+runtime; skills on runtime; specs zero-dep).
Crucially, *most of the stale path citations flagged below are pre-0008 `swarm/...` paths
that were never refreshed after this move.*

### v3.0-alpha kernel transaction loop

| ID | Title (one-line decision) | Tier | Status |
|---|---|---|---|
| 0010 | **Write-scope enforcement** via K14 post-completion snapshot + post-spawn-resolver (detect, not prevent-at-write) | technical | accepted |
| 0011 | **K9↔K14 sequencing** + Phase-1-alpha spec deltas + rationale-before-code obligations (the authoritative resolver-table spine) | technical | accepted |
| 0012 | **Capability enforcement is STATIC** (agent.md frontmatter `tools:`), not runtime-injected — `updatedInput` is INERT on Agent spawns; K8 DROPPED, `pre-spawn-tool-mask` retired-as-inert | technical | accepted |
| 0015 | **Freeze the `failure_signature` schema** (negative-attestation witness); E2 reads only closed-enum structural fields, never the free-form diagnostics | technical | accepted |
| 0016 | **Extract a pure leaf to `kernel/_lib`** when logic is needed across layers (DRY/DIP; `/self-improve` promotion, 4x recurrence) | technical | accepted |

**Deeper note — ADR-0012 (the most consequential empirical finding in the set).** A
`claude -p` probe proved a PreToolUse hook's `updatedInput` is inert for Agent/Task
spawns, so per-spawn capability narrowing is impossible; enforcement is the static
`agent.md` frontmatter + the build-time `contracts-validate.js` reconciliation. This
killed K8 and the `pre-spawn-tool-mask` hook (now a tombstone `_comment` at
`hooks.json:61`). It is cited by the v3.5 / v3.9 RFCs, the enforcing-vs-advisory-identity
RFC, and MEMORY as a canonical "do not re-litigate" fact. Note: ADR-0012 has **no
`## Status notes` section** (deviates from `_TEMPLATE.md`); its supersession-style update
is captured under `## Amendment (2026-05-31)` instead.

**Deeper note — ADR-0010 / ADR-0011 pairing.** 0010 shipped "rationale-first" before K14
existed; its top-of-body "⚠️ Provisional Status" header was meant to be reconciled at PR-4.
The reconciliation happened — ADR-0011's `## PR-4 Re-grounding Amendment` (line 244) is
now the authoritative resolver spine, and 0011 line 63 explicitly marks its own original
`{crashed? × violation?}` table **SUPERSEDED** in place. Status of both is `accepted`. See
Findings F-7 for the residual header drift on 0010.

### Meta / taxonomy (re-listed for completeness)

ADR-0004 (tier taxonomy) and ADR-0013/0014 below.

### Proposed-but-unbuilt (v6 derived-view ADRs)

| ID | Title (one-line decision) | Tier | Status |
|---|---|---|---|
| 0013 | Ship **endorsements as a derived view**, not a first-class primitive (pure deterministic function; evidence-link required; no self-endorsement) | technical | **proposed** |
| 0014 | Adopt the **Memory Root Pointer convention** for substrate discovery (atomic tmp+fsync+rename; persona-index canonical-only) | technical | **proposed** |

**Deeper note — 0013/0014 are the two never-graduated ADRs.** Both are sibling v6
artifacts authored 2026-05-27 with status `proposed` and a "LOCK target — accepted" status
note that never flipped the frontmatter. Their `files_affected`
(`packages/lab/_lib/endorsement-view.js`, `packages/kernel/_lib/memory-root.js`) confirm
the split: `memory-root.js` **exists** (0014 was at least partially built — a reader stub),
but `endorsement-view.js` is **absent** (0013 E14 was never built). Because they are
`proposed`, the drift hook treats them as inactive (only `accepted`/`seed` are active), so
the missing file is not flagged. They are the closest thing here to orphaned decisions —
see F-3.

---

## RFCs — full catalog

Eleven docs. The dominant pattern is a **provenance chain** culminating in
`v6-substrate-synthesis.md`, plus dated forward-direction RFCs.

### The v3.3 to v6 synthesis chain (the blueprint lineage)

| File | Purpose | Status |
|---|---|---|
| `v3.3-substrate-synthesis-v1.md` | First synthesis draft (4-class state model + parent-records pivot recap) | **historical** — "v1 preserved for diff"; superseded by v2/v3/v6 |
| `v3.3-substrate-synthesis-v2.md` | v1 + Round-1 pair-review absorbed (6 axioms + 20 primitives) | **historical** — preserved for diff; superseded by v3/v6 |
| `v3.3-substrate-synthesis-v3.md` | v2 + external GPT analysis (three-layer formalization + MVP staging + "delete before add" compression) | **historical** — superseded by v6 |
| `v6-substrate-synthesis.md` | **THE canonical blueprint** (1944 lines): 10 axioms, 14 kernel primitives, 29 invariants, the memory consistency model (§5a), §0a.3.1 anti-amplifier clause, ADR-0013/0014 origin | **canonical** (per MEMORY `v6-substrate-locked`, merged PR #160) — but self-declared status is "LIVE-DRAFTING" (see F-1) |

**Deeper note — `v6-substrate-synthesis.md`.** This is the single most load-bearing RFC:
the blueprint every v3.x phase derives from. It introduced the A8/A9/A10 consistency
axioms, the Memory Root Pointer (§5a.9 to INV-26/27), the derived-view no-amplification
clause (§0a.3.1), and is the spec source for ADR-0013 (E14) and ADR-0014. MEMORY treats it
as LOCKED + merged and canonical. Consumers: `docs/ARCHITECTURE.md`, the v3.x phase plans,
and the persona-depth research docs all cite it.

### Memory / recall design

| File | Purpose | Status |
|---|---|---|
| `causal-recall-graph-rfc.md` | The Causal Recall Graph + dream-cycle + GC design; target release v3.0.0; MANDATORY-gate shape | **historical/locked** — `rfc-v3.2-LOCKED`; re-grounded onto v6 by the v3.5 DRAFT; operationalized by the v3.11 RFC |
| `gc-component-spec.md` | Focused Spawn-Lifecycle + GC + Retention spec for a pre-lock architect spot-review | **superseded** — explicitly "folded into §GC of `causal-recall-graph-rfc.md`" (its own `related` note in the parent RFC + line 14 of that RFC) |

### Dated forward-direction RFCs

| File | Purpose | Status |
|---|---|---|
| `2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md` | v3.5 memory write/manage/read + causal graph candidate; re-grounds the causal-recall RFC onto v6; carries web-verified 2026 memory-research citations | **DRAFT** — never promoted out of draft (filename + frontmatter both say DRAFT); v3.5 shipped (MEMORY: v3.5 PHASE-CLOSED). See F-2 |
| `2026-06-04-enforcing-vs-advisory-identity.md` | Decides the promote/merge disposition: **Option B** human-gated ceiling (provisional), shadow default, auto-merge retired-until-ContainerAdapter | **accepted** (ratified 2026-06-04; amended 2026-06-11 + 2026-06-14) — canonical (MEMORY `power-loom-promote-disposition-decision`) |
| `2026-06-11-north-star-autonomous-sde-trust.md` | The **North Star** — Power Loom as a fault-tolerance layer for probabilistic SDE; apex = external-maintainer merge; the trust-fractal | **DRAFT** — "pending USER ratification + a verify panel"; but MEMORY treats it as the operative NORTH-STAR. See F-4 |
| `2026-06-13-v3.9-retrospective-calibration-bootcamp.md` | v3.9 predict to verify to recalibrate loop over resolved issues; ContainerAdapter born read-mostly | **Proposed** (frontmatter) — but v3.9 PHASE-CLOSED + released 3.9.0 per MEMORY. See F-2 |
| `2026-06-15-v3.11-experience-layer.md` | The Recall-Graph Experience Layer — lessons-not-actions; structured signature; confirmation gate; client-owned artifacts | **Proposed** (REVISED post-VERIFY-board) — but v3.11 RELEASED 3.11.0 per MEMORY. See F-2 |

**Deeper note — the forward RFCs are accurate as *captured at authoring time* but their
`status:` fields freeze at the moment of writing while the phases they describe have since
shipped.** This is a systemic pattern (4 of 5 dated RFCs), not a one-off — see F-2. The
two genuinely-canonical forward docs are `2026-06-04-enforcing-vs-advisory-identity.md`
(ratified, the disposition decision) and the North-Star (the destination charter).

---

## architecture-substrate — full catalog

Two substrate-meta docs that ADR-0005 deliberately moved out of always-on rules
(`rules/core/self-improvement.md` + `rules/core/prompt-enrichment.md`) to reduce
session-context tax; loaded only when working on that machinery.

| File | Purpose |
|---|---|
| `auto-loop-infrastructure.md` | How the self-improvement auto-loop works: 3 hook integrations (capture/consolidation/approval), threshold-based auto-promotion (≥5 queued, ≥10+low auto-graduated), the self-improve-store CLI surface |
| `prompt-enrichment-architecture.md` | The vagueness-detection gate (`prompt-enrich-trigger.js`), the skip-pattern catalog, the prompt-pattern-store 5+-approval auto-apply, and the empirical conversion-rate funnel (32% flagged, 0.2% follow-through) |

**Deeper note.** Both declare `**Status**: active` and are genuinely informative, but both
carry **pre-Phase-0 (`swarm/...`, `hooks/scripts/...`, `scripts/...`, `~/.claude/scripts/`)
path citations that no longer resolve** after ADR-0008's restructure. They are *not*
covered by the doc-path CI gate (which scans `skills/` + `kb/`, not
`specs/architecture-substrate/`), so the drift is silent. See F-5/F-6.

---

## Findings

| Severity | Level | Type | Location | Description |
|---|---|---|---|---|
| MEDIUM | file | smell | `packages/specs/rfcs/v6-substrate-synthesis.md:3,5` | **Status-marker drift on the canonical blueprint.** The doc self-declares "v6 **LIVE-DRAFTING** (Round 1 of 3 ... Supersedes v5.4 ... upon Round-3 completion)", but MEMORY (`v6-substrate-locked`) records it as LOCKED + merged (PR #160) and *the canonical spec*. Everything downstream treats v6 as locked; the doc header was never flipped. A cold reader would wrongly conclude it is an unfinished draft. Add a LOCKED status banner. |
| MEDIUM | file | smell | `rfcs/2026-06-13-v3.9-*.md`, `rfcs/2026-06-15-v3.11-experience-layer.md`, `rfcs/2026-05-30-v3.5-*-DRAFT.md`, `rfcs/2026-06-11-north-star-*.md` | **Systemic `status:` staleness across forward RFCs.** Four dated RFCs are still `Proposed`/`DRAFT` in frontmatter while their phases have shipped (v3.5 PHASE-CLOSED, v3.9 released 3.9.0, v3.11 released 3.11.0 per MEMORY). The `status:` field freezes at authoring time and is never reconciled at phase-close. Not wrong-as-history, but misleading as current state. Consider a phase-close step that flips RFC `status:` to `accepted`/`shipped` (or `superseded`). |
| LOW | file | smell | `packages/specs/adrs/0013-endorsement-derived-view.md`, `0014-memory-root-pointer.md` | **Two ADRs stuck at `status: proposed`** though their Status-notes say "LOCK target — accepted". ADR-0014's `memory-root.js` exists (partially built); ADR-0013's `endorsement-view.js` is absent (E14 never built). Because `proposed` ADRs are inactive for drift detection, the unbuilt-decision state is invisible. Either flip to `accepted` (and let drift detection flag the missing `endorsement-view.js`) or mark `deprecated` if E14 was abandoned. |
| LOW | file | smell | `packages/specs/rfcs/gc-component-spec.md` | **Superseded-but-not-status-marked.** This spec was explicitly folded into §GC of `causal-recall-graph-rfc.md` (stated in that RFC's `related` note + line 14: "superseded by §GC in this RFC"), yet `gc-component-spec.md`'s own frontmatter still reads `status: pre-lock spec for architect spot-review`. A reader landing on it directly won't know it was absorbed. Add `superseded_by: causal-recall-graph-rfc.md`. |
| MEDIUM | file | bug | `packages/specs/architecture-substrate/prompt-enrichment-architecture.md:71-73` | **Broken path citations (pre-Phase-0).** The "Hook architecture wiring" table cites `hooks/scripts/prompt-enrich-trigger.js`, `hooks/scripts/auto-store-enrichment.js`, `scripts/prompt-pattern-store.js` — none exist. Actual: `packages/kernel/hooks/lifecycle/prompt-enrich-trigger.js`, `.../lifecycle/auto-store-enrichment.js`, `packages/kernel/spawn-state/prompt-pattern-store.js`. The `~/.claude/prompt-patterns.json` symlink note and `skills/agent-team/kb/architecture` (now `packages/skills/library/agent-team/kb/architecture`) are also stale. Not caught by CI (doc-path gate excludes `specs/architecture-substrate/`). |
| MEDIUM | file | bug | `packages/specs/architecture-substrate/auto-loop-infrastructure.md:35-37,48` | **Broken path citations (pre-Phase-0).** CLI examples cite `~/.claude/scripts/self-improve-store.js` (actual source: `packages/kernel/spawn-state/self-improve-store.js`) and `node scripts/library.js` (the README form is `library write ...`; `scripts/library.js` does exist but the invocation shape differs from `docs/library.md`). The `swarm/path-reference-conventions.md` sibling-precedent cited in both docs no longer exists at that path. Refresh to `packages/` paths. |
| LOW | file | smell | `packages/specs/adrs/0010-write-scope-enforcement.md` (top of body) | **Residual "⚠️ Provisional Status" header on an `accepted` ADR.** The provisional-reconcile gate was discharged — ADR-0011's `## PR-4 Re-grounding Amendment` (line 244) is now authoritative and ADR-0011 line 63 marks 0010's original resolver table SUPERSEDED. But 0010's body still leads with the alarming provisional banner. Update the banner to note reconciliation is complete and point to ADR-0011's amendment. |
| LOW | file | smell | `packages/specs/adrs/_README.md:19-24,144` | **ADR README cites pre-Phase-0 `swarm/adrs/` paths.** The "File structure" tree and the deferred-feature note (`swarm/adrs/INDEX.md`) use `swarm/adrs/` (the directory is now `packages/specs/adrs/`). Same class as the architecture-substrate drift; cosmetic but it is the entry-point doc for the ADR primitive. |
| INFO | file | smell | `packages/specs/adrs/0012-*.md` | **ADR-0012 omits the `## Status notes` section** mandated by `_TEMPLATE.md`; its update is under a non-standard `## Amendment (2026-05-31)` heading instead. Harmless, but a schema-consistency deviation worth noting since 0012 is heavily cited. |
| LOW | substrate | gap | `packages/specs/architecture-substrate/` | **Coverage gap in the doc-path CI gate.** The two architecture-substrate docs are the most path-citation-dense docs in this set yet sit outside the doc-path gate's scan scope (`skills/` + `kb/` only). This is precisely why the F-5/F-6 stale paths persisted silently. Extending the gate to `packages/specs/architecture-substrate/**` would catch this class. |
| INFO | substrate | smell | `packages/specs/rfcs/v3.3-substrate-synthesis-v1.md`, `-v2.md` | **Consolidation opportunity (low priority).** v1 and v2 are explicitly "preserved for diff" and fully superseded by v3 (itself superseded by v6). They total ~1186 lines of historical synthesis. Per the workspace-hygiene convention these are legitimate append-only history, but candidates for an `_archive/` move with a `lifecycle:` marker if rfcs/ navigability degrades. No action required now. |
| INFO | file | smell | `packages/specs/rfcs/causal-recall-graph-rfc.md` (`related:` frontmatter) | **Stale `swarm/...` cross-references in `related`.** Cites `swarm/thoughts/shared/HT-state.md`, `swarm/adrs/0007-*.md`, `swarm/thoughts/shared/design/gc-component-spec.md` — all pre-Phase-0 paths (the ADR is now `packages/specs/adrs/0007-*.md`; the GC spec is `packages/specs/rfcs/gc-component-spec.md`). Historical doc, low priority, but the cross-refs no longer navigate. |
