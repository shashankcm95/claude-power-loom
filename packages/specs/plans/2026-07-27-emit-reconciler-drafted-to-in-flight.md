# Plan — the emit reconciler (`drafted -> in_flight`)

lifecycle: ephemeral

## Goal

Close the pipeline's one structural discontinuity. **No code in `packages/` writes the
`drafted -> in_flight` edge** (probed below), so an unattended cron fills the queue to `drafted` and every
rung above EMIT sweeps zero rows forever. Build a TOTAL, SHADOW, **read-only** reconciler that OBSERVES the
operator's emitted PR and advances the entry to `in_flight` with the `pr_url`/`pr_number` that
`merge-promote.promoteOneInFlight` requires.

**Needs NO arming.** The operator still owns the emit; the agent only observes that it happened. Zero egress
imports, zero write verbs, `-X GET` only.

## Runtime Probes (firsthand-verified against the repo)

- **The gap is real**: `grep -rn "to_state: *'in_flight'" packages/` -> **ZERO writers**. Every `in_flight`
  reference is a READER (`solve-queue-poll.js:82`, `merge-promote.js:120` both `list({state:'in_flight'})`)
  or the enum (`solve-queue-fold.js:23,28-29`). The only producers are TESTS.
- **The kernel is decoupled**: `grep -rln "solve-queue" packages/kernel/` -> no hits. The armed emit never
  touches the queue, so opening a real PR cannot advance the entry.
- **A manual path exists**: `cli.js:49` `advance` + `buildEvidence` supports `--pr-url` / `--pr-number`. So
  today the seam is MANUAL-ONLY, not absent. The reconciler automates the OBSERVATION, not the emit.
- **The branch convention is exact**: `gh-emit.js:915`
  `` const branch = `loom/issue-${issueRef}-${approvalHash.slice(0, 12)}` `` and `:995` sets the PR head to
  `forkOwner:branch` in fork mode, bare `branch` otherwise. The GitHub list-PRs response reports `head.ref` as
  the bare branch in BOTH modes, so one regex matches fork and non-fork emits.
- **Read-only chokepoint to reuse**: `gh-verify.js:71 assertReadOnlyGhArgs` REQUIRES `args[0]==='api'` and an
  explicit `-X GET` (else `-f/-F` data fields auto-POST), refusing any other verb; `defaultRunner:91` calls it
  BEFORE spawn; `buildVerifyEnv:117` allowlist-filters the env. All four (`assertReadOnlyGhArgs`,
  `buildVerifyEnv`, `defaultRunner`, `isGhRepo`) are already exported and already imported cross-module by
  `review-observer.js:29` — reusing them adds NO new coupling.
- **Evidence is a CLOSED allowlist**: `solve-queue-fold.js:37 EVIDENCE_FIELDS` is frozen and
  `badEvidence:63` rejects `unknown-field:<k>`. => the reconciler can set ONLY `pr_url` + `pr_number`.
  **Correction to an earlier intent**: capturing `labels` / `mergeable_state` as evidence would require
  extending that shared frozen enum + the fold's validator. That is a schema change belonging to the
  hold-aware wave, NOT to this one. Out of scope here (see below).
- **The dam**: the kernel's authoritative join-key store is allowlisted to exactly ONE reader by full relative
  path (`join-key-shadow.test.js` `ALLOWED_READER = packages/lab/world-anchor/merge-observer.js`,
  non-vacuity-tested). => Route A (observe the world via `gh`), never a second dam reader.
- **CAS available**: `advance` accepts `expect_state` + `expect_rev` (#587). `foldEntry` returns `rev`.

## Design

### The module — `packages/lab/solve-queue/emit-reconcile.js`

`reconcileDraftedEntries({ queueDir?, queue?, runner?, timeoutMs?, maxBytes?, listFn? }) ->
{ ok, reconciled:[], skipped:[], errors:[] }`

- TOTAL (never throws), SHADOW / weight-0, mirrors `dispose-stale.js` + `merge-promote.js` conventions
  (summary object, fail-soft per entry, FIXED positional alert token + a `kind` detail key — never a variable
  positional arg, never a `reason` key in the detail: the `alert.js` positional-clobber lesson).
- **Group by repo, ONE list call per repo** (not per entry) so N drafted entries on one repo cost 1 gh call.
- Per repo: `gh api -X GET "repos/<repo>/pulls?state=all&per_page=100&sort=created&direction=desc&page=N"`,
  walking pages 1..K (K=3) with a `--jq` projection to
  `{n: .number, ref: .head.ref, head_repo: .head.repo.full_name, created: .created_at}` guarded by
  `if type=="array" ... else error(...)`. `state=all` so a PR merged before the first sweep is not lost;
  newest-first plus the watermark bounds the walk.
- Per entry, an EXACT SET (all three conjuncts, never a single-conjunct `.find()`):
  branch shape `loom/issue-<issue_ref>-[0-9a-f]{12}` AND `head_repo` identity (re-validated with
  `isGhRepo` + `validRepo` before a lowercased compare) AND `created_at >= drafted_at - skew`.
  - **EXACTLY ONE match required**:
    - 1 -> `advance({to_state:'in_flight', expect_state:'drafted', expect_rev: e.rev, evidence:{pr_url, pr_number}})`
      with `pr_url` CONSTRUCTED from the fold-validated repo + a boundary-validated integer, round-trip
      asserted through `parsePrUrl`. At most one entry may claim a given PR per sweep.
    - 0 -> absence is PROVEN by the watermark (paging stops at the first row older than it) -> silent
      `no-open-pr`. Only exhausting the page cap BEFORE crossing the watermark is `list-truncated`
      (+ an OBSERVABLE alert), because that is the one case where the list's end was never seen.
    - >1 -> skip `ambiguous-match` + an OBSERVABLE alert carrying the candidate PR numbers, leave the entry
      `drafted` (never guess). Manual escape: `cli.js advance --to-state in_flight --pr-url … --pr-number …`.
- CAS refusal (`state-changed` / `version-changed`) -> benign `skipped`, not an error.
- A gh failure for a repo -> that repo's entries land in `skipped:gh-unverifiable` (+ alert) and the sweep
  CONTINUES to the next repo. Never throws, never poisons other repos.

### Why a bounded single page, not `--paginate`

`assertReadOnlyGhArgs` would permit `--paginate`, but unbounded pagination is a quota/DoS hazard on a busy
upstream. A bounded page plus an explicit `list-truncated` signal is fail-SAFE: the loop never silently
concludes "no PR exists" from a list it could not see the end of.

### The poll wire — PASS 0.5

`pollSolveQueue` runs the reconciler AFTER PASS 0 (dispose) and BEFORE PASS 1 (observe), so a PR reconciled
this sweep is observed in the SAME sweep. try/catch wrapped (mirrors PASS 0); adds `summary.reconciled`; a
whole-sweep failure (`ok:false` with empty `errors[]`) is surfaced as a `stage:'reconcile'` summary error
(the fail-closed-must-be-observable lesson from #587).

**Rate-limit interaction (load-bearing)**: PASS 1 already bails on a rate-limit signal to protect the shared
token. PASS 0.5 spends gh calls BEFORE that bail runs, so it must be frugal (1 call per repo, bounded page)
and must record a rate-limited failure rather than retrying.

## Test plan (TDD-first)

- happy: a `drafted` entry + a matching open PR -> `in_flight` with `pr_url`/`pr_number`; CAS args asserted
  (`expect_state:'drafted'`, `expect_rev`).
- exactly-one: 2 matching PRs -> `ambiguous-match`, NOT advanced, alert fired.
- absence: 0 matches on a SHORT page -> `no-open-pr`, no alert; 0 matches on a FULL (100-row) page ->
  `list-truncated` + alert (never silently absent).
- branch discipline: a PR for a DIFFERENT issue_ref does not match; a near-miss ref (`loom/issue-26` vs `2`)
  does not match (anchored regex); a non-loom branch does not match.
- fork mode: a `head.ref` from a fork still matches (bare branch name).
- one call per repo: 3 drafted entries on one repo -> exactly 1 list invocation.
- multi-repo isolation: repo A's gh failure does not stop repo B from reconciling.
- CAS: `state-changed` / `version-changed` -> benign skip, not an error.
- TOTAL: throwing list / throwing advance / junk rows / non-array -> never throws.
- read-only: the args the module builds PASS `assertReadOnlyGhArgs`, and a mutated write-verb variant is
  REFUSED (non-vacuous: prove the gate can fail).
- real-store write-through: an isolated `LOOM_LAB_STATE_DIR` entry genuinely reaches `in_flight` on disk.
- poll: PASS 0.5 runs between dispose and observe; `summary.reconciled` present; a throw does not abort
  PASS 1/2; a whole-sweep failure surfaces a `stage:'reconcile'` error.

## Files

- `packages/lab/solve-queue/emit-reconcile.js` — NEW.
- `packages/lab/solve-queue/solve-queue-poll.js` — PASS 0.5 wire + `summary.reconciled`.
- `tests/unit/lab/solve-queue/emit-reconcile.test.js` — NEW.
- `tests/unit/lab/solve-queue/solve-queue-poll.test.js` — PASS 0.5 cases.

## Out of scope (deliberate)

- **Hold/defer awareness** (`pr:deferred` labels, `mergeable_state`, insider *comments* as signal, a
  `held-exogenous` outcome class excluded from the merge-rate). Motivated by real evidence — the
  spec-kitty#2611 maintainer comment, which our observer cannot see because it reads only `/pulls/N/reviews`
  — but it needs the frozen `EVIDENCE_FIELDS` enum extended and an outcome-class design. Its own wave.
- Extending `EVIDENCE_FIELDS` (see above).
- The armed emit itself (`drafted -> in_flight` EMISSION) — operator-only, never Claude.
- Closed-unmerged disposal (GAP-2) and log rotation (GAP-6a) — separate waves.

## Architect VERIFY — findings folded (2 CRITICAL, 4 HIGH, 6 MED, 5 LOW)

All probed firsthand before folding. The naive design would have shipped a silent no-op.

- **CRITICAL-1 (jq projection cannot work)** — `{number, ref, url}` expands to `.ref` (top-level, always
  `null`; the branch is at `.head.ref`) and `.url` (the API URL, not `html_url`). Production would match
  NOTHING and take the deliberately alert-free `no-open-pr` path forever, while mock fixtures authored from
  the same wrong shape stayed green (the mock-vs-real gap verbatim). -> FIXED: explicit paths
  `{n:.number, ref:.head.ref, head_repo:.head.repo.full_name, created:.created_at}` + a checked-in
  REAL captured response fixture so the parse is tested against a true body.
- **CRITICAL-2 (no provenance bind — third party can capture the entry)** — matching `head.ref` alone lets
  any stranger fork the upstream, push `loom/issue-<N>-<12hex>`, and have our entry bind to THEIR PR; PASS 1
  would ingest their reviews and PASS 2 would mint a `world_anchored` node asserting OUR
  `candidate_patch_sha` landed as that merge. **Probed**: `gh-emit.js:948-958` already does a FIVE-WAY
  exact-set for the same lookup with the comment *"A subset match is superset-tolerant / laundering-prone"* —
  the plan adopted only the first conjunct, a strict weakening of a discipline already learned here (#273
  family: integrity != provenance). -> FIXED: require `head_repo.toLowerCase() === e.repo.toLowerCase()`
  (null-safe; a deleted head fork reads null -> non-match), and emit an observable `foreign-head-refused`
  when a loom-shaped row is refused only for that. NOT copying gh-emit's `draft === true` conjunct: it is
  safe seconds after creation but would false-negative once the operator marks the PR ready.
  Named residual (gh-emit acknowledges the same one): a push-capable org member can still forge a branch;
  closing that needs a configured expected author, not this wave.
- **HIGH-1 (`state=open` drops the fastest merges)** — a PR merged before the first sweep has no open row, so
  the entry silently never anchors — losing exactly the best signal. -> FIXED: `state=all`, bounded by the
  HIGH-4 watermark. **Declared coupling**: this makes closed-unmerged PRs matchable too, so entries will
  reach `in_flight` with a dead PR — strictly more honest than `drafted`-forever, and precisely GAP-2's job.
- **HIGH-2 (never store a vendor-supplied URL)** — `validEvidenceField('pr_url')` is a LENGTH check only, and
  `PR_URL_RE` (probed, `parse-pr-url.js:26`) accepts only `https://github.com/<slug>/pull/<n>`, so an
  api.github.com URL would advance to `in_flight` and then fail `promoteOneInFlight` with `bad-pr-url` on
  EVERY sweep, unalerted and unreachable (the reconciler only sweeps `drafted`). -> FIXED: CONSTRUCT
  `pr_url` from the fold-validated `e.repo` + a boundary-validated integer `n`, then assert it round-trips
  through `parsePrUrl` before advancing. Plus an integration test driving a reconciled entry through
  `promoteMergedEntries`.
- **HIGH-3 (refuse-on->1 wedges permanently)** — refusing is right (never guess a world-anchor binding) but
  as specified it is absorbing: no tie-break, no aging, and `dispose-stale` sweeps only `solving`. Three real
  paths reach >1 (re-emit after revision — the EXPECTED flow; an abandoned prior-cycle PR; a forged one).
  -> FIXED: the watermark kills the prior-cycle case, the head bind kills the stranger case, the alert now
  carries the candidate PR NUMBERS so it is actionable, and the existing manual escape is documented
  (`cli.js advance --to-state in_flight --pr-url … --pr-number …`). "Silently take the newest" explicitly
  REJECTED as a default.
- **HIGH-4 (truncation heuristic is a guess where a proof is free)** — a full page with no match fires
  `list-truncated` forever on a busy repo (noise), and an older entry past row 100 is wedged (false
  negative). -> FIXED: a `created_at` WATERMARK. The PR cannot predate the drafted event, and `foldEntry`
  already exposes `updated_at` = that event's ts. Walk pages 1..K (K=3) created-desc; the moment a row is
  older than `drafted_at - skew` (generous, days) absence is PROVEN -> silent `no-open-pr`. Only hitting the
  page cap BEFORE crossing the watermark is genuinely `list-truncated`. Rejected alternatives: `head=` takes
  an exact value and we do not know the hash suffix; the search API's `head:` prefix semantics are UN-PROBED
  and its rate limit is tighter than the core API.
- **MED-1 (rate-limit interlock)** -> PASS 0.5 classifies via `err.stderr` against the shared RATELIMIT_RE,
  stops calling gh for the rest of the pass on the first hit (+ a 2-consecutive-failure systemic proxy),
  returns `rate_limited`, and `pollSolveQueue` SKIPS PASS 1 when it is set. Regex extracted to one shared
  place (no reconciler->poll import; that would cycle). Raw stderr never enters an alert.
- **MED-2 (`rev` guard)** -> mirror `dispose-stale.js:70`: a non-integer/negative `rev` is skipped `no-rev`,
  never advanced without version protection (the CAS must stay non-bypassable).
- **MED-3 (join-key precheck)** -> `promoteOneInFlight` needs `pr_url` AND `candidate_patch_sha`. Verified
  the auto-wired path carries it (`live-draft-run.js:519` sets it on `-> drafted`; evidence accumulates
  per-field). But a HAND-created entry may lack it, and advancing such an entry manufactures an
  unpromotable dead end with no legal repair transition. -> REFUSE with an observable `no-join-key`, leaving
  it `drafted` where a human can still act.
- **MED-4 (alert hygiene + repetition)** -> alert details carry ONLY integers and fold-validated fields
  (PR numbers, entry_id, repo) — never the raw gh `head.ref` (`emitEgressAlert`'s JSON.stringify escapes C0
  but not the C1 band, which is why `gh-verify.js:221 isCleanBounded` rejects C1 on gh-sourced strings).
  Alerts capped once per repo (truncation) / once per entry (ambiguity). Named residual: persistent
  conditions still re-alert across sweeps, which raises GAP-6a (log rotation) priority.
- **MED-5 (jq array-assert)** -> probed `review-observer.js:79` uses `if type=="array" then … else error(…)`
  IN jq because a bare `[.[]|…]` construction laundes a non-array 200 body into a valid array. Mirrored,
  plus a node-side `!Array.isArray` backstop.
- **MED-6 (invoke the gate on the real path)** -> probed `review-observer.js:81-82` calls
  `assertReadOnlyGhArgs(ghArgs)` itself and refuses `not-read-only`, because an INJECTED runner bypasses
  `defaultRunner`'s internal gate. Mirrored (a test proving the args are clean does NOT prove the module
  invokes the gate).
- **LOWs folded**: lowercase the repo group key; static prefix compare instead of a dynamic RegExp; a
  `require.main === module` CLI entry (so the operator can dogfood one sweep before it goes on the cron);
  initialize `summary.reconciled = []` before the early return; refresh `solve-queue/README.md` (its
  lifecycle table still attributes `drafted -> in_flight` to the operator and its Files list omits
  `dispose-stale.js`) and the ROADMAP/MEMORY producer-gap status claim this wave closes. Confirmed NOT to
  add the module to `READONLY_GH_ALLOW` (it imports `defaultRunner` rather than spawning, exactly like
  `review-observer`; adding it would be a no-op that dilutes the list).

**Explicitly confirmed sound**: Route A honors the dam (the join-key store's single-reader allowlist is
untouched, and `gh-verify` is unrestricted by the shadow-import graph); `expect_state` + `expect_rev` is the
right CAS and `rev` is load-bearing here specifically (a `drafted -> disposed -> queued -> … -> drafted(FRESH)`
cycle carries a DIFFERENT `candidate_patch_sha`, so state alone would bind the wrong patch); gh calls stay
OUTSIDE the store lock (`withLockSoft` has `maxWaitMs: 3000` — holding it across a network call would
lock-timeout every other queue op); the `[0-9a-f]{12}` suffix charset is exact; one list call per repo;
freezing `EVIDENCE_FIELDS` and deferring labels/`mergeable_state` is right.

**Follow-up named (not this wave)**: `drafted` has no terminal path at all, so never-emitted entries accrete
forever. A stale-`drafted` dispose is the natural sibling (`drafted -> disposed` is already legal).

## VALIDATE — board findings folded (hacker live-probe + code-reviewer, on the BUILT diff)

- **hacker C-1 (CRITICAL — forged provenance tuple, no attacker required)**: the 12-hex branch suffix is
  `approvalHash.slice(0,12)`, but the queue carries NO approval hash, so the branch match is a SHAPE, never an
  IDENTITY. With `state=all` and my **3-day skew**, a still-open PR from a PRIOR solve cycle re-bound to a
  FRESH draft carrying a DIFFERENT `candidate_patch_sha`; probed end-to-end through `merge-promote` into the
  `(merge_sha, candidate_patch_sha)` tuple the world-anchored mint seals. The ordinary retry path triggers it.
  **My own test asserting "a prior-cycle abandoned PR never binds" was VACUOUS** — a 19-day gap against a
  3-day skew never touched the boundary, so it asserted a property the code did not have, 21/21 green.
  -> FIXED at the root: the skew was an unjustified constant. The operator always emits AFTER the draft, so
  the skew needs to cover only host-vs-GitHub clock divergence: **3 days -> 10 minutes**, with the reasoning
  written into the constant. Both probed scenarios now refuse. Tests replaced with BOUNDARY cases (a PR 1h
  before the draft must not bind; a PR 1min after must — the gate is non-vacuous both ways).
  Residual (named, not closable this wave): a true identity bind needs the approval prefix carried as
  evidence, which needs a PRODUCER — the kernel emit is deliberately decoupled from the queue.
- **hacker H-1 (case-variant double-bind)**: `entry_id = sha256({repo, issue_ref})` is case-SENSITIVE, so
  `Acme/W` and `acme/w` are distinct entries that both lowercase-match ONE PR -> two world_anchored nodes
  claiming different patches landed in one merge. -> FIXED: a per-repo-group `claimed` set; the second entry
  gets an observable `pr-already-claimed`.
- **hacker H-2 (every skip invisible on the cron path)**: `list-truncated` / `no-rev` / `version-changed`
  pushed to `summary.skipped` with NO alert, and the poll then overwrote `summary.skipped` wholesale with
  PASS 2's — a permanently stalled entry re-burning `maxPages` calls every sweep, unobservable
  (`drift:fail-silent`). -> FIXED: alerts on those three, and the poll carries the reconciler's skips through
  as `summary.reconcile_skipped` (stage-tagged) instead of dropping them.
- **hacker M-1 (case-fold spoof)**: `toLowerCase()` is not injective (U+212A KELVIN folds to `k`), and the
  vendor `head_repo` was compared without re-validation. -> FIXED: `isGhRepo` + `validRepo` on the vendor
  string BEFORE the compare.
- **hacker M-2 (half-built interlock)**: PASS 1 was gated on the rate limit but PASS 2 still ran, and
  `merge-promote` has no bail of its own. -> FIXED: PASS 2 gated too (`promote_pass_bailed`).
- **hacker M-3 (weaker recognizer)**: the entry boundary used `isGhRepo` (accepts `..`) where the fold uses
  `validRepo` (rejects it). -> FIXED: both.
- **code-reviewer HIGH-1 (entries vanish)**: on a systemic non-rate-limit failure the `break` dropped every
  later repo out of `reconciled`/`skipped`/`errors` — a monitor could not tell those entries existed.
  -> FIXED: a `systemicFailed` flag mirroring the `rate_limited` interlock; every entry still lands in a
  bucket (dispose-stale's contract). Regression test added.
- **code-reviewer LOW-1 / PRINCIPLE-1** -> FIXED: dead ternary removed; the duplicated branch-shape check
  extracted to `isLoomShapedRef`.
- **hacker LOW (no module deadline; one-sided watermark; early-stop trusts vendor ordering)** and
  **code-reviewer MEDIUM-1/2 (no test executes the real `jq`; the plan's claimed downstream integration test
  is absent)** -> ACCEPTED as named residuals, not fixed this wave: production's `defaultRunner` carries a
  30s timeout so the hang is harness-only; `created_at` is GitHub-assigned and immutable so the ordering and
  far-future cases are refuted as attacks; the `jq` string was verified correct by the reviewer piping it
  through real `jq`, and the constructed URL was verified to round-trip through `promoteOneInFlight`'s own
  parse. Both test gaps are real coverage debt and are recorded here rather than silently dropped.

**Explicitly held under probing** (~60 hacker probes, 9 bypasses found, the rest refuted): the read-only gh
gate is non-vacuous AND invoked on the injected-runner path; the env is sanitized (no token leak); the URL
round-trip guard refuses; the CAS holds across a full dispose/re-solve cycle and two concurrent sweeps
(exactly-once, loser gets `state-changed`); prototype pollution, duplicate JSON keys, traversal refs, NUL
bytes, throwing getters, 8MB bodies, 50k-row pages and 5000-deep nesting all held without a throw.

## Pre-PR CodeRabbit CLI — 7 findings, 6 folded, 1 REFUTED after premise-probing

- **Major (poll header + PASS 2 interlock)** — PARTIALLY folded. The header now lists PASS 0 / 0.5 / 1 / 2.
  But the proposed fix (gate PASS 2 on `rate_limited || review_pass_bailed`) **over-reaches and was
  refuted**: PASS 1's systemic bail also fires on 2 consecutive NON-rate-limit failures (two 404s, a transient
  blip), and F3 (#584) DELIBERATELY keeps promote running through those — locked by its own test m3 ("promote
  (pass 2) still runs") and this suite's header. Applying the suggestion turned m3 red, which is the tell.
  Kept the `rate_limited`-only gate (the actual cooldown the hacker's M-2 identified) and wrote the reasoning
  into the code. **This is the "premise-probe the board's SUGGESTED FIX, not just its finding" discipline** —
  the same shape as the PACT #126 case where a board's proposed fix would have re-broken an invariant.
- **2 Majors on the plan doc** — the normative Design section still described the PRE-VERIFY algorithm
  (single page, no head-repo bind) while the folded design differs. Real staleness in a living plan. -> the
  Design section's Part 2/3 now match the built code.
- **Minor (plan HIGH-2 claimed an integration test that did not exist)** -> FIXED by BUILDING it rather than
  downgrading the claim: an integration test now drives a reconciled entry through the real
  `promoteMergedEntries` and asserts it is not rejected as `bad-pr-url` / `repo-mismatch`.
- **2 Minors (weak tests)** -> FIXED: the MED-1 test now asserts BOTH entries are accounted for (the
  code-reviewer HIGH-1 contract), and the HIGH-4 early-stop test now uses a FULL page plus an unfetched
  second page, so it proves WATERMARK early-stop rather than short-page exhaustion (it was weaker than its
  own name claimed).

## Sign-off

- Suites: emit-reconcile 25 / poll 8; full lab + kernel suites exit 0. eslint / signpost / markdownlint clean;
  0 non-ASCII in added lines.
- Review cascade: architect VERIFY (2 CRITICAL / 4 HIGH / 6 MED / 5 LOW) -> hacker live-probe VALIDATE
  (1 CRITICAL / 2 HIGH / 3 MED, ~60 probes) + code-reviewer VALIDATE (1 HIGH) -> pre-PR CodeRabbit (1 Major
  code + 6). Each layer caught a class the others did not.
