---
lifecycle: persistent
topic: fork-emit, external-repo, kernel-egress, cross-repo-pr, token-blast-radius, classic-pat
status: SCOPED (pre-build, ratify-before-build)
---

# Fork-based external-repo emit path — SCOPE (2026-07-02)

## Why

Track-A (the live issue->PR beta) produced its first verified-correct draft (`schmug/colophon#27`,
hand-verified: suite green + byte-identical OSAI constraint), but **the egress cannot emit it.** The current
`ghEmit` (`packages/kernel/egress/gh-emit.js`) writes the branch + PR **directly on the target repo**
(`POST repos/${repo}/git/{trees,commits,refs}` + a same-repo `pulls`), which needs **write access to the
target**. There is **no `fork` anywhere in `kernel/egress`**. So the current egress is a **same-owner** emit
(spec-kitty#2137 was a repo the token controls); the external-maintainer north-star (a PR to a repo we do NOT
own) is unbuilt. This scopes that path. Recon workflow `wf_18e9fa79-030` (egress-delta + GitHub-API + security).

## THE DECISION-CRITICAL FINDING (read first)

**A fine-grained PAT CANNOT open a cross-repo PR to an upstream you do not own.** Confirmed GitHub limitation
(not a permissions misconfig): fine-grained PATs are scoped to a single resource owner and get **read-only**
access to unowned public repos; `POST /repos/{unowned-upstream}/pulls` returns `403 Resource not accessible by
personal access token`, and adding "Pull requests: write" does not fix it. Only a **classic PAT** (`public_repo`
scope) can open a PR against a repo you do not own. (Sources: docs.github.com permissions-required-for-fine-grained
-PATs + managing-your-PATs; community #106661, #131615; roadmap #600.)

**Consequence:** the current egress token is a fine-grained PAT (`Contents:write`, emitPR-only, selected repos).
The fork path needs a token that can open cross-repo PRs -> a **classic PAT (`public_repo`)** or a **GitHub App
installation token** -> a real **token-blast-radius widening** (write-all-our-repos vs one selected repo). This
is the load-bearing DECISION below, and it is as much a security-posture / deploy decision as a code change.

## The fork flow (API sequence, doc-sourced; live-probe before relying)

1. `POST /repos/{upstream}/forks` -> **async (202)**; fork lands as `{bot}/{name}`. Idempotent if it already exists.
2. Poll `GET /repos/{bot}/{name}/git/ref/heads/{default}` until 200 (fork objects are not ready at the 202).
3. **De-stale the fork:** `POST /repos/{bot}/{name}/merge-upstream {branch: default}` (fast-forward), OR resolve
   base off **upstream's live SHA** and branch from that. **INVARIANT: base derives from UPSTREAM's current
   default tip, never a stale fork tip** (a stale fork -> a spurious "revert everything" diff).
4. Create tree/commit/ref on the **fork** (`POST /repos/{bot}/{name}/git/{trees,commits,refs}`; Contents:write on the fork).
5. `POST /repos/{upstream}/pulls {head: "{bot}:{branch}", base: "{upstream-default}", draft: true, maintainer_can_modify: <const>}`
   -> **the cross-repo PR; needs PR:write on the UPSTREAM (the classic-PAT wall).**

## Design — the single-source-upstream invariant (the whole ballgame)

Today ONE `repo` variable serves all 11 gh call sites (reads AND writes), so head-repo == base-repo ==
approval-repo **provably cannot diverge**. A fork flow splits this into **two identities**:

- **UPSTREAM** = `normalizeRepo(draft.repo)` = the approval-bound target. **Everything trust-bearing stays keyed
  off this:** base ref/commit/tree/contents fetch, the PR `base`, the dedup query's upstream endpoint, the
  join-key `repo`, the etiquette/cap key, and `computeEmissionHash`. **NEVER the fork.**
- **FORK** = `{bot}/{name}` in our namespace = **the write target + the PR `head` namespace ONLY**. Plumbing,
  invisible to approval semantics.

**The approval stays bound to UPSTREAM, unchanged** (`emissionAxiom` hashes `{repo,issueRef,diff}` with
repo=upstream; `approval.js:53-60,68`). A `forkRepo` write-routing field, if added to the draft, MUST NOT enter
the emission hash (else every fork-name change needs re-signing) — and a human approving "issue #N in owner/repo"
must be approving the UPSTREAM identity. The fork is derived **deterministically** (`fork_owner` = the fixed
custody-owned bot account; `name` = the upstream name), **custody-resolved never actor-supplied** (mirror the
`DISPOSITION_KEYS` deny-by-default discipline; `emit-pr.js:180-217`).

## Security surface + required mitigations (build directives)

- **CRITICAL — cross-repo approval re-use (IDOR on the repo axis).** The approval pins bytes-for-a-specific-upstream;
  splitting head-repo out of the signed basis means the receiving repo becomes an unsigned field (#273 "never
  trust a field the signature does not cover", now on the repo-identity axis). **MIT:** base-resolution + PR-base +
  dedup + join-key + etiquette ALL read `normalizeRepo(draft.repo)`; derive the fork deterministically from
  upstream + the fixed bot account; **after PR creation, re-assert `pr.base.repo.full_name === upstream` and
  REFUSE + `emitEgressAlert` on any mismatch.**
- **CRITICAL — token blast radius.** A fork-capable token widens to write-all-our-repos. **MIT (the token
  posture decision below):** a **dedicated throwaway fork-bot account** (blast radius = a disposable account, not
  our main org) or a **per-emit GitHub App installation token** minted by the cross-uid broker (scoped to the one
  fork + upstream PR:write, short-lived). Never reuse the upstream-write credential for fork-create. A NON-VACUOUS
  arm-time token-scope self-check (broker refuses to arm if the resolved token is broader than fork+PR).
- **HIGH — stale fork -> wrong base.** Base MUST be fetched from UPSTREAM at emit time and bound into
  `baseCommitSha`; never the fork's default branch (a lagging fork silently rebuilds the post-image against a
  stale tree the approver never saw). Fold `baseCommitSha` into the approval basis (a standing residual at
  `gh-emit.js:393-397`) so a moved upstream base invalidates the approval — more urgent in the fork flow.
- **HIGH — fork-state poisoning (pre-seeded branch in our own fork).** The branch name `loom/issue-N-<hash12>`
  is publicly computable; a fork we control is more exposed than the upstream. **MIT:** extend the
  ref-exists-no-open-PR fail-closed (`gh-emit.js:617-622`) to verify the fork branch tip **=== the commit we just
  created from the approved tree**, else REFUSE; prefer an ephemeral fork per emit (no long-lived branch state).
- **MED — dedup/etiquette/join-key divergence.** Keep all keyed off upstream; fix the dedup `head` filter to
  `head=<fork_owner>:<branch>` AND additionally verify `pr.base.repo === upstream`.
- **MED — envelope injection via new cross-repo fields.** `head`/`base` repo strings + `maintainer_can_modify`
  must be **kernel-derived constants** (re-validated against `OWNER_RE`/`REPO_NAME_RE`), never actor bytes;
  `maintainer_can_modify` a HARD CONSTANT (mirror `draft:true`).

## What stays UNCHANGED (must survive byte-identically)

env-sanitization killswitch (`buildEmitEnv` from `{}` + allowlist, `emit-pr.js:82-102`); #273 body-verify /
verify-on-read; the signed approval binding `{repo,issueRef,diff}` + freshness basis; size caps; mode-preserve +
regular-files-only; the fail-closed base+hunk applier (keyed off the **upstream** base); egress-denied paths +
`SAFE_PATH`; `draft:true` hard constant + the kernel-constant envelope (zero actor bytes); one-PR-per-issue
etiquette + global cap (keyed off upstream); fail-closed-must-be-observable (`emitEgressAlert` on every reject).

## THE TOKEN POSTURE DECISION (load-bearing; USER/operator)

To open cross-repo PRs we need a token the current fine-grained PAT cannot be. Ranked safest-first
(**superseded in part by Rev 3 below — option 1 is REFUTED by the doc research; read Rev 3 first**):

1. ~~**GitHub App installation token, per-emit, broker-minted**~~ — **REFUTED (Rev 3).** An installation token
   *"cannot be granted access to repositories that the installation was not granted access to"*
   (docs — authenticating-as-a-github-app-installation). For an arbitrary UNOWNED upstream the maintainer controls
   installation, so the app is NOT installed there and the token cannot open the PR. Viable ONLY in the atypical
   case where the maintainer installs our app — not a general external-emit posture. **This kills the "durable
   posture to design toward" framing.**
2. **Dedicated throwaway fork-bot GitHub account** with a classic `public_repo` PAT — its ONLY assets are its
   forks, so a compromise writes the disposable bot's repos, not our main org. **Simplest to stand up; blast
   radius = the bot account.** **Now the ONLY viable well-bounded option** (per Rev 3) — the sole capable token
   type is the classic PAT, and it cannot be repo-scoped, so bounding WHOSE account it lives on is the only lever.
3. **A classic `public_repo` PAT on our main account** — writes EVERY public repo we own. **Rejected** (blast
   radius = our whole namespace; violates minimal-privilege).

**Recommendation (Rev 3):** stand up (2) — a dedicated throwaway fork-bot account with a classic `public_repo`
PAT. It is the only documented-capable, well-bounded posture; there is no App-token durable target to design
toward. The token stays the SOLE custody-injected `GH_TOKEN` behind the unchanged env-sanitization killswitch,
and the fork-create credential is SEPARATE from any upstream-write credential. Bound the residual classic-PAT
breadth with the approval-keyed fork-target allowlist (HIGH fold above) + the non-vacuous arm-time scope self-check.

## Proposed waves (each its own VERIFY -> TDD -> VALIDATE, kernel/egress = 3-lens)

- **F-W1 — thread two repo identities through `ghEmit` (no fork yet, SHADOW).** Split the single `repo` into
  `upstreamRepo` (reads/PR-base/approval/dedup/join-key) + an optional `forkRepo` (write target); when `forkRepo`
  is absent, behavior is **byte-identical** to today (same-owner). Add the `pr.base.repo === upstream` post-create
  re-assertion + the deterministic-fork-derivation guard. Pure refactor + new guards; the highest-risk mechanical
  change (11 call sites), so it goes first, alone, fully tested.
- **F-W2 — the fork lifecycle** (`POST /forks` + readiness poll + `merge-upstream` de-stale OR upstream-SHA base)
  as a hardened helper; the pre-seeded-branch tip-assertion; ephemeral-vs-reused fork decision.
- **F-W3 — the cross-repo PR-open** (`head={bot}:{branch}`, upstream `pulls`, `maintainer_can_modify` const) +
  the dedup `head` fix.
- **F-W4 — the token posture** (the bot account / App token) + the arm-time token-scope self-check + a
  deploy-gated fork-arming flag (asymmetric-parse, typo-fails-closed). Operator-run deploy; Claude host-verifies.
- **F-W5 — live dogfood** to `colophon#27` end-to-end through the fork path, human-approved at the gate.

## Runtime probes (before build)

- All 11 same-owner call sites: `gh-emit.js:504,510,515,525,550,591,596,606,612,628,633` (delta reader, firsthand).
- The approval binds `{repo,issueRef,diff}` upstream-only: `approval.js:53-60,68` (firsthand).
- **CLAIM to live-probe (doc-sourced, NOT firsthand):** the cross-repo `head=owner:branch` syntax + the
  fine-grained-PAT 403 wall — verify with a throwaway sandbox repo + a scoped token by the F-W3 implementer before
  relying on it (per the runtime-claim-probe discipline; the recon flagged this as external-doc-sourced).

## Open questions

**RATIFIED (USER, 2026-07-02):**
1. **Token posture = (2) dedicated throwaway fork-bot account** + classic `public_repo` PAT scoped to its forks
   (blast radius = the disposable bot account). **UPDATED (Rev 3): option (1) App-installation-token is REFUTED
   as a durable target** (an installation token cannot reach an upstream where the app is not installed) — (2) is
   the terminal posture, not a stepping stone. Bound its residual breadth via the approval-keyed fork-target allowlist.
2. **Fork lifecycle = EPHEMERAL per emit** (create/use/delete; no long-lived branch-poisoning state to defend).
5. **Sequence: fork-emit FIRST** (unblocks `colophon#27`, which is already hand-verified), verify-container right after.

**RESOLVED by the VERIFY board (2026-07-02):**
3. **`baseCommitSha` INTO the approval basis (`emissionAxiom`) — YES, now** (hacker H1 + architect H2 + honesty:
   the fork flow makes the moved-base residual load-bearing; a moved upstream base must invalidate the approval).
4. **Fork-create gets its own deploy-gated arming flag** (asymmetric-parse, typo-fails-closed), distinct from emit arming.

## Pre-Approval Verification (3-lens VERIFY board, 2026-07-02)

**Board: architect + hacker + honesty-auditor, all NEEDS-REVISION.** UNANIMOUS on the architecture (the two-identity
axis is right, the wave order is right, DESIGN-READY on the design), NEEDS-REVISION on the mitigations + plan
precision. All folds below are AUTHORITATIVE build directives; they supersede any contradicting body prose above.

**CRITICAL (reshape the security design):**
- **C1 — pre-network bind, not post-create detect (hacker C1 + honesty MED-2).** The body's "re-assert
  `pr.base.repo===upstream` AFTER PR creation and refuse" is DETECT-AFTER-EMIT — the wrong-repo PR already exists,
  loom-branded, on a stranger's repo; refuse cannot un-send it. FIX: derive the PR-open ENDPOINT repo + `base` from
  `normalizeRepo(draft.repo)` as a kernel constant, and assert `fork_owner === CUSTODY_BOT_ACCOUNT` +
  `fork_name === upstreamName` **BEFORE** `POST /forks` and **BEFORE** `POST /pulls` (mirror the existing pre-network
  `computeEmissionHash===approvalHash` gate at `gh-emit.js:439,499`). KEEP the post-create `pr.base.repo===upstream`
  check but LABEL it defense-in-depth backstop; on a post-create mismatch, alert-page AND attempt `PATCH .../pulls/{n}`
  close (cleanup, not prevention). Also assert the bot repo IS a fork of THIS upstream pre-write
  (`GET /repos/{bot}/{name}` -> `.fork===true && .source.full_name===upstream`) — hacker unprobed-claim 3.
- **C2 — SIGN the fork head-repo; do not merely derive it (hacker C2 — the #273 family).** "Deterministic derivation
  is safe without signing" is the exact integrity-≠-provenance trap: `computeEmissionHash` is EXPORTED/co-forgeable
  (`approval.js:20-25`), so a same-uid process can co-forge an approval + steer the fork head. FIX: fold the fork
  head-repo INTO the signed basis — add `head_repo` to `emissionAxiom` (invalidates the approval on any fork change),
  OR add it to `approvalSigBasis` (`approval.js:88-92`) so the BROKER signs it. AND add `forkRepo` (+ casing /
  `__proto__` variants) to `DISPOSITION_KEYS` (`emit-pr.js:180`) IMMEDIATELY (F-W1), so it can never arrive via
  untrusted `data` (it is NOT in the deny-set today).

**HIGH:**
- **The dedup/reconcile path (arch C1 + hacker H2 + honesty H2 — and a spec CONTRADICTION).** Dedup does NOT "stay
  unchanged" (remove it from the invariant list — the internal contradiction honesty flagged). FIX: a DISTINCT
  `forkOwner` var (not `repo.split('/')[0]`); query `repos/${upstreamRepo}/pulls?head=${forkOwner}:${branch}`; and the
  `.find` predicate (`gh-emit.js:614`) MUST additionally require `p.base.repo.full_name === upstreamRepo` before
  returning a deduped PR (else a poisoned open PR with the right head-branch laundering loom's envelope). Extend the
  ref-exists fail-closed (`:617-622`) to require the fork branch tip `=== commit.sha` we just created.
- **`baseCommitSha` into `emissionAxiom` now** (Q3 resolved YES above).
- **The rollback DELETE (`gh-emit.js:633`) targets the FORK** (arch H3), not upstream (else an orphan ref on the fork
  blocks the next dedup forever). F-W1 MUST include an explicit **11-call-site UPSTREAM/FORK assignment table**:
  reads 504/510/515/525/550 + dedup-endpoint 612 + PR-base 628 = UPSTREAM; writes 591/596/606 + rollback-DELETE 633 =
  FORK; the `pulls` POST 628 is the one cross-identity call (endpoint=upstream, head=fork).
- **F-W1 "byte-identical" is a TEST GATE, not a free property (honesty H1 + arch H1).** Reframe: "byte-identical on
  the SAME-OWNER happy path is the F-W1 ACCEPTANCE GATE." Ship a **golden-bytes regression**: assert the exact `gh`
  argv + JSON request bodies for a no-fork emit are byte-identical pre/post-split (the existing suite was written
  against the single-`repo` shape and would NOT catch a stray `forkRepo` in `prBodyJson` or a re-routed `owner`).
  Test the two NEW guards separately (they fire on a synthesized mismatch even in same-owner mode).
- **Token posture — state what the bot does NOT protect (honesty H3 + hacker M1).** The dedicated bot bounds WHOSE
  account, NOT what the actor steers: a classic `public_repo` PAT writes EVERY repo the bot forked (every past
  target), and RELOCATES (does not reduce) the classic-PAT breadth. Only option-1 (per-emit App token) bounds to the
  single in-flight upstream. FIX: (a) state this at option 2; (b) gate the fork TARGET to an allowlist keyed off the
  human approval (approved `owner/repo` -> fork ONLY that, never "any public repo the PAT can reach"); (c) a
  NON-VACUOUS arm-time token-scope self-check (plant a too-broad token, watch it refuse).

**MEDIUM:**
- **Structural enforcement (arch M1).** Fold the two identities behind narrow helpers `upstreamApi(suffix)` /
  `forkApi(suffix)` (build the `repos/${id}/...` argv) + a single `openCrossRepoPull({upstreamRepo, forkOwner, branch})`
  — the ONLY place both identities co-occur — so "which repo" is a grep-auditable helper choice, not prose discipline
  across 11 sites (restores the single-hiding-point the one-`repo` design had).
- **`maintainer_can_modify: true` (arch M2)** — explicit named kernel constant + one-line rationale (polite contribution
  default; ephemeral fork + DRAFT + human-gate bound the risk), documented beside `draft:true` (`gh-emit.js:625-627`).
- **Readiness-poll TOCTOU (hacker M2).** Bind on a handle not a name: pin the upstream-derived base SHA yourself,
  assert the post-write ref tip `=== commit.sha` before the PR-open.
- **Inline the doc-sourced markers (honesty MED-1)** at each design step that consumes `head=owner:branch`, not just
  the global caveat.

**LOW:** reserved alert reasons `fork-identity-mismatch` / `pr-base-not-upstream` / `fork-branch-tip-mismatch` (arch L2);
soften "the whole ballgame" (honesty L1); F-W2 probes for async-readiness-poll (404-then-200) + `merge-upstream` FF (arch L1).

**Unprobed claims (all need a live probe on a THROWAWAY sandbox repo + scoped token before relied on) — probe order by value.
NOTE (Rev 3): claims 1-3 are now DOC-CONFIRMED with verbatim GitHub citations (see Rev 3), but doc-say != verified —
the live probe still HARDENS them (per the runtime-claim-probe discipline; a documented capability can still fail in practice):**
1. **Classic `public_repo` PAT CAN open a cross-repo PR to an unowned upstream** — the load-bearing POSITIVE; if wrong,
   the whole fork path is moot. **Probe FIRST**, before F-W4. **Rev 3: DOC-CONFIRMED verbatim** (*"Only personal access
   tokens (classic) have write access for public repositories that are not owned by you"*) — probe hardens, does not discover.
2. Fine-grained-PAT wall (the negative) — **Rev 3: DOC-CONFIRMED as an explicitly enumerated limitation** (the exact HTTP
   status, 403 vs 404, is NOT documented for the create-PR endpoint — the "403" in the finding above is INFERENCE; probe it).
   3. Cross-repo `head={bot}:{branch}` accepted — **Rev 3: DOC-CONFIRMED** (with the "same fork network" requirement). 4. `POST /forks` async-202 +
   object lag + idempotency/response `full_name`. 5. `merge-upstream` fast-forward. 6. `POST repos/{fork}/git/commits
   {parents:[upstream-sha]}` succeeds on a fresh fork (fork-object-sharing, arch H2). 7. `gh api` 301-redirect-following
   (hacker unprobed-1). — F-W3/F-W2 implementer probes these; multi-reviewer blessing is NOT a live probe.

**Disposition:** design-ready; the plan needs Rev-2 folds (above) + the operator bot-account token + the F-W3 probes
before F-W1 build. None require re-architecting — the axis holds; the folds tighten the exact invariant the design names.

## Rev 3 — doc-grounded token-capability research (2026-07-02, general-purpose + WebFetch on docs.github.com)

The (b) "probe-first" doc half: pin the token matrix against official GitHub docs BEFORE any operator provisions a
live PAT. Every row is a verbatim doc citation. **Doc-say NARROWS, it does not HARDEN** (OQ-NS-6) — the live probe on
a throwaway sandbox still gates reliance (unprobed-claims 1-3 above). This Rev SUPERSEDES the token-posture ranking.

### Capability matrix (cross-repo PR to an unowned PUBLIC upstream)

| Token type | Verdict | Reason (doc-verbatim) | Cite |
|---|---|---|---|
| Fine-grained PAT | **CANNOT** | Enumerated gap: *"Using fine-grained personal access token to contribute to public repos where the user is not a member"*; scope is *"limited to a single user or organization"* | managing-your-personal-access-tokens |
| Classic `public_repo` PAT | **CAN** | *"Only personal access tokens (classic) have write access for public repositories that are not owned by you"* + `public_repo` = read/write code for public repos | managing-your-personal-access-tokens · scopes-for-oauth-apps |
| Classic `repo` PAT | CAN (over-privileged) | superset of `public_repo`; grants private too — NOT least-privilege | scopes-for-oauth-apps |
| GitHub App installation token | **CANNOT** (unless app installed on upstream) | *"The installation access token cannot be granted access to repositories that the installation was not granted access to"* | authenticating-as-a-github-app-installation |

**Bottom line:** the ONLY documented-capable token for this flow is a **classic PAT** (least-privilege `public_repo`),
and it is user-global — it CANNOT be repo-scoped like a fine-grained PAT. The blast-radius tension is structural, not
a config choice. -> posture (2), a throwaway bot account, is terminal (Rev-3 correction to the ranking above).

### New build directives surfaced by the research

- **BD-1 (mechanical, was under-specified):** cross-repo PRs require the head to be in the **same fork network** as the
  base — verbatim *"For cross-repository pull requests in the same network, namespace head with a user like this:
  username:branch"* + *"You cannot submit a pull request to one repository that requests a merge to a base of another
  repository."* The `POST /forks` step (F-W2) is therefore MANDATORY — you cannot push a branch to an unrelated bot
  repo and PR it into the upstream; the head repo must be a genuine fork of THIS upstream. (Reinforces C1's pre-write
  `.fork===true && .source.full_name===upstream` assertion.) Cite: rest/pulls/pulls.
- **BD-2 (security, folds into arch M2 `maintainer_can_modify`):** the docs warn that "Allow edits from maintainers"
  becomes "Allow edits **and access to secrets** by maintainers" when the fork carries GitHub Actions workflows, and
  *"can potentially reveal values of secrets and grant access to other branches."* DIRECTIVE: the ephemeral bot fork
  MUST carry NO workflow files (the actor diff touches only the issue's code; assert no `.github/workflows/**` in the
  emitted tree), AND `maintainer_can_modify` stays the named kernel constant. Given a workflow-free fork + DRAFT +
  human-gate, `maintainer_can_modify: true` (polite-contribution default) is acceptable — but the no-workflow assertion
  is the load-bearing guard, not the flag value. Cite: creating-a-pull-request-from-a-fork.
- **BD-3 (honesty, status-decay):** GitHub frames the FGPAT "contribute to public repos where you're not a member" gap
  as a **temporary/roadmap** limitation. It is TRUE as of this Rev, but it is exactly a decaying status claim — re-probe
  before long-term reliance, and do NOT architect on the assumption it stays (nor that it has already been lifted).
- **BD-4 (honesty, remove undocumented specificity):** the create-PR endpoint documents only 201/403/422 — NO 404. The
  exact status an off-scope FGPAT create-PR returns is NOT documented; the "403 wall" phrasing in the DECISION-CRITICAL
  FINDING is INFERENCE. The F-W3 probe must OBSERVE the actual status, not assert 403.

### Sources (fetched by the research agent)

rest/pulls/pulls · managing-your-personal-access-tokens · scopes-for-oauth-apps ·
authenticating-as-a-github-app-installation · rest/authentication/permissions-required-for-github-apps ·
creating-a-pull-request-from-a-fork (all docs.github.com).

### Residual = the operator-gated live probe (HARDENs; still open)

The doc research is the cheap first cut. What remains is the empirical HARDEN: a real classic `public_repo` PAT on a
throwaway sandbox account + a throwaway sandbox upstream + a real `POST /forks` -> push -> `POST /pulls` attempt, observing
the actual accept + the FGPAT-negative status. **Operator-gated** (Claude does not provision tokens / create accounts).
This is unprobed-claims 1-3; the F-W3 implementer runs it before F-W1 build is relied upon.
