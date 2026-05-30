---
adr_id: 0011
title: "K9↔K14 sequencing, Phase 1-alpha spec deltas, and rationale-before-code obligations"
tier: technical
status: provisional-until-pr-4
created: 2026-05-28
author: 04-architect.theo (HETS-routed Phase 1-alpha design) + post-compact PR-1 R1 amendments
superseded_by: null
files_affected:
  - packages/kernel/_lib/k9-promote-deltas.js
  - packages/kernel/_lib/k9-path-guard.js
  - packages/kernel/_lib/k9-journal.js
  - packages/kernel/_lib/k14-write-scope.js
  - packages/kernel/spawn-state/post-spawn-resolver.js
  - packages/kernel/spawn-state/recovery-sweep.js
  - packages/kernel/spawn-state/spawn-record.js
  - packages/kernel/_lib/context-envelope.js
  - packages/kernel/schema/context-envelope.schema.json
  - packages/kernel/hooks/pre/pre-spawn-tool-mask.js
  - packages/kernel/enforcement/k10-escape-hatch.js
invariants_introduced:
  - "K9 ships DORMANT in PR 3 (no production importer); first production importer is post-spawn-resolver in PR 4"
  - "K9↔K14 ordering is sequential: K14 snapshot completes BEFORE K9 pre-commit consumes the violation set"
  - "K3.b schema is PROVISIONAL until v3.1 (schemaVersion: 1.0.0-provisional); v3.1 may amend without backward-compat guarantee"
  - "Combined env-var bypass (LOOM_DISABLE_WORKTREE=1 + LOOM_ALLOW_OUT_OF_SCOPE_WRITES=1) is audit-logged but allowed in local-trust mode; DENIED in CI by default (LOOM_CI_DENY_COMBINED_BYPASS=1)"
  - "F22 scrubSecrets regex extensions enumerated in §F22 below; F22 impl in spawn-record.js BLOCKS on this ADR's finalization"
related_adrs:
  - 0009
  - 0010
related_kb:
  - architecture/crosscut/idempotency
  - architecture/discipline/stability-patterns
  - architecture/crosscut/single-responsibility
---

## ⚠️ Provisional Status — Reconcile with K9/K14 final impl at PR 4 merge

This ADR ships in PR 1 ahead of K9 (PR 3) + K14 (PR 4). The substantive spec deltas captured here are derived from the v6 substrate synthesis + 14 critical findings absorbed at master-plan design time + 13 PR-1-grain findings absorbed at post-compact /verify-plan R1. They are the design contract; K9 + K14 implementers MUST conform.

**Reconcile gate (mandatory PR 4 merge checklist item)**: a named PR 4 reviewer confirms this ADR's §K9↔K14-sequencing + §combined-bypass + §sweep-timeout sections are consistent with the K14 impl + recovery-sweep impl. Divergence triggers amendment in the same PR.

## Context

Phase 1-alpha's 5-PR cadence ships 11 kernel primitives across 4 substantive PRs (PR 1 = ADRs + K3/K3.b + bug-fix bundle; PR 2 = K1+K7+K10+K13; PR 3 = K9; PR 4 = K14 + post-spawn-resolver + recovery-sweep; PR 5 = K12 advisory). Cross-PR semantics need a canonical home that survives plan-PR squash; this ADR is that home.

## §K9↔K14 sequencing

K9 (pre-commit gate for promote-deltas) and K14 (write-scope enforcer) interact via the spawn-record's `write_scope_violations[]` field:

1. K14 (PR 4) populates `write_scope_violations[]` at spawn-close via the snapshot algorithm.
2. K9 (PR 3) READS the field at pre-commit time and REJECTS the chain if non-empty.

The sequencing is **sequential**, not concurrent: K14 must complete BEFORE K9 consumes. The post-spawn-resolver (PR 4) is the 5-path state machine that gates this hand-off:

| Path | Spawn state | Violations | Outcome |
|---|---|---|---|
| 1 | Completed normally | None | K9 pre-commit consumes chain; ready for promote |
| 2 | Completed normally | Non-empty | K9 rejects chain; emit violation summary in audit log |
| 3 | Crashed mid-spawn | Sweep finds it | Sweep emits ABORTED record; K9 sees ABORTED and skips |
| 4 | Crashed; tail-window elapsed at crash | N/A | Recovery-sweep treats as final; emit ABORTED |
| 5 | Sweep-incomplete (timeout) | N/A | Admission BLOCKS (correctness over liveness; user-decision settled at design time) |

**K9 DORMANT in PR 3** — per post-compact PR-1 R1 verification + Reviewer Amendment RA-2:
- PR 3 lands the K9 module + tests but NO production code path imports it
- The dormancy-assertion CI gate (`dormancy-assertion-k9`) BLOCKS PR 3 merge if any production importer is detected
- PR 4 introduces the first production importer (post-spawn-resolver) AND deletes the CI gate in the same commit (gate self-removes when dormancy ends)

## K9 split decision (PR 3)

Per plan line 138 (reviewer amendment 2026-05-27): the mandatory-split trigger fires at **projected impl-LoC > 700 measured at end of TDD Phase 1** (failing tests written + scaffolding stubs), NOT at PR-finalization. The earlier trigger prevents the impl-then-refactor tax.

**Projected impl-LoC: 760 → split verdict: SPLIT (3 files).** 760 > 700, so K9 ships as three single-responsibility modules rather than one `k9-promote-deltas.js`. The projection was authored up front during TDD Phase 1 so impl (Phase 3) writes straight to the partition.

LoC projection method note: the bare `(fixtures + cases) × 3` formula (atomic-write.js ratio: ~3 impl-LoC per test case) yields ~195, which materially **undercounts** here. The INV-K9-RejectFidelity property test, the crash-mid-abort syntactic-atomicity case, and the real-git F11 conflict-bailout case each drive far more than 3 impl-LoC apiece. 760 is the sum of the three per-module mid-estimates and lands inside the plan's own 650–1,050 HIGH-end band.

**Module breakdown (LOCKED partition; DAG strictly `orchestration → {leaves}`):**

| Module | Responsibility | Projected impl-LoC | DAG role |
|---|---|---|---|
| `packages/kernel/_lib/k9-path-guard.js` | CWE-22 path-traversal guard (delegates to K7 `checkWithinRoot`) + delta-SHA validation (40/64-hex accept; empty/non-hex/shell-metachar reject) | ~230 | leaf (imports K7; NOT the orchestrator) |
| `packages/kernel/_lib/k9-promote-deltas.js` | Cherry-pick orchestration + `--abort` conflict-bailout (F11) + evidence pre-commit gate (F9/INV-21) + F12 chain-walk bound | ~330 | orchestrator (imports both leaves) |
| `packages/kernel/_lib/k9-journal.js` | Append-only reverse-cherry-pick ledger (INV-19 append-only; `reverse_op = 'git revert <sha>'`) | ~200 | leaf (imports neither sibling) |

The acyclic guarantee is **tested**, not asserted: each leaf test (`k9-path-guard.test.js`, `k9-journal.test.js`) carries a `DAG: does NOT import k9-promote-deltas (no back-edge)` case, and `k9-promote-deltas.test.js` asserts the orchestrator imports both leaves while neither imports it (Martin acyclic-dependencies / morning-after-syndrome guard). Three test files mirror the three modules (closes the verify-plan HIGH "test coverage mapping ambiguous"). Probed 2026-05-30: all three test files load and run RED against the stubs (path-guard 3/6, journal 4/10, promote-deltas 5/9; each exits 1).

**Dormancy grep is split-aware** — the in-test dormancy gate and the PR-3 CI job `dormancy-assertion-k9` MUST use a disjunction over all three filenames `k9-(promote-deltas|path-guard|journal)` (excluding the `k9-*.js` module files themselves), NOT the single-token plan template at lines 296–306. A single-token grep against only `k9-promote-deltas` would let a production importer of `k9-path-guard` or `k9-journal` slip past the dormancy gate, defeating the §K9↔K14-sequencing dormancy invariant above.

### §F11 — cherry-pick conflict-bailout + execFile discipline

K9's git interaction is `git cherry-pick` (forward) against the **parent worktree** (the cherry-pick `cwd` is `parentRoot`; the cherry-pick arg is the spawn's delta SHA). On a 3-way conflict the orchestrator runs `git cherry-pick --abort`, which restores the host worktree byte-for-byte and leaves ZERO `.orig`/`.rej` artifacts behind — verified empirically against real git 2.50.1 in a hermetic temp repo (the load-bearing runtime probe the verify-plan HIGH demanded; the test skips cleanly rather than false-RED if git is unavailable).

- **CWE-78 (arg-array, no shell)**: git is invoked via an injectable `runGitFn` seam (`(args[]) => { ok, code, stdout, stderr }`, the K1 worktree-allocator pattern). F11's DRY premise was probed FALSE — `safe-exec.js` exports only `invokeNodeJson` / `invokeNodeText`, both hardcode `'node'`; there is NO general `execFile`/git wrapper. The seam keeps pure unit tests from shelling out; impl SHOULD consume a shared `invokeGit` only IF `safe-exec.js` later grows one. Arg-array discipline is asserted directly against recorded `runGitFn` calls (no string concatenation, no `shell: true`).
- **CWE-732 (hooks suppression)**: cherry-pick runs with `HOOKS_DISABLED_ARGS` (`-c core.hooksPath=/dev/null`) so a malicious repo-local git hook cannot execute during promotion.

### §F12 — MAX_EVIDENCE_CHAIN_DEPTH bound rationale + v3.1 R10 replacement

`MAX_EVIDENCE_CHAIN_DEPTH = 1000` (defined `packages/kernel/_lib/k9-promote-deltas.js:63`).

**Rationale (F12, eli-H3, CWE-400 — Uncontrolled Resource Consumption)**: the K9 pre-commit gate walks the evidence chain to validate the head transaction record (F9/INV-21). The walk is `O(|evidence_refs| × chain-depth)` with no intrinsic terminator — a forged or pathological chain could drive an unbounded walk and exhaust CPU/memory at commit time, a denial-of-service surface on the promotion path. The bound caps the walk: a chain deeper than 1000 is REJECTED at depth 1000 rather than walked to exhaustion (failing test: synthetic 1500-deep chain → rejected at the bound). 1000 is generously above any realistic Phase-1-alpha evidence depth (depth-1 spawn topology means chains are short) while still being a hard ceiling.

**v3.1 R10 replacement**: this depth cap is a v3.0-alpha **interim** mitigation, not the permanent design. v3.1 R10 (the budget-envelope / full chain-integrity verifier) SUPERSEDES `MAX_EVIDENCE_CHAIN_DEPTH` (per plan line 441: "R10 budget envelope (replaces F12 MAX_EVIDENCE_CHAIN_DEPTH=1000) → v3.1"). When R10 lands, the constant is removed in favor of an explicit per-promotion resource budget rather than a fixed-depth heuristic. Until then the depth cap is the load-bearing CWE-400 guard.

## §combined-bypass policy

Two operator escape hatches exist for write-scope enforcement:
- `LOOM_DISABLE_WORKTREE=1` — disables K1 worktree allocation (testing, dev)
- `LOOM_ALLOW_OUT_OF_SCOPE_WRITES=1` — disables K14 violation rejection (testing, dev)

Either alone is intended for dev workflow. **Both together** = effective kernel bypass. K10 (PR 2) detects the combination and emits an audit-log entry with severity HIGH at spawn-init.

**Local-trust threat model** (v3.0-alpha): combined bypass is ALLOWED (audit-logged, not blocked). Single-user substrate; misconfiguration is the threat model, not adversarial bypass.

**CI threat model**: combined bypass is DENIED by default via `LOOM_CI_DENY_COMBINED_BYPASS=1` set in CI workflows. CI workflows explicitly opt INTO bypass for diagnostic jobs (with reviewer approval).

## §sweep-timeout policy

Recovery sweep (PR 4) MUST hold the K13 lock during the (a)→(c) critical section:
- (a) directory scan of `~/.claude/loom/spawn-records/` for PENDING records
- (b) per-spawn filesystem-hash compute (TOCTOU-protected window)
- (c) ABORTED record emit + fsync to WAL

**Timeout**: `LOOM_SWEEP_LOCK_TIMEOUT_MS` (default 30000ms; configurable per operator).

**On timeout** (user-decision settled at design time, per Critical Finding F3 round-2 resolution):
- Sweep releases K13 lock (avoids permanent deadlock)
- Sweep emits Class-4 audit event `sweep-timeout-operator-alert`
- **Admission REMAINS BLOCKED** — correctness over liveness; stale-PENDING records advancing evidence chains during non-converged recovery is unacceptable
- Operator escape hatch: `LOOM_FORCE_ADMIT_AFTER_SWEEP_TIMEOUT=1` (audit-logged Class-4 event same pattern as K10)

## §K3.b — Schema-version field + handshake protocol

Per **post-compact PR-1 R1 FL-2 (2026-05-28)**: the K3.b context-envelope schema ships PROVISIONAL in v3.0-alpha with ZERO production consumers. v3.1 personas opt-in via `consumes_context_envelope: true` flag in their persona contract.

**Schema-version field** (top-level):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "K3.b Context Envelope (provisional)",
  "type": "object",
  "required": ["schemaVersion", "contextItems"],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "const": "1.0.0-provisional",
      "description": "v3.0-alpha ships 1.0.0-provisional; v3.1 may amend without backward-compat guarantee"
    },
    "contextItems": {
      "type": "array",
      "items": { "type": "object" }
    }
  }
}
```

**Version-handshake protocol**:
1. **v3.0-alpha producer** (K8 `updatedInput` payload assembly, future v3.1): always sets `schemaVersion: "1.0.0-provisional"`.
2. **v3.1 consumer** (personas with `consumes_context_envelope: true`): reads `schemaVersion`; if MAJOR-version mismatch (`schemaVersion` does not start with `"1."`), REJECTS the envelope and emits Class-4 audit event `context-envelope-schema-version-mismatch`.
3. **Migration path** (v3.0-alpha → v3.1): v3.1 MAY:
   - Add new optional fields to `contextItems[]` (backward-compatible — v3.0 readers ignore unknown fields)
   - Add new required top-level fields (breaks v3.0; bump MAJOR `schemaVersion` to `2.0.0`)
   - Tighten existing field constraints (breaks v3.0; bump MAJOR)
4. **Dormancy** (per FL-5): until v3.1 ships the first consumer, the `_lib/context-envelope.js` module has ZERO production importers; a CI grep check enforces this (see PR 1 verification probes).

The PROVISIONAL label is operationally honest: this ADR does NOT promise stability. v3.1 amendment without backward-compat guarantee is explicitly reserved.

## §F22 — scrubSecrets pattern enumeration

Per **post-compact PR-1 R1 FL-3 (2026-05-28)**: F22 spawn-record.js scrubSecrets regex extension. **F22 impl in spawn-record.js BLOCKS on this section's finalization** (PRINCIPLE: rationale-before-code for security-class regex extensions).

Current `SECRET_PATTERNS` in `packages/kernel/spawn-state/spawn-record.js:93-101` covers:
- AWS access key id (`AKIA[0-9A-Z]{16}`)
- AWS secret access key (`aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?`)
- OpenAI / Anthropic key prefix (`sk-[a-zA-Z0-9\-_]{20,}`)
- JWT (`eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+`)
- GitHub PAT (`ghp_[a-zA-Z0-9]{36}`)
- GitHub OAuth (`gho_[a-zA-Z0-9]{36}`)
- Slack token family (`xox[abprs]-[a-zA-Z0-9-]{10,}`)

**F22 additions** (enumerated; implementer MUST add EXACTLY these patterns — no more, no less):

| Pattern | Regex | Rationale |
|---|---|---|
| Stripe live secret key | `/sk_(live\|test)_[A-Za-z0-9]{24,}/g` | Stripe API keys (live + test prefix) |
| Stripe restricted live | `/rk_(live\|test)_[A-Za-z0-9]{24,}/g` | Stripe restricted-permission keys |
| Password-in-URL | `/(https?\|ftp):\/\/[^:\/\s@]+:[^@\s\/]+@/g` | Embedded `:password@` in URLs |

**Regex authoring notes**:
- All patterns use `/g` flag for global replacement (matches existing SECRET_PATTERNS style)
- Stripe pattern uses non-capturing branch `(live|test)` to handle both prefix variants in one regex
- Password-in-URL pattern excludes whitespace + `/` in user+password segments to avoid over-matching across line boundaries
- The `://` anchor prevents matching scheme-less `user:password@host` (which is rare in observed leaks; defer to v3.1 if telemetry warrants)

**Verification**:
- PR 1 phase 4 implementation MUST: (a) add patterns to `SECRET_PATTERNS` array; (b) add new test fixtures to `tests/unit/kernel/spawn-state/spawn-record.test.js` per the failing-test contract; (c) NOT change existing patterns (regression risk)
- Plain URLs (`https://example.com/path`) MUST NOT trigger redaction (over-match check codified in failing test `F22.new: password-in-URL does not over-match plain URLs`)

## §F1 + §F3 spec deltas

Per Critical Findings F1 (blair-CRIT-1) + F3 (blair-CRIT-3):

**F1 — K13×K14 tail-window WAL race**: v6 §5.4 originally anchored tail-window to WAL `committed_at`. Race: on slow-disk WAL writes, the committed_at timestamp drifts AFTER the tail-window has logically closed. **Spec delta**: tail-window anchors to `spawn-state/<run-id>/spawn_close_wall_ms.txt` written at PostToolUse hook entry (separate from WAL; wall-clock-only). v6.1 should patch §5.4 to capture this.

**F3 — Recovery sweep TOCTOU**: v6 §5.3 originally described sweep as a synchronous filesystem walk. Race: background subprocesses (started by the spawn but outliving it) write during the sweep window. **Spec delta**: sweep MUST hold K13 lock during (a)→(c) critical section (see §sweep-timeout above); v6.1 should patch §5.3.

## §K2.b — Allow/deny conflict resolution

Per Critical Finding F17 (blair-MED-4): K2.b precedence levels (user-global → project-local) need explicit conflict-resolution semantics.

**Resolution** (per master plan + post-compact R1):
- **Deny is UNION across levels**: project-local `deny` EXTENDS user-global `deny` (set union, NOT replacement)
- **Allow is union per-tool BUT cannot remove denies**: project-local `allow: ["Bash"]` does NOT whitelist `Bash` if user-global has `deny: ["Bash"]`
- **Tool-deny is sticky**: once denied at any level, no level can re-allow

**Implementer guidance**: K2.b conflict logic in PR 1 SHOULD NOT proceed until this ADR's text is reviewed (jade FLAG #6, master-plan R1).

## Consequences

**Positive**:
- Cross-PR semantics survive plan-PR squash (the plan is squash-merged; this ADR persists)
- Operator runbook for sweep timeout + combined bypass + K9 dormancy is centralized
- §K3.b version-handshake gives v3.1 a clean upgrade path without backward-compat gymnastics
- §F22 pattern enumeration removes implementer ambiguity (FL-3)

**Negative**:
- This is a LARGE ADR (~5-7 sections, ~250-450 LoC markdown). Risk: future contributors skim past sections that apply to them.
- Provisional-until-PR-4 means a meaningful update window where the ADR could drift from impl reality.

**Mitigated**:
- §-anchored cross-references in the plan + verification probes (`ADR-0011 §K3.b`, `ADR-0011 §F22`, etc.) make sections individually addressable
- PR 4 reconcile-gate is a merge-blocking checklist item, not advisory

## Verification

- `validate-adr-drift.js` schema-validates the frontmatter
- Plan file cross-references resolve to this ADR (37 refs to `ADR-0011` per `grep -c ADR-0011 packages/specs/plans/2026-05-27-phase-1-alpha-v3.0-alpha-kernel.md`)
- §F22 patterns are precisely the ones in spawn-record.js post-PR-1-phase-4
- §K3.b schemaVersion `1.0.0-provisional` is precisely the one in `packages/kernel/schema/context-envelope.schema.json`
