# {A+B} co-build — scope + shared contract (the v-next live pathway)

> Status: **SCOPING** (pre-build). Produced by the `ab-cobuild-scope` workflow (`wf_ee23763e-2bc`:
> 3 codebase-analyzer probes + architect synthesis) 2026-06-16, after C-W1 shipped (#335). Resolves
> the two A/B forks the phase plan flagged + surfaces the genuine user-calls. NOT a build.

## The resolved shared A↔B contract

1. **Live-node source = a recall-graph NODE (`provenance='live'`), NOT a verdict record.** (HIGH —
   verified.) The verdict-attestation store is the orthogonal emission/reputation track (no
   `worked_example_ref`/`lesson_signature`/`trigger_class` → structurally un-rankable). `provenance` is
   already a first-class node-identity axis (`deriveNodeId` folds it, `recall-graph.js:104-112`); the
   `#316` real-E2E established a real run mints a NODE via `populateRecallGraph({provenance})` +
   `writeNode`, and that pipeline is already provenance-parametric. The `corpus.js:46` "live = verdict
   value" comment is a historical W0 note, superseded by the scheduled ENUM widen.
2. **Bridge shape = (b) orchestrator/persona advisory-READ of a Lab-materialized lessons snapshot**
   (the A6 reputation pattern re-applied), NOT (a) static agent-def synthesis. (HIGH.) (a) is
   clobber-prone (`install.sh cp -r` overwrites `agents/*.md` + `runtime/personas` — the "edit source
   not installed copy" trap; 0/18 defs have a regenerable region) + staler. (b) reuses a shipped,
   security-hardened `project→materialize→O(1) fail-open read` path and keeps lessons out of
   version-controlled files. Both are honor-system advisory (ADR-0012: NO enforced injection exists).
3. **Trust-weight lane = `authenticatedEdgeIds` for any LIVE surface** (the C-W1 fail-closed,
   provenance-bearing lane), NOT the co-forgeable integrity-only `confirmedNodeIds`. (HIGH.) BUT in
   SHADOW, thread it as a **parallel** lane — do NOT flip `runConsolidationPass` until C-W2 re-mints +
   a verify key exists (without a key `authenticatedEdgeIds` is fail-closed empty → a premature swap
   silently zeroes ALL tie-break signal). The ranker must degrade gracefully (missing weight = 0
   tie-break, never crash). A+B both read the same `consolidation-report.json` shape regardless.
4. **Retriever I/O:** input `query = { repo, trigger_class }`; output `{ top, ranked }` (`top` = the
   highest `trigger_class`-matching valid node B injects). The live retriever adds an EXPLICIT
   `provenance==='live'` admission gate at the read path (defense-in-depth — `onlyValid` filters only
   `classifyLessonLayer`, NOT provenance, so a mixed store would rank backtest into live trust).
5. **Bridge input:** B feeds A a `{ repo, trigger_class }` query, consumes `top`, renders ONLY through
   a field whitelist (`renderNodeForPrompt`) — NEVER `JSON.stringify(node)` (leaks `built_by`/`graded_by`).

## Build sequence (the architect's recommended order)

| Wave | Scope | Shadow/Live | Depends on |
|---|---|---|---|
| **W1 (C)** | SHIPPED #335 — ed25519 authenticated edges; `authenticatedEdgeIds` lane | shadow-complete | — |
| **W2 (C)** | switch `runConsolidationPass` → `authenticatedEdgeIds`; re-mint OR clean-slate the edge corpus; define key-rotation/trust-set contract | enforce (weight still advisory downstream) | W1; **FORK-7** + key-custody (**FORK-2**) |
| **W3 (A+B substrate)** | widen `corpus.js:46` ENUM to admit `'live'`; build the inverted-firewall `recall-graph-live/` store; pin the NODE-not-record contract | SHADOW (substrate, no consumer) | W2 |
| **W4 (A)** | promote the retriever to a live module; add the `provenance==='live'` read-path gate; thread the `authenticatedEdgeIds` weight | SHADOW until W5 | W3 + W2 |
| **W5 (B)** | the bridge: a Lab `lessons` materialize pass (A6-sibling) → snapshot → advisory-read at spawn-time, selecting by `trigger_class` via A's retriever, whitelist-rendered | SHADOW (dry-run) then LIVE | W4 + **FORK-5** + the ADR-0012 spike |
| **W6 (B)** | **the ONLY hardening wave** — define+wire the world-anchored observable; mint the FIRST real `provenance='live'` node from a world-anchored run/merge | LIVE | W5 + C-enforced + **FORK-6** |

**Honest caveat folded from my earlier probe:** the live build (W4/W5) is BLOCKED on FORK-5
(`trigger_class`). W2's "flip consolidation" only matters once a live consumer reads the weight — in
isolation it would zero the shadow weight (no production signer exists yet), so it is best bundled with
W4-live, not done standalone. W3 substrate is the only fork-free brick, but it is plumbing-without-a-consumer.

## Forks for the USER (genuine calls — architect marked NEEDS-USER)

- **FORK-5 — the `trigger_class` classifier (LOAD-BEARING; blocks W4/W5).** ZERO code in `runtime/`
  derives a live spawn's `trigger_class`; the 4 frozen values describe a bug's SITUATION, nothing
  classifies a spawn's task/diff into them. Candidates: (a) a spawn-time classifier persona-pass; (b)
  derive from the leaf's decomposition metadata; (c) classify the task prompt. Neither A's live query
  nor B's selection has a key without this.
- **FORK-6 — the W6 world-anchored observable (EXISTENTIAL; gates the only hardening wave).** What
  observable connects an injected lesson to a real external-maintainer-merge outcome?
  `measureDiscrimination` measures internal hit-rate@1; W6 needs external-merge outcomes. **UNDEFINED.**
  Per OQ-NS-6, until this exists the entire A+B layer only NARROWS — *"A's 'live' provenance is
  COSMETIC unless B's source is a genuine world-anchored run; a re-labeled backtest node minted as
  `provenance='live'` is narrowing dressed as hardening."* This fork decides whether the phase can ever
  claim its north-star.
- **FORK-6b (NEW, surfaced by the probe) — the live NODE has no authenticated writer.** C-W1 closed the
  #273 co-forge for EDGES; the live recall-graph NODE is the SAME residual (a byte-writer co-forges a
  self-consistent `provenance='live'` node via the exported `deriveNodeId` — `recall-graph-store.js` has
  no signing path). The plan did NOT schedule node-attestation. A live node must NOT gate a surface
  until it has an authenticated writer (a C-style follow-on for nodes).
- **FORK-7 — W2 migration vs clean-slate** (re-mint the edge corpus under the authenticated minter, or
  wipe per the beta mandate). Risk/effort trade.
- **FORK-2 — C-W2 key-custody** (confirm the ed25519 private-key-the-lab-process-cannot-read boundary
  holds, vs a separate-process writer). W1 shipped ed25519; W2 must confirm custody.
- **FORK-1 — scope appetite** (commit to the full W3-W6 A+B co-build now, vs stop at C-W2 enforcing).

## Runtime probes gating the build

1. **[MANDATORY before B] ADR-0012 lesson-path `claude -p` spike** — a throwaway `PreToolUse:Agent`
   hook emitting `updatedInput.prompt` with an appended "PRIOR LESSON: …"; spawn a sub-agent; confirm
   the injected line does NOT appear. Must PASS (injection absent) → kills hook-injection, forces shape
   (b). (The K8/tool-mask recurrence guard — probe the path, don't trust the design board.)
2. **authenticatedEdgeIds end-to-end** — sign via `runConfirmationPass({signingKey})`, confirm
   `authenticatedEdgeIds({verifyKey})` includes the node + a co-forged unsigned edge is EXCLUDED (still
   counted by `confirmedNodeIds`) + fail-closed empty with no key.
3. **data gate** — `measureDiscrimination` on the CURRENT real corpus must be `MEASURED` not
   `INSUFFICIENT-N` (≥2 valid lessons sharing a signature across DISTINCT issues + N≥floor).
4. **[W3] ENUM-widen regression** — after `['backtest','live']`, run the corpus suite; confirm no W0 path regresses.
5. **[W3] inverted-firewall round-trip** — the live store ACCEPTS `'live'` + REJECTS `'backtest'` (the firewall direction is the load-bearing edit).
6. **[W4] retriever provenance-blindness** — a mixed backtest+live vector ranks backtest (proves the read-path gate is needed).
7. **[W6] live-node population gate** — a world-anchored scored attempt must carry `recall_eligible===true` + `reference!=null` + a CLEAN_FOR_RETRIEVAL tier, or `populateRecallGraph` drops it.

## Narrows vs hardens (OQ-NS-6)

NARROWS only: W1+W2 (weight-vs-forgery), W3 (substrate), W4 (live retriever on the backtest corpus),
W5-shadow. **HARDENS: W6 ONLY** — a `provenance='live'` node from a real world-anchored run, measured
against external-merge outcomes. The mechanism is provable INTERNALLY at W1-W5 (beta mandate satisfiable);
the TRUST claim waits for the W6 world signal — which is **undefined (FORK-6)** and is the phase's
genuine open risk.

## Biggest risks

1. **Provenance-laundering into a LIVE surface (TOP)** — the live NODE is co-forgeable (no node-signing
   path; FORK-6b). A live retriever/bridge before an authenticated node-writer lets an unauthorized
   writer poison a real agent's context. The inverted firewall proves INTEGRITY not PROVENANCE.
2. **Building B on a non-existent harness capability** (ADR-0012 / K8 recurrence) — the mandatory
   lesson-path spike must run BEFORE B commits.
3. **OQ-NS-6 over-claim** — shipping W1-W5 as "hardening" when only W6 hardens (and W6's observable is undefined).
4. **The `trigger_class` gap (FORK-5)** — A and B silently mis-join on a null/wrong key.
5. **Premature authenticated-lane flip** — zeroes all tie-break signal (keep both lanes; degrade gracefully).
6. **Carry-C enforcement theater** — same-process minter+verifier re-invocable; confirm key-custody (FORK-2).
7. **The inverted-firewall trap (W4)** — gate provenance at the READ path, not store-isolation alone.

## Recommendation

The forks resolved cleanly, but **the live build (W4/W5) is blocked on FORK-5, and the entire A+B
payoff hinges on FORK-6 (undefined).** The highest-leverage, most-honest next move is to **resolve
FORK-6 first** — determine whether a viable world-anchored observable even exists — *before* investing
in more shadow machinery that, per OQ-NS-6, only narrows. If FORK-6 has no answer, A+B is narrowing
dressed as progress; if it does, the build is justified and FORK-5 (the classifier) is the next unblock.
W3 substrate is the only fork-free brick if incremental progress is preferred over resolving the
strategic forks first.
