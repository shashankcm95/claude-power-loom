---
lifecycle: persistent
plan: item-3-live PR-2 — the merge connection (world-anchor a captured live_pending lesson)
status: VERIFY-pending
date: 2026-06-28
---

# item-3-live PR-2 — the MINT-SIDE half of the merge wire (SHADOW, widens #273)

The autonomous-SDE ladder rung after #454 (the live-solve lesson CAPTURE into the
`live_pending` lane). #454 captures a lesson HYPOTHESIS at draft; today that hypothesis
is **disconnected** from the merge return-wire — the world-anchor mint (#452) only ever
world-anchors the static `LESSON_2137` seed. PR-2 builds the **MINT-SIDE half** of the
wire: the mint's floor can now *select* a captured `live_pending` lesson (via a
`(repo, issueRef, lesson_signature)` exact-set lookup) **if an attestation carrying that
lesson's signature exists**. The EMIT-side producer that writes such an attestation is
**Half B (deferred, a named seam)** — verified absent today (`cli.js:140-144` is the only
attestation producer, and it hardcodes the static `LESSON_2137` signature), so the
captured-floor branch is built + unit-proven but **inert in production** until Half B
lands (exactly #454's `deriveFn=null` posture). The honest one-liner: PR-2 does **not**
make a captured lesson get world-anchored on merge end-to-end; it builds + proves the mint
half of that future wire.

Stays SHADOW / weight-INERT (`LIVE_SOURCES = Object.freeze([])`; the import dams hold).
**WIDENS #273** in a named, bounded way (see §4). The authenticated edge minter (PR-A2)
remains the hard close.

## 0. Runtime probes (claims ground-truthed against the tree, 2026-06-28)

| Claim | Probe → observed |
|---|---|
| `main` @ #454 merged, synced | `git log --oneline -1` → `36bc932 …(#454)`; `git rev-list --count origin/main...HEAD` → `0 0` |
| The mint floor is static one-entry | `world-anchor-mint.js:77` → `const ORCHESTRATOR_LESSON_SEEDS = Object.freeze([LESSON_2137]);` |
| #452 header NAMES this rung's residual | `world-anchor-mint.js:36-39` → "the node's lesson basis (`att.lesson_signature`) is a same-uid substitution lever once item-4's runtime floor lands" |
| The attestation is the only bridge carrying BOTH issue + PR keys | `world-anchor-store.js:71-74` ATT_FIELDS = `[repo, issueRef, pr_url, pr_number, branch, base_sha, diff_hash, lesson_signature, built_by, approval_hash, emitted_at]` |
| The merge-outcome record has NO `issue_ref` | `merge-outcome-store.js:88-91` OUTCOME_KEYS = `[join_key_id, repo, pr_number, pr_url, approval_hash, outcome, merge_commit_sha, observed_at, content_hash]` |
| `lesson_signature` is a coarse 24-value bucket | `lesson-signature.js:62-68` `lessonClusterKey` = `lesson:<trigger>|<gotcha>|<corrective>`; enums are 4×3×2 |
| Both lesson producers emit the SAME cluster key | `lesson.js:47` and `live-lesson-derive.js:126` both `lessonClusterKey({trigger,gotcha,corrective})` |
| The captured lane carries the join keys | `live-pending-store.js:67` BASIS = `[provenance, repo, issue_ref, candidate_patch_sha, lesson_signature]` |
| `listLivePendingLessons` is TOTAL (load-bearing for a floor) | `live-pending-store.js:331-358` — skips corrupt/forged, never throws, deep-freezes each |
| The lane stays weight-inert | `weight-source-gate.js:37` `LIVE_SOURCES = Object.freeze([])`; gate keys on `source`, `live_pending` is a `provenance` |
| The dam already names PR-2's relaxation | `live-pending-store-shadow.test.js:16-18` — "PR-2 adds the world-anchor mint's floor-builder as the one allowlisted reader" |
| `att.issueRef` is the ISSUE number, not the PR | `cli.js:58-67` SPEC_KITTY_2137 → `issueRef: 2097` vs `pr_number: 2137` |

**Must probe at BUILD (producer-side, not yet confirmed):** that the capture site
(`persona-experiment/live-draft-run.js`) actually writes `repo` (GH_REPO_RE shape) +
`issue_ref` (positive int) + `candidate_patch_sha` (HEX64) for a real solve — the join
keys this PR reads. (The store's `validateBlock` enforces the shapes on write, but the
producer must populate them.)

## 1. The join-chain (the load-bearing data flow)

```
 draft  ──capture(#454)──▶  live_pending lesson { repo, issue_ref, candidate_patch_sha,
                                                  lesson_signature(bucket), lesson_body }
 emit   ──Half B──────────▶ attestation { repo, issueRef, pr_number, pr_url,
                                          lesson_signature ⟵ SOURCED from the capture }
 merge  ──observe(#451)───▶ merge-outcome { join_key_id, repo, pr_number, pr_url,
                                            approval_hash, merge_commit_sha }
 mint   ──Half A(#452)────▶ resolveAnchorForPr(repo, pr_number, pr_url) → attestation
                            floor-lookup (repo, issueRef, lesson_signature) → 1 lesson
                            → world_anchored NODE + UNSIGNED edge
```

The attestation is the **only** record carrying both `issueRef` (→ the captured lesson)
and `pr_number`/`pr_url` (→ the merge outcome). The merge record has no `issue_ref`, so
the join MUST route through the attestation.

## 2. Scope decision — Half A this PR; Half B a NAMED seam (recommended)

`lesson_signature` is a coarse bucket, so a connection keyed on it alone is wrong (a
different-issue lesson in the same bucket would substitute). The fix is to key the floor
lookup on the full `(repo, issueRef, lesson_signature)` exact-set.

**Recommended split** (mirrors #454's "build mechanism, defer the production wire" —
`deriveFn=null` was the named seam there):

- **PR-2 (this) = Half A, the mint-side connection.** The mint reads captured lessons
  into an **issue-bound, exact-set** floor and world-anchors the one match. Proven
  end-to-end by a test that crafts an attestation whose `lesson_signature` matches a
  real captured `live_pending` node and asserts the mint world-anchors THAT body (not
  `LESSON_2137`). The dam relaxes to admit `world-anchor-mint.js` as the one reader.
- **Half B (next rung) = the emit-time attestation-from-capture builder** — sourcing
  `att.lesson_signature` from the captured lesson at emit. Named seam: until it lands,
  production attestations still carry the static signature, so the captured-floor branch
  is built + proven but **inert in production** (exactly the #454 posture). **This is an
  open question for the VERIFY board** — collapse A+B into one PR if the board judges the
  emit wire small + low-risk enough to co-review (< 400 LoC total, one risk surface).

## 3. Design (Half A) — the issue-bound, exact-set floor

In `world-anchor-mint.js`, replace `ORCHESTRATOR_LESSON_SEEDS = [LESSON_2137]` with a
floor model where **every** entry is keyed by `(repo, issue_ref, lesson_signature)`:

- **Static grandfather seed** becomes issue-bound:
  `{ repo: 'Priivacy-ai/spec-kitty', issue_ref: 2097, ...LESSON_2137 }` (spec-kitty
  predates capture; this keeps its mint working).
- **Captured floor** = `listLivePendingLessons()` (already `{repo, issue_ref,
  lesson_signature, lesson_body, ...}`; deep-frozen, TOTAL).
- **Lookup at mint:** filter the combined floor to
  `repo === att.repo && issue_ref === att.issueRef && lesson_signature === att.lesson_signature`,
  then require **EXACTLY ONE** (the exact-set discipline, mirroring `resolveAnchorForPr`):
  - **0 matches →** `no-floor-lesson` refuse (existing reason; emit).
  - **>1 matches →** NEW `ambiguous-floor-lesson` refuse (emit, **fail-closed**).
  - **1 match →** world-anchor that lesson's `{lesson_signature, lesson_body}`.
- The static seed must still be BUILT inside the mint's try/catch (FOLD-A invariant from
  #452 — no build at require-time), and a captured lesson is already built (it carries
  `lesson_signature` + `lesson_body` verbatim — re-validate its enum axes / body bound via
  `buildWorldAnchorLesson` only if cheaply possible; otherwise treat the verified store
  body as the lesson, since the store already content-address-verified it on read).

**Why exact-one-or-refuse protects the grandfather:** an attacker who plants a *competing*
captured lesson for `(spec-kitty, 2097, LESSON_2137-bucket)` causes a **refuse** (ambiguity,
no mint), NOT a silent override. The attacker can DENY a shadow mint; they cannot
SUBSTITUTE the human-vetted body silently. Denial of a weight-inert shadow mint is
low-stakes.

**The dam relaxation** (`live-pending-store-shadow.test.js`): add `world-anchor-mint.js`
to the reader allowlist (the one admitted caller of `listLivePendingLessons`); keep the
writer allowlist + the corpus-firewall + weight-inertness assertions; keep the
non-vacuity probe (a planted sibling reader must still be detected).

## 4. #273 analysis — what this widens, and why it is tolerable

- **Before (#452):** the floor was ONE human-vetted static entry; blast radius = one
  lesson (the #452 header's named residual).
- **After (PR-2):** the mint READS the open-writable `live_pending` lane into its floor. A
  same-uid attacker can co-forge BOTH a captured lesson AND a matching attestation (both
  stores are open-writable; integrity ≠ provenance) → the mint world-anchors the
  attacker's body. The substitution lever grows 1 → N (per captured `(issue, bucket)`).
- **Why tolerable:** the node is **weight-INERT** (`LIVE_SOURCES=[]`; the import dam admits
  one reader, no weight/ranking/spawn consumer). The minted node gates NOTHING. The
  attacker can inflate a shadow record or DENY a shadow mint — neither moves a real
  decision. This is the SAME tolerance #454 already took for the lane itself.
- **The hard close (unchanged):** an authenticated edge minter (signed / kernel-writer
  edges — PR-A2 / ladder item 5) is the prerequisite before ANY `live_pending` node may
  gate a weight or the `LIVE_SOURCES` flip. PR-2 does NOT touch `LIVE_SOURCES`.
- **A world-anchored merge proves DIFF-ACCEPTANCE, not LESSON-CORRECTNESS** (`lesson.js:57-62`
  — the maintainer's review CORRECTED LESSON_2137's body). The mint records "this lesson's
  PR merged", never "this lesson is true".

## 5. Files

| File | Change |
|---|---|
| `packages/lab/world-anchor/world-anchor-mint.js` | the floor: static issue-bound seed + `listLivePendingLessons`; `(repo,issueRef,sig)` exact-one filter; new `ambiguous-floor-lesson` refuse; import `live-pending-store` (lab→lab sibling, allowed) |
| `tests/unit/lab/causal-edge/live-pending-store-shadow.test.js` | relax the reader allowlist to admit `world-anchor-mint.js`; keep writer-allowlist + non-vacuity + firewall asserts |
| `tests/unit/lab/world-anchor/world-anchor-mint*.test.js` | NEW cases: captured-lesson world-anchored end-to-end (crafted attestation); 0 / 1 / >1 floor matches; cross-issue non-match; grandfather still mints; co-forge widening is weight-inert |
| `packages/specs/plans/2026-06-28-item3live-pr2-merge-connection.md` | this plan (accretes VERIFY / VALIDATE / PR sections) |
| (Half B, if board says co-review) `packages/lab/world-anchor/cli.js` | an `attest-from-capture` builder sourcing `lesson_signature` from the capture |

## 6. HETS Spawn Plan (3-lens VERIFY — REQUIRED, kernel/security/trust-surface class)

Routing: route-decide → `root` + `[ROUTE-META-UNCERTAIN]` (token "attestation"); escalated
by judgment to `route` (high-stakes #273-widening trust surface with real design forks).

Spawn in parallel (read-only lenses):
- **architect** — the design forks: (D1) Half-A-only vs A+B split; (D2) the exact-one
  floor + ambiguity-refuse model; (D3) issue-binding the static seed; whether re-running
  `buildWorldAnchorLesson` on a captured body is needed or redundant given verify-on-read.
- **hacker** — the #273 blast-radius: the co-forge substitution lever, the
  ambiguity-as-denial vector, cross-issue/cross-repo non-substitution, weight-inertness,
  the dam relaxation (one reader, no second reader sneaks in), DoS via a large captured
  floor.
- **honesty-auditor** — the trust framing: CAPTURE≠confirm; "widens #273" stated not
  hidden; the Half-B-inert-in-production claim; no over-claim of "live connection".

Fold the board's verdicts into `## Pre-Approval Verification` here, then present to the
USER (the merge gate) for the go to BUILD.

## Drift Notes

- route-decide under-scored again on the substrate-meta lexicon (token "attestation");
  the `[ROUTE-META-UNCERTAIN]` escalation-by-judgment is the documented path.
- The summary's one-line scope ("thread the lesson_signature") was under-specified — recon
  surfaced that `lesson_signature` is a coarse bucket and the merge record lacks
  `issue_ref`, so the join must route through the attestation on `(repo, issueRef, sig)`.
  A status-claim that decayed against the probed reality (the recon-completeness sibling).

## Pre-Approval Verification (3-lens VERIFY board, 2026-06-28)

Three independent read-only lenses reviewed this plan against the real source. All three:
**PROCEED-WITH-FOLDS** (architect; hacker; honesty-auditor grade B). Verdicts + the folded
design below. The board caught one build-breaking contract drift (CRITICAL-1) and two
framing/authz errors (HIGH) the plan's first draft got wrong.

### Board findings (folded)

- **CRITICAL-1 (architect) — captured body has NO enum axes.** `live-pending-store.js`
  `buildBody` (132-144) persists only `lesson_signature` + `lesson_body`; the
  `trigger/gotcha/corrective_class` axes that `live-lesson-derive.js:125` produced are
  dropped. So the §3-draft "re-validate axes via `buildWorldAnchorLesson`" is impossible.
  **FOLD:** the mint resolves the lesson in **two explicit branches** that converge only at
  the final `{lesson_signature, lesson_body}` → `mintWorldAnchoredNode`:
  - **Branch A (static grandfather):** built via `buildLesson(seed)` inside the try/catch
    (the FOLD-A no-build-at-require invariant from #452 stays); seeds are issue-bound.
  - **Branch B (captured):** consume the live-pending record's `{lesson_signature,
    lesson_body}` **verbatim** — the store already content-address-verified it on read; do
    NOT rebuild. The node body comes from the **content-verified live-pending record**,
    never from the open-writable `att`.
  Do NOT unify the two branches into one "floor entry" abstraction (DRY trap) — they have
  different shapes (axes-bearing vs body-only) and different trust origins (human-vetted vs
  same-uid-forgeable); a premature merge erases the trust distinction §4 depends on.

- **HIGH (hacker H2) — exact-one is DEDUP, not AUTHZ.** The exact-one-or-refuse join
  prevents a *silent ambiguous-tuple* override, but it is NOT an authorization gate: for any
  **uncontested** `(repo, issue_ref, sig)` (any issue the grandfather does not occupy), a
  same-uid attacker co-forges one captured node + one attestation → exactly-one match → the
  mint world-anchors the attacker body with **NO refuse**. **The only thing keeping this
  safe is weight-inertness + the absence of a trusting reader — not the join.** §3/§4
  reworded accordingly (see §4 rewrite below). The authenticated minter (PR-A2) is the
  missing AuthN.

- **HIGH (hacker H1 + architect HIGH-1) — the body's TRUST CLASS flips.** The
  world-anchored body changes from a human-vetted, maintainer-corrected constant
  (`LESSON_2137`) to **untrusted model prose** (`live-lesson-derive` output) carrying that
  module's NAMED vacuous-leak residual (`live-lesson-derive.js:28-30` — with no
  `accepted_diff`, `lessonLeaks` is a no-op; only `scrubLabSecrets` + `LESSON_BODY_MAX`
  guard the body). §4 must name this qualitative widening (not just the 1→N count).

- **HIGH (architect HIGH-2) — inert branch needs an inertness ASSERTION.** Mirror #454's
  `deriveFn=null` test: assert a **production-shaped** attestation (carrying the static
  signature, no Half-B sourcing) does NOT world-anchor a captured body — making the
  production-inert posture a contract, not a comment.

- **JOIN BUG (architect D3 + hacker) — repo format mismatch.** The attestation `repo` is a
  **slug** (`Priivacy-ai/spec-kitty`; `validateAttestation` only length-bounds it, and
  `resolveAnchorForPr` forces it === the merge record's slug), but the captured lane
  enforces a **URL** (`GH_REPO_RE` → `https://github.com/owner/repo`). So
  `captured.repo === att.repo` is broken by construction. **FOLD:** normalize at the join —
  a `repoSlug()` helper extracting `owner/repo` from BOTH forms; compare slugs. (Half B must
  later reconcile the producer format; named there, not here.)

- **MED-1 (hacker) — off-taxonomy signature.** `validateBlock` only length-bounds a captured
  `lesson_signature` (≤512), so a co-forged node can carry a non-canonical key
  (`lesson:INVALID|...`). **FOLD:** the MATCHED signature must round-trip the frozen
  taxonomy — `isCanonicalLessonSignature(sig)` checks membership in the 24 derived
  `lessonClusterKey(TRIGGER×GOTCHA×CORRECTIVE)` keys; a non-canonical match → refuse
  (`off-taxonomy-lesson`, emit). Keeps the recall graph on-taxonomy (the freeze invariant).

- **MED-2 (hacker M2) — ambiguity-as-denial (forward-contract).** Planting a competing
  tuple forces `ambiguous-floor-lesson` → the legit mint is DENIED. Low-stakes today
  (nothing depends on mint-success; the refuse is observable). Becomes a
  grandfather-suppression vector once a world_anchored mint feeds item-4's runtime floor —
  the authenticated minter closes both the substitution and the denial lever.

- **MED-3 (hacker M3) — floor-count DoS.** `listLivePendingLessons` is per-file bounded +
  TOTAL, but reads EVERY file on EVERY mint (count-unbounded, O(N)-per-merge, same-uid local
  only, on the no-throw CLI arm). Named accepted residual at SHADOW scale; a defensive
  scan-count cap is optional this PR.

- **LOW-1 (hacker L1) — dam relaxation is full-path exact-set.** Admit `world-anchor-mint.js`
  by full-path `===` (not basename); assert the new-reader set is **exactly**
  `{world-anchor-mint.js}` (deepStrictEqual on offenders minus the one admitted path); keep
  the writer-allowlist, the corpus-firewall (M4), the weight-inertness assert, and the
  planted-sibling non-vacuity probe.

### §4 rewrite (the honest #273 framing)

The widening has THREE dimensions, all tolerable ONLY because weight-inert and ONLY until a
`live_pending` node gates a weight:
1. **Count:** floor grows 1 → N (per captured `(issue, bucket)`); the lever the #452 header
   named (`world-anchor-mint.js:36-39`) lands here.
2. **Body trust class:** the world-anchored body flips human-vetted-constant → untrusted
   model prose with a vacuous leak rail (H1).
3. **No authz:** the exact-one join is dedup/correctness, not authorization — substitution
   is uncontested-and-free on any fresh `(repo, issue, sig)` (H2).
**The protection that actually holds = weight-inertness (`LIVE_SOURCES=Object.freeze([])`,
confirmed) + zero trusting readers (probed: no reader of `listLiveNodes`/`world_anchored`
outside `world-anchor/`).** The hard close (unchanged) = the authenticated cross-uid edge
minter (PR-A2 / item 5), the prerequisite before ANY `live_pending` node gates a weight or
the `LIVE_SOURCES` flip. PR-2 touches `LIVE_SOURCES` not at all. A world-anchored merge
proves DIFF-ACCEPTANCE, never LESSON-CORRECTNESS (`lesson.js:57-62`).

### Build exit gates (folded, hard)

1. **Producer probe (honesty FOLD-5, HARD):** confirm `persona-experiment/live-draft-run.js`
   actually populates `repo`/`issue_ref`/`candidate_patch_sha` for a real captured solve. If
   it does not, the captured floor is empty and the whole branch is inert even with Half B —
   say so in the PR.
2. **Static-seed repo byte-form probe:** pin the issue-bound seed's `repo` to byte-match the
   actual spec-kitty attestation record (post-`repoSlug` normalization) so the grandfather
   mint still resolves.
3. Two-branch mint (CRITICAL-1); `repoSlug` join normalization; `isCanonicalLessonSignature`
   round-trip (MED-1); new refuse reasons `ambiguous-floor-lesson` + `off-taxonomy-lesson`
   (both emit).
4. Tests: captured world-anchored via crafted attestation (mechanism, NOT real-path —
   labeled per Rule-2a-corollary); 0/1/>1 floor matches; cross-issue + cross-repo non-match;
   grandfather still mints; production-shaped attestation does NOT mint a captured body
   (inertness assertion); off-taxonomy + co-forge widening stays weight-inert; dam exact-set
   relaxation + non-vacuity.
5. The full per-wave gate: kernel suite green, the lab + new suites green, eslint/yaml/
   markdownlint/release-surface/signpost drift-gates clean, `install.sh --hooks --test`.

### Honest title (honesty board)

`feat(lab/world-anchor): build the mint-side half of the captured-lesson merge wire (SHADOW, widens #273, Half B deferred)`

Status: **VERIFY complete → awaiting USER go for BUILD.**
