---
adr_id: 0010
title: "Write-scope enforcement via K14 snapshot + post-spawn-resolver (v3.0-alpha)"
tier: technical
status: accepted
created: 2026-05-28
author: 04-architect.theo (HETS-routed Phase 1-alpha design)
superseded_by: null
files_affected:
  - packages/kernel/_lib/k14-write-scope.js
  - packages/kernel/_lib/k14-snapshot.js
  - packages/kernel/_lib/k14-tail-window.js
  - packages/kernel/_lib/k14-symlink-guard.js
  - packages/kernel/spawn-state/post-spawn-resolver.js
  - packages/kernel/spawn-state/recovery-sweep.js
  - packages/kernel/spawn-state/spawn-record.js
  - packages/kernel/_lib/k9-promote-deltas.js
invariants_introduced:
  - "INV-K14-PostDetectionEnforcement: K14 snapshot computed AFTER spawn completes; out-of-scope writes are detected, NOT prevented at write-time (the snapshot is the source of truth)"
  - "P-WriteScope: every spawn-record carries a write-scope-snapshot field declaring permitted write paths"
  - "INV-A7: violations of P-WriteScope are recorded in spawn-record as `write_scope_violations[]`, never silently dropped"
related_adrs:
  - 0009
  - 0011
related_kb:
  - architecture/crosscut/idempotency
  - architecture/discipline/stability-patterns
---

## ⚠️ Provisional Status — Reconcile with K14 final impl at PR 4 merge

**Per post-compact PR-1 R1 FL-6 (2026-05-28)**: this ADR ships in PR 1 (rationale-first) before K14 ships in PR 4 (impl-later). The risk: K14 impl may diverge from the rationale captured here.

**Reconcile gate (mandatory PR 4 merge checklist item)**:
- [ ] **ADR-0010 reconciled with K14 final impl** — a named PR 4 reviewer reads this ADR alongside the K14 implementation in `packages/kernel/_lib/k14-write-scope.js` (or its split files per RA-1) and CONFIRMS no rationale-vs-impl divergence. If divergence exists, this ADR is amended in the same PR.

Without this gate, this ADR risks becoming a stale historical artifact at the moment it ships.

> **PR-4 Re-grounding (2026-05-30 verify-plan HETS pass)**: the reconcile gate is now a **numbered phase in PR-4b** (not a floating checkbox), and the authoritative re-grounding of K14 / resolver / sweep against merged code lives in **ADR-0011 §"PR-4 Re-grounding Amendment"** (canonical resolver table, `write_scope_violations[]` schema, K13 provenance, recovery-replay). PR 4 ships split: **4a** = K14(+split) + the `spawn-record.js` envelope field + K13 fixes (dormant); **4b** = resolver + recovery-sweep + K9 `rollbackPromotion` + the status flip `provisional-until-pr-4` → `accepted`.

## Context

The v6 substrate synthesis (per `packages/specs/rfcs/v6-substrate-synthesis.md` §6.5) commits to write-scope enforcement as a Pillar-2 invariant: every spawned actor MUST write only to declared paths. Violations are correctness failures that pollute the substrate state (introduce ghost writes, break lineage chains, create unattributable side effects).

The naive enforcement model — "intercept every write at the syscall layer" — was rejected at v6 lock-time because it requires either:
- Native code instrumentation (LD_PRELOAD, syscall filters) — high deployment friction, platform-specific
- Process-level write-protection (chroot, mount-bind) — too coarse-grained for fine-typed write-scope declarations
- Custom filesystem (FUSE) — performance overhead + reliability concerns at substrate-fundament tier

Forces:
- Substrate is single-user, local-trust threat model — actors are not adversarial; they may be misconfigured or buggy
- Operator runtime is heterogeneous (macOS + Linux + WSL) — kernel-level instrumentation is non-portable
- Write-scope violations should be REPRODUCIBLE post-spawn (so debuggers can see what happened), not silently blocked
- Recovery sweep needs to detect violations even when the originating spawn crashed mid-write

## Decision

Adopt **post-detection enforcement** via K14 snapshot algorithm. The substrate does NOT prevent out-of-scope writes at write-time. Instead:

1. **Spawn declares scope at admission** — write-scope-snapshot is a declarative claim recorded in the spawn-record at spawn-init time.
2. **K14 snapshots the filesystem at spawn-close** — after the spawn completes (or after a tail-window timeout for crashed spawns), K14 walks the declared write paths + their parents and computes a content-hash snapshot.
3. **post-spawn-resolver compares snapshot to declared scope** — any file outside the declared write paths whose content-hash changed since spawn-init is flagged as a `write_scope_violation` and recorded in the spawn-record's `write_scope_violations[]` envelope field (added to `spawn-record.js` in PR-4a; per-element schema in ADR-0011 §write-scope-violations-schema).
4. **K9 (PR 3) consumes the violation set** at pre-commit time — promote-deltas refuses to commit a chain if any spawn in its evidence chain has a non-empty `write_scope_violations[]` (unless explicitly bypassed via combined env-var per ADR-0011 §combined-bypass).

### Key mechanics

- **Tail-window** (K14): a configurable window (default 5s) AFTER spawn-close during which late writes are still attributed to the spawn. After the tail-window closes, writes to declared paths are no longer attributed (handled by next spawn or sweep).
- **Snapshot transports**: file-modification-time + content-hash for small files (<1MB); content-hash only for large files. Symlinks are resolved at snapshot time; symlink races are tracked separately (see `k14-symlink-guard.js` per RA-1 split).
- **Recovery sweep** (PR 4): on substrate boot, sweep crashed spawns whose tail-window timestamps elapsed mid-crash; emit ABORTED records via WAL.

### Why post-detection (not pre-prevention)

Pre-prevention requires syscall-level instrumentation (rejected above). Post-detection accepts that out-of-scope writes happen but ensures they CANNOT silently advance the canonical state. The substrate's correctness guarantee is that violators don't commit, not that violators can't write.

## Consequences

**Positive**:
- Portable across macOS + Linux + WSL with zero native code
- Violations are debuggable (the write IS on disk; the snapshot diffs are inspectable)
- Recovery sweep is mechanical (filesystem walk + hash) — no kernel-level state needed

**Negative**:
- Out-of-scope writes happen and leave artifacts on disk before being detected; operators see "ghost files" until next sweep
- Performance: snapshot cost scales with declared write-scope size (mitigated by tail-window so most spawns avoid the full walk)
- TOCTOU windows between spawn-close and snapshot (mitigated by tail-window + recovery sweep)

**Mitigated**:
- Symlink-race CWE classes documented in `k14-symlink-guard.js` (per RA-1 split + Phase 1-alpha PR 4 phase 4)
- Sweep timeout governed by `LOOM_SWEEP_LOCK_TIMEOUT_MS` (default 30000ms; per ADR-0011 §sweep-timeout)
- Operator escape hatch `LOOM_FORCE_ADMIT_AFTER_SWEEP_TIMEOUT=1` for unblock-after-investigation cases

## Verification

- INV-K14-PostDetectionEnforcement: a synthetic out-of-scope-write fixture under `tests/fixtures/k14/violations/` produces a non-empty `write_scope_violations[]` array in the spawn-record AND is rejected by K9 pre-commit
- INV-A7: every write_scope_violation is reproducible — re-running the snapshot algorithm on the same filesystem state produces the same violation set (determinism)
- The resolver transition table — **SUPERSEDED by ADR-0011 §canonical-resolver-table** (the prior cross-product enumeration here did not map K9's six outcome codes nor the override / `ABORT_UNCONFIRMED` whole-tree-verify cells). The canonical table is the single authoritative spine `post-spawn-resolver.js` encodes.

Full verification probe enumeration lives in PR 4 phase section + INV-K14-PostDetectionEnforcement property test in `tests/unit/kernel/_lib/k14-write-scope.test.js` (PR 4 deliverable).
