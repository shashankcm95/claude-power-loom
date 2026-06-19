<!-- markdownlint-disable -->
# Kernel enforcement, recall, worktree, observability, route-decide — `packages/kernel/{enforcement,recall,worktree,observability,algorithms}`

> This cluster spans five sub-directories of the **kernel** tier (the only *enforced* layer of Power Loom; runtime is orchestration, lab is advisory/shadow, skills are best-effort discipline). Despite living in the kernel, almost every file here is *advisory or dormant in v3.0-alpha*: K10 (`k10-escape-hatch.js`) and K1 (`worktree-allocator.js`) ship as libraries with no `hooks.json` entry, K13 (`k13-serial-enforcer.js`) ships hook-shaped but dormant, the network-egress audit is an explicitly non-gating PostToolUse advisory, `loom-recall.js` + `signpost.js` are read-side navigation utilities, and `route-decide.js` is a deterministic class-1 forcing-instruction scorer (never a block). The genuinely-enforced consumers (`post-spawn-resolver.js`, the resolver hooks) live outside this scope but pull K13/K1 in. The recurring substrate theme — fail-soft per ADR-0001, escape hatches as operator conveniences under a local-trust model, and "detect+advise, never block" — is the through-line of every file below.

## Directory contents & nesting

| Folder | File | One-line purpose |
|---|---|---|
| `enforcement/` | `k10-escape-hatch.js` | Pure decision + Class-4 audit over the operator escape-hatch env vars (`LOOM_DISABLE_WORKTREE`, `LOOM_ALLOW_OUT_OF_SCOPE_WRITES`); flags the F10/CWE-284 combined bypass. |
| `enforcement/` | `k13-serial-enforcer.js` | Serial-spawn admission via an age-reaped marker file under a lock; dormant hook entry + the `runSerialAdmission` / `releaseSerialMarker` primitives PR-4's resolver consumes. |
| `recall/` | `loom-recall.js` | Deterministic top-K recall CLI over the `~/.claude/library/sections/` markdown corpus (Jaccard + tag + surface signals). |
| `recall/` | `signpost.js` | Auto-generates `docs/SIGNPOST.md` (concern→location map) from repo structure + each file's header-comment purpose; `--check` is the CI drift gate. |
| `worktree/` | `worktree-allocator.js` | K1 — declarative `git worktree add` allocator with retry + cleanup + K10 escape-hatch composition; no-shell `execFile` git invocation. |
| `observability/` | `network-egress-audit.js` | PostToolUse:Bash advisory hook that flags Bash egress to hosts not in any persona's `network_*` trait allowlist; never blocks. |
| `algorithms/` | `route-decide.js` | H.7.3 deterministic route/borderline/root scorer (8 scored dims + infra lift); emits `[ROUTE-DECISION-UNCERTAIN]` / `[ROUTE-META-UNCERTAIN]` forcing instructions. |

No `_lib/` or `_spike/` subfolders exist *within* this scope; the shared primitives these files consume live one level up in `packages/kernel/_lib/` (`invoke-git.js`, `lock.js`, `atomic-write.js`, `network-egress-detect.js`, `route-decide-export.js`) — these are the kernel's pure DAG-leaf helper modules, distinguished from the feature dirs by the `_`-prefix convention (private/internal to the kernel package).

## Per-file analysis

### `enforcement/k10-escape-hatch.js`

- **Purpose** — Evaluate the operator escape-hatch env vars into a structured decision and (optionally) append a Class-4 audit record. The one case it flags loudly is the *combined* bypass (`LOOM_DISABLE_WORKTREE=1` + `LOOM_ALLOW_OUT_OF_SCOPE_WRITES=1`), which disables both halves of the filesystem-delta-as-truth guarantee (F10 / CWE-284).
- **Imports / consumes** — `fs`, `path`, `os` (Node builtins). Reads env via the `env` argument (defaults to `process.env`). Writes to `~/.claude/checkpoints/k10-escape-hatch-log.jsonl` (or an injected `opts.logPath`).
- **Consumers** — `worktree/worktree-allocator.js:31` imports `evaluateEscapeHatches` and calls it at line 112. Unit test: `tests/unit/kernel/enforcement/k10-escape-hatch.test.js`. `emitEscapeHatchAudit` has no production caller (allocator emits its own K1 audit, not this one).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isTruthyEnv` | exported | Truthy-env predicate (`1`/`true`/`yes`, case-variant). | `v` string | — (returns bool) | none (pure) |
| `evaluateEscapeHatches` | exported | Pure decision over the 3 env vars → `{worktreeDisabled, outOfScopeAllowed, denyCombinedInCi, combinedBypass, action, severity}`. | `env` (defaults `process.env`): `LOOM_DISABLE_WORKTREE`, `LOOM_ALLOW_OUT_OF_SCOPE_WRITES`, `LOOM_CI_DENY_COMBINED_BYPASS` | — (returns object) | none (pure); reads `process.env` only when `env` omitted |
| `auditLogPath` | internal (re-exported as `_auditLogPath`) | Default JSONL audit path under `~/.claude/checkpoints/`. | `os.homedir()` | — | none (pure) |
| `emitEscapeHatchAudit` | exported | Append one Class-4 JSONL audit record for a non-`allow` decision; no-op on `allow`. | `decision`, `opts.logPath`, `opts.extra`; `new Date()` | appends a line to the log file; `mkdirSync` of its parent dir | filesystem mutation (dir create + append); fail-soft → returns `false` on any error |

- **File-level notes** — Clean SRP split (pure decision vs I/O emit). F23 discipline honored: the log path is injectable by *argument*, never env. Fail-soft per ADR-0001. The decision is genuinely pure. The audit record carries `combined_bypass`/`severity` but is purely observational — nothing in this file *acts* on `action === 'deny'`; the allocator only reads `worktreeDisabled`. So `denyCombinedInCi` / `action:'deny'` are computed but have **no enforcement consumer** in this scope (see Findings).

### `enforcement/k13-serial-enforcer.js`

- **Purpose** — Admit at most one spawn marker within `maxSpawnAgeMs` (serial-spawn gate), via a persistent marker file guarded by the kernel lock. Ships hook-shaped but dormant; the real consumers are PR-4's `post-spawn-resolver.js` (release path) and the recovery sweep.
- **Imports / consumes** — `fs`, `os`, `path`; `../_lib/lock` (`acquireLock`, `releaseLock`); `../_lib/atomic-write` (`writeAtomicString`). Env: `LOOM_SPAWN_STATE_DIR` (state dir override), `LOOM_K13_MAX_SPAWN_AGE_MS` (default 600000). Reads `stdin` (fd 0) in the hook entry. Reads/writes the marker `k13-active-spawn.json` and lock `k13-serial.lock` under the state dir.
- **Consumers** — `spawn-state/post-spawn-resolver.js:53` (`require`) calls `k13.readMarker` + `k13.releaseSerialMarker` (release path); `hooks/post/spawn-close-resolver.js` + `spawn-state/stage-promote.js` reference it with shadow/enforce skip stubs (`released:false`). Tests: `tests/unit/kernel/enforcement/k13-serial.test.js`, `tests/unit/kernel/_lib/k13-k14-interlock.test.js`, `tests/unit/kernel/integration/transaction-loop.test.js`, `tests/unit/kernel/spawn-state/post-spawn-resolver.test.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `markerPathFor` | exported | Resolve marker path under a state dir. | `stateDir` / `DEFAULT_STATE_DIR` | — | none (pure) |
| `lockPathFor` | internal | Resolve lock path. | `stateDir` | — | none (pure) |
| `k13AuditPath` | internal | Default audit JSONL path. | `os.homedir()` | — | none (pure) |
| `emitK13Audit` | exported | Append a Class-4 audit record. | `record`, `logPath`; `new Date()` | appends a JSONL line; `mkdirSync` parent | fs mutation; fail-soft → `false` on error |
| `decideAdmission` | exported | Pure admission decision (none/stale-reap/live-block). | `currentMarker`, `nowMs`, `maxSpawnAgeMs` | — | none (pure) |
| `readMarker` | exported | Parse the marker file → object or `null`. | `markerPath`; `fs.readFileSync` | — | reads disk; missing/corrupt → `null` (no throw) |
| `writeMarker` | internal | Atomically write a marker (mkdir mode `0o700` + atomic rename). | `markerPath`, `marker` | writes the marker file via `writeAtomicString` | fs mutation (tmp+rename); dir create |
| `runSerialAdmission` | exported | Lock-guarded read→decide→write critical section; returns `{decision, reason, reaped}`. | `o.stateDir/spawnId/nowMs/maxSpawnAgeMs/acquireLockFn/releaseLockFn/auditLogPath`; `readMarker` | on admit: `writeMarker`; on critical-section error: `emitK13Audit` | acquires+releases lock; writes marker; **throws** on non-finite `nowMs` (programmer error); fail-CLOSED `block` on write error |
| `attemptOwnerRelease` | internal | One lock-guarded owner-scoped marker unlink attempt; `null` = lock unavailable. | `stateDir`, `spawnId`, `acquire`, `release`; `readMarker` | on owner-match: `fs.unlinkSync(marker)` | acquires+releases lock; deletes marker iff owner |
| `releaseSerialMarker` | exported | Release the marker iff it belongs to `spawnId`; single-attempt or bounded-retry (3×500ms) when `sleepFn` supplied. | `o.stateDir/spawnId/acquire/release/sleepFn/auditLogPath` | delegates to `attemptOwnerRelease`; `emitK13Audit` on lock-unavailable / retry-exhausted | lock ops + marker delete; never throws/hangs (hard-bounded attempts) |
| `readStdin` | internal (hook) | Parse JSON from fd 0. | `fs.readFileSync(0)` | — | reads stdin; malformed → `null` |
| `emit` | internal (hook) | Write `{decision[,reason]}` JSON to stdout. | `decision`, `reason` | `process.stdout.write` | stdout write (swallows write error) |
| `main` | hook-entry | Dormant PreToolUse:Agent/Task entry; allow for non-spawn tools, else `runSerialAdmission`. | stdin JSON (`tool_name`, `session_id`); `Date.now()` | stdout JSON; (indirectly) marker | `process.exit(0)` always; fail-soft `allow` on any error |

- **File-level notes** — Honest guarantee scope is documented (FLAG-1): "at most one ADMITTED marker within `maxSpawnAgeMs`", **not** "at most one LIVE spawn" — a long spawn is reaped and a second admits while the first may still be alive. F8 is correctly realized: `acquireLock` is called directly, never `withLock` (whose lock-fail does `process.exit(2)`), so a lock-fail maps to a clean `block`. `runSerialAdmission` fails CLOSED on a critical-section error (will not admit an unrecordable spawn). The owner-release provenance (resolver sources `spawnId` by `readMarker`, so the owner check matches by construction) is confirmed in `post-spawn-resolver.js:185-202`. The `main` hook entry generates a `spawnId` (`Date.now().toString(36)-session`) that is NEVER released by the dormant path (only age-reap), and that id differs from the resolver-sourced id — fine while dormant, but a latent coupling (see Findings).

### `recall/loom-recall.js`

- **Purpose** — Deterministic recall CLI: scan `~/.claude/library/sections/` for `*.md`, score each against a free-text query via `0.5*keyword-Jaccard + 0.3*tag-overlap + 0.2*surface-overlap`, print top-K.
- **Imports / consumes** — `fs`, `path`, `os`. Reads `--root` (default `~/.claude/library/sections`) recursively; each `.md` file's content. No writes (read + stdout only).
- **Consumers** — Invoked as a *subprocess* (`scripts/loom-recall.js`, a path that resolves to this module's CLI) by `packages/specs/spikes/fixtures/p-measure-build-sheet.js`. Test references: `tests/unit/lab/causal-edge/loop-and-exclusion.test.js:81` (path string), `tests/unit/lab/attribution/recall-graph-store.test.js` (only a tmpdir-name coincidence). No in-process importer consumes the module exports directly in production; the exports (`tokenize`, `jaccard`, etc.) exist for unit testing.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `tokenize` | exported | Lowercase, strip non-`[a-z0-9.-]`, split, drop `<3`-len + stopwords. | `text` | — | none (pure) |
| `jaccard` | exported | Token-set Jaccard. | `setA`, `setB` | — | none (pure) |
| `parseFrontmatter` | exported | Split leading `---`-fenced YAML, parse flat `key: value` lines. | `content` | — | none (pure); flat-only parser |
| `extractH1` | internal | First `# ` heading line. | `body` | — | none (pure) |
| `walkMdFiles` | exported | Recursive `.md` collector, sorted. | `root`; `fs.readdirSync` | — | reads dir tree; missing dir → `[]` (swallowed) |
| `scoreDocument` | exported | Compute `{score, kw, tag, surface}` for one doc. | `queryTokens`, `queryStr` (unused), `doc` | — | none (pure) |
| `main` | cli | Parse argv, walk, score, sort, print (text or `--json`). | `argv`; library files | `console.log` / `console.error` | `process.exit(0/2/3)`; reads many files |

- **File-level notes** — Genuinely deterministic (documented acceptance criterion). `scoreDocument` takes `queryStr` but never uses it (dead param). The tag-source list (lines 128-135) reads six frontmatter fields but the docstring (lines 14-15) only advertises four (`phase`, `branch`, `session_class`, `work_target`) — it actually also reads `prior_snapshot` and `h1`; minor doc drift. `tokenize`'s `replace(/[^a-z0-9\s.-]/g,' ')` then split on `[\s.-]+` means a token like `post_state_hash` survives only as `post_state_hash` (underscore is NOT in the strip class, so it's kept) — but `route-decide` would be split into `route`/`decide`. This is expected for a coarse recall heuristic. No mutation, no writes.

### `recall/signpost.js`

- **Purpose** — Auto-generate (or `--check`) `docs/SIGNPOST.md`: a layer→subgroup→file map derived entirely from repo structure, with a one-line purpose lifted from each file's header comment. Drift-free by construction (CI `--check` regenerates + diffs).
- **Imports / consumes** — `fs`, `path`. `scanFiles` walks `packages/` for non-test `.js`. `generateSignpost` reads the existing `docs/SIGNPOST.md` in `--check` mode.
- **Consumers** — `scripts/generate-signpost.js:13` calls `require('../packages/kernel/recall/signpost').runCli()`. `scripts/validate-release-surface.js:29` references it in a comment (delegates ownership to the CLI). Test: `tests/unit/kernel/recall/signpost.test.js`. CI runs the `--check` gate.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `extractPurpose` | exported | Lift a one-line purpose from a header comment, robust to 3 conventions (path-echo / line-1 purpose / `@loom-layer` marker). | `source`, `relPath` | — | none (pure) |
| `truncatePurpose` | internal | First-sentence + `MAX_PURPOSE_LEN=160` truncate. | `text` | — | none (pure) |
| `classifyPath` | exported | `relPath` → `{layer, subgroup, file}` from path segments. | `relPath` | — | none (pure) |
| `layerRank` | internal | Index in `LAYER_ORDER` (unknown → last). | `layer` | — | none (pure) |
| `buildIndex` | exported | Group `[{path, purpose}]` by layer→subgroup, deterministically sorted. | `entries` | — | none (pure) |
| `renderMarkdown` | exported | Render the grouped index as markdownlint-safe markdown. | `index` | — | none (pure); emits `<!-- markdownlint-disable -->` header |
| `generateMarkdownFromFiles` | exported | Pure `[{path, source}]` → rendered markdown (the `--check` determinism basis). | `files` | — | none (pure) |
| `scanFiles` | exported | Walk `packages/`, return `[{path(rel), source}]` sorted, skip `node_modules` + `*.test.js`. | `root`; `fs.readdirSync`/`readFileSync` | — | reads file tree; read errors → empty `source` (swallowed) |
| `generateSignpost` | exported | Generate / `--check` / write the signpost. | `opts.root/outPath/write/check`; existing doc on `--check` | on `write`: writes `docs/SIGNPOST.md` (+ mkdir parent) | fs write only in `write` mode; `--check` is read-only |
| `runCli` | cli | `node ... [--check]`; `--check` exits 1 on drift, else writes + exits 0. | `argv`; `process.cwd()` | stdout/stderr; writes the doc (non-check) | `process.exit(0/1)` |

- **File-level notes** — Clean pure-core / I/O-shell split; the `--check` determinism rests on `generateMarkdownFromFiles` being a pure function of the file set, which holds. `extractPurpose` is robust to the three header conventions and correctly skips shebang + `'use strict'`. One subtle behavior: `extractPurpose` `break`s on the first non-comment line, so a file whose first non-blank line is code (no header) returns `''` — intentional. The path-echo guard (line 55) uses `endsWith('/' + baseName)` which could mis-skip a legitimate purpose line that happens to end with the basename — extremely low-probability, noted for completeness.

### `worktree/worktree-allocator.js`

- **Purpose** — K1: allocate a git worktree for a spawn, with (1) retry on transient `git worktree add` failure, (2) cleanup of partial worktrees between attempts, (3) K10 escape-hatch composition (`LOOM_DISABLE_WORKTREE` → no-worktree mode; all-retries-fail → escape-hatch-failed degrade). Ships dormant (no `hooks.json` entry); consumed by PR-4's resolver flow.
- **Imports / consumes** — `fs`, `os`, `path`; `../enforcement/k10-escape-hatch` (`evaluateEscapeHatches`); `../_lib/invoke-git` (`runGitDefault`, re-exported). Env via `opts.env` (default `process.env`) — only `LOOM_DISABLE_WORKTREE` is consulted through K10. Writes `~/.claude/checkpoints/k1-worktree-log.jsonl` (or injected path).
- **Consumers** — `tests/unit/kernel/worktree/worktree-allocator.test.js`, `tests/unit/kernel/integration/transaction-loop.test.js:112,300` (`k1.allocateWorktree`) + `:147,365` (`k1.cleanupWorktree`). `_lib/invoke-git.js` + `_lib/k9-promote-deltas.js` reference K1 in comments (shared runner rationale). No production hook calls it yet (dormant).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `k1AuditPath` | internal (re-exported `_k1AuditPath`) | Default audit JSONL path. | `os.homedir()` | — | none (pure) |
| `emitK1Audit` | internal | Append a Class-4 K1 audit record. | `record`, `logPath`; `new Date()` | appends JSONL; mkdir parent | fs mutation; fail-soft `false` |
| `cleanupWorktree` | exported | `git worktree remove --force` then `prune`; never throws. | `opts.repoRoot/worktreePath/runGitFn` | runs git (no shell) | invokes git subprocess; **throws** only if `worktreePath` missing (input guard) |
| `allocateWorktree` | exported | Retry-loop allocate + cleanup-between-attempts + K10 composition. | `opts.repoRoot/worktreePath/ref/maxAttempts/env/runGitFn/sleepFn/auditLogPath`; `evaluateEscapeHatches(env)` | runs `git worktree add`; `emitK1Audit` on disabled/failed; `sleep` between retries | creates a real git worktree (side effect on the repo); throws on missing required inputs; audit writes |

- **File-level notes** — Security claim (no-shell `execFile` arg arrays via `invoke-git`) is verified true in `_lib/invoke-git.js` (`execFileSync('git', args, ...)`, no shell). Fail-fast input validation present (`repoRoot`/`worktreePath` required). HIGH-2 cleanup-degraded folding into the audit trail is implemented. One real bug: `maxAttempts` clamp uses `> 0`, so a caller passing `0` falls back to `DEFAULT_MAX_ATTEMPTS=3` rather than running zero attempts (the test at `worktree-allocator.test.js:155` passes `maxAttempts:0` expecting it not to allocate, but the fallback makes it run 3 attempts — see Findings). `allocateWorktree` does NOT consult the *combined-bypass* / `outOfScopeAllowed` decision from K10 — it only branches on `worktreeDisabled`; the F10 combined-bypass detection in K10 is therefore never surfaced through K1's audit (K1 logs `severity: hatch.severity` which would be MEDIUM/HIGH, but never the deny action).

### `observability/network-egress-audit.js`

- **Purpose** — PostToolUse:Bash advisory: detect Bash commands reaching hosts not declared in any persona's `network_*` trait, and emit a `[NETWORK-EGRESS-UNDECLARED]` advisory to stdout. Explicitly post-hoc detection, never interception (ADR-0012: real prevention is ContainerAdapter-tier).
- **Imports / consumes** — `fs`, `path`; `../hooks/_lib/_log.js` (`log`); `../_lib/network-egress-detect.js` (`auditCommand`, `loadDeclaredHosts`). Reads `packages/runtime/contracts/traits/_registry.json` (the allowlist source). Reads stdin (fd 0, capped at 10 MiB). Writes a structured log line via `logger` and the advisory to stdout.
- **Consumers** — Registered as a PostToolUse:Bash hook (referenced in `packages/runtime/orchestration/contracts-validate.js:1198`). Tests: `tests/unit/kernel/observability/network-egress-audit.test.js`; the detection core is tested via `tests/unit/kernel/_lib/network-egress-detect.test.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `readStdin` | internal | Parse JSON from fd 0; cap 10 MiB; `null` on empty/oversize/malformed. | `fs.readFileSync(0)` | — | reads stdin; bounded |
| `loadAllowlist` | exported | Parse the traits registry → declared hosts; fall back to `['api.anthropic.com']`. | `REGISTRY_PATH` file; `loadDeclaredHosts` | — | reads the registry; never widens on error |
| `spawnOrigin` | exported | Derive `{origin, agentId?}` from a worktree-shaped cwd. | `cwd` string | — | none (pure regex) |
| `buildAdvisory` | exported | Build the `[NETWORK-EGRESS-UNDECLARED]` advisory text. | `hosts`, `allowlist` | — | none (pure) |
| `main` | hook-entry | Tool gate (Bash only) → `auditCommand` → advise / log. | stdin JSON (`tool_name`, `tool_input.command`, `cwd`); allowlist | stdout advisory; `logger` lines | reads files; stdout write; never blocks; fail-soft on any error |

- **File-level notes** — Genuinely non-gating (PostToolUse, advisory) — correct posture for the documented evadable detection. `loadAllowlist` correctly fails *closed-to-the-canonical-endpoint* (an empty allowlist would flag `api.anthropic.com`, so it falls back to the default rather than to `[]`). The detection logic lives in the pure `_lib/network-egress-detect.js` sibling; its subdomain allowlisting uses a `.`-prefixed `endsWith` that blocks the `evil-api.anthropic.com` / `…anthropic.com.evil.com` bypasses (verified). Honest-scope (base64 / sockets / indirected URLs not detected) is documented — this is mock-vs-real-class acceptable for an advisory, but the *advisory's value claim* rests on a coarse regex; never treat absence of an advisory as proof of no egress.

### `algorithms/route-decide.js`

- **Purpose** — H.7.3 deterministic route-decision scorer. Scores a task string on weighted keyword dimensions (+ infra lift, counter-signals, short-prompt penalty, optional context at half-weight) → `route` / `borderline` / `root`, with confidence + reasoning, plus the `[ROUTE-DECISION-UNCERTAIN]` and `[ROUTE-META-UNCERTAIN]` forcing instructions. Class-1 advisory; never blocks.
- **Imports / consumes** — No external requires (self-contained). Reads `process.argv` (CLI). All constants (`WEIGHTS`, `KEYWORDS`, `SUBSTRATE_META_TOKENS`, thresholds) are inline.
- **Consumers** — `_lib/route-decide-export.js` re-exports `scoreTask` for in-process use; `runtime/orchestration/identity/trust-scoring.js:103,120` (`bucketTaskComplexity`), `runtime/orchestration/_h70-test.js` (regression tests). The PreToolUse hook `hooks/pre/route-decide-on-agent-spawn.js` spawns it as a *subprocess*. Tests: `tests/unit/kernel/algorithms/route-decide.test.js`, `tests/unit/kernel/algorithms/kernel-algorithms-audit.test.js` (registry audit). `bench/collect.js` scans logs for invocations.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `detectSubstrateMeta` | internal | Match `SUBSTRATE_META_TOKENS` in lowercased text (parallel to scoring; no score impact). | `lowerText`; `buildKeywordRegex` | — | none (pure); mutates the module-level regex cache |
| `buildMetaForcingInstruction` | internal | Build the `[ROUTE-META-UNCERTAIN]` text. | `tokens`, `score`, `recommendation` | — | none (pure) |
| `parseArgs` | internal | Parse `--key value` / `--flag` argv. | `argv` | — | none (pure) |
| `buildKeywordRegex` | internal | Memoized word-boundary, case-insensitive keyword regex. | `keyword` | — | mutates `_keywordRegexCache` (module-level memo) |
| `matchKeywords` | internal | Return matched keywords from a list. | `text`, `keywordList`; `buildKeywordRegex` | — | none beyond cache |
| `scoreTask` | exported | The whole scoring pipeline → result JSON object. | `task`, `scoreArgs` (`context`/`force-route`/`force-root`) | — | none (pure aside from regex cache); reads no files |
| `main` (CLI block) | cli | `--task`/`--context`/`--force-*`/`--explain`/`--help`; print result JSON. | `process.argv`; `scoreTask` | `process.stdout` (JSON) + `process.stderr` (`--explain`/usage) | `process.exit(0/2)` |

- **File-level notes** — Pure, deterministic, well-documented; the catch-22 (a route-decide-modifying task scores against the *old* dictionary) is handled out-of-band via `[ROUTE-META-UNCERTAIN]`. `compound_strong` contributes a flat 0.15 however many keywords match (documented), so dictionary expansion structurally cannot push a substrate task past `root` on its own. **Three inconsistent dimension counts**: the header (line 4) and `--help` (line 710) say "7 weighted dimensions", the forcing-instruction (line 590) says "all 9 dimensions", but `WEIGHTS` has **8** scored keys plus the `infra_implicit` lift (and `counter_signals`/`infra_terms`/`domain_novelty` are also in `KEYWORDS`, giving 11 keyword dims). **Weight-sum claim is false**: the comment at line 27 says "Sums to 1.00 … after R1-R6 calibration", but the 8 `WEIGHTS` values sum to **1.15** (see Findings — the `infra_implicit` lift adds another 0.30, so a single task can theoretically reach the `[0,1]` clamp easily; the clamp masks the non-normalization). These are doc/calibration-honesty issues, not runtime bugs (the clamp keeps output in range), but they contradict the load-bearing "do not re-derive weights" comment.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | function | logical-fallacy | `algorithms/route-decide.js:27` | Comment claims the weights "Sum to 1.00 within decimal-precision tolerance after R1-R6 calibration." The 8 `WEIGHTS` values actually sum to **1.15** (0.25+0.15+0.15+0.075+0.20+0.075+0.15+0.10). The `[0,1]` clamp masks the non-normalization at runtime, but the comment is a premise-not-probed false claim sitting directly above the load-bearing "MUST NOT re-derive them" directive — a calibration-honesty risk for the next architect pass. |
| MEDIUM | function | smell | `algorithms/route-decide.js:4,590,710` | Three inconsistent dimension counts in one file: header + `--help` say "7 weighted dimensions"; the `[ROUTE-DECISION-UNCERTAIN]` text says "all 9 dimensions"; `WEIGHTS` has 8 scored keys (and matching runs over more `KEYWORDS` dims incl. `counter_signals`/`infra_terms`/`domain_novelty`). The user-facing forcing-instruction string ("9 dimensions") is wrong and is what a confused operator reads. |
| MEDIUM | function | bug | `worktree/worktree-allocator.js:103-104` | `maxAttempts` is clamped with `opts.maxAttempts > 0`, so a caller passing `maxAttempts: 0` silently falls back to `DEFAULT_MAX_ATTEMPTS=3` and runs three `git worktree add` attempts instead of zero. A "0 attempts → no allocation" intent is impossible to express. The unit test (`worktree-allocator.test.js:155`) passes `maxAttempts:0` and still observes the escape-hatch-failed path only because all 3 stubbed attempts fail — so the test passes for the wrong reason and would not catch a real `0`-means-3 regression. |
| MEDIUM | component | smell | `enforcement/k10-escape-hatch.js:48-64` vs `worktree/worktree-allocator.js:112-119` | K10 computes `combinedBypass`, `outOfScopeAllowed`, and `action:'deny'` (the entire F10/CWE-284 reason for the module), but the only production consumer (K1) branches solely on `hatch.worktreeDisabled`. The combined-bypass `deny` action and `outOfScopeAllowed` flag have **no enforcement consumer anywhere in this scope** — `emitEscapeHatchAudit` (the function that would surface the HIGH/CRITICAL combined bypass) is called by nobody in production. The CI `LOOM_CI_DENY_COMBINED_BYPASS` "deny" path is effectively dead until a caller acts on `decision.action`. |
| LOW | function | smell | `enforcement/k10-escape-hatch.js:27` | `isTruthyEnv` enumerates `'TRUE'`/`'YES'` explicitly but not `'True'`, `'Yes'`, `'On'`, `'1 '` (trailing space), etc. The intent ("case-insensitive") is not actually realized — `LOOM_DISABLE_WORKTREE=True` is treated as falsy. A `String(v).trim().toLowerCase()` compare against a small set would be both shorter and correct (KISS). |
| LOW | function | bug | `enforcement/k13-serial-enforcer.js:311` vs `:200-202` | The dormant `main()` generates `spawnId = Date.now().toString(36)-session`, but the real release path in `post-spawn-resolver.js` sources the release id by `readMarker()` (so it matches the *written* marker `spawn_id`, which is whatever the admission caller passed). If the live hook ever wires `main()` AND a resolver release on the same flow with different id-derivation, the owner-check would silently no-op (non-owner → marker persists for age-reap). Latent while dormant; flagged because activating the gate is the documented next step. |
| LOW | function | optimization | `recall/loom-recall.js:118` | `scoreDocument(queryTokens, queryStr, doc)` never uses `queryStr` — dead parameter. Removing it (and the call-site arg at line 199) is a no-risk cleanup; the JSDoc/signature currently implies a surface-overlap path keyed on the raw query that doesn't exist. |
| LOW | file | smell | `recall/loom-recall.js:14-19` | The header docstring lists four scored frontmatter fields (`phase`, `branch`, `session_class`, `work_target`), but `scoreDocument` (lines 128-135) actually reads six sources (`+ prior_snapshot`, `+ h1`). Doc drift — a reader trusting the header would mis-model the tag signal. |
| LOW | function | optimization | `algorithms/route-decide.js:453,564` | `allSignals`/`lowSignal` are recomputed as `Object.values(matches).reduce(...)` twice (lines 453 and 564 via `const lowSignal = allSignals === 0`); minor, but the second is redundant — `bareLowSignal` already captures `allSignals === 0`. Trivial DRY. |
| LOW | function | smell | `recall/signpost.js:55` | The path-echo guard `text.endsWith('/' + baseName)` would discard a legitimate one-line purpose that happens to end in `"/<basename>"` (e.g. a purpose mentioning the file's own path). Very low probability given header conventions, but it silently drops the purpose to `''` rather than flagging — a navigability degradation, not a crash. |
| INFO | component | smell | `observability/network-egress-audit.js` (whole file) | The advisory's correctness rests on the coarse regex host-extractor in `_lib/network-egress-detect.js`, which the file header honestly documents as evadable (base64 / `python -c` sockets / indirected URLs / bare-host `ssh host`). This is the documented mock-vs-real gap: absence of a `[NETWORK-EGRESS-UNDECLARED]` advisory is NOT evidence of no egress — only ContainerAdapter-tier network policy gates it (ADR-0012). Correctly non-gating; flagged so downstream readers do not over-trust the signal. |
| INFO | file | smell | `enforcement/k13-serial-enforcer.js:13,8-13` | Ships dormant: built + unit-tested but NOT wired in `hooks.json` (no PreToolUse:Agent/Task entry). The admission GATE is inert; only the `releaseSerialMarker` primitive is consumed (by the resolver). Same ship-dormant shape as K1/K9. Worth noting that the *enforced kernel* contains a non-trivial dormant gate whose age-reap liveness/correctness trade is only valid under the local-trust model. |
| INFO | function | optimization | `enforcement/k13-serial-enforcer.js:108-116` | `readMarker` collapses "missing file" and "corrupt JSON" into the same `null` (admission-equivalent to no spawn). For a *corrupt* marker (vs missing), fail-soft-to-admit means a partially-written marker silently permits a second concurrent admission. Acceptable under local-trust + the documented age-reap model, but a corrupt-marker case is observationally indistinguishable from no-spawn in the audit trail. |

