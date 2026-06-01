# PR-P2a — provenance producer primitives (dormant): post_state_hash + head_anchor

> **Status**: plan authored 2026-06-01, firsthand-probed. The dormant-primitives half of P2,
> mirroring the PR-3c-a→3c-b discipline. Branch `feat/v3.1-pr-p2-shadow-producer`. Cadence:
> this plan → `/verify-plan` → TDD → build → 3-lens → harden → probe → commit → **USER merge gate**.

## Context

P1 (#188) shipped the dormant `record-store.js` keyed by `post_state_hash`. P2 is the **producer**
that writes real records to it at spawn-close — making the store live-fed and recording the
`head_anchor` (the forked-from HEAD), which is the auto-merge prerequisite.

**P2 splits** (proactively, per the 3c-a→3c-b lesson — and now a concrete technical reason):

- **P2a (THIS PR, dormant):** the additive primitives — a `head_anchor` schema field,
  `computePostStateHash`, a `buildSpawnRecord` builder, and `materializeDelta` returning the
  `tree`+`parentHead` it already computes. No live wiring; nothing new runs on a real spawn.
- **P2b (next):** wire the producer into the live SHADOW hook (`spawn-close-resolver`'s
  `resolveAndJournal`). Gated on a design decision the recon surfaced: the shadow path's git seam
  (`makeGuardedRunGit`, `READ_ONLY_GIT_SUBCOMMANDS = [status,diff,rev-parse,show-ref]`,
  `spawn-close-resolver.js:98,316`) **REFUSES `write-tree`/`commit-tree`** — so the live producer
  needs an **unguarded runner + a deliberate mutation-profile change** (dangling tree/commit objects).
  That is non-trivial and belongs in its own gated PR (Probe #5).
- **P3:** the enforcing auto-merge mechanism (HEAD-anchor re-check + sibling-concurrency lock).

P2a is purely additive + dormant — low-risk, and it pins the load-bearing `post_state_hash=sha256(tree)`
decision + the `head_anchor` schema in tested code while the design analysis is fresh.

## Routing Decision

```json
{ "task": "P2a dormant producer-primitives (head_anchor schema + computePostStateHash + buildSpawnRecord + materializeDelta tree/parentHead return)",
  "override": "route",
  "override_rationale": "Kernel provenance primitives on the auto-merge critical path; a schema amendment under additionalProperties:false; a load-bearing post_state_hash-formula decision (chain-consistency). Additive/dormant, but earns the /verify-plan + 3-lens cadence. Consistent with the PR-3x/PR-P1 arc." }
```

## Runtime Probes (firsthand against the source this session)

| # | Claim | Probe | Result |
|---|---|---|---|
| 1 | The schema is `additionalProperties:false`; `post_state_hash` exists (64-hex\|null); `head_anchor` does NOT | `transaction-record.schema.json:17,29-35` (read full) | ✅ `post_state_hash` is `oneOf[64-hex,null]` — no amendment needed for it. `head_anchor` is absent → **adding it REQUIRES a schema amendment** (the in-process validator tolerates unknowns, but the schema rejects them — the F6/P1 lesson). |
| 2 | `materializeDelta` already computes the resulting `tree` + the forked-from `parentHead` but returns neither | `quarantine-promote.js:187,193,211` | ✅ `parentHead = rev-parse HEAD` (`:187`, the HEAD-anchor); `tree = write-tree` (`:193`, the post-state); returns `{delta_sha, candidateRel, isEmpty}` (`:211`). **Amend to additionally return `tree`+`parentHead`** — additive; `stage-promote` destructures only the existing 3 (unaffected). |
| 3 | `buildGenesisRecord` omits `post_state_hash` + `head_anchor` | `quarantine-promote.js:267-276` | ✅ Sets prev_state_hash/persona/spawn_id/operation_class/evidence_refs/intent_recorded_at/commit_outcome/schema_version + transaction_id. **No post_state_hash, no head_anchor** — P2a adds a builder (or extends this) that sets them. |
| 4 | `post_state_hash = sha256(resulting tree)`, NOT `sha256(canonical{prev,tree})` | chain-consistency analysis + `_test-harness.js:117-119,167` (the fixture's `sha256('post-'+i+prev)` is a TOP-DOWN test convenience) | ✅ A spawn chains by the state it FORKED FROM and only ever sees that tree (never the parent's lineage). `post=sha256(tree)` lets a future child set `prev=sha256(forked-from tree)=parent.post` without knowing the parent's history; binding `post` to `prev` would break fork-based chaining. **Locked: `computePostStateHash(treeSha)=sha256('POST_STATE\|'+treeSha)`** (domain-prefixed; 64-hex; run-scoped lookups make scope-binding unnecessary). |
| 5 | The LIVE producer (P2b) cannot reuse the shadow guarded runner for `write-tree` | `spawn-close-resolver.js:98,303-340,316` | ✅ `makeGuardedRunGit` refuses any verb not in `[status,diff,rev-parse,show-ref]` (returns `shadow-refused-mutating-arg`). `write-tree`/`commit-tree` are refused → P2b needs an **unguarded runner** + a mutation-profile change (dangling objects). **Defers the live wiring to P2b** (this is the technical driver of the split). |
| 6 | P2a adds NO new live caller; the two amended functions are behavior-preservingly edited (verify-plan honesty MEDIUM — tightened) | grep + `stage-promote.js:297,390` | ✅ `computePostStateHash`/`buildSpawnRecord`/`head_anchor` have ZERO live callers (P2b wires them). **But** `materializeDelta` + `buildGenesisRecord` ARE live-imported by `stage-promote.js` (the `LOOM_RESOLVER_ENFORCE` path) — the amendments are **behavior-preserving**: the `:297` named-destructure `{delta_sha, candidateRel, isEmpty}` drops the new `tree`/`parentHead` keys; `buildGenesisRecord` stays byte-identical via the shared `genesisRecordFields` helper (regression test #4-adjacent). "Additive, no live blast radius" holds UNDER additive-only discipline. |

## Design — additive, dormant

1. **`packages/kernel/schema/transaction-record.schema.json`** — add `head_anchor` to `properties`:
   ```jsonc
   "head_anchor": {
     "description": "The parent HEAD sha the spawn's worktree forked from (materializeDelta parentHead). The auto-merge re-check anchor (P3). git sha — 40-hex (sha1) or 64-hex (sha256); null when unknown. Schema-additive; INV-K2-SchemaForwardCompat.",
     "oneOf": [ { "type": "string", "pattern": "^[a-f0-9]{40}$|^[a-f0-9]{64}$" }, { "type": "null" } ]
   }
   ```
   NOT added to `required` (optional; null-tolerant). `additionalProperties:false` stays — the field is now declared, so a strict validator accepts it.
2. **`packages/kernel/_lib/transaction-record.js`** — add `computePostStateHash(treeSha)` =
   `sha256('POST_STATE|' + treeSha)`. Validates `treeSha` is 40-or-64-hex (throws otherwise — fail-fast).
   Exported alongside `computeTransactionId`/`computeGenesisHash`.
3. **`packages/kernel/_lib/quarantine-promote.js`** — `materializeDelta` additionally returns
   `tree` (the `write-tree` output) + `parentHead` (the `rev-parse HEAD`). Purely additive; the
   existing `{delta_sha, candidateRel, isEmpty}` destructure in `stage-promote` is unaffected.
4. **`buildSpawnRecord({agentId, personaId, schemaVersion, postStateHash, headAnchor})`** — a **NEW
   export** in `quarantine-promote.js` (verify-plan F1/R-2 adjudicated: NEW, not extending
   `buildGenesisRecord` — Open/Closed + ISP; keeps `buildGenesisRecord`'s signature frozen so
   `stage-promote`'s records stay byte-identical). To avoid duplicating the genesis field-assembly
   (honesty's divergence concern), **extract a shared internal `genesisRecordFields(opts)` helper**
   (the base fields, sans `transaction_id`); both `buildGenesisRecord` and `buildSpawnRecord` call it,
   then add their specifics (`buildSpawnRecord` adds `post_state_hash: postStateHash` +
   `head_anchor: headAnchor`), then `computeTransactionId` + `validateTransactionRecord({isGenesisPosition:true})`.
   `buildGenesisRecord`'s output stays **byte-identical** (a regression test pins it). DORMANT (only
   tests call `buildSpawnRecord`; P2b is the first live caller). Genesis in the all-genesis world;
   `post_state_hash` is recorded for the chain + future.

## Architectural Decisions

1. **`post_state_hash = sha256(tree)`, fork-consistent** (Probe #4) — not bound to `prev`; locked by
   `computePostStateHash` + a test. This is the corrected-keying's natural partner (P1's
   `readByPostStateHash` matches exactly this value).
2. **`head_anchor` is an in-record field requiring a schema amendment** (Probe #1) — not "additive
   without a schema change" (the P1/F6 lesson). It's recorded now (in the builder) so P2b/P3 consume a
   field that already exists + validates.
3. **Dormant-first split** (P2a primitives / P2b live wiring) — driven by the guarded-runner conflict
   (Probe #5), mirroring PR-3c-a→3c-b. P2a runs nothing new on a real spawn.
4. **`resolve()` immutable; K1 dormant; record-store untouched** — P2a adds no production importer of
   record-store (P2b does); touches no hook/`resolve()`/`ci.yml`/ROADMAP.
5. **Reuse over re-roll** — `buildSpawnRecord` reuses `buildGenesisRecord` + `computeTransactionId` +
   `validateTransactionRecord`; `computePostStateHash` reuses the module's `crypto` sha256 helper.

## Security review

- **S1 — schema widening.** Adding `head_anchor` (optional, null-tolerant, pattern-bounded) cannot
  widen any existing contract; it's a new optional field. The pattern is the **anchored alternation**
  `^[a-f0-9]{40}$|^[a-f0-9]{64}$` (sha1-40 OR sha256-64 — matching `quarantine-promote.js:157`), NOT a
  `{40,64}` range quantifier (which would wrongly admit 41–63-hex garbage — verify-plan M2/LOW). It
  bounds the field to a git-sha shape (no free-form injection; P3, not P2a, is the consumer).
- **S2 — `computePostStateHash` input.** `treeSha` comes from `git write-tree` (trusted local git), but
  the helper fail-fasts on a non-hex input (defensive — a caller passing a bad tree gets a throw, not a
  silent bad hash). Domain prefix `POST_STATE|` prevents cross-purpose hash collision with
  `computeTransactionId`/`computeGenesisHash`.
- **S3 — builder validation.** `buildSpawnRecord` runs `validateTransactionRecord(rec,{isGenesisPosition:true})`
  (reusing `buildGenesisRecord`'s gate) + the bootstrap-sentinel check; an invalid record throws (never
  a silently-malformed record reaches the store).
- **S4 — no live blast radius.** P2a wires nothing live; the worst case of a bug is a failing test, not
  a broken spawn (the live producer's fail-soft is a P2b concern).

## TDD test inventory (write RED first)

`tests/unit/kernel/_lib/transaction-record.test.js` (extend):
1. `computePostStateHash('a'.repeat(40))` → a 64-hex sha256; deterministic (same input → same output).
2. `computePostStateHash` of two DIFFERENT trees → different hashes; domain-prefixed (≠ `sha256(tree)` bare, ≠ `computeGenesisHash`).
3. `computePostStateHash` rejects a non-hex / wrong-length input (throws) — explicitly cover 39-char, 41-char, 63-char, 65-char (the `{40,64}`-range-vs-`{40}|{64}`-alternation guard) + a non-hex string.

`tests/unit/kernel/_lib/quarantine-promote.test.js` (extend, real-git):
4. `materializeDelta` now returns `tree` (40-or-64-hex) + `parentHead` (matches `rev-parse HEAD` of the parent) in addition to the existing 3 fields; existing fields unchanged (regression).
5. `buildSpawnRecord({...,postStateHash,headAnchor})` → a record with `post_state_hash===postStateHash` + `head_anchor===headAnchor`, genesis-valid (`validateTransactionRecord` passes), `transaction_id` = `computeTransactionId(record)` (integrity).
6. `buildSpawnRecord` omitting/​null `headAnchor` → `head_anchor:null`, still genesis-valid (null-tolerant).
7. **Chain-consistency (the load-bearing test):** a record built with `post_state_hash = computePostStateHash(tree)` round-trips through `record-store.appendRecord` + `readByPostStateHash(computePostStateHash(tree))` returns it — proving the producer's post_state_hash is exactly what P1's K9 seam reads.

`tests/unit/kernel/schema/` (or a schema-validate test):
8. **Schema amendment (verify-plan F3 — precise; `ajv` is NOT installed so strict enforcement is the schema FILE's contract, not in-process):** assert (a) `validateTransactionRecord` ACCEPTS a record carrying `head_anchor` (the lenient runtime path — always true), AND (b) a **structural assertion on the parsed schema file**: `transaction-record.schema.json`'s `properties` now declares `head_anchor` (with the `^[a-f0-9]{40}$|^[a-f0-9]{64}$` pattern) and `additionalProperties` is still `false`. Do NOT assert "unknown field rejected" in-process — that is vacuous (the lenient validator tolerates unknowns; the F6/P1 nuance).

## Out of scope / deferred

| Item | Why | Target |
|---|---|---|
| The LIVE producer wiring (record-store write in `resolveAndJournal`) | needs the unguarded-runner + mutation-profile decision (Probe #5) | **P2b** |
| The unguarded runner for `write-tree`/`commit-tree` in the shadow path | a deliberate step beyond shadow's read-only posture | P2b (design + verify-plan) |
| Non-genesis `prev_state_hash = computePostStateHash(forked-from tree)` | no non-genesis spawns until auto-merge (the chain-walk is inert now) | P3 |
| OQ-2 genesis-recognition (`computeGenesisHash` vs literal `'GENESIS'`) | only bites the live non-genesis walk | P2b/P3 |
| HEAD-anchor re-check + sibling-concurrency lock + merge-vs-quarantine | the auto-merge mechanism | P3 |

## Risks & Open Questions

- **OQ-P2b-1:** which runner does the live producer use for `write-tree` — a new unguarded runner
  (dangling objects) or restrict `post_state_hash` to the committed-delta case (`rev-parse HEAD^{tree}`,
  read-only, null for uncommitted)? Decided in P2b (this PR surfaces it, Probe #5).
- **R-1:** the `materializeDelta` amendment touches a shipped module (3c-a). Additive (return more
  fields); the regression test (#4) guards the existing consumers.
- **R-2:** `buildSpawnRecord` vs extending `buildGenesisRecord` — a DRY-vs-clarity call; either keeps
  `stage-promote`'s genesis records byte-identical (the new fields are opt-in). Verify-plan to weigh in.

## HETS Spawn Plan

| Stage | Persona | Lens |
|---|---|---|
| Build | `node-backend` | TDD (RED tests first) → impl the 4 additive pieces to green |
| Verify | `architect` + `code-reviewer` + `honesty-auditor` (read-only) | design soundness / concrete bugs + the schema-amendment correctness / claim-vs-evidence (re-confirm `post_state_hash=sha256(tree)` chain-consistency + the guarded-runner finding) |
| Harden | `code-reviewer` | edge cases (non-hex tree, null head_anchor, the regression on existing materializeDelta consumers) |
| Probe | independent | dormancy (no new live caller) + the chain round-trip (test #7) + schema strict-accept |

Read-only verify personas only (architect/code-reviewer/honesty), never Write-capable.

## Drift Notes

- **DN-1 (recon-caught wiring complication):** the shadow path's `makeGuardedRunGit` refuses
  `write-tree`/`commit-tree`, so the live producer (P2b) needs an unguarded runner — a concrete
  technical reason for the P2a/P2b split, surfaced by reading the hook BEFORE planning the wiring.
  Reinforces: read the live integration point before scoping a change into it.
- **DN-2:** `post_state_hash=sha256(tree)` (fork-consistent) diverges from the `synthesizeChain` fixture's
  `sha256('post-'+i+prev)` (top-down test convenience). Production chains by forked-from state, not by
  known lineage — the fixture's formula is not the production contract. (Same "test ≠ canonical" class
  as P1's keying fallacy, caught proactively here.)

## Pre-Approval Verification

Three read-only HETS lenses reviewed this plan against the live repo @ `feat/v3.1-pr-p2-shadow-producer`,
each mandated to independently re-confirm the two load-bearing probes from primary source.

**Verdicts:** architect `APPROVE-WITH-REVISIONS` · code-reviewer `APPROVE-WITH-REVISIONS` · honesty
`APPROVE-WITH-REVISIONS` (grade **A-**). **No CRITICAL/HIGH.** All three **independently confirmed**:
**Probe #4** (`post_state_hash=sha256(tree)`) by tracing the K9 value-equality join
(`k9-promote-deltas.js:173-178` → `readByPostStateHash` raw `===` at `record-store.js:311`) — the
`synthesizeChain` `sha256('post-'+i+prev)` is a marker-gated top-down fixture, NOT the production
contract; and **Probe #5** (the guarded runner refuses `write-tree`/`commit-tree`,
`spawn-close-resolver.js:98,316-319`) — the P2b deferral is technically driven, not scope-theater (the
read-only `rev-parse HEAD^{tree}` alternative is a *lossy* committed-only subset, correctly flagged in
OQ-P2b-1). The design is sound; every revision is plan-precision/framing.

| # | Lens | Sev | Finding | Resolution |
|---|---|---|---|---|
| M1 | architect | MED | "locked canonical formula" overstates the RFC — v6 specifies `post_state_hash` only *semantically* (`§534,566,791`), never the formula | Reframed: P2a **establishes** the concrete realization; **every future producer (P3 non-genesis) MUST reuse `computePostStateHash` verbatim** or the value-equality join silently breaks. Added to the P3 deferred row + a `computePostStateHash` code comment (forward-coupling invariant). |
| M2/F/LOW | architect+CR+honesty | MED | the `head_anchor` pattern prose said `{40,64}` (admits 41–63-hex garbage) vs the correct JSONC `{40}\|{64}` | Fixed S1 prose to the anchored alternation; test #3 now covers 39/41/63/65-char. |
| F1/R-2 | architect+CR (vs honesty) | FLAG | `buildSpawnRecord` new vs extending `buildGenesisRecord` — lenses split | **Adjudicated: NEW `buildSpawnRecord`** (Open/Closed + ISP; `buildGenesisRecord` signature frozen) **+ a shared `genesisRecordFields` helper** so there's no duplication (honesty's divergence concern) AND `buildGenesisRecord` stays byte-identical. Both lenses satisfied. |
| F3 | architect+CR | FLAG | test #8's "unknown field rejected" is vacuous in-process (`ajv` not installed; the lenient validator tolerates unknowns) | Rewrote test #8: assert (a) lenient-accept + (b) a structural assertion on the parsed schema file (declares `head_anchor` + `additionalProperties:false` intact). |
| F2 | architect | FLAG | `materializeDelta` returning `parentHead` mildly contradicts `stage-promote.js:400-403`'s deliberate single-return SRP stance | Note the **conscious** widening in the build (an inline comment superseding the `:400-403` stance) so a future reader doesn't see contradictory SRP comments. The new keys are opt-in/unconsumed in P2a. |
| MEDIUM | honesty | MED | Probe #6 "activates nothing live" undersells that `materializeDelta`/`buildGenesisRecord` are live-imported | Probe #6 tightened to "no new live caller; the two amended fns are behavior-preservingly edited." |
| N1 | architect | NIT | domain-prefix collision claim slightly overstated | left as-is (defensive practice; correct directionally). |

**Net:** the design is APPROVED; the keying (`sha256(tree)`, fork-consistent) and the split (technically
driven by the guarded-runner refusal) are triple-confirmed. **Build-ready** with the above folded in —
the load-bearing forward-coupling invariant (M1: all `post_state_hash` producers MUST reuse
`computePostStateHash`) is the one thing to carry into P3.
