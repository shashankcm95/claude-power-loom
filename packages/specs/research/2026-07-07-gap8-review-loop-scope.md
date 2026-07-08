# Gap-8 — the review-loop rung: grounded scope (2026-07-07)

Scopes the third world-contact rung of the autonomous-SDE lifecycle gap-map (`2026-06-25-autonomous-sde-lifecycle-gap.md`; sketch in `2026-07-04-live-dogfood-lifecycle-gaps.md` §"Gap 8"). Pressure-tested by an `architect` (design/wave-split, firsthand persona-join trace) + a `hacker` (security posture) — both returned NEEDS-REVISION and their folds are baked in below. **This doc supersedes the §Gap 8 sketch's Wave-C security invariant, which named the wrong control (see §Correction-to-the-sketch).**

## The gap

An external PR review has **no ingestion path** back to the autonomous persona. Firsthand-mapped current state:

- The only post-emit signal ingested is the `merged` boolean (`merge-observer.js` → `gh-verify.js verifyMerge`). Nothing reads `/pulls/N/reviews` or `/pulls/N/comments`.
- No re-solve-on-feedback branch exists; `emitPR` is **create-only** (no update/re-push).
- The recorded outcome is effectively `['merged']` — it cannot even *represent* a review verdict.

Maintainers rarely merge first-shot; the **review → revise → re-push** loop is how most PRs reach the apex merge. Modeling only the outcome (merge) and not the dialogue (review) leaves the pipeline unable to converge on the signal it exists to earn.

## Runtime probes (firsthand-verified; the load-bearing corrections rest on these)

| Claim | Probe | Result |
|---|---|---|
| A review's `state` is GitHub-*computed* like `merged` | `gh-verify.js:179-188` (`merged===true` is a computed boolean) vs the GitHub review object | **FALSE** — `CHANGES_REQUESTED` is the **reviewer's button-press**, reviewer-supplied. Anyone with a GitHub account can submit it on a public/fork PR. This is the CRITICAL delta (C1 below). |
| The candidate's persona is reachable from the PR / join-key | Traced `merge-observer.js:72-84` → `join-key-store.js` `CORE_KEYS` (:110) + optional `built_by` (:111) → `live-draft-run.js:338` (`emitFn(…, {})`, so `built_by` never populated) → `live-pending-store.js:71` `STORED_KEYS` (no persona) → `candidate-sidecar.js:37-48` (patch bytes only) | **NOT reachable** — the persona (`classifyIssue`, `issue-classifier.js:56-166`) rides ONLY onto the in-memory outcome + the `draft-<record_id>.json` artifact (`live-draft-run.js:379-383`), keyed by `record_id`, NOT by `pr_number`/`join_key_id`. Per-persona review-halt is a **sub-gap** (Rung A0). |
| The circuit-breaker is a pluggable, halt-only source registry | `circuit-breaker/project.js:125` `SOURCES` = id → `{list:(nowMs,opts)=>[{persona,recorded_at}], starved}`; §0a.3.1 (:9-18) halt-only NARROWS | CONFIRMED — a new source is a `SOURCES` entry. BUT halt-only is **integrity-safe, not availability-safe** (H1 below). |
| The egress scrub defends against reviewer-prose injection | `kernel/_lib/scrub.js:81-96` (`scrubEmitDiff`) | **FALSE** — it is a **secret** scrub (outbound DLP: redacts tokens/base64/high-entropy from an *outbound* diff). It does nothing against inbound instruction-smuggling. The sketch's Wave-C invariant names the wrong control (H2). |
| A re-push could inherit the create-time approval | `emit-pr.js:575` (`computeEmissionHash(draft)` over the original diff) + `:615` (`consumeApproval`, one-shot) | CONFIRMED risk — an UPDATE that reuses the create approval launders unapproved (injection-influenced) content into an approved PR (#273 integrity≠provenance). Re-push MUST mint a fresh approval (H3). |
| A dry-run draft writes a join-key | `emit-pr.js:622` (writes only on `pr && !pr.deduped`, i.e. armed emit) | CONFIRMED — dry runs write no join-key → the observer has nothing to resolve. Wave A is buildable+unit-testable now but **dormant until armed emission + a real external review coincide** (same posture as merge-observer). |

## The wave split (revised after the boards)

The full loop = review-observer → reviewContext → persona materializer → `emitPR` UPDATE. The **risk is concentrated in the second half** (untrusted prose → re-solve prompt = actor-injection; `emitPR` UPDATE = a new egress capability). The split isolates the safe, buildable-now feedback path from the arming-gated Rubicon.

### Wave A — the review HALTS (it does not re-solve). Buildable now, SHADOW, safe once revised.

The signal: a maintainer's `changes-requested` on the pipeline's PRs slows the autonomous spawn rate. No prose, no re-solve, no emit-update.

- **A1 — review-observer** (`review-observer.js`, a new sibling of `gh-verify.js`): read-only `gh api -X GET repos/<repo>/pulls/<n>/reviews`, projecting at the **`--jq` layer** (like `gh-verify.js:146`) to select ONLY `state`, `author_association`, `submitted_at`, `id` — so the reviewer's free-text `body`/`login` **never leave GitHub** (structural, not "we fetch it but don't read it"). Reuse `assertReadOnlyGhArgs` (GET-only). **Do NOT widen `live-puller.js:60` `ENDPOINT_RE`** (it deliberately blocks `/reviews`); the observer is a separate module with its own GET-gate.
- **A2 — an APPEND-ONLY, per-review-snapshot review-outcome store** (SHADOW, content-addressed). A PR has MANY reviews and the "current" verdict is non-monotonic (CHANGES_REQUESTED → later APPROVED/DISMISSED), so the merge-outcome-store's one-record-per-join-key write-once model does **not** transfer. Key each record by `(join_key_id, review_id)` (or a content-hash of the verdict snapshot); "latest state" is a projection over `submitted_at`. The stored verdict is a **closed enum** — structurally cannot carry prose. Idempotent: the observer polls repeatedly, so re-recording the same review dedups content-addressed.

> **Correction (Wave A-1 build recon + VERIFY board, 2026-07-07 — the Wave A-1 plan `plans/2026-07-07-gap8-review-loop-wave-a1.md` is the concrete authority):** (1) **the key drops `join_key_id`** → `(repo, pr_number, review_id, state)`. Reading the kernel join-key would breach its `REQUIRE_ALLOWLIST` (exactly two readers: `emit-pr.js` + `merge-observer.js`); the observer must NOT be a third reader. (2) **the `pr_number`↔`join_key_id` recovery is POST-MERGE ONLY** — `merge-observer` records exclusively `merged===true`, so the merge-outcome store has no record for the un-merged, changes-requested PRs the breaker targets. Pre-merge correlation needs the A0 `join_key_id`→persona map (option b) or Wave B becoming an explicit join-key reader; **A-2 must re-establish "is-this-ours" before it gates** (un-joinable → non-counting, never trust-by-existence). (3) enums are **GitHub UPPERCASE** (`APPROVED`/`CHANGES_REQUESTED`/`COMMENTED`/`DISMISSED`; `PENDING`→skip). (4) the store OWNS its basis → it **re-derives `node_id` on read** (join-key-store pattern), unlike merge-outcome-store's opaque id.
- **A3 — a `changes-requested` circuit-breaker SOURCE**, GLOBAL-only (constant-persona, byte-for-byte the `reject-event`/`manage-promote` pattern, `project.js:155-193`), **mtime-windowed** (a `submitted_at` field is back-dateable; mtime-window keeps the `excluded_future` tamper diagnostic meaningful), opt-in (`LOOM_BREAKER_SOURCE=changes-requested`; default stays `verdict-fail`). Halt-only NARROWS.

**Wave-A invariants (load-bearing — the "safe" claim rests on ALL of these):**

1. **`author_association` gate (C1, CRITICAL — must be Wave A, not deferred).** Record a `changes-requested` denial ONLY when GitHub's *computed* `author_association ∈ {OWNER, MEMBER, COLLABORATOR}` (reuse `live-puller.js:231-232` `PR_INSIDER_ASSOCIATIONS`). A `CONTRIBUTOR`/`NONE` review is display-only, never a breaker input. Without this, any internet user is a remote off-switch for the persona (and, via the global cap, the fleet).
2. **Global-only plane (H1).** The source feeds the global cap, never a remotely-drivable per-persona plane. State explicitly: halt-only is **integrity-safe, NOT availability-safe** — a maintainer-gated, rate-limited, global-first plane is the availability mitigation this source's DoS surface requires.
3. **Rate-limit the halt input.** A hard cap on `changes-requested` events counted per window (belt-and-braces with the author_association gate).
4. **Dismissal/staleness (M2).** A `DISMISSED` review, or a `CHANGES_REQUESTED` superseded by a newer commit, must **stop halting** — else a resolved critique halts forever. The latest-state projection must account for it.
5. **Prose never persisted.** `body` and `login` are equality-checked against the maintainer allowlist only (via `author_association`), never stored for later display.

### Rung A0 — the PR→persona join (the sub-gap that unlocks per-persona halting)

Per-persona review-halt is blocked on a PR→persona map that does not exist today. Two build options, both with costs:

- **(a) Populate `built_by` at emit** (`opts.joinKeyMeta.built_by`, plumbing exists). Cheap, but `built_by` is untrusted/out-of-basis (same-uid-tamper-accepted); a forge could *relocate* a halt to the wrong persona — the v3.6 W2a IDOR-relocate class `dedupBySubject` guards (`project.js:94-106`). Halt-only means it grants nothing, but it under-counts the real persona (safety-bad direction). Acceptable only while SHADOW.
- **(b) A `join_key_id`→persona map store**, written at emit/capture, content-addressed. Cleaner; the persona key derives from the SEALED join-key, never the review payload (M1). This is essentially the sketch's "extend the outcome model" — so **per-persona review-halt is honestly a Wave-B deliverable.**

Recommendation: ship Wave A global-only; build A0 option (b) as the Wave-B prerequisite.

### Wave B — the outcome-model extension (deferred, SHADOW)

Make a review verdict a first-class recorded outcome (the "enum can't even represent a review verdict" gap) + Rung A0's PR→persona map → per-persona changes-requested halting. Consumes only GitHub-*computed* scalars (author_association-gated state, `submitted_at`, `merged`) — never attacker-inflatable comment counts, never prose (M2).

### Wave C — the re-solve Rubicon (arming-gated; the analog to item-8 Part-B)

`reviewContext` → persona materializer (a re-solve on feedback) + an `emitPR` UPDATE path (re-push to the existing PR branch). Operator/deploy-gated. **Wave-C invariants (sharpened by the hacker):**

- **Prose containment is TOOL-INERTNESS, not the secret-scrub (H2).** Reviewer prose enters ONLY the tool-less, network-isolated contained actor (`live-draft-run.js:409-421` `verifyToollessRuntime`, fail-closed — a prompt-injected actor can neither exfiltrate nor execute), labeled untrusted-not-instruction (`persona-prompt-materializer.js:50`). This is the SAME class as the raw issue text that already enters the actor prompt today (`trajectory-friction-run.js:98-104`), contained by the same tool-inertness + human-gate — NOT a new class, and NOT the outbound secret-scrub. Prefer the structured verdict + changed line-ranges over prose entirely; never route prose to a host-side judge.
- **Fresh approval on every re-push (H3).** A re-solve → new diff → new `computeEmissionHash` → a NEW signed human approval (never reuse the one-shot create approval; `consumeApproval` stays one-shot). The update TARGET (repo, pr_number, head ref, base_sha) derives ONLY from the SEALED join-key (`loadJoinKey`), never the review payload's `commit_id`/branch. The re-solved diff re-passes the full `assertEgressSafeDiff` + `scrubEmitDiff` + killswitch chain (an UPDATE is a fresh untrusted candidate, not a trusted continuation).
- **Hard per-PR re-solve iteration cap (M2).** The review→re-solve→re-push→review loop is an unbounded cost-amplification DoS; bound it.

## Correction to the §Gap 8 sketch (plan-honesty)

The sketch (`2026-07-04-live-dogfood-lifecycle-gaps.md` §Gap 8, lines 55-60) states the Wave-C invariant as *"reviewer prose must pass the same kernel-constant envelope / scrubbing the egress path already enforces."* That names the **outbound secret-scrub** (`scrub.js`), which is a no-op against inbound instruction-smuggling — a category error (hacker H2). The correct control is inbound **tool-inertness containment** (`verifyToollessRuntime`) + the untrusted-not-instruction framing + the human approval gate. This scope doc is the current authority; the sketch line should be corrected in place on the next docs-touching PR.

## Recommendation

**Build Wave A** (global-only `changes-requested` breaker: read-only-GET observer, append-only per-review store, author_association-gated + rate-limited global source, mtime-windowed, dismissal-aware). It is a real, safe first review→feedback path — safe because a halt grants nothing (integrity) AND is maintainer-gated + global-only + rate-limited (availability). It adds **zero** egress capability and **zero** prose surface. **Defer** Rung A0/Wave B (per-persona halting, needs the PR→persona map) and **Wave C** (the re-solve/emit-update Rubicon, operator-arming-gated). Do NOT authorize Wave C without explicit per-step go-aheads — it is the actor-injection + new-egress-capability surface.

## Board records

- **architect** (`a0787ab618fdfe892`): SCOPE-NEEDS-REVISION → persona-join is a genuine sub-gap (Wave A must be global-only); review cardinality breaks the merge-observer template (append-only per-review store); author_association + dismissal + mtime-window invariants. Folded above.
- **hacker** (`ae4f1257aadb7cab6`): POSTURE-NEEDS-REVISION → C1 (reviewer-supplied state = remote off-switch; author_association gate in Wave A) · H1 (halt-only is integrity- not availability-safe; global-only) · H2 (Wave-C control is tool-inertness, not the secret-scrub) · H3 (fresh approval per re-push) · M1 (persona key from sealed join-key) · M2 (mutable state + inflatable counts + re-solve cost-loop). All folded above.

## Open questions (resolve before the respective wave)

- **OQ-1 (A2):** the exact review-snapshot key — `(join_key_id, review_id)` vs a content-hash of `{state, author_association, submitted_at}`; and the latest-state projection's dismissal/staleness rule.
- **OQ-2 (A0):** `built_by`-at-emit (cheap, forgeable) vs a `join_key_id`→persona map store (cleaner, Wave-B-sized). Recommend the map store.
- **OQ-3 (A3):** the global-cap threshold + window for a maintainer-gated source (the existing `verdict-fail` defaults may not fit a much sparser review stream).
