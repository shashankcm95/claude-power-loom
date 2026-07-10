# Handoff to Embers — persona-commons sync (2026-07-10)

> A high-level sync doc to align the Embers blueprint with the cross-substrate decisions made in the
> Power Loom session on 2026-07-10. Pass this to the Embers session. It states the seam, the trust split,
> the persona-context model, and the access-control model we converged on. It does NOT prescribe Embers'
> internals - where a decision touches Embers' own mechanisms, it is framed as "confirm / add", not "do X".
>
> **Reconciled against Embers' north-star (PRD + ADRs 0001-0011) and premise-verified against the Embers
> code on 2026-07-10.** Corrections folded: governance vocabulary trimmed to fit Embers' anti-authority,
> no-relocated-throne charter (Embers is a receiver-sovereign lesson-log, NOT a "control plane" /
> "system of record" / reputation store); three toolkit-conflated premises (reputation, recall-graph,
> ADR-0012) relabeled as plugin/toolkit concepts; the persona-context pins marked as a predicate-v2 ADD
> (not present-tense ember fields); the persona-context hierarchy + access model marked as proposals for
> Embers' deferred multi-party phase.

## 1. The relationship: producer / verifiable commons

- Power Loom (plugin) = the execution engine + producer. It solves, observes the merge, and produces
  artifacts. It holds no durable trust state.
- Embers = a receiver-sovereign, merge-anchored lesson-log that banks, verifies, logs, and consolidates
  what the plugin produces. It is a durable log of embers (INTEGRITY), NOT a "control plane" or a "system
  of record" that OWNS trust state: per Embers' charter there is no central authority, no trust in the log
  operator, and NO persisted global state (validity is receiver-local, derived on read; NS-5 "no relocated
  throne"). Provenance is INTEGRITY-only until the operator arms a cross-uid signer; Embers never becomes
  the authority.
- A future read-only Trust Explorer UI (ADDITIVE; not in Embers' current scope) would be a projection of
  Embers and never a trusted intermediary - offline-verifiable-by-construction: it shows only what anyone
  can independently verify.

## 2. The seam (Embers already built the shape - premise-verified)

- Handoff artifact: the toolkit's `world_anchored` node -> Embers `bank --node` -> `ember/v1`. CONFIRMED
  (`publish.js:19` -> `build-lesson.js:37`, which re-verifies the node's own seals, #273 integrity-on-read).
- Return path: Embers `kindle` -> a sanitized, data-labeled advisory block (Embers DOES build the sanitize
  and data-label boundary: `kindle.js:69-82`, `sanitize-lesson-body.js`, `as-advisory-context.js`) -> emitted
  to stdout; the INJECTION into the next solve is the plugin's wire.
- Ownership: the producer wire (mint a live lesson) and the consumer wire (recall into a solve) are the
  plugin's build; the authenticated commons (bank / log / weight / confirm / sanitize) is Embers'.
- Action: we will send the exact `world_anchored` node + `meta` shape after plugin recon; please confirm
  it matches what `bank --node` / `meta.json` expect, and flag any field you need that we do not emit.

## 3. The three-axis trust split (who owns what)

- Integrity: both, at their own boundary (content-address + verify-on-read here; DSSE + Merkle in Embers).
- Provenance: established in Embers via `persona-binding` under the attested human root - a persona is a
  K_root-bound, KEY-HOLDING identity whose pubkey must equal the key its lessons are DSSE-signed under
  (anti-bind-swap). The plugin's `built_by` persona tag is an unauthenticated LABEL that resolves to
  `unverified` (weight 0) until it corresponds to such a registered binding. NOTE: Embers does not "sign
  over" a free-text tag; and a cross-substrate merge->persona ATTRIBUTION is only authenticated if the
  plugin binds persona into the `world_anchored` node's SIGNED basis at mint (gap8-a0b) - Embers banking a
  self-asserted label does not authenticate the attribution (see §10).
- Validity: Embers owns it and correctly refuses to claim it mechanically (receiver-weighted,
  consumption-earned, never inherited from the anchor). The plugin does not try to own validity - a merge
  proves the contribution event, not that the lesson faithfully interprets it. Please keep it that way:
  a persona-context bundle (below) is legibility/provenance metadata, narrows-only, never a hardening input.

## 4. The persona is a distributed object (a legibility join, NOT a rank-bearing object)

- Mechanics (persona prose + contract + KB refs + memory) live in the plugin: git-versioned, CI-frozen.
  Do NOT mint these as opaque blobs - that trades away the CI guarantees the persona work depends on.
- Identity + lessons live in Embers: identity minted (`persona-binding`), lessons minted + logged. Embers
  has NO reputation store, by design (NS-5, "no relocated throne"): a persona's "standing" is a
  receiver-LOCAL weight DERIVED ON READ from its lessons' consumption-earned validity, never a persisted
  global rank. "Grouping a persona's lessons" is a derived legibility VIEW over the signed
  `minter.persona_id`, not a first-class trust object. (Reputation-as-a-store is a TOOLKIT concept
  [`packages/lab/reputation/`], deliberately absent from Embers.)
- Neither half alone is "the persona." A future UI's job is to present the join as one persona object.
- This is the mechanics-freeze / state-accrues split made physical - where "state" = the logged lessons +
  their receiver-derived weight, never a persisted score.

## 5. The persona-context model (the meta-class) - pointers, not payloads

The load-bearing constraint: a lesson carries content-HASHES, never payloads, so no plugin data is dumped
into Embers.

PROPOSED (predicate v2 - these are NOT ember fields today: the Embers predicate is EXACT-SET closed
[`lesson-v1.js:33-36`] and the free-form `scope` bag is explicitly forbidden from carrying trust, so they
must be ADDED as first-class ADVISORY/legibility fields, never trust inputs):

- A lesson would pin:
  - `context_commons_ref` - a content-hash of the KB doc hashes + shared skills, owned at the human-root
    level and stored ONCE per plugin version (dedup across all lessons of that version). Plugin-resolved;
    Embers stores the hash, never the payload.
  - `persona_def_ref` - a hash of that persona's prose + declared constraints + reference-class.
  - `recall_graph_root` - the PLUGIN-side content-addressed root of the persona's recall slice at emit
    time. NOTE: the recall graph is a PLUGIN structure (toolkit `attribution/recall-graph-store.js`);
    Embers stores this root OPAQUELY and never resolves or owns it. Because it is pinned per lesson, the
    sequence of roots IS the cumulative-growth curve - which stays LEGIBILITY-only, never a trust/quality
    signal (a growth count would be the same self-mint laundering the trust model forbids).
  - `runtime` - the small per-emit facts that live in no file: model, actual tool set, timeout, budget.
- The context bundle = EXACTLY what the contained actor received (the materializer output): the
  materialized prompt (prose + inlined instincts), the KB docs it cited, the grounding slice it was
  handed, and the runtime constraints. It is a CLOSED, capturable set - not "all relevant context".
- Store hashes, not text. Embers holds pointers plus the human's own resolvable content; a hash resolves
  to readable content on demand against the plugin's published KB. This solves bloat, "don't dump the
  plugin", and (in a multi-party commons) confidentiality in one move.
- Hierarchy (a PROPOSED superstructure; composes with `persona-binding`, which already binds `persona_id`
  -> human root):

  ```
  human root (persona-binding, K_root-signed)
    +-- shared context commons  (KB doc hashes + shared skills; stored once per version)
    +-- persona definitions      (thin: prose + declared constraints + reference-class; diverse skillsets)
          +-- recall graph        (per persona, grows; plugin-side, Embers stores the root opaquely)
                +-- lessons        (pointer-tuples: context_commons_ref, persona_def_ref, recall_graph_root, runtime)
  ```

## 6. Declared vs attested constraints (a PLUGIN/harness axis, distinct from Embers' "attested root")

- Declared (what persona.md says the persona is limited to): self-described, git-verifiable. Fine for
  legibility; carry as a hash.
- Attested (what the contained actor ACTUALLY could do): a PLUGIN/harness fact (the toolkit's ADR-0012
  static capability from agent-frontmatter; the container's observed fs/net/proc isolation). A constraint
  that is a TRUST claim ("produced write-confined") must be attested by that harness, never
  persona-self-asserted (integrity is not provenance). NOTE: this "attested" is a HARNESS-CAPABILITY axis,
  distinct from Embers' existing "attested ROOT" (the K_root provenance anchor) - do not conflate the two.
- A future UI must label `declared` vs `attested` and never render a self-asserted constraint as proven.
- Likely v1: declared-only (cheap, ships now); harness-attested is a plugin/kernel build that drops in
  later behind the same field. Neither is built in Embers today.

## 7. Access-control model (2 classes x 3 modes) - PROPOSED (presupposes the multi-party commons)

NOTE: Embers today is single-user / receiver-private (its multi-party "shared witnessed commons" is a
deferred/future phase). This access model is a `confirm/add` PROPOSAL for that phase, not a present-tense
Embers capability.

| Data class | public | inherited (container's audience) | private |
|---|---|---|---|
| Trust primitives (`mergeId`, `persona_id`, provenance, sigs, hashes) | default | allowed | forbidden |
| Content (persona.md, KB bodies, lesson body, diff) | allowed | allowed | allowed |

- Trust primitives are public-floor by law, not preference: a private provenance is unverifiable (= no
  provenance), and a `mergeId` is physically public anyway (a real PR on the forge). Never private.
- `inherited` = follow the container's (commons/root's) audience, not a per-item ACL.
- Content is fully user-discretionary (public / inherited / private) - this is where the user's real
  control lives.
- Prerequisite: `inherited` mode for the trust-primitive class needs the N-of-M witness layer armed
  (Embers P6's deferred operator half). Without witnesses, a scoped log lets the operator equivocate
  (split-view). So the safe v1 is: Class 1 public-only; inherited-scoped is a post-witness-arming feature.
  Class 2's full three modes can ship now.
- Honest limitation: access gates ARTIFACTS, not INFERENCES - a public lesson derived from a private KB
  can still leak the KB's substance. Do not promise a private KB stays secret if its lessons are public.
- Refinement: split `persona_id` into an opaque id (public, verifiable anchor) plus a friendly name
  (Class 2, discretionary), so a roster can be pseudonymous while still establishing trust.

## 8. Coherence with the north-star (why the access model does not weaken trust)

- OQ-NS-6: trust HARDENS only at a world-anchored merge; the internals are legibility, not the trust
  source. So content-private does not weaken trust - the public `mergeId` + provenance ARE the trust.
- NS-5: validity is receiver-local, derived on read - there is no persisted global rank to protect or leak.
- Only CONFIRMED (merged) lessons feed recall; a lesson's validity is consumption-earned, never inherited
  from the merge event.

## 9. What we are asking of the Embers blueprint

Confirm / add (Embers decides the internals):

- Confirm the `bank --node` + `meta.json` shape vs the toolkit's `world_anchored` node (exact shape to follow).
- ADD (predicate v2) the lesson pins - `context_commons_ref`, `persona_def_ref`, `recall_graph_root`,
  `runtime` - as hash/scalar ADVISORY fields on the ember (not payloads, never trust inputs). They are NOT
  ember fields today; the predicate is exact-set closed, so this is an add, not a confirm.
- A human-root-level context commons: a content-addressed bundle (KB doc hashes + shared skills)
  referenced by persona definitions and lessons. (Net-new structure; no Embers equivalent today.)
- The access-control layer (§7): Class 1 public-floor / Class 2 discretionary; `inherited` gated on
  witnesses. Scoped to Embers' deferred multi-party phase.
- Keep validity receiver-weighted; the context bundle must not become a hardening input.

## 10. Open items to co-decide

- Confirm `inherited` semantics = follow-the-container's-audience.
- Single-user LEDGER vs multi-party commons (shapes the `persona_id` namespace, ties to the opaque-id
  decision, AND determines whether the attribution boundary below needs gap8-a0b).
- `persona_id` opaque + friendly-name-as-content (we lean this way; confirm).
- Persona identity continuity across KEY ROTATION: the binding is first-writer-immutable and rotation = a
  NEW `persona_id`, which orphans the grouping/anchor. Decide whether accumulated trust survives via a
  signed `supersede`-link chaining old `persona_id` -> new.
- The merge->persona ATTRIBUTION boundary: for a multi-party commons the persona must be bound into the
  plugin's `world_anchored` node SIGNED basis at mint (gap8-a0b); Embers banking a self-asserted label
  does not authenticate the attribution. (Single-user: the operator vouches; multi-party: gap8-a0b required.)
- Sybil under one human_root: N personas under one root are attributable but NOT independent - any
  human_root/persona aggregation must discount/dedupe by `human_root`.
