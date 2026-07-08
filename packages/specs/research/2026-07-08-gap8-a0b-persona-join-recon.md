# Gap-8 Rung A0/B (the PR→persona join) — grounding recon + DEFER decision (2026-07-08)

3-lens read-only recon (census / architect / hacker, all firsthand + the hacker ran live PROBEs) to ground
the A0/B scope before building. **Outcome (as first written): DEFER A0/B to arming.** Gap-8's SHADOW-buildable work (Wave A-1
ingestion #524 + Wave A-2 global-only breaker #526) is DONE; A0/B (per-persona halting) and C (re-solve) are
arming-gated. This doc records WHY, and the arming-time build recipe so it is not re-derived.

> **CORRECTION (2026-07-08, same day — the DEFER conclusion below is SUPERSEDED; see [§Correction](#correction-2026-07-08--the-defer-over-applied-the-beta-internal-verification-mandate) at the end):**
> the DEFER over-applied the `beta-internal-verification-mandate`. A0/B IS buildable + INTERNALLY-verifiable now
> (mock/bootcamp/sandbox); **no external merge, and no reusable past data, is needed.** The hacker's "dormant-on-dormant
> → un-internally-verifiable" conflated *feature-works* (proven internally) with *trust-hardens* (waits for a live
> signal) — the exact conflation the mandate exists to correct. The byzantine-classifier surface + the self-asserted
> persona value REMAIN valid, but as DESIGN-FOR / arming-time concerns, not build blockers.

## The central finding (all 3 lenses agree)

No usable PR→persona or join_key→persona join exists on the LIVE path. The classified persona
(`classifyIssue`, `live-draft-run.js:284`) is computed and handed to `solveFn` (:303) but the emit call at
`:338` is `emitFn(data, {})` — an EMPTY opts, so the persona is never carried to emit. The scope doc's "the
join does not exist" HOLDS, sharpened by two partial pieces that do NOT close the gap:

- **The kernel join-key record has a `built_by` slot — but plumbed-but-empty + out-of-basis.** `built_by` is
  an optional bounded string (`WITH_BUILT_BY_KEYS`, `join-key-store.js:110-111`), gated by
  `assertRecordedClaim` (`emit-pr.js:276-292`), but NEVER populated (the sole live caller passes `{}`).
  Critically it is OUT of the sealed `deriveJoinKeyId` basis (`{repo, issueRef, pr_number, approval_hash,
  lesson_commitment}` — no persona) and out of `bodiesEqual`, so an in-place same-uid edit is ACCEPTED
  (**PROBE-2**: wrote `built_by='python-backend.noor'`, edited it to `'security-auditor.mallory'`, `loadJoinKey`
  read back the tampered value, no alert). And consuming it needs a join-key READ = a **3rd reader = the
  `REQUIRE_ALLOWLIST` dam breach** Wave A-1 deliberately avoided.
- **`authorship-store.js` is a real `(node_id → built_by)` persona-edge store — but the WRONG key domain.**
  `node_id` is a BACKTEST recall-graph worked-example (`deriveNodeId` over `{issue_id, candidate_patch_ref,
  repo, provenance}`), not a PR; its only writer is a `_spike`. It shares no key with any PR-keyed store.
- **`merge-outcome-store` has `(pr_number ↔ join_key_id)` — but POST-MERGE only** (`merge-observer` records
  `merged===true`), so it holds NOTHING for the un-merged changes-requested PRs the A-2 breaker targets.

## OQ-2, resolved (for when arming arrives)

The scope's OQ-2 was "(a) `built_by`-at-emit vs (b) a `join_key_id`→persona map store". Corrected by the recon:

- **Both leave the persona VALUE self-asserted.** The persona is `classifyIssue` output, absent from every
  sealed/signed basis. Content-addressing (option b) makes the `(key, persona)` binding **tamper-EVIDENT**
  (**PROBE-3**: an in-place tamper of a content-addressed record is REJECTED with a `content-hash` alert), NOT
  **provenance-authentic** (**PROBE-4**: a same-uid attacker mints a FRESH self-consistent record for a review
  GitHub never returned — accepted; the #273 integrity-not-provenance residual survives). So (b) still needs
  the authenticated-minter close before the persona can GATE.
- **Prefer (b), keyed by `(repo, pr_number)` — NOT `join_key_id`.** The A-2 review-outcome records carry
  `(repo, pr_number)`, so a `(repo,pr_number)→persona` map lets the breaker look up the persona from records it
  already reads, with ZERO join-key read (preserves the exactly-2-reader dam). Template: `review-outcome-store.js`.
- **The is-this-ours query is UNDER-SPECIFIED by a `join_key_id`→persona map.** A pre-merge review record has
  only `(repo, pr_number)`; resolving that to a join-key today needs `resolveJoinKeyForPr` (a 3rd kernel
  reader) which also wants an `html_url` the review record lacks. Building a `join_key_id`-keyed map now risks
  locking in a shape that does not serve A-2's actual query. **Resolve the is-this-ours index shape FIRST, at arming.**

## Why DEFER (the governing call — hacker, mandate-grounded)

The census + architect judged A0 "buildable-now-SHADOW" (true: halt-only NARROWS, so a forged/mis-attributed
persona over- or under-halts but never grants). But **safety (CAN) ≠ warrant (SHOULD)**:

1. **Dormant-on-dormant → fails the `beta-internal-verification-mandate`.** The map's producer inherits the
   join-key's armed-only write site (`emit-pr.js:622`, `pr && !pr.deduped`); the shipped pipeline is DRY and
   emits nothing → the map accretes ZERO records. The consumer (the `changes-requested` source) is
   `starved:true`, fed by an operator-invoked dormant observer. The JOIN — A0's only deliverable — is
   **un-exercisable end-to-end internally** (needs armed emission + a real external insider review, both
   arming-gated). The store is unit-testable in isolation, but the join is not internally verifiable. Per the
   mandate ("feature WORKS = proven INTERNALLY before done"), A0/B cannot clear the bar now.
2. **A NEW availability surface for zero payoff.** On the global plane the source uses a CONSTANT persona, so
   `classifyIssue` is inert. Per-persona makes `classifyIssue` — a keyword scorer over a STRANGER's issue text
   (`issue-classifier.js:56-80`) — load-bearing for WHICH persona is throttled: an attacker seeds an issue body
   with `kubernetes helm terraform` to steer classification to `devops-sre`, and if an insider then submits a
   changes-requested, the halt targets a CHOSEN persona. Availability-only, insider-gated, integrity-safe — but
   a targeted-DoS refinement the global plane lacks, pure new cost while dormant.

Global-only Wave A-2 (shipped, starved, halt-only) is the correct SHADOW resting point.

## Arming-time build recipe (do NOT re-derive — build in this order when arming arrives)

1. Resolve the **is-this-ours index shape** first — a `(repo,pr_number)→join_key` oracle (or accept a
   sanctioned 3rd join-key reader, a deliberate dam widening the USER must ratify). The map key follows from this.
2. Build option **(b)** (content-addressed, tamper-evident), NOT (a) — PROBE-2 vs PROBE-3.
3. Pair the persona VALUE with an **authenticated minter** (a signed / kernel-owned-writer edge — the #273
   v-next close = the same arming gate as ladder item-5). Tamper-evident is not provenance-authentic (PROBE-4).
4. Port the `(persona, id)`-keyed relocate-dedup that `dedupBySubject` (`project.js:116-132`) applies to
   `verdict-fail` into `activeChangesRequestedDenials` (`project.js:156-185`) — today it uses a constant
   persona and has NO relocate guard; a per-persona plane reopens the PROBE-2 relocate IDOR without it.

## Board records

- **census (general-purpose)**: BUILD-SHADOW-NOW a `(repo,pr_number)→persona` map (dam-preserving). Buildable, halt-only.
- **architect**: BUILD-SHADOW-NOW, same shape; both options leave the value self-asserted; do NOT reuse authorship-store / compose merge-outcome.
- **hacker (PROBE-backed)**: **DEFER** — dormant-on-dormant (mandate bar unmet) + a new byzantine-classifier availability surface + the map shape is under-specified for A-2's query. GOVERNING **(the mandate half is SUPERSEDED — see §Correction)**.

## Correction (2026-07-08) — the DEFER over-applied the beta-internal-verification-mandate

Prompted by the USER's question ("can we reuse existing data or do we truly need another external merge?"), a
firsthand re-read of `[[beta-internal-verification-mandate]]` (a USER standing directive, 2026-06-15) shows the
DEFER's load-bearing reason is WRONG. The mandate holds TWO axes ORTHOGONAL:

- **Feature WORKS** = proven INTERNALLY (mock / bootcamp / sandbox). MANDATORY before done. *"Never we'll validate it live."*
- **Trust HARDENS** = a LATER, separate axis awaiting a real world-anchored signal (a maintainer merge). *"Because the
  substrate behaves IDENTICALLY mock-vs-real, the internal proof ALREADY establishes the feature works; the live signal
  swaps in later with ZERO new machinery validation."* And: *"the ENTIRE build is the BETA: prove the MECHANICS."*

The hacker's "the JOIN is un-exercisable internally → fails the mandate" treated the trust-hardening signal (armed
emit + a real review) as a feature-works PREREQUISITE — the exact conflation the mandate was written to correct
(*"corrects an imprecise framing where I said the reputation E2E is gated on a real signal — WRONG"*). A0/B's join is
internally verifiable: the join LOGIC (persona-map + review records → per-persona halt) with MOCK records — exactly as
the Wave A-2 tests seeded mock review-outcomes — and the PRODUCER with an INJECTED mock pr_number (mock-vs-real
identical, per the mandate). No armed emit, no real review, needed for "done".

**Data-reuse finding (the USER's question, answered):** NO reusable data exists, and NONE is needed. The lab-state
stores are EMPTY (0 join-keys / merge-outcomes / review-outcomes / authorship). `spec-kitty#2137` was a real armed run
but persisted NO durable persona↔PR record AND never merged. The 73 `swarm/run-state/` dirs are chaos/bootcamp test
runs. PACT holds trust/signer attestations (custody roots, signed edges, the live cross-uid broker) — NOT Loom
PR/persona/review data. PACT's real role is the ARMING-time trust close: its live authenticated cross-uid broker is the
minter that signs the persona VALUE to close the co-forge residual WHEN armed (the loom-broker already reuses PACT's
broker mechanism) — a trust-hardening reuse, not a build input.

**Corrected recommendation: A0/B is BUILDABLE + internally-verifiable NOW.** Build it per the arming-time recipe above
(minus the "wait for arming" gating): the `(repo,pr_number)→persona` map (option b, content-addressed, dam-preserving),
written by the orchestrator, internally verified via the bootcamp/mock path. The two surviving hacker findings are
DESIGN-FOR, not blockers: (1) port the `(persona,id)` relocate-dedup into `activeChangesRequestedDenials` (the
byzantine-classifier / relocate surface); (2) NAME the self-asserted persona value as the arming-time trust residual
(the authenticated minter = PACT's broker at arming). What genuinely WAITS for arming is only TRUST-HARDENING (the live
per-persona halt calibrating a real weight), never the feature's correctness.
