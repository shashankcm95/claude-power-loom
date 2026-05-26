---
adr_id: 0004
title: "Codify ADR tier taxonomy at schema level: technical, governance, editorial"
tier: governance
# status enum (5 values): proposed | accepted | seed | superseded | deprecated
#   proposed   — drafted; not yet in effect
#   accepted   — approved; implementation can/has happened
#   seed       — pre-existing discipline codified retroactively (e.g., ADR-0001); still active for drift detection
#   superseded — replaced by another ADR (set superseded_by)
#   deprecated — no longer applies; not replaced
status: accepted
created: 2026-05-11
author: root (HT.3.1 sub-plan; post-HT audit-followup Tier 2 institutional reframing)
superseded_by: null
files_affected:
  - swarm/adrs/_TEMPLATE.md
  - swarm/adrs/_README.md
  - swarm/adrs/0001-substrate-fail-open-hook-discipline.md
  - swarm/adrs/0002-bridge-script-entrypoint-criterion.md
  - swarm/adrs/0003-substrate-fail-open-hook-discipline-forward-looking.md
  - swarm/adrs/0005-slopfiles-authoring-discipline.md
invariants_introduced:
  - "Every substrate ADR declares a `tier` field with value `technical` | `governance` | `editorial`. PRs without `tier` are NEEDS-REVISION at code review (load-bearing institutional gate)."
  - "Technical-tier ADRs codify MECHANICAL invariants verifiable by grep/lint/test (e.g., presence-of-pattern in source files, threshold compliance via `wc -l` or responsibility-count). Drift detection is mechanical."
  - "Governance-tier ADRs codify INSTITUTIONAL commitments backed by load-bearing code-review gates. The institutional commitment is the load-bearing surface; drift detection is human review of process discipline at PR time."
  - "Editorial-tier ADRs codify AUTHORING discipline whose compliance depends on best-effort instruction-following (LLM-side) + author-side curation. Drift detection is partition-decision review at PR time."
related_adrs:
  - 0001
  - 0002
  - 0003
  - 0005
related_kb:
  - architecture/discipline/error-handling-discipline
  - architecture/crosscut/single-responsibility
---

## Context

At HT.1.13 (slopfiles authoring discipline), the substrate introduced a three-tier ADR taxonomy in prose — see ADR-0005 lines 60-66:

- **Technical-tier** ADRs (e.g., ADR-0001 — fail-open hook discipline) codify MECHANICAL invariants verifiable by grep/lint/test.
- **Governance-tier** ADRs (e.g., ADR-0003 — institutional commitment to enforce ADR-0001) codify INSTITUTIONAL commitments backed by code-review gates.
- **Editorial-tier** ADRs (e.g., ADR-0005 itself — slopfiles authoring discipline) codify AUTHORING discipline whose compliance is LLM-side best-effort + author-side curation.

The three tiers compose: technical → governance → editorial. Each tier addresses a structurally distinct class of decision: WHAT the substrate enforces mechanically (technical), HOW the substrate maintains discipline institutionally (governance), and WHAT-CONTENT the substrate authors at the editorial layer (editorial).

The taxonomy has been operational in prose since HT.1.13 (2026-05-10) and maps cleanly across the existing ADR ledger:

- ADR-0001 (fail-open hook discipline) — technical
- ADR-0002 (bridge-script entrypoint criterion) — technical
- ADR-0003 (fail-open hook discipline as institutional commitment) — governance
- ADR-0005 (slopfiles authoring discipline) — editorial

The forces motivating codification at schema level (post-HT audit-followup, 2026-05-11):

- **Schema-vs-prose gap**: ADR-0005 declares the taxonomy in prose at lines 60-66, but no ADR frontmatter declares its tier. Readers cannot programmatically partition ADRs by tier; future tooling (`adr.js list --tier`) lacks a data substrate; drift detection cannot reason about tier-shape mismatches.
- **5-agent chaos test + HETS code review (post-HT)**: two senior-architect agents independently flagged "schema doesn't match prose — the 3-tier taxonomy is operating but invisible to the schema layer." Convergent FLAG; cross-validates the institutional gap.
- **Sequencing-correct timing**: the existing ledger is 4 ADRs — small enough that retroactive tagging is a single-session task. As the ledger grows past 10+ ADRs, retroactive tagging becomes harder; doing it now while the surface is small minimizes migration cost.

Without codification, the taxonomy remains an institutional convention with implicit author-side discipline — vulnerable to drift if new authors join + write ADRs without consulting ADR-0005's prose. Codifying as a frontmatter field + load-bearing code-review gate prevents this drift.

## Decision

**Every substrate ADR declares a `tier` field at the frontmatter layer with one of three values: `technical`, `governance`, or `editorial`.** New ADRs without a `tier` field are NEEDS-REVISION at code review (institutional gate; load-bearing).

The frontmatter field sits at the schema layer:

```yaml
---
adr_id: NNNN
title: "..."
tier: technical | governance | editorial
status: proposed | accepted | seed | superseded | deprecated
created: YYYY-MM-DD
...
---
```

The three values are defined as follows:

### Technical-tier

ADR codifies MECHANICAL invariants verifiable by grep/lint/test. The verifiability surface is automation-friendly:

- Presence-of-pattern in source files (e.g., "every hook has top-level try/catch")
- Threshold compliance via `wc -l` or responsibility-count (e.g., "≤800 LoC per bridge-script entrypoint")
- Schema validation against a fixed shape (e.g., "module.exports declares N functions")

Drift detection for technical-tier ADRs is mechanical — a script or grep query can answer "does the substrate satisfy this invariant?" without human judgment.

Examples in current ledger: ADR-0001 (fail-open hook discipline; 4 mechanical try/catch + logger + decision-shape invariants), ADR-0002 (bridge-script entrypoint criterion; 800-LoC + 5-responsibility thresholds).

### Governance-tier

ADR codifies INSTITUTIONAL commitments backed by load-bearing code-review gates. The institutional commitment is the load-bearing surface; mechanical verification may be present (e.g., grep-able invariants) but is NOT the primary discipline. The primary discipline is:

- New PRs verify compliance in body or commit message
- Reviewers gate on compliance independently of other review concerns
- Case-by-case exceptions weaken the commitment + erode the discipline

Drift detection for governance-tier ADRs is human review of process discipline at PR time. Automation may augment (e.g., a lint check ensuring PR body mentions the ADR) but cannot replace the institutional commitment surface.

Examples in current ledger: ADR-0003 (institutional commitment to enforce ADR-0001 on all post-2026-05-10 hooks; load-bearing code-review gate), ADR-0004 (this ADR — institutional commitment that all ADRs declare a tier field).

### Editorial-tier

ADR codifies AUTHORING discipline whose compliance depends on best-effort instruction-following (LLM-side) + author-side curation. The compliance surface is fundamentally probabilistic:

- LLM may correctly skip conditional sections per predicate fit, or may not
- Author may correctly partition content (core-always vs conditional vs out-of-rules), or may not
- Automation is limited because the underlying discipline is judgment-based

Drift detection for editorial-tier ADRs is partition-decision review at PR time — a reviewer examines whether new content lands in the correct partition + whether existing partitions remain coherent.

Examples in current ledger: ADR-0005 (slopfiles authoring discipline; predicate-vocabulary curation + content partitioning).

### Tier disambiguation (overlapping shapes)

Some ADRs span tiers — e.g., an ADR with one mechanical invariant + one governance invariant. The dominant-invariant rule resolves: classify by the invariant most load-bearing for the substrate's discipline. Cross-tier behavior should be acknowledged in the ADR body but the frontmatter `tier` field is single-valued.

ADR-0004 (this ADR) is an instructive case: invariant 1 ("every ADR declares tier") is grep-verifiable (mechanical-shape), but the load-bearing surface is the institutional commitment + code-review gate (governance-shape). Per dominant-invariant rule, `tier: governance` wins. The classification criteria for tier values (invariants 2/3/4) are advisory to authors (editorial-shape) but secondary to the field-requirement invariant.

## Consequences

**Positive consequences** (what we gain):

- **Schema-vs-prose alignment**: the 3-tier taxonomy is now machine-readable at frontmatter layer. Future tooling (`adr.js list --tier technical`, drift-detection grouping by tier, ADR ledger reports) has a data substrate.
- **Institutional discipline preservation**: load-bearing code-review gate prevents the taxonomy from eroding as new authors join + the ledger grows. The retroactive tag on 4 existing ADRs documents the current state at codification time.
- **Onboarding signal**: new ADR authors see the field in `_TEMPLATE.md` + the `_README.md` taxonomy section + ADR-0004 itself. The 3-tier discipline becomes visible at authoring time, not just in prose elsewhere.
- **Sequencing-correct cost**: codifying at 4-ADR ledger size is cheaper than codifying at 10+-ADR ledger size. Retroactive tagging is a single-session task at HT.3.1; deferring would compound migration cost.
- **Drift-detection enhancement**: `[ADR-DRIFT-CHECK]` forcing instruction can future-evolve to surface tier alongside title + invariants, giving Claude more context about the nature of the discipline at edit time. Drift-note candidate for H.9.x.

**Negative consequences** (what we sacrifice):

- **Onboarding cost**: new ADR authors must understand the 3-tier taxonomy + classify their ADR. Mitigated by `_README.md` taxonomy section + ADR-0004's tier-disambiguation prose + 4 existing examples (one per technical/governance/editorial + this ADR for governance-with-cross-tier-shape).
- **Code-review tax**: reviewers must verify `tier` field presence + check classification reasonableness. Mitigated by mechanical presence-check (grep `^tier:`) + ADR-by-ADR review is bounded (new ADR PRs are rare in substrate cadence — ~5 per year historically).
- **Ledger-cardinality dependency**: if the substrate grows to need a 4th tier (e.g., "meta" for ADRs about the ADR system itself), the 3-value enum requires extension. Mitigated by treating this ADR as supersession-eligible if a 4th tier becomes load-bearing. Open question below.
- **Field-naming risk**: `tier` is generic; readers may confuse with other tier-shaped concepts (e.g., trust-tiered verification per `agent-identity` system). Mitigated by frontmatter context — `tier` in ADR frontmatter unambiguously refers to ADR taxonomy.

**Open questions** (what we still don't know):

- Should a 4th "meta" tier exist for ADRs about the ADR system itself (e.g., this ADR-0004; future ADRs about ADR tooling)? Currently classified as `governance` because the load-bearing surface is the institutional commitment, but the underlying scope is meta. Drift-note candidate; revisit if 3+ ADRs surface that match the "meta" shape.
- Should `tier` be plural (`tiers: [technical, governance]`) for legitimately-spanning ADRs? Current decision: single-valued via dominant-invariant rule. Drift-note candidate; revisit if 3+ cross-tier ADRs surface AND the dominant-invariant rule produces classification difficulty in practice.
- Should drift-detection hook emit tier alongside title at edit time? Currently does not (the hook reads frontmatter for `files_affected` + `invariants_introduced` only). Future enhancement; deferred to H.9.x because the present hook output is already at Convention G's class-1-advisory headroom.

## Alternatives Considered

### Alternative A: prose-only (status quo)

Continue with ADR-0005's prose declaration of the 3-tier taxonomy; no frontmatter field. Rejected because:

- Prose-only is institutional-luck. New authors may not read ADR-0005 lines 60-66; new ADRs may land without tier consideration; the discipline erodes silently.
- Tooling cannot reason about tier (no data substrate); future filtering / drift-detection grouping requires re-parsing prose.
- The 5-agent chaos test + HETS code review explicitly flagged this as a schema-vs-prose gap. Closing the gap requires codification.

### Alternative B: tier as a body-section heading

Codify tier as an H2 section in each ADR body (e.g., `## Tier: technical`) rather than frontmatter field. Rejected because:

- Body sections are not machine-readable in the same way as frontmatter. `adr.js read 0001` returns full body; programmatic filtering requires regex against body content.
- Frontmatter is the canonical "machine-readable fields" surface per `_README.md` line 29 ("Frontmatter (machine-readable fields)"); body sections are prose.
- The existing schema layer is well-defined; adding a field is lower-cost than introducing a new sectioning convention.

### Alternative C: tier as a label/tag list

Codify tier as a YAML array (`tags: [technical]`) rather than a single-valued field. Rejected because:

- Tag-style allows ADRs to declare multiple tiers; this conflicts with the dominant-invariant rule (tiers are exclusive by design).
- Tag systems tend toward sprawl over time (new tags accumulate; semantics drift). Single-valued enum keeps the taxonomy bounded.
- Cross-tier ADRs are handled via dominant-invariant rule + prose acknowledgment in the body, not via multi-valued tags.

### Alternative D: do nothing (let the taxonomy remain prose-only)

The substrate operated prose-only from HT.1.13 → HT.3.1 (4 weeks). Why codify now? Rejected because:

- The 5-agent chaos test + HETS code review surfaced the gap externally; user-facing audit signal is present.
- Retroactive cost grows with ledger size; codifying at 4-ADR ledger is cheaper than 10+.
- The institutional commitment is already operating; codifying makes it visible at the schema layer where new authors land.

## Status notes

- 2026-05-11 — proposed by root in HT.3.1 sub-plan; sub-plan-only methodology per HT.1.7 + HT.2.4 + HT.1.13 architect-MEDIUM-2 absorption precedent (codification of pre-existing prose, not fresh institutional commitment)
- 2026-05-11 — accepted at HT.3.1 ship; transition recorded here for transparency rather than authoring transient `proposed` state on disk (per HT.1.7 + HT.1.13 same-day proposed→accepted convention; ADR-0003 + ADR-0005 precedent)

## Related work

- **Drift-notes**: none directly. The schema-vs-prose gap was surfaced by 5-agent chaos test + HETS code review (post-HT audit-followup) rather than via in-flight drift-note inventory.
- **Phase tags**: HT.1.13 (ADR-0005 introduced the 3-tier taxonomy in prose at lines 60-66 via architect MEDIUM-2 absorption); HT.3.1 (this ADR's source case — codification at schema layer); HT.3.3 will inherit `tier: technical` annotation for ADR-0002 simultaneously with status `proposed` → `accepted` transition.
- **KB pattern docs**: `architecture/discipline/error-handling-discipline.md` (the substrate-curated principle that ADR-0001 implements; technical-tier reference); `architecture/crosscut/single-responsibility.md` (single-tier-per-ADR per dominant-invariant rule is an SRP analog at the metadata layer).
- **Sibling ADRs**: ADR-0001 (technical exemplar; the canonical reference for "mechanical invariants verifiable by grep/lint/test"); ADR-0002 (technical exemplar; bridge-script entrypoint criterion); ADR-0003 (governance exemplar; institutional commitment + code-review gate); ADR-0005 (editorial exemplar + the prose source of the 3-tier taxonomy at lines 60-66).
- **External**: none. The 3-tier taxonomy is substrate-specific; no canonical-knowledge counterpart in software-engineering literature. The closest analog is the "code review tiers" pattern in some open-source governance docs (e.g., kernel.org's maintainer tiers) — but those are about *who reviews*, not *what is reviewed*. Substrate's tier-by-ADR-shape is distinct.
