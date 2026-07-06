---
lifecycle: persistent
status: design-note (converged expectation; NOT a wave — seeds a SEPARATE phase, ~v3.11)
topic: recall-graph, experience-layer, lessons-not-actions, surprise-stored, confirmation-edge, lesson-identity
supersedes-intent: reframes the recall-graph CONTENT model from the v3.9 bootcamp's success-worked-example node
---

# The recall graph as a DERIVED EXPERIENCE LAYER (converged 2026-06-15; a v3.11+ phase)

> **Folded into [ADR-0018 — the canonical memory architecture](../adrs/0018-memory-architecture.md) (2026-07-06).**
> This is a superseded design note. The canonical structure — two substrates on one pattern-kernel — plus the resolved
> forks live in ADR-0018; this note's "port, don't invent" insight is the reason it exists. Per the supersede-not-fork
> discipline, a memory-design change supersedes that ADR, never this note.

**Status:** USER-converged design EXPECTATION from a deep 2-chat discussion. NOT in-flight. v3.10-W3 (reputation)
runs FIRST on the current node shape as a diagnostic of the mechanism; THIS is the separate content-model
pivot that follows. Captured so the convergence survives compaction.

## The reframe (the locked expectation)

A recall node should be a **derived lesson**, not an action log. The file delta is already anchored in git;
re-storing it (even as the v3.9 opaque digest) is the **too-literal** failure mode. Instead a node carries
**what to watch for** — the TRIGGER (situation it recognizes), the GOTCHA (the non-obvious trap), a corrective
PRINCIPLE, and a WEIGHT (recurrence). **Store surprise; compress expectation.** A routine pass matched the
prediction (low information -> compress to a class-level "this kind is reliably solvable"); a failure/divergence
VIOLATED the prediction (high information -> a durable, anchored node). The death-map is worth more than the
trophy case.

## Why it's grounded (not invented)

- **git is survivorship-biased** — a merged fix is the sole survivor; the wrong turns + the journey are deleted
  (a squash erases even what's left). git reconstructs WHAT changed, never WHY-this-and-not-the-alternative or
  what made it non-obvious. **Memory is the counterpart to git's silence about reasoning** (failure is the
  loudest instance, but a divergent-valid PASS is also git-unrepresentable reasoning).
- **The dependency is ONE-WAY: memory -> delta** (derived, not symmetric). A lesson is computed by CONTRASTING
  an attempt (esp. a failed one) against git's ground-truth delta. git = the answer key; memory = the
  margin-notes. Where there's no success-delta (a live unsolved problem) the lesson DEGRADES gracefully to
  "known-hard; approach X failed; cause unconfirmed" — a hazard marker, weaker, separate low-trust lane.
- **The confirmation GATE (false >> missing):** a confidently-stored WRONG lesson actively mis-steers the next
  actor; a missing lesson is just silence. So a lesson enters the predictor lane ONLY when a same-requirement
  success (same `fail_to_pass`) CONFIRMS it. An unconfirmed failure is an unfalsified hypothesis -> stays out.
- **The graph's FIRST real edge falls out for free:** `(failure-context, lesson) --confirmed-by--> (delta-ref)`.
  Edges are NOT "issue resembles issue"; they are "this lesson was confirmed by that delta."

## The fractal inversion: the LESSON is the node, the task is provenance

The learning sits at a STEP (a moment of truth), not the whole task. Self-similar unit = (expectation ->
surprise -> correction) at task scale AND step scale, but **sparse at every level** (a 10-step trajectory is
~9 routine + 1 surprise). So invert the index: **1 node per DISTINCT lesson, with N provenance-links** to the
(task, step, failed-attempt, confirming-delta) where it showed up. Recurrence-anchoring lives on the LESSON
(a gotcha in 3 tasks is a law; a task done 3× is nothing). **Confirm COARSE (one pass at the task boundary),
learn FINE** (localize the lesson by contrasting at hunk/decision granularity).

## The identity question — RESOLVED to a structured signature (NOT embedding, NOT text-hash)

The fork "semantic-embedding (needs identity machinery) vs content-hash-of-text (can't merge)" is a FALSE
binary. The substrate already chose the third path: `frictionClusterKey` = `friction_class|friction_phase|
detection_leg` (`trajectory-friction.js:309`) -- a STRUCTURED closed-enum tuple, hashable (cheap, merges by
EXACT match) at the failure-class altitude, with the code explicit: "embedding is an OPTIONAL depth layer,
NEVER the key." **Lesson identity = an EXTENDED friction-style signature** (`trigger-class | gotcha-class |
corrective-class`); semantic-clustering merges near-duplicate signatures as a v-next refinement, never the
entry price. Recurrence is then exact-key counting (what `clusterFriction` already does).

## The de-risk: we already run this organ (port, don't invent)

The ghost-protocol / **drift-taxonomy IS this experience layer for the META domain** -- failure-anchored,
signature-keyed, graduates a pattern at convergence ~3, retires internalized ones. The code-domain recall graph
PORTS that proven lifecycle (signature + convergence-count + graduate/retire). Existence-proof the shape is
right: this very arc minted the correct-shaped lessons (`ENV-BEFORE-REQUIRE`, the branch-stacking slip,
mock-suite != real-path) and the drift-taxonomy already eats them.

## Two lesson SEAMS (sequencing, not a blocker)

| Seam | Lesson shape | Data today? |
|---|---|---|
| **Design-space** (divergent-valid PASS -> accepted) | "the obvious shape isn't the only valid one; here's the axis" -- BROADENS | YES -- the 11 nodes carry `reference_divergence` + the leg-C contrast |
| **Trap** (FAIL -> fix) | "X is the trap; do Y" -- SHARPENS (richer) | NO -- the harness DISCARDED failed diffs; needs a bootcamp re-run capturing the failed attempt |

**Recommendation: pipeline-first, richest-seam-second.** Bootstrap from the divergent-valid passes we ALREADY
have (prove `derive -> structured-signature -> leak-guard -> store -> trigger-retrieve` end-to-end, per the
mandate), THEN add the trap seam (re-run capturing failed attempts). Don't gate the whole organ on re-capture.

## What stays genuinely HARD (the real substance)

1. **Lesson derivation at altitude** -- an LLM contrasts (attempt vs accepted) at hunk/decision granularity into
   a signature + a renderable gotcha; LEAK-GUARD: the rendered lesson shares no >=12-char run with the sealed diff.
2. **Trigger-matching retrieval** -- match the NEW problem's SITUATION against stored lesson TRIGGERS (the
   recognizer), not issue slugs. This is the real similarity index the lexical retriever lacks.
3. **Capturing the failed attempt** (trap seam) -- a bootcamp re-run; the lesson is `contrast(wrong-diff,
   accepted-fix)`. Timeouts are a different sub-type ("too hard to one-shot" -- a complexity hazard, not a trap).

## Open decisions (for the phase kickoff)

- (a) Bootstrap from divergent-valid passes first, or gate on the failure re-capture first? (rec: passes-first.)
- (b) The signature taxonomy axes for a code-lesson (trigger / gotcha / corrective enums) -- the friction enums
  are the seed but cover failure-CLASS, not the trigger/recognizer axis retrieval needs.
- (c) Lifecycle thresholds (anchor-at-N, graduate-to-rule, retire-when-internalized) -- borrow drift-taxonomy's.

## Relationship to v3.10 (orthogonality — important)

v3.10 W0'-W3 build the **WHO-built** axis (persona provenance -> reputation). This is the **WHAT-was-learned**
axis. COMPLEMENTARY, not competing: reputation works on whatever nodes exist; the experience layer changes what
a node IS. W3 (reputation diagnostic) proceeds on the current node shape; this pivot is a later, separate phase.
