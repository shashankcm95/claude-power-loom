# PR-P3c-c — non-genesis minting: the integrator exercises the live walk

> The minting follow-up descoped from P3c-b (#196). The ordered integrator now MINTS a non-genesis chained provenance record per clean merge and walks it to genesis BEFORE advancing the tip — so the live chain-walk is finally exercised against integrator-built records (`depthWalked ≥ 1`), and a clean merge whose provenance does NOT link to genesis is set aside fail-closed. Arc anchors: [`2026-06-01-p3c-b-ordered-integrator.md`](2026-06-01-p3c-b-ordered-integrator.md) + [`2026-06-01-p3-design-integration-branch.md`](2026-06-01-p3-design-integration-branch.md).

## Context

P3c-b (#196, merged) shipped the ordered integrator as a **pure git-merge stacker** — no record store, no provenance. The USER descoped non-genesis minting + the live-walk exercise to this follow-up. Ground truth: `buildSpawnRecord` mints GENESIS records only; the producer (`stageCandidate`) stores a genesis record per candidate (`prev = computeGenesisHash`, `post_state_hash = computePostStateHash(delta^{tree})`). This PR builds the first non-genesis minter and wires it into the integrator's clean-merge path.

This is the M1/Case-E fallacy-risk zone. **The premise + the two board-flagged gaps were probed firsthand before this revision** (Runtime Probes). The `/verify-plan` board (2 CRITICAL + 6 HIGH) is recorded in Pre-Approval Verification; every finding is folded below.

## Routing Decision

Architect-shaped (a provenance-chaining sub-design touching the merged integrator + the record store + the K9 walk). Routed: firsthand recon of the 4 consumed modules + a firsthand end-to-end chain probe + a `/verify-plan` board + firsthand re-probes of the board's two CRITICALs, all BEFORE the build.

## Principle Audit

- **SRP** — the non-genesis builder is its OWN module (`integration-record.js`). The integrator's provenance-chaining enters via injected seams (`chainRecordFn`/`resolveParentFn`/`appendRecordFn`), not inline. `mintIntegrationRecord` (read-evidence + mint + walk + append, fail-soft) is one unit; `integrateOneClean` stays a thin dispatcher.
- **Open/Closed** — minting is ADDITIVE: ON only when `runId`+`stateDir` are supplied (CLI: iff `--run-id` is passed). Absent → the integrator behaves exactly as P3c-b. The 22 P3c-b tests pass unchanged.
- **DRY** — the builder reuses `computePostStateHash`/`computeTransactionId`/`validateTransactionRecord` verbatim (M1); no hash is re-derived.
- **Immutability** — every record is built fresh; the fold threads NEW `tip`/`chainHeadPost`/id-arrays per step.
- **KISS/YAGNI** — no per-ref CONTENT verification (v3.1 R10); no two-phase commit (single COMMITTED record); a fixed integrator identity.

## Recon Findings (firsthand, grounded)

- **`transaction-record.js`:** `computePostStateHash(treeSha)` = `sha256('POST_STATE|'+treeSha)` (M1). `computeTransactionId` = `sha256(canonical_json(record − transaction_id))`. `validateTransactionRecord(rec,{isGenesisPosition:false})`: `prev_state_hash` MUST be 64-hex; A10 — a state-changing op (CREATE/APPEND/…) needs **non-empty `evidence_refs`** (content NOT verified — v3.1 R10). Schema required (8): `transaction_id, prev_state_hash, writer_persona_id, writer_spawn_id, operation_class, intent_recorded_at, commit_outcome, schema_version`; `additionalProperties:false`; `post_state_hash`/`head_anchor` are declared (allowed, null-tolerant).
- **`quarantine-promote.js`:** `genesisRecordFields` does NOT carry `post_state_hash` (that's `buildSpawnRecord`-only) — so the non-genesis builder must set `post_state_hash` explicitly (board CRITICAL #2).
- **`record-store.js`:** `appendRecord` validates (non-genesis → strict 64-hex `prev` + A10) then the `transaction_id===computeTransactionId` integrity gate; never throws. `readByPostStateHash` scans the run dir (O(records)/call) for the record whose `post_state_hash===key` — the `resolveParent` seam.
- **`k9-promote-deltas.js`:** `checkEvidenceLinkPreCommit({record,isGenesisPosition,resolveParent})` validates the head, terminates at genesis (`depthWalked:0`), else walks `prev → readByPostStateHash → parent` until `isGenesisPosition(parent)`. `isGenesisPosition` recognizes `prev==='GENESIS'`, a sentinel, OR `prev===computeGenesisHash(schema_version, scope)` (the producer's form).

## Runtime Probes (firsthand — load-bearing; the M1/Case-E premise + the board's 2 CRITICALs)

| Claim | Result |
|---|---|
| A non-genesis record (prev = seed's STORED post, `post_state_hash` set, evidence non-empty) walks to genesis. | **CONFIRMED** `{ok:true, depthWalked:1}` |
| The chain extends (record_2 prev=record_1.post). | **CONFIRMED** `{ok:true, depthWalked:2}` |
| A broken chain (prev resolves to nothing) is rejected. | **CONFIRMED** `{ok:false, chain-bottomed-out-non-genesis}` |
| **(board HIGH)** the integrator's seed post `computePostStateHash(rev-parse delta_sha^{tree})` === the PRODUCER's stored genesis post `computePostStateHash(materializeDelta.tree)`. | **CONFIRMED** (`delta_sha^{tree}` === the producer `write-tree`; real-producer-shaped) |
| **(board CRITICAL #1)** `evidence_refs` = the candidate's genesis record `transaction_id` (read via `readByPostStateHash(candidatePost)`) validates + walks. | **CONFIRMED** `{ok:true, depthWalked:1}` — R10-safe (a real record ref, not a raw git sha) |

## Architecture — a minting arm threaded through the clean-merge path (board fixes folded)

Minting is ON iff `runId`+`stateDir` are supplied. The integrator gains an optional `ctx`; the composer resolves the seams (defaults = the real builder / `readByPostStateHash` / `appendRecord`).

```
integrateCandidates({ ...P3c-b opts..., runId, stateDir,
                      chainRecordFn, resolveParentFn, appendRecordFn })   // NEW, all optional
ctx = { minting: !!(runId && stateDir), schemaVersion, runGit,
        chainRecordFn  = buildChainedRecord,
        resolveParentFn = (h) => readByPostStateHash(h, {runId, stateDir}),
        appendRecordFn  = (r) => appendRecord(r, {runId, stateDir}) }

foldCandidatesOntoTip(resolved, runGit, ctx):
    tip = resolved[0].delta_sha
    chainHeadPost = null
    if ctx.minting:                                                   // BOOTSTRAP the chain head from the seed (re-board HIGH)
       boot = bootstrapSeedChain(tip, ctx)                            //   the seed anchors EVERY downstream walk -> require it UPFRONT
       if !boot.ok: return { ...emptyAcc, aborted:true, reason: boot.reason }  // 'seed-rev-parse-failed' | 'seed-unprovenanced'
       chainHeadPost = boot.post
    integratedIds=[seed_id]; quarantinedIds=[]; quarantineOverwrites=[]; provenanceRejectedIds=[]
    ... (the per-candidate fold, unchanged) ...

bootstrapSeedChain(seedDelta, ctx):   // fail-soft; the seed's genesis is REQUIRED (record_1.prev resolves to it, NOT to a per-candidate skip)
  try:
    seedPost = computePostStateHash(rev-parse `${seedDelta}^{tree}`)  // guarded: a rev-parse miss -> 'seed-rev-parse-failed' (re-board CR LOW)
    if !ctx.resolveParentFn(seedPost): return {ok:false, reason:'seed-unprovenanced'}  // no seed genesis -> NO candidate can chain; surface the SEED, not candidate-1
    return {ok:true, post: seedPost}
  catch: return {ok:false, reason:'seed-rev-parse-failed'}
// runIntegration forwards fold.reason (seed-unprovenanced / seed-rev-parse-failed / merge-error) into the report.
    for cand in resolved[1..] IN DECLARED ORDER:
       acc = { tip, chainHeadPost, integratedIds, quarantinedIds, quarantineOverwrites, provenanceRejectedIds } // captures chainHeadPost
       s = stackOneCandidate(tip, cand, runGit)                          // unchanged (merge-base --all + tri-state)
       clean:
         r = integrateOneClean(tip, chainHeadPost, cand, s.tree, runGit, ctx)
         r.ok                  -> tip=r.tip; chainHeadPost=r.chainHeadPost; integratedIds += cand
         r.kind==='provenance' -> provenanceRejectedIds += cand          // continue; NO ref pinned (the candidate ref persists)
         r.kind==='commit'     -> return {...acc, aborted:true}          // a git-object failure aborts (rare)
       conflict|quarantine -> quarantineCandidate(cand) (as P3c-b)
       error -> return {...acc, aborted:true}
    return {...updated, aborted:false}

integrateOneClean(tip, chainHeadPost, cand, mergedTree, runGit, ctx):
    commit = commitMergedTree({tree: mergedTree, parents:[tip, cand.delta_sha]})  // build the OBJECT (no ref yet)
    if !commit.ok: return {ok:false, kind:'commit'}
    if !ctx.minting: return {ok:true, tip: commit.commit, chainHeadPost: null}    // P3c-b path
    m = mintIntegrationRecord(chainHeadPost, cand, mergedTree, ctx)               // COMMIT-FIRST (board HIGH): object built, then mint
    if !m.ok: return {ok:false, kind:'provenance'}                               // walk/append/throw -> provenance-rejected; object is GC-able
    return {ok:true, tip: commit.commit, chainHeadPost: m.post}                   // advance ONLY when both commit + mint succeed

mintIntegrationRecord(prevPost, cand, mergedTree, ctx):   // NEVER throws -> {ok:false} on ANY failure (board PRINCIPLE)
  try:
    candPost = computePostStateHash(rev-parse `${cand.delta_sha}^{tree}`)
    candGenesis = ctx.resolveParentFn(candPost)                                   // the candidate's OWN genesis record
    if !candGenesis: return {ok:false}                                            // no per-candidate provenance -> reject
    post = computePostStateHash(mergedTree)                                        // M1 verbatim
    record = ctx.chainRecordFn({ prevPost, post, evidenceTxid: candGenesis.transaction_id,
                                 safeId: cand.safeId, schemaVersion: ctx.schemaVersion })
    walk = checkEvidenceLinkPreCommit({ record, isGenesisPosition:false, resolveParent: ctx.resolveParentFn })
    if !walk.ok: return {ok:false}                                                 // fail-CLOSED — never advance an unprovenanced merge
    if !ctx.appendRecordFn(record).ok: return {ok:false}
    return {ok:true, post}
  catch: return {ok:false}
```

**`buildChainedRecord({prevPost, post, evidenceTxid, safeId, schemaVersion})`** (NEW `packages/kernel/_lib/integration-record.js`): `prev_state_hash = prevPost` (the parent's STORED post — the M1/Case-E seam, NOT a recompute), `post_state_hash = post` (EXPLICIT — board CRITICAL #2), `head_anchor: null`, `operation_class:'APPEND'`, `evidence_refs:[evidenceTxid]` (the candidate's genesis record txid — a real R10-safe chain edge, NOT a raw git sha — board CRITICAL #1), `commit_outcome:'COMMITTED'`, `writer_persona_id: KERNEL_INTEGRATOR_PERSONA`, `writer_spawn_id:'loom-integrate-'+safeId`, `intent_recorded_at: now` (= commit time; single-phase, no separate PENDING record — board LOW), `schema_version`. `transaction_id = computeTransactionId(record)`; validated `isGenesisPosition:false` (fail-fast).

**THE NAMED SEMANTIC (board MEDIUM M7 + re-board honesty MEDIUM):** per-candidate provenance is ENFORCED by the READ GATE in `mintIntegrationRecord` — it REQUIRES `resolveParentFn(candPost)` to resolve the candidate's OWN genesis record; absent → provenance-rejected (NOT integrated; surfaced in `provenanceRejectedIds`). The resolved `transaction_id` is then recorded in `evidence_refs` as an **A10-satisfying, R10-UNVERIFIED back-reference** — it is NOT walked by `checkEvidenceLinkPreCommit` (only the `prev` chain is walked to genesis; per-ref content verification is v3.1 R10). So the precise guarantee is: *the candidate's genesis record was resolvable at mint time* (a presence gate), recorded as a back-reference — NOT a verified evidence link. The seed's genesis is required the same way, upfront (`bootstrapSeedChain`), because record_1's `prev`-walk resolves to it.

**Ordering — COMMIT-FIRST (board HIGH, consistent prose + pseudocode):** build the merge object → mint+walk+append → advance the tip ONLY if both succeed. A mint failure orphans the (unreferenced, GC-able) commit object — the lesser evil vs an append-first path that could leave a `COMMITTED` record with no merge (a permanently decoupled chain). Records appended during a run that later aborts/loses-CAS are F-01-tolerable dups (same `post_state_hash`; a re-run re-appends equivalently).

## Files To Modify

- **NEW** `packages/kernel/_lib/integration-record.js` — `buildChainedRecord` + `KERNEL_INTEGRATOR_PERSONA`.
- **NEW** `tests/unit/kernel/_lib/integration-record.test.js` — the builder unit contract.
- **MODIFY** `packages/kernel/spawn-state/integrator.js` — thread `ctx` through `foldCandidatesOntoTip`/`integrateOneClean`; add `mintIntegrationRecord`; the typed `{ok:false, kind}` return; `provenanceRejectedIds` in the report (`report()` default += `[]`). Minting OFF when `runId`/`stateDir` absent (P3c-b preserved). Watch `foldCandidatesOntoTip` line count (extract if > 50).
- **MODIFY** `packages/kernel/spawn-state/integrate-cli.js` — add a `--run-id <id>` flag (+ `--state-dir`, default the producer's `LOOM_SPAWN_STATE_DIR` || `~/.claude/spawn-state`). Minting is ON iff `--run-id` is passed (explicit — NOT a session_id derivation, which a standalone CLI cannot obtain; board HIGH). `Probe: integrate-cli --run-id X --root R <ids> → records under <stateDir>/X/`.
- **MODIFY** `tests/unit/kernel/spawn-state/integrator.test.js` — add the minting tests (M2–M8). The 22 existing tests UNCHANGED (no `runId`/`stateDir` → no minting).

## Phases (TDD RED → GREEN → review → smoke)

1. **RED** — `integration-record.test.js` + the minting tests, against the absent builder/seam.
2. **GREEN** — `integration-record.js` + the integrator threading + the CLI flag.
3. **Review-on-diff** — architect + code-reviewer (the M1 seam, commit-first ordering, the typed-return routing, fail-soft mint, immutability, fold line count).
4. **Smoke** — `bash install.sh --hooks --test` (118/0) + full kernel suite (now 41 files) + the firsthand chain probe re-run against an INTEGRATOR-built record.

### RED behavioral contract

- **M1** `buildChainedRecord`: `prev_state_hash===prevPost` (verbatim); `post_state_hash===post` (EXPLICIT) `===computePostStateHash(mergedTree)`; `head_anchor===null`; `evidence_refs===[evidenceTxid]` (64-hex); `operation_class:'APPEND'`; validates `isGenesisPosition:false`; `transaction_id===computeTransactionId`; **a full `appendRecord` round-trip succeeds + `readByPostStateHash(post)` returns it** (the join, not just validation).
- **M2** (headline) integrate 2 clean candidates WITH `runId`/`stateDir` (seed + both candidate genesis records pre-seeded via the real producer/`buildSpawnRecord`) → record_1 + record_2 appended; `checkEvidenceLinkPreCommit` on the INTEGRATOR-built record_1 → `{ok:true, depthWalked:1}`, record_2 → `depthWalked:2` (non-vacuous against integrator output).
- **M3** per-candidate provenance required: a clean candidate whose OWN genesis record is ABSENT under `runId` → `provenanceRejectedIds` (NOT integrated, NOT `quarantinedIds`); the merge object is NOT advanced; no orphaned record.
- **M4** chain edge = the STORED post: record_2.prev === record_1.post (the value `appendRecord` stored), NOT `computePostStateHash(growing tip)`.
- **M5** minting OFF: integrate WITHOUT `runId`/`stateDir` → no records; identical to P3c-b (regression guard for the 22).
- **M6** append failure (inject `appendRecordFn` → `{ok:false}`) → `provenanceRejectedIds`, tip not advanced (the ctx `appendRecordFn` seam).
- **M7** mint throw (inject `chainRecordFn` that throws) → `provenanceRejectedIds`, never escapes the outer boundary (fail-soft).
- **M8** N≥5 clean candidates → all chained (`depthWalked` increments 1..N-1); the nested `readByPostStateHash` scan stays correct at depth (a sanity bound, not a perf gate — see Out of Scope for the O(N³) growth).
- **M9** (re-board HIGH — seed asymmetry) the SEED's genesis record ABSENT under `runId` → the run aborts `reason:'seed-unprovenanced'` (NO tip advances; the SEED is surfaced, NOT misattributed to candidate-1 as a per-candidate provenance-reject). A seed `delta_sha^{tree}` rev-parse failure → `reason:'seed-rev-parse-failed'` (fail-soft, not an opaque 'threw').

## Verification Probes

1. The live walk is NON-vacuous against INTEGRATOR-built records (M2 `depthWalked≥1`).
2. The M1 seam holds (M4 — stored-post threading) + the per-candidate provenance requirement (M3).
3. Minting OFF ≡ P3c-b (M5 + the 22 unchanged); minting opt-in via `--run-id` only.
4. Smoke 118/0 + kernel 41/41.

## Sub-Decisions (SETTLED by the board + the firsthand re-probes)

1. **Builder placement:** SETTLED → new `_lib/integration-record.js` (SRP).
2. **Integrator identity:** SETTLED → a fixed `KERNEL_INTEGRATOR_PERSONA` constant (KISS).
3. **`operation_class`:** SETTLED → `APPEND`.
4. **Evidence kind:** SETTLED → the candidate's genesis record `transaction_id` (R10-safe; board CRITICAL #1; probed). Requires per-candidate provenance (M7 semantic named).
5. **`runId` source:** SETTLED → an explicit `--run-id` CLI flag (board HIGH; a standalone CLI has no hook payload). Minting opt-in via the flag.
6. **Ordering:** SETTLED → commit-first; advance only on mint success (board HIGH).
7. **Provenance-fail disposition:** SETTLED → `provenanceRejectedIds` (distinct from conflict `quarantinedIds`; board HIGH) — no `loom-promote` ref (the candidate ref persists; remediation = re-run the producer, re-integrate).
8. **Seed provenance (re-board HIGH):** SETTLED → require the seed's genesis record UPFRONT (`bootstrapSeedChain`); absent → abort `seed-unprovenanced` (the seed anchors record_1's walk — a whole-run condition, NOT a per-candidate skip). The candidate-genesis read is sound for EVERY candidate: `delta_sha^{tree}` === the producer's stored `write-tree` (probed) AND the producer's FLAG-2 record-before-ref ordering means a resolved candidate ref implies a present genesis record.

## Out of Scope (Deferred)

- **Per-ref evidence CONTENT verification** — v3.1 R10 (the deferral that drove the evidence-kind fix).
- **Two-phase commit** (PENDING → COMMITTED) — single COMMITTED record (the merge is synchronous + atomic via the terminal CAS).
- **The O(N³) `readByPostStateHash` scan** during the fold (re-board CR: each of N candidates does an evidence read + a depth-k chain-walk, each step a full dir scan → N × N walk-steps × N files). Bounded + CLI-only at small N (N=5 ≈ 60 reads); the in-memory index is a deferred record-store optimization (YAGNI). Documented, not implemented; M8 sanity-bounds correctness (not a perf gate).

## Drift Notes

- **DN P3c-c-1:** the firsthand chain probe resolved the board's Case-E concern BEFORE the plan; the board then found 2 CRITICAL (evidence-kind, missing `post_state_hash`) the abstract design missed, both re-probed firsthand before this revision. The premise-probe + the adversarial board are complementary — neither alone caught everything.
- **DN P3c-c-2:** the board caught an unprobed runtime claim (the CLI `runId` = "sha256(session_id)") that a standalone CLI cannot satisfy — the `drift:plan-honesty` class. Corrected to an explicit `--run-id`.

## Pre-Approval Verification

Board: a read-only `architect` + `code-reviewer` lens against the v1 plan. Both **NEEDS-REVISION**, **2 CRITICAL + 6 HIGH** — all folded into this revision; the two CRITICALs were firsthand-re-probed (Runtime Probes rows 4–5) before folding.

### Architect → disposition
- **[CRITICAL] `evidence_refs=[delta_sha]` is the wrong kind + R10 retro-fail** → FOLDED (evidence = the candidate's genesis `transaction_id`; Sub-Decision 4; probed).
- **[CRITICAL] builder omits `post_state_hash`** → FOLDED (explicit `post_state_hash===post` + `head_anchor:null`; M1 asserts a full `appendRecord`/`readByPostStateHash` round-trip).
- **[HIGH] seed-bootstrap not probed with the real producer** → FOLDED (Runtime Probes row 4 — confirmed equal).
- **[HIGH] provenance-fail conflated with conflict quarantine** → FOLDED (`provenanceRejectedIds`, distinct disposition).
- **[HIGH] fold line-count / `acc` must capture `chainHeadPost`** → FOLDED (`acc` includes `chainHeadPost`; line-count watch in Phase 3; `mintIntegrationRecord` a separate unit).
- **[MEDIUM] CLI always-mints (no off-switch)** → FOLDED (opt-in via `--run-id`).
- **[MEDIUM] M7 partial-store semantic unnamed** → FOLDED (per-candidate provenance REQUIRED, named + M3).
- **[MEDIUM] `appendRecordFn` seam unlisted** → FOLDED (in `ctx`; M6). **[LOW] single-phase `intent_recorded_at`** → FOLDED (a builder note).

### Code-reviewer → disposition
- **[HIGH] ordering contradiction (prose vs pseudocode)** → FOLDED (commit-first, consistent; Sub-Decision 6).
- **[HIGH] M3/M6 quarantine-vs-abort mismatch** → FOLDED (typed `{ok:false, kind:'provenance'|'commit'}`; provenance→continue, commit→abort).
- **[HIGH] `runId` bridge unprobed** → FOLDED (explicit `--run-id`; DN P3c-c-2).
- **[PRINCIPLE] mint throw escapes the boundary** → FOLDED (`mintIntegrationRecord` fully try/caught → `{ok:false}`; M7).
- **[MEDIUM] O(N²) dir-scan undocumented** → FOLDED (Out of Scope + M8). **[LOW] evidence commit-vs-tree sha** → FOLDED (subsumed by the evidence-kind fix).

### Re-board (the revised plan — USER-requested 2nd pass)

A second `architect` + `code-reviewer` lens against this revised plan. **Code-reviewer: READY** (0 CRITICAL/HIGH; confirmed all four v1 fixes landed; 1 MEDIUM doc-label + 3 LOW defense-in-depth notes). **Architect: NEEDS-REVISION — 1 HIGH** (a residual the revision introduced) + 2 MEDIUM. All folded:

- **[HIGH] seed-genesis asymmetry** → FOLDED. record_1's `prev`-walk transitively requires the seed's genesis record, yet the seed was admitted whole — a missing seed-genesis was misattributed to candidate-1. Now `bootstrapSeedChain` requires it UPFRONT → abort `seed-unprovenanced` (Sub-Decision 8, M9).
- **[MEDIUM] honest-framing** → FOLDED. The evidence-ref txid is NOT walked; the per-candidate gate is the READ. Reworded the named semantic (A10-satisfying, R10-unverified back-reference; presence gate, not a verified link).
- **[MEDIUM] read-soundness undocumented** → FOLDED (Sub-Decision 8: `delta_sha^{tree}`===stored tree + FLAG-2 record-before-ref).
- **[MEDIUM] O(N²)→O(N³) label** → FOLDED (Out of Scope corrected; M8 reworded).
- **[LOW] seed rev-parse → opaque 'threw'** → FOLDED (`bootstrapSeedChain` guards → `seed-rev-parse-failed`; M9). **[LOW] keep `integrateOneClean`'s local commitMergedTree try/catch** → GREEN note. **[LOW/FLAG] fold line-count + `provenanceRejectedIds:[]` report default + M10/M11 (dup-post, builder-validation-throw)** → GREEN/hardening notes.

### Net verdict — READY for the TDD RED phase

Two boards + multiple firsthand probes (the chain walk, the seed-post equality with a real producer, the candidate-genesis-txid evidence, the fail-closed orphan). The re-board's HIGH (seed asymmetry) + all MEDIUMs are folded; the code-reviewer returned READY. The remaining items are GREEN-time defense-in-depth (keep the local try/catch) + hardening tests (M10/M11). Build may begin.
