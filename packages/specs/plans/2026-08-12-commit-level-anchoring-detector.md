# Plan — commit-level world-anchoring detector (SHADOW, advisory)

lifecycle: ephemeral

## Goal

`merge-promote` decides world-anchoring from `pulls/N.merged`. That is **PR-scoped**, but the anchoring
event is **COMMIT-scoped**: a maintainer who carries our commits into their own PR gives us a real merge
that our detector calls a rejection. This just happened on the first real case, so the false negative is
demonstrated, not hypothetical.

Build a READ-ONLY, TOTAL, SHADOW detector that answers *"did our work land in the upstream default branch?"*
independent of whether OUR PR merged. **Advisory only this wave** — wired to nothing that gates, because
changing the single trust input deserves its own wave with the full board.

## The motivating case (all figures firsthand-probed)

`Priivacy-ai/spec-kitty#2611` (ours) — closed, **not merged**. Yet both its commits are ancestors of
upstream `main`, authored by us, carried in by the maintainer's `#3305` (merged 2026-08-10).

```
verifyMerge(#2611)            -> {merged:false, merge_commit_sha:null, state:"closed"}   => "rejected"
compare(main...6930d8c56)     -> {status:"behind", ahead_by:0}                            => actually landed
```

GAP-2 (closed-unmerged disposal), which was next on the roadmap, would have **disposed this as a
rejection** — poisoning the only signal that hardens trust. This detector is a prerequisite for GAP-2
being safe to build at all.

## Runtime Probes (each run against the live case before designing)

- **Head-SHA comparison is INSUFFICIENT.** `compare/main...{pr.head.sha=76f1ec12c}` ->
  `status=diverged, ahead_by=2`. The maintainer rebased, so our commits landed under DIFFERENT shas
  (`6930d8c56`, `370d1b72e`). A head-sha containment check would have MISSED the motivating case entirely.
- **`author=<login>` is UNRELIABLE; `author=<email>` works.** `?author=shashankcm95` -> **0** commits;
  `?author=shashankcm95@users.noreply.github.com` -> exactly our **2**. (The commit IS linked to the
  account — `.author.login == "shashankcm95"` — the login-form filter simply does not match it here.)
  Recorded so nobody later "simplifies" it to the login form and silently gets zero forever.
- **`/commits/{sha}` exposes `.files[].patch`** (7 files, `has_patch=true`) -> content compare is possible.
- **STRICT PATCH-IDENTITY IS TOO STRICT.** With a patch-id-style normalization (drop hunk headers +
  `index` lines, keep only `+`/`-` content, sort by filename), our two commits scored **1/2**:
  `refactor: route remaining…` matched exactly (`2df5863f9d1eabfe` both sides), but
  `refactor(clock): enforce…` did NOT (`bf2ff8f2353d9550` vs `82fb48da905bed1b`) — the maintainer ADAPTED
  it while landing (closing `tz=` / aliased-UTC bypasses). => patch-identity must be a STRENGTH
  QUALIFIER, never the gate, or an adapted landing reads as "not anchored".
- `.committer.login` on the landed commit is the MAINTAINER (`stijn-dejongh`) while `.commit.author` is
  us — i.e. the maintainer committing our authored work is exactly the observable shape of the event.

## Design

### The signal (and why it is sound)

**Anchored := a commit ATTRIBUTED to our author identity is REACHABLE from the upstream default branch,
authored on/after our PR opened.**

- **Reachability is the trust basis.** Only someone with write access to upstream can put a commit on its
  default branch. We verify it EXPLICITLY per candidate (`compare/{default}...{sha}` -> `ahead_by === 0`)
  rather than inferring it from the list endpoint's default-branch behaviour.
- **Author-email is the ATTRIBUTION LINK and a search bound — never the evidence.** Git author metadata is
  self-asserted, so it is used only to narrow the candidate set. Forging it would require upstream write
  access, i.e. the maintainer deliberately landing work as us — which IS the event we are detecting.
- **A candidate must LINK to a specific commit of ours** — attribution + reachability alone is NOT
  anchoring (a live control proved that means merely "this author has committed since"; see the dogfood
  section). `exact` = patch-identical after normalization (sound, no shape matching). `adapted` = same
  subject AND >=50% of our files also touched — a shape-ASSISTED inference, so it is never reported as
  `exact` and never substitutes for patch-identity; it exists only because a maintainer may MODIFY the
  change while landing it (probed: 1 of our 2 commits).

### Module — `packages/lab/solve-queue/commit-anchor.js`

`detectCommitAnchoring({ repo, pr_number, runner?, timeoutMs?, maxBytes?, maxCandidates? })` ->
`{ ok, anchored, strength, via, landed:[{sha, patch_exact}], our_commit_count, reason? }`
(`via` is `'head-contained'` on PATH A and `'attributed-reachable'` on PATH B; `null` when not anchored.)

- READ-ONLY: every call goes through the shared `assertReadOnlyGhArgs` gate, invoked HERE (an injected
  runner bypasses `defaultRunner`'s own gate — the `review-observer.js:81` lesson).
- TOTAL: never throws; every failure is a classified `reason` + an OBSERVABLE alert.
- **PATH A (cheap, the ordinary case):** `compare/{default}...{pr.head.sha}` -> `ahead_by === 0` ->
  anchored, `strength:'exact'`, `via:'head-contained'`. One call; covers a normal merge/fast-forward.
- **PATH B (the rebase/cherry-pick case):**
  1. `GET /pulls/{n}/commits` -> our commits + their author emails (bounded; refuse > MAX_OUR_COMMITS).
  2. per distinct author email: `GET /commits?author={email}&since={pr.created_at}&per_page=100`
     (bounded to `maxCandidates`; a full page is reported as `candidates-truncated`, never silent).
  3. per candidate: EXPLICIT reachability check, then a fingerprint (normalized patch hash + subject +
     file set) and a LINK attempt against each of our commits.
  4. `anchored` = at least one LINKED candidate (never attribution alone). `strength` = `exact` if every
     one of our commits has a patch-exact landing, else `adapted`.
- Alerts: FIXED positional token `commit-anchor` + a `kind` key spread LAST; details carry only shas and
  counts, never raw vendor prose.

### Deliberately NOT in this wave

- **No wiring into `merge-promote` / the poll.** It gates nothing; `verifyMerge` is untouched. Changing the
  trust input is its own wave.
- **No `EVIDENCE_FIELDS` change.** Nothing is written to the queue.
- GAP-2 closed-unmerged disposal — but this detector is its stated prerequisite.

### Named residuals

- **Re-authored landings are invisible.** If a maintainer lands our work under THEIR authorship, the
  attribution link is gone and we report not-anchored. Detecting that would need patch-identity over a
  broad unfiltered scan (expensive) or a maintainer-declared link. Stated, not built.
- Patch normalization approximates `git patch-id`; it is not byte-equal to it.
- The `since` bound uses `pr.created_at`: work cannot land before it was written.

## Test plan (TDD-first)

- PATH A: `ahead_by:0` -> anchored/exact/head-contained, and only ONE gh call is spent.
- PATH B happy: head diverged, one attributed+reachable candidate -> anchored.
- **The real-case fixture**: 2 our-commits, 2 landed, one patch-exact and one adapted -> `anchored:true`,
  `strength:'adapted'`, `landed[].patch_exact == [true,false]`. Locks the probe's actual finding.
- Not-anchored: head diverged, zero attributed candidates -> `anchored:false` (the honest negative).
- **Reachability is load-bearing**: an attributed candidate that is NOT reachable (`ahead_by>0`) is
  EXCLUDED — proves we never trust the list endpoint's default alone.
- Author-email vs login: the built args use the EMAIL form (regression-locks the probed mechanism).
- Truncation: a full candidate page -> `candidates-truncated`, observable, never silent absence.
- Read-only: built args pass the gate; a mutated write verb is REFUSED (non-vacuity — prove it can fail).
- TOTAL: throwing/garbage/non-array runner output, bad pr_number, bad repo -> classified, never throws.
- Normalization: hunk-header drift does NOT change the hash; a real content change DOES.

## Files

- `packages/lab/solve-queue/commit-anchor.js` — NEW.
- `tests/unit/lab/solve-queue/commit-anchor.test.js` — NEW.

## Pre-PR CodeRabbit — 4 findings, all folded

The pre-PR CLI was unavailable (transient `WebSocket closed`), so the async bot on the PR was the review
surface. It found 2 Majors, both real:

- **Major — reachability used the PR's BASE REF, not the repo's DEFAULT branch.** The plan claimed "reachable
  from the upstream default branch" while the code passed `.base.ref`. A PR targeting `release` could be
  reachable from `release` and absent from `main`, reporting a landing on a branch the trust argument never
  covered. -> FIXED: `.base.repo.default_branch` (already on the PR payload, so no extra call); fail-closed if
  absent. Regression test drives a base-aware compare double and asserts EVERY compare uses the default branch.
- **Major — a binary / patch-less file could produce a false `patch_exact`.** The API omits `patch` for binary
  and too-large files, so those hash an EMPTY body and two unrelated binary commits would agree. -> FIXED:
  fingerprints carry `comparable`, and exactness requires BOTH sides comparable (falls back to the weaker
  link, never `exact`). Also the `+++`/`---` prefix filter was eating real content: `-` plus `--count;`
  renders `---count;`. Probed that GitHub's `patch` starts at `@@` and carries no file headers at all, so the
  filter could only ever have dropped content. -> now a STRUCTURAL header match (`^(---|\+\+\+) [ab]/`).
- **Minor** — the documented result shape omitted `via` though PATH A returns it -> added above.
- **Minor** — this section was still a placeholder -> replaced by this record.

## Sign-off (post-fold)

- 15 tests (3 added for the folds); full lab + kernel suites exit 0; eslint / signpost / markdownlint clean.
- Live re-verified after the default-branch change (see the dogfood section).

## Live dogfood + the defect a CONTROL caught

The mock suite passed at 11/11 while the design still carried a false positive. The **control run** found it:

- **#2611 (the motivating case)** -> `anchored:true, strength:'adapted', landed:2` (one patch-exact, one
  adapted). Matches the hand-probe exactly. The PR-scoped check on the same PR reads `merged:false`.
- **#3305 (positive control, a 26-commit PR by a prolific author)** -> returned **`landed: 104`**, including
  `chore(release)` / `fix(release)` commits with no relation to the PR.

**The defect**: `anchored = at least one reachable attributed candidate` actually means *"this author has
committed to main since the PR opened"* - trivially true for any active committer. That is the MIRROR of the
false negative this wave set out to fix. Author attribution is not a link to OUR WORK.

**The fix**: a candidate must LINK to a specific commit of ours - `exact` (patch-identical after
normalization; sound, no shape matching) or `adapted` (same subject AND >=50% of our files also touched;
a shape-ASSISTED inference, so it is never reported as `exact` and never substitutes for patch-identity).
Anchoring on author+reachability alone was removed outright. Re-run: **#3305 104 -> 2 landed**, #2611
unchanged. A regression test locks the control's finding.

## Findings worth carrying

- **PATH A only fires for merge-commit merges.** #3305 was squash/rebase-merged, so its head sha is not
  contained in main and it fell through to PATH B. Our own repo squash-merges, so PATH B is the common path,
  not the exception.
- **Cost is O(our_commits + candidates) gh calls** (a fingerprint + a compare each). Fine for an advisory
  CLI probe; it would need bounding before any cron use.
- Running the tool on a PR that is not ours is a category error (`our_commit_count` counts that PR's
  commits). It assumes the PR is ours.

## Sign-off

- commit-anchor 12 passed; full lab + kernel suites exit 0; eslint / signpost clean; 0 non-ASCII added.
- Live: #2611 anchored/adapted (the false negative caught); #3305 control corrected 104 -> 2.
- Wired to NOTHING. `verifyMerge` and `merge-promote` are untouched; this gates nothing this wave.
