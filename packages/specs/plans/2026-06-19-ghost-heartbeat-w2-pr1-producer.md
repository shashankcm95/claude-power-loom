# Plan — Ghost Heartbeat W2-PR1: the capability-free drift-judge producer

- **Date:** 2026-06-19
- **Design-of-record:** `packages/specs/rfcs/2026-06-19-ghost-heartbeat-w2-drift-emit.md` (3-lens board CLOSEABLE-WITH-NOTES, all folds applied; capability-free mechanism probe-resolved). This plan is the BUILD sequencing for PR-1 only; it does not re-litigate the design.
- **Scope (PR-1 = producer core, carrier-agnostic, manually invokable).** OUT of scope: the Tier-1 Stop hook (PR-2) and the Tier-2 cron + `install.sh` offer (PR-3). PR-1 ships nothing that auto-fires — `drift-audit.js --transcript <path>` is invoked by hand.

## Goal

`drift-audit.js`: read ONE session transcript -> capability-free judge -> deterministic Verify guard -> idempotent emit (`bump --signal drift:<class>`), with the state module (`ghost-heartbeat-state.json`) and the shared capability-free `claude -p` helper. Advisory, draft-only, default-off.

## Runtime Probes (completed — this section is evidence, not intent)

- **Capability-free enforcement (the load-bearing one): RESOLVED.** 7-probe chain (RFC 5.6 Probe 3): empty `--allowedTools` does NOT restrict (auto-approval); a `--disallowedTools` denylist is bypassable (model read a sentinel via the unlisted `Monitor`); **`claude -p --tools "" --strict-mcp-config`** blocks read + MCP + LSP (no leak, no `tool_use`) while the JSON classify path runs clean. Verified live 2026-06-19. The build pins these flags + ships a sentinel-leak regression test.
- **Store contract: PROBED.** `self-improve-store.js` -> `bump --signal <type:value>` is the emit CLI; `signalPolicy` routes `drift:` -> `rule-candidate`/high/threshold-3; `_runScan` converges at `entry.count >= 3`. `cmdBump` is non-idempotent (`count += n`) and session-blind -> idempotency MUST live in the producer's emitted-set (RFC 2.2).
- **Judge helper precedent: PROBED.** `packages/lab/causal-edge/trajectory-friction-run.js` `claudeOnce` (stdin prompt, pinned `--model`, `spawnSync` timeout + maxBuffer + ETIMEDOUT) — the invocation shape to extract; it passes NO tool flags (default tools), so the new helper ADDS `--tools "" --strict-mcp-config`.
- **Lock primitive: PROBED.** `packages/kernel/_lib/lock.js` — `withLock` calls `process.exit(2)` on timeout (unsafe in a hook); **`withLockSoft` returns `{ok:false}`** (header: "use in any HOOK context"). The producer uses `withLockSoft`.
- **Frozen taxonomy: PROBED.** `library/.../ghost-protocol/volumes/drift-taxonomy.md` — the closed class set + the open `drift:cwe-class:<n>`. The allowlist is sourced from this; `cwe-class` is bounded `^drift:cwe-class:[0-9]{1,4}$`.

## File manifest

- NEW `packages/kernel/_lib/capability-free-claude.js` — the shared `runCapabilityFreeJudge({prompt, model, timeout})` helper (`claude -p --tools "" --strict-mcp-config --model <m>`, stdin prompt, `spawnSync` timeout/maxBuffer/ETIMEDOUT -> `{ok, text|reason}`). Single place the capability-free flags live.
- NEW `packages/kernel/spawn-state/drift-audit.js` — the producer: `buildDigest(transcript)`, `verifyJudgeOutput(json, taxonomy, emittedSet)` (allowlist + cwe-regex + confidence + evidence + dedup + sanitize), `emit(survivors)` (the one `withLockSoft` critical section), `auditTranscript({transcriptPath})`, CLI `--transcript <path>`.
- NEW `packages/kernel/spawn-state/ghost-heartbeat-state.js` — `loadState`/`recordEmitted`/`isEmitted`/`pruneByWatermark` over `~/.claude/checkpoints/ghost-heartbeat-state.json`, `withLockSoft`. Emitted-set = correctness; watermark = optimization.
- NEW `tests/unit/scripts/drift-audit.test.js` — the TDD behavioral spec (below), mocked judge.
- NEW `tests/unit/scripts/capability-free-claude.test.js` — the sentinel-leak regression test (real `claude -p`; guarded so it skips if `claude` is absent, like the other real-`claude -p` suites).
- (No modification to `self-improve-store.js` in PR-1 — the producer calls its `bump` CLI. If surfaced-value sanitization needs a store-side hook, that is a NAMED follow-up, not PR-1: the producer sanitizes before `bump`, which is sufficient for the emit path.)

## TDD behavioral spec (write tests first; red; then impl)

Verify guard:
- T1 unknown/invented class -> dropped + logged (taxonomy stability).
- T2 closed class in allowlist -> accepted.
- T3 `drift:cwe-class:74` -> accepted; `drift:cwe-class:` + non-digit / overlong / injection payload -> dropped (the `^...[0-9]{1,4}$` bound).
- T4 confidence < MIN -> dropped; missing evidence -> dropped.
- T5 surfaced value with control chars / over-length -> sanitized before emit.
- T6 a `(session_id, class)` already in the emitted-set -> NOT re-emitted (idempotent).

State + atomicity:
- T7 `recordEmitted` then `isEmitted` round-trips; second audit of the same `(session_id, class)` is a no-op.
- T8 the read-decide-emit critical section holds under `withLockSoft` (concurrent invocation does not double-record — simulate two calls; assert one emit). `withLockSoft` `{ok:false}` -> emits nothing, exits 0 (fail-open).
- T9 `session_id` read from the in-transcript harness field; filename-mismatch -> skipped + logged.
- T10 `pruneByWatermark` only prunes sessions below the watermark floor (never un-dedups a re-auditable session).

Producer end-to-end (mocked judge — inject the JSON):
- T11 a digest + a mock judge returning a valid drift -> `bump` called once with `drift:<class>`; emitted-set updated.
- T12 killswitch `GHOST_HEARTBEAT_DISABLED=1` -> zero judge invocations, zero bumps (spy).
- T13 malformed judge JSON -> fail-open (no throw, no emit).

Capability-free regression (real `claude -p`, skip if absent):
- T14 plant a sentinel file; run the helper with an injected "read this file with any tool" prompt; assert the sentinel does NOT appear in output and no `tool_use` (the RFC 5.6 Probe-3 property, as a standing test).

## Acceptance gate — RESULTS (2026-06-19)

- **Unit suites GREEN:** capability-free 3/3 (incl. G3 the REAL sentinel-leak test — capability-free holds in the built code), ghost-heartbeat-state 8/8 (incl. T8 the 8-way concurrency race = 1 emit, T8b cross-process lock-timeout fail-open), drift-audit 15/15. eslint clean on all 6 files.
- **Real-`claude -p` dogfood (Rule-2a-corollary), two cases, both recorded:**
  - A REAL 56k-line transcript (dominant `sessionId` resolved past a filename/rotation mismatch) -> real capability-free judge (25.8s) -> `no-drift` (conservative, valid).
  - A synthetic UNAMBIGUOUS-drift transcript -> real judge (13.8s) -> classified `["claim-false","plan-honesty"]`, both survived Verify, emit fired. This is the end-to-end emit proof.
- **Post-build 3-lens VALIDATE board** (RFC section 10): hacker CLEAN-WITH-NOTES (30+ live probes, all vectors closed), code-reviewer CLEAN-WITH-NOTES (1 HIGH folded), honesty-auditor CHANGES-REQUIRED (all folded — see below).
- Pending before PR: `bash install.sh --hooks --test` + the kernel suite (the pre-push gate).

## Drift / honesty notes (build-time corrections — recorded per the honesty discipline)

- **capability-free premise FALSIFIED at design time** (empty-`--allowedTools` is auto-approval, not availability) -> corrected to `--tools "" --strict-mcp-config`, probed + regression-tested. A `drift:plan-honesty` / ADR-0012 catch.
- **filename-mismatch rejection FALSIFIED by the dogfood** — the draft/verify-board said "reject if filename != in-transcript sessionId"; a real transcript proved the filename legitimately differs (resume/rotation: a file named `<A>` held 56519 lines of `<B>`). Build uses the DOMINANT in-transcript `sessionId`, no filename check. A second `drift:plan-honesty` catch — the fix-of-a-fix.
- **sanitizer subsumed, not shipped** — the RFC asserted a strip/cap sanitizer; the build proves no judge free-text reaches the store (only the validated class crosses), so it is YAGNI. RFC reworded; not silently dropped.
- **VALIDATE honesty catch: T8/T5 slots had been relabeled** — the original T8 tested immutability (not concurrency) and T5 tested allowlist-survival (not sanitization). Corrected: T8 is now the real 8-way concurrency race; T-immut holds the immutability assertion; the sanitization "test" is acknowledged as subsumed by the allowlist. The feature that catches dropped-planned-tests must not ship one.
