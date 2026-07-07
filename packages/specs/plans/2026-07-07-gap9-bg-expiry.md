# Gap-9 background-expiry — sweep stale never-merged `live_pending` lessons (dormant/SHADOW)

**Wave**: autonomous-SDE lifecycle gap-map, Gap-9 second half (the first half — terminal-block-triggered disposal — shipped in #514).
**Branch**: `feat/gap9-bg-expiry` · **Base**: fresh `origin/main` @ `9c9f1e0`.

## Context

PR #514 shipped Gap-9's *terminal-block* disposal: when an emit fails with a terminal block (collaborators-only, etc.) the candidate is disposed *immediately* via `disposeCandidate` (record-then-tombstone). The design sketch (`packages/specs/research/2026-07-04-live-dogfood-lifecycle-gaps.md` §Gap-9) names a second, complementary lane: a **background expiry** for `live_pending` lesson nodes that grew old without ever landing — "pending artifacts accumulate silently … a background expiry for pending lessons older than N days that never reached a merge. Keep it observable (log the disposal + reason), never a silent delete." This wave ships that sweep as a **dormant, SHADOW, gates-nothing** library function reusing #514's disposal/tombstone machinery — nothing in the live pipeline calls it (an operator/future-scheduled-hook knob, exactly like `disposeCandidate` itself). ("Dormant" = no live caller, so it writes nothing in the shipped pipeline; when *invoked* it does write tombstones + disposal-outcome records by design — so the precise claim is dormant + gates-nothing/weight-inert, not "byte-inert", per the VALIDATE honesty-auditor.)

## Routing Decision

```json
{
  "task": "Gap-9 background-expiry: a dormant SHADOW lab function that sweeps live_pending lesson nodes, disposes (tombstone-only) those older than N days via the existing disposeCandidate machinery; add a mtime-aware lister to live-pending-store.js; content-addressed store, data-mutation, #273 invariants",
  "recommendation": "root",
  "confidence": 0.5,
  "score_total": 0.15,
  "scores_by_dim": {
    "compound_strong": { "matched": ["content-addressed"], "raw": 1, "weight": 0.15, "contribution": 0.15 }
  },
  "signals_matched": ["content-addressed"],
  "reasoning": "Score 0.150 → root: compound_strong (+0.150, 'content-addressed'), context (mult=0.5).",
  "weights_version": "v1.3-dict-expanded-2026-06-12",
  "substrate_meta_detected": true,
  "substrate_meta_tokens": ["tombstone", "content-addressed"],
  "meta_forcing_instruction": "[ROUTE-META-UNCERTAIN] substrate-component (content-addressed store, tombstone lane)"
}
```

**Escalation judgment**: bare score is `root`, but `[ROUTE-META-UNCERTAIN]` fired on substrate-meta tokens (`tombstone`, `content-addressed`). This change touches a **content-addressed store, the #273 provenance invariants, the tombstone lane, and data-mutation** — the exact Rule-2 class (`skills/agent-team` persona-selection Rule 2) that mandates the full **3-lens VERIFY + VALIDATE** tier regardless of the bare score. There are genuine design calls to bless (mtime-as-age-source, the age-only vs merge-cross-reference simplification, the store-surface extension). Escalating to the per-wave board.

## HETS Spawn Plan

Rule 2 (kernel/security/data-mutation class) → full 3-lens tier, read-only personas, parallel.

| Persona | Lens | Stage | Why |
|---|---|---|---|
| `architect` | design / trade-offs | VERIFY (pre-build) | mtime-as-age soundness; age-only vs merge-cross-ref scope call; store-surface factoring (`readNodeVerified` refactor vs new duplicated read); dormancy/SHADOW shape |
| `hacker` | adversarial-security | VERIFY (pre-build) + VALIDATE (re-probe BUILT code) | #273 co-forge surface on the mtime path; tombstone-as-suppression already-known lane; can the expiry become an evidence-erasure or DoS lever; repoSlug/`'expired'`-reason injection |
| `code-reviewer` | correctness | VERIFY (pre-build) + VALIDATE (built code) | fail-soft totality; idempotent re-sweep; the `readNodeVerified` back-compat wrapper preserves the crown-jewel read exactly; fd/resource discipline; boundary validation |
| `honesty-auditor` | claim-vs-evidence | VALIDATE (post-build) | "dormant/SHADOW/byte-inert" claim vs the import-graph dam; "never reached a merge" honesty vs the age-only simplification |

## Runtime Probes (claims verified firsthand against the repo)

| Claim | Probe | Result |
|---|---|---|
| A `live_pending` node body carries no timestamp — age must come from elsewhere | Read `live-pending-store.js` `STORED_KEYS` / `buildBody` | CONFIRMED — shape is `[provenance, repo, issue_ref, candidate_patch_sha, lesson_signature, lesson_body, node_id, content_hash]`; no `captured_at`. |
| The node is write-once (never rewritten), so file mtime ≈ capture time | `mintLivePendingLesson` writes with `{flag:'wx'}`, content-addressed, no update path | CONFIRMED — exclusive create, immutable; mtime is stable unless externally touched. |
| The mint does not dispose/tombstone a pending node on merge, so "reached a merge" is not a node-local fact | Read `world-anchor-mint.js` `collectCapturedCandidates` (line ~256) — it only *reads* the lane; no tombstone/delete | CONFIRMED — "never reached a merge" cannot be read off the node; would need a cross-store join. |
| The disposal store accepts a bounded-kebab `block_reason`, so `'expired'` is a valid new reason | `live-disposal.js` `BLOCK_REASON_RE = /^[a-z][a-z0-9-]{0,63}$/` | CONFIRMED — `'expired'` matches; `block_reason` is part of the disposal identity basis, so an `expired` disposal is a distinct record from a `pr-creation-restricted` one. |
| The disposal store wants a bare `owner/repo` slug; the pending node stores a full URL | `live-disposal.js` `GH_REPO_RE=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/` vs `live-pending-store.js` `GH_REPO_RE=/^https:\/\/github\.com\/…$/` | CONFIRMED — the sweep must convert via `repoSlug(node.repo)`. |
| `disposeCandidate` threads `now` to BOTH the disposal record and the tombstone, and takes `dir` (disposal) + `pendingDir` (tombstone) | Read `disposeCandidate` (lines 254-286) | CONFIRMED — `{ dir, pendingDir, now, selfUid }` all supported; fail-soft, never throws; idempotent. |
| Re-running the sweep is safe (idempotent) | disposal dedups on basis (excl. `disposed_at`) → `deduped:true`; tombstone EEXIST → `deduped:true`; a tombstoned node is skipped by the default lister | CONFIRMED — a re-sweep converges (already-expired nodes drop out of the scan set). |

## Files To Build / Modify

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/lab/causal-edge/live-pending-store.js` | modify | **medium** | Refactor the internal node read to `readNodeVerified` (returns `{body, mtimeMs}` — mtime off the SAME already-fstat'd fd, NEVER a 2nd stat, F2); `readNodeRaw` becomes a thin back-compat wrapper (`.body`). **Post-build call graph (F13, corrected at VALIDATE)**: `readNodeVerified` is called by the `readNodeRaw` wrapper + `enumerateVerifiedPendingNodes` (direct); `readNodeRaw`'s remaining 4 call sites (mint dedup pre-check + EEXIST re-check, `readLivePendingLesson`, `tombstonePendingLesson`) are behavior-identical. Note the F1 enumerator MOVED `listLivePendingLessons`'s read off `readNodeRaw` onto `readNodeVerified` (so the pre-build "5 sites incl. listLivePendingLessons" count no longer holds — F1 and F13 reconciled here). Extract ONE `enumerateVerifiedPendingNodes(opts, includeTombstoned)` (readdir + tombstone-skip applied ONCE — the anti-resurrection guard, F1); both `listLivePendingLessons` and the new exported `listLivePendingAges` project from it. Crown-jewel read path → the sensitive change. |
| `tests/unit/lab/causal-edge/live-pending-store-shadow.test.js` | modify | **medium** | **F4 — extend the LANE dam**: add `listLivePendingAges` to `READER_CALL_RE`; admit `live-expiry.js` as a 2nd named reader-caller via full-path `===` (mirrors `READER_FULLPATH`, NOT a sibling skip); non-vacuity probe (live-expiry actually calls it). Keeps the exactly-N-named-readers invariant that licenses the #273 SHADOW residual. |
| `packages/lab/causal-edge/live-expiry.js` | **NEW** | low-medium | `expirePendingLessons({ maxAgeMs, now, pendingDir, disposalDir }, opts)` — pure policy: for each verified non-tombstoned node whose `now - mtimeMs > maxAgeMs`, reconstruct the disposal candidate (`repoSlug`, `'expired'`) and call `disposeCandidate`. TOTAL (never throws); each disposal already fail-soft. Observable (per-expiry alert). Imports the sibling `live-pending-store` (lister) + `live-disposal` (disposer) — both causal-edge siblings (dam-exempt). Dormant: no live caller. |
| `tests/unit/lab/causal-edge/live-expiry.test.js` | **NEW** | low | age threshold (before/after N days), idempotent re-sweep, tombstoned-skip, repoSlug conversion, `'expired'` reason, fail-soft (a disposer that throws), TOTAL on empty/absent store, injected `now`/`disposeFn`. |
| `tests/unit/lab/causal-edge/live-pending-store.test.js` (or a new `live-pending-ages.test.js`) | modify/NEW | low | `listLivePendingAges`: returns mtime; skips tombstoned by default; `readNodeVerified` wrapper preserves `readNodeRaw` behavior (all existing tests still green). |
| `tests/unit/lab/causal-edge/live-expiry-shadow.test.js` | **NEW** | low | import-graph dam: assert `live-expiry.js` has ZERO gating/ranking/weight consumer (mirrors `live-disposal-shadow.test.js`); assert no live-pipeline file imports it. |
| `docs/SIGNPOST.md` | modify (generated) | low | `node scripts/generate-signpost.js` for the new source file(s). |

## Phases

#### Phase 1 — store surface (mtime-aware lister)
1. Refactor `readNodeRaw` → internal `readNodeVerified(node_id, dir, selfUid, cap)` returning `{ body, mtimeMs } | null` (the `st.mtimeMs` comes off the SAME already-fstat'd fd — no extra open, no TOCTOU). `readNodeRaw` = `const r = readNodeVerified(...); return r ? r.body : null;`. **Verification probe**: all existing `live-pending-store` tests green (behavior identical).
2. Add `listLivePendingAges(opts)` — copy `listLivePendingLessons`'s loop, default tombstone-skip identical, but push `{ node: deepFreeze({...body}), mtimeMs }`. Export it. **Probe**: a fresh node lists with a plausible mtime; a tombstoned node is absent by default.

#### Phase 2 — expiry policy (new dormant function)
3. `live-expiry.js`: `expirePendingLessons({ maxAgeMs, now = Date.now(), pendingDir, disposalDir }, opts)`. Validate `maxAgeMs` (positive finite int) — a bad threshold refuses (observable), never disposes everything. For each `{node, mtimeMs}` from `listLivePendingAges({dir: pendingDir, selfUid})`: skip if `now - mtimeMs <= maxAgeMs`; else `repoSlug(node.repo)` (skip + alert if null), then `disposeFn({ repo: slug, issueRef: node.issue_ref, candidatePatchSha: node.candidate_patch_sha, blockReason: 'expired', pendingNodeId: node.node_id }, { dir: disposalDir, pendingDir, now, selfUid })`. Collect `{ node_id, disposed, tombstoned }`. Return `{ scanned, eligible, disposed, tombstoned, results }`. TOTAL. **Probe**: node aged past threshold → disposed + tombstoned; node younger → untouched; re-run → deduped, scan set shrinks.
4. `repoSlug` — reuse a small local copy (the world-anchor-mint one strips `https://github.com/` and `.git`); a local helper avoids importing the mint (which is a reader with its own dam). **Probe**: `https://github.com/o/r` → `o/r`; a bare slug passes through; garbage → null (skip+alert).

#### Phase 3 — dams + signpost
5. `live-expiry-shadow.test.js` import-graph dam. `generate-signpost.js`. **Probe**: `node scripts/generate-signpost.js --check` clean; dam test asserts zero gating consumer.

## Verification Probes (aggregate)

| Probe | Pass criterion |
|---|---|
| 1 | `find tests/unit/lab/causal-edge -name '*.test.js' -print0 \| xargs -0 -n1 node` → all green (62 preserved + new) |
| 2 | **F14** — `node tests/unit/lab/world-anchor/world-anchor-mint-captured-floor.test.js` green (the ONE external consumer of the refactored read path — run locally pre-push, not just CI catch-all) + full `tests/unit/lab/world-anchor` green |
| 3 | full kernel suite green; `bash install.sh --hooks --test` → 118/0 |
| 4 | `node scripts/generate-signpost.js --check` → no drift (Test 121) |
| 5 | `node scripts/validate-release-surface.js --check` → clean |
| 6 | **F4** — lane dam: `live-pending-store-shadow.test.js` governs `listLivePendingAges` (READER_CALL_RE) + admits `live-expiry.js` full-path; import-graph dam: `live-expiry.js` has zero ranking/weight/spawn-selection consumer |
| 7 | re-sweep idempotency test: second `expirePendingLessons` run → scan set shrinks to non-expired only (tombstoned drop out) |
| 8 | **F2** — VALIDATE hacker spies `fs.openSync`/`fs.statSync`: exactly one open + one fstat per node in `listLivePendingAges` (no 2nd stat) |
| 9 | **F3** — `now`=NaN/undefined/negative → refused `{ok:false}`, disposes NOTHING (not everything) |
| 10 | **F10** — refuse-path alerts still fire from INSIDE `readNodeVerified` (plant foreign/oversize/tampered → assert emit) |
| 11 | eslint 0 / markdownlint 0 / yaml 0 |

## Out of Scope (Deferred)

- **Physical artifact reap** — tombstone-only, evidence-preserving (node bytes retained), same as #514. A real reap (deleting `draft-*.json` / cost-ledger lines) is a separate, irreversible follow-up.
- **Merge cross-reference** — the sketch says "never reached a merge"; this wave uses **age + not-already-tombstoned** and does NOT cross-reference the world-anchor/merge-outcome store to prove non-merge. **Honest residual (VERIFY board — all 3 lenses corrected the draft rationale)**: age-only is safe *only while N exceeds the max realistic merge latency*. The "already consumed = harmless GC" claim holds ONLY for an EARLY-consumed node (merge before expiry). The mint does NOT tombstone a pending node on consume, and `collectCapturedCandidates` (`world-anchor-mint.js:256`) reads the **tombstone-skipping default lister** — so a node whose merge lands AFTER the sweep (a PR open > N days) is tombstoned first, and its captured floor is silently dropped from the default mint read (recoverable via `includeTombstoned:true`, but silently absent from the live path). This is INERT while the mint gates no weight, but it is a real behavior gap, not universal harmlessness. The arming-time close: pick N well past the worst-case PR-open-to-merge latency, OR add the merge cross-reference / a merge-aware join. Named forward-contract, deferred for SHADOW.
- **A CLI / scheduled hook** — the function ships dormant (no live caller), exactly like `disposeCandidate`. Wiring it into a scheduled sweep is a future arming step. YAGNI now.
- **Authenticated provenance on mtime / tombstone** — the #273 forward-contract from #514 stands, but the VERIFY hacker sharpened the mtime framing: mtime is a **DISTINCT, LOWER-BAR** lever than the accepted same-uid node co-forge, NOT "the same co-forge class." It is not content-sealed, so it can be shifted with only a `touch` (no seal derivation, acting on OTHER already-minted legit nodes) — **and non-adversarially** by a benign `rsync` without `--times` / `cp` without `-p` / `tar` extract / backup restore, which mass-shifts mtimes. It is **BI-DIRECTIONAL** (code-reviewer): touch-OLD → premature mass-disposal of fresh/unconsumed nodes (suppresses the floor from the default mint reader); touch-FRESH → an immortal node the sweep never reaps. INERT while SHADOW (nothing gates), but the precise arming-time close is a **content-sealed `captured_at`** in the node body (bound by `content_hash`) — an authenticated *writer* alone does not close it, since mtime lives outside any seal. `captured_at` is a store-schema migration (a new `STORED_KEY` breaks the exact-set read on every existing node), so it belongs at arming, not this wave. Mitigations folded THIS wave: the per-expiry alert carries `mtimeMs + age` (forensic visibility of a mass-expiry burst, F7) and an optional `maxPerSweep` cap bounds a single sweep's blast radius (F8).
- **Skip-already-disposed membership check (VERIFY hacker MEDIUM — considered, NOT folded)** — the hacker proposed skipping a node that already has a disposal-outcome record under ANY reason, to avoid a 2nd `'expired'` record when a #514 terminal-block disposal's tombstone write had failed (recorded, un-tombstoned). **Premise-probed and declined**: a 2nd *different-reason* record is bounded honest observability (the store dedups per-reason, so at most one record per cause — "terminal-blocked AND later aged-out" is legitimate dual-cause history, not noise), and the node in that state SHOULD be tombstoned (it can never merge), which a skip would prevent. The write-amplification concern the finding also raised is addressed by F8 (`maxPerSweep`). Flagged for the VALIDATE board to re-examine.

## Drift Notes

- **Drift-note**: route-decide scored `root` (0.15) but the task is Rule-2 (content-addressed store + #273 + data-mutation). The `[ROUTE-META-UNCERTAIN]` co-fire is doing exactly its job — the escalation to the 3-lens board is by-judgment, not by-score. Consistent with the H.7.16 substrate-meta catch-22.
- **Drift-note**: "background expiry" tempts a scheduled-job / CLI framing, but the SHADOW-dormant discipline (ship the mechanism, wire nothing live) says the honest shape is a callable dormant function. Same shape as `disposeCandidate` in #514.
- **Drift-note**: the age-source question (no node timestamp → mtime) is a genuine design fork the architect lens should rule on before build; captured here so the VERIFY board anchors on it.

## Pre-Approval Verification (3-lens VERIFY board — 2026-07-07)

Rule-2 class → `architect` + `hacker` + `code-reviewer` in parallel (read-only), against the plan + source. **All three: PROCEED-WITH-FOLDS.** All three blessed the three design forks (mtime-as-age ADOPT; age-only ACCEPT-with-honesty-fix; `readNodeVerified` refactor PROCEED-with-guardrail). Findings folded:

| # | Fold | Severity / lens | Disposition |
|---|---|---|---|
| F1 | Extract ONE `enumerateVerifiedPendingNodes` (tombstone-skip once); both listers project | MEDIUM (all 3) | **FOLD** — build |
| F2 | mtime off the SAME fstat fd; no 2nd `statSync` (symlink-swap TOCTOU); `readNodeRaw` = thin projection | HIGH (hacker+cr) | **FOLD** — build + VALIDATE spy-probe |
| F3 | Validate `now` (finite,>0) symmetric with `maxAgeMs`; refuse observably | HIGH (cr) | **FOLD** — build |
| F4 | Extend the LANE dam to govern `listLivePendingAges` + admit `live-expiry` full-path | HIGH (architect) | **FOLD** — build |
| F5 | Per-node `disposeFn` try/catch (total sweep; a throw → that node only) | MEDIUM (cr) | **FOLD** — build |
| F7 | Per-expiry alert carries `mtimeMs + age`; sweep-summary alert | HIGH-adjacent (hacker+architect) | **FOLD** — build |
| F8 | Optional `maxPerSweep` cap (default unbounded = dormant behavior unchanged) | HIGH-dib (hacker) | **FOLD** — build (optional knob) |
| F9 | Return shape distinguishes refused (`{ok:false,reason}`) from empty | LOW (cr) | **FOLD** — build |
| F10 | Assert refuse-path alerts fire from INSIDE `readNodeVerified` | LOW (architect) | **FOLD** — tests |
| F11 | Out-of-Scope: mtime is a DISTINCT LOWER-BAR, BI-DIRECTIONAL lever (touch/rsync/cp/restore); arming close = content-sealed `captured_at` | HIGH (hacker), fold cr | **FOLD** — plan text ✓ |
| F12 | Out-of-Scope: late-merge window honesty (age-only safe only when N ≫ merge latency) | HIGH (all 3) | **FOLD** — plan text ✓ |
| F13 | 5 call sites across 4 functions (not 4) | LOW (cr) | **FOLD** — plan text ✓ |
| F14 | Add world-anchor captured-floor test to local probes | MEDIUM (cr) | **FOLD** — probes ✓ |
| F15 | Local `repoSlug` + parity test vs mint + fail-safe-today comment | LOW/NIT (all 3) | **FOLD** — build (keep-local per architect YAGNI) |

**Premise-probed, NOT folded** (documented in Out-of-Scope for VALIDATE re-examination): the hacker's "skip already-disposed" membership check (a 2nd different-reason record is bounded honest observability, and the node should be tombstoned; F8 handles amplification); the code-reviewer's `repoSlug`→`kernel/_lib` extraction (architect ruled YAGNI-keep-local at NIT with 2 consumers; keeps the crown-jewel mint untouched).

Board tokens: ~351K, 48 tool calls, 3/3 done. Full findings: workflow `wf_646fd924-1cb`.

## VALIDATE result (post-build 3-lens board — 2026-07-07)

Rule 2 + Rule 2a → `code-reviewer` + `hacker` (LIVE re-probe of the BUILT code) + `honesty-auditor`, parallel. **All three: SHIP-WITH-FOLDS.** The hacker ran **8 live probes** against the built modules — all CONFIRMING the safety posture: F2 single-fstat proven (`opens=N, path-statSync=0`); tombstone-only holds (`unlink=0, truncate=0`, node bytes retained); the exact-set read rejects an injected `block_reason` field; `'expired'` is un-smuggleable (hardcoded literal); repo-injection is contained (disposal store re-validates); dormancy confirmed (zero live caller). Post-build folds applied:

| # | Fold | Severity / lens | Disposition |
|---|---|---|---|
| V1 | `maxPerSweep:0` was silently UNBOUNDED (the safest value → least-safe behavior; `0.5` floored-to-0 DID cap — internal inconsistency) → distinct `isNonNegativeFinite` (`>= 0`) so 0 is a real zero-item cap | **MEDIUM** (cr, CONFIRMED live) | **FOLDED** — code + test e15 |
| V2 | NaN `mtimeMs` fell through to DISPOSE (the F3 failure, per-node, test-seam reachable) → `Number.isFinite(mtimeMs)` guard (skip, never dispose) | LOW (hacker+cr, CONFIRMED) | **FOLDED** — code |
| V3 | Plan F13 "5 sites incl. listLivePendingLessons untouched" contradicted the F1 enumerator (which moved that read) | MEDIUM (honesty, CONFIRMED) | **FOLDED** — plan text (above) |
| V4 | Return `eligible` was the ATTEMPTED count, under-reported when capped → renamed `attempted` + JSDoc | LOW (cr+honesty, CONFIRMED) | **FOLDED** — code + tests |
| V5 | Dormancy dam was `packages/`-scoped; a future `scripts/`/launchd arming caller would escape it | LOW (all 3, CONFIRMED) | **FOLDED** — dam scans `packages/ + scripts/` |
| V6 | F8 comment "bounds the loop work" over-claimed (bounds writes, not the enumeration read) | LOW (honesty, CONFIRMED) | **FOLDED** — comment |
| V7 | F5 isolation tested only with an always-throwing disposeFn (per-node isolation unproven) | LOW (honesty, CONFIRMED) | **FOLDED** — test e16 (first throws, second disposes) |
| V8 | "byte-inert" language (the sweep writes tombstones/records when invoked) → "dormant + gates-nothing" | NIT (honesty+hacker) | **FOLDED** — plan + JSDoc (counts are node-centric) |

**CodeRabbit (async bot, real review — no rate-limit; 1 nitpick, FOLDED):** the `maxPerSweep` cap processed `readdirSync` order, so under a cap the *unswept* nodes could be more overdue than disposed ones — a subtly-wrong "dispose the stalest" semantic. Folded: sort the node list **oldest-mtime-first** (immutably) before the loop, so the cap bounds the blast radius among the MOST overdue candidates (no-op when uncapped). Test e17 asserts the youngest node is the survivor under a 2-of-3 cap.

**Board endorsed** (CONFIRMED, no change): the F6 "skip-already-disposed" decline is HONEST (a #514-recorded-but-untombstoned candidate genuinely SHOULD be tombstoned by the age sweep; the per-basis dedup makes a 2nd different-reason record legitimate dual-cause history, not noise); the readNodeVerified refactor is behavior-preserving (24 pre-existing tests + the world-anchor external consumer unchanged); the whole lane stays SHADOW/weight-inert with the #273 arming close (content-sealed `captured_at`) named. Board tokens: ~450K, 67 tool calls, 8 live probes, 3/3 done. Full findings: workflow `wf_9a8a5abd-a20`.
