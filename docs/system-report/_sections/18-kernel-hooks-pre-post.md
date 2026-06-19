# Kernel hooks: pre/post tool-use gates + hooks/_lib — `packages/kernel/hooks/{pre,post,_lib}`

> This cluster is the **enforced kernel layer**: the deterministic `PreToolUse` / `PostToolUse` hook scripts Claude Code invokes around every tool call, plus the shared `_lib/` primitives they import. The pre-hooks gate behavior *before* a tool runs (block a protected-config Edit, force a Read-before-Edit, deny `EnterPlanMode` in headless, block `ExitPlanMode` without verification, mutate an Agent spawn prompt, consult `route-decide`); the post-hooks observe *after* a tool ran (consolidate repeated Bash failures, audit KB-citation compliance, reconcile the library catalog, run the SHADOW spawn-close resolver). All hooks follow the **ADR-0001 fail-soft contract** — any error path must approve / exit 0 so a hook crash never bricks a session. The `_lib/` modules (`_log`, `file-path-pattern`, `marketplace-state-reader`, `settings-reader`) are DRY shared helpers consumed across the whole `hooks/` tree and beyond. Critically, several of these hooks are *advisory* despite emitting `decision: block` — the harness does not propagate every block — and one (`contract-reminder-on-agent-spawn`) is built on a mechanism (`updatedInput` on Agent spawns) that ADR-0012 empirically proved **inert**.

## Directory contents & nesting

| Folder | File | One-line purpose |
|---|---|---|
| `hooks/pre/` | `config-guard.js` | `PreToolUse:Edit\|Write` — block edits to linter/formatter/build/test config files |
| `hooks/pre/` | `contract-reminder-on-agent-spawn.js` | `PreToolUse:Agent\|Task` — prepend a `[CONTRACT-REMINDER]` block to a sub-agent's prompt via `updatedInput` |
| `hooks/pre/` | `fact-force-gate.js` | `PreToolUse:Read\|Edit\|Write` — block Edit of a file not Read first this session (read-tracker) |
| `hooks/pre/` | `redirect-plan-mode-in-headless.js` | `PreToolUse:EnterPlanMode` — deny plan mode in headless `claude -p`, redirect to TodoWrite |
| `hooks/pre/` | `route-decide-on-agent-spawn.js` | `PreToolUse:Agent\|Task` — auto-invoke `route-decide.js`, log the verdict, always approve |
| `hooks/pre/` | `verify-plan-gate.js` | `PreToolUse:ExitPlanMode` — block exit if HETS-routed plan lacks `## Pre-Approval Verification` |
| `hooks/post/` | `catalog-reconcile-write.js` | `PostToolUse:Write\|Edit` — upsert library `_catalog.json` when a model writes a volume |
| `hooks/post/` | `error-critic.js` | `PostToolUse:Bash` — Critic→Refiner: emit `[FAILURE-REPEATED]` after 2+ same-command failures |
| `hooks/post/` | `kb-citation-gate.js` | `PostToolUse:Agent\|Task` — audit architect KB-citation compliance; log + advisory block |
| `hooks/post/` | `spawn-close-resolver.js` | `PostToolUse:Agent\|Task` — SHADOW spawn-close resolver: observe worktree, journal a would-be verdict |
| `hooks/_lib/` | `_log.js` | Shared append-only JSONL logger with 5MB rotation + env-var redirect |
| `hooks/_lib/` | `file-path-pattern.js` | Shared file-path extractor with substrate-internal deny-list filter |
| `hooks/_lib/` | `marketplace-state-reader.js` | Read local marketplace mirror clone HEAD age (no network) |
| `hooks/_lib/` | `settings-reader.js` | Read `~/.claude/settings.json`; plugin-enabled + registered-marketplace checks |

Nesting note: `_lib/` is the SHARED-primitives subfolder for the `hooks/` tree only (relative-require, no `findToolkitRoot()` dependency); the deeper kernel `_lib/` at `packages/kernel/_lib/` (`atomic-write`, `path-canonicalize`, `safe-resolve`, `lock`, `record-store`, `transaction-record`, `wal-append`) is a SEPARATE shared library reached via cross-tree `../../_lib/...` requires. There is no `_spike/` here. The `pre/` and `post/` split mirrors the Claude Code hook lifecycle: `pre/` hooks can deny (block); `post/` hooks cannot deny (the tool already ran) and at most emit advisory stdout.

## Per-file analysis

### `hooks/pre/config-guard.js`

- **Purpose** — `PreToolUse:Edit|Write` security gate that blocks edits to linter/formatter/build/test config files, forcing the agent to fix code rather than weaken the config.
- **Imports / consumes** — `fs`, `path`, `../_lib/_log.js` (`log`). Reads pattern file at `../config-guard-patterns.json` and `./config-guard-patterns.json`. Consumes stdin PreToolUse payload (`tool_input.file_path` / `tool_input.path`).
- **Consumers** — registered in `hooks.json` (`PreToolUse:Edit|Write`); pattern file shared with `validators/validate-config-redirect.js` (the Bash-redirect sibling). `eslint.config.js:26` documents that this hook protects it.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `loadPatterns` | internal | load + compile protected-path regexes from JSON, fall back to `FALLBACK_PATTERNS` | candidate JSON files; `parsed.patterns[]` | log events (`bad_pattern`, `patterns_loaded`, `patterns_fallback`) | compiles RegExp per pattern in its own try/catch (drops bad ones); returns compiled array or fallback |
| stdin `end` handler | hook-entry | parse payload, test path against `PROTECTED_PATTERNS`, emit decision | stdin JSON | stdout `{decision:'block'\|'approve'}`; log events | no disk mutation; emits block/approve decision |

- **File-level notes** — `PROTECTED_PATTERNS` is computed at MODULE LOAD (line 62), so a pattern-file change requires a new process (fine for a per-invocation hook). Uses the legacy `{decision:'block'}` shape (not `hookSpecificOutput.permissionDecision`) — consistent with `validate-config-redirect.js`. Fail-OPEN on parse error (`decision:'approve'`), correct for a discipline gate but note it means a malformed payload bypasses the guard. The double-wrap `(?:^|\\/)(?:${p})` in `loadPatterns` double-anchors patterns that may already carry their own `(?:^|/)` — harmless but redundant.

### `hooks/pre/contract-reminder-on-agent-spawn.js`

- **Purpose** — `PreToolUse:Agent|Task` hook that prepends a persona-specific `[CONTRACT-REMINDER]` block to the sub-agent's `prompt` via `hookSpecificOutput.updatedInput`, intending DETERMINISTIC contract enforcement (KB citations, Principle Audit, etc.).
- **Imports / consumes** — `fs`, `os`, `path`, `../_lib/_log.js`. Reads stdin payload (`tool_name`, `tool_input.subagent_type`/`subagent`/`type`, `tool_input.prompt`, `session_id`, `tool_use_id`). Writes a JSONL log at `~/.claude/checkpoints/contract-reminder-log.jsonl`.
- **Consumers** — `hooks.json` (`PreToolUse:Agent|Task`, second hook on that matcher). No JS importer (CLI hook entry).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `readStdin` | internal | read fd 0, parse JSON, fail-soft null | fd 0 | log events on read/parse fail | none |
| `emit` | internal | write a decision object + newline to stdout | decision object | stdout | none |
| `appendLog` | internal | append one JSONL record to the contract-reminder log | entry object | `contract-reminder-log.jsonl` | mkdir -p + appendFile (best-effort) |
| `main` | hook-entry | normalize subagent type, look up reminder, prepend to prompt, emit `updatedInput` | stdin payload; `CONTRACT_REMINDERS` map | stdout `hookSpecificOutput.updatedInput.prompt`; log file | appends a log line; emits a prompt-mutation that the harness IGNORES for Agent spawns (see Findings) |

- **File-level notes** — **The load-bearing premise of this entire file is FALSIFIED by ADR-0012**: a `PreToolUse` hook's `updatedInput` is **inert on Agent/Task spawns** (the sub-agent ran the ORIGINAL prompt in two `claude -p` probes; the Agent `tool_input` has no honored prompt-rewrite path). The header (lines 25-44) still presents `updatedInput.prompt` as achieving "deterministic compliance, no reliance on PostToolUse decision propagation." The hook fires and logs, but the prompt mutation never reaches the sub-agent — so the contract reminder is delivered only via the static `agents/<name>.md` definitions, not this hook. This is the same dead-mechanism class that retired `pre-spawn-tool-mask` (see `hooks.json:61` tombstone). Functionally the hook is now observability-only.

### `hooks/pre/fact-force-gate.js`

- **Purpose** — `PreToolUse:Read|Edit|Write` gate: blocks Edit of a file that was not Read (or Written) earlier in the session, defeating edits-from-memory. Maintains a per-session read-tracker on disk.
- **Imports / consumes** — `fs`, `path`, `os`, `crypto`, `../_lib/_log.js`, `../../_lib/atomic-write` (`writeAtomic`), `../../_lib/path-canonicalize` (`canonicalize`), `../../_lib/safe-resolve` (`currentUid`). Reads env `CLAUDE_SESSION_ID` / `CLAUDE_CONVERSATION_ID`; stdin payload (`tool_name`, `tool_input.file_path`/`path`, `session_id`). Reads/writes a tracker JSON under `os.tmpdir()/claude-loom-<uid>/claude-read-tracker-<key>.json`.
- **Consumers** — `hooks.json` (`PreToolUse:Read|Edit|Write`); `hooks/lifecycle/session-reset.js:25` imports `trackerDir` to clean the per-uid 0700 subdir at SessionStart.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `deriveSessionKey` | exported | sha256(session_id\|env\|ppid) sliced to 16 hex — path-safe tracker key | payload `session_id`/`sessionId`, env, `process.ppid` | none | pure |
| `isSafeTrackerDirStat` | exported | PURE policy: is an lstat result a safe owner-only tracker dir | `fs.Stats`, `selfUid` | none | pure (rejects symlink / non-dir / foreign-uid / group-other bits) |
| `trackerDir` | exported | resolve/establish per-uid 0700 subdir; fall back to flat base, NEVER throw | `base`, `currentUid()` | mkdir 0700; log `tracker_subdir_unsafe_fallback` | creates the 0700 dir; on unsafe/error returns flat root (logged) |
| `resolveTrackerPath` | exported | compose absolute tracker path | payload, base | none | pure path compose |
| `loadTracker` | exported | read + JSON.parse the tracker; fresh on any error | tracker file | none | returns `{files,sessionStart}` |
| `saveTracker` | exported | re-assert 0700 dir, atomic-write the tracker | tracker path + object | tracker file via `writeAtomic`; log `atomic_write_failed` | disk write (best-effort); fail-soft |
| `normalizePath` | exported | delegate to shared K7 `canonicalize` (symlink-resolving) | file path | none | pure |
| `handleEnd` | internal | parse payload, route by tool, record Read/Write, block unread Edit | stdin JSON | stdout decision; tracker file; log events | records reads/writes; emits block on unread Edit |
| stdin block | hook-entry | wire stdin -> `handleEnd` when `require.main` | fd 0 | — | — |

- **File-level notes** — Exemplary fail-open posture (the catch-all approves). The session-key resolution comment HONESTLY documents the concurrent-same-parent residual (over-approve, never false-block). Write satisfies fact-knowledge (records like Read). Two genuine TOCTOU residuals are conceded in-comment (same-uid container-tier, remove-then-symlink-plant). The `write_to_deleted_file` branch (line 293) is observability-only — it logs a possible rm-then-Write bypass but still approves. **Minor smell**: `fs.existsSync(filePath)` is called twice (lines 308) inside the approve log — a redundant stat. **`handleEnd` is ~96 lines** (lines 239-335), over the 50-line guideline, mostly due to the long inline rationale comment for the Write case.

### `hooks/pre/redirect-plan-mode-in-headless.js`

- **Purpose** — `PreToolUse:EnterPlanMode` hook that DENIES plan mode in headless (`claude -p`/`--print`) sessions and redirects the model to TodoWrite (the approval dialog hangs with no interactive user — GAP-G).
- **Imports / consumes** — `fs`, `os`, `path`, `child_process` (`execSync`), `../_lib/_log.js`. Reads env `CLAUDE_HEADLESS`; `process.ppid`; runs `ps -p <ppid> -o command=`. Writes `~/.claude/checkpoints/headless-plan-redirect-log.jsonl`.
- **Consumers** — `hooks.json` (`PreToolUse:EnterPlanMode`).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `detectHeadless` | internal | OR of two signals: parent cmdline `-p`/`--print` + non-auto `permission_mode` | env override, `ps` output, envelope | log `ps_check_failed` on error | spawns `ps` (1s timeout); pure result otherwise |
| `composeRedirect` | internal | build the `[HEADLESS-PLAN-MODE-DENIED]` forcing-instruction text | signals array | none | pure string |
| `appendObservability` | internal | append one JSONL record | record | redirect log file | mkdir -p + appendFile (best-effort) |
| stdin `end` handler | hook-entry | parse envelope, gate on `EnterPlanMode`, deny-with-redirect if headless | stdin JSON | stdout `hookSpecificOutput.permissionDecision:'deny'`; log | emits deny + observability record; fail-safe allow (empty stdout) on error |

- **File-level notes** — Uses the modern `hookSpecificOutput.permissionDecision:'deny'` + `permissionDecisionReason` shape (correct for a `PreToolUse` deny). Fail-SAFE: any error / undetermined => empty stdout => allow (lets interactive sessions through). The `ps` invocation is a per-invocation subprocess (1s timeout) — acceptable cost. The `permission_mode !== 'auto' && !== 'default'` heuristic admits a false-positive for interactive `bypassPermissions` runs (documented in-comment). `composeRedirect` text claims "12th forcing instruction" — a documentation cross-reference, not load-bearing.

### `hooks/pre/route-decide-on-agent-spawn.js`

- **Purpose** — `PreToolUse:Agent|Task` hook that auto-invokes `route-decide.js` with the spawn task, logs the verdict for the bench harness, and ALWAYS approves (consultation visibility, never blocks).
- **Imports / consumes** — `fs`, `os`, `path`, `child_process` (`spawnSync`), `../_lib/_log.js`, `../../_lib/safe-resolve` (`resolveExecCandidate`). Reads stdin payload (`tool_name`, `tool_input.description`/`prompt`/`subagent_type`, `session_id`, `tool_use_id`). Resolves + spawns `packages/kernel/algorithms/route-decide.js`. Writes `~/.claude/checkpoints/route-decide-log.jsonl`.
- **Consumers** — `hooks.json` (`PreToolUse:Agent|Task`, first hook on that matcher); `module.exports = { resolveRouteDecidePath }` (test surface).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `resolveRouteDecidePath` | exported | resolve route-decide.js across `__dirname`-relative + homedir-mirror candidates with exec-safety hardening | candidate paths via `resolveExecCandidate` | none | returns a safe path or null |
| `readStdin` | internal | read fd 0 + JSON parse, fail-soft null | fd 0 | log on fail | none |
| `emit` | internal | write decision + newline | decision | stdout | none |
| `appendLog` | internal | append one JSONL record | entry | route-decide log | mkdir -p + appendFile |
| `main` | hook-entry | extract task, spawn route-decide, parse verdict, log, approve | stdin; `spawnSync(process.execPath, [path, '--task', taskText])` | stdout `{decision:'approve'}`; log | spawns a child node process (5s timeout); always approves |

- **File-level notes** — Uses `process.execPath` (not bare `'node'`) for deterministic interpreter (CodeRabbit #290). B1 fix: resolves the script across plugin-install + legacy-mirror candidates (was a single hardcoded homedir path that left pure-plugin users inert). Truncates task to 4000 chars. Honestly fail-open: parse / spawn failure logs and approves. Cost note: synchronously spawns route-decide for EVERY Agent/Task spawn (5s budget) — acceptable but additive latency on the spawn path.

### `hooks/pre/verify-plan-gate.js`

- **Purpose** — `PreToolUse:ExitPlanMode` hook that BLOCKS exiting plan mode when the active plan file is HETS-routed but lacks a `## Pre-Approval Verification` section, redirecting the model to run `/verify-plan` first.
- **Imports / consumes** — `fs`, `path`, `os`, `../_lib/_log.js`. Reads env `CLAUDE_PLAN_DIR`, `SKIP_VERIFY_PLAN`. Reads the most-recently-modified `.md` under `PLAN_DIR` (default `~/.claude/plans`).
- **Consumers** — `hooks.json` (`PreToolUse:ExitPlanMode`). Mirrors `validators/validate-plan-schema.js` detection logic; referenced by `validate-adr-drift.js:15` (SKIP-bypass pattern precedent).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `requiresPrincipleAudit` | internal | detect HETS-routed plan (HETS Spawn Plan non-stub OR `recommendation:route`) | plan content | none | pure regex test |
| `hasH2Heading` | internal | memoized regex test for an H2 section heading | content, sectionName | none | mutates module-scope `_sectionRegexCache` (memoization) |
| `findActivePlan` | internal | newest `.md` in PLAN_DIR by mtime | dir listing + statSync | none | reads dir; returns `{name,path,mtime}` or null |
| `buildBlockReason` | internal | compose `[PRE-APPROVAL-VERIFICATION-NEEDED]` text | planPath | none | pure string |
| stdin `end` handler | hook-entry | gate ExitPlanMode, env-bypass, read plan, block if section missing | stdin; env; plan file | stdout `{decision:'block'\|'approve'}`; log | emits block/approve; reads disk; fail-open on error |

- **File-level notes** — `findActivePlan` uses **newest-mtime as a proxy for "the active plan"** — a real fragility: if the model is in plan mode for plan A but plan B was touched more recently (e.g., a concurrent edit, an unrelated `.md` write into `~/.claude/plans`), the gate inspects the WRONG file and either falsely blocks or falsely approves. Documented intent but a genuine correctness gap. `SKIP_VERIFY_PLAN=1` is a session-wide bypass (user authority, intentional). Detection logic is intentionally DUPLICATED from `validate-plan-schema.js` to keep two enforcement points in lockstep — a deliberate DRY exception (the comment says "kept consistent"), but a real drift risk if one changes without the other.

### `hooks/post/catalog-reconcile-write.js`

- **Purpose** — `PostToolUse:Write|Edit` hook that keeps the library `_catalog.json` current when the model writes a volume file directly into a stack's `volumes/` dir (bypassing the `library write` CLI).
- **Imports / consumes** — `fs`, `path`, `../_lib/_log.js`, lazily `../../_lib/library-reconcile` (`upsertVolumeByPath`). Reads stdin payload (`tool_name`, `tool_input.file_path`). `fs.realpathSync` on the written path.
- **Consumers** — `hooks.json` (`PostToolUse:Write|Edit`). `library-reconcile.js:10` documents this as one of its two callers.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| module require block | internal | lazily require `library-reconcile`, null on missing | module | none | sets `reconcile` or null (partial-install fail-soft) |
| stdin `end` handler | hook-entry | realpath the file, upsert into catalog if it's a volume | stdin JSON; realpath | catalog via `upsertVolumeByPath` (delegated); log `upserted`/`error` | `process.exit(0)` always (PostToolUse cannot deny) |

- **File-level notes** — Correctly realpaths BEFORE the volumes-glob test so the symlinked `mempalace-fallback.md` resolves into the library tree (architect B3). Fail-soft: every error swallowed + logged + `exit(0)`. Coverage boundary honestly documented: catches Write+Edit only; MultiEdit / bash-heredoc / Node-fs writes are NOT seen here (the SessionStart `catalog-reconcile-session.js` backstop covers those). Notably this hook does NOT emit a `{decision}` to stdout — it only `exit(0)`s; correct for a non-deny PostToolUse observer.

### `hooks/post/error-critic.js`

- **Purpose** — `PostToolUse:Bash` Critic→Refiner: detects repeated failures of the SAME Bash command in a session and emits a `[FAILURE-REPEATED]` forcing instruction with the last-N error excerpts on the 2nd+ failure.
- **Imports / consumes** — `fs`, `path`, `os`, `crypto`, `../_lib/_log.js`, `../../_lib/atomic-write` (`writeAtomicString`), `../../_lib/lock` (`acquireLock`/`releaseLock`), with homedir-mirror fallback. Reads env `CLAUDE_SESSION_ID` / `CLAUDE_CONVERSATION_ID`. State under `os.tmpdir()/.claude-toolkit-failures/<session>/<key>.{count,log}` + `.lock`.
- **Consumers** — `hooks.json` (`PostToolUse:Bash`); `session-reset.js:212` cleans `.claude-toolkit-failures/` at SessionStart.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| require/fallback blocks | internal | resolve lock + atomic-write primitives with typeof guards + fail-soft fallbacks | modules | log `lock_primitive_missing` | sets `acquireLock=()=>false` fallback (skip-not-unlocked) |
| `commandKey` | internal | sha256(normalized command) sliced to 12 hex | command string | none | pure (trim + collapse whitespace, case-preserving) |
| `isFailure` | internal | detect failure from `is_error` or stderr keyword heuristic | tool_response | none | pure |
| `truncateError` | internal | cap error text to `MAX_ERROR_BYTES` | error string | none | pure |
| `buildForcingInstruction` | internal | compose `[FAILURE-REPEATED]` text | command, count, errorLog | none | pure string |
| stdin `end` handler | hook-entry | RMW the per-command count+log under lock, escalate at threshold | stdin; count/log files | count+log files via `writeAtomicString`; stdout forcing text; logs | mkdir -p; lock acquire/release; atomic writes; emits forcing instruction at count>=2 |

- **File-level notes** — Strong concurrency story: lock for mutual exclusion + atomic-write for crash-consistency, both documented as orthogonal. Fallback semantics carefully INVERTED from H.7.10 (lock-missing => skip, not proceed-unlocked). Session-scoped TMPDIR keying (the macOS `/var/folders` persistence lesson). `commandKey` comment honestly corrects a prior false claim (it preserves case, does NOT lowercase). **Gaps documented in-comment**: `isFailure` stderr keyword set misses `ENOTFOUND`/`ECONNREFUSED`/`abort`/`panic` (relies on `is_error` for those). **Smell**: the per-command `.count`/`.log` files accumulate one pair per DISTINCT command string within a session and are only cleaned at SessionStart — unbounded within a long session (bounded by distinct-command count, low risk).

### `hooks/post/kb-citation-gate.js`

- **Purpose** — `PostToolUse:Agent|Task` hook that audits whether an `architect` sub-agent's reply includes the required `## KB Sources Consulted` section + >=1 `kb:` ref; logs verdicts and emits an (advisory) `decision: block` with a `[KB-CITATION-MISSING]` forcing instruction when non-compliant.
- **Imports / consumes** — `fs`, `os`, `path`, `../_lib/_log.js`. Reads stdin payload (`tool_name`, `tool_input.subagent_type`, `tool_response`/`tool_result`). Writes `~/.claude/checkpoints/kb-citation-log.jsonl`.
- **Consumers** — `hooks.json` (`PostToolUse:Agent|Task`); `spawn-record.js:183` deliberately duplicates `extractResultText` from here.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `readStdin` | internal | read fd 0 + JSON parse, fail-soft null | fd 0 | log on fail | none |
| `emit` | internal | write decision + newline | decision | stdout | none |
| `appendLog` | internal | append JSONL verdict record | entry | kb-citation log | mkdir -p + appendFile |
| `extractResultText` | internal | normalize string\|array\|object tool_response into one string | tool_response | none | pure |
| `main` | hook-entry | gate on architect, check section+refs, log, approve/block | stdin; regex tests | stdout `{decision}`; log | emits advisory block; no disk state |

- **File-level notes** — **The header itself documents that this hook's `decision: block` does NOT propagate to the parent in headless mode** (confirmed v2.4.1) — so despite emitting `block`, the hook is functionally OBSERVABILITY-ONLY; the real enforcement was MEANT to move to `contract-reminder-on-agent-spawn.js` (which is itself inert per ADR-0012 — see that file's finding). So both the post-hook block AND the pre-hook prompt-mutation are non-load-bearing; the only working KB-citation enforcement is the static `agents/architect.md` contract. Scoped to ONE persona (architect) via a `Set` — `KB_REQUIRED_SUBAGENTS.has(...)` is a correct exact membership test (no subset hazard here since it's a single-element allow-set, not an authorization post-condition). The v2.7.1 regex tightening (`^##\s+` anchor) correctly rejects h3 headings.

### `hooks/post/spawn-close-resolver.js`

- **Purpose** — `PostToolUse:Agent|Task` SHADOW spawn-close resolver: OBSERVES a harness `isolation:worktree` at spawn-close, runs the kernel transaction-loop `resolve()` in SHADOW (no git mutation, journal-only), records read-only provenance into the content-addressed store, and is the first production importer of `record-store`/`post-spawn-resolver`. Has dormant ENFORCING (`LOOM_RESOLVER_ENFORCE=1`) and candidate-staging (`LOOM_STAGE_CANDIDATES=1`) branches.
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`, `child_process` (`execFileSync`), `../_lib/_log.js`, `../../spawn-state/post-spawn-resolver.js` (`resolve`), `../../_lib/path-canonicalize.js` (`checkWithinRoot`, `isSafePathSegment`), `../../_lib/wal-append.js`, `../../spawn-state/stage-promote.js`, `../../spawn-state/stage-candidate.js`, `../../_lib/quarantine-promote.js` (`buildSpawnRecord`), `../../_lib/transaction-record.js` (`computePostStateHash`, `GIT_SHA_RE`), `../../_lib/record-store.js` (`appendRecord`). Reads env `LOOM_SPAWN_STATE_DIR`, `LOOM_GIT_TIMEOUT_MS`, `LOOM_RESOLVER_ENFORCE`, `LOOM_STAGE_CANDIDATES`. Reads stdin payload (`tool_response.worktreePath`/`worktreeBranch`/`agentId`/`status`, `session_id`, `tool_input.subagent_type`). Runs read-only `git status/diff/rev-parse/show-ref` in the worktree. Writes per-spawn journals + content-addressed records under `~/.claude/spawn-state/<run_id>/`.
- **Consumers** — `hooks.json` (`PostToolUse:Agent|Task`, 3rd on the matcher); `record-store.js:7` names it as the store's first production importer. Exports a wide surface for tests.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `readStdin` | internal | read fd 0 with 10MB cap + JSON parse | fd 0 | log | none |
| `emitApprove` | internal | write `{decision:'approve'}` + newline | — | stdout | none |
| `sha256` | internal | hex sha256 of a string | string | none | pure |
| `resolveRunId` | internal | session_id->sha256[:16] or fresh UUID, enforce `isSafePathSegment` | payload | none | returns safe single path segment |
| `resolvePersonaId` | internal | source persona from `subagent_type`, else `kernel-enforce` sentinel | payload | none | pure |
| `journalPathFor` | internal | compose per-spawn journal path | stateDir, runId, agentId | none | pure path |
| `appendJournal` | internal | lazily mkdir 0700 + append a WAL record (fail-soft) | journal file, record | journal file | mkdir + WAL append |
| `buildEnvelopeFromToolResponse` | exported | map tool_response to a SHADOW decision envelope; null if no worktreePath/agentId | tool_response | none | pure (commit_outcome from `status==='completed'`) |
| `buildK14Ctx` | exported | prototype-pollution-safe + CWE-22-bounded k14_ctx from a raw bag | raw bag, worktreeRoot | none | pure (Object.fromEntries over frozen 9-key whitelist + `checkWithinRoot`) |
| `dryRunPromote` | internal | the SHADOW dry-run promote seam | — | none | returns `{outcome:'PROMOTED',dryRun:true}` |
| `gitTimeoutMs` | exported | fail-SAFE timeout from env (positive finite int only) | env | none | pure |
| `makeGuardedRunGit` | exported | build a read-only git runner; refuse mutating args; bound buffer+timeout | cwd | log `git-mutation-refused`/`git-read-failed` | spawns `git` (read-only); refuses non-allow-list subcommands |
| `buildK14CtxFromNames` | internal | attribute the first sorted tracked name as targetPath, boundary-validate | worktreeRoot, names | none | pure |
| `okStdout` | exported (impl internal) | fail-CLOSED stdout extractor (null on non-ok) | runGit result | none | pure |
| `parseStatusZ` | exported | parse `status --porcelain -z` into dirty bit + sorted tracked names | NUL-framed stdout | none | pure (rename/copy + untracked aware) |
| `readWorktreeStatus` | exported | single fail-CLOSED status walk | runGit | none | runs one read-only git |
| `recordSpawnProvenance` | exported | COMPLETED-gated, read-only, fail-soft provenance record into the store | envelope, runGit, dirty | content-addressed record via `appendRecord`; journal entries | writes a store record (committed+clean only); own try/catch |
| `resolveAndJournal` | exported | run resolve() in SHADOW + journal the would-be verdict + provenance | envelope, stateDir, runId, agentId, personaId | journal entries; store record | runs resolve() with injected seams; fail-soft swallows resolve() throws |
| `journalWorktreeGone` | internal | journal a GC'd-worktree record without entering resolve() | stateDir, runId, agentId, path | journal entry | journal write |
| `main` | hook-entry | gate Agent\|Task, build envelope, worktree-gone guard, dispatch flag branches | stdin; env flags | stdout approve; journals/records | dispatches shadow / enforce / candidate; always `emitApprove` + fail-soft |

- **File-level notes** — This is the most sophisticated file in the cluster and is unusually careful: prototype-pollution-safe ctx build (frozen whitelist), CWE-22 path-boundary checks (`checkWithinRoot`), read-only git allow-list with mutation refusal, bounded buffer + timeout, fail-CLOSED dirty detection (unknown tree => dirty => never hashes), `resolveRunId` enforces `isSafePathSegment` so a future derivation change can't thread a traversal segment into a `path.join`. The W1-B two-walk collapse (`status --porcelain -z`) closes a real parser-differential the VERIFY hacker found (line-mode quoting + ` -> ` mis-split). All paths fail-soft to approve+exit 0. **At 875 lines this is well over the 800-line file guideline** (the only over-limit file in the cluster). Honesty discipline is strong: the journal labels everything `shadow`/`would_be`/`dry_run` and never over-claims a kernel commit. Provenance is read-only and COMPLETED-gated so the store can't hold a record contradicting an ABORTED verdict. The store write goes through `appendRecord` which content-address-verifies on read (the #273 lesson) — this hook is the producer, so its records are legitimately minted (no co-forge concern from the producer side).

### `hooks/_lib/_log.js`

- **Purpose** — shared append-only JSONL logger for ALL hook scripts; 5MB auto-rotation; env-var log-dir redirect for hermetic tests.
- **Imports / consumes** — `fs`, `path`, `os`. Reads env `CLAUDE_HOOKS_QUIET`, `LOOM_LOG_DIR`, `LOOM_SPAWN_STATE_DIR`. Writes `<logDir>/<hookName>.log` (+ `.log.1` on rotation).
- **Consumers** — every file in this cluster, plus `network-egress-audit.js`, `spawn-record.js`, `prompt-pattern-store.js`, and all `validators/*` (via `../hooks/_lib/_log.js`). The single most-imported module in the cluster.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `resolveLogDir` | internal | resolve log dir live (env override -> spawn-state subdir -> `~/.claude/logs`) | env | none | pure |
| `maybeRotate` | internal | rename `.log`->`.log.1` when size > 5MB | statSync | renames log file | one rename on overflow; swallows missing-file |
| `log` | exported | factory returning a `(event, details)` logger | hookName | log file (appendFile) | mkdir -p; rotate; sanitize event name; append line; never throws |
| `resolveLogDir` | exported | same (also exported) | env | none | pure |

- **File-level notes** — Resolves log dir PER-CALL (not at module load) to remove require-order fragility for in-process callers. Defensively strips `\r\n\t` from the event name + caps at 80 chars (log-injection defense, forward-looking). Honors `CLAUDE_HOOKS_QUIET=1`. Keeps only ONE historical log (`.log.1` overwritten each rotation) — bounded storage, acceptable. Note: `details` is NOT sanitized for newlines (only the event name is) — a future caller piping multiline user input into `details` could inject log lines via `JSON.stringify` (low risk: `JSON.stringify` escapes `\n` inside strings, so this is actually safe; the event-name sanitization is the real guard).

### `hooks/_lib/file-path-pattern.js`

- **Purpose** — shared file-path extractor (Unix/Windows/quoted), filtering out substrate-internal state files so the auto-loop doesn't observe its own bookkeeping.
- **Imports / consumes** — none (pure regex module). Operates on arbitrary text.
- **Consumers** — `hooks/lifecycle/pre-compact-save.js:18` (`extractFilePaths`); `tests/unit/kernel/hooks/_lib/file-path-pattern.test.js`. (Header notes it also previously served `auto-store-enrichment.js`.)
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isSubstrateInternalPath` | exported | test a path against the substrate-internal deny-list | path string | none | pure |
| `extractFilePaths` | exported | extract + dedup file paths from text, filtering substrate-internal | text | none | pure; returns `Set<string>` |

- **File-level notes** — Pure, well-bounded, honestly documents what it intentionally does NOT catch (unquoted spaces, network paths, <2-segment paths). `HT.1.9` pruned speculative regex-constant exports (verified 0 external consumers). The deny-list is curation-disciplined (>90%-substrate-state rule). Param named `path` shadows the conventional `path` module name but no `require('path')` here, so harmless. No mutation, no I/O.

### `hooks/_lib/marketplace-state-reader.js`

- **Purpose** — DRY shared reader for the local marketplace mirror clone: resolve its root + compute HEAD-commit age in days, with NO network call.
- **Imports / consumes** — `fs`, `path`, `os`, `child_process` (`execSync`). Reads `~/.claude/plugins/marketplaces/<name>/`; runs `git log -1 --format=%ct` in that dir.
- **Consumers** — `hooks/lifecycle/session-reset.js:105` (lazy require, third diagnostic branch). Header also names `contracts-validate.js` (historical).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `getMirrorRoot` | exported | resolve mirror clone path, null if absent | marketplaceName, fs.existsSync | none | pure-ish (one existsSync) |
| `getMirrorHeadTimestamp` | internal | git HEAD commit unix-ts (local), null on error | mirrorPath; `git log` | none | spawns git (2s timeout, stderr silenced) |
| `getMirrorAgeDays` | exported | age in days from HEAD ts | mirrorPath | none | derives from `getMirrorHeadTimestamp` |

- **File-level notes** — `execSync('git log -1 --format=%ct')` is marked `REVIEWED-SAFE H.8.4` (fixed-string args, no shell-injection vector — but it IS `execSync` with a string, so the `cwd` is the only attacker-influenced input and that is a path, not a command). Local-only by design (privacy + perf — no `git fetch`). `HT.1.9` pruned speculative exports. Clean SOLID Interface Segregation (2 narrow exports).

### `hooks/_lib/settings-reader.js`

- **Purpose** — DRY shared reader for `~/.claude/settings.json`: plugin-enabled check + registered-marketplace list.
- **Imports / consumes** — `fs`, `path`, `os`. Reads `~/.claude/settings.json`.
- **Consumers** — `hooks/lifecycle/session-reset.js:71` (lazy require). Header notes the other historical callers (`plugin-loaded-check.js` retired H.7.26, `contracts-validate.js` dead-code removed HT.2.4).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `readSettings` | internal | read + parse settings.json, null on any error | settings file | none | one file read |
| `isPluginEnabled` | exported | is `enabledPlugins[id]` truthy | pluginId; settings | none | pure-ish |
| `getRegisteredMarketplaces` | exported | keys of `extraKnownMarketplaces` | settings | none | pure-ish |

- **File-level notes** — Fail-soft (null/empty on unreadable). `HT.1.9` pruned speculative exports (only the 2 consumed functions are public). Clean Interface Segregation. `isPluginEnabled` coerces value to `Boolean` — the comment honestly notes an empty-object config would count as enabled (an edge Claude Code doesn't actually emit). No mutation.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| HIGH | file | logical-fallacy | `hooks/pre/contract-reminder-on-agent-spawn.js:25-44,289-300` | The hook's entire enforcement mechanism — mutating the sub-agent prompt via `hookSpecificOutput.updatedInput.prompt` — is **inert on Agent/Task spawns** per accepted ADR-0012 (two `claude -p` probes: the sub-agent ran the ORIGINAL prompt, prompt rewrites are NOT honored). The header still claims "deterministic compliance" and the hook is registered + actively firing in `hooks.json:76`. It is the SAME dead-mechanism class that retired `pre-spawn-tool-mask` (`hooks.json:61` tombstone). Net effect: a registered, log-writing hook whose load-bearing side effect never reaches the harness — enforcement theater. Reduce to observability-only or remove. |
| MEDIUM | function | bug | `hooks/pre/verify-plan-gate.js:93-116,176` | `findActivePlan` infers "the active plan" purely from NEWEST mtime in `PLAN_DIR`. If any other `.md` in `~/.claude/plans` was touched more recently than the plan being exited (concurrent edit, unrelated write, an archived plan re-saved), the gate inspects the WRONG file and can either falsely block a non-HETS exit or falsely approve a HETS exit. No correlation to the session's actual plan. |
| MEDIUM | substrate | smell | `hooks/post/kb-citation-gate.js:24-35,160-163` | The hook emits `decision: block` but its OWN header documents that the block reason does NOT propagate to the parent in headless mode (confirmed v2.4.1) — so it is functionally observability-only. Its intended successor enforcement (`contract-reminder-on-agent-spawn.js`) is ALSO inert (finding above). Result: zero working runtime KB-citation enforcement; only the static `agents/architect.md` contract binds. The two hooks together give a false impression of a live enforcement loop. |
| LOW | file | smell | `hooks/post/spawn-close-resolver.js:1-875` | File is 875 lines — over the 800-line file-organization ceiling. It is cohesive (one close-path concern) and heavily SRP-decomposed internally, but the size + breadth (shadow + enforce + candidate dispatch, provenance producer, status parser) is a split candidate (e.g., extract the git-runner + status-parser into a `_lib` module). |
| LOW | function | optimization | `hooks/pre/route-decide-on-agent-spawn.js:143-146` | Every Agent/Task spawn synchronously `spawnSync`s a fresh `node route-decide.js` child (5s budget) on the spawn-critical path. For high-fanout HETS runs this is N child-process launches. Consider in-process `require()` of the route-decide module (it is a pure scorer) to avoid per-spawn process-launch latency. |
| LOW | function | smell | `hooks/pre/fact-force-gate.js:308` | `fs.existsSync(filePath)` is evaluated twice in the Write-approve path (once for the ternary `reason`) after an earlier existsSync at line 293 — three stats of the same path in one handler. Compute once into a `const exists`. Cosmetic; not a correctness issue. |
| LOW | function | bug | `hooks/pre/config-guard.js:44-46` | `loadPatterns` wraps each loaded pattern as `(?:^ \| \\/)(?:${p})`, but patterns in the JSON file may already include their own`(?:^ \| /)` anchor (the fallback set does). Double-anchoring is harmless for matching but means the `_comment` in `config-guard-patterns.json` ("automatically anchored with `(?:^ \| /)`") understates that user patterns are wrapped regardless — a user-authored pattern that itself begins with`^` would become `(?:^ \| /)(?:^...)` and silently never match a path with a leading separator. Minor authoring footgun. |
| LOW | file | smell | `hooks/pre/verify-plan-gate.js:51-63,79-85` | `requiresPrincipleAudit` + `hasH2Heading` are INTENTIONALLY duplicated from `validators/validate-plan-schema.js` "to keep the two enforcement points in lockstep." This is a conceded DRY exception, but there is no shared module or test asserting the two copies stay identical — a real drift risk if one is edited without the other. Extracting to a shared `_lib` helper would remove the lockstep-by-convention fragility. |
| LOW | function | smell | `hooks/post/error-critic.js:119,253` | Per-command `.count`/`.log` state files accumulate one pair per DISTINCT command string within a session under `${TMPDIR}/.claude-toolkit-failures/<session>/` and are cleaned only at SessionStart (`session-reset.js`). A long session running many distinct failing commands grows this dir unbounded within the session. Low risk (bounded by distinct-command count, small files), but no in-session cap or TTL. |
| INFO | function | optimization | `hooks/post/error-critic.js:159-179` | `isFailure`'s stderr keyword heuristic (`error \| failed \| cannot \| not found \| undefined \| exception`) is documented to MISS`ENOTFOUND`/`ECONNREFUSED`/`abort`/`panic` when `is_error` is absent. Acknowledged in-comment; widening needs a false-positive eval corpus. Recording it as a known coverage gap, not a new bug. |
| INFO | file | optimization | `hooks/_lib/_log.js:64-66` | Only the event NAME is newline/control-char-sanitized; `details` is passed through `JSON.stringify` (which escapes `\n` inside strings, so log-injection via details is not actually possible today). Forward-looking note: any future code that writes raw (non-JSON.stringify) detail text would reopen the injection surface. No change required. |
| INFO | substrate | smell | `hooks/pre/config-guard.js:69-88` vs `hooks/pre/redirect-plan-mode-in-headless.js:193-200` | Decision-shape inconsistency across the pre-gates: `config-guard` + `fact-force-gate` + `verify-plan-gate` use the legacy `{decision:'block'\|'approve'}` shape, while `redirect-plan-mode-in-headless` uses the modern `hookSpecificOutput.permissionDecision:'deny'`. Both are honored by the harness, but the mixed convention is a readability/consistency smell across sibling files on the same lifecycle phase. |
