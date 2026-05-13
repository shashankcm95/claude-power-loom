# Library vs MempPalace — design-deltas

H.9.21 v2.1.0 introduces an in-house **library memory organizer** inspired by — but architecturally independent from — **MempPalace** (Jovovich + Sigerson; MIT; https://github.com/mempalace/mempalace).

This doc captures the deltas to make attribution honest and design rationale legible.

## What we borrowed (concepts only)

1. **Index + content separation** — MempPalace's catalog-card-pointing-to-drawer-content pattern. Our `_catalog.json` + `volumes/<id>.{md,json}` mirrors this shape.
2. **Load-on-demand context strategy** — Zettelkasten's discipline of not loading all content into working memory; only the index card + selectively-fetched contents.
3. **4-layer L0-L3 mental model** — Reader Profile = L0 (always loaded); rest of library reachable on-demand. We don't formally codify L1-L3 in v2.1.0.

## What we did NOT borrow

| Their | Ours | Why different |
|---|---|---|
| Palace / Wings / Rooms / Closets / Drawers | Library / Section / Stack / Catalog / Volume | **Plagiarism/trademark avoidance** per user directive. Library metaphor is a universal English idiom; coined-hierarchy vocabulary would have been derivative naming. |
| ChromaDB + embeddings + Python deps | Local-files only (JSON catalogs + .md/.json volumes) | Our scale (100s-1000s of items) is well within file-system performance. ~300MB model weights + Python dep is overkill for our use case. |
| MCP integration as primary | No MCP at all | MempPalace MCP was never installed in any production session per our chaos-audit; the "fallback" path WAS the substrate. v2.1.0 owns that fully. |
| All-verbatim conversation storage | **Selective verbatim** via dual storage modes (narrative for prose; schematic for aggregates) | Verbatim everything is inefficient for structured aggregates (counters, verdict histories). Dual modes via `form` discriminator on each volume. |
| AAAK compression (entity-code shorthand) | Not adopted | Requires LLM-side decode infrastructure we don't have; deferred to v2.2+ if compelling use case emerges. |

## What MempPalace did first (no claim of novelty)

- The PreCompact hook pattern: deterministic checkpoint write + LLM-side enrichment instruction (we kept this verbatim in `pre-compact-save.js`)
- The "hooks over prompts" reliability principle (our point #1 in design philosophy)
- The Zettelkasten-rooted index/content separation (we copied the shape)

These remain credited in `ATTRIBUTION.md`.

## What we did that MempPalace didn't

- **Saga-protected migration** with backup-before-write + idempotency-key sentinel + explicit rollback (CRITICAL #1 from our H.9.21 MANDATORY-gate review)
- **Fail-closed hook guard** detecting library-init-but-migrate-incomplete race (CRITICAL #2)
- **Per-stack catalog locking** under HETS parallel-write stress (Component N)
- **Per-store schema versioning** (NOT one global; Component M — `section.json.store_schema_versions`)
- **Chaos-test isolation** via `CLAUDE_LIBRARY_ROOT` env override (Component O bulkhead)
- **6 named test scenarios** (J1-J6) wired into install.sh — all live-verified at ship

These design choices were arrived at via architect + code-reviewer parallel spawn at plan-time (MANDATORY-gate per HT.1.6 4/5 triggers), with both reviewers grounded in our 37-doc kb tree at `skills/agent-team/kb/` per the H.9.20.0 KB-consultation-discipline.

## File-system layout deltas

MempPalace's hierarchy was `palace/wings/rooms/closets/drawers` (5 levels deep at the storage tier). Ours is `library/sections/stacks/{volumes,_catalog.json}` (effectively 3 storage levels + 1 catalog-as-index card). One level less of nesting; explicit index file at the stack tier rather than implicit "closet" semantics.

## Why a fresh vocabulary

User-flagged concern at plan-time: using MempPalace's coined vocabulary verbatim risks plagiarism/trademark overlap. The library metaphor is a universal English idiom (Borges, Le Corbusier, libraries-as-architecture in OOP texts) — anyone in the field can use it without attribution baggage. Cleaner authorship, equally legible meaning.

## See also

- `ATTRIBUTION.md` — full attribution with deltas
- `docs/library.md` — concepts + CLI reference
- `CHANGELOG.md` v2.1.0 — MANDATORY-gate review trail
