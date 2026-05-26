# @power-loom/lab

**Loom Evolution Lab layer** — maps to v4 substrate synthesis §2 Layer 3.

Adaptive cognition. Experimental. PATCH-iterable. **NEVER promoted to kernel without an ADR.**

**Empty in v3.0-alpha.** Phase 0 created the home; v3.3+ fills it.

## What WILL live here (v3.3+)

- `negative-attestation/` — observation tools without enforcement authority
- `policy-axioms/` — adaptive policy proposals (kernel reads via K4 recall-CLI through A6 snapshot; not a static import)
- `reputation/` — per-persona + per-identity scoring across runs
- `attribution/` — provenance tracking for emitted artifacts
- `convergence/` — paired-with convergence measurement
- `evolve/` — agent + skill evolution loop
- `review/` — adaptive code-review heuristics
- `circuit-breaker/` — degraded-mode triggers

## Boundary invariants (K12 advisory; v3.3+)

- NO direct kernel-path writes — K12 enforces (convention + advisory per v5.1 downgrade)
- NO direct runtime gating — advisory only
- Filesystem reads of `~/.claude/library/sections/toolkit/**` from kernel are permitted IFF A6 snapshot interposes (Phase 0 plan §17 open question 5; flag for v3.0-alpha K12 implementation)
