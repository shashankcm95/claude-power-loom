---
title: "Test-Premise Probe — the de-facto spec encoded by the test suite, contrasted against the north-star"
doc_id: test-premise-probe-2026-06-21
created: 2026-06-21
status: analysis — point-in-time audit; not a charter, not canon
method: >
  8 module-scoped sub-agents read all 235 `*.test.js` files (~50k lines) under `tests/unit/**`
  and inferred, PURELY from what each test ASSERTS, the contract that module promises. Those
  per-module inferences are combined here into a single de-facto specification and contrasted
  against the north-star RFC + the combined-roadmap charter.
premise: >
  The toolkit was built test-first (TDD): tests were written, then code was written to pass them.
  So the test suite IS the de-facto specification of what the plugin guarantees. The question this
  doc answers: is that test-encoded spec MATERIALLY CONSISTENT with the stated vision/north-star?
related:
  - packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md
  - packages/specs/plans/2026-06-10-combined-roadmap.md
lifecycle: persistent
---

# Test-Premise Probe — what the tests prove vs what the north-star wants

> **One-line verdict.** The test suite is **materially consistent** with the north-star — but the
> consistency is of a specific, honest kind: **the tests rigorously prove the fault-tolerance
> *scaffold* and mechanically enforce the one binding *law* (OQ-NS-6 narrows-vs-hardens), and they
> are silent on exactly the parts the north-star itself flags as UNBUILT** (the apex external-merge
> signal, end-to-end learning *efficacy*, and provenance-closure of trust weights). There is **no
> material contradiction** between the tests and the vision. The risk is not divergence; it is that
> the load-bearing half of the thesis — *trust* — currently has **near-zero test surface** because its
> producers do not exist yet, and the one mechanism that would close its central gap (the signed
> `weight-minter`) ships **built-but-dark with zero consumers**.

---

## Part I — The de-facto specification (what the tests actually prove)

### I.0 The shape of the evidence

Coverage is heavily concentrated in the **internal factory (Side B)** of the north-star and almost
absent from the **external signal (Side A)**:

| Tier | Test files | What the tests are *about* |
|---|---|---|
| kernel | 87 | spawn lifecycle, content-addressed record store, fail-closed promote/reject, never-touch-HEAD |
| lab | 81 | shadow/advisory learning + trust substrate (lessons, calibration, reputation, breaker, attestation) |
| runtime | 26 | HETS decomposition / capability reconciliation / honest verification gating |
| scripts+hooks+bench | 39 | ghost-heartbeat (safe-by-default background scanner), self-improve store, router-v2 bench, context/secret hooks |
| kb+agents+agent-team | 3 | doc-schema conformance, agent-definition contracts, synthid identity |

### I.1 The kernel — "mediate every agent spawn, fail-closed, never touch HEAD"

**Central promise (test-derived):** a sub-agent's filesystem work is captured out-of-tree as a
content-addressed, provenanced delta and can only ever reach shared state through a kernel-attested,
fail-closed decision path — and under **no** code path is the user's checked-out HEAD/working tree
written.

- **NEVER-TOUCH-HEAD** is one of the most load-bearing and most-emphasized invariants — named
  explicitly in test titles/comments across ~14 files (by raw assertion-line count, content-address /
  idempotency [INV-22] and quarantine routing actually carry *more* lines; "the single most-asserted"
  would overstate it). It is proven from three independent angles in the integration tests (shadow /
  candidate-integrate / enforce arms) and re-proven inside `stage-candidate`, `stage-promote`, the
  shadow close-resolver, and the integrator: HEAD, working tree, `git status`, and the ref store are
  byte-unchanged; all mutation is confined to out-of-tree objects and the `refs/loom/*` /
  `loom-promote/*` quarantine namespaces a human reviews.
- **Content-address integrity, verified on READ as well as write.** `transaction_id ==
  computeTransactionId(body)` and `filename-txid == body-txid == content-hash`; every store read
  (`readById` / `readByPostStateHash` / `listByRun` / the reject-event and snapshot readers) re-verifies
  and fail-softs a tampered file to null. The store is treated as untrusted disk (`p-writescope`), not a
  sandbox.
- **Fail-soft at the hook boundary, fail-CLOSED at the security boundary.** Validators/observers exit 0
  and never block (advisory); but unknown resolver outcomes, unverifiable trees, hash failures, and
  out-of-scope writes all block/reject rather than fail-open promote. The resolver table has *no
  unhandled default* and fails closed to `ABORTED` on an unknown K9 outcome.
- **Dynamic merge-base** (`deriveMergeBase`: 1=ok / 0=none / >1=ambiguous) is the integrator's tightest
  correctness guard — the defense against the falsified `delta_sha^1` rule that would silently drop main
  commits between fork points.
- **One CWE-22 canonicalizer** (`checkWithinRoot`) that every scope check delegates to; raw-segment
  traversal rejection *before* `path.join` collapses `..` (the #215 trap), recurring in K9/K14, the
  record store, and the runtime trampoline; no-shell arg-array git; depth/width-bounded canonical-JSON
  hashing; homoglyph/control-char input hygiene; capability-free headless execution proven by a real
  sentinel probe.
- **The route-decide gate is honest.** Behavioral bands (`route`/`borderline`/`root`) and a
  `weights_version` golden tripwire are pinned so a weight rebalance is a *reviewable signal*, not a
  silent tax; the lexicon-as-data loader fails closed (a corrupt lexicon never produces a fabricated
  exit-0 verdict).

**The kernel's own honesty markers (tests assert these explicitly):** several primitives ship
**DORMANT with dormancy asserted as a first-class contract** (`context-envelope`, `k9-*`, `k14-*`,
`quarantine-promote`, `reject-event-store`, `weight-minter`) — a `packages/` grep proves zero
production importers. And the suite is explicit that content-address verify-on-read proves **INTEGRITY,
not PROVENANCE**: a co-forged-but-self-consistent record is the acknowledged residual.

### I.2 The runtime — "decompose safely; never claim more than you can prove"

**Central promise (test-derived):** a capability-bounded, honestly-verified decomposition pipeline —
split a task into leaves, reconcile each leaf against an authoritative capability/instinct floor,
structurally admit (R9), execute/verify (R11 over a sandboxed R12 node runner), and trampoline (R6)
under checkpoint (R7) + budget (R10) bounds, with every rejection carrying a frozen ADR-0015
`failure_signature`.

- **Honest verification gating is the load-bearing invariant:** `accepted <=> failure_signature ===
  null`; a test-skipped or structural-only accept is `verified:false` (never laundered into a verified
  pass); reserved-but-unregistered runners (`jest`/`vitest`/`pytest`) return null (no over-promised
  test-run).
- **Capability reconciliation closes the source-of-truth gap:** a persona's `agents/<name>.md` `tools:`
  frontmatter is the privilege floor; the contract may neither over-grant (`write-overgrant` /
  `subprocess-overgrant`) nor under-grant (`write-floor-missing`); all 19 real contracts reconcile to 0
  violations. Instinct bindings reconcile to the `## Mindset` headings in `personas/NN-*.md`.
- **Test-runner sandboxing:** no-shell argv, absolute-only, symlink-reject (TOCTOU window-narrowing via
  `lstat`), parent-secret scrub (least-privilege child env). The node-runner header is the suite's most
  security-honest file — it pins explicit `TODO(ARCH-H1/C1)` residuals (cwd is not a chroot;
  absolute-path writes still reach host paths; no process-group reaping), making the ADR-0012
  kernel-cannot-wrap-a-subprocess boundary visible.

### I.3 The lab — "an evidence-linked, tamper-resistant record; advisory signals that refuse to gate"

**Central promise (test-derived):** build a content-addressed, tamper-resistant record of *what
happened* (failures, verdicts, worked examples, confirmation edges, lessons) and derive **advisory**
signals from it — while **structurally refusing to let those signals gate real actions.**

- **Almost everything is ADVISORY / SHADOW, and the tests enforce it structurally:** the circuit
  breaker "halts nothing yet" and only NARROWS; reputation is labeled `not_a_trust_score:true` with no
  scalar `score/quality/rank/grade/trust` field; the spawn-narrowing gate's worst output is `reroute`
  (never `exclude`) and it only fires on an **authenticated lane** (a non-`verdict-attestation`
  "mirror" source -> all `proceed`, reason `unauthenticated-lane`); the recall-graph node carries **no
  weight/gradient field at all** (asserted by regex over the serialized node); `bootcamp-gates`
  *physically forbids* the backtest tree from importing reputation / breaker / `recordVerdict`
  (Path-2-dark); `hooks.json` is asserted to contain **zero** lab references.
- **The OQ-NS-6 firewall is built into the data model.** The hardening-signal store *rejects* a
  `source:"real"` record on write and a tag flipped on disk fails re-derivation on read (`source` is in
  the content-address). The reputation math is **source-agnostic** (mock vs real signals are
  mathematically indistinguishable) precisely so an engineered signal can never *masquerade* as a
  world-anchored one.
- **The one place that mints real destructive state** — cross-run `manage-promote` (TOMBSTONE /
  SUPERSEDE) — is the most heavily guarded path in the layer: human-approval axiom
  (`USER_INTENT_AXIOM:`) required, **exact-set** authorization post-condition (superset/subset/dup-pad
  decoys all HARD-FAIL — never a `.includes` subset check), IDOR refusal of kernel-owned targets, a
  predictive circuit-breaker zero-mint refusal, and default-off (`LOOM_MANAGE_ENFORCE=1`).
- **The grader is firewalled and oracle-sealed.** Three-axis verdicts (`behavioral` / `semantic` /
  `reference`) are never blended into a scalar; sealed answer-keys and secrets never reach the graded
  actor or persisted state; at the `scoreAttempt` grader, test-tree / test-infra tampering fails closed
  to `BEHAVIORAL_FAIL` (note the *live* `calibration-issue-run.js` `mapBehavioral` runner path still
  treats `test_tree_mutated` as report-only — a known false-PASS carry targeted by phase 3.2.1a, so
  "the grader fails closed" is true of the tested function, not yet of that one runner wrapper); the
  recall-eligibility gate is a fail-closed 4-conjunct with no truthiness; the trajectory/friction
  "learning telemetry" is provably firewalled OUT of every trust-bearing number (`detector_validated:
  false`).

### I.4 The periphery — "safe-by-default advisory autonomy + honest provenance"

- **The ghost-heartbeat** (background drift scanner) is **default-off / opt-in**, has dual
  kill-switches that short-circuit before any FS write, and is hardened against input-poisoning,
  symlink/traversal, FIFO-hang, and injection (cron/XML/argv/prompt) — plus a runaway-spawn guard
  (debounce marker outlives its emitted entry). The judge is always injected in unit tests; the real
  `claude -p` path is out of scope.
- **The self-improve store** gates by risk: high-risk signals (`drift:`, `rule-recurrence:`) converge at
  count 3 and **never auto-graduate** — they stay pending for human triage; terminal states
  (`dismissed`/`promoted`) are sticky.
- **The router-v2 bench** enforces an *epistemic* contract: blind labeling can't leak the scorer's
  band, the eval set fails closed on under-evidenced rows, "costume" provenance tags are forbidden, and
  the shadow-eval report must literally contain `NARROWS-ONLY` and fail a wording gate if it
  co-locates a trust score with a pass-rate — OQ-NS-6 enforced *in prose*.

### I.5 The cross-cutting invariants (this is what the plugin IS, per its tests)

Stripped of module detail, the test suite encodes **seven** recurring disciplines. These are the
load-bearing "spec":

1. **Never touch the user's HEAD / working tree.** All mutation is out-of-tree objects + `refs/loom/*`.
2. **Content-address everything; verify on read, not just write.** A store is untrusted disk.
3. **Fail-soft at the hook boundary; fail-closed at the security boundary.** Advisory hooks exit 0;
   trust/security gates throw or return null/false rather than fabricate a trusting verdict.
4. **Exact-set, no-coercion authorization.** Every single-purpose authz post-condition is exact-set
   equality (compute `missing[]` + `unexpected[]`), never a subset `.includes`; no `toString`/array
   coercion slips past a typed guard.
5. **Advisory/shadow isolation.** Learned/derived signals NARROW at most; they never gate, and the
   code physically forbids the learning substrate from importing the trust machinery.
6. **Hostile-input hardening as a default.** CWE-22 raw-segment traversal, symlink/extension/subdir
   evasion, depth/width DoS bounds, homoglyph/control-char hygiene, SSRF allowlists, no-shell argv.
7. **Honest provenance / honest claims.** Identifiers, labels, verdicts, and reports may only claim the
   certainty their evidence supports; `not_a_trust_score`, `detector_validated:false`,
   `UNKNOWN-until-measured`, `NARROWS-ONLY`, and the integrity-vs-provenance caveat are written *into*
   the assertions.

**What the tests overwhelmingly prove is that the substrate RUNS SAFELY. What they do NOT prove — by
their own explicit admission — is that the learning/trust loop WORKS.** Every "learning" leg (derive,
solve, judge, score, confirm) is an injected mock or deterministic stub; the A/B/C experiment is
instrumented to detect a difference but is driven by a stub that cannot produce one (arms differ only
in `lesson_count`, never in graded outcome). The real `claude -p` / docker / sandbox legs are
explicitly out-of-glob and "dogfooded separately."

---

## Part II — What the north-star demands

The north-star RFC frames Power Loom as a **DDIA fault-tolerance layer around a probabilistic actor**.
Its load-bearing claims:

- **Two sides of one curtain.** Side A = the *external* signal (apex of correctness = an external
  maintainer merges our PR — world-anchored AND independent). Side B = the *internal* factory (intake
  -> architect -> HETS personas in isolated branches -> thin-PM orchestrator -> assemble -> PR).
- **The thin-PM bulkhead** answers error-amplification: the orchestrator sees **diffs + verdicts, not
  context**, and decides at **commit granularity** (absorb/reject a commit as a unit, never cherry-pick
  within).
- **The absorb decision is a STACK of narrowing filters** (Layer 0 mergeability [built] / Layer 1
  build-test gate / Layer 2 reviewer-verdict / Layer 3 coverage) — and **filtering != hardening.**
- **OQ-NS-6 is a BINDING LAW (ratified):** the same-system absorb-rate may only **NARROW** review; only
  a **world-anchored merge** may **HARDEN** (unlock reduced scrutiny). Reputation key is
  `(individual x model x project x task-type)`, never global.
- **Reconciliation:** a rejection is an obligation, never a silent drop — needs a requirement -> commit
  coverage map (set-difference over tags); open obligations BLOCK the PR.
- **The retrace:** an external correction localizes to a checkpoint via delta-trajectory bisection; the
  constructed memory is split `bug = confirmed-external` / `attribution = inferred` and the inferred
  half must not harden.

And the RFC is **honest about what is unbuilt** (its own "Honest gaps" + 8 open questions):

- The **apex signal has no producer and no authentication** (OQ-NS-8); attribution must survive
  `run_id` rotation on a durable key (OQ-NS-3); the non-merge classifier (OQ-NS-1) and
  difficulty-weighting (OQ-NS-2) are unbuilt.
- The **absorb/reject ledger** must be **minted by the assembly path itself, kernel-attested, never
  caller-asserted** — the current `recordVerdict` accepting a caller-supplied verdict+agentId is an
  absorb-forgery hole (panel CRITICAL).
- **Layer 1 (build/test gate on the assembled tree, OQ-NS-7)** is unbuilt — the integrator catches only
  *textual* conflicts; cross-file/semantic incoherence merges clean.
- **Intra-spawn checkpoint capture (OQ-NS-5)** is unbuilt — `materializeDelta` squashes per-spawn, so
  blame is commit-level, not checkpoint-level.
- The **ContainerAdapter wall** stands for the autonomous end; the beta routes around it because *the
  human is the containment*.

The combined-roadmap puts the live sequence at: spine through **v3.9 = first live beta (human-gated)**;
v3.7 re-scoped to **mint the reject-event ledger at the integrator** (non-chain, off the
`post_state_hash` keyspace, fail-soft). Per MEMORY, the live state is now phase **(3).2 — live
external-PR beta**, with (3).1 dry-run phase-closed.

---

## Part III — Material consistency contrast

Verdict legend: **CONSISTENT** (the tests prove what the vision says exists) - **CONSISTENT-DARK** (the
mechanism is built + tested but ships shadow/no-consumer, exactly as the vision says) - **GAP** (the
vision wants it; no test surface — and the vision agrees it is unbuilt) - **TENSION** (a real friction
to watch).

| North-star element | Test evidence | Verdict |
|---|---|---|
| DDIA scaffold: gates / bulkhead / containment around an unreliable actor | The kernel's fail-closed mediation, never-touch-HEAD, out-of-tree quarantine refs, content-address verify-on-read are the most heavily tested invariants in the suite | **CONSISTENT** — strongest agreement |
| Thin-PM bulkhead: decide at **commit granularity**, diffs + verdicts not context | Integrator stacks candidate *deltas* (`delta_sha`) onto `loom/integration` in declared order; verdict-attestation records verdicts evidence-linked to a spawn `agentId`; no path re-imports intra-commit context. K9 promotes via `cherry-pick` at `delta_sha` (= one squashed spawn) granularity, honoring "never cherry-pick *within* a commit" — but only *because* `materializeDelta` squashes per-spawn | **CONSISTENT** (structurally) / **TENSION** (both "never ingests full reasoning" AND "never sub-commit cherry-pick" are orchestration disciplines, not unit-assertable) |
| **OQ-NS-6 binding law:** engineered signal NARROWS, only world-anchor HARDENS | Reputation-gate maxes at `reroute` (never `exclude`) + authenticated-lane-only; hardening-signal store physically rejects `source:"real"`; reputation math source-agnostic; bench report must say `NARROWS-ONLY` | **CONSISTENT** — the law is mechanically enforced across kernel, lab, and bench |
| Absorb-stack Layer 0 (mergeability) | The integrator's `merge-tree` + dynamic merge-base + quarantine-on-conflict is fully tested | **CONSISTENT** |
| Absorb-stack Layer 2 (reviewer-verdict, narrows-only) | `verdict-attestation` store + reputation projection tested; the *wiring* of a per-candidate reviewer verdict into the assembly filter is not | **GAP** (vision: ~v3.8, reuses `verification-policy.js`) |
| Absorb-stack **Layer 1 (build/test gate on the ASSEMBLED tree, OQ-NS-7)** | container-adapter / docker-backend / pytest-runner *pure parts* tested; **no test wires a build/test gate over the assembled integration tree**; integrator catches only textual conflict | **GAP** — vision-acknowledged; the cross-file/semantic-incoherence hole is open |
| Absorb-stack **Layer 3 (requirement -> commit coverage, no silent drop)** | decompose-run emits an outbox with `failure_signature` for Lab ingest, but **no requirement-tagging / coverage set-difference / obligation-blocks-PR** anywhere | **GAP** — vision-acknowledged (post-intake; OQ-NS-5 tag-integrity) |
| **Apex signal: external maintainer merge** (Side A) | **Zero test surface.** No producer for merge-event polling, non-merge classification (OQ-NS-1), difficulty-weighting (OQ-NS-2), durable `issue->spawn->PR->merge` key (OQ-NS-3), or forge-API authentication (OQ-NS-8) | **GAP** — vision-acknowledged as UNBUILT; but this is the *apex of the entire thesis* and it has no tests because it has no code |
| Reject-event ledger **minted by the assembly path, kernel-attested** | `reject-event-store` is built + tested (non-chain, off `post_state_hash`, S5 on read/write, A1 isolation, run-binding) and `scanRejectEvents` aggregates it; the integrator's reject-ledger mint is tested | **CONSISTENT-DARK** — the ledger exists + is isolated correctly; it gates nothing yet (shadow), matching the v3.7 re-scope |
| `recordVerdict` is **caller-forgeable** (panel CRITICAL H-ATK-1) | verdict-attestation REQUIRES an `agentId` link or rejects, and the enricher resolves the link from the kernel journal (not self-asserted); an ambiguous cross-run link is refused — BUT the verdict *value* itself (`pass`/`partial`/`fail`) is still caller-supplied | **TENSION** — only the *link* is kernel-resolved; the *verdict value* remains caller-asserted, which is exactly the H-ATK-1 hole. Closes only when the assembly path itself mints the verdict. Tolerable today because nothing gates on it (shadow) |
| Reconciliation: a rejection is an obligation, **retain trajectory until the external signal SETTLES** (forgetting gated by the world-anchor) | **Zero test surface.** No retention/forgetting primitive; the only `settle`/`retain` hits are an `Atomics.wait` sleep helper | **GAP** — vision-acknowledged; depends on the (unbuilt) apex signal |
| **OSS-citizenship** (disclose AI-provenance, respect `CONTRIBUTING.md`, rate-limit, never spam) | **Zero test surface** | **GAP** — and load-bearing: the RFC notes "merged" stops being a clean signal once a maintainer auto-rejects the bot, so this *conditions the apex signal's validity*, not just a missing feature |
| **Integrity != provenance** (a co-forging store-writer can inflate a shadow weight) | Pervasively asserted across `recall-edge-store`, `lesson-confirm`, `authorship-store`, `manage-promote` (OQ-E), `evolution-snapshot-provenance`. The closer — a **signed** `weight-minter` (ed25519, value-committing) — is fully tested | **CONSISTENT-DARK + TENSION** — the gap is honestly bounded (every affected weight is shadow/advisory), but the closer ships with `F4` asserting **zero production importers**: built-but-dark |
| Retrace / blame-to-checkpoint (intra-spawn capture, OQ-NS-5) | `materializeDelta` squashes per-spawn (tested); **no per-checkpoint capture**; trajectory-friction parses logs but is report-only, `detector_validated:false` | **GAP** — vision-acknowledged as UNBUILT |
| ContainerAdapter wall (same-uid not a security boundary) | Tests repeatedly state the residual: worktree is not a sandbox, absolute writes escape, the node-runner pins `TODO(ARCH-H1/C1)`, manage-promote's OQ-E forge is accepted-untested | **CONSISTENT** — the wall is honestly marked everywhere; beta routes around it (human = containment) |
| Reputation key = `(individual x model x project x task-type)`, not global | reputation projects per-`subject.persona`; recall-graph hard-gates retrieval by repo; but a unified `(model x project x task-type)` key is not assembled, and `animating_model` stamping is Position 8 (probe-first) | **GAP** (partial) — repo-gating + persona present; model-axis + task-type composition not yet a key |

### The headline finding

**There is no contradiction between the tests and the north-star.** Every place the vision says
"built," the tests prove it — and prove it *hard* (the scaffold and the OQ-NS-6 law). Every place the
tests are silent, the vision *already says it is unbuilt*. The test suite and the vision are in
remarkable agreement about the boundary between what-is and what-is-not.

But that agreement has a sharp edge worth stating plainly:

> **The thesis of Power Loom is *trust*. The tests prove *safety* and the trust-loop *scaffold*. Those
> are not the same as proven *trust*.** Safety (the gates) AND the trust-loop scaffold (the thin-PM
> bulkhead's amplification-control — the RFC's *unconditional* cold-start win — plus the kernel-attested
> reject-ledger's correct isolation) are both proven to a very high bar. What is NOT proven is trust
> *efficacy* — the claim that the system *earns reduced scrutiny from a world-anchored signal* —
> because its two load-bearing producers do not exist yet: (a) the **apex external-merge signal** (Side
> A — zero code, zero tests, and additionally gated by an unbuilt **OSS-citizenship** discipline that
> conditions whether "merged" even stays a clean signal), and (b) an **authenticated minter** that
> would make a trust weight provenance-bearing rather than merely integrity-bearing (built + tested as
> `weight-minter`, but wired to nothing).

This is **consistent with** the north-star, which is explicit that trust is earned only post-beta from
the apex signal and that the absorb-rate is display-only / narrows-only until then. The system is
honestly positioned at "the scaffold is real and safe; the trust loop is instrumented but not yet
demonstrated." The tests *are* that honesty, encoded.

---

## Part IV — Material risks & what would close the test<->vision delta

These are the items where the test suite's silence coincides with the vision's most load-bearing
claims. None is a *contradiction*; each is an **untested apex** the next phases must cover.

1. **The apex signal needs a producer AND its first tests.** Side A (external-merge polling +
   non-merge classification + durable attribution key + forge-API authentication) is the entire basis of
   "trust is earned." It has no code and therefore no tests. Until a producer + an authenticated
   read of the forge's merge-event exists (OQ-NS-3 / OQ-NS-8), every downstream trust claim is a design
   target, not a verified capability. *This is the single highest-leverage gap.*

2. **Close the integrity->provenance gap on the live path, or keep every weight provably shadow.** The
   signed `weight-minter` is the answer and is fully tested — but `F4` asserts zero consumers. The
   moment any weight gates an action, an authenticated minter (signed edge / kernel-owned writer the
   caller cannot invoke) becomes mandatory, because a co-forging store-writer can mint a
   byte-indistinguishable record today. Recommendation: keep the `F4` zero-consumer test as a tripwire,
   and when a consumer is wired, require the signed path in the same PR.

3. **Layer 1 (assembled-tree build/test gate, OQ-NS-7) is the real semantic-incoherence hole.** The
   container/docker/pytest *orchestration* is tested but the gate over the *assembled* integration tree
   is not wired. A caller importing a never-merged helper merges clean and fails at runtime — exactly
   the panel's BREAKS finding. This is the most concrete missing *filter*.

4. **Reconciliation / requirement-coverage (Layer 3, OQ-NS-5) has no surface at all.** "A rejection is
   an obligation, never a silent drop" is a core vision promise with zero test evidence. The decompose
   outbox is the closest seam (it already carries `failure_signature`), but requirement-tagging + the
   set-difference coverage ledger + obligation-blocks-PR are absent. (Caution for a future re-prober:
   the *phrase* "no silent drop" DOES appear in the suite — for corpus-disposition accounting,
   persona-collision dedup, and the `materializeDelta` squash guard — none of which is a
   requirement->commit coverage ledger.) The **retention/forgetting boundary** (retain trajectory until
   the external signal settles) is the same kind of absence: a named primitive with zero test surface.

5. **Efficacy is unmeasured by construction.** The learning loop is proven to RUN safely, never to
   WORK. The arm-A/B/C harness is sound but stub-driven; the recall-smell detector ships
   `detector_validated:false` behind a 3-valued INSUFFICIENT-N gate. This is fine *as long as no
   decision consumes a learned signal* — which is currently true. The risk is a future PR quietly wiring
   an unmeasured signal into a real decision; the `bootcamp-gates` Path-2-darkness test and the
   reputation-gate authenticated-lane test are the guardrails to keep green.

### Minor internal inconsistencies surfaced (low severity)

- **"Real contract" count drifts (19 / 18 / 17)** across the three runtime contract-validate test files
  due to validator-specific skip rules; never reconciled in one place. Cosmetic, but a reader-confusing
  seam.
- **The numbered-vs-bare persona laundering lever** (`13-node-backend` vs `node-backend`) is closed at
  *read* in many stores, but MEMORY notes the legacy v3.4-W6 verdict rows group separately — a known,
  named seam, not a regression.

---

## Verification (3-lens adversarial pass, 2026-06-21)

This conclusion was itself premise-probed by three independent read-only lenses before being trusted —
a claim-vs-evidence auditor, an architectural-coherence reviewer, and a firsthand grep-prober that ran
searches against the real test files to falsify the load-bearing factual claims.

**Convergent verdict: the conclusion HOLDS.** Honesty-auditor — Grade A / MINOR-OVERCLAIMS (8/8
load-bearing claims CONFIRMED firsthand). Architect — SOUND-WITH-FIXES (the central "no contradiction"
claim survived a hard falsification attempt: no test asserts behavior the vision forbids; no binding
law — OQ-NS-6, section-0a.3.1, ADR-0012 — is violated by an encoded test behavior). Firsthand prober —
5 CONFIRMED, 1 PARTIAL, 1 REFUTED.

Folds applied to this doc from the pass:

- **REFUTED -> fixed (factual).** "NEVER-TOUCH-HEAD is the *single most-asserted* invariant" was an
  overstatement — by raw assertion-line count, idempotency/content-address (~93) and quarantine (~77)
  out-assert HEAD-unchanged (~30). Downgraded to "one of the most load-bearing / most-emphasized,
  named across ~14 files." (I.1)
- **MEDIUM -> fixed.** The `recordVerdict` row was reclassified CONSISTENT -> **TENSION**: only the
  *link* is kernel-resolved; the *verdict value* is still caller-asserted — exactly the H-ATK-1 hole.
- **LOW -> fixed (scope precision).** "The grader fails closed on test-tree tampering" qualified to the
  `scoreAttempt` function; the live `mapBehavioral` runner still treats it report-only (3.2.1a carry).
- **LOW -> fixed (omissions).** Added GAP rows for the retention/forgetting boundary and OSS-citizenship
  (both Side-A disciplines with zero test surface that the original table silently skipped); added the
  OSS-citizenship clause to the headline and the trust-loop-scaffold clause distinguishing proven
  *scaffold* from unproven *efficacy*.
- **INFORMATIONAL.** Named the "never cherry-pick within a commit" sub-rule in the thin-PM row; noted
  the "no silent drop" phrase is reused by unrelated subsystems.

No fold changed the headline verdict — all three lenses independently judged the core (material
consistency, no contradiction, safety-proven / trust-unproven) sound; the folds tightened scope and
classification.

## Appendix — provenance of this probe

- Derived by 8 module-scoped sub-agents reading all 235 `tests/unit/**/*.test.js` files; each inference
  is grounded in actual `assert(...)` / `describe`/`it` assertions, not prose or memory.
- Vision baseline: the north-star RFC (`2026-06-11-north-star-autonomous-sde-trust.md`) + the
  combined-roadmap charter (`2026-06-10-combined-roadmap.md`), read firsthand.
- This is a point-in-time audit of the committed test suite as of 2026-06-21. It asserts material
  consistency of the *current* test-encoded spec with the *current* north-star; it does not re-litigate
  any ratified decision.
