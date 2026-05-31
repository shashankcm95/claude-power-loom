---
adr_id: 0011
title: "K9↔K14 sequencing, Phase 1-alpha spec deltas, and rationale-before-code obligations"
tier: technical
status: accepted
created: 2026-05-28
author: 04-architect.theo (HETS-routed Phase 1-alpha design) + post-compact PR-1 R1 amendments + PR-4b reconcile
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

> ⚠️ **SUPERSEDED (2026-05-30 verify-plan HETS pass)** — this table partitions by `{crashed? × violation?}`, an axis orthogonal to v6 §6.5.1's detection-phase enumeration, and maps NONE of K9's six actual outcome codes. The single authoritative spine `post-spawn-resolver.js` encodes is the **§canonical-resolver-table** in the PR-4 Re-grounding Amendment at the end of this ADR. Read that, not this table.

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

---

## PR-4 Re-grounding Amendment (2026-05-30 — verify-plan HETS pass)

**Provenance**: 4-lens verify-plan workflow (`architect-theo` + `code-reviewer-blair` + `security-engineer-eli` + `honesty-auditor-quinn`) re-grounded the PR-4 design against the actual merged code at main `cde3d2a` (K1/K7/K10/K13 = #169; K9 = #172). Verdict was **unanimous NEEDS-REVISION** — 5 CRITICAL + 9 HIGH gaps, all absorbed below. This is the third+ time the graduated `drift:plan-honesty` rule caught blessed-prose-vs-runtime contradictions; three lenses independently named the same load-bearing gap (§K13-spawn-id-provenance).

**Two user decisions (2026-05-30)**: (1) **build** the K9 rollback executor (not scope it out); (2) **split PR 4 into 4a + 4b** — 4a = K14 + spawn-record envelope field + K13 provenance/retry (producer + primitives, ships dormant); 4b = post-spawn-resolver + recovery-sweep + K9 `rollbackPromotion` + F20 skip (integration; first production importer; deletes `dormancy-assertion-k9`).

### §canonical-resolver-table (SUPERSEDES the 5-path table at §K9↔K14 sequencing)

The earlier 5-path table and v6 §6.5.1 partitioned along **orthogonal axes** — `{crashed? × violation?}` vs detection-phase — and neither mapped K9's six actual outcome codes (`PROMOTED`, `NOOP_ALREADY_PRESENT`, `ABORTED`, `ABORT_UNCONFIRMED`, `REJECTED_REQUEST`, `REJECTED_EVIDENCE`). This is the SINGLE authoritative transition table `post-spawn-resolver.js` encodes **as data** (a map from `(terminal_state, condition)` → action; NOT if/else branches — per the resolver-SRP finding). Rows are spawn-terminal-state (the crash domain the recovery-sweep MUST handle is the spine); the violation/override dimension and the K9 outcome map fold in as cells.

| Terminal state | Condition | K14 verdict | K9 outcome | Resolver action | Audit disposition |
|---|---|---|---|---|---|
| completed-normally | no violations | `SCOPE_OK` | `PROMOTED` | PROMOTE | `promote-ok` |
| completed-normally | no violations | `SCOPE_OK` | `NOOP_ALREADY_PRESENT` | ACCEPT (idempotent — NO re-promote/re-cherry-pick) | `promote-noop` |
| completed-normally | violations, no override | `VIOLATION` | *(K9 not entered)* | REJECT_SCOPE | `reject-scope-violation` |
| completed-normally | violations + `LOOM_ALLOW_OUT_OF_SCOPE_WRITES` | `VIOLATION` (allowed) | `PROMOTED` | PROMOTE_WITH_AUDIT | `override-allowed` (Class-4) |
| completed-normally | K9 cherry-pick conflict | `SCOPE_OK` | `ABORTED` | REJECT_CONFLICT | `reject-cherry-conflict` |
| completed-normally | K9 abort unconfirmed | `SCOPE_OK` | `ABORT_UNCONFIRMED` | WHOLE_TREE_VERIFY → (clean → REJECT_CONFLICT \| dirty → HARD_RESET) | `abort-unconfirmed-worktree-{clean,dirty}` (Class-4 if dirty) |
| completed-normally | evidence-link fail | `SCOPE_OK` | `REJECTED_EVIDENCE` | REJECT_EVIDENCE | `reject-evidence` |
| completed-normally | bad promote request | `SCOPE_OK` | `REJECTED_REQUEST` | REJECT_REQUEST | `reject-request` |
| crashed (tail not elapsed) | sweep finds PENDING | *(N/A)* | *(K9 skipped)* | SWEEP_ABORT | `sweep-aborted` |
| crashed (tail elapsed at crash) | sweep finds PENDING | *(N/A)* | *(K9 skipped)* | SWEEP_ABORT_FINAL | `sweep-aborted-final` |
| sweep-incomplete (timeout) | — | *(N/A)* | *(K9 not entered)* | ADMISSION_BLOCKED | `sweep-timeout-operator-alert` (Class-4) |

Resolver TDD MUST assert **no K9 outcome hits an unhandled default** (all six codes appear above), and that `NOOP_ALREADY_PRESENT` resolves to terminal-ACCEPT WITHOUT a second `promoteDelta`/`runGitFn` call (the merged NOOP path returns `promoted:false` — the delta is already present; re-cherry-picking would be a bug). The `ABORT_UNCONFIRMED` row is the whole-tree-fidelity wiring (see §recovery-replay).

**v3.1-DEFERRED — DELETED from the plan's verification probe**: the K14-FAIL-during-K9 "event-stream" path (v6 §6.5.1 line 1369 — event-stream transport ONLY; the snapshot transport that ships in v3.0-alpha cannot exercise it). The plan's old line-370 probe tested this dead path while testing none of the crash/sweep/timeout paths; it is replaced by the crash + sweep-timeout fixtures implied by the rows above.

### §K13-spawn-id-provenance (NEW — closes CRITICAL C2)

**Problem (probed, all 4 lenses, quinn found it is worse than carry-forward #4 stated)**: three non-agreeing spawn-id schemes exist in merged code — K13 `main()` mints `${Date.now().toString(36)}-${sessionId}` (`k13-serial-enforcer.js:256`, ephemeral, never persisted where a resolver reads it); `spawn-record.js buildSpawnId()` mints `${Date.now().toString(36)}-${crypto.randomUUID()}` (`:239`); `spawn-record.js run_id` is `sha256(sessionId).slice(0,16)` (`:203`). `releaseSerialMarker` gates on `marker.spawn_id === o.spawnId` (`k13:216`). The resolver, holding only the spawn-record envelope, would pass `spawn_id` (UUID-keyed) which can never equal the marker's `sessionId`-keyed id → silent `{released:false, reason:'not-owner'}` → marker persists to age-reap (`maxSpawnAgeMs`, 10 min) → all spawns blocked. Passes every isolated unit test.

**v3.0-alpha resolution (PR-4a, read-marker)**: the resolver/spawn-close path recovers the admission-written id by **reading the marker itself** (`k13` exports `readMarker`) and passes THAT id back to `releaseSerialMarker`. Under K13 serial-only there is at most one active marker, so read-then-release is safe and the owner-check matches by construction. The resolver does NOT need to know the id scheme — it releases what admission wrote.

**Deferred deeper fix (Phase-2 schema-migration PR — touches the LIVE spawn-record PostToolUse hook)**: a single canonical spawn-id derived deterministically from `session_id + tool_use_id`, written identically by the K13 PreToolUse gate and the spawn-record hook. Required when K13 relaxes to concurrent admission (v3.5+), where "read the active marker" is ambiguous. **Drift-note owed.**

**TDD (PR-4a)**: `INV-K13-SpawnIdProvenance` — (positive) admit → resolver sources release-id via `readMarker` → `releaseSerialMarker` returns `{released:true}` and marker is deleted; (negative, captures the bug) `releaseSerialMarker({spawnId: envelope.spawn_id})` returns `{released:false, reason:'not-owner'}` — proving the naive path fails, which is WHY the resolver reads the marker.

### §recovery-replay + K9 `rollbackPromotion` (NEW — closes CRITICAL C4 + the CWE-78 HIGH)

**Problem**: v6 §6.5.1 path-4 ("K9.rollback consumes the journal entry to revert") has **no K9 entry point** — `k9-promote-deltas.js` exports `promoteDelta` but no rollback/revert; the journal stores `reverse_op = 'git revert <sha>'` as a human-readable STRING (`k9-journal.js:106`) with nothing to execute it.

**Resolution (PR-4b — user decision: build it)**: add a new export `rollbackPromotion({ worktreeRoot, promotedSha, runGitFn })` to `k9-promote-deltas.js`. It executes `runGitDefault(worktreeRoot, ['revert', '--no-edit', promotedSha])` via the `invoke-git` arg-array seam (CWE-78: no shell) and appends a `REVERTED` journal entry. **`promotedSha` is read from the `promoted_sha` journal FIELD (hex-validated at build, `k9-journal.js:40,96`), NEVER parsed from the `reverse_op` string.** The `reverse_op` string is documentation only — to kill the temptation at the schema level it is renamed **`reverse_op_description`** (a non-actionable label).

**Normative rule**: recovery-sweep / resolver MUST NOT pass `reverse_op_description` (or any stored string) to a shell-interpreting function. **TDD**: positive — rollback calls `runGitFn` with arg-array `['revert','--no-edit', <sha>]`; negative — a synthetic journal entry whose description contains `'; rm -rf /'` (with a valid hex SHA in the field) is replayed safely, executing only the arg-array, never the string.

**Journal-module co-updates (PR-4b `k9-journal.js`, in lockstep with the rename + the new `REVERTED` entry — re-verify R2, eli + blair)**: (a) **add `'REVERTED'` to `JOURNAL_OUTCOMES`** (today `Object.freeze(['PROMOTED','ABORTED','NOOP_ALREADY_PRESENT'])`) — WITHOUT it `validateJournalEntry` REJECTS the `rollbackPromotion` entry at runtime (`invalid outcome: REVERTED`), so the undo never journals and is unrecoverable from the ledger (INV-19 breach); (b) `buildJournalEntry`/`validateJournalEntry` carry the `reverse_op_description` consistency check for BOTH `PROMOTED` and `REVERTED` outcomes; (c) rename every `reverse_op` reference — the two `validateJournalEntry` presence/absence checks, `JOURNAL_REQUIRED_FIELDS`, and the ~12 `k9-journal.test.js` fixtures — in the SAME commit. **Probes**: `grep -c reverse_op packages/kernel/_lib/k9-journal.js` returns 0 after PR-4b; `buildJournalEntry({outcome:'REVERTED', ...})` passes `validateJournalEntry`.

### §write-scope-violations-schema (NEW — closes CRITICAL C5)

**Problem**: the field K14 must produce and the resolver must consume does not exist on the spawn-record envelope (`buildEnvelope()`, `spawn-record.js:280-324` — zero production occurrences), the field NAME contradicts (ADR-0010 `write_scope_violations[]` vs v6 §6.5.1 `violations[]`), and the LIVE `spawn-record.js` PostToolUse hook is absent from the PR-4 file list.

**Resolution (PR-4a)**: `spawn-record.js` gains the envelope field `write_scope_violations[]` (the ADR-0010 name is canonical; v6 §6.5.1 `violations[]` is an alias to amend at v6.1). Per-element schema (adopted from v6 §6.5.1):

```json
{ "path": "string (canonicalized, relative to worktree root)",
  "kind": "out-of-scope | symlink-escape | parent-scope-suspected",
  "transport": "snapshot",
  "detected_at_phase": "spawn-close | tail-window | recovery-sweep",
  "sha256_pre": "string|null", "sha256_post": "string|null",
  "flags": ["K14_SUSPECTED_FALSE_POSITIVE?"] }
```

Default `[]` (empty = clean). **TDD** asserts an out-of-scope write populates the **full element shape**, not merely a truthy/non-empty array (avoids the shape-match false-green).

### §F20-recovery-sweep-sentinel correction (skip was NEVER added to merged K9)

Plan F20 claims "K9 pre-commit skips evidence-link check when `is_recovery_sweep: true`," but `checkEvidenceLinkPreCommit`/`promoteDelta` in the merged `k9-promote-deltas.js` have ZERO such logic. **PR-4b MUST MODIFY the merged `k9-promote-deltas.js`** to add the skip (checked on the record object). **TDD** asserts the skip with a record that would FAIL the evidence-link gate WITHOUT the flag (non-vacuous), and that the same record without the flag still fails.

### §combined-bypass CI-deny correction (closes the plan-honesty HIGH)

The earlier §combined-bypass states `LOOM_CI_DENY_COMBINED_BYPASS=1` is "DENIED in CI by default" — **false against the codebase**: the var appears in `k10-escape-hatch.js` + its tests but is set in **no CI job** (`.github/workflows/ci.yml`). This is a fresh `drift:plan-honesty` instance. **Correction**: the deny is NOT yet present; **PR-4 MUST add `LOOM_CI_DENY_COMBINED_BYPASS=1` to the CI workflow env** + a test that `evaluateEscapeHatches()` returns `action:'deny'` under both bypass vars + the deny var. Until added, the claim is downgraded to "MUST be set in PR 4 — merge-checklist item."

### §K14-split (orchestrator named — closes the back-edge HIGH)

Plan line 140 implies `k14-write-scope.js` is "split INTO" three modules, leaving no orchestrator. **Correction (mirrors the K9 split)**: `k14-write-scope.js` STAYS the orchestrator and imports three NEW leaves — `k14-snapshot.js` (snapshot + hash), `k14-tail-window.js` (timer + tail logic), `k14-symlink-guard.js` (TOCTOU + symlink-race). The three leaves operate over one shared filesystem-walk state — the exact place a back-edge sneaks in — so each leaf test carries a `DAG: does NOT import the orchestrator (no back-edge)` case, and the resolver imports ONLY the `k14-write-scope.js` orchestrator, never a leaf. Split decision recorded here at end of TDD Phase 1 (same discipline as §K9-split). **K14's snapshot walker MUST pass every visited file through K7 `checkWithinRoot`** (not just declared roots — a symlink inside the worktree resolving outside must be flagged `symlink-escape`, fail-closed).

**Transport-agnostic facade (Decision 2 / THEO-M1 — preserves the v3.1 seam without a flag)**: the resolver calls the `k14-write-scope.js` orchestrator through a single transport-agnostic entry, `detectWriteScopeViolations(ctx) → write_scope_violations[]`, which in v3.0-alpha dispatches only to the snapshot leaf. v3.1 adds the fsevents/inotify event-stream branch BEHIND that same facade (Open/Closed) with ZERO resolver change — honoring YAGNI (no flag built now) while keeping the extension seam. The resolver NEVER imports a K14 leaf directly.

### §sweep-timeout hardening (fail-closed + force-admit record shape)

Augments the earlier §sweep-timeout: (1) **step-(b) per-spawn hash failure** (permission/symlink-loop/disk error mid critical-section) MUST fail-closed — the spawn is **skipped and stays PENDING** (NOT a forged `ABORTED`), a Class-4 `hash-compute-error` event is emitted with `spawn_id`, and the sweep continues; `skipped_count` is reported. (2) The `LOOM_FORCE_ADMIT_AFTER_SWEEP_TIMEOUT` Class-4 record MUST carry blast-radius fields `{ kind:'recovery-sweep-force-admit', pending_spawn_count, pending_spawn_ids[], sweep_elapsed_ms, sweep_timeout_ms }` — "same pattern as K10" is insufficient for the highest-severity unblock.

### §K13-release-retry (closes the bounded-retry HIGH)

`releaseSerialMarker` lock-unavailable currently returns immediately (`k13:205-211`, retry explicitly handed to PR 4). **PR-4a adds** a bounded retry inside `k13-serial-enforcer.js`: up to N attempts (3–5) with fixed backoff (≈500ms), total budget bounded by the sweep critical-section ceiling; on exhaustion emit Class-4 `release-retry-exhausted` and fall back to age-reap — the PostToolUse hook MUST exit cleanly regardless (no indefinite block). Sleep is an injectable seam (F23 — no env-var trigger). **TDD** `INV-K13-ReleaseRetry`: lock-unavailable for N−1 attempts then success → marker deleted.

### §reconcile-as-phase + status flip (closes the floating-checkbox HIGH)

ADR-0010 and ADR-0011 ship `status: provisional-until-pr-4`, but the reconcile obligation lived only as a PR-description checkbox — not a build phase. **Correction**: PR-4b's final phase is a numbered step — diff §canonical-resolver-table / §sweep-timeout / §combined-bypass against the final `post-spawn-resolver.js` + `recovery-sweep.js` + `k14-write-scope.js`; amend on any divergence; **flip both ADRs' `status` from `provisional-until-pr-4` → `accepted`.** A verification probe asserts neither ADR retains `provisional-until-pr-4` after PR-4b. The runbook-familiarity `gh pr view | jq` CI step (plan line 342) **does not exist** in `ci.yml`; either implement it in PR-4b or downgrade the plan claim to "manual reviewer confirmation" (it currently over-claims CI enforcement).

### §reconcile EXECUTED (PR-4b, 2026-05-30)

PR-4b's reconcile phase ran. **Both ADRs flipped `provisional-until-pr-4` → `accepted`.** Diff of the spec sections against the shipped `post-spawn-resolver.js` + `recovery-sweep.js` + the K9 modifies:

- **§canonical-resolver-table** — `post-spawn-resolver.js` encodes the table as a frozen `RESOLVER_TABLE` map (data, not if/else); all six K9 outcomes map with no unhandled default; `ABORT_UNCONFIRMED` → whole-tree `git status --porcelain` (clean=`REJECT_CONFLICT` / dirty=`HARD_RESET` + Class-4); `NOOP_ALREADY_PRESENT` → ACCEPT, no re-promote. **Conforms.**
- **§recovery-replay** — `rollbackPromotion` runs arg-array `git revert --no-edit` reading the `promoted_sha` field (never the string); `REVERTED` added to `JOURNAL_OUTCOMES`; `reverse_op`→`reverse_op_description` rename complete (grep-zero). **Conforms.**
- **§sweep-timeout** — `recovery-sweep.js` holds the K13 lock across (a)→(c); step-(b) hash failure → spawn stays PENDING (fail-closed, never a forged `ABORTED`); WAL-write failure is per-orphan isolated (Class-4 `wal-write-error`, sibling still aborts); force-admit Class-4 record carries `pending_spawn_ids[]`. **Conforms (+ hardened).**
- **§combined-bypass** — `LOOM_CI_DENY_COMBINED_BYPASS=1` now set as a top-level `ci.yml` env (the SEC-PR4-02 correction). The `dormancy-assertion-k9` job is deleted in the same PR that adds the first K9 importer; `dormancy-assertion-k3b` remains (K3.b still dormant). **Conforms.**

**One honest divergence (recorded, not amended-away)** — the table's two crash rows distinguish `SWEEP_ABORT` (tail not elapsed at crash) from `SWEEP_ABORT_FINAL` (tail elapsed at crash). The shipped `recovery-sweep.js` **cannot observe crash-time tail-elapsed state** in v3.0-alpha (the crashed process left no readable `tail_window_close_at` marker), so it emits ONE abort disposition regardless. The two-row distinction is **v3.1-deferred** (needs crash-time tail persistence the sweep can read post-crash). Impl behavior is correct and tested; the two-row taxonomy is the eventual-state spec. (architect-theo residual MEDIUM, PR-4b review.)

**Deferred (v3.1 hygiene, non-blocking)** — crash dispositions live in `recovery-sweep.js` as `SWEEP_DISPOSITIONS` while the six K9-outcome rows live in `post-spawn-resolver.js` as `RESOLVER_TABLE` — two inspectable data structures across two modules rather than one unified table. Every row's behavior is correct + tested; unification is a v3.1 pass.

### §K12 EXECUTED (PR-5, 2026-05-30) — Phase-1-alpha COMPLETE

PR-5 ships **K12 as convention + advisory** per the v6 §329-353 / v5.1 downgrade (no new ADR rationale needed — Decision 4 already covered it; this note records execution). `packages/kernel/_lib/layer-boundary-lint.js` (128 code LoC) is a pure path-string classifier:

- **Layer identity is PATH-PRIMARY** (`packages/<kernel|runtime|lab|adapter>`), resolving the §337-vs-§339 marker tension: zero source files carry the `@loom-layer` marker today, so missing-marker is **not** a finding (it would emit ~95 and break the 0-on-main baseline). Marker parsing is OMITTED in PR 5 (YAGNI); the marker is a v3.1+ optional cross-check.
- **Two finding kinds** (both counting toward the 0-on-main baseline): `inner-imports-outer` (Dependency Rule, `LAYER_RANK` kernel<runtime<lab<adapter; `src<dst` = violation; outer→inner + same-layer are legal) and `prod-imports-tests` (**F23 defense-layer (b)** — any `packages/**`-not-under-`tests/` file importing a `tests/` path).
- **ADVISORY, non-blocking**: the script exits non-zero on findings (ground truth); the `layer-boundary-advisory` CI job carries `continue-on-error: true` (the entire severity/policy lever). **OQ-19 upgrade-to-mandatory (≥3 observed drift events, v3.1-v3.3) = delete that one line + add to required checks** — zero rework in the lint.
- **Empirical-zero-drift baseline confirmed**: `node packages/kernel/_lib/layer-boundary-lint.js` → 0 findings on main (independently re-run + non-vacuously proven: injected prod→tests + inner→outer synthetics both fire, exit 1; commented-out + legal runtime→kernel negative controls do NOT fire). 3-lens HETS review (architect/code-reviewer/honesty-auditor) all READY, no CRITICAL/HIGH; honesty-auditor disconfirmed the jade vacuous-pass failure mode.

**With K12, the Phase-1-alpha kernel transaction loop is COMPLETE — 11 of the 14 roadmap primitives shipped** (K1, K2, K3, K3.b, K4, K7, K9, K10, K12, K13, K14, atop the pre-existing K5 validators; **K6/K8/K11 deferred** to v3.1/v3.2; K12 advisory; K3.b dormant until its v3.1 consumer).

## §v3.0-alpha-hardening (2026-05-31) — resolver seam fixes + e2e composition proof

The MVP-review phase-gate added the FIRST true end-to-end integration test of the composed loop (`tests/unit/kernel/integration/transaction-loop.test.js`): real K1 worktree → K13 admit → `post-spawn-resolver.resolve()` driving the **REAL** K14 + **REAL** K9 against a real git repo, no stubs at those seams. Its first (discovery) run surfaced **two seam bugs the stub-injecting unit tests masked** — both fixed in `post-spawn-resolver.js`:

- **K9 seam** — `resolve()` called `promoteDelta` without `isGenesisPosition`/`resolveParent`, so `checkEvidenceLinkPreCommit` rejected EVERY real record (a genesis record failed forged-genesis validation at the default `isGenesisPosition:false`; a non-genesis record failed `missing-resolve-parent`). The PROMOTE path was unreachable through the real composition. **Fix**: `dispatchPromote` threads `isGenesisPosition` (from `envelope.is_genesis_position`), an optional `resolveParentFn` chain-walk seam, and `is_recovery_sweep` from the envelope/opts. A genesis-position spawn now promotes; a chained spawn threads its `resolveParent` (v3.1 wires it to the record store).
- **K14 seam** — `resolve()` called `detectWriteScopeViolations({worktreeRoot, envelope})` without `targetPath`, so `classifyTarget` always returned null and the scope-REJECT path was inert. **Fix**: Step 2 threads the K14 detection inputs from `envelope.k14_ctx` (`{ targetPath, preSnapshot, … }`). Absent in a v3.0-alpha observational envelope → `detect()` safely returns `[]`; populated by the e2e test and by v3.1's spawn-close detection hook → real detection fires.

Both fixes are **forward-compatible and additive** — the 15 existing resolver unit tests (which inject the K9/K14 seams) pass unchanged. The e2e test now PROVES four composed paths against real git: genesis PROMOTE, K14 scope-REJECT, K9 conflict-REJECT, and INV-20 two-phase ABORT, each with the K13 marker released. **Honest status upgrade**: the loop was "built but never composed end-to-end"; it is now "composition PROVEN end-to-end" — though still not WIRED into a live spawn hook (that, plus the record-store `resolveParent` and the spawn-close K14 detection that populates `k14_ctx`, is v3.1 work).

Also in this pass: `k13-k14-interlock.test.js` was repointed from a local `k13Admits` mock to the REAL `k13.decideAdmission` (it had tested an unimplemented tail-window invariant and would have passed even if the real enforcer were deleted); a `dormancy-assertion-k1` CI gate was added (K1 had zero importers AND no tripwire); and ADR-0009's count slip + its failing version-bump verification probe were corrected (the `3.0.0-alpha.N` manifest bump was deferred — see ADR-0009 Amendment).
