# Plan: World-Anchor Ingress MVP (the merge -> internal-confirmation return wire)

Status: PLANNING (pre-VERIFY). Wave 1 of the autonomous-SDE ingress ladder
(`packages/specs/research/2026-06-25-autonomous-sde-lifecycle-gap.md`). Lifecycle: persistent until the wave closes.

## Goal (and the honest scope boundary)

Make a maintainer MERGE of an emitted PR land as a REAL internal world-anchored confirmation, attached to a real
lesson, so the autonomous-SDE loop closes on real-world data for the first time. Concretely: when spec-kitty#2137
merges, the operator runs one CLI and the substrate records a verified merge-outcome that confirms the #2137 lesson.

**Observe-first, SHADOW (load-bearing honesty boundary).** This wave does NOT move any production weight. Per the
audit + #273 (a store proves INTEGRITY, not PROVENANCE: an open-writable confirmation is co-forgeable by anyone who
can write the store), actually moving a ranked weight requires the AUTHENTICATED edge minter + a `LIVE_SOURCES` token,
which are a deliberately-deferred later wave (ladder item 5). This wave RECORDS the world-anchored signal honestly and
keeps it advisory. "Something hardens" here means: the first real world-anchored signal lands internally and confirms a
real lesson, observe-first. It is the genuine loop-closing milestone, not a weight change. We will not overclaim it.

## Routing decision

`route` (substantive, multi-file, trust-substrate-adjacent, #273-adjacent). VERIFY board warranted (architect +
hacker + honesty). Not `root`.

## Runtime probes (grounded against the tree, 2026-06-25)

- Lab state base: `process.env.LOOM_LAB_STATE_DIR || ~/.claude/lab-state` (`recall-graph-store.js:38`). The new store
  lives under `$LAB_STATE_BASE/world-anchor/`, a NEW dir, NOT touching `recall-graph-backtest/`.
- The recall-graph already reserves `live` provenance in the `node_id` basis (`recall-graph.js:28-29,104-110`) so a
  backtest/live pair never collides, but `ENUMS.provenance = ['backtest']` only and the store rejects non-backtest
  (the OQ-7 dam). => This wave does NOT extend that enum or store; it uses a separate ledger. Opening the live recall
  lane is ladder item 3/5, deferred.
- The lesson taxonomy is frozen: `lessonClusterKey(TRIGGER_CLASS, GOTCHA_CLASS, CORRECTIVE_CLASS)` + `lesson_body`
  (`causal-edge/lesson-signature.js`). The world-anchor lesson REUSES this so it is taxonomy-compatible.
- `built_by` is UNAUTHENTICATED metadata by design (`recall-graph.js:53-58`: "a faceless claude -p actor LABELED").
  For #2137 the actor was anonymous (no persona), so `built_by = 'anonymous-actor'` honestly. The persona-attributed
  case is ladder item 4, deferred.
- emitPR result shape (firsthand, this session): `{ok, emitted, draft:{repo,issueRef,diff,touched_paths}, approvalHash,
  pr:{pr_url,number,branch}}`; base commit `f853934...` (the `base-commit` in the kernel envelope). All the join-key
  data is available at/after emit.
- emitPR (`emit-pr.js`) chokepoint stays UNTOUCHED by this wave (security-critical). The attestation is written by a
  LAB-side step the loop/orchestrator calls AFTER emitPR returns. Stale comments at `emit-pr.js:20/39/51/352`
  ("armedEmit throws by construction") are FALSE (`:334` delegates to `ghEmit`, proven live #2137) and get cleaned
  here (doc-only, no behavior change), since they twice misled reviewers.

## Design: a new `packages/lab/world-anchor/` module

Three records, one content-addressed + verify-on-read store (mirroring `recall-graph-store.js` hygiene: deep-freeze,
verify-on-read, `O_NOFOLLOW` + fstat-same-fd reads, `wx` exclusive writes, dir uid+perm guard, fail-closed I/O).

1. **`world-anchor-store.js`** — the ledger under `$LAB_STATE_BASE/world-anchor/`:
   - `recordAttestation(att)`: the EMIT-time join-key. Fields:
     `{anchor_id, repo, issueRef, pr_url, pr_number, branch, base_sha, diff_hash, lesson_signature, built_by,
       approval_hash, emitted_at}`. `anchor_id` = content-address over the IDENTITY basis
     `{repo, issueRef, diff_hash}` (so the same emitted fix dedups; verify-on-read re-derives it). `lesson_signature`
     links to the lesson it claims. INTEGRITY-not-provenance: co-forgeable, SHADOW (documented residual).
   - `recordConfirmation(anchor_id, outcome)`: the MERGE-time outcome `{outcome: merged|closed|stale, merge_sha?,
     confirmed_at}` written as a SIDECAR keyed to `anchor_id` (the attestation is immutable; the confirmation is a
     separate append, never an in-place mutate). Exact-set: confirm exactly the one `anchor_id`, reject if absent.
   - `readAnchor(anchor_id)` / `listAnchors()`: verify-on-read (re-derive `anchor_id` from the body; reject mismatch).
2. **`lesson.js`** (or reuse `causal-edge/lesson-signature.js`) — the world-anchor lesson: `lessonClusterKey` +
   `lesson_body`, taxonomy-compatible. For the MVP the lesson is orchestrator-authored (future: auto-minted by the
   live `captureLessons` leg, ladder item 3). `lesson_signature` = the frozen cluster key.
3. **`cli.js`** — `record-merge --pr <url> --outcome merged|closed [--merge-sha <sha>]`: the human-invoked OBSERVER.
   Resolves the `anchor_id` via the exact `(repo, pr_number, pr_url)` tuple (exactly one matching attestation), calls
   `recordConfirmation`. Fail-closed if no matching attestation (so a merge of an un-attested PR is loudly skipped,
   not silently laundered). This is the Q1 MVP: a human-invoked world-anchored signal, no poller/webhook.

### The #2137 backfill (so the pending merge actually works)

A one-shot `backfill-2137` path (a `_spike` script or a CLI subcommand) that writes:
- the attestation for #2137 (`repo: Priivacy-ai/spec-kitty`, `issueRef: 2097`, `pr_url: .../pull/2137`,
  `base_sha: f853934...`, `diff_hash`= sha256 of the approved scrubbed diff, `built_by: anonymous-actor`,
  `approval_hash: dba8bf18...`), and
- the world-anchor lesson for the fix: trigger=`host shell script invokes bare python`,
  gotcha=`python3-only hosts (Ubuntu/Debian) lack a python symlink -> command not found`,
  corrective=`resolve the interpreter (prefer python, fall back python3), error if neither`.
Then, when the maintainer merges, `record-merge --pr <2137 url> --outcome merged` confirms it.

## Security model (the explicit residuals)

- **INTEGRITY not PROVENANCE (#273):** the ledger is open-writable, so a same-uid process can co-forge an attestation
  or a confirmation. This is TOLERATED ONLY because the ledger is SHADOW (gates no action). The authenticated minter
  (signed/kernel-writer edges) is the deferred close (ladder item 5) and is REQUIRED before any world-anchor record
  feeds `LIVE_SOURCES`. Documented as a first-class residual + a dedicated test.
- **Store hygiene (non-negotiable even in SHADOW):** verify-on-read (re-derive `anchor_id` from the body, reject a
  filename/field mismatch); `O_NOFOLLOW`+fstat-same-fd reads; `wx` exclusive writes (no symlink-follow); dir uid+perm
  guard; fail-closed on every I/O error; deep-freeze returned objects (the immutability-of-read-paths rule).
- **Exact-set confirmation:** `record-merge` confirms exactly the joined `anchor_id`; never a subset/`includes` match
  (the superset-laundering class). A PR with no attestation is REFUSED with an observable signal, never auto-created.
- **Fail-closed + OBSERVABLE:** every refuse path emits a high-visibility signal (a merge of an un-attested PR, a
  verify-on-read mismatch), so the gate's failures surface (the fail-silent-must-be-observable rule).
- **No secrets in the ledger:** the attestation stores a `diff_hash`, not the diff; reuse `scrub-lab-secrets` on any
  free-text (lesson_body).

## Wave breakdown

- **W1 (this plan):** the `world-anchor` module (store + lesson + `record-merge` CLI) + the #2137 backfill +
  the emit-pr stale-comment cleanup. TDD. 3-lens VALIDATE (code-reviewer + hacker + honesty: it is trust-substrate +
  #273-adjacent). Observe-first, SHADOW. PR for USER merge.
- **Deferred (named, NOT this wave):** live `captureLessons` on the live loop + `live` provenance lane (item 3); the
  issue->persona classifier + prompt materializer (item 4); the authenticated edge minter + `LIVE_SOURCES` token
  (item 5); MV-W4 interleaver + reputation/breaker -> spawn selection (item 6).

## HETS Spawn Plan (VERIFY board, pre-build)

Parallel 3-lens VERIFY on this plan BEFORE build:
- `architect` — is a separate ledger (vs extending the recall-graph live lane) the right call? is the
  attestation/confirmation split sound? does the observe-first/SHADOW boundary hold?
- `hacker` — co-forge surface, the join (PR->anchor) spoofing, verify-on-read bypass, the un-attested-merge laundering
  path, symlink/TOCTOU on the new store.
- `honesty-auditor` — does the plan overclaim "hardens"? is the SHADOW boundary stated honestly? is the #2137 backfill
  represented faithfully (an orchestrator-authored lesson, not an auto-derived one)?

## Open questions (for VERIFY)

1. Should the emit-attestation eventually move INSIDE emitPR (atomic, every emit attested) vs the lab-side post-emit
   call (lighter, but the orchestrator can forget)? Lean: lab-side now (observe-first), fold into emitPR with the
   authenticated minter later.
2. Is a separate `world-anchor` ledger the right home, or should the confirmed lesson eventually MERGE into the
   recall-graph `live` lane (item 3)? Lean: separate now; bridge into the recall-graph live lane when item 3 opens it.
3. `built_by` for #2137 is `anonymous-actor`; confirm that is honest + that the persona case is cleanly deferred.

## Pre-Approval Verification (3-lens board, 2026-06-25)

VERIFY board (architect + hacker + honesty-auditor), all three **APPROVE-WITH-FOLDS** (no CRITICAL, no
NEEDS-REVISION). Folds below are the build contract.

### Corrections to the design above (superseding)

- **Read-path hygiene source (hacker HIGH, factual fix):** the model is `approval-store.js:62-68`
  (`O_RDONLY|O_NOFOLLOW|O_NONBLOCK` open + `fstatSync` the SAME fd + `isForeign(st,selfUid)` reject + `isFile()`),
  NOT `recall-graph-store.js` (which reads WITHOUT `O_NOFOLLOW`). The world-anchor store read path follows approval-store.
- **The PR->anchor JOIN contract (hacker HIGH + architect MED):** the confirmation binds to `anchor_id`, never
  `issueRef` alone. `record-merge` resolves by the FULL tuple `(repo, pr_number, pr_url)` and requires EXACTLY ONE
  matching attestation (compute `missing[]`+`unexpected[]`, both empty). `>1` match (a re-emit/force-push or a planted
  decoy) => REFUSE with an observable signal, never pick one.
- **Lesson taxonomy (architect LOW + honesty MED):** the world-anchor lesson IMPORTS `lessonClusterKey` +
  `TRIGGER_CLASS`/`GOTCHA_CLASS`/`CORRECTIVE_CLASS` from `lesson-signature.js` (never re-literal). The #2137 backfill
  lesson maps to FROZEN members: `trigger_class='boundary-contract'`, `gotcha_class='unguarded-edge-case'`,
  `corrective_class='handle-edge-explicitly'`; the natural-language specifics ("a host shell script invoking bare
  `python` breaks on python3-only hosts; resolve preferring `python` then `python3`, error if neither") go in
  `lesson_body` (bounded by `LESSON_BODY_MAX=4096`).
- **Stale-comment cleanup scope (honesty LOW):** targets `emit-pr.js:20-21/:39-40/:51` (and `:255` "no live emission
  seam... doubly fail-closed"), NOT `:352` (the historically-accurate `emitPR @returns` line). Doc-only.

### Build contract (folds required)

1. **Write-path self-consistency (hacker MED):** `recordAttestation` rejects `{ok:false,reason:'self-inconsistent'}`
   if `anchor_id` does not re-derive from `{repo,issueRef,diff_hash}` (symmetric with read-path verify; mirrors
   `recall-graph-store.js:78-81`).
2. **Dedup-collision, no silent first-wins (hacker MED):** on an `anchor_id` collision, compare the FULL incoming body
   (`lesson_signature`, `approval_hash`, `built_by`) to the stored record; on ANY divergence emit an observable
   collision signal (mirror `recall-graph-store.js:106-108`), never silently keep first-eligible.
3. **One canonical observable emitter (hacker MED):** reuse `emitEgressAlert(reason, detail)` (`alert.js:22`) for ALL
   three refuse paths — `world-anchor-unattested-merge`, `world-anchor-verify-mismatch`, `world-anchor-collision` —
   with fixed reason tokens. Each gets a NON-VACUOUS test (inject the violation, assert the alert fires).
4. **Bound + scrub every free-text (hacker MED):** `lesson_body` HARD-REJECTS (not truncates) over `LESSON_BODY_MAX`,
   on BOTH write and read (a forged giant body cannot DoS verify-on-read); `scrubLabSecrets` every free-text field as
   COARSE defense-in-depth, the PRIMARY control being not echoing secrets at authorship (enforceable now, the backfill
   is orchestrator-authored).
5. **SHADOW made STRUCTURAL (architect LOW):** a header invariant in `world-anchor-store.js` ("SHADOW: no
   ranking/weight/spawn consumer may read these records until the authenticated minter + `LIVE_SOURCES` land") + an
   import-graph test asserting no module outside `world-anchor/` imports its read functions. Mirrors the OQ-7 dam's
   structural (not stamped) guarantee.

### Residuals (named, first-class)

- **INTEGRITY not PROVENANCE (#273):** the ledger is co-forgeable; SHADOW-tolerable; the authenticated minter is the
  deferred close (item 5), REQUIRED before any record feeds `LIVE_SOURCES` or the recall-graph live lane (item 3 shares
  the SAME minter prerequisite, so 3 and 5 unlock together, not independently).
- **Lab-side attestation coverage is BEST-EFFORT (architect MED):** a forgotten/failed post-emit attestation yields a
  silently-unlearnable merge. Folding the attestation INTO `emitPR` atomically (with the authenticated minter) is the
  forward-contract that converts best-effort coverage into a guarantee.
- **Re-emit ambiguity:** a force-push changing `diff_hash` but keeping `pr_number` makes the join ambiguous;
  REFUSE-on->1 handles it safely (SHADOW).

### Inline probes for the #2137 backfill constants (honesty LOW)

- `base_sha = f853934...`: `git -C ~/loom-targets/spec-kitty rev-parse HEAD` (the base the actor solved; the kernel
  envelope `base-commit`).
- `approval_hash = dba8bf18...334`: the consumed approval filename (verified this session).
- `diff_hash`: `sha256(<approved scrubbed diff>)`, re-derived at backfill from `/tmp/spec-kitty-2097.diff`
  (== the emitted PR's `run_tests.sh` patch), never hardcoded.

Verdict: **CLEAR TO BUILD** with the above folds. OQ2 strengthened: the separate ledger is REQUIRED (not merely
preferred) because opening the recall-graph live lane would breach the OQ-7 physical firewall before the authenticated
minter exists.
