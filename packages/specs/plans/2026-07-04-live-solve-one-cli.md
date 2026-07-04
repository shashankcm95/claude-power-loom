# Plan — `live-solve-one`: a single git-issue → PR entry point (SHADOW/dry)

## Motivation

The substrate had no single entry point for "one git issue in → draft PR out" — the colophon#27 dogfood needed a scratch driver to wire `buildPublicRecord` + `runLiveDraftLoop` by hand. Promote that into a proper, tested CLI + the missing single-issue populator. All SHADOW/dry (emit off by construction).

## Runtime Probes (firsthand, this session)

- `ENDPOINT_RE = /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/commits\/HEAD)?$/` (`live-puller.js:54`) — **REJECTS `/issues/N`.** Probe: `re.test('repos/schmug/colophon/issues/27') === false`. So the guarded gh path cannot fetch a specific issue as-is → the regex must be extended (a security-guard widening).
- Guards are all imported into `live-puller.js` scope: `validatePublicRecord` from `./corpus`; `assertSafeRepo`,`assertSafeSha` from `./_clone-lifecycle`; `assertSafeOwnerRepo`,`ghApiReadArgs`,`buildPublicRecord` local. So a single-issue populator co-located in `live-puller.js` reuses the EXACT guard sequence `pullLiveCorpus` uses (`:229-246`).
- `buildPublicRecord` validates `number` (positive integer) and constructs the canonical URL (`live-puller.js:136-145`); `parseRecordRef` (`live-draft-run.js:63`) re-extracts `issueRef` from `id`'s `-issue-N` suffix.
- `runLiveDraftLoop` (`live-draft-run.js:352`) defaults: `solveFn=solveLiveIssueContained`, `gradeFn=gradeLiveIssueSemantic`, `emitFn=emitPR` (dry), judges tool-pinned. Threading NO egress custody opts → `emitPR`'s 3 fail-closed defaults (dry-run + no-token + killswitch) → `emitted:false`. (Mirrors `live-loop-run.js`.)
- Artifacts convention (`live-loop-run.js:28-35`): `~/.claude/checkpoints/live-loop-*`. Mirror as `live-solve-*`.

## Design

### Change 1 — `packages/lab/issue-corpus/live-puller.js`

1. Extend the guard regex to allow a digit-only issue suffix:
   `ENDPOINT_RE = /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/commits\/HEAD|\/issues\/[0-9]{1,15})?$/`
   (`[0-9]{1,15}` is digit-only + anchored + length-capped below 2^53's 16 digits — no `..`/`/`/traversal; a true re-assertion of the caller's own safe-integer validation, never weaker. The 15-cap folds architect finding F1.2.)
2. Add + export `fetchOneIssueRecord({ owner, repo, number, ghRunner = defaultGhRunner })` — the single-issue populator, reusing the identical guard sequence:
   - `assertSafeOwnerRepo(`${owner}/${repo}`)`; validate `number` is a positive safe integer BEFORE it reaches the endpoint.
   - GET `/issues/${number}` → `{title, body}` (now permitted by ENDPOINT_RE).
   - GET repo meta → `isPrCapable` + license-compatible: **HARD-refuse** a non-PR-capable or non-permissive repo (a safety gate — do not autonomously solve where we cannot/should not PR). (Do NOT enforce `isUnassigned` — the caller explicitly targeted this issue; assignment is a puller candidate-filter, not a safety gate.)
   - GET `/commits/HEAD` → `assertSafeSha(base_sha)`.
   - `buildPublicRecord(...)` → `assertSafeRepo(record.repo)` + `validatePublicRecord(record)` → return the record.

### Change 2 — `packages/lab/persona-experiment/live-solve-one.js` (NEW CLI)

- Args: `<owner>/<repo>#<N>` (a single positional target), `--model`, `--max-budget-usd <n>`, `--json`. `--materialize` maps to `LOOM_PERSONA_MATERIALIZE` for the run (default off = the SHADOW default).
- `fetchOneIssueRecord(...)` → `runLiveDraftLoop({records:[record], artifactsDir, ledgerPath, capUsd, model})`, artifacts default `~/.claude/checkpoints/live-solve-*`.
- Prints a per-stage summary (persona, verdict, cost, draft-artifact path = the "PR" output) + `--json` for the raw report. Exit 0 on draft-written; non-zero on fatal/usage.
- SHADOW/dry by construction: threads NO egress custody → `emitted:false`. Injectable `fetchFn`/`draftFn` seams for tests (no network).

### Change 3 — tests

- `tests/unit/lab/issue-corpus/live-puller.test.js` (extend): `fetchOneIssueRecord` with the injected `mockRunner` — happy → record; bad/zero/float number → throw; unsafe slug → throw; bad sha → throw; non-permissive license → refuse; non-PR-capable → refuse. Plus `ghApiEndpoint('..','..','/issues/27')` now passes and `/issues/2a` / `/issues/../x` still fail.
- `tests/unit/lab/persona-experiment/live-solve-one.test.js` (NEW): arg parse (`owner/repo#N`, flags, bad args → usage exit); wiring with injected `fetchFn`+`draftFn` → record built + loop called + summary printed + exit codes; fatal path fail-soft.

## Safety / invariants

- Untrusted GitHub input (title/body/repo/sha) flows through the SAME guards as `pullLiveCorpus`; the CLI adds no un-guarded path.
- The ENDPOINT_RE widening is digit-only + double-guarded (caller number-validation + regex re-assertion).
- SHADOW/dry: no egress custody threaded; `emitPR` fail-closes to `emitted:false`. The CLI sets no arming flag, touches no `/etc/loom`.
- New `.js` → `node scripts/generate-signpost.js --check` before push.

## HETS Spawn Plan

route-decide = `root` (no team). Per-wave lenses still apply given the untrusted-input + guard-widening:
- **VERIFY (pre-build):** architect — design soundness, esp. the ENDPOINT_RE change + the license/PR-capable hard-refuse decision + the SHADOW-dry guarantee.
- **VALIDATE (post-build):** code-reviewer (correctness/tests) + hacker (adversarial: does `/issues/[0-9]+` open any injection? can a crafted issue/repo/sha bypass a guard? does any path emit?).

## VERIFY result

Two independent architect passes (the KB-citation gate false-fired on the async-launch stub; both real reviews arrived via completion). Both **SOUND-WITH-CHANGES**, converging. Findings folded into the build:

- **[HIGH] slug-guard-first / no re-split.** `fetchOneIssueRecord`'s FIRST statement is `assertSafeOwnerRepo(\`${owner}/${repo}\`)` and it uses the returned `{o,r}` exclusively; number-validation precedes the `/issues/N` GET. The CLI `parseTarget` splits on the FIRST `/` only, so any extra `/` stays in `repo` and is rejected downstream. **Folded + tested (i4, r1).**
- **[MED] length-capped regex.** `ENDPOINT_RE` uses `/issues/[0-9]{1,15}` (< 2^53's 16 digits) so it is a true re-assertion of the caller's safe-integer guarantee, never weaker. **Folded + tested (j1/j2).**
- **[MED] all GETs via `ghApiReadArgs`** (the `-X GET` pin + `ENDPOINT_RE` re-assertion); no bespoke args array. **Folded.**
- **[MED] `isPrCapable`/`isLicenseCompatible` reused BY IMPORT** (fail-closed / exact-set semantics can't drift); `isUnassigned` skipped for a targeted issue. **Folded + tested (i6/i7).**
- **[HIGH] gh error/rate-limit handling.** `fetchOneIssueRecord` rethrows TYPED + value-redacted (raw execFileSync stderr — which can echo ambient-token context — never surfaces); the CLI `main()` top-level catch turns any throw into a clean non-zero exit. **Folded + tested (i9, r7).**
- **[MED] SHADOW-dry as a TESTED invariant.** No argv flag maps to `deps.emitFn`/`loopDeps`/any custody path; `fetchFn`/`draftFn` are test-only; an import-exclusion test asserts no egress-arming import + only `LOOM_PERSONA_MATERIALIZE` set. **Folded + tested (r4, r8).**
- **[MED] `-issue-N` END-anchor** (a repo named `*-issue-*` is safe): **tested (i2).** PR-vs-issue refusal added: **tested (i5).**
- **[LOW] base_sha snapshot** (pinned at fetch time; staleness is a Part-B/emit concern, inert in SHADOW): documented in `fetchOneIssueRecord`.

**Real-path check (Rule 2a):** `fetchOneIssueRecord` invoked against the LIVE `schmug/colophon#27` (3 real gh reads) produced a valid record — the widened endpoint + fetch work end-to-end, not just the mock.

## VALIDATE result

Two lenses on the BUILT code (both LIVE-probed, not read-only):

- **code-reviewer: APPROVE** — 0 CRITICAL/HIGH/PRINCIPLE. Live-probed the guard order, endpoint boundaries, the fatal-report summary (no crash on `oc===null`), and confirmed `validatePublicRecord` rejects an empty `problem_statement`. 2 MEDIUM folded (a note on the deliberately-unwired `estimatedUsd`; tests for the `--json` + fatal-report branches, r9/r10).
- **hacker: 0 CRITICAL / 0 HIGH / 0 bypasses across 31 hostile inputs.** The two architect-flagged HIGH-risk surfaces HELD under live boom-runner probing: no crafted slug (traversal / encoded-slash / homoglyph / ZWSP / control-char) reaches gh (all rejected pre-gh); no endpoint injects a flag; the 15-digit cap is lossless-safe. Untrusted title/body flows ONLY through `boundProblemStatement` (control-strip + 64 KiB bound); a `ghp_`-token error is redacted; the SHADOW-dry emit invariant is airtight (proved `emitted:false` with `LOOM_EMIT`/`WORLD_ANCHOR_ARM` set — no argv/env can arm). 2 MEDIUM folded:
  - **M1** `--model` now charset-validated (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, no leading dash) — closes the arg-injection-into-`claude --model` surface (proved shell-inert via the wrapper's `exec "$@"`, but fail-closed is right). Tested (r11).
  - **M2** `--materialize` now SCOPES `LOOM_PERSONA_MATERIALIZE` (set around the solve, RESTORED in a finally) — no un-scoped process-global leaking into a subsequent `run()`. Tested (r6).

**Final:** puller 40/0, CLI 11/0, eslint 0, 0 regressions across the issue-corpus + persona-experiment suites, signpost current. Real-path fetch confirmed against the live `schmug/colophon#27`.

## VALIDATE result

_(pending)_
