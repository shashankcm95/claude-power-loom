---
lifecycle: persistent
topic: fork-emit, F-W1, kernel-egress, two-identity, cross-repo-pr
plan-of: the first wave of the fork-emit path (external-repo PR emission)
status: DRAFT — awaiting 3-lens VERIFY then TDD build
---

# F-W1 — thread two repo identities through `ghEmit` (no fork yet, SHADOW, byte-identical)

The first wave of the fork-emit path (scope + Rev-2/Rev-3 folds in
`packages/specs/research/2026-07-02-fork-emit-external-repo-scope.md`). This wave is a **pure plumbing
refactor + new guards** inside `packages/kernel/egress/`. It introduces the two-identity axis
(`upstreamRepo` vs `forkRepo`) but wires NO fork network calls — when `forkRepo` is absent (the F-W1
default), every one of the 11 `gh` call sites resolves to the SAME string it does today, so the
same-owner emit stays **byte-identical**. It ships SHADOW/emit-OFF like everything else.

## Why this wave first, alone

The 11-call-site `repo` split is the single highest-risk MECHANICAL change of the whole fork-emit path:
one stray site left on the wrong identity is a wrong-repo write. Doing it FIRST, ALONE, byte-identical,
and behind a golden-bytes regression test isolates that risk from the fork lifecycle (F-W2), the
cross-repo PR-open (F-W3), the token posture (F-W4), and the live dogfood (F-W5).

## Runtime probes (firsthand, 2026-07-02 — the plan is built against the ACTUAL code, not stale recon)

- **The 11 `gh` call sites are exactly where the scope doc said** (no drift since recon). `gh-emit.js`:
  `504` `api repos/${repo}` (default_branch) - READ; `510` `git/ref/heads/${base}` - READ; `515`
  `git/commits/${baseCommitSha}` - READ; `525` `git/trees/${baseTreeSha}?recursive=1` - READ; `550`
  `contents/${st.pathB}?ref=${baseCommitSha}` - READ; `591` `POST git/trees` - WRITE; `596` `POST
  git/commits` - WRITE; `606` `POST git/refs` - WRITE; `612` `pulls?head=${owner}:${branch}` - READ
  (dedup); `628` `POST pulls` - WRITE (the PR create); `633` `DELETE git/refs/heads/${branch}` - WRITE
  (rollback). Plus `owner = repo.split('/')[0]` at `601` (feeds the dedup head + is otherwise unused).
- **`validateEmitInputs` returns `{ repo, issueRef, stanzas }`** (`gh-emit.js:485`); `repo` == the
  approved/validated `draft.repo` == the UPSTREAM. Probe: read `gh-emit.js:443-485`.
- **The base tree/commit references are the UPSTREAM's** (`base_tree: baseTreeSha` at `588`, `parents:
  [baseCommitSha]` at `595`). A fork shares the upstream's git objects (GitHub fork-object-sharing), so
  a commit on the fork with an upstream-base parent works — but that is an F-W2/F-W3 concern; F-W1 keeps
  writes on `repo` (== upstream == same-owner), so the cross-object path is NOT exercised here.
- **`forkRepo` must be a CUSTODY value, never from `data`.** `emitPR(data, opts)` (`emit-pr.js:418`)
  builds `draft.repo = normalizeRepo(data.repo)` from UNTRUSTED data; `opts` is trusted custody. The bot
  account is operator-configured => `forkRepo` flows via `opts`/args, and MUST join `DISPOSITION_KEYS`
  (`emit-pr.js:180`, a case-folded set at `:203`) so the actor can never inject it via `data`.
- **`emissionAxiom` = `{repo, issueRef, diff}`** (`approval.js:53`); `baseCommitSha` is deliberately NOT
  bound (the documented integrity-not-provenance residual, `gh-emit.js:41-45`). `approvalSigBasis`
  (`approval.js:88`) is what the broker signs.

## Scope boundary (what is IN F-W1 vs deferred)

**IN F-W1:**

1. The identity SPLIT in `gh-emit.js`: `upstreamRepo` (reads + dedup endpoint + PR base) vs `forkRepo`
   (tree/commit/ref writes + rollback DELETE) vs `forkOwner` (dedup head + — later — PR head). When
   `forkRepo` is absent, `resolvedForkRepo = upstreamRepo` and `forkOwner = upstreamOwner` => byte-identical.
2. The **structural helpers** `upstreamApi(suffix)` / `forkApi(suffix)` (build the `repos/${id}/...` argv)
   so "which identity" is a grep-auditable helper choice, not prose discipline across 11 sites (arch M1).
3. The **post-create backstop** (C1 defense-in-depth half): after the PR create, assert
   `pr.base.repo.full_name === upstreamRepo`; on mismatch, `emitEgressAlert('pr-base-not-upstream')` AND
   attempt a best-effort close, then throw. (Same-owner: base.repo === upstream trivially; a synthesized
   mismatch fires it.)
4. The **fork-derivation guard** (structural, dormant until a `forkRepo` is passed): if `forkRepo` is
   provided, assert `forkName === upstreamName` (a fork must share the repo NAME) BEFORE any write; alert
   `fork-identity-mismatch` + throw on mismatch. (The `forkOwner === CUSTODY_BOT` half needs the bot
   account, an F-W4 custody value — accept an optional `expectedForkOwner` and assert it only when
   provided; both absent in F-W1.)
5. The **dedup hardening** (HIGH fold): a DISTINCT `forkOwner` var (not `repo.split('/')[0]`); the GET on
   `repos/${upstreamRepo}/pulls?head=${forkOwner}:${branch}`; the `.find` predicate ALSO requires
   `p.base && p.base.repo && p.base.repo.full_name === upstreamRepo` before returning a deduped PR; and
   extend the ref-exists fail-closed to require the fork branch tip `=== commit.sha` we just created.
6. The **rollback DELETE targets the FORK** (`forkApi`) — the ref was created on the fork (H3).
7. `forkRepo` + casing/underscore/hyphen variants (`fork_repo`, `fork-repo`) + `forkOwner`/`fork_owner` +
   `upstreamRepo`/`upstream_repo` into `DISPOSITION_KEYS` NOW (C2-immediate).
8. The **golden-bytes regression** (HIGH): assert the EXACT `gh` argv + JSON request bodies for a no-fork
   emit are byte-identical pre/post-split (the existing suite was written against the single-`repo` shape
   and would NOT catch a stray `forkRepo` in `prBodyJson` or a re-routed `owner`).

**DEFERRED (named, not silently dropped):**

- `POST /forks` + the fork lifecycle + `maintainer_can_modify` const + BD-2 no-`.github/workflows/**`
  assertion -> **F-W2/F-W3** (the fork + PR-open waves; those add the actual fork writes + the cross-repo
  head, where the full C1 pre-network bind and BD-2 land).
- SIGNING the fork head-repo into `emissionAxiom`/`approvalSigBasis` -> **F-W3** (only load-bearing once
  the fork is steerable; the DISPOSITION_KEYS half is the F-W1-immediate part of C2).
- The token posture / throwaway bot account + the arm-time scope self-check -> **F-W4**.
- The operator live-probe (classic-PAT cross-repo-PR HARDEN) -> before F-W4.

## The 11-call-site identity assignment table (build against this exactly)

| # | line | call | R/W | identity |
|---|---|---|---|---|
| 1 | 504 | `api repos/${id}` default_branch | R | **upstream** |
| 2 | 510 | `git/ref/heads/${base}` | R | **upstream** |
| 3 | 515 | `git/commits/${baseCommitSha}` | R | **upstream** |
| 4 | 525 | `git/trees/${baseTreeSha}?recursive=1` | R | **upstream** |
| 5 | 550 | `contents/${path}?ref=${baseCommitSha}` | R | **upstream** |
| 6 | 591 | `POST git/trees` | W | **fork** |
| 7 | 596 | `POST git/commits` | W | **fork** |
| 8 | 606 | `POST git/refs` | W | **fork** |
| 9 | 612 | `pulls?head=${forkOwner}:${branch}` (dedup) | R | endpoint=**upstream**, head=**forkOwner** |
| 10 | 628 | `POST pulls` (PR create) | W | endpoint=**upstream**; head stays `branch` in F-W1 (F-W3 switches to `forkOwner:branch`) |
| 11 | 633 | `DELETE git/refs/heads/${branch}` (rollback) | W | **fork** |

F-W1 keeps site 10's head as the bare `branch` (same-owner PR); F-W3 flips it to `${forkOwner}:${branch}`
once the fork exists. All fork-side sites (6,7,8,11) resolve to `upstreamRepo` in F-W1 (forkRepo absent).

## THE ONE OPEN SCOPE DECISION — RESOLVED by the architect VERIFY lens (2026-07-02)

**`baseCommitSha` into `emissionAxiom` — RULING: DEFER out of F-W1, and the Rev-2 board's mechanism was
DOUBLY WRONG (correct it, don't just defer it).**

The architect established a decisive fact from the code: `baseCommitSha` **does not exist at approval
time**. The human signs `{repo, issueRef, diff}` at approve-cli time; the base sha is resolved by a live
API call INSIDE `ghEmit` (`gh-emit.js:510-511`), temporally AFTER the signature is minted. So "bind
`baseCommitSha` into `emissionAxiom`" is incoherent — you cannot put a value into a signed preimage that
does not exist until after the signature. The board's INTENT (a moved upstream base must invalidate the
approval) is sound; the mechanism it named is not:

- **Wrong mechanism:** the base sha is emit-time freshness/provenance, not approval-time emission-content.
  The correct vehicle is `approvalSigBasis` (`approval.js:88`) + a `requestedBaseSha` threaded from
  `ghEmit`'s live resolution into `verifyApproval`, plus a base-sha line in the approve-CLI
  sign-what-you-see render. NEVER `emissionAxiom` (which is the emission-determining content set).
- **Wrong wave:** F-W1 is byte-identical-same-owner (`forkRepo` absent) and resolves the base from
  `upstreamRepo` exactly as today — it introduces ZERO new moved-base risk (the exact-applier already
  REFUSES a moved base at `gh-emit.js:359,364`). The moved-base hazard first exists in **F-W2**, when the
  write target becomes a fork whose default branch can lag upstream. So it lands as a NAMED, pre-committed
  fold in the F-W2 plan (with the `requestedBaseSha` thread + the approve-CLI render change + an explicit
  standing-approval-invalidation note + the approve-time-vs-emit-time base TOCTOU caveat the architect flagged).

Verdict grounds: KISS + blast-radius + SRP — binding a signed-basis change (which invalidates every
standing approval and rewrites the approve-CLI render) into the highest-blast-radius 11-site mechanical
refactor is a mistake, and F-W1 buys nothing by doing it now (no moved-base attack exists that today's
exact-applier does not already refuse). **This is settled; F-W1 does NOT touch `approval.js`.**

## TDD test list (write these FIRST, red against current impl, then build to green)

New file `tests/unit/kernel/egress/gh-emit-two-identity.test.js` (+ a `DISPOSITION_KEYS` case in the
existing emit-pr suite):

1. **Golden-bytes, no-fork happy path** — with `forkRepo` absent, capture every `gh` argv + every
   `--input` JSON body via an injected `runGh` mock for an ADD emit; assert them byte-identical to a frozen
   golden (the pre-split behavior). This is the F-W1 ACCEPTANCE GATE.
2. **Golden-bytes, no-fork MODIFY path** — same, for a modify emit (exercises the base-fetch reads).
3. **Fork-derivation guard fires** — pass `forkRepo` whose NAME != upstream name => `fork-identity-mismatch`
   alert + throw, ZERO network writes (assert the mock saw no POST).
4. **`expectedForkOwner` mismatch fires** — pass `forkRepo` + `expectedForkOwner` != forkOwner => throw pre-write.
5. **Post-create backstop fires** — mock the PR-create to return `base.repo.full_name != upstream` =>
   `pr-base-not-upstream` alert + a close attempt + throw. (Non-vacuity: prove it can fail.)
6. **Post-create backstop passes same-owner** — base.repo.full_name === upstream => no throw (happy path).
7. **Dedup predicate tightened** — the 422-already-exists path: a returned PR with the right head.ref but
   `base.repo.full_name != upstream` is NOT deduped (fails closed); one with matching base IS deduped.
8. **Dedup fork-tip assert** — ref-exists but the fork branch tip != our commit.sha => fail-closed.
9. **Rollback DELETE targets the fork** — with a (synthesized) distinct forkRepo, the DELETE argv uses the
   fork identity, not upstream.
10. **`DISPOSITION_KEYS` rejects `forkRepo` in data** — `emitPR({repo, issueRef, diff, forkRepo}, ...)` =>
    the policy-key reject (+ `fork_repo`, `fork-repo`, `FORKREPO` casing variants).
11. **Structural helper non-vacuity** — `upstreamApi`/`forkApi` produce the exact `repos/${id}/${suffix}` argv.

## HETS Spawn Plan

kernel/egress/security diff => the FULL 3-lens tier is REQUIRED at VALIDATE (Rule 2): `code-reviewer`
(correctness) + `hacker` (adversarial-security, re-probing the BUILT code per Rule 2a) + `honesty-auditor`
(claim-vs-evidence). PRE-BUILD: a 3-lens VERIFY on THIS plan (architect + code-reviewer + hacker) —
architect adjudicates the open scope decision above; the design itself is already Rev-2 3-lens-VERIFIED.

Routing: substrate kernel-egress security work, non-trivial, high blast-radius => `route`.

## Runtime Probes (claims this plan makes about substrate/harness state)

- Probe: the 11 call sites + `owner` at 601 -> observed above (firsthand read of gh-emit.js, 2026-07-02).
- Probe: `DISPOSITION_KEYS` is a case-folded set -> `emit-pr.js:203` `.map(k => k.toLowerCase())` (firsthand).
- Probe: `emissionAxiom` excludes baseCommitSha -> `approval.js:53-60` (firsthand).
- Claim (DEFERRED, doc-sourced, NOT probed here): classic `public_repo` PAT can open the cross-repo PR
  (Rev 3 DOC-CONFIRMED; the live HARDEN probe is operator-gated, before F-W4 — not exercised by F-W1).

## Drift Notes

- The scope doc's C1 "pre-network bind before POST /forks and POST /pulls" is largely F-W2/F-W3 material
  (F-W1 has no fork write and no cross-repo head yet). F-W1 lands the SPLIT + the post-create backstop +
  the structural fork-derivation guard, which make it impossible to add the fork later WITHOUT routing
  through the identity split. Flagging so the architect confirms the boundary is honest, not a silent drop.

## Pre-Approval Verification (3-lens VERIFY board, 2026-07-02)

**Board: architect + code-reviewer + hacker (all read-only, parallel).** UNANIMOUS: the two-identity axis
is the right architecture, the 11-site table is correct row-by-row, the wave-order holds. Each returned
NEEDS-REVISION on the F-W1 INVARIANTS (not the design). All folds below are AUTHORITATIVE build directives;
they SUPERSEDE any contradicting body prose above. The design was already Rev-2 3-lens-VERIFIED; this board
verified the F-W1 boundary + the concrete change-list.

**CONVERGENT — all THREE lenses (code-reviewer HIGH-1 + architect F-3 + hacker H-3) — the #1 fold:**
- **The `forkRepo` threading channel is EXPLICIT NAMED PARAMS, never the `draft`.** Thread
  `forkRepo` / `expectedForkOwner` as NEW top-level args on `ghEmit({draft, approvalHash, env, forkRepo,
  expectedForkOwner})` and `armedEmit(...)`, sourced from `emitPR`'s custody `opts` position ONLY. They
  MUST NOT enter the frozen `draft` (`emit-pr.js:459`): `emissionAxiom` (`approval.js:53-60`) ignores keys
  beyond `{repo,issueRef,diff}`, so a `forkRepo` in `draft` would be an UNSIGNED, co-forgeable steering
  field — the exact #273/C2 integrity-not-provenance trap (`computeEmissionHash` is EXPORTED). Add a
  fail-closed test asserting `ghEmit` IGNORES `draft.forkRepo` if ever present (it reads only the named arg).
  This is the F-W1-immediate half of C2; the `DISPOSITION_KEYS` entry alone does not close it.

**CRITICAL (hacker) — reshape the F-W1 guards:**
- **C-1 — `forkOwner` MUST pass `OWNER_RE` at the `gh-emit.js` sink.** Today `owner` is derived from an
  already-`assertSafeRepoRef`-validated `draft.repo`; a DISTINCT `forkOwner` var breaks that chain.
  `gh-emit.js` imports no `OWNER_RE` — a malformed `forkOwner` interpolates raw into
  `pulls?head=${forkOwner}:${branch}` (param-injection, reopening the M1 surface the code closed for
  contents). FIX: export `OWNER_RE` from `emit-pr.js`, import it into `gh-emit.js`, and re-validate
  `forkOwner` (fail-closed + `emitEgressAlert('fork-owner-unsafe')`) BEFORE the dedup GET. Land in F-W1
  even though `forkOwner === upstreamOwner` in the no-fork case (the guard must exist before F-W3 populates it).
- **C-2 — the dedup predicate is case-normalized on BOTH sides + exact-set, not subset.** `upstreamRepo` is
  normalized (lowercased); GitHub `full_name` is canonical-cased (`Schmug/Colophon`). A raw
  `p.base.repo.full_name === upstreamRepo` fails-closed on every legit dedup where upstream has uppercase
  (bricks retry) — AND a subset match is superset-tolerant. FIX: compare
  `String(p.base.repo.full_name).toLowerCase() === upstreamRepo` AND additionally require
  `p.base.ref === base` (the resolved default branch) AND the existing `p.head.ref === branch` AND
  `p.draft === true`. All four must hold (exact-set).

**HIGH:**
- **H-1 (hacker) — land the pre-network STRUCTURAL bind in F-W1, defer only the network call.** The
  post-create backstop is detect-after-emit (the C1 the board closed); shipping it as F-W1's only defense
  risks F-W3 forgetting the pre-network bind. FIX: the `POST /pulls` endpoint MUST be built via
  `upstreamApi('pulls')` where `upstreamApi` is derived from the validated `upstreamRepo` (==
  `normalizeRepo(draft.repo)`) as a kernel value — never from `forkRepo`. Add a REGRESSION test that FAILS
  if the PR-create argv endpoint is routed off anything other than `upstreamRepo`, even when a distinct
  `forkRepo` is supplied.
- **H-2 (hacker) — the close backstop is best-effort-MAY-FAIL + must be observable.** The wrong-repo PR is
  on a repo we do not own; the `PATCH .../pulls/{n}` close 403s and is swallowed. FIX: on the swallowed
  close error emit a DISTINCT `emitEgressAlert('pr-close-attempt-failed')` (in ADDITION to
  `pr-base-not-upstream`), and label the close in-code as "best-effort, may 403 on an unowned repo — this
  does NOT reverse the exfiltration; the real prevention is the pre-network bind (H-1)."
- **HIGH-2 (code-reviewer) — golden-bytes must be a PRE-refactor literal + exact-string equality.** Capture
  the golden argv + JSON bodies from `git show main:` / a pre-split run and hard-code them as frozen
  literals; assert `assert.strictEqual(call.input, '<exact JSON string>')` on the tree/commit/PR bodies (a
  `JSON.parse`+deepEqual is key-order-blind and would absorb a key-reorder regression). The golden must NOT
  be regenerated from the refactored code.
- **HIGH-3 (code-reviewer) — the two EXISTING dedup tests will break under the tightened predicate.**
  `tests/unit/kernel/egress/gh-emit.test.js` HIGH-1 (~:533) and the LOW-fold (~:550) use `makeGh()`'s
  default `existingPulls` (no `base` field) — they regress under C-2. FIX: update `makeGh`'s default
  `existingPulls` + the `POST /pulls` response literal to carry `base: {ref: <base>, repo: {full_name:
  <repo>}}`, and give per-test overrides for the mismatch cases (tests 5, 7). Touch the SHARED default, not
  only individual test bodies.

**ARCHITECT (design folds):**
- **F-5 — use `forkRepo === undefined ? upstreamRepo : forkRepo`, NOT `forkRepo || upstreamRepo`.** An
  empty-string `forkRepo` from a custody mis-wire must fail loud, not silently resolve to upstream. (Same
  for `expectedForkOwner`.)
- **F-2 — label the post-create backstop NON-LOAD-BEARING in F-W1** (scaffolding placed early so F-W3
  inherits it; vacuous in same-owner until a cross-repo head exists). Do not let a reader mistake a
  same-owner-vacuous check for real F-W1 protection.
- **F-8 — the golden-bytes test also asserts the RETURN `base_sha` is unchanged** (== the upstream base
  sha); it feeds the kernel join-key (`emit-pr.js:497-499`) and an argv-only golden misses a return regression.
- **F-9 — register `fork-owner-unsafe` / `fork-identity-mismatch` / `pr-base-not-upstream` /
  `pr-close-attempt-failed` in `./alert.js`'s known-reason set** (if it enumerates) so a fired alert is
  itself observable, not an "unknown reason".
- **F-7 (forward-contract note) — the `baseTreeSha`/`baseCommitSha` (both upstream-resolved) are consumed
  by fork-side writes in F-W2; the fork-object-sharing assumption (a commit on the fork with an upstream
  base parent) is DOC-sourced + UNPROBED (scope doc unprobed-claim 6). F-W2's #1 live probe. Noted here so
  the seam the split creates is explicit at the F-W1 boundary.

**MEDIUM:**
- **M-1 (hacker) — `DISPOSITION_KEYS` full enumeration.** Add: `forkRepo`, `fork_repo`, `fork-repo`,
  `forkOwner`, `fork_owner`, `upstreamRepo`, `upstream_repo`, `expectedForkOwner`, `expected_fork_owner`,
  `forkName`, `headRepo`, `head_repo`, `baseRepo`, `base_repo`, `sourceRepo`, `source_repo` — every
  fork/identity field name any guard reads (the set is case-folded at `emit-pr.js:204`, so casing variants
  collapse; underscore/hyphen forms are DISTINCT and must be listed).
- **M-2 (hacker) — the fork-derivation guard needs a present-target precondition.** `forkName ===
  upstreamName` passes vacuously on `undefined === undefined`. FIX: require `typeof upstreamName ===
  'string' && upstreamName.length > 0` before the equality, so a nameless fork fails closed. Test the
  both-undefined case, not only the mismatch.
- **MED-1 (code-reviewer) — kill the dead `owner` var.** The old `const owner = repo.split('/')[0]`
  (`gh-emit.js:601`) is replaced by `forkOwner` — delete it, don't leave parallel dead code.
- **MED-3 (code-reviewer) — test 9 needs `failPulls: true`** to reach the rollback branch (a distinct
  `forkRepo` alone won't fire the DELETE); reuse the existing `failPulls` mock lever.

**TEST-LIST ADDITIONS (fold into the TDD list above):**
- Test 12 — `ghEmit` IGNORES `draft.forkRepo` if present (reads only the named arg) — the C2 co-forge guard.
- Test 13 — PR-create endpoint regression: with a distinct `forkRepo`, `POST pulls` argv endpoint is still
  `repos/${upstreamRepo}/pulls` (H-1 structural bind).
- Test 14 — `forkOwner` failing `OWNER_RE` => `fork-owner-unsafe` alert + throw, zero writes (C-1).
- Test 15 — dedup predicate: a PR with matching head.ref + draft but `base.ref != base` is NOT deduped (C-2).
- Test 16 — PR-create `head` stays the bare `branch` even when `forkRepo` supplied (F-W1/F-W3 boundary lock).
- Test 17 — MODIFY diff + distinct `forkRepo`: base-tree/contents reads still hit `repos/${upstreamRepo}`
  (code-reviewer LOW-1 — the highest-risk stray-identity combination).
- Test 18 — the both-`undefined`-name derivation guard fails closed (M-2 non-vacuity).
- Update the two existing `gh-emit.test.js` dedup tests + `makeGh` defaults for `base.{ref,repo.full_name}`.

**Disposition:** DESIGN-READY (architect) + NEEDS-REVISION-folded (code-reviewer + hacker) => the folds
above are the revision. None re-architect; they tighten the exact invariants the split introduces and stop
F-W1 from shipping guards that all pass vacuously in the only mode F-W1 runs. Build against this section.

## VALIDATE result (post-build 3-lens board, 2026-07-02)

Built by a delegated `node-backend` builder (TDD: tests-first -> red -> impl -> green). The BUILT diff got the
full 3-lens VALIDATE (Rule 2 for kernel/egress/security; Rule 2a — the hacker re-probed the BUILT code with 8
LIVE node probes, not the plan):

- **code-reviewer: SHIP** — 0 CRITICAL/HIGH/MED, 5 LOW (all confirmations). Independently diffed vs origin/main:
  byte-identity confirmed for the no-fork path; every fold verified in the diff; each guard's alert fires to stderr.
- **hacker: SAFE-TO-SHIP** — 8 live probes (co-forge draft.forkRepo, forkOwner injection, 11 dedup-laundering
  shapes, prototype-pollution, vacuity, adversarial default_branch) ALL held against the BUILT modules. It
  RESOLVED the honesty F-1 concern by dereferencing the GitHub `rest-api-description` OpenAPI: `Repository.required`
  includes `full_name` (non-nullable) + `pull-request.base.required` includes `repo` => a conformant 201 always
  carries `base.repo.full_name`, so the backstop cannot fail-close a legit same-owner emit. One LOW (see deferred).
- **honesty-auditor: CLAIMS-NEED-CORRECTION (grade B)** — 13/16 folds fully CONFIRMED, 0 silent drops, deferrals
  honest. Two over-claims corrected below (F-1, F-2).

**Folds applied post-VALIDATE (this diff):**
- **F-1 (honesty HIGH, hacker-refined) — the backstop now FAILS SAFE on an absent field.** Present-and-mismatched
  `base.repo.full_name` still fail-closes (alert + best-effort close + throw); an ABSENT/malformed field now emits
  `pr-base-unverifiable` and PROCEEDS (H-1's pre-network structural bind is the real guarantee, so a response-shape
  surprise must not regress the working same-owner emit). Since the hacker proved the field is schema-guaranteed,
  this is purely defensive — a no-op on conformant responses. New test 6b proves the fail-safe path (no throw, alert
  observable, no close attempt).
- **F-2 (honesty MED) — checked-in non-vacuity negative control.** New test 1b re-serializes a golden body with
  swapped key order and asserts it != the golden, DEMONSTRATING (not just asserting) that the exact-string golden
  assertion catches a key-reorder regression. (Golden provenance is genuine: the literals were captured from
  origin/main BEFORE the build and handed to the builder.)

**Deferred (named, not dropped):**
- **hacker LOW — no length cap on owner/name/branch.** A 500-char owner passes `NORMALIZED_REPO_RE`/`OWNER_RE`
  (fail-late, ReDoS-free, 404s at the network). Non-exploitable in F-W1 (forkRepo always undefined -> resolves to
  the already-`assertSafeRepoRef`'d upstreamRepo; the same gap already ships on upstreamRepo). Land a consistent
  length bound across `validateForkIdentity` + `assertSafeRepoRef` before F-W3 gives forkRepo a live cross-repo head.
- F-9 (alert reason registry) is N/A — `alert.js` does not enumerate reasons (free-string tokens; every reject is
  observable). The fork-branch-TIP assert + `baseCommitSha`->`approvalSigBasis` remain F-W2 (per the open-decision ruling).

**Gate:** 138 egress tests green (gh-emit-two-identity 20 + gh-emit 57 + emit-pr 61) + the full kernel suite (115
files, 0 failed); eslint clean, zero eslint-disable; signpost up-to-date; release-surface clean. Same-owner emit
byte-identical to origin/main (golden-bytes exact-string, non-vacuity demonstrated). **DISPOSITION: SHIP** (SHADOW,
emit-OFF, byte-identical — forkRepo never populated in F-W1).

## CodeRabbit review folds (post-PR, 2026-07-02)

The async CodeRabbit bot (hit a spending-cap wall; a re-nudge past the window produced a real review) posted 3
actionable + 1 nitpick on PR #488. Each was premise-probed firsthand before folding:

- **Major (Security) — DISPOSITION_KEYS incomplete hyphen spellings [FOLDED].** The set had `fork-repo` but only
  underscore forms for the other identity fields, contradicting the comment. Completed every identity field to all
  three spellings (camelCase / snake_case / kebab-case) + corrected the comment. (Non-exploitable in F-W1 — the
  hacker VALIDATE confirmed these are never read from `data` this wave — but the deny-list must be complete before
  F-W2/F-W3 reads forkRepo, and the comment was false.)
- **Major (Data Integrity) — dedup not bound to the fork head repo [FOLDED, partial].** The dedup `.find` bound
  `base.repo.full_name` but not `head.repo.full_name === resolvedForkRepo`; a reconcile could return a PR whose head
  is an upstream branch coincidentally sharing the loom branch name. Added the head-repo binding (re-asserted, not
  trusted solely from the `?head=` query filter) + mock updates + two non-vacuity tests (15b non-draft, 15c wrong
  head-repo). **Skipped** the suggested post-create backstop head-check with reason: the backstop verifies a PR *we*
  created with a `head` *we* set in the request (not an untrusted value there); the meaningful risk is the dedup
  reconcile-to-a-pre-existing-PR, now closed.
- **Minor — no non-draft dedup negative control [FOLDED].** Added test 15b (a `draft:false` PR sharing the branch is
  not deduped).
- **Nitpick (Trivial) — extract a shared two-identity mock helper [SKIPPED, reason].** Kept the inline mocks: the diff
  stays minimal on a security-sensitive test file, and the three inline mocks are self-contained and clear.

Post-fold gate: 140 egress tests (two-identity 22 + gh-emit 57 + emit-pr 61) + full kernel suite (115 files) green;
eslint clean, zero eslint-disable. Same-owner emit still byte-identical (golden test unchanged, passing).
