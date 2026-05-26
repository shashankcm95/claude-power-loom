# kb/architecture — Planning Area

Working files for authoring the architectural-fundamentals knowledge base. This directory holds **planning artifacts** (taxonomy, notes, sources, principles); the **authored pattern docs** ship to `skills/agent-team/kb/architecture/` once ready.

## Why this exists

The substrate's existing `kb/` is keyed on strict frontmatter (`kb_id`, `version`, `tags`) and auto-scanned by `kb-resolver`. Working notes, source logs, and curation principles don't fit that schema. They live here in `swarm/` (the substrate's working area, alongside chaos-test runs and phase findings) until the authored pattern docs are ready to ship to canonical kb.

## North star

Build a substrate-native architectural KB that anchors LLM reasoning on canonical patterns rather than the activation-mixture-distribution from training data. RAG-shaped: deterministic relevance routing → small set of authored docs in context → reduced drift on architectural decisions.

This is **proto-OS internal positioning, plugin external positioning** (per H.7.27+ direction). The KB is a kernel feature once it lands; for now, it's authoring prep.

## Working files (read all of these every session)

| File | Purpose |
|------|---------|
| `_PRINCIPLES.md` | Curation criteria + scope rules + quality bar. Read first. |
| `_TAXONOMY.md` | Target structure for the KB tree. Slots to fill. |
| `_NOTES.md` | **Load-bearing memory layer.** Pattern notes from source ingestion. Without this, prior context is lost across sessions (Claude has no cross-session memory; substrate filesystem IS the memory). |
| `_SOURCES.md` | Log of sources processed + tier classification. |

## Workflow phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Infrastructure setup (this PR) | In progress |
| 2 | Source ingestion (per-session, user passes URLs/excerpts) | Pending |
| 3 | Convergence detection (every 5-10 sources, brief sessions) | Pending |
| 4 | Authoring (priority by consensus; ships to `skills/agent-team/kb/architecture/`) | Pending |
| 5 | KB integration with `kb-resolver` + HETS spawn flow (post-soak; v2.1+) | Out of scope here |

## Soak compatibility

Phases 1-4 are **authoring-only**. No runtime changes. No hook modifications. No agent contract changes. Soak-counter for v2.0 is preserved.

Phase 5 (integration) carries runtime risk; reserved for post-soak.

## Per-session protocol

Start of session:

1. Read `_PRINCIPLES.md` (refresh curation criteria)
2. Read `_NOTES.md` (restore prior context)
3. Read `_SOURCES.md` (check what's been processed)
4. Confirm with user: which phase + what to do this session

End of session:

5. Update `_NOTES.md` with new findings
6. Update `_SOURCES.md` with sources processed
7. Brief summary back to user

## Out of scope

- Runtime integration (`kb-resolver` extension, `architecture-relevance-detector`, ADR primitive) — defer to v2.1+ post-soak phase
- Pattern claims as RL signal — deferred per H.7.x brainstorm conclusions
- Multi-tenant OS-grade primitives — proto-OS positioning is internal only

## Related work

- v2.0 soak — substrate runtime stable; this work runs in parallel
- v2.1 candidate — kb integration + static-analysis pre-write gate + ADR primitive
- Drift-note 21 / Convention G — established the discipline that this KB extends
