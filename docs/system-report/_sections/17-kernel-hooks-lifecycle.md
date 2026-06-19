# Kernel hooks: session lifecycle hooks — `packages/kernel/hooks/lifecycle/`

> These nine scripts are the **session-lifecycle layer of the kernel hook substrate** — the scripts Claude Code invokes at `SessionStart`, `UserPromptSubmit`, `Stop`, and `PreCompact` boundaries (wired in `packages/kernel/hooks.json`). Although they live under the kernel (the "enforced" tier), nearly all of them are **advisory / best-effort by design**: per ADR-0001 every one fail-soft passes the input through unchanged on any error, and the forcing instructions they emit are Class-1/Class-2 (advisory / operator-notice) — they nudge Claude or the operator, they never block a tool call. The genuinely enforcing PreToolUse gates (`config-guard`, `fact-force-gate`, validators) live in `hooks/pre/` + `validators/` and are out of scope here. This cluster's job is housekeeping (stale-tracker sweeps, catalog reconcile, checkpoint persistence), observability (context-size warning, console.log lint), and steering (prompt-enrichment gate, self-improve queue surfacing, session-end nudge).

## Directory contents & nesting

All nine files sit directly in `packages/kernel/hooks/lifecycle/`. There is no nested `_lib/` or `_spike/` under `lifecycle/`; shared helpers are reached by relative require into two sibling/parent libs:

| File | Hook event | One-line purpose |
|---|---|---|
| `auto-store-enrichment.js` | `Stop` | Detect `[ENRICHED-PROMPT-START/END]` markers in the response and persist the pattern via the `prompt-pattern-store` CLI. |
| `catalog-reconcile-session.js` | `SessionStart` | Drift-guarded library-catalog reconcile backstop covering writers the PostToolUse reconciler can't see. |
| `console-log-check.js` | `Stop` | Warn about `console.log(` in git-changed `.ts/.tsx/.js/.jsx` files. |
| `context-size-warn-stop.js` | `Stop` | Deterministic context-window-size warning (token / bytes / turns fallback chain) with band-upgrade idempotency. |
| `pre-compact-save.js` | `PreCompact` | Write a deterministic checkpoint, trigger a self-improve scan, detect active orchestration runs, then emit the MEMORY/snapshot SAVE_PROMPT. |
| `prompt-enrich-trigger.js` | `UserPromptSubmit` | Heuristic vagueness detection; inject `[PROMPT-ENRICHMENT-GATE]` (full / short-confirm tier) forcing instruction. |
| `session-end-nudge.js` | `Stop` | Count responses per session; after a threshold, append a one-shot `/self-improve` nudge. |
| `session-reset.js` | `SessionStart` | Sweep stale read-tracker / context-state / failure-dir files; emit plugin-load + `[MARKETPLACE-STALE]` diagnostics. |
| `session-self-improve-prompt.js` | `UserPromptSubmit` | On first prompt of a session, surface the self-improve pending queue once via `[SELF-IMPROVE QUEUE]`. |

Shared dependencies (not in scope, but load-bearing): `hooks/_lib/_log.js` (per-hook JSON logger), `hooks/_lib/file-path-pattern.js`, `hooks/_lib/settings-reader.js`, `hooks/_lib/marketplace-state-reader.js`, and the kernel `_lib/` modules `safe-resolve.js`, `lock.js`, `atomic-write.js`, `library-paths.js`, `library-reconcile.js`, plus the sibling `hooks/pre/fact-force-gate.js` (for its `trackerDir()` export).

## Per-file analysis

### `auto-store-enrichment.js`

- **Purpose** — `Stop` hook. Scans Claude's response text for `[ENRICHED-PROMPT-START]...[ENRICHED-PROMPT-END]` blocks and persists each as a prompt pattern via the `prompt-pattern-store.js` CLI, hardened against injection (G1), docs-poisoning (G3), nested-marker hijack (G4), and URL-as-field-key (G6). The legacy self-improve frequency-capture path was retired here at source (2026-05-30).
- **Imports / consumes** — `child_process.spawnSync`; `path`; `os` (lazy, inside `resolveStoreScript`); `../_lib/_log.js`; `../../_lib/safe-resolve` (`resolveExecCandidate`, `isSafeExecCandidate`). Reads `STORE_SCRIPT` candidate paths via lstat (through `resolveExecCandidate`). Consumes the response text on stdin when run as a hook.
- **Consumers** — `packages/kernel/hooks.json` `Stop` matcher `*` (timeout 10s). Test/spawn consumer: `tests/unit/kernel/resolver-symlink-hardening.test.js` (lines 100, 168) executes the hook. Module-require consumers of the exported internals: none found outside tests (the `module.exports` is a test seam).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `resolveStoreScript` | exported | Resolve the `prompt-pattern-store.js` path among 3 candidates, returning the first lstat-safe one or `null`. | candidate paths; `safe-resolve.resolveExecCandidate` (lstat) | none | none (read-only lstat scan); called once at module load to set `STORE_SCRIPT`. |
| `stripCodeBlocks` | internal | Remove triple-backtick fenced blocks before marker scanning (G3). | `text` | none | none (pure). |
| `extractEnrichments` | exported | Parse all well-formed enrichment blocks; refuse nested-START blocks (G4); skip unclosed. | `text`; calls `stripCodeBlocks`, `parseFields` | none | logs `skipped_unclosed` / `skipped_nested` via `_log`. |
| `parseFields` | exported | Parse `KEY: value` lines into a fields object using the `KNOWN_KEYS` allowlist (G6); multi-line values appended. | `body` | none | none (pure). |
| `storePattern` | exported | spawnSync the store CLI with explicit argv (G1); re-verify `isSafeExecCandidate` immediately before spawn (TOCTOU collapse). | `enrichment`; `STORE_SCRIPT`; `process.execPath` | invokes external CLI (which writes the pattern store); returns stdout or `null` | logs `stored` / `store_failed`; spawns a child process (8s timeout); never throws. |
| (stdin runner) | hook-entry | When `require.main === module`: echo input to stdout, then extract + store each enrichment. | stdin; the functions above | `process.stdout` (passthrough of input) | logs `no_enrichment` / `detected` / `error`; triggers `storePattern` side effects. |

- **File-level notes** — Genuinely well-hardened: explicit argv (no shell), fenced-block strip, nested-START refusal, KNOWN_KEYS allowlist, and a **re-verify-before-spawn** TOCTOU collapse (line 171) that re-checks `isSafeExecCandidate(STORE_SCRIPT)` after the module-load resolve. The hook always writes input to stdout *first* (line 236) so the response pipeline is never broken even if extraction throws. The `'[ENRICHED-PROMPT-START]'.length` literal is recomputed 3x per loop iteration (micro-smell). The store CLI itself is the actual content-addressed writer; this hook does not verify what the CLI persists.

### `catalog-reconcile-session.js`

- **Purpose** — `SessionStart` hook. A drift-guarded **backstop** reconcile of the library catalog: it covers every catalog writer the `PostToolUse:Write|Edit` reconciler (`catalog-reconcile-write.js`) cannot observe (raw `fs` writes, bash-heredoc redirects, MultiEdit). Cheap on the no-drift path (readdir + statSync per file, no hashing unless a stack actually drifted).
- **Imports / consumes** — `fs`, `../../_lib/library-paths` (`sectionsIndexPath`, `sectionManifestPath`), `../../_lib/library-reconcile` (`stackHasDrift`, `reindexStack`) — all inside a fail-soft `try/catch` at module load (partial install → undefined). `../_lib/_log.js`. Reads the sections index JSON and each section manifest JSON from disk.
- **Consumers** — `packages/kernel/hooks.json` `SessionStart` (timeout 6s). Test: `tests/unit/kernel/hooks/catalog-reconcile-hooks.test.js` (line 22, `SESSION_HOOK`).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `reconcileAllStacks` | internal | For each section + stack, if `stackHasDrift`, call `reindexStack` and log the count. | `library-paths`, `library-reconcile`; `sectionsIndexPath()`, each `sectionManifestPath(id)` via `fs.readFileSync` + `JSON.parse` | indirectly: `reindexStack` rewrites the on-disk catalog for drifted stacks | logs `reindexed` / `stack_error`; mutates library catalog files (via `reindexStack`). |
| (stdin runner) | hook-entry | Drain SessionStart stdin, run `reconcileAllStacks`, swallow all errors, `process.exit(0)`. | stdin (drained, unused) | none directly | logs `error`; always exits 0. |

- **File-level notes** — Correctly SRP-separated from `session-reset.js` (per architect rec #7). Fail-soft is thorough: per-section `try/catch continue` so one unreadable manifest doesn't abort the whole pass, per-stack `try/catch` so one drift error doesn't abort the section. The `JSON.parse(fs.readFileSync(idxPath))` of the sections index (line 39) has **no depth/size bound** — but the library index is a self-owned `~/.claude` artifact, not external input, so the DoS surface is low. The reconcile *writes* the catalog (via `reindexStack`), making this the only lifecycle hook in the cluster that performs a substantive store mutation at SessionStart.

### `console-log-check.js`

- **Purpose** — `Stop` hook. Lints git-changed (committed + untracked) JS/TS files for `console.log(` and appends a warning to the response. Layered comment-stripping + negative-lookbehind to avoid false positives on `foo.console.log(`, inline-comment-after-code, and `eslint-disable` lines.
- **Imports / consumes** — `child_process.execSync` (3 fixed git commands), `fs`, `path`, `../_lib/_log.js`. Reads git repo root, `git diff --name-only HEAD`, `git ls-files --others`, and **the full content of every changed `.ts/.tsx/.js/.jsx` file** via `fs.readFileSync`.
- **Consumers** — `packages/kernel/hooks.json` `Stop` (timeout 5s). Referenced (not executed) in `tests/smoke-ht.sh:536`. No unit test directly exercises it.
- **Functions** — single anonymous `stdin.on('end')` handler (hook-entry); no named/exported functions.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| (stdin runner) | hook-entry | Resolve repo root, list changed+untracked files, read each, scan non-comment lines for `console.log(`, append a warning if any found. | stdin; 3 `execSync` git calls; `fs.readFileSync` per changed file | `process.stdout` (input, optionally + warning) | logs `warned` / `clean` / `error`; on error, passes input through (fail-soft). No file/store mutation. |

- **File-level notes** — No `module.exports`; pure hook-entry script. The git commands are fixed-string (REVIEWED-SAFE H.8.4 — no injection vector). The hook reads the **entire content of every changed source file with no per-file size cap** (line 52) and splits into `lines` — a multi-megabyte generated/minified `.js` in the diff is fully buffered + line-split + regex-scanned on every Stop event (a real but bounded perf/memory smell; 5s timeout limits the blast radius). The documented multi-line block-comment-body false-positive gap (a `* console.log(...)` JSDoc line) is still real and acknowledged (lines 67–70). Output uses a non-ASCII `⚠` glyph (line 90) — fine in a string literal but worth noting against the repo's ASCII-in-source discipline.

### `context-size-warn-stop.js`

- **Purpose** — `Stop` hook. Deterministic context-window-size warning. Primary signal = sum of `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` from the last assistant `message.usage` block in the transcript JSONL; falls back to transcript byte-size, then to a turn counter. Emits `[CONTEXT-SIZE-WARN]` / `[CONTEXT-SIZE-URGENT]` only on a **band upgrade** (idempotent, never downgrades).
- **Imports / consumes** — `fs`, `os`, `path`, `../_lib/_log.js`, `../../_lib/lock` (`acquireLock`, `releaseLock`), `../../_lib/atomic-write` (`writeAtomic`). Env: `CLAUDE_SESSION_ID` / `CLAUDE_CONVERSATION_ID` / `ppid`; `CLAUDE_CONTEXT_WINDOW_SIZE`; `CLAUDE_CONTEXT_{WARN,URGENT}_{TOKENS,BYTES,TURNS}`. Reads the per-session state file `~/.claude/sessions/context-${SESSION_ID}.json`, the transcript tail (64 KiB), and the stdin envelope's `transcript_path`.
- **Consumers** — `packages/kernel/hooks.json` `Stop` (inserted LAST so its forcing instruction is the final concatenation; timeout 5s). Test: `tests/unit/hooks/context-size-warn-stop.test.js` (line 34).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseLastUsageBlock` | internal | Read transcript tail (`TAIL_WINDOW` bytes), walk lines right-to-left, return first parseable assistant `message.usage` total. | `transcriptPath`; `fs.statSync` / `readFileSync` / `openSync` / `readSync` / `closeSync` | none | opens/reads/closes an fd (fd-close in `finally`); returns object or `null`. |
| `pickSignal` | internal | Choose tokens → bytes → turns signal and compute the band. | `transcriptPath`, `turnCount`; `parseLastUsageBlock`, `fs.statSync` | none | logs `transcript_stat_failed` / `transcript_path_missing`. |
| `bandForTokens` / `bandForBytes` / `bandForTurns` | internal | Threshold comparators → `'none'\|'warn'\|'urgent'`. | the measurement + module-const thresholds | none | none (pure). |
| `rankBand` | internal | Map band string → 0/1/2 for upgrade comparison. | `band` | none | none (pure). |
| `loadState` | internal | Load per-session state JSON; fresh defaults on any error. | `STATE_FILE` via `fs.readFileSync` | none | none (returns object). |
| `saveState` | internal | mkdir + `writeAtomic` the state. | `state`; `STATE_DIR` | `STATE_FILE` (atomic) | logs `state_save_failed` on error. |
| `appendObservability` | internal | Append one JSONL record to the context-warn log. | `record`; `LOG_FILE` dir | `~/.claude/checkpoints/context-warn-log.jsonl` (append) | swallows errors silently. |
| `composeForcingInstruction` | internal | Build the `[CONTEXT-SIZE-*]` forcing-instruction text. | `band`, `measurement`; thresholds | none | none (pure string build). |
| (stdin runner) | hook-entry | Acquire lock, parse envelope, bump turn count, pick signal, emit on band-upgrade, else pass through. | stdin envelope; `acquireLock`/`releaseLock` | `process.stdout` (input ± forcing); `STATE_FILE`; observability JSONL | logs `lock_timeout`/`band_upgraded`/`counted`; mutates state + observability log; releases lock in `finally`. |

- **File-level notes** — Well-engineered: per-session lock, atomic state write, fd-close in `finally`, env-overridable thresholds with a window-size auto-scaler, and a carefully documented tail-window boundary invariant (`size <= TAIL_WINDOW` reads whole file; `>` triggers fd+slice(1) to discard the partial first line). The token-mode total is the empirically-validated ground-truth signal (the v2.5.0 bytes proxy was off by ~500x). One **`return` inside a held lock** (line 424) is correctly covered by the `finally` `releaseLock`. The forcing instruction hardcodes the author-machine path `~/Documents/claude-toolkit/scripts/library.js` (line 349) — a portability smell for non-author installs. `parseLastUsageBlock` reads the most recent `usage` block but does not validate the assistant turn is the *latest* turn overall (it scans right-to-left and returns the first match), which is the intended behavior but means an interleaved non-assistant tail line is simply skipped — correct.

### `pre-compact-save.js`

- **Purpose** — `PreCompact` hook. Deterministically writes a checkpoint (timestamp, cwd, mentioned file paths, context length) to `last-compact.json` + an append-only `compact-history.jsonl` (trimmed to 50), triggers a heavier self-improve consolidation scan, detects active orchestration runs from `swarm/run-state/`, and emits the MEMORY/library-snapshot SAVE_PROMPT (with an integrated numbered 4th task when orchestration is mid-cycle). Fails-closed if a library migration is mid-flight.
- **Imports / consumes** — `fs`, `path`, `os`, `../_lib/_log.js`, `../_lib/file-path-pattern` (`extractFilePaths`), `../../_lib/safe-resolve` (`resolveExecCandidate`), `../../_lib/lock` (with a homedir-fallback require + API-shape guard, then no-op stub). `child_process.spawnSync` (lazy). Env: `CLAUDE_TOOLKIT_PATH`, `CLAUDE_PLUGIN_ROOT`. Reads `LIBRARY_MANIFEST` + `MIGRATE_SENTINEL` sentinels, `swarm/run-state/<run-id>/` dirs, and `compact-history.jsonl`.
- **Consumers** — `packages/kernel/hooks.json` `PreCompact` (timeout 10s). Tests: `tests/unit/kernel/precompact-store-resolver.test.js` (line 27), `tests/unit/kernel/resolver-symlink-hardening.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `walkUpForRunState` | internal | Walk up from `__dirname` (≤8 levels) for a `swarm/run-state` dir. | `__dirname`; `fs.existsSync` | none | none (returns path or null). |
| `detectActiveOrchestrationRuns` | internal | List `run-state` dirs with node-actor files, mtime within 4h, cap 3 most-recent. | `TOOLKIT_RUN_STATE_CANDIDATES`; `fs.readdirSync`/`statSync` | none | none (best-effort; `[]` on error). |
| `buildSavePrompt` | internal | Build the SAVE_PROMPT body; integrate active runs as a numbered 4th task. | `activeRuns` | none | none (pure string build). |
| `extractCheckpoint` | internal | Build the checkpoint object (timestamp, cwd, top-20 mentioned files, length). | `inputText`; `extractFilePaths` | none | none (pure). |
| `writeCheckpoint` | internal | Persist checkpoint to `last-compact.json` (overwrite) + lock-serialized append to `compact-history.jsonl` (trim 50). Throws if migrate-incomplete. | `checkpoint`; sentinels; `acquireLock`/`releaseLock` | `last-compact.json`, `compact-history.jsonl` | mkdir; fail-closed throw on `library_initialized_but_migrate_incomplete`; lock held during append. |
| `resolveSelfImproveScript` | exported | Resolve `self-improve-store.js` among 4 candidates (incl. legacy `~/.claude/scripts/`), first lstat-safe or null. | candidates; `resolveExecCandidate` | none | none (read-only lstat). |
| `runSelfImproveScan` | exported | spawnSync the store CLI `scan` subcommand; parse stdout JSON; null on any failure. | resolved script; `process.execPath` | invokes external CLI (which mutates the self-improve store) | spawns child (10s timeout); returns parsed result or null; never throws. |
| (stdin runner) | hook-entry | extractCheckpoint → writeCheckpoint → runSelfImproveScan → detectActiveOrchestrationRuns → emit SAVE_PROMPT (or skip-instruction if checkpoint failed). | stdin | `process.stdout` (input + suffix) | logs many events; writes checkpoint files; spawns scan; emits prompt. |
| `acquireLock` / `releaseLock` | imported (with stub fallback) | Serialize history append; degrade to no-op if `_lib/lock` missing. | lock path | the lock file | acquires/releases the JSONL append lock. |

- **File-level notes** — The fail-closed migrate-race guard (line 240) is a genuine correctness win: it refuses to write when `library.json` exists but `.migrate-complete` is absent, avoiding writes landing in legacy paths mid-migration. `writeCheckpoint` is **not pure** despite a sibling's "pure function" framing of `extractCheckpoint` — the comment is accurate (it says `writeCheckpoint handles persistence`). The history append is lock-serialized; on lock timeout the append is *skipped* (not corrupted) — last-checkpoint already written. One smell: `last-compact.json` is overwritten with `fs.writeFileSync` (non-atomic, last-writer-wins) while the JSONL append is lock-protected — an asymmetry the comments justify ("latest-only semantic; no lock needed") but which means a concurrent compact could interleave a partial `last-compact.json` write. The hardcoded author-machine fallback `~/Documents/claude-toolkit/swarm/run-state` is now correctly *last* in the candidate list (H.7.10 fix).

### `prompt-enrich-trigger.js`

- **Purpose** — `UserPromptSubmit` hook. Heuristic vagueness detection on every prompt. Clear prompts pass through silently; vague prompts inject `[PROMPT-ENRICHMENT-GATE]` with a `tier:` discriminator (`full-enrichment` for the 4-part ceremony, `short-confirm` for short confirmation-shaped prompts). Pure heuristic — no subprocess LLM.
- **Imports / consumes** — `../_lib/_log.js` only. Consumes the stdin JSON envelope's `prompt` field.
- **Consumers** — `packages/kernel/hooks.json` `UserPromptSubmit` (timeout 3s). Tests: `tests/unit/hooks/prompt-enrich-trigger.test.js` (line 22); smoke tests `smoke-h4.sh`, `smoke-h7.sh`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `stripPolitenessPadding` | internal | Iteratively strip ≤3 leading politeness phrases. | `prompt`; `POLITENESS_PREFIXES` | none | none (pure). |
| `hasFilePath` | internal | Detect file-path / project-dir signal (URLs stripped first). | `prompt` | none | none (pure). |
| `hasSpecificEntity` | internal | Detect PascalCase/camelCase ≥8 chars, function calls, backtick code, quoted strings (URLs stripped). | `prompt` | none | none (pure). |
| `isObservationOnly` | internal | Match verb-less bug-report patterns. | `prompt`; `OBSERVATION_PATTERNS` | none | none (pure). |
| `isVague` | internal | The ordered vagueness gate (keywords → observation → politeness-padded → skip → length). | `prompt`; all the above | none | none (pure). |
| `isShortAmbiguousConfirmation` | internal | 1–5 words + soft-confirmation signal + no path/entity. | `prompt`; `SOFT_CONFIRMATION_SIGNALS` | none | none (pure). |
| `buildShortConfirmInstruction` | internal | Build the short-confirm-tier forcing instruction (raw prompt truncated to 200 + escaped). | `rawPrompt` | none | none (pure string build). |
| `buildForcingInstruction` | internal | Build the full-enrichment-tier forcing instruction. | `rawPrompt` | none | none (pure string build). |
| (stdin runner) | hook-entry | Parse envelope, classify, inject short-confirm or full instruction, else silent pass. | stdin | `process.stdout` (instruction only, when vague) | logs `invoked`/`classified`/`injected`/`skipped`/`error`. |

- **File-level notes** — Large but cohesive (440 lines, all single-responsibility helpers). No file/store mutation — purely a stdin→stdout classifier. The runner writes **only the forcing instruction** to stdout when vague (not `input + instruction`); for `UserPromptSubmit` hooks the harness appends stdout to the prompt context, so this is correct (other hook types in this cluster echo input). The injected full instruction hardcodes `~/.claude/packages/kernel/spawn-state/prompt-pattern-store.js` (line 378) — the *installed* path, not the plugin-cache path, which is the right path for an interactive user but would be wrong inside a plugin-only install where `~/.claude/packages/` isn't populated. The escape `rawPrompt.slice(0,200).replace(/"/g,'\\"')` (slice-before-escape) correctly avoids a trailing-backslash-at-boundary bug (Phase-C note). The `KNOWN_KEYS`/regex-driven heuristics are intentionally conservative (better to miss than over-flag).

### `session-end-nudge.js`

- **Purpose** — `Stop` hook. Counts Stop events per session in a lock-serialized per-session state file; once `count >= NUDGE_THRESHOLD` (default 10), appends a one-shot `/self-improve` suggestion to the response and sets `nudged: true` so it fires exactly once.
- **Imports / consumes** — `fs`, `path`, `os`, `../_lib/_log.js`, `../../_lib/lock` (`acquireLock`, `releaseLock`), `../../_lib/atomic-write` (`writeAtomic`). Env: `CLAUDE_SESSION_NUDGE_THRESHOLD`, `CLAUDE_SESSION_ID`/`CLAUDE_CONVERSATION_ID`/`ppid`. Reads `~/.claude/sessions/nudge-${SESSION_ID}.json`.
- **Consumers** — `packages/kernel/hooks.json` `Stop` (timeout 3s). Tests: `smoke-ht.sh` (lines 278, 311).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `loadState` | internal | Load nudge state; fresh `{count:0,nudged:false,sessionStart}` on error. | `STATE_FILE` | none | none. |
| `saveState` | internal | mkdir + `writeAtomic` the state. | `state`; `STATE_DIR` | `STATE_FILE` (atomic) | logs `state_save_failed` on error. |
| (stdin runner) | hook-entry | Acquire lock, bump count, emit nudge once at threshold, else pass through. | stdin; `acquireLock`/`releaseLock` | `process.stdout` (input ± nudge); `STATE_FILE` | logs `lock_timeout`/`nudged`/`counted`; mutates state; releases lock in `finally`. |

- **File-level notes** — Mirror of `context-size-warn-stop.js`'s state pattern: per-session lock + atomic write + fail-soft pass-through on lock timeout. The nudge string uses a non-ASCII `💡` emoji (line 106) in a string literal (cosmetic; not a source-identifier issue). Correct `return`-inside-lock covered by `finally`. No content-addressing or trust derivation — the state file is self-owned and advisory only.

### `session-reset.js`

- **Purpose** — `SessionStart` hook. Sweeps stale `claude-read-tracker-*.json` files (>1 day) from `os.tmpdir()` and the gate's per-uid subdir, stale `context-*.json(.lock)` files from `~/.claude/sessions`, and stale failure-dir session subdirs; emits operator diagnostics: a plugin-root-unexpanded WARNING, an inverse "plugin-not-loaded" NOTICE, and `[MARKETPLACE-STALE]` when the mirror clone HEAD is older than the threshold. The old dead reset-write was removed in ③.1-W1.
- **Imports / consumes** — `fs`, `path`, `os`, `../_lib/_log.js`, `../pre/fact-force-gate` (`trackerDir`), lazy `../_lib/settings-reader.js`, lazy `../_lib/marketplace-state-reader.js`. Env: `CLAUDE_SESSION_ID`/etc., `CLAUDE_PLUGIN_ROOT`, `CLAUDE_MARKETPLACE_STALE_DAYS`. Reads tmpdir entries, `~/.claude/sessions`, failure-root, marketplace mirror git log (via reader).
- **Consumers** — `packages/kernel/hooks.json` `SessionStart` (first, timeout 3s). Tests: `tests/unit/hooks/session-reset.test.js` (line 25); `smoke-h4.sh:64`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `sweepStaleTrackers` | internal (closure) | Remove `claude-read-tracker-*.json` files older than 1 day in one dir; return count. | `dir`; `fs.readdirSync`/`statSync` | deletes matching stale files (`fs.unlinkSync`) | mutates the filesystem (deletes tracker files); per-file errors ignored. |
| (top-level body) | hook-entry | Emit diagnostics; sweep trackers (flat tmpdir + per-uid subdir), context-state files, failure dirs. | env, readers, `trackerDir()` | `process.stderr` (diagnostics); deletes stale files / dirs | logs many events; `fs.unlinkSync`/`fs.rmSync` deletions; never produces stdout. |

- **File-level notes** — This file runs its work at **module top-level** (not in a `require.main === module` guard and not in a stdin handler) — a SessionStart hook doesn't read stdin, so it executes its sweep immediately on `node session-reset.js`. The `trackerDir()` require pulls in `fact-force-gate.js`, whose own runtime is guarded by `require.main === module`, so the require is side-effect free (verified). Double-sweep is guarded (`if (subdir !== tmpDir)`). The `context-*.json(.lock)` regex correctly also matches the lock files. All three diagnostic branches fail-open (lazy requires in try/catch). The marketplace threshold validates `Number.isFinite && > 0` with an operator warning on bad config. One **logical subtlety**: `placeholderUnexpanded = PLUGIN_ROOT.includes('${') || PLUGIN_ROOT === ''` (line 42) treats an empty `CLAUDE_PLUGIN_ROOT` as "unexpanded" — correct for the plugin-install case but the WARNING only fires when `looksLikePluginInstall` is also true, so non-plugin installs (empty env) don't false-warn. The failure-dir cleanup uses `fs.rmSync({recursive,force})` which is fine for self-owned tmp dirs. The stderr `[MARKETPLACE-STALE]` block (line 128) embeds a self-referential drift-note in the user-facing output — verbose but harmless.

### `session-self-improve-prompt.js`

- **Purpose** — `UserPromptSubmit` hook. On the first prompt of a session (idempotent via `lastShownInSessionId`), if the self-improve pending queue has visible candidates, inject a single batched `[SELF-IMPROVE QUEUE]` reminder grouping auto-graduated vs pending-approval items.
- **Imports / consumes** — `fs`, `path`, `os`, `../_lib/_log.js`, `../../_lib/atomic-write` (`writeAtomic`). Env: `CLAUDE_SESSION_ID`/etc. Reads `~/.claude/checkpoints/self-improve-pending.json`.
- **Consumers** — `packages/kernel/hooks.json` `UserPromptSubmit` — **NOT FOUND in the current `hooks.json`** (see findings; only `prompt-enrich-trigger.js` is wired under `UserPromptSubmit`). Referenced in spec/research docs. No unit test directly exercises it.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `loadPending` | internal | Load the pending-queue JSON; null on error. | `PENDING_PATH` | none | none. |
| `buildReminder` | internal | Build the `[SELF-IMPROVE QUEUE]` text grouping auto vs pending (cap 5 each). | `candidates` | none | none (pure string build). |
| (stdin runner) | hook-entry | Load queue; if unshown this session + has visible candidates, inject reminder + mark shown (atomic write); else pass through. | stdin | `process.stdout` (input ± reminder); `PENDING_PATH` (mark-shown) | logs `no_queue_file`/`already_shown`/`queue_empty`/`injected`/`error`; mutates the pending file. |

- **File-level notes** — The mark-shown write (`pending.lastShownInSessionId = SESSION_ID`) is the only mutation; `writeAtomic` preserves any legacy-path symlink. Visible-candidate filter accepts only `'pending'` and `'auto-graduated'` statuses. The injected store-CLI paths (`~/.claude/packages/kernel/spawn-state/self-improve-store.js`, lines 72–73) are installed paths. Because this hook is **not currently wired in `hooks.json`**, it is effectively dormant in the live substrate (the queue-surfacing capability described in the comments is not active). It echoes `input + suffix` (correct for `UserPromptSubmit`, since the queue reminder should be *added* to the prompt rather than *replace* it — unlike `prompt-enrich-trigger.js` which emits only its instruction; the two `UserPromptSubmit` echo conventions differ, which is the smell flagged below).

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | file | smell | `session-self-improve-prompt.js` (whole file) vs `packages/kernel/hooks.json:26-37` | The hook is **not registered in `hooks.json`** — only `prompt-enrich-trigger.js` is wired under `UserPromptSubmit`. The file's header claims it fires "on the first user prompt of each session," but no live event invokes it; the `[SELF-IMPROVE QUEUE]` surfacing path is dormant. Either the comment is stale (premise-not-probed) or the wiring was dropped. Worth reconciling: dead-in-substrate code whose docstring asserts active behavior. |
| MEDIUM | function | optimization | `console-log-check.js:51-52` | Every changed JS/TS file is read in full (`fs.readFileSync`, no size cap) and split into a `lines` array on every `Stop` event. A large generated/minified/vendored `.js` in the diff is fully buffered + line-split + regex-scanned, with `O(files * bytes)` cost per Stop. Bound by an `fs.statSync` size check (skip files > N bytes) or stream-scan; the 5s hook timeout is the only current backstop. |
| MEDIUM | function | smell | `context-size-warn-stop.js:349` and `pre-compact-save.js:102`, `prompt-enrich-trigger.js:378`, `session-self-improve-prompt.js:72-73` | Hardcoded author/install paths leak into user-facing forcing instructions and fallbacks: `~/Documents/claude-toolkit/scripts/library.js` (author machine) and `~/.claude/packages/kernel/...` (installed layout, not plugin-cache). On a plugin-only install where `~/.claude/packages/` is not populated, the instructed commands fail. Prefer `${CLAUDE_PLUGIN_ROOT}`-aware resolution or the same candidate-resolver the hooks use internally. |
| LOW | file | smell | `pre-compact-save.js:255-257` vs `:264-278` | Asymmetric durability: `last-compact.json` is written with a plain non-atomic `fs.writeFileSync` (no lock, no tmp+rename) while the `compact-history.jsonl` append is lock-serialized. A concurrent PreCompact (or a crash mid-write) can leave a torn/partial `last-compact.json`. Use `writeAtomic` (already imported elsewhere in the cluster) for parity. |
| LOW | function | smell | `auto-store-enrichment.js:79-117` | `'[ENRICHED-PROMPT-START]'.length` (and the END literal at 117) are recomputed on every loop iteration; `indexOf` rescans `cleaned` from `cursor` each pass. Functionally correct, minor. Hoist the literal lengths to consts. |
| LOW | file | smell | `console-log-check.js:90` | The warning string embeds a non-ASCII `⚠` (U+26A0); `session-end-nudge.js:106` embeds `💡` (U+1F4A1). Both are in string literals (not identifiers) so `no-irregular-whitespace` won't fire, but they cut against the repo's "plain ASCII in source edits" discipline and can render inconsistently on some terminals. Cosmetic. |
| LOW | function | smell | `prompt-enrich-trigger.js:436` vs `session-self-improve-prompt.js:112` | Two `UserPromptSubmit` hooks use *different* stdout conventions: `prompt-enrich-trigger.js` writes **only** the forcing instruction (relying on the harness to append it), while `session-self-improve-prompt.js` writes `input + suffix`. Both happen to be correct for `UserPromptSubmit` semantics, but the inconsistency is a latent foot-gun if either is ever copied as a template. |
| LOW | function | logical-fallacy | `context-size-warn-stop.js:331` | The bytes-mode threshold display divides by 1024 inline: `${threshold / 1024}KB` produces a non-integer like `390.625KB` for the default 400000-byte threshold. Cosmetic but inconsistent with the `(measurement.bytes / 1024).toFixed(1)` formatting two tokens earlier. |
| INFO | file | smell | `catalog-reconcile-session.js:39` | `JSON.parse(fs.readFileSync(idxPath))` of the sections index has no depth/size bound. The library index is a self-owned `~/.claude` artifact (not external input), so the unbounded-JSON DoS class is low-risk here, but it is the one unbounded parse in the cluster that *also* triggers catalog writes (`reindexStack`) on a drift hit. Noted for completeness against checklist item 6. |
| INFO | function | bug | `session-reset.js:182-183` | `subdir = trackerDir()` is wrapped in `try/catch` defaulting to `tmpDir`; if `trackerDir()` ever returns the flat base for an *unsafe* subdir while the real (unswept) tracker files live in a 0700 subdir it refused to use, those trackers would not be swept (accumulate). This matches the documented "trackerDir() returns the flat base when the subdir is unsafe" contract, so it is by-design, but the sweep then cannot reach a foreign-owned/unsafe subdir's stale files — a small unbounded-growth corner in a misconfigured-$HOME case. Low impact (tmp files only). |
| INFO | substrate | smell | cluster-wide (all 9 files) | Every hook re-derives `SESSION_ID` from the same `CLAUDE_SESSION_ID \|  \| CLAUDE_CONVERSATION_ID \|  \| String(ppid \|  \| 'default')` chain inline. When none of the env vars are set, all sessions collapse onto the literal key `'default'`, so per-session state files (`context-default.json`,`nudge-default.json`) and the self-improve`lastShownInSessionId` idempotency all key to one bucket across concurrent default sessions — band-upgrade/nudge/queue idempotency would cross-contaminate. Acceptable in practice (the harness sets the env), but the fallback is shared, undocumented as a risk, and DRY-extractable into a single helper. |
