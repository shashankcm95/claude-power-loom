---
title: "Plugin blueprint — the learning wire + the persona-context model (producer side)"
status: BLUEPRINT (authored 2026-07-10; REVIEWED by a 4-lens board 2026-07-10 -> NEEDS-REVISION; corrections folded in ## Review board, which is AUTHORITATIVE over the body where they conflict; the recall-wiring fork RESOLVED (boundary-module approach, USER 2026-07-10) in ## Review board)
created: 2026-07-10
derives_from:
  - packages/specs/research/2026-07-10-external-sde-pipeline-anchor.md   # the reconciled pipeline (the WHY)
  - docs/handoff-embers-persona-commons-sync.md                          # the cross-substrate seam + access model
grounded_by: a 5-slice file:line recon of the current tree (2026-07-10) — see ## Runtime Probes
lifecycle: persistent
---

# Plugin blueprint — the learning wire + the persona-context model

> The PLUGIN (producer) side of the toolkit <-> Embers seam. This closes the crux gap (the learning wire)
> and adds the persona-context model, all SHADOW-first (weight-inert; hardening is arming-gated,
> operator-only). It is grounded in a file:line recon of the current tree, which corrected the stale
> premise it inherited. It is a BLUEPRINT pending a review board; the board's findings append here, and
> only then does it become an execution plan.

## 0. The corrected premise (recon, not the stale gap-map)

The gap-map's "the live loop mints zero lessons" is STALE. The current tree:

- The loop ALREADY mints a `live_pending` HYPOTHESIS node on every eligible solve (`captureLiveLesson ->
  mintLivePendingLesson`, weight-inert). So the crux is NOT "mint a lesson."
- The genuinely missing pieces are four: (1) the recall-into-solve step; (2) the toolkit -> Embers export
  seam (the word "embers" appears zero times in any `packages/**.js`); (3) the persona-context pins +
  their capture; (4) the reference-class signal and a `recall_graph_root`. Plus a fifth, independent:
  promoting the intake gate to a submit-time fail-fast.
- Embers Phase 1 built the `bank`/`meta` SHAPE (`bank --node <node> --meta <meta> --key <pem>`); a producer
  never feeds it. [CORRECTED per board H1-honesty: byte-parity is an OPEN cross-repo confirm item, not an
  established fact - the exact node + meta shape must be sent and confirmed as a Wave-4 precondition.]

So the plugin's job is: wire what exists, add the four missing pieces, and keep the whole thing
SHADOW-inert until an operator arms.

## 1. What is BUILT vs EXTEND vs NEW (grounded)

| Component | Where | State | Blueprint action |
|---|---|---|---|
| Live-loop lesson capture (`captureLiveLesson`) | `live-draft-run.js:195-255,:325` | BUILT (mints `live_pending`) | reuse; do NOT rebuild |
| `world_anchored` node (7-key body) | `world-anchor/live-recall-store.js:60-132` | BUILT (frozen cross-repo shape) | treat as a FROZEN shared contract; extend only via coordinated bump |
| Post-merge mint (`mintFromMergeOutcome`) | `world-anchor/world-anchor-mint.js`, `cli.js:373` | BUILT but OPERATOR-MANUAL | automate the driver (Wave 4) |
| `merge-outcome-store` record | `world-anchor/merge-outcome-store.js:106-164` | BUILT (carries `pr_url`, `repo`) | read as the `meta.json` source |
| Prompt seam (`buildActorPrompt` `extraContext`) | `trajectory-friction-run.js:98-104` | BUILT (single injection point) | inject recall here |
| Live prompt assembly | `live-draft-run.js:127-132` | PARTIAL (persona block only) | slot the recall block here |
| Sanitizer / advisory-DATA framing | `grounding-slice.js:63-107`, `renderFencedBoundedBlock` | BUILT | reuse; no new sanitizer |
| `retrieveWorldAnchoredInstincts` (provenance-correct retriever) | `causal-edge/world-anchored-recall.js:140-183` | BUILT but SHADOW-EMPTY | wire it; empty until arming |
| `buildGroundingSlice` (integrity-only lane) | `persona-experiment/grounding-slice.js:121-161` | BUILT but NOT live-safe | reuse RENDERING only; NOT its `confirmedNodeIds` lane for a live injection |
| Content-address primitive | `kernel/_lib/canonical-json.js` + `computeContentHash(body)` idiom | BUILT | reuse for the bundle hashes |
| `materialize(persona)` (the closed "what-the-actor-received" set) | `persona-prompt-materializer.js:80-151` | PARTIAL | extend to return hashes; decide KB-body inlining |
| `attestActorContainment` (ATTESTED constraints) | `docker-actor-backend.js:173-204` | BUILT but result DISCARDED | capture as the attested pin |
| Declared constraints (`tools:` + contract) | `contracts-validate.js:1159-1236` | BUILT | hash as the declared pin |
| Classifier (`classifyIssue` -> `canonicalPersonaKey`) | `issue-classifier.js:127-171` | BUILT (persona, narrow coverage) | key `persona_id` on it; tolerate null |
| Intake gate (`hasExternalMergeHistory`) | `issue-corpus/live-puller.js:227,262,292,333` | PARTIAL (advisory, never drops) | promote to submit-time gate (Rung-2) |
| Recall step in the live loop | `live-draft-run.js` / `live-solve-one.js` | MISSING (grep zero) | NEW (Wave 1) |
| toolkit -> Embers export seam | (absent) | MISSING | NEW (Wave 4) |
| Persona-context pins (4 refs) | (absent, grep zero) | MISSING | NEW (Wave 2/3) |
| Reference-class (`trigger_class`) on the live record | classifier returns persona only | MISSING | NEW (Wave 1a) |
| `recall_graph_root` | only per-node hashes exist | MISSING | NEW (Wave 3) |

## 2. The waves (SHADOW-first, dependency-ordered)

Each wave ships weight-inert and byte-identical-until-armed. Nothing here hardens a weight; nothing here
arms egress; Claude never touches `/etc/loom` or a signer.

### Wave 1 - the recall / consume wire (THE CRUX)

The single most load-bearing wire: a solve retrieves confirmed lessons and injects them as advisory DATA.
[REDESIGNED per FORK RESOLVED in ## Review board: recall reaches the drafter ONLY through the audited
cross-uid subprocess boundary `recall-inject-boundary.js`; the 1a/1b/1c sub-steps below are superseded by
that design wherever they conflict (no direct `deps`-threaded import of the recall lane).]

- 1a (NEW) - a record -> reference-class derivation. The retriever scopes on `trigger_class` (the frozen
  24-cell taxonomy), but the classifier yields only a persona. Extend `classifyIssue` (or a sibling) to
  also emit a `trigger_class`, so recall is scoped by `(repo x trigger_class)`, not persona alone.
- 1b (wire BUILT) - retrieve inside `solveLiveIssueContained`: use the `retrieveWorldAnchoredInstincts`
  SHAPE (world_anchored provenance + reference-class scope + fail-closed-to-empty). Render through the
  existing `renderFencedBoundedBlock` / grounding-slice framing (DATA-not-instructions, control-char
  strip, per-line + byte cap). It returns EMPTY until arming, so the runtime OUTPUT is byte-identical to
  the bare prompt until the commons has data. [CORRECTED per board CRITICAL F1: the SHADOW-inert property
  is NOT free - importing `world-anchored-recall.js` into `live-draft-run.js` trips the deliberate
  `drafter-recall-disjointness.test.js` structural dam (resolved paths, not runtime output), which by
  design forces the cross-uid arming decision. Landing this needs a board-approved carve-out OR a new
  boundary module - FORK #1 in ## Review board - it is NOT a routine `deps` thread. Also H5: compose
  `renderLesson` (`stripControlChars`) BEFORE `renderFencedBoundedBlock`; they are not one framing.]
- 1c (wire) - combine at `live-draft-run.js:128`: `extraContext = [personaBlock, recallBlock]
  .filter(Boolean).join('\n\n') || null`, behind a new `LOOM_RECALL_INJECT` flag parsed with the SAME
  asymmetric strict-truthy allowlist (typo fails CLOSED to the bare prompt). Thread the retriever via the
  `deps` spread (mirror `lessonLegFn`), so the DI/test path stays inert.
- INVARIANT: recall is advisory-only; it NEVER mutates the graded `record` and gates nothing (OQ-NS-6).
  [CORRECTED per board CRITICAL H1 + F1: the `world_anchored` lane is INTEGRITY + key-possession, NOT
  provenance, until a DEPLOYED cross-uid signer arms - and wiring it into `live-draft-run.js` trips the
  deliberate `drafter-recall-disjointness.test.js` dam. So recall injection into a live external-repo actor
  gets its OWN cross-uid-deployment gate (fail-closed to empty until then, even with `LOOM_RECALL_INJECT`
  on); the DATA-framing is necessary-but-NOT-sufficient. This whole wave is gated on the two forks in
  ## Review board.] Still: NEVER the integrity-only `confirmedNodeIds` lane, whose own header forbids
  feeding a live persona.

### Wave 2 - the persona-context capture + pins (the meta-class, on the earliest mint)

Capture "exactly what the actor received" as HASHES, pinned on the `live_pending` node (the earliest mint
point, where persona + materializer output + runtime are all in hand).

- 2a (EXTEND `materialize`) - return hashes alongside `.block`: `persona_def_ref` = `computeContentHash`
  over the runtime BRIEF bytes + contract bytes (NOT the thin `agents/*.md` stub; NOT `synthid`'s 8-hex).
  Reuse `canonicalJsonSerialize` + sha256 at 64-hex.
- 2b (NEW) - the `runtime` pin: `{model, tools, timeout}` (the per-emit facts in no file). And capture
  the `attestActorContainment` REPORT (today discarded) as the ATTESTED pin, bound DISTINCTLY from the
  declared `persona_def_ref` (declared = self-asserted git prose; attested = harness-observed isolation).
- 2c (EXTEND `live_pending` schema) - pin `persona_def_ref`, `context_commons_ref`, `recall_graph_root`,
  `runtime` onto the node. Because `BASIS_FIELDS`/`STORED_KEYS` are exact-set + sealed in `content_hash`,
  this is a VERSIONED schema bump (a v2 node shape), not an additive field. The `world-anchor-mint` join
  (`repo-slug, issue_ref, lesson_signature`) then carries the pins forward to the `world_anchored` node.
- OPEN (for the board) - `context_commons_ref`: today the contained actor receives ZERO KB bodies (only
  `kb:` name-tokens in prose). So pin what is TRULY received (persona block + KB name-refs), labeled
  honestly - do NOT smuggle KB-body inlining (a behavioral change to the solve) into the capture wire.
  KB-body inlining is a separate behavioral wave (see 6.2).

### Wave 3 - carry the pins forward + `recall_graph_root`

- 3a (EXTEND `world_anchored` node) - extend the 7-key body to carry the pins. This is a CROSS-REPO
  contract change: Embers re-derives `node_id` + `content_hash` and refuses on mismatch, so this must be a
  COORDINATED superseding schema bump on both sides (see 4c).
- 3b (NEW `recall_graph_root`) - a content-addressed root/head over the admitted recall-node (+
  confirmed-by edge) set at EMIT time, captured at the emit boundary (there is a temporal gap: the
  `world_anchored` node is minted post-merge, but the recall state to pin is the emit-time state).
  Template on the kernel `head_anchor`/`post_state_hash` chain (`transaction-record.js:133`): a
  deterministic canonical-json digest over an ordered set.

### Wave 4 - the producer export seam to Embers (the biggest missing piece)

- 4a (NEW exporter/adapter) - after `mintFromMergeOutcome` yields the `world_anchored` node: (i) read the
  node file (re-verifying its seals), (ii) JOIN the `merge-outcome-store` record (`pr_url`, `repo`) +
  persona-attribution (`persona_id`, `human_root`) to synthesize the `meta.json` Embers requires, (iii)
  invoke `embers bank --node <node> --meta <meta> --key <pem>`. Emit the node UNMODIFIED (seals intact).
- 4b (NEW driver) - automate `observe-merge -> mint -> export` when a `merge-outcome` record appears
  (today operator-manual). NOTE: the loop is EMIT-OFF, so a real merge only occurs post-arming; the driver
  is buildable + unit-testable SHADOW now, but its live exercise is arming-gated.
- 4c (COORDINATE with Embers) - the four pins land on the ember via a NEW `ember/v2` predicate
  (`registerPredicate`, NOT an in-place edit of the exact-set `v1`). Trust primitives (`persona_id`,
  hashes, sigs) public-by-default; prose/body/diff user-discretionary (the access model).

### Wave 5 - intake-gate promotion (independent, Rung-2)

- Promote `hasExternalMergeHistory` from a default-off advisory arm to a submit-time fail-fast for Rung-2
  (stranger-repo) targets. Rung-1 is N/A (the USER owns the repo). Keep `null` = keep (a network blip
  never silently drops a good candidate). Independent of Waves 1-4; can land anytime.

### Arming tail (OPERATOR-only, NOT this build)

The authenticated cross-uid edge minter (ladder item 5 / PR-A2b) + the `LIVE_SOURCES` flip. Until both,
every node is integrity-not-provenance (a same-uid process can co-forge a byte-valid node/edge), so no
banked node may HARDEN a toolkit weight. Claude never arms this.

## 3. Load-bearing invariants (the build must hold all)

- SHADOW / weight-inert: the real dam is a two-gate AND - `isWorldAnchorArmed()` false AND custody verify
  keys absent (`LIVE_SOURCES = Object.freeze(isWorldAnchorArmed() ? [WORLD_ANCHOR_SOURCE] : [])`,
  `weight-source-gate.js:55`, NOT a hard `[]` literal - board L2/H2); the edge stays unsigned; no banked
  node hardens a weight until the authenticated cross-uid minter arms (operator-only).
- The `world_anchored` 7-key body is a FROZEN cross-repo contract; any change is a coordinated superseding
  bump on both toolkit and Embers (Embers verify-on-read refuses a shape drift).
- Recall injects as advisory DATA (reuse `renderFencedBoundedBlock`), gates nothing, never mutates the
  graded `record` (OQ-NS-6). The recall SOURCE is provenance-authenticated, never the integrity-only lane.
- Every new flag parses asymmetric strict-truthy (a typo fails CLOSED to the safe path).
- Pins are HASHES, not payloads; the context bundle = exactly what the actor received (no more).
- Declared vs attested are DISTINCT pins with distinct provenance; a self-asserted constraint is never
  rendered as proven.
- Persona key = the bare `canonicalPersonaKey` (`node-backend`), reconciling the legacy numbered form, not
  re-forking it. Tolerate `persona:null` (classifier miss).

## 4. The seam contract to hand Embers (already in the handoff doc)

- The `world_anchored` 7-key node body (frozen) is the `bank --node` artifact, emitted unmodified.
- `meta.json` = `{prUrl, repoSlug, minter:{persona_id, human_root}, failureSignature (default =
  node.lesson_signature), scope, ...}` synthesized from the `merge-outcome` record + persona-attribution.
- The four pins land via `ember/v2` (`registerPredicate`). Access model: Class 1 public-floor, Class 2
  discretionary; `inherited` gated on the witness layer.

## 5. Open decisions for the review board

1. Recall SOURCE - the local `world_anchored` store (SHADOW-empty until arming) vs read-back from the
   Embers commons (the authenticated consumer). Recommendation: adopt the `retrieveWorldAnchoredInstincts`
   shape now (empty until arming); make the Embers commons the eventual authenticated source. NEVER the
   integrity-only `confirmedNodeIds` lane for a live injection.
2. KB-body inlining - pin what the actor TRULY receives (no KB bodies today; honest but thin
   `context_commons_ref`) vs first inline KB bodies (a behavioral change to the solve) then pin them.
   Recommendation: honest-thin in v1; KB-body inlining is a separate, separately-validated behavioral wave.
3. Pin placement - per pin, in the `node_id` identity basis (identity-affecting) vs sealed-but-not-identity
   (inside `content_hash`, outside the basis). Recommendation: `recall_graph_root` + `runtime` are
   emit-context -> in-basis; `persona_def_ref` + `context_commons_ref` -> sealed, non-identity.
4. Materialize default - flip `LOOM_PERSONA_MATERIALIZE` on (so a persona actually activates and there is
   context to pin) vs keep off. A bare-prompt run has no persona context to pin at all.
5. Automate-vs-operator for the export driver (Wave 4b) - fully automated on merge-outcome appearance vs
   operator-triggered. Live exercise is arming-gated either way.
6. Schema-bump strategy - one coordinated `world_anchored` v2 + `ember/v2` bump for all four pins, vs
   staged. The cross-repo freeze makes a single coordinated bump the safer path.

## 6. Deferred / out of scope (named, not silent)

- The authenticated cross-uid minter + `LIVE_SOURCES` flip (operator arming; the #273 close).
- KB-body inlining into the actor prompt (a behavioral change; its own wave - see 5.2).
- The revise loop (Gap-8, `emitPR` update seam) and the F-W4 fork path - Rung-2 scaling, per the anchor.
- The Trust Explorer UI - Embers' side; this blueprint only produces the data it renders.

## Runtime Probes (per the runtime-claim-probe discipline)

Every current-state claim above is grounded in a 2026-07-10 five-slice file:line recon. Load-bearing
probes:

- `Probe: live-draft-run.js:195-255,:325` -> the loop mints a `live_pending` node on every eligible solve
  (corrects "mints zero").
- `Probe: world-anchor/live-recall-store.js:60-132` -> the `world_anchored` node is an exact 7-key sealed
  body (the frozen cross-repo `bank --node` contract).
- `Probe: grep -rniE '\bembers\b' packages --include=*.js = 0` -> the toolkit -> Embers export seam is
  entirely absent.
- `Probe: grep recall|buildGroundingSlice|grounding in live-draft-run.js / live-solve-one.js = 0` -> the
  recall-into-live-solve step is genuinely missing (the crux).
- `Probe: issue-classifier.js:127-171` -> the classifier returns `{persona, classify_signal, matched}` and
  NO `trigger_class` (the reference-class signal must be built).
- `Probe: world-anchored-recall.js:140-183` -> `retrieveWorldAnchoredInstincts` is provenance-correct but
  SHADOW-EMPTY (frozen `LIVE_SOURCES` -> weight 0 -> `instincts:[]`) until arming.
- `Probe: docker-actor-backend.js:173-204` -> `attestActorContainment` produces a real isolation report
  that is discarded (the attested-constraint source exists but is not captured).
- `Probe: persona-prompt-materializer.js:80-151` -> `materialize` inlines persona prose + skill/KB NAMES,
  never KB bodies (so the actor receives zero KB content today).
- `Probe: canonical-json.js` + `computeContentHash(body)` idiom across the world-anchor stores -> the
  reusable content-address primitive (do not invent a new hasher).

## Review board (2026-07-10)

A 4-lens board (architect, code-reviewer, hacker, honesty-auditor), each premise-probing the tree.
**Verdicts: architect NEEDS-REVISION, code-reviewer NEEDS-REVISION, hacker NEEDS-REVISION, honesty-auditor
SOUND-WITH-NOTES.** Every load-bearing finding was re-confirmed firsthand (F1, H1, F2, the `LIVE_SOURCES`
mechanism) - the board is essentially all true-positive. **The corrections below are AUTHORITATIVE over the
body where they conflict.** Two findings open a genuine design fork that needs a USER decision (marked FORK).

### CRITICAL

- **F1 - the recall wiring trips a deliberate CI dam the recon missed (`drift:recon-depth`).**
  `tests/unit/lab/persona-experiment/drafter-recall-disjointness.test.js` forbids the whole
  `world-anchor/` dir + `world-anchored-recall.js` in `live-draft-run.js`'s transitive import closure
  (checked on RESOLVED paths, so it fires regardless of SHADOW-empty output). Its assert message: wiring it
  means "the armed-weight lane has been wired into the DRAFTER path. Land a kernel-level dam + require
  deployed+attested cross-uid arming before fusing these lanes." So Wave 1's "wire the retriever via
  `deps`, SHADOW-inert is free" is FALSE - the wiring IS the lane-fusion decision the dam guards, and it
  has no carve-out (unlike the sibling `shadow-import-graph.test.js`'s `isB3RecallConsumer`).
  **FORK (USER):** land Wave 1 recall via (a) a board-approved scoped carve-out to the disjointness test,
  or (b) a new board-reviewed boundary module the dam is updated to permit. Either is its own board line
  item; it cannot be folded silently. Until decided, Wave 1 does not land as written.

- **H1 - the recall lane is integrity + key-possession, NOT provenance, until cross-uid deployment; the
  arming tail guards WEIGHTS only, not the new injection channel.** `admit-world-anchor-node.js` header:
  "B2 admission is INTEGRITY + key-possession, NOT PROVENANCE... an attacker who controls the lab stores
  can CO-FORGE a self-consistent quadruple that admits... the close is PR-B5 arming." So my "recall SOURCE
  is provenance-authenticated" label is wrong. On a same-uid box armed for hardening, a co-forged
  `lesson_body` flows straight into the live external-repo actor's prompt. **RESOLUTION:** relabel the
  recall lane "integrity + key-possession, provenance-authenticated ONLY at cross-uid deployment"; the
  recall-INJECTION channel gets the SAME cross-uid-deployment gate as weight-hardening (not merely
  `LOOM_WORLD_ANCHOR_ARM`); injection fail-closes to empty until cross-uid-deployed even with
  `LOOM_RECALL_INJECT` on; the DATA-framing is demoted to necessary-but-not-sufficient (H6). This is the
  same decision F1's dam forces - the two CRITICALs converge.

### HIGH

- **A1 - "byte-identical-until-armed" contradicts Decision #4.** Flipping `LOOM_PERSONA_MATERIALIZE` on is
  a non-arming behavioral change to the actor prompt (the class Decision #2 refuses for KB-inlining), and
  it is decoupled from egress arming. RESOLUTION: scope byte-inertness to Wave 1 only; model
  `LOOM_PERSONA_MATERIALIZE` and egress arming as two INDEPENDENT flags; treat materialize-ON as a named,
  separately-validated behavioral flip; Decision #4 is a HARD prerequisite of Wave 2.
- **A2 / M1 - Wave 1 cannot deliver A3 project-scoping.** The `world_anchored` node body carries no `repo`
  axis, and `retrieveWorldAnchoredInstincts` only SORTS by `trigger_class` (does not hard-filter).
  RESOLUTION: Wave 1 recall is `trigger_class`-sort-preference only, explicitly NOT project-scoped;
  enforced `(repo x trigger_class)` hard-filtering (anchor A8/A3) is a later wave, and it is where the
  Embers-`kindle` read-back (whose `meta.json` carries `repoSlug`) supplies BOTH repo-scope and
  authenticated provenance (A7). Wave 1's local retriever is a labeled SHADOW placeholder, not the
  production path.
- **F2 - the mint join does NOT carry pins forward.** `collectCapturedCandidates` extracts ONLY
  `{lesson_signature, lesson_body}` by a load-bearing design comment ("DELIBERATELY not propagated"), and
  static-origin (Branch A grandfather) nodes have no `live_pending` record to pin from. RESOLUTION: Wave
  2c/3a must name the concrete edit sites (`collectCapturedCandidates` + the `mintWorldAnchoredNode(...)`
  call) and decide Branch-A handling (nullable-sentinel pins or exclude static-origin from v2).
- **F3 / A6 - do NOT put pins in the node_id identity basis.** `recall_graph_root` legitimately differs
  per attempt, so an in-basis placement mints a distinct `node_id` per retry, breaking Branch-B's
  exactly-one-`live_pending`-per-join-key assumption (spurious `ambiguous-captured-lesson` refusals). And
  `anchor_id` already disambiguates the node. RESOLUTION: all four pins are `content_hash`-sealed,
  non-identity metadata (Decision #3 resolved).
- **H3 - Wave 4 `embers bank --key` under-specifies the signer.** If producer-held, banking laundering a
  co-forged node into an apparently-provenance-bearing ember. RESOLUTION: `--key` is an OPERATOR/cross-uid
  custody key, never producer-held; the live `embers bank` invocation is arming-gated (not just its "live
  exercise"); a pre-arm export must be marked UNAUTHENTICATED on the Embers side.
- **H1-honesty - "Embers consumer fully BUILT and byte-parity" is asserted as fact but is an OPEN confirm
  item.** The handoff doc REQUESTS parity ("exact shape to follow"). RESOLUTION: downgrade to "Embers
  Phase 1 built the bank/meta SHAPE; byte-parity is an OPEN cross-repo confirm"; make the parity handshake
  an explicit Wave-4 precondition.

### MEDIUM (folded)

- **A3** - freeze a single pin-shape contract artifact (exact canonical-json inputs per pin) that BOTH
  repos build against; add an arming-time precondition "Wave 4 export gated on `ember/v2` registered in
  the target commons." **A4** - v2 node schema uses always-present-nullable pins (empty-string sentinel)
  so Branch-A grandfather nodes validate. **A5** - `persona_def_ref` = persona-DEFINITION-version identity
  (fine to hash the full brief+contract, labeled as version-identity, NOT "received"); add a SEPARATE
  received-block digest (hash of the rendered `.block` + the `truncated` flag) if "exactly what the actor
  received" is to hold. **A7** - name the Embers-`kindle` read-back as an explicit later wave (its own
  retriever + provenance check). **F4 / M2** - split Wave 2b: per-emit `{model,tools,timeout}` (already
  threaded) vs the attested pin (needs plumbing from `preflightEnv`, which discards the report; decide
  reuse-once-per-run vs re-attest-per-record - the latter spins a container ~15s/call). **F5** - Wave 1c
  decomposes the single `if (persona && personaMaterializeEnabled())` block into two independently
  flag-gated builders (cite `live-draft-run.js:127-132`, not one line). **H4** - the "attested" pin is
  self-asserted-until-kernel-signed and is `attested:false` (negative) in SHADOW/CI; pin it honestly as
  "self-reported containment (unauthenticated)" until a kernel attestation signer arms. **H5** - sanitizer
  composition: each `lesson_body` passes `grounding-slice.renderLesson` (`stripControlChars` +
  whitespace-collapse + per-line cap) BEFORE `renderFencedBoundedBlock` - the two are NOT one framing, and
  `renderFencedBoundedBlock` alone does not strip control chars. **H6** - DATA-framing is
  defense-in-depth, not the trust boundary (folded into H1).

### LOW / NIT (folded)

- **A8** - Wave 1b needs glue (the retriever returns structured nodes, not a rendered block); pick ONE
  renderer. **A9** - reframe: Wave 1 is the SHADOW-inert consumer STUB; the crux CLOSES at Wave 4 +
  arming, not at Wave 1. **A10** - `hasExternalMergeHistory` is "never drops BY DEFAULT" (an arming-gated
  drop knob exists); the mint auto-fires post record-merge, the OBSERVE trigger is operator-manual.
  **H7** - the pins are co-forgeable exactly as the node is; `recall_graph_root`'s growth-curve must NEVER
  be a hardening/ranking input; unicode bidi/zero-width survive `stripControlChars` (a Trust Explorer
  rendering concern -> cross-substrate note to Embers). **L1** - mark Decision #1 as DECIDED-in-Wave-1b
  (board ratifies), not open. **L2** - `LIVE_SOURCES = Object.freeze(isWorldAnchorArmed() ?
  [WORLD_ANCHOR_SOURCE] : [])` (`weight-source-gate.js:55`) - frozen-empty only while unarmed; the real dam
  is the arming-flag read AND absent custody keys (a two-gate AND), not a hard `[]` literal. **L3** - the
  attest BOOLEAN gate is consumed at preflight; only the detailed REPORT is uncaptured.

### Cross-ref - the Embers handoff reconciliation (corroborates H1 + H1-honesty)

The `docs/handoff-embers-persona-commons-sync.md` doc was reconciled against Embers' actual PRD + ADRs and
corrects three toolkit-conflated premises: **Embers is a receiver-sovereign, merge-anchored lesson-log,
NOT a "control plane / system of record"** (no central authority, no persisted global state, validity is
receiver-local); **Embers has NO reputation store** (that is a toolkit concept; a persona's "standing" is
a receiver-local weight derived on read, never a persisted rank); and - load-bearing for this blueprint -
**a merge -> persona ATTRIBUTION is authenticated ONLY if the plugin binds persona into the
`world_anchored` node's SIGNED basis at mint (gap8-a0b); Embers banking a self-asserted `minter` label does
NOT authenticate it.** So the persona identity belongs in the node's signed basis, not merely `meta.json` -
a design change to Wave 2/§4, and it composes with H1 (the whole lane is integrity-not-provenance until
cross-uid deployment). The four pins are an ADVISORY `ember/v2` predicate add, NEVER trust inputs.

### Net + what needs a USER decision

Mechanical/correctness fixes (A1, A2, A5, A6, F2-F6, H3-H7, all LOW/NIT) are folded as resolutions above
and will be applied when this becomes an execution plan. **Two forks need your call before Wave 1 can
land:** (1) F1 - the disjointness-dam approach (scoped test carve-out vs a new boundary module); and (2)
H1 - confirm the recall-injection channel gets its OWN cross-uid-deployment gate (fail-closed until then),
distinct from `LOOM_WORLD_ANCHOR_ARM`. Both point at the same real question: wiring recall into the drafter
is the "fuse the lanes" Rubicon the substrate deliberately dammed, so it is a deliberate arming-class
decision, not a routine wire. Everything else is ready to sequence once those two are answered.

### FORK RESOLVED (USER, 2026-07-10) - the boundary-module approach

The USER chose the boundary module over relaxing the dam or wiring the lane directly. It resolves BOTH
CRITICALs (F1 + H1) with one structural move, and it becomes the authoritative Wave-1 design:

- A thin drafter-side seam `recall-inject-boundary.js` (in `persona-experiment/`) is the SINGLE audited
  bridge between the drafter and recall lanes. `live-draft-run.js` imports ONLY this boundary, never the
  recall/weight lane.
- The boundary does NOT statically import the recall lane. It invokes recall as a CROSS-UID SUBPROCESS
  (execFile `world-anchored-recall-cli.js` under the cross-uid custody holder, uid 612). Two properties
  fall out: (a) the module graphs stay disjoint - the recall lane never enters the drafter's static import
  closure, so the disjointness INVARIANT is preserved, not carved out; (b) the cross-uid provenance gate
  (H1) is STRUCTURAL, not a flag - recall runs under the uid holding the signing key the drafter uid cannot
  `read()`, which IS the #273 provenance close. Until cross-uid deployment, the subprocess is
  absent/unresolved -> the boundary returns EMPTY (fail-closed), so injection is byte-identical to the bare
  prompt. This subsumes FORK #2: the cross-uid injection gate is the subprocess-uid boundary itself,
  distinct from `LOOM_WORLD_ANCHOR_ARM`.
- The boundary enforces the injection-only contract: it returns ONLY a sanitized fenced advisory DATA
  block or empty - NEVER a weight, never a record mutation - applying the H5 composition (`renderLesson`
  `stripControlChars` -> `renderFencedBoundedBlock`) + the H7 unicode-category guard (bidi/zero-width).
- The disjointness dam (`drafter-recall-disjointness.test.js`) is UPDATED (board-reviewed), NOT relaxed:
  it now (a) permits `recall-inject-boundary.js` in the drafter closure, (b) asserts the boundary does NOT
  statically import the recall lane (subprocess-only), and (c) asserts the boundary's fail-closed-to-empty
  and sanitization contract. The lanes remain graph-disjoint, mediated by one audited process boundary.
- Sequencing (honors A9): Wave 1's SHADOW half - the boundary module + the updated dam + tests
  (fail-closed-empty, no cross-uid process present) - is buildable now; the cross-uid subprocess deployment
  is the OPERATOR arming step (never Claude), and that is when the recall wire actually closes.
