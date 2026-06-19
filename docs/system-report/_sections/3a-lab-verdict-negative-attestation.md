# Lab verdict-attestation + negative-attestation + lab `_lib` — `packages/lab/{verdict-attestation,negative-attestation,_lib}`

> This cluster is the **advisory/shadow evidence-ledger producer layer** of the substrate (the `lab` tier — never enforced, never blocking; per the K12 layer discipline these files are `lab` by path and may import `kernel/_lib` inward but no `kernel`/`runtime` STATE module). Two structurally-parallel append-only JSONL ledgers — `verdict-attestation` (records the FACT-OF-EMISSION of an advisory verdict about a delegated builder spawn, evidence-linked to a kernel spawn-record via `agentId`→`transaction_id`) and `negative-attestation` (records a rejected decompose-leaf's `failure_signature` as a witness) — plus the `enrich-from-spawn-state` PULL enricher (Lab pulls, nothing pushes in) and a shared closed-set key primitive (`_lib/enum-key`). Everything here OBSERVES and RECORDS; the downstream `reputation/project.js` and `circuit-breaker/project.js` are the consumers that derive advisory (never gating) distributions from these ledgers. The whole cluster is the §0a.3.1 "emission, not content" track — it records *that* a verdict was emitted, never trusts the verdict's content as ground truth.

## Directory contents & nesting

| Folder | File | One-line purpose |
|---|---|---|
| `verdict-attestation/` | `store.js` | Advisory append-ledger for verdict-emission attestations (content-addressed `attestation_id`, expiry, dedup, enrich, prune). |
| `verdict-attestation/` | `enrich-from-spawn-state.js` | PULL enricher: resolves a record's `agentId` → kernel spawn-record `transaction_id` by reading the kernel spawn-state journal as a DATA file. |
| `verdict-attestation/` | `cli.js` | CLI / orchestrator entry point: `record` / `record-review` / `enrich` / `list` / `prune` / `stats`. |
| `negative-attestation/` | `store.js` | Advisory append-ledger for negative attestations wrapping a frozen ADR-0015 `failure_signature` (structural SIBLING of the verdict store). |
| `negative-attestation/` | `record-from-decompose.js` | Ingest: reads a `decompose-run` outbox (`decompose-result.json`) as a DATA file, records each rejected leaf's `failure_signature`. |
| `negative-attestation/` | `cli.js` | CLI entry point: `record-from-decompose` / `list` / `prune` / `stats`. |
| `_lib/` | `enum-key.js` | PURE shared closed-set key primitive (`safeEnumKey`); imported INWARD by the two `causal-edge` key spaces. Lives in `_lib/` precisely so neither key-space consumer couples sideways through a shared sentinel. |

There is no `_spike/` subfolder in scope. The `_lib/` subfolder is a **neutral leaf** (no imports, CI-safe) deliberately separate from the two attestation domains so they can each import it without coupling to one another.

## Per-file analysis

### `verdict-attestation/store.js`

- **Purpose** — The Layer-3 ADVISORY-ONLY producer that records "verdict V was EMITTED about spawn A's work, by verifier W of kind K, at time T". Owns a Lab ledger at `$LOOM_LAB_STATE_DIR/verdict-attestations/ledger.jsonl`. Records the fact-of-emission, evidence-linked to a kernel spawn-record; never blocks.
- **Imports / consumes** — `os`, `path`, `crypto`; `kernel/_lib/atomic-write` (`writeAtomicString`), `kernel/_lib/lock` (`acquireLock`/`releaseLock`), `kernel/_lib/canonical-json` (`canonicalJsonSerialize`), `kernel/_lib/jsonl-read` (`readJsonlBounded`), `kernel/_lib/path-canonicalize` (`isSafePathSegment`). Env vars: `LOOM_LAB_STATE_DIR` (store base), `LOOM_LAB_MAX_LEDGER_BYTES` (read byte-cap override). Reads/writes `ledger.jsonl`; uses `.lock`.
- **Consumers** — `packages/lab/reputation/project.js` (`listVerdicts`, `VALID_VERDICTS`), `packages/lab/circuit-breaker/project.js` (`listVerdicts`), `enrich-from-spawn-state.js` (`listVerdicts`, `enrichRecords`), `cli.js` (`recordVerdict`, `listVerdicts`, `pruneExpired`, `VALID_VERDICTS`, `MAX_FIELD_LEN`), kernel `evolution-snapshot-read` test references `source: 'verdict-attestation'`. Tests under `tests/unit/lab/verdict-attestation/`.

| name | kind | purpose | consumes (params, files read) | writes (files, refs, stdout/JSON) | state changes / side effects |
|---|---|---|---|---|---|
| `sha256` | internal | hex digest helper for the content-address. | `s:string` | none | none (pure). |
| `withLabLock` | internal | Advisory soft-lock wrapper; on contention warns to stderr and runs the `onContended` fallback (NEVER `process.exit`, unlike the kernel store). | `fn`, `onContended`; reads/acquires `.lock` | `.lock` file; stderr warning | acquires/releases lock; soft-fallback on contention. |
| `readLedger` | internal | Read JSONL ledger via bounded reader; missing → `[]`; oversized → newest tail; corrupt line → skipped. | `LEDGER_PATH`, `MAX_LEDGER_RECORDS`, `MAX_LEDGER_BYTES` | none | none (read-only; never throws). |
| `writeLedger` | internal | Atomic whole-ledger rewrite (never a raw append). | `records[]` | `LEDGER_PATH` (atomic rename) | replaces the entire ledger file; creates `STORE_DIR`. |
| `expiresAfterDaysOf` | internal | Per-record expiry window, default 30. | `record` | none | none. |
| `isExpired` | internal | Wall-clock expiry test; unparseable `recorded_at` → NOT expired (fail-safe keep). | `record`, `nowMs` | none | none. |
| `nowMsFrom` | internal | Resolve injected `now` or `Date.now()`. | `opts.now` | none | none. |
| `nonEmptyString` | internal | type+length guard. | `v` | none | none. |
| `hasControlChars` | internal | Reject C0/DEL/C1 + U+2028/U+2029 in a stored field (would split JSONL / pollute grouping keys). | `v:string` | none | none. |
| `validateRecordVerdictInput` | internal | Boundary validation+normalize BEFORE the lock: verdict ∈ `VALID_VERDICTS`, required `agentId`/`verifier.identity`/`verifier.kind`/`subject.persona`, per-field `MAX_FIELD_LEN` cap, `isSafePathSegment(agentId)`, control-char scan. | `o` (input) | none | throws a clean `Error` on any violation. |
| `recordVerdict` | exported | Record one verdict-emission attestation; content-address `attestation_id`; prune-on-write; mislabel guard (H-1); dedup on replay; count-cap. | `input` (`verdict`,`subject`,`verifier`,`agentId`,`expiresAfterDays`,`now`); reads `ledger.jsonl` | `ledger.jsonl` (on new/prune); returns frozen record / `{deduped}` / `{skipped:'lock-contended'}` JSON | acquires lock, RMW the ledger; throws on mislabel; stderr on contention. |
| `applyEnrichment` | internal | Produce a NEW frozen record with the resolved link merged onto `evidence_refs` (present overwrites, absent preserves). | `prev`, `link` | none | returns a new frozen object (immutable update). |
| `enrichRecord` | exported | Persist an enricher-resolved link onto ONE record by `attestation_id` (RMW). | `attestationId`, `link`; reads ledger | `ledger.jsonl` | acquires lock, RMW; returns updated frozen record / `{notFound}` / `{skipped}`. **Only referenced by tests** (see findings — dead in production). |
| `enrichRecords` | exported | Batch-persist many resolved links in ONE locked RMW (O(ledger) not O(records×ledger)). | `updates[]`; reads ledger | `ledger.jsonl` (only when `enriched>0`) | acquires lock, RMW; returns `{enriched,notFound,skipped}`. |
| `listVerdicts` | exported | List LIVE (non-expired) records, optional filter; read-only, no lock. | `opts` (`filter`,`now`); reads ledger | none | none (returns **un-frozen** parsed rows — see findings). |
| `pruneExpired` | exported | Drop expired records, rewrite ledger; advisory. | `opts.now`; reads ledger | `ledger.jsonl` (when count changes) | acquires lock, RMW; returns count dropped; `0` on contention. |

- **File-level notes** — 369 lines (< 800). The `attestation_id` basis is a 4-scalar flat array `[agentId, verifier.identity, verifier.kind, verdict]` — **`subject.persona` is intentionally NOT in the id basis** but IS guarded by the H-1 mislabel check at write-time, which is the load-bearing invariant tying one `agentId` to one persona. The dedup is **content-address membership**, so distinct verifiers ACCUMULATE (3-lens VALIDATE). `MAX_LEDGER_BYTES` is coincidentally-but-distinctly equal to E4's recency half-life — comment explicitly forbids "DRY"-ing them. The store is content-INTEGRITY-only on write; it does NOT re-verify on read and is NOT a provenance authority (see findings — the integrity≠provenance and read-back-mutability classes).

### `verdict-attestation/enrich-from-spawn-state.js`

- **Purpose** — The PULL enricher (E1 pattern): resolves a stored record's orchestrator-formed `agentId` → the kernel spawn-record's content-addressed `transaction_id` by reading the kernel spawn-state JOURNAL as a DATA FILE (by path only — imports NO kernel STATE module). Closes the shadow loop: a claimed link becomes a resolvable link.
- **Imports / consumes** — `os`, `path`, `fs`; `kernel/_lib/path-canonicalize` (`isSafePathSegment`), sibling `./store`. Env var `LOOM_SPAWN_STATE_DIR` (resolved once at module-load → `SPAWN_STATE_BASE`). Reads `<base>/<runId>/resolver-journal-<agentId>.jsonl` files.
- **Consumers** — `cli.js` (`enrichLedger`), `recordReviewBatch` (auto-enrich). Tests under `tests/unit/lab/verdict-attestation/`. The kernel `spawn-close-resolver` is the upstream producer of the journal it reads (frozen F4 contract).

| name | kind | purpose | consumes (params, files read) | writes (files, refs, stdout/JSON) | state changes / side effects |
|---|---|---|---|---|---|
| `recordStatusOf` | internal | Map journal append flags → coarse `appended`/`deduped`/`not-appended` status. | `line` (parsed JSON) | none | none. |
| `resolveKernelRecord` | exported | Resolve one `agentId` → `{agentId,runId,transactionId,recordStatus,collision?}` or `null`; globs run-dirs, lstat-guards symlinked/oversized journals, takes the LAST provenance-record line; flags multi-hit collision. | `agentId`; reads `SPAWN_STATE_BASE` dir + journal file | none | reads disk; THROWS if `agentId` not a safe path segment; fail-soft `null` on every IO/parse failure. |
| `enrichLedger` | exported | Enrich every unenriched LIVE record whose `agentId` resolves; resolves OUTSIDE the lock then persists the whole batch via `store.enrichRecords`. | `opts.now`; `store.listVerdicts`; reads journals | via `store.enrichRecords` → `ledger.jsonl` | one locked RMW; returns `{enriched,unresolved,skipped}`; fail-soft per record. |

- **File-level notes** — 166 lines. Defense-in-depth: `isSafePathSegment` is checked here AND at the store boundary (`validateRecordVerdictInput`). The symlink/oversize guards (`lstatSync`, `isSymbolicLink`, `MAX_JOURNAL_BYTES = 4MB`) close the M1/M3 hacker findings. The collision rule REFUSES to persist an ambiguous link (an ambiguous link is no link). **It is the canonical PULL boundary** — it reads spawn-state but `store.enrichRecord(s)` does the ledger mutation, so the store stays the single ledger owner.

### `verdict-attestation/cli.js`

- **Purpose** — The dogfood vehicle + orchestrator entry point: `record` / `record-review` (batch a 3-lens review then auto-enrich) / `enrich` / `list` / `prune` / `stats`. Every subcommand is advisory: records/reads/enriches/prunes only.
- **Imports / consumes** — `./store` (`recordVerdict`,`listVerdicts`,`pruneExpired`,`VALID_VERDICTS`,`MAX_FIELD_LEN`), `./enrich-from-spawn-state` (`enrichLedger`). Reads `process.argv`.
- **Consumers** — Invoked by orchestrators per workflow Rule 4 (`record-review --subject-persona ... --agent-id ... --review "I|K|V"`). Referenced in `docs/ROADMAP.md`, `docs/SIGNPOST.md`, several plan docs, and the `agent-identity-reputation` skill pattern. Tested in `tests/unit/lab/verdict-attestation/cli.test.js`.

| name | kind | purpose | consumes (params, files read) | writes (files, refs, stdout/JSON) | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs` | exported | Generic last-wins `--flag VALUE` / `--flag (bare→true)` parser. | `argv[]` | none | none. |
| `tally` | internal | Group-count helper for `stats`. | `records[]`, `keyFn` | none | none. |
| `parseReviewArgs` | exported | Dedicated walk that COLLECTS repeatable `--review` into an array + single-value flags (parseArgs is last-wins, can't collect repeats). | `argv[]` | none | none. |
| `isValidField` | internal | bounded non-empty scalar per the store's `MAX_FIELD_LEN`. | `v` | none | none. |
| `parseExpiresAfterDays` | internal | Parse `--expires-after-days` → positive whole number ≤ `MAX_EXPIRES_DAYS`; rejects hex/exponent/NaN footguns. | `raw` | none | THROWS on bad value (dispatch maps → exit 1). |
| `parseReviewTriple` | exported | Parse+validate one `identity\|kind\|verdict` triple (exactly 3 non-empty parts, bounded, verdict ∈ enum). | `raw` | none | THROWS naming the bad value. |
| `recordReviewBatch` | exported | Pre-validate ALL triples (all-or-nothing for validation) then record each via `recordVerdict`, then auto-enrich unless `--no-enrich`; enrich throw is non-fatal. | `opts` (`subjectPersona`,`agentId`,`reviews[]`,`expiresAfterDays`,`enrich`) | via `recordVerdict`/`enrichLedger` → `ledger.jsonl` | records (lock RMW) + enrich (lock RMW); returns summary; THROWS pre-write on validation. |
| `emitReviewSummary` | internal | Print the `{recorded,deduped,skipped,enriched,unresolved}` summary; warn on enrich-throw (still exit 0). | `summary` | stdout JSON; stderr on enrichError | none beyond IO. |
| `main` | cli (entry) | Dispatch the subcommand; map throws → clean stderr + `process.exit(1)`; success → JSON + `process.exit(0)`. | `argv[]` | stdout JSON / stderr; via store/enricher → `ledger.jsonl` | `process.exit` codes; ledger mutation through the subcommand. |

- **File-level notes** — 333 lines. The `record` subcommand re-implements its own `--expires-after-days` NaN guard inline (lines 219-227) using a DIFFERENT, weaker validator than `parseExpiresAfterDays` used by `record-review` — see findings (DRY + inconsistent-validation). `recordReviewBatch` is explicitly "not transactional" — a mid-batch store IO throw is not rolled back (advisory + dedup-safe on re-run), which is documented and acceptable for the Lab tier.

### `negative-attestation/store.js`

- **Purpose** — The structural SIBLING of the verdict store (built first, v3.3 Wave 0/1). Wraps a frozen ADR-0015 `failure_signature` into a durable expiring negative-attestation. Owns `$LOOM_LAB_STATE_DIR/negative-attestations/ledger.jsonl`. Observes/records, never gates.
- **Imports / consumes** — `os`, `path`, `crypto`; `kernel/_lib/atomic-write`, `kernel/_lib/lock`, `kernel/_lib/canonical-json`, `kernel/_lib/jsonl-read`. Env vars `LOOM_LAB_STATE_DIR`, `LOOM_LAB_MAX_LEDGER_BYTES`. **Notably does NOT import `isSafePathSegment`** (the verdict-store sibling does) — but it stores `run_id` verbatim and the `runId` path-guard lives in `record-from-decompose.js`.
- **Consumers** — `record-from-decompose.js` (`recordAttestation`), `cli.js` (`listAttestations`,`pruneExpired`), `circuit-breaker/project.js` (`negStore`). `canonicalSigBasis` exported for the totality test. Tests under `tests/unit/lab/negative-attestation/`.

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `sha256` | internal | hex digest helper. | `s` | none | none. |
| `canonicalSigBasis` | exported | Canonical-serialize the signature (sorted keys → cross-node reproducible id); on the bound firing emit a unique `uncomputable-sig:<rand>` sentinel (total by construction; never re-touches the blob; never falls back to `JSON.stringify`). | `sig`; `canonicalJsonSerialize` | none | `crypto.randomBytes` on the (unreachable-in-practice) catch path → non-dedupable id. |
| `withLabLock` | internal | Advisory soft-lock; warns + soft-fallback on contention (never `process.exit`). | `fn`,`onContended`; `.lock` | `.lock`; stderr | lock acquire/release. |
| `readLedger` | internal | Bounded JSONL read; missing → `[]`; oversized → newest tail; corrupt → skip. | `LEDGER_PATH`, caps | none | none. |
| `writeLedger` | internal | Atomic whole-ledger rewrite. | `records[]` | `LEDGER_PATH` | replaces file; creates `STORE_DIR`. |
| `expiresAfterDaysOf` / `isExpired` / `nowMsFrom` | internal | Expiry helpers (identical contract to the verdict store). | `record`/`nowMs`/`opts` | none | none. |
| `recordAttestation` | exported | Record a negative attestation; id includes a hash of the signature (H1: a DIFFERENT failure at the same (`runId`,`leafRef`) is a distinct event, not a false replay); null `leafRef` → append-always (random suffix); prune-on-write; dedup; count-cap. | `input` (`failureSignature`,`identity`,`runId`,`leafRef`,`expiresAfterDays`,`now`); reads ledger | `ledger.jsonl` | acquires lock, RMW; returns frozen record / `{deduped}` / `{skipped}`. |
| `listAttestations` | exported | List LIVE attestations, optional filter; read-only. | `opts`; reads ledger | none | none (returns **un-frozen** parsed rows). |
| `pruneExpired` | exported | Drop expired, rewrite; advisory. | `opts.now`; reads ledger | `ledger.jsonl` | acquires lock, RMW; returns count dropped. |

- **File-level notes** — 255 lines. `failure_signature` is stored VERBATIM (`record.failure_signature = o.failureSignature`) inside a shallow `Object.freeze` — the comment claims "already frozen + validated by the producer", which is true for the in-process `buildFailureSignature` producer but NOT for the live ingest path (`record-from-decompose` parses from a JSON file → an UNfrozen object). `identity.tags` is defensively `.slice()`d but the elements are not copied. The id basis comment-vs-code: the string-array wrap uses `JSON.stringify` while the signature component uses `canonicalSigBasis` — deliberate and correct (a fixed-order string array is already canonical).

### `negative-attestation/record-from-decompose.js`

- **Purpose** — The E1 capture half: reads a `decompose-run` outbox (`<run-state>/<runId>/decompose-result.json`) as a DATA FILE and records each rejected leaf's `failure_signature`. Provenance (persona/task) comes from the outbox itself, so it can't be told the wrong persona.
- **Imports / consumes** — `fs`, `path`; `kernel/_lib/runState` (`runStateDir`), `kernel/_lib/path-canonicalize` (`isSafePathSegment`), sibling `./store` (`recordAttestation`). Reads `decompose-result.json`.
- **Consumers** — `cli.js` (`recordFromDecompose`). Tests under `tests/unit/lab/negative-attestation/record-from-decompose.test.js`.

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isFlatScalarSignature` | internal | Reject any signature carrying a nested object/array value BEFORE recording (closes a deep/wide-nesting DoS at the untrusted-ingest boundary). | `sig` | none | none (pure). |
| `readOutbox` | exported | Path-guard `runId` (PRE-join `isSafePathSegment` — the #215 trap-class), then read+parse `decompose-result.json`. | `runId`; `runStateDir`; reads the outbox file | none | THROWS on bad runId / ENOENT / parse error. |
| `recordFromDecompose` | exported | Ingest a run's rejected leaves: require non-empty runId, derive persona/task from the outbox, skip malformed/non-flat signatures (fail-soft), call `recordAttestation` per leaf. | `opts` (`runId`,`expiresAfterDays`,`now`); `readOutbox` | via `recordAttestation` → `ledger.jsonl` | per-leaf lock RMW; returns `{runId,persona,rejectedCount,recorded,deduped,skipped}`; THROWS if no persona. |

- **File-level notes** — 103 lines. The C1 guard is the load-bearing security boundary: an attacker could invoke `record-from-decompose --run-id ../../secret` directly, so the ingest self-defends rather than trusting decompose-run. `isFlatScalarSignature` uses `typeof v !== 'object'` which treats `null` correctly (explicit `=== null` first) but **arrays return `typeof === 'object'`** so a nested array IS rejected — good. The outbox JSON is `JSON.parse`d with no `maxBytes` bound (see findings — a planted multi-GB outbox).

### `negative-attestation/cli.js`

- **Purpose** — The dogfood vehicle + the command a `code-reviewer` persona invokes after decompose-run: `record-from-decompose` / `list` / `prune` / `stats`.
- **Imports / consumes** — `./record-from-decompose` (`recordFromDecompose`), `./store` (`listAttestations`,`pruneExpired`). Reads `process.argv`.
- **Consumers** — Documented in `docs/SIGNPOST.md` + the v3.3 orchestration design-spike. Tested in `tests/unit/lab/negative-attestation/` (via `main`/`parseArgs`).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs` | exported | Generic last-wins flag parser (identical to the verdict-cli copy). | `argv[]` | none | none. |
| `tally` | internal | Group-count helper for `stats` (identical to the verdict-cli copy). | `records[]`,`keyFn` | none | none. |
| `main` | cli (entry) | Dispatch subcommands; map throws → stderr + exit 1; success → stdout JSON + exit 0. | `argv[]`; via record/store | stdout/stderr; `ledger.jsonl` through the subcommand | `process.exit` codes; ledger mutation. |

- **File-level notes** — 102 lines. `list` and `stats` are NOT wrapped in try/catch (the comment asserts `readLedger` swallows reads, so `listAttestations` can't throw) — but `JSON.stringify` of a manually-corrupted ledger row COULD throw; the verdict-attestation `cli.js` wraps `list`/`stats` in try/catch for exactly this reason, so the two sibling CLIs are inconsistent (see findings).

### `_lib/enum-key.js`

- **Purpose** — A PURE shared closed-set key primitive. `safeEnumKey` collapses any off-enum / non-string field to the literal `INVALID` sentinel — a deterministic closed key component, never the caller's bytes. Stops a RAW block from injecting `|`/`:` separators or seating a poison token as a content-addressed key component.
- **Imports / consumes** — None (pure, no imports, CI-safe).
- **Consumers** — `causal-edge/lesson-signature.js` (`lessonClusterKey`), `causal-edge/trajectory-friction.js` (`frictionClusterKey`), referenced by `causal-edge/weight-source-gate.js`. Tested in `tests/unit/lab/_lib/enum-key.test.js`. **NOT consumed by either attestation store** — it is the neutral primitive for the `causal-edge` key spaces, co-located in `lab/_lib` because both one-way-door key spaces depend on it.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `safeEnumKey` | exported | Return `v` iff it is a STRING present in the closed set (`Set` or `Array`); else `INVALID`. `typeof`-string guard BEFORE membership so a boolean/number/object never coerces into a match. | `v`, `set` | none | none (pure). |
| `INVALID` | exported const | The closed sentinel (`'INVALID'`) — kebab-upper, no `\|`/`:` delimiter, itself a safe key component. | — | — | — |

- **File-level notes** — 37 lines. Correctly uses exact-membership (`set.has`/`Array.includes`) AFTER a `typeof` string guard — this is the RIGHT pattern (it is not an authorization post-condition, it is a key-sanitizer, so `.includes` membership is the intended semantic: "is this an allowed enum value"). No findings.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location (file:line) | description |
|---|---|---|---|---|
| HIGH | component | bug | `verdict-attestation/store.js:336` (`listVerdicts`) + `negative-attestation/store.js:226` (`listAttestations`) | **Read-back immutability leak** (the documented #266 class). `readLedger` → `readJsonlBounded` returns raw `JSON.parse` objects with NO freeze; the `Object.freeze` in `recordVerdict`/`recordAttestation` only protects the WRITE-path in-memory return, never records read back from disk. `listVerdicts`/`listAttestations` therefore hand consumers fully-mutable rows (incl. nested `evidence_refs`, `subject`, `verifier`, `failure_signature`, `identity.tags`). Current consumers (`reputation/project.js`, `circuit-breaker/project.js`) happen to be read-only, but any future consumer mutating a returned row corrupts the in-process ledger view. The repo's own testing rule mandates testing the read-back/dedup/update return paths' immutability. |
| MEDIUM | substrate | smell | `verdict-attestation/store.js` (whole file) + `negative-attestation/store.js` (whole file) | **Integrity ≠ provenance** (the documented #273 third-face). Both stores are append-only ledgers in an open-writable dir (`$LOOM_LAB_STATE_DIR`) with NO read-side content-address re-verification — `listVerdicts`/`listAttestations` trust every line as-is. `attestation_id` is a self-asserted field; a same-UID writer can CO-FORGE a byte-indistinguishable record (re-deriving the id via the same `sha256(canonicalJsonSerialize(...))`) and inflate the downstream advisory reputation distribution. Tolerable TODAY only because the reputation/breaker outputs are SHADOW/advisory and gate nothing; the moment any weight here gates an action, an authenticated minter (signed/kernel-owned writer) is required, per `security.md`. |
| MEDIUM | function | smell | `verdict-attestation/store.js:286-297` (`enrichRecord`) | **Dead production code.** The single-record `enrichRecord` is exported but the live enricher uses `enrichRecords` (batch) exclusively; the only callers of `enrichRecord` are unit tests (`store.test.js`, `reputation/*.test.js`, `cross-store-loop.test.js`, kernel `spawn-record-a6.test.js`). It is real surface area + a second RMW path to keep correct. Either delete it (YAGNI) or have `enrichRecord` delegate to `enrichRecords([{...}])` (DRY) rather than maintaining a parallel locked RMW. |
| MEDIUM | function | smell | `verdict-attestation/cli.js:219-227` vs `:89-101` | **Inconsistent + duplicated `--expires-after-days` validation.** The `record` subcommand validates inline with `Number(...)` + `Number.isFinite` + `> 0` (which ACCEPTS hex `0x10`, exponent `1e9`, and has no upper ceiling), while `record-review` routes through `parseExpiresAfterDays` (strict `/^\d+$/` + `MAX_EXPIRES_DAYS` ceiling). The stricter validator's own comment says the loose form is a footgun, yet `record` still uses it. Route `record` through `parseExpiresAfterDays` too (DRY + close the footgun consistently). |
| MEDIUM | file | bug | `negative-attestation/record-from-decompose.js:54` (`readOutbox`) | **Unbounded outbox read** (DoS asymmetry vs the journal/ledger reads). `JSON.parse(fs.readFileSync(outboxPath, 'utf8'))` reads the entire `decompose-result.json` with NO byte cap, while the sibling enricher caps the journal at `MAX_JOURNAL_BYTES = 4MB` and the stores cap the ledger at `MAX_LEDGER_BYTES`. The outbox lives in run-state (same-UID writable; the worktree is not a sandbox per p-writescope), so a planted multi-GB outbox can OOM the ingest (and a single >512MB string trips V8's string ceiling → a thrown RangeError, not the intended fail-soft). Cap the read symmetrically with the other two paths. |
| LOW | file | smell | `negative-attestation/cli.js:64-67,82-91` (`list`/`stats`) | **Inconsistent error handling between sibling CLIs.** `verdict-attestation/cli.js` wraps `list`/`stats` in try/catch (comment: a corrupted ledger could make `JSON.stringify` throw → clean exit 1, not a stack dump), but `negative-attestation/cli.js` leaves `list`/`stats` unwrapped on the premise that `readLedger` swallows reads. `JSON.stringify` of the read-back array can still throw (e.g. a hand-written ledger row containing a BigInt or a circular structure surviving parse), producing a raw stack dump instead of the documented clean exit 1. Mirror the verdict-cli try/catch. |
| LOW | file | bug | `negative-attestation/store.js:183` (`recordAttestation`) | **Comment-vs-code: "already frozen by the producer" is not true on the live ingest path.** `failure_signature` is stored VERBATIM as the parsed-from-JSON object from `record-from-decompose` (`JSON.parse` → unfrozen), but the comment asserts it is "already frozen + validated by the producer". The in-process `buildFailureSignature` producer does freeze, but the actual live producer is the file ingest. Combined with the read-back leak above, the stored nested `failure_signature` is mutable. Premise-not-probed comment claim. |
| LOW | function | optimization | `verdict-attestation/store.js:243` (`recordVerdict` dedup) + `:237` (mislabel scan) | **O(live) linear scans per record under a batch.** `recordReviewBatch` calls `recordVerdict` N times; each call re-reads the ledger and does a `.find` (mislabel) + a `.some` (dedup) linear scan over all live records — O(N × live) for a batch, plus N whole-ledger RMW rewrites. Bounded by `MAX_REVIEWS_PER_BATCH=64` and `MAX_LEDGER_RECORDS=10000` so not pathological, but a batch-aware `recordVerdicts` (one lock, one RMW, a Map index — mirroring `enrichRecords`) would collapse it to O(live + N), matching the optimization already applied to the enrich path. |
| LOW | function | smell | `verdict-attestation/cli.js:50-54` + `negative-attestation/cli.js:34-38` + `:22-32` | **DRY: `parseArgs` and `tally` are byte-identical copies across the two CLIs.** Both are also duplicated relative to each store's helpers. Minor (small, stable functions), but a shared `lab/_lib/cli-args.js` (next to `enum-key.js`) would remove the copy and is the established pattern for shared lab primitives. |
| INFO | function | optimization | `enrich-from-spawn-state.js:80,104` (`resolveKernelRecord`) | **Full `readdirSync` of the spawn-state base per resolve.** `enrichLedger` calls `resolveKernelRecord` once per unenriched record, each globbing the entire spawn-state base dir and lstat-ing a candidate journal in every run subdir — O(unenriched × runDirs). For the advisory cadence (small batches) this is fine; if the unenriched set ever grows large, hoist the `readdirSync(SPAWN_STATE_BASE)` once per `enrichLedger` pass. Not a correctness issue. |
| INFO | function | smell | `negative-attestation/store.js:188` (`identity.tags`) | **Shallow tag copy.** `tags: Array.isArray(identity.tags) ? identity.tags.slice() : []` copies the array but not its elements; if a caller passes object elements they remain shared. Live callers pass `tags: []`, so latent only — but combined with the read-back leak, the stored array is mutable post-read regardless. |
