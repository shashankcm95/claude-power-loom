# Design: Tiered Memory with Demote-by-Score (replacing compress-to-budget)

> **Folded into [ADR-0018 — the canonical memory architecture](../adrs/0018-memory-architecture.md) (2026-07-06).**
> This is a superseded design note; its demote-by-score / demote-never-delete model is part of the ADR's shared
> pattern-kernel. Per the supersede-not-fork discipline, a memory-design change supersedes that ADR, never this note.

Status: DESIGN / proposal. Grounded in a cited web-research pass (2026-06-25, deep-research workflow). Author intent:
replace the current "compress `MEMORY.md` to fit a byte budget" curation with a principled tiered-demotion scheme so
nothing is lost and the hot set stays lean.

**Build status (2026-06-25):** the CURATION POLICY half SHIPPED (source edits, pending merge + `install.sh --rules`):
the demote-by-score rule + section-inferred importance convention + invariant-protection were added to
`packages/skills/rules/core/self-improvement.md` (Pre-Compact Awareness) and reinforced in the compaction-moment
prompt at `packages/kernel/hooks/lifecycle/pre-compact-save.js` (`buildSavePrompt` Task 1). Validated by hand on this
session's compaction (two closed blocks demoted to `[[scars-graduate-candidates]]` + the ingress snapshot, MEMORY
back under budget without lossy rewriting). The deterministic `memory demote` HELPER (script ranks candidates, curator
confirms) is the DEFERRED follow-up — see "Implementation sketch" below.

## Motivation (the problem)

The pre-compact curation today hits the `MEMORY.md` soft byte budget (~24,986 B) by **lossy compression in place**:
paraphrasing, dropping clauses, merging lines. USER critique (2026-06-25): stale content should instead be **pushed
to an archive (or other places) with links, retrievable when needed**, rather than crammed. The research confirms the
critique: lossy index-compression is the named anti-pattern; the consensus is hot/cold tiering with just-in-time
retrieval.

## Research consensus (cited; full report in the 2026-06-25 deep-research run)

1. **OS-style memory hierarchy is the dominant architecture.** Context window = fast/limited "RAM"; an external store
   = large/slow "disk"; page between them. MemGPT/Letta "virtual context management" (core / recall / archival tiers),
   uncontested as the pattern. [arXiv:2310.08560; letta.com/blog/agent-memory]
2. **Anthropic's "just-in-time" memory:** keep lightweight IDENTIFIERS (file paths, links, queries) in-context, load
   full data at runtime. This IS demote-to-archive-with-links, and is named as the replacement for cramming.
   [anthropic.com/engineering/effective-context-engineering-for-ai-agents]
3. **Maximize recall first, then precision.** Aggressive summarization loses subtle context whose importance surfaces
   later. A direct argument against lossy index-compression. [same Anthropic source]
4. **Summarize-vs-archive is HYBRID, not binary:** keep a lossy summary in-context for continuity WHILE preserving the
   verbatim record in a retrievable store; evict a portion, never all. [MemGPT/Letta]
5. **Hot-vs-cold is scored by recency + importance + relevance** (Generative Agents): recency = exponential decay;
   importance = a salience score set AT WRITE TIME; relevance = similarity to the active query. The load-bearing
   nuance: **importance is a distinct signal that PROTECTS high-salience items from staleness-based eviction.**
   [arXiv:2304.03442]
6. **Anthropic ships the pattern:** context-editing evicts oldest content from the model's view but the client keeps
   the FULL history (curate the hot view, do not destroy the record); paired with a memory tool that writes essentials
   to persistent files before clearing. [platform.claude.com/docs/en/build-with-claude/context-editing]

Caveats (honest): the specific numbers (0.995 decay, 1-10 importance, ~70% eviction, Anthropic's 100k trigger) are
illustrative DEFAULTS, not tuned optimums. A vector DB is NOT required: our structured-linked file memory is a
consensus-valid modality (token-level retrieval) and is better for a curated, human-auditable substrate. Anthropic's
context-editing + memory-tool primitives are BETA. One five-families taxonomy is a single-author 2026 preprint (cite
as "one survey proposes", not consensus).

## Current state (what we already have right, and the one thing wrong)

Our structure ALREADY maps to the consensus, this is a policy fix, not a re-architecture:

| Tier | Today | Consensus role |
|---|---|---|
| HOT | `MEMORY.md` (always cold-loaded at session start; soft byte budget) | in-context "RAM" / core memory |
| WARM | `[[topic-file]]` links in the memory dir (loaded on demand) | just-in-time identifiers -> external context |
| COLD | the library session-snapshots + `_archive/` dirs | archival storage (verbatim, retrievable) |

Retrieval path exists: `[[name]]` links + `loom-recall` (kernel `L_global` library recall) + the topic files.

**The one thing wrong: the curation POLICY.** When HOT exceeds budget, the curator COMPRESSES (lossy) instead of
DEMOTING (move to WARM/COLD, leave a linked pointer, verbatim preserved). That is the anti-pattern finding #3 names.

## Proposed scheme: demote-by-score, not compress

When `MEMORY.md` exceeds the hot budget, do NOT rewrite entries to be shorter. Instead:

1. **Score each entry** = `recency` + `importance` + `relevance`:
   - **recency** — how long since the entry was last touched / referenced (staleness; decays with age).
   - **importance** — a salience tag set WHEN WRITTEN: `invariant` (load-bearing, never auto-demote) | `project`
     (active-work state) | `historical` (a closed arc) | `transient` (ephemeral). Maps to the existing sections
     ("Canonical / do not re-litigate", "Load-bearing invariants" = high importance).
   - **relevance** — does the entry bear on the ACTIVE phase (the START-HERE block / the current wave)? Cheap
     heuristic (no embeddings needed): is it referenced by, or about, the active work?
2. **Demote the low-score entries** (stale AND low-importance AND not-relevant) to a dated archive file
   (`memory/_archive/<YYYY-MM>-demoted.md` or an existing topic file), leaving a ONE-LINE `[[link]]` pointer in the
   index. Verbatim preserved; retrievable on demand.
3. **The USER-refinement (load-bearing):** demotion gates on **low importance TOO**, never staleness alone. A
   stale-but-`invariant` entry (e.g. the kernel record-store rules) STAYS HOT regardless of age. This is exactly the
   protection finding #5's importance signal exists for.
4. **Hybrid (finding #4):** the index keeps a one-line summary + link for demoted content (lossy summary for
   continuity); the archive keeps the verbatim entry. Demote, never delete.
5. **The byte budget stays as a HOT-tier bound** (the context window IS bounded), but it is met by MOVING content down
   a tier, not by lossy rewriting. The archive is unbounded.

## Implementation sketch (the build wave, post-compact)

Surfaces the implementation will touch (all in-repo):

- **The importance-tag convention** — formalize a frontmatter/inline `importance:` tag on MEMORY entries (or infer
  from the existing section: Canonical / Load-bearing = `invariant`; START-HERE = `project`; "HISTORICAL" lines =
  `historical`). Document in `rules/core/self-improvement.md` (the memory-write rule).
- **The demotion policy** — change the curator instruction (in `rules/core/self-improvement.md` Pre-Compact Awareness
  and the `pre-compact-save.js` prompt text) from "compress to budget" to "demote-by-score, protect `invariant`,
  leave a `[[link]]`."
- **A `memory demote` helper (optional, the self-editing-memory pattern, finding from MemGPT/Letta)** — a script that
  MOVES an entry to the archive, leaves the one-line pointer, and re-checks the budget. Deterministic; the curator (or
  the hook) invokes it. Mirrors `scan-stale-artifacts.js` + the workspace-hygiene archive convention.
- **The archive + retrieval** — reuse the existing `_archive/` convention + `[[links]]` + `loom-recall`. No vector DB.
- **A budget check that reports the OVER amount + the demotion candidates** (lowest-score entries), so the curator
  demotes the right ones rather than trimming arbitrarily.

## Open questions (resolve at build / VERIFY)

1. How to compute `relevance` cheaply without embeddings? (Lean: a heuristic on "referenced by the active
   phase / START-HERE" + section membership; revisit if it under-selects.)
2. Where do demoted entries land, a single rolling `_archive/<YYYY-MM>-demoted.md`, or back into the topical
   `[[topic-file]]` they belong to? (Lean: topical when an obvious topic file exists; the dated archive otherwise.)
3. Should the demotion be agent-driven (the curator decides, self-editing) or deterministic-scored (the script
   ranks, the curator confirms)? (Lean: script ranks + curator confirms, keeping the human/agent in the loop and
   the move auditable.)
4. Is the byte budget the right hot-tier bound, or should it be a token budget (closer to the real context cost)?
   (Lean: token-aware, but byte is a fine proxy for now.)

## Relationship to the autonomous-SDE substrate

This is its own concern (the OPERATING memory of the toolkit), distinct from the lab's world-anchor/recall-graph
(the autonomous-SDE LESSON memory). But the patterns rhyme: both are "structured-linked stores with retrieval," and
the importance/recency/relevance scoring here is the same family as the lab's lesson retrieval. Keep them separate
modules; share the conceptual vocabulary.

## Citations

- MemGPT (virtual context management): https://arxiv.org/abs/2310.08560
- Letta agent-memory (tiers, self-editing): https://www.letta.com/blog/agent-memory/
- Generative Agents (recency+importance+relevance retrieval): https://arxiv.org/abs/2304.03442
- Anthropic, effective context engineering (just-in-time, maximize-recall-first): https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, context editing + memory tool (server-side eviction, client keeps full history): https://platform.claude.com/docs/en/build-with-claude/context-editing
- A Survey of Context Engineering for LLMs (temporal classification, retrieval ops): https://arxiv.org/pdf/2507.13334
