# ROADMAP PLAN: Stable 5-Lesson SHADOW Bundle into Embers

**Status**: Proposed → TWO 3-lens `/verify-plan` passes (2026-07-13), both NEEDS-REVISION, both applied. The corrected design-of-record is **R1'-R7'** in the `## Pre-Approval Verification` → `### Round-2 re-verification` section at the bottom; they SUPERSEDE both the body AND the first-round R1-R7 where they conflict (marker is CLI-note-only R1'; gh fetch seated in `gh-verify.js` with `diff_hash` pinned to the merge-commit patch R2'; Wave 2b = shared canonical vector R3'; `provenance_basis` advisory-not-a-gate R4'). Both rounds: weight-0 mechanism SAFE-TO-BUILD, boundary intact, nothing arms. Build PENDING user go-ahead.
**Date**: 2026-07-13
**Scope**: SHADOW / weight-0 / atomic-unit. Produce >=5 minted lessons ingested into Embers (full bundle), gap-by-gap, until the internal pipeline is end-to-end STABLE (no new bug surface per solve).
**Explicitly OUT (deferred next phase)**: HARDEN (the `LIVE_SOURCES` weight-flip), the authenticated cross-uid minter (#273 close), operator-arming, the join-key merge->harden wire. Named in Phase 5 / Deferred, never a task here.

---

## 0. Framing and the two decoupled tracks

The goal splits into two clocks that must NOT be conflated:

- **Track M (Mechanism stabilization)** — exercisable NOW. Uses #2137 (real, already-attested), authored test data, and #2611-on-merge. Gated only by our own code + gh-verify. This is where "no new bug per solve" is measured.
- **Track N (N real merged lessons)** — externally paced. Maintainer merges take days-to-weeks. A "minted lesson" that requires a fresh real merge is bottlenecked on humans we do not control.

**Design consequence**: reach STABILITY on Track M with a mix of {1 real-now (#2137) + authored-but-honestly-labelled exercise nodes + already-merged public history}, then let Track N accumulate real merged lessons against the now-frozen mechanism. The 5-lesson *bundle count* is satisfiable with real+already-merged nodes; the *mechanism* is proven stable independently and earlier.

**Provenance invariant threaded throughout** (#273, integrity != provenance): every unit is *operator-vouched* (self-asserted provenance, weight-0) or *gh-verified-merge* (world-evidence, still weight-0 to any receiver whose policy is empty — `receiver-weight.js:35-40`). They NARROW; they do not HARDEN. A durable structural label (`minter_kind:"operator-vouched"` / `arming_class:"pre-arm"`) must be seated so a pre-arm node can NEVER masquerade as signed-provenance once arming lands (loomRecon gap #4, BLOCKING-for-safety).

---

## Phase 1 — The unblock: `record-manual-merge` + first proof-of-pipe (#2137 -> Embers)

**Objective**: one generic, gh-verified, join-key-free, node-producing manual arm; then bank #2137 as the first ingested unit.

The loomRecon confirms every underlying primitive exists and is exported — this is **recombination + a distinguishability marker, not new machinery**:
- `mintWorldAnchoredNode` (`live-recall-store.js:213`) — join-key-free, exported, verify-on-write, dedup-collision-aware, `provenance` must be `world_anchored` (verified above at :207-235).
- `recordAttestation` (`world-anchor-store.js:193`) — `anchor_id=sha256(canonical{repo,issueRef,diff_hash})`, re-derives `diff_hash` from bytes.
- `buildWorldAnchorLesson(block)` (`lesson.js:29`) — validates against the frozen 24-cell taxonomy (`lesson-signature.js:44-67`).
- `verifyMerge` (`gh-verify.js`) — standalone, join-key-free, `merged===true`.
- `validateAttestArgs` / `runAttestFromCapture` (`cli.js:242-305`) — already takes (pr-url, issue-ref, candidate-patch-sha, diff, approval-hash, base-sha, branch, built-by, emitted-at).

### Wave 1a — Hygiene precondition (do FIRST, before any node count is asserted)
- **Task**: prune test-pollution from real `~/.claude/lab-state`: `recall-graph-live/afd32730…` (`SECRET-BODY-should-not-leak`, `merge_sha "aaaa…"`, no attestation) and `recall-graph-live-pending/ebd7e3e8…` (`octocat/hello-world`). Source of leak: the `LOOM_LAB_STATE_DIR`-not-set-before-require hazard ([[lab-state-dir-require-time-capture]]).
- **Exit**: `list-live` shows exactly 1 exportable node (#2137, `ca648110…`). `merge-outcome/` and `world-anchor-edge/` remain EMPTY (correct — no armed lane).

### Wave 1b — Build `record-manual-merge <pr-url>` (the one arm; single responsibility)
New CLI arm in `packages/lab/world-anchor/cli.js`, composing existing exports. One arm, one reason to change (SRP): "turn a gh-verified merged PR + a hand-authored lesson block into an exportable world_anchored node, labelled pre-arm."

Pipeline inside the arm:
1. `parsePrUrl(pr-url)` -> `{repo, pr_number}`.
2. `verifyMerge(...)` — gh call, assert `merged===true`, capture `merge_sha` (join-key-FREE; this is the world-evidence).
3. `buildWorldAnchorLesson({trigger_class, gotcha_class, corrective_class, lesson_body})` from **CLI args** (loomRecon gap #3 — expose the 4 fields; builder self-validates against the frozen floor). Reject if lesson_body byte-cap exceeded (Embers re-checks at 4096, `build-lesson.js:63` — enforce locally too, fail-fast at boundary).
4. `recordAttestation(...)` with a **synthetic, self-asserted `approval_hash`** (loomRecon gap #2 — `approval_hash` is HEX64-required by `validateAttestation` but only honestly minted in the armed emit path; a manual attestation MUST supply a synthetic value). The synthetic hash MUST be structurally distinguishable — derive it as `sha256("operator-vouched:" + anchor_id)` so it is deterministic, non-forgeable-as-a-real-approval, and self-labelling.
5. `mintWorldAnchoredNode({anchor_id, merge_sha, lesson_signature, lesson_body})`.
6. **Seat the provenance-class marker** (loomRecon gap #4): stamp `minter_kind:"operator-vouched"` + `arming_class:"pre-arm"` on the attestation record and carry it to the export meta. This is BLOCKING-for-safety — without it a manual node is byte-shaped identical to a future gh-verified shadow node.

Design refuses (fail-closed, all OBSERVABLE per M1): placeholder pr-url (mirror `cli.js:169` guard), `merged!==true`, taxonomy-invalid lesson block, byte-cap violation, `anchor_id`/`content_hash` re-derive mismatch.

**ADR embedded** (see §7 below).

### Wave 1c — Proof-of-pipe: #2137 -> Embers (first ingested unit)
- `runExportBankPair` (`cli.js:383`) on `ca648110…` -> `node.json` + `meta.json`.
- `embers keygen` (throwaway ed25519, `keygen.js`) -> `embers bank --node --meta --key --dir <commons>`.
- `embers verify` + `embers kindle` -> assert receiver-weight 0 (`receiver-weight.js`, empty policy -> 0; expected and correct).
- **Exit criterion Phase 1**: #2137 is a banked, verified, kindled bundle at weight-0 in the commons `_log/`+`_index/`. `record-manual-merge` produces a byte-valid exportable node for an arbitrary merged PR. Lesson-count in commons = **1**.

**Runtime probe required before build** (Runtime-Claim discipline): confirm `mintWorldAnchoredNode` is exported and join-key-free — DONE (`live-recall-store.js:213`, verified :207-235). Confirm `buildBankPair` is pure/no-I/O — DONE (`export-bank-pair.js:93`, verified :88-134).

---

## Phase 2 — Gap-by-gap sequencing (small waves) with a measurable stability exit

Each gap is a small wave. After each, run the **stability probe**: produce one more node through the full arm->export->bank->kindle chain and count NEW pipeline bug surfaces.

### Ordered Loom-side gaps (from loomRecon, BLOCKING set)
Already folded into Phase 1 Wave 1b as the combined clean design (loomRecon "Combined clean design for #1-4"): gap #1 (join-key-free node producer surface), #2 (generic attestation arm), #3 (arbitrary-lesson-block surface), #4 (provenance marker). Phase 1 closes all four in one arm. **No separate waves needed** — the recon explicitly says they are one recombination.

### Ordered Embers-side gaps (from embersRecon)
- **Wave 2a — GAP A (producer wire, real blocker for GOOD lessons)**: `export-bank-pair.js` `buildBankPair` emits v1-MINIMAL meta only (`{minter, prUrl, repoSlug}`, no `mergeSnapshot`/`scope` — YAGNI per its header). Consequence: an A3-exported pair banks with `evaluateMintGate({})` -> `merged!==true` -> verdict `fail` (not-merged) + empty `merge_evidence`. SHADOW banks anyway, but the merge-quality evidence we DO have (the attestation knows the merge happened, `merge_sha` captured) is dropped.
  - **Task**: extend `buildBankPair` to carry `mergeSnapshot` (the `merge_sha` + repo + pr_number the attestation already holds) into `meta.json`, so the mint gate sees `merged===true`. Keep the strict `prUrl` full-shape check (`export-bank-pair.js:119-134`) and node<->PR consistency (`:131-134`) intact.
  - **Exit 2a**: an `export-bank-pair` pair banks with `mint_gate` verdict != `fail` and a non-empty `merge_evidence`. No hand-authored `meta.json` required (removes the embersRecon "the one thing that will bite" friction).
- **Wave 2b — GAP B (byte-parity, unconfirmed cross-repo precondition)**: `content-address.js` + `canonical-json.js` are documented byte-parity COPIES of the toolkit kernel; **no shared test vector, no CI parity gate** (contract §2, hacker LOW-1). Drift -> EVERY bank self-DoSes at `node-id-mismatch`.
  - **Task**: add a shared test vector (one canonical node -> known `node_id`+`content_hash`) checked in BOTH repos, and a CI parity assertion. Smallest form: a fixture JSON + a test in each repo asserting the same derived seals. (Toolkit-side test + Embers-side test; the fixture is the shared contract.)
  - **Exit 2b**: a CI gate fails if the toolkit hasher drifts from the Embers copy.
- **GAP C (human_root launders into weight)** and **GAP D (no Embers merge-outcome consumer / HARDEN seam)** and **GAP E (`emit-cli.js` omits `custodyJoinKeyDir`)** — all **DEFERRED to the HARDEN phase** (Phase 5). C is arming-time-only (empty policy -> weight 0 now); D is the deferred authenticated cross-uid signer (out by design); E is the toolkit half of the merge->harden wire (blocks Rung-1 harden, NOT the weight-0 bundle). See §5.

### Stability exit criterion (measurable — the "no new bug per solve" contract)
Define a **pipeline-bug** as any defect in the arm/export/bank/kindle chain that requires a code change to `world-anchor/*.js`, `export-bank-pair.js`, or the Embers `bank`/`verify` path to let a well-formed solve through (NOT a data-quality issue in a specific lesson body).

**STABLE = K=3 consecutive nodes minted -> exported -> banked -> kindled with ZERO new pipeline-bug code changes.** Each of the 3 uses a DISTINCT lesson taxonomy cell and a DISTINCT (repo, pr_number). Track the count in the plan's `## Stability Ledger` accretion. If any of the 3 surfaces a new pipeline bug, fix it and reset the counter to 0.

Rationale for K=3 (KISS / YAGNI): the recon shows the mechanism is a recombination of already-tested primitives with full re-verification on both bank and kindle; 3 distinct-cell repeats is enough to exercise the taxonomy-branch + gh-verify + parity paths without over-engineering a large K. Raise K only if a bug surfaces (evidence-driven, not speculative).

---

## Phase 3 — The 5-lesson accumulation (Track N cadence)

**Composition of the 5** (explicit real-now vs pending-merge):

| # | Source | Provenance | Real-now? |
|---|---|---|---|
| 1 | spec-kitty#2137 | gh-verified merge (real, backfilled) | YES — real merged |
| 2 | spec-kitty#2611 (datetime consolidation) | gh-verified once maintainer merges | PENDING-MERGE (PR open, USER fork) |
| 3 | An already-merged public PR from history (a real merge we can gh-verify NOW but did not author) | gh-verified merge, operator-vouched lesson-derive | YES — already-merged history |
| 4 | An already-merged public PR from history | gh-verified merge, operator-vouched | YES — already-merged history |
| 5 | Next real solve from the beta queue on merge | gh-verified on merge | PENDING-MERGE |

**Key decoupling decision**: lessons #3 and #4 are drawn from **already-merged history** — real world merges that `verifyMerge` confirms `merged===true` TODAY, with a hand-authored (operator-vouched) lesson-derive. This lets the 5-count reach completion on Track M's clock while #2 and #5 accumulate on Track N (maintainer-paced). Every one of the 5 is gh-verified-merge (world-evidence) and weight-0; #3/#4 are additionally operator-vouched on the lesson-derive (we did not author the fix, we authored the lesson). All carry `arming_class:"pre-arm"`.

**Cadence** — manual-confirm-on-merge:
- For PENDING-MERGE units (#2, #5): the operator polls the PR; on `merged===true`, run `record-manual-merge <pr-url>` -> export -> bank. (Do NOT trust an async CI check as the merge signal — poll the actual merge state via gh, per the coderabbit/async-bot lesson generalized.)
- For already-merged history (#3, #4): run immediately once Phase 1+2 are STABLE.

**Exit Phase 3**: 5 distinct bundles in the commons `_dir`, each verify+kindle clean at weight-0, sharing one growing `_log/` and one `_index/` (embersRecon: 5 sequential `bank` calls accumulate correctly; O(n)-per-append `persistent-log-adapter.js` is fine for 5+/hundreds; cap 64MB).

---

## Phase 4 — Embers bundle completion at 5 lessons

**What "the whole Embers bundle" needs at 5** (embersRecon §2): **nothing new is required** — 5 lessons is 5 sequential `bank` calls into one `--dir`; they accumulate into one Merkle `_log/` (each bundle's `log_proof` snapshots its checkpoint) and one `_index/` (pointers grouped by `failure_signature`, lock-serialized). There is **no batch command, and none is needed** (YAGNI — do not build a `bulk-bank`).

**Deferred-by-design surfaces the recon found (do NOT build these here)**:
- No graph / Trust-Explorer / minter-reputation store (contract §8: "Trust Explorer UI is deferred"). Minter identity rides INSIDE the DSSE-signed `predicate.minter` — no separate store.
- Real public log backend (Rekor/Tessera), N-of-M witness network, split-view protection — the deferred operator half (`0008:78`, `0009:95-96`).

**Completion tasks (small)**:
- Verify the `_index/` correctly groups the 5 by `failure_signature` (distinct signatures -> distinct pointer groups; this exercises multi-writer append).
- Run `embers kindle` on each of the 5, assert all 7 verify stages `[ok]` and receiver-weight 0.
- Snapshot the commons `_dir` as a reproducible fixture (mirror `docs/samples/ember-v2-dogfood/`) for the 5-lesson bundle.

**Exit Phase 4 (= overall goal)**: >=5 verified, kindled, weight-0 bundles in one commons `_dir`, produced through a STABLE mechanism (Phase 2 K=3 met), with a reproducible fixture snapshot. Internal pipeline declared end-to-end STABLE.

---

## Phase 5 — DEFERRED (next phase, NOT tasks here): the scout->feed cron + HARDEN

Designed, scoped as the next phase, gated on {Phase 4 stability + the autonomous actor being runnable (currently fail-closed `deployed-unconfigured` on this box)}.

### 5a. Eventual issue-ingestion routine (scout -> feed)
A SEPARATE pipeline from the mint mechanism (dependency-rule: intake is a distinct concern from mint):
- **Scout**: a cron/routine that scans target repos for candidate issues.
- **Feed**: hands a candidate to the autonomous pipeline (`live-draft-run.js` -> the 4 `claude -p` spawns) — which is **fail-closed on this box today**, so this whole leg is gated on the actor being runnable (arming-adjacent).
- **Intake filters (lessons from THIS session — capture now, apply in Phase 5)**: (1) **target-repo main-CI-health** — do not feed a candidate whose target repo has red main CI (the solve cannot be validated against a broken baseline); (2) **queue-decay** — de-prioritize stale queue entries (an issue that has decayed past a freshness window is likely resolved or abandoned; poll before feeding). Note the spec-kitty#2611 env-friction lesson (`uv sync --extra test` else pytest falls through to system py3.14) as an intake precondition: verify the target's test-dep resolution before declaring a solve validated.

### 5b. HARDEN (explicitly OUT of the current goal)
The `LIVE_SOURCES` weight-flip and everything gating it:
- **GAP E close**: `emit-cli.js:90-104` `buildOpts` omits `custodyJoinKeyDir`; `emit-pr.js:636` mints the join-key only `if (typeof opts.custodyJoinKeyDir === 'string')`. So even the turnkey armed emit writes no join-key -> `observe-merge` (`merge-observer.js:78-79`) fail-closes `no-join-key`. Fix belongs with arming.
- **Authenticated minter / #273 close** (loomRecon HARDEN #6): the world-anchored-by edge is UNSIGNED, same-uid co-forge possible. A signed/kernel-writer edge is required before ANY world-anchor record feeds `LIVE_SOURCES`. (Deferred — PR-A2b / ladder item 5.)
- **`verifyKeyPem` engagement** (PR-A2a): un-armed mint emits `world-anchor-mint-unauthenticated` — fine for SHADOW, engaged at arming.
- **GAP C close** (`human_root` -> weight): bind `human_root` to a registry when a receiver policy assigns trust.
- **GAP D**: the Embers authenticated cross-uid signer (`kindle` wires `NULL_WORLD_ANCHOR_PORT` today, dormant seam).

**All of Phase 5 is operator-arming-gated. Claude never arms** (③.2 security invariant: never touch `/etc/loom`, `/opt/loom`, an arming flag, or `--attested-cross-uid`).

---

## 6. Risks / Open Questions

1. **Manual lesson-derive quality without the `claude -p` deriver.** The actor path (`live-lesson-derive.js`) is fail-closed, so lesson bodies are hand-authored against the frozen 24-cell taxonomy. RISK: hand-authored lessons may be lower-signal than actor-derived. MITIGATION: the taxonomy floor (`lesson-signature.js:44-67`) constrains the shape; `buildWorldAnchorLesson` self-validates. OPEN: define a minimal quality rubric for a hand-authored lesson body (what makes a lesson worth banking vs noise) — this is a Phase 2 sub-task, not a blocker.
2. **Operator-vouched provenance tier — durability of the label.** The `minter_kind:"operator-vouched"` / `arming_class:"pre-arm"` marker MUST survive into the node/attestation schema, not just the export meta (loomRecon gap #4). RISK: if seated only in export-meta (the current weaker mitigation, `cli.js:336` `PROVENANCE_NOTE`), a pre-arm node is byte-identical to a future signed-shadow node. RESOLUTION in this plan: seat it on the attestation record in Wave 1b (BLOCKING-for-safety). OPEN: confirm the node schema has room for the marker without breaking the frozen 7-key `world_anchored` exact-set (Embers `build-lesson.js:34-37` — exact-set 7 keys; the marker likely rides on the attestation + meta, NOT the node body, to avoid tripping the exact-set gate — **probe this before Wave 1b build**).
3. **Embers banking `--key` custody step.** SHADOW uses a throwaway ed25519 key (`keygen.js`, 0600, O_EXCL); no operator/cross-uid key needed at weight-0 (contract §0). RISK: none at weight-0; the real custody key is a Phase 5 (arming) concern. Note: `keygen` is O_EXCL fresh-file-only — a re-run against an existing keyfile fails (idempotency-adjacent; expected).
4. **Verifying the `emit-cli.js` join-key gap (audit claim).** CONFIRMED by loomRecon at `emit-cli.js:30-31` + `:91-104` + `emit-pr.js:636`. It is the TOOLKIT half of the merge->harden wire, irrelevant to the weight-0 bundle, real blocker for Rung-1 harden. Filed to Phase 5b. No action in Phases 1-4.
5. **Byte-parity drift (GAP B) is asserted, not gated.** Until Wave 2b lands the CI parity gate, a toolkit hasher change silently DoSes every future bank at `node-id-mismatch`. RISK-WINDOW: Phases 1-2 before 2b. MITIGATION: the #2137 fixture reproducing byte-for-byte is current evidence the copies agree; land 2b early.
6. **Synthetic `approval_hash` honesty.** A manual attestation supplies a self-asserted `approval_hash` (no honest manual source — it is kernel-sealed only in the armed path). RISK: a synthetic hash could be mistaken for a real approval. MITIGATION: derive it deterministically as `sha256("operator-vouched:"+anchor_id)` and pair it with the `minter_kind` marker so it is self-labelling and never collides with a real HEX64 kernel approval. OPEN: confirm `validateAttestation` accepts the synthetic (HEX64-shaped) value without a provenance check that would reject it.

---

## 7. ADR: The one-arm `record-manual-merge` unblock (join-key-free, operator-vouched)

**Status**: Proposed
**Context**: PR-3 removed the legacy join-key-free node mint and replaced it with a join-key-GATED `observe-merge` (`merge-observer.js:78`). A manual `gh pr create` never mints a join-key, so the merge-observer fail-closes (`no-join-key`), and the sole node producer `mintFromMergeOutcome` (`world-anchor-mint.js:303`) is transitively join-key-bound via `loadMergeOutcome`. Result: `export-bank-pair` dies at `readLiveNode` for any manual PR. The one surviving node (#2137) was made by a now-deleted path. We need a manual, gh-verified, join-key-free, node-PRODUCING confirm to reach a 5-lesson SHADOW bundle without arming.
**Decision**: build ONE CLI arm `record-manual-merge <pr-url>` that composes existing exported primitives — `parsePrUrl -> verifyMerge (gh, merged===true, join-key-free) -> buildWorldAnchorLesson(cli block) -> recordAttestation(synthetic-labelled approval_hash) -> mintWorldAnchoredNode({anchor_id, merge_sha, ...})` — stamping `minter_kind:"operator-vouched"` + `arming_class:"pre-arm"`. It re-creates the node-only surface PR-3 removed, NOT the armed edge.
**Consequences**: (+) unblocks the bundle using only in-tree, exported, re-verified primitives; every refuse path OBSERVABLE. (+) provenance marker makes pre-arm nodes structurally non-masquerading. (-) introduces a synthetic `approval_hash` (self-asserted — the provenance seam we accept at weight-0). (-) re-opens a manual node-mint surface PR-3 closed; MITIGATED by the pre-arm label + the fact it produces node-only, never the armed world-anchored-by edge, so it can never feed `LIVE_SOURCES`.
**Alternatives Considered**: (a) mint the join-key manually for a `gh pr create` PR — REJECTED: re-implements the armed egress path outside the kernel chokepoint, reopening the actor-injection surface (③.2 egress invariant); (b) extend `observe-merge` to a join-key-free branch — REJECTED: conflates the armed merge-observer (which MUST stay join-key-gated for the harden lane) with the shadow manual lane, violating SRP; (c) hand-author `node.json` directly — REJECTED: bypasses verify-on-write, exactly the #273 integrity hole.
**Principle Audit**: SRP (one arm, one reason to change — "merged PR + lesson block -> pre-arm node"); DRY (composes existing exports, adds no duplicate mint logic); KISS/YAGNI (recombination, no new machinery; no batch command). Design qualities: **Modularity** (the arm depends on abstractions — the exported primitives — not raw store internals, Dependency-Inversion); **Security** (fail-closed + OBSERVABLE refuses; the pre-arm marker enforces the integrity!=provenance boundary of #273 so a weight-0 node can never masquerade as signed); **Maintainability** (the join-key-free shadow lane stays cleanly separate from the armed harden lane). Conflict surfaced: re-opening a removed surface (reversibility) vs unblocking the bundle — resolved by the node-only + pre-arm-label constraint that keeps it off the `LIVE_SOURCES` path.
**Sources**: `kb:architecture/crosscut/single-responsibility` (one-arm decomposition by actor); `kb:architecture/crosscut/idempotency` (mintWorldAnchoredNode dedup-collision + content-addressed node_id as the natural idempotency key — verified `live-recall-store.js:228-244`); `kb:architecture/discipline/trade-off-articulation` (the synthetic-approval-hash + reopened-surface sacrifices surfaced explicitly).

---

## 8. Provenance-layer refinement — GitHub-anchored (2026-07-13, per USER)

> **Corrected by R1'/R2'/R4'** in `## Pre-Approval Verification` (round-2) — those resolutions supersede this section where they conflict (marker is CLI-note-only not attestation-seated; `diff_hash` pinned to the merge-commit patch; the author distinction is advisory-not-a-harden-gate).

Supersedes the pure synthetic-`approval_hash` provenance basis in Wave 1b step 4 + §6 risk 6. For the single-user commons (#569) GitHub auth can serve as the provenance anchor, and it is a strict upgrade over local self-assertion (integrity != provenance, #273). GitHub is already the OQ-NS-6 world-anchor authority, so anchoring provenance on it is aligned, not a hack.

**What changes in `record-manual-merge`:**

- Wave 1b step 2 already calls `verifyMerge` (gh, `merged===true`, `merge_sha`). ADD: also gh-verify the PR **author** (== operator's GitHub identity) and capture `{author, merged_by, merge_sha, verified_at}`.
- Wave 1b step 6: the `provenance_basis` / `minter_kind` / `arming_class` markers are operator-facing audit metadata ONLY (the CLI-result `PROVENANCE_NOTE`), NOT persisted to the attestation record, the node body, OR `meta.json` (per **R1'** — the frozen `ATT_FIELDS`/7-key stores silently drop or reject extra keys, and populating export meta would create a forgeable carrier a future consumer could key on). The `{repo, pr_number, author, merge_sha, verified_at}` gh facts are the real, re-verifiable trust basis and are re-derived from the oracle at mint (and at any future harden), never trusted as stored fields.
- The synthetic `approval_hash` (`sha256("operator-vouched:"+anchor_id)`) STAYS only as the HEX64 field-shape placeholder `validateAttestation` requires; it is NOT the trust basis. The trust basis is the gh-re-verifiable github-anchor.

**The load-bearing security invariant (github-anchored):** the mint step (and any future harden step) MUST **re-verify against GitHub via `gh`** — is this PR merged? authored by the operator? does the stored `diff_hash` match the merged diff? — and NEVER trust the stored fields (the lab-store is open-writable; GitHub is the oracle). A co-forger can write the fields but cannot make `gh api` confirm a merged PR that is not real. This invariant is exactly where a subtle bug silently reopens #273, so it gets its own architect + hacker design pass before the Wave 1b build.

**Credential boundary:** the substrate only READS via `gh` to verify; the operator signs commits and GitHub attests; Claude never handles the signing key.

**Honest scope (unchanged):** a SINGLE-USER provenance close. It does NOT close the MULTI-PARTY / untrusted-actor case — the cross-uid authenticated signer (Phase 5b / item-5) remains the deferred multi-party close. `lesson_body` + persona stay operator-vouched metadata. Everything stays weight-0.

**Optional stronger tier (evidence-driven, Phase 2 sub-task):** require GPG/SSH-signed commits (GitHub "Verified") for a `provenance_basis:"github-signed"` tier. NOTE: #2611's commits are currently **unsigned** (`gh` reports `verified=false`), so this tier needs commit-signing set up going forward; it does not apply retroactively to #2611.

---

## Requirements Checklist

| # | Requirement (task's 6 mandated covers) | Disposition |
|---|---|---|
| 1 | The unblock: generalize backfill-2137 -> repeatable `record-manual-merge <pr-url>` (gh-verified, content-addressed, manual lesson-derive, persona attribution, join-key-free mint, operator-vouched label) + #2137->Embers proof-of-pipe | ADDRESSED — Phase 1 Waves 1b/1c + §7 ADR. Persona attribution noted as off-critical-path (`cli.js:134`, `runRecordPersona` is a separate operator arg, not a bundle blocker — loomRecon stage 4). |
| 2 | Gap-by-gap sequencing + measurable "no new bug per solve" stability exit | ADDRESSED — Phase 2 (Loom gaps #1-4 folded into Phase 1; Embers GAP A/B as Waves 2a/2b; C/D/E deferred). Stability exit = K=3 consecutive distinct-cell mints, zero new pipeline-bug, reset-on-fail. |
| 3 | The 5-lesson accumulation (which issues/repos, merge-pacing cadence, real-now vs pending) | ADDRESSED — Phase 3 table: #2137 real; #2611+#5 pending-merge; #3/#4 from already-merged history to decouple count from maintainer clock. |
| 4 | Embers bundle completion at 5 (multi-lesson index/graph, deferred embers surfaces) | ADDRESSED — Phase 4: 5 sequential banks into one `_dir` share one `_log/`+`_index/`; NO batch cmd needed (YAGNI); graph/Trust-Explorer deferred by contract §8. |
| 5 | Eventual scout->feed cron/routine, scoped as NEXT phase (gated on stability + runnable actor); note CI-health + queue-decay intake lessons | ADDRESSED — Phase 5a, explicitly deferred; intake filters (main-CI-health, queue-decay, uv --extra test) captured. |
| 6 | Risks/OQs: manual lesson-derive quality, operator-vouched tier, `--key` custody, emit-cli join-key verification | ADDRESSED — §6 items 1-6 (plus byte-parity + synthetic-approval-hash risks). |
| H | HARD FRAMING: SHADOW/weight-0 throughout; HARDEN OUT as deferred phase; works WITHOUT arming; decouple mechanism-stabilization from N-real-merges | ADDRESSED — §0 two-track split; Phase 5b holds all HARDEN/arming; every unit weight-0 + pre-arm. |

---

## KB Sources Consulted

- `kb:architecture/crosscut/idempotency` — grounded the K=3 stability contract and confirmed `mintWorldAnchoredNode`'s content-addressed node_id + dedup-collision path is the natural idempotency key (re-bank idempotent, divergent = observable collision), so re-running `record-manual-merge` is safe.
- `kb:architecture/crosscut/single-responsibility` — informed the "one arm, one reason to change" decomposition and the rejection of extending `observe-merge` (which would conflate the armed and shadow lanes).
- `kb:architecture/discipline/trade-off-articulation` — required surfacing the sacrifices (synthetic approval_hash, re-opened manual mint surface, asserted-not-gated byte-parity window) in the ADR and §6 rather than only the gains.

*Files central to this plan (all absolute):* `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/lab/world-anchor/cli.js`, `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/lab/world-anchor/live-recall-store.js` (mintWorldAnchoredNode :213), `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/lab/world-anchor/world-anchor-store.js` (recordAttestation :193), `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/lab/world-anchor/export-bank-pair.js` (buildBankPair :93, GAP A), `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/lab/world-anchor/lesson.js` (buildWorldAnchorLesson :29), `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/lab/world-anchor/merge-observer.js` (:78 no-join-key), `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/kernel/egress/emit-cli.js` (:90-104 GAP E), and the Embers repo `~/Documents/embers/src/cli/publish.js` + `src/core/mint/mint-pipeline.js` + `docs/ember-v2-contract.md`.

---

## Pre-Approval Verification (2026-07-13, 3-lens `/verify-plan`)

**Verdict: NEEDS-REVISION → resolutions below.** Three read-only lenses spawned in parallel — architect (design), code-reviewer (claim-vs-evidence), hacker (adversarial-security, because the plan is `#273`-adjacent) — each charged to PROBE every runtime claim against the actual repo, not trust the prose. No exploitable weight-0 hole was found (the `LIVE_SOURCES` boundary genuinely holds; the ADR's three rejections are sound; 8 of 10 file:line citations are exact; Wave 1a hygiene confirmed byte-for-byte against real `~/.claude/lab-state`). But three substantive issues would each bite the Wave 1b build, so the plan body is corrected by the numbered resolutions below (they supersede the body where they conflict).

### Consolidated findings (ranked, cross-lens)

- **F1 [FAIL, all 3 lenses] The "BLOCKING-for-safety" provenance marker is theater.** It cannot be seated (`buildBody` copies only the fixed 11-key `ATT_FIELDS` allowlist, silently dropping extras — `world-anchor-store.js:168-174`; the node body is a 7-key exact-set that rejects extras — `live-recall-store.js:61-65`), AND nothing reads it (`grep -rn "minter_kind|arming_class|operator-vouched|pre-arm|provenance_basis" packages/ --include=*.js` → zero non-test hits), AND it rides a same-uid-forgeable attestation, so per `#273` it can never be a trust boundary. The genuine non-masquerade defense is the signed-edge admission gate: a node-only manual mint produces no signed edge, so `admitWorldAnchorNode` refuses at `no-authenticated-edge` (`admit-world-anchor-node.js:119-123`) → `source:'mock'` → weight 0 (`weight-source-gate.js:76-81`), regardless of any marker. Real danger: a future harden step could build an admission gate on the forgeable marker, reopening `#273`.
- **F2 [FAIL, code-reviewer] The 11-field attestation gap (build-blocker).** `recordAttestation` requires all 11 `ATT_FIELDS` (non-nullable, format-checked — `world-anchor-store.js:71-74`, `:140-153`). Wave 1b as written sources only ~5 (`repo`, `pr_number`, `pr_url`, `lesson_signature`, synthetic `approval_hash`). No source for `issueRef`, `branch`, `base_sha` (HEX40), `diff_hash` (HEX64), `built_by`, `emitted_at`, and no `--diff` input — the arm rejects on `bad-issueRef`/`bad-diff_hash`/etc the instant it runs. Also: `recordAttestation` only shape-checks `diff_hash`; the actual `sha256(bytes)` re-derivation lives in CLI callers (`cli.js:161`, `:269`) that assume a local `--diff` file. And `merge_sha` is NOT an attestation field — it threads straight from `verifyMerge` into the mint. This collapses the "lean one-arm recombination" framing: the arm is essentially `attest-from-capture`'s surface + `verifyMerge` + a lesson block.
- **F3 [FAIL, code-reviewer] GAP B is already closed (`drift:recon-depth` miss).** Both byte-parity vectors AND CI gates already exist: toolkit `tests/unit/lab/world-anchor/export-bank-pair.test.js:37-77` (frozen `EMBERS_DOGFOOD_NODE`, byte-identical to `embers/docs/samples/ember-v2-dogfood/node.json`, with an explicit byte-parity test, CI-wired at `ci.yml:237`); Embers `test/unit/schema/content-address.test.js` (reciprocal frozen fixture `test/fixtures/toolkit-node/world-anchored-node.json`, CI-wired via `test/run.js`). The real residual is narrower: the two vectors are DIFFERENT nodes (not one shared file), and neither side tests injectivity.
- **F4 [MEDIUM, hacker + architect + code-reviewer] §8 provenance contradictions.** (a) §8's `author==operator` check contradicts Phase-3 lessons #3/#4 ("already-merged public PR … we did NOT author") — one arm cannot both enforce and admit these. (b) §8's "re-verify `diff_hash` against the merged diff" is unbacked: `verifyMerge` fetches only `{merged, merge_commit_sha, state}` (`gh-verify.js:141-146`), never the diff or the author — so §8 IS new machinery (a `gh-verify.js` edit / a second `gh` call), not pure recombination.
- **F5 [MEDIUM, hacker] "All refuses OBSERVABLE" is false for the composed attestation path.** `recordAttestation`'s refuse paths at `world-anchor-store.js:195` (`bad-attestation`), `:201` (`self-inconsistent`), `:224` (`write-failed`) return silent `{ok:false}` with no `emitEgressAlert`, while sibling `mintWorldAnchoredNode` DOES emit on the same classes — an asymmetry that violates the fail-silent invariant (`security.md`).
- **F6 [FLAG, architect] K=3 stability must run the REAL gh path.** `verifyMerge` accepts an injectable `opts.runner` (`gh-verify.js:142`); a K=3 measured with a mock runner is a hypothesis about the mocked path (Rule-2a-corollary). Also strike §0's "authored-but-honestly-labelled exercise nodes" language — every mint gates on `merged===true`, so a synthetic/non-merged PR refuses; there is no valid exercise node that skips a real merge.
- **F7 [NIT] Citation fixes.** `cli.js:169` is the placeholder-`diff_hash` guard inside `backfill2137`, not a placeholder-`pr-url` guard (there is no pr-url placeholder concept in the file). Off-by-one line refs: `buildOpts` at `:91` (claimed `:90`); `merge-observer` `no-join-key` at `:79` (claimed `:78`). Harmless; fix for accuracy.

### Resolutions (corrected design-of-record — supersede the body where conflicting)

- **R1 (F1)** — Relabel the marker as NON-load-bearing operator-audit metadata carried on the export meta ONLY (never the frozen attestation/node store). Strike every "BLOCKING-for-safety" framing (lines 19, 47, 152, §7). Add an explicit invariant to the ADR: *"the marker is NEVER a trust/admission input — the signed-edge + merge-outcome + broker-sig admission gate is the sole masquerade defense."* The durable-structural-label desire for arming becomes a DEFERRED Phase-5 concern (a signed sidecar keyed by `anchor_id`, seated only when the authenticated minter lands), not this phase.
- **R2 (F2)** — Wave 1b MUST specify a full 11-field `ATT_FIELDS` mapping. Resolution: `record-manual-merge` fetches the REAL merge metadata via `gh` (real `diff_hash` from the merged diff bytes, real `base_sha`, `branch`, `author`, `merged_at`) so the attestation is honestly content-addressed — placeholders for content-address inputs are rejected (they would break the `anchor_id` integrity that is the `#273` core). Only `built_by` (operator identity) and the synthetic `approval_hash` are operator-vouched, both self-labelling + OBSERVABLE. Reuse `validateAttestArgs` semantics rather than re-implement; thread `merge_sha` straight to the mint. This makes the arm `attest-from-capture` + a `gh` merge-metadata fetch + a CLI lesson block — the ADR "recombination, not new machinery" claim is corrected to "composes `attest-from-capture` + one new `gh` merge-metadata fetch."
- **R3 (F3)** — Re-scope Wave 2b from "build the parity vector + CI gate" to "CONFIRM the existing two-sided coverage is current, and close the real residual": (a) add an INJECTIVITY case each side (one-field change → different id, so a symmetric field-coverage drift edited into both repos can't collide two nodes to one id — hacker LOW/MED); (b) optionally converge the two different vectors toward one shared fixture. Cite the existing tests; do not re-build from scratch.
- **R4 (F4)** — Split `provenance_basis` into `github-authored` (author==operator; #1/#2/#5) vs `github-third-party-vouched` (merge-verified only, operator-vouched lesson-derive; #3/#4), and forbid any future harden path from treating the latter as authored. Own the `gh-verify.js` edit (add `.author.login`/`.merged_by.login`/`.merged_at` to the `--jq` + return shape) as a real code change named in Wave 1b/§8. Route §8 through the architect+hacker design pass §8 already promises, BEFORE the Wave 1b build.
- **R5 (F5)** — The new arm wraps every non-ok `recordAttestation` return with an observable emit (mirror `runAttestFromCapture`'s `attestRefuseAlert`), OR the store's three silent paths are hardened. Every refuse OBSERVABLE, for real.
- **R6 (F6)** — The K=3 stability proof (or a named subset ≥1) runs the REAL `gh` path against real already-merged PRs (Phase-3 #3/#4 already intend this). Strike the synthetic-exercise-node language from §0.
- **R7 (F7)** — Fix the three citations inline.

### Scope note

Revision is NARROW: the mechanism claims (F-nums aside), the `LIVE_SOURCES` boundary, the two-track decoupling (with R6 applied), and the single-user gh-anchored provenance model (with R2+R4 applied) all stand. GAP C/D/E, the authenticated minter, and the scout-cron are correctly non-blocking for the weight-0 bundle (each gates only the armed path the manual lane never touches). A `/verify-plan` re-run on the revised plan is recommended before the Wave 1b build (the R2 field-mapping + R4 `gh-verify.js` edit materially change the arm's shape). Phase 1 build is PENDING an explicit user go-ahead; nothing arms.

**Lens transcripts**: architect `a397455c` (NEEDS-REVISION; KB-grounded), code-reviewer `af5fc24c` (NEEDS-REVISION; 10 claims probed, Wave 1a hygiene confirmed), hacker `aa9140c2` (SAFE-TO-BUILD-conditional; 7 attacks, 2 bypasses). All read-only; no store writes, no arming, no `/etc/loom` access.

### Round-2 re-verification (2026-07-13) — corrections to R1-R7

A second 3-lens `/verify-plan` pass ran against the revised plan (this section). All three converged: the **weight-0 bundle mechanism is SAFE-TO-BUILD** (`LIVE_SOURCES` is `Object.freeze([])` un-armed; BOTH source-derivers — `admitWorldAnchorNode`, `deriveWorldAnchorSource` — gate on the authenticated signed edge, never a marker; a node-only manual mint has no signed edge → weight 0 by construction). But a second round of **text-level** fixes to R1-R7 is needed before the Wave 1b build codifies the wrong invariant. No design was reopened; the weight-0 boundary is intact. The corrected resolutions **R1'-R7' below SUPERSEDE R1-R7**.

**Resolved question — the deleted-branch risk is REFUTED (feasibility good news).** `gh` returns `.head.ref` and `.base.sha` as static strings captured at PR creation; they survive same-repo branch deletion AND fork-repo deletion (empirically confirmed on `facebook/react#500` fork-deleted + `spec-kitty#1000` branch-404). R2 is feasible for Phase-3 #3/#4 already-merged history.

- **R1' (marker seat — supersedes R1; fixes the R1↔§8 contradiction, code-reviewer FAIL #2 + hacker LOW).** The marker family (`minter_kind` / `arming_class` / `provenance_basis`) is operator-facing audit ONLY: keep it as the CLI-result `PROVENANCE_NOTE` disclaimer (`cli.js:336`) and do NOT persist it to the attestation, the node, OR `meta.json`. Rationale: populating `meta.json` would CREATE the attack-#2 carrier (a forgeable field crossing to Embers that a future consumer could key on). §8's "stamp … on the attestation record" clause (body line ~179) is corrected to "CLI-note only; not persisted to any store or export meta." The signed-edge admission gate is the sole masquerade defense (verified across both derivers).
- **R2' (field sourcing + gh seat + diff-pin + reuse — supersedes R2).**
  - **`issueRef`**: `record-manual-merge` takes an explicit `--issue-ref` operator arg (the operator is vouching for the lesson anyway), DEFAULTING to `pr_number` when absent for gh-only-sourced lessons. Documented as an `anchor_id`-identity-basis convention. #2137 is GRANDFATHERED at its original `#2097` basis (its node already exists; never re-derived) and is EXEMPT from the §8 gh-diff re-verify (its `diff_hash` came from a local file `/tmp/spec-kitty-2097.diff`, which a gh fetch will not reproduce byte-for-byte).
  - **gh seat (CI chokepoint)**: the whole gh fetch lands INSIDE `gh-verify.js` (already on `READONLY_GH_ALLOW` + `assertReadOnlyGhArgs` GET-gated; `emit-pr.test.js:750-787` fails CI on a raw `gh` spawn from `cli.js`). ONE extended call returns `{merged, merge_commit_sha, state, author, merged_by, merged_at, base_sha, branch}` — folding R4's author-fetch AND `base_sha`/`branch` (which R4's text omitted) into a single `--jq` + return-shape edit — plus the merge-commit diff.
  - **`diff_hash` pin**: hash the MERGE-COMMIT patch (what literally landed; `gh api repos/O/R/commits/<merge_sha>` diff media-type, or `compare/<merge_sha>^...<merge_sha>`) — immutable under later base movement, unlike `gh pr diff` (PR-head, live-recomputed; squash/rebase merges rewrite it). §8's future re-verify uses the SAME pin. On #2137 all three sources happened to be byte-identical (base never moved), but that is not guaranteed in general.
  - **reuse (SRP/DRY)**: extract only the pure field-SHAPE validators (`HEX64`/`HEX40`/`isIsoUtc`/`isBoundedPlainString`, already factored at `cli.js:196,:212-215`) into a shared helper both arms call. Do NOT call full `validateAttestArgs` (it hard-requires `--candidate-patch-sha`, reads `--diff` as a local file, and emits under the `attest-from-capture-refused` namespace). Do NOT add a `--from-merged-pr` mode-flag to `attest-from-capture` (the exact lane-conflation the §7 ADR rejected for `observe-merge`). `record-manual-merge` stays a separate arm.
  - **synthetic `approval_hash`**: `built_by` + `sha256("operator-vouched:"+anchor_id)` stay operator-vouched, but the hash is a SELF-LABEL, not a security tell — with R2' all 11 fields are public gh facts / publicly derivable, so an honest node self-labels while a forger just uses a random hash. The distinguishing arming tell is ALWAYS "verified signed edge + `broker_sig`," never "the attestation looks real." State this invariant; drop any "non-forgeable-as-a-real-approval" framing.
- **R3' (Wave 2b — supersedes R3).** Injectivity tests ALREADY exist both sides (`embers/test/unit/schema/content-address-injective.test.js`; toolkit `tests/unit/lab/world-anchor/live-recall-store.test.js:76-85`). Real residual, re-prioritized: **PRIMARY** = a single SHARED canonical vector asserted with the same expected `node_id`/`content_hash` in BOTH repos (guards the asymmetric cross-repo drift that is the load-bearing GAP-B concern — the two current fixtures are DIFFERENT nodes, so a one-sided hasher drift leaves both green while a real cross-repo bank self-DoSes); **SECONDARY** = widen the existing injectivity tests' field coverage (vary all 5 basis fields, not just `merge_sha` / `lesson_body`). Cite the existing tests; do not build from scratch.
- **R4' (author distinction — supersedes R4; adopts R1's invariant, architect FAIL + hacker HIGH).** The `provenance_basis` split (`github-authored` vs `github-third-party-vouched`) is ADVISORY audit only, gates NOTHING, weight-0-inert. STRIKE "forbid any future harden path from treating [third-party-vouched] as authored" (it implies the forgeable field is a trust input = F1 relocated). The authored/vouched distinction becomes trust-bearing ONLY at harden via a consume-time `gh` author re-verify (re-derive `author==operator` from the oracle, per §8's own invariant) OR the deferred Phase-5 signed sidecar — never a stored/exported/CLI-note read.
- **R5' (observable refuse — supersedes R5, widened).** EVERY refuse in the composed arm emits, not just `recordAttestation`'s trio: the `parsePrUrl` / `buildWorldAnchorLesson` throw-catch (these THROW, not `{ok:false}`), the `verifyMerge {ok:false}`, the `recordAttestation` trio (`:195/:201/:224`), and the `mint {ok:false}`. Mechanically trivial — the local `attestRefuseAlert` helper (`cli.js:218`, used at `:300`) already does exactly this; call it on each. Prefer store-side hardening of the three `recordAttestation` reasons to avoid a double-emit on the already-observable `:208/:217` paths.
- **R6' (unchanged, SOUND).** K=3 on the REAL gh path (`verifyMerge` gates on `merged===true` with a HEX40 sha, so no synthetic/non-merged node passes); strike §0's "authored exercise node" language.
- **R7' (unchanged, SOUND).** Citation fixes; ALSO fix §8 body line ~179 per R1'.

**Round-2 dispositions**: R1 → **R1' (fixed)**, R2 → **R2' (fixed)**, R3 → **R3' (fixed)**, R4 → **R4' (fixed)**, R5 → **R5' (widened)**, R6/R7 SOUND. All fixes text-level; none reopens the weight-0 boundary; nothing arms. Per the round-2 architect, a THIRD `/verify-plan` is not required — the corrections are text-level applications of already-verified design directions; the Wave 1b build's own VERIFY stage re-checks them against the built code.

**Round-2 transcripts**: architect `a7de3bda` (NEEDS-REVISION; R4-incoherence FAIL + R2 diff-pin/chokepoint/validator-share FLAGs), code-reviewer `a8ee314b` (NEEDS-REVISION; issueRef + R1↔§8 FAILs; deleted-branch REFUTED via live gh probes), hacker `aea168af` (SAFE-TO-BUILD-conditional; R4 theater-relocation HIGH + 3 completeness MEDIUMs). All read-only; live `gh api` GETs only; no store writes, no arming, no `/etc/loom` access.

### VALIDATE result — Wave 1b BUILT (2026-07-13)

`record-manual-merge` + the two `gh-verify.js` fetch siblings were built TDD-first (`tests/unit/lab/world-anchor/record-manual-merge.test.js`), then 3-lens VALIDATE ran on the BUILT code (Rule 2/2a). **Verdict: SHIP after fixes** (all applied). Real-gh probe (Rule 2a-corollary, mock-vs-real gap) CLOSED: all three jq/diff shapes verified against live merged PR #2137 — `verifyMerge` → `{merged:true, merge_commit_sha, state}`; `fetchPrMergeMeta` → `{author:"shashankcm95", base_sha (HEX40), branch, merged_at, merged_by:"stijn-dejongh"}` (author != merged_by confirms the captured distinction); `fetchMergeCommitDiff` (`commits/<sha>` diff media type) → 813-byte diff, `sha256=7957a923…`, byte-identical to `gh pr diff`. Confirms #2137's grandfather (a fresh run derives a NEW anchor_id from the merge-commit diff, distinct from the local-file-derived `ca648110`).

- **hacker `a81e5338` — SAFE-TO-SHIP** (12 live-probe scenarios, 0 weight-0 bypasses). PROVED on the built code: a node-only mint lands `admitWorldAnchorNode` → `source:'mock'` → weight 0 (`no-authenticated-edge`), and 0 even with a forced `world-anchor` source (`LIVE_SOURCES=Object.freeze([])`); the markers are ABSENT from the raw `<anchor_id>.json` / `<node_id>.json` bytes (F1 close, proven against files). Findings folded: **M1** (control-char reject on gh-sourced branch/author) FIXED; **L2** (mint-failed arm-emit) FIXED.
- **honesty-auditor `a6baaa9c` — Grade A** (7/7 R1'-R7' claims CONFIRMED). Flagged: the R5' wrap lacked a regression test (FIXED — added partial-state + no-merged-at tests); a MINOR plan-prose imprecision (see below).
- **code-reviewer `a56de1a5` — FIX-FIRST** (1 FAIL, empirically reproduced): `emitted_at` sourced from wall-clock broke idempotency (`emitted_at` is in `ATT_FIELDS` → `content_hash`, so a same-PR retry collision-rejected). **FIXED** — `emitted_at = ev.meta.merged_at` (retry-stable, gh-anchored); a no-`now`-override + emitted_at-source regression test added. Plus the L2 mint-failed FLAG (FIXED).

**Fixes applied to the built code**: (1) `emitted_at` = gh `merged_at` (idempotency); (2) `validatePrMeta` control-char reject on branch/author/merged_by/merged_at (M1); (3) `mint-failed` emits the arm's `record-manual-merge-refused` classifier + surfaces `anchor_id` (L2). Tests: 25 → **30** (added emitted_at-source, no-merged-at, mint-failed partial-state, control-char branch + author). eslint clean; all 25 world-anchor test files green.

**MINOR (plan-prose, honesty-auditor)**: R2''s "all 11 fields are public gh facts / publicly derivable" is loose — after the `emitted_at=merged_at` fix, 9 of 11 are gh-derived/factual; `built_by` + the synthetic `approval_hash` are the two operator-vouched fields. The built code's own comments are correctly scoped.

**Forward items (NOT fixed here — deferred by design)**: **L1** — `parsePrUrl`/`isGhRepo` admit a `.`/`..` repo segment (operator-typed, gh 404s fail-closed, `execFile` no-shell → not exploitable); a shared-code hardening for a future PR. **L3** — a manual attestation at `anchor_id` would collision-reject a future REAL armed-emit attestation at the same anchor (availability poison of the real lane); inert today (the arm targets orphan-grandfather PRs with no kernel join-key), but NAME it in the arming ADR (§5b). **VALIDATE transcripts**: `a56de1a5` / `a81e5338` / `a6baaa9c` — read-only; live probes isolated via throwaway `LOOM_LAB_STATE_DIR`; no arming, no real-store writes, no `/etc/loom`.

### Phase-1 dogfood result — Wave 1a + Wave 1c RUN (2026-07-13, real state)

**Wave 1a (hygiene)** — the two test-pollution nodes ARCHIVED (reversible `mv`, not deleted) to `~/.claude/lab-state/_archive-pollution-2026-07-13/`: `recall-graph-live/afd32730…` (SECRET-BODY placeholder, no attestation) + `recall-graph-live-pending/ebd7e3e8…` (octocat). `list-live` now returns exactly 1 node (`ca648110…`, #2137, anchor `469af2bb…`); `recall-graph-live-pending/` empty; `merge-outcome/` + `world-anchor-edge/` absent (correct — no armed lane). The #2137 export join re-verified intact (node.anchor_id === att.anchor_id; att.repo=`Priivacy-ai/spec-kitty` pr_number=2137; merge_sha=`d91785ea…`).

**Wave 1c (proof-of-pipe: #2137 → Embers)** — `export-bank-pair` on `ca648110…` → a byte-valid `(node.json, meta.json)` pair (7-key node; v1-minimal meta with NO `mergeSnapshot` — the GAP-A drop Wave 2a fixes). Embers (`~/Documents/embers`, main): `keygen` (throwaway ed25519) → `bank` → `{banked:true, bundle_id:c5d1f44b…, mint_gate:"fail" [not-merged, no-distinct-reviewer], indexed:true, log_backend:persistent}` → `verify` (7/7 stages `[ok]`, VERIFIED full-chain offline) → `kindle` (**receiver-weight 0**, `minter_trust:0 repo_valuation:0.5 scope_fit:1`, mint-gate `fail` advisory-not-gated, lesson body wrapped in the DATA-NOT-INSTRUCTIONS fences). **Phase-1 exit MET**: #2137 is a banked+verified+kindled weight-0 bundle in the commons `_log/`+`_index/`; commons lesson-count = **1** (the K=1 stability-ledger seed). The `mint_gate:"fail"/not-merged` is the EXPECTED weight-0 signal (meta drops the merge evidence, GAP-A); nothing arms, nothing gates. Commons is a throwaway scratchpad dir (a persistent commons is an operator/Phase-4 decision).

## Stability Ledger

- **K=1** (2026-07-13): #2137 — arm→export→bank→verify→kindle clean, weight-0, ZERO new pipeline-bug. (Distinct cell: `boundary-contract|unguarded-edge-case|handle-edge-explicitly`; repo Priivacy-ai/spec-kitty #2137.) STABLE target = K=3 distinct-cell.

### Wave 2a result — GAP-A CLOSED (2026-07-13, toolkit-only)

`buildBankPair` now emits `meta.mergeSnapshot = { merged: true, merge_sha }` — the merge signal a verified `world_anchored` node already proves (`merged:true` derivable from `node.merge_sha`, itself sealed in the node's `content_hash`; never a fabricated richer signal). Embers already reads `meta.mergeSnapshot` (`publish.js:50` → `evaluateMintGate`), so **NO Embers change** was needed. Dogfood re-run of #2137: `mint_gate` flipped **`fail` → `weak`** (`gate_reasons: ["no-distinct-reviewer"]`; the `not-merged` FAIL is gone), receiver-weight still 0 (the gate annotates, never gates). **GAP-A exit MET** (verdict != fail; no hand-authored meta). The richer signals (merger identity, distinct reviewers, `merge_commit_parents`) are NOT in the node/att (never stored, R1'/#273), so Embers' generous SHADOW defaults apply — a future enhancement, and the merger-distinct default (absent→`false`→"self-merge") is a PRE-EXISTING coarse default (the empty-snapshot path already did it), NOT a Wave-2a regression. Tests: export-bank-pair 44→45, export-cli +1 assertion; full world-anchor green; eslint clean.

