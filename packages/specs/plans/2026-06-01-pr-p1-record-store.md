# PR-P1 — `record-store.js` (dormant): the provenance state-chain store

> **Status**: plan authored 2026-06-01, firsthand-probed (not recon-trusted). The first PR of the
> provenance arc. Ships **DORMANT** (only its own test imports it). Branch
> `feat/v3.1-pr-p1-record-store`. Cadence: this plan → `/verify-plan` → TDD → build → 3-lens →
> harden → independent probe → commit → **USER merge gate**.

## Context

The v3.1 enforcing arc (#185/#186/#187) made the kernel transaction loop reachable in production
but **quarantine-confined**. The harness probe (`packages/specs/spikes/p-prov-harness-payload-*`)
then established that nesting is impossible (every spawn is genesis-from-main) and `tool_use_id` is
a stable init↔close key — reframing safe auto-merge-to-HEAD from "harness-blocked" to "buildable
kernel work (HEAD-anchor + close-time concurrency lock)."

**PR-P1 builds the one foundational missing primitive**: an on-disk store that backs K9's
`resolveParent` chain-walk seam. Today that seam is `undefined` at every live call site and there
is no store for it to read. PR-P1 supplies the store + reader, **dormant** (no production importer),
fully tested. It is the dependency for P2 (wire the live shadow chain-walk) and the eventual
auto-merge.

**This plan corrects a fallacy in the prior (HETS-verified) design** — see Runtime Probe #1.

## Routing Decision

```json
{ "task": "PR-P1 dormant record-store backing K9 resolveParent (state-chain store)",
  "override": "route",
  "override_rationale": "Security-sensitive kernel primitive on the auto-merge critical path; a non-obvious keying contract that the prior design + 3 lenses got WRONG (Probe #1); CWE-22 path-from-hash surface. One module, but earns the full /verify-plan + 3-lens + harden cadence. Consistent with the PR-3x arc routing." }
```

## Runtime Probes (every claim verified firsthand against the source this session)

| # | Claim | Probe | Result |
|---|---|---|---|
| **1** | **The chain key is `post_state_hash`, NOT `transaction_id`** (the prior design + recon + code-reviewer FLAG all said `transaction_id` — a FALLACY) | `v6-substrate-synthesis.md:554,574,753-754` + `_test-harness.js:167` + `inv-19…test.js:98` vs `transaction-loop.test.js:305` | ✅ Spec §554: *"Subsequent transactions MUST set [`prev_state_hash`] to the **`post_state_hash`** of the most recent COMMITTED transaction."* Example record (`:753-754`): record2.`prev_state_hash`==record1.`post_state_hash`, **≠** record1.`transaction_id`. `synthesizeChain` (canonical) sets `prevStateHash = postStateHash`. The `transaction_id` claim was read off the e2e test's self-stubbed SHORTCUT (`:305`). **`resolveParent(h)` = the record whose `post_state_hash === h`.** |
| 2 | `post_state_hash` has zero live producers **on a transaction-record** | `quarantine-promote.js buildGenesisRecord:268-276` omits it; `spawn-record.js` never sets it | ✅ The state-chain walk over REAL records is gated on a P2/P3 producer that computes `post_state_hash`. **Disambiguation (verify-plan F10):** a grep finds `post_state_hash` set at `k9-promote-deltas.js:434` etc. — those are **K9-JOURNAL** entries (a different artifact/chain), NOT transaction-records; irrelevant to this store's seam. PR-P1 (dormant) tested with local-helper records that carry it. Not a blocker. |
| 3 | K9 `resolveParent` contract: returns a full record; walk is fail-closed | `k9-promote-deltas.js:137-191` | ✅ `cursor.prev_state_hash` → `resolveParent(prevHash)` → `isGenesisPosition(parent)` (reads `parent.prev_state_hash`, `:88-92`). A non-genesis record with no resolveParent → REJECT (`:163`). A miss (`null`) → `chain-bottomed-out-non-genesis` REJECT (`:180`). **Fail-soft store + fail-closed K9 = a read miss safely → quarantine.** |
| 4 | `transaction_id` = content hash (the primary key) | `transaction-record.js:62-70` | ✅ `sha256(canonical_json(record_minus_transaction_id))`. Always present, unambiguous → `readById` primary key. |
| 5 | `validateTransactionRecord` does NOT enforce `additionalProperties:false`; rejects `_test_chain_marker` | `transaction-record.js:199-279` (esp. `:213-218`) | ✅ Checks `required` + spot-checks enums/patterns only. **Rejects any record carrying `_test_chain_marker` (F23)** → the store's write-validation refuses synthetic chains; tests must use marker-stripped records. |
| 6 | Write pattern to mirror: one file per record, atomic | `spawn-record.js:334-343` + `atomic-write.js:135,149` | ✅ `writeAtomicString(file, …)` ("same-filesystem POSIX-atomic"); one `spawn-<id>.json` per record under `path.join(SPAWN_STATE_DIR, runId)`. **Reuse `writeAtomicString`; one file per record → no shared-WAL concurrent-append race.** |
| 7 | `isAcyclicChain` is in-set cycle check, NOT completeness; operates on the LINEAGE edge | `lineage.js:54-95` (esp. `:88`) | ✅ Dangling parent ref = "acyclic-by-convention"; *"caller responsible for chain completeness."* Operates on `{state_id, parent_state_id}` — the **lineage** chain (parent_state_id→writer_spawn_id), a DIFFERENT chain than the `post_state_hash` **state** chain K9 walks. **PR-P1 serves the state chain; lineage chain is out of scope (no-nesting made it mostly moot).** |
| 8 | A new `record-store.js` trips no CI dormancy gate | `.github/workflows/ci.yml:209-313` | ✅ Gates `-k3b`/`-k1`/`-k6` each grep ONE specific module (`context-envelope`/`worktree-allocator`/`k6-subset-check`). No `record-store` gate, no generic spawn-state-writer gate. **Trips nothing.** (Optional: author a `dormancy-assertion-record-store` mirroring these + self-delete in P2 — deferred; not required.) |
| 9 | `SPAWN_STATE_DIR` derivation | `spawn-record.js:77` | ✅ `path.join(os.homedir(), '.claude', 'spawn-state')`. Store writes under `<stateDir>/<runId>/records/` (configurable `stateDir` for tests). |

## Design — `packages/kernel/_lib/record-store.js` (NEW, dormant)

A content-addressed transaction-record store backing K9's `resolveParent` seam. **Two substrate
chains exist — do NOT conflate** (Probe #7): the **STATE chain** (`prev_state_hash` →
predecessor's `post_state_hash`, what K9 walks — served here) vs the **LINEAGE chain**
(`parent_state_id` → `writer_spawn_id`, `lineage.js`, separate, out of scope).

```
module.exports = {
  appendRecord,          // (record, {runId, stateDir?}) => {ok, file?, transaction_id?, reason?}
  readById,              // (transactionId, {runId, stateDir?}) => record|null   — content-addressed primary
  readByPostStateHash,   // (postStateHash, {runId, stateDir?}) => record|null   — THE K9 resolveParent seam
  listByRun,             // ({runId, stateDir?}) => record[]                     — sibling set (run/session grouping)
  recordStoreDir,        // ({runId, stateDir?}) => string                       — on-disk dir (tests/inspection)
}
```

- **Persistence**: one file per record at `<stateDir>/<runId>/records/record-<transaction_id>.json`
  via `writeAtomicString` (Probe #6 — creates the parent dir + is rename-atomic; no separate
  `mkdirSync` needed). The `records/` subdir keeps it disjoint from spawn-record's `spawn-*.json`.
  **This store is a content-addressed CACHE keyed by `transaction_id`, NOT the canonical attestation
  WAL** (F6 MEDIUM) — it does not `fsync` per record; durability is the WAL's job, and a lost cache
  entry degrades safely to a K9 fail-closed quarantine. Forecloses the dual-write-inconsistency trap.
- **`appendRecord`** (write-validation, ORDER IS LOAD-BEARING — F3): (1) `validateTransactionRecord(record)`
  — the **lenient runtime** validator (rejects `_test_chain_marker` via `:213` + missing-required;
  deliberately does NOT apply the schema file's `additionalProperties:false`, preserving
  `INV-K2-SchemaForwardCompat`); only if `.valid`, then (2) the `record.transaction_id ===
  computeTransactionId(record)` integrity check. `{ok:false, reason}` on reject; never throws.
- **`readById`**: hex-validate `transactionId` (`/^[a-f0-9]{64}$/`) BEFORE any `path.join` (CWE-22 —
  a non-hex key returns null at the gate, no filesystem reach); defense-in-depth `checkWithinRoot`
  (`path-canonicalize.js:163`). `validateTransactionRecord` on load; invalid/parse-error → null (fail-soft).
- **`readByPostStateHash`** (the K9 seam): hex-validate the key; `readdirSync` wrapped (ENOENT → null),
  parse each (skip parse-error + invalid), return the record whose `post_state_hash === key`
  (value-strict — a `null`/absent `post_state_hash` never matches a 64-hex key). On a duplicate
  `post_state_hash` in one run (data corruption) returns an arbitrary match — K9's fail-closed walk is
  the correctness gate. Per-call scan, bounded by the run; an in-memory index is a P2 optimization
  (YAGNI). No hash-keyed object is built → no prototype-pollution surface in PR-P1 (the Map/null-proto
  discipline applies to the P2 index when it lands).
- **`listByRun`**: `readdirSync` wrapped (ENOENT → `[]`); read + validate all `record-*.json`; return
  the valid set (skip invalid/corrupt).
- **All readers fail-soft** (null/[] on missing dir / parse error / invalid record) — composes with K9's
  fail-closed walk (Probe #3): a read miss safely degrades to REJECT/quarantine, never silent-admit.

## Architectural Decisions

1. **Key the state chain by `post_state_hash`** (Probe #1), `transaction_id` is the content-addressed
   primary. The corrected keying is pinned by an **anti-fallacy regression test** (below) so it
   cannot silently regress in P2.
2. **Include `readByPostStateHash` now** (dormant), not deferred — its value is codifying the
   corrected key as an executable contract while the fallacy analysis is fresh. Testable today via
   `synthesizeChain` records (which carry `post_state_hash`). The `post_state_hash` *producer* stays
   deferred to P2/P3 (Probe #2).
3. **Serve the STATE chain only**; the lineage chain (`parent_state_id`/`isAcyclicChain`) is a
   separate concern, now mostly moot post-no-nesting (Probe #7). KISS — no lineage assembly here.
4. **One file per record** (Probe #6) → no shared-WAL concurrent-append race; reuse `writeAtomicString`.
5. **Dormant-first** (mirrors K9/K3.b/quarantine-promote): no production importer; only the test
   imports it. Trips no CI gate (Probe #8). `resolve()`/hooks/`ci.yml`/ROADMAP byte-untouched.
6. **K1 stays dormant**; this PR adds no `worktree-allocator` import (observe-don't-allocate).

## Security review

- **S1 — CWE-22 (path from hash).** `readById`/`readByPostStateHash` derive a filename from the
  caller-supplied key. Strict `/^[a-f0-9]{64}$/` hex-gate BEFORE any `path.join`; defense-in-depth
  `checkWithinRoot(file, recordStoreDir)` (reuse `_lib/path-canonicalize`). A non-hex key → null,
  never a filesystem reach.
- **S2 — untrusted record content.** Records are attacker-influenceable (writer_spawn_id carries a
  raw agentId). `validateTransactionRecord` on every load; invalid records are skipped, never
  returned to the walk. No record field is ever `eval`/`path.join`'d without validation.
- **S3 — prototype pollution.** Any hash-keyed lookup uses `Map`/`Object.create(null)` (the
  `buildK14Ctx` precedent) — an adversarial `__proto__`/`constructor` post_state_hash cannot poison.
- **S4 — fail-soft ≠ fail-open.** Readers fail-soft (null), but the consumer (K9) is fail-CLOSED
  (Probe #3) — a dropped/corrupt record degrades to REJECT/quarantine, the safe direction. This
  composition is the load-bearing property; preserve it.
- **S5 — write integrity.** `appendRecord` rejects a record whose `transaction_id` ≠
  `computeTransactionId(record)` — a record cannot be stored under a forged/mismatched id.

## TDD test inventory (write RED first) — `tests/unit/kernel/_lib/record-store.test.js`

**Test-data helper (verify-plan F1 CRITICAL):** build records via a **local valid-record helper** that
emits records WITHOUT `_test_chain_marker` from the start. Do **NOT** strip the marker off
`synthesizeChain` output for `appendRecord` tests — its `transaction_id` is computed *over* the marker
(`_test-harness.js:165` hashes the record incl. `_test_chain_marker:true`), so a post-hoc strip makes
`record.transaction_id !== computeTransactionId(strippedRecord)` and `appendRecord`'s integrity check
silently rejects it (a write-reject masquerading as a read-miss). The helper emits canonical records
(distinct `post_state_hash` per record); the genesis record's `prev_state_hash = 'GENESIS'` (the literal
sentinel K9 recognizes, `k9-promote-deltas.js:88-92`) — NOT `computeGenesisHash`, which the walk's
`isGenesisPosition` does not recognize (see OQ-2).

1. `appendRecord` + `readById` round-trip: assert `.ok === true`, then fetch by `transaction_id`.
2. `appendRecord` rejects an invalid record (missing required field) → `{ok:false}`, no file written.
   **Order (F3 HIGH):** `validateTransactionRecord` runs FIRST, then the `computeTransactionId` integrity check.
3. `appendRecord` rejects `transaction_id` ≠ `computeTransactionId(record)` on an otherwise-valid record (forged-id guard).
4. `appendRecord` rejects a record carrying `_test_chain_marker` via `validateTransactionRecord` (the dedicated `:213` branch, before the integrity check).
5. **Forward-compat (F4 MEDIUM):** `appendRecord` ACCEPTS a valid record carrying an extra unknown field (`INV-K2-SchemaForwardCompat`) — the store uses the lenient runtime `validateTransactionRecord`, NOT the schema's `additionalProperties:false`.
6. `readByPostStateHash` returns the record whose `post_state_hash === key`; a PENDING record (`post_state_hash:null`) in the same store is **never** returned and never matches any key (the hex key-gate precludes a `null` match) — F5 MEDIUM.
7. **ANTI-FALLACY (load-bearing):** over a local-helper chain of N — `readByPostStateHash(child.prev_state_hash)` returns the parent; **and** assert explicitly over `listByRun` that **no** stored record has `transaction_id === child.prev_state_hash` (so `readById(child.prev_state_hash) === null`). Locks Probe #1 as a checked fact over the set, not a structural assumption (F-honesty LOW).
8. **K9 integration (executable proof):** genesis record built with `prev_state_hash:'GENESIS'`. `k9.checkEvidenceLinkPreCommit({record: child, isGenesisPosition:false, resolveParent: h => store.readByPostStateHash(h)})` → assert `ok:true` **and** `depthWalked >= 1`. The SAME with `resolveParent: h => store.readById(h)` → assert `ok:false` **and** `reason === 'chain-bottomed-out-non-genesis'` — the `transaction_id` keying fails the real gate, for the intended reason (F7 FLAG).
9. CWE-22: `readById('../../etc/passwd')` / any non-hex key → `null`; a `fs.readFileSync` spy asserts it is **never called** for a non-hex key (the hex-gate returns before any `path.join`) — F8 FLAG.
10. Fail-soft / TOCTOU: readers on a truly-absent run dir (no append yet) → `null`/`[]`, no throw — `readdirSync`/`readFileSync` wrapped (ENOENT → `[]`/`null`), no `existsSync` pre-check (F9 FLAG).
11. `listByRun` returns the sibling set and skips an invalid/corrupt `record-*.json` (write garbage, assert excluded).
12. Concurrency: two `appendRecord` calls for distinct records in the same run → both files present (one-file-per-record, no clobber).

## Verification probes (end-to-end)

| # | Probe | Pass |
|---|---|---|
| P1 | `record-store.test.js` | all green incl. the anti-fallacy (#6) + K9-integration (#7) |
| P2 | `grep -rE "require.*record-store" packages/ --include=*.js \| grep -v tests/ \| grep -v 'record-store.js'` | **zero** production importers (dormant) |
| P3 | `git diff --stat` vs main | only `record-store.js` + its test (+ this plan + the spike files); `resolve()`/hooks/`ci.yml`/ROADMAP untouched |
| P4 | `bash install.sh --hooks --test` | eslint (Test 84, zero `eslint-disable` ADR-0006) + yaml + markdownlint green |
| P5 | full kernel unit suite | green (no regression; record-store is additive + dormant) |

## Out of scope / deferred

| Item | Why | Target |
|---|---|---|
| `post_state_hash` **producer** (compute + set it on real records) — *what* the post-state hash is for a git-delta spawn | the store reads it; producing it is the wiring side | P2/P3 (a real design OQ) |
| Wiring `resolveParentFn = h => store.readByPostStateHash(h)` into the live shadow hook | dormant-first; shadow is the proving ground | P2 |
| LINEAGE chain (`parent_state_id`/`isAcyclicChain`) support | separate chain; mostly moot post-no-nesting | if/when needed |
| `readByPostStateHash` in-memory index (vs per-call scan) | premature; run is bounded | P2 if the live walk shows cost |
| HEAD-anchor + close-time concurrency lock (the auto-merge mechanism) | downstream of the store | post-P3 |

## Risks & Open Questions

- **OQ-1 (the deferred crux):** how is `post_state_hash` computed for a git-delta spawn — the
  resulting tree sha? a content hash of the post-merge state? Gates the *live* walk (P2/P3), not
  PR-P1. Surfaced, not resolved here.
- **OQ-2 (THIRD substrate inconsistency — surfaced by verify-plan F2):** genesis-**recognition** format
  mismatch. The genesis producers emit `prev_state_hash = computeGenesisHash(...)` (a 64-hex;
  `synthesizeChain:113`, `buildGenesisRecord:268`, per spec §4.3), but the chain-walk's
  `isGenesisPosition` (`k9-promote-deltas.js:88-92`) recognizes ONLY the literal `'GENESIS'` or a
  bootstrap sentinel — NOT `computeGenesisHash` output. So a **live non-genesis walk** reaching a real
  genesis record would NOT terminate (→ `chain-bottomed-out` REJECT). The enforcing path works today
  only because the external `is_genesis_position:true` flag short-circuits the walk for a genesis spawn
  (`:146,157`). Reconciling producer-format vs walk-recognizer is **P2/P3** (the live non-genesis walk).
  PR-P1 test #8 uses the literal `'GENESIS'` (the walk-recognized form). Not a PR-P1 blocker.
- **R-1:** the e2e `transaction-loop.test.js` uses the `transaction_id` shortcut (Probe #1). It is
  internally consistent (own stub) so it stays green, but it is **misleading** as a chain-model
  reference. Non-blocking; a candidate test-fidelity fix (make it use `post_state_hash`) is noted,
  not bundled.
- **R-2:** `readByPostStateHash` per-call scan is O(records) — fine while dormant + bounded; flagged
  for P2 if live cost shows.

## HETS Spawn Plan

| Stage | Persona | Lens |
|---|---|---|
| Build | `node-backend` | TDD-treatment (RED tests first) → impl to green |
| Verify | `architect` + `code-reviewer` + `honesty-auditor` (read-only) | design soundness / concrete bugs + edge cases / claim-vs-evidence (esp. re-confirm Probe #1 against the spec, NOT the e2e test) |
| Harden | `code-reviewer` | fd/lock/concurrency/CWE-22 edge coverage |
| Probe | independent Runtime-Claim re-run | re-grep dormancy (P2) + the anti-fallacy keying (P1 #6/#7) |

The verify lenses are **read-only** (architect/code-reviewer/honesty), never Write-capable
(security-auditor/node-backend) — per the read-only-verify rule.

## Drift Notes

- **DN-1 (load-bearing — `drift:plan-honesty` recurrence):** the prior provenance design + recon +
  the code-reviewer's explicit FLAG all specified `transaction_id` keying — a **fallacy** read off
  the e2e test's self-stubbed shortcut, refuted by the canonical spec (Probe #1). THIRD instance
  this session of multi-reviewer blessing missing ground truth (design premise → harness probe;
  keying → spec probe; `isAcyclicChain`-completeness → source probe). Reinforces: **probe the
  primary source (spec/synthesizer), not the convenient test.**
- **DN-2:** two distinct substrate chains (state via `post_state_hash`; lineage via
  `parent_state_id`) were conflated in the design + this session's earlier "child→parent =
  parent_state_id" framing. K9 walks the STATE chain. Worth a one-line clarification in the kernel
  docs (candidate, not bundled).

## Pre-Approval Verification

Three read-only HETS lenses (architect + code-reviewer + honesty-auditor) reviewed this plan against
the live repo @ `feat/v3.1-pr-p1-record-store`, each **mandated to independently re-verify the
`post_state_hash` keying against the canonical spec** — not this plan, not the e2e test.

**Verdicts:** architect `APPROVE-WITH-REVISIONS` · code-reviewer `NEEDS-REVISION` · honesty
`APPROVE-WITH-REVISIONS` (grade **A-**). **The `post_state_hash` keying (Probe #1) was independently
confirmed by all three** against `v6-substrate-synthesis.md:554` + the example records `:753-754`
(record2.`prev_state_hash` == record1.`post_state_hash` ≠ record1.`transaction_id`) +
`_test-harness.js:167` (`prevStateHash = postStateHash`). The module design + security model are
sound; **every revision is in the TEST INVENTORY + plan precision — none in the record-store design.**

| # | Lens | Sev | Finding | Resolution |
|---|---|---|---|---|
| F1 | code-reviewer | **CRITICAL** | marker-stripped `synthesizeChain` records fail `appendRecord` — `transaction_id` is computed OVER the marker (`_test-harness.js:165`), so stripping breaks the integrity check (write-reject masquerading as read-miss) | TDD preamble rewritten: **local valid-record helper** (no marker); `synthesizeChain` banned for append tests |
| F2 | code-reviewer | **HIGH** | K9-integration test fails — `synthesizeChain` genesis uses `computeGenesisHash`, which K9's `isGenesisPosition` does NOT recognize | helper builds genesis with literal `'GENESIS'`; **OQ-2** documents the producer-vs-recognizer mismatch (a 3rd inconsistency) |
| F3 | code-reviewer | **HIGH** | `appendRecord` validation ORDER unspecified | design pinned: `validateTransactionRecord` FIRST, then integrity check (test #2) |
| F4 | architect | MED | must use lenient runtime validator, NOT schema `additionalProperties:false` (forward-compat) | design pinned + test #5 (accepts unknown extra field) |
| F5 | architect | MED | `readByPostStateHash` must skip `post_state_hash:null` (PENDING) | design + test #6 |
| F6 | architect | MED | store is a CACHE not the WAL; `writeAtomicString` no-fsync | module-header note (cache-not-WAL; durability via WAL; lost entry → fail-closed quarantine) |
| F7 | architect+CR | FLAG | assert reason strings, not just ok | test #8 asserts `chain-bottomed-out-non-genesis` + `depthWalked>=1` |
| F8 | code-reviewer | FLAG | CWE-22 test under-specified | test #9: `fs.readFileSync` spy asserts no read for a non-hex key |
| F9 | architect | FLAG | readers ENOENT→[]/null (TOCTOU), not `existsSync` | design + test #10 |
| F10 | honesty | LOW | Probe #2 under-qualified — grep finds 5 JOURNAL `post_state_hash` producers (different artifact) | Probe #2 amended (transaction-record vs K9-journal) |
| F11 | honesty | LOW | Probe #5 validator-vs-schema imprecision; Probe #6/#9 citation paths omit `spawn-state/` | noted; `_test_chain_marker` rejection is the dedicated `:213` branch, not `additionalProperties` |

**Net:** verify-plan caught 1 CRITICAL + 2 HIGH **test-inventory** bugs that would have produced
un-GREEN-able RED tests (the marker/`computeTransactionId` trap; the genesis-recognition trap), **before
the build** — saving a rework loop. The keying correction (the point of this plan) was
triple-independently confirmed against the spec. It also surfaced a **third** substrate inconsistency
(OQ-2). The record-store design is APPROVED; the plan is **build-ready** with the above folded in.
