# MV-W3 (Full) — the faithfulness seams, exercised active-in-isolation then burned

**Phase:** v-next trust-hardening · **Wave:** MV-W3 (follows MV-W2 #337)
**Date:** 2026-06-16
**Status:** PLAN (pre-VERIFY)

## The decision (USER, this session)

> "why don't we just set the production to active and isolate its output and burn it after. Would we be
> able to go with Full W3 with this approach?"

**Yes.** The isolate-and-burn rig lets us run the **production CODE PATHS** (the real seams behind the MV-W2
mocks) **active inside the isolated rig** — the gate fires HARDEN, the weight flips **the retriever's ranking
over the ISOLATED rig nodes** (the production ranking is untouched — frozen-empty `LIVE_SOURCES`), an
`injected-into` edge is minted — all inside an **ephemeral, firewalled, torn-down** rig. This upgrades MV-W2's
proof from "unit-mock" to **full-pipeline composition evidence** — it NARROWS toward a future mechanics-freeze;
it is NOT itself the freeze (the freeze is gated on the live beta, not this disposable single-run). Precedent:
the v3.9 bootcamp ran the mechanism for real then burned the backtest nodes.

**Release-note guard (honesty HIGH):** the only sentence a release note may use is — *"MV-W3 proved the seams
compose in an isolated rig; it moved trust ZERO."* No artifact may use **observed/measured** for merges (no
real merge exists — only fixtures); only **fed/exercised**.

## The load-bearing honesty caveat (OQ-NS-6 — non-negotiable)

It still **NARROWS, never HARDENS**. "Burn it after" *literally means no world-anchored corpus accrues* — so
trust is **untouched**. A full active-isolated run proves the MECHANISM composes end-to-end; it cannot harden
trust, because (a) the inputs are realistic FIXTURES, not accumulated real-maintainer merges, and (b) we
discard the output. **The live external-PR beta — real outbound PRs whose maintainer-merge signal we KEEP and
accumulate — remains the only thing that hardens.** This wave delivers "Full W3, mechanics-frozen, in a
burnable rig," NOT "trust hardened." Every artifact + claim must hold this line.

## The safety invariant (CORRECTED at VERIFY — the firewall is dir+allow-set+keyless+physical-separation, NOT provenance)

The VERIFY board (2 CRITICAL) **falsified the original provenance-based framing**: edges carry NO provenance
field; the retriever (`retrieve-signature.js`) is provenance-BLIND (gates on `classifyLessonLayer==='valid'`,
not provenance); and the real node store admits ONLY `'backtest'`, refusing `'live'` (which is not even a node
enum). The real, code-true firewall — "Active" = **the isolated rig ONLY**:

1. **Ephemeral state root — a MECHANISM, not a discipline (CRIT-2).** Every Lab store captures `DEFAULT_DIR`
   at REQUIRE time from `process.env.LOOM_LAB_STATE_DIR`. So the rig MUST set it to a temp root as the
   **literal first executable line, before ANY lab `require`** (mirror `persona-consumer-round.js`'s
   refuse-unless-isolated) + a **pre-flight assertion** that every store's exported `DEFAULT_DIR` resolves
   under the temp root (else ABORT) + pass `opts.dir` explicitly at every write (belt+suspenders).
2. **Frozen-empty `LIVE_SOURCES` (MV-W2)** — the rig passes `opts.liveSources` (injected); the real default is
   never mutated; the production recall path is NOT wired on.
3. **Keyless production (CRIT/HIGH-3)** — `authenticatedEdgeIds` / `deriveItemSource` are FAIL-CLOSED empty
   without a verify key. The rig injects an **EPHEMERAL throwaway keypair** (`generateEdgeKeypair`) via `opts`
   ONLY; it NEVER sets `LOOM_EDGE_SIGNING_KEY`/`LOOM_EDGE_VERIFY_KEY` in any inheritable env, and NEVER reuses
   a production-candidate key (the rig key is burned with the rig). The real path has no key → its signed lane
   is empty.
4. **Physical dir separation for edges** — edges have NO provenance, so isolated signed edges live in a temp
   edge dir the real `listEdges`/`authenticatedEdgeIds` consumer never scans.
5. **Provenance (NODES only, corrected)** — the rig tags nodes with a NEW `'isolated'` enum (one-way-door
   append); the real `recall-graph-store` admits only `'backtest'` so it AUTO-REFUSES `'isolated'`. NOTE: the
   retriever is provenance-blind — node isolation at the RANKER is the injected `nodes` array + the ephemeral
   dir, NOT provenance.
6. **Burn = `rm -rf` the temp root** (NOT `retireEdges`, which selectively KEEPS foreign/rm-failing files +
   the candidate-sidecar has no retire), in a `finally`/atexit that fires even on crash.

A VALIDATE assertion **snapshots the REAL `~/.claude/lab-state` edge/node/sidecar dirs BEFORE the rig requires
anything**, then proves them byte-unchanged AND the temp root gone after teardown.

## Runtime Probes (verified against the repo, not prose)

| Claim | Probe -> observed |
|---|---|
| `EDGE_TYPE` is an APPEND-ONLY frozen set; W3 may add a type | `EDGE_TYPE = Object.freeze(['confirmed-by'])` + header "W3 may add e.g. 'contradicted-by'; never rename/remove" ([recall-edge-store.js:36-39,62-63](../../lab/attribution/recall-edge-store.js)) |
| but the edge BASIS forces `to_delta_ref` HEX64 + non-empty `fail_to_pass` | `verifyEdge` rejects otherwise ([recall-edge-store.js:106-116](../../lab/attribution/recall-edge-store.js)) — an `injected-into` (lesson->spawn) edge has neither |
| each Lab store's verify predicate DIFFERS by design (independent auditability > DRY) | store header ([recall-edge-store.js:13-17](../../lab/attribution/recall-edge-store.js)) |
| provenance is folded into the node content-address (the OQ-7 firewall) | `deriveNodeId(workedExampleRef, provenance)` ([recall-graph.js:104](../../lab/attribution/recall-graph.js)); `PROVENANCE='backtest'` enum ([recall-graph.js:42](../../lab/attribution/recall-graph.js)) |
| the signed-edge minter is `runConfirmationPass`'s injected `signer` (C-W1) | `signer = signingKey ? (id) => signEdgeId(id, {privateKeyPem}) : undefined` ([lesson-confirm.js:145](../../lab/causal-edge/lesson-confirm.js)) |
| the live-source admission seam exists + is injectable | `admitWeightForRanking(rec, {liveSources})`; `LIVE_SOURCES` frozen-empty ([weight-source-gate.js](../../lab/causal-edge/weight-source-gate.js)) |
| `retireEdges` is a SELECTIVE prune (KEEPS foreign/rm-failing files), NOT the rig burn | ([recall-edge-store.js:210-227](../../lab/attribution/recall-edge-store.js)); the rig burn = `rm -rf` the temp root |
| no forge-poller / `injected-into` edge exists yet | grep: net-new |

## Full W3 = FOUR sub-waves (each its own PR + gate) — CORRECTED at VERIFY

Honest scope (honesty MED): this is **three NEW security-sensitive seams + an isolation rig**, NOT a
verification pass over MV-W2. Decomposed for reviewability (<400 lines/PR). The rig is the DAG SINK, so it is
its own **4th** PR (W3a-as-spine cannot host it without forward-referencing W3b/W3c). W3a + W3c specifically
get the **full 3-lens VALIDATE** (new authorization map; new signed store).

### W3a — `deriveItemSource` ONLY (the spine; small, principle-first, independently VALIDATE-able)
- **`deriveItemSource(node, signedEdges, opts) -> source`** (new, `causal-edge/item-source.js`): maps a lesson
  node -> its `item.source` by membership in the **C-W1 `authenticatedEdgeIds` signed lane** (node_id in the
  authenticated set -> the `SIGNED_LANE_SOURCE` token; else -> `'mock'`). FAIL-CLOSED: no verify key ->
  authenticatedEdgeIds empty -> `'mock'` (never the signed token). The verify key is **opts-injected, never
  env** (the keyless-prod firewall). This is an **AUTHORIZATION-class function** (it decides which lessons map
  to the admitted source the MV-W2 firewall keys on — a bug here is a firewall bypass / #273 laundering lever)
  → full 3-lens VALIDATE.
- **Ships deriveItemSource + its unit tests ONLY** — no rig (that is W3d). Discharges the MV-W2
  *plausible-but-unverified* "a real signal needs zero new machinery" hypothesis → **PROVEN, dated to W3a**.

### W3b — the forge-poller (mechanism real, signal FIXTURE)
- **`forge-poller.js`** (new): parse realistic forge `external_maintainer_merge` responses (recorded
  **FIXTURES** — NOT a live API; no real outbound PRs exist yet) -> per-arm merge `armCounts`. **Schema-validate
  before the gate** (hacker MED): each arm `{merged:int>=0, n:int>=merged}` on a **null-proto** object copying
  only expected own keys (defeat `__proto__` pollution from `JSON.parse`); REJECT (not coerce) malformed. A
  **hard fixtures-only guard** refuses a non-file source (the live-API path cannot be silently enabled without
  a re-VALIDATE). The site-predicate (the AVOIDED call) stays deterministic (LLM-as-judge FORBIDDEN — FORK-6).

### W3c — the injection-minter + a SEPARATE `injected-into` signed store
- **`injection-edge-store.js`** (new, sibling to recall-edge-store; NOT an `EDGE_TYPE` append — that store's
  basis forces `to_delta_ref` HEX64 + non-empty `fail_to_pass` a lesson->spawn edge lacks; "each store's
  predicate differs — auditability > DRY"). Content-addressed, verify-on-read, its own verify predicate.
- The writer is **the rig's sole minter (an in-process key-possession boundary)** — NOT "kernel-owned" (arch
  MED: `signEdgeId` is a pure fail-soft fn any caller can invoke; #273 integrity != provenance). The
  `injected-into` edge proves integrity + sig-well-formedness, NOT that a legitimate producer minted it; full
  provenance = a future enforcement wave. Tolerable here ONLY because it is shadow/rig-only and **gates
  nothing** (OQ-NS-6). → full 3-lens VALIDATE.
- Records `(lesson_node) --injected-into--> (spawn_id)` — the seam a future A/B needs to correlate injection
  -> outcome. Minted only inside the rig this wave.

### W3d — the capstone isolated-activation rig (DAG sink; depends on W3a+W3b+W3c)
- **`causal-edge/_spike/isolated-activation.js`**: implements the corrected safety invariant (env-first +
  pre-flight abort + ephemeral keypair + physical edge-dir separation + `'isolated'` node provenance + `rm -rf`
  burn). Runs the seams end-to-end ACTIVE in isolation: forge-poller(fixtures) -> `armCounts` ->
  `evaluateHardenGate` -> HARDEN -> `lessonTrustWeight` -> `deriveItemSource`(signed-lane) ->
  `buildRankingWeights` -> the ACTUAL `retrieveBySignature` **flips the ranking over the ISOLATED rig nodes**
  -> the injection-minter signs an `injected-into` edge -> **burn**.
- The VALIDATE assertion: the REAL `~/.claude/lab-state` dirs are byte-unchanged (snapshotted before any
  require) AND the temp root is gone. Folds the deferred MV-W2 LOW (weight upper-bound clamp).

### The two-axis weight distinction (arch HIGH — must be probed before W3d)
`opts.weights` is fed by TWO different magnitudes: the MV-W2 path (`lessonTrustWeight` verdict-magnitude,
binary 0/1, source-gated) and the pre-existing retriever design (`recurrence_count_confirmed`, an integer from
the consolidation report). They are type-compatible (both `lesson_signature -> number`) but SEMANTICALLY
DISTINCT axes. **MV-W3's rig exercises the MV-W2 verdict-magnitude path ONLY** (that is what proves the MV-W2
mocks compose). It does NOT claim to wire the recurrence path; how the two combine in a future live retriever
is a beta/enforcement design question, out of scope here. W3d's plan adds a Runtime Probe tracing one weight
HARDEN -> `buildRankingWeights` -> `opts.weights` -> `retrieveBySignature`.

## Open design questions for the VERIFY board
1. **Sub-wave decomposition** — is W3a/W3b/W3c the right split, or should the rig capstone be its own 4th PR?
   Is Full-W3-in-one-PR ever defensible here (NO, per <400-line rule — confirm)?
2. **`injected-into` store**: a separate `injection-edge-store` (recommended) vs an `EDGE_TYPE` append +
   basis-version on recall-edge-store. The board adjudicates against the store's one-way-door discipline.
3. **Isolation provenance**: reuse the existing `backtest` enum for the rig, or add an `isolated` enum
   (another one-way-door append to `recall-graph` ENUMS)? Reuse is cheaper; a distinct enum is clearer.
4. **Forge-poller input**: fixtures only (recommended — honest "mechanism real, signal mock") vs a read-only
   live GitHub API call (no real PRs to observe yet -> returns nothing meaningful + needs a secret).
5. **Does the rig belong in `_spike/`** (like the bootcamp + retrieve-signature) or as a first-class harness?

## HETS Spawn Plan
Substrate trust-boundary + new-signed-store + harness work -> escalate past route-decide's `root` stakes-miss.
- **VERIFY (pre-build, 3-lens parallel):** `architect` (the 5 open questions + the decomposition + does
  "Full W3 via isolate-and-burn" cohere with the substrate to-here) + `hacker` (can an isolated artifact
  escape the firewall into real trust? provenance-forge / allow-set leak / a burned-but-recoverable edge /
  the new injection store's verify predicate) + `honesty-auditor` (is the narrows-not-hardens line held in
  every artifact, or does "active" anywhere read as "trust hardened"?). Fold before building W3a.
- **VALIDATE (post-build, per sub-wave, 3-lens, Rule-2a live re-probe):** `code-reviewer` + `hacker` (attack
  the BUILT rig: prove the real path is untouched after a full active run) + `honesty-auditor`.

## Drift / honesty notes
- "Active" is the rig, never the real path. If any artifact's prose lets "active" read as a production
  activation, that is a BLOCKING honesty fault.
- The forge-poller is fixture-fed: its CODE is real, its INPUT is mock. State this at the call site — a real
  GitHub poll returns nothing until the beta exists.
- This wave's value is END-TO-END COMPOSITION EVIDENCE (the seams interlock, once, on fixtures) — it NARROWS
  toward a future mechanics-freeze; it is NOT the freeze. It moves trust ZERO. The next real lever is the live
  beta, unchanged.

---

## VERIFY result (2026-06-16, 3-lens board `wf_d403a339-3aa` — architect + hacker + honesty)

**Verdict: PROCEED-WITH-FOLDS (all 3 lenses).** The sections above are the CORRECTED/folded design; the board
found **2 CRITICAL** firewall flaws + 4 HIGH + 5 MED/LOW, all folded:
- **CRIT-1 (hacker+honesty):** the provenance "firewall" is false vs the code (edges have no provenance; the
  retriever is provenance-blind; the real node store admits only `'backtest'`). Firewall rewritten to
  dir-mechanism + frozen-`LIVE_SOURCES` + keyless-prod + physical edge-dir separation (§safety invariant).
- **CRIT-2 (hacker):** module-cache env-capture defeats the ephemeral dir → made a mechanism (env-first +
  pre-flight abort + explicit `opts.dir`).
- **HIGH:** signing-key env bypass → ephemeral keypair via opts only; burn-incompleteness → `rm -rf` not
  `retireEdges`; `'backtest'` reuse collision → new `'isolated'` enum; the two-axis weight conflation →
  scoped to the MV-W2 verdict-magnitude path + a W3d Runtime Probe.
- **MED/LOW:** "kernel-owned" → "rig's sole minter (in-process key boundary)"; rig → its own W3d; FREEZE-ready
  → composition-evidence-that-narrows; "active"/"set production active" phrasings → isolated-rig framing +
  release-note guard; forge-poller schema-validate + null-proto + fixtures-only guard; "Full W3" relabeled as
  3 new security seams; "zero new machinery" dated to W3a.
- **Open questions resolved:** Q1 4-PR split (rig = W3d) · Q2 separate injection store · Q3 new `'isolated'`
  enum · Q4 fixtures-only · Q5 `_spike/`.

**Build order:** W3a (deriveItemSource + tests, full 3-lens VALIDATE) → W3b (forge-poller) → W3c (injection
store, full 3-lens VALIDATE) → W3d (capstone rig). Each its own PR + USER merge gate.

---

## W3a VALIDATE result (2026-06-16, 3-lens board `wf_7330dd15-5c5` — code-reviewer + hacker live-reprobe + honesty)

**Verdict: SHIP-WITH-FOLDS.** One HIGH (all 3 lenses converged, reproduced) + MEDs, all folded; gate green after.

### Folded (code)
- **HIGH — the "opts-injected, never env" contract was false at the DELEGATE level.** `deriveItemSource` reads
  no env, but delegates to `authenticatedEdgeIds → loadPublicKey`, which falls back to
  `process.env.LOOM_EDGE_VERIFY_KEY`. So a keyless prod caller with an ambient env key would silently get
  `signed-lane`. Contained today by frozen-empty `LIVE_SOURCES`, but it is the exact gap that bites once
  W3d/beta admits `signed-lane`. **Fix:** both `deriveItemSource` AND the sibling `evaluateHardenGate` (MV-W1,
  same over-claim — "asserted in two places, enforced in neither") now short-circuit to fail-closed unless
  `opts.verifyKey` is a non-empty string, BEFORE delegating → **env-blind by construction** + a regression
  test at each site (sets the env, asserts mock/EXCLUDED).
- **MED:** explicit `!Array.isArray(node)` guard; whole-body try/catch → `MOCK_SOURCE` (auth-class
  never-throws, fails CLOSED); + tests (`[]` node, an adversarial throwing getter).
- **MED:** cross-module assertion test `MOCK_SOURCE === SOURCE_MOCK` (the `'mock'` token is dual-defined with
  hardening-signal-store — catch a future drift without a premature shared-constants module).

### Folded (doc/honesty)
- **LOW:** the headers said `deriveItemSource` "DISCHARGES 'zero new machinery'" — overclaim. Retightened: W3a
  **proves the source-DERIVATION seam**; the end-to-end discharge (source → buildRankingWeights → retriever)
  is the **W3d** rig. The "zero new machinery" claim is dated to W3a's derivation, not back-dated to MV-W2.
- **LOW:** the header's "re-derive defeats the replay forge" could read as defeating ALL #273 forges — split:
  REPLAY (kept sig + swapped subject) is defeated; CO-FORGE (a private-key holder mints a fresh valid edge) is
  NOT — the standing #273 provenance residual, tolerable only because the source gates nothing in prod.

### Positive attestations (hacker live-probed, HELD)
- The C-W1 re-derive guard fires through `deriveItemSource` (replay forge → mock); non-hex / `__proto__` /
  `constructor` node_ids → mock (no pollution); the unsigned-but-confirmed path never leaks the signed token;
  `LIVE_SOURCES` is a genuinely-frozen array (`push` throws). Only the full co-forge (attacker holds the
  private key) earns the token — the documented #273 residual, not a new bug.

**Gate after folds:** 125/125 install · 67 lab files · item-source 11 + lesson-merge-lift 17 + weight-source-gate 16. eslint clean.

---

## SCOPE DECISION (USER, 2026-06-16, post-W3a): LIGHT composition capstone; W3b/W3c DEFERRED

After W3a (#338), the USER chose the **light composition capstone (W3d-lite)** over Full W3. Rationale: the
heavier seams (W3b forge-poller, W3c signed injection store) are 2 MORE security-sensitive surfaces that only
NARROW (move trust zero); the live external-PR beta is the binding constraint, not more machinery. The light
capstone closes W3a's one honest gap (the END-TO-END discharge of "zero new machinery") with **zero new
security surface**.

### W3d-lite — the light composition capstone (the NEXT wave, after #338 merges)
- **Goal:** prove the FULL chain composes END-TO-END in isolation with the source DERIVED (not injected):
  a signed edge for a valid lesson node → `deriveItemSource` → `'signed-lane'` → `buildRankingWeights` (rig's
  INJECTED allow-set holds the signed-lane token) → `opts.weights` → the ACTUAL `retrieveBySignature` **flips
  the ranking over isolated rig nodes**. And the negative: an UNSIGNED lesson → `deriveItemSource` → `'mock'`
  → gated to 0 → **inert** (no flip). This discharges "a real signal needs zero new machinery" end-to-end
  (W3a proved only the derivation half).
- **No new modules, no new security seams** — composes W3a `deriveItemSource` + MV-W2 `buildRankingWeights` +
  the existing `evaluateHardenGate` (SYNTHETIC armCounts — NO forge-poller) + the existing `retrieveBySignature`.
- **Isolation (the corrected firewall, subset):** a **test** (`tests/unit/lab/causal-edge/`) that threads an
  explicit temp `dir` at EVERY store write (belt+suspenders — sidesteps the env-capture CRIT entirely),
  injects an EPHEMERAL keypair via `opts` only, **snapshots the real `recall-edge` DEFAULT_DIR before**,
  asserts it byte-unchanged after, and `rm -rf` burns the temp dir. CI-safe (temp dirs; no network/LLM).
- **VALIDATE:** focused — code-reviewer + a hacker re-probe (the ONE claim that matters: the real lab-state
  dirs are untouched after a full isolated composition run). Honesty: the rig NARROWS (composition evidence),
  it does not HARDEN.

### DEFERRED to beta-time (NOT this phase)
- **W3b** the fixture-fed forge-poller; **W3c** the signed `injection-edge-store` + injection-minter; the full
  W3d rig that wires them. Revisit when the live external-PR beta makes them load-bearing (and when the real
  forge API shape is known — building the poller now risks rework, honesty-lens noted).

### W3d-lite VALIDATE result (2026-06-16, 3-lens board `wf_95dd3e3f-978` — code-reviewer + hacker + honesty)

**Verdict: SHIP / SHIP-WITH-FOLDS / SHIP** (test-only wave — all folds are test-quality/honesty). Folded:
- **HIGH (code-reviewer):** `gateOpts.lessonSignature` was hardcoded to a stale `api-shape` token (the nodes
  are `boundary-contract`) -> the placebo-independence arm ran on unrelated sigs. **Fix:** derive
  `lessonSignature`/`placeboSignature` from the real target/distractor nodes.
- **MED (code-reviewer):** the real-dir isolation assertion sat OUTSIDE `finally` -> skipped on an inner
  failure (when a breach matters most). **Fix:** moved INTO `finally`, after the burn (both tests).
- **MED (hacker):** the snapshot covered only `recall-edge` (not edge+node+sidecar) and was blind to an
  in-place overwrite. **Fix:** `digestLabState()` digests the WHOLE real lab-state tree as `relpath:size`
  (catches an add OR overwrite in ANY store).
- **LOW (honesty):** clarified the HARDEN magnitude is SYNTHETIC arm counts (the signed edge gates ADMISSION;
  the forge->armCounts link is W3b, deferred) — so "the gate fires HARDEN" can't read as a real signal.
- **Positive (hacker live-probe):** 0 writes under the real lab-state base; the snapshot catches a deliberate
  leak; the ephemeral key is env-blind; the burn is complete.

**Gate after folds:** 125/125 install · 68 lab files · w3d-lite 2/2. eslint clean. The MECHANICS-not-TRUST line
holds: composition EVIDENCE, hardens NO trust.

**MV-W3 status under the light-capstone scope: COMPLETE** (W3a #338 + W3d-lite). W3b/W3c remain deferred to
beta-time; the live external-PR beta is the unchanged next real lever for TRUST.
