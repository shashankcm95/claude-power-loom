# Kernel `_lib`: K9/K14 write-scope & journal guards — `packages/kernel/_lib/`

> This cluster is the **kernel-enforced** write-admission and audit substrate for delta promotion (K9) and write-scope detection (K14). It is the load-bearing security boundary that gates how a spawn-worktree delta is cherry-picked into the parent (`k9-promote-deltas`), validates the write target (`k9-path-guard`), records a durable append-only undo ledger (`k9-journal`), classifies whether a write escaped its declared root (`k14-symlink-guard` / `k14-snapshot` / `k14-tail-window` / `k14-write-scope`), materializes a spawn's squashed delta into a content-addressed genesis record (`quarantine-promote`), and runs all git through one no-shell invoker (`invoke-git`). Per the kernel contract these modules are the only enforced layer; everything they protect against (path traversal, shell injection, false-merge, torn audit) must fail CLOSED here because no runtime or skill layer above re-checks it. Several modules SHIP DORMANT (no production importer at their PR) but are now live through `spawn-state/*` and `hooks/post/spawn-close-resolver.js`.

## Directory contents & nesting

All nine files live directly in `packages/kernel/_lib/` (the kernel's shared-primitive folder; the leading `_` marks it private-to-kernel, not a public package surface). There is no nested `_lib/` or `_spike/` inside this folder. The K9 trio and K14 quartet are each a deliberate **mandatory split** (ADR-0011 §K9-split / §K14-split) into one orchestrator + leaves, with a strict acyclic `orchestration -> {leaves}` DAG (no leaf imports its orchestrator or sibling).

| File | Folder | Role | One-line purpose |
|---|---|---|---|
| `k9-path-guard.js` | `_lib` | K9 leaf (input validation) | CWE-22 write-scope gate + delta-SHA shape + request well-formedness; thin admission layer over K7 `checkWithinRoot`. |
| `k9-journal.js` | `_lib` | K9 leaf (durable audit) | Append-only reverse-cherrypick journal: build/validate/append/read entries (INV-19). |
| `k9-promote-deltas.js` | `_lib` | K9 orchestrator | Cherry-pick a delta SHA into the parent gated by an evidence pre-commit check; abort fail-closed; record outcome; rollback via `git revert`. |
| `k14-symlink-guard.js` | `_lib` | K14 leaf (TOCTOU/CWE-22) | Classify a candidate path in-scope / symlink-escape / out-of-scope / unresolvable; content-hash only verified in-scope files. |
| `k14-snapshot.js` | `_lib` | K14 leaf (snapshot) | Iterative BFS tree snapshot to a content-addressed map + a pure `diffSnapshots` comparator. |
| `k14-tail-window.js` | `_lib` | K14 leaf (attribution) | Decide whether a write at a given wall-clock ms is attributable to the just-closed spawn + which phase. |
| `k14-write-scope.js` | `_lib` | K14 orchestrator | Transport-agnostic facade `detectWriteScopeViolations(ctx)` composing the three leaves into `write_scope_violations[]`. |
| `quarantine-promote.js` | `_lib` | spawn-delta materializer | Squash `<merge-base>..HEAD` + working tree into one commit via a temp index; build genesis / spawn transaction-records. |
| `invoke-git.js` | `_lib` | shared git primitive | No-shell `execFileSync` git runner with a uniform `{ok,code,stdout,stderr}` contract; locale-pinned; optional per-call env overlay. |

## Per-file analysis

### `k9-path-guard.js`

- **Purpose** — K9's input-validation leaf: CWE-22 write-scope admission + delta-SHA shape screen + whole-request well-formedness, all fail-closed BEFORE any git runs.
- **Imports / consumes** — `require('./path-canonicalize')` (`checkWithinRoot`). No `fs`, no env vars. Pure CPU + the K7 delegate (which does touch the filesystem via `realpathSync`).
- **Consumers** — `k9-promote-deltas.js` (the only production importer: `pathGuard.admitPromoteRequest` in `promoteDelta` gate 1, and `pathGuard.checkWritePathInScope` for the journal-path scope check). Tests: `tests/unit/kernel/_lib/k9-promote-deltas.test.js` and the K9 CWE-22 fixtures.

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `checkWritePathInScope` | exported | CWE-22 gate; thin delegate to K7 with an added `missing-root` token | `candidatePath`, `worktreeRoot`; via K7 reads filesystem (realpath) | none (returns object) | none (pure verdict; K7 may `realpathSync`) |
| `validateDeltaSha` | exported | 40/64-hex lowercase SHA shape allowlist | `deltaSha` | none | none |
| `admitPromoteRequest` | exported | whole-request admission (root present, SHA shaped, path in scope), cheapest-first order | `req.{candidatePath,worktreeRoot,deltaSha}` | none | none |
| `DELTA_SHA_PATTERN` | exported const | the hex SHA regex | n/a | n/a | n/a |

- **File-level notes** — Clean SRP leaf, fail-closed, single source of truth delegation to K7 (no re-rolled traversal logic). The ordering comment (missing-root then SHA then scope) is accurate. Note the duplicated SHA validation between `validateDeltaSha` here and `admitPromoteRequest`'s call to it (intentional reuse, not duplication). `admitPromoteRequest` re-checks `worktreeRoot` (lines 93-95) that `checkWritePathInScope` would also check (line 49) — a harmless redundant guard that lets the request layer surface `missing-root` before the SHA check.

### `k9-journal.js`

- **Purpose** — The durable append-only reverse-cherrypick undo ledger (INV-19-WALAppendOnly). Builds, validates, appends, and reads journal entries; undo is a forward `git revert` replayed from the ledger, never a history rewrite.
- **Imports / consumes** — `fs`, `crypto`, `require('./atomic-write')` (`writeAtomicString`). Reads `journalPath` via `fs.readFileSync`. No env vars.
- **Consumers** — `k9-promote-deltas.js` (`journal.buildJournalEntry` / `journal.appendJournalEntry` via `recordOutcome`). Tests: `tests/unit/kernel/_lib/k9-journal.test.js`.

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `computeEntryId` | internal | sorted-key sha256 of the entry minus `entry_id` | `entryWithoutId` | none | none (pure hash) |
| `buildJournalEntry` | exported | build (not write) a complete entry; fills derived fields + `entry_id`; fail-closed SHA-shape guard | `fields.{outcome,promoted_sha,pre_state_hash,post_state_hash,worktree_root,abort_reason,timestamp_iso}` | none | throws on missing fields or non-hex `promoted_sha`; reads `Date.now()` (default `timestamp_iso`) |
| `validateJournalEntry` | exported | validate required fields + outcome enum + `reverse_op_description` IFF description-bearing | `entry` | none | none |
| `appendJournalEntry` | exported | append one entry to the journal (read-existing + concat + atomic rewrite) | `journalPath` (`fs.readFileSync`), `entry` | writes `journalPath` via `writeAtomicString` (tmp+rename) | disk mutation; throws on invalid `journalPath`/entry; normalizes a torn tail to a newline boundary |
| `readJournal` | exported | parse all entries; tolerate a torn/unparseable final line | `journalPath` (`fs.readFileSync`) | none | returns fresh `JSON.parse` objects (no shared mutable state) |
| `JOURNAL_SCHEMA_VERSION` / `JOURNAL_OUTCOMES` / `JOURNAL_REQUIRED_FIELDS` | exported const | schema constants (frozen) | n/a | n/a | n/a |

- **File-level notes** — `reverse_op_description` is documented as a **non-actionable LABEL** (the executor reads the `promoted_sha` field, never this string) which neutralizes the CWE-78 temptation, and `PROMOTED_SHA_PATTERN` is duplicated from the path-guard DELIBERATELY (DAG-leaf no-back-edge + defense-in-depth so boundary validation is not call-order-dependent). `readJournal` returns freshly parsed objects, so checklist item 4 (read-back immutability) is satisfied — no shared row is frozen-then-leaked. The two real concerns are (a) the **whole-file rewrite per append is O(n) → O(n²)** over the ledger lifetime (despite the "append-only" framing the implementation is a full atomic rewrite, defensible for crash-atomicity but costly), and (b) the **read-modify-rewrite has no lock**, so two concurrent appends race to last-writer-wins and one entry is silently lost — a durability gap for an audit ledger (MEMORY flags concurrency as a known future concern).

### `k9-promote-deltas.js`

- **Purpose** — K9's orchestrator: cherry-pick a spawn-worktree delta SHA into the parent worktree, GATED by CWE-22 admission + an evidence pre-commit check (INV-21); on conflict/gate-fail leave host byte-for-byte pre-spawn (INV-K9-RejectFidelity); record every outcome in the journal; provide `rollbackPromotion` (`git revert`).
- **Imports / consumes** — `./k9-path-guard`, `./k9-journal`, `./invoke-git` (`runGitDefault`), `./transaction-record` (`validateTransactionRecord`, `isBootstrapSentinel`, `computeGenesisHash`), and lazily `require('fs')` (in `snapshotHost`). Reads candidate file bytes (`snapshotHost`), runs git via the injected `runGitFn` or default. No env vars directly (locale pinning is in `invoke-git`).
- **Consumers** — `spawn-state/post-spawn-resolver.js` and `spawn-state/recovery-sweep.js` (`const k9 = require('../_lib/k9-promote-deltas')`). Tests: `k9-promote-deltas.test.js`, `recovery-sweep.test.js`, `post-spawn-resolver.test.js`.

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isGenesisPosition` | exported | recognize a genesis chain position (literal `GENESIS`, bootstrap sentinel, or `computeGenesisHash` for per-project/per-user) | `record.{prev_state_hash,schema_version}` | none | none (pure; calls `computeGenesisHash`) |
| `checkEvidenceLinkPreCommit` | exported | INV-21 gate: validate head record, walk evidence chain to genesis bounded by `MAX_EVIDENCE_CHAIN_DEPTH` with cycle guard; F20 recovery-sweep skip | `opts.{record,isGenesisPosition,is_recovery_sweep,resolveParent}` | none | none (pure verdict); calls injected `resolveParent` |
| `readHeadSha` | internal | best-effort `git rev-parse HEAD`; sentinel `'unknown'` on failure | `runGit` | none | runs git (read-only) |
| `snapshotHost` | internal | byte snapshot of a candidate file (Buffer or null) | `candidatePath` (`fs.readFileSync`) | none | reads a file; never throws |
| `hostUnchangedBetween` | internal | byte-equality of two snapshots (both-null = unchanged) | `before`, `after` Buffers | none | none |
| `recordOutcome` | internal | fail-soft journal emission (build + append; swallow any error) | `journalPath`, `fields` | writes journal via `appendJournalEntry` | disk mutation (best-effort); never throws |
| `isAlreadyPresent` | internal | classify git "already applied / empty" via substring over stderr+stdout | `result.{stderr,stdout}` | none | none |
| `rejectedRequest` | internal | shared `REJECTED_REQUEST` result shape | `reason`, `depthWalked` | none | none |
| `resolveCherryOutcome` | internal | classify a non-clean cherry-pick (NOOP vs conflict), fail-closed `--abort`, `ABORT_UNCONFIRMED` honesty outcome | `ctx.{cherry,runGit,deltaSha,parentRoot,candidatePath,journalPath,preStateHash,hostBefore,depthWalked}` | journal write; runs `git cherry-pick --abort` | git mutation (abort resets index+worktree); journal write; never rethrows a partial state |
| `promoteDelta` | exported | top-level promote: gate 1 (CWE-22 admission + journal-path scope), gate 2 (evidence), snapshot, cherry-pick, classify | `opts.{deltaSha,parentRoot,candidatePath,record,journalPath,resolveParent,isGenesisPosition,is_recovery_sweep,runGitFn}` | journal write; runs `git cherry-pick` (+ `--abort` on conflict) | git mutation of parent worktree; journal write; reads candidate bytes only post-gate; throws only on a non-object `opts` |
| `rollbackPromotion` | exported | reverse a prior promote via `git revert --no-edit <sha>` (hooks disabled); append a `REVERTED` entry | `opts.{worktreeRoot,promotedSha,journalPath,runGitFn}` | journal write; runs `git revert` | git mutation (new revert commit); journal write; fail-closed on non-hex SHA (no git runs) |
| `MAX_EVIDENCE_CHAIN_DEPTH` / `HOOKS_DISABLED_ARGS` / `runGitDefault` | exported | constants + re-export of the git runner | n/a | n/a | n/a |

- **File-level notes** — This is the densest and most security-load-bearing file (565 lines, well under the 800 ceiling; functions are appropriately small after the `resolveCherryOutcome` split). Strong points: every git call is an arg array (no shell), hooks disabled on BOTH the forward cherry-pick AND the rollback path, SHA shape validated locally at every git boundary (defense-in-depth, not call-order-dependent), the evidence gate fails CLOSED on a missing `resolveParent` for a non-genesis record, a cycle-guard `Set` short-circuits adversarial `A->B->A` chains, and `ABORT_UNCONFIRMED` is surfaced when the abort does not confirm rather than reporting a false whole-tree-clean. The file is admirably honest in its docstrings about what the gate does NOT guarantee (no evidence-ref CONTENT verification in v3.0-alpha — that is the integrity-not-content boundary). The genuine concerns: (a) `isAlreadyPresent` substring matching on localized-but-pinned git prose is a fragile interim heuristic (acknowledged), and one marker entry is redundant (see findings); (b) `hostUnchanged`/`candidateUnchanged` report only a SINGLE-file snapshot, with whole-tree fidelity delegated entirely to `git cherry-pick --abort` — this is documented but means a caller trusting `hostUnchanged===true` outside the `ABORT_UNCONFIRMED` path is trusting the abort succeeded.

### `k14-symlink-guard.js`

- **Purpose** — K14's load-bearing security leaf: classify a candidate path as in-scope / symlink-escape / out-of-scope / unresolvable, NEVER trusting an escaping or unresolvable target as in-scope; content-hash only verified in-scope regular files.
- **Imports / consumes** — `fs`, `crypto`, `./path-canonicalize` (`checkWithinRoot`). Reads candidate files (`realpathSync`, `lstatSync`, `readFileSync`/chunked `readSync`). No env vars.
- **Consumers** — `k14-write-scope.js` (`classifyPath`, `hashInScopeFile`); `k14-snapshot.js` receives `classifyPath` INJECTED by the orchestrator (does not import it directly). Tests: `k14-symlink-guard.test.js`.

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `hashInScopeFile` | exported | content-hash a caller-verified regular-file path (chunked for >1MB), fail-closed to null | `resolvedPath`, `size`; reads file bytes | none | opens/reads a file; closes fd in `finally`; returns null on any error |
| `classifyPath` | exported | full classification via K7 + a `realpathSync`/`lstatSync` gate; attach sha256 for in-scope readable files | `candidatePath`, `worktreeRoot`; `realpathSync`, `lstatSync`, file bytes | none | reads filesystem; fail-closed to `unresolvable` on stat/realpath error |
| `LARGE_FILE_BYTES` | exported const | 1MB streaming-hash threshold | n/a | n/a | n/a |

- **File-level notes** — The leaf owns the FULL classification (surfaces K7's reason token AND splits the two out-of-namespace cases), so the orchestrator dispatches on `kind` alone with no second `checkWithinRoot` (removes a double-realpath TOCTOU window on the reason re-check — a real hardening). The docstring on `hashInScopeFile` is refreshingly honest that `resolvedPath` is an aspirational name, not a verified precondition (the function `open()`s and follows symlinks; scope/regular-file-ness is the caller's obligation). The fd is always closed in `finally`. One subtlety: `classifyPath` does `realpathSync(candidatePath)` then `lstatSync(resolved)` — since `resolved` is the realpath, `lstatSync` on it is effectively a stat (the final component is no longer a symlink after realpath), which is correct for the directory-vs-file decision. Fail-closed throughout.

### `k14-snapshot.js`

- **Purpose** — Capture a content-addressed snapshot of a tree (keyed by POSIX relative path) and a pure `diffSnapshots` comparator. The escaping-symlink classification is INJECTED so the leaf does not import its sibling (preserves the star DAG).
- **Imports / consumes** — `fs`, `path`. Reads directory entries (`statSync`, `readdirSync`, `lstatSync`) and (via the injected classifier) file bytes. No env vars.
- **Consumers** — `k14-write-scope.js` (`snapshotTree` in `snapshotDeclaredRoots`). `diffSnapshots` has no production caller (deliberately ahead-of-consumer; reserved for the 4b multi-write path). Tests: `k14-snapshot.test.js`.

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `snapshotTree` | exported | iterative BFS snapshot to `{rel: {sha256,size,mtimeMs,kind}}`; escaping symlinks recorded `symlink-escape` (never descended); fail-closed on missing classifier | `root`, `classify` fn; `statSync`/`readdirSync`/`lstatSync` + classifier file reads | none | reads filesystem; bounded by `MAX_ENTRIES`; fail-soft per-dir (skips unreadable dirs) |
| `diffSnapshots` | exported | pure compare of two snapshots; one record per path that differs (content or kind transition) | `pre`, `post` maps | none | none (does not mutate inputs) |
| `MAX_ENTRIES` | exported const | 100000-entry walk ceiling (CWE-400) | n/a | n/a | n/a |

- **File-level notes** — Iterative BFS (no recursion → no stack blowup), bounded by `MAX_ENTRIES`, fail-closed when no classifier is supplied. Two notes: (a) the walk is **fail-SOFT on an unreadable directory** (`continue` on `readdirSync` throw) — a write into a directory the hook cannot read becomes invisible to the snapshot (a fail-open gap relative to the per-file fail-closed posture, justified in-comment as "security is per-file" but worth flagging since the orchestrator's single-target path does not currently route through `snapshotTree` anyway); (b) `visited` increments for every dirent INCLUDING directories, so a wide-but-shallow tree could hit `MAX_ENTRIES` and silently truncate — a truncated snapshot under-reports rather than over-reports (fail-open for the missing tail). `diffSnapshots` correctly returns NEW records and does not mutate its inputs.

### `k14-tail-window.js`

- **Purpose** — Decide whether a write observed at a wall-clock ms is attributable to the just-closed spawn (within the tail window) and classify the detection phase. The clock is an injected argument (F23 — never an env/global trigger).
- **Imports / consumes** — Nothing (pure arithmetic). No fs, no env.
- **Consumers** — `k14-write-scope.js` (`tailWindowPhase` in `phaseFor`). Tests: `k14-tail-window.test.js`.

| name | kind | purpose | consumes (params) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isWithinTailWindow` | exported | true iff `writeAtMs` in half-open `[close, close+tail)`; writes at/before close also attributed; fail-closed on non-finite | `o.{writeAtMs,spawnCloseWallMs,tailWindowMs}` | none | none (pure) |
| `tailWindowPhase` | exported | classify `'spawn-close'` / `'tail-window'` / null | same shape | none | none (pure) |

- **File-level notes** — Clean, deterministic, fully testable. Fail-closed on any non-finite input (a garbage anchor never widens the window). The half-open boundary `[close, close+tail)` is a deliberate, documented edge. One logical note: there is NO lower bound on the "at or before close" arm (`writeAtMs <= spawnCloseWallMs` → attributed), so a write timestamped arbitrarily far before the spawn even started would still be attributed "spawn-close"; harmless for the snapshot transport (where `writeAtMs` defaults to `spawnCloseWallMs`) but a real concern once a true event-stream transport supplies historical write times.

### `k14-write-scope.js`

- **Purpose** — The K14 orchestrator: a transport-agnostic facade `detectWriteScopeViolations(ctx)` returning a fully-shaped `write_scope_violations[]`. v3.0-alpha dispatches only to the snapshot transport (single-target classification on `ctx.targetPath`).
- **Imports / consumes** — `path`, `./k14-snapshot` (`snapshotTree`), `./k14-tail-window` (`tailWindowPhase`), `./k14-symlink-guard` (`classifyPath`, `hashInScopeFile`), `./path-canonicalize` (`checkWithinRoot`, `hasTraversalMarkers`). Filesystem reads happen via the injected/default `fs` and the leaves. No env vars.
- **Consumers** — `spawn-state/post-spawn-resolver.js` (`const k14 = require('../_lib/k14-write-scope')`). Tests: `k14-write-scope.test.js`.

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `hashFileUnconditional` | exported | hash an out-of-scope sibling without a scope requirement; fail-soft to null | `filePath`, `fsmod`; `lstatSync` + file bytes | none | reads filesystem; returns null on non-file or error |
| `snapshotDeclaredRoots` | exported | pre-snapshot seam: snapshot each declared root + pre-hash a suspected out-of-scope target | `ctx.{fs,declaredWriteRoots,targetPath}`; filesystem | none | reads filesystem; does NOT mutate ctx |
| `makeViolation` | exported | build a fully-shaped violation element (every key present) | shaped fields | none | returns a NEW object (copies `flags`) |
| `phaseFor` | internal | the detection phase via `tailWindowPhase`; defaults `writeAtMs` to `spawnCloseWallMs`, `tailWindowMs` to 5000 | `ctx.{tailWindowMs,spawnCloseWallMs,writeAtMs}` | none | none |
| `isParentScopeSuspected` | internal | is the target a caller-marked IDE/watcher-owned (unreachable) path | `ctx.{unreachableFromSpawnRoot,targetPath}` | none | none |
| `classifyTarget` | internal | classify the single suspected target into a violation (or null); CWE-22 traversal gate at entry | `ctx`, `fsmod`; via `classifyPath`/`hashFileUnconditional` filesystem | none | reads filesystem; returns a violation or null |
| `treeShaFor` | internal | look up a pre-hash for an in-scope rel path from a preSnapshot tree | `preSnapshot`, `root`, `rel` | none | none |
| `detectWriteScopeViolations` | exported | the facade: returns `write_scope_violations[]` (default []) | `ctx` | none | reads filesystem (via `classifyTarget`); does NOT mutate ctx |
| `TRANSPORT_SNAPSHOT` / `FALSE_POSITIVE_FLAG` | exported const | element constants | n/a | n/a | n/a |

- **File-level notes** — The facade's OUTPUT and NAME are transport-agnostic (Open/Closed for the v3.1 event-stream branch) and the file is honest that the INPUT `ctx` is still snapshot-shaped (the seam is narrower than the output until v3.1) — a model of trade-off articulation. The CWE-22 traversal-marker gate is applied UNIFORMLY at the entry of both `snapshotDeclaredRoots` and `classifyTarget` (so a `..`/null-byte target never reaches `hashFileUnconditional` via OS normalization). The notable concern is the `(3)` branch label-fidelity bug: the comment says it handles "an out-of-scope sibling OR an unresolvable target," but the violation it emits hardcodes `kind: 'out-of-scope'` — so an in-scope-but-unresolvable target (a dangling symlink that passes K7's lenient canonicalize, fails `realpathSync`, and is classified `unresolvable` by `classifyPath`) is mislabeled `out-of-scope` in the output (see findings). The `phaseFor` dead-code-removal comment (the prior unreachable `if (phase === null)` fallback) is accurate — `tailWindowPhase` returns null IFF `isWithinTailWindow` is false.

### `quarantine-promote.js`

- **Purpose** — The spawn-delta materializer: squash a worktree's `<merge-base>..HEAD` range PLUS the uncommitted working tree into ONE commit via a throwaway temp index (never touching the real `.git/index`), and build genesis / spawn transaction-records that downstream K9 cherry-picks. Ships dormant at PR-3c-a; live through `stage-candidate`/`stage-promote`/`spawn-close-resolver`.
- **Imports / consumes** — `crypto`, `fs`, `os`, `path`, `./path-canonicalize` (`canonicalize`), `./transaction-record` (`computeTransactionId`, `computeGenesisHash`, `computeContentHash`, `computeIdempotencyKey`, `isBootstrapSentinel`, `validateTransactionRecord`). Runs git via INJECTED `runGit`/`runGitWithEnv` seams (default to `invoke-git`); reads `os.tmpdir()`, `process.pid`, `Date.now()`. Writes a temp index file (via git's `GIT_INDEX_FILE`) and removes it.
- **Consumers** — `spawn-state/_stage-helpers.js` (`materializeDelta`), `spawn-state/stage-candidate.js` (`buildSpawnRecord`, `deriveParentRoot`), `spawn-state/stage-promote.js` (`buildGenesisRecord`, `deriveParentRoot`), `spawn-state/integrator.js` + `runtime/orchestration/trampoline.js` (`sanitizeAgentId`), `hooks/post/spawn-close-resolver.js` (`buildSpawnRecord`). Tests: `quarantine-promote.test.js`, `stage-candidate.test.js`, `stage-promote.test.js`.

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `makeTempIndexPath` | internal | unique temp-index path (pid + monotonic counter + 6 random bytes) | `process.pid`, `crypto.randomBytes`, `os.tmpdir()` | none (path only) | mutates module-level `_tempIndexCounter` |
| `gitOut` | internal | run a git seam, trim stdout, throw a bounded-stderr Error on non-ok | `runGit`, `args`, `label` | none | runs git; throws concrete Error on failure |
| `deriveParentRoot` | exported | canonicalized parent repo root from `git worktree list --porcelain` (first `worktree` line) | `worktreePath`, `runGit`; via `canonicalize` reads filesystem | none | runs git; throws on no-worktree-line or non-canonicalizing root |
| `writeTreeViaTempIndex` | internal | `add -A` + `write-tree` into a temp index; validate tree SHA shape | `runGitWithEnv`, `env` (GIT_INDEX_FILE) | git writes the temp index | runs git (stages into temp index); throws on failure or non-hex tree |
| `materializeDelta` | exported | squash `<merge-base>..HEAD` + working tree into one commit; report `{delta_sha,candidateRel,isEmpty,tree,parentHead}` | `opts.{worktreePath,agentId,runGit,runGitWithEnv}`; git object store | git `commit-tree` (new commit object); temp index file | creates a git commit object; writes + `rmSync` removes the temp index in `finally` (every path) |
| `sanitizeAgentId` | exported | reduce agentId to `[A-Za-z0-9_-]` (NOT injective/collision-free) | `agentId` | none | none |
| `genesisRecordFields` | internal | assemble shared genesis base fields; fail-fast on non-sentinel agentId / empty personaId | `{agentId,personaId,schemaVersion}`; `computeGenesisHash` | none | reads `Date.now()`; throws concrete Error on bad input |
| `finalizeGenesisRecord` | internal | assert sentinel, compute `transaction_id`, validate at genesis; return a NEW record | `record` (must carry `evidence_refs[0]`) | none | throws on non-sentinel evidence_ref or invalid record |
| `buildGenesisRecord` | exported | a genesis-valid record (no post_state_hash/head_anchor) | `opts.{agentId,personaId,schemaVersion}` | none | throws (via helpers); reads `Date.now()` |
| `buildSpawnRecord` | exported | a genesis spawn record + post_state_hash + head_anchor + idempotency_key | `opts.{agentId,personaId,schemaVersion,postStateHash,headAnchor}` | none | throws (via helpers); reads `Date.now()` |

- **File-level notes** — The temp-index discipline is excellent: a UNIQUE path (pid + monotonic counter + random bytes) defeats same-ms collisions, `GIT_INDEX_FILE` keeps the real `.git/index` untouched, and `fs.rmSync(..., {force:true})` runs in `finally` on EVERY path including errors. Error handling avoids the name-paraphrasing smell (surfaces bounded git stderr). The module is honest that GENESIS is a STRUCTURAL gate, not provenance (matching the substrate's documented "integrity != provenance" lesson) and that `sanitizeAgentId` is NOT a unique id (uniqueness keys off `writer_spawn_id` / `transaction_id`). `buildSpawnRecord` correctly derives `content_hash` (binding `writer_spawn_id` + `head_anchor`) and `idempotency_key` BEFORE `finalizeGenesisRecord` so the `transaction_id` hashes them in (INV-22). Minor: `finalizeGenesisRecord` indexes `record.evidence_refs[0]` with no guard — safe today (only reached via `genesisRecordFields` which always sets it), but a future direct caller would get a `TypeError` rather than the intended concrete message. The `_tempIndexCounter` is module-global mutable state (acceptable for uniqueness, the only mutation in the file).

### `invoke-git.js`

- **Purpose** — The single no-shell git invoker for kernel callers: `execFileSync('git', args, ...)` with a uniform `{ok,code,stdout,stderr}` contract, locale-pinned to C, with an optional per-call env overlay (`GIT_INDEX_FILE`).
- **Imports / consumes** — `child_process` (`execFileSync`). Reads `process.env` (inherited, then `LANG`/`LC_ALL` pinned, then `extraEnv` overlaid). No fs.
- **Consumers** — `worktree/worktree-allocator.js` and `k9-promote-deltas.js` (`runGitDefault`); indirectly the default git runner for `quarantine-promote` seams. Tests: `invoke-git.test.js`.

| name | kind | purpose | consumes (params) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `runGitDefault` | exported | run git via execFile (no shell); bound stderr to 500 chars; never throws | `repoRoot`, `args[]`, `extraEnv?`; `process.env` | spawns a `git` child process (may mutate the repo per the args) | git side effects per args; returns a result object; catches all errors |

- **File-level notes** — Correct CWE-78 posture: args are an argument ARRAY, git is spawned directly (no shell, no word-splitting). Never throws (callers branch on `.ok`). Bounded stderr prevents a hostile/huge stderr from bloating the result. One comment-vs-code nuance: the rationale says the locale pins "cannot be silently clobbered by an inherited LANG — extraEnv is opt-in per call." That is true for an INHERITED `process.env.LANG` (the `LANG:'C'` literal is spread AFTER `...process.env`), but because `...extraEnv` is spread LAST, an explicit `extraEnv.LANG`/`extraEnv.LC_ALL` WOULD override the pins — the protection is against inherited env only, not against a caller's explicit overlay. Defensible (the only intended overlay is `GIT_INDEX_FILE`) but the comment slightly over-states the guarantee.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | function | bug | `k9-journal.js:182-205` | `appendJournalEntry` is a non-atomic read-modify-rewrite with NO lock. Two concurrent appends both read `prior`, both concat their own entry, and the second `writeAtomicString` (tmp+rename) overwrites the first — silently LOSING an entry from an audit ledger whose whole INV-19 promise is durability. The atomic-write only makes each individual rewrite crash-safe, not the read-modify-write critical section. MEMORY flags concurrency as a known future concern; for a recovery-replay ledger this is the load-bearing gap. |
| LOW | function | smell | `k14-write-scope.js:210-222` | Label-fidelity: the `(3)` branch comment says it handles "an out-of-scope sibling OR an unresolvable target," but `makeViolation` hardcodes `kind: 'out-of-scope'`. `classifyPath` returns `kind:'unresolvable'` (distinct from `out-of-scope`) for an in-scope path that fails `realpathSync` (dangling symlink); that target lands in this branch and is reported as `out-of-scope`, erasing the `unresolvable` distinction the symlink-guard deliberately surfaced. A downstream resolver dispatching on `kind` cannot tell a sibling write from an unresolvable in-scope target. |
| LOW | function | optimization | `k9-journal.js:190-202` | O(n) per append (full `readFileSync` + concat + whole-file rewrite) → O(n²) over the ledger lifetime. Despite the "append-only" framing the implementation rewrites the entire file each call. Defensible for crash-atomicity (a true `appendFileSync` is not atomic across a torn write), but for a long-lived journal a size-bounded segment scheme or an fsync'd O(1) append with a torn-tail reader (which `readJournal` already tolerates) would scale better. |
| LOW | function | smell | `k9-promote-deltas.js:74-78` | Redundant marker in `ALREADY_PRESENT_MARKERS`: `'previous cherry-pick is now empty'` is a strict superset of `'cherry-pick is now empty'`, and `isAlreadyPresent` uses substring `.indexOf(...) !== -1` — the shorter marker already matches the longer phrasing, so the first entry is dead weight. Harmless but misleading (a reader assumes two distinct git phrasings). |
| LOW | function | smell | `k9-promote-deltas.js:287-293` | `isAlreadyPresent` classifies a NOOP vs a genuine conflict by substring-matching localized git PROSE. Acknowledged in-comment as an interim heuristic (v3.1 R10 replaces it with a structural `git diff --quiet` probe) and mitigated by the `LANG=C` pin, but it remains a brittle correctness dependency on git's English output: a future git rewording the "empty" message would mis-route a NOOP as a conflict (triggering a spurious `--abort`) or vice-versa. |
| LOW | function | smell | `k14-snapshot.js:67-71` | The walk is fail-SOFT on an unreadable directory (`continue` on `readdirSync` throw), so a write into a directory the hook cannot read is invisible to the snapshot — a fail-OPEN gap relative to the module's per-file fail-closed posture. Justified in-comment ("security is per-file") and currently unreached in the v3.0-alpha single-target path, but a hazard once `diffSnapshots`/the whole-tree path goes live (4b). |
| LOW | function | smell | `k14-snapshot.js:64-73` | `MAX_ENTRIES` (100000) is checked against `visited`, which increments for EVERY dirent including directories. A wide-but-shallow tree can hit the ceiling and silently truncate the snapshot; a truncated snapshot under-reports changes (fail-open for the dropped tail) with no signal to the caller. Belt-and-suspenders today (kernel worktree is small), but the truncation is silent. |
| LOW | function | logical-fallacy | `k14-tail-window.js:43-44` | `isWithinTailWindow` attributes ANY write with `writeAtMs <= spawnCloseWallMs` ("during the spawn proper") with NO lower bound — a write timestamped arbitrarily far BEFORE the spawn started is still attributed `spawn-close`. Moot for the snapshot transport (`writeAtMs` defaults to `spawnCloseWallMs`), but the comment's "during the spawn" claim is not actually enforced; once a real event-stream supplies historical write times, pre-spawn writes would be wrongly attributed. |
| LOW | file | smell | `invoke-git.js:60-64` | Comment-vs-code mismatch: the rationale says the locale pins "cannot be silently clobbered by an inherited LANG." True for inherited `process.env` (spread before the `LANG:'C'` literal), but `...extraEnv` is spread LAST, so an explicit `extraEnv.LANG`/`extraEnv.LC_ALL` WOULD override the pins. The guarantee is "inherited env cannot clobber," not "nothing can clobber"; the comment over-states it. Harmless (only `GIT_INDEX_FILE` is ever overlaid) but a latent footgun for a future caller. |
| LOW | function | smell | `quarantine-promote.js:318-322` | `finalizeGenesisRecord` indexes `record.evidence_refs[0]` with no guard. Safe today (only reached via `genesisRecordFields`, which always sets `evidence_refs`), but a future direct caller passing a record without `evidence_refs` gets an opaque `TypeError: Cannot read properties of undefined` instead of the module's intended concrete fail-fast message — counter to the file's own "fail fast with a concrete message" discipline. |
| INFO | component | logical-fallacy | `quarantine-promote.js:261-269` + `k9-promote-deltas.js:138-156` | Both modules document (correctly, and as a non-bug) that GENESIS is a STRUCTURAL position gate, NOT provenance: the A10/evidence checks confirm a record is self-consistent and bottoms out at genesis, but NOTHING here authenticates the legitimate producer. This matches the substrate's documented "integrity != provenance" lesson — any trust derived downstream from "the record exists and validates" is inflatable by anyone who can write the store. Flagged INFO for the report's provenance-trust audit, not as a defect in these files (the open-writable-store risk is owned elsewhere). |
| INFO | component | bug | `k9-promote-deltas.js:138-151` | Honestly self-documented limitation (not a regression): the evidence pre-commit gate does NOT verify evidence_ref CONTENT in v3.0-alpha — a garbage ref string carried at a valid-hex `prev_state_hash` is NOT caught (only forged-genesis-position and bottomed-out/cyclic/over-depth chains are). Per-ref content + chain-membership verification is deferred to v3.1 R10. Recorded so the report does not over-claim the gate's guarantee. |

Markdown discipline applied: underscore-bearing tokens are backticked, no table cell contains an unescaped `|`, a single bullet style is used, and no wrapped line opens with a bare list marker.
