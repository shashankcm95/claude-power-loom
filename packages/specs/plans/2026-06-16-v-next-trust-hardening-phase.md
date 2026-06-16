# v-next — Trust-hardening phase (scope plan)

> Status: **SCOPING** (pre-wave). Produced by the `v-next-scope` workflow (3 codebase-analyzer
> probes + architect synthesis) 2026-06-16. This is the umbrella scope; each wave gets its own
> per-wave plan (Runtime Probes -> architect VERIFY -> TDD build -> multi-lens VALIDATE -> PR).

## Goal

Close the v3.11 phase-close "carries" — the three items named in the ROADMAP v3.11 sign-off as
the work that actually *hardens* trust (vs the bootcamp, which only NARROWED, per OQ-NS-6):

- **Carry A** — a LIVE signature retriever with an OQ-7 provenance firewall (filters
  `provenance=backtest` out of any live trust surface).
- **Carry B** — the A6 lesson-bridge that injects confirmed lessons into a live spawn.
- **Carry C** — signed / kernel-writer `confirmed-by` edges that close the #273 provenance
  residual (an authenticated minter so the advisory confirmed-weight cannot be co-forged).

## Runtime Probes (confirmed firsthand 2026-06-16, not from prose)

| Claim | Probe | Result |
|---|---|---|
| No kernel signing primitive to reuse | `grep -rnE 'createHmac\|createSign\|crypto\.sign\|privateKey\|publicKey\|ed25519\|generateKeyPair\|HMAC' packages/kernel` | **zero** -> Carry C MUST build the minter (kernel-layer build) |
| No live caller of the retriever | `grep -rnE 'retrieveBySignature\|measureDiscrimination' packages` (excl. `_spike`/tests) | **zero** -> "LIVE" is net-new; nothing consumes retrieval today |
| Corpus rejects `provenance:'live'` | `corpus.js:46` admits `['backtest']` only; `validateEnum(raw,'provenance')` at `:113` | confirmed -> ENUM widen is a prerequisite edit |
| Co-forge surface is exported | `deriveEdgeId` (`recall-edge-store.js:177`) + `writeCandidate`/`sidecarSha` (`candidate-sidecar.js:68`) | confirmed exported -> the #273 co-forge is real, not theoretical |

**Deferred to their wave (heavier, Rule-2a / ADR-0012 probes — MUST run before that wave builds):**

- **[C, the red-test]** Co-forge a `confirmed-by` edge end-to-end against the BUILT store (read a
  real `from_node_id` -> `writeCandidate(arbitraryBytes)` -> `deriveEdgeId(handBuiltRec)` -> drop
  `<edge_id>.json` -> `runConsolidationPass` -> assert `recurrence_count_confirmed` incremented with
  ZERO gate runs). This becomes the red-test C's minter must turn green.
- **[C, threat-model fit]** Confirm `runConfirmationPass` is lab-process code (a same-process secret
  is readable by the lab caller) -> forces ed25519 (kernel-held private key) or a separate-process
  writer, NOT a shared HMAC secret.
- **[A/B, ADR-0012 re-confirm for the LESSON path]** Throwaway `claude -p` spike: attempt to inject
  a lesson string into a sub-agent's context via a `PreToolUse:Agent` `updatedInput`; confirm it does
  NOT appear. Premise that kills the obvious bridge and forces static-synthesis / advisory-read.
- **[A/B, data gate]** Run `measureDiscrimination` against the current real lesson corpus: MEASURED
  vs INSUFFICIENT-N. A bridge/retriever must not ship from a corpus that cannot discriminate.

## Dependency order

The carries form a partial order, driven by two facts: (1) the trust-weight the retriever ranks on
is **co-forgeable until Carry C authenticates its minter**; (2) a backtest-only retriever NARROWS
but cannot HARDEN — only a **world-anchored** live node (Carry B's territory) can (OQ-NS-6).

```
C (shadow-complete authenticated minter)
  -> A + B  (co-build in shadow against a shared live-node / live-store contract; A<->B entangled)
    -> measure world-anchored discrimination
      -> flip LIVE only after C is enforcing AND a world-anchored signal exists (W6)
```

- **C -> {A, B}**: both consume `recurrence_count_confirmed` (A as ranker tie-break
  `retrieve-signature.js:65`; B as injection-selection weight). `security.md` §"integrity != provenance":
  *the moment such a weight gates/steers a live surface, the authenticated writer is mandatory.* So C
  is a HARD prerequisite for the LIVE form of either A or B. C also stands alone as defense-in-depth
  (no other carry need promote the weight for C to be worth doing) -> the **dependency-free entry point**.
- **B -> A (for hardening)**: A cannot HARDEN until a `provenance='live'` node exists to retrieve;
  that node is born of Carry B's world-anchored run/merge.
- **A <-> B (for live-ness)**: B's bridge needs A's retriever to *select* the right lesson; A's live
  retriever needs B's bridge (or a recall CLI) to be "LIVE" at all. Co-design against a shared contract;
  flip live together.

## Wave breakdown

| Wave | Carry | Scope | Ships |
|---|---|---|---|
| **W1** (SHIPPED — see carry plan) | C | Build the kernel ed25519 signing primitive (none existed). Add `edge_sig`/`sig_alg` as additive top-level fields **OUTSIDE** the `edge_id` basis (`deriveEdgeId` UNCHANGED — no basis-version bump, no orphaning). `verifyEdge` SHAPE-checks a present sig (sig_alg pinned ed25519 + canonical base64); the store stays integrity-only + **key-free** (it does NOT crypto-verify — Design Y, post-VALIDATE: a key-free store never drops a legit edge on a key mismatch). Crypto PROVENANCE is enforced SOLELY in the authenticated lane (`authenticatedEdgeIds`, fail-closed), NOT in `verifyEdge`. The minter (`runConfirmationPass`) signs via an injected private key. | **SHADOW-COMPLETE**: accept-both (unsigned legacy edges load UNCHANGED); `confirmedNodeIds`/`runConsolidationPass` UNCHANGED (zero downstream change). Internally provable -> satisfies beta-internal-verification mandate without a world signal. |
| **W2** | C | Switch the live consumer (`runConsolidationPass` -> `confirmedNodeIds`) to the authenticated lane (`authenticatedEdgeIds`) so ONLY authenticated edges feed the weight; re-mint (or clean-slate wipe) the edge corpus under the authenticated minter; define the key-rotation / trust-set contract BEFORE a live verify key is wired (Design Y: a stale-key edge degrades to unauthenticated, never vanishes). | **LIVE/enforcing in the consolidation path** (authenticated-only weight); the weight is still SHADOW/ADVISORY downstream (steers ordering, gates nothing). Unblocks A/B live form. |
| **W3** | A+B | Widen `corpus.js:46` ENUM to admit `'live'`. Build the LIVE recall-graph store (mirror `recall-graph-store.js`, firewall **inverted**: reject `provenance!=='live'`, separate `recall-graph-live/` dir). Define the live-node minting contract (the A<->B seam). | **SHADOW**: live store exists + rejects non-live; nothing mints/consumes a live node. Pure substrate. |
| **W4** | A | Promote the spike retriever to a live module. Add an EXPLICIT `provenance==='live'` admission gate to the ranker (defense-in-depth — `retrieve-signature.js:36-37` filters only on `classifyLessonLayer==='valid'`, NOT provenance, so a mixed store would silently rank backtest into live trust). Tie-break on the W2-authenticated weight. | **SHADOW** until a live consumer (W5) exists. Provenance gate + authenticated weight are LIVE the moment the consumer is. |
| **W5** | B | Build the bridge in the shape the probes permit (ADR-0012 makes per-spawn hook injection INERT): EITHER (a) static agent-definition/persona synthesis (a periodic Lab pass rendering confirmed lessons into the static files the harness reads — owns a deterministic, regenerable file region to survive install-clobber) OR (b) orchestrator advisory-read of a Lab-materialized lessons snapshot (the A6 reputation pattern re-applied). Consumes A's retriever to select by `trigger_class`. | Ships **SHADOW** first (advisory/dry-run render of what WOULD inject, measured for leak + discrimination), then LIVE once PROBE-1/2/3 confirm the mechanism + a world signal exists. |
| **W6** | B | The HARDENING wave. Define + wire the world-anchored signal (measure the bridge's effect against external-merge outcomes, NOT internal hit-rate). Mint the FIRST `provenance='live'` node from a real world-anchored run/merge. `measureDiscrimination` against the world-anchored corpus. | **LIVE** — the only wave whose output is a world-anchored trust signal. Gates the claim "this phase hardened trust." |

## Cross-carry seams (drift risk between waves)

1. **The confirmed trust-weight** (`recurrence_count_confirmed`) — produced by C's consolidation,
   consumed by A's ranker tie-break AND B's lesson selection. THE central seam; all three touch it.
   If C changes its derivation (authenticated-edges-only `confirmedNodeIds`) without A/B updating
   consumption, A/B silently rank/select on a stale-scoped weight.
2. **The provenance value + firewall direction** — backtest store REJECTS-live/HOLDS-backtest; the
   live store must be the EXACT inverse. ENUM widen (`corpus.js:46`) is the shared prerequisite.
3. **The live-node minting contract (B<->A)** — does a world-anchored run mint a recall-graph NODE
   (`provenance='live'`) or only a verdict-RECORD? `corpus.js:46` says "live is the v3.10 verdict-record
   value." If live lives only on verdict records, A's retriever has a different node source and the
   firewall design changes. **Must be pinned before A+B co-build** (open question for the user).
4. **The edge basis version (C)** — `verifyEdge`'s additive-only basis: a signature field added
   in-place (not as a versioned bump) orphans every existing edge, silently zeroing `confirmedNodeIds`
   — which A and B then read as "nothing is confirmed." Within-C mistake, cross-carry blast radius.
5. **The `trigger_class` query key** — B's bridge must know the spawn's `trigger_class` at spawn-time
   to query A's retriever. Where that classification comes from at spawn-time is undefined — a classic
   A<->B contract gap (open question).
6. **The persona/roster key-fragmentation lever** (carried from v3.10 C2: `13-node-backend` vs
   `node-backend`) — if B's bridge or A's trust inputs join on a persona/roster key, the two shapes
   could split/merge trust unexpectedly. Adjacent to all three carries' trust-weight wiring.

## Biggest risks

1. **Provenance-laundering into a LIVE surface (TOP risk)** — until C lands enforcing, any byte-writer
   co-forges a `confirmed-by` edge via the exported `deriveEdgeId` + `writeCandidate` (CONFIRMED:
   `verifyEdge` PASSES a hand-built edge), inflating the weight A ranks on and B injects. A live
   retriever/bridge built before C is enforcing lets an unauthorized writer reorder/poison a real
   agent's context. **Mitigation: C-first, enforcing, BEFORE any live A/B surface.**
2. **OQ-NS-6 over-claim** — mistaking NARROWING for HARDENING. A live retriever/bridge fed only by the
   engineered backtest corpus could be shipped as "trust-hardening" when it only narrows. **Mitigation:
   the hardening accounting below; W6 is the ONLY wave allowed to claim hardening.**
3. **Building B on a non-existent harness capability (ADR-0012 recurrence — the K8/tool-mask catch)** —
   a bridge designed around per-spawn hook injection is INERT on Agent/Task spawns. **Mitigation:
   PROBE-1 mandatory before B's design commits; viable shapes are static-synthesis or
   orchestrator-advisory-read, NOT hook injection.**
4. **Carry C false-assurance (enforcement theater)** — if the minter + verifier live in the same
   exported module the lab caller imports, the caller re-invokes the minter directly, re-creating the
   co-forge under a new name. A shared HMAC secret readable by the lab process (same Node process today)
   is itself co-forgeable. The #273 family has bitten 3x via exactly this confusion. **Mitigation: the
   minter MUST be a boundary the caller cannot reach (separate kernel process, or ed25519 private key
   the lab process cannot read).**
5. **The inverted-firewall trap** — pointing the spike at a mixed store silently ranks backtest into
   live trust (the ranker filters on `classifyLessonLayer==='valid'` only, NOT provenance).
   **Mitigation: explicit `provenance==='live'` admission gate at the read-path (W4), not store
   separation alone.**
6. **Layer-boundary violation in C Design B** — a kernel writer that re-runs the confirmation needs the
   behavioral verdict + corpus `fail_to_pass`, which live in the LAB calibration run. Moving that
   evidence kernel-ward risks the kernel depending UP into lab (lab->kernel is the only legal direction).
7. **Static-synthesis clobber (W5 shape a)** — if synthesis writes into `agents/*.md` or
   `runtime/personas`, an install/sync (`cp -r`) clobbers hand edits. **Mitigation: the pipeline owns a
   deterministic, regenerable file region; never hand-merged.**

## Hardening vs narrowing (OQ-NS-6 honest accounting)

- **NARROWS only** (raises forgery/precision bars against an engineered corpus; does NOT harden trust
  in any externally-anchored sense): **W1, W2** (C — hardens the weight against FORGERY, a
  prerequisite-enabler, not a world signal), **W3** (substrate), **W4** (live retriever on the backtest
  corpus), **W5 shadow** (injecting engineered-corpus lessons).
- **HARDENS** (world-anchored): **W6 only** — a `provenance='live'` node born of a real world-anchored
  run/merge, measured against external-merge outcomes (the north-star apex).

**Honest phase-close framing**: "we built the LIVE-and-authenticated machinery (W1-W5, narrowing); we
HARDENED trust only at W6, and only to the extent a real world-anchored signal was actually observed."
The mechanism is provable INTERNALLY (beta-internal-verification mandate); the TRUST claim waits for the
world signal.

## Open questions for the user (genuine forks — not defaultable)

1. **Scope appetite** — full 6-wave phase (build all the live machinery, accept it NARROWS until W6) vs
   **Carry C standalone** (the #273 security close, defense-in-depth, order-free) vs a different entry.
2. **Carry C minter shape** — ed25519 (asymmetric, kernel-held private key, shippable public verify key —
   strongest under p-writescope) vs a kernel-owned writer the lab caller cannot invoke (Design B, most
   ADR-0012-consistent, but requires the kernel to own the confirmation evidence). Deciding factor:
   lab + `runConfirmationPass` run in the SAME Node process today, so a same-process key file is forgeable.
3. **The live-node minting contract** — does a world-anchored run mint a recall-graph NODE or only a
   verdict-RECORD? Pins the A<->B seam; must be decided before A+B co-build.
4. **Carry B bridge shape** — static agent-definition synthesis vs orchestrator advisory-read.
5. **A6 reuse** — reuse the A6 snapshot machinery literally (sibling kind in `materialize.js` +
   `spawn-record.js` axioms) vs a parallel lessons-snapshot.
6. **The world-anchored measurement (W6)** — what observable connects an injected lesson to a real
   downstream outcome (external-maintainer-merge)?
7. **Migration vs clean-slate for C's enforce flip (W2)** — re-mint the edge corpus under the
   authenticated minter, or accept a clean-slate wipe (the beta mandate says persona STATE is wipeable)?

Questions 3-7 gate their own waves (W2-W6); only **1 and 2 gate the immediate next step (W1)**.

## Recommendation

**Start at Carry C, shadow-complete (W1).** It is the only carry with no upstream dependency, it is a
prerequisite-enabler (every later hardening surface would otherwise be built on a forgeable weight), it
respects shadow-first discipline (raises the forgery bar without going live or gating anything), and it
de-risks the top failure mode (provenance-laundering) before any live surface exists to exploit. W1 must
NOT flip `verifyEdge` to require-signed (that retroactively invalidates every existing unsigned edge —
defer to W2 after re-mint).
