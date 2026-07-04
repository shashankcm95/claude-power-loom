# Live-Dogfood Lifecycle Gaps — three rungs the world adds

Status: research (as-is findings from a real external dogfood; input for v-next planning).
Date: 2026-07-04.
Extends: `packages/specs/research/2026-06-25-autonomous-sde-lifecycle-gap.md` (the 6-rung internal gap-map).
Evidence: the `schmug/colophon#27` dogfood through the shipped `live-solve-one` CLI (SHADOW/dry) + the manual
PATH-1 submission attempt.

> **Why this doc exists.** The 6-rung lifecycle gap-map covers the *internal* mechanics: issue -> classify ->
> materialize -> contained solve -> grade -> capture -> emit -> observe-merge -> mint-lesson -> persona. It is
> mechanism-complete (SHADOW). But taking a real fix to a real stranger's repo surfaced **three rungs the map
> never had**, because they only exist at the *contact surface with the outside world* — and all three
> surfaced only from a live run, not from internal reasoning (the Rule-2a-corollary: the real path is where
> the gaps hide). Each blocks the north-star apex signal (an external maintainer's merge) for ordinary repos.

## The colophon dogfood, in one paragraph

The shipped `live-solve-one schmug/colophon#27 --materialize` ran end to end (SHADOW/dry, $0.39): classified
`python-backend`, materialized the persona, solved in the container, wrote a draft. The autonomous draft chose
the *more robust* gate (`_looks_like_osai_corpus`) but broke OSAI byte-identity (key reorder); the internal
judges *refused* (deployed-unconfigured) and so caught nothing. A human produced the correct fix (the union:
robust gate + byte-identity). Then the submission hit a wall: `schmug/colophon` restricts PR creation to
collaborators, so the fix — however correct — can never be merged there. Three gaps, in the order we hit them.

## Gap 7 — INTAKE: no PR-acceptance precheck (the cheapest, highest-leverage)

**What broke.** We ran a full classify -> solve -> fix -> verify -> submit cycle before discovering, at the
`CreatePullRequest` step, that the repo blocks external PRs. The apex trust signal (an external merge) was
*structurally unreachable from the first token*, and we spent the whole cycle to learn it.

**The core constraint (grounded 2026-07-04).** You cannot fully pre-check PR-acceptance via the API: a repo's
interaction limit / collaborators-only restriction is **admin-only** (`GET .../interaction-limits` -> 403 for
a non-admin). What IS readable pre-solve: `allow_forking`, `archived`/`disabled`, `visibility`, and — the
strongest discriminator — **whether the repo has ever merged an external-contributor PR** (colophon: zero, all
`OWNER`; spec-kitty, which merged our #2137: five external authors). So the precheck is necessarily a
*heuristic*, backed by a *fail-fast* at submit. Full design: `2026-07-04-intake-pr-acceptance-gate-design.md`.

**Coupling.** A terminal block at submit should hand off to Gap 9 (dispose the candidate) and, later, to the
deferred issue-dataset (switch to the next candidate rather than stall).

## Gap 8 — REVIEW LOOP: an external review has no path back to the persona

**What broke.** The colophon arc produced a rich external review (the substring-gate critique). It created
value *only because a human routed it by hand* into a fix revision. In the autonomous pipeline the review has
**no ingestion path** — mapped firsthand: the only post-emit signal ingested is the `merged` boolean
(`merge-observer.js`); nothing reads `/pulls/N/reviews` or `/pulls/N/comments`, no re-solve-on-feedback branch
exists, `emitPR` is create-only (no update/re-push), and the outcome enum is frozen to `['merged']` (it cannot
even represent a review verdict).

**Why it is on the critical path, not a nice-to-have.** Maintainers rarely merge first-shot; they request
changes. The review -> revise -> re-push loop is *how most PRs actually reach the apex merge*. Modeling only
the outcome (merge) and not the dialogue (review) leaves the pipeline unable to converge on the very signal it
exists to earn.

**Design sketch (deferred; not this wave).** A review-observer (fetch review state/comments) + a `reviewContext`
threaded through `runLiveDraftLoop` -> the persona materializer + an `emitPR` UPDATE path (push a commit to the
existing PR branch). **Security invariant:** reviewer prose is untrusted external text; it must pass the same
kernel-constant envelope / scrubbing the egress path already enforces before it can reach a re-solve prompt (the
`#273` / actor-injection discipline). The safe first landing spot for a review-derived signal is the
circuit-breaker denial-source registry (a `changes-requested` source halts, and halt-only NARROWS -> OQ-NS-6-safe).

## Gap 9 — DISPOSAL: "only merged is retained" is non-promotion, not disposal

**What we found (traced firsthand).** "Only merged is retained" is implemented as **non-promotion**: a pending
lesson is promoted to a world-anchored edge *on merge*, and an un-merged candidate simply never gets promoted.
There is **no active disposal**. Ephemeral working state (the Docker container, the throwaway clone) IS reaped
per run; durable residue is not — a never-merged draft persists as an inert `draft-*.json` + a cost-ledger line
indefinitely. (For colophon specifically the residue is minimal: emit was dry, so no PR / no join-key, and it
captured **no lesson at all** — `lesson_captured:false, ineligible`, the grade was unavailable.)

**The gap.** If the policy is *only merged is retained*, it needs an **explicit disposal / expiry**, not just
absence-of-promotion — else pending artifacts accumulate silently. And a **terminal blocker** (collaborators-only,
issue closed, license-incompatible) should trigger disposal *immediately*: this candidate can never merge, so it
should be disposed now, not left pending forever.

**Design sketch (deferred).** A terminal-block outcome (from Gap 7's fail-fast, or a closed issue) -> dispose the
candidate's durable artifacts + mark the pending lesson dead; a background expiry for pending lessons older than N
days that never reached a merge. Keep it observable (log the disposal + reason), never a silent delete.

## The cross-cutting insight

The 6-rung map is the machine talking to itself; these three rungs are the machine touching the world — *can we
submit here, can we iterate with the reviewer, what happens to what never lands.* They are invisible to internal
reasoning and to a mock suite; only a real external dogfood exposes them. That is the argument for continuing to
run real, SHADOW, human-gated dogfoods now: each one that hits a wall lets us re-scope from a real angle, so the
recorded workflows actually explain end-to-end before we scale the *speed* of solutions.

## Status / next

- All three are **unscheduled** as of 2026-07-04; recorded here + in `docs/PRD.md` §6 (the roadmap's new rungs).
- **Gap 7 (intake)** is the cheapest and is drafted now (`2026-07-04-intake-pr-acceptance-gate-design.md`).
- Gap 8 (review loop) and Gap 9 (disposal) are design-sketched here, deferred to their own waves.
