---
title: "Track A, Wave 2 — persona-context pins on the live_pending signed basis (SHADOW)"
status: PLAN (authored 2026-07-10; awaiting /verify-plan + USER approval before build)
created: 2026-07-10
lifecycle: persistent
derives_from:
  - packages/specs/research/2026-07-10-plugin-learning-wire-blueprint.md   # blueprint Wave 2 + the board
  - packages/specs/plans/2026-07-10-external-readiness-checklist.md         # A2 gate row
  - packages/specs/plans/2026-07-10-track-a-wave1-recall-boundary.md        # W1 (#566), the sibling wave
---

# Track A, Wave 2 — persona-context pins on the `live_pending` signed basis (SHADOW)

## Context

The external-readiness checkpoint's **Layer 3** (minted lessons + persona) is PARTIAL: the live loop already
mints a `live_pending` HYPOTHESIS node on every eligible solve, but persona is only an unauthenticated
`built_by`-style LABEL — **the node's signed basis (`content_hash`) carries no persona at all**. That is the
gap8-a0b integrity gap: a merge to persona attribution is authenticated only if the plugin binds persona into
the node's SIGNED basis at mint; a self-asserted side-label does not.

This wave binds the persona-context **into the `live_pending` node's `content_hash`-sealed body** at the
earliest mint point (the draft, where persona + materializer output + runtime facts are all in hand). It
captures "what the actor received" as HASHES (not payloads) and seals them tamper-evidently.

**Scope (USER-chosen 2026-07-10 — blueprint Wave 2 only):** the pins land on the **`live_pending`** node
(one content-addressed store migration) + the `recall_graph_root` helper. Carrying the pins FORWARD into the
`world_anchored` node (blueprint Wave 3a) is the **following** wave — deferred so the cross-repo-bound
`world_anchored` shape is co-designed with Embers at A3 rather than frozen unilaterally now. The Embers `bank`
export (Wave 4) is A3.

Per OQ-NS-6, nothing here HARDENS trust. The pins are SHADOW metadata on a weight-inert node: no ranking /
weight / spawn-selection consumer reads them; the node's two dams (`LIVE_SOURCES` frozen-empty + the
import-graph writer-allowlist) stand unchanged. This is INTEGRITY (tamper-evidence), NOT PROVENANCE — a
same-uid process can still co-forge a byte-consistent node; the authenticated cross-uid minter (operator
arming, the #273 close) is the prerequisite before any pin gates anything. **This build adds no reader, no
weight, no arming.**

## Routing Decision

```json
{
  "task": "Track A Wave 2 — persona-context pins on the live_pending signed basis (SHADOW)",
  "route-decide": { "recommendation": "borderline", "score_total": 0.35, "confidence": 0.167 },
  "resolution": "ESCALATE to route (architect + full 3-lens verify). Judgment override of the borderline score: this is a content-addressed schema migration binding persona provenance into a #273-family signed basis + a fail-soft data-flow plumbing change across the live-solve path. The seal-extension correctness (a pin must be inside content_hash yet outside node_id) and the backward-compat read (grandfather nodes) are genuine tradeoffs the hacker/code-reviewer lens must probe. Borderline-not-root because the stakes lexicon under-weights 'schema migration' / 'signed basis'."
}
```

## HETS Spawn Plan

Pre-approval (`/verify-plan`, this plan) and post-build (VALIDATE, the diff) both run the security tier — the
change extends a #273 content-address seal + threads new data into a live-actor mint path:

- **architect** (read-only) — the schema-migration design: are the pins correctly `content_hash`-sealed but
  NON-identity? is the v2 backward-compat model sound (grandfather + the v1/v2 dedup edge)? is the pin set
  right (the declared-vs-attested question)? are the SRP seams (materializer computes / store seals / writer
  threads) clean?
- **code-reviewer** (read-only) — correctness of the `buildBody`/`validateBlock`/`STORED_KEYS`/`content_hash`
  extension, the fail-soft plumbing (a pin computation that throws must not break the never-throws mint), the
  nullable-sentinel typing, the test-fixture migration completeness.
- **hacker** (read-only, VALIDATE on the BUILT diff per Rule 2a) — attack the seal: can an injected pin key
  ride inside a "verified" node? can a forged/omitted pin pass the exact-set read? does a v1 grandfather node
  become a laundering vector? does a pin become a covert weight/ranking input anywhere? build live probes
  against the built store.

Pre-build: architect + code-reviewer + hacker (this `/verify-plan`, security tier per Rule 2). Post-build
VALIDATE: code-reviewer + hacker + honesty-auditor, on the diff (Rule 2a).

## Principle Audit

- **SRP** — three distinct change-drivers stay distinct: the **materializer** COMPUTES the persona refs
  (`persona_def_ref` + `context_commons_ref`); the **store** SEALS the pins (`buildBody`/`content_hash`); the
  **writer** THREADS them into the mint block. No layer takes on another's reason-to-change.
- **OCP** — the store schema is EXTENDED to a v2 shape (new pin keys added alongside), never a rewrite of the
  v1 seal; the v1 read path is preserved for grandfather nodes. New behavior added, existing untouched.
- **DRY** — reuse the existing content-address primitive (`canonicalJsonSerialize` + `crypto.sha256`, the
  exact `deriveLivePendingNodeId`/`computeContentHash` idiom), the existing `renderFencedBoundedBlock`
  materializer output, the existing `deps.<name>Fn || realDefault` seam. Invent NO new hasher.
- **KISS** — the pins are flat sealed fields; the digest helper is a one-line `sha256(canonical(sorted set))`.
  No new abstraction layer, no new store.
- **YAGNI** — Wave 2 only. No `world_anchored` forward-carry (next wave), no Embers export (A3), no reader,
  no weight, no arming. `recall_graph_root` is the empty-set digest in SHADOW (its real content is
  arming-gated). Each is a named later wave.

## The pin model (design proposal — the architect board ratifies)

Four canonical pins (blueprint 2c), each a `content_hash`-sealed but **NON-identity** field (board F3/A6 — NOT
in `BASIS_FIELDS`, so a per-attempt pin never mints a distinct `node_id`), each nullable via an explicit
sentinel so a persona-less / grandfather node still validates (board A4):

| Pin | Value | Producer | Sentinel |
|---|---|---|---|
| `persona_def_ref` | `sha256(briefBytes ‖ contractBytes)` — the persona DEFINITION-version identity (NOT the thin `agents/*.md` stub) | materializer (2a) | `''` (no persona) |
| `context_commons_ref` | `sha256(rendered .block ‖ truncated-flag)` — what persona-context the actor RECEIVED (board A5's separate received-digest; honest-thin, NO KB bodies) | materializer (2a) | `''` (no persona) |
| `runtime` | `{model, tools, timeout}` — the per-emit execution facts (in no file today) | writer (2b) | `''` (a canonical-json string of the tuple; `''` if unknown) |
| `recall_graph_root` | `sha256(canonical([...sorted recall node/edge ids]))` — empty-set digest in SHADOW | new helper (3b) | the empty-set digest (never absent) |

**OPEN for the board (declared-vs-attested):** blueprint 2b also names an ATTESTED-containment pin, DISTINCT
from the declared `persona_def_ref` (the harness isolation report from `attestActorContainment`, today
discarded in `preflightEnv`). Recommendation: **include a fifth `containment_ref` pin** = `sha256` over the
per-run attest report `{attested, scope, report}`, captured REUSE-ONCE-per-run (the container image is fixed
per run, so no per-record re-attest — board F4/M2), honestly labeled "self-reported containment
(unauthenticated)" and `attested:false` in SHADOW/CI (board H4). Defer only if the `preflightEnv → env →
captureLiveLesson` threading proves un-clean. The architect decides include-now-vs-defer.

## Files To Modify

| File | Action | What |
|---|---|---|
| `packages/lab/persona-experiment/persona-prompt-materializer.js` | **EXTEND** | `_materializeWithDeps` (`:114-151`) returns `persona_def_ref` (`sha256` over the raw `briefMd` `:131` + `contractRaw` `:132` byte-strings, pre-parse) + `context_commons_ref` (`sha256` over the composed `block` `:145` + the `truncated` flag) alongside the existing `{block,bytes,truncated}` (`:147`). Import the content-address primitive (`kernel/_lib/canonical-json` + `crypto` — K12-legal, `:26-28` bans only runtime/kernel-hooks). Arity-1 public `materialize` (`:108`) unchanged. |
| `packages/lab/causal-edge/live-pending-store.js` | **v2 SCHEMA MIGRATION** | add the pin keys to `STORED_KEYS` (`:71`) as a v2 superset; `buildBody` (`:156`) emits them (sentinel when absent); `validateBlock` (`:141`) types them (64-hex-or-`''` for refs, bounded canonical string for `runtime`); add `MAX` caps (`:74`); `content_hash` (`:126`) seals them automatically (it hashes every non-`content_hash` key); `BASIS_FIELDS` (`:67`) UNCHANGED (pins non-identity); the read-path exact-set (`:324`) accepts the v2 superset AND grandfathers a v1 (no-pin) body. Backward-compat mechanism = the #1 open question below. |
| `packages/lab/causal-edge/recall-graph-root.js` | **NEW** | a pure `computeRecallGraphRoot(nodeIds, edgeIds)` → `sha256hex(canonicalJsonSerialize([...sortedNodeIds, ...sortedEdgeIds]))` (mirrors the `transaction-record.js:167-174` canonical-digest idiom). The empty-set root is a deterministic constant. No I/O, no state. |
| `packages/lab/persona-experiment/live-draft-run.js` | **THREAD (fail-soft)** | compute the pins inside `solveLiveIssueContained` (persona `:133`, full materializer `m` `:134`, recall block `:139`, model/timeout params, `ACTOR_TOOLS`), return them on `solveRes` (`:153`), thread through `solveGradeDraftOne` into `captureLiveLesson`'s mint block (`:236-239`); widen `captureLiveLesson`'s params (`:204`) + call site (`:334-336`); import `ACTOR_TOOLS` from `../issue-corpus/docker-actor-backend`. IF the attested pin is included: keep the attest report in `preflightEnv` (`:102-110`, today dropped) + thread `env` to `captureLiveLesson`. Every pin computation is fail-soft → sentinel (the never-throws mint contract, `:204-263`, is preserved). |
| `tests/unit/lab/causal-edge/live-pending-store.test.js` | **MIGRATE + EXTEND** | migrate the no-pin fixtures to v2; ADD: pins are `content_hash`-sealed (an in-place pin edit fails verify-on-read); pins are NON-identity (two nodes differing only in a pin share `node_id` → dedup COLLISION, observable); an injected non-pin extra key still rejects (exact-set holds); a v1 grandfather body still reads back verified; a forged/mistyped pin rejects. |
| `tests/unit/lab/causal-edge/recall-graph-root.test.js` | **NEW** | determinism (order-independent via sort), the empty-set constant, distinct sets → distinct roots. |
| `tests/unit/lab/persona-experiment/persona-prompt-materializer.test.js` | **EXTEND** | `persona_def_ref` + `context_commons_ref` are present, 64-hex, stable for identical inputs, change when brief/contract/block change; `''` sentinel on the fail-closed/no-persona branch. |
| `tests/unit/lab/persona-experiment/live-draft-run.test.js` | **EXTEND** | the pins thread end-to-end into the minted block (with an injected `lessonWriteFn` capturing the block); the never-throws contract holds when a pin producer throws (→ sentinel, mint still succeeds); the byte-identical-bare-prompt SHADOW guarantee survives. |
| other `live_pending` fixture tests (`live-disposal`, `live-expiry`, `live-pending-tombstone`, `live-pending-ages`, `full-arc-capture-flow`, `world-anchor-mint-captured-floor`) | **MIGRATE** | update any test that builds/asserts a `live_pending` body shape to the v2 shape (recon named the exact lines). |

**Reuse, do NOT modify:** `docker-actor-backend.js` (`attestActorContainment` already returns the report;
only `preflightEnv`'s DROP changes, in `live-draft-run.js`), `canonical-json.js`, `world-anchor-mint.js` (the
forward-carry is the NEXT wave), `live-recall-store.js` (`world_anchored` untouched this wave).

## Phases

1. **The digest helper** — `recall-graph-root.js` + its test (pure, no deps; the cheapest first slice).
2. **Materializer refs** — extend `_materializeWithDeps` to return `persona_def_ref` + `context_commons_ref`;
   its test.
3. **Store v2 migration** (the security core, TDD-treatment per the workflow rule — the seal change ≥80 LoC
   with an existing behavioral contract) — write the store test FIRST (v2 seal + non-identity + grandfather +
   exact-set), watch it fail, then extend `buildBody`/`validateBlock`/`STORED_KEYS`/`MAX`/read-path.
4. **Writer plumbing** — thread the pins (+ optionally the attest report) into the mint block, fail-soft; its
   test (end-to-end thread + never-throws + byte-identical SHADOW).
5. **Fixture migration** — migrate the ~10 other `live_pending` fixture tests to the v2 shape; full lab suite
   green; the store shadow/dam tests green (no new importer).

## Verification Probes

Grounded in a 2026-07-10 two-agent firsthand file:line recon of current `main` (post-#567). The blueprint's
line numbers had decayed; these are the corrected, re-probed sites:

- Probe: `persona-prompt-materializer.js` — `materialize` = `:108-110` (public), `_materializeWithDeps` =
  `:114-151`, returns `{block,bytes,truncated}` (`:147`), reads brief `:131` + contract `:132`, composes at
  `:145`; NO hash imported (adding `crypto`/`canonical-json` is K12-legal per `:26-28`). [blueprint's `:80-151`
  was wrong]
- Probe: `live-draft-run.js` — mint block `{repo,issue_ref,candidate_patch_sha,lesson_signature,lesson_body}`
  passed to `writeFn` at `:236-239`; `mintLivePendingLesson` is the default `lessonWriteFn` `:281` (NO literal
  call); `captureLiveLesson` = `:204-264` (never-throws, fail-soft); materializer `m` is local to
  `solveLiveIssueContained` `:134` (discarded except `.block` `:135`, NOT on `solveRes` `:153`); the actor's
  received `extraContext`/`prompt` exists only at `:140-141`. [blueprint's `:195-255,:325` was wrong]
- Probe: `docker-actor-backend.js` is at `packages/lab/issue-corpus/` (NOT `persona-experiment/`);
  `attestActorContainment` `:173-204` returns `{attested,reason,scope,raw,report}`; `preflightEnv`
  (`live-draft-run.js:102-110`) DROPS `att.report/scope`; `attested:false` is the normal no-Docker SHADOW/CI
  value (and `preflightEnv` treats `attested!==true` as fatal → tests inject `deps.attestFn`).
- Probe: `live-pending-store.js` — `BASIS_FIELDS` (`:67`) = 5 identity fields; `STORED_KEYS` (`:71`) = 8 keys;
  `content_hash` (`:126-130`) seals every non-`content_hash` key; read-path exact-set reject at `:324-325`;
  `buildBody` fixed shape `:156-168`; `validateBlock` `:141-152`; `MAX` `:74`. Production callers of
  `mintLivePendingLesson`: **exactly one** (`live-draft-run.js`).
- Probe: `world_anchored` store (`live-recall-store.js`) — 7-key body (`STORED_KEYS:65`, `BASIS_FIELDS:61`);
  **NO cross-repo/Embers/frozen-contract comment exists in the code** (only the blueprint frames it so); the
  Embers export seam is UNBUILT (grep `embers` in `packages/**.js` = 0 real hits). → extending `world_anchored`
  is toolkit-only-safe TODAY, but is DEFERRED to co-design with Embers at A3 (USER scope choice).
- Probe: `transaction-record.js:167-174` — `sha256(canonicalJsonSerialize({...}))` is the digest idiom to
  mirror for `recall_graph_root`; the same `sha256(canonical(BASIS.map...))` pattern is already in both
  stores.
- Probe: grandfather / Branch-A — the static seed floor `ORCHESTRATOR_LESSON_SEEDS` (`world-anchor-mint.js:141-143`,
  one `LESSON_2137` entry) builds candidates with NO `live_pending` record → nothing to pin from (handled by
  the nullable sentinel). The live store is empty in CI; on-disk v1 nodes (if any) need the grandfather read.

## Out of Scope (Deferred)

- **Blueprint Wave 3a (the `world_anchored` forward-carry)** — carrying the pins from `live_pending` into the
  `world_anchored` node's signed basis (the `collectCapturedCandidates:261` + `mintWorldAnchoredNode:496-501`
  edit sites). The FOLLOWING wave, co-designed with Embers so the cross-repo-bound shape is not frozen
  unilaterally. This is why W2 alone does not yet close gap8-a0b end-to-end — it builds the capture+seal
  foundation; the forward-carry consumes it.
- **Blueprint Wave 4 (the Embers `bank` export + byte-parity handshake)** — A3, cross-repo coordination.
- **The authenticated cross-uid minter + `LIVE_SOURCES` flip** — operator arming, the #273 close. Until it,
  every pin is integrity-not-provenance; no pin may HARDEN a weight.
- **`recall_graph_root` real content** — surfacing the actual admitted recall-node ids for the root is
  arming-gated (the Wave-1 boundary returns a rendered block, not node ids; and recall is SHADOW-empty). W2
  seals the empty-set root shape; the real digest is a boundary extension, later.
- **KB-body inlining** into `context_commons_ref` — pin what the actor TRULY receives (honest-thin), never
  smuggle a behavioral change into the capture wire (board Decision #2). A separate behavioral wave.
- **Any reader of the pins** — no ranking/weight/spawn consumer reads a pin this wave (the store's dams stand).

## Drift Notes

- route-decide returned `borderline` again on a security-class task — the stakes lexicon under-weights "schema
  migration" / "signed basis" (same miss as W1). Escalated by judgment (recurring dictionary-expansion
  candidate; noted across W1 + W2).
- The blueprint's file:line claims had ALL decayed (wrong `docker-actor-backend.js` path; wrong materializer +
  mint-site lines). Re-probed firsthand via two recon agents before writing this plan (the runtime-claim-probe
  discipline; `drift:recon-depth`). The blueprint also mis-stated `collectCapturedCandidates` as extracting
  two fields (it extracts three, `origin` included) — corrected in the recon, relevant to the deferred Wave 3a.
- The "world_anchored is a frozen cross-repo contract" premise is a BLUEPRINT design-intent claim, NOT a code
  fact today (no Embers consumer exists). Surfaced the distinction to the USER; it informed the Wave-2-only
  scope cut (don't freeze the cross-repo shape before coordinating).

## Open questions (RESOLVED in Pre-Approval Verification below)

1. **v2 backward-compat mechanism** — how does a v1 (no-pin) node still read back verified while a v2 node
   carries the pins? Proposal: WRITE v2 always (all pins present, sentinel when absent); the read path's
   exact-set accepts the v2 superset AND a v1 body (all pins absent). Edge: a v1 node + a later v2 mint for the
   SAME basis share `node_id` (pins non-identity) but differ in `content_hash` → the existing dedup
   (`bodiesEqual` = node_id AND content_hash) yields an OBSERVABLE collision-reject, not corruption (and the
   store is empty in practice). Confirm this is the right handling vs a `schema_version` discriminator field.
2. **Declared-vs-attested (the fifth pin)** — include `containment_ref` now (reuse-once-per-run, honestly
   labeled unauthenticated) or defer? It needs `preflightEnv → env → captureLiveLesson` threading. Recommend
   include (cheap via reuse-once; fulfills the declared-vs-attested distinction); the board rules.
3. **`runtime` representation** — store `{model,tools,timeout}` as a nested object (readable facts, needs
   object-shape validation) or a canonical-json string / hash (uniform with the ref pins, loses readability)?
   Recommend a bounded canonical-json STRING (uniform, sealed, still parse-able) with a `''` sentinel.
4. **`context_commons_ref` input** — digest the materializer `.block` alone (persona-context received) vs the
   full `extraContext` (persona + recall)? Recommend the `.block` alone (persona-context is the pin's subject;
   recall is separately captured by `recall_graph_root`), so the pin is stable regardless of the SHADOW recall
   state.

## Pre-Approval Verification

A 3-lens board (architect + code-reviewer + hacker, security tier per Rule 2), each premise-probing the plan
against the real store with live PoCs. **Verdicts: architect SOUND-WITH-NOTES (no CRITICAL/HIGH); code-reviewer
SOUND-WITH-NOTES (2 HIGH); hacker SOUND-WITH-NOTES (1 HIGH).** The core is sound and honest — pins are
`content_hash`-sealed + NON-identity (firsthand-confirmed the seal mechanism has no trap), grep-confirmed ZERO
pin readers, integrity-not-provenance stated plainly, the deferred `world_anchored` reader NOT regressed. But
several load-bearing corrections must be folded before build. **This section is AUTHORITATIVE over the body
above where they conflict.** Every finding was re-confirmed firsthand (the hacker + architect built collision
PoCs).

### HIGH — fold before build

- **[HIGH] The v2 read must be a DISCRIMINATED exact-set via a sealed `schema_version`, NOT "accept the
  superset" (hacker H1 + architect M4, both PoC-confirmed).** The naive `keys.filter(k => !STORED_KEYS.includes(k))`
  rejects only UNKNOWN keys, never a MISSING one — so the plan's "accept the v2 superset" degrades the store's
  exact-set seal to subset-tolerance: a same-uid writer mints a self-sealed **partial-pin** or **v1+one-injected-pin**
  body that reads back "verified" (hacker proved both accepted; a stripped-pins v2 body with a recomputed
  `content_hash` also reads as a valid grandfather — a silent downgrade, architect). INERT this wave (0 readers)
  but it pre-opens a laundering shape for the Wave-3a reader. **Resolution (OQ#1):** add a sealed
  `schema_version: 2` field (in the body, sealed by `content_hash`, OUT of `BASIS_FIELDS` so `node_id` +
  the collision behavior are unchanged). `readNodeVerified` discriminates: `schema_version === 2` ⇒ key-set
  must equal EXACTLY the v2 set (all four pins present); absent ⇒ key-set must equal EXACTLY the v1 set (no
  pins); anything else ⇒ reject `unknown-schema-version`. This unifies the hacker's "V1-xor-V2-full" and the
  architect's `schema_version`, closes the strip-downgrade, and self-documents on disk for Wave 3a.
- **[HIGH] `validateBlock` needs a nullable-pin predicate + the read-path must TYPE every pin, or the
  no-persona mint silently fails (code-reviewer HIGH-1 + hacker M3 + architect L3, firsthand).** `isBoundedString`
  requires `length>=1` (rejects `''`); `HEX64.test` rejects `''` and `undefined`. `validateBlock` runs on BOTH
  the write (`:221`, raw block) and read (`:318`, on-disk body) paths. A naive `HEX64.test(v) || v===''` rejects
  the omitted/`undefined` case → **every no-persona live-solve mint fails with a silent `store-refused`**, and a
  v1 grandfather body (pins absent) fails on read. **Resolution:** mirror the existing `provenance` idiom
  (`:145`) — validate each pin TOLERANTLY: `if (v != null && !isValidPin(v)) return 'bad-<pin>'` (absent → OK,
  the write-path buildBody defaults it; present → strictly typed). Ref pins: `v === '' || HEX64.test(v)`.
  `runtime`: a bounded string under a NEW module-const `MAX.runtime` (a free-length canonical string has no regex
  anchor — the store-is-not-a-sandbox lesson: reject-not-truncate on READ too). `schema_version`:
  `v != null && v !== 2 → reject`. The discriminated exact-set (above) lives in `readNodeVerified`; the tolerant
  typing lives in `validateBlock` — the existing write/read split is preserved. Add a store test that plants an
  oversized/mistyped-pin body and asserts verify-on-read rejects it.
- **[HIGH] Pin computation must be fault-isolated from the actor SOLVE's try/catch (code-reviewer HIGH-2,
  firsthand).** The plan puts pin computation "inside `solveLiveIssueContained`", whose whole body is one
  `try { ... } catch { return {ok:false, reason:'solve-threw'} }` (`:127-158`). `persona_def_ref` /
  `context_commons_ref` are SAFE (computed inside `_materializeWithDeps`'s own try `:126-150`, fail-closed to
  `null`). But `runtime` (a stringify) and `recall_graph_root` have no inner guard: a throw would discard a REAL
  container run + candidate patch as `solve-threw` — a far larger blast radius than "fail-soft to sentinel."
  **Resolution:** `recall_graph_root` has ZERO solve-data dependency this wave (the Wave-1 boundary exposes no
  node/edge ids → always the empty-set constant) → compute it as a pure top-level constant, NOT inside the solve
  try. `runtime` gets its OWN small `try {} catch { runtime = '' }`, distinct from the solve's error path. And
  every pin-read off the materializer `m` MUST use the existing `m && m.field` null-guard (`:135`) — the
  collateral regression oracle is `live-draft-persona-wire.test.js:124` (`materializeFn` returns `{block,bytes}`,
  no pins) + a sibling that injects `() => null`; without the guard these already-green tests throw.

### MEDIUM — fold into the build/test plan

- **[MED] Canonical-STRUCTURE hashing, never a raw `‖` concat (hacker M2 + architect M1/L1, both PoC-confirmed a
  collision).** `sha256(brief ‖ contract)` is preimage-ambiguous (`("PERSONA-A","XYZ")` and `("PERSONA-AX","YZ")`
  collide — proven); `recall_graph_root = sha256(canonical([...nodes, ...edges]))` flattens two sets
  (`nodes=[a],edges=[b,c]` and `nodes=[a,b],edges=[c]` both → `["a","b","c"]` — proven). **Resolution:** every
  pin hashes a canonical STRUCTURE — `persona_def_ref = sha256(canonicalJsonSerialize([briefMd, contractRaw]))`,
  `context_commons_ref = sha256(canonicalJsonSerialize({block, truncated}))`, `recall_graph_root =
  sha256(canonicalJsonSerialize({ nodes: [...ids].sort(), edges: [...ids].sort() }))` (domain-separated). The
  "distinct sets → distinct roots" test must include the flatten-boundary case.
- **[MED] `runtime` must pin the EFFECTIVE values, not the raw params (architect M2).** `model`/`timeout` can be
  `undefined` in `solveLiveIssueContained` (`:117`); `runActorInContainer` then applies `DEFAULT_MODEL` /
  `DEFAULT_ACTOR_TIMEOUT_MS` (`docker-actor-backend.js:41-42,151-152`). Pinning the raw params would seal a body
  that omits model/timeout while the actor actually ran `claude-sonnet-4-6` at 180s — a dishonest pin.
  **Resolution:** export `DEFAULT_MODEL` + `DEFAULT_ACTOR_TIMEOUT_MS` from `docker-actor-backend.js` and resolve
  `model || DEFAULT_MODEL` / `timeout || DEFAULT_ACTOR_TIMEOUT_MS` in the writer (single source, DRY — never
  re-declare the defaults). Store `{model, tools, timeout}` (effective) as a bounded canonical-json string.
- **[MED] Fail-silent pin capture needs a canary (hacker M1, the `drift:fail-silent` class).** A THROWN pin
  producer → `''` sentinel is indistinguishable from a by-design no-persona `''`. The sibling `captureLiveLesson`
  emits on every fail-soft branch. **Resolution:** emit a low-visibility `live-pending-pin-compute-failed` canary
  ONLY on a THROWN-producer sentinel (the `runtime` catch) — NOT on the by-design no-persona/flag-off `''` (that
  is silent, correct). Distinguishes a defeated capture from a legitimate absence.
- **[MED] Persona refs are FLAG-GATED — state it, don't fake-populate (architect M3).** The materializer runs
  only under `persona && personaMaterializeEnabled()` (`:133`), and `LOOM_PERSONA_MATERIALIZE` defaults OFF
  (`:57-61`, the byte-identical-SHADOW default). So in the DEFAULT shipped state `persona_def_ref` +
  `context_commons_ref` are always `''` (the actor received the bare prompt — the pin honestly captures that).
  Keep BOTH refs materialization-tied; do NOT derive `persona_def_ref` from `classifyFields.persona` (which
  exists flag-off) — that would claim a definition the actor never received.
- **[MED] Add the two wire-test files that actually own the byte-identical guarantee to the verification set
  (code-reviewer MEDIUM-HIGH).** The SHADOW byte-identical guarantee lives in
  `live-draft-persona-wire.test.js` + `live-draft-recall-wire.test.js:58` (`p === buildActorPrompt(PYREC)`), NOT
  the files the plan named. Both call `solveLiveIssueContained` (the function gaining pin code) with injected
  minimal/null deps — they are the regression oracle for the null-guard. Add both to Files-To-Modify's test set.

### LOW — note

- **[LOW] Rename "signed basis" → "content-addressed / sealed basis" (hacker L1).** The seal is a `content_hash`
  (a hash), not a signature; in the #273 family the whole distinction is integrity(hash) vs provenance(signature).
  The plan body already says integrity-not-provenance; the build's code comments must say "sealed / content-
  addressed", never "signed" (the authenticated signer is the deferred cross-uid minter). "signed basis" survives
  only as the gap8-a0b shorthand, clarified as the hash.
- **[LOW] Update two now-stale reader comments (architect L2).** `world-anchor-mint.js:250-251` (and `:72`) assert
  the captured `live_pending` body "persists only `lesson_signature` + `lesson_body`" — the migration makes that
  false (it now persists the pins too). The JOIN logic is unaffected (it still reads only those fields, the
  deferred forward-carry is genuine), but the comments must be corrected to avoid a same-format-in-reader-and-writer
  doc leak.
- **[LOW] Reframe Phase 5 as "verify, fix only what breaks" (code-reviewer LOW-MEDIUM).** Firsthand grep confirms
  the ~10 named fixture tests assert only SELECTED fields (never a full body key-set), so with the buildBody-
  defaults + tolerant-validateBlock fix they pass UNCHANGED. The ONE test file that genuinely needs edits is
  `live-pending-store.test.js` (its `selfConsistentNode` local-hash replica must gain the new keys to stay a
  faithful #273/exact-set replica). Phase 5 = run the full lab suite, fix only breakage — no pre-committed
  10-file migration (avoids scope drift; the gate is already "full lab suite green").

### Rulings on the open questions

| Q | Ruling | Reasoning |
|---|---|---|
| #1 v2 mechanism | **Sealed `schema_version: 2` + discriminated exact-set** (HIGH #1) | Enforces v2-requires-all-pins, rejects the strip-downgrade + partial-pin subset; pin-presence alone cannot. Out of `BASIS_FIELDS` → `node_id` + collision unchanged. |
| #2 `containment_ref` fifth pin | **DEFER** (architect ruling) | YAGNI in SHADOW — `attestFn` returns `attested:false` with no `report`/`scope` in CI, so it would seal a CONSTANT. Stay at the four USER-named pins. (Plan's stated defer-reason "un-clean threading" is WRONG — `env` already flows to the call site; defer for scope + YAGNI, not plumbing.) |
| #3 `runtime` repr | **Bounded canonical-json STRING + `''` sentinel + EFFECTIVE values** (MED) | Uniform with the ref pins (KISS — no nested-object validation), DoS-capped by `MAX.runtime`, parse-able. Must capture effective model/timeout. |
| #4 `context_commons_ref` input | **`.block` alone** | Recall has its own pin; digesting the combined `extraContext` double-covers recall + destabilizes the persona pin as recall varies. Armed-state forward-gap (`.block` won't capture the recall bytes once recall is non-empty) is a NAMED residual, acceptable in SHADOW (`extraContext === personaBlock` today). |

### Held SOUND (positive evidence, firsthand)

- The seal mechanism has NO trap: `deriveLivePendingNodeId` maps `BASIS_FIELDS` only (a pin can't enter
  `node_id`); `computeContentHash` sweeps every non-`content_hash` key (a pin auto-seals) — zero change to those
  two functions or `BASIS_FIELDS`.
- ZERO pin readers this wave (grep-confirmed); `world-anchor-mint.js:259-262` (Branch B) reads only
  `{lesson_signature, lesson_body, origin}` and does not spread the body — the deferred Wave-3a forward-carry is
  genuinely deferred, the reader is NOT regressed.
- Non-identity pins do NOT widen the pre-existing first-writer-wins suppression bar (`node_id` basis unchanged).
- `runtime` injection is neutralized: `ACTOR_TOOLS` is a frozen const; model/timeout are operator params; the
  refs are HASHES (preimage-injection is inert).
- The materializer's public surface stays arity-1; both callers + test assertions use `m.block` property access
  (no destructuring) → extending the return is additive-safe.
- The v1↔v2 same-basis dedup collision is honestly handled: `bodiesEqual` (`:209`) diverges on `content_hash` →
  the existing observable `alert('collision')` reject (`:240`), never silent corruption (store is empty in CI).

### Net

**SOUND-WITH-NOTES → resolved here.** No redesign — the boundary of change is: a sealed `schema_version` + a
discriminated exact-set in `readNodeVerified`; a tolerant nullable-pin typing in `validateBlock` + a `MAX.runtime`
cap; canonical-structure hashing; effective-runtime resolution; fault-isolated `runtime`/`recall_graph_root`
computation + a fail-silent canary; and a scope trim (four pins, `containment_ref` deferred). Phase 3 (the store
v2 migration) is the TDD-treatment core — write the discriminated-exact-set + nullable-typing + seal tests FIRST.
Per Rule 2a, the **hacker + code-reviewer + honesty-auditor re-probe the BUILT diff at VALIDATE** (the
discriminated read, the planted-mistyped-pin body, the fault isolation, the collision) — a green suite is not
proof. Ready to build on USER approval.

## VALIDATE result (post-build 3-lens, on the BUILT diff)

A security-tier board (code-reviewer + hacker + honesty-auditor) re-probed the BUILT diff with live probes
per Rule 2a. **Verdicts: all three SOUND-WITH-NOTES - no CRITICAL, no HIGH.** The core held under live
attack; all findings are MEDIUM/LOW and every one was firsthand-demonstrated. This section is AUTHORITATIVE
over the body + Pre-Approval above where they conflict.

### Held SOUND (positive, live-proven)

- **The discriminated exact-set is NON-VACUOUS.** The hacker planted 9 attack shapes (partial-pin v2,
  v1+injected-pin, stripped-pins-v2 downgrade, injected source/weight key, schema_version null/"2"/3,
  mistyped pin, over-bound runtime, `__proto__`) -> **0 seal bypasses**, each rejected with an observable
  alert. The code-reviewer reverted `readNodeVerified` to the naive reject-unknown-only filter -> 3 tests
  went RED (partial-pin, v1+injected, stripped-downgrade) -> reverted clean to green. Real protection, not
  theater.
- **ZERO pin readers** (whole-tree grep, all three lenses); `world-anchor-mint` Branch B reads only
  `{lesson_signature, lesson_body, origin}` without spreading the body. **Byte-identical SHADOW** confirmed
  (`p === buildActorPrompt(record)`). Every Pre-Approval resolution verified present in the built code
  (honesty-auditor: NO-OVERCLAIM, grade A).

### Folded (with fix + re-verify)

- **[MED] runtime pin misreported a falsy-but-defined override** (code-reviewer, live-proven `timeout:0` ->
  pinned as the default). The `|| DEFAULT` fix diverged from the consumer's `= DEFAULT` (undefined-only)
  param semantics. **Fixed:** resolve `model === undefined ? DEFAULT_MODEL : model` (+ timeout) to mirror
  `runActorInContainer` exactly; `timeout:0` now pins `0`. New test `W2 fold MED-1`.
- **[MED] the fail-silent canary was on the wrong pin + untested** (code-reviewer + hacker + honesty). The
  runtime producer (canonical-json of primitives) cannot realistically throw, so its canary was near-dead;
  the REAL silent-fail is a defeated persona-pin capture (materializer -> null while the flag is on).
  **Fixed:** the canary now fires on the defeated persona-pin path (`!personaDefRef` under
  persona+flag-on), distinct from the by-design flag-off `''`; a `deps.serializeFn` seam makes the runtime
  fault-isolation throw path testable too. New tests `MED-3/hacker-LOW-3` (defeated-persona canary) +
  `MED-3` (runtime-throw fault isolation, non-vacuous).
- **[MED] recall_graph_root "never absent" was not store-enforced** (code-reviewer). CORRECTED CLAIM: the
  store treats `recall_graph_root` uniformly with the other pins (absent -> `''` sentinel); the WRITER
  supplies `EMPTY_RECALL_GRAPH_ROOT` on every real mint (caller discipline, SRP - the store seals what it
  is handed, it holds no recall semantics). The pin-model table's "never absent" is superseded by this.
- **[MED] the v1-grandfather lane is a same-uid pin-strip downgrade vector** (hacker, live-proven). CORRECTED
  the Pre-Approval HIGH-1 claim: the discriminated exact-set closes the marker-RETAINED strip
  (schema_version:2 + pins stripped -> missing-field reject) but NOT the marker-STRIPPED-too variant (a
  re-sealed v1 body at the same node_id is byte-indistinguishable from a genuine v1 node). This is ONE
  instance of the accepted #273 same-uid weight-inert residual (INERT: 0 readers). **Documented** in the
  store header (`#273 GRANDFATHER RESIDUAL`) + a **named-residual test** (`v2 grandfather RESIDUAL`);
  FORWARD-HAZARD noted: the Wave-3a reader must prove "no pins" via an authenticated v2 marker, never infer
  it from pin-absence.
- **[LOW] over-bound runtime is mint-fatal, not sentinel-degraded** (hacker). This is the correct
  reject-not-truncate store-is-not-a-sandbox behavior (validateBlock rejects before buildBody); the writer's
  runtime is a small fixed object well under the cap. **Documented** at `pinRuntimeValue`.
- **[LOW] runtime comment overstated "what the actor ran with"** (honesty). It is a pre-run CONFIG value that
  mirrors the backend's own defaults, not a post-run observation. **Reworded.**
- **[LOW] null-materializeFn pin-sentinel coverage** (code-reviewer). Covered by the new defeated-capture
  test (materializeFn -> null asserts refs `''`).

### Residuals (named, not silent)

- The v1-grandfather same-uid pin-strip downgrade (accepted #273 residual; INERT while weight-inert;
  closes at the authenticated cross-uid minter arming).
- `recall_graph_root` real content (over actual admitted recall ids) is arming-gated - SHADOW seals the
  empty-set constant.
- The deferred `containment_ref` (attested) pin + the `world_anchored` forward-carry (Wave 3a) + Embers
  export (A3) remain later waves.

### Gates

Track A W2 suites all green: store 37/0, draft-run 67/0, materializer 20/0, recall-graph-root 6/0; **full
lab suite 157/0, kernel 125/0**; eslint clean (0 disables); zero non-ASCII in source; signpost regenerated +
markdownlint + release-surface clean. Ready to PR on USER approval; the USER owns the merge gate.
