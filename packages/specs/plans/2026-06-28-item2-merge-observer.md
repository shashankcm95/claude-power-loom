---
lifecycle: persistent
---

# PR-2 — the gh-verified, join-key-anchored merge-outcome RECORD (gap-map item 2, SHADOW)

Status: PLAN (architect design-panel synthesized 2026-06-28). Wave: autonomous-SDE ladder item 2.
Depends on: #447 (item 1, the kernel egress join-key, MERGED `c698d52`).

## Goal (one line)

A human-invoked lab observer that, given a merged PR URL, **gh-verifies the merge in-process**
(`merged === true`), **joins on the kernel egress join-key** (`resolveJoinKeyForPr`), and writes a
**content-addressed merge-outcome RECORD** bound to the SEALED `approval_hash` — fail-closed if the PR
has no kernel join-key. SHADOW: it admits no weight, mints no node/edge, flips no `LIVE_SOURCES`.

## Scope decision (design-panel synthesis — READ FIRST)

A 3-architect design panel (minimal-additive / single-flow-rewire / free) converged on **RECORD-ONLY,
additive, attestation-severed**. The two strongest-reasoned lenses (A + C) both put the node/lesson/edge
mint + the `to_delta_ref = approval_hash` rebind in **item 3**, not PR-2.

- **IN scope (PR-2 = item 2):** gh-verify + join-key join + a new merge-outcome record store + a new
  observer + a new CLI subcommand + the precise dam relaxation. The record CARRIES the sealed
  `approval_hash` (so item 3 can trust it).
- **OUT of scope (item 3 / later):** minting the `world_anchored` node, the lesson, the
  `world-anchored-by` edge, and binding the edge `to_delta_ref` to `approval_hash`. Item 3 will consume
  THIS record to mint the node + the `approval_hash`-derived edge. `LIVE_SOURCES`, any signer, and
  `deriveWorldAnchorSource` are untouched (that is PR-3 / PR-B, deployment-gated).

**Re-scope note (honesty):** the orchestrator's prior START-HERE scope said "PR-2 binds `to_delta_ref`
to `approval_hash`." That directive is re-read here as the item-3 EDGE forward-contract documented in the
#447 join-key header (the edge field must derive from the sealed `approval_hash`, never `diff_hash`/
`pr_url`/`base_sha`) — surfaced now because #447 created the sealed field, but NOT a PR-2 deliverable.
PR-2 honors the spirit by binding the RECORD to `approval_hash`; the EDGE bind lands in item 3.
**Residual (VERIFY honesty MEDIUM-2):** because the edge rebind is deferred, the EXISTING node/edge
(ca648110) stays anchored to the operator-controlled `att.diff_hash` (a local-file hash) until item 3
rebinds the edge to `approval_hash`. PR-2 does not fix the existing weak anchor — it only stops the NEW
RECORD lane from depending on it.

## Why (the structural finding the panel agreed on)

- The current `record-merge` flow (`cli.js:92-131`) is end-to-end **attestation-anchored** and trusts a
  **pasted `--merge-sha`** (no gh call), despite comments claiming "gh-verified" (`cli.js:148-167`).
- **"Require both attestation + join-key" works for NO real case:** ca648110/spec-kitty#2137 has an
  attestation but no join-key (it predates #447); a future merge has a join-key (from #447's `emitPR`)
  but no attestation (the attestation auto-write is item 3, deferred). So the **new `observe-merge` lane
  is attestation-severed** — the join-key is its authoritative basis.
- **Honesty qualification (VERIFY honesty-auditor HIGH-1):** PR-2 does NOT sever the attestation from the
  substrate. The legacy `record-merge` (pasted `--merge-sha`, NO gh-verify, mints node+edge from the
  attestation) STAYS LIVE and is still the only path that writes a `world_anchored` node. PR-2 ADDS a
  severed-and-gh-verified RECORD lane beside it; the legacy minter is the **residual unsafe path until
  item 3** retires/fences it. Do not claim "the attestation dependency is severed" — claim "the new lane
  is severed; the legacy minter remains live."

## Runtime Probes (verified against the live repo/runtime — 2026-06-28)

- **gh field names** — `gh api repos/shashankcm95/claude-power-loom/pulls/447 --jq '{merged, merge_commit_sha, state}'`
  → `{"merged":true,"merge_commit_sha":"c698d52...","state":"closed"}`. CONFIRMED: `merged` (bool),
  `merge_commit_sha` (sha), `state`.
- **The open-PR trap** — `merge_commit_sha` is **non-null even for UNMERGED open PRs** (GitHub computes a
  test-merge sha). ⇒ the authoritative gate is **`merged === true`**, NEVER sha-presence. (Probe: PR #1
  showed a populated `merge_commit_sha`; GitHub API semantics confirm an open mergeable PR carries one.)
- **approval_hash definition** — `computeEmissionHash(draft)` (`approval.js:61`) =
  `sha256(canonicalJson({repo, issueRef, diff}))`, the content-address of the approved emission. Threaded
  into the join-key at `emit-pr.js:486` (`approval_hash: approvalHash`). It IS a sound delta reference.
- **join-key consumer API** — `resolveJoinKeyForPr({repo, pr_number, pr_url})` → `{ok, id}` (exact-set on
  all three, fail-closed on 0/>1, emits `unjoined-pr`); `loadJoinKey(id)` → verified frozen body with the
  SEALED `approval_hash` (`join-key-store.js:403-414`, `:334-349`).
- **the kernel dam** — `tests/unit/kernel/egress/join-key-shadow.test.js` asserts ZERO production callers
  of `loadJoinKey`/`resolveJoinKeyForPr`/`listJoinKeys` AND that every importer pulls only the writer
  surface (`ALLOWED_IMPORTS`). PR-2's observer is the FIRST reader → this dam MUST relax (precisely).
- **lab dam** — `tests/unit/lab/world-anchor/shadow-import-graph.test.js` forbids any module outside
  `world-anchor/` from importing the lab stores + asserts zero callers of `deriveWorldAnchorSource`/
  `authenticatedWorldAnchorIds`. PR-2's new files live INSIDE `world-anchor/` and touch neither → this dam
  stays GREEN (extend only the born-SHADOW header invariants for the 2 new files).
- **lab→kernel import is legal** — the world-anchor stores already import `kernel/_lib/*` +
  `kernel/egress/alert`; importing `resolveJoinKeyForPr`/`loadJoinKey` from `kernel/egress/join-key-store`
  is the inward/legal direction.

## Design (the synthesized winner)

### New files (all `packages/lab/world-anchor/`)

1. **`gh-verify.js`** (~90 LoC) — `verifyMerge({repo, pr_number}, opts)` → `{ok, merged, merge_commit_sha, reason}`.
   - STRICT-validate `repo` (`owner/repo`, gh-name-safe segments) + `pr_number` (positive safe int)
     BEFORE the call.
   - `execFile('gh', ['api', 'repos/<repo>/pulls/<n>', '--jq', '{merged: .merged, merge_commit_sha: .merge_commit_sha, state: .state}'], {timeout, maxBuffer, env: sanitized})`
     — array args (NO shell), AMBIENT gh auth (NO token in argv), bounded buffer, hard timeout.
   - Parse JSON → gate on **`merged === true`** (strict boolean) → validate `merge_commit_sha` is HEX40.
   - Fail-closed `{ok:false, reason}` + OBSERVABLE (`emitEgressAlert`) on: bad-args, gh-nonzero-exit,
     timeout, unparseable, `merged !== true`, bad-sha. A `merged:false` PR is `{ok:true, merged:false}`
     (a legitimate not-yet-merged, the caller refuses-to-record — NOT an error).
   - **Injectable `opts.runner`** (replaces execFile) so unit tests never shell real gh.

2. **`merge-outcome-store.js`** (~200 LoC) — content-addressed, verify-on-read; a near-clone of the
   sibling hardened read-path (deliberate-duplication DRY — each verify predicate is security-load-bearing).
   - Record body (closed-shape exact-set): `{ join_key_id, repo, pr_number, pr_url, approval_hash,
     outcome, merge_commit_sha, observed_at, content_hash }`.
   - **Identity = `join_key_id` ALONE** (the file key; one merge-outcome per PR/join-key). `outcome` +
     `merge_commit_sha` etc. are in the body + in `bodiesEqual`, so a re-record with a DIVERGENT outcome
     (merged→closed) for the same join-key is an **observable COLLISION** (a PR has one terminal outcome),
     and an identical re-record DEDUPS. [CORRECTION vs the panel: A/C said basis `{join_key_id, outcome}`
     — that would create two files and MISS the collision. Key on `join_key_id` alone.]
   - `content_hash = computeContentHash(body-minus-content_hash)` seals the full body (the launder close).
   - Read path: `O_NOFOLLOW|O_NONBLOCK` + fstat-same-fd + foreign-uid reject + `st.size` cap BEFORE read +
     bounded read (cap+1) + `JSON.parse` + closed-shape exact-set + full field re-validation +
     re-derive `content_hash` and `join_key_id===filename` + deep-freeze + OBSERVABLE on every refuse
     (ENOENT benign). Write: `wx` exclusive, `0o600`; `validateReadDir`/`ensureStoreDir` dir guards.
   - Exports: `recordMergeOutcome(rec, opts)` → `{ok, deduped?, reason?}`; `loadMergeOutcome(join_key_id, opts)`;
     `listMergeOutcomes(opts)`. Born SHADOW (header names `/SHADOW/`, `/LIVE_SOURCES/`, `/#273/`).

3. **`merge-observer.js`** (~110 LoC) — `runMergeObserve({pr, outcome, expectedMergeSha?}, opts)`. The
   composer + the **SOLE kernel-join-key reader**.
   - `parsePrUrl(pr)` (reuse the exported one from cli.js — DRY) → `{repo, pr_number, pr_url}`.
   - `resolveJoinKeyForPr({repo, pr_number, pr_url})` → fail-closed refuse on `no-match`/`ambiguous`
     (the resolver already emits `unjoined-pr`; the observer surfaces the reason).
   - `loadJoinKey(id)` → SEALED `approval_hash` (refuse if null — verify-on-read failed, observable).
   - `verifyMerge({repo, pr_number})` → refuse if `!ok` or `merged !== true` (observable).
   - If `expectedMergeSha` provided (the operator's optional cross-check): require `=== merge_commit_sha`,
     refuse on mismatch (observable — catches a stale/wrong paste).
   - `recordMergeOutcome({ join_key_id: id, repo, pr_number, pr_url, approval_hash, outcome:'merged',
     merge_commit_sha, observed_at })`.
   - Returns `{ok, join_key_id?, outcome?, recorded?, deduped?, reason?}`. Mints NO node/edge.

### Edited files

4. **`cli.js`** — add an `observe-merge --pr <url> [--merge-sha <sha>]` subcommand dispatch arm (~10 lines)
   + USAGE. The legacy `record-merge` (attestation+node+edge, pasted sha) STAYS untouched (it serves
   ca648110 + is the item-3-early scaffold); add a one-line header note that `observe-merge` is the
   gh-verified join-key successor.
5. **`tests/unit/kernel/egress/join-key-shadow.test.js`** — relax the kernel dam from "ZERO readers" to
   **"exactly one named reader: `packages/lab/world-anchor/merge-observer.js`"**. Keep teeth: any OTHER
   reader is an offender; the import-graph half allows that one file to pull `resolveJoinKeyForPr` +
   `loadJoinKey` and nothing-else-anywhere. Non-vacuity: the matcher must still FAIL on a planted offender.
6. **`tests/unit/lab/world-anchor/shadow-import-graph.test.js`** — add a `merge-outcome-store` born-SHADOW
   matcher (zero external importers + zero consumers in PR-2) + header invariants for `gh-verify.js`,
   `merge-outcome-store.js`, `merge-observer.js`.
7. **`packages/kernel/egress/join-key-store.js`** header prose — name `merge-observer.js` as the one
   reader; reaffirm it admits no weight (SHADOW preserved).

### New tests

8. `tests/unit/lab/world-anchor/gh-verify.test.js` (injectable-runner; the **`merged:false` + non-null
   `merge_commit_sha` non-vacuity trap** is a REQUIRED case), `merge-outcome-store.test.js` (verify-on-read
   + collision + dedup + dir-guard + bounded-read), `merge-observer.test.js` (happy + every refuse path).

## Security invariants (must hold)

- **Gate on `merged === true`** (strict boolean), NEVER on `merge_commit_sha` presence (the open-PR trap).
  Asymmetric-parse: a gh failure fails CLOSED as "unverifiable", never silently degrades to "not merged".
- **Exact-set, not subset** for the join (`resolveJoinKeyForPr` already does this) + the closed-shape read.
- **Verify-on-read CONTENT** (re-derive `content_hash`, `join_key_id===filename`), not just the key (#273).
- **Integrity ≠ provenance** — the record proves "the kernel egress emitted this PR under `approval_hash`
  AND GitHub says it merged"; it does NOT prove the cross-uid broker was deployed (same-uid co-forge of the
  join-key remains the documented #273 residual until PR-3). The record is SHADOW; it gates nothing.
- **Fail-closed must be OBSERVABLE** — every `{ok:false}`/refuse emits `emitEgressAlert` (the #439/#447 SCAR).
- **No token / secret in argv or logs** — ambient gh (a GET), execFile array args, sanitized env.
- **Idempotent + collision-aware** — re-run dedups; divergent outcome for one join-key = observable collision.
- **Non-vacuous guards** — the gh gate test must include a `merged:false` PR with a non-null
  `merge_commit_sha`; the dam test must fail on a planted offender.
- **SHADOW preserved** — `LIVE_SOURCES=Object.freeze([])` untouched; no signer; `deriveWorldAnchorSource`
  uncalled. "Trust moves zero" means **no weight is admitted and nothing is gated** — NOT "no consumption
  of the join-key" (VERIFY honesty MEDIUM-1): the kernel dam moves from **zero-reader to one-recorder**
  (the join-key gains its first reader, read-only, gating nothing). State it that way; do not round to
  "no reader."
- **`merge_commit_sha` is gh-reported-at-observe-time, NOT verified-equal-to-the-approved-content**
  (VERIFY hacker H1 + honesty HIGH-2). The record binds `approval_hash` (the SEALED approved-content
  address) and `merge_commit_sha` (what gh says merged) SIDE BY SIDE; it does NOT prove they describe the
  same tree. A maintainer can edit a PR after approval, before merge → the two diverge. **Named residual:
  post-approval drift is undetected in PR-2.** Item-3 trust derives ONLY from the sealed `approval_hash`,
  never from `merge_commit_sha`. The record body field AND the store header must carry this label.

## Orphan disposition (ca648110 / spec-kitty#2137)

**Documented grandfather, forward-only. NO code carve-out** (a carve-out is a fail-closed-gate bypass +
attack surface; the keyed `pr_url` isn't even sealed). ca648110 has no kernel join-key (it predates #447);
`observe-merge` will fail-closed (`no-match`, observable) on it — which is CORRECT (it has no
kernel-authoritative basis). It stays where it is (SHADOW, weight-inert, served by the legacy `record-merge`
attestation lane). Do NOT re-emit (PR already merged — a real network side-effect, no upside). Do NOT
synthesize a fake join-key (that forges the provenance basis — a #273 violation). The first real
join-key-bearing merge becomes the genuine first record.

## HETS Spawn Plan

- **VERIFY (this plan, pre-build), 3-lens parallel:** `code-reviewer` (correctness of the record store
  verify-on-read + the dam relaxation + the cli wiring), `hacker` (adversarial: the gh subprocess injection
  surface, the `merged:false` trap, the dam non-vacuity, env/secret leak, the join collision), and
  `honesty-auditor` (claim-vs-evidence: is it really SHADOW? does it really sever the attestation? is the
  re-scope honest?). Read-only personas.
- **BUILD:** delegated to `node-backend` (the lab tier is Node) on a fresh worktree off origin/main; open
  the PR as a **DRAFT** per the CodeRabbit-conservation workflow (#448).
- **VALIDATE (post-build), 3-lens parallel + Rule-2a:** `code-reviewer` + `hacker` (live-probe the BUILT
  modules — throwaway scripts exercising the real verify-on-read + a planted symlink/foreign/oversize +
  the injectable-runner gh paths) + `honesty-auditor`. Plus the **real gh dogfood** (Rule-2a-corollary):
  run `observe-merge` against a known-merged real PR (it will fail-closed on the missing join-key, proving
  the gh+parse+resolve path end-to-end) AND confirm the `merged:false` path on a real open PR if available.
- **Rule 4:** record the VALIDATE board verdicts (delegated builder spawn) into the Lab verdict-attestation
  store after the wave.

## Drift gates (by hand, pre-push — the 5)

eslint + yaml + markdownlint + release-surface + **`node scripts/generate-signpost.js --check`** (3 new
`.js` files → SIGNPOST will be stale → CI Test 121 fails; the #447 SCAR). Plus the full kernel + lab suites.

## Pre-Approval Verification (3-lens VERIFY board, 2026-06-28)

`code-reviewer` (NEEDS-REVISION), `hacker` (NEEDS-REVISION, 2 CRITICAL), `honesty-auditor`
(NEEDS-QUALIFICATION, grade B). All findings premise-probed + folded below. These folds are
**BUILD-BINDING** — the builder implements them verbatim; the VALIDATE board checks them.

### CRITICAL (hacker C1+C2 / reviewer HIGH-3) — the dam relaxation, the highest-stakes lines

- **The kernel dam allowlist MUST be a single hard-coded FULL-RELATIVE-PATH constant compared with `===`**
  (`path.relative(REPO, file) === 'packages/lab/world-anchor/merge-observer.js'`). NOT a substring
  (`.includes('merge-observer.js')` admits `lab/evil/merge-observer.js` AND a `merge-observer.js.bak/`
  child) and NOT a basename (`path.basename === ...` admits `lab/evil/merge-observer.js`).
- **The caller-test assertion is exact-set:** `assert.deepStrictEqual(offenders, ['packages/lab/world-anchor/merge-observer.js'])`
  — never a cardinality-only `length === 1`.
- **Add a NON-VACUITY test** that plants each of the three bypass shapes (a basename-twin in another dir,
  a substring-twin `not-merge-observer.js`, a `merge-observer.js.bak/x.js` child) and asserts EACH is
  still flagged an offender. Prove the guard can fail.
- **C2 — close the import-then-alias route:** the lab dam exempts the whole `world-anchor/` dir, so a
  future sibling reader INSIDE `world-anchor/` is invisible to it — only the kernel dam catches it.
  Therefore extend the kernel dam's IMPORT-graph half (`STORE_REQUIRE_RE` / `ALLOWED_IMPORTS`) so a
  production module that IMPORTS a reader (`loadJoinKey`/`resolveJoinKeyForPr`/`listJoinKeys`, under any
  alias) is restricted to the SAME single full path — not just the call-grep half.

### gh-verify gate + subprocess (hacker H2/H3/M2 + reviewer LOW-1)

- **The gate is `typeof parsed.merged === 'boolean' && parsed.merged === true`** — reject a missing/null/
  string `merged` as unverifiable (fail-closed + observable). NEVER gate on `merge_commit_sha` presence
  (non-null for open PRs), NEVER on `state === 'closed'` (a closed-unmerged PR is also `closed`).
- **REQUIRED gh-verify test cases (non-vacuity):** (a) `merged:false` + non-null `merge_commit_sha`;
  (b) `merged:null`/absent; (c) `state:'closed'` + `merged:false`; (d) gh non-zero exit (404 nonexistent /
  403 private) → fail-closed-observable. All via the injectable runner — no real gh in unit tests.
- **`gh-verify.js` consumes the ALREADY-VALIDATED integer `pr_number` from the shared parser; it NEVER
  re-parses the URL.** It asserts `Number.isSafeInteger(pr_number) && pr_number > 0` at its own boundary
  (defense-in-depth vs the `1e+23` overflow).
- **`gh-verify.js` re-validates `repo` against the kernel's exact gh-name-safe predicate** (the
  `GH_PR_URL` / `validateRecord` repo shape in join-key-store.js — two non-empty segments, no leading
  dash), and a test asserts a leading-dash segment (`o/-r`, which `parsePrUrl` admits) is REJECTED at the
  gh-verify boundary. execFile array args + sanitized env (mirror `gh-emit.js` `BUILD_EMIT_ENV_SET_KEYS`)
  + hard timeout + bounded maxBuffer.

### merge-outcome-store (reviewer HIGH-1/MEDIUM-2 + hacker M1)

- **`observed_at` is OUTSIDE `bodiesEqual`** (mirrors join-key-store's `emitted_at` / edge-store's
  `recorded_at` exclusion): a re-observe with a fresh timestamp DEDUPS (first-write-wins), it does not
  collide. Without this, idempotency is a lie and every re-run errors. `bodiesEqual` compares the
  identity-relevant fields (`outcome`, `merge_commit_sha`, `approval_hash`, `repo`, `pr_number`, `pr_url`)
  so a DIVERGENT `outcome` for one `join_key_id` is an observable collision.
- **Verify-on-read = (a) `body.join_key_id === filename` (the id is OPAQUE to this store — no re-derive
  from body fields, which would be circular) + (b) `recomputeContentHash(body-minus-content_hash) ===
  body.content_hash`.** The `content_hash` seals the FULL body INCLUDING `join_key_id`, so a planted file
  with a valid filename but a wrong `join_key_id` field fails the content_hash check.
- **The store header carries the verbatim #273 same-uid co-forge residual** (mirror join-key-store.js
  lines 27-33): verify-on-read proves INTEGRITY not PROVENANCE; a same-uid process can co-forge a
  byte-valid record (the divergent-outcome collision detects an HONEST double-observe, not a malicious
  plant); tolerable ONLY because SHADOW.
- **The `merge_commit_sha` body field is labeled** (field-level prose) as gh-reported-at-observe-time, NOT
  verified-equal-to-`approval_hash`.

### observer + wiring (reviewer MEDIUM-1/HIGH-2/LOW-2/MEDIUM-3)

- **The observer's `merged !== true` refuse is OBSERVABLE** — `emitEgressAlert('merge-outcome-not-merged', ...)`
  fires BEFORE the early return (the most common operator mistake: running `observe-merge` pre-merge).
- **Extract `parsePrUrl` into a new dependency-free `parse-pr-url.js`** imported by BOTH `cli.js` and
  `merge-observer.js` — so `merge-observer.js` (the sole kernel-reader) does NOT transitively require all
  of `cli.js` (which constructs `ORCHESTRATOR_LESSONS` at load). Keeps the reader narrow.
- **issueRef forward-contract note** in the record design: the merge-outcome record deliberately does NOT
  denormalize `issueRef` (it is in the sealed join-key, retrievable via `loadJoinKey(join_key_id)`). Item
  3 re-loads the join-key to obtain `issueRef` for the edge basis — document so item-3's builder doesn't
  try to parse it from the URL (impossible).
- **The lab dam matcher for `merge-outcome-store` is "zero external importers (outside `world-anchor/`)"**
  — same shape as the sibling store dams, NOT a temporal "zero consumers in PR-2" claim. Item 3 will need
  a symmetric relaxation when it consumes `loadMergeOutcome`.

## VALIDATE result (3-lens, post-build, 2026-06-28)

Delegated build (node-backend, isolated worktree). Board: `code-reviewer` (PASS — all folds verified), `hacker`
(live-probe, NEEDS-REVISION — 1 CRITICAL + 1 MEDIUM + 1 LOW), `honesty` folds already baked pre-build.
All findings folded + each mitigation premise-probed on its real path:

- **C-1 (CRITICAL, dam bypass) — FIXED + PROVEN.** The dam missed a whole-module-require + computed/bracket
  reader (`const s = require(store); s['load'+'JoinKey'](id)`) — no literal `loadJoinKey(` token, not a
  destructure, so both prior halves missed it (hacker proved it live: planted reader → "9 passed"). Fix: an
  ACCESS-PATTERN-AGNOSTIC require-allowlist (`REQUIRE_RE` matches ANY require of the store; the requiring-file
  set must be EXACTLY {emit-pr.js, merge-observer.js}) + a matcher-exercising non-vacuity test. PROVEN:
  re-planted the exact bypass → dam now FAILS (exit 1); after cleanup → 11 passed.
- **M-1 (MEDIUM, comment-fooled lint) — FIXED + PROVEN.** The EC1b.2a GET-gate lint matched
  `assertReadOnlyGhArgs(args);` even in a comment, so a commented-out runtime gate still passed. Fix:
  strip comments before `GET_GATE` + export `defaultRunner` + a test proving it invokes the gate
  (write-arg throws before spawn). PROVEN: commented the real gate → lint FAILS ("missing GET-gate"); restored → 51 passed.
- **L-1 (LOW) — FIXED.** `merged:null` now reports `merged_type:'null'` (was `'object'`).
- **reviewer LOW-2 — FIXED.** cli.js's async dispatch gained a `.catch()` (clean exit-1 on an unexpected throw).

Final: full kernel suite **107/0**, full lab/world-anchor **11/0**, eslint clean, signpost up to date. The 4
causal-edge test failures are **pre-existing on main** (environmental sandbox/judge-deploy state), not a PR-2
regression. Real-gh dogfood: `verifyMerge` against merged PR #447 → `{ok:true, merged:true, c698d52…}`; the
orphan (no join-key) fail-closes E2E.

## Drift Notes

- route-decide scored `root` but fired `[ROUTE-META-UNCERTAIN]` (token "attestation") — escalated to the
  3-lens VERIFY board by judgment (genuinely architect-shaped: a real attestation-vs-join-key basis fork).
- The panel corrected my own START-HERE over-scope (the `to_delta_ref` rebind → item 3). Captured as a
  re-scope note, not silent drift.
- The VERIFY board caught the dam-relaxation bypass class (substring/basename allowlist) BEFORE build —
  the same "prove the guard can fail" non-vacuity discipline that #447 needed. Folded as build-binding.
