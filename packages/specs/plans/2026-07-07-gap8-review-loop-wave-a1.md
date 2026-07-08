# Gap-8 review-loop — Wave A-1: the review ingestion path (observer + store)

**Wave**: autonomous-SDE gap-map, Gap-8 (review-loop), first slice of Wave A. **Branch**: `feat/gap8-review-loop-wave-a` · **Base**: fresh `origin/main` @ `12490fb`. **Scope authority**: [`research/2026-07-07-gap8-review-loop-scope.md`](../research/2026-07-07-gap8-review-loop-scope.md) (architect + hacker pressure-tested).

## Context

An external PR review has no ingestion path back to the autonomous persona (today only the `merged` boolean is observed). This slice ships the **ingestion half** of Wave A: a read-only-GET **review-observer** + an append-only content-addressed **review-outcome store** that records INSIDER review verdicts. It is SHADOW and gates NOTHING (no consumer reads the store this slice — the `changes-requested` circuit-breaker source that consumes it is Wave A-2). Split from the full Wave A because the store's dismissal/cardinality design is the load-bearing subtlety and a ~1000-line 3-piece PR is not reviewable in one sitting.

## Routing Decision

```json
{"task":"Gap-8 review-loop Wave A: review-observer + append-only content-addressed review-outcome store; untrusted external review input; #273-adjacent, SHADOW/dormant","recommendation":"root","score_total":0.15,"substrate_meta_detected":true,"substrate_meta_tokens":["circuit-breaker","breaker source","content-addressed"]}
```

**Escalation judgment**: `root` bare score but substrate-meta detected + this is the Rule-2 class (content-addressed store, UNTRUSTED external input, #273-adjacent, an off-switch-shaped security surface). Full 3-lens VERIFY + VALIDATE tier by judgment.

## Runtime Probes (firsthand-verified — the load-bearing build decisions rest on these)

| Claim | Probe | Result |
|---|---|---|
| Resolving PR→join-key would breach the kernel dam | `merge-observer.js` header: "the kernel REQUIRE_ALLOWLIST stays at exactly two readers (emit-pr.js + THIS observer)"; `join-key-store.js:446` `resolveJoinKeyForPr` | CONFIRMED — a THIRD join-key reader is a dam breach. **The review-observer MUST NOT read the kernel join-key.** |
| (repo, pr_number)→join_key_id is resolvable downstream WITHOUT the review-observer reading the join-key | `merge-observer.js` records `recordMergeOutcome({join_key_id, repo, pr_number, pr_url, …})` | CONFIRMED — the merge-outcome store already carries BOTH; Wave B correlates review-outcomes (keyed by repo/pr_number) with the persona via that existing link. No join-key read needed in A-1. |
| A review's `state` is reviewer-SUPPLIED, not GitHub-computed | GitHub review object; contrast `gh-verify.js:179-188` (`merged===true` computed) | CONFIRMED — `CHANGES_REQUESTED` is a button-press; **`author_association` (GitHub-computed) is the authorization discriminator.** |
| The merge-outcome-store is the store template | `merge-outcome-store.js` — content-addressed, closed-shape exact-set, O_NOFOLLOW/fstat/oversize/content-hash verify-on-read, MAX_OUTCOME_BYTES | CONFIRMED — mirror it, but change the KEY (one-per-PR → append-only per-review-snapshot). |
| gh-verify is the read-only-GET template | `gh-verify.js` `verifyMerge`: `gh api -X GET … --jq '{…}'`, `assertReadOnlyGhArgs`, `buildVerifyEnv`, injected runner, fail-closed | CONFIRMED — mirror on `/pulls/N/reviews --jq '[.[]\|{id,state,author_association,submitted_at}]'`. NEVER select `.body` (prose stays on GitHub). |

## Files To Build / Modify

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/lab/world-anchor/review-outcome-store.js` | **NEW** | **medium** | Content-addressed, **append-only per-review-snapshot** store. `node_id = hash(BASIS = {repo, pr_number, review_id, state})` — each (review, state) snapshot is ONE immutable record; a re-poll at the same state dedups, a state change (CHANGES_REQUESTED→DISMISSED) is a NEW record (append-only, dismissal-representable). Body `{repo, pr_number, review_id, state, author_association, submitted_at, observed_at, node_id, content_hash}`; content_hash seals all. Closed enums: `state ∈ {approved, changes_requested, commented, dismissed}`, `author_association ∈ {OWNER, MEMBER, COLLABORATOR}` (INSIDER-only — a non-insider record is rejected on read; the observer never writes one). Mirror merge-outcome-store's verify-on-read (O_NOFOLLOW/fstat-same-fd/oversize/exact-set/content-hash), `{flag:'wx'}`, MAX cap, deep-frozen list. `recordReviewOutcome` / `listReviewOutcomes`. |
| `packages/lab/world-anchor/review-observer.js` | **NEW** | **medium** | Mirror merge-observer + gh-verify. `runReviewObserve({pr}, opts)`: `parsePrUrl(pr)` → `{repo, pr_number}` (NO join-key read — dam-safe); read-only `gh api -X GET repos/<repo>/pulls/<n>/reviews --jq '[.[]\|{id,state,author_association,submitted_at}]'` via injected runner + gh-verify's env-hardening (import if exported, else replicate per deliberate-duplication); for each review, **INSIDER-gate** (author_association ∈ {OWNER,MEMBER,COLLABORATOR}) → record a snapshot; non-insider → SKIP (never recorded — closes C1 remote-off-switch AND store-spam DoS at the earliest point). Fail-closed, observable. Returns `{ok, recorded, deduped, skipped_non_insider, reason?}`. |
| `packages/lab/world-anchor/cli.js` | modify | low | add an `observe-reviews --pr <url>` subcommand (operator-invoked, mirrors `record-merge`). Dormant — an operator points it at a known-ours PR. |
| `tests/unit/lab/world-anchor/review-outcome-store.test.js` | **NEW** | low | verify-on-read (tamper/foreign/oversize/exact-set), append-only per-snapshot (state change → 2 records; re-poll → dedup), insider-only read reject, deep-frozen list, deterministic node_id. |
| `tests/unit/lab/world-anchor/review-observer.test.js` | **NEW** | low | injected runner: insider review recorded; non-insider SKIPPED (C1); prose `.body` never fetched/stored; fail-closed on gh error/unparseable; dedup on re-poll; TOTAL. |
| `tests/unit/lab/world-anchor/review-outcome-shadow.test.js` | **NEW** | low | import-graph dam: ZERO gating consumer reads `listReviewOutcomes` this slice (Wave A-2's breaker source is the first admitted reader); the observer is the only writer. |

## Phases

1. **review-outcome-store** (TDD: tests first). node_id basis {repo, pr_number, review_id, state}; closed-enum state + insider author_association; verify-on-read parity with merge-outcome-store; append-only (state change = new node_id). **Probe**: a CHANGES_REQUESTED then DISMISSED snapshot of the same review = 2 records; re-record same = dedup; a planted non-insider record → rejected on read.
2. **review-observer** (TDD). parsePrUrl (no join-key); read-only GET `/reviews` with `-X GET` + env-hardening; `--jq` selects only {id,state,author_association,submitted_at} (no body); insider-gate at write. **Probe**: injected runner with 1 insider + 1 non-insider review → 1 recorded, 1 skipped; a runner returning a `.body` field is irrelevant (jq never selects it); gh-error → {ok:false} observable.
3. **cli `observe-reviews` + the shadow dam + signpost**. **Probe**: dam asserts zero `listReviewOutcomes` caller; `generate-signpost --check` clean.

## Verification Probes

| Probe | Pass criterion |
|---|---|
| 1 | `find tests/unit/lab/world-anchor -name '*.test.js' -print0 \| xargs -0 -n1 node` → all green (incl. the 3 new suites) |
| 2 | C1: a non-insider (CONTRIBUTOR/NONE) review is NEVER recorded (observer test) |
| 3 | append-only: a review's state change writes a 2nd record; the store never mutates the 1st |
| 4 | dam: `review-outcome-store` has zero gating/ranking consumer; the observer is the only writer |
| 5 | the review-observer reads NO kernel join-key (grep: no `resolveJoinKeyForPr`/`loadJoinKey`/`join-key-store` import) → the kernel 2-reader allowlist is untouched |
| 6 | prose: no `.body` is fetched (jq) or stored (store schema); `body`/`login` never persisted |
| 7 | full kernel suite green; `install --hooks --test` → 118/0 (minus the pre-existing plugin-cache drift); eslint/markdownlint/yaml 0; signpost + release-surface clean |

## Out of Scope (Deferred)

- **Wave A-2 — the `changes-requested` breaker source** (the actual HALT): a new global-only, mtime-windowed, dismissal-aware `SOURCES` entry in `circuit-breaker/project.js` that scans this store and emits constant-persona denial events for currently-CHANGES_REQUESTED insider reviews. Small add on top; next PR.
- **Rung A0 / Wave B — the PR→persona join** (per-persona halting): needs a `join_key_id`→persona map (the persona is UNreachable from the join-key today). Correlates via the merge-outcome store's existing pr_number↔join_key_id link. NOT this slice.
- **Wave C — the re-solve Rubicon** (`reviewContext`→materializer + `emitPR` UPDATE): arming-gated; prose-containment = tool-inertness (`verifyToollessRuntime`) NOT the secret-scrub; fresh approval per re-push. Operator-gated, far deferred.
- **Live wiring**: the observer is operator-invoked (cli), dormant like merge-observer; it is buildable/testable now but only fires when armed emission + a real external review coincide (a dry run writes no PR).

## Security invariants (from the scope's board, carried into this slice)

1. **C1 — insider gate at the observer (write)**: record ONLY `author_association ∈ {OWNER,MEMBER,COLLABORATOR}` (GitHub-computed). Non-insider is display-only, never recorded. Re-validated on store read (defense-in-depth). This closes the remote-off-switch AND store-spam DoS at the earliest point.
2. **No prose ever**: `--jq` selects only structured GitHub-computed fields; `body`/`login` never leave GitHub / never persisted.
3. **Read-only GET**: `-X GET` pinned (mirror `assertReadOnlyGhArgs`); the observer adds ZERO egress capability.
4. **Dam-safe**: NO kernel join-key read (keeps the kernel 2-reader allowlist intact); the review-outcome store is SHADOW (zero gating consumer this slice).
5. **Append-only + verify-on-read**: content-addressed snapshots, immutable, O_NOFOLLOW/uid/exact-set/content-hash (#273 store discipline).

## Drift Notes

- The scope's "Wave A" is 3 pieces (~1000 lines); split into A-1 (ingestion, this PR) + A-2 (the breaker source) for reviewability — each independently safe (A-1 records but nothing consumes).
- The join-key-dam constraint (only 2 kernel join-key readers) was NOT in the scope's board findings; caught in build recon. It flips the store key from the scope's proposed `(join_key_id, review_id)` to `(repo, pr_number, review_id, state)` — the join_key_id correlation moves downstream to Wave B (via the merge-outcome pr_number↔join_key_id link). A runtime-claim probe win.

## Pre-Approval Verification (3-lens VERIFY board — 2026-07-07)

`architect` + `hacker` + `code-reviewer` on the concrete plan. **architect/hacker: PROCEED-WITH-FOLDS; code-reviewer: NEEDS-REVISION.** All four concrete decisions ruled sound-with-corrections (dam-avoidance SOUND but recovery-contract wrong; insider-gate-at-write RIGHT; per-snapshot identity COLLISION-FREE; verify-on-read parity transfers EXCEPT the re-derive addition). Folds baked into the build:

| # | Fold | Severity / lens | Disposition |
|---|---|---|---|
| F1 | Store OWNS its basis → **re-derive `node_id` on read** (`deriveReviewNodeId(parsed) !== id` → reject), mirror join-key-store NOT merge-outcome's opaque id. Write uses the derived id as filename. | **CRITICAL** ×3 (hacker PoC) | build |
| F2 | Recovery-contract wrong: merge-outcome link is POST-MERGE only; pre-merge = A0 map / Wave-B join-key reader. **A-2 must re-establish is-this-ours before gating** (un-joinable → non-counting). Scope doc corrected. | **HIGH** ×3 | plan+scope ✓ + fwd-contract |
| F3 | Per-item try/catch over the `/reviews` array (one bad entry drops observably; poll continues; `[]` valid); `per_page=100`. | HIGH (cr) | build |
| F4 | `bodiesEqual` = identity basis `{repo,pr_number,review_id,state}` only — EXCLUDE `observed_at`+`author_association`+`submitted_at` (a benign association-change on re-poll dedups first-write-wins). | HIGH (cr, architect) | build |
| F5 | **Array-shape gate** — assert the GET result is an Array; reject a non-array 200-body (hacker PoC: an object with review-shaped values is mangled into valid records). | MEDIUM (hacker) | build |
| F6 | Add `pull_request_url` to the jq (prose-free) + cross-check its `/repos/O/R/pulls/N` parts against the operator-supplied `(repo,pr_number)` (mirror merge-outcome-store:148-149). | MEDIUM (hacker) | build |
| F7 | ONE `validateRecord` on BOTH write and read (state∈enum, author_association∈insider, review_id int, ISO ts) — defense-in-depth, not "the observer never writes one by convention". | MEDIUM (hacker, cr) | build |
| F8 | `MEMBER` is org-wide (too broad for a halt gate). Record with `{OWNER,MEMBER,COLLABORATOR}` (A-1 gates nothing); **named residual: A-2 narrows the halt-authorization set to `{OWNER,COLLABORATOR}`** (or a write-access/CODEOWNERS check). | MEDIUM (hacker) | named residual |
| F9 | GitHub **UPPERCASE** enums (`APPROVED`/`CHANGES_REQUESTED`/`COMMENTED`/`DISMISSED`); `PENDING`→SKIP at the observer (not a store-reject that aborts the poll). | LOW (hacker, architect) | build |
| F10 | Pin scalar validators: `review_id` = `Number.isSafeInteger && >0`; `submitted_at`/`observed_at` = anchored `ISO_8601_UTC` + `Date.parse` finite. | LOW ×3 | build |
| F11 | Per-observe processed-review cap + `per_page=100` (carry the scope's rate-limit invariant into A-1, not deferred). | MEDIUM (hacker) | build |
| F12 | Honest #273-residual header: this store has NO kernel-sealed anchor (weaker than merge-outcome); a record proves "GitHub returned this review for this (repo,pr_number)", NEVER "PR is ours". Downgrade "closes C1 at earliest point" → "closes C1-as-scoped". | MEDIUM (architect) | header+plan ✓ |
| F13 | A-2 forward-contract: the review store is many-records-per-PR; A-2's scan must be mtime-bounded / have retention (not an unbounded readdir). | LOW (architect) | Out-of-Scope note |
| F14 | Precision: not "prose never leaves GitHub" but "body/login never enter the node process or the store (the `--jq` strips them in the gh subprocess before stdout)". | NIT (hacker) | header ✓ |
| F15 | `buildVerifyEnv`/`assertReadOnlyGhArgs`/`defaultRunner` ARE exported by `gh-verify.js:200` → **import them** (no replication hedge). | LOW (cr) | build |
| F16 | `PR_INSIDER_ASSOCIATIONS` is NOT exported by live-puller (+ importing it drags the whole module / couples issue-corpus→world-anchor). Define the frozen insider Set in `review-outcome-store.js`, export it; the observer imports from the store. | MEDIUM (architect) | build |

Board tokens ~378K, 49 tool calls, 3/3 done. Full findings: workflow `wf_904d21fd-1b5`.

## VALIDATE result (post-build 3-lens board — 2026-07-07)

`code-reviewer` + `hacker` (live probes) + `honesty-auditor` on the BUILT diff. **All three: SHIP-WITH-FOLDS.** The code-reviewer confirmed **all 16 folds F1-F16 genuinely present + correct** (line-by-line + 31 passing tests); the hacker ran **13 live probes** — F1 divorced-key forge REJECTED, C1 non-insider 0-records, F6 pr-url-mismatch refused, prose never stored, read-only `-X GET` no `-f`, the accepted same-uid co-forge admitted-and-named. Post-build folds applied:

| # | Fold | Severity / lens | Disposition |
|---|---|---|---|
| V1 | **F5 array-gate was DEAD in production** — jq `[.[]\|{...}]`'s outer `[...]` launders a non-array body into an array BEFORE the node `!Array.isArray` (hacker PROBE E2: object-body → `recorded:2`). Assert `type=="array"` INSIDE jq (fail-closed at the subprocess); node check kept as defense-in-depth. | **MEDIUM** (hacker+honesty, CONFIRMED) | **FOLDED** — code + test o11 |
| V2 | F12 wording downgrade never applied to code ("at the earliest point" → "C1-as-scoped": provenance deferred, MEMBER org-wide, not a complete off-switch close). | MEDIUM (honesty, CONFIRMED) | **FOLDED** — observer + store headers |
| V3 | The `collision` refuse is dead/mislabeled — node_id re-derive makes `bodiesEqual` vestigial; `collision` only ever means "existing file failed verify". Renamed → `existing-record-unverifiable` + fixed comment. | MEDIUM ×3 (all lenses, CONFIRMED) | **FOLDED** — store |
| V4 | The `observe-reviews` cli arm was untested + didn't thread `selfUid`. | **HIGH** (cr) | **FOLDED** — thread selfUid + tests c1/c2/c3 |
| V5 | `..`/`.` repo segments build a path-traversal-shaped gh path (fails-closed, latent). | LOW (hacker, CONFIRMED) | **FOLDED** — observer segment guard |
| V6 | No pagination past `per_page=100` — a PR with >100 reviews silently ingests only page 1. | LOW (cr) | **FOLDED** — named residual (header) |
| V7 | Store header "proves" over-runs the integrity-not-provenance model (a same-uid co-forge fabricates a record for a review GitHub never returned). | LOW (honesty, CONFIRMED) | **FOLDED** — "ASSERTS (does not prove)" |

**Board endorsed** (CONFIRMED, no change): all 16 F-folds present; the store is SHADOW (zero reader, dam holds); no kernel join-key read (dam-safe); the accepted same-uid co-forge is inert-while-SHADOW + named; the A-2 forward-contract (re-establish is-this-ours before gating) is recorded in the store header. Board tokens ~379K, 56 tool calls, 13 live probes, 3/3 done. Full findings: workflow `wf_61b4b0dd-24f`.

### CodeRabbit (async bot, real review — no rate-limit; 2 inline + 2 nitpicks)

| Finding | Disposition |
|---|---|
| **Major** (shadow-test): the importer-scan blanket-skipped world-anchor siblings → a sibling importing the store was invisible (#451-C2 hole on the importer axis); `CLI_FULLPATH` was a dead/vacuous const | **FOLDED** — scan now covers siblings (exempt only definer+writer full-path) + a planted-sibling-importer non-vacuity probe; dead const removed |
| **Minor** (store): a malformed-JSON tamper was swallowed as `alert('io', io_code:undefined)`, conflating a parse-tamper with an FS I/O fault | **FOLDED** — distinct `malformed-json` token (test r13) |
| **Nitpick**: add coverage for the defensive branches | **FOLDED** — test r14 covers the `existing-record-unverifiable` refuse (reachable via a planted tamper) |
| **Nitpick**: "trim the board transcript from the plan; link out (DRY)" | **DECLINED** (documented) — contradicts the repo's OWN canonical convention: living per-wave plans **accrete** `## Pre-Approval Verification` / `## VALIDATE result` inline (CLAUDE.md + `plans/README.md`: "in-place updates ARE the workflow"). The SCAR #29(b) class — a valid-looking bot nitpick that is an anti-pattern for THIS repo. |
