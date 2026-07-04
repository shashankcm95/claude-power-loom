# Intake Gate — Wave 1: the `hasExternalMergeHistory` populator guard

Status: PLANNED (2026-07-04). Realizes Gap 7 / Part A (`packages/specs/research/2026-07-04-intake-pr-acceptance-gate-design.md`).
Mode: SHADOW-first (default OFF — log-only advisory; no production behavior change until the drop-flag is armed).

## Context

The autonomous-SDE apex signal is an external maintainer's merge. A repo that blocks external PRs
(collaborators-only) can never produce it; today we learn that only at submit, after a full solve (the colophon
dead-end). Gap 7 / Part A adds the one readable signal the populator lacks: **has this repo ever merged an
external-contributor PR?** (`isPrCapable` already gates archived/disabled/no-fork/template; the interaction limit
is admin-only/unreadable.) Wave 1 is Part A only — the guard + its wiring. Part B (submit-time fail-fast +
`terminal-block` + disposal) is a later wave and couples to Gap 9.

## Routing Decision

```json
{ "recommendation": "route", "basis": "security-adjacent (widens the gh endpoint surface + a new authenticated read on untrusted repo data); multi-file; needs architect VERIFY + a 3-lens VALIDATE. route-decide abstained on keyword signal ([ROUTE-DECISION-UNCERTAIN]); route by judgment per H.7.5 + ultracode." }
```

## HETS Spawn Plan

- **VERIFY (pre-build):** `architect` (design soundness — the ENDPOINT_RE widening vs a separate builder; the
  out-of-band advisory; the SHADOW gating) + `hacker` (the endpoint-surface widening + the new GET-pinned read on
  untrusted `author_association`/`merged_at`).
- **Build:** root (TDD, done in-session; small, security-sensitive, high-familiarity).
- **VALIDATE (post-build, on the BUILT diff):** the 3-lens tier in parallel — `code-reviewer` (correctness) +
  `hacker` (re-probe the widened endpoint + the read-only pin on the live module) + `honesty-auditor`
  (claim-vs-evidence: does it stay SHADOW/no-shape-change; is the predicate honest).

## Files To Modify

- `packages/lab/issue-corpus/live-puller.js` — extend `ENDPOINT_RE` to allow a `/pulls` suffix; add
  `ghApiClosedPullsArgs` (or extend `ghApiReadArgs`) + `hasExternalMergeHistory`; wire into `pullLiveCorpus`
  (SHADOW-gated drop) + `fetchOneIssueRecord` (out-of-band advisory); export the new symbols.
- `tests/unit/lab/issue-corpus/live-puller.test.js` — TDD-first: the guard's true/false/malformed/error cases,
  the ENDPOINT_RE `/pulls` regression, the SHADOW-gated drop, the single-path advisory, the read-only pin holds.

## Runtime Probes (verify the premises before building)

- Probe: `ENDPOINT_RE` today → `/^repos\/…\/…(\/commits\/HEAD|\/issues\/[0-9]{1,15})?$/` — **rejects `/pulls`**
  (live-puller.js:58). So a `/pulls` read needs the regex widened (a security-sensitive change → the hacker lens).
- Probe: `validatePublicRecord` enforces `pubKeys === PUBLIC_FIELDS` exactly (corpus.js:132-135) → **the acceptance
  verdict CANNOT be a field on the record**; it is delivered out-of-band (a logger call / a separate return).
- Probe (2026-07-04 gh): `author_association` + `merged_at` are readable on a closed PR — colophon: all `OWNER`
  (0 external merges); spec-kitty: `CONTRIBUTOR` (5 external authors). The discriminator holds on real repos.
- Probe: `assertReadOnlyGhArgs` requires an explicit `-X GET` (live-puller.js:174) → the new call MUST pin `-X GET`
  and pass `state`/`per_page` as `-f` query params (GET-pinned), never a write verb.

## Phases

### Build

- [ ] Widen `ENDPOINT_RE` to `(\/commits\/HEAD|\/issues\/[0-9]{1,15}|\/pulls)?` — `/pulls` is a fixed literal, no
      params in the PATH (params go via `-f`, GET-pinned). Add a targeted regression test.
- [ ] `ghApiClosedPullsArgs(owner, repo, perPage)` → `['api','-X','GET', ghApiEndpoint(owner,repo,'/pulls'),
      '-f','state=closed','-f',`per_page=${perPage}`,'-f','sort=updated','-f','direction=desc']`.
- [ ] `hasExternalMergeHistory(owner, repo, ghRunner, {perPage=30} = {})` → **tri-state** `true` / `false` / `null`
      (VALIDATE MEDIUM — a transient error must NOT read as a structural block). `true` = a merged PR from a
      non-insider (`author_association` a STRING not in `INSIDER = {OWNER, MEMBER, COLLABORATOR}`); `false` = a
      VALID read showing none (a confirmed "never merged an external PR"); `null` = could-not-assess (a throw /
      non-JSON / non-array). Whole body wrapped so no crafted response throws out. Unknown-but-string association
      => external (lenient keep; a false-keep is only a wasted solve, which the FUTURE Part-B submit-fast will
      recover — Part B is deferred, so this is NOT yet backstopped; a false-drop would silently lose a candidate).
- [ ] `pullLiveCorpus`: new opt `dropOnNoExternalMerge = false`. When TRUE, AFTER `isPrCapable` + license (the
      cheap guards, so the extra read only runs for otherwise-eligible repos): `if (!hasExternalMergeHistory(...))
      throw new Error('drop: no external PR ever merged')`. When FALSE (default) the guard is **not invoked at
      all** — zero extra gh call, zero behavior change (the observe-first dam; existing `g*` tests untouched).
      Record shape untouched.
- [ ] `fetchOneIssueRecord`: new optional `logger`. When a `logger` IS provided, after the safety gates:
      `if (!hasExternalMergeHistory(...)) logger({level:'warn', reason:'no-external-merge-history', repo})`. When
      absent, the guard is not invoked. The record is returned UNCHANGED (public shape locked); never a drop (the
      operator explicitly targeted this issue). Stays synchronous.
- [ ] Export `hasExternalMergeHistory`, `ghApiClosedPullsArgs`.

### Test (TDD — write first, expect red)

- [ ] guard TRUE: a merged PR with `author_association:'CONTRIBUTOR'` → true (spec-kitty shape).
- [ ] guard FALSE: all merged PRs `OWNER` → false (colophon shape); and no merged PRs → false; and open-only → false.
- [ ] guard FAIL-CLOSED: gh throws / non-JSON / non-array → false (never throws out).
- [ ] `INSIDER` exactness: `MEMBER`/`COLLABORATOR` merges → false; unknown assoc merge → true.
- [ ] ENDPOINT_RE regression: `/pulls` now passes `ghApiEndpoint`; `/pulls/../x`, `/pulls?x`, `/pullsX` still reject.
- [ ] pullLiveCorpus: flag OFF → risky repo KEPT + an observe log; flag ARMED → risky repo DROPPED with the reason.
- [ ] fetchOneIssueRecord: risky repo → record returned unchanged + a warn log; no logger → no throw.
- [ ] read-only pin: `ghApiClosedPullsArgs` passes `assertReadOnlyGhArgs` (has `-X GET`); a fabricated write-verb variant is refused.

### Validate

- [ ] 3-lens on the built diff (code-reviewer + hacker + honesty-auditor); findings folded + re-probed.
- [ ] full issue-corpus suite green; eslint 0; signpost (no new .js file — extends an existing one); markdownlint (plan).

## Verification Probes (post-build)

- The widened `ENDPOINT_RE` still rejects every traversal/param-in-path form (unit + a hacker re-probe).
- `pullLiveCorpus` with the flag default (OFF) produces the SAME records as before (no behavior change) — a golden test.

## Out of Scope (Deferred)

- **Part B** — submit-time fail-fast on the `CreatePullRequest` error → `terminal-block` outcome (Wave 2; couples to Gap 9 disposal).
- **Calibration/telemetry** — measuring how often the heuristic predicts the submit outcome (needs Part B outcomes).
- **Pagination** — the guard checks the most-recent `perPage` closed PRs (sort=updated desc); a deeper scan is a follow-up.
- Gap 8 (review loop) and Gap 9 (disposal) — their own waves.

## Drift Notes

- The design doc's "fold acceptance onto the record" was corrected here: `validatePublicRecord` locks the shape,
  so the verdict is out-of-band (logger). Caught at plan time by the record-shape probe.
- The plan's original "SHADOW observe-but-keep (log + KEEP)" default was refined to **invoke-only-when-enabled**
  (default fully inert, no gh call) — surfaced by the TDD process: an always-on `/pulls` call would break the
  existing `g*` pull tests and add a per-candidate read for a calibration comparison that needs Part B (deferred).
  This is the safer observe-first-dam shape; the architect lens (which would likely have flagged it) failed
  mechanically, so the TDD red step caught it instead.

## Pre-Approval Verification (2026-07-04)

- **hacker: SOUND-WITH-CHANGES.** Probed the widened `ENDPOINT_RE` against 8 abuse forms (`pulls/1/merge` PUT,
  `pulls/1/reviews`, `pullsX`, param-in-path, traversal, newline) — all reject; only `repos/owner/repo/pulls`
  passes (terminal literal alternative + the `ghApiEndpoint` re-assertion). The proposed args builder passes
  `assertReadOnlyGhArgs` (explicit `-X GET`); query params ride as GET, no auto-POST. `author_association`/
  `merged_at` flow only into a Set test + a logger reason (no interpolation). **The security surface is safe.**
  Three folds applied to the Build/Test below:
  1. **[MEDIUM]** Wrap the WHOLE predicate in ONE try/catch → `false` on ANY throw (a null array element throws a
     TypeError the "gh/parse error" wording didn't cover); require `pr` truthy + `typeof pr==='object'` +
     `merged_at` truthy + `typeof author_association==='string'`. New mixed-junk-list test.
  2. **[LOW]** `typeof author_association==='string'` is now required to COUNT a merge as external (a non-string
     is skipped, not counted); unknown-but-string stays external (lenient keep). Commented + tested.
  3. **[LOW]** Add `pulls/1/merge` + `pulls/1/reviews` to the ENDPOINT_RE reject-regression set.
- **architect lens: failed mechanically** (StructuredOutput retry-cap, no substantive output). Its one non-security
  concern — caller-compat of the new opts — was resolved firsthand: both callers use options-objects
  (`fetchFn({owner,repo,number})` @ live-solve-one.js:99; `pullFn({limit})` @ live-loop-run.js:94), so the optional
  `logger` / `dropOnNoExternalMerge` (undefined defaults) break no caller; `fetchOneIssueRecord` stays synchronous.

## VALIDATE result (2026-07-04) — 3-lens on the BUILT diff, each finding adversarially verified

Tests 55/0; eslint clean; full issue-corpus suite green. **Security surface HELD** (hacker positive evidence):
the widened `ENDPOINT_RE` + the `/pulls` call reject every write/traversal/injection probe (`/pulls/1/merge`
PUT, `/pulls/1/reviews`, param-in-path, `%2f`-encoded, traversal) at `ghApiEndpoint`; the new call stays
GET-pinned; SHADOW-dormant default verified (zero new gh call / zero behavior change). Findings folded:

- **[MEDIUM] logger-throw could abort an otherwise-valid fetch** (code-reviewer + hacker) → the advisory
  `logger()` call is now wrapped fail-soft (a logging side-effect never changes the fetch's control flow); test `k14`.
- **[MEDIUM] fail-closed conflated a transient `/pulls` error with a structural "no external merge"** (hacker) →
  the guard is now **tri-state** (`null` = could-not-assess); callers act ONLY on an explicit `false`, so a
  network blip never drops a good candidate or emits a false reason; tests `k4`, `k15`.
- **[LOW] `caught at submit by Part B` present-tensed an unbuilt gate** (honesty) → reworded to FUTURE in both
  the code comment and this plan (Part B is deferred / not yet a backstop).
- **[LOW] missing JSDoc** for `dropOnNoExternalMerge` + `logger` → added.
- **[LOW] untested empty-string / lowercase `author_association`** → test `k13` locks the lenient-keep behavior.
- **[LOW] pagination blind spot** (only newest `perPage` PRs) → already listed Out-of-Scope; documented in the guard.

## Why this is the right shape

The populator already IS the intake filter (`isUnassigned`/`isPrCapable`/`isLicenseCompatible`, throw-to-drop).
This adds one guard in the same idiom, SHADOW-gated so it changes nothing until calibrated, and keeps the locked
public-record shape untouched. The security surface is a single, minimal endpoint widening (`/pulls`) that stays
GET-pinned by construction.
