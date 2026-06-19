# Kernel `_lib`: content-addressed record store + hashing core — `packages/kernel/_lib/`

> This cluster is the **kernel** tier (the only *enforced* layer of the substrate). It holds the content-addressed transaction-record store that backs K9's provenance state-chain walk, the pure hashing/validation primitives that mint and verify those records (`transaction_id`, `post_state_hash`, `content_hash`, `idempotency_key`), and the shared low-level I/O primitives every higher tier (runtime orchestration, Lab advisory stores) reuses: atomic tmp+rename writes, append-only JSONL WAL, a PID file-lock, a recursive deep-freeze, and a bounded JSONL reader. Although the store is *fed* in SHADOW (it advises K9, it does not gate promotion in production), the read/write discipline here — fail-soft readers composed under fail-closed consumers, content-address-verify-on-read, hex-gated path derivation — is load-bearing for the whole provenance model. A drift in the canonical-JSON bytes or a weakened verify-on-read silently breaks idempotency dedup and re-opens the manage-promote IDOR substrate-wide.

## Directory contents & nesting

All ten files live directly in `packages/kernel/_lib/` (no nested `_lib/` or `_spike/` subfolders within scope; `_lib` itself is the kernel's shared-primitive folder, sibling to `hooks/`, `algorithms/`, `spawn-state/`, `validators/`, `enforcement/`). Two supporting modules referenced below — `path-canonicalize.js` and `safe-resolve.js` — also live in `_lib/` but are out of this section's scope (covered as dependencies).

| File | Folder | One-line purpose |
|---|---|---|
| `record-store.js` | `kernel/_lib` | Content-addressed, run-scoped transaction-record store (append + 3 readers + list); the K9 `resolveParent` seam. |
| `record-locate.js` | `kernel/_lib` | Cross-run locator: which run holds a given `transaction_id` (fail-closed on ambiguity). |
| `record-scan.js` | `kernel/_lib` | Two cross-run, mtime-windowed read-only scans (committed destructive ops + reject-events) feeding the circuit breaker. |
| `transaction-record.js` | `kernel/_lib` | The K2 hashing/validation/classification helpers (`computeTransactionId`, `computePostStateHash`, `computeContentHash`, `computeIdempotencyKey`, `deriveIdempotencyKey`, `validateTransactionRecord`, …). |
| `canonical-json.js` | `kernel/_lib` | Pure sorted-keys, depth+node-bounded canonical JSON serializer (the content-hash substrate). |
| `atomic-write.js` | `kernel/_lib` | `writeAtomic` / `writeAtomicString` tmp+rename primitive with symlink-preservation + foreign-uid containment. |
| `wal-append.js` | `kernel/_lib` | Append-only JSONL WAL append (read + newline-normalize + atomic rewrite), fail-soft/fail-hard caller choice. |
| `lock.js` | `kernel/_lib` | PID-based file lock (`acquireLock`/`releaseLock`/`withLock`/`withLockSoft`) with stale-lock recovery + `Atomics.wait` sleep. |
| `deep-freeze.js` | `kernel/_lib` | Pure iterative (explicit-stack) recursive `Object.freeze`, cycle-safe + depth-safe. |
| `jsonl-read.js` | `kernel/_lib` | Bounded JSONL reader (byte cap + backward-scan record cap + tail-read), advisory/never-throws. |

## Per-file analysis

### `record-store.js`

- **Purpose** — The provenance state-chain store: one JSON file per record at `<stateDir>/<runId>/records/record-<txid>.json`. Content-addressed by `transaction_id`; also queryable by `post_state_hash` (the STATE-chain edge K9 walks) and `idempotency_key` (INV-22 dedup). SHADOW-fed by four live producers (`spawn-close-resolver.js`, `trampoline.js`, `stage-candidate.js`, `integrator.js`).
- **Imports / consumes** — `fs`, `os`, `path`; `./atomic-write` (`writeAtomicString`); `./deep-freeze` (`deepFreeze`); `./transaction-record` (`computeTransactionId`, `validateTransactionRecord`, `deriveIdempotencyKey`, `isBootstrapSentinel`); `./path-canonicalize` (`checkWithinRoot`, `isSafePathSegment`). Reads `process.env`-independent default `~/.claude/spawn-state`. Reads record files from disk via `loadRecordFile`.
- **Consumers** — kernel: `record-locate.js`, `record-scan.js` (constants only), `integrator.js`, `stage-candidate.js`, `_stage-helpers.js`, `spawn-close-resolver.js`, `quarantine-promote.js`, `provenance-walk.js`, `provenance-projections.js`, `route-decide.js`; runtime: `trampoline.js`, `decompose-run.js`, `safe-segment.js`; Lab: `manage-proposal/*` (`promote`, `store`, `lifecycle`, `crossrun-load`, `recall-suppression`), `verdict-attestation/enrich-from-spawn-state.js`, `negative-attestation/store.js`, `causal-edge/store.js`; plus broad test coverage.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes (files, refs, stdout/JSON) | state changes / side effects |
|---|---|---|---|---|---|
| `isSafeRunId` | internal | runId path-segment safety (S1b) | `runId`; delegates to `isSafePathSegment` | none | none (pure) |
| `recordStoreDir` | exported | derive `<base>/<runId>/records` dir | `{runId, stateDir}` | none | none (pure path build) |
| `recordFilePath` | internal | derive `record-<txid>.json` path | `transactionId`, `opts` | none | none (pure) |
| `isGenesisPositionRecord` | internal | detect genesis-position record | `record.prev_state_hash`; `isBootstrapSentinel` | none | none (pure) |
| `appendRecord` | exported | validate + integrity-check + dedup + write one record | `record`, `{runId, stateDir}`; reads run dir for dedup scan | writes `record-<txid>.json` via `writeAtomicString`; `mkdirSync` (mode `0o700`) | creates dir + file; INV-22 dedup short-circuit (no write on replay); returns `{ok, file, transaction_id, deduped, reason}`; never throws |
| `loadRecordFile` | internal | parse + validate + content-verify + deep-freeze one file | `file`; `fs.readFileSync`; `validateTransactionRecord`, `computeTransactionId`, `deepFreeze` | none | returns a deep-frozen record or `null` (fail-soft); no disk mutation |
| `readById` | exported | read by `transaction_id` | `transactionId`, `opts`; reads one file | none | returns frozen record or `null`; hex-gate → zero fs reach on bad key |
| `readByPostStateHash` | exported | read by `post_state_hash` (K9 seam) | `postStateHash`, `opts`; `readdirSync` + per-file load | none | per-call linear scan; returns first match or `null` |
| `readByIdempotencyKey` | exported | read by verified `idempotency_key` (dedup seam) | `key`, `opts`; `readdirSync` + per-file load + `deriveIdempotencyKey` re-verify | none | per-call linear scan; returns first content-verified match or `null` |
| `listByRun` | exported | list all valid records in a run | `opts`; `readdirSync` + per-file load | none | returns array (possibly empty); fail-soft |

- **File-level notes** — The security model is unusually well documented and (verified against the code) largely sound: the `HEX64` gate fires before any `path.join`; `isSafeRunId` rejects traversing runIds on every path; `checkWithinRoot` is anchored to `base` (not the derived dir) so a relocated store is caught; and `loadRecordFile` is the *single read chokepoint* enforcing the three-part content-address verify-on-read ((a) type+shape, (b) filename↔field, (c) field↔content S5-re-hash) plus a terminal `deepFreeze`. `appendRecord` validates *first*, then integrity-checks, then dedups, then writes — order is load-bearing and correctly implemented. The file is 472 lines (well under the 800 ceiling), but several functions are documentation-heavy; `appendRecord` is ~90 lines of which ~half is comments. Coupling to `transaction-record` hashing is forward-coupled (M1): any new producer MUST reuse `computePostStateHash`/`computeContentHash` verbatim or the value-equality joins break silently.

### `record-locate.js`

- **Purpose** — `findRecordRun(txid)`: the record-store is run-scoped with no cross-run index, so this scans every run dir and returns the run that holds `txid` as a *valid* record — used so a manage-op TOMBSTONE is appended into the same run as its target. Fail-closed on `>1` match.
- **Imports / consumes** — `fs`, `os`, `path`; `./record-store` (`readById`); `./path-canonicalize` (`checkWithinRoot`, `isSafePathSegment`). Default root `~/.claude/spawn-state`.
- **Consumers** — `manage-proposal/promote.js`, `manage-proposal/crossrun-load.js`, `record-scan.js` (sibling-user reference only, not a code dep), plus tests.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `findRecordRun` | exported | locate the run holding a valid `txid` | `txid`, `{stateDir}`; `realpathSync(base)`, `readdirSync(realBase)`, per-run `realpathSync` + `readById` | none | returns `{runId}` \| `{ambiguous:true, runs}` \| `null`; read-only |

- **File-level notes** — Hardened correctly: hex-gate before fs reach; `isSafePathSegment(run)` skips hostile basenames; `realpathSync` + `checkWithinRoot(realDir, realBase)` skip symlinked runs that escape the store; the *match test* delegates to `readById` so a decoy garbage `record-<txid>.json` fails to validate and is not a match; `>1` valid match returns `{ambiguous}` (never readdir-order roulette). One subtle inconsistency: `readById` is called with `stateDir: base` (the unresolved base) while the scope check used `realBase` — benign because `readById` re-runs its own `checkWithinRoot` against `base`, but it means the realpath-vouched `realDir` is not the path `readById` ultimately reads from (it re-derives from `base`). Tiny single-function file (59 lines).

### `record-scan.js`

- **Purpose** — Two cross-run, mtime-windowed, read-only scans that feed the circuit breaker's kernel-store denial sources: `scanCommittedOps` (committed destructive mints TOMBSTONE/SUPERSEDE under `<run>/records/`) and `scanRejectEvents` (integrator-decided candidate rejects under `<run>/reject-events/`). Windowing is on FS `mtime` (NOT a record field, because the only timestamp field is caller-chosen AND content-hashed, so content-addressing would authenticate a back-dated value).
- **Imports / consumes** — `fs`, `os`, `path`; `./path-canonicalize` (`checkWithinRoot`, `isSafePathSegment`); `./reject-event-store` (`REJECT_EVENT_FILE_RE`, `RECORD_KIND`, `REJECT_EVENT_OUTCOMES`). Default root `~/.claude/spawn-state`.
- **Consumers** — `circuit-breaker/project.js`, `manage-proposal/promote.js`, `attribution/bootcamp-gates.js`, `route-decide.js`, `reject-event-store.js`, plus tests.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `scanCommittedOps` | exported | count committed ops in `opClasses` with `mtime > sinceMs` | `{opClasses, sinceMs, stateDir}`; `realpathSync`, `readdirSync`, per-file `lstatSync` + `readFileSync` + `JSON.parse` | none | returns `[{transaction_id, operation_class, mtime_ms}]`; **throws** on non-ENOENT base error (fail-closed); per-run/file errors skipped |
| `scanRejectEvents` | exported | enumerate reject-events with `mtime > sinceMs` | `{sinceMs, stateDir}`; same fs surface, `reject-events/` subdir | none | returns `[{reject_event_id, outcome, mtime_ms, run_id}]`; same throw/skip granularity |

- **File-level notes** — The fail-granularity is the core invariant and is correct: ABSENT store (ENOENT) → `[]` (clean-empty), UNREADABLE base (EACCES/ENOTDIR/ELOOP) → THROW (consumer fails closed), per-run/file errors → skip. The two walks are deliberately *duplicated, not extracted* (rule-of-three unmet; the architect VERIFY note argues refactoring a shipped halt-only control risks regressing the gate in the unsafe under-count direction). Hardening is symmetric across both: `isSafePathSegment` + `realpathSync` + `checkWithinRoot`, the CodeRabbit `#302` subdir `lstatSync(...).isDirectory()` gate (a symlinked `records/`/`reject-events/` subdir is rejected outright), `lstat`-not-`stat` per file (planted symlink skipped), `MAX_SCAN_FILE_BYTES` size-skip before read. The halt-only argument (a forged/extra record only OVER-counts → OVER-halts → narrows → safe) is the load-bearing reason no content-verify is paid here. **`scanCommittedOps` does NOT validate `rec.transaction_id`** before pushing it into the return shape (see Findings) — benign today because the only consumer maps it away to `mtime_ms`, but it surfaces an unverified attacker-assertable field.

### `transaction-record.js`

- **Purpose** — The K2 envelope helper: pure hash computation (`computeTransactionId`, `computeGenesisHash`, `computePostStateHash`, `computeContentHash`, `computeIdempotencyKey`), the content-address re-derivation (`deriveIdempotencyKey`), classification (`isStateChanging`, `isBootstrapSentinel`), the lenient runtime validator (`validateTransactionRecord`), and a schema-cache control (`clearSchemaCache`). Re-exports `canonicalJsonSerialize` for back-compat.
- **Imports / consumes** — `crypto`, `fs`, `path`; `./canonical-json` (`canonicalJsonSerialize`). Reads `../schema/transaction-record.schema.json` (cached at first validate).
- **Consumers** — Very broad: kernel (`record-store`, `reject-event-store`, `manage-op-record`, `integrate-merge`, `quarantine-promote`, `k9-promote-deltas`, `integration-record`, `spawn-close-resolver`, `stage-candidate`, `integrator`), runtime (`trampoline`, `decompose-run`), Lab (`verdict-attestation/enrich-from-spawn-state`, `manage-proposal/store`, `causal-edge/{enums,store}`), plus extensive tests.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `loadSchema` | internal | load + memoize the JSON schema | `../schema/transaction-record.schema.json` via `readFileSync` | none | mutates module-level `_schemaCache` (memo) |
| `computeTransactionId` | exported | fixed-point sha256 of record minus its id field | `record`; `canonicalJsonSerialize` | none | throws `TypeError` on non-object; may throw via canonical-json bound |
| `computeGenesisHash` | exported | sha256 of `GENESIS\|ver\|scope` | `schemaVersion`, `scope` | none | throws `TypeError` on bad inputs (pure) |
| `computePostStateHash` | exported | sha256 of `POST_STATE\|treeSha` (LOCKED) | `treeSha`; `GIT_SHA_RE` | none | throws `TypeError` if not 40/64-hex (pure) |
| `computeContentHash` | exported | sha256 binding spawn identity (null-safe) | `{postStateHash, writerSpawnId, headAnchor}`; `canonicalJsonSerialize` | none | no throw on null postStateHash; may throw via canonical-json bound |
| `computeIdempotencyKey` | exported | sha256 of the 4 dedup inputs | `{writerPersonaId, operationClass, contentHash, prevStateHash}` | none | throws `TypeError` if any of the 4 is falsy |
| `deriveIdempotencyKey` | exported | re-derive a record's key from its own body | `record` (4 fields + post_state_hash) | none | returns key or `null` (fail-closed on missing input / hash-bound throw) |
| `isStateChanging` | exported | classify op as state-changing | `operationClass` | none | pure boolean (CREATE/APPEND/SUPERSEDE/TOMBSTONE) |
| `isBootstrapSentinel` | exported | match the 3 bootstrap-evidence sentinels | `ref`; `BOOTSTRAP_SENTINEL_PATTERNS` | none | pure boolean |
| `validateTransactionRecord` | exported | lenient runtime schema+structural validation | `record`, `{isGenesisPosition}`; `loadSchema` | none | returns `{valid, errors?}`; may trigger `loadSchema` memo write; never throws |
| `clearSchemaCache` | exported | invalidate the memoized schema | none | none | sets `_schemaCache = null` |

- **File-level notes** — `computeContentHash` carries a *documented but unprobed harness assumption* (the false-merge defense rests on `writerSpawnId`/agentId being unique per spawn; the comment itself flags this as a deferred Runtime-Claim Probe — see Findings). The validator is intentionally *lenient* (no `additionalProperties:false`, preserving forward-compat) and *spot-checks* the highest-value fields rather than loading a full JSON-schema library — a YAGNI-justified shortcut, but it means the schema's full constraint set is NOT enforced at runtime (only `required`, two enums, four hex patterns, and the array/object shape gates added in PR-4 hardening). `_schemaCache` is module-level mutable; the file itself flags the Worker-thread race as benign (a redundant `readFileSync`, not corruption). 491 lines; all functions under 50 lines except `validateTransactionRecord` (~118 lines including comments — see Findings).

### `canonical-json.js`

- **Purpose** — Pure, stateless canonical JSON serialization (sorted keys, no whitespace) — the byte-identical substrate for all content hashing. Extracted from `transaction-record.js` so non-state callers (Lab advisory stores) can depend on the encoding rule without importing the kernel state module.
- **Imports / consumes** — none (pure leaf). Constants `MAX_CANONICAL_DEPTH=100`, `MAX_CANONICAL_NODES=10000`.
- **Consumers** — Very broad across kernel/runtime/Lab (route-decide, enum-validate, transaction-record, evolution-snapshot-read, free-string-checks, jsonl-read, recency-decay, and many Lab stores). It is the single most reused leaf in scope.
- **Functions**

| name | kind | purpose | consumes (params) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `canonicalJsonSerialize` | exported | sorted-key, whitespace-free canonical string with depth+node bounds | `value` | none | throws controlled `TypeError` past depth (100) or node (10000) bound; otherwise pure |
| `walk` | internal (closure) | recursive depth/node-bounded walk | `v`, `depth`; closed-over `nodeCount` | none | increments closure-local `nodeCount`; recurses |

- **File-level notes** — Correct and tight (58 lines). The dual bound (depth → stack-overflow DoS; nodes → wide-structure CPU DoS) is the documented hardening, and both throw a *controlled* `TypeError` that callers catch and fail-closed (`appendRecord` → `record-uncomputable`, `deriveIdempotencyKey` → `null`). The single forward-coupling risk (M1) is that any byte drift here silently breaks idempotency dedup substrate-wide — flagged in the header, no code defect. `walk` itself is genuinely recursive (not the explicit-stack form `deep-freeze.js` uses), but the depth bound (100) caps native-stack risk well below the ~10K JS recursion limit.

### `atomic-write.js`

- **Purpose** — The shared hardened atomic file-write primitive (`writeAtomic` JSON / `writeAtomicString` raw), via tmp+rename, with symlink-target preservation (FIX-H3) and foreign-uid symlink-redirect containment (B2).
- **Imports / consumes** — `fs`, `path`, `crypto`; `./safe-resolve` (`currentUid`). No env reads.
- **Consumers** — Extremely broad (40+ sites): every store/WAL/journal in kernel/runtime/Lab plus hooks. `writeAtomicString` is the write backend for `record-store.js` and `wal-append.js`.
- **Functions**

| name | kind | purpose | consumes (params, files) | writes (files) | state changes / side effects |
|---|---|---|---|---|---|
| `_tmpSuffix` | internal | collision-resistant tmp suffix | `process.pid`, `process.hrtime.bigint()`, `crypto.randomBytes(6)` | none | none (returns string) |
| `_foreignOwned` | exported | PURE: is lstat owned by a different uid? | `stat`, `selfUid` | none | none (pure; null stat/uid → false) |
| `_resolveForAtomicWrite` | internal | resolve symlink chain; refuse foreign-uid redirect | `filePath`; up to 10× `lstatSync`/`readlinkSync`; `currentUid` | none | returns resolved path (or original on foreign refusal) |
| `writeAtomic` | exported | atomically write JSON | `filePath`, `data`; `_resolveForAtomicWrite` | tmp file + `renameSync` to target; `mkdirSync` parent | creates dir + file; best-effort `unlinkSync(tmp)` on error then re-throw |
| `writeAtomicString` | exported | atomically write a string | `filePath`, `str`; `_resolveForAtomicWrite` | tmp file + `renameSync`; `mkdirSync` parent | same as `writeAtomic`; re-throws original error |

- **File-level notes** — `_resolveForAtomicWrite` walks the symlink chain manually (10-hop bound) so a partially-broken chain still resolves; the B2 foreign-uid containment refuses a redirect to a foreign-owned target and writes the original path instead. The documented residual (a symlink to a non-existent target is undecidable → still followed, but only ever creates a new writer-owned file) is honestly stated and benign. **`writeAtomic`/`writeAtomicString` do NOT set a mode on the `mkdirSync` parent dir** — callers that need `0o700` (like `record-store.appendRecord`) pre-create the dir hardened first; this is correct but a foot-gun for new callers (see Findings). Note `mkdirSync` here uses default mode, distinct from `record-store`'s explicit `DIR_MODE`.

### `wal-append.js`

- **Purpose** — Shared append-only JSONL-WAL append: read-existing + newline-normalize + atomic tmp+rename rewrite (INV-19 byte-prefix preserved). Caller chooses fail-soft (resolver) vs fail-hard (recovery-sweep).
- **Imports / consumes** — `fs`; `./atomic-write` (`writeAtomicString`).
- **Consumers** — `spawn-close-resolver.js`, `recovery-sweep.js`, `stage-promote.js`, `stage-candidate.js`, `post-spawn-resolver.js`, plus the INV-19 test.
- **Functions**

| name | kind | purpose | consumes (params, files) | writes (files) | state changes / side effects |
|---|---|---|---|---|---|
| `appendWalRecord` | exported | append one record to a JSONL WAL | `walPath`, `record`, `{failSoft}`; `fs.readFileSync(walPath)` | rewrites whole WAL via `writeAtomicString` (prior bytes + record + `\n`) | returns `true`/`false` (failSoft) or throws (fail-hard); builds new string (no record mutation) |

- **File-level notes** — Correct: the missing-tail-newline normalization prevents fusing two JSON objects across a torn final line. This is a *read-modify-rewrite* append (O(file) per append, NOT O_APPEND), and the header explicitly delegates concurrency to a caller-held K13 lock — i.e. unlocked concurrent appends would race (last writer wins, losing the other's record). That is a documented contract, not a defect, but it is a sharp edge for any future caller that appends without the lock (see Findings). Tiny (64 lines).

### `lock.js`

- **Purpose** — PID-based advisory file lock with stale-lock recovery, `Atomics.wait` true-sleep (busy-wait fallback), and verify-after-write theft detection. Four exports: `acquireLock`, `releaseLock`, `withLock` (exit-on-fail), `withLockSoft` (return-on-fail, for hooks).
- **Imports / consumes** — `fs`, `path`. Builds a 4-byte `SharedArrayBuffer`/`Int32Array` at module load (guarded). Writes to `process.stderr` for one-time diagnostics.
- **Consumers** — Very broad (25+ sites): Lab stores, runtime orchestration (registry, tree-tracker, kb-resolver, budget-tracker, pattern-recorder, …), kernel hooks + `integrator.js`, `k13-serial-enforcer.js`, plus the lock test.
- **Functions**

| name | kind | purpose | consumes (params) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `_waitSleep` | internal | sleep `sleepMs` (Atomics.wait or busy-wait), NaN-guarded | `sleepMs`; module `_WAIT_INT32` | one-time `stderr` diagnostic | blocks the thread; sets `_UNEXPECTED_WAIT_RESULT_LOGGED`/`_SAB_FALLBACK_LOGGED` once |
| `acquireLock` | exported | acquire a PID lock with stale recovery + verify-after-write | `lockPath`, `{maxWaitMs, sleepMs}`; reads lockfile | `mkdirSync` parent; `writeFileSync(lockPath, pid, {flag:'wx'})`; `unlinkSync` on stale/self-PID reclaim | creates/reclaims lockfile; returns `true`/`false`; spins until timeout |
| `releaseLock` | exported | delete the lockfile | `lockPath` | `unlinkSync(lockPath)` | removes lockfile (ignores error) |
| `withLock` | exported | acquire + run + release; exit(2) on fail | `lockPath`, `fn`, `opts` | via `acquireLock`/`releaseLock` | **`process.exit(2)`** on acquire-fail; runs `fn` in try/finally; `console.error` |
| `withLockSoft` | exported | soft sibling: `{ok:false}` on fail (no exit) | `lockPath`, `fn`, `opts` | via `acquireLock`/`releaseLock` | returns `{ok, value/reason}`; `fn` throw still releases + propagates |

- **File-level notes** — The verify-after-write theft detection (read back the lockfile; if it doesn't hold our PID we were stolen) and the empty-content-is-transient (don't unlink) fix are subtle but correctly reasoned (the documented T108 contention bug). The self-PID reclaim (treat a same-PID lock as a crashed prior incarnation and reclaim) is intentional. **`withLock` calls `process.exit(2)` on acquire failure** — appropriate for CLI consumers but lethal in a hook context (which is exactly why `withLockSoft` exists); a hook accidentally using `withLock` would kill the hook process. The busy-wait fallback path (`while (Date.now() < end) {}`) burns CPU but only when `SharedArrayBuffer` is unavailable. 218 lines; `acquireLock` is the only function approaching the comment-heavy length threshold (~88 lines, mostly comments).

### `deep-freeze.js`

- **Purpose** — Pure recursive `Object.freeze` via an explicit-stack iterative walk, cycle-safe (WeakSet) and depth-safe (no native recursion). Fixes the `#266` shallow-freeze recurrence (a top-level freeze left nested arrays/objects mutable).
- **Imports / consumes** — none (pure leaf).
- **Consumers** — `record-store.js` (the in-scope chokepoint), `reject-event-store.js`, plus Lab read paths (`trace-store`, `recall-graph-store`, `authorship-store`, `hardening-signal-store`, `recall-edge-store`) and tests.
- **Functions**

| name | kind | purpose | consumes (params) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `deepFreeze` | exported | iteratively deep-freeze a value in place | `value` | none | **mutates the input graph** (freezes the same references in place); returns the same value |

- **File-level notes** — Correct and well-reasoned: the WeakSet is BOTH the cycle guard AND the `#266` fix (an already-frozen node is still visited so its possibly-unfrozen children get frozen — the prior `Object.isFrozen` short-circuit left children latent). The explicit stack bounds depth by heap, not the ~10K call-stack limit, so a hostile deep `JSON.parse` graph freezes without `RangeError`. The one semantic caveat (documented): it freezes *in place* — it is a mutation of the input by design (the only "mutation" in the cluster that is intentional and contract-stated). 65 lines.

### `jsonl-read.js`

- **Purpose** — Bounded JSONL reader: byte cap (with hard 256MB ceiling), backward-scan record cap, and tail-read for oversized files. Advisory — never throws; returns newest-by-file-position records. Built so a flooded/hand-written ledger never blanks an advisory store (the prior `readFileSync` >512MB throw → catch → `[]` wipe).
- **Imports / consumes** — `fs`. Constants `DEFAULT_MAX_BYTES=64MB`, `HARD_MAX_BYTES=256MB`, `DEFAULT_MAX_RECORDS=10000`. (Header references the canonical-json precedent; no code import of it.)
- **Consumers** — Lab stores (`manage-proposal/store`, `negative-attestation/store`, `causal-edge/store`), kernel (`enum-validate`, `provenance-walk`, `free-string-checks`, `evolution-snapshot-read`), plus its test.
- **Functions**

| name | kind | purpose | consumes (params, files) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `warn` | internal | best-effort stderr warn | `name`, `msg` | `process.stderr.write` (guarded) | one stderr line; never throws |
| `fmtBytes` | internal | human-format a byte count | `n` | none | pure |
| `lastLines` | exported | last `max` non-empty lines via backward scan | `text`, `max` | none | pure; O(bytes in last `max` lines) |
| `readTailText` | exported | read last `maxBytes` bytes as utf8, drop partial leading line | `filePath`, `size`, `maxBytes`; `openSync`/`readSync`/`closeSync` | none | opens+closes an fd (try/finally); returns bounded string |
| `readJsonlBounded` | exported | bounded JSONL → parsed array | `filePath`, `{maxRecords, maxBytes, name}`; `statSync`, `readFileSync`/`readTailText` | none | `warn` on stat/read anomaly; returns array; never throws |

- **File-level notes** — The memory-safety reasoning is sound: the `HARD_MAX_BYTES` clamp survives a hostile `maxBytes:Infinity` override (the M-1 fix — a bad caller can shrink the window but never disable the ceiling); the backward-scan `lastLines` avoids `split()` materializing all lines (the H-1 ~1GB-RSS fix); the tail-read uses a `Buffer` so a >maxBytes string is never materialized. The fd in `readTailText` is correctly closed in a `finally`. Honest caveat (documented): "newest" is *positional*, not `recorded_at`-sorted — correct only for a single-writer append-only ledger. 133 lines.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | function | smell | `record-scan.js:141` | `scanCommittedOps` pushes `rec.transaction_id` into the return shape **without** the type/hex validation every other field receives (`operation_class` is `wanted.has`-gated, `mtime_ms` is from `lstat`). The raw, attacker-assertable `transaction_id` from an unvalidated JSON body is surfaced verbatim. Benign *today* only because the sole consumer (`circuit-breaker/project.js:158`) maps it away to `mtime_ms`; the comment claims the scan reads "`operation_class` + `mtime` only," but it also emits `transaction_id`. A future per-record consumer that trusts this field re-opens the back-dating/forgery surface the mtime-windowing was designed to avoid. Either drop the field from the return or hex-gate it. |
| MEDIUM | function | smell | `transaction-record.js:330-448` | `validateTransactionRecord` is ~118 lines — over the 50-line fundamentals ceiling. It mixes test-marker rejection, required-field check, enum spot-checks, hex spot-checks, the PR-4 shape gates (string-or-null, array-of-string, object-or-null) and the A10/GP4 semantic rules. Extracting the per-field shape gates into a small `validateHashFedShapes(record, errors)` helper would restore the ceiling and isolate the PR-4 hardening from the v6 semantic rules. |
| MEDIUM | function | logical-fallacy | `transaction-record.js:152-159` | `computeContentHash`'s false-merge defense rests on an **unprobed premise**: that the harness `agentId` (`writerSpawnId`) is unique per spawn. The comment itself flags this as "not a written guarantee" and a "deferred Runtime-Claim Probe." Because `head_anchor` is null in every live producer and `operation_class`/genesis-`prev` are constant, the live `idempotency_key` reduces to `f(persona, post_state_hash, writer_spawn_id)`; if agentId is ever reused, two genuinely-distinct same-persona spawns on an identical tree collapse to one key and one is silently dedup-dropped. The mitigation (fold a per-spawn entropy source) is identified but not implemented — the premise gating dedup correctness is unverified per the repo's own Runtime-Claim-Probe discipline. |
| LOW | function | optimization | `record-store.js:251-263` | `appendRecord`'s dedup (`readByIdempotencyKey`) → write is not atomic — a TOCTOU window exists between the dedup scan and `writeAtomicString`. It is **benign by construction** (two concurrent same-key appends derive the *same* `transaction_id`, so both write byte-identical content to the same `record-<txid>.json` via tmp+rename — the second clobber is a no-op), and the live producer (`integrator.js`) holds a K13 lock anyway. Worth an inline note that the safety rests on the content-address collision, so a future change that makes the filename non-content-derived would introduce a real race. |
| LOW | function | optimization | `record-store.js:251` + `loadRecordFile:312` | The INV-22 dedup scan calls `readByIdempotencyKey`, which funnels every candidate through `loadRecordFile` (now re-running `computeTransactionId` per file for the S5-on-read verify) AND then re-derives `deriveIdempotencyKey` per match candidate — so an append pays O(n) full-record re-hashes over the run dir, and a hit re-derives the key twice (once in `loadRecordFile`'s S5, once in the `deriveIdempotencyKey` match test). For large runs this is the documented deferred index optimization (YAGNI-acknowledged), but the double-derive is avoidable today. |
| LOW | file | smell | `record-locate.js:52` | `readById(txid, { runId: run, stateDir: base })` is called with the **unresolved** `base`, while the symlink-escape vouching used `realDir`/`realBase`. It is safe (readById re-runs `checkWithinRoot` against `base`), but the realpath-vetted `realDir` is discarded — the path that was security-checked is not the path that is read from. A one-line consistency note (or passing the resolved run) would remove the cognitive seam the in-file comment itself calls out as a deviation from `record-scan.js`. |
| LOW | function | smell | `atomic-write.js:148,172` | `writeAtomic`/`writeAtomicString` `mkdirSync` the parent with the **default** mode (no `0o700`), unlike `record-store.appendRecord` which pre-creates the dir with `DIR_MODE`. The header documents this ("does NOT set DIR_MODE"), but it is a foot-gun: any new caller that writes identity-bearing records via this primitive without pre-hardening the dir gets a world-traversable parent. A `{ mode }` option (defaulting to current behavior) would let callers opt in without re-implementing the pre-create dance. |
| LOW | file | smell | `wal-append.js` (whole) | `appendWalRecord` is a read-modify-rewrite (O(file) per append) that **delegates all concurrency safety to a caller-held lock** (documented). There is no in-function guard or warning if called unlocked; an unlocked concurrent append silently loses a record (last-writer-wins on the full rewrite). Acceptable as a contract, but a sharp edge — a future caller that forgets the K13 lock gets silent data loss, not an error. Consider documenting the lock requirement in the JSDoc `@param`, not only the file header. |
| LOW | function | smell | `lock.js:191-196` | `withLock` calls `process.exit(2)` on acquire failure. This is correct for CLI/script consumers but is a latent hazard if any *hook* consumer uses it (it would terminate the hook process) — the entire reason `withLockSoft` was added. There is no guard preventing hook code from importing `withLock`; the safety is purely by-convention. Worth a JSDoc warning on `withLock` pointing hook authors to `withLockSoft`. |
| INFO | function | optimization | `lock.js:90-91` | The busy-wait fallback (`while (Date.now() < end) {}`) burns a CPU core for the sleep interval when `SharedArrayBuffer` is unavailable. Reachable only under hardened/`--no-shared-array-buffer` runtimes (logged once), so impact is bounded, but a `setTimeout`-free synchronous sleep alternative (e.g. a short blocking `Atomics`-less `fs` op) was not considered. Low priority given the rarity gate. |
| INFO | function | logical-fallacy | `transaction-record.js:443-445` | The GP4 rule rejects `DERIVED-VIEW-INVALIDATE` unless `commit_outcome === 'NOT_APPLICABLE'`, but `DERIVED-VIEW-INVALIDATE` is *not* in `isStateChanging`, so it never hits the A10 evidence-refs gate — correct per spec, but the two op-class branches (`isStateChanging` set at :272 and the enum list at :360) are maintained independently. A new op-class added to the enum but not to `isStateChanging` would silently skip A10. Not a current bug; a maintenance fragility (two sources of op-class truth). |
| INFO | substrate | smell | cluster-wide | Every reader/scanner is **fail-soft (null/`[]`)** and the safety story depends entirely on the *consumer* being fail-closed (K9 walk rejects on a read miss; the breaker over-halts on an over-count). This composition is documented and sound, but it is a substrate-level invariant enforced only by convention + comments, not by a type or a shared contract. A new consumer that treats a `null`/`[]` read as "clean/absent → proceed" (fail-open) would invert the safety direction silently. The `record-scan` throw-on-ambiguous-base is the one place this is structurally enforced; the readers are not. |
| INFO | function | smell | `transaction-record.js:489` | `_BOOTSTRAP_SENTINEL_PATTERNS` is exported "for testing only" — a test-only export on a heavily-imported kernel module. Harmless, but it widens the public surface; the test could exercise `isBootstrapSentinel` behaviorally instead of reaching the raw patterns. |

No CRITICAL or HIGH findings: the content-address verify-on-read (the `#273` family's three faces), the hex-gate-before-`path.join`, the runId/segment safety, the symlink+`realpath`+`checkWithinRoot` hardening, the depth/node bounds, the deep-freeze of read-back rows, and the bounded JSONL reader are all present and correctly implemented against the documented threat model. The residual integrity-vs-provenance gap (an open-writable store proves a record is self-consistent, not that the legitimate producer minted it) is real but explicitly conceded as the SHADOW/advisory posture and tracked for the signed/kernel-writer-edge follow-up; it is not a defect in *this* cluster's code.
