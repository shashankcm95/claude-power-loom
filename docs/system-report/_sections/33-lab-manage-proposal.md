# Lab manage-proposal: lifecycle, promote, store, suppression — `packages/lab/manage-proposal/`

> The manage-proposal cluster is the Evolution-Lab (advisory / SHADOW) substrate for human-disposable "manage" operations over kernel memory records — quarantine, content-dedup, cull, merge. It is a Layer-3 producer/consumer pair: a content-addressed append-only proposal ledger (`store.js`) plus thin op producers (`manage-ops.js`), pure projections (`projections.js`), a cross-layer lifecycle JOIN (`lifecycle.js`), a recall-class suppression VIEW (`recall-suppression.js`), and the ONE live-mutating path — the human-gated, flag-gated promote orchestrator (`promote.js`) that mints COMMITTED kernel `TOMBSTONE`/`SUPERSEDE` records. Everything is ADVISORY: 0 `hooks.json` refs (grep-confirmed SHADOW), every read path narrows-only, and the destructive mint is a no-op REFUSE unless `LOOM_MANAGE_ENFORCE=1`. The trust model is explicitly cooperative / writer-UNAUTHENTICATED (OQ-E): the human approving a proposal is the trust anchor; the store verifies INTEGRITY (content-address) on read, never PROVENANCE.

## Directory contents & nesting

All nine files live flat under `packages/lab/manage-proposal/` (no nested `_lib/` or `_spike/` subfolders in scope). Shared validation leaves live one layer up under `packages/kernel/_lib/` (lab to kernel imports are LEGAL per K12).

| File | Purpose (one line) |
|---|---|
| `cli.js` | The dogfood + human-disposition surface; parses argv, dispatches to the seven subcommands, JSON-on-stdout, exit codes. |
| `store.js` | The append-only proposal ledger: content-addressed create/dedup, durable disposition update, frozen reads, count + byte caps. |
| `enums.js` | Shared frozen op-type / disposition enums + re-export of the kernel `enum-validate` leaf; side-effect-free. |
| `manage-ops.js` | Thin presence-guarded CREATE producers (`quarantineRecord` + the multi-target `content-dedup`/`cull`/`merge`). |
| `projections.js` | Pure projections over the proposal set: `quarantinedRecords` (tiered) + `approvedOpsByRecord` (mint-feed). |
| `lifecycle.js` | Pure cross-layer JOIN: a kernel txid to a composed advisory verdict (kernel lifecycle state + approved manage-intent). |
| `crossrun-load.js` | The READER-side I/O assembly: locate a txid's run(s), load that run's content-verified records for the lifecycle JOIN. |
| `recall-suppression.js` | The recall-class retrieval-suppression VIEW: partition a candidate txid set into surfaced / suppressed / flagged. |
| `promote.js` | The leave-shadow MINT orchestrator: human-gated + flag-gated cross-run TOMBSTONE/SUPERSEDE mint with breaker + post-condition. |

## Per-file analysis

### `cli.js`

- **Purpose** — The CLI entry point and the human-disposition surface for the SHADOW manage-write loop. Seven subcommands: `quarantine`, `content-dedup`/`cull`/`merge`, `list`, `dispose`, `lifecycle`, `recall-filter`, `promote`. Pure routing + arg validation; all real work delegates to siblings.
- **Imports / consumes** — `./store` (`listProposals`, `updateDisposition`), `./manage-ops` (the four producers), `./enums` (`DISPOSITIONS`, `validateEnum`), `./lifecycle` (`manageLifecycleStatus`), `./crossrun-load` (`loadRecordsForTarget`), `./recall-suppression` (`recallSuppression`), `./promote` (`promoteProposal`), `../../kernel/_lib/provenance-walk` (`HEX64`). Reads `process.argv`. No direct env reads (the store reads env).
- **Consumers** — Invoked by humans / dogfood scripts as `node packages/lab/manage-proposal/cli.js <cmd>` (cited in `CHANGELOG.md`, `docs/SIGNPOST.md`, and multiple `packages/specs/plans/*.md`). `module.exports = { main, parseArgs }` — `main`/`parseArgs` are exported for tests; no production module imports the CLI.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs` | exported (internal helper) | Minimal `--flag [value]` parser; a flag with no following non-`--` value becomes boolean `true`. | `argv` array | none | none (pure) |
| `USAGE` (const) | internal | The usage string emitted on an unknown/missing command. | none | (string, written by `main`) | none |
| `emit` | internal | Write a pretty-printed JSON object + newline to stdout. | `obj` | `process.stdout` | stdout write |
| `fail` | internal | Write a `manage-proposal:`-namespaced error to stderr and `process.exit(1)`; avoids double-prefixing already-namespaced store errors. | `msg` | `process.stderr` | stderr write + `process.exit(1)` |
| `main` | cli-entry | Dispatch `argv[0]` to the matching subcommand; validate flag presence/type; emit the producer/reader result; set exit code. | `argv`, all sibling modules | stdout (results) / stderr (errors) | `process.exit(0/1)`; indirectly triggers store writes via producers/dispose/promote |

- **File-level notes** — Each subcommand wraps the delegate in `try/catch` and routes to `fail` (no leaked stack traces). The `recall-filter` and `lifecycle` commands hex-gate / non-string-gate before delegating (defense-in-depth even though siblings re-validate). `promote` is the only command whose exit code is data-driven (`result.ok ? 0 : 1`). The unknown-command fallthrough prints USAGE + exits 1 — correct. Coupling: `cli.js` is the single integration point that wires all seven siblings together.

### `store.js`

- **Purpose** — The append-only, content-addressed proposal ledger. A proposal has a STABLE identity (`op_type` + canonical target set, content-addressed into `proposal_id`) and a MUTABLE `disposition`. `createProposal` dedups on identity (first-write-wins on `justification`/`origin`); `updateDisposition` supersedes the disposition in place; `listProposals` reads back frozen rows. Bounded by a record count cap + a read-path byte cap; no wall-clock expiry.
- **Imports / consumes** — `os`, `path`, `crypto`; kernel `_lib`: `atomic-write` (`writeAtomicString`), `lock` (`acquireLock`/`releaseLock`), `canonical-json` (`canonicalJsonSerialize`), `jsonl-read` (`readJsonlBounded`), `provenance-walk` (`HEX64`), `free-string-checks` (`nonEmptyString`/`hasControlChars`); `./enums`. Env: `LOOM_LAB_STATE_DIR` (state root, resolved ONCE at module-load), `LOOM_LAB_MAX_LEDGER_BYTES` (read-path byte cap). Reads/writes `<state>/manage-proposals/ledger.jsonl` + `.lock`.
- **Consumers** — `cli.js` (`listProposals`, `updateDisposition`), `manage-ops.js` (`createProposal`), `promote.js` (`listProposals`, `canonicalizeTargets`, `MAX_TARGETS`), `recall-suppression.js` indirectly (mirrors `MAX_TARGETS` as `MAX_RECALL_SET`), tests under `tests/unit/lab/manage-proposal/store.test.js` and `tests/unit/lab/v3*`.
- **Functions**

| name | kind | purpose | consumes (params, files) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `sha256` | internal | Hex sha256 of a string. | `s` | none | none |
| `withLabLock` | internal | Advisory soft-lock wrapper; on bounded acquire-failure warns + returns `onContended()` (never `process.exit`). | `fn`, `onContended`; `LOCK_PATH` | stderr warning; lock file via `acquireLock` | acquires/releases `.lock`; on contention runs the fallback |
| `canonicalizeTargets` | exported | Dedup (Set) + lexicographic sort of the target array; non-array to `[]`. | `targetRecords` | none | none (pure) |
| `computeProposalId` | exported | Content-address: `sha256(canonicalJson([opType, ...canonicalTargets]))`. | `opType`, `targetRecords` | none | none (pure) |
| `isAuthenticProposal` | internal | INV-22 verify-on-read: re-derive `proposal_id` from the body and compare; un-rederivable to `false`. | `r` | none | none (read-side integrity check) |
| `readLedger` | internal | Bounded JSONL read, then filter to authentic rows. | `LEDGER_PATH` | none | reads ledger file |
| `writeLedger` | internal | Serialize records to newline-joined JSONL and atomically write. | `records`; `LEDGER_PATH` | `ledger.jsonl` (atomic) | overwrites the ledger file |
| `freezeProposalRecord` | internal | DEEP-freeze a record (clone+freeze `target_records`, then freeze the row) for all return paths. | `r` | none | returns a new frozen object |
| `nowMsFrom` | internal | Resolve injected `now` to ms, else `Date.now()`. | `opts.now` | none | none |
| `tsOf` | internal | Parse `recorded_at` to ms for the count-cap eviction sort; unparseable to `-Infinity`. | `record.recorded_at` | none | none |
| `validateFreeString` | internal | Non-empty + 512-byte cap + control-char-free guard for `justification`/`proposer_origin`. | `v`, `fieldName` | none | throws on violation |
| `validateTargets` | internal | Non-empty array of strict 64-hex strings; dedup+sort; `MAX_TARGETS` cap AFTER dedup. | `targetRecords` | none | throws on violation |
| `validateCreateProposalInput` | internal | Validate+normalize all create input at the boundary (pre-lock). | `o`; `enums` | none | throws on violation |
| `createProposal` | exported | Create or idempotently return a proposal; count-cap eviction under the lock. | `input`; reads ledger | `ledger.jsonl` (on net-new) | writes the ledger; returns frozen record / live row / `{skipped}` |
| `updateDisposition` | exported | Durable in-place disposition supersede (RMW under lock); all transitions accepted. | `proposalId`, `decision`; reads ledger | `ledger.jsonl` | rewrites the ledger; returns frozen record / `{notFound}` / `{skipped}` |
| `listProposals` | exported | Read-only listing, optional filter, frozen rows. | `opts.filter`; reads ledger | none | reads ledger; returns frozen array |

- **File-level notes** — INV-22 verify-on-read is correct: `isAuthenticProposal` re-derives the content-address and drops a row whose `proposal_id` lies about its body. The `freezeProposalRecord` deep-freeze closes the #266 shallow-freeze leak across ALL four return paths (create/dedup/update/list). `validateTargets` correctly fixes the documented `[].every() === true` vacuous pass and the `typeof === 'string'` split (avoids `HEX64.test` coercion via a `toString`-bearing object). Fragility: the TRUST model is writer-UNAUTHENTICATED by design — a co-forged authentic-but-illegitimate row verifies (integrity != provenance), bounded only by narrowing-safety. The count-cap eviction in `createProposal` is O(n log n) per net-new write (acceptable given the small dedup'd ledger).

### `enums.js`

- **Purpose** — Side-effect-free shared enums + a re-export of the shared kernel enum-validation leaf so `store`/`manage-ops`/`projections` all import one module.
- **Imports / consumes** — `../../kernel/_lib/enum-validate` (`validateEnum`, `normalizeAsciiEnum`). No env, no I/O.
- **Consumers** — `store.js`, `projections.js`, `lifecycle.js` (via `OP_TYPES`/`APPROVED_DISPOSITION`), `cli.js`, `manage-ops.js` (op-type constants are local, not from here), `promote.js` (`APPROVED_DISPOSITION`).
- **Functions** — No functions of its own; exports the frozen consts `OP_TYPES`, `DISPOSITIONS`, `DEFAULT_DISPOSITION` (`'pending'`), `APPROVED_DISPOSITION` (`'approved'`) plus the re-exported `validateEnum`/`normalizeAsciiEnum`.
- **File-level notes** — `Object.freeze` on the enum arrays is correct. Clean SRP boundary; the disambiguation comment (this `quarantine` is a Memory-Manage marker, NOT the kernel `quarantine-promote.js`) is load-bearing and accurate. KISS-clean.

### `manage-ops.js`

- **Purpose** — The op producers. `quarantineRecord` is the safe single-target marker; `proposeMultiTargetOp` is the shared engine behind `contentDedupRecord`/`cullRecord`/`mergeRecord`. THIN wrappers: own three presence guards, delegate all FORMAT validity to `store.createProposal` (one admission gate, DRY). CREATE-only — never calls `updateDisposition`.
- **Imports / consumes** — `./store` (`createProposal`). No env, no other I/O.
- **Consumers** — `cli.js` (all four producers). Tests under `tests/unit/lab/manage-proposal/manage-ops.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `quarantineRecord` | exported | Single-target quarantine proposal; presence-guards `justification`/`origin`/`target`, then `createProposal`. | `input` | (store ledger via `createProposal`) | indirect ledger write |
| `proposeMultiTargetOp` | internal | Shared producer for the multi-target ops; presence-guards then `createProposal` with the pinned `opType`. | `opName`, `opType`, `input` | (store ledger) | indirect ledger write |
| `contentDedupRecord` | exported | `proposeMultiTargetOp('contentDedupRecord', 'content-dedup', input)`. | `input` | (store ledger) | indirect ledger write |
| `cullRecord` | exported | `proposeMultiTargetOp('cullRecord', 'cull', input)`. | `input` | (store ledger) | indirect ledger write |
| `mergeRecord` | exported | `proposeMultiTargetOp('mergeRecord', 'merge', input)`. | `input` | (store ledger) | indirect ledger write |

- **File-level notes** — DRY-clean: presence guards (which name THIS wrapper's contract) vs format guards (the store). The documented decision to NOT enforce arity (a single-target merge is harmless advisory data) is defensible at the advisory layer. The target presence-guard is the documented `VERIFY FAIL-3` fix. No mutation of inputs.

### `projections.js`

- **Purpose** — Two PURE projections over the proposal set. `quarantinedRecords` maps each txid targeted by a non-rejected `quarantine` proposal to its tier (`quarantined` if any APPROVED, else `candidate`) + incident proposals. `approvedOpsByRecord` maps each txid to the APPROVED ops targeting it across all op-types (the mint-feed for `promote`/`lifecycle`).
- **Imports / consumes** — `./enums` (`APPROVED_DISPOSITION`, `OP_TYPES`). No I/O, no env, no `./store`.
- **Consumers** — `lifecycle.js` (`approvedOpsByRecord`), `recall-suppression.js` (`quarantinedRecords`). Tests under `tests/unit/lab/manage-proposal/projections.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isRecord` | internal | True iff a non-null non-array object. | `r` | none | none |
| `nonEmptyStr` | internal | True iff a non-empty string. | `v` | none | none |
| `quarantinedRecords` | exported | Tiered quarantine annotation map; load-bearing `op_type==='quarantine' && disposition!=='rejected'` pre-filter; APPROVED-wins monotonic. | `proposals` | none | none (pure; returns a Map) |
| `approvedOpsByRecord` | exported | Approved-only, all-op-type, tier-free map of txid to approved ops; closed-enum membership pre-filter. | `proposals` | none | none (pure; returns a Map) |

- **File-level notes** — The load-bearing pre-filters (the F3-trap analog) are correctly implemented: a `rejected` quarantine never marks its targets, and a garbage `op_type` is dropped by `OP_TYPES.includes`. Intra-proposal target dedup via a `seen` Set guards a hand-planted duplicate (pure over ANY set). Note (not a bug): the returned Map values (`entry.proposals`, the op arrays) are NOT frozen — but the only consumers (`lifecycle.js`, `recall-suppression.js`) re-`Object.freeze` what they expose, so the mutable interior never reaches a caller. See finding L-3.

### `lifecycle.js`

- **Purpose** — The cross-layer JOIN. Given a kernel `txid`, compose two orthogonal facts into one frozen advisory verdict: `kernel_state` (the COMMITTED lifecycle via `projectLifecycleState`) + `approved_ops` (approved manage-intent via `approvedOpsByRecord`). `effective` is a PURE DESCRIPTIVE UNION `{committed, pending_intent}`, never a resolved gate verdict.
- **Imports / consumes** — `../../kernel/_lib/provenance-projections` (`projectLifecycleState`), `../../kernel/_lib/provenance-walk` (`indexByTransactionId`), `./projections` (`approvedOpsByRecord`). Pure — no I/O, no env (the CLI assembles `records` via `crossrun-load`).
- **Consumers** — `cli.js` (`lifecycle` command), `recall-suppression.js` (per-txid verdict). Tests under `tests/unit/lab/manage-lifecycle-consumer.test.js`, `v36-integration.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `manageLifecycleStatus` | exported | Resolve txid to a record (via `indexByTransactionId`), project its kernel state, attach approved ops, return a deep-frozen verdict. | `txid`, `opts.records/proposals/nowMs/retentionDays` | none | none (pure; deep-frozen return) |

- **File-level notes** — Correct: `projectLifecycleState` takes a RECORD (verified against the kernel source — it returns `null` only on a non-record, and `indexByTransactionId` HEX64-filters + first-wins), so the `?? 'unknown'` collapses both the absent-record path and the unreachable null into one safe default. `approved_ops` and `pending_intent` are individually + collectively frozen (closes the shallow-freeze leak). The `nowMs`/`retentionDays` gating uses `Number.isFinite`/`Number.isInteger` correctly. Documented PRECONDITION: with no records, `kernel_state` is `'unknown'` (the run-seam default the CLI now closes via `crossrun-load`).

### `crossrun-load.js`

- **Purpose** — The READER-side I/O assembly that the pure `lifecycle.js` JOIN needs. Given a kernel `txid`, locate its run (`findRecordRun`) and load that run's content-verified records (`listByRun`). On an ambiguous (duplicated-across-runs) txid, UNION across all dup runs (not under-report). Read-only; never throws.
- **Imports / consumes** — `../../kernel/_lib/record-locate` (`findRecordRun`), `../../kernel/_lib/record-store` (`listByRun`), `../../kernel/_lib/provenance-walk` (`HEX64`). Reads the kernel record-store on disk (`stateDir` default inside `record-store`).
- **Consumers** — `cli.js` (`lifecycle` command), `recall-suppression.js` (the default `loadRecordsFn`). Tests via the W2c integration suites.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `loadRecordsForTarget` | exported | Hex-gate the txid; locate the run; load its records (UNION across dup runs on ambiguous); `[]` on non-hex / absent / error. | `txid`, `opts.stateDir`; reads record-store | none | reads disk (record-store) only |

- **File-level notes** — Defense-in-depth hex-gate at the helper boundary (F8). The `(opts || {}).stateDir` normalization correctly tolerates a `null` opts. The ambiguous-union branch wraps each `listByRun` in `try/catch` so a vanished run is skipped (never-throws). Note (smell, not a bug): the unique-match branch (line 52) catches `listByRun` errors but the inner `Array.isArray(loc.runs)` guard in the ambiguous branch is belt-and-suspenders given `findRecordRun`'s contract. Layer-clean: SRP-separated from the pure `lifecycle.js`.

### `recall-suppression.js`

- **Purpose** — The recall-class retrieval-suppression VIEW. Partition a candidate txid set against the LIVE manage state into `suppressed` (kernel-COMMITTED `tombstoned`/`superseded` ONLY), `flagged` (approved-but-unpromoted ops UNION pending quarantine), and `surfaced` (the explicit default; everything else, per-element fail-soft with a diagnostic reason). EXHAUSTIVE + pairwise-DISJOINT; the whole partition is always returned.
- **Imports / consumes** — `./lifecycle` (`manageLifecycleStatus`), `./projections` (`quarantinedRecords`), `./crossrun-load` (`loadRecordsForTarget`, the default loader). `opts.stateDir`/`proposals`/`nowMs`/`retentionDays`/`loadRecordsFn` injectable. Reads the record-store via the default loader.
- **Consumers** — `cli.js` (`recall-filter` command). Tests under `tests/unit/lab/recall-suppression.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `deepFreezeRows` | internal | Deep-freeze each partition row + its nested `reasons` array/entries. | `rows` | none | returns frozen array |
| `recallSuppression` | exported | Partition the deduped candidate set into surfaced/suppressed/flagged; per-element fail-soft; deep-frozen return. | `txids`, `opts.*`; reads records via loader | none | reads disk via default loader; throws only on a non-array input or an over-cap set |

- **File-level notes** — Correct precedence: a committed destructive fact wins (lands in `suppressed` ONLY); the `flagged` Map-by-`op_type|disposition` dedups the approved-quarantine double-listing (it appears in BOTH `approvedOpsByRecord` and `quarantinedRecords`). Per-element diagnostics (`invalid-txid`/`no-records`/`unresolved`) keep the partition lossless. The documented cost-contract caps `txids` at `MAX_RECALL_SET` (256) but leaves `proposals` UN-capped (acceptable today — local Lab store; flagged for a future external proposal source). Note: `MAX_RECALL_SET = 256` is hard-coded to "mirror the store's `MAX_TARGETS`" rather than imported from `store.js` — a DRY drift risk (finding L-1).

### `promote.js`

- **Purpose** — The leave-shadow MINT orchestrator (the ONE live-mutating path). Reads ONE explicit approved `cull`/`content-dedup`/`merge` proposal, resolves each target's run, runs an IDOR eligibility gate, plans per-run mints, consults a PREDICTIVE breaker, then mints one COMMITTED `TOMBSTONE`/`SUPERSEDE` per run with a re-read exact-SET post-condition. SHADOW DEFAULT: a no-op REFUSE unless `LOOM_MANAGE_ENFORCE==='1'`. Never throws; returns a frozen result.
- **Imports / consumes** — `crypto`; `./store` (`listProposals`, `canonicalizeTargets`, `MAX_TARGETS`), `./enums` (`APPROVED_DISPOSITION`), `../../kernel/_lib/manage-op-record` (`buildManageOpRecord`), `../../kernel/_lib/record-locate` (`findRecordRun`), `../../kernel/_lib/record-store` (`appendRecord`, `readById`, `readByIdempotencyKey`), `../../kernel/_lib/canonical-json` (`canonicalJsonSerialize`), `../circuit-breaker/project` (`evaluate`). Env: `LOOM_MANAGE_ENFORCE` (gate); transitively `LOOM_DISABLE_CIRCUIT_BREAKER`, `LOOM_BREAKER_*` via the breaker. Reads + WRITES the kernel record-store.
- **Consumers** — `cli.js` (`promote` command). Tests under `tests/unit/lab/manage-promote.test.js`, `manage-promote-crossrun.test.js`, `promote-breaker.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isEnforced` | internal | True iff `LOOM_MANAGE_ENFORCE === '1'`. | env | none | none |
| `refuse` | internal | Build a deep-frozen `{ok:false, refused}` result (freezes array-valued context). | `reason`, `extra` | none | returns frozen object |
| `eligibilityRefusal` | internal | IDOR gate: refuse a `null`, kernel-namespaced (`kernel:`/`kernel-`, normalized), or manage-op (`SUPERSEDE`/`TOMBSTONE`/`DERIVED-VIEW-INVALIDATE`) target. | `targetRecord` | none | returns a refusal code or null |
| `resolveTargetRuns` | internal | Resolve EACH target's run via `findRecordRun` to a `Map<runId, target[]>`; fail-closed on phantom / ambiguous. | `targets`, `opts`; reads store | none | reads store |
| `partialResult` | internal | Build the honest per-run mint-failure result (clean total vs `partial-cross-run`); no rollback. | `minted`, `runIds`, `failRid`, `cause`, `extra` | none | returns frozen object |
| `mintPlannedRuns` | internal | Append each planned per-run mint; per-run re-read + exact-SET post-condition; stop + honest partial on first failure. | `planned`, `runIds`, `operationClass`, `opts` | record-store (COMMITTED ops) | WRITES kernel records; returns `{minted}` or a partial |
| `postConditionOk` | internal | Exact-SET-equality post-condition: stored op is COMMITTED + the expected class + acts on EXACTLY the want set. | `stored`, `operationClass`, `wantSet` | none | none |
| `promoteProposal` | exported | Orchestrate the full gated mint over a multi-target, possibly cross-run proposal. | `proposalId`, `opts.stateDir/nowIso`; reads store + breaker | record-store (on success) | WRITES kernel records; returns a frozen `{ok}` result |

- **File-level notes** — This is the security-critical surface and is hardened deeply: (1) the proposal is named by id + content-authentic (store re-derives `proposal_id`); (2) `disposition === 'approved'` is asserted; (3) `OP_MAP` lookup is `hasOwnProperty`-guarded (closes a `toString`/`valueOf` prototype-chain bypass); (4) targets are re-canonicalized + re-capped at the boundary (a planted authentic-but-unsorted row is not trusted); (5) IDOR eligibility is all-or-nothing BEFORE any mint, reading each target against its OWN run; (6) the breaker is PREDICTIVE with `k = net-mint count` (NOT `runIds.length`) to avoid double-counting dedup'd runs; (7) `excluded_future > 0` fails CLOSED (storm-hiding tamper signal); (8) the re-read exact-SET post-condition rejects an INV-22 poison-key decoy in every shape. `promoteProposal` is 127 lines — exceeds the 50-line guideline (finding L-2). Honest residuals (documented + accurate): a same-uid `updateDisposition('approved')` on a genuine proposal is trusted (OQ-E), an ordinary non-kernel CREATE record is still targetable, and a back-date `utimes()` storm against the FS-mtime breaker window is uninstrumented — all closing only at the Track-2 ContainerAdapter sandbox.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| LOW | substrate | smell | `recall-suppression.js:61` | `MAX_RECALL_SET = 256` is hard-coded with a comment "mirrors the store's `MAX_TARGETS`" instead of importing `MAX_TARGETS` from `./store` (which is already exported and IS imported by `promote.js`). A DRY drift risk: if the store cap changes, this silently diverges. Import it. |
| LOW | function | smell | `promote.js:220-347` | `promoteProposal` is ~127 lines, exceeding the repo's "<50 lines" guideline. Steps (2)-(6.5) are cohesive but extractable (`resolveOperationClass`, `planMints`, `evaluatePromoteBreaker`) would each be independently testable. Not a bug — readability/maintainability only. |
| LOW | file | smell | `projections.js:62,111` | The Maps returned by `quarantinedRecords`/`approvedOpsByRecord` contain UNFROZEN value objects (`entry.proposals` array, the pushed op objects). Pure functions, so not a mutation bug today (both consumers re-freeze before exposing), but a future direct consumer could mutate a shared interior. Consider freezing on emit for defense-in-depth consistent with the rest of the cluster. |
| INFO | component | smell | `promote.js:316-322` vs `circuit-breaker/project.js:357` | The breaker also computes `excluded_undated`, but `promote.js` fails-closed ONLY on `excluded_future > 0`. For the `manage-promote` source this is benign (mint `recorded_at` is derived from FS `mtime`, always a valid past ISO date, so `excluded_undated` is structurally 0 here), but the asymmetry is implicit — a one-line assertion or comment that `excluded_undated` cannot be nonzero for this source would make the fail-closed reasoning self-evident. Documentation gap, not a bug. |
| INFO | function | smell | `cli.js:39` | `parseArgs` treats any flag value beginning with `--` as a missing value (boolean `true`), so `--justification --foo` yields `justification === true`. Downstream validators reject the non-string cleanly (fails closed), so this is acceptable, but it cannot express a justification literally starting with `--`. Known minimal-parser limitation; flag for awareness only. |
| INFO | substrate | logical-fallacy | `store.js:28-37` (TRUST MODEL) | Verified-accurate, recorded for the downstream report: the store proves INTEGRITY (content-address re-derived on read) NOT PROVENANCE. A co-forged authentic row (a valid body + a matching `proposal_id` computed via the SAME exported `computeProposalId`) verifies and is dedup-served. This is the documented #273-family residual (integrity != provenance); it is TOLERABLE only because every read is advisory/narrowing-safe and `approved` is RECORDED-NOT-EXECUTED until a human + `LOOM_MANAGE_ENFORCE=1` promote. The moment a manage-proposal field gates an action without the human gate, an AUTHENTICATED minter is mandatory. No code change needed at the current trust boundary. |
| INFO | function | optimization | `recall-suppression.js:98-101` | The `proposals` arg is UN-capped while `txids` is capped at 256. Documented as deliberate (local Lab store; the 200k-proposal probe measured ~31ms). Recorded per the checklist: if a future wave wires an EXTERNAL proposal source into this view, cap `proposals` alongside the txid cap. |
| INFO | component | smell | `promote.js:330` | The predictive breaker bound (`denials_in_window + k > threshold`) reads `denials_in_window` from a global (no-persona) `evaluate`, which is correct. Worth noting it relies on `k` = net-mint count being correct; the comment-vs-code agreement was verified (a dedup'd run is excluded from `k` AND already counted in `denials_in_window`, so counting it in `k` would double-count). No bug — the subtle invariant holds. |

_Files covered: 9. No CRITICAL/HIGH/MEDIUM findings — the cluster is unusually well-hardened against the documented bug classes (exact-SET post-condition present, content-verify-on-read present, deep-freeze on every return path, fail-closed on tamper signal, prototype-chain guards, no missing `await` since every path is synchronous). The residuals are documentation/DRY smells plus the accepted OQ-E provenance boundary._
