---
lifecycle: persistent
---

# Wave B — the merge-poll → captured-lesson promotion

**Status**: Proposed → pending `/verify-plan` (architect + code-reviewer) → USER approval before build.
**Date**: 2026-07-14
**Scope**: SHADOW / weight-0 / additive. ONE new lab module (`merge-promote.js`) + a CLI arm + tests, on top of the Wave A queue (#580, merged). Wave C (persona-carry) and the `live-solve-one → queue` auto-wire are OUT of scope.

## Context

Wave A landed the durable solve-queue lifecycle store; the recon found the live-solve *capture* (ladder item 3) already built (a lesson is captured at the solve into `live_pending`, keyed on `candidate_patch_sha`). Wave B is the **async merge-poll that promotes a merged solve into a minted lesson** — the wire that makes a merged PR actually produce a world-anchored node. It polls the queue's `in_flight` entries, gh-verifies each PR merged (join-key-free), sources the **captured** lesson by `candidate_patch_sha`, mints a **weight-0** `world_anchored` node, and advances the entry `in_flight → merged → minted`. The producer never blocks on any single merge; the dataset widens as merges land.

## The design fork (surfaced for the board)

The merge→mint chain has two paths:

- **Option A — the join-key / armed path** (`runMergeObserve → mintFromMergeOutcome`): anchored on the kernel-egress join-key created at *armed* `emitPR` time. It carries the sealed `approval_hash` + broker-sig trust chain, but **requires the operator to emit via the kernel egress** (arming-adjacent); in pure SHADOW (dry emit, no arming) it fails-closed `no-join-key`. This is the eventual "real" trust path, gated behind arming.
- **Option B — the join-key-FREE captured path** (CHOSEN): `verifyMerge` (join-key-free gh) + the captured lesson (`resolveCapturedSignatureForAttest` on `candidate_patch_sha`) + a node-only weight-0 mint (`mintWorldAnchoredNode`, `admit`-refused `no-authenticated-edge` → weight 0). This is what `record-manual-merge` already does, but sourcing the lesson from the **capture** instead of a hand-authored arg — i.e. it **activates the built-but-production-inert `attest-from-capture` seam** in a SHADOW-safe way. Matches the USER model: the operator opens the PR normally, Wave B mints the captured (persona-tied) lesson on merge, nothing arms.

Everything is weight-0/SHADOW regardless, so the A-vs-B trust distinction only bites at ARMING (deferred); B is the correct SHADOW choice now. Option A is the named future path.

## Routing Decision

Verbatim `route-decide.js` (the substrate-meta lexicon-miss again — `stakes`/`audit` tokens unmatched; the task is architect-shaped: a mint + gh + #273 provenance + the weight-0 invariant. Escalated by the `/verify-plan` gate + judgment):

```json
{ "task": "Build Wave B merge-poll promotion ...", "recommendation": "root", "confidence": 0.4, "score_total": 0 }
```

## HETS Spawn Plan

The `/verify-plan` board:

| Persona | Role | Why |
|---|---|---|
| 04-architect | design | the A-vs-B fork; the SHADOW-safety (weight-0) argument; the fail-closed-on-no-capture policy; the queue-advance ordering (merge before mint, so a mint failure leaves a resumable `merged` state) |
| 03-code-reviewer | correctness | the poll loop's per-entry isolation (one bad entry never aborts the batch); idempotent re-poll (a re-run must not double-mint or double-advance); the reuse seams (verifyMerge / resolveCapturedSignatureForAttest / mintWorldAnchoredNode); gh-runner injection |

The adversarial (`hacker`) lens runs at the post-build VALIDATE (Rule 2a re-probe of the built mint path), not pre-approval.

## Files To Modify

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/lab/solve-queue/merge-promote.js` | create | high | the two-state poller + promotion: `list(in_flight)`→confirm merge; `list(merged)`→source captured lesson→weight-0 mint→`advance` |
| `packages/lab/world-anchor/world-anchor-mint.js` | modify | medium | extend `resolveCapturedSignatureForAttest` to also return `lesson_body` (the DAM-safe seam — the sole admitted live-pending reader) |
| `packages/lab/solve-queue/cli.js` | modify | low | add a `promote` subcommand (a single sweep; JSON summary) |
| `packages/lab/solve-queue/README.md` | modify | low | document the two-state promote sweep + the merged→minted transitions + SHADOW/weight-0 |
| `tests/unit/lab/world-anchor/world-anchor-mint.test.js` | modify | low | assert the extended helper returns `lesson_body` (+ still gates exact-one) |
| `tests/unit/lab/solve-queue/merge-promote.test.js` | create | high | TDD-first; injected gh-runner + seeded live_pending + isolated stores |

## Design (Option B, revised post-verify — the two FAILs + the emitted_at footgun folded in)

- **`promoteMergedEntries(opts)` — a TWO-STATE sweep** (the crux fix): it sweeps **`in_flight` AND `merged`**, in two passes, so a `merged`-but-not-yet-`minted` entry (from a crash, a transient gh/store error, or a not-yet-present capture) is RE-VISITED and its mint RETRIED. TOTAL (never throws); each per-entry step is a `{ok:false,reason}`-routed result (NOT just try/catch — the reused primitives return, not throw) collected into a typed summary `{ merged:[entry_id], minted:[{entry_id, node_id}], skipped:[{entry_id, stage, reason}], errors:[{entry_id, stage, message}] }`.
  - **Pass 1 — confirm merges** (`promoteOneInFlight`, extracted): for each `list({state:'in_flight'})`: require `evidence.pr_url`+`evidence.candidate_patch_sha` (else `skip`); `parsePrUrl` inside try/catch → a malformed url is a named `bad-pr-url` skip (not a thrown abort); cross-check `parsed.repo === entry.repo` (else `repo-mismatch` skip — no wrong-repo join); `verifyMerge` (join-key-free). `!ok`/`merged!==true` → `skip`, leave `in_flight`. `merged===true` → `advance(in_flight → merged, {merge_sha})`.
  - **Pass 2 — mint pending merges** (`promoteOneMerged`, extracted): for each `list({state:'merged'})` (includes pass-1's just-advanced AND any prior-stranded): source the captured lesson; if present, mint the weight-0 node + `advance(merged → minted, {node_id})`; if absent → `skip` (`no-captured-lesson`), leave `merged` (retried next sweep — a persistent no-capture stays observably `merged`; a human disposes it via `advance --to-state disposed`).
- **Capture-sourcing keeps the reader DAM intact (FAIL #2 fix)**: `merge-promote.js` NEVER imports `live-pending-store` (its full-path reader allowlist admits only `world-anchor-mint.js`). Instead, `resolveCapturedSignatureForAttest` (world-anchor-mint.js:559) is EXTENDED to also return `lesson_body` (additive: `{ok, lesson_signature, lesson_body}` — `byPatch[0].lesson_body` is already in hand there); the exact-one join stays. `merge-promote.js` calls that one admitted reader.
- **The mint (weight-0)** reuses the same primitive set as `runRecordManualMerge` (composed directly from `gh-verify` + the stores — NOT imported from `cli.js`; a small deliberate duplication of the ~15-line evidence→attestation→mint compose, with a shared-tail extraction named as a deferred DRY follow-up): `fetchPrMergeMeta` (→ `branch`, `base_sha`, **`merged_at`**) + `fetchMergeCommitDiff(merge_sha)` (→ `diff_hash`) → `deriveAnchorId({repo, issueRef, diff_hash})` → `recordAttestation({... captured lesson_signature, built_by:'captured-promote', approval_hash: sha256('operator-vouched:'+anchor_id), emitted_at })` → `mintWorldAnchoredNode({anchor_id, merge_sha, lesson_signature, lesson_body})`. Node-only → `admitWorldAnchorNode` refuses `no-authenticated-edge` → **weight 0**; `LIVE_SOURCES` stays `Object.freeze([])`.
- **`emitted_at` = the gh-reported `merged_at`** (FAIL #3 fix — NOT a wall-clock `Date()`): `emitted_at` is in `ATT_FIELDS` → the attestation `content_hash`, so a wall-clock value makes a crash-retry a PERMANENT collision-reject (not a clean dedup). `merged_at` is retry-stable + gh-anchored (exactly `runRecordManualMerge`'s fix, cli.js:517-522). A null `merged_at` → `skip` (`no-merged-at`, anomalous).
- **Idempotent re-poll (now correct)**: pass 2 re-lists `merged`, so a crash between the `merged`-advance and the mint is RETRIED; `mintWorldAnchoredNode` + `recordAttestation` dedup on content (same `merged_at`/`diff_hash` → same body → clean dedup, no divergent collision); the queue's legality guard rejects a repeat `merged → minted` (no double-advance). A `minted` entry is in neither swept state.
- **Isolation** — all lab stores derive their subdir from `LOOM_LAB_STATE_DIR` natively (queue, anchor, live-recall, live-pending). `promoteMergedEntries` takes `{ ghRunner? }` + an OPTIONAL test-seam dir bundle that is **all-or-nothing** (0 = production/all-real, or the full set) — mirroring `mintFromMergeOutcome`'s FOLD-B guard so a partially-isolated test can never cross-write real `~/.claude/lab-state`.
- **SHADOW / weight-0**: node-only mint (admit-refused); gh reads read-only; NO arming, NO PR emit, NO signer, NO kernel join-key read (Option A untouched). Captured `lesson_body` is untrusted model prose but weight-INERT (zero trusting readers) — the accepted #273 residual.
- **File split** (`promoteOneInFlight` + `promoteOneMerged` extracted from the sweep) keeps `merge-promote.js` < 800 lines / functions < 50 (mirrors `runRecordManualMerge`'s own `validate`/`fetchEvidence` extraction).

## Runtime Probes (verified against the tree 2026-07-14)

| Claim | Probe | Result |
|---|---|---|
| the weight-0 mint primitive exists | `grep mintWorldAnchoredNode live-recall-store.js` | `:213` (node-only mint) |
| a node-only mint is admit-refused → weight 0 | `grep no-authenticated-edge admit-world-anchor-node.js` | `:121` refuse `no-authenticated-edge` |
| the captured-lesson join is on `candidate_patch_sha` | read `resolveCapturedSignatureForAttest` world-anchor-mint.js:559-589 | joins `(repoSlug, issue_ref, candidate_patch_sha)` → `lesson_signature` |
| join-key-free gh verify + merge-commit diff exist | `grep verifyMerge\|fetchMergeCommitDiff gh-verify.js` | both present (Phase-1 record-manual-merge uses them) |
| the Wave-A queue carries the join inputs | `solve-queue-fold.js` EVIDENCE_FIELDS | `candidate_patch_sha`, `pr_url`, `pr_number`, `merge_sha` present |
| no existing poller to duplicate | `grep -rlE "in_flight\|merge.?poll" packages/lab \| grep -v solve-queue` | none |
| Option A needs the armed join-key | read `runMergeObserve` merge-observer.js:78-84 | `resolveJoinKeyForPr` fail-closes `no-join-key` (armed-emit-only) |
| live_pending has a full-path reader DAM (FAIL #2) | `grep -n allowlist live-pending-store-shadow.test.js` | admits only `world-anchor-mint.js` + `live-expiry.js` → merge-promote must NOT import live-pending-store; source via the world-anchor-mint export |
| `resolveCapturedSignatureForAttest` returns sig-ONLY | read world-anchor-mint.js:566-589 | returns `{ok, lesson_signature}` — no body; must be EXTENDED to add `lesson_body` (`byPatch[0].lesson_body` in hand) |
| `recordAttestation` needs all 11 ATT_FIELDS incl. `emitted_at` (FAIL #3) | read `ATT_FIELDS`/`content_hash` world-anchor-store.js | 11 non-nullable fields; `emitted_at` in `content_hash` → must be gh `merged_at` (retry-stable), so `fetchPrMergeMeta` is required (branch/base_sha/merged_at) |

## Phases

#### Phase 0: the DAM-safe body seam (Files: 1 modify + 1 test, Risk: medium)
0. Extend `resolveCapturedSignatureForAttest` (world-anchor-mint.js) to also return `lesson_body` (additive; the exact-one join unchanged). Update its test to assert `lesson_body` is returned + the exact-one gate still holds. This keeps `merge-promote.js` off the live-pending reader dam.
   - Probe: the world-anchor-mint test green; `grep require live-pending-store merge-promote.js` → absent (later).

#### Phase 1: TDD — the promotion contract (Files: 1 NEW test + 1 NEW impl, Risk: high)
1. `merge-promote.test.js` FIRST, seeding a `live_pending` capture + queue entries + an injected gh-runner. Assert:
   - **merged `in_flight` → weight-0 node minted + entry `minted`** (assert `admitWorldAnchorNode` refuses `no-authenticated-edge` / `production_inert`).
   - **the TWO-STATE sweep RESUMES a stranded `merged` entry** (seed an entry already in `merged` with no node yet → the sweep mints it) — the FAIL-#3 fix.
   - **not-yet-merged → left `in_flight`**; **gh-unverifiable → left `in_flight`**, both observable.
   - **merged but no captured lesson → left `merged` + observable `no-captured-lesson`, no mint** (fail-closed at-the-solution-path).
   - **idempotent re-poll: a second sweep re-mints the SAME node (clean dedup, `emitted_at=merged_at`) and does NOT double-advance** (the legality guard rejects a repeat `merged→minted`).
   - **`bad-pr-url` + `repo-mismatch` are named skips** (batch continues); a per-entry `{ok:false}` is routed to `skipped`/`errors`, never aborts the sweep.
   Then `merge-promote.js` to green it.
   - Probe: `LOOM_LAB_STATE_DIR=$(mktemp -d) node tests/unit/lab/solve-queue/merge-promote.test.js` → all green.

#### Phase 2: The CLI arm (Files: 1 modify + test, Risk: low)
2. `cli.js` `promote` subcommand (one sweep, JSON summary `{ok, merged, minted, skipped, errors}`); a cli.test case.
   - Probe: `node cli.js promote` on a no-in_flight/no-merged queue → clean JSON `{ok:true, minted:[], ...}`.

#### Phase 3: README + gates (Files: 1 modify, Risk: low)
3. README promote section (two-state sweep, merged→minted, SHADOW/weight-0); lab suite + eslint + markdownlint + signpost.

## Verification Probes

| Probe | Pass criterion |
|---|---|
| 1 | `merge-promote.test.js` green under isolated `LOOM_LAB_STATE_DIR` |
| 2 | the minted node is **weight 0** (assert `admitWorldAnchorNode` refuses `no-authenticated-edge`; `production_inert`) |
| 3 | merged-but-no-capture leaves `merged` + emits `no-captured-lesson` (fail-closed at-the-solution-path) |
| 4 | re-poll is idempotent (no double-mint, no illegal double-advance) |
| 5 | merge-before-mint ordering: a forced mint failure leaves a resumable `merged` entry |
| 6 | `bash install.sh --hooks --test` green AND full lab suite green; eslint + markdownlint + signpost clean |

## Out of Scope (Deferred)

- **Option A** (the join-key/armed path) — the eventual real trust chain, gated behind arming.
- **The `live-solve-one → queue` auto-wire** (solve records `candidate_patch_sha` into the entry at `drafted`) — Wave B operates on entries populated by the operator (`advance --candidate-patch-sha`, Wave-A CLI) or that future wire; the promotion is testable in isolation with a seeded capture.
- **Wave C** (persona-carry as a non-identity pin).
- **A scheduler/cron** driving the sweep — Wave B is a single-sweep function + CLI; the operator/cron cadence is separate (operator-gated).
- **Operator-only / never Claude**: PR emit; arming; the authenticated signed-edge minter (item 5).

## Drift Notes

- route-decide `root` on an architect-shaped mint+gh task (score 0, stakes/audit lexicon miss) — the recurring substrate-meta catch-22; escalated by the `/verify-plan` gate.
- The A-vs-B fork is the load-bearing design call; documenting it (not silently picking B) keeps the future arming path legible.

## Pre-Approval Verification

Two lenses (`/verify-plan`, 2026-07-14), both **NEEDS-REVISION** with two agreed crux FAILs. All folded in above; dispositions:

### Architect (design)

- **1 A-vs-B fork — PASS.** Option A genuinely needs the armed join-key (`merge-observer.js:78-79` fail-closes `no-join-key`); Option B stays weight-0 (`LIVE_SOURCES` frozen-empty + `no-authenticated-edge` refuse). Framing accurate.
- **2 Queue-advance ordering — FLAG.** **Fixed**: the two-state sweep makes `merged` resumable; a persistent no-capture stays observably `merged` (human-disposable via `disposed`), not a silent dead-end.
- **3 Idempotent re-poll — FAIL (crux).** **Fixed**: sweep `in_flight` ∪ `merged`; pass 2 re-lists `merged` and retries the mint (my "re-poll re-mints" claim was wrong — the poller never re-listed `merged`).
- **4 Capture-sourcing (body) — FAIL.** **Fixed**: extend `resolveCapturedSignatureForAttest` (the sole dam-admitted reader) to return `lesson_body`; `merge-promote.js` never imports live-pending-store. Dam allowlist + body-availability probed firsthand.
- **5 SHADOW-safety — FLAG** (the dam breach). **Fixed** by #4.
- **6 Scope honesty — PASS.** Deferring the `live-solve-one → queue` auto-wire is legitimate (Wave B is testable with a seeded capture).
- **7 Runtime probes — FLAG** (un-probed body-sourcing). **Fixed**: added the reader-dam + sig-only-return + 11-field/`emitted_at` probes; probed the dam live.
- **8 Open design — FLAG.** **Fixed** by the two-state sweep (#3) + the body export (#4).
- Verdict: NEEDS-REVISION → resolved.

### Code-reviewer (foot-guns)

- **1 Per-entry isolation — FLAG.** **Fixed**: each reused-primitive `{ok:false}` is routed to `skipped`/`errors` (typed shapes), never a thrown abort; the lock-contention batch-degraded mode is named.
- **2 `merged`-stranded window — FAIL (crux).** **Fixed** by the two-state sweep (same as architect #3).
- **3 `emitted_at` footgun — FLAG.** **Fixed**: `emitted_at = gh merged_at` (retry-stable), so a crash-retry dedups cleanly instead of a permanent collision-reject; needs `fetchPrMergeMeta`.
- **4 gh-runner + dir injection — FLAG.** **Fixed**: `LOOM_LAB_STATE_DIR`-rooted native subdirs + an all-or-nothing test-seam dir bundle (mirrors FOLD-B).
- **5 Reuse / missing meta fields — FAIL (load-bearing).** **Fixed**: `fetchPrMergeMeta` added (branch/base_sha/merged_at); body via the new export; compose the primitives (shared-tail DRY extraction named as a deferred follow-up, not a cli.js refactor in this wave).
- **6 Input robustness — FLAG.** **Fixed**: `bad-pr-url` (try/catch `parsePrUrl`) + `repo-mismatch` named skips.
- **7 Function/file size — PRINCIPLE.** **Fixed**: `promoteOneInFlight` + `promoteOneMerged` extracted.
- **8 Scope creep — confirmed.** **Fixed**: `world-anchor-mint.js` added to Files To Modify.
- Verdict: NEEDS-REVISION → resolved.

**Resolution**: both crux FAILs closed (two-state resumable sweep; dam-safe body export), the `emitted_at`-collision footgun pinned to `merged_at`, and the mint's 11-field attestation completed via `fetchPrMergeMeta`. The Phase-1 TDD contract now encodes the `merged`-resume, no-capture-fail-closed, idempotent-re-poll, and `bad-pr-url`/`repo-mismatch` behaviors. Ready to build on approval.

## VALIDATE result — BUILT (2026-07-14)

Built TDD-first (Phase 0 world-anchor-mint +1; merge-promote 8 + cli 9; full lab suite 164/0; eslint + signpost + markdownlint clean). A CI dam caught a design gap the plan missed, and the 2-lens VALIDATE re-probed the built mint path (Rule 2a).

- **CI dam finding (build-time): the mint touched the dam-guarded stores from `solve-queue/`.** `world-anchor-store` + `live-recall-store` may only be imported from within `packages/lab/world-anchor/` (`shadow-import-graph.test.js`). **Fixed**: extracted the attest+mint into a NEW `packages/lab/world-anchor/mint-captured-merge.js` (inside the dir); `merge-promote.js` (solve-queue/) delegates to it + owns only the queue + the join-key-free `verifyMerge`. A genuine improvement (the mint belongs in world-anchor/).
- **2-lens VALIDATE: PASS-with-nits, no CRITICAL/HIGH.** The core safety (node is weight-0 / `admit`-refused; `LIVE_SOURCES` frozen; clean idempotent dedup; batch isolation survives a mid-sweep throw; no arming/emit/signer/join-key/dam-leak) was PROVEN by live probes, not asserted. Fixed:
  - **M1 [hacker MED]**: the Wave-B mint dropped the frozen-taxonomy gate its sibling enforces (an off-taxonomy signature from a forged capture could seat into `recall-graph-live`, breaking a freeze invariant). **Fixed**: `isCanonicalLessonSignature` gate → `off-taxonomy-lesson` refuse, parity with `mintFromMergeOutcome`.
  - **M2 [both MED]**: pass 2 had no `repo` cross-check (pass 1 did) — a `merged` entry with an attacker `pr_url` drove the mint's repo from the URL (bounded: 404 fail-closed, no SSRF). **Fixed**: pass-2 `parsed.repo === e.repo` skip + a regression test.
  - **L1 [hacker LOW]**: `no-merged-at` (+ the mint-layer refuses) failed SILENT. **Fixed**: observable `emitEgressAlert` on the module-originated refuses.
  - **Test gap [code-reviewer]**: the idempotency test proved "terminal entry left alone", not the crash-window re-mint. **Fixed**: a direct double-`mintCapturedMerge` dedup test (same `node_id`).
  - **Deferred (weight-inert forward-hazards, noted)**: L2 (a gh-field drift — `branch`/`base_sha` rename between a crash and retry — stalls the entry in `merged` with an `attest-collision`; gh freezes these post-merge, so realistically stable) and L3 (a captured `lesson_body` carries control chars verbatim into the node; scrubbed at capture + data-not-instructions downstream; a node-boundary control-char gate is a future arming-time hardening).

Verdict: SHIP. The mint is proven weight-0 + SHADOW; the freeze-invariant + two-guard-repo gaps are closed before any consumer reads the lane.
