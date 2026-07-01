# PR-B (the Rubicon) scope — the first HARDEN gate

Status: research / pre-build (ratify-before-build). Date 2026-06-30. Produced by an 8-agent recon+synthesis
workflow (5 readers + architect synth + honesty-auditor + hacker), all facts re-probed firsthand against HEAD
(`c04f519`). This doc folds the board's two CRITICAL corrections into the design; the raw synthesis recommended
a flip-gating mechanism the hacker proved fails OPEN, so the **corrected** design below supersedes it.

> NOT YET RATIFIED. This is the scope the USER ratifies (or revises) before any build, mirroring the
> `2026-06-29-pra2b-custody-vehicle-scope.md` precedent.

## 1. What PR-B is

PR-B = lifecycle gap-map **item 5**: "authenticated edge minter + ship a live token into `LIVE_SOURCES`" = the
FIRST place a lab-derived weight gates a REAL substrate decision. The chosen gate is **Option A** (already
decided): a merge-confirmed lesson is preferentially surfaced into a spawn's context = a **HARDEN**. Dependencies
(items 2 merge-observer + 3 live-lesson-mint) are BUILT (#447-#457); the cross-uid edge signer is BUILT SHADOW
(#466) + deploy-provisioned (#471-#473) but NOT DEPLOYED.

**The load-bearing fact (confirmed live, 3 ways):** signal, gate, and consumer are three physically-disconnected
pipelines, and **flipping `LIVE_SOURCES` alone enables nothing**:

- `weight-source-gate.js:37` `LIVE_SOURCES = Object.freeze([])`; `buildRankingWeights` (`:85`) is the SOLE
  constructor of the `lesson_signature -> weight` map.
- `deriveWorldAnchorSource` / `authenticatedWorldAnchorIds` (`world-anchor-edge-store.js:434` / `:406`) have ZERO
  production callers (structurally enforced by `shadow-import-graph.test.js:164-173`).
- the production mint passes `signer: undefined` (`world-anchor-mint.js:216`) so every edge is UNSIGNED; the only
  retriever (`retrieveBySignature`) lives in `lab/attribution/_spike/` and is schema-incompatible with
  world-anchored nodes.

PR-B is the work of *connecting* the three pipelines while keeping the dam closed until a real signer is deployed.
KISS framing that governs the whole scope: **PR-B turns INTEGRITY into PROVENANCE-when-deployed; it never turns
PROVENANCE into TRUST** (that is the OQ-NS-6 ceiling, code-unprovable).

## 2. The corrected security model (folds hacker CRITICAL 1 + 2)

The raw synthesis proposed deriving the admitted-source set from `isDeployFlagSet(LOOM_EDGE_REQUIRE_UID_SEP)`. The
hacker proved that **fails OPEN**: `isDeployFlagSet` is the LENIENT predicate (any non-falsey token is true), so a
typo (`ture`) or any attacker-set env var admits the co-forgeable `'world-anchor'` source. A plain same-uid env
var has ZERO cryptographic tie to a deployed key. The lenient polarity is correct for the routing-refuse decision,
backwards for admission.

**Corrected design — admission gates on CRYPTO, never on a lenient flag.** A world-anchored weight is admitted to a
real ranking ONLY when ALL hold:

1. **Custody-key provenance (hard in-PR precondition, NOT deferred).** The recall driver resolves the custody
   PUBLIC verify-key from a TRUSTED, deploy-provisioned location (root-owned / pinned config), and passes it with
   `allowEnvFallback:false`. NEVER the ambient `LOOM_EDGE_VERIFY_KEY` (same-uid-writable; `loadPublicKey` defaults
   `allowEnvFallback:true` at `edge-attestation.js:74` — the latent self-pwn). **Refuse-on-absent**: no custody key
   present (every non-deployed env) -> no `'world-anchor'` source derives -> dam holds *without* the flag.
2. **Full-tuple commitment verified (`commitment_verified === true`).** The recall consumer admits a node ONLY when
   the weight-minter has re-derived `computeLessonCommitment(node.lesson_signature, node.lesson_body)` over the
   VERIFIED node body and bound it `===` the broker-sig-verified bundle's `lesson_commitment` (itself over a
   `broker_sig`-verified `approval_hash`). The edge signature alone (`authenticatedWorldAnchorIds`) is NOT
   sufficient — a deployed signer is still a signing-oracle for a caller-staged `from_node_id` (hacker HIGH).
3. **Axes re-validated against the frozen taxonomy.** The recall classifier's ranking axes must re-derive via
   `lessonClusterKey` against the closed enum; NEVER key `buildRankingWeights` on the node's unconstrained on-disk
   `lesson_signature` (a free `<=512` string at `live-recall-store.js:114`) — that is a trust-laundering surface
   (an attacker picks `lesson_signature` to target which spawn-context the laundered weight lands on, hacker HIGH).

**The `LIVE_SOURCES` token.** With the custody-key + commitment gate as the real boundary, the `'world-anchor'`
token (`WORLD_ANCHOR_SOURCE`, `world-anchor-edge-store.js:62`) may ship as a plain reviewed frozen literal (per the
gate header's own stated intent, `:34` — "ship a new frozen literal, never mutate a runtime singleton"). As
defense-in-depth (first HARDEN gate; conservatism warranted) the literal is additionally belt-gated behind a
STRICT-parsed arming flag (`normalizeBool`, `host-claude-guard.js:69-73` — a typo/garbage fails CLOSED for the ARM
direction). The flag is a belt; the custody-key verification is the load-bearing gate.

**The `LOOM_EDGE_REQUIRE_UID_SEP` flag** gates the MINT-side ROUTING only (does the mint construct + route the
cross-uid signer): LENIENT `isDeployFlagSet` for the deployed-signal (a typo -> refuse-to-run-direct = fail-closed
for routing), STRICT `normalizeBool` for the ARM (a typo -> not-armed = fail-closed). It does NOT gate admission.

## 3. The decomposition (5 waves, each a reviewable SHADOW PR)

Ordering is dependency-forced. B1-B4 are mechanism inert by construction; B5 ships dark (live only under a deployed
custody key + armed flag).

- **B1 — mint signer-routing resolver (kernel/egress).** New `loom-edge-resolver.js`, the edge analog of
  `defaultJudgeLauncher` / `resolveJudgeLaunch` (`host-claude-guard.js:122-159`). Reads `LOOM_EDGE_REQUIRE_UID_SEP`
  via the asymmetric pair (STRICT arm / LENIENT deployed-signal), returns `{mode, signer}`; on `cross-uid`
  constructs `crossUidLoomEdgeSigner` (`loom-edge-launch.js:48`); fail-CLOSES + EMITS on a throwing/unknown
  launcher. SHADOW: flag unset everywhere -> `mode:'direct'`, `signer:undefined` -> byte-identical to today.
  ~120-160 LoC. (Decision Q-DEP below: where the shared asymmetric-parse predicates canonically live, since
  `host-claude-guard.js` is `lab/_lib` but the resolver is kernel-side and kernel must not import lab.)
- **B2 — wire the resolver into the mint + the full-tuple weight-minter (lab).** THE #273 close, the gating
  precondition (hacker HIGH: this is the close, not a co-equal wave). Thread B1 into `cli.js` (`:352`); build the
  value-committing weight-minter that VERIFIES `broker_sig` over `approvalSigBasis(...)` (`allowEnvFallback:false`,
  fail-closed), RE-DERIVES the full-tuple `lesson_commitment` over the verified node body, and mints the
  `{source:'world-anchor', weight, lesson_signature}` record ONLY when both pass. SHADOW: resolver returns
  `signer:undefined` -> unsigned basis -> the record flows nowhere (`LIVE_SOURCES` empty). ~250-350 LoC; split the
  weight-minter to its own sub-PR if it crosses 400.
- **B3 — net-new world-anchored recall retriever (lab).** NET-NEW (honesty CRITICAL: the `_spike` retriever ranks
  by `trigger_class`/`worked_example_ref.repo` which world-anchored nodes lack — it cannot be "promoted"). Reads
  `listLiveNodes()`, supplies the missing persona/recency/enum axes via the schema-bridge (Q-SCHEMA below),
  re-validates axes against the frozen taxonomy, constructs `opts.weights` EXCLUSIVELY via `buildRankingWeights`
  (the SOLE chokepoint). Opens THREE dams (honesty HIGH — not two): `EDGE_IMPORT_RE` + the zero-caller assertion
  (`shadow-import-graph.test.js:147-173`) AND the live-consumer provenance firewall (`recall-graph-store.js:56`,
  which the live store's own header names as "the REAL live-consumer firewall"). Each dam relaxed with a SYMMETRIC
  replacement guard so the firewall stays auditable. SHADOW: every node derives `'mock'` (no signed edge) ->
  empty weights map. ~250-350 LoC (size is Q-SCHEMA-dependent — the schema bridge is the dominant cost, not a
  parallelizable add-on).
- **B4 — spawn-context integration point (runtime).** A 4th context class in `build-spawn-context.js` (a
  `## Earned instincts` section calling B3), **fail-OPEN** (a recall miss degrades to today's behavior; recall is
  enrichment, never a gate on whether the spawn happens). Resolve whether the read is keyed on target persona
  (`build-spawn-context.js` takes `--task`/`--files`, not a persona today). SHADOW: B3 returns empty -> the section
  renders empty. ~120-180 LoC.
- **B5 — the `LIVE_SOURCES` flip + verify-key-mandatory (deploy-gated, ships DARK).** Add `'world-anchor'` to a new
  frozen literal at `weight-source-gate.js:37` (belt-gated behind the STRICT-parsed arming flag, per §2); flip the
  mint's `verifyKeyPem`-absent path from "observable SHADOW skip" (`world-anchor-mint.js:417-421`) to
  "refuse-on-absent" (the named residual at `:45-48`); enforce `commitment_verified===true` at the HARDEN gate
  (refuse the OQ3-5 `''`-grandfather node from the HARDEN weight — it may surface, if at all, only through a
  SEPARATE NARROW lane). Inert by deploy-gate: in CI and on every dev box the custody key is absent + the flag is
  unset, so the gate admits nothing. ~60-120 LoC; the test matrix proving the gate stays closed without a custody
  key is the load-bearing part.

## 4. Out of buildable scope (deploy-time, operator-owned, code-unprovable)

- A **DEPLOYED** separate-uid edge signer the same-uid host cannot `read()` (#273 condition 2). PR-B provisions the
  routing; the act of deploying the key under a separate uid is operator work. `loom-edge-custody-verify.js`
  reports `hostObservableChecksPassed` + `requiresOutOfBandUidConfirmation`, NEVER `custodyVerified`.
- The operator's **out-of-band uid attestation** (#273 condition 3). Sole determiner; no code asserts it.
- **OQ-NS-6 ceiling** — accumulated REAL merges. A deployed signer proves PROVENANCE, not world-anchored TRUST.
  No code in PR-B closes this, and PR-B must not claim it does.
- The **arming wave (gap-map item 8)** — the live-loop scheduler. PR-B's gate sits downstream; B1-B5 can merge
  SHADOW ahead of it (exercisable with test fixtures + the deploy-gate keeps production inert). Sequencing Q-SEQ
  below.

## 5. #273 status after PR-B-mechanism-merged: NARROWS, does NOT CLOSE

Conditions after B1-B5 merge (mechanism complete, dark):

1. PR-A2b shipped the cross-uid signer + recompute-bind MECHANISM (#466), SHADOW/undeployed — the
   sign-arbitrary-hex oracle closes only when that signer is DEPLOYED (folds into condition 2; the honesty MED
   correction to the raw synthesis's "DONE (#466)").
2. A DEPLOYED separate-uid signer the host cannot `read()` — STILL OPEN (operator-owned).
3. Out-of-band uid attestation — STILL OPEN (code-unprovable).
4. PR-B arming the custody-pinned verify (`allowEnvFallback:false`) + full-tuple `commitment_verified` — DONE as
   MECHANISM (B2 + B5).

PR-B-mechanism-merged satisfies condition 4 only. The co-forge leg closes only when 2 + 3 also hold (a deployed
cross-uid broker + attestation). Precise status line: **#273 NARROWS to "mechanism-complete, co-forge survives
until a DEPLOYED + ATTESTED cross-uid broker." Per OQ-NS-6, PR-B does not touch the trust ceiling at all — only
accumulated real merges through a deployed gate harden trust, and no code closes that.**

## 6. Open decisions for USER ratify

- **Q-PROCEED (the overarching gate).** Build the corrected 5-wave mechanism now (SHADOW/dark; unblocked per
  gap-map; consistent with the whole arc's observe-first posture), formalized as a ratified RFC first (the OQ-3
  precedent for load-bearing kernel/trust work) -> `/verify-plan` -> wave-by-wave build? OR defer until the
  cross-uid signer is actually deployed and build PR-B against a real custody key?
- **Q-SCHEMA (gap-map item 4 / the INSTINCT GAP — the biggest fork).** The world-anchored live node body is a
  frozen 7-key set (`live-recall-store.js:65`) with no `built_by` persona axis, no `recorded_at`, and a free-string
  `lesson_signature`. Does PR-B (a) WIDEN the live node body to carry the classification axes (re-opening the
  frozen `STORED_KEYS` exact-set seal — a #273-adjacent lab-store contract change), or (b) build a net-new
  side-channel classifier deriving axes from the merge record / world-anchor edge, leaving the node body frozen +
  re-validating against the frozen taxonomy? Recommendation: **(b)** — keep the frozen seal intact (re-opening it
  is the most dangerous lab-store change class); derive axes side-channel; re-validate via `lessonClusterKey`.
- **Q-SEQ (sequencing vs the arming wave).** Confirm B1-B5 merge SHADOW ahead of the live-loop arming wave
  (item 8), or sequence item 8 first? Recommendation: B1-B5 ahead (mechanism is fixture-exercisable; the deploy-gate
  keeps production inert).
- **Q-DEP (low-stakes, ratifiable at B1).** Where the shared asymmetric-parse predicates (`normalizeBool` /
  `isDeployFlagSet`) canonically live, since the kernel resolver must not import `lab/_lib`. Likely: relocate the
  pair to a kernel `_lib`, or duplicate the tiny predicates kernel-side.
- **Q-FRESH (low-stakes, ratifiable at B4/B5).** The freshness/replay window for the gated weight (RFC 2026-06-18
  Erratum P2 + M-1): a signed mint verifies forever, so the consumer flip must enforce a freshness window or a
  policy re-run. Window value TBD at the wave.

## 7. Board verdicts

- **honesty-auditor: NEEDS-REVISION** — 1 CRITICAL (B3 cannot promote the `_spike` retriever; it is net-new +
  schema-incompatible), 2 HIGH (the third firewall `recall-graph-store.js:56` omitted; "everything I need" was
  optimism-default while Q-SCHEMA gates B3/B4 sizing), 2 MED (anchor drift; #273 condition-1 over-credit), 2 LOW
  corroborating (the §2 `opts.liveSources` mechanism is real; the deploy-residual stub disclosure was honest). The
  inertness thesis itself was rated well-calibrated. ALL folded above.
- **hacker: NEEDS-REVISION** — 2 CRITICAL (lenient-flag admission fails OPEN; verify-key-provenance deferred =
  the whole gate's safety deferred), 2 HIGH (signing-oracle for caller-staged `from_node_id` -> full-tuple
  commitment IS the close; schema-bridge is a trust-laundering surface), 1 MED (OQ3-5 `''`-grandfather body-binding
  hole), 1 LOW (`LOOM_EDGE_REQUIRE_UID_SEP` has zero code readers today). ALL folded above — they reshaped §2.

Run: `wf_cb216852-f6d` (8 agents, ~963K tok). One recon slice (`recon:deploy-residual`) returned a stub; the
architect drew deploy facts firsthand from `docs/deployment/loom-edge.md` + the signer-wiring slice, and §4 here
is independently re-grounded.
