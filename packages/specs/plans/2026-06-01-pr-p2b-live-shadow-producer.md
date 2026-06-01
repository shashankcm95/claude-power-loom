# PR-P2b — live shadow producer wiring (record-store goes live-fed)

> **Status**: plan authored 2026-06-01, firsthand-probed, **verify-revised** (3 read-only lenses, all
> APPROVE-WITH-REVISIONS — revisions folded below). The live half of P2: wire the P2a producer primitives
> into the SHADOW spawn-close hook so the content-addressed record-store starts collecting real records.
> Branch `feat/v3.1-pr-p2b-shadow-producer-wiring`. Cadence: this plan → `/verify-plan` ✅ → TDD → build →
> 3-lens → harden → probe → commit → **USER merge gate**.

## Context

P1 (#188) shipped the dormant `record-store.js` keyed by `post_state_hash`. P2a (#189) shipped the
dormant producer primitives: `computePostStateHash`, `buildSpawnRecord`, the `head_anchor` schema field,
and `materializeDelta` returning `tree`+`parentHead`. **P2b is the first LIVE wiring** — it records a
`buildSpawnRecord` at every observed **completed** worktree-spawn close, becoming **record-store's first
production importer** (ending its dormancy).

**The OQ-P2b-1 decision (USER-approved): Option B — read-only, correct-or-null.** The shadow path's
guarded runner (`makeGuardedRunGit`, `READ_ONLY_GIT_SUBCOMMANDS=[status,diff,rev-parse,show-ref]`) refuses
`write-tree`/`commit-tree`. Computing `post_state_hash` from the *uncommitted* working tree would need
`write-tree` (an object-store mutation) — breaking the shadow hook's shipped **"ZERO git mutation"**
contract. Option B instead derives `post_state_hash` from the **committed HEAD tree** (`rev-parse
HEAD^{tree}`, read-only, in the allow-list) when the worktree is clean, and records **`null`** when it is
dirty. `null` is **honest, not lossy**: an uncommitted delta has no *committed* post-state. The
authoritative always-correct hash is computed in **P3** (enforcing), where mutation is already licensed;
both phases call `computePostStateHash` verbatim (the M1 forward-coupling invariant), so a committed
spawn's shadow hash and its P3 hash are identical (pinned by test #8).

**Correct-or-null extends to `head_anchor` too (verify P2B-A1/A2):** the schema defines `head_anchor` as
the *forked-from parent HEAD*, but that value is **not read-only-derivable at close** — the worktree's own
HEAD is the spawn's tip (≠ the fork point for a committed delta), and `deriveParentRoot`'s `git worktree
list` is **refused** by the guarded runner. So P2b records **`head_anchor: null`** (honest absence),
mirroring the `post_state_hash` discipline; P3 computes the real `parentHead` via `materializeDelta` under
licensed mutation.

**Why Option B costs nothing in this phase:** in P2b every spawn is genesis-position
(`is_genesis_position:true` hardcoded; P-PROV proved nesting is impossible), and BOTH live `resolve()`
sites pass `resolveParentFn:undefined` (`spawn-close-resolver.js:408`, `stage-promote.js:225`), so
**nothing reads `post_state_hash` back via the chain at spawn-close** — `readByPostStateHash` has zero
production callers. `post_state_hash` is **write-only provenance** in P2b; its completeness is a P3
(merge-time) consumer requirement, recovered there for free under licensed mutation.

## Routing Decision

```json
{ "task": "P2b live shadow producer wiring: recordSpawnProvenance (read-only post_state_hash, head_anchor=null, completed-gated) into resolveAndJournal; record-store's first production importer",
  "override": "route",
  "override_rationale": "A LIVE change to a fail-soft hook that runs on every spawn close, on the provenance critical path; it ends record-store's dormancy and plants the first records in the canonical store. Read-only + additive, but the fail-soft isolation + zero-mutation contract + the dirty-gate/commit_outcome honesty earn the /verify-plan + 3-lens cadence. Consistent with the PR-3x/PR-P1/PR-P2a arc." }
```

## Runtime Probes (firsthand against the source this session; ✅ re-confirmed by all 3 verify lenses)

| # | Claim | Probe | Result |
|---|---|---|---|
| 1 | `resolveAndJournal` is the SHADOW branch; `main()` dispatches enforcing XOR shadow via `LOOM_RESOLVER_ENFORCE === '1'`; `runId`+`agentId` derived in `main()` | `spawn-close-resolver.js:520-538,501-502,392` | ✅ The producer slots into `resolveAndJournal`; the two paths are **mutually exclusive** → **no double-record**. `runId`/`agentId` in hand. |
| 2 | The guarded runner allows `[status,diff,rev-parse,show-ref]`; the producer's reads (`status --porcelain`, `rev-parse HEAD^{tree}`) pass it; `write-tree`/`commit-tree` refused | `spawn-close-resolver.js:98,313-320` (+ existing test `:420-422` proves `status --porcelain` runs ok) | ✅ Both producer reads pass the existing `makeGuardedRunGit`. **Zero new git verb, zero allow-list change, ZERO mutation.** (`head_anchor=null` drops the earlier 3rd read.) |
| 3 | `computePostStateHash(treeSha)` requires 40/64-hex; **throws** otherwise | `transaction-record.js:127-135` | ✅ On the clean path, gate `treeSha` with `GIT_SHA_RE` before calling (catches a failed `rev-parse` on an empty repo + any non-hex output → `null`, not a throw/skip). Whole producer in its own try/catch. |
| 4 | `buildSpawnRecord` **throws** on empty personaId / un-sanitizable agentId / bad sentinel; `appendRecord` is fail-soft (returns `{ok,reason}`, never throws) | `quarantine-promote.js:378-389,276-301,316-327`; `record-store.js:167-224` | ✅ Wrap in try/catch (fail-soft). `personaId` from `resolvePersonaId` (ALWAYS non-empty: `subagent_type ∥ 'kernel-enforce'`, `:160-165`); `agentId` from the envelope (non-empty, sanitizes). `headAnchor`/`postStateHash` null-tolerant (`:386`). |
| 5 | `appendRecord(record,{runId,stateDir})`: `runId = sha256(session_id).slice(0,16)` (16-hex) passes `isSafeRunId`; the fresh-UUID fallback also passes | `record-store.js:104-111`; `spawn-close-resolver.js:144-150` | ✅ Both `runId` shapes are separator/`..`/null-byte free. A store failure cannot break the hook. |
| 6 | record-store has ZERO production importers + NO dormancy CI gate | `grep -rn require.*record-store packages/` (this session); `ci.yml:209-313` gates only context-envelope/worktree-allocator/k6 | ✅ Only its own test imports it; no gate references it. **P2b's import is the FIRST production importer** (dormancy-ending) and **trips nothing**. |
| 7 | `git status --porcelain` (untracked-aware) is the correct dirty-gate — `diff --name-only HEAD` MISSES untracked new files (empirically verified by the reviewer lens) | git tracked-vs-untracked semantics + `spawn-close-resolver.js:351-361,367-376` (the K14 `diff` is a separate concern, with its own honesty comment) | ✅ An untracked-file spawn is clean per `diff HEAD` but dirty per `status` → using `diff` would compute a **WRONG** `post_state_hash`. `status` is in the allow-list. |
| 8 | `post_state_hash` + `head_anchor` schema are both `oneOf[hex,null]`, optional; the lenient validator checks neither | `transaction-record.schema.json:29-41` (+ `validateTransactionRecord` has no branch for either) | ✅ `post_state_hash:null` (dirty) + `head_anchor:null` are both schema-valid + lenient-valid. |
| 9 | OQ-2 stays LATENT: `buildSpawnRecord`'s `prev_state_hash = computeGenesisHash` (64-hex, ≠ literal `'GENESIS'`/sentinel) still validates in `appendRecord` | `quarantine-promote.js:292`; `record-store.js:146-150,183-188`; `transaction-record.js:285` | ✅ `isGenesisPositionRecord` → false → strict 64-hex check → `computeGenesisHash` IS 64-hex → passes. Records validate + store; **OQ-2 only bites the live non-genesis walk (P3).** |

## Design — additive, read-only, fail-soft, completed-gated

1. **`packages/kernel/_lib/transaction-record.js`** — **export `GIT_SHA_RE`** (verify F4): it is already a
   module-local const (`:99`); add it to `module.exports`. One line; the hook already imports
   `computePostStateHash` from this module, so no new dependency. (The 4 k9-* copies with different names
   are out of scope.)
2. **`packages/kernel/hooks/post/spawn-close-resolver.js`** — new function `recordSpawnProvenance(...)`,
   called from `resolveAndJournal` AFTER the verdict journaling, with its OWN internal try/catch (so a
   producer throw NEVER reaches `resolveAndJournal`'s outer catch — the verdict return stays `{ok:true}`):
   ```js
   // okStdout — fail-CLOSED stdout extractor (verify F2/H1): a non-ok git result returns null, so the
   // dirty-gate (null !== '') reads DIRTY and the sha-gate (GIT_SHA_RE.test(null)) reads false. An
   // unknown git state is NEVER coerced to "clean"/"valid".
   const okStdout = (r) => (r && r.ok && typeof r.stdout === 'string') ? r.stdout.trim() : null;

   function recordSpawnProvenance({ envelope, runGit, stateDir, runId, agentId, personaId, journalFile }) {
     try {
       // Completed-only gate (verify F1/H3 — resolves OQ-P2b-2): a non-completed close plants no record
       // (else the store would hold a commit_outcome:COMMITTED record contradicting the journal's ABORTED).
       if (!envelope || envelope.commit_outcome !== 'COMMITTED') {
         appendJournal(journalFile, { kind: 'shadow-provenance-skipped', reason: 'not-completed', ... });
         return;
       }
       const dirty = okStdout(runGit(['status', '--porcelain'])) !== '';   // null (failed) !== '' => dirty
       let postStateHash = null;
       if (!dirty) {
         const treeSha = okStdout(runGit(['rev-parse', 'HEAD^{tree}']));    // committed post-state tree
         if (treeSha && GIT_SHA_RE.test(treeSha)) postStateHash = computePostStateHash(treeSha);
       }
       // head_anchor=null in P2b (verify P2B-A1/A2): the forked-from parentHead is not read-only-derivable
       // here; P3 computes it under licensed mutation. Recording the worktree HEAD would contradict the
       // field's schema semantics.
       const record = buildSpawnRecord({ agentId, personaId, schemaVersion: SCHEMA_VERSION,
                                         postStateHash, headAnchor: null });
       const appended = appendRecord(record, { runId, stateDir });
       appendJournal(journalFile, { kind: 'shadow-provenance-record', spawn_id: agentId,
         transaction_id: record.transaction_id, post_state_hash: postStateHash, head_anchor: null,
         record_appended: appended.ok, record_reason: appended.ok ? null : appended.reason,
         uncommitted: dirty, observed_status: envelope.observed_status, mode: 'shadow', ... });
     } catch (err) {                                                        // fail-soft isolation
       logger('provenance-record-failed', { error: err.message, agentId });
       appendJournal(journalFile, { kind: 'shadow-provenance-error', spawn_id: agentId, error: err.message, ... });
     }
   }
   ```
   - **`resolveAndJournal`** gains a `personaId` param; calls `recordSpawnProvenance` reusing the SAME
     guarded `runGit` + `stateDir` + `runId` + `agentId` + the same `journalFile`.
   - **`main()`** passes `personaId = resolvePersonaId(input)` into the shadow-branch call (it already
     computes it for the enforcing branch, `:528`).
3. **Imports** (top of the hook): `buildSpawnRecord` (`../../_lib/quarantine-promote.js`),
   `computePostStateHash` + **`GIT_SHA_RE`** (`../../_lib/transaction-record.js`), **`appendRecord`
   (`../../_lib/record-store.js` — the first production importer)**.
4. **No change** to `resolve()`, `makeGuardedRunGit`, the allow-list, the enforcing `stagePromote` path,
   `buildK14CtxFromWorktree`, the schema, `quarantine-promote.js`, `record-store.js`, `hooks.json`,
   `ci.yml`, or the ROADMAP. K1 stays dormant.

## Architectural Decisions

1. **Option B (read-only, correct-or-null)** — USER-approved. Preserves the ZERO-mutation contract;
   `post_state_hash` is **never wrong** (null when dirty); the authoritative hash is deferred to **P3**.
   Both phases call `computePostStateHash` verbatim (M1), pinned by test #8. **Option A (unguarded
   `write-tree`) explicitly rejected** (writes objects to the user's repo every close).
2. **`head_anchor: null` in P2b** (verify P2B-A1/A2) — the forked-from `parentHead` is not
   read-only-derivable at close (the worktree HEAD is the spawn tip; `git worktree list` is refused by the
   guarded runner). Null mirrors the `post_state_hash` correct-or-null discipline; P3 computes the real
   value. Recording the worktree HEAD would store a value contradicting the field's declared meaning.
3. **Completed-spawn gate** (verify F1/H3 — resolves OQ-P2b-2) — the producer records ONLY when
   `envelope.commit_outcome === 'COMMITTED'` (status `completed`). A non-completed close plants no record
   (avoiding a `COMMITTED`-record-vs-`ABORTED`-journal contradiction). A completed-but-dirty spawn records
   `COMMITTED + post_state_hash:null` — coherent: `commit_outcome` is the **provenance record's**
   transaction state (a committed genesis CREATE), not a claim about the spawn's git commit; the absence
   of a captured committed git-state is carried by `post_state_hash:null`. Documented, not buried.
4. **`okStdout` fails CLOSED** (verify F2/H1) — a non-ok git read → `null` → the dirty-gate reads dirty
   and the sha-gate reads false. "I couldn't verify cleanliness" never becomes "clean".
5. **`git status --porcelain` for the dirty-gate** (Probe #7) — untracked-aware; `diff --name-only HEAD`
   would silently miss new files → a wrong hash.
6. **Fail-soft isolation** — `recordSpawnProvenance` has its OWN try/catch; a producer throw is journaled
   (`shadow-provenance-error`) and **never** reaches `resolveAndJournal`'s outer catch or disturbs the
   verdict return. Additive; the existing `shadow-resolver-verdict` journaling is unchanged.
7. **The producer fits the EXISTING guarded runner** (Probe #2) — no unguarded runner, no allow-list
   change, no new git verb. (P2a Probe #5 correctly named BOTH the unguarded-runner path AND this
   read-only-committed-HEAD path — itself calling the latter "lossy on uncommitted"; Option B reframes
   that loss as an honest null. The decision picked P2a's foreseen branch, not a contradiction.)
8. **Export `GIT_SHA_RE`** (verify F4) — 5 production copies already exist (not 3 as first written); the
   hook already imports from `transaction-record.js`, so exporting + importing the canonical const beats a
   6th copy. (The pre-gate is defense-in-depth: `computePostStateHash` throws on its own; the gate lets the
   producer record `null` instead of skipping the whole record.)
9. **Content-addressed concurrency-safety** (verify P2B-A5) — N sibling spawns closing concurrently all
   write under `<stateDir>/<runId>/records/`, but `appendRecord` writes `record-<transaction_id>.json` via
   `writeAtomicString` (tmp+rename); distinct spawns → distinct `transaction_id`s → distinct filenames →
   **no shared-file race** (unlike the per-spawn JOURNAL, which needed the per-agent-file split because it
   is a read-modify-rewrite WAL). Making the store live-fed is concurrency-safe by construction.

## Security review

- **S1 — store write path.** record-store's own CWE-22 guards (`isSafeRunId` + the 64-hex gate +
  `checkWithinRoot` anchored to the state root) protect the write; `runId` is 16-hex (safe). `agentId`
  reaches `writer_spawn_id` (raw) + the sanitized sentinel; record-store re-validates on every load.
- **S2 — ZERO git mutation.** `status` + `rev-parse` only; the shadow contract holds (pinned multi-signal
  by test #4). No unguarded runner introduced.
- **S3 — fail-soft isolation.** A producer throw is caught + journaled; never breaks the spawn or the
  verdict. `appendRecord` never throws; `appendJournal` is itself fail-soft (`appendWalRecord
  {failSoft:true}`), with `resolveAndJournal`'s outer try/catch as the final backstop (verify F6).
- **S4 — fail-soft reader / fail-closed consumer preserved.** A null/missing `post_state_hash` →
  `readByPostStateHash` miss → K9 fail-closed REJECT (the safe direction). P2b only WRITES.
- **S5 — no new external surface.** Same stdin cap, same bounded git buffer, same per-spawn journal as
  PR-3b. The reads are local git on the harness-created worktree.

## TDD test inventory (write RED first — the file's imperative `assert` + `test(...)` style, real temp-git repos per the `:406-420` precedent)

1. **CLEAN completed worktree (committed delta), store-level round-trip** — a record is appended;
   `post_state_hash === computePostStateHash(rev-parse HEAD^{tree})`; `head_anchor === null`;
   `record-store.readByPostStateHash(thatHash, {runId, stateDir})` returns it. **Proves the producer's
   hash is exactly what `readByPostStateHash` reads (the M1 store-level join holds), so when P3 wires
   `resolveParent=readByPostStateHash` the live records resolve** (NOT "feeds the live K9 seam" — that is
   unwired in P2b; verify H4).
2. **DIRTY completed worktree (tracked modification)** — `post_state_hash === null`; `head_anchor ===
   null`; `readById` returns it; `readByPostStateHash` never matches null. **Correct-or-null.**
3. **UNTRACKED-only completed worktree** (a new file; clean per `diff HEAD`, dirty per `status
   --porcelain`) → `post_state_hash === null`. **Proves the `status --porcelain` gate** (Probe #7).
4. **ZERO-mutation, multi-signal** (verify F7) — like the existing `:325-385`: HEAD sha + `show-ref` + the
   recursive `.git/objects` file-set + no new branch — **byte-identical** before/after the producer.
5. **Fail-soft isolation** (verify H5) — `resolvePersonaId` never returns empty, so FORCE the throw
   directly: call `recordSpawnProvenance`/`resolveAndJournal` with `personaId:''` on a completed envelope →
   `buildSpawnRecord` throws → the `shadow-resolver-verdict` entry is STILL present, the hook returns
   `{ok:true}`, AND a `shadow-provenance-error` entry is journaled.
6. **Completed-spawn gate** (verify F1 — resolves OQ-P2b-2) — a non-completed (`status:'error'`) close →
   NO record (`listByRun` empty) + a `shadow-provenance-skipped` journal entry.
7. **Mutual exclusion** — `LOOM_RESOLVER_ENFORCE` unset → the shadow producer records (a `record-*.json`
   exists) AND the enforcing `stagePromote` does NOT run (no `loom-promote` ref). Pin the dispatch.
8. **M1 cross-phase hash equality** (verify P2B-A3 — the linchpin) — for a clean committed-delta worktree,
   `computePostStateHash(rev-parse HEAD^{tree}) === computePostStateHash(materializeDelta(...).tree)`.
   **Pins the P2b↔P3 hash-equality that makes deferring the always-correct hash safe.**
9. **Empty-repo worktree** (verify F5) — `git init`, no commits → `post_state_hash:null`,
   `head_anchor:null`, no throw (`status` ok-empty → clean → `rev-parse HEAD^{tree}` fails → `GIT_SHA_RE`
   gate → null).
10. **End-to-end live-feed through the real hook** — `spawnSync` the hook with a completed worktree-payload
    + a hermetic `LOOM_SPAWN_STATE_DIR` → a `record-<id>.json` appears under `<runId>/records/`.
11. **`okStdout` fail-closed contract** (verify F2) — a non-ok git result → `okStdout` returns `null` →
    the dirty-gate reads dirty (`null !== ''`) → `post_state_hash:null` (never a hash on an unverified
    tree).
12. **Regression** — the existing `shadow-resolver-verdict` journaling is unchanged + present alongside
    the new provenance entry; the existing journal assertions are content-filtered (`.some()`/`.every()`),
    so the additive entry breaks none (verify H2/F3 — R-1's `.pop()` hazard is a phantom; the only `.pop()`
    reads STDOUT, not the journal). **Update the existing direct-call test (`:463`) to pass a `personaId`**
    for signature correctness (the `envelope:null` path throws in `resolve()` before the producer runs).

## Out of scope / deferred

| Item | Why | Target |
|---|---|---|
| Always-correct `post_state_hash` for uncommitted deltas (Option A unguarded `write-tree`, or Option C isolated-object-store) | needs licensed mutation; nothing reads it in P2b | **P3** (via `materializeDelta` at merge time) |
| The enforcing path's record-store wiring (`stagePromote` → `appendRecord`) | the two dispatch paths are mutually exclusive; enforcing is P3 | **P3** |
| `head_anchor` = the real forked-from `parentHead` | not read-only-derivable at close; only consumed by CAS at merge time | **P3** (`materializeDelta.parentHead`) |
| OQ-2 genesis-recognition (`computeGenesisHash` vs literal `'GENESIS'`) | only bites the live non-genesis walk | **P3** |
| The double-failure test (producer throw AND a disk-write failure) | low risk given `{failSoft:true}` + the outer backstop | harden / post-P2b (verify F6) |
| The auto-merge mechanism (HEAD-anchor re-check + sibling-concurrency lock) | the enforcing merge | **P3** |

## Risks & Open Questions

- **OQ-P2b-1 — RESOLVED (Option B, USER-approved):** read-only correct-or-null; preserves ZERO mutation.
- **OQ-P2b-2 — RESOLVED (verify F1/H3):** a non-completed spawn does **not** record provenance (the gate);
  the store holds only completed-spawn records, so `commit_outcome:COMMITTED` never contradicts the
  journal.
- **R-1 — RESOLVED (verify H2/F3):** the "`.pop()` journal-position hazard" does **not** exist — every
  existing journal assertion is content-filtered (`.some()`/`.every()`); the only `.pop()` parses STDOUT,
  which the producer never writes. Test #12 is a forward-looking confirmation, not a repair.
- **R-2:** the producer adds 2 read-only git calls per completed worktree-spawn close → negligible (closes
  are infrequent + bounded; within the existing guarded runner; `MAX_GIT_BUFFER`-bounded).

## HETS Spawn Plan

| Stage | Persona | Lens |
|---|---|---|
| Build | `node-backend` | TDD (RED tests first) → impl `recordSpawnProvenance` (completed-gate, `okStdout` fail-closed, `head_anchor:null`) + the `GIT_SHA_RE` export + wire into `resolveAndJournal` + `main()` personaId pass-through, to green |
| Verify | `architect` + `code-reviewer` + `honesty-auditor` (read-only) | design soundness / fail-soft + zero-mutation + dirty-gate + completed-gate correctness / claim-vs-evidence (the M1 cross-phase equality; `status --porcelain` untracked-correctness; the store-level round-trip framing) |
| Harden | `code-reviewer` | edge cases: detached/empty-repo HEAD, a git error mid-read (the `okStdout` fail-closed path), untracked-only, the dirty↔clean boundary, the double-failure backstop, the additive-journal-entry regression |
| Probe | independent | the M1 equality (#8) + zero-mutation multi-signal (#4) + the end-to-end hook live-feed (#10) + full smoke `118/0` |

Read-only verify personas only (architect/code-reviewer/honesty), never Write-capable.

## Drift Notes

- **DN-1 (the decision picked P2a's foreseen branch):** P2a Probe #5 explicitly enumerated BOTH the
  unguarded-runner path AND the read-only-committed-HEAD path (calling the latter "lossy on uncommitted
  changes"). Option B is that second branch; "correct-or-null" and "lossy on uncommitted" describe the
  identical behavior — P2b reframes the loss as an honest null. The design choice removed the
  unguarded-runner need; it did not contradict the probe. (Honesty-lens H6 confirmed this framing.)
- **DN-2 (a subtle git correctness trap):** `diff --name-only HEAD` MISSES untracked files — using it for
  the cleanliness gate would compute a WRONG `post_state_hash` from `HEAD^{tree}` for an untracked-file
  spawn (clean per `diff`, dirty per `status`). `git status --porcelain` is the correct untracked-aware
  dirty-check. Caught by reasoning about git's tracked-vs-untracked semantics, not by reusing the nearby
  K14 `diff` call.
- **DN-3 (write-only provenance reframes the completeness tradeoff):** because every P2b spawn is
  genesis-position and `readByPostStateHash` is unconsumed at spawn-close, `post_state_hash` is write-only
  here — so Option B's null-for-dirty costs nothing this phase, and the "always populate it now" instinct
  (Option A/C) buys a corruption hazard for a field no consumer reads until P3.
- **DN-4 (correct-or-null is a uniform discipline, not a post_state_hash special-case):** the verify pass
  extended it to `head_anchor` — a field whose schema-correct value is unknowable read-only at close gets
  `null`, not a plausible-but-wrong substitute (the worktree HEAD). "Store correct-or-null, never
  misleading" is the through-line; a field that cannot be honestly computed in a phase is null in that
  phase.

## Pre-Approval Verification

Three read-only HETS lenses reviewed this plan against the live repo @
`feat/v3.1-pr-p2b-shadow-producer-wiring`, each mandated to re-confirm the six load-bearing claims from
primary source (run as a background Workflow, `wf_20a89129-76f`).

**Verdicts:** architect `APPROVE-WITH-REVISIONS` · code-reviewer `APPROVE-WITH-REVISIONS` · honesty
`APPROVE-WITH-REVISIONS`. **No CRITICAL.** **All six load-bearing claims + both honesty pillars
independently confirmed from primary source:** the producer's reads fit the existing read-only allow-list
(`spawn-close-resolver.js:98,313-320`); `status --porcelain` is the correct untracked-aware dirty-gate
(empirically verified by the reviewer + corroborated by the file's own `:351-361` comment);
`computePostStateHash` throws on non-hex (`:127-135`); `buildSpawnRecord` throws / `appendRecord` is
fail-soft; the `LOOM_RESOLVER_ENFORCE==='1'` dispatch is mutually exclusive; record-store has zero
importers + no CI gate; **"ZERO git mutation" is genuinely preserved** (rev-parse + status are pure reads);
and **`post_state_hash` is genuinely write-only at spawn-close** (`resolveParentFn:undefined` at both live
sites; zero `readByPostStateHash` production callers). All revisions are folded above.

| # | Lens | Sev | Finding | Resolution |
|---|---|---|---|---|
| P2B-A1/A2 | architect | MED ×2 | `head_anchor`=worktree HEAD contradicts the schema's "forked-from parentHead" semantic; the fork-point is NOT read-only-derivable (`git worktree list` refused by the guarded runner) | **`head_anchor: null` in P2b** (AD-2). Extends correct-or-null to `head_anchor`; P3 computes the real `parentHead` under licensed mutation. Drops the 3rd git read. |
| F1 / H3 | reviewer+honesty | HIGH/MED | `buildSpawnRecord` hardcodes `commit_outcome:'COMMITTED'` → an errored spawn's record contradicts the journal's ABORTED verdict | **Completed-spawn gate** (AD-3 — resolves OQ-P2b-2): record only when `envelope.commit_outcome === 'COMMITTED'`. Documented that a completed-but-dirty record (`COMMITTED`+null) is coherent (record-transaction state, not a git-commit claim). |
| F2 / H1 / P2B-A6 | reviewer+honesty+architect | HIGH | the `okStdout` helper is undefined; the dirty-gate's failed-read direction is unspecified | **Defined `okStdout` fail-CLOSED** (AD-4): non-ok → `null` → dirty-gate reads dirty, sha-gate reads false. Pinned by test #11. |
| F4 / P2B-A4 | reviewer+architect | MED/LOW | the plan said "3 existing GIT_SHA_RE copies"; actual is **5** — adding a 6th compounds a DRY violation | **Export `GIT_SHA_RE`** from `transaction-record.js` + import it (AD-8); the hook already imports from that module. Count corrected. |
| P2B-A3 | architect | LOW | the P2b↔P3 "same hash" promise (M1) rests on `HEAD^{tree} == materializeDelta.tree` for a clean worktree, asserted only in prose | **Added test #8** (the cross-phase equality) — the single claim that makes deferring the always-correct hash safe. |
| F7 | reviewer | LOW | test #4's `git count-objects` oracle false-passes under packing | **Multi-signal zero-mutation** (test #4) — HEAD + `show-ref` + `.git/objects` file-set + no-new-branch, like the existing `:325-385`. |
| F5 | reviewer | MED | empty-repo degradation is correct but untested | **Added test #9** (empty-repo → null, no throw). |
| F3 / H5 | reviewer+honesty | HIGH/LOW | the existing direct-call test (`:463`) omits `personaId`; `resolvePersonaId` never returns empty so test #5's empty-personaId path is unreachable from `main()` | **Update `:463`** to pass `personaId`; **test #5 FORCES the throw directly** (`personaId:''`); documented `resolvePersonaId` is always non-empty. |
| H2 / F3 | honesty+reviewer | MED | R-1's `.pop()` journal hazard does NOT exist — all journal asserts are content-filtered; the only `.pop()` reads STDOUT | **R-1 softened to RESOLVED**; test #12 reframed as a forward-looking confirmation, not a repair. |
| H4 | honesty | LOW | test #1's "feeds the live K9 resolveParent seam" over-claims (the seam is unwired at spawn-close) | **Reworded** test #1 to "proves the store-level M1 join holds, so P3's wiring resolves" — aligned with the write-only-in-P2b framing. |
| P2B-A5 | architect | LOW | the store's sibling-concurrency safety (content-addressed one-file-per-id) is unstated | **Documented** (AD-9): distinct `transaction_id`s → distinct filenames → no shared-file race (contrast the journal's per-agent-file split). |
| F6 | reviewer | MED | the double-failure (producer throw AND `appendJournal` failure) is untested | **Documented** the `appendJournal` fail-soft + outer backstop (S3); the double-failure test **deferred to harden** (low risk). |
| F8 | reviewer | LOW | Probe #3 wording implies dirty-detection is the only guard before `rev-parse` | **Reworded** Probe #3 (the `GIT_SHA_RE` gate also catches a failed `rev-parse` on an empty repo). |
| H6 | honesty | NIT | DN-1's framing — confirmed HONEST (P2a Probe #5 itself named this "lossy" branch) | DN-1 amended with the "lossy"≡"honest null" clause; no defect. |

**Net:** the design is APPROVED. The core architecture (Option B read-only correct-or-null, fail-soft
isolation, zero mutation, no new git surface, mutually-exclusive dispatch, the M1 forward-coupling
invariant) holds against primary source. The two HIGH items (F1 `commit_outcome` honesty, F2 `okStdout`
fail-closed) and the `head_anchor:null` reconciliation are folded. **Build-ready.**
