---
status: BUILD
plan-of: F-W4 M1, the disable-Actions-on-fork wire deferred from #492. A focused BUILD plan for the one remaining Claude-buildable mechanism piece of F-W4 that does not need an operator decision. SHADOW/dormant (behind isForkMode, never fires in prod), byte-identical same-owner. The design was already 3-lens VERIFY-blessed in the canonical scope plan (2026-07-02-fork-emit-fw4-arming-scope.md, VERIFY board section) and is unchanged; this plan re-grounds the probes at the current HEAD and puts the rigor on a 3-lens VALIDATE of the built diff.
---

# F-W4 M1 — disable GitHub Actions on the ephemeral fork (dormant)

M1 was DEFERRED at #492: M0 set `maintainer_can_modify=false`, which removed the
maintainer-push-to-workflows vector and demoted M1 from load-bearing to OPTIONAL
defense-in-depth. Its remaining value is against a REUSED / previously-enabled fork — the
steady-state `ensureFork` path, where an operator provisions one throwaway fork and every emit
after the first reuses it. A fresh fork defaults Actions-DISABLED, but a reused fork may have
had them enabled, so M1 EXPLICITLY (and idempotently) disables Actions on BOTH `ensureFork`
ready paths before any fork write.

This is the last mechanism piece of F-W4 that needs no operator decision (M2 waits on Q-M2; the
operator half O0-O5 waits on the operator). Canonical F-W4 contract + the split table + the
already-passed VERIFY board: `packages/specs/plans/2026-07-02-fork-emit-fw4-arming-scope.md`.

## Runtime probes (re-grounded 2026-07-03 @ `1dc75fb` — M0/VC-W1a shifted the `0e466bb` anchors)

- `ensureFork` is at `gh-emit.js:566`; TWO ready paths: the reuse path
  `verifyForkRepo(existing, ...)` (`:592`) then `return { ready: true }` (`:593`); the create path
  `verifyForkRepo(repo, ...)` (`:609`) then `return { ready: true }` (`:610`). The disable-Actions
  call goes on EACH, AFTER the verify (never PUT to an unverified/foreign repo), BEFORE ready.
- `ensureFork` is called ONLY under `if (isForkMode)` (`gh-emit.js:737`); prod is always same-owner
  (`resolvedForkRepo === upstreamRepo` => isForkMode false), so the new call never fires in prod.
- transport idiom (probed at the PR-create `:967-968` and the PATCH-close `:984`): a body-bearing
  call is `gh(['api', <endpoint>, '--method', <M>, '--input', '-'], { env, input: JSON.stringify(body) })`.
  The `POST /forks` sibling (`:599`) is body-LESS; M1 differs only in carrying a kernel-constant body.
- `runGh` THROWS fail-closed on any non-2xx (`:130-133`, deliberate contrast to safe-exec fail-open),
  so a failed disable-Actions PUT propagates out of `ensureFork` automatically — fail-closed is free.
- `emitEgressAlert` is imported (`:60`) and is the file's idiom for an OBSERVABLE fail-closed reject
  (every other reject site emits then throws) — M1 adds a SPECIFIC `fork-actions-disable-failed` alert.
- no `actions/permissions` call exists in `packages/kernel/egress/` today — M1 is a net-new dormant wire.

## GitHub platform facts (probed 2026-07-03 @ docs.github.com/rest/actions/permissions — not asserted)

- endpoint: `PUT /repos/{owner}/{repo}/actions/permissions`; body `{"enabled": false}` (`enabled`
  required; `allowed_actions` omitted when false). Effect: disables all workflow runs on the repo.
- token: a classic PAT needs the `repo` scope for this endpoint. NOTE (operator sub-question, below):
  the F-W4 O1 token is scoped `public_repo` (the narrower public subset) — whether `public_repo`
  suffices for `actions/permissions` PUT is an OPERATOR arming concern (O1), NOT a mechanism blocker;
  the dormant mock does not exercise a live token. Flagged as Q-M1-token-scope.

## Design (unchanged from the VERIFY-blessed scope; DRY-refined)

A single module-level helper (closes over nothing — matches the `ensureFork` code-reviewer PRINCIPLE
comment at `:559-561` that ensureFork builds its own endpoint strings and is independently testable):

```
function disableForkActions(gh, resolvedForkRepo, env) {
  try {
    gh(['api', `repos/${resolvedForkRepo}/actions/permissions`, '--method', 'PUT', '--input', '-'],
       { env, input: JSON.stringify({ enabled: false }) });   // kernel-constant body — no actor bytes
  } catch (err) {   // fail-closed + OBSERVABLE; PRESERVE runGh's diagnostic fields (folded per the VALIDATE below)
    emitEgressAlert('fork-actions-disable-failed', { resolvedForkRepo: <=80, httpStatus: err && err.httpStatus, message: <=200 });
    const e = new Error('ghEmit: fork-actions-disable-failed — the disable-Actions request failed on <repo> — fail-closed');
    e.cause = err; e.httpStatus = err && err.httpStatus; e.status = err && err.status;
    throw e;
  }
}
```

The SUCCESS path is BEST-EFFORT (a non-throwing 204 PUT is treated as disabled; the hard read-back
state-verify is a named arming precondition, M-1 in the VALIDATE result below).

Called at BOTH ready paths: after `verifyForkRepo` on `:592` and on `:609`, before each
`return { ready: true }`. ONE helper, TWO call sites (DRY; a single producer cannot wire only the
create path and miss the reuse path — the SCAR #21 catch). Not exported: exercised THROUGH
`ensureFork`/`ghEmit` like every other guard here (YAGNI — smallest module surface).

Fail-mode (Q-M1-failmode, RESOLVED fail-closed per the scope recommendation): the PUT throws on
non-2xx => `ensureFork` throws => the emit never reaches the write phase. A fork whose Actions could
not be confirmed-disabled is exactly the hazard M1 exists to close, so fail-closed is correct; the
`emitEgressAlert` makes the reject OBSERVABLE (the fail-silent security rule).

## Dormancy / byte-identity proof

`disableForkActions` is reached only from `ensureFork`, itself gated on `isForkMode`. Prod is always
same-owner => the call never fires => same-owner argv/bodies byte-identical. The golden-bytes gate
(tests 1-2, exact `deepStrictEqual(endpointsOf...)`) is same-owner and stays green. The new call is
exercised only by the fork-mode direct-`ensureFork` / `ghEmit` unit tests.

## Test plan (TDD — tests describe the new behavior first, run RED, then impl)

Harness: the mock `makeGh` router gains a `PUT repos/${forkId}/actions/permissions` route + a
`failActionsDisable` knob; TEST 17's inline mock gains the same route.

1. M1 reuse-path (ensureFork-direct, `forkGetSequence: [200]`): exact call sequence
   `['GET repos/botacct/repo', 'PUT repos/botacct/repo/actions/permissions']`; the PUT body parses to
   `{ enabled: false }`; method is PUT.
2. M1 create-path (ensureFork-direct, `forkGetSequence: [404, 200]`): the POST /forks then a readiness
   GET then the PUT fire; the PUT fires exactly once (the reuse path is not silently the only one).
3. M1 fail-closed (full ghEmit, `failActionsDisable: true`): ghEmit THROWS; `captureAlerts` shows
   `fork-actions-disable-failed`; `forkWriteCalls(gh).length === 0` (the emit never wrote to the fork).
4. M1 ordering (full ghEmit, fork mode): the PUT index precedes the first `POST repos/fork/git/trees`.
5. M1 dormant (same-owner `makeGh()`): zero `actions/permissions` calls (byte-identical; complements 1-2).

## Security invariants (the NEVER list — carries verbatim)

- Claude NEVER provisions a token, runs a live GitHub probe, sets a deploy-constant value, sets an
  arming flag, or runs `--attested-cross-uid`. M1 ships DORMANT; O0 (the operator gate) takes
  M1-deployed as a precondition before any arming.
- Claude NEVER touches, reads, or stats `/etc/loom` or `/opt/loom`.
- Merges are the USER's gate. Explicit named `git add`; the PACT doc stays untracked.
- #273 NARROWS-not-closes until a deployed cross-uid broker signs live edges (Part B).

## Open sub-question (operator, non-blocking for the dormant build)

- Q-M1-token-scope: does the O1 `public_repo`-scoped classic PAT cover `PUT actions/permissions`, or
  does the operator need the broader `repo` scope? GitHub docs say `repo`. This is an O1 provisioning
  detail the operator confirms at arming; it does not block the dormant mechanism (the mock has no
  token). Recorded here so O0/O1 pick it up. The M1 fail path now preserves `.httpStatus` on the throw
  and in the alert, so a `public_repo`-token 403 on this endpoint is diagnosable at arming.

## VALIDATE result (3-lens board, 2026-07-03 @ the built M1 diff)

Read-only 3-lens VALIDATE over the BUILT diff (code-reviewer + hacker-live-probe + honesty-auditor, parallel).

- **honesty-auditor: SHIP** — 8/8 claims TRUE, NO-OVERCLAIM (grade A). Dormancy doubly-anchored
  (`isForkMode` false + `forkRepo` never populated in prod); both call sites present; kernel-constant
  body; fail-closed AND observable; the token-scope gap honestly flagged as Q-M1-token-scope; no
  over-claim of M1's value (correctly scoped as OPTIONAL defense-in-depth post-M0). Its one named
  residual (log a real green run of the golden suite) is closed by the build's own runs (54/0 two-identity,
  1610/0 full kernel, 129/0 pre-push).
- **code-reviewer: SHIP-WITH-NOTES** — 0 CRITICAL/HIGH/MEDIUM, 1 LOW: the throw discarded `runGh`'s
  structured diagnostic fields (unlike the file's 6+ other catch sites). FOLDED.
- **hacker (live-probe, Rule 2a): SHIP-WITH-NOTES** — 0 CRITICAL/HIGH. All CRITICAL/HIGH-class attacks
  HELD under live probes against the BUILT code: actor-byte injection into the PUT body (body byte-exactly
  `{"enabled":false}` regardless of planted `draft` fields), dormancy (same-owner => 0 `actions/permissions`
  calls), endpoint traversal via `resolvedForkRepo` (all 6 payloads rejected pre-network by
  `NORMALIZED_REPO_RE`), fail-open on a THROWING PUT (fail-closed, 0 fork writes), observability, and
  skip-one-path (PUT fires once + before the first write on BOTH reuse and create). Two MEDIUM + one LOW,
  disposed below.

**Folds applied to the diff (this revision):**

- code-reviewer LOW + hacker L-1: the fail path now PRESERVES `.httpStatus`/`.status`/`.cause` on the
  thrown Error (mirroring the file's `ghJson` pattern) and adds `httpStatus` to the alert, with the alert
  `message` bounded to 200 chars. The fail-closed test asserts the preserved fields (mock throws a
  runGh-shaped `.httpStatus='403'`).
- honesty: the helper comment is reworded so the SUCCESS path is honestly marked BEST-EFFORT (a
  non-throwing 204 PUT is treated as disabled; it is not a hard state-verify), removing the
  confirm-disabled over-claim the hacker surfaced.

**Recorded as NAMED F-W4 ARMING preconditions (deferred, NOT folded — proportionate to a dormant, OPTIONAL,
triple-mitigated control; the hacker itself framed both as arming preconditions, and building the read-back
against an uncertain org-policy scenario on a dormant wire is YAGNI):**

- **M-1 (hacker MEDIUM) — state-verify the disable.** A 2xx PUT that did not actually disable (org-policy
  override / eventual consistency) is treated as confirmed. Before `isForkMode` can ever be true in prod,
  add a read-back `GET .../actions/permissions` and assert `enabled === false`, else fail-closed
  (`fork-actions-still-enabled`). This is an O0-class precondition (the deployed build must state-verify).
- **M-2 (hacker MEDIUM) — TOCTOU re-check at the H2 rebind.** Actions state is confirmed in `ensureFork`
  but not re-checked at the H2 identity-rebind (`gh-emit.js` H2 window) before the write. When M-1's
  read-back lands, also run it (idempotent) at the H2 rebind so the Actions check-to-use window matches
  the already-narrowed identity window.

**Board disposition: SHIP** (SHADOW, production byte-identical; dormant until F-W4 arms). The two MEDIUMs are
arming preconditions on a dormant path already triple-mitigated (`maintainer_can_modify=false` + the always-on
`.github/` egress denial + the fork Actions-disabled default), not this-wave blockers. Tests after fold:
two-identity 54/0; full kernel suite 1610/0; pre-push gate 129/0.
