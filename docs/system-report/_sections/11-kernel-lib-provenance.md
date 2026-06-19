# Kernel `_lib`: provenance, integration & chain edges — `packages/kernel/_lib/`

> This cluster is the **kernel** (enforced-tier) provenance substrate: the pure builders and pure walks that mint, chain, validate, and read the content-addressed transaction-record ledger plus its two satellite stores (the reject-event ledger and the reputation-snapshot witness ledger). Every module here is a `_lib` leaf — small, single-responsibility, dependency-injected (git via a `runGit` seam, time via injectable `nowMs`/`nowIso`), and either PURE (no I/O: `lineage`, `provenance-walk`, `provenance-projections`, `integration-record`, `integrate-merge`, `manage-op-record`, `edge-attestation`) or a fail-soft FS store (`reject-event-store`, `evolution-snapshot-read`). The cluster is consumed by the kernel `spawn-state/integrator` (the production importer of `integrate-merge` + `integration-record` + `reject-event-store`), the `spawn-record` close hook (`evolution-snapshot-read`), and — across the K12 lab→kernel boundary — by `packages/lab/manage-proposal/*`, `packages/lab/causal-edge/*`, and `packages/lab/reputation/*`. Per the substrate's standing posture, most of this is SHADOW (it records/projects, it does not gate), and the trust properties it asserts are deliberately scoped to *integrity* not *provenance* (the documented `#273` family).

## Directory contents & nesting

All nine files live directly in `packages/kernel/_lib/` (no nested `_lib/` or `_spike/` subfolders within scope). The `_lib` folder itself is the kernel's "pure-leaf / fail-soft-store" tier, distinguished from `packages/kernel/spawn-state/` (the orchestrating hooks + CLIs that consume these leaves) and `packages/kernel/hooks/` (the only PreToolUse/PostToolUse-registered enforcement).

| File | Folder | One-line purpose |
|---|---|---|
| `integration-record.js` | `kernel/_lib` | Mints the NON-GENESIS chained integration transaction-record per clean merge (`buildChainedRecord`). |
| `integrate-merge.js` | `kernel/_lib` | DORMANT-on-ship git merge primitives (out-of-tree 3-way merge, `commit-tree`, CAS ref-advance) for the integrator. |
| `lineage.js` | `kernel/_lib` | K3 pure lineage primitive: single-edge builder + DAG-acyclicity scan (NO current production consumer). |
| `provenance-walk.js` | `kernel/_lib` | Pure bounded, cycle-safe walks: backward `prev_state_hash` STATE chain + transitive `evidence_refs` closure. |
| `provenance-projections.js` | `kernel/_lib` | Pure derived-lifecycle projections (`stale` / `archived` / `superseded` / `tombstoned`) + provenance-edge VIEW. |
| `edge-attestation.js` | `kernel/_lib` | ed25519 sign/verify primitive for the `confirmed-by` edge ledger (authenticated minter; fail-closed verify). |
| `manage-op-record.js` | `kernel/_lib` | Mints a genesis-rooted COMMITTED SUPERSEDE/TOMBSTONE manage-op record (the human-gated leave-shadow mint). |
| `reject-event-store.js` | `kernel/_lib` | Content-addressed reject-event ledger (the integrator's DENIAL-source producer); FS store isolated off the chain keyspace. |
| `evolution-snapshot-read.js` | `kernel/_lib` | A6 hot-path reputation-snapshot reader + the materialize witness ledger (write-then-witness). |

## Per-file analysis

### `integration-record.js`

- **Purpose** — Mint the integrator's non-genesis APPEND record per clean merge. It is the non-genesis parallel to quarantine-promote's genesis builders; it validates at the non-genesis position so a malformed `prevPost` fails fast at this boundary rather than as a cryptic K9 reject downstream.
- **Imports / consumes** — `require('./transaction-record.js')` for `computeTransactionId`, `computeContentHash`, `computeIdempotencyKey`, `validateTransactionRecord`. No fs, no env. Pure.
- **Consumers** — `packages/kernel/spawn-state/integrator.js:39` (`buildChainedRecord`, the live producer, default `chainRecordFn`); `packages/kernel/_lib/reject-event-store.js:85` imports the exported `KERNEL_INTEGRATOR_PERSONA` constant; `packages/lab/manage-proposal/promote.js` references the persona name in a comment; the unit test `tests/unit/kernel/_lib/integration-record.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `buildChainedRecord` | exported | Build + validate a non-genesis chained integration record | `opts.{prevPost, post, evidenceTxid, safeId, schemaVersion}`; `compute*`/`validate*` from `transaction-record` | returns a new finalized record object | none (pure); throws on missing `prevPost` or non-genesis validation failure |
| `KERNEL_INTEGRATOR_PERSONA` | exported const | The fixed kernel-assembly authoring identity `'kernel-loom-integrator'` | n/a | n/a | n/a |

- **File-level notes** — Correctly orders `computeContentHash` → `computeIdempotencyKey` → record assembly → `computeTransactionId` (LAST, so the id hashes the `idempotency_key` in and `appendRecord`'s `id === computeTransactionId` check passes — INV-22). Immutable construction (spread; never mutates `opts`). `head_anchor: null` and single-phase `COMMITTED` (no separate PENDING) are documented and consistent. `evidence_refs = [evidenceTxid]` is explicitly an A10-satisfying, R10-UNVERIFIED back-reference (not walked) — the comment is accurate (the integrator's `mintIntegrationRecord` does the real provenance read).

### `integrate-merge.js`

- **Purpose** — Three stateless, git-seam-injected primitives for the ordered integrator: out-of-tree 3-way merge (`mergeTreeWriteTree`), merge-commit construction (`commitMergedTree`), and atomic CAS ref-advance (`casAdvanceRef`). The load-bearing safety property: never touch the user's checked-out HEAD/working tree — the merge is pure plumbing (`merge-tree --write-tree` to a tree, never a checkout) and only ever advances `loom/integration`.
- **Imports / consumes** — None (no require). Git is injected via the `runGit` seam (args arrays, never a shell string — CWE-78 avoidance). No env, no fs.
- **Consumers** — `packages/kernel/spawn-state/integrator.js:35` (`mergeTreeWriteTree`, `commitMergedTree`, `casAdvanceRef`, `GIT_SHA_RE`); the unit test `tests/unit/kernel/_lib/integrate-merge.test.js` (drives real git in a temp repo). `parseConflictPaths` + `GIT_SHA_RE` exported "for the spec + future reuse".
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `requireSeam` | internal | Fail-fast when the injected `runGit` is not a function (DIP) | `runGit`, `fn` (name) | n/a | throws on a missing seam |
| `parseConflictPaths` | exported | Parse + dedup conflicted paths out of `merge-tree` CONFLICT stdout | `stdout` string | returns `string[]` | none |
| `unquoteGitPath` | internal | Strip `core.quotePath` double-quotes + unescape `\\ \" \t \n` | a path token | returns unquoted string | none (octal `\NNN` left as-is, documented as cosmetic) |
| `mergeTreeWriteTree` | exported | Out-of-tree 3-way merge; returns CLEAN/CONFLICT/ERROR tri-state | `opts.{mergeBase, ours, theirs, runGit}` | runs `git merge-tree --write-tree` via seam; returns result object | invokes git (read-only — produces a tree object in the object DB, no ref/working-tree change) |
| `commitMergedTree` | exported | Build a merge commit from a merged tree (no working tree) | `opts.{tree, parents, message, runGit}` | runs `git commit-tree`; returns `{ok, commit}` | writes a commit object to the object DB; throws on non-sha tree / non-array-or-empty parents / non-sha parent |
| `casAdvanceRef` | exported | Atomic CAS ref-advance / create via `update-ref <ref> <new> <old>` | `opts.{ref, newOid, oldOid, runGit}` | runs `git update-ref`; returns `{ok, created, reason, ...}` | MUTATES a git ref (the only state-changing primitive); throws on a non-`refs/` ref / non-sha `newOid` / bad `oldOid` |

- **File-level notes** — `GIT_SHA_RE` is the anchored 40-OR-64 hex alternation (correctly avoids admitting 41–63-hex garbage that a `{40,64}` range would). `mergeTreeWriteTree`'s `code`-absent fallback (Finding 1 in-code) defaults `{ok:false}`-without-a-code to `code 1` (conflict → quarantine, the safe-conservative route). The DORMANT-on-P3a claim in the header is now stale: `integrator.js` IS the production importer (the header even says P3c's integrator would be "the first production importer", which has since happened). `casAdvanceRef` conflates a stale-CAS loss with a ref-already-exists-on-create under one `reason:'cas-failed'` (see Findings) — the comment acknowledges both map to exit 128.

### `lineage.js`

- **Purpose** — K3 pure lineage primitive: build a single `{parent_state_id, session_id}` entry and verify a passed-in chain is acyclic. Pure, no I/O.
- **Imports / consumes** — None. Operates only on arrays passed by the caller. No env, no fs.
- **Consumers** — **NONE in production.** Grep across `packages/` finds no `require('./lineage')` / `buildLineageEntry` / `isAcyclicChain` call outside the module's own test (`tests/unit/kernel/` references via the test harness). The header's "Used by: K9 pre-commit (PR 3) ... K8 updatedInput payload assembly" is FALSE: K8 was CANCELLED (ADR-0012, `updatedInput` is inert on Agent spawns) and the K9 / `integrator` / `quarantine-promote` paths do not import this module.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `buildLineageEntry` | exported | Build a lineage entry; prompt-injection guard on empty `sessionId` | `parentStateId` (string\|null), `sessionId` (non-empty string) | returns a new 2-field object | throws on empty `sessionId` or non-string/non-null `parentStateId` |
| `isAcyclicChain` | exported | Linear-scan DAG-acyclicity check over a passed-in chain | `chain` array of `{state_id, parent_state_id}` | returns boolean | none (pure) |

- **File-level notes** — Logic is correct and defensively written: duplicate `state_id` → `false` (FAIL #7, prevents Map-overwrite erasure); per-walk `seenThisWalk` cycle detection with a cross-walk `verifiedAcyclic` cache for linear total work; dangling parent refs treated as acyclic-by-convention. The problem is purely that this is DEAD CODE with a stale "Used by" header (see Findings) — a maintainer reading the header would believe K9 depends on it.

### `provenance-walk.js`

- **Purpose** — The W0.0 bounded, cycle-safe transitive provenance walk. Supplies the STATE chain (backward `prev_state_hash` → predecessor `post_state_hash`) and the transitive `evidence_refs` closure that record-store's point-lookups + lineage's single-edge builder did not.
- **Imports / consumes** — None (pure over a passed-in record array). No env, no fs.
- **Consumers** — `provenance-projections.js:34` (`walkStateChain`, `collectEvidenceClosure`, `HEX64`); lab consumers via the legal lab→kernel direction: `lab/manage-proposal/{store,cli,crossrun-load}.js` import `HEX64`, `lab/manage-proposal/lifecycle.js` imports `indexByTransactionId`, `lab/causal-edge/walker.js` imports `DEFAULT_MAX_NODES`. The unit test `tests/unit/kernel/_lib/provenance-walk.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isRecord` | internal | Type-guard for a non-null non-array object | `r` | boolean | none |
| `clampMaxNodes` | internal | Resolve a positive `maxNodes` (default 10000) | `opts.maxNodes` | number | none |
| `indexByPostStateHash` | exported | Map `post_state_hash` → record (first-wins; skips non-hex/PENDING) | `records[]` | `Map` | none |
| `indexByTransactionId` | exported | Map `transaction_id` → record (first-wins) | `records[]` | `Map` | none |
| `walkStateChain` | exported | Backward STATE-chain walk, newest-first, bounded + cycle-safe | `startRecord`, `records[]`, `opts.maxNodes` | `object[]` | none; fail-soft (missing predecessor stops the walk) |
| `collectEvidenceClosure` | exported | BFS transitive `evidence_refs` closure (includes seed ids) | `startTxIds[]`, `records[]`, `opts.maxNodes` | `Set<string>` | none; bounded, cycle-safe |

- **File-level notes** — Cycle-safety verified empirically (self-loop → chain length 1; 2-cycle → terminates at length 2; multi-seed closure honors the cap in the seed phase per the VALIDATE M-fix at line 153). `HEX64` exported so projection consumers share the one definition (DRY). The `walkStateChain` `seenPost` set is seeded with `startRecord.post_state_hash` only when it is a string — a PENDING start (null `post_state_hash`) still follows ITS `prev_state_hash`, which is correct. Solid leaf.

### `provenance-projections.js`

- **Purpose** — W0.2 + W0.3 pure derived-lifecycle projections (re-derivable, NEVER stored per v6 §5a.1) and the provenance-edge VIEW. Produces the two kernel lifecycle states `stale` + `archived` (the other two — `conflicted` / `quarantined` — moved to the advisory Lab causal-edge store).
- **Imports / consumes** — `require('./provenance-walk')` (`walkStateChain`, `collectEvidenceClosure`, `HEX64`). Injectable `opts.nowMs` (the recency-decay precedent). No fs, no env.
- **Consumers** — `lab/manage-proposal/lifecycle.js:31` (`projectLifecycleState`); `manage-op-record.js` references the SUPERSEDE/TOMBSTONE `affected_records` convention in a comment; the unit test `tests/unit/kernel/_lib/provenance-projections.test.js`. Lab's `causal-edge/projections.js` documents its parallel design but reuses the *style*, not this module.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isRecord` | internal | Non-null non-array object guard | `r` | boolean | none |
| `findAffectedByOp` | internal | The `affected_records` set for COMMITTED ops of one class (DRY core) | `records[]`, `opClass` | `Set<string>` (64-hex) | none |
| `findSupersededTxids` | exported | COMMITTED SUPERSEDE targets | `records[]` | `Set<string>` | none |
| `findTombstonedTxids` | exported | COMMITTED TOMBSTONE targets | `records[]` | `Set<string>` | none |
| `parseTimestamp` | internal | `committed_at` \|\| `intent_recorded_at` → epoch ms or null | `record` | number\|null | none |
| `staleGiven` | internal | Stale check given a precomputed superseded set | `record`, `records[]`, `supersededSet`, `opts` | boolean | none |
| `archivableGiven` | internal | Archivable check given precomputed superseded + tombstoned sets | `record`, `records[]`, two sets, `opts` | boolean | none |
| `isStale` | exported | mark-stale projection (recomputes superseded set) | `record`, `records[]`, `opts` | boolean | none |
| `isArchivable` | exported | retention-archive projection (recomputes both sets) | `record`, `records[]`, `opts.{nowMs,retentionDays}` | boolean | none |
| `projectLifecycleState` | exported | Combined derived lifecycle with precedence | `record`, `records[]`, `opts` | string\|null | none |
| `buildProvenanceView` | exported | W0.3 read-side provenance-edge view (state chain + evidence) | `record`, `records[]`, `opts` | view object\|null | none |

- **File-level notes** — Correctly honest-bounding: only invalidations the substrate witnessed AS A COMMITTED transaction are detected (the `isStale` bounding-negative is documented). The HEX64-only `direct_evidence` filter intentionally excludes `USER_INTENT_AXIOM:<sha256>` sentinels and carries an explicit "a future wave must NOT 'fix' this" warning. `projectLifecycleState` correctly hoists both sets once (the per-call recompute in `isStale`/`isArchivable` is the documented YAGNI BATCH NOTE at line 118). One subtlety: `archivableGiven` reads `record.transaction_id` without a string-type guard before `supersededSet.has(id)` (harmless — `Set.has(undefined)` is false — but inconsistent with `staleGiven`'s explicit `typeof id !== 'string'` guard). See Findings.

### `edge-attestation.js`

- **Purpose** — The ed25519 edge-attestation primitive (v-next Carry C W1): an authenticated minter that narrows the `#273` standing residual on the `confirmed-by` edge ledger by raising the forgery bar from "anyone who can call `deriveEdgeId`" to "a holder of the kernel private key". Pure kernel crypto — knows nothing about edges/lessons/the lab.
- **Imports / consumes** — `require('crypto')`. Env: `LOOM_EDGE_SIGNING_KEY` (private PEM), `LOOM_EDGE_VERIFY_KEY` (public PEM), read at call-time via `loadPrivateKey`/`loadPublicKey`. No fs.
- **Consumers** — `lab/attribution/recall-edge-store.js:56` (`isCanonicalBase64`, `SIG_ALG`); `lab/causal-edge/lesson-confirm.js:38` (`signEdgeId`, `verifyEdgeSig`, `hasVerifyKey`, `SIG_ALG`); several lab tests use `generateEdgeKeypair`/`signEdgeId`; the kernel test `tests/unit/kernel/edge-attestation.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isHex64` | internal | 64-lowercase-hex guard | `v` | boolean | none |
| `isCanonicalBase64` | exported | base64 round-trip check (malleability / parser-diff defense) | `s` | boolean | none; swallows decode errors → false |
| `loadPrivateKey` | internal | Resolve an ed25519 PRIVATE KeyObject (PINS ed25519) | `opts.privateKeyPem` \|\| `LOOM_EDGE_SIGNING_KEY` | KeyObject\|null | none; returns null on a non-ed25519 key (algorithm-confusion defense) |
| `loadPublicKey` | internal | Resolve an ed25519 PUBLIC KeyObject (PINS ed25519) | `opts.publicKeyPem` \|\| `LOOM_EDGE_VERIFY_KEY` | KeyObject\|null | none; no committed default → verify fails CLOSED |
| `generateEdgeKeypair` | exported | Fresh ed25519 keypair as PEM strings | none | `{publicKeyPem, privateKeyPem}` | generates a keypair (CPU) |
| `signEdgeId` | exported | base64 ed25519 signature over the `edgeId` string | `edgeId`, `opts` (key) | base64 string\|null | none; fail-soft → null (never throws) |
| `verifyEdgeSig` | exported | Verify a sig; fail-CLOSED | `edgeId`, `sigB64`, `opts` (key) | boolean | none; never accept-all (no key → false) |
| `hasVerifyKey` | exported | Whether a loadable ed25519 verify key is configured | `opts` | boolean | none |

- **File-level notes** — Security discipline is excellent and empirically verified: ed25519 pinned on the KEY (refuses a self-asserted alg / RSA-key confusion); canonical-base64 re-asserted here as defense-in-depth (probe: whitespace-tampered sig → verify false); everything fail-soft (sign → null, verify → false, never throws); verify fails CLOSED with no key. The `#273` honest scope (a same-uid forger holding the key can still co-forge) is correctly deferred to a deployment precondition (private key in the minter's env). No issues found beyond the documented honest-residual.

### `manage-op-record.js`

- **Purpose** — Mint a genesis-rooted COMMITTED SUPERSEDE/TOMBSTONE manage-op transaction-record (the kernel-side of the human-gated leave-shadow mint). Targets go in `affected_records`; `evidence_refs = [USER_INTENT_AXIOM:<approvalAxiomHash>]`; `post_state_hash` is NULL (a manage op advances no git tree — the honest choice).
- **Imports / consumes** — `require('./transaction-record')` (`computeGenesisHash`, `computeContentHash`, `computeIdempotencyKey`, `computeTransactionId`, `validateTransactionRecord`). Pure; no fs, no env.
- **Consumers** — `lab/manage-proposal/promote.js:43` (`buildManageOpRecord`, the orchestrator); tests `tests/unit/lab/manage-promote.test.js`, `manage-promote-crossrun.test.js`, and the kernel test `tests/unit/kernel/_lib/manage-op-record.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isHex64` | internal | 64-lowercase-hex guard | `v` | boolean | none |
| `buildManageOpRecord` | exported | Build + validate a genesis manage-op record | `o.{operationClass, affectedRecords, proposalId, runId, approvalAxiomHash, schemaVersion, nowIso}`; `transaction-record` primitives | returns a validated record object | none (pure); throws (fail-fast) on ANY invalid input |
| `PERSONA_ID` | exported const | `'lab:manage-promote'` (Lab-originated, un-attested writer) | n/a | n/a | n/a |

- **File-level notes** — Strong input validation at the boundary (all seven fields fail-fast). The `proposalId` 64-hex assertion enforces the colon-join unambiguity invariant (`writer_spawn_id = manage-promote:${proposalId}:${runId}`) rather than relying on a caller accident — even though `isSafePathSegment` permits a `:` in a `runId`, the fixed-width hex `proposalId` makes the tail unambiguous (hacker VERIFY M3, verified). `affected_records` is copied (`[...affectedRecords]`) — immutable. The TRUST residual (any same-uid caller could forge this un-attested writer; the `affected_records`-not-in-the-key poison is closed by `promote.js`'s exact-SET post-condition, NOT here) is honestly documented AND the consumer (`postConditionOk` in `promote.js:203`) was verified to enforce true exact-set equality (length + dedup-size + `every`-containment), not a subset `.includes`.

### `reject-event-store.js`

- **Purpose** — The v3.7 reject-event ledger: the trust-system's DENIAL-source producer. Records the two integrator-decided REJECT dispositions (`quarantined` from a merge CONFLICT; `provenance-rejected` from a clean merge whose own genesis is absent) as content-addressed, tamper-evident records. The absorb/clean side is deliberately NOT minted here. SHADOW (records, does not gate; the v3.8 breaker is its consumer).
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`; `./atomic-write` (`writeAtomicString`), `./deep-freeze` (`deepFreeze`), `./transaction-record` (`canonicalJsonSerialize`), `./path-canonicalize` (`checkWithinRoot`, `isSafePathSegment`), `./integration-record` (`KERNEL_INTEGRATOR_PERSONA`). Env: none directly (default state dir from `os.homedir()`).
- **Consumers** — `packages/kernel/spawn-state/integrator.js:48` (`buildRejectEvent`, `appendRejectEvent`, default `buildRejectEventFn`/`appendRejectEventFn`); `packages/kernel/_lib/record-scan.js:61` imports `REJECT_EVENT_FILE_RE`, `RECORD_KIND`, `REJECT_EVENT_OUTCOMES` (the v3.8 cross-run scanner — partial DIP); tests `reject-event-store.test.js`, `reject-event-scan.test.js`, `integrator-reject-ledger.test.js`, `lab/circuit-breaker/reject-event-source.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `rejectEventStoreDir` | exported | The isolated `<stateDir>/<runId>/reject-events/` dir path | `opts.{runId, stateDir}` | path string | none |
| `rejectEventFilePath` | internal | `reject-event-<id>.json` path (id must be pre-validated) | `rejectEventId`, `opts` | path string | none |
| `computeRejectEventId` | exported | Content-address = sha256(canonical body minus the id) | `record` | 64-hex string | none; throws (TypeError) on a non-object |
| `rejectEventShapeError` | internal | Validate the stable shape (kind/run_id/persona/safe_id/post_hash/outcome/evidence_refs) | `record` | error string\|null | none |
| `buildRejectEvent` | exported | Build a content-addressed reject-event (fail-fast) | `opts.{runId, safeId, candidatePostStateHash, outcome, schemaVersion}` | returns finalized record | none; throws on any invalid input |
| `appendRejectEvent` | exported | Append one file per content-address; idempotent; NEVER throws | `record`, `opts.{runId, stateDir}` | writes `reject-event-<id>.json` (atomic) | mkdir + atomic file write; returns `{ok,...}`; dedups |
| `loadRejectEventFile` | internal | Single read chokepoint: parse + S5-on-read re-hash + run-binding | `file`, `expectedRunId` | deep-frozen record\|null | reads a file; fail-soft → null |
| `readRejectEventById` | exported | Direct read by content-address (hex-gate, runId guard, scope check) | `rejectEventId`, `opts` | record\|null | reads a file |
| `listRejectEvents` | exported | List every valid reject-event in a run (the breaker's reader) | `opts` | `object[]` | reads a dir; skips invalid/tampered |

- **File-level notes** — Exemplary content-addressed-store hygiene that directly answers the checklist: (1) S5-on-read re-hash in `loadRejectEventFile` (lines 285-287) verifies CONTENT not just filename↔field; (2) a flipped `outcome` breaks the id → skipped (H2 defense); (3) deep-freeze on read (B3) closes the read-back-mutability gap; (4) `isSafePathSegment(runId)` runs BEFORE any `path.join` on every path (S1b), `checkWithinRoot` anchored to the STATE ROOT not the derived dir (avoids the record-store tautology trap, S1); (5) NO `recorded_at` field (the temporal signal is FS mtime — a field timestamp would be forgeable AND load-bearing); (6) read-side run-binding closes the cross-run plant. `evidence_refs = [candidatePostStateHash]` deliberately refines the v3.7 plan's literal genesis-txid (which isn't available on the provenance-reject path) — the comment is accurate. The honest residual (same-uid back-date-into-the-past at the FS layer) is documented as ContainerAdapter-bounded.

### `evolution-snapshot-read.js`

- **Purpose** — The A6 hot-path reputation-snapshot reader (the kernel side of the §3.6 Lab→Kernel data contract — read AS A FILE, never by importing the lab module, K12-clean) plus the v3.8b W2 witness ledger (write-then-witness provenance). Single source of truth for the cross-layer path + hash basis so writer and reader can't drift.
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`; `./canonical-json` (`canonicalJsonSerialize`); lazily `./jsonl-read` (`lastLines`), `./lock` (`acquireLock`/`releaseLock`), `./atomic-write` (`writeAtomicString`). Env: `LOOM_SNAPSHOT_MAX_BYTES`, `LOOM_EVOLUTION_SNAPSHOT_PATH`, `LOOM_LAB_STATE_DIR`, `LOOM_SNAPSHOT_WITNESS_PATH` (all read at call-time).
- **Consumers** — `packages/kernel/spawn-state/spawn-record.js:82` (`readEvolutionSnapshot`, the <50ms close hook, calls it bare/no-verify); `lab/reputation/materialize.js:26` (`resolveSnapshotPath`, `computeSnapshotHash`, `appendSnapshotWitness`); `lab/reputation/cli.js:25` (`readEvolutionSnapshot`, `resolveSnapshotPath`); tests `evolution-snapshot-read.test.js`, `lab/reputation/materialize.test.js`, `lab/cross-store-loop.test.js`, `spawn-record-a6.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `maxBytes` | internal | Resolve the byte cap (env-overridable, clamped to 1MB) | `LOOM_SNAPSHOT_MAX_BYTES` | number | none |
| `resolveSnapshotPath` | exported | The ONE snapshot path formula (writer+reader share it) | env | path string | none |
| `snapshotHashBody` | exported | Body minus `content_hash` (prototype-safe spread) | `snap` | object | none |
| `computeSnapshotHash` | exported | sha256 of the canonical hash-body | `snap` | 64-hex string | none; may throw via `canonicalJsonSerialize` bound (callers catch) |
| `fail` | internal | `{present:false, reason}` helper | `reason` | object | none |
| `resolveWitnessLedgerPath` | exported | The ONE witness-ledger path formula | env | path string | none |
| `computeWitnessId` | exported | sha256 of the whole witness body minus `witness_id` (`#273`) | `body` | 64-hex string | none |
| `readWitnessRowsSafe` | internal | FIFO-safe handle-bound bounded tail read of the witness ledger | `ledgerPath`; lazily `lastLines` | `object[]`\|null | opens+fstats+reads one fd; never blocks; never throws |
| `appendSnapshotWitness` | exported | Append a materialize-witness line (locked RMW, dedup, cap) | `input.{content_hash, generated_at, record_count, now}` | writes the witness ledger (atomic, under lock) | mkdir + lock + atomic write; FAIL-SOFT `{ok,...}` |
| `verifySnapshotProvenance` | exported | Was this content_hash witnessed? bounded tail scan, per-row id re-derive | `snapshotish`, `opts.ledgerPath` | `{witnessed, reason}` | reads the ledger; never throws |
| `readEvolutionSnapshot` | exported | Read + validate + self-verify the snapshot (hot path; never throws) | `pathOrOpts`; `maxBytes`; `computeSnapshotHash`; optionally `verifySnapshotProvenance` | result object | opens+fstats+reads one fd; fail-soft on every branch |

- **File-level notes** — The FIFO-hang defense is the standout: both `readWitnessRowsSafe` and `readEvolutionSnapshot` open ONE fd with `O_NONBLOCK`, `fstat` the BOUND fd to confirm `isFile()`, then read from that same fd — never re-open by name (which would reintroduce the statSync→readFileSync TOCTOU swap window). INV-22 self-verify (recompute the content hash, compare). The witness ledger is double-bounded (rows cap 1024 == read cap, the tail-window invariant; plus a 4MB byte bound for a same-uid flooder). The honest scope (integrity != authenticity: a hand-written snapshot self-hashes to `present:true`, and a same-uid forger can append a coherent witness) is documented and correct. Prototype-safety on the rest-spread is explicit (a hostile `__proto__` own-key is hashed faithfully, not set as a prototype). The hot path never pays for the witness machinery (lazy requires; `verifyProvenance` opt-in, the bare call's result shape is byte-identical). No correctness bug found; the only notes are minor (see Findings).

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | file | smell | `lineage.js:1-13, 97-100` | DEAD CODE + STALE COMMENT. `buildLineageEntry` / `isAcyclicChain` have NO production consumer (grep finds only the test). The header claims "Used by: K9 pre-commit (PR 3) to verify chain integrity ... K8 updatedInput payload assembly" — both false: K8 was CANCELLED (ADR-0012, `updatedInput` is inert on Agent spawns) and the K9/`integrator`/`quarantine-promote` paths do not import this module. A maintainer would wrongly believe K9 depends on it. Either wire it into the integrator's pre-commit chain check or mark it dormant/retire it; at minimum fix the "Used by" header. |
| MEDIUM | file | smell | `integrate-merge.js:5-19` | STALE "DORMANT / no production importer" header. The header says the module "SHIPS DORMANT: no production code imports it ... P3c's `integrator` is the first production importer" — `integrator.js:35` now IS that production importer. The DORMANT framing is no longer true and misleads a reader about whether the module is live (it is, on the kernel's most load-bearing path). |
| LOW | function | smell | `integrate-merge.js:247-252` | `casAdvanceRef` conflates two distinct exit-128 failures under one `reason:'cas-failed'`: a genuine stale/lost CAS (retry against the new tip) vs ref-already-exists on a CREATE (`oldOid==null`). The integrator branches only on `.ok`, so it is currently harmless, but a future caller that retries a CAS loss would also retry a create-collision (a different, non-retryable condition). Distinguishing the two reasons (parse the stderr, or branch on `created`-intent) would make the seam less foot-gun-prone. |
| LOW | function | smell | `integrate-merge.js:122-124` | Documented unbounded-stdout (Finding 6 in-code): `runGitDefault` caps only stderr (500 chars), so a `merge-tree` CONFLICT listing with very many files is held in full in `mergeTreeWriteTree`. Accepted for P3c's bounded use, but it is an unbounded-memory surface on a kernel path (the same byte-bound discipline `evolution-snapshot-read` enforces elsewhere). A stdout cap would close it. |
| LOW | function | optimization | `provenance-projections.js:132-154` | `isStale` and `isArchivable` each recompute `findSupersededTxids` / `findTombstonedTxids` — O(records) per call. The in-code BATCH NOTE (line 118) flags this as deferred-until-a-batch-consumer YAGNI. The lab consumer (`lifecycle.js`) calls `projectLifecycleState` (which hoists the sets once), so the un-hoisted public fns are the slow path only if a future batch consumer calls them directly per-record. |
| LOW | function | smell | `provenance-projections.js:103-107` | `archivableGiven` reads `const id = record.transaction_id` then `supersededSet.has(id)` without the `typeof id !== 'string'` guard that the sibling `staleGiven` (line 91-92) applies. Harmless today (`Set.has(undefined)` is `false`, so a record with no txid simply isn't treated as superseded/tombstoned), but the asymmetry is a latent inconsistency between two near-identical internal helpers. |
| INFO | function | optimization | `provenance-projections.js:166-181` | `projectLifecycleState` computes `findSupersededTxids` + `findTombstonedTxids` and then `staleGiven` re-scans the evidence closure while `archivableGiven` re-parses timestamps — all per single `record`. For a one-record projection this is fine; if a caller maps it over the whole run (the natural "list everything's lifecycle" view), the superseded/tombstoned sets are recomputed O(records) times. A `projectLifecycleStates(records)` batch variant that hoists the two sets once would be O(records) overall instead of O(records²). |
| INFO | function | smell | `reject-event-store.js:248-249` | `appendRejectEvent` does the idempotency read (`readRejectEventById`) and then `mkdirSync` + `writeAtomicString` — a TOCTOU window between the dedup-check and the write under concurrent same-run appends. Benign because the write target is the content-address (two racing identical events write byte-identical content to the same path, and `writeAtomicString` is atomic), so the worst case is a redundant write, never corruption. Noted for completeness, not a defect. |
| INFO | file | smell | `evolution-snapshot-read.js:1-32` | The header is unusually dense (~32 lines of design narrative before the first import). Accurate, but it crosses into the over-documentation a fresh reader must wade through; the load-bearing facts (FIFO defense, write-then-witness, integrity!=authenticity, hot-path lazy/opt-in) could be a 5-line summary with the rest in the wave plan. Pure readability, no behavior impact. |
| INFO | substrate | smell | cluster-wide | Two `HEX64`/`GIT_SHA_RE` definitions coexist by design across the cluster: `provenance-walk.HEX64` (64-only, exported for DRY reuse by projections + lab) and `integrate-merge.GIT_SHA_RE` (40-OR-64 alternation, for git shas). `manage-op-record`, `reject-event-store`, `edge-attestation`, and `evolution-snapshot-read` each re-declare a local 64-hex regex rather than importing `provenance-walk.HEX64`. The duplication is intentional (kept dependency-free / leaf-local) and each is correct, but it is five copies of the same literal; a shared `kernel/_lib/hex.js` would centralize it. Low value — flagged only as a DRY observation. |

> Verification notes: the cycle-safety of `walkStateChain`/`collectEvidenceClosure`, the canonical-base64 + ed25519-pinning behavior of `edge-attestation`, the exact-set post-condition in the `manage-op-record` consumer (`promote.js postConditionOk`), and the S5-on-read content verification in `reject-event-store` were each confirmed by direct probe or source read, not inferred. No CRITICAL/HIGH bug was found in this cluster — the security-load-bearing modules (`reject-event-store`, `edge-attestation`, `evolution-snapshot-read`, `manage-op-record`) all correctly verify content-on-read, fail closed where required, deep-freeze read-back, gate raw path segments before `path.join`, and honestly scope integrity-vs-provenance. The findings are dominated by stale "Used by"/"DORMANT" headers (the live-vs-documented drift class) and minor optimization/consistency smells.
