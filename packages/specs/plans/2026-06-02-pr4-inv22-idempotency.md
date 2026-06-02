# PR-4 — INV-22 in-substrate idempotency-key enforcement (+ K2.c/R13 build-plan re-slot)

## Context

The v3.1 P3 enforcing-integration arc is merged; PR-4 was nominally "R13 idempotency-key enforcer + K2.c observability". Firsthand recon reframed it: the spec cleanly separates **INV-22** (the in-substrate idempotency key over ALL transactions — §4.2/§5a.6, the buildable F-01 fix) from **INV-R13** (the network-side-effecting-tool-call enforcer — gates a surface that does not exist yet: K6 network-tools are dormant + ADR-0012 forbids wrapping a spawn's tool calls). PR-4 ships **INV-22 only**; K2.c and the R13-enforcer are re-slotted into the v6 build plan at their honest future releases (not dropped). The load-bearing outcome: producers set `idempotency_key`, the append path dedups on it, and F-01 (the re-fired-close duplicate) is fixed at the write step — superseding P3's tolerate-on-read.

## Routing Decision

`route-decide.js` returned `root` (0.30); **escalated to `route` by judgment** per the documented `stakes`-lexicon miss for kernel-enforcement work (drift-note P3-2: "writes to real refs / kernel enforcement" carries no `stakes`/`audit`/`infra` token; only `compound_strong` matched). The task is architect-shaped — multi-file kernel enforcement, a non-obvious `content_hash`/dedup-TOCTOU design, and it supersedes a P3 decision (tolerate-on-read). The USER also explicitly requested the full plan→review→workflow rigor. Per `route-decide.js:11-13` load-bearing comment, judgment overrides a lexicon-miss `root`.

```json
{
  "task": "PR-4: enforce INV-22 in-substrate idempotency-key — wire computeIdempotencyKey into buildSpawnRecord + buildChainedRecord, add readByIdempotencyKey, dedup-on-append in record-store; fixes F-01 re-fire duplicate; multi-file kernel transaction-record enforcement",
  "recommendation": "root",
  "confidence": 0,
  "score_total": 0.3,
  "scores_by_dim": {
    "stakes": { "matched": [], "raw": 0, "weight": 0.25, "contribution": 0 },
    "domain_novelty": { "matched": [], "raw": 0, "weight": 0.15, "contribution": 0 },
    "compound_strong": { "matched": ["transaction", "idempotency"], "raw": 1, "weight": 0.15, "contribution": 0.15 },
    "audit_binary": { "matched": [], "raw": 0, "weight": 0.2, "contribution": 0 },
    "scope_size": { "matched": ["multi-file"], "raw": 1, "weight": 0.075, "contribution": 0.075 },
    "convergence_value": { "matched": [], "raw": 0, "weight": 0.15, "contribution": 0 }
  },
  "signals_matched": ["transaction", "idempotency", "multi-file"],
  "reasoning": "Score 0.300 → root: compound_strong (+0.150, 'transaction'), scope_size (+0.075, 'multi-file'), context (+0.075, mult=0.5).",
  "weights_version": "v1.2-dict-expanded-2026-05-07"
}
```

## HETS Spawn Plan

Read-only verify board (parallel, asymmetric) + the build workflow. Read-only passes use read-only personas (never Write-capable).

| Persona | Identity | Role | Paired-with | Why |
|---|---|---|---|---|
| 04-architect | theo | `/verify-plan` design lens | (asymmetric: 03-code-reviewer) | content_hash choice (post_state_hash vs delta-tree vs semantic-sha); dedup-TOCTOU vs K13-serial; supersede-vs-keep the P3 tolerate-on-read |
| 03-code-reviewer | nova | `/verify-plan` correctness lens | architect.theo | the append-path edit is HIGH-risk (every producer writes through it); integrity-check ordering; return-shape back-compat; fd/scan cost |
| (build) node-backend | — | Workflow TDD build (Write-capable) | — | RED→GREEN impl of the 3 producers + the store dedup + the re-slot docs |
| (build) code-reviewer | — | Workflow review-on-diff | — | resource/edge-case pass the tests miss (concurrency residual, return-shape) |

## Runtime Probes

Every state claim below was probed firsthand against `main @ 1b7ab0b` before this plan:

| Claim | Probe | Result |
|---|---|---|
| `computeIdempotencyKey` exists but UNENFORCED | `grep -rn idempotency_key/computeIdempotencyKey packages/kernel` | Defined `transaction-record.js:152`, exported; **no producer sets it** ("NONE in producers") |
| `appendRecord` has no dedup | read `record-store.js:167-224` | content-addressed one-file-per-`transaction_id`; validate→integrity→write; **no idempotency check** |
| `idempotency_key` in schema, optional | read `transaction-record.schema.json:123` | present, `pattern ^[a-f0-9]{64}$`, **NOT** in `required` |
| both live producers have all 4 key-inputs | read `quarantine-promote.js:378` + `integration-record.js:41` | `buildSpawnRecord`: persona/`CREATE`/`postStateHash`/genesis-prev ✓; `buildChainedRecord`: persona/`APPEND`/`post`/`prevPost` ✓ |
| `content_hash = post_state_hash` always available | both builders | `postStateHash`/`post` are required args in both ✓ |
| F-01 root cause = wall-clock `intent_recorded_at` | read `quarantine-promote.js:337-341` | honesty FLAG: "NOT byte-identical … `intent_recorded_at` is a per-call wall-clock timestamp so `transaction_id` differs" |
| the 2 live `appendRecord` producers | `grep appendRecord callers` | `spawn-close-resolver.js:514` (buildSpawnRecord) + `integrator.js:422` (buildChainedRecord); `stage-candidate` injects `appendRecordFn` |
| caller checks only `.ok` | read `spawn-close-resolver.js:514-524` | journals `record_appended: appended.ok`; journals **local** `record.transaction_id` (not `appended.transaction_id`) |
| R13-enforcer gates a dormant surface | v6 §1527 + ADR-0012 + `ls observability/` | §1527 "K6 denies network-side-effecting tools by default … through v3.1; closes in v3.5 via ContainerAdapter"; `network-egress-audit.js` is advisory-only |
| INV-22 vs INV-R13 are distinct | v6 §6.13 lines 1608/1622 | INV-22 = ALL transactions, 4-field key, dedup-on-append; INV-R13 = network tool-calls only, `(spawn_id,tool_use_id)` key |

## Files To Modify

> **Board revision (NEEDS-REVISION → folded):** `content_hash` is NO LONGER the bare `post_state_hash` — that is identity-erasing (CRITICAL-1, below). A new null-safe `computeContentHash({postStateHash, writerSpawnId, headAnchor})` helper binds spawn identity; both builders use it. See `## Pre-Approval Verification`.

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/kernel/_lib/transaction-record.js` | modify | medium | **NEW** `computeContentHash({postStateHash, writerSpawnId, headAnchor})` = `sha256(canonicalJsonSerialize({post_state_hash, writer_spawn_id, head_anchor}))`. Null-safe (canonicalJsonSerialize handles `null` post → valid hash, no throw). The single `content_hash` definition (DRY) feeding `computeIdempotencyKey`. Export it |
| `packages/kernel/_lib/record-store.js` | modify | **HIGH** | add `readByIdempotencyKey` (mirror `readByPostStateHash` incl. the cost JSDoc note) + dedup-on-append in `appendRecord` (gated on `record.idempotency_key`; short-circuit BEFORE `mkdirSync`). THE enforcement point; every producer writes through it |
| `packages/kernel/_lib/quarantine-promote.js` | modify | medium | `buildSpawnRecord`: `content_hash = computeContentHash({postStateHash, writerSpawnId: agentId, headAnchor})` → `idempotency_key` BEFORE `finalizeGenesisRecord`. Import `computeIdempotencyKey` + `computeContentHash`. `buildGenesisRecord` FROZEN — untouched (Open/Closed) |
| `packages/kernel/_lib/integration-record.js` | modify | medium | `buildChainedRecord`: `content_hash = computeContentHash({postStateHash: post, writerSpawnId: 'loom-integrate-'+safeId, headAnchor: null})` → `idempotency_key` BEFORE `computeTransactionId`. Import both fns |
| `packages/kernel/hooks/post/spawn-close-resolver.js` | modify | low | caller-honesty: line `:520` journal `appended.transaction_id` (the stored/deduped id) ‖ fallback `record.transaction_id`; add `deduped` flag |
| `packages/kernel/spawn-state/stage-candidate.js` | modify | low | caller-honesty (FLAG-1): `stagedResult` (`:181`) journals `appended.transaction_id` + `deduped`; thread the append result through (today hardcodes `record_appended:true` + local `transactionId`) |
| `packages/kernel/spawn-state/integrator.js` | modify | low | **positive idempotency**: `mintIntegrationRecord` treats `{ok:true,deduped:true}` as success; re-run `integrateCandidates` over a folded candidate = idempotent (same `post`, chain-head + count unchanged). Inline comment: deduped `.file` is the EXISTING record's path |
| `tests/unit/kernel/_lib/record-store.test.js` | modify | medium | RED-first: `readByIdempotencyKey` unit (hex-gate/miss/hit/hostile-runId); dedup-on-append; **INV-22** (replay → `appended.transaction_id === first id` + count unchanged); **F-01** (re-fire diff-timestamp → deduped); **false-merge-prevention** (two distinct `writer_spawn_id`, same tree → NOT deduped); dirty-null-post (record still written, re-fire dedups); no-key forward-compat |
| `tests/unit/kernel/_lib/transaction-record.test.js` | modify | low | `computeContentHash`: stable across re-fire (timestamp-independent); distinct on different `writer_spawn_id`; null-post → valid hash, no throw |
| `tests/unit/kernel/_lib/quarantine-promote.test.js` | modify | low | `buildSpawnRecord` carries a valid `idempotency_key`; key stable across re-fire, distinct across agentId |
| `tests/unit/kernel/_lib/integration-record.test.js` | modify | low | `buildChainedRecord` carries a valid `idempotency_key` |
| `tests/unit/kernel/spawn-state/integrator.test.js` | modify | low | **integrator-side F-01**: re-run over a folded candidate → chained record dedups, same `post`, chain-head + record-count unchanged |
| `packages/specs/plans/2026-05-31-phase-2-v3.1-runtime-foundation.md` | modify | low | **re-slot**: PR-4 → INV-22-only; K2.c → v3.3 (A6 consumer); R13-enforcer → v3.5+ (ContainerAdapter surface) |
| `packages/specs/rfcs/v6-substrate-synthesis.md` | modify | low | **re-slot**: dated amendment note at §6.6; preserve locked tables; probe must also amend the cost-rollup (line ~1535) + scope line (~1451), not just the §6.6 header |

## Phases

#### Phase 0 — RED (TDD-treatment: failing tests = the corrected behavioral contract)
1. Write the failing tests encoding the BOARD-CORRECTED design: `computeContentHash` (stable across re-fire / distinct across `writer_spawn_id` / null-post-safe); dedup-on-append; INV-22 (replay → `appended.transaction_id === first id` + count unchanged); F-01 re-fire collapse; **false-merge-prevention** (two distinct `writer_spawn_id` + same tree → NOT deduped); dirty-null-post (written, re-fire dedups); no-key forward-compat; integrator-side F-01 (re-run folds once). Add key-present asserts to the producer tests.
   - Probe: the new tests FAIL against current impl (no helper, no dedup). The failing set IS the spec. **The false-merge + dirty-null tests are the CRITICAL-1 regression guards.**

#### Phase 1 — `computeContentHash` helper (transaction-record.js)
2. Add `computeContentHash({postStateHash, writerSpawnId, headAnchor})` = `sha256(canonicalJsonSerialize({post_state_hash: postStateHash ?? null, writer_spawn_id: writerSpawnId, head_anchor: headAnchor ?? null}))`. Null-safe by construction; binds spawn identity so distinct spawns never collide on an identical tree. Export it.
   - Probe: `computeContentHash` tests pass — re-fire-stable, agentId-distinct, null-post → 64-hex (no throw).

#### Phase 2 — `readByIdempotencyKey` (record-store.js)
3. Add `readByIdempotencyKey(key, opts)` mirroring `readByPostStateHash`: hex-gate the key first (`^[a-f0-9]{64}$` → null before any fs), hostile-`runId` guard, scan run dir, return first record with `record.idempotency_key === key`, fail-soft. JSDoc: "bounded by run size; an in-memory index is a deferred optimization (YAGNI)" (mirrors `readByPostStateHash`). Export it.
   - Probe: `readByIdempotencyKey` unit tests pass; hostile-runId/non-hex return null with zero fs reach.

#### Phase 3 — dedup-on-append (record-store.js)
4. In `appendRecord`, AFTER validation + the S5 integrity check + the scope check, BEFORE `mkdirSync`: `if (record.idempotency_key) { const existing = readByIdempotencyKey(record.idempotency_key, opts); if (existing) return { ok:true, transaction_id: existing.transaction_id, deduped:true, file: recordFilePath(existing.transaction_id, opts) }; }`. Short-circuits before any fs mutation (Finding-4: no `mkdirSync` for a pure replay). No-key records keep current behavior (Open/Closed; INV-K2-SchemaForwardCompat).
   - Probe: dedup test passes (returns the FIRST id; no dir created on replay); no-key record still writes.

#### Phase 4 — wire the key into the 2 live producers
5. `buildSpawnRecord` (quarantine-promote.js): `const contentHash = computeContentHash({postStateHash, writerSpawnId: agentId, headAnchor})`; `idempotency_key = computeIdempotencyKey({writerPersonaId: personaId, operationClass: 'CREATE', contentHash, prevStateHash: base.prev_state_hash})`; add to the record BEFORE `finalizeGenesisRecord` (so `transaction_id` hashes it in). Import both fns.
6. `buildChainedRecord` (integration-record.js): `contentHash = computeContentHash({postStateHash: post, writerSpawnId: 'loom-integrate-'+safeId, headAnchor: null})`; same key derivation, `operationClass:'APPEND'`, `prevStateHash: prevPost`; add before `computeTransactionId`. Import both fns.
   - Probe: producer tests assert a valid 64-hex `idempotency_key`; `transaction_id === computeTransactionId(record)` still holds (S5 integrity); dirty-null-post spawn record gets a key + writes (no throw).

#### Phase 5 — caller honesty (3 sites)
7. `spawn-close-resolver.js:520`: journal `appended.transaction_id || record.transaction_id` + `deduped: appended.deduped === true`. `stage-candidate.js` `stagedResult`: thread the append result; journal `appended.transaction_id` + `deduped` (replace the hardcoded local id + `record_appended:true`). `integrator.js` `mintIntegrationRecord`: treat `deduped:true` as success + inline-comment the `.file` semantics.
   - Probe: F-01 regression (re-fire the shadow producer) journals the ORIGINAL/stored id + `deduped:true`, record count unchanged; integrator re-run over a folded candidate folds once (positive idempotency assertion).

#### Phase 6 — GREEN + review-on-diff
8. Full kernel suite green; `code-reviewer` pair-run on the diff (concurrency residual, return-shape back-compat, fd/scan cost).
   - Probe: `find tests/unit/kernel -name '*.test.js' -print0 | xargs -0 -n1 node` → all files pass.

#### Phase 7 — build-plan re-slot (K2.c + R13)
9. phase-2 plan: PR-4 row → INV-22-only; add K2.c (→ v3.3, A6 consumer + INV-R13 prerequisite) + R13-enforcer (→ v3.5+, ContainerAdapter network surface; ADR-0012 can't-wrap rationale) re-slot notes.
10. v6 RFC: dated amendment note at §6.6 recording the reframe (INV-22 in v3.1 / K2.c v3.3 / R13 v3.5+). Preserve locked tables; ALSO amend the cost-rollup (line ~1535) + scope line (~1451) so no "v3.1 R13/K2.c" claim dangles.
    - Probe: markdownlint clean; `grep -n "R13\|K2.c" §6.6/§6.8/§6.10 + lines 1451/1535` shows no un-amended "v3.1" claim.

#### Phase 8 — smoke
11. `bash install.sh --hooks --test` (118/0) + full kernel suite + `eslint` 0 / 0 eslint-disable.

## Verification Probes

| Probe | Pass criterion |
|---|---|
| INV-22 | replay a record verbatim → second `appendRecord` returns **`appended.transaction_id === first.transaction_id`** + `deduped===true` + run record-count unchanged + `readById(first id)` resolves |
| F-01 regression | re-fire with a different `intent_recorded_at` (same persona/spawn_id/tree) → same `idempotency_key` → deduped, count unchanged |
| **false-merge prevention (CRITICAL-1 guard)** | two records with DISTINCT `writer_spawn_id` + identical tree → DIFFERENT `content_hash` → DIFFERENT key → BOTH written (no false-merge) |
| **dirty-null-post (CR CRITICAL-1 guard)** | `postStateHash=null` → `computeContentHash` returns a valid hash (no throw) → record written WITH a key; re-fire dedups |
| **integrator-side F-01** | re-run `integrateCandidates` over an already-folded candidate → chained record dedups, same `post`, chain-head + record-count unchanged |
| readByIdempotencyKey | hex-gate (non-hex → null, no fs); miss → null; hit → record; hostile runId → null |
| forward-compat | a record without `idempotency_key` still writes (no dedup) — INV-K2-SchemaForwardCompat preserved |
| integrity | every producer's `transaction_id === computeTransactionId(record)` with the key present |
| kernel suite | `find tests/unit/kernel -name '*.test.js' -print0 \| xargs -0 -n1 node` → all pass |
| smoke | `bash install.sh --hooks --test` → 118/0; eslint 0 errors / 0 eslint-disable |
| re-slot consistency | the forward-looking scope amended: §6.6 in-scope bullets, cost-rollup (~1543), scope line (~1451), the §4.2 composition-ref (~556); the version-history ledger (line 15) is preserved as historical-by-design. markdownlint clean |

## Out of Scope (Deferred)

- **K2.c per-tool-call observability** — re-slotted to **v3.3** (its only consumer is A6 reputation, which is v3.3; it is also the prerequisite for INV-R13's `tool_calls[]`). YAGNI now.
- **R13-enforcer (INV-R13)** — re-slotted to **v3.5+** with the ContainerAdapter / network-egress work. Gates K6-permitted network tools, which are dormant through v3.1 (§1527), and ADR-0012 forbids wrapping a spawn's tool calls. Building it now = inert dead code (the ADR-0012 anti-pattern).
- **Intent-record (two-phase) idempotency** — the §5.2 PENDING intent-record has `post_state_hash:null`, so `content_hash = post_state_hash` does not apply; the two-phase producer does not exist yet. Deferred with two-phase commit.
- **`recovery-sweep` `buildAbortedRecord`** — already idempotent via its `spawn_id` natural-key dedup (INV-A9); a `computeIdempotencyKey` wiring there is separable and not on the F-01 surface.
- **agentId-uniqueness Runtime-Claim Probe** — the false-merge defense rests on the harness `agentId` (`writer_spawn_id`) being unique per spawn (the live key reduces to `f(persona, post, agentId)`). Documented as an assumption in `computeContentHash`'s JSDoc; a firsthand harness probe of agentId-uniqueness is deferred (3-lens hacker LOW, confirmed=false). If ever reused, fold a per-spawn entropy source (task/intent hash) into `content_hash`.
- **`canonicalJsonSerialize` width bound (L1, pre-existing)** — the depth bound stops deep nesting; a WIDE structure (e.g. a 1M-entry `evidence_refs`) still costs O(n) at the S5 hash (~0.2-0.5s, no crash, returns cleanly). Pre-existing (predates the depth bound), per-spawn-close not a hot loop. Defense-in-depth fix (deferred): a `MAX_CANONICAL_NODES` budget alongside the depth bound.
- **Validator type-completeness (L2, pre-existing, non-exploitable)** — the PR-4 type-check covers `head_anchor`/`post_state_hash`; a deep-`evidence_refs`/`abort_detail`/`affected_records`/`references_transaction_id` direct-disk poison loads as VALID but is inert (no read path hashes the loaded body; can't reach a downstream hash — the integrator walks only the txid + 64-hex `post`). The S5 catch backstops any incoming-append crash. Deferred hardening: extend the validator type-check to those fields uniformly.
- **Concurrent-double-write atomicity** — `readByIdempotencyKey`-then-write is not atomic; a concurrent same-key race could write two records. **The safety argument is NOT "K13-serial precludes it"** (board LOW-1: K13 governs *spawn* concurrency, and the integrator is a user-invoked CLI — a spawn-close hook racing the CLI is NOT K13-serialized). The real argument: the race is **benign by composition** — the store is content-addressed (one file per `transaction_id`; a second writer clobbers to an identical-modulo-timestamp file) and every consumer is **fail-closed** (S4/S5 + the chain-walk). A lock would serialize ALL appends for a race that cannot corrupt. No lock added (KISS). The integrator's tolerate-on-read is the no-key/legacy fallback (see HIGH-1 layering below), not a co-equal belt.
- **tolerate-on-read layering (board HIGH-1)** — dedup-on-append keys on `idempotency_key` (timestamp-EXCLUDED); the integrator's existing tolerate-on-read keys on `transaction_id` (timestamp-INCLUDED). Post-PR-4, dedup-on-append SUBSUMES the F-01 case (catches the re-fire before the 2nd write); tolerate-on-read now only earns its keep for keyless/pre-PR-4 records. Documented so a future reader doesn't remove the wrong one.

## Drift Notes

- **DN-1**: MEMORY/snapshot prose conflated R13(network-enforcer) with INV-22(in-substrate key) — "R13 = enforce INV-22". The firsthand spec-probe (§556/§591/§1460/§1608/§1622) caught the conflation before any build. *Probe the premise/primary source even when MEMORY sounds authoritative* — recurrence of the P3 `drift:plan-honesty` lesson.
- **DN-2**: route-decide scored kernel-enforcement work `root` again (P3-2 recurrence) — "idempotency"/"transaction" hit only `compound_strong`, no `stakes`/`audit`/`infra` token. The `stakes` lexicon still has no kernel-state-mutation entry. Dictionary-expansion candidate (defer; not this PR).
- **DN-3**: "insert K2.c and R13 scaffold at appropriate places in the v6 build plan" interpreted as **documented future plan-slots**, NOT inert code scaffolds — building inert code now would contradict "INV-22 core only for now" + the ADR-0012 dead-code anti-pattern. Surfaced to USER in the plan presentation.
- **DN-4 (board-surfaced; M1 INVERTED)**: the plan reached for the convenient already-computed `post_state_hash` as `content_hash` — but `post_state_hash` is *deliberately* identity-erasing (fork-consistent / tree-only; that is its chain-edge job). Reusing the canonical hash verbatim is right for chain-edges (the M1 forward-coupling rule) and WRONG for a transaction-identity key. New pattern: *"is this hash's identity-semantics the one this consumer needs?"* — a canonical hash can be exactly wrong for a different purpose. Candidate for the ghost-protocol drift taxonomy.
- **DN-5 (board-surfaced)**: the plan's OWN Runtime Probe row ("`intent_recorded_at` is per-call wall-clock so `transaction_id` differs") pointed straight at spawn-identity as the dedup axis — but the design then walked past it to the tree hash. *A correct probe finding can be under-applied by the design that follows it.* The board (RUN against the code) caught it; the plan author (reasoning abstractly) did not. Reinforces: adversarial review that re-derives from the code beats author self-review.
- **DN-6 (CI-surfaced; local-pass / CI-fail fragility)**: the deep-nesting crash-guard test (`head_anchor` nested 5000-deep) passed locally but FAILED `CI / Kernel property tests` with `Maximum call stack size exceeded` — the **test's own `JSON.stringify(fixture)`** overflowed the CI runner's smaller native stack, NOT the code under test (the production depth bound caps at 100 + fails closed). Lesson: a test fixture probing a **native-limited resource** (recursion/stack depth) must use a value robust across environments — comfortably OVER the code's bound (so it's exercised) yet UNDER universal native limits (so the fixture is portable) — and be verified under a constrained condition (`node --stack-size=<small>`). Recurrence-flavor of the H.7.15 "validate against a non-author environment before merging" rule, extended to test-fixture resource assumptions. Fix: depth 200 + drive the deep value through `writer_spawn_id` (a hashed-but-not-type-checked field) so the bound is genuinely exercised; verified under `--stack-size=600`.

## Principle Audit

- **KISS** — dedup is a scan-check (no index); one `computeContentHash` helper, null-safe by construction (no special-case branch for dirty records).
- **DRY** — `readByIdempotencyKey` mirrors `readByPostStateHash` in shape (hex-gate / hostile-runId / fail-soft scan); ONE `content_hash` definition (`computeContentHash`) feeds both builders.
- **Open/Closed** — dedup gated on `record.idempotency_key` presence; no-key records keep current behavior. `buildGenesisRecord` stays FROZEN (untouched; no live `appendRecord` caller).
- **SRP** — `content_hash` derivation + key in the builders; dedup in the store; caller-honesty in the journals. The board's CRITICAL-1 root cause was an SRP collapse: `post_state_hash` (chain-edge identity) ≠ `content_hash` (transaction identity) — they are two responsibilities and must be two hashes.
- **YAGNI** — no in-memory idempotency index; no network-enforcer; no two-phase intent-record wiring; two idempotency mechanisms (INV-22 `idempotency_key` for spawn/chained; INV-A9 `spawn_id` natural-key for recovery-sweep) coexist — do NOT unify (board MEDIUM-2).
- **Identity, not erasure** — `content_hash = computeContentHash({post_state_hash, writer_spawn_id, head_anchor})` BINDS spawn identity. Using `post_state_hash` alone (fork-consistent / tree-only / deliberately identity-erasing) was the CRITICAL-1 bug — it false-merges distinct same-tree spawns. The M1 lesson INVERTED: reuse the canonical hash verbatim for chain-edges, NOT for transaction-identity keys.

## Pre-Approval Verification

`/verify-plan` board: **architect (theo) + code-reviewer (nova)**, parallel, read-only, against plan v1 + the real code. **Both verdicts: NEEDS-REVISION.** All findings folded into v2 above; the two CRITICALs were re-probed firsthand before folding (multi-reviewer blessing ≠ runtime verification).

| # | Severity | Finding | Firsthand re-probe | Fold |
|---|---|---|---|---|
| A-1 | **CRITICAL** | `content_hash = post_state_hash` is identity-erasing — `buildSpawnRecord`'s key collapses to `f(persona, tree)` (`op_class='CREATE'` + genesis-`prev` are constant), false-merging distinct same-tree spawns; F-01 is "fixed" only VIA that collision | `quarantine-promote.js:292-295` (constant CREATE/genesis-prev) + `transaction-record.js:127-134` (tree-only post) ✓ confirmed | `computeContentHash({post_state_hash, writer_spawn_id, head_anchor})` — binds spawn identity; Phase 1 + false-merge-prevention test |
| C-1 | **CRITICAL** | `computeIdempotencyKey` THROWS on falsy `contentHash`; dirty worktree → `postStateHash=null` → throw → caught → **provenance blackout** (record silently dropped vs today's null-post record) | `spawn-close-resolver.js:494-512` (`null` on dirty) + `transaction-record.js:153` (4-required throw) ✓ confirmed | the `computeContentHash` helper is null-safe (canonicalJsonSerialize handles `null`) → no throw → dirty record gets a valid key + writes; dirty-null-post test |
| A-2 | **CRITICAL** | integrator-side F-01 (`buildChainedRecord:54` wall-clock `intent_recorded_at`) unprobed; dedup-at-integrator success contract under-specified | `integration-record.js:54` ✓ confirmed | integrator-side-F-01 test (re-run folds once) + Phase 5 positive idempotency assertion |
| A-3 / C-2 | HIGH | `spawn-close-resolver:520` journals LOCAL `record.transaction_id`, not `appended.transaction_id` → deduped re-fire journals an id never stored | `:520` ✓ confirmed | Phase 5 line-specific fix + INV-22 test asserts `appended.transaction_id` |
| A-FLAG-1 | HIGH | `stage-candidate.js` is a 3rd live `buildSpawnRecord`→`appendRecord` caller missing from the caller-honesty set (`stagedResult:181` journals local id + hardcoded `record_appended:true`) | `stage-candidate.js:181-191` ✓ confirmed | added to Files-To-Modify + Phase 5 |
| C-4 | HIGH | dedup-read placed after `mkdirSync` → dir created for a pure replay | `record-store.js:213-219` ✓ | Phase 3: short-circuit BEFORE `mkdirSync` |
| A-HIGH-1 | HIGH | dedup-on-append (keys on `idempotency_key`) and tolerate-on-read (keys on `transaction_id`) are NOT co-equal belts — different hashes | `transaction-record.js:66` (txid incl. timestamp) ✓ | Out-of-Scope "tolerate-on-read layering" note |
| C-6 | MEDIUM | INV-22/F-01 tests can pass vacuously (count-only) | — | strengthened: assert specific id + `deduped` + `readById` + key-collision |
| A-LOW-1 | LOW | no-lock is fine but justify via S4/S5 fail-closed, NOT "K13-serial precludes" (K13 ≠ CLI-vs-hook) | `integrator.js` is a CLI ✓ | corrected Out-of-Scope rationale |
| A-MED-1 / C — | MEDIUM | keep `idempotency_key` OPTIONAL (keyless genesis/DVI/PENDING); runtime validator never enforced `additionalProperties:false` anyway | `transaction-record.js:262-318` ✓ | kept optional; noted |
| A-MED-2 | MEDIUM | two idempotency mechanisms (key vs `spawn_id`) now coexist | — | YAGNI note (don't unify) |
| A-LOW-2 | LOW | amendment-note re-slot correct for the locked RFC; extend probe to cost-rollup (~1535) + scope (~1451) | `v6:1451,1535` ✓ | Phase 7 + re-slot-consistency probe |
| C-5 / C-7 | LOW | `readByIdempotencyKey` O(n) JSDoc note; both builders import `computeIdempotencyKey`/`computeContentHash` | — | folded into Phase 1-4 |

**Decision: fold + proceed to build (not re-board).** CRITICAL-1 is FIXABLE (a verified, surgical `computeContentHash` redesign), not a scope-out — distinct from the "risky path is CRITICAL-underbaked → scope it out" case. The corrected design is encoded as Phase-0 RED tests (TDD-treatment: the false-merge + dirty-null + integrator-idempotency tests ARE the design contract and will FAIL if the fix regresses); the build workflow's review-on-diff is the second independent gate.

## 3-Lens Pre-Commit Review (post-build, on the real diff)

After the build went GREEN + a single code-reviewer APPROVED, a **3-lens parallel review** (correctness `code-reviewer` ‖ adversarial-security `hacker` ‖ claim-vs-evidence `honesty-auditor`) ran on the actual diff — the corrected orchestration (lens-selected, not domain-literal; multi-tier, not single). It found a HIGH the single correctness pass structurally could not.

- **HIGH (hacker, confirmed, PoC) — record-suppression via unverified `idempotency_key`** → **FOLDED.** The dedup trusted `record.idempotency_key` as a self-asserted label; a poison record (a victim's key + attacker content) dropped directly into the non-sandbox store (p-writescope) would suppress the victim's real write. Fix: `deriveIdempotencyKey(record)` re-derives the key from the body, making it a verifiable **content-address** (like `transaction_id`); `appendRecord` rejects a self-inconsistent INCOMING key (`idempotency-key-mismatch`, S2b), and `readByIdempotencyKey` SKIPS a forged-key stored record as a dedup target. RED suppression-guard tests 21–24 (stored-side + incoming + validator-shape + derive-unit) encode it.
- **LOW (hacker) — `idempotency_key` had no runtime shape contract** → FOLDED: `validateTransactionRecord` now 64-hex-checks it (closing the truthy-gate vs hex-gate divergence).
- **LOW (hacker, confirmed=false) — natural false-merge if agentId is reused** → documented assumption + deferred probe (Out of Scope).
- **MEDIUM/LOW (code-reviewer)** — O(n) dedup scan (JSDoc note on `appendRecord`), `buildChainedRecord` falsy-`prevPost` fail-fast guard, `deduped` `@returns` doc, `integrationRecords` test helper now counts via the production `listByRun` validation gate → all FOLDED.
- **LOW (honesty-auditor)** — un-amended `R13 (v3.1)` at `v6:556` → amended (line 15 left historical); deviation-#4 phrasing + the run-output artifact → addressed in the PR body. **Positive (confirmed):** all four core claims verify TRUE against the code — INV-22 genuinely enforced, F-01 literally fixed, false-merge-prevention non-vacuous, JSDoc matches.

**Process note:** the 3-lens tier (the user-requested correction) paid for itself on its first run — the security lens caught a confirmed HIGH that the prior single-lens review missed. Codified in [[hets-persona-lens-over-domain]].

### Hacker re-verify (2 rounds, convergent)

- **Round 1** (re-verify the suppression fix): the original suppression HIGH = **CLOSED**, but the fix INTRODUCED a new HIGH — `deriveIdempotencyKey` on the read path hashed the stored record via the **unbounded** `canonicalJsonSerialize`, so a poison record with a deeply-nested `head_anchor` (passes the lenient validator) crashed the victim's append with an unhandled `RangeError` = crash-based suppression. Plus a pre-existing MEDIUM on the incoming `computeTransactionId`. → **FOLDED:** `canonicalJsonSerialize` depth-bounded (`MAX_CANONICAL_DEPTH=100`, controlled throw); `deriveIdempotencyKey` try/catch → null (fail-closed); `appendRecord` S5 try/catch → `record-uncomputable`; `validateTransactionRecord` rejects a non-scalar `head_anchor`/`post_state_hash`. RED crash-guard tests 25–26. The depth param does NOT change hash output for flat records (M1 intact — confirmed by the suite + a byte-identical PoC).
- **Round 2** (re-verify the crash fix): **CLOSED** — 14 PoCs, 0 bypasses; the three guards compose; the original suppression stays closed; no new regression; hash-stability verified. Two residual LOWs surfaced, both **pre-existing + non-exploitable** (the hacker's words), so DEFERRED, not folded (scope discipline): L1 wide-structure O(n) cost at S5 (bounded, no crash); L2 the validator type-check covers only `head_anchor`/`post_state_hash`, so a deep-`evidence_refs` direct-disk poison loads as inert (no read path hashes it). Tracked in Out of Scope + a spawned follow-up.

## Phase

Shipped: pending (PR-4)
