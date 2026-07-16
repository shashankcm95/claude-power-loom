---
lifecycle: persistent
---

# Wave C — the persona accountability-pin forward-carry

**Status**: Proposed → pending `/verify-plan` (architect + code-reviewer) → USER approval before build.
**Date**: 2026-07-15
**Scope**: SHADOW / weight-0 / additive. A versioned v2 body on `live-recall-store.js` (the `world_anchored` node) + the DAM-safe pin-surfacing seam on `world-anchor-mint.js` + the pin pass-through in `mint-captured-merge.js` + tests. The `live-solve-one → queue` auto-wire is a SEPARATE follow-up (Wave D), OUT of scope here.

## Context — mint AT the solution path, not inferred from a stranger's diff

The USER's design correction ([[world-anchor-lesson-minted-at-solution-path]]): a bundle lesson must be MINTED AT THE SOLUTION PATH — a byproduct of OUR OWN persona's solve, `persona_def_ref`-accountable — never inferred from a stranger's merged diff (a fictional persona breaks provenance/accountability). The point is not to *gather* lessons but to *show what was learnt by building solutions*.

The capture already records that accountability at the solve. `packages/lab/causal-edge/live-pending-store.js` mints the `live_pending` hypothesis with the **Track-A-W2 persona-context pins** — `PIN_FIELDS = ['persona_def_ref', 'context_commons_ref', 'runtime', 'recall_graph_root']` (`live-pending-store.js:85`) — sealed into `content_hash` but **NOT** into `node_id` (excluded from `BASIS_FIELDS`, `:67`), via a v1/v2 discriminated exact-set. `persona_def_ref = sha256(canonicalJsonSerialize([briefMd, contractRaw]))` (`persona-prompt-materializer.js:147`) — the content-address of the persona DEFINITION (brief + contract bytes, pre-parse): "what the persona IS (version identity)". That is the accountability pin.

But the merge-time mint **drops it**. `collectCapturedCandidates` (`world-anchor-mint.js:258-267`) comments: *"The pins are NOT carried forward here — the forward-carry into the world_anchored node is a later wave (blueprint 3a)."* Only `{lesson_signature, lesson_body}` cross to `mintWorldAnchoredNode`. So the durable `world_anchored` lesson node — the permanent record — loses the `persona_def_ref` at exactly the moment it becomes permanent.

**Wave C IS that deferred forward-carry (blueprint 3a).** It threads the captured pin(s) from the `live_pending` node onto the minted `world_anchored` node, as NON-identity pins — sealed (tamper-evident), never a `BASIS_FIELD` (never in the content-address identity; never able to fork the `node_id`). The USER's constraint, verbatim: "persona-carry as a NON-identity pin — the USER accountability point; never a BASIS_FIELD."

## The design decision (surfaced for the board)

**D1 — carry the FULL pin bundle, or just `persona_def_ref`?** Proposal: carry the full `PIN_FIELDS` bundle (all four), verbatim from the captured node, mirroring live-pending's atomic `PIN_FIELDS` unit. Rationale: (a) lossless — the values already exist on the capture; dropping the three siblings loses solve-provenance permanently at the durable node; (b) one schema, no future v3 churn when a consumer wants the sibling context; (c) not speculative — we preserve what the capture recorded, we don't invent. `persona_def_ref` is the headline accountability pin; the siblings (`context_commons_ref` = what the actor received, `runtime`, `recall_graph_root`) are the solve context that makes the accountability legible. **The board rules: full-bundle (proposed) vs persona-only (narrower/YAGNI).**

**D2 — always-v2 write, or v2-only-when-a-pin-is-present?** [**SUPERSEDED at VALIDATE → CONDITIONAL-v2; see `## VALIDATE result`.**] Original proposal: `buildBody` ALWAYS emits v2. This was REVERSED after the code-reviewer HIGH: always-v2 makes the two no-pin mint callers (`record-manual-merge`, `mintFromMergeOutcome`) re-mint a pre-existing v1 node as v2 → a `content_hash` collision instead of a dedup, an idempotency loss the poller-only fix didn't cover. The adopted design is **conditional-v2** (v2 iff a pin is carried; a no-pin mint stays v1 and dedups cleanly). The "same lesson two shapes" collision the original feared is now the RARE two-paths-for-one-PR case, handled by the poller's collision-idempotent advance.

## Routing Decision

Verbatim `route-decide.js` (the substrate-meta lexicon-miss again — `stakes`/`audit` tokens unmatched; the task is architect-shaped: it touches a #273-hardened content-address basis + a cross-repo parity seam + the weight-0 invariant. Escalated by the `/verify-plan` gate + judgment per the H.7.16 substrate-meta catch-22):

```json
{ "recommendation": "root", "confidence": 0.75, "score_total": 0.075, "scores_by_dim": { "stakes": 0, "audit_binary": 0, "scope_size": {"matched": ["multi-file"]} } }
```

## HETS Spawn Plan

The `/verify-plan` board (read-only lenses):

| Persona | Role | Why |
|---|---|---|
| 04-architect | design | D1 (full-bundle vs persona-only); D2 (always-v2 vs conditional); the v1/v2 discriminated-exact-set migration; whether the cross-repo #578 vector + the shared `verifyNodeBody` export seam stay invariant under an ADDITIVE v2 (v1 read-branch byte-identical) |
| 03-code-reviewer | correctness | the discriminated exact-set read gate (partial-pin / injected-key / stripped-pin all rejected, mirroring live-pending's `V1_KEYS`/`V2_KEYS`); the DAM-safe resolver extension (no new import); the pin pass-through wiring; the four exact-set tests that must be re-expressed to the discriminated shape |

The adversarial (`hacker`) lens + the `honesty-auditor` lens run at the post-build VALIDATE (Rule 2 — this touches a #273 store): the hacker re-probes the BUILT read gate (can a forged v2 body ride an injected key past the seal? can a v1↔v2 downgrade strip a pin silently?); the honesty-auditor rates the weight-0/no-leak + cross-repo-invariance claims against the actual test output.

## Files To Modify

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/lab/world-anchor/live-recall-store.js` | modify | high | add `SCHEMA_VERSION_V2` + `PIN_FIELDS` + `V1_KEYS`/`V2_KEYS`; `validateBlock` bounds the present pins (a LOCAL `isValidPinRefValue` copy — deliberate-duplication discipline, NOT a cross-module import); `buildBody` always-v2 defaulting; `verifyNodeBody` discriminated exact-set. `BASIS_FIELDS` STAYS 5-wide (pins non-identity). **`STORED_KEYS` is RETAINED as the 7-key v1 alias (= `V1_KEYS`)** so `export-bank-pair.js:40,92` still imports it + its load-time drift-check stays green. Mirror `live-pending-store.js:84-91,377-382` |
| `packages/lab/world-anchor/world-anchor-mint.js` | modify | medium | extend `resolveCapturedSignatureForAttest` return (`:593`) to also surface the pins read off `byPatch[0]` (already the deep-frozen v2 body) — the DAM-safe seam; no new import |
| `packages/lab/world-anchor/mint-captured-merge.js` | modify | medium | read the pins off `cap` and pass them into `mintWorldAnchoredNode`; **carry `node_id` on a `mint-collision`** so the poller can idempotently advance (see the migration-hazard fix) |
| `packages/lab/world-anchor/export-bank-pair.js` | modify | **high** | **(export-seam fix — VERIFY blocking)** after `verifyNodeBody` passes, REFUSE a v2 node (`node.schema_version !== undefined`) with an observable `v2-node-not-exportable` (else `reconstructNode`'s 7-key whitelist strips the pins while keeping the v2-sealed `content_hash` → a self-inconsistent cross-repo export). The bank lane is operator-gated (`cli.js:411`, NOT the active SHADOW path), so refusing regresses nothing; the v1-projection (pins dropped at the boundary) is named O-series work |
| `packages/lab/solve-queue/merge-promote.js` | modify | medium | **(migration-hazard fix — VERIFY blocking)** in `promoteOneMerged`, before the `/^(attest\|mint)-/ → errors` branch, treat `m.reason === 'mint-collision'` (with `m.node_id`) as an IDEMPOTENT advance-to-`minted` (a node already exists for this lesson identity → the promote goal is met), observable; never a stuck error |
| `tests/unit/lab/world-anchor/live-recall-store.test.js` | modify | high | re-express the exact-set tests (`267-278`, `443-446`, `448-456`, the `validBody()` 7-key comment `420-424`) to the discriminated V1/V2 shape; add: a v2 node round-trips the pins; a partial-pin/injected-key/stripped-pin v2 is rejected; a v1 grandfather still reads; the pin is NOT in `node_id` (two mints differing only by pin collide) |
| `tests/unit/lab/solve-queue/merge-promote.test.js` | modify | medium | **(mintCapturedMerge is exercised HERE, not in a separate file)** add: a captured pin flows onto the minted node (`readLiveNode(node_id).persona_def_ref === <capture's>`); an empty-pin capture mints a `''`-pin node; still weight-0 (admit-refused); a `mint-collision` on a pre-existing node advances idempotently to `minted` (the stuck-entry fix) |
| `tests/unit/lab/world-anchor/world-anchor-mint.test.js` | modify | low | assert the extended resolver returns the pins (+ still gates exact-one) |
| `tests/unit/lab/world-anchor/export-bank-pair.test.js` | modify | medium | add: a v2 node → `buildBankPair` refuses `v2-node-not-exportable` (observable); a v1 node exports unchanged; the frozen #578 vector stays green |
| `packages/lab/world-anchor/README.md` (or live-recall header) | modify | low | document the v2 pin-carry + the three named residuals + the bank-lane v2-refuse |

## Design

- **`live-recall-store.js` v2 (mirror the live-pending precedent EXACTLY):**
  - `SCHEMA_VERSION_V2 = 2`; `PIN_FIELDS = Object.freeze(['persona_def_ref', 'context_commons_ref', 'runtime', 'recall_graph_root'])` (same names + order as live-pending, so a verbatim forward-carry).
  - `BASIS_FIELDS` UNCHANGED (`['anchor_id', 'provenance', 'merge_sha', 'lesson_signature', 'lesson_body']`) → `deriveLiveNodeId` reads the SAME 5 fields → **the pin is never in `node_id`** (the USER's non-identity constraint; two mints differing only by a pin share a `node_id` and dedup/collide, never fork).
  - `V1_KEYS = [...BASIS_FIELDS, 'node_id', 'content_hash']` (the current 7-key grandfather shape); `V2_KEYS = [...BASIS_FIELDS, 'schema_version', ...PIN_FIELDS, 'node_id', 'content_hash']`.
  - `validateBlock`: bound each PRESENT pin (persona/context/recall = `''`-or-HEX64 via a shared `isValidPinRefValue`; `runtime` = bounded canonical-json string, REJECT-not-truncate), tolerant of absent (buildBody defaults). `schema_version` present → must be 2.
  - `buildBody`: ALWAYS emit v2 (schema_version:2 + all four pins, absent → `''` sentinel). `content_hash` seals the full body (pins included → tamper-evident); `node_id` seals only BASIS_FIELDS (pins excluded → non-identity).
  - `verifyNodeBody`: the DISCRIMINATED exact-set — `expected = parsed.schema_version === SCHEMA_VERSION_V2 ? V2_KEYS : V1_KEYS`; reject `unexpected` (extra) AND `missing` (partial/stripped) keys; then the own-property gate + both seal re-derivations (unchanged order: exact-set BEFORE the seals — an injected key must not ride inside a self-consistent seal). A partial-pin / injected-key / v1+pin / stripped-pin-v2 body matches NEITHER shape → rejected (`unexpected-field`/`missing-field`).
- **The DAM-safe pin seam:** `resolveCapturedSignatureForAttest` (`world-anchor-mint.js:559`) already reads the full deep-frozen v2 capture body at `byPatch[0]` (`:568`, from `listLivePendingLessons`). EXTEND its return from `{ok, lesson_signature, lesson_body}` to also carry the pins: `{ok, lesson_signature, lesson_body, pins: {persona_def_ref, context_commons_ref, runtime, recall_graph_root}}` (read off `byPatch[0]`, defaulting each absent field to `''`). `mint-captured-merge.js` NEVER imports `live-pending-store` (the reader dam admits only `world-anchor-mint.js`); it sources the pins through this one admitted reader. `world-anchor/cli.js`'s `runAttestFromCapture` reads only `.lesson_signature` today → additive, unaffected.
- **The pass-through:** `mint-captured-merge.js` reads `cap.pins` and passes it into `mintWorldAnchoredNode({anchor_id, merge_sha, lesson_signature, lesson_body, ...cap.pins})`. Node stays node-only → `admitWorldAnchorNode` refuses `no-authenticated-edge` → **weight 0**; `LIVE_SOURCES` stays `Object.freeze([])`.
- **The export-seam v2-refuse (VERIFY blocking fix):** `STORED_KEYS` is RETAINED as the 7-key v1 alias (`= V1_KEYS`) so `export-bank-pair.js:40,92` still resolves + its load-time drift-check passes. In `buildBankPair`, AFTER `verifyNodeBody` passes (line 120), add: `if (node.schema_version !== undefined) { alert('v2-node-not-exportable', {...}); return { ok: false, reason: 'v2-node-not-exportable' }; }` — fail-closed, before `reconstructNode` can strip pins under a v2 seal. `export-bank-pair.js` gains ONE observable-alert import (it currently has none — it is a pure assembler; the refuse can instead be a bare `{ok:false}` that the CLI caller logs, mirroring the module's existing `{ok:false,reason}` contract, to keep it I/O-free — DECIDE at build: prefer the bare `{ok:false,reason}` to preserve the pure-core property, and let `cli.js:411`'s caller surface it).
- **The collision-idempotent poller fix (VERIFY blocking fix):** `mintCapturedMerge` — on a `mintWorldAnchoredNode` collision, return `{ ok:false, reason:'mint-collision', node_id: mint.node_id }` (carry the id; the store already returns it at `live-recall-store.js:234`) + the existing observable refuse-alert. `merge-promote.promoteOneMerged` — before the generic `/^(attest|mint)-/` → `errors` branch, add: `if (m.reason === 'mint-collision' && m.node_id) { const adv = queue.advance({entry_id, to_state:'minted', evidence:{}}, {dir}); ...; summary.minted.push({entry_id, node_id: m.node_id, deduped:true}); alert('collision-idempotent-minted', {...}); return; }`. A node already exists for this (anchor, lesson) identity (node_id is over the 5-field basis → same lesson content) → the promote goal is met → advance, don't stick.

## Cross-repo invariance (the load-bearing safety argument — REVISED post-verify)

Two distinct cross-repo surfaces, both must stay sound (the first verify pass proved only the first):

1. **The frozen v1 parity vector.** `verifyNodeBody` is EXPORTED and SHARED with the toolkit→Embers export seam (`export-bank-pair.js:40`, `live-recall-store.js:381-383`), and the frozen #578 vector (`export-bank-pair.test.js` + Embers `content-address.test.js`, the pinned dogfood node `c411ae69…`) is a **v1** (7-key) body. The v2 change is ADDITIVE: the v1 read-branch (`schema_version` absent → `V1_KEYS`) is byte-identical to today's `STORED_KEYS` gate, and `deriveLiveNodeId` / `computeContentHash` are UNCHANGED. The frozen v1 vector still verifies via the v1 branch. **`STORED_KEYS` STAYS the 7-key set** (= `V1_KEYS`), so `export-bank-pair.js:92`'s module-load drift-check (`NODE_EMIT_ORDER.length !== STORED_KEYS.length`) stays green — removing/widening it would brick the #578 test file at REQUIRE.
2. **The forward v2-export path (the gap the first pass missed).** Post always-v2, the operator `bank` CLI (`world-anchor/cli.js:411`) reads a v2 node via `readLiveNode` and hands it to `buildBankPair`. `verifyNodeBody` ACCEPTS the v2 body, but `reconstructNode` (`export-bank-pair.js:84-89`) copies only the 7 `NODE_EMIT_ORDER` keys while keeping the **v2-sealed** `content_hash` (over 12 fields) → a self-inconsistent export that fails Embers' seal re-derivation. **Fix: `buildBankPair` REFUSES a v2 node** (`node.schema_version !== undefined` → `{ok:false, reason:'v2-node-not-exportable'}` + an observable alert), fail-closed. The bank lane is operator-gated + deferred (the O-series cross-repo crossing), so refusing v2 regresses NOTHING on the active SHADOW path; the v1-projection (drop pins at the boundary, re-derive a v1 `content_hash`) is a NAMED O-series residual — pins are toolkit-local until the authenticated minter arms, so they should NOT cross to the external commons in Wave C anyway.

**VALIDATE MUST PROVE (not assert):** `export-bank-pair.test.js` + the Wave-2b parity tests green post-change; a v2 node is refused by `buildBankPair`; the frozen v1 vector still exports.

## Named residuals (honesty — mirror live-pending)

1. **v1-grandfather-collides-on-re-mint** (PROBED — 1 real v1 node exists; handled, not just named): a pre-existing v1 `world_anchored` node + a re-mint (now always-v2) → same `node_id` (basis unchanged), different `content_hash` (v2 adds fields) → an OBSERVABLE `collision` reject. **Probe (this session): `ls ~/.claude/lab-state/recall-graph-live/` → ONE v1 node (`ca648110…`, `schema_version` ABSENT — the #2137 Phase-3 dogfood mint); `~/.claude/lab-state/solve-queue/` ABSENT (no queue entries).** So today the hazard is INERT (the v1 node reads fine via the grandfather branch; nothing re-mints it — the queue is empty). BUT once Wave D's auto-wire populates the queue, a crash-stranded `merged` entry whose node was minted v1 would re-sweep → `mint-collision` → (unfixed) `merge-promote.js:86` routes `/^mint-/` to `errors` → the entry STICKS at `merged`, erroring every sweep. **FIX (not just a residual): `mintCapturedMerge` carries `node_id` on a collision; `merge-promote.promoteOneMerged` treats `mint-collision` (node exists for this lesson identity → the promote goal is met) as an IDEMPOTENT advance-to-`minted`, observable.** The collision-as-success interpretation is SHADOW-safe (the node gates nothing); the arming-time revisit (item 5): when a node gates a weight, a collision must be re-examined, not blindly accepted.
2. **the pin is integrity-sealed, NOT provenance-authenticated** (#273): `content_hash` proves the pin's self-consistency, not that the legitimate persona produced it — a same-uid process can co-forge a byte-consistent v2 node with any `persona_def_ref`. Tolerable ONLY because the node is weight-INERT (LIVE_SOURCES frozen-empty + the two dams + admit-refused). The authenticated cross-uid minter (item 5) is the prerequisite before any pin gates a weight. Carrying the pin onto a weight-inert node does NOT change its trust posture; do NOT over-claim the pin as authenticated.
3. **the #273 grandfather-downgrade** (mirror `live-pending-store.js:75-83`): schema_version + pins are non-identity, so a v1 body and a v2 body for the same basis share a `node_id`; a same-uid writer can overwrite a v2 node with a re-sealed v1 body → reads back as a clean grandfather with pins silently gone. INERT here (0 pin readers, weight-inert). FORWARD-HAZARD: once a pin gates anything, "no pins" MUST be proven by an AUTHENTICATED v2 marker, never inferred from pin-absence.

## Runtime Probes (claims verified against the repo this session)

| Claim | Probe → result |
|---|---|
| live-pending already carries `PIN_FIELDS` as a v2 non-identity shape | Read `live-pending-store.js:67,85,90-91,377-382` → confirmed (`BASIS_FIELDS` excludes pins; `V1_KEYS`/`V2_KEYS` discriminated) |
| `persona_def_ref` = content-address of the persona definition | Read `persona-prompt-materializer.js:147` → `sha256(canonicalJsonSerialize([briefMd, contractRaw]))` |
| `mint-captured-merge.js` is already dir-admitted to import live-recall-store | recon agent 3: `shadow-import-graph.test.js:124` sibling-dir skip (`WORLD_ANCHOR_DIR`); it already imports `mintWorldAnchoredNode` (`:24`) |
| the pins are already on `byPatch[0]` in the resolver (no new import to surface them) | recon agent 3 + read `world-anchor-mint.js:565-570` → `listLivePendingLessons` returns the full v2 body; `byPatch[0]` holds the pins |
| the live-recall exact-set tests to update | recon agent 3 + read: `live-recall-store.test.js:267-278, 443-446, 448-456, 420-424` |
| the persona-attribution store is ORTHOGONAL (must not source from it — would break the exactly-one-reader dam) | recon agent 2: `(repo,pr_number)→name` map; `lookupPersonaForPr` has exactly one reader (`circuit-breaker/project.js:200`); a second reader breaks `tests/unit/lab/world-anchor/persona-attribution-shadow.test.js` |
| the dam that admits `mint-captured-merge` to import live-recall-store | `tests/unit/lab/world-anchor/shadow-import-graph.test.js` (sibling-dir skip on `WORLD_ANCHOR_DIR`) — corrected path (was abbreviated) |
| how many pre-existing v1 `world_anchored` nodes in the REAL ledger (the migration-hazard input) | `ls ~/.claude/lab-state/recall-graph-live/*.json` → **1 node (`ca648110…`, `schema_version` ABSENT = v1)**; per-node `schema_version` checked via `node -e` |
| the real solve-queue state (can the stuck-entry bug fire today?) | `ls ~/.claude/lab-state/solve-queue/` → **ABSENT** (no entries) → the poller has nothing to re-sweep; the hazard is inert until Wave D populates the queue |
| the export-seam `STORED_KEYS` coupling (the module-load throw) | read `export-bank-pair.js:40,84,92` → imports `STORED_KEYS`; throws at REQUIRE if `NODE_EMIT_ORDER.length !== STORED_KEYS.length` |
| `buildBankPair` is operator-gated, not on the active SHADOW path | `grep buildBankPair` → sole caller `world-anchor/cli.js:411` (the `bank` CLI arm; the deferred O-series crossing) |
| v1 derivation unchanged keeps the #578 cross-repo vector + export seam green | ASSERTED here; PROVEN at VALIDATE by running `export-bank-pair.test.js` + Wave-2b parity tests + the new v2-refuse test (not yet run — a VALIDATE gate, not a pre-build claim) |

## Test plan (TDD-treatment — this is a ≥80 LoC #273-store change whose existing tests describe changing behavior)

Rewrite the exact-set tests FIRST (the failing set is the behavioral spec), then implement:

1. a v2 node round-trips all four pins (`readLiveNode(id).persona_def_ref === <minted>`), deep-frozen.
2. a v1 grandfather (no schema_version, 7 keys) still reads back (byte-identical to today).
3. the discriminated exact-set: a v2-with-injected-8th-key → `unexpected-field`; a v2-with-a-pin-stripped → `missing-field`; a v1-carrying-a-pin → rejected; each OBSERVABLE.
4. the non-identity proof: two mints identical except `persona_def_ref` → same `node_id` → the second is a `collision` reject (NOT a fork).
5. still weight-0: `admitWorldAnchorNode` on a v2 node → refused `no-authenticated-edge`.
6. the forward-carry end to end (`mint-captured-merge.test.js`): a seeded capture with `persona_def_ref` → the minted node carries it; an empty-pin capture → a `''`-pin node.
7. cross-repo invariance (VALIDATE gate): `export-bank-pair.test.js` + the Wave-2b parity tests stay green.

## Principle Audit (explicit — this is a #273-store change)

- **Open/Closed**: the v2 shape is ADDITIVE — a new schema branch alongside v1, not a rewrite of the v1 path. `deriveLiveNodeId` / `computeContentHash` untouched; v1 nodes read identically.
- **DRY-via-mirror, NOT DRY-via-import**: the v2 pattern mirrors `live-pending-store.js`'s already-shipped V1/V2 discriminated exact-set. The pin validators (`isValidPinRefValue`) are a LOCAL copy per the codebase's explicit deliberate-duplication discipline (`live-recall-store.js:262` "each read path is audited independently") — NOT a cross-module import (which would also need dam clearance).
- **Single Responsibility**: the store owns the schema + seal; the resolver owns the dam-safe read seam; `mint-captured-merge` owns the pass-through; `merge-promote` owns the queue-advance policy (incl. the collision-idempotent interpretation). No responsibility leaks across.
- **YAGNI**: D1 (full-bundle) preserves data the capture ALREADY records (not speculative); the v1-projection export is DEFERRED to the O-series (not built ahead of the cross-repo crossing's need).
- **Security (integrity ≠ provenance)**: the pin is `content_hash`-sealed (tamper-evident) but same-uid co-forgeable — NOT authenticated. Framed as such everywhere; never wired to a weight. `BASIS_FIELDS` stays 5-wide → the non-identity property is structural, not conventional.

## Estimate

Moderate #273-store wave, comparable to Wave A/B: ~6 source edits (2 substantive — live-recall-store v2 + the resolver seam; 4 small — mint pass-through, export-refuse, merge-promote collision branch, README) + ~4 test files. TDD-first (the exact-set rewrites are the spec). One sitting; the export-seam + collision fixes are localized. No new external dependency; no CI-workflow change.

## Build-time design refinement (VALIDATE evidence — refuse-v2 → v1-projection)

The plan (and the `/verify-plan` board) chose the MINIMAL export-seam fix: `buildBankPair` REFUSES a v2 node (`v2-node-not-exportable`), on the premise "the bank lane is operator-gated, so refusing regresses nothing on the active path." **The build falsified that premise's scope:** running the suite surfaced that `tests/unit/lab/world-anchor/export-cli.test.js` (the `bank` CLI arm, ~14 tests) mints nodes via the store and exports them — so refuse-v2 does not merely *defer* the bank lane, it **dead-ends a shipped, TESTED capability** for every post-Wave-C (always-v2) node. A real regression, not a deferral.

**Refinement (adopted): the v1-PROJECTION the plan named as the O-series alternative.** `buildBankPair` now DOWNGRADE-projects a v2 node to its canonical v1 shape (`projectToV1Body`: drop `schema_version` + pins, re-derive a v1 `content_hash`, preserve `node_id`) and emits THAT. The pins are dropped at the export boundary (toolkit-local — integrity-sealed, not provenance-authenticated — they must not cross to the external commons until the authenticated minter arms), the shipped bank lane keeps working, and the emitted node is a self-consistent v1 body Embers accepts unchanged. The frozen #578 v1 vector is untouched (a fixed literal, not a projection); the export-cli suite is meaningful again (15 green post-Wave-C-test). A Rule-2a catch: the BUILT code's test surface revealed the design premise was too narrow. (NOTE: this section describes the FIRST refinement; the `## VALIDATE result` below records the SECOND — always-v2 → conditional-v2 — which is the final `buildBody` design. The refuse-v2 language in the earlier Files-To-Modify / Design / Cross-repo / Pre-Approval sections is superseded by the projection here.)

## Drift Notes

- Extending the plan runtime-probe step to the shadow-import store-DAMS paid off again: recon agent 3 pre-cleared the two dams (world-anchor sibling-dir + live-pending reader allowlist) BEFORE the build — the self-improve candidate from the Wave A/B snapshot, applied. The one dam that touches the FUTURE auto-wire (`drafter-recall-disjointness`) was also pre-mapped (agent 1) so Wave D won't surprise.
- **The export-seam coupling was the miss the `/verify-plan` board caught** (both lenses): a store-schema change rippled into a SEPARATE module (`export-bank-pair.js`) via an exported `STORED_KEYS` + a module-load drift-throw + a live CLI export path. Drift-note candidate: "when a store adds a schema version, grep every importer of its exported key-set / shape constants — a downstream reconstructor or a load-time drift-assert can break forward-compat even when the store's own reads stay green." (Sibling of the shadow-import-dam probe: that one guards WHO imports; this one guards WHAT they do with the exported shape.)

## Pre-Approval Verification

Spawned architect (`04-architect`) + code-reviewer (`03-code-reviewer`) in parallel against the plan (both read the real source + the precedent). Both returned **NEEDS-REVISION**, converging on the export-seam gap. All findings resolved inline below; the core store-schema design (discriminated exact-set, non-identity pins, always-v2 `buildBody`, the dam-safe resolver seam) PASSED both lenses.

### Blocking findings (both lenses) — RESOLVED

1. **Export-seam forward-compat break** (code-reviewer item 8; architect "cross-repo invariance UNSOUND"). `export-bank-pair.js:40` imports `STORED_KEYS` with a module-load throw on width drift; `reconstructNode` emits 7 keys but keeps the v2 `content_hash` → a v2 node exports self-inconsistent; the plan's invariance argument covered only the frozen v1 vector. **Fixed** [the refuse-v2 resolution here was SUPERSEDED at build → v1-projection; see `## VALIDATE result`]: `STORED_KEYS` RETAINED as the 7-key v1 alias (load-check green); `buildBankPair` now DOWNGRADE-PROJECTS a v2 node to v1 (not refuse) so the bank lane keeps working + pins stay toolkit-local. Added `export-bank-pair.js` + its test to Files-To-Modify; rewrote the Cross-repo section.
2. **Migration hazard / stuck-entry** (architect CRITICAL). A crash-stranded `merged` entry that minted a v1 node re-sweeps under always-v2 → `mint-collision` → `merge-promote.js:86` routes `/^mint-/` to `errors` → entry stuck, erroring every sweep. **Fixed**: PROBED the real ledger (1 v1 node; queue empty → inert today) + added the collision-idempotent poller fix (mintCapturedMerge carries `node_id`; merge-promote advances-to-`minted` on `mint-collision`). Added `merge-promote.js` + the test to Files-To-Modify; rewrote residual #1.

### Un-probed runtime claims (architect FAIL) — RESOLVED

3. "~no v1 nodes in the real ledger" — **Fixed**: probed (`ls` → 1 v1 node; queue absent); folded into residual #1 + Runtime Probes. Corrected the abbreviated `shadow-import-graph.test.js` path (→ `tests/unit/lab/world-anchor/`). Added the export-seam coupling probe + the `buildBankPair`-caller probe.

### FLAGs — RESOLVED / ACKNOWLEDGED

4. **No Principle Audit section** (architect) — **Fixed**: added above.
5. **No estimate** (architect) — **Fixed**: added above.
6. **"shared `isValidPinRefValue`" ambiguity** (code-reviewer item 5) — **Fixed**: clarified as a LOCAL duplicate (deliberate-duplication discipline), not a cross-module import, in Files-To-Modify + the Principle Audit.
7. **`mint-captured-merge.test.js` path doesn't exist** (code-reviewer item 8b) — **Fixed**: the pin-carry assertions go into the EXISTING `tests/unit/lab/solve-queue/merge-promote.test.js` (where `mintCapturedMerge` is already driven); dropped the phantom file.
8. **D2 rationale "partially self-defeating"** (architect item 8) — **Acknowledged**: always-v2 relocates (not removes) the v1-grandfather collision; that residual is now PROBED + FIXED (the collision-idempotent poller), so the relocation is handled, not hand-waved. Always-v2 retained for schema-uniformity + precedent-parity with live-pending.
9. **D1 "persona-carry" literal-vs-full-bundle tension** (architect item 1) — **RESOLVED by USER (2026-07-15): FULL BUNDLE (all 4 pins).** The durable node carries all four capture pins verbatim (lossless; no future v3), with `persona_def_ref` as the accountability headline.

### Overall: READY — USER-approved (design fork D1 = full-bundle); build authorized

Weight-0, no security regression (neither lens said BLOCKED). The two blocking gaps are closed with concrete fixes + probes; the design mirrors a shipped precedent. D1 resolved (full pin bundle). Proceeding to TDD build.

## VALIDATE result (post-build 3-lens — the AUTHORITATIVE final design)

The built diff was re-probed by three parallel read-only lenses (Rule 2, a #273-store change): `hacker` (adversarial live re-probe, Rule 2a) + `code-reviewer` (correctness) + `honesty-auditor` (claim-vs-evidence). Final suite: **lab 164/0, kernel 125/0, hooks 15/0, eslint clean, all drift gates clean.**

### Lens verdicts

- **hacker — CLEAN (0 CRITICAL/HIGH/MEDIUM bypasses).** 9 live probes across 6 attack classes; every guarantee held: the discriminated exact-set (all 6 injection variants + a `__proto__` on-disk plant rejected pre-seal), the non-identity property (two pins → byte-identical `node_id`), `projectToV1Body` (pin stripped, id preserved, self-consistent, no launder), the resolver `''` defaulting (no `undefined` leak), the collision node_id bound to its own basis (no cross-entry advance), and weight-0 (a v2 pin node stays `admit`-refused). One **LOW (L1)** — the collision-idempotent poller would advance on an UNVERIFIABLE existing file (same-uid tamper/corruption only, observable). **FIXED**: `mintCapturedMerge` now readback-gates the idempotent signal (`readLiveNode` must confirm a verifiable node; else a hard `mint-collision-unverifiable` the poller routes to errors).
- **code-reviewer — Warning (1 HIGH, 1 MEDIUM, 1 LOW).**
  - **HIGH — incomplete migration-hazard coverage.** Always-v2 made ALL three `mintWorldAnchoredNode` callers collide on a re-mint of a pre-existing v1 node, but the collision-idempotent fix covered only the poller lane; `record-manual-merge` + `mintFromMergeOutcome` (which minted the one real v1 node `ca648110`) still hard-refused. **FIXED at the ROOT: conditional-v2** — `buildBody` emits v2 iff a pin is carried, so the no-pin paths stay v1 and DEDUP cleanly with an existing v1 node (no per-caller patch needed). New test proves the cross-version dedup.
  - **MEDIUM — `deduped` mislabeled.** The success path dropped the store's real `deduped` flag; `merge-promote` inferred it from `!m.ok` (wrong for a genuine store-dedup). **FIXED**: `mintCapturedMerge` propagates `mint.deduped`; `merge-promote` uses `m.ok ? !!m.deduped : true`.
  - **LOW — `readNodeRaw` ~54 lines.** Informational (comment-dense house style); left as-is.
- **honesty-auditor — B / MINOR-OVERCLAIMS (0 trust-overclaims).** All 6 load-bearing claims (weight-0, non-identity, cross-repo invariance, integrity≠provenance, the refinement, the Pre-Approval honesty) substantively hold; nothing over-claimed as authenticated/trusted. Precision flags **FIXED**: this section supersedes the stale always-v2/refuse-v2 language in the earlier sections; the resolver JSDoc now documents `lesson_body` + `pins`; the "14/15 green" stat corrected. Noted (not-my-code, left): `weight-source-gate.js:55` is `Object.freeze(isWorldAnchorArmed() ? [...] : [])` — the un-armed empty freeze holds (SHADOW), but the literal "stays `Object.freeze([])`" is only true un-armed; `merge-promote.js:10`'s `no-authenticated-edge` framing is imprecise (the un-keyed admit refuses at `no-verify-key` step 0 first) — both pre-existing, outcome (`admitted:false`) sound.

### The two design pivots adopted at build/VALIDATE (final design)

1. **Export seam: refuse-v2 → v1-PROJECTION** (build-time, export-cli evidence). `buildBankPair` downgrade-projects a v2 node to v1 (`projectToV1Body`) instead of refusing; pins stay toolkit-local, the bank lane keeps working.
2. **Write shape: always-v2 → CONDITIONAL-v2** (VALIDATE HIGH). `buildBody` emits v2 iff a pin is carried; no-pin mints stay v1 and dedup with existing v1 nodes.

Both keep the invariants the lenses verified: non-identity pins, weight-0, the discriminated exact-set, and the frozen #578 cross-repo vector. **These supersede the always-v2 / refuse-v2 language in the earlier Design / Files-To-Modify / Cross-repo / Named-residuals / Pre-Approval sections.**
