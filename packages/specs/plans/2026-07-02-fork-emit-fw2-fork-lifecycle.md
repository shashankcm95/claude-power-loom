---
lifecycle: persistent
topic: fork-emit, F-W2, kernel-egress, fork-lifecycle, ensureFork, dormant
plan-of: the second wave of the fork-emit path — the fork lifecycle (POST /forks + readiness)
status: DRAFT — awaiting 3-lens VERIFY then TDD build
---

# F-W2 — the fork lifecycle (`ensureFork`), DORMANT / byte-identical

The second wave of the fork-emit path (F-W1 = the two-identity axis, MERGED #488 `ffa4e67`). F-W2 adds
`ensureFork` — create/verify the bot's fork of the upstream BEFORE any fork-side write — called by `ghEmit`
ONLY when `resolvedForkRepo !== upstreamRepo` (a real distinct fork). In F-W1's default (forkRepo absent =>
resolvedForkRepo === upstreamRepo), `ensureFork` is SKIPPED entirely, so the same-owner emit stays
**byte-identical**. `forkRepo` is still never populated this wave (that is F-W4), so `ensureFork` is
structurally DORMANT — built + mock-tested, exercised live only once F-W4 arms a real fork target.

## Scope decision (settled at recon; flag for the architect to confirm)

**F-W2 = the fork lifecycle ONLY.** The deferred `baseCommitSha` -> `approvalSigBasis` moved-base invalidation
(the architect's F-W1 corrected mechanism) is SPLIT OUT to its own wave (**F-W2b**), because recon confirmed it
is a cross-cutting SIGNED-BASIS change: `grep approvalSigBasis` shows it ripples through 4 production
re-derive/define sites (`approval.js` define, `verifyApproval` re-derive, `approve-cli` sign, `loom-broker-bind`
`authorizeRequest` recompute) — the exact shape of the OQ-3 W2 `lesson_commitment` binding
(`plans/2026-06-29-oq3-w2-approval-layer-binding.md`), which was a whole wave. Bundling it into the fork
lifecycle would sprawl F-W2 across gh-emit + approval + approve-cli + broker + mint-verify. Same KISS +
blast-radius + SRP reasoning the architect used to defer it OUT of F-W1. F-W2b is sequenced AFTER F-W2.

## THE LOAD-BEARING UNPROBED CLAIM (Q3 — names the F-W4 gate; NOT built-upon live this wave)

The fork-side write path (F-W1's `forkApi('git/trees'|'git/commits'|'git/refs')` with `parents:[baseCommitSha]`
+ `base_tree: baseTreeSha`, both UPSTREAM shas) relies on **fork object-sharing**: a commit created on the fork
can reference upstream-only git objects. **GitHub's official docs NEVER state this** (doc-research 2026-07-02:
Create-a-commit/tree/ref references are silent on cross-fork object existence; "fork network" is referenced but
never technically defined; the strongest signal — private-fork commits "migrated to a network" on a visibility
change — is about a migration, not API cross-referencing). Community lore says fork networks DO share a
server-side object store and this pattern works, but that is NOT official.

**Treatment (runtime-claim-probe discipline):** F-W2 builds the fork-CREATION mechanism (needed regardless of the
write approach) and keeps F-W1's upstream-sha write path UNCHANGED. It does NOT build `merge-upstream` (YAGNI —
only needed if object-sharing fails). The object-sharing claim is **F-W4's #1 HARD live probe** (operator-gated:
it forks a throwaway repo + attempts `POST /repos/{fork}/git/commits {parents:[upstreamSha]}` and observes
201-vs-422). If that probe FAILS, a small F-W2b-sibling adds `merge-upstream` + switches the write base to the
fork's synced tip. F-W2 never runs live, so it does not depend on the unprobed claim — it only NAMES it.

## Runtime probes (firsthand + doc-cited, 2026-07-02)

- **Insertion point** (firsthand, `gh-emit.js` on `ffa4e67`): `validateForkIdentity` returns
  `{resolvedForkRepo, forkOwner}` at `:565`; the two helpers `upstreamApi`/`forkApi` at `:566-567`; base
  resolution `:569-582`; the FIRST fork write is the tree POST at `:657`. `ensureFork` inserts after `:567`,
  gated on `resolvedForkRepo !== upstreamRepo`.
- **`POST /forks` = 202, ASYNC** (docs.github.com/en/rest/repos/forks — verbatim "you may have to wait a short
  period of time before you can access the git objects"). No documented poll contract => design a bounded poll.
- **Idempotency DOC-SILENT** (Q2) => defensive: `GET /repos/{fork}` first, `POST /forks` only on 404.
- **Response body = full Repository** with `full_name`, `owner.login`, `source.full_name` (the C1 fork-of-upstream
  assert reads `.fork` + `.source.full_name`).
- **`merge-upstream`** exists (`POST /repos/{fork}/merge-upstream {branch}`) — NOT built this wave (Q3-gated).

## The `ensureFork` design (dormant; each reject ALERTS then throws — fail-closed security boundary)

`ensureFork({ upstreamRepo, resolvedForkRepo, forkOwner, expectedForkOwner }, { gh, env, sleep })`:

1. **Defensive idempotency (Q2):** `GET /repos/${resolvedForkRepo}`. If it 200s, VERIFY it is a fork of THIS
   upstream: `repo.fork === true && normalize(repo.source.full_name) === upstreamRepo` (the C1 pre-network bind
   the F-W1 board deferred here) AND `forkOwner === repo.owner.login`-normalized AND (if `expectedForkOwner`
   provided) `forkOwner === expectedForkOwner`. On any mismatch: `emitEgressAlert('fork-not-of-upstream'|
   'fork-owner-mismatch')` + throw. If it 404s, go to (2).
2. **Create (202) + bounded readiness poll:** `POST /repos/${upstreamRepo}/forks` (kernel-constant envelope — no
   actor bytes; NO `name`/`organization`/`default_branch_only` params, so the fork is `${forkOwner}/${upstreamName}`
   with all branches). Then poll `GET /repos/${resolvedForkRepo}` with BOUNDED exponential backoff (injectable
   `sleep`; default a pure-node synchronous wait; e.g. <= 10 attempts, total <= ~2 min, well under GitHub's 5-min
   escalation). On the first 200, run the SAME fork-of-upstream verification as (1). On exhausting the budget:
   `emitEgressAlert('fork-readiness-timeout')` + throw (fail-closed — never write to an unconfirmed fork).
3. Return `{ ready: true }` (or throw). PURE of any tree/commit/ref write — `ensureFork` only creates + verifies.

`sleep` is injectable (opts/deps) so tests drive the 404-then-200 readiness path with ZERO real waiting; the
default is a synchronous, timer-free wait (e.g. `Atomics.wait` on a throwaway `Int32Array`) — no busy-loop, no
`Date.now()`.

## Also in F-W2 (the deferred F-W1 items that belong with the fork lifecycle)

- **Fork-branch-TIP assert (deferred from F-W1):** in the dedup 422-reconcile path, before returning a deduped PR,
  `GET /repos/${resolvedForkRepo}/git/ref/heads/${branch}` and assert `.object.sha === commit.sha` (the commit we
  just created). A pre-existing branch whose tip is NOT our commit => `emitEgressAlert('fork-branch-tip-mismatch')`
  + fail-closed (do not launder loom's envelope onto foreign fork content). BYTE-IDENTICAL on the happy path (this
  is inside the 422 path only). Mock: the fork-ref GET returns our commit sha on the reconcile path.
- **Owner/name length cap (hacker VALIDATE LOW, F-W1):** add a length bound in `validateForkIdentity`
  (`resolvedForkRepo.length <= 100`, owner segment `<= 39` — GitHub's login max) AND — consistently — in
  `assertSafeRepoRef` (`emit-pr.js`) for `upstreamRepo`. Turns a fail-late (a 500-char owner 404s at the network)
  into a fail-fast + observable alert. Cheap; lands the F-W1 deferral before F-W3 gives forkRepo a live head.

## What stays UNCHANGED (byte-identical)

The entire same-owner emit path: `ensureFork` is gated on `resolvedForkRepo !== upstreamRepo` (false in F-W1
default), so ZERO new calls fire; the base resolution, the write sequence, the dedup happy path, the golden-bytes
argv/bodies — all identical to `ffa4e67`. The golden-bytes regression test is the acceptance gate.

## TDD test list (tests FIRST, red, then build to green)

New tests in `tests/unit/kernel/egress/gh-emit-two-identity.test.js` (+ a `validateForkIdentity`/`assertSafeRepoRef`
length case):

1. **Golden-bytes STILL byte-identical** — no forkRepo => `ensureFork` never called, argv/bodies unchanged (re-run
   the existing golden assertions; they must still pass).
2. **`ensureFork` skipped in same-owner** — with resolvedForkRepo === upstreamRepo, ZERO `/forks` or fork-`GET`
   calls fire.
3. **`ensureFork` happy — fork already exists** — GET 200 + `.fork===true` + `.source.full_name===upstream` =>
   no POST /forks, proceeds.
4. **`ensureFork` creates on 404** — GET 404 => POST /forks (202) => readiness GET 200 => verified.
5. **Readiness poll retries** — GET 404-then-404-then-200 across the injected `sleep` => succeeds; assert the
   poll count + that `sleep` was called (injected, no real wait).
6. **Readiness timeout fails closed** — GET stays 404 past the budget => `fork-readiness-timeout` alert + throw,
   NO tree/commit/ref write.
7. **Fork-not-of-upstream fails closed** — GET 200 but `.fork===false` OR `.source.full_name` != upstream =>
   `fork-not-of-upstream` alert + throw, zero writes.
8. **expectedForkOwner mismatch** — GET 200 fork but owner != expectedForkOwner => throw.
9. **Fork-branch-tip assert (dedup)** — 422 reconcile: fork ref tip != our commit.sha => `fork-branch-tip-mismatch`
   + fail-closed; tip === commit.sha => dedup proceeds.
10. **Length cap** — a >100-char resolvedForkRepo / >39-char owner => fail-closed in `validateForkIdentity`; a
    >39-char upstream owner => fail-closed in `assertSafeRepoRef`. Each NON-VACUOUS (proven to fire).
11. **Non-vacuity** — each new guard exercised on its RED path (inject the violation, watch the alert fire).

## HETS Spawn Plan

kernel/egress/security => FULL 3-lens tier REQUIRED at VALIDATE (Rule 2): code-reviewer + hacker (Rule 2a, live
probes on the BUILT `ensureFork`) + honesty-auditor. PRE-BUILD: 3-lens VERIFY (architect + code-reviewer +
hacker) on THIS plan — architect confirms the F-W2/F-W2b split + the dormant-ensureFork boundary + the
object-sharing-probe-deferral honesty; hacker probes the readiness-poll TOCTOU + the fork-of-upstream assert.
Routing: substrate kernel-egress security, non-trivial => `route`.

## Runtime Probes (claims this plan makes)

- Insertion point + line numbers -> firsthand read of `gh-emit.js` @ `ffa4e67` (above).
- `POST /forks` 202/async/idempotency-silent/merge-upstream -> doc-research 2026-07-02 (cited above), NOT firsthand.
- Fork object-sharing (Q3) -> DOC-SILENT, UNPROBED -> F-W4 operator live probe (NAMED, not built-upon live here).

## Drift Notes

- F-W2 is FULLY DORMANT (like F-W1): `ensureFork` never runs live until F-W4 populates a real forkRepo. This is
  the incremental-mechanism pattern (small tested waves) — but note honestly that the fork-CREATION path, like the
  write path, is mock-tested only; the operator live-probe at F-W4 is the first real exercise. Flagging so the
  VERIFY board confirms this is honest incrementalism, not enforcement-on-an-unprobed-harness-mechanism (it is the
  former: F-W2 ships no live dependency).
- The Q3 object-sharing deferral is the single most important honesty line: if the operator probe fails, F-W2's
  assumption (upstream-sha write base) is wrong and a merge-upstream sibling is needed. Named, not hidden.

## Pre-Approval Verification (3-lens VERIFY board, 2026-07-02)

**Board: architect + code-reviewer + hacker (read-only, parallel).** UNANIMOUS: the F-W2/F-W2b split is sound
(architect RATIFIED it on SRP + blast-radius grounds vs the OQ-3 W2 precedent), the dormant-`ensureFork` boundary
is honest incrementalism (no live dependency), the insertion point + byte-identity are correct. Each returned
NEEDS-REVISION on `ensureFork`'s trust binding + the mock/test precision. All folds below are AUTHORITATIVE build
directives; they SUPERSEDE contradicting body prose above.

**CRITICAL (hacker C1) — bind the fork to LOOM's identity, not just "a fork of upstream":**
- The assert `.fork===true && .source.full_name===upstream` proves the target is a fork of the RIGHT upstream, NOT
  that it is LOOM's fork. An attacker who owns `attacker/{upstreamName}` (a legit fork of upstream) would pass it,
  and loom would write tree/commit/ref into the attacker's repo + open a PR `head=attacker:branch` — loom's envelope
  on attacker-force-pushable content (the fork-side re-open of the dedup-laundering hole). FIX: **`expectedForkOwner`
  is MANDATORY in `ensureFork`** (fail-closed + `emitEgressAlert('fork-owner-required')` if absent), and assert BOTH
  `forkOwner === expectedForkOwner` (the resolved target's owner is the expected bot) AND
  `normalize(repo.owner.login) === expectedForkOwner` (the ACTUAL fork's owner from the API is the expected bot).
  `expectedForkOwner` is a CUSTODY value (the bot login, from the same source that mints the token) — F-W4 MUST
  supply it whenever it populates `forkRepo`. Byte-identical preserved: `ensureFork` is unreachable in same-owner
  mode, so the mandatory check never fires there.

**HIGH:**
- **isNotFound helper + non-404 re-throw (code-reviewer).** `runGh` throws on ANY non-2xx. Add `isNotFound(err)`
  (mirror `isAlreadyExists` at `:138`, match `HTTP 404`/`Not Found` on `err.stderr`). In `ensureFork`: a GET that
  throws is 404 => proceed to create; any OTHER throw (5xx/403/network/unparseable) => **re-throw immediately**
  (fail-closed), never folded into the create-or-keep-polling branch. TDD: a non-404 GET failure during the poll
  throws immediately, does NOT consume the retry budget.
- **TOCTOU re-bind before the write + PR (hacker H2/H3).** The fork verified at readiness-200 is name-bound, not
  handle-bound, and 4 upstream GETs intervene before the first fork write (`:657`). FIX: re-assert fork-of-upstream
  (a fresh `GET /repos/{fork}` + the C1 shape/owner/source checks) IMMEDIATELY before the first fork write, AND
  re-read the fork ref tip (`=== commit.sha`) immediately before the PR-create (`:709`) on BOTH the ref-CREATE and
  the 422-reconcile paths (the tip assert currently guards only the 422 path). Alert `fork-branch-tip-mismatch` +
  fail-closed. NOTE these guards are name-bound (GitHub has no CAS handle) — state that residual honestly.
- **Gate F-W4 arming on a RECORDED object-sharing probe (hacker H1).** Deferring the Q3 probe is honest ONLY if
  arming is hard-gated: the live fork-WRITE path must assert "Q3 probe PASSED and recorded" as a precondition, so a
  future wave physically cannot arm the fork write without the probe. F-W2 names this as an F-W4 GATE (not just a
  Drift Note); the write path fail-closes if the probe result is unrecorded.

**MEDIUM:**
- **Defensive `.source` shape + both-sides normalize (hacker M1).** Before the equality: require `repo.fork===true`,
  `repo.source && typeof repo.source.full_name === 'string'`, `typeof repo.owner.login === 'string'`; on any shape
  violation `emitEgressAlert('fork-shape-invalid')` + throw (a bare `TypeError` on a null `.source` is neither
  fail-closed nor observable). Lowercase BOTH sides of `source.full_name === upstreamRepo` (upstream is normalized-
  lowercase; `full_name` is canonical-cased — a one-sided compare false-mismatches a legit mixed-case upstream AND
  could false-match a case-variant squat).
- **Poll budget = HARD KERNEL CONSTANTS (architect F-5 + code-reviewer + hacker M3 — triple convergence).**
  `FORK_READINESS_MAX_ATTEMPTS` + the backoff schedule are module `const`s (like `MAX_BASE_BYTES` at `:75`), NEVER
  caller-overridable opts. ONLY `sleep` is injectable (the wait MECHANISM, for test speed), never the budget.
  **Pin the EXACT formula:** attempt 1 = immediate GET; on 404, `sleep(min(250 * 2^(attempt-1), 20000))` ms then
  retry; give up (throw `fork-readiness-timeout`) after `FORK_READINESS_MAX_ATTEMPTS = 8` WITHOUT sleeping after the
  last failed attempt. Total worst-case ~= 250+500+1000+2000+4000+8000+16000 = ~31.75s (< the 5-min GitHub
  escalation). Tests 5/6 assert this exact attempt count + sleep-call count.
- **Reuse `_lib/lock.js`'s `_waitSleep` (code-reviewer PRINCIPLE/DRY).** It already solves SAB-unavailable
  (try/catch + busy-wait fallback) + the `Atomics.wait(NaN)`-blocks-forever guard. Extract its core to a shared
  `packages/kernel/_lib/sleep.js` (egress is `@loom-layer: kernel` and MAY import `kernel/_lib`) and import it as
  the default `sleep`; do NOT hand-roll a second `Atomics.wait`.
- **POST /forks body test (code-reviewer).** Assert the `POST /forks` args/input EXACTLY: the kernel-constant
  envelope carries NO body (or exactly `{}`) — no `name`/`organization`/`default_branch_only`, zero actor bytes.
- **Post-poll verification test (code-reviewer).** The create-then-poll path's terminal 200 MUST run the SAME
  fork-of-upstream + owner verification as the immediate-200 path; add a test exercising a MISMATCH on the post-poll
  path (not only the immediate-200 branch), so the two verification call-sites can't silently diverge.
- **Non-vacuous red tests (hacker M2).** Each new guard test asserts the SPECIFIC alert token AND zero fork writes
  (`git/trees|git/commits|git/refs` on the fork), not merely "a throw occurred."

**LOW / forward-contract:**
- **F-W2b MUST precede F-W3's live-head arming (architect F-1).** The moved-base signature hazard first bites when a
  live fork target whose branch can lag is written to (F-W3). State this sequencing invariant.
- **Fork-name-collision dead-end (architect F-3).** If the bot already has a fork of a DIFFERENT upstream at
  `bot/{name}`, the GET 200s + `.fork===true` but `.source.full_name != upstream` => fail-closed PERMANENT block (no
  POST fallback; the bot fork namespace is flat). Name it as an F-W4 operator concern; the `POST /forks {name}`
  rename param (currently omitted) is the disambiguation lever — a named forward-option.
- **Label the fork-tip assert NON-LOAD-BEARING in F-W2 (architect F-4)** — vacuous in same-owner (like F-W1's
  post-create backstop); scaffolding placed early so F-W3 inherits it.
- **Object-sharing is ALREADY load-bearing in merged F-W1 (architect F-2).** F-W2 INHERITS the dormant
  `parents:[baseCommitSha]` write dependency (`gh-emit.js:660`), does not introduce it. Correct the honesty line.
- **Alert vocab (architect F-7).** New tokens are free-string (alert.js does not enumerate — F-W1 F-9 N/A);
  reconcile `fork-owner-mismatch`/`fork-owner-required` against the existing `fork-identity-mismatch`/`fork-owner-unsafe`
  (`:435,442`) so the reject vocabulary stays coherent (no near-synonyms).
- **Cite owner<=39 (architect F-6 + code-reviewer LOW)** — reframe the length-cap justification from "cheap" to
  "closes the F-W1-deferred fail-late window before F-W3 makes forkRepo live"; cite GitHub's 39-char login max.

**Mock/test-infra folds (code-reviewer HIGH-2/HIGH-3 — get agreed before TDD):**
- Extend `makeGh`: a `GET repos/${resolvedForkRepo}` route (distinct from `repos/${upstreamRepo}` at `:84`) with a
  `forkGetSequence` (return 404 N times then 200) for the retry test; a `POST repos/${upstreamRepo}/forks` route; a
  `forkRepoMeta` override for the `.fork`/`.source`/`.owner` shape tests. Make the `/git/ref/heads/` dispatch
  ENDPOINT-STRING-AWARE (distinguish `repos/${upstream}/git/ref/heads/${base}` => SHA_A, unchanged, from
  `repos/${fork}/git/ref/heads/${branch}` => the fork-tip sha) so the fork-tip assert doesn't perturb tests 1/2.

**Disposition:** DESIGN-READY (architect, split ratified) + NEEDS-REVISION-folded (code-reviewer + hacker) => the
folds above are the revision. None re-architect `ensureFork`; they tighten its trust binding (C1 owner-to-custody,
H2/H3 re-bind, M1 shape defense) and pin the mock/backoff so the TDD tests are the spec, not the reverse. Build
against this section.

## VALIDATE result (post-build 3-lens board, 2026-07-02)

Built by a delegated `node-backend` builder (TDD). The BUILT diff got the full 3-lens VALIDATE (Rule 2; Rule 2a —
the hacker ran ~45 LIVE node probes against the built `ensureFork`/`verifyForkRepo`/`sleepSync`):

- **code-reviewer: SHIP** — 0 CRITICAL/HIGH/MED; 1 PRINCIPLE (ensureFork builds its own endpoint strings — a
  documented deliberate exception, it is standalone-testable) + 1 LOW (F6 exact count). Hand-traced the 5-call
  fork-GET sequence; confirmed byte-identity + the verbatim `sleepSync` lift.
- **hacker: SAFE-TO-SHIP** — ~45 live probes, 0 exploitable bypasses. C1/M1/M3/H2/H3 all HOLD under live attack;
  same-owner byte-identical (0 fork calls). Findings folded (M-1, M-2) + Part-B directives (below).
- **honesty-auditor: CLAIMS-NEED-CORRECTION (grade B)** — 21/22 folds landed; caught the ONE miss: the H1
  arming gate was documented, not coded. Folded (below). Other claims (byte-identity, non-vacuous guards, DRY
  lift) CONFIRMED; the F6 GET-count retarget confirmed an HONEST fix.

**Folds applied post-VALIDATE (this diff):**
- **H1 arming gate BUILT (honesty-auditor HIGH).** `OBJECT_SHARING_PROBE_RECORDED = false` is a HARD kernel
  constant in `emit-pr.js`; `armedEmit` (the custody-only production entry F-W4 will use to populate a live
  forkRepo) now FAILS CLOSED with `object-sharing-unprobed` on any populated `forkRepo` until F-W4 flips the
  constant (with the live-probe evidence in that commit). Placed at `armedEmit` (not `ghEmit`) so the ghEmit
  fork-mode MECHANISM stays directly unit-testable while the PRODUCTION path is gated. The old F-W1
  "armedEmit threads forkRepo" test is repurposed to prove the gate (a populated forkRepo is refused BEFORE ghEmit).
- **M-1 (hacker) — case-normalize `expectedForkOwner`.** GitHub `owner.login` is canonical-cased; `forkOwner` is
  lowercase — a canonical-cased custody value would fail-closed EVERY legit fork emit. Now lowercased on both sides
  at every owner compare (`verifyForkRepo`, `ensureFork`, `validateForkIdentity`); new test M-1.
- **M-2 (hacker) — `sleepSync` hard ceiling.** `MAX_SLEEP_MS = 60000` caps a large FINITE `ms` inside the shared
  primitive (a future caller can't hang the process); extracted a pure `clampSleepMs` so it is testable without a
  real wait; new test M-2.
- **PRINCIPLE (code-reviewer)** — one-line comment noting ensureFork's independent endpoint strings are a deliberate
  standalone-testability exception. **LOW** — F6 tightened to `=== 5` fork-GETs (exact regression net).

## F-W4 arming preconditions (MUST be satisfied before F-W4 populates a live forkRepo)

These are NAMED, tracked directives — not F-W2 code (F-W2 is dormant). The F-W4 builder MUST address them; the H1
gate makes the first one physically enforced.

1. **Object-sharing probe (H1 — gate is BUILT).** Run the operator live-probe: fork a throwaway repo, attempt
   `POST /repos/{fork}/git/commits {parents:[upstreamSha]}`, observe 201-vs-422. Only if it PASSES may F-W4 flip
   `OBJECT_SHARING_PROBE_RECORDED = true` (with the evidence in the commit). Until then `armedEmit` refuses every
   populated forkRepo. If it FAILS: the upstream-sha write base is invalid — add the `merge-upstream` sibling.
2. **`expectedForkOwner` -> a DEPLOY CONSTANT (hacker H-1/A3).** The guards verify CONSISTENCY, not PROVENANCE
   (#273): the whole fork path's safety reduces to `forkRepo`/`expectedForkOwner` being custody-only. They are
   today (armedEmit named args, never `draft`, deny-listed at the actor boundary). Before arming, bind
   `expectedForkOwner` to a deploy-time constant (like `draft:true`), NOT a per-call param, and add a live probe
   asserting no actor path reaches armedEmit's fork args.
3. **The H2/H3 TOCTOU residual is NAME-bound, not handle-bound (hacker M-3).** GitHub exposes no CAS primitive, so
   a delete+recreate in the sub-request window is undetectable. Acceptable for DRAFT + human-merge (PATH-1); NOT
   sufficient for any ready-PR / auto-merge arming — keep documented and re-visit there.
4. **Fork-name-collision dead-end (architect F-3).** `bot/{name}` is a flat namespace; a prior fork of a DIFFERENT
   upstream at that name is a fail-closed permanent block. Ensure a clean fork namespace or use `POST /forks {name}`.
5. **F-W2b (baseCommitSha -> approvalSigBasis) MUST precede F-W3's live-head arming (architect F-1).**

**Gate:** 168 egress/lib tests (two-identity 41 + gh-emit 57 + emit-pr 61 + sleep 5 + lock 4) + full kernel suite
(116 files) green; eslint clean, zero eslint-disable; signpost up-to-date. Same-owner emit byte-identical (golden
literals unchanged). **DISPOSITION: SHIP** (SHADOW, emit-OFF, byte-identical; ensureFork dormant; H1 gate DARK).
