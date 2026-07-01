# PR-B B3 — the net-new world-anchored recall retriever (SHADOW)

Status: pre-build. Date 2026-07-01. Wave B3 of the PR-B (Rubicon) decomposition
(`packages/specs/research/2026-06-30-pr-b-rubicon-scope.md` §3). B1 merged (#474), B2 merged (#475).
This wave builds the FIRST (SHADOW-inert) production consumer of the world-anchor trust records.

## 0. What B3 is (and is NOT)

**Is:** a NET-NEW retriever that, given a situation (`trigger_class`), reads the world_anchored live
nodes, admission-gates each via B2's `admitWorldAnchorNode`, builds a trust-weight map EXCLUSIVELY via
the `buildRankingWeights` chokepoint, and returns the admitted lessons ranked by weight. It opens THREE
SHADOW dams — each relaxed with a symmetric single-consumer guard so the firewall stays auditable.

**Is NOT:** the `LIVE_SOURCES` flip. That is **B5** (deploy-gated, ships dark). B3 stays SHADOW because
`LIVE_SOURCES = Object.freeze([])` — every node's `'world-anchor'` source is un-admitted → weight 0 →
the retriever's OUTPUT is empty. (Corrects the stale snapshot line that conflated B3 with the flip; the
MEMORY START-HERE decomposition — B3 recall-retriever → … → B5 flip — is the correct one, confirmed by
scope §3.)

**Is NOT (deferred, honest):** the persona/recency ranking axes. B3 supplies only the ENUM axis
(re-validated `trigger_class`). Persona (`built_by`) + recency (`emitted_at`) are side-channel-derivable
from the attestation but their consumption is the INSTINCT GAP (gap-map item 4 / scope Q-SCHEMA) — a B4
concern. Pulling them in now would trip a fourth dam (`world-anchor-store`) for no SHADOW benefit (output
is empty regardless). Deferred with a named residual, not silently dropped.

## 1. Runtime Probes (firsthand, HEAD `3f42ba2`)

| Claim | Probe → observed |
|---|---|
| `LIVE_SOURCES` is frozen-empty; `buildRankingWeights` is the sole weight-map constructor + source-gates | Read `causal-edge/weight-source-gate.js:37,85` — `Object.freeze([])`; `admitWeightForRanking` returns 0 unless `source ∈ liveSources` (exact `.includes`, no coercion) |
| A world_anchored node body is a frozen 7-key set with NO trigger_class / worked_example_ref / built_by / recorded_at | Read `live-recall-store.js:61-65` — `[anchor_id, provenance, merge_sha, lesson_signature, lesson_body, node_id, content_hash]` |
| `listLiveNodes()` verify-on-reads + enforces `provenance === 'world_anchored'` | Read `live-recall-store.js:263,325-348` — provenance reject + content-hash reseal per node |
| The `_spike` `retrieveBySignature` cannot be promoted (schema-incompatible) | Read `attribution/_spike/retrieve-signature.js:58-66` — ranks on `node.trigger_class` + `node.worked_example_ref.repo/issue_id`, which world_anchored nodes LACK; `onlyValid` uses `classifyLessonLayer` (backtest-node shape) |
| B2 `admitWorldAnchorNode(node, {edges, edgeVerifyKey, brokerVerifyKey, anchorDir, outcomeDir, selfUid})` → `{admitted, source, commitment_verified}`; caller supplies `edges` (B2 does not read the edge store) | Read `admit-world-anchor-node.js:48,92,117` |
| The trust-laundering guard: never key ranking on the raw ≤512-char on-disk `lesson_signature`; re-validate against the frozen taxonomy | Scope §2.3 (hacker HIGH); `lesson-signature.js:62-68` `lessonClusterKey` = `lesson:T|G|C` via `safeEnumKey` over frozen `TRIGGER/GOTCHA/CORRECTIVE_CLASS` |
| `lessonTrustWeight(HARDEN)=1, else 0` | Read `lesson-merge-lift.js:122-123` |
| Three shadow dams fire on B3's reads/calls | Read `shadow-import-graph.test.js:54 (LIVE_IMPORT_RE), :63 (EDGE_IMPORT_RE), :165 (READER_CALL_RE incl. admitWorldAnchorNode)` — B3 in `causal-edge/` (not exempt) tripping all three |
| No runtime→lab import exists; `build-spawn-context.js` invokes scripts via `invokeNodeJson` (subprocess) | `grep` runtime for lab requires → none; `build-spawn-context.js:58` imports `invokeNodeJson`/`invokeNodeText` from `kernel/_lib/safe-exec` |
| The attestation DOES carry `built_by` (128) + `emitted_at` (40) — persona/recency ARE side-channel-derivable (corrects scope Q-SCHEMA "no built_by") | Read `world-anchor-store.js:63` MAX field caps |
| Lab CLI pattern to mirror | `calibration-cli.js:36,45,61` — `main(argv)`, `process.stdout.write(JSON.stringify(..., null, 2))`, `require.main === module` guard |

## 2. Design

**New files (both `packages/lab/causal-edge/`):**

- `world-anchored-recall.js` — the pure-ish core `retrieveWorldAnchoredInstincts(query, opts)`.
- `world-anchored-recall-cli.js` — thin CLI wrapper B4 will `invokeNodeJson` (mirrors `calibration-cli.js`).

**Location rationale (an architect-lens question — see §6):** `causal-edge/` is the home of the
ranking/weight machinery it must use exclusively (`weight-source-gate`, `lesson-signature`,
`lesson-merge-lift`). Placing it OUTSIDE `world-anchor/` is deliberate — it makes the world-anchor store
imports cross-dir and therefore VISIBLE to the import dams, which is the whole point (an auditable
single named consumer). Placing it inside `world-anchor/` would make it a dam-exempt sibling → the
consumer becomes invisible to the dam (the vacuous outcome scope §3 explicitly warns against).

**`retrieveWorldAnchoredInstincts(query, opts)`:**

```
query = { trigger_class: string, limit?: number }   // the SITUATION (persona/repo axes deferred to B4)
opts  = {
  edgeVerifyKey?, brokerVerifyKey?,   // custody-pinned public keys (absent on dev/CI → empty output)
  liveDir?, edgeDir?, anchorDir?, outcomeDir?,   // opts-injected store dirs (SHADOW by injection)
  selfUid?,                            // uid seam; null FAILS CLOSED
  liveSources?,                        // TEST-ONLY injected allow-set; prod pins the frozen empty default
  limit?
}
-> { instincts: object[], ranked: object[], shadow_empty: boolean, diagnostics: {...} }
```

Flow:
1. `nodes = listLiveNodes({ dir: opts.liveDir, selfUid })` — verified world_anchored nodes.
2. `edges = listWorldAnchorEdges({ dir: opts.edgeDir, selfUid })` — for admission.
3. For each node, build a weight ITEM:
   - **Laundering guard (hacker HIGH):** re-validate `node.lesson_signature` by ROUND-TRIP against the
     frozen taxonomy — parse `lesson:T|G|C`, rebuild via `lessonClusterKey({trigger_class:T,gotcha_class:G,
     corrective_class:C})`, require `=== node.lesson_signature`. A non-round-tripping (off-floor / poison /
     arbitrary) signature → DROP the node (never rank it, never let it pick a target key). Uses ONLY
     `lesson-signature.js` (no `world-anchor-mint` import).
   - `adm = admitWorldAnchorNode(node, { edges, edgeVerifyKey, brokerVerifyKey, anchorDir, outcomeDir, selfUid })`.
   - `item = { lesson_signature: node.lesson_signature, verdict: adm.admitted ? 'HARDEN' : 'WITHHOLD', source: adm.source }`.
     (verdict-WITHHOLD-on-non-admit is a BELT; the `source` gate is the load-bearing one. A world_anchored
     node's trust is its confirmed-merge admission, not a re-run statistical arm-count gate — §6 open Q.)
4. `weights = buildRankingWeights(items, { liveSources: opts.liveSources })` — **the SOLE chokepoint** (never
   a hand-built map). SHADOW: `liveSources` defaults to the frozen-empty `LIVE_SOURCES` → every `'mock'`
   source admits 0 → `weights = {}`.
5. **Source-gated OUTPUT (the SHADOW-inert mechanism):** for each node, `w = weights[node.lesson_signature] || 0;`
   `if (w <= 0) continue;` — ONLY positively-weighted (admitted-live-source) nodes are surfaced. This is
   stricter than `_spike` retrieveBySignature (which surfaces trigger-matches at weight 0) — B3's OUTPUT
   itself is gated on admission, so a world_anchored lesson never reaches a spawn's context in SHADOW.
6. Rank the survivors: `score = (triggerMatch ? 1 : 0)`, tie-break by `weight` desc then `node_id` asc
   (deterministic). Return top-`limit` (`instincts`), the full `ranked` vector (inspectable), and
   `shadow_empty = instincts.length === 0` (informational, NOT the security flag — the gate is step 4/5).
7. Fail-closed + observable throughout: a bad node is skipped (never throws the retrieval); `selfUid:null`
   is honored by the stores' foreign-owned reject; the CLI resolves custody keys from a deploy-provisioned
   location (absent everywhere in B3 → empty).

**Two independent SHADOW gates (belt + suspenders), either alone keeps B3 dark:**
- (a) `LIVE_SOURCES` frozen-empty → `'world-anchor'` never admits a weight (the flip is B5).
- (b) No deployed custody key on any dev/CI box → `admitWorldAnchorNode` → `'mock'` (source not even
  world-anchor). Even if (a) were flipped, (b) still zeroes it; even with a key present, (a) zeroes it.

## 3. The three dam relaxations (each symmetric / non-vacuous)

In `tests/unit/lab/world-anchor/shadow-import-graph.test.js`, relax each dam from "zero external
consumers" to "EXACTLY ONE named consumer: `causal-edge/world-anchored-recall.js`", keeping every dam
NON-VACUOUS (still fails for a second consumer, and fails if the named file stops importing/calling —
so the exemption is not a blanket hole):

1. **LIVE_IMPORT_RE** (`listLiveNodes`): exempt the ONE path `packages/lab/causal-edge/world-anchored-recall.js`.
2. **EDGE_IMPORT_RE** (`listWorldAnchorEdges`): exempt the same ONE path.
3. **READER_CALL_RE** (`admitWorldAnchorNode`): exempt the same ONE path.

Plus:
- A **chokepoint assertion** — `world-anchored-recall.js` MUST import `buildRankingWeights` from
  `weight-source-gate` and MUST NOT import `_spike/retrieve-signature` nor hand-assign a numeric-map
  literal to `opts.weights` (a focused grep: requires `weight-source-gate`, no raw `weights = {`… ranker).
- A **separation assertion** — `world-anchored-recall.js` MUST NOT import `recall-graph-store` (the
  backtest store): the live and backtest retrievers stay physically separate (the symmetric replacement
  for the `recall-graph-store.js:56` firewall B3 never touches; `listLiveNodes` already enforces
  `provenance === 'world_anchored'`, so B3's inputs are provenance-clean by construction).
- A **non-vacuity re-proof** (mirrors B2): a unit test that plants a SECOND fake consumer string and
  asserts each relaxed dam still flags it.

## 4. Test plan (TDD — write tests first, describe NEW behavior)

`tests/unit/lab/causal-edge/world-anchored-recall.test.js` (new):
- SHADOW-empty: canonical live nodes present, default opts (no keys / empty liveSources) → `instincts: []`,
  `shadow_empty: true`. **The load-bearing SHADOW proof.**
- Source-gated output: with a TEST-injected `liveSources: ['world-anchor']` + a real ed25519 signed-edge
  quadruple (reuse B2's `admit-world-anchor-node.test.js` fixtures: `generateEdgeKeypair`/`signEdgeId`/
  `signRecordId` + `writeOutcome`) → the admitted node surfaces with weight 1; a non-admitted node does not.
- Laundering guard: a node with an off-floor / non-round-tripping `lesson_signature` is DROPPED even when
  otherwise admissible (never ranked, never picks a target key).
- trigger_class ranking + deterministic tie-break (weight desc, node_id asc).
- Fail-closed: `selfUid:null`, absent store dirs, a malformed node → empty / skipped, never throws.
- `limit` honored; `ranked` vector inspectable.

`tests/unit/lab/world-anchor/shadow-import-graph.test.js` (modify): the three relaxations + chokepoint +
separation + non-vacuity assertions above; re-prove each dam still catches a planted second consumer.

CLI test (mirror `calibration-parse.test.js` DRY CLI test): `world-anchored-recall-cli.js` runs, emits
valid JSON, `shadow_empty: true` on a clean box.

## 5. Residual (#273 — UNCHANGED by B3)

B3 changes NO trust property. It is the first CONSUMER of the world-anchor records, but SHADOW-inert:
`LIVE_SOURCES` empty + no deployed key → empty output. The #273 residual is exactly B2's: admission is
INTEGRITY + key-possession, NOT provenance; a same-uid co-forge admits (test-asserted in B2). B3 inherits
it verbatim and adds no new surface. **#273 still NARROWS (not closes); the close is B5-arming on a
DEPLOYED + ATTESTED cross-uid broker.** Per OQ-NS-6, B3 does not touch the trust ceiling.

## 6. Open questions for the VERIFY board

- **Q-LOC (architect):** `causal-edge/` (recommended — near the weight chokepoint, dams stay visible) vs
  a new `packages/lab/recall/` vs inside `world-anchor/` (rejected — dam-vacuous). Confirm `causal-edge/`.
- **Q-VERDICT (architect / honesty):** is `verdict = HARDEN on admission` for a world_anchored node an
  over-credit? (The world-anchor lane's trust is confirmed-merge provenance, not a re-run merge-lift
  statistical gate. The `source` gate + `commitment_verified` are the real boundary; verdict is a belt.)
- **Q-AXES (honesty):** is deferring persona/recency (item-4) the right minimal scope, or must B3 supply
  them now (accepting the 4th `world-anchor-store` dam)? Recommendation: defer (no SHADOW benefit; the
  INSTINCT GAP is B4/item-4 by the scope's own framing).
- **Q-OUTPUT-GATE (hacker):** is "surface ONLY positively-weighted nodes" airtight as the SHADOW-inert
  mechanism, or is there a path where a node reaches `instincts` without a positive `buildRankingWeights`
  weight? (Adversarial: a hand-built weights map — forbidden by the chokepoint assertion; a `NaN`/negative
  weight — `admitWeightForRanking` clamps; a prototype-key — `buildRankingWeights` null-proto.)

## Drift Notes
- Re-probing corrected the scope TWICE (dam undercount: LIVE_IMPORT_RE; persona axis: built_by IS in the
  attestation). Logged as the "recon verifies the world; the scope reasoned about the design" SCAR paying
  off again — a board-verified scope written a day earlier still decayed against HEAD.

## Pre-Approval Verification (VERIFY board — 3-lens, 2026-07-01)

Board: architect (design) + code-reviewer (correctness) + hacker (adversarial-security), read-only, parallel
against the plan + the load-bearing code. All three returned **NEEDS-REVISION**, converging on a cleaner
design. The §2 pre-board design above is SUPERSEDED where it conflicts with the RESOLVED DESIGN below.

### Board findings + disposition

| # | Lens | Sev | Finding | Fold |
|---|---|---|---|---|
| 1 | hacker | CRITICAL | `opts.liveSources` threaded into the gate + comment-labeled "TEST-ONLY" is a caller-overridable admission default (`security.md` hard-constant anti-pattern); a B4/in-process caller passing `liveSources:['world-anchor']` mints a live weight with no key + `LIVE_SOURCES` frozen-empty | **F1** — REMOVE `liveSources` from B3's public API entirely; gate per-node via `admitWeightForRanking` with the frozen default (see F-combined) |
| 2 | code-reviewer | HIGH | `buildRankingWeights` dedups last-wins by `lesson_signature` (24-cell bucket); two nodes sharing a bucket → a non-admitted `mock` node rides an admitted node's weight; `fs.readdirSync` order → non-deterministic | **F1** (same fix) — per-node `admitWeightForRanking`, independent per node, sort by node_id |
| 3 | hacker | HIGH | `safeEnumKey('INVALID',…)` is an idempotent round-trip FIXPOINT → the round-trip guard admits 60 cells (24 canonical + INVALID-axis perms), not 24; an attacker seats a laundered node on any `lesson:INVALID\|…` cell | **F2** — `isCanonicalLessonSignature`/`parseLessonClusterKey` uses DIRECT enum membership (`TRIGGER_CLASS.includes(parts[0])` …), never round-trip |
| 4 | code-reviewer | HIGH | the guard parse is unspecified; `.split('\|',3)` silently truncates a 4-part poison signature | **F2** (same helper) — strict `startsWith` prefix + `.split('\|')` NO limit + `parts.length===3` + direct membership |
| 5 | hacker | HIGH | `triggerMatch` has no defined source — a 7-key node has no `trigger_class` field; the `_spike` reads `node.trigger_class` = `undefined` | **F3** — `trigger_class` = `parseLessonClusterKey(sig).trigger_class` (parts[0] of the GUARD-VALIDATED signature), never `node.trigger_class` |
| 6 | hacker | MED | the single-file dam exemption match-shape is unspecified; a `.includes`/`.endsWith`/basename match is substring-confusable (`world-anchored-recall-2.js` slips) | **F4** — exact `path.relative(REPO,file) === EXEMPT` equality; non-vacuity re-proof plants a substring-adjacent name |
| 7 | hacker | MED | the CLI "resolves custody keys from a deploy-provisioned location" is unpinned; an env-var read is the `edge-attestation.js:74` self-pwn (a same-uid attacker sets `LOOM_EDGE_VERIFY_KEY`) | **F5** — B3's CLI resolves NO keys (passes undefined → admission 'mock' → empty); custody-pinned key resolution is B5. Test: a present env `LOOM_EDGE_VERIFY_KEY` does NOT flip the output |
| 8 | hacker | LOW | `ranked` returns weight-0 nodes "inspectable" incl. attacker-controlled `lesson_body` (≤4096) → a diagnostic serialize is an attacker-string surface | **F6** — `ranked` = w>0 entries only (= `instincts`); `diagnostics` = COUNTS only, never `lesson_body`. In SHADOW both are empty |
| 9 | code-reviewer | LOW | verdict string literals `'HARDEN'`/`'WITHHOLD'` hand-written → silent weight-0 drift on a future enum refactor | **F7** — `const { VERDICT } = require('./lesson-merge-lift')` |
| 10 | code-reviewer | MED | "reuse B2's fixtures" is inaccurate — `writeOutcome`/`buildBase`/`admit` are un-exported locals; only `generateEdgeKeypair`/`signEdgeId`/`signRecordId` (kernel `edge-attestation`) are importable | **F8** — import the crypto primitives from `edge-attestation`; build a SLIM local merge-outcome/edge fixture in B3's test (deliberate-duplication; a shared `_lib` extraction is a follow-up if a 3rd consumer appears — YAGNI) |
| 11 | architect | HIGH | the B4 `invokeNodeJson` contract (single-JSON-stdout, 5000ms default timeout) is under-pinned | **F9** — PROBE-MITIGATED: `emitEgressAlert` writes `process.stderr` (`alert.js:23`), `invokeNodeJson` parses only stdout (`safe-exec.js:34-40`) → alerts can't poison the JSON. Pin the clause + a CLI test (clean JSON to stdout, stderr-noise-tolerant). B4 passes an explicit timeout |
| 12 | architect | MED | `verdict:HARDEN`-on-admission bypasses the merge-lift statistical arm (Wilson/PER_ARM_FLOOR) | **F10** (doc) — CORRECT by design: the world-anchor lane's trust basis is confirmed-merge provenance + `commitment_verified`, NOT arm-counts (a category difference). State it in the ADR so `verdict:HARDEN` isn't misread as an over-credit; the belt is WITHHOLD-on-non-admit |
| 13 | architect | MED | admission is O(N·E) sig-verifies (per-node `admitWorldAnchorNode` re-verifies every edge) | **F11** (doc) — named residual; acceptable at SHADOW/current scale (YAGNI); a real-scale consumer hoists `authenticatedWorldAnchorEdges` out of the per-node loop. Do NOT pre-optimize |
| 14 | architect | LOW | ranking axis is thin (score ∈ {0,1}, only weight+node_id discriminate) | ACK — intentional minimal (enum-axis only); persona/recency (B4/item-4) give real discrimination. Q-AXES defer CONFIRMED |
| 15 | architect/reviewer | LOW | the chokepoint + separation guards are PROSE | **F4** — make them grep-based unit tests in `shadow-import-graph.test.js`, matching the existing structural-test pattern |

Q-LOC (`causal-edge/`), Q-OUTPUT-GATE (source-gated output), Q-AXES (defer persona/recency): all CONFIRMED
by the architect against the code. Q-VERDICT: CORRECT-as-belt (F10 doc note).

### RESOLVED DESIGN (as-built — supersedes §2 where they differ)

**New helper in `packages/lab/causal-edge/lesson-signature.js` (additive, Open/Closed — the symmetric
validator next to the builder `lessonClusterKey`):**
- `parseLessonClusterKey(sig)` → `{ trigger_class, gotcha_class, corrective_class }` iff strict-canonical
  (`typeof sig === 'string'` + `startsWith('lesson:')` + `slice.split('|')` NO limit + `length === 3` +
  `TRIGGER_CLASS.includes(t) && GOTCHA_CLASS.includes(g) && CORRECTIVE_CLASS.includes(c)` — DIRECT
  membership, so the `INVALID` fixpoint and split-truncation are both structurally excluded); else `null`.
- `isCanonicalLessonSignature(sig)` = `parseLessonClusterKey(sig) !== null`.

**`packages/lab/causal-edge/world-anchored-recall.js` — three exported functions (SRP, each unit-testable
WITHOUT a `liveSources` seam):**
- `classifyNode(node, opts)` → `{ node_id, lesson_signature, trigger_class, lesson_body, verdict, source }`
  or `null`. `parseLessonClusterKey(node.lesson_signature)` (null → drop); `admitWorldAnchorNode(node, {edges,
  edgeVerifyKey, brokerVerifyKey, anchorDir, outcomeDir, selfUid})` → `source`; `verdict = adm.admitted ?
  VERDICT.HARDEN : VERDICT.WITHHOLD`. (The test proves an admitted node yields `source:'world-anchor'` — the
  wiring proof — WITHOUT flipping `LIVE_SOURCES`.)
- `admittedWeight(item)` = `admitWeightForRanking({ source: item.source, weight: lessonTrustWeight(item.verdict) })`
  — **NO opts** → the frozen-empty `LIVE_SOURCES` default, unconditionally. THE per-node source gate (the
  same gate `buildRankingWeights` calls internally; per-node kills the bucket collision; no injection seam).
- `rankInstincts(entries, query, limit)` — PURE: keep `weight > 0`, sort by `(trigger_class === query.trigger_class ? 1 : 0)`
  desc, then `weight` desc, then `node_id` asc; `slice(0, limit)`. (Tested with synthetic w>0 entries — no gate needed.)
- `retrieveWorldAnchoredInstincts(query, opts)` = `listLiveNodes` + `listWorldAnchorEdges` → `classifyNode` each
  → `admittedWeight` each → keep w>0 → `rankInstincts`. Returns `{ instincts, ranked, shadow_empty, diagnostics }`
  where `ranked === instincts` (w>0 only), `shadow_empty = instincts.length === 0`, `diagnostics = { n_nodes,
  n_off_taxonomy, n_admitted }` (COUNTS only — never `lesson_body`). `opts` has NO `liveSources`. `instincts`
  carry `lesson_body` (B4 needs it) but ONLY for admitted (w>0) nodes → in SHADOW, empty → no `lesson_body` leak.

**`packages/lab/causal-edge/world-anchored-recall-cli.js`** — `--trigger-class`, `--limit`; calls
`retrieveWorldAnchoredInstincts` with **no verify keys** (→ admission 'mock' → empty on every dev/CI box);
single `JSON.stringify(...)` to stdout (diagnostics via `emitEgressAlert` → stderr). Mirrors `calibration-cli.js`.

**`weight-source-gate.js`** — update the `:78-80` NOTE: the live recall path uses `admitWeightForRanking`
PER-NODE (the same source gate) rather than the bucket-keyed `buildRankingWeights`, to avoid the last-wins
cross-node collision (code-reviewer HIGH#1). One-line honest doc-sync; no behavior change.

**Two independent SHADOW gates hold, either alone dark:** (a) `LIVE_SOURCES` frozen-empty → `admitWeightForRanking`
returns 0 for `'world-anchor'`; (b) B3 CLI passes no keys → `admitWorldAnchorNode` → `'mock'`. No `liveSources`
injection seam exists on the production path (F1). `#273` residual UNCHANGED (inherited from B2; SHADOW-inert).

## VALIDATE result (post-build 3-lens board, 2026-07-01) — ALL SHIP

Board (read-only, parallel, against the BUILT diff): hacker (Rule-2a LIVE probes) + code-reviewer (built-code
correctness) + honesty-auditor (claim-vs-evidence). All three: **SHIP**.

- **hacker — SHIP, 0 CRIT/HIGH/MED, 2 LOW.** Built 8 live probe scripts (real ed25519 quadruples, dir-injected
  temp stores). The decisive proof (probe #1): a FULLY-ADMITTED real quadruple + real edge/broker keys fed to
  `retrieve` STILL returns `shadow_empty:true` — the frozen-empty `LIVE_SOURCES` gate is independent of key
  resolution. 8 defenses probed-and-confirmed: two-gate SHADOW, no live-source seam, weight clamp, laundering
  fuzz (INVALID-fixpoint / 4-part truncation / homoglyph / proto / colon-newline — 24-case, only the 24 canonical
  cells parse), exact-path dam non-vacuity (planted a real 2nd consumer → flagged; broke the chokepoint greps →
  RED), env-blind key resolution, fail-closed store handling (symlink/garbage/oversize), no info-disclosure
  (`lesson_body` never rides out). 2 LOW = forward-hardening at the B4 seam.
- **code-reviewer — SHIP, 0 CRIT/HIGH, 2 MED + 3 LOW (all latent-not-live).**
- **honesty-auditor — SHIP, Grade A, NO-OVERCLAIM.** 7/7 sampled folds verifiably implemented; every claim
  SUPPORTED by a `file:line`; deferrals labeled with named residuals. Sole flag: it (read-only) could not
  EXECUTE the suites — closed by the orchestrator's runs (lab 121/0; B3 19/19; dam 19/19; lesson-signature 18/18).

**Folds applied (all board LOW/MED, folded now so B5 inherits no latent throw):**
- **V1** (reviewer MED + hacker LOW): `classifyNode` / `admittedWeight` / `rankInstincts` are now each FAIL-CLOSED
  (whole-body try → null / 0 / []) — the exported seam a future B4 direct caller uses can't be thrown by an
  adversarial getter. Test: `world-anchored-recall.test.js` "exported helpers never throw" (evil getters → null/0/[]).
- **V2** (reviewer MED): `rankInstincts` + the success return moved INSIDE the `retrieve` try/catch — a future-live
  comparator defect degrades to the fail-closed shape, never throws out of the CLI's single-JSON-stdout contract.
- **V3** (reviewer LOW): symmetric diagnostics shape — `error:false` on success, `error:true` on the fail path
  (a strict-key-set consumer never breaks). Test updated to assert the `error` key + `false`.
- **V4** (reviewer LOW): the dam chokepoint test adds a source-anchored `function admittedWeight(item)` single-param
  assertion (Function.length reads 1 even for `admittedWeight(item, opts={})`, so the regex closes the reopen-seam).
- **V5** (reviewer LOW + hacker LOW): documented the `rankInstincts` invariant (survivor `trigger_class` is always a
  real taxonomy value, never undefined) + the non-integer-`limit` → full-(bounded)-set fallback.

Post-fold gate: lab **121/0**, kernel **114/0**, `install.sh --hooks --test` **129/0**, eslint / signpost /
release-surface clean.
