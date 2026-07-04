# Intake PR-Acceptance Gate — design draft

Status: design draft (DRAFT — not a build commitment; needs a VERIFY panel + a wave plan before it lands).
Date: 2026-07-04.
Motivates: Gap 7 in `2026-07-04-live-dogfood-lifecycle-gaps.md`.
Grounding probe: `schmug/colophon` (blocks external PRs) vs `Priivacy-ai/spec-kitty` (merged our #2137), gh API
2026-07-04.

## Problem

The north-star apex signal is an external maintainer merging an autonomously-delivered PR. A repo that blocks
external PRs can never produce that signal, however correct the fix. Today we discover this only at the
`CreatePullRequest` step, *after* a full classify -> solve -> fix -> verify cycle (the colophon dead-end). The
intake gate exists to spend zero solve budget on a candidate whose repo cannot merge our PR.

## The detection reality (what is and is not knowable pre-solve)

Probed 2026-07-04 as a non-collaborator on both repos:

| Signal | Readable? | Discriminating? |
|---|---|---|
| `allow_forking` | yes | necessary, not sufficient (colophon allows forking, still blocks PRs) |
| `archived` / `disabled` | yes | hard non-starter if true |
| `visibility` / access | yes | hard non-starter if no read/fork access |
| **external-contributor MERGED-PR history** | **yes** | **strongest** — colophon: 0 (all `OWNER`); spec-kitty: 5 external authors |
| per-PR `author_association` | yes | corroborates the above (`CONTRIBUTOR`/`FIRST_TIME_CONTRIBUTOR` = external merges happen) |
| interaction limit / collaborators-only PR restriction | **NO** (`GET .../interaction-limits` -> 403, admin-only) | this is the *actual* block, and it is invisible to us |

**Conclusion:** there is no perfect precheck. The definitive signal is the `CreatePullRequest` permission error
at submit. So the gate is two coupled parts: a cheap readable **heuristic** at intake that filters obvious
non-starters, and a **fail-fast-and-dispose** at submit that catches the rest cleanly.

## Design

### Part A — one new viability guard in the populator (not a separate filter)

> **Correction (`drift:recon-depth`, 2026-07-04).** An earlier draft of this section proposed a separate
> "intake filter" with a HARD-REFUSE set (`allow_forking===false` / `archived` / `disabled` / template). A read
> of the actual populator shows **that set is already enforced** by `isPrCapable` in
> `packages/lab/issue-corpus/live-puller.js` — `!!meta && meta.archived===false && meta.disabled===false &&
> meta.allow_forking===true && meta.is_template===false` — applied per-item in `pullLiveCorpus`'s throw-to-drop
> loop (and imported by `fetchOneIssueRecord`). So there is no separate filter to build and no hard-refuse set to
> re-implement. Part A scopes down to the ONE signal the populator does not yet have.

The populator is *already* the intake filter: `pullLiveCorpus` drops non-viable candidates per-item
(`isUnassigned` -> `isPrCapable` -> `isLicenseCompatible`, each throwing a greppable `drop:` reason). The only
PR-acceptance signal missing from that sequence is the colophon discriminator — **has this repo ever merged an
external-contributor PR?** Add exactly one guard, reusing the existing pattern:

- **New guard `hasExternalMergeHistory(owner, repo, ghRunner)`** — reads the closed-PR list (via the existing
  read-only `ghApiReadArgs`) and returns true iff at least one merged PR has `author_association` in
  `{CONTRIBUTOR, COLLABORATOR, MEMBER, FIRST_TIME_CONTRIBUTOR}` (i.e. a non-`OWNER` merge). colophon: false
  (all `OWNER`); spec-kitty: true (5 external authors). It costs one extra `gh` read, so it runs AFTER the
  cheap metadata guards, only for candidates that already passed `isPrCapable`.
- **Disposition differs by path:**
  - `pullLiveCorpus` (pool discovery): a **drop-filter**, same throw-to-drop shape —
    `if (!hasExternalMergeHistory(...)) throw new Error('drop: no external PR ever merged')` (or a down-rank in a
    ranked pool).
  - `fetchOneIssueRecord` (single targeted): an **advisory, not a drop** — the operator explicitly chose this
    issue, so attach the verdict and warn ("no external PR has ever merged here; submission may be blocked"),
    but do not discard their pick on a heuristic (a brand-new repo may simply have no PR history yet).
- **Output:** a structured `{acceptance: 'ok' | 'risky', signals: {...}, reason}` folded onto the public record,
  so downstream (and the operator) see the risk before the solve, and telemetry can measure how often the
  heuristic predicts the eventual submit outcome (calibration against Part B).

### Part B — submit-time fail-fast-and-dispose (the definitive gate)

At the emit/submit path, the `CreatePullRequest` permission error (the GraphQL "does not have the correct
permissions" / REST 404-on-`POST /pulls`) is the ground truth. Catch it explicitly (it is already surfaced,
value-redacted) and classify the candidate **TERMINAL-BLOCKED**:

- hand off to Gap 9 disposal (dispose durable artifacts, mark the pending lesson dead — do not retain a candidate
  that can never merge);
- record a `terminal-block` outcome with the reason (`pr-creation-restricted`), so the heuristic in Part A can be
  *calibrated* against real outcomes over time (did "risky" predict "blocked"?);
- (future, coupled to the deferred issue-dataset) switch to the next candidate rather than stall.

### Why both

Part A avoids *most* wasted solves for free (a repo with a healthy external-PR history is very likely to accept
ours; one with none is the risk case). Part B is the backstop for what the heuristic cannot see (the admin-only
limit), and it converts a dead-end from "silent inert residue" into "recorded terminal-block + clean disposal +
a calibration data point."

## Wiring + mode

- **Part A:** one `hasExternalMergeHistory(owner, repo, ghRunner)` guard in `live-puller.js`, slotted into the
  existing per-item guard sequence AFTER `isPrCapable` (which already gates `archived`/`disabled`/no-fork/template)
  and the cheap rejects — a drop in `pullLiveCorpus`, an advisory verdict in `fetchOneIssueRecord`. Reads only via
  `ghApiReadArgs` (read-only, value-redacted errors).
- **Part B:** in the submit/emit path; classify the create error, emit a `terminal-block` outcome, invoke disposal.
- **Mode:** SHADOW-first — the new guard logs its `acceptance` verdict as an advisory and does NOT drop the risky
  single-targeted case until the calibration (Part B outcomes) shows the heuristic is trustworthy. The unambiguous
  non-starters (`archived`/no-fork/template) already gate today via `isPrCapable` — no change needed there.

## Security

- Part A reads only public repo metadata through the existing read-only gh surface; no new auth, no write, no
  actor-controlled input reaches a privileged path.
- Part B reads the gh create-error only (already handled + value-redacted); the terminal-block reason is a fixed
  enum, never free actor text.

## Open questions (resolve at VERIFY)

1. Heuristic threshold: is "zero external merged PRs" a REFUSE or only a WARN? (Draft: WARN for a targeted issue;
   down-rank for a pool. A brand-new repo with no PR history should not be permanently refused.)
2. How to represent `terminal-block` in the outcome store (whose enum is currently `['merged']`) — a sibling
   store, or an extension? (Couples to Gap 8's review-outcome shape; decide together.)
3. Calibration horizon: how many real terminal-blocks before the heuristic is trusted to hard-gate?

## Honest residual

Even Part A + Part B cannot *guarantee* acceptance: a repo can accept external PRs in general but block a specific
one, or set a limit after intake, or a maintainer can simply decline. The gate REDUCES wasted solves and makes
dead-ends cheap and recorded; it does not make the merge predictable. Only the merge is the signal (OQ-NS-6).
