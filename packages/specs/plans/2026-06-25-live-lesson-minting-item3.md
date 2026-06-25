# Plan: Live lesson minting (autonomous-SDE ladder item 3)

## Context

The substrate can ACT (it emitted a real external PR, spec-kitty#2137, **MERGED 2026-06-25T12:47:36Z, mergeSHA `d91785ea`** — the first world-anchored merge) but cannot yet LEARN from a world merge: `record-merge` records a confirmation sidecar and stops, minting no recallable lesson (`world-anchor/cli.js:83-85`). Item 3 closes that wire: when a world-anchored PR merges, mint a recallable `world_anchored`-provenance lesson into a physically separate, SHADOW (weight-inert) live store, with the recorded `merged` confirmation as the eligibility signal.

**Scope honesty (north-star):** item-3-MVP mints a lesson that is **orchestrator-authored** (now GROUNDED in the merged diff, not hand-guessed — see D8) and keyed to a real, gh-verified merge confirmation. It does NOT yet auto-DERIVE the lesson from the world (the issue→lesson classifier is item 4). This MVP is "a world-grounded lesson anchored to a real merge" — a NARROWING of where trust *could* attach, NOT the substrate autonomously learning. (VERIFY honesty F6.)

**Scope decision (post-VERIFY + post-merge):** confirmation-mint-only. The draft-time candidate-capture was DROPPED from the MVP — VERIFY (architect + honesty, independently) found it has no MVP consumer until item 4's classifier, and the hacker (H2) found it adds a forgeable-join attack surface; the real first lesson comes from #2137's direct confirmation-mint (it was manually emitted, no candidate). The candidate→promotion design moves to item 4. (Dropped: `candidate-lesson-store.js`, the `captureFn` seam, old Phase 3.)

## Routing Decision

Verbatim `route-decide.js` output (escalated by judgment, see below):

```json
{
  "task": "Build live lesson minting (ladder item 3): captureLessons in the live draft loop, a live/world_anchored provenance enum, a live recall store, and an oracle-free eligibility path so a world-anchored merge confirmation mints a recallable lesson.",
  "recommendation": "root",
  "score_total": 0,
  "confidence": 0.4,
  "signals_matched": [],
  "substrate_meta_detected": false,
  "weights_version": "v1.3-dict-expanded-2026-06-12"
}
```

**Escalation rationale**: the scorer returns `root` because lab/substrate work that writes to the recall/weight substrate carries no `stakes` lexicon token (a known scorer blind spot, MEMORY). This is genuinely architect-shaped: a one-way-door provenance value, a new content-addressed trust store, and #273-family security implications (a `world_anchored` node that any weight consumer could read is inflatable by a same-uid co-forge). Escalated to the full per-wave workflow (3-lens VERIFY before build; 3-lens VALIDATE after).

## HETS Spawn Plan

This is data-mutation + #273-family, so the review/verify passes fan out the full 3-lens tier (read-only personas).

| Persona | Role | Lens | When |
|---|---|---|---|
| architect | design soundness, the candidate→promotion + store-separation shape | design | VERIFY (pre-build) |
| hacker | adversarial: can a `world_anchored` node be minted/co-forged without a real merge; can a live node reach a weight | adversarial-security | VERIFY (design) + VALIDATE (re-probe BUILT code, Rule 2a) |
| honesty-auditor | claim-vs-evidence: is "shadow/inert" actually enforced structurally; is the seed lesson honest | claim-vs-evidence | VERIFY + VALIDATE |
| node-backend | the build (delegated) | build | BUILD (TDD) |

## Runtime Probes (firsthand-verified, 2026-06-25)

| Claim | Probe | Result |
|---|---|---|
| recall-graph-store is hard-wired to ONE provenance; a `world_anchored` node would be rejected | read `recall-graph-store.js:56,76` | `writeNode`/`verifyNode` reject `node.provenance !== PROVENANCE` (the single `backtest` const, `:36`); default dir `recall-graph-backtest` (`:39`). CONFIRMED: cannot reuse this store for live nodes. |
| `record-merge` stops at the confirmation, mints no lesson | read `world-anchor/cli.js:71-85` | `runRecordMerge` ends at `recordConfirmation` (`:83-85`); `buildWorldAnchorLesson` only called in `backfill2137` (`:112`), which extracts only `lesson_signature`. CONFIRMED gap. |
| the SHADOW boundary is structural: no outside module imports `world-anchor-store`; siblings may | read `tests/unit/lab/world-anchor/shadow-import-graph.test.js:62-70` | the test greps `packages/` and asserts zero offenders outside `world-anchor/` (`:65` exempts siblings). CONFIRMED: mint wire belongs inside `world-anchor/`. |
| the anchor identity (repo, issueRef, diff) is available at draft time | read `live-draft-run.js:156` | `emitFn({ repo: ref.slug, issueRef: ref.issueRef, diff: solveRes.candidate })` — all three in hand; `ok:true` outcome at `:174` is the capture point; `deps.*Fn` seam at `:185-189`. CONFIRMED. |
| `buildWorldAnchorLesson` constructs only, persists nothing, stamps no provenance | read `world-anchor/lesson.js:29-54` | returns `{lesson_signature, lesson_body}`; no store write, no provenance. CONFIRMED reuse-as-builder. |
| the taxonomy is frozen append-only; the seed maps cleanly | read `lesson.js:18-20,58-65` + `causal-edge/lesson-signature.js` | imports frozen `TRIGGER_CLASS`/`GOTCHA_CLASS`/`CORRECTIVE_CLASS`; seed = `boundary-contract\|unguarded-edge-case\|handle-edge-explicitly`. CONFIRMED: map into, never extend. |
| the seed lesson body is STALE/WRONG | read `lesson.js:62-64` | body literally reads "preferring python (honors venv/pyenv) then python3" — orders bare `python` first, the python2-on-bare-host trap. Corrected from the merge (D8). |
| spec-kitty#2137 is MERGED; the merged fix is `uv run pytest` | `gh pr view 2137` + `gh api .../contents/run_tests.sh?ref=d91785ea` | state `MERGED`, mergedAt `2026-06-25T12:47:36Z`, mergeSHA `d91785ea`, file `run_tests.sh`; merged content = `uv run pytest tests/ "$@"` (delegate to the canonical runner). The world signal. |

## Design decisions (folded with VERIFY findings)

- **D1 — provenance token `world_anchored`** (NOT `live`): the corpus comment reserves `'live'` for the v3.10 verdict-record meaning (`corpus.js:47`); `world_anchored` is distinct and names WHY the node is trusted. Defined as a constant in the NEW live store, NOT added to the backtest corpus enum (the backtest firewall stays untouched).
- **D2 — physically separate live store**: new `packages/lab/world-anchor/live-recall-store.js`, dir `recall-graph-live/` (sibling to `recall-graph-backtest/`). Content-addressed; own `deriveLiveNodeId` over the anchor basis (do NOT import `recall-graph.js`'s `deriveNodeId` — the basis differs; reuse ONLY `lessonClusterKey`/enums from `causal-edge`, per VERIFY architect F5). **Read-path template = `world-anchor-store.js`, NOT `recall-graph-store.js`** (hacker M2: `recall-graph-store.js:162` does a bare `readFileSync` with no size cap / no `O_NOFOLLOW` — the #439 DoS antipattern). So: `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` + fstat-same-fd + `st.size > MAX_RECORD_BYTES` reject BEFORE read; full-body `content_hash` seal; verify-on-read+write. The backtest lane is NOT modified.
- **D3 — mint wire inside `world-anchor/`**: `cli.js record-merge` (outcome `merged` only) resolves the anchor, builds the lesson **from the verified attestation**, then mints a `world_anchored` node via the new store. Lives inside `world-anchor/` so it may import the store + builder without tripping the shadow dam (acyclic: `recall-graph` does not import `world-anchor/`).
- **D4 — eligibility = a recorded `merged` confirmation (integrity-checked, NOT an oracle)** [RELABELED per hacker C1 + honesty F4]: a `world_anchored` node is minted ONLY when a confirmation with `outcome === 'merged'` (exact-string, not subset) exists for the anchor; `closed`/`stale` mint nothing. **The `merged` confirmation is a SELF-ASSERTED, co-forgeable field (integrity-checked, like `built_by`), NOT an oracle** — a same-uid writer can co-forge the attestation+confirmation. Tolerable ONLY because the node is weight-inert (D5). The path to a GENUINE oracle: the human-invoked `record-merge --merge-sha <sha>` carries the gh-verified merge commit (for #2137: `d91785ea`), recorded on the node as world-evidence; full authentication is item 5 (the signed minter). The lesson body/identity at mint derives from the **content_hash-sealed attestation** (`world-anchor-store.js:145`), never an open-writable candidate.
- **D5 — SHADOW/INERT rests on TWO dams** [folded per hacker H1 + honesty F5]:
  - (a) the **source-admission firewall**: `LIVE_SOURCES` stays `Object.freeze([])` and no production `buildRankingWeights`/`admitWeightForRanking` driver is wired; the weight gate keys on a node's `source` token, NOT its `provenance` (`item-source.js:35`), so `world_anchored` provenance can never become an admitted weight source.
  - (b) the **import-graph dam**: extend `shadow-import-graph.test.js` to also forbid outside imports of `live-recall-store` (a SEPARATE basename matcher — the existing `IMPORT_RE` at `:47` is `world-anchor-store`-specific and would pass vacuously otherwise).
  - **The REAL live-consumer firewall is `recall-graph-store.js:56`** (it provenance-rejects any non-`backtest` node even when pointed at a live dir). Add a non-vacuous test: plant a `world_anchored` node in `recall-graph-live/`, assert `recall-graph-store.listNodes` skips it AND `grounding-slice.js:130` returns `''`. Opening either dam is item 5.
- **D6 — DROPPED (deferred to item 4)**: the draft-time candidate-capture + `candidate-lesson-store.js` + the `captureFn` seam are NOT built this wave (VERIFY architect F2 + honesty F7: no MVP consumer; hacker H2: forgeable join). Confirmation-mint-only. The candidate→promotion design moves to item 4's plan, where the classifier consumes it.
- **D7 — seed is orchestrator-authored, GROUNDED in the merge**: the MVP lesson is `LESSON_2137`, its body finalized from the merged diff (D8). The automatic issue→lesson classifier is item 4.
- **D8 — finalize the seed body FROM the merge** [folded per honesty F3, now resolved by the real merge]: the merged `run_tests.sh` at `d91785ea` is the `uv run pytest` revision (delegate to the canonical runner, NOT interpreter-guessing). Rewrite `LESSON_2137.lesson_body` to that world-grounded learning: a host shell test-runner invoking a bare interpreter (`python`) is unsafe (absent on python3-only hosts; or resolves to python2 below requires-python); the merged fix delegates to the project's canonical runner (`uv run pytest`), honoring the declared test authority (Makefile/CONTRIBUTING). The mint records the merge SHA as world-evidence.
- **M1 — fail-closed mint refuses are OBSERVABLE**: every new mint-refuse path (non-`merged` outcome, attestation/confirmation absent, verify-on-write fail, over-bound body, mismatch) emits a reason-bearing `emitEgressAlert` — parity with `world-anchor-store.js:266,301`. Non-vacuous test: plant a mismatch, assert the alert fires.

### #273 honest residual

The `world_anchored` node's provenance is SELF-ASSERTED; the store proves INTEGRITY, not PROVENANCE (a same-uid process can co-forge a byte-consistent node + the world-anchor ledger it derives from — hacker C1). This is tolerable in item 3 ONLY because the node is weight-INERT (the two dams, D5). The authenticated edge minter (item 5) is the prerequisite before any `world_anchored` node may gate a weight. The gh-verified merge SHA (D4) is world-evidence, not authentication. Documented, not closed here.

## Files To Modify

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/lab/world-anchor/live-recall-store.js` | create | high | new content-addressed live-node store; read-path templated on `world-anchor-store.js` (D2/M2); own `deriveLiveNodeId` |
| `packages/lab/world-anchor/cli.js` | modify | high | `record-merge --outcome merged` mints from the verified attestation; add `list-live`; observable refuses (M1) |
| `packages/lab/world-anchor/lesson.js` | modify | medium | finalize `LESSON_2137` body from the merged diff (D8) |
| `tests/unit/lab/world-anchor/shadow-import-graph.test.js` | modify | medium | extend the dam to `live-recall-store` (separate matcher) + the real-firewall assertion (D5) |
| `tests/unit/lab/world-anchor/live-recall-store.test.js` | create | low | mint + verify-on-read/write + size-cap (70KB plant rejected before read) + O_NOFOLLOW |
| `tests/unit/lab/world-anchor/cli.test.js` | modify | low | merged→mints; closed/stale→nothing; mint derives from attestation; refuse emits |
| `tests/unit/lab/world-anchor/recall-graph-store-rejects-live.test.js` | create | low | the REAL firewall: `recall-graph-store`/`grounding-slice` reject a planted `world_anchored` node (non-vacuous) |

## Phases

#### Phase 1: The live store (TDD; Files: 1 NEW + 1 NEW test, Risk: high)
1. **Write `live-recall-store.test.js` FIRST** (the behavioral spec): a `world_anchored` node round-trips; verify-on-read rejects an in-place edit (full-body seal); a 70KB plant is rejected before read (`st.size` cap); an `O_NOFOLLOW` symlink is refused; a node whose body does not re-derive its id/content_hash is rejected (write + read).
   - Probe: `node tests/unit/lab/world-anchor/live-recall-store.test.js` → fails (no impl yet).
2. **Build `live-recall-store.js`** to pass: `mintWorldAnchoredNode(block, {dir})`, `readLiveNode`, `listLiveNodes`, `deriveLiveNodeId`; `WORLD_ANCHORED = 'world_anchored'`; dir `recall-graph-live/`; read-path templated on `world-anchor-store.js` (NOT recall-graph-store — M2). Mint refuses emit `emitEgressAlert` (M1).
   - Probe: store test green; `grep -c "O_NOFOLLOW\|st.size\|content_hash\|emitEgressAlert" live-recall-store.js` ≥ 4.

#### Phase 2: The merge→mint wire in cli.js (TDD; Risk: high)
1. **Extend `cli.test.js`**: `record-merge --outcome merged` mints exactly one live node, its lesson identity derived from the VERIFIED attestation (content_hash-sealed), never a caller field; `closed`/`stale`/un-attested/ambiguous mint NOTHING and EMIT (fail-closed, observable). Finalize `LESSON_2137` body from the merged diff.
2. **Modify `cli.js`**: after `recordConfirmation` ok AND `outcome === 'merged'`, build the lesson from the attestation's sealed fields and call `mintWorldAnchoredNode`; record `--merge-sha` as world-evidence. Add `list-live`. Fix `LESSON_2137` body (D8).
   - Probe: `record-merge --outcome merged` on a temp dir → exactly one `recall-graph-live/` node; `--outcome closed` → zero + an emitted reason.

#### Phase 3: The structural SHADOW dams (Risk: medium)
1. **Extend `shadow-import-graph.test.js`**: a SEPARATE matcher asserts no module outside `world-anchor/` imports `live-recall-store`; plant an outside import → fails RED (non-vacuous), then revert.
2. **New `recall-graph-store-rejects-live.test.js`** (the REAL firewall): plant a `world_anchored` node in `recall-graph-live/`; assert `recall-graph-store.listNodes` skips it AND `grounding-slice` returns `''`; assert `LIVE_SOURCES` is still `Object.freeze([])` and no new code references `buildRankingWeights`/`admitWeightForRanking`.

## Verification Probes

| Probe | Pass criterion |
|---|---|
| 1 | full kernel + lab world-anchor suites green: `find tests/unit/lab/world-anchor -name '*.test.js' -print0 \| xargs -0 -n1 node` |
| 2 | `record-merge --outcome merged` on a temp dir → exactly one `recall-graph-live/` node; `--outcome closed` → zero + an emitted reason (M1) |
| 3 | verify-on-read rejects an in-place body edit; a 70KB plant rejected before read; `O_NOFOLLOW` symlink refused (firsthand plant, non-vacuous) |
| 4 | shadow-import-graph: planted outside import of `live-recall-store` fails RED, then reverts (non-vacuous dam) |
| 5 | REAL firewall: a `world_anchored` node planted in `recall-graph-live/` is skipped by `recall-graph-store.listNodes` AND `grounding-slice` returns `''` |
| 6 | the minted lesson identity derives from the content_hash-sealed attestation, NOT a caller field (hacker H2 fold) |
| 7 | `bash install.sh --hooks --test` → all green; eslint 0 / markdownlint 0 / SIGNPOST regen for the new `.js` module |
| 8 | the seed `LESSON_2137` body matches the merged diff (`d91785ea`, `uv run pytest`/canonical-runner); records the merge SHA |
| 9 | `LIVE_SOURCES` is still `Object.freeze([])` and no new code references `buildRankingWeights`/`admitWeightForRanking` (two-dam inertness) |

## Out of Scope (Deferred)

- **Opening `LIVE_SOURCES` / wiring a ranking driver** — ladder item 5 (authenticated edge minter). A `world_anchored` node stays weight-inert until then (D5).
- **Automatic issue→lesson taxonomy classifier** — item-4-adjacent; MVP seed is orchestrator-authored (D7).
- **The issue→persona classifier + prompt materializer** — ladder item 4.
- **MV-W4 interleaver + reputation/breaker → spawn-select** — ladder item 6.

## Drift Notes

- **Drift-note A**: route-decide returned `root` (score 0) for genuinely architect-shaped lab work — the `stakes` lexicon still has no token for "writes to the recall/weight substrate." Recurs (MEMORY notes it); a dictionary-expansion candidate, but escalation-by-judgment is the documented fallback.
- **Drift-note B**: the original item-3 spec said "captureLessons in the live draft loop" — but the loop produces dry-run DRAFTS, not merges. Surfaced at recon that `world_anchored` provenance must come from the merge confirmation, not the draft. After VERIFY (candidate-capture = no MVP consumer + a forgeable join) the MVP narrowed to confirmation-mint-only; the candidate→promotion design moved to item 4. Pattern: a one-line ladder item can encode a subtle correctness error AND speculative scope that only firsthand recon + a VERIFY pass surface.
- **Drift-note C** [corrected per honesty F2]: the seed body (`LESSON_2137`) shipped in #439 (`world-anchor-ingress-mvp.md:74-76`) DELIBERATELY encoded a host-interpreter resolver that prefers bare `python` — wrong on AUTHORSHIP, blessed by the internal 3-lens VALIDATE, and flagged only by the EXTERNAL maintainer. This is NOT status-decay (the body was never once-correct-then-stale); it is a first-authoring error the internal lenses structurally could not catch. The world-anchored-lens proof, again: the merged diff (`d91785ea`, `uv run pytest`) is the corrected learning — derived from the world, not re-guessed.
- **Drift-note D**: route-decide returned `root` (score 0) for genuinely architect-shaped lab work, then the full 3-lens VERIFY found 1 CRITICAL-relabel + 2 HIGH + 3 MEDIUM folds on the `root`-scored plan. Reinforces the MEMORY note that the `stakes` lexicon underweights "writes to the recall/weight substrate"; escalation-by-judgment paid for itself.

## Pre-Approval Verification (3-lens VERIFY, 2026-06-25)

All three lenses returned **APPROVE-WITH-FOLDS** (no NEEDS-REVISION; design sound, folds are hardening + framing, none build-blocking). Folds applied to the plan above.

| Lens | Persona | Verdict | Load-bearing findings (folded) |
|---|---|---|---|
| design | architect | APPROVE-WITH-FOLDS | F1 anchor-basis mismatch (mooted by dropping candidate); F2 candidate = YAGNI (dropped → confirmation-mint-only); F3 store separation correct; F5 own `deriveLiveNodeId` not recall-graph's |
| adversarial-security | hacker | APPROVE-WITH-FOLDS | C1 "oracle" relabel (merge = self-asserted, integrity≠provenance); H1 dam guards wrong module → assert the REAL firewall (`recall-graph-store.js:56` + grounding-slice); H2 derive lesson from the sealed attestation, not the candidate (mooted by drop); M1 observable refuses; M2 read-path templated on world-anchor-store not recall-graph-store |
| claim-vs-evidence | honesty-auditor | APPROVE-WITH-FOLDS (grade B) | F6 Context = NARROWING not HARDENING (folded); F2 drift-note C = first-authoring error not status-decay (folded); F3 seed fix un-probed → now GROUNDED in the real merge diff; F5 two-dam inertness named |

**Net scope change**: confirmation-mint-only (candidate-capture deferred to item 4) — dissolved hacker H2 + architect F1/F2 + honesty F7 at once. **Disposition**: APPROVED for build (per-wave workflow: TDD build → 3-lens VALIDATE with the hacker re-probing the BUILT code, Rule 2a).
