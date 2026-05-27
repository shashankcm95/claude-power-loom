---
adr_id: 0014
title: "Adopt Memory Root Pointer Convention for substrate discovery"
tier: technical
status: proposed
created: 2026-05-27
author: 04-architect.theo (v6 Artifact 4 + PB-1 user-lock)
superseded_by: null
files_affected:
  - packages/kernel/_lib/memory-root.js
  - packages/specs/rfcs/v6-substrate-synthesis.md
invariants_introduced:
  - "INV-26-MRAtomicWrite — updates to memory-root.json use tmp+fsync+rename atomic primitive"
  - "INV-27-PersonaIndexCanonicalOnly — persona_memory_index indexes ONLY kernel-canonical records; derived views are never indexed there"
related_adrs:
  - 0013
related_kb:
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/dependency-rule
  - architecture/discipline/error-handling-discipline
---

## Context

v5.4 hard-codes substrate discovery paths across hooks, validators, and the recall-CLI. Concretely: `~/.claude/checkpoints/attestation-log.jsonl` (WAL), `~/.claude/library/_meta/causal-graph-{scope}.json` (causal-recall index), `~/.claude/library/_meta/persona-blocks-index.json` (persona memory index). Hard-coding has three load-bearing problems:

1. **Per-project scope is impossible** — a substrate operator who wants project-scoped state (sandboxed dev environment, multi-tenant deployment) must edit hook code, not configuration.
2. **A8/A9 require a known WAL location BEFORE the recovery sweep can run** — the recovery sweep on startup needs to find the WAL; the WAL is a configuration concern; configuration cannot be encoded as a hard-coded path without breaking A8's discovery story.
3. **Schema evolution requires a migration anchor** — when the substrate's persona-memory schema advances (v6.0 → v6.1), the migration needs a stable discovery point that survives the migration. Hard-coded paths in 16 hook scripts is not that.

Working through the v3.0-alpha implementation surfaced these problems. v6 introduces the Memory Root Pointer as the single discovery artifact. Initial Artifact 4 included an `active_state_hash` field as a perf cache for the WAL-tail-computed state hash; **PB-1 user-lock (2026-05-27)** rejected this field — caching state in a separate file re-opens the dual-write inconsistency surface A8 was designed to eliminate.

This decision is being made NOW because the K2 reservation PR (~180-285 LoC, ~6-9h, inside the v3.0-alpha envelope) needs to land with the pointer reader stubbed in so v3.1+ hook refactors can depend on it.

## Decision

Adopt `memory-root.json` as the substrate's **single discovery artifact** for locating persona memory.

Canonical schema (v6.0):

```json
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

Scope precedence: per-project pointer at `<cwd>/.claude/loom/memory-root.json` (with `project_context` matching CWD) overrides per-user pointer at `~/.claude/loom/memory-root.json`. Otherwise per-user is canonical.

Discovery: kernel reads `memory-root.json` first. No path is hard-coded in hooks/validators beyond the root pointer location itself.

Atomicity: updates use tmp-write + fsync + atomic-rename per §5a.2 (reuses the K1/K9 atomic-write primitive). Codified as INV-26-MRAtomicWrite.

Startup ordering: (1) resolve `memory-root.json`; (2) resolve `manifests.attestation_wal`; (3) run A9 recovery sweep against the resolved WAL. The pointer is the precondition of the sweep.

Bootstrap: missing pointer → reconstruct by scanning well-known defaults + write fresh; schema-invalid → treat as missing (do not half-parse); on bootstrap, the WAL is empty, the active state is the deterministic empty replay, the first real transaction's `prev_state_hash` equals the genesis sentinel (§4.3).

Pointer self-migration: NOT executed as an A9 transaction (it is the precondition of A9). Instead: atomic tmp+fsync+rename + post-rename `memory_root_schema_migrated` attestation to the WAL carrying from/to schema_version + content-hashes. This is the only substrate-emitted record that legitimately has `intent_recorded_at == committed_at` and `commit_outcome: COMMITTED` set directly (per §5a.8 exception).

Index scope: `persona_memory_index` indexes ONLY kernel-canonical records (K2/K3/K9 chain entries, R13 advisory-findings, A6 snapshots). Derived views are NEVER indexed there. Codified as INV-27-PersonaIndexCanonicalOnly.

## Consequences

**Positive consequences**:

- Hooks, validators, and the recall-CLI no longer hard-code paths. One discovery point; all consumers read from it.
- Per-project scope becomes a configuration concern, not a code concern.
- A8 single-source-of-truth is preserved — the pointer is discovery-only; the WAL is canonical for state.
- INV-27 closes the path by which derived views could backdoor into evidence-link selection (composes with A10 + §0a.3.1 to form the two-layer + index-scope triple-defense).
- Schema migration becomes auditable — the pointer's self-migration emits a WAL attestation; the substrate's schema migration is an A9 transaction.

**Negative consequences**:

- Startup ordering is now sequenced — pointer resolution MUST complete before recovery sweep starts. No parallel startup work in steps 1-3.
- Bootstrap-on-missing-pointer adds ~30-50 LoC of well-known-defaults-scanning logic. Marginal complexity, but real.
- Self-migration is the only substrate record with `intent == committed`; readers + replay tools must special-case this.
- `derived_views_cache` adds a new directory the substrate manages; v3.3 ships without cache-GC; long-running installs may accumulate stale projections.

**Open questions**:

- Whether `schema_compat_floor` enforcement is too strict — fresh installs of newer substrate against older pointers may fail-closed unnecessarily. v3.0-alpha ships strict; v3.1+ may relax to "warn-and-attempt".
- Whether per-project scope precedence needs a more sophisticated match than `project_context == CWD` (e.g., parent-directory walks for sub-package work). v3.0-alpha ships the exact-match; v3.1+ may extend.

## Alternatives Considered

### Alternative A: `active_state_hash` dual-write field in `memory-root.json`

Initial Artifact 4 included a cached `active_state_hash` field that would be updated whenever the WAL advances, providing O(1) lookup of "what's the current state" without walking the WAL tail. Rejected at PB-1 user-lock. Re-opens the dual-write inconsistency surface A8 was designed to eliminate — the cache can disagree with the WAL (cache stale, cache corrupt, cache lag), and resolving the disagreement requires choosing one source over the other. A8 already chose: the chain is canonical. The cache either has no value (always disregarded) or violates A8 (sometimes disagrees). Removed entirely per user-lock.

### Alternative B: Hard-coded paths (status quo from v5.4)

Keep paths hard-coded in 16+ hook scripts. Rejected — fails for per-project scope, blocks schema migration, and any path change requires editing 16 files.

### Alternative C: Environment-variable configuration

Use `LOOM_WAL_PATH`, `LOOM_INDEX_PATH`, etc. as environment-variable overrides. Rejected — env vars are per-shell, not per-substrate-instance; multiple substrate processes on the same host (CI runner + dev environment) would interfere; no atomic update path; no audit trail for changes.

### Alternative D: do nothing

Live with the v5.4 hard-coded paths. Rejected because the K2 reservation PR's transaction-record envelope NEEDS a discoverable WAL location, and A8/A9 NEED a stable discovery anchor before recovery-sweep can run. Doing nothing blocks v3.0-alpha implementation.

## Status notes

- 2026-05-27 — proposed by 04-architect.theo as v6 Artifact 4; PB-1 user-lock dropped `active_state_hash` field.
- v3.0-alpha LOCK target — accepted; reader stub lands in K2 reservation PR.

## Related work

- v6 Artifact 4 (locked drafting input): `/tmp/v6-drafting-input-locked.md`.
- v6 §5a.9 — Memory Root Pointer Convention (this ADR's implementation specification).
- v6 §5a.5 — Recovery sweep precondition (the load-bearing sequencing constraint).
- v6 §5a.8 — Schema-version migration as transaction (with the pointer-self-migration exception).
- v6 §6.13 — invariants 26/27 (the testable property contracts).
- ADR-0013 — Endorsement Derived View (sibling v6 ADR; `manifests.derived_views_cache` is the discovery point E14 depends on).
- `kb:architecture/crosscut/single-responsibility` (one discovery artifact, one responsibility — load-bearing rationale).
- `kb:architecture/crosscut/dependency-rule` (Kernel pointer is discovered; Lab/Runtime depend on the pointer, not vice versa).
- `kb:architecture/discipline/error-handling-discipline` (fail-closed on corrupt pointer — DO NOT half-parse).
