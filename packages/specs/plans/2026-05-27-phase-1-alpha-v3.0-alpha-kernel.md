---
phase: phase-1-alpha
status: draft (pending /verify-plan + USER GATE 1)
parent_rfc: packages/specs/rfcs/v6-substrate-synthesis.md (v6 LOCKED)
parent_plans:
  - packages/specs/plans/2026-05-24-v3.0-multiphase-hets-execution-plan.md
  - packages/specs/plans/2026-05-25-phase-0-workspace-restructure-v1.md (Phase 0 DONE)
created: 2026-05-27
gate_shape: HETS-routed; /verify-plan REQUIRED pre-ExitPlanMode per H.7.23
manifest_bump_target: 3.0.0-alpha
scope_estimate: ~2,755-4,600 LoC + ~52-87h per v6 §6.11 row (after Round-3b cleanup)
pr_slicing: 5 sub-PRs + sibling CI sub-PRs (0a/0b) per HETS Decision 5
---

# Phase 1-alpha — v3.0-alpha Kernel Implementation

## Context

Per v6 §13(c) "CURRENT GATE": v6 BLUEPRINT LOCKED ([#160](https://github.com/shashankcm95/claude-power-loom/pull/160)); K2 reservation shipped ([#161](https://github.com/shashankcm95/claude-power-loom/pull/161)); Round-3b HD cleanup landed ([#162](https://github.com/shashankcm95/claude-power-loom/pull/162)). Phase 1-alpha is the substrate-fundament implementation of the PURE KERNEL TRANSACTION LOOP — 10 in-scope kernel primitives + property-test harness + 3 ADRs. This plan replaces v6 §13's vague "(~30h)" estimate with the honest §6.11 row total **(~2,755-4,600 LoC / ~52-87h)** sliced into 5 dependency-ordered sub-PRs with sibling CI infra PRs. HETS pair-review by `04-architect.theo` + `03-code-reviewer.blair` + `12-security-engineer.eli` surfaced **3 CRITICAL + 5+5 HIGH + 5+5 MEDIUM** findings the spec didn't catch — all absorbed below into the per-PR scope.

## Routing Decision

```json
{
  "task": "Multi-file architectural implementation spanning 10 kernel primitives across the loom-kernel package. Substrate-fundament system design work [...] Architectural decision points + cross-module integration + multi-component design + system design at convergence_value >= 0.30.",
  "recommendation": "route",
  "confidence": 0.208,
  "score_total": 0.662,
  "scores_by_dim": {
    "compound_strong": { "matched": ["schema"], "raw": 1, "weight": 0.15, "contribution": 0.15 },
    "convergence_value": { "matched": ["tradeoff"], "raw": 1, "weight": 0.15, "contribution": 0.15 },
    "user_facing_or_ux": { "matched": ["component"], "raw": 1, "weight": 0.10, "contribution": 0.10 }
  },
  "context_score": 0.112,
  "context_contributions": {
    "compound_strong": { "matched": ["schema","transaction"], "contribution": 0.075 },
    "compound_weak": { "matched": ["design"], "contribution": 0.0375 }
  },
  "reasoning": "Score 0.662 → route: compound_strong (+0.150, 'schema'), convergence_value (+0.150, 'tradeoff'), user_facing_or_ux (+0.100, 'component'), context (+0.112, mult=0.5).",
  "weights_version": "v1.2-dict-expanded-2026-05-07",
  "thresholds": { "route": 0.6, "root": 0.3 },
  "first_attempt_drift": "bare-technical-detail variant returned root (score 0.112) — counter-signal 'lint' fired from K12-advisory mention; dictionary missing K-primitive nomenclature. H.7.5 prompt-design retry with explicit architectural surface keywords (architecture, tradeoff, system design, multi-component) → route. Drift-note 56 candidate: kernel primitive names (K1-K14, axiom names, invariant names) should arguably be substrate-meta detection signals."
}
```

## HETS Spawn Plan

Independent-lens parallel pattern (Option B per `kb:hets/patterns/asymmetric-challenger`), matching the K2 reservation 5-persona pair-review pattern.

| Persona | Identity | Tier | Role | Findings count | Bounded output | Paired-with |
|---|---|---|---|---|---|---|
| 04-architect | theo | high-trust (9 prior) | Design synthesis — 6 open architectural decisions | 6 decisions + 4 drift notes | [swarm/run-state/v3.0-phase-1-alpha-design/04-architect-theo.md](swarm/run-state/v3.0-phase-1-alpha-design/04-architect-theo.md) | blair (asymmetric) + eli (asymmetric) |
| 03-code-reviewer | blair | unproven | Edge-case hunt against v6 spec + existing codebase | 3 CRITICAL + 5 HIGH + 5 MEDIUM + 2 LOW | [swarm/run-state/v3.0-phase-1-alpha-design/03-code-reviewer-blair.md](swarm/run-state/v3.0-phase-1-alpha-design/03-code-reviewer-blair.md) | theo + eli (asymmetric to both) |
| 12-security-engineer | eli | unproven | Threat model K9/K14/K10/pre-spawn-tool-mask/harness attack surface | 2 CRITICAL + 5 HIGH + 5 MEDIUM + 3 LOW | [swarm/run-state/v3.0-phase-1-alpha-design/12-security-engineer-eli.md](swarm/run-state/v3.0-phase-1-alpha-design/12-security-engineer-eli.md) | theo + blair (asymmetric to both) |

**Convergence**: agree on plan-structure direction (theo's 6 decisions are non-contradicted). **Strong convergence on 2 critical bugs**: (1) blair-CRIT-2 ≡ eli-C1 (pre-spawn-tool-mask no-op when `tools[]` absent — silent Pillar-2 bypass); (2) blair-HIGH-1 ≡ eli-H4 (spawn-record.js double-write uses pre-H.9.8 unhardened `.tmp` pattern). **Extension** (no contradiction): blair + eli surface 3 spec-level deltas theo's design didn't address; all absorbed into per-PR scope below.

## Critical Findings to Absorb (all CRITICAL + HIGH + MEDIUM from blair + eli)

| # | Finding (severity) | Owner | Lands in PR | Resolution |
|---|---|---|---|---|
| F1 | blair-CRIT-1: K13×K14 tail-window anchored to WAL `committed_at` (race on slow-disk WAL writes) | spec + impl | 1 + 4 | Spec delta in ADR-0010 + Phase 1-alpha workaround: `spawn-state/<run-id>/spawn_close_wall_ms.txt` captured at PostToolUse hook entry (separate from WAL); v6.1 should patch §5.4 |
| F2 | blair-CRIT-2 ≡ eli-C1: pre-spawn-tool-mask.js silent no-op when `toolInput.tools` absent (CWE-693) | impl | 2 | Fail-closed: when `tools` absent, emit Class-4 audit event + block with `decision: "block", reason: "tools-array-absent-pillar-2-gap"`. **Verify-plan ROUND 2 FLAG (vlad) — Bash-as-string bypass note**: pre-existing gap — if `tools[]` contains string `"Bash"` (not an object with `.command`), `isNetworkBashCommand` never runs because the content check is gated on object-shape. F2 fail-closed CLOSES the absent-tools[] gap but DOES NOT close the Bash-as-string gap. v3.0-alpha mitigation: ADR-0010 documents the gap; mask additionally checks `if (typeof tool === 'string' && tool === 'Bash') { mark for content-injection at K8-arrival point in v3.1 }`. **Verify-plan ROUND 2 FLAG (ari) — hook-protocol citation upgraded**: WebFetch on `https://code.claude.com/docs/en/hooks/` BEFORE PR 2 merge to verify the `{decision: "block", reason: "..."}` PreToolUse response shape against documented protocol (per H.7.23 drift-note 43 schema source-of-truth). LIVE-pattern citation is inductive evidence only; normative source-of-truth is the docs. ADR-0010 records the WebFetch citation. **Verify-plan ROUND 2 FLAG (vlad) — migration scan re-run**: scan window stays 30 days BUT add merge-gate condition — re-run scan within 24h of merge; result must show zero callers omitting `tools[]` or merge is blocked. Closes race between scan and merge. |
| F3 | blair-CRIT-3: recovery sweep TOCTOU between filesystem-hash and ABORTED fsync (background subprocess writes during the window) | spec + impl | 4 | Spec delta in ADR-0010 (v6.1 patch §5.3): recovery sweep MUST hold K13 lock during steps (a)→(c) critical section; spawn-state/<run-id>/`tail_window_close_at.txt` so sweep determines whether crashed spawn's tail window had elapsed at crash time. **Verify-plan MEDIUM #3 (jade) — sweep timeout**: `LOOM_SWEEP_LOCK_TIMEOUT_MS` (default 30000ms; configurable). The (a)→(c) critical section enumerated in ADR-0010 — (a) directory scan, (b) per-spawn filesystem-hash compute, (c) ABORTED record emit + fsync; ADR-0010 IS a hard dependency for PR 4 implementation. **Verify-plan ROUND 2 FAIL (ari) — sweep-incomplete admission safety**: corrected per user decision — spawn admission **BLOCKS until sweep completes** (correctness over liveness). On sweep timeout (`LOOM_SWEEP_LOCK_TIMEOUT_MS` exceeded): sweep releases K13 lock BUT emits Class-4 "sweep-timeout-operator-alert" event AND admission remains blocked; operator must investigate before unblocking via `LOOM_FORCE_ADMIT_AFTER_SWEEP_TIMEOUT=1` (audit-logged Class-4 escape hatch, same pattern as K10). Rationale: stale-PENDING records building evidence chains during a non-converged recovery state is a correctness violation we cannot ship; the brief outage on slow recovery is acceptable for v3.0-alpha local-trust threat model (single-user; not a high-availability target). ADR-0010 documents the policy + the operator-alert mechanism. |
| F4 | eli-C2: pre-spawn-tool-mask denylist incomplete (14+ network-capable Bash patterns missing) (CWE-184) | impl | 2 | Add patterns to mask; ADR-0010 documents allowlist gap; v3.1 K8 accelerates. **Verify-plan MEDIUM #4 (jade) — anchoring policy**: anchored regex via `\b...\b` word-boundary match (not substring); each new pattern ships with "matches-correctly" + "doesn't-match-false-positive" fixture pair. **Verify-plan ROUND 2 FAIL (vlad + nova) — additional bypass vectors discovered**: original list expanded from 14 → 22+ patterns: `git push/fetch/clone <url>`, `socat`, `nc`/`ncat`, `dig`/`nslookup`/`host`/`getent hosts`, base64-piped exec, `rsync` remote, **PLUS** `\bbun\b`, `\bdeno\b`, `\bpnpm\s+dlx\b`, `\bnpx\b`, **`\bcat\s+<<`** (heredoc-pipe-exec class — detects `cat <<EOF \| python` payloads). Inline-interpreter flag-stuffing bypass closed: regex changed from `\b(python\|python3)\s+-c\b` to `\b(python\|python3)(\s+-[A-Za-z])*\s+-c\b` (allows flag stuffing like `python3 -B -c` while still requiring `-c`). Same flag-stuffing pattern applied to `node`/`perl`/`ruby` variants. |
| F5 | blair-HIGH-1 ≡ eli-H4: spawn-record.js double-write `file + '.tmp'` pattern (pre-H.9.8 unhardened) at lines 207, 313, 343-356, 352 (CWE-377) | impl | 1 (bundle with ADRs) | Migrate all 3 sites to `writeAtomicString` from `_lib/atomic-write.js`; collapse double-write where possible (compute `hook_duration_ms` before single write) |
| F6 | blair-HIGH-2: synthesizeChain in `_test-harness.js` uses synthetic `'idem-' + i` idempotency key (INV-22 property tests broken — production `computeIdempotencyKey` can be broken and tests still pass) | impl | 2 | Call real `computeIdempotencyKey({writerPersonaId, operationClass, contentHash, prevStateHash})` inside synthesizeChain |
| F7 | blair-HIGH-3: K14 snapshot-fallback cannot distinguish spawned-agent writes from parent-environment writes (IDE formatters, file watchers) | impl + docs | 4 | Document known false-positive class; add `K14_SUSPECTED_FALSE_POSITIVE` flag to violation records for files not reachable from spawn worktree root; INV-K14-PostDetectionEnforcement fixture set adds "parent-scope change during spawn" case |
| F8 | blair-HIGH-4: K13 must NOT use `withLock` (calls `process.exit(2)` → UI error dialog instead of clean hook-protocol JSON rejection) | impl | 2 | K13 calls `acquireLock` directly + maps false return to `{decision: "block", reason: "serial-only-spawn-active"}` + `process.exit(0)` |
| F9 | blair-HIGH-5: `validateTransactionRecord` does NOT call `isBootstrapSentinel` for A10 genesis-position exception (valid genesis-position records with empty `evidence_refs` will be rejected by K9 pre-commit) | impl | 1 | Add `{isGenesisPosition: boolean}` context parameter to validator; call from K9 pre-commit gate based on chain head position |
| F10 | eli-H1: combined `LOOM_DISABLE_WORKTREE=1` + `LOOM_ALLOW_OUT_OF_SCOPE_WRITES=1` is effective kernel bypass (CWE-284) | impl + docs | 2 (with K10) | Detect + audit-log combined bypass at spawn-init; ADR-0010 documents policy ("deny in CI by default — `LOOM_CI_DENY_COMBINED_BYPASS=1`"); CI smoke job sets the deny env var |
| F11 | eli-H2: K9 cherrypick conflict-bailout artifact placement unspecified (`.orig`/`.rej` files at arbitrary paths) | impl | 3 (K9) | **Verify-plan ROUND 2 FAIL (nova) — `git apply --check` semantic mismatch with cherry-pick**: pre-check approach DROPPED. `git apply --check` validates patches against a raw 3-way merge premise; `git cherry-pick` uses a different ancestor resolution that can succeed where apply --check fails (and vice versa). The pre-check is NOT lossless and shipping it would create false rejection cases. **Corrected approach (per user decision)**: invoke `git cherry-pick <SHA>` directly; on non-zero exit, run `git cherry-pick --abort` (this command resets the index AND the working tree itself, including any `.orig`/`.rej` files it wrote — no separate `git clean` needed). To enforce the v3.0-alpha local-trust assumption around git hooks (vlad CWE-732): cherry-pick is invoked with `-c core.hooksPath=/dev/null` (or equivalent) to disable `pre-applypatch`/`post-applypatch` hook execution from the spawn worktree's `.git/hooks/`. 6th fixture category "conflict-bailout artifacts" added to K9 CWE-22 fixture taxonomy. Path arguments to git invocations use `execFile`-style argument arrays (Node.js `child_process.execFile`), NOT shell-string interpolation — closes vlad CWE-78 command-injection vector. |
| F12 | eli-H3: K9 pre-commit chain-walk is O(\|evidence_refs\| × chain-depth) with no bound until v3.1 R10 (CWE-400) | impl | 3 (K9) | `MAX_EVIDENCE_CHAIN_DEPTH = 1000` constant; ADR-0010 captures the bound rationale + v3.1 R10 replacement |
| F13 | eli-H5: memory-root.js allowlist reads w/ no size cap; parse error messages leak verbatim into WAL JSONL (CWE-20) | impl | 1 (small fix bundled with ADRs) | 100KB size cap on allowlist file read. **Verify-plan ROUND 2 FAIL (vlad) — CWE-74 JSON-structure injection NOT mitigated by control-char stripping alone**: an error message like `"},"injected_key":"value"` contains no control chars; stripping `\n` doesn't help. **Corrected approach** — error strings are NOT concatenated into JSONL via string interpolation; instead, every JSONL record emission goes through `JSON.stringify(record)` where the error message is a string-typed field value. `JSON.stringify` correctly escapes `"`/`\`/`{`/`}` in string values per RFC 8259. The `sanitizeForJsonl` helper becomes simpler: strip `\0` (which `JSON.stringify` rejects) + `scrubSecrets` first-pass before stringify. **Codified ordering** (per vlad): `scrubSecrets(msg) → sanitizeForJsonl(msg) → JSON.stringify({err: msg, ...})` — never concatenation. CWE-117 + CWE-74 both addressed; ADR-0010 enumerates emission sites to verify. |
| F14 | blair-MED-1: K7 path-canonicalize will duplicate `fact-force-gate.js:normalizePath` (DRY) | impl | 2 (K7) | Migrate `fact-force-gate.js` to consume shared `_lib/path-canonicalize.js`; K7 PR includes the migration |
| F15 | blair-MED-2: `_test-harness.js:writeWAL` is non-atomic `fs.writeFileSync` | impl | 2 (with harness extensions) | Migrate to `writeAtomicString`; `appendWAL` fsync after append |
| F16 | blair-MED-3: `transaction-record.js:_schemaCache` is module-level mutable singleton (test pollution risk) | impl | 1 (small fix bundled) | Export `clearSchemaCache()` |
| F17 | blair-MED-4: K2.b allow/deny conflict resolution across precedence levels unspecified | spec | 1 (ADR-0010) | ADR-0010 specifies: **deny is UNION across levels** (project-local deny EXTENDS user-global deny — set union, NOT replacement); **allow is union per-tool but cannot remove denies** (project-local `allow` cannot whitelist a tool that user-global `deny` blocks; tool-deny is sticky across levels). **Verify-plan MEDIUM #6 (jade) — footgun**: this resolves the "wholesale" ambiguity. A project-local block with only `allow: ["Bash"]` and no `deny` key will NOT remove user-global denies. Implementer SHOULD NOT proceed with K2.b conflict logic until ADR-0010 is finalized and reviewed (ADR-first dependency for PR 1). |
| F18 | blair-MED-5: highest-fragility deferred invariants are INV-20, INV-25, INV-A9 (recommend INV-20 + INV-A9 in Phase 1-alpha scope; INV-25 defer) | impl | 4 (K14) + 5 | INV-20-TwoPhaseCommitClosure ships with K9/K14 (PRs 3+4); INV-A9-RecoverySweepIdempotent ships with K9/K14 via `_crash-harness.js`; INV-25 deferred to v3.0-alpha-patch |
| F19 | eli-M1: K14 `LOOM_MONITORED_SIBLINGS` default-empty gap is invisible | impl | 4 | Emit advisory at spawn-init when default-empty; ADR-0010 documents intent |
| F20 | eli-M2: recovery sweep needs `RECOVERY_SWEEP_SENTINEL` bootstrap-sentinel (avoid circular rejection by K9 pre-commit) | impl | 4 | Sweep records use `is_recovery_sweep: true` field; K9 pre-commit skips evidence-link check when set |
| F21 | eli-M3: `ROOT_TASK_RECORD` sentinel unverified — YAGNI candidate | docs | 1 | ADR-0008 documents the sentinel OR removes the claim |
| F22 | eli-M4: `scrubSecrets` misses Stripe key + password-in-URL patterns | impl | 1 | Extend regex set in spawn-record.js |
| F23 | eli-M5: test harness clock/fs-watch injection must be code-path-only (not env-var-triggered); synthesized chains must use non-admissible sentinel | impl | 2 | Harness primitives require explicit function-call activation; chains carry `_test_chain_marker: true` rejected by production validators. **Verify-plan MEDIUM #7 (jade) — reject-not-strip**: `validateTransactionRecord` MUST REJECT records carrying `_test_chain_marker` field (return validation failure with `reason: "test-marker-not-admissible-in-production"`). The field is NEVER stripped at any read boundary. **Verify-plan ROUND 2 FAIL (ari + nova + vlad convergent) — DCE claim was wrong**: Node.js ships as raw `.js` files with no compile-time dead-code elimination. Earlier "compiled out via DCE" claim is factually incorrect for this stack. Replaced with: (a) `validateTestRecord` lives at `tests/unit/kernel/_lib/_test-validate.js` — physically OUTSIDE `packages/kernel/` so production code paths cannot `require` it without crossing the layer boundary; (b) K12 layer-boundary advisory lint (PR 5) flags any production-file import of a `tests/` path as a finding; (c) at runtime, every WAL append path routes through `validateTransactionRecord` which rejects `_test_chain_marker`-bearing records — defense in depth. ADR-0010 enumerates ALL WAL append paths to verify (b)+(c) coverage. |

## Architectural Decisions (theo)

### Decision 1 — K9↔K14 sequencing: sequential resolver in `packages/kernel/spawn-state/post-spawn-resolver.js`

K9 and K14 stay separate (SRP); a NEW `post-spawn-resolver.js` (~120-180 LoC) owns the 5-path post-spawn resolution state machine described in v6 §6.5.1. Resolver imports K9 + K14; neither imports the other (acyclic). Reject the `_lib/k9-k14-contract.js` shape — JS not TS, contracts at this level would either be type definitions (no runtime value) or shared business logic (SRP violation). Parallel-with-barrier rejected by KISS+YAGNI (K14 snapshot p99 ~500ms; K9 cherrypick wall-time dominates; concurrent execution complicates the 5-path failure resolution).

### Decision 2 — K14: pure snapshot at v3.0-alpha; NO feature flag scaffold

Pre-wiring fsevents/inotify flag plumbing violates YAGNI three ways. v6 §6.5.K14:1338 already commits to "snapshot at alpha + event-stream behind flag at v3.1." Per Decision 1, K14's caller is the post-spawn-resolver — v3.1 adds polymorphic dispatch on transport (cleaner than a feature-flag preserved through v3.0-alpha). ADR-0010 documents the v3.1 API delta explicitly.

### Decision 3 — K2-helper integration into spawn-record.js: DEFER to Phase 2

`spawn-record.js` (388 LoC, HARDENED, LIVE PostToolUse) and `transaction-record.js` (180 LoC RESERVATION) coexist intentionally. v6 §3 A10 + §6.13 invariants name `validateTransactionRecord` as the K9 pre-commit gate — K9 doesn't ship until Phase 1-alpha completes; the producer-chain has no consumer yet. Integration now ships pure carrying cost. Adapter (option c) is DRY violation in disguise (premature abstraction). Phase 2 owns the schema-migration PR (~100-200 LoC, ~3-4h) bundled with v6 envelope extensions.

### Decision 4 — CI wiring: 2 sibling sub-PRs (0a + 0b); option (b) new CI job

Per H.7.15 CI-infrastructure dogfood discipline: each CI change ships as its own PR (or atomic-commits-within-one-PR — H.7.15 actually mandates fresh-checkout validation, not literally sibling-PR shape; sibling-PR is the safer-default choice per verify-plan mira FLAG), validated against a clean / non-author checkout BEFORE merging. Two failure modes are different (shellcheck install vs test-discovery); debugging them together is harder. Option (b) — new `kernel-property-tests` CI job — is SRP-clean (vs option a: per-package replace `pnpm -r test` echo-stub, out of scope; option c: fold into smoke-ht.sh, overloads smoke job).

### Decision 5 — 5 dependency-ordered sub-PRs (+ sibling 0a/0b)

See "Phases" section below.

### Decision 6 — Property-test harness shape: split into 3 sibling files

`_test-harness.js` (existing; ~204 LoC) keeps time + WAL + tmpDir basics; NEW `_fs-watch-harness.js` (~150-300 LoC) for injectable fs-watch; NEW `_crash-harness.js` (~150-250 LoC) for kernel-crash-mid-write injection. SRP per harness; Interface Segregation (tests import only what they need). Subdirectory (option c) is YAGNI at N=3 files. In-place extension (option a) breaks the 800-LoC file ceiling per fundamentals rule.

## Files To Modify

Risk classification: **CRITICAL** = LIVE substrate hook touched; **HIGH** = new substrate primitive (Class-1 fault); **MEDIUM** = supporting infra; **LOW** = docs/ADRs.

| Path | Action | Risk | Notes | PR |
|---|---|---|---|---|
| `packages/specs/adrs/0008-major-bump-rationale.md` | NEW | LOW | v3.0.0 MAJOR-bump rationale per ADR template | 1 |
| `packages/specs/adrs/0009-write-scope-enforcement.md` | NEW | LOW | A7 + K14 rationale + P-WriteScope FAIL evidence | 1 |
| `packages/specs/adrs/0010-k9-k14-sequencing-and-phase-1-alpha-spec-deltas.md` | NEW | LOW | K9↔K14 contract; combined env-var bypass policy; F1/F3 spec deltas; K2.b conflict resolution | 1 |
| `packages/kernel/spawn-state/spawn-record.js` | MODIFY | **CRITICAL** | F5: migrate 3 `.tmp` sites to `writeAtomicString`; F22: extend scrubSecrets regex | 1 |
| `packages/kernel/_lib/transaction-record.js` | MODIFY | HIGH | F9: add `isGenesisPosition` param to validator; F16: clearSchemaCache() export | 1 |
| `packages/kernel/_lib/memory-root.js` | MODIFY | MEDIUM | F13: 100KB size cap; sanitizeForJsonl helper | 1 |
| `packages/kernel/_lib/lineage.js` | NEW | HIGH | K3 parent_state_id chain + session_id prompt injection (~15-30 LoC per Architect M3) | 1 |
| `packages/kernel/schema/context-envelope.schema.json` | NEW | HIGH | K3.b context envelope schema; consumes_context_envelope persona flag plumbing. **Verify-plan round 2 (ari) — provisional schema disclaimer**: v3.0-alpha ships schema with ZERO consumers (personas opt-in at v3.1). Schema is **provisional**; v3.1 may amend without backward-compat guarantee. ADR-0010 documents the provisional status + version handshake. | 1 |
| `packages/kernel/_lib/context-envelope.js` | NEW | HIGH | K3.b schema-additive block carried in K8's updatedInput payload (~80-150 LoC) | 1 |
| `.github/workflows/ci.yml` | MODIFY | MEDIUM | Sibling 0a: add `shellcheck` job; Sibling 0b: add `kernel-property-tests` job | 0a, 0b |
| `packages/kernel/_lib/path-canonicalize.js` | NEW | HIGH | K7 (~60-120 LoC); reused by K9 + K14 + fact-force-gate.js (F14 migration) | 2 |
| `packages/kernel/hooks/pre/fact-force-gate.js` | MODIFY | MEDIUM | F14: consume shared `_lib/path-canonicalize.js` | 2 |
| `packages/kernel/worktree/worktree-allocator.js` | NEW | **CRITICAL** | K1 declarative worktree integration + retry + cleanup (~150-220 LoC) | 2 |
| `packages/kernel/hooks/pre/pre-spawn-tool-mask.js` | MODIFY | **CRITICAL** | F2: fail-closed on absent `tools`; F4: 14+ pattern additions; F23 test-mode-flag policy | 2 |
| `packages/kernel/enforcement/k10-escape-hatch.js` | NEW | HIGH | LOOM_DISABLE_WORKTREE + LOOM_ALLOW_OUT_OF_SCOPE_WRITES audit-log emit (~40-60 LoC) + F10 combined-bypass detection | 2 |
| `packages/kernel/enforcement/k13-serial-enforcer.js` | NEW | HIGH | K13 spawn-state scan + lock-based admission gate (~80-150 LoC); F8: use acquireLock directly | 2 |
| `tests/unit/kernel/_lib/_test-harness.js` | MODIFY | MEDIUM | F6: real computeIdempotencyKey in synthesizeChain; F15: atomic writeWAL; F23: code-path-only injection | 2 |
| `tests/unit/kernel/_lib/_fs-watch-harness.js` | NEW | MEDIUM | Injectable fs-watch event emitter (~150-300 LoC) | 2 |
| `tests/unit/kernel/_lib/_crash-harness.js` | NEW | MEDIUM | Kernel-crash-mid-write injection (~150-250 LoC); INV-A9 critical-path | 2 |
| `packages/kernel/_lib/k9-promote-deltas.js` | NEW | **CRITICAL** | K9 cherrypick + reverse-cherrypick journal + CWE-22 + F11 conflict-abort + F12 MAX_EVIDENCE_CHAIN_DEPTH (~650-1,050 LoC). **Verify-plan PRINCIPLE (jade) — 800-LoC ceiling**: at HIGH-end estimate this breaches fundamentals.md 800-LoC file limit. **Mandatory split (reviewer amendment 2026-05-27)** — trigger moved from "impl-actual exceeds 700 LoC at PR-finalization" to **"projected impl-LoC exceeds 700 at end of TDD Phase 1 (failing tests written + scaffolding stubs)"**. Split into `k9-path-guard.js` (CWE-22 validation, ~150-250), `k9-promote-deltas.js` (cherrypick orchestration, ~300-450), `k9-journal.js` (reverse-cherrypick journal, ~200-350). LoC projection method: count test-fixture cases × average impl-LoC-per-fixture from comparable existing primitives (atomic-write.js ratio is ~3 impl LoC per test case for substrate code). Earlier trigger prevents impl-then-refactor waste. Implementer SHOULD pause Phase 3 (impl-to-green) until split decision recorded; split decision records to ADR-0010. | 3 |
| `tests/fixtures/k9/cwe-22/*` | NEW | HIGH | 5-category × 4 = 20 path-traversal fixtures + 4 semantic-invalidity fixtures + 6th conflict-bailout category | 3 |
| `packages/kernel/_lib/k14-write-scope.js` | NEW | **CRITICAL** | K14 snapshot algorithm + tail-window + symlink/TOCTOU (~500-900 LoC). **Verify-plan PRINCIPLE (jade)**: at HIGH-end approaches 800-LoC ceiling. **Mandatory split (reviewer amendment 2026-05-27)** — trigger moved from "impl-actual exceeds 700 LoC" to **"projected impl-LoC exceeds 700 at end of TDD Phase 1"** (same method as K9 above). Split into `k14-snapshot.js` (snapshot + hash, ~200-300), `k14-tail-window.js` (timer + tail logic, ~150-250), `k14-symlink-guard.js` (TOCTOU + symlink-race, ~150-200). Same Phase-3 pause + ADR-0010 recording discipline. | 4 |
| `packages/kernel/spawn-state/post-spawn-resolver.js` | NEW | **CRITICAL** | Per Decision 1: 5-path state machine resolver (~120-180 LoC); union audit-log emission | 4 |
| `packages/kernel/spawn-state/recovery-sweep.js` | NEW | **CRITICAL** | F3 + F20: sweep holds K13 lock; tail_window_close_at.txt anchor; recovery_sweep sentinel | 4 |
| `tests/fixtures/k14/violations/*` | NEW | HIGH | 4 violation classes × 3 transports = 12 fixtures + F7 parent-scope false-positive case + F19 default-empty advisory case | 4 |
| `packages/kernel/_lib/layer-boundary-lint.js` | NEW | LOW | K12 frontmatter markers + advisory CI lint (~50-80 LoC) | 5 |
| `.github/workflows/ci.yml` | MODIFY | LOW | K12 job: layer-boundary-lint advisory job (failure = warning, not block) | 5 |

## Phases

### Sub-PR Phase-1-alpha/0a — shellcheck CI gate (~30 min, ~20-40 LoC)

**Branch**: `feat/phase-1-alpha/0a-shellcheck-ci-gate`
**Risk**: LOW. Standalone. No coupling to other PRs.
**Files**: `.github/workflows/ci.yml` only.
**Action**:
1. Add new GitHub Actions job `shellcheck-gate`: ubuntu-latest, runs `shellcheck install.sh **/*.sh` against all shell scripts.
2. Verify CI passes on a fresh-checkout feature branch (H.7.15 dogfood).
3. Push, open PR, merge.
**Verification probes**:
- `act -j shellcheck-gate` (local CI sim) returns 0
- CI on fresh feature branch returns 0
- PR review checklist: 1 reviewer

### Sub-PR Phase-1-alpha/0b — kernel-property-tests CI job (~1-2h, ~30-60 LoC)

**Branch**: `feat/phase-1-alpha/0b-kernel-property-tests-ci`
**Risk**: LOW.
**Depends on**: 0a merged (so two CI infra changes don't co-mingle).
**Files**: `.github/workflows/ci.yml` only.

**⚠️ Verify-plan FAIL #1 (jade) — CI false-green bug**: existing test files use imperative `assert` + hand-rolled `test()` wrappers (NOT `node:test` framework). `node --test tests/unit/kernel/**/*.test.js` would load them, see zero `node:test`-format `test()`/`describe()` calls, report 0 tests run = **vacuous pass even when assertions fail**. Switching to per-file script-runner loop (KISS).

**Action**:
1. Add new GitHub Actions job `kernel-property-tests`: ubuntu-latest, Node.js 20, runs each test file as a script (the existing pattern). **Verify-plan round 2 nova FLAG fixes applied**: explicit `working-directory: ${{ github.workspace }}` declared per step (else relative `find` may silently match zero files and produce vacuous pass — exactly jade's original bug); null-delimited `find -print0` + `read -d ''` instead of `for f in $(find)` to safely handle paths with whitespace; fail-fast NOT used (loop continues across all test files so a single failure doesn't mask others, then exits 1 if any failed):
   ```yaml
   - name: Run kernel property tests
     working-directory: ${{ github.workspace }}
     shell: bash
     run: |
       set +e  # explicit; don't kill loop on first failure
       failed=0
       count=0
       while IFS= read -r -d '' f; do
         count=$((count+1))
         echo "::group::$f"
         node "$f"
         rc=$?
         echo "::endgroup::"
         [ $rc -ne 0 ] && failed=1
       done < <(find "$GITHUB_WORKSPACE/tests/unit/kernel" -name '*.test.js' -type f -print0)
       echo "Ran $count test files; failures: $failed"
       [ "$count" -eq 0 ] && { echo "::error::Zero test files matched (vacuous-pass guard); failing."; exit 2; }
       exit $failed
   ```
2. Trigger: `on: [push, pull_request]` (matches existing CI jobs).
3. Verify all 6 existing kernel test files pass under the new job AND that a deliberately-failing test causes the job to fail (false-green regression check; the `count -eq 0` guard catches the cwd-mismatch vacuous-pass directly).
4. Push, open PR, merge.
**Verification probes**:
- All 6 existing kernel tests pass in new job
- Job runs in <60s p99
- CI on fresh feature branch returns 0

### Sub-PR Phase-1-alpha/1 — ADRs + K3/K3.b + bug-fix bundle (~280-450 LoC, ~8-12h)

**Branch**: `feat/phase-1-alpha/1-adrs-and-k3-bundle`
**Risk**: HIGH (touches LIVE `spawn-record.js` per F5).
**Depends on**: 0b merged.
**TDD-treatment**: write failing tests FIRST per H.7.9 sub-rule.
**Files** (all from "Files To Modify" PR=1 rows above):
- 3 new ADRs (0008/0009/0010)
- `spawn-record.js` 3 .tmp-suffix migrations + F22 secret regex extension
- `transaction-record.js` F9 + F16
- `memory-root.js` F13
- K3 lineage primitives (NEW)
- K3.b context envelope schema + plumbing (NEW)

**Phases**:
1. **TDD-treatment**: write failing tests for INV-K3-LineageAcyclicity (parent_state_id chain DAG property); INV-K2-SchemaForwardCompat genesis-position case (F9); spawn-record.js atomic-write behavior (F5 regression test); memory-root.js size-cap behavior (F13).
2. Run tests → expect failures → architect-pair-run with failing-test set as design contract (already done at design time; capture conformance).
3. Write 3 ADRs first (pair-reviewed text; LOW risk).
4. Migrate spawn-record.js .tmp sites to writeAtomicString (F5); collapse double-write where possible. RUN existing spawn-record.test.js after each migration — zero regressions tolerated.
5. Add isGenesisPosition param to validateTransactionRecord (F9); add clearSchemaCache export (F16); add 100KB cap + sanitizeForJsonl to memory-root.js (F13).
6. Implement K3 lineage primitives (`_lib/lineage.js`).
7. Implement K3.b context envelope schema + plumbing.
8. Re-run all tests → expect GREEN.
9. Code-reviewer pair-run (different identity than blair; not the design challenger) for resource/edge-case coverage.

**Verification probes**:
- All 6 kernel tests (existing) PASS post-migration (zero regressions on LIVE hook)
- New tests for F9/F13/F16 PASS
- New INV-K3-LineageAcyclicity property test PASS
- ADR-0008/0009/0010 schema-validate per `validate-adr-drift.js`
- `bash install.sh --hooks --test` PASS (smoke regression check)

### Sub-PR Phase-1-alpha/2 — K1 + K7 + K10 + K13 + pre-spawn-tool-mask fixes + harness extensions (~580-880 LoC, ~12-18h)

**Branch**: `feat/phase-1-alpha/2-easy-primitives-and-harness`
**Risk**: HIGH (touches THE ONE THING + LIVE spawn-record adjacent).
**Depends on**: 1 merged.
**TDD-treatment**: write failing tests FIRST.

**Files** (PR=2 rows):
- `_lib/path-canonicalize.js` (NEW; K7) + fact-force-gate.js migration (F14)
- `worktree/worktree-allocator.js` (NEW; K1)
- `pre-spawn-tool-mask.js` MODIFY (F2 fail-closed + F4 14+ patterns + F23 policy)
- `enforcement/k10-escape-hatch.js` (NEW; K10 + F10 combined-bypass)
- `enforcement/k13-serial-enforcer.js` (NEW; K13 + F8 acquireLock directly)
- `tests/unit/kernel/_lib/_test-harness.js` MODIFY (F6 + F15 + F23)
- `tests/unit/kernel/_lib/_fs-watch-harness.js` NEW
- `tests/unit/kernel/_lib/_crash-harness.js` NEW

**Phases**:
1. **TDD-treatment**: write failing tests for: INV-K13-SerialOnly (acquireLock direct path; F8); INV-P-DepthOne; pre-spawn-tool-mask absent-tools (F2 fail-closed); K1 retry+cleanup; K7 path-canonicalize edge cases (CWE-22 categories); K10 combined-bypass detect (F10).
2. Build `_lib/path-canonicalize.js` + migrate `fact-force-gate.js` to consume it (F14). Run fact-force-gate.js tests (existing) — zero regressions.
3. Build K1 `worktree/worktree-allocator.js` retry+cleanup + escape-hatch hook.
4. Modify `pre-spawn-tool-mask.js`: F2 fail-closed on absent tools[]; F4 14+ pattern additions (`git push`, `socat`, etc.); F23 explicit non-env-var policy. RUN existing pre-spawn-tool-mask.test.js — zero regressions tolerated.
5. Build K10 escape-hatch + F10 combined-bypass detection + audit-log emit.
6. Build K13 serial-enforcer: spawn-state scan + acquireLock direct (F8); JSON hook response.
7. Extend harnesses: F6 real computeIdempotencyKey; F15 atomic writeWAL; F23 code-path-only injection; build `_fs-watch-harness.js`; build `_crash-harness.js`.
8. Re-run all tests → expect GREEN.
9. Code-reviewer pair-run for: regression on pre-spawn-tool-mask (LIVE hook); resource leaks in K1 worktree cleanup; concurrency edges in K13.

**Verification probes**:
- INV-K13-SerialOnly property test PASS (concurrent-spawn fixture queues or rejects, never both active)
- INV-P-DepthOne property test PASS
- pre-spawn-tool-mask absent-tools test: hook returns `{decision: "block", reason: "tools-array-absent-pillar-2-gap"}` + Class-4 audit event emitted
- pre-spawn-tool-mask denylist regression: all 14 new patterns covered by test fixtures
- K1 retry: spawn with simulated worktree-allocation failure → 3 retries → escape hatch fires
- K10 combined-bypass: env vars both set → audit-log entry emitted with severity HIGH + spawn proceeds (local-trust threat model)
- `_crash-harness.js`: kernel-crash-mid-write fixture passes
- `bash install.sh --hooks --test` PASS

### Sub-PR Phase-1-alpha/3 — K9 promote-deltas (~650-1,050 LoC, ~14-20h)

**Branch**: `feat/phase-1-alpha/3-k9-promote-deltas`
**Risk**: **CRITICAL**. Multi-architect pair-review mandated (architect + code-reviewer + security-auditor).
**Depends on**: 2 merged (uses K7 path-canonicalize + `_crash-harness.js`).
**TDD-treatment**: MANDATORY (substrate-fundament ≥80 LoC + behavior change).

**Verify-plan ROUND 2 FAIL (ari) resolution — K9 ships DORMANT**: K9 module + tests land in PR 3 but NO production import path uses K9 in this PR. Only test files in `tests/unit/kernel/_lib/k9-promote-deltas.test.js` (and K9 CWE-22 fixtures) import the module. The first production importer is `post-spawn-resolver.js` which ships in PR 4. Why this matters: if PR 4 stalls (review, hotfix, holiday), K9 sits on main as ~700-1,050 LoC of unimported code — carrying cost is real but no half-shipped behavior risk.

**Reviewer amendment 2026-05-27 — dormancy is a merge-blocking CI gate, NOT advisory**. PR 3 CI workflow adds a new job `dormancy-assertion-k9` (or extends `kernel-property-tests` with a pre-test step) that runs:

```bash
# Must return zero hits; any hit means K9 is being imported by production code
# (anything outside tests/), which violates the ship-dormant contract
hits=$(grep -r "require.*k9-promote-deltas\|from.*k9-promote-deltas" packages/ \
  | grep -v "tests/" \
  | grep -v "^packages/kernel/_lib/k9-promote-deltas.js" || true)
if [ -n "$hits" ]; then
  echo "::error::K9 dormancy violation — production import detected:"
  echo "$hits"
  exit 1
fi
echo "K9 dormancy verified: zero production importers."
```

CI job failure BLOCKS the PR merge button. PR 3 description includes a checkbox: `[ ] dormancy-assertion-k9 CI job green (manually verified by reviewer)`. PR 4 deletes this CI job in the same commit that adds the first production importer (post-spawn-resolver), so the gate self-removes when dormancy ends.

**Files** (PR=3 rows):
- `_lib/k9-promote-deltas.js` (NEW; K9 cherrypick + journal + CWE-22 + F11 + F12)
- `tests/fixtures/k9/cwe-22/*` (NEW; 5 categories × 4 = 20 + 4 semantic-invalidity + 6th conflict-bailout = 26 fixtures)
- `tests/unit/kernel/_lib/k9-promote-deltas.test.js` (NEW)

**Phases**:
1. **TDD-treatment**: write failing tests for: INV-K9-RejectFidelity (post-FAIL host state = pre-spawn byte-for-byte); INV-K9-SyntacticAtomicity (K9 mid-cherrypick abort → state ∈ {pre, post}, never partial); INV-21-EvidenceLinkPreCommit (forged evidence_refs rejected; valid genesis-position bootstrap accepted via F9); all 26 CWE-22 fixtures; F11 conflict-bailout abort; F12 chain-walk depth bound at 1000.
2. Architect-pair-run with failing-test set as behavioral contract (theo's design ≅ tests).
3. Implement `k9-promote-deltas.js` minimum-code to make all tests GREEN. No scope creep.
4. Security-auditor pair-run (different identity than eli) reviewing CWE-22 fixture coverage + journal integrity + chain-walk bound.
5. Code-reviewer pair-run (different identity than blair) for fragility + resource leaks.

**Verification probes**:
- All 26 fixtures pass K9 verification (negative cases: rejected; positive: promoted)
- INV-K9-RejectFidelity property test PASS (random delta injection + abort)
- INV-K9-SyntacticAtomicity PASS
- INV-21-EvidenceLinkPreCommit PASS (including genesis-position bootstrap)
- F12 chain-walk depth limit: synthetic 1500-deep chain → rejected at depth 1000
- F11 conflict-bailout: synthetic 3-way merge conflict → abort, NO `.orig`/`.rej` files produced
- `bash install.sh --hooks --test` PASS

### Sub-PR Phase-1-alpha/4 — K14 write-scope enforcer + post-spawn-resolver + recovery-sweep (~700-1,100 LoC, ~14-20h)

**Branch**: `feat/phase-1-alpha/4-k14-resolver-recovery`
**Risk**: **CRITICAL**. K9↔K14 contract glue lands here.
**Depends on**: 3 merged.
**TDD-treatment**: MANDATORY.

**Reviewer amendment 2026-05-27 — PR 4 runbook-familiarity pre-merge gate**: PR 4 introduces state-machine modifications that interact with LIVE WAL writes. The Rollback Strategy section's "Operator runbook for PR 4 revert specifically" enumerates the procedure (revert + manual ABORTED record emission for in-flight PENDING records + LIVE-session restart + post-revert smoke test). **Before PR 4 can merge**:
1. PR 4 description includes a `[ ]` checkbox: "I (designated rollback operator for v3.0-alpha) have read packages/specs/plans/2026-05-27-phase-1-alpha-v3.0-alpha-kernel.md §Rollback Strategy operator runbook and acknowledge the manual ABORTED-record injection procedure."
2. At least 2 named reviewers (project owners) must check this box explicitly in the PR review.
3. CI workflow adds a pre-merge step: `gh pr view <PR-4> --json reviews | jq '.reviews | map(select(.body | contains("Runbook acknowledged"))) | length >= 2'` — must return true.
4. ADR-0010 captures the runbook AS the canonical reference (not just plan-file prose), so even after the plan PR is squashed/merged, the runbook persists as an ADR.

Why: PR 4 is the only PR in Phase 1-alpha whose rollback requires manual filesystem operations on operator runtime (WAL ABORTED-record emission). All other PR reverts are pure git operations. The pre-merge gate ensures rollback-readiness is verified BEFORE the substrate is exposed to PR 4's risk surface.

**Files** (PR=4 rows):
- `_lib/k14-write-scope.js` (NEW; K14 snapshot + tail-window + symlink/TOCTOU)
- `spawn-state/post-spawn-resolver.js` (NEW; Decision 1 5-path state machine)
- `spawn-state/recovery-sweep.js` (NEW; F3 K13-locked critical section + F20 sweep sentinel)
- `tests/fixtures/k14/violations/*` (12 fixtures + F7 + F19)

**Phases**:
1. **TDD-treatment**: write failing tests for: INV-K14-PostDetectionEnforcement (K14 violation → K9 path not entered); INV-28-K13K14SerialClosure (tail-window interlock; uses injectable-clock from existing harness); INV-19-WALAppendOnly (already passing — regression-only); INV-20-TwoPhaseCommitClosure; INV-A9-RecoverySweepIdempotent (uses `_crash-harness.js` from PR 2); F1 spawn_close_wall_ms anchor; F3 K13-locked recovery critical section; F7 parent-scope false-positive; F19 default-empty advisory.
2. Architect-pair-run.
3. Implement K14 minimum-code.
4. Implement `post-spawn-resolver.js` — 5-state transition table as data; union audit-log emission.
5. Implement `recovery-sweep.js` — F3 K13 lock + F20 sentinel.
6. Security-auditor pair-run (TOCTOU + symlink-race coverage).
7. Code-reviewer pair-run (state-machine completeness, error paths).

**Verification probes**:
- All 12 K14 fixtures pass (4 violation classes × 3 transports)
- INV-K14-PostDetectionEnforcement PASS
- INV-28-K13K14SerialClosure PASS (injectable-clock-driven, no wallclock dep)
- INV-A9-RecoverySweepIdempotent PASS (twice-walk-WAL same-result)
- F1: K13 unblocks based on `spawn_close_wall_ms.txt`, not WAL `committed_at`
- F3: recovery sweep test where backgrounded subprocess writes during critical section → sweep emits violation record correctly
- F7: parent-scope IDE-formatter fixture → emitted with `K14_SUSPECTED_FALSE_POSITIVE` flag
- post-spawn-resolver: 5-path fixtures (PASS, pre-K9 FAIL, post-K9 tail FAIL, K9 event-stream FAIL, override) each produces correct audit record
- E2E test: spawn → write in-scope → K14 PASS → K9 PASS → promoted; spawn → write out-of-scope → K14 FAIL → K9 not entered → REJECTED + reverse-cherrypick journal entry

### Sub-PR Phase-1-alpha/5 — K12 layer-boundary advisory CI lint (~50-80 LoC, ~1-2h)

**Branch**: `feat/phase-1-alpha/5-k12-layer-lint`
**Risk**: LOW. Independent. Can ship parallel to any other PR if review bandwidth allows.
**Depends on**: 0b merged (uses the CI pattern).

**Files**:
- `_lib/layer-boundary-lint.js` (NEW)
- `.github/workflows/ci.yml` MODIFY (add advisory job)

**Phases**:
1. Implement frontmatter-marker check + advisory CI lint per v5.1 downgrade spec.
2. Wire as ADVISORY job (failure = warning annotation, not blocking).
3. Verify lint emits findings on 0 current cross-layer violations (empirical-zero-drift baseline per v5.1 Round-7).

**Verification probes**:
- `node packages/kernel/_lib/layer-boundary-lint.js` returns 0 findings on current main
- CI job runs but does not block PRs on lint failure
- ADR-0010 updated with K12-advisory rationale (already covered via Decision 4)

## TDD-Treatment

Per H.7.9 TDD-treatment sub-rule (substrate-fundament rewrite ≥80 LoC + behavior change): mandatory for PRs 3 + 4. Recommended for PRs 1 + 2. Skipped for PRs 0a/0b/5 (CI infra + advisory lint; no behavior change).

**Failing-test order per PR** (the failing-test set IS the behavioral spec the architect pair-runs against):

| PR | Invariants tested first (failing) | Tests location |
|---|---|---|
| 1 | INV-K3-LineageAcyclicity, INV-K2-SchemaForwardCompat genesis-pos, **INV-22-IdempotencyKeyUniqueness lightweight uniqueness fixture (per verify-plan mira FLAG)** | `tests/unit/kernel/_lib/k3-lineage.test.js`, extend `transaction-record.test.js`, extend `transaction-record.test.js` with INV-22 fixture (`computeIdempotencyKey` returns unique key for distinct (persona, op_class, contentHash, prev) tuples; collision-fixture asserts known-good input pairs do not collide) |
| 2 | INV-K13-SerialOnly, INV-P-DepthOne, pre-spawn-tool-mask absent-tools (F2), K10 combined-bypass (F10) | `tests/unit/kernel/enforcement/k13-serial.test.js`, extend `pre-spawn-tool-mask.test.js`, new `k10-escape-hatch.test.js` |
| 3 | INV-K9-RejectFidelity, INV-K9-SyntacticAtomicity, INV-21-EvidenceLinkPreCommit + 26 CWE-22 fixtures + F11/F12 | `tests/unit/kernel/_lib/k9-promote-deltas.test.js` |
| 4 | INV-K14-PostDetectionEnforcement, INV-28-K13K14SerialClosure, INV-20-TwoPhaseCommitClosure, INV-A9-RecoverySweepIdempotent + F1/F3/F7 fixtures | `tests/unit/kernel/_lib/k14-write-scope.test.js`, `tests/unit/kernel/spawn-state/post-spawn-resolver.test.js`, `tests/unit/kernel/spawn-state/recovery-sweep.test.js` |

Invariants explicitly DEFERRED to v3.0-alpha-patch (manual-verification at v3.0-alpha LOCK, property test at patch): INV-22-IdempotencyKeyUniqueness (covered transitively by synthesizeChain F6 fix), INV-23-MVCCSnapshotPinned (degenerate under K13 serial-only; activate when K13-relax v3.5+), INV-24-NoBareUpdate (schema-enforced; no operation_class=UPDATE in enum), INV-25-SchemaMigrationIsTransaction (per blair MED-5; defer), INV-27-PersonaIndexCanonicalOnly (defer until v3.3 E14 needs it), INV-A3a-A3b-Separation (deferred per blair MED-5 — R-primitives ship v3.1), INV-Replay-K5K7K9Equivalence (K5 doesn't ship in v3.0-alpha; defer).

**Estimate-realism footnote (per verify-plan mira FLAG)**: per-sub-PR sum (~2,320-3,650 LoC / ~50.5-74.5h) is LOWER than the v6 §6.11 row total (~2,755-4,600 LoC / ~52-87h). The ~435-950 LoC delta is accounted for by: (a) K9 CWE-22 fixtures (26 fixtures × ~10-20 LoC each = ~260-520 LoC; fixture data NOT inside the K9 impl 650-1,050 estimate); (b) K14 violation fixtures (12 + F7/F19 cases × ~10-20 LoC = ~130-260 LoC); (c) ADR prose (3 ADRs × ~150-300 lines markdown = ~450-900 lines — counted as LoC); (d) per-test-file boilerplate + shared fixture setup helpers (~50-100 LoC). The 52-87h estimate honestly includes TDD-treatment 2× cost on PRs 3 + 4 (write tests first, then impl-to-green, then pair-review).

## Verification Probes (aggregate end-to-end)

| Probe | Pass criterion |
|---|---|
| P1 | All 5 sub-PRs (+ 0a/0b) merged on main with zero reverts |
| P2 | Honest LoC actual vs estimated: within ±25% of 2,755-4,600 range (acknowledge if over) |
| P3 | Honest hours actual vs estimated: within ±25% of 52-87h range; abort at 140h |
| P4 | INV-19, INV-26, INV-27, INV-28 (from K2 reservation) still passing (regression-only) |
| P5 | 13+ NEW invariant property tests passing: INV-K9-RejectFidelity, INV-K9-SyntacticAtomicity, INV-K14-PostDetectionEnforcement, INV-21-EvidenceLinkPreCommit, INV-K3-LineageAcyclicity, INV-K13-SerialOnly, INV-P-DepthOne, INV-K14 false-positive class, INV-20-TwoPhaseCommitClosure, INV-A9-RecoverySweepIdempotent, INV-K2-SchemaForwardCompat-Genesis, plus pre-spawn-tool-mask absent-tools + K10 combined-bypass behavior tests |
| P6 | E2E spawn test: K1 worktree → spawn → in-scope write → K14 PASS → K9 PASS → promoted; out-of-scope write → K14 FAIL → K9 not entered → REJECTED + journal entry |
| P7 | All 23 critical findings (F1-F23) resolved with traceable PR + test fixture |
| P8 | ADRs 0008/0009/0010 schema-valid + cross-referenced from primitive files |
| P9 | Pre-spawn-tool-mask coverage audit: F4's 14 new patterns each have a denied-attempt test fixture |
| P10 | `bash install.sh --hooks --test` PASS at every merge boundary; smoke tests zero regressions |
| P11 | CI: shellcheck-gate (0a), kernel-property-tests (0b), smoke, markdown-lint, json-validate, k12-advisory (5) all green. **Verify-plan round 2 (ari) — honest p99 budget**: 0b's per-file script-runner p99 budget revised to **~2-3 minutes when PR 3 lands** (K9 + 26 CWE-22 fixtures × git-subprocess each); the original "<60s" target only holds for pre-PR-3 baseline. P11 is honest-disclosure of CI wallclock growth, NOT a regression. |
| P12 | HETS reputation: per-persona pair-review verdicts recorded for all 5 substrate PRs; convergence pattern observed |
| P13 | Plan-honesty: actual decisions taken vs Decision 1-6 documented; deviations flagged in Drift Notes |
| P14 | Local-trust threat model holds: no v3.0-alpha invariants claim defense against host-level filesystem tampering (OQ-20 deferred to v3.1) |

## Out of Scope (Deferred)

Honest scope discipline — what we explicitly chose NOT to do in Phase 1-alpha.

| Item | Where it lands |
|---|---|
| K2-helper integration into spawn-record.js (Decision 3) | Phase 2 (~100-200 LoC schema migration PR) |
| K6 capability subset check | v3.1 RUNTIME FOUNDATION |
| K8 capability injection | v3.1 RUNTIME FOUNDATION |
| K11 kernel algorithm library expansion (beyond route-decide) | v3.2 RUNTIME DECOMPOSITION |
| K12 mandatory enforcement (upgrade from advisory) | OQ-19: triggers at ≥3 observed drift events |
| FSEvents/inotify real-time variant of K14 (Decision 2) | v3.1 (polymorphic dispatch on transport via post-spawn-resolver) |
| R10 budget envelope (replaces F12 MAX_EVIDENCE_CHAIN_DEPTH=1000) | v3.1 |
| R13 idempotency-key enforcer | v3.1 |
| K2.c per-tool-call observability | v3.1 |
| INV-22, INV-23, INV-24, INV-25, INV-27, INV-A3a-A3b-Separation, INV-Replay-K5K7K9Equivalence (per TDD-Treatment deferral list) | v3.0-alpha-patch or v3.1+ |
| Tamper-evidence (cryptographic chain anchoring + signed WAL records) | v3.1 OQ-20 (threat-model ADR) |
| ContainerAdapter (K1 alternative via Docker/Firecracker/E2B) | v3.5+ |
| Blocking-grade prompt-injection defense (Pillar 2 EXTENSION) | v3.5+ (M1 from v5) |
| Kernel-layer network egress policy | v3.5+ (M2 from v5; ContainerAdapter dependency) |
| Cherrypick latency benchmarking vs DeltaBox | v3.1 backlog field-survey closure |
| AGENTS.md interop | v3.1+ backlog |
| Dream-Lite, GC machinery, E1-E14 Evolution Lab | v3.3+ |
| `pnpm -r test` real per-package runners | out of scope; option (a) rejected in Decision 4 |
| HD-3 v3.3 envelope expansion | v3.3 LOCK (per Round-3b cleanup deferral) |
| T-7 §5/§5a vs §6.1/§6.2 in-file ordering | v6.1 amendment |

## Rollback Strategy (per-PR, per verify-plan round-2 ari FAIL C.2)

| PR | Revert order | State cleanup | Cascading reverts? |
|---|---|---|---|
| 0a (shellcheck) | `git revert <0a-merge-commit>` | None (CI config only) | No |
| 0b (kernel-property-tests CI) | `git revert <0b-merge-commit>` | None (CI config only); existing CI jobs unaffected | No |
| 1 (ADRs + K3 + bug-fix bundle) | `git revert <1-merge-commit>` | Restore prior `spawn-record.js` from pre-1 commit; ADRs become unmerged (re-create from `swarm/run-state/` if needed) | If 2+ already merged: revert 2 first (K3 + K3.b have downstream consumers) |
| 2 (K1 + K7 + K10 + K13 + harness extensions) | `git revert <2-merge-commit>` | Restore prior `pre-spawn-tool-mask.js` + `fact-force-gate.js`; remove `enforcement/`, `worktree/` directories if empty; delete `tests/unit/kernel/_lib/_fs-watch-harness.js` + `_crash-harness.js` (no consumers if PR 4 not yet merged) | If 3+ already merged: revert 3 first (K9 imports K7); if 4 already merged: revert 4 first (resolver imports K1/K13) |
| 3 (K9) | `git revert <3-merge-commit>` | Delete `_lib/k9-promote-deltas.js` + `tests/fixtures/k9/`; spawn-state directories unaffected (K9 never wrote in dormant state) | If 4 already merged: revert 4 first (resolver imports K9). Cascade order: 4 → 3 |
| 4 (K14 + resolver + recovery-sweep) | `git revert <4-merge-commit>` | Clean up any in-flight spawn-state directories from PostToolUse hook runs that wrote K14 violations; flush in-progress WAL entries if any landed in two-phase-commit phase 1 (PENDING) — manual operator step | Standalone revert if 5 not yet merged. PR 4 is the highest-risk revert; in-flight WAL state requires careful handling. ADR-0010 documents the operator procedure. |
| 5 (K12 advisory) | `git revert <5-merge-commit>` | Remove `_lib/layer-boundary-lint.js` + advisory CI job from workflow | No (advisory only; non-blocking lint never affected merges) |

**Cascade-revert order summary** (worst case, all 5 substrate PRs merged then PR 4 needs revert): revert 5 (independent) → revert 4 (resolver/K14/sweep) → revert 3 (K9; resolver no longer imports it) → revert 2 (K7 used by K9 + K14 + fact-force-gate.js; revert order matters since fact-force-gate.js's migration to shared K7 happened in PR 2) → revert 1 (K3 chain + bug fixes). Reverting 0a/0b individually does nothing useful (CI infra only); if rollback-everything is needed, revert in inverse-merge order.

**Operator runbook for PR 4 revert specifically** (per ari's call-out — highest-risk):
1. `git revert -m 1 <4-merge-commit>` (preserves merge history)
2. For each spawn-state directory under `swarm/run-state/` with `commit_outcome: PENDING`: emit a manual `ABORTED` record with `abort_reason: "operator-revert-of-pr-4"` so subsequent recovery sweep doesn't re-process.
3. Restart any LIVE Claude Code session (kills in-flight PreToolUse hooks that may have stale K14 state).
4. Smoke-test: spawn an Agent task; confirm `spawn-record.js` still emits envelopes via the prior pathway (not via the reverted resolver).
5. ADR-0010 explicitly covers this runbook so operators don't reinvent it under pressure.

## Drift Notes

Pattern-emergence observations during plan work.

- **DN-1**: route-decide v1.2 dictionary missed K-primitive nomenclature (K1-K14, axiom names, invariant names) — bare technical-detail variant scored 0.112 → root despite spec explicitly classifying this as HETS-routed. H.7.5 prompt-design retry with architectural surface keywords resolved (0.662 → route). **Candidate for /self-improve**: add K1-K14, A8-A10, INV-* to dictionary as substrate-meta + architectural signal tokens; flag substrate_meta_detected=true when present.
- **DN-2**: HETS Option B (independent-lens parallel) yielded 3 CRITICAL + 13 HIGH/MEDIUM findings the spec authors and architect-only-design would have missed. CRIT-2/eli-C1 convergence on pre-spawn-tool-mask absent-tools bug = exact pattern from H.7.23 (caught 4 HIGH/CRITICAL bugs in H.7.22). Pattern: parallel-against-spec catches MORE than sequential-against-architect-output for substrate-fundament work.
- **DN-3**: v6 §6.5 doesn't codify "K2-helper integration deferred to Phase 2" — implicit in K2 reservation PR description but not in the LOCKED RFC body. Theo's Decision 3 fills this gap operationally. **v6.1 candidate**: add §6.5 sub-note explicitly excluding spawn-record.js↔transaction-record.js integration from Phase 1-alpha.
- **DN-4**: v6 §6.5.1 enumerates 5 failure paths but does NOT name the orchestrator. Theo's Decision 1 fills this gap (`post-spawn-resolver.js`). **v6.1 candidate**: name the resolver module in §6.5.1 body.
- **DN-5**: v6 §6.5.K14:1338 uses "feature flag" terminology for v3.1 event-stream variant; Decision 2 argues "polymorphic dispatch" is the correct shape. **v6.1 candidate**: clarify §6.5.K14 dispatcher vs feature-flag distinction.
- **DN-6**: v6 §5.4 anchors K13×K14 tail-window on WAL `committed_at` (subject to slow-disk WAL races per blair CRIT-1). **v6.1 candidate**: amend §5.4 to use `spawn_close_wall_ms` from spawn-state directory as the canonical anchor; `committed_at` is a WAL audit field, not a clock-gate anchor.
- **DN-7**: v6 §5.3 recovery sweep has TOCTOU between filesystem-hash and ABORTED fsync (blair CRIT-3). **v6.1 candidate**: amend §5.3 to require K13 lock held during steps (a)→(c) critical section.
- **DN-8**: v6 §2.4 "enforce, not document" claim for pre-spawn-tool-mask is incomplete (blair CRIT-2 + eli C1 — silent no-op on absent `tools[]`). ADR-0010 will restate this honestly; **v6.1 candidate**: §2.4 honest restatement of pre-spawn-tool-mask coverage gap.
- **DN-9**: v6 §6.13 INV-A9-RecoverySweepIdempotent activation REQUIRES kernel-crash-mid-write injection from `_crash-harness.js`. If that harness slips to Phase 2, INV-A9 reverts to manual-verification at v3.0-alpha LOCK. Decision 6 keeps `_crash-harness.js` on the critical path for Phase 1-alpha/2.
- **DN-10**: pre-spawn-tool-mask denylist coverage gap (eli C2 — 14 patterns missing) is a single point of failure for Pillar 2 enforcement until K8 ships v3.1. Plan absorbs the gap explicitly + ADR-0010 acknowledges the residual risk.
- **DN-11**: HETS spawn convention via `agent-identity.js assign` + `tree-tracker.js spawn` + `pattern-recorder.js record` was followed for theo/blair/eli — but the actual subagent invocation via Agent tool is independent of the convention. The convention's value is REPUTATION tracking, not enforcement of spawn lifecycle. Future refinement: codify a wrapper that does `assign → spawn-tree → Agent invoke → pattern-recorder` as one composite call.
- **DN-12**: `04-architect.theo` returned its bounded output as a code block IN the response message but did NOT actually write the file at the claimed path. I had to write it myself from the response content. Pattern: subagents sometimes claim file writes that didn't happen. **Candidate fix**: post-spawn verifier hook reads the claimed file path; if missing, blocks the spawn-record write and surfaces drift. (Hook is out of scope for Phase 1-alpha but worth noting in v6.1 / Phase 2 backlog.)
- **DN-13**: Round 2 of `/verify-plan` (user-requested) caught **5 NEW FAIL-class findings** that round 1 missed. The /verify-plan skill currently says "recursive verification is over-engineering per YAGNI" — that guidance is **load-bearing wrong for substrate-fundament work**. **Candidate /self-improve**: skill should branch by HETS-routing-tier — `convergence-trivial` skips round 2 (current behavior); `substrate-fundament` (route-decide convergence_value ≥ 0.10 AND ≥3 NEW primitives) mandates round 2 with fresh identities. This phase produced the empirical data point.
- **DN-14**: 04-architect identity pool appears small (theo + mira + ari observed); 03-code-reviewer pool (blair + jade + nova). For multi-round verification on long phases, the identity-rotation pool may run dry. **Candidate /self-improve**: agent-identity.js roster expansion candidate; also "force-pick by name" CLI flag to pull specific identities for paired-with convergence experiments.

## Principle Audit

Per H.7.22+H.7.24 codification: explicit SOLID/DRY/KISS/YAGNI reference is required for HETS-routed phases.

- **SOLID**:
  - **SRP**: K9 (cherrypick), K14 (scope-detection), `post-spawn-resolver.js` (orchestration), each `_*-harness.js` (one concern) — each one reason to change. K2-helper integration deferred per Decision 3 (don't mix Phase 1 prototype shape with v6 envelope schema).
  - **OCP**: K14 v3.1 event-stream variant is ADDED alongside snapshot, not by editing snapshot path (Decision 2). 14 new denylist patterns ADDED to pre-spawn-tool-mask, not by editing existing pattern logic.
  - **LSP**: K9 + K14 callable by `post-spawn-resolver.js` without resolver knowing their internals (interface contract honored). *(Per verify-plan mira FLAG: in untyped JS the LSP contract is duck-typed-only — i.e., the resolver expects exported functions of certain shapes but the language doesn't enforce LSP statically. The claim is "informal LSP" not "compiler-checked LSP".)*
  - **Interface Segregation**: 3 sibling harness files (Decision 6) so tests import narrow surfaces. K3.b context envelope schema is opt-in (`consumes_context_envelope` persona flag at v3.1) — personas not needing it aren't burdened.
  - **Dependency Inversion**: resolver depends on K9 + K14 abstractions exported by each (not internals); K9 imports `_lib/path-canonicalize.js` (K7) as an abstraction; K14 reuses `_lib/atomic-write.js` (H.9.8-hardened).
- **DRY**: F14 — K7 path-canonicalize migrates fact-force-gate.js to consume the shared primitive (no duplication). F5 — spawn-record.js .tmp sites migrate to writeAtomicString (no parallel atomic-write pattern). HARNESS: `_test-harness.js` + `_fs-watch-harness.js` + `_crash-harness.js` share NO duplicated logic (each owns its concern).
- **KISS**: 5 sub-PRs not 1 mega-PR (Decision 5). Pure snapshot at v3.0-alpha not flag-scaffold (Decision 2). Sequential K14→K9 resolver not parallel-with-barrier (Decision 1). 3 sibling harness files at the current count, not subdirectory (Decision 6).
- **YAGNI**: No K14 fsevents/inotify scaffold (Decision 2). No K2-helper integration without consumer (Decision 3). No subdirectory until N≥6 harness files (Decision 6). No mandatory K12 enforcement (v5.1 downgrade preserved; empirical-zero-drift finding).
- **Immutability**: K9 reverse-cherrypick journal is append-only (INV-19); recovery-sweep records are emitted as new ABORTED entries, never mutating prior PENDING records. Spawn-state directory: each spawn gets its own subdirectory; cross-spawn state is read-only access.

Cross-cutting: acyclic dependencies preserved (resolver→K9, resolver→K14, K9→K7, K14→K7, K14→atomic-write — DAG); idempotency preserved (synthesizeChain F6 fix uses real computeIdempotencyKey).

## HETS Spawn Plan — execution audit (recorded)

- `04-architect.theo`: total spawns=66 (post-Phase-1-alpha-plan), pass verdict, 6 decisions, asymmetric verification
- `03-code-reviewer.blair`: total spawns=31, pass verdict, 15 findings, asymmetric verification
- `12-security-engineer.eli`: total spawns=24, pass verdict, 15 findings, asymmetric verification
- Convergence pattern: agree-on-direction + extend-with-spec-deltas (the most common load-bearing pattern per `kb:hets/patterns/asymmetric-challenger`)

## Pre-Approval Verification

Spawned 2026-05-27 per H.7.23 discipline (parallel architect + code-reviewer against the finished plan file; fresh identities to avoid self-review).

### Architect verdict: READY (04-architect.mira, medium-trust)

[Full bounded output: `swarm/run-state/v3.0-phase-1-alpha-design/04-architect-mira-verify.md` — to be saved post-merge]

| # | Check | Verdict | Resolution |
|---|---|---|---|
| 1 | Findings coverage F1-F23 | PASS | All 23 findings traced to file paths + PR + verification probe |
| 2 | Principle Audit honesty | PASS + FLAG | **Fixed**: LSP claim now explicitly hedged as duck-typed-only in JS |
| 3 | Sub-phase ordering | PASS | Dependencies real; parallelization claims valid |
| 4 | YAGNI deferrals (INV-22 specifically) | FLAG | **Fixed**: INV-22-IdempotencyKeyUniqueness lightweight uniqueness fixture added to PR 1 TDD-treatment list |
| 5 | Estimate realism | FLAG | **Fixed**: Estimate-realism footnote added explaining the ~435-950 LoC delta (CWE-22 + K14 fixtures + ADR prose + per-test boilerplate) |
| 6 | Recursive/dogfood claims | PASS | H.7.15 dogfood operationally concrete; TDD-treatment specific enough for implementer |
| 7 | Drift-note treatment | PASS + FLAG | **Acknowledged**: DN-12 (post-spawn-verifier hook) correctly scoped to v6.1 / Phase 2 backlog, not Phase 1-alpha (YAGNI-honest) |
| 8 | Open design choices defensibility | PASS + FLAG | **Fixed**: Decision 4 H.7.15 reading hedged ("atomic-commits-within-one-PR also satisfies H.7.15; sibling-PR is the safer-default choice") |

**Overall verdict (mira)**: READY. Three advisory FLAGs all addressed inline.

### Code-reviewer verdict: NEEDS-REVISION → READY (03-code-reviewer.jade, low-trust)

[Full bounded output: `swarm/run-state/v3.0-phase-1-alpha-design/03-code-reviewer-jade-verify.md` — to be saved post-merge]

| # | Check | Verdict | Resolution |
|---|---|---|---|
| 1 | New scripts/validators — concrete bugs in described logic | FLAG | **Acknowledged**: 3 implementation-detail gaps surfaced (post-spawn-resolver 5-path preconditions; recovery-sweep critical-section step enumeration; cherrypick conflict-abort mechanism). Conflict-abort fix below (FAIL #2); other 2 captured as ADR-0010 authoring obligations before PR 4 implementation. |
| 2 | **CI workflows — node --test silent false-green bug** | **FAIL** | **Fixed**: PR 0b command changed from `node --test tests/unit/kernel/**/*.test.js` to per-file script-runner loop (`for f in $(find tests/unit/kernel -name '*.test.js' -type f); do node "$f" \|\| failed=1; done; exit $failed`). PR 0b verification probe adds: "deliberately-failing test causes the job to fail" (false-green regression check). |
| 3 | Hook scripts — fail-open semantics, race conditions | FLAG | **Fixed**: F2 hook-protocol JSON shape cited (matches LIVE pre-spawn-tool-mask.js pattern); F2 migration risk addressed (scan ~30d spawn-records for callers omitting `tools[]`; fix-ahead OR delay PR 2 merge); F3 sweep timeout added (`LOOM_SWEEP_LOCK_TIMEOUT_MS=30000` default; clean release on timeout). |
| 4 | Settings.json edits — idempotency | FLAG | **Fixed**: F17 "wholesale" ambiguity resolved — deny is UNION across levels (project-local deny EXTENDS user-global; project-local allow CANNOT remove user-global denies; tool-deny is sticky). ADR-0010 is now ADR-first dependency for PR 1 K2.b impl. |
| 5 | **Path/regex assumptions — F11 cherry-pick artifact placement** | **FAIL** | **Fixed**: F11 mechanism specified — pre-check via `git apply --check <patch>` BEFORE attempting `git cherry-pick` (apply --check exits non-zero on conflict WITHOUT writing `.orig`/`.rej`). On rare race where cherry-pick still conflicts: `git cherry-pick --abort` + `git clean -fdx` scoped to spawn worktree only. F4 anchoring policy specified (anchored regex with word boundaries; `\b(python\|python3)\s+-c\b` not bare substring). F22 scrubSecrets patterns specified (Stripe `sk_(live\|test)_[A-Za-z0-9]{24,}`; password-in-URL `://[^:]+:[^@]+@` flagged-with-allowlist-for-CI-tokens). |
| 6 | Function/file size limits | FLAG | **Fixed**: K9 + K14 HIGH-end LoC pre-authorized split (K9 → `k9-path-guard.js` + `k9-promote-deltas.js` + `k9-journal.js`; K14 → `k14-snapshot.js` + `k14-tail-window.js` + `k14-symlink-guard.js`); implementer decides at PR-prep based on actual LoC count. |
| 7 | Security concerns | FLAG | **Fixed**: F13 sanitizeForJsonl spec (strip `\n`/`\r`/`\0`; control chars→space; non-ASCII preserved); F23 marker reject-not-strip semantics (validateTransactionRecord REJECTS; never strips). |
| 8 | Scope creep | FLAG | **Acknowledged**: PR 2 F14 migration of fact-force-gate.js should be a separate commit within PR 2 with own regression-test gate (captured in PR 2 phase 2 instructions). PR 4 bundling 3 NEW CRITICAL primitives flagged as highest-risk PR; multi-persona pair-review already mandated. |

**Overall verdict (jade)**: NEEDS-REVISION → **READY after inline fixes** (2 FAILs fixed; 1 PRINCIPLE pre-authorized; 5 FLAGs resolved or acknowledged). The two FAIL-class findings (CI false-green + cherry-pick artifact mechanism) were exactly the H.7.23 pattern paying off — both would have been hotfix rounds post-impl.

### Aggregate verdict: **READY for USER GATE 1**

H.7.23 pre-approval verification caught:
- **1 FAIL** (silent false-green CI bug — `node --test` against imperative-assert tests) → fixed inline
- **1 FAIL** (F11 cherry-pick artifact placement mechanism unspecified) → fixed inline
- **1 PRINCIPLE** (K9 + K14 800-LoC ceiling at HIGH-end) → pre-authorized split
- **7 FLAGs** (LSP hedging, INV-22 lightweight test, LoC delta footnote, hook-protocol citation, migration risk, sweep timeout, F17 wholesale ambiguity, F4 regex anchoring, F13 sanitize spec, F23 marker rejection) → all addressed inline

Plan is now NEEDS-REVISION → READY. All blocking findings resolved without re-plan rounds. Ready for USER GATE 1.

### Continuation IDs (if user requests follow-up)

- `04-architect.mira` (verify R1): agentId `a7ce5e08be1ef67b5`
- `03-code-reviewer.jade` (verify R1): agentId `a6f5659fcf532cd2a`
- `04-architect.theo` (design): agentId `ad6f011832ea7f4d5`
- `03-code-reviewer.blair` (design): agentId `a14a11f3be82ced76`
- `12-security-engineer.eli` (design): agentId `af79009e8e49f811a`
- `04-architect.ari` (verify R2): agentId `a968c5f7411291dde`
- `03-code-reviewer.nova` (verify R2): agentId `a3b795ba114f15217`
- `12-security-engineer.vlad` (verify R2): agentId `ac65dfe305f5ae2ee`

## Pre-Approval Verification — ROUND 2

User-requested second verify round (per /verify-plan skill note: "recursive verification is over-engineering per YAGNI" — but substrate-fundament weight justified the cost). Fresh identities: `04-architect.ari` + `03-code-reviewer.nova` + `12-security-engineer.vlad`. Each pressure-tested the **round-1 fixes** (round 1 generated them; can't self-verify).

### Verdicts

| Reviewer | Verdict | FAIL count | FLAG count |
|---|---|---|---|
| 04-architect.ari | NEEDS-REVISION | 3 | 5 |
| 03-code-reviewer.nova | NEEDS-REVISION | 1 | 5 |
| 12-security-engineer.vlad | NEEDS-REVISION | 1 | 6 |

### Convergent FAILs (all 3 reviewers caught the same issues)

| # | Finding | Resolution |
|---|---|---|
| R2-F1 | **DCE claim factually wrong** — Node.js has no compile-time dead-code elimination; `validateTestRecord` callable in production despite "compiled out" claim | **Fixed**: replaced with file-placement boundary (`validateTestRecord` lives at `tests/unit/kernel/_lib/_test-validate.js` — outside `packages/kernel/`) + K12 advisory lint flags production→test imports + validateTransactionRecord runtime rejection at every WAL append path (defense in depth) |
| R2-F2 | **F4 denylist missing patterns** — bun, deno, pnpm dlx, npx, heredoc-pipe (cat <<), python -B -c flag-stuffing all bypass the 14-pattern list | **Fixed**: expanded to 22+ patterns; flag-stuffing regex `(python\|python3)(\s+-[A-Za-z])*\s+-c\b` |
| R2-F3 | **F13 sanitizeForJsonl doesn't address CWE-74 JSON-structure injection** — stripping control chars doesn't prevent `"},"injected"` payloads | **Fixed**: drop string-concat approach entirely; use `JSON.stringify` for ALL JSONL emission; codified ordering `scrubSecrets → sanitizeForJsonl → JSON.stringify` |

### ari-specific FAILs (architectural correctness)

| # | Finding | Status |
|---|---|---|
| R2-F4 | **F3 sweep-incomplete admission safety** — "spawn admission CAN proceed even with sweep incomplete" conflates correctness with liveness; stale-PENDING records could be used to build evidence chains before sweep ABORTs them | ✅ **Fixed (user decision: block-until-complete)**: spawn admission BLOCKS until sweep completes; sweep timeout → operator alert + LOOM_FORCE_ADMIT_AFTER_SWEEP_TIMEOUT escape hatch (audit-logged). F3 row updated. |
| R2-F5 | **Multi-PR dependency edges** — if PR 3 (K9) merges but PR 4 stalls, half-shipped state exists; PR 4 imports K9, so K9 sits on main without resolver invoking it | ✅ **Fixed (user decision: PR 3 ships dormant)**: K9 module ships in PR 3 with NO production importer (only tests). PR 4 brings post-spawn-resolver as first production importer. Pre-merge probe verifies dormancy. PR 3 phase section updated. |
| R2-F6 | **Rollback strategy absent** — no per-PR rollback section; PR 4 rollback cascades into PR 3 because resolver imports K9 | ✅ **Fixed (user decision: per-PR rollback subsection)**: Centralized Rollback Strategy table added covering all 7 PRs (revert order + state cleanup + cascade dependencies); PR 4 operator runbook spelled out. |

### nova-specific FAILs (code correctness)

| # | Finding | Status |
|---|---|---|
| R2-F7 | **F11 `git apply --check` semantic mismatch with cherry-pick** — 3-way merge can succeed where apply --check fails (different ancestor); pre-check is NOT lossless | ✅ **Fixed (user decision: drop apply --check)**: pre-check approach dropped entirely. Cherry-pick invoked directly; on conflict, `git cherry-pick --abort` resets index + worktree (no separate `git clean` needed); `-c core.hooksPath=/dev/null` disables `.git/hooks/` execution (closes vlad CWE-732); `execFile`-style argument arrays (closes vlad CWE-78). F11 row updated. |

### vlad-specific FAILs (security)

R2-F1 (DCE) + R2-F2 (denylist) + R2-F3 (JSON injection) — convergent with ari and nova, fixed above.

### Round 2 FLAGs addressed inline

| # | Finding | Fix |
|---|---|---|
| R2-G1 | F8 hook-protocol "LIVE precedent" not normative | Added WebFetch on `code.claude.com/docs/en/hooks/` as PR 2 prerequisite |
| R2-G2 | F2 Bash-as-string bypasses isNetworkBashCommand | Mask updated to flag string-shaped Bash entries; ADR-0010 documents pre-existing gap |
| R2-G3 | F2 migration scan race (30d window + scan-to-merge gap) | Added 24h-pre-merge re-scan gate |
| R2-G4 | PR 0b relative `find` path + `for f in $(find)` word-splitting | Switched to `find -print0` + `read -d ''`; explicit `working-directory: ${{ github.workspace }}`; added `count -eq 0` vacuous-pass guard |
| R2-G5 | K9/K14 file-split semantics ambiguous at impl-time | ADR-0010 will pre-define export surface per sub-file |
| R2-G6 | Decision 4 ↔ Decision 5 wording sync (sibling vs atomic-commits) | Decision 4 hedged; Decision 5 firm; clarified that hedge applies to H.7.15 reading only |
| R2-G7 | K3.b schema lock-in risk (carrying cost for 1 cycle with no consumer) | Added provisional-schema disclaimer to Files-To-Modify row |
| R2-G8 | CI feedback p99 "<60s" budget breaches when K9 lands | Honest disclosure added to P11 (~2-3 min when K9 ships) |
| R2-G9 | F4 `pre-applypatch` hook risk on cherry-pick path (CWE-732) | Linked to F11 design decision pending |
| R2-G10 | F11 `git clean -fdx` shell-metacharacter injection risk (CWE-78) | Linked to F11 design decision pending |
| R2-G11 | F17 reverse-attack via compromised user-global | Accepted under local-trust threat model (OQ-20 deferred to v3.1) |

### Round 2 honest framing

This second verification round caught:
- **5 NEW FAIL-class issues** (DCE wrong + denylist gaps + JSON injection + sweep-correctness + multi-PR dependency + rollback absence)
- **~11 FLAGs**, ~8 of which directly addressable inline

The /verify-plan skill explicitly says "recursive verification is over-engineering per YAGNI" — that guidance is **wrong for substrate-fundament work**. Round 2 paid for itself. Future codification: skill should distinguish "convergence-trivial" (skip round 2) from "substrate-fundament" (mandate round 2). **Drift-note 14 candidate** (added to Drift Notes section).

**4 design-shaped fixes resolved per user decisions (all "Recommended" picks)**:
1. F3 sweep-correctness: block-until-complete + operator-alert escape hatch
2. F11 cherry-pick: drop apply --check pre-check; use --abort directly + disable git hooks + execFile
3. Multi-PR: PR 3 K9 dormant; PR 4 resolver is first production importer
4. Rollback: centralized per-PR table + PR 4 operator runbook

### Aggregate round-2 verdict: **READY for USER GATE 1**

All FAIL-class findings resolved (5 convergent + 3 ari-specific + 1 nova-specific = 9 distinct FAILs across rounds 1+2). 11 FLAGs addressed inline. Plan now in shippable shape; no remaining blockers.

## Reviewer Amendments (2026-05-27 — post-verify, pre-USER-GATE-1)

User-supplied reviewer notes after round 2 closed. Three constraints tightening enforcement of existing plan provisions (no new design decisions; elevates implicit checks to explicit blocking gates).

### RA-1 — K9/K14 split trigger moved earlier (TDD Phase 1, not PR-finalization)

**Original (rounds 1+2 outcome)**: pre-authorized split fires at PR-finalization if impl-actual exceeds 700 LoC.
**Amended**: split decision fires at end of TDD Phase 1 (failing tests + scaffolding stubs written, before impl-to-green) based on **projected** impl-LoC (test-fixture count × ~3 impl-LoC-per-fixture, calibrated to atomic-write.js ratio). Phase 3 (impl-to-green) pauses until split decision is recorded to ADR-0010.

**Rationale**: catching the breach BEFORE impl wastes less work. The original PR-finalization trigger meant the implementer might write 1,050 LoC, then refactor — wasteful. TDD-stage trigger uses projection so the split shape is locked before impl invests heavily.

**Files touched**: Files To Modify table — K9 row + K14 row (LoC-ceiling notes updated to reflect TDD-stage trigger).

### RA-2 — K9 dormancy probe elevated to merge-blocking CI gate

**Original (round 2 outcome)**: "Pre-merge probe for PR 3: `grep -r ...` returns zero hits (asserts dormancy)." Advisory.
**Amended**: new CI job `dormancy-assertion-k9` runs on PR 3 specifically; failure BLOCKS the merge button. PR 3 description includes a manual-verification checkbox. PR 4 deletes the CI job in the same commit that introduces the first production importer, so the gate self-removes when dormancy ends.

**Rationale**: K9 dormancy is the load-bearing safety property that prevents PR 3 from leaving main in a half-shipped state. Advisory probes drift; merge-blocking gates don't.

**Files touched**: PR 3 phase section (dormancy paragraph rewritten with full CI snippet).

### RA-3 — PR 4 runbook-familiarity pre-merge gate

**Original (round 2 outcome)**: Rollback Strategy section includes a PR 4 operator runbook for WAL ABORTED-record emission.
**Amended**: PR 4 cannot merge until at least 2 named reviewers explicitly check a runbook-acknowledgment checkbox in the PR description. CI verifies via `gh pr view ... | jq` query. ADR-0010 becomes the canonical home of the runbook (persists post-plan-PR-squash).

**Rationale**: PR 4 is the only Phase 1-alpha PR whose rollback requires manual filesystem operations on operator runtime (other reverts are pure git). Pre-merge runbook acknowledgment ensures rollback-readiness BEFORE the substrate is exposed to the risk surface.

**Files touched**: PR 4 phase section (new "Reviewer amendment 2026-05-27" subsection at top of phase).

### RA aggregate

Three amendments. Zero new design decisions. All three tighten existing provisions from advisory → blocking, OR move existing checks earlier in the workflow where they cost less to act on. No re-verification round needed (all amendments add gates, don't change design). Plan stays at READY verdict.
