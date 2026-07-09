# 2026-07-09 — Egress operator emit-CLI (the missing armed-emit runner)

> Living plan. Builds the operator-run step that calls `emitPR` with an approved draft + custody
> config to open a real GitHub PR — the piece the egress substrate is missing (`approve-cli.js`
> mints an approval, but nothing runs the armed `emitPR`; the only prod caller is `live-loop-run.js`,
> EMIT-OFF by design). Prereq for the Rung-1 live dogfood: emitting the corrected #536 fix through the
> real egress path. This CLI is normal substrate tooling (a normal PR, USER-merged); the #536 fix is
> then emitted THROUGH it (the egress-armed dogfood).

## Goal

A `packages/kernel/egress/emit-cli.js` that mirrors `approve-cli.js`: reads a `draft.json`
`{repo, issueRef, diff}` + operator-provided custody paths, calls `emitPR(data, opts)`, and
interprets the return fail-closed. Claude builds + reviews + PRs it. The OPERATOR (never Claude) then
deploys the broker, arms, mints the approval via `approve-cli`, and runs this CLI. Claude never
touches `/etc/loom`, sets an arm flag, or runs the armed emit (task_d722450d).

## Runtime Probes (contract, firsthand-verified this session)

- `emitPR(data, opts)` builds + scrubs the draft ITSELF from `data`; custody comes ONLY from `opts`.
  Probe: [emit-pr.js:525-572](../../kernel/egress/emit-pr.js) read this session.
- REQUIRED opts for a live same-owner emit: `killswitchPath` (ARM file = literal `ARMED`),
  `custodyDispositionPath` (`{mode:"live"}`), `custodyTokenPath`, `custodyVerifyKeyPath`
  (`/etc/loom/verify.pem` in deploy), `custodyApprovalsDir`, `ghConfigDir` (empty custody dir).
  Probe: emit-pr.js:542-544,580,612 + `buildEmitEnv` throws on absent/non-empty ghConfigDir (:82-91).
- `data` may carry ONLY `{repo, issueRef, diff, lesson_commitment?}`; `assertDataIsPolicyFree` +
  `DISPOSITION_KEY_SET` fail-close any custody-shaped key. Probe: emit-pr.js:248-257,195-240.
- Draft-consistency: the ONLY byte-identical requirement between the mint side (`approve-cli`) and the
  emit side is the raw `data.diff`; both feed `computeEmissionHash(emissionAxiom(draft))` over
  `{repo, issueRef, diff}` (title/touched_paths dropped). Probe: approval.js:62-79; approve-cli.js:91-93,253.
- The approval is written `<hash>.approved` in `custodyApprovalsDir` and CONSUMED (unlinked) on any
  `emitted:true`. Probe: approval-store.js:154,164-167; emit-pr.js:615.
- For #536 the solve reported `lesson_captured:false` → `data.lesson_commitment = ''` (no lesson).
  Probe: the live-solve-one run report this session.
- No existing operator emit runner. Probe: `grep emitPR( / custody*Path` this session → only
  emit-pr.js (self), live-loop-run.js (empty opts, EMIT-OFF), tests.

## Requirements

**Functional**
1. Parse argv mirroring `approve-cli`'s style: `--draft <path>` (required), `--approvals-dir`,
   `--killswitch`, `--disposition`, `--token`, `--verify-key`, `--gh-config-dir` (all required for a
   live emit); optional `--lock`, `--cap-state`, `--etiquette-ledger`, `--join-key-dir`, `--ttl-ms`,
   `--host-allowlist`, and a lesson-commitment reproduction path (`--lesson-signature`/`--lesson-body`
   or `--lesson-commitment`) for the lesson case.
2. Read the same `draft.json` `approve-cli` signed; build `data = {repo, issueRef, diff}` (+
   `lesson_commitment` only when a lesson rode the approval, recomputed identically to approve-cli).
3. Build `opts` from the operator flags ONLY.
4. Call `emitPR(data, opts)` and interpret the return:
   - `ok:true, emitted:true` → print `pr.pr_url`, exit 0.
   - `ok:true, emitted:false, reason:"awaiting-approval"` → print `approvalReason`, exit 1.
   - `ok:true, emitted:false` (no approvalReason) → not-live / no-token / killswitch-on: print
     `disposition` + `draft.approvalHash` (so the operator knows the hash to approve), exit 1.
   - `ok:false` → fail-closed error: print `reason`, exit 1.

**Safety invariants (load-bearing — the VERIFY board must confirm)**
- S1 — **custody NEVER from the draft.** `data` is built from the draft file's `{repo, issueRef, diff}`
  ONLY; every custody path comes from argv. A draft that smuggles a `token`/`killswitchPath`/`disposition`
  key must NOT influence `opts` and must NOT reach `data` (emitPR would reject it, but the CLI strips it
  first). This is the #273 data/opts separation at the CLI layer.
- S2 — **fail-closed.** Any parse/read error, missing required flag, or `emitPR {ok:false}` → non-zero
  exit + a clear reason; never a false "emitted".
- S3 — **observable.** The failing `approvalReason` / `reason` is printed (not swallowed) so a first-live
  run is debuggable (the whole path is done-DARK).
- S4 — **no fork owner.** Same-owner emit never passes `custodyForkOwnerPath` (fork mode is dormant;
  `OBJECT_SHARING_PROBE_RECORDED=false` would throw). The CLI has no `--fork-owner` flag.
- S5 — **ASCII-only, zero eslint-disable** (ADR-0006); functions < 50 lines; testable seams exported.

## Design

`packages/kernel/egress/emit-cli.js` (~120-150 lines, mirrors approve-cli.js):
- Pure helpers (exported for tests): `parseArgv(argv)`, `buildData(draftObj, lessonOpts)`,
  `buildOpts(flags)`, `formatResult(res)` → `{stdout, exitCode}`.
- `run(argv, deps = {})` — `deps.emitFn = emitPR` by default (injectable for tests); reads the draft
  file via approve-cli's exported `readDraftFile` (`statSync` + isFile + 8 MiB cap — symlink-permissible
  and content-gated, NOT `O_NOFOLLOW`: the draft PATH is operator-provided, the CONTENT is the trust
  boundary), assembles data+opts, calls `emitFn`, and RETURNS `{exitCode, stdout?, stderr?}` (no
  `process.exit`; the non-exported `main()` writes the streams + sets `process.exitCode`).
- `if (require.main === module) run(process.argv.slice(2))`.
- `module.exports = { run, parseArgv, buildData, buildOpts, formatResult, USAGE }`.

## The corrected draft artifact

A `draft.json` `{repo:"shashankcm95/claude-power-loom", issueRef:536, diff:<CORRECTED diff>}` — the
loadNode try-wrap + regression test (saved `dogfood-536-CORRECTED.patch`). The operator points BOTH
`approve-cli --draft` and `emit-cli --draft` at this one file.

## Test plan (TDD — write tests FIRST)

`tests/unit/kernel/egress/emit-cli.test.js`:
1. `buildData` extracts ONLY `{repo, issueRef, diff}` from a draft — and a draft carrying a smuggled
   `token`/`killswitchPath`/`disposition` key yields data WITHOUT it (S1, non-vacuous: assert the
   smuggled key is absent from both data and opts).
2. `buildOpts` maps every flag to the right opts key; custody paths come only from flags.
3. `run` with an injected `emitFn` returning `{ok:true,emitted:true,pr:{pr_url}}` → exit 0 + url printed.
4. `run` with `{ok:true,emitted:false,reason:"awaiting-approval",approvalReason:"sig-invalid"}` →
   exit 1 + `sig-invalid` printed.
5. `run` with `{ok:true,emitted:false,disposition,draft:{approvalHash}}` → exit 1 + hash printed.
6. `run` with `{ok:false,reason:"…"}` → exit 1 + reason.
7. Missing `--draft` (or a required custody flag on the live attempt) → usage error, exit 1.
8. INTEGRATION (real emitPR, no network): `run` with `deps.emitFn=emitPR`, a temp draft, and a custody
   config whose killswitch is ABSENT (→ ON) → real emitPR returns `emitted:false` before armedEmit →
   the CLI reports not-live/killswitch. Proves the CLI wires to the REAL emitPR (Rule-2a: not just a mock).
9. Lesson path: a draft + `--lesson-signature/--lesson-body` → `data.lesson_commitment` recomputed ===
   `approve-cli`'s `computeLessonCommitment` (non-vacuous: assert it matches the approve-cli helper).

## Operator runbook (deliverable — read-only; Claude never runs these)

`docs/deployment/loom-emit-runbook.md`: broker deploy (`scripts/loom-broker-deploy-macos.sh` +
`docs/deployment/loom-broker.md`) → pin `/etc/loom/{verify,edge-verify}.pem` → arm flags → write the
custody disposition (`{mode:"live"}`), token, killswitch ARM file, empty ghConfigDir → `approve-cli
--draft draft.json` (sign-what-you-see, as a distinct uid) → `emit-cli --draft draft.json <custody
flags>` → real PR opens → USER merges. Flagged FIRST-LIVE (done-DARK; expect friction).

## HETS Spawn Plan (VERIFY board — required: egress/security diff)

Pre-build, 3 lenses in parallel on THIS plan + the design:
- **architect** — the CLI boundary + the data/opts separation (S1); does the design reuse approve-cli's
  safe-read + argv conventions; is anything a dead-guard.
- **hacker** — can a hostile draft file smuggle custody into opts/data (S1)? can any flag combination
  produce a false "emitted"? is the fail-closed real (S2)? the lesson-commitment dead-lock.
- **code-reviewer** — correctness of the return interpretation, exit codes, the test plan's
  non-vacuousness, ASCII/eslint/function-length, testable seams.

## Routing Decision

```json
{ "recommendation": "route", "why": "new egress/security-sensitive CLI touching the emit chokepoint; multi-file; the #273 data/opts separation + fail-closed are load-bearing" }
```

## VERIFY board result (folded — 3 lenses, strong convergence)

Verdicts: architect READY-WITH-NOTES, hacker READY-WITH-NOTES (no CRITICAL, no custody-smuggle/fail-open),
code-reviewer NEEDS-REVISION. All folded before build:

- **[HIGH] `approvalHash` is a TOP-LEVEL return field** (arch F1 + cr) — `formatResult` reads
  `res.approvalHash`, never `res.draft.approvalHash`; the not-live test asserts the exact hash.
- **[HIGH] `run()` uses `process.exitCode`, never `process.exit()`** (cr) — `run(argv, deps)` returns
  `{stdout?, stderr?, exitCode}`; a non-exported `main()` does the stream-writes + exit (mirror
  approve-cli's `runApprove`/`main` split) so tests can call `run` without killing the runner.
- **[HIGH] `formatResult` fail-closed default** (hacker H3) — success ONLY on
  `res.ok===true && res.emitted===true` (strict `===`); every other/unknown shape → exit 1.
- **[HIGH] draft read = `readDraftFile` from approve-cli** (all 3) — `statSync`+isFile+8MiB cap
  (symlink-permissible, content-gated — NOT `O_NOFOLLOW`); reused via the new approve-cli export.
- **[HIGH] exit codes 2=usage / 1=refusal / 0=success; failures → stderr** (cr + hacker L3) — the 7
  core custody flags are UNCONDITIONALLY required (KISS; drops the muddy "required for a live emit").
- **[PRINCIPLE] lesson path DEFERRED** (arch F2 + hacker H2 + cr) — no lesson flags; `buildData` omits
  `lesson_commitment` (emitPR defaults `''`); a lesson-bearing draft fails CLOSED (safe). When needed,
  derive from the DRAFT's own `lesson_signature`/`lesson_body`, never argv.
- **[MED] whole-pipeline try/catch** → any throw (JSON.parse / ENOENT / emitPR validator) → clean
  `{exitCode:1, stderr}`, never a stack trace (+ a malformed-draft test).
- **[MED] `buildData` explicit exact-key pick** `{repo, issueRef, diff}` (never spread); test asserts
  `Object.keys(data)` is the exact set even with an extra/policy key in the draft (S1 exact-set).
- **[MED] deduped emit** reported distinctly (hacker M2): `res.pr.deduped` → "already emitted (deduped,
  prior PR)", not a fresh "opened".
- **[MED] integration test uses an isolated `lockPath`** (cr) so real-emitPR tests never collide.
- **[MED] `--etiquette-ledger` REQUIRED-for-live in the runbook** (hacker M4) — durable double-emit
  backstop (`consumeApproval` is best-effort + its return ignored). Kept as an OPTIONAL CLI flag,
  runbook-required. **Dropped** `--cap-state` / `--join-key-dir` / `--host-allowlist` (surplus; the
  last has a string/array trap).
- **[LOW] `--ttl-ms` Number-coerced** (reject NaN, usage exit 2); S4 fork-dormancy test
  (`custodyForkOwnerPath` always `undefined`, no `--fork-owner`); keep the flag-injection guard.
- **[HACKER H1 → runbook HARD precondition]** the emit-time `resolveVerifyKey` is a bare
  symlink-following read with NO owner check — the CLI CANNOT close it (emitPR re-reads the path).
  The runbook makes `/etc/loom/verify.pem` **root-owned in a root-owned dir** a HARD, checked
  precondition (the sole mitigation) and names the `resolveVerifyKey` `O_NOFOLLOW`+owner hardening as a
  co-arming follow-up. Fold into `docs/deployment/loom-emit-runbook.md`.
- **[LOW follow-up]** extract `egress/_lib/draft-io.js` (readDraftFile + cap) shared by both CLIs — for
  now approve-cli exports them; noted, not done this wave.

## VALIDATE result (3 lenses on the BUILT code, folded)

Verdicts: hacker **SHIP-WITH-NITS** (12 probe classes, 0 bypasses — the #273 data/opts separation +
the strict `ok===true && emitted===true` exit-0 gate held under live attack, incl. `__proto__`
pollution, FIFO/oversize draft, and every truthy-non-`===true` return shape → exit 1); honesty-auditor
**CLAIMS-HOLD** (all 13 folded VERIFY findings + S1/S2 traced to code+test; the S1 exact-set + the
real-emitPR integration called exemplary); code-reviewer **SHIP-WITH-NITS** (every emitPR return shape
correct + probed; 0 CRITICAL/HIGH).

Folded (all applied; `emit-cli.test.js` 18/18 green, eslint clean, siblings regress-clean):
- **M1 (hacker+cr):** exit 0 now REQUIRES a real `pr.pr_url` string — an `emitted:true` with no url is a
  fail-closed "malformed result", never a false "opened PR: undefined".
- **M2 (hacker):** a thenable return is refused LOUD (explicit "emit returned a Promise" diagnostic), not
  a silent universal not-armed — a landmine if `emitPR` ever goes async.
- **L1 (hacker):** a repeated custody flag is rejected (no silent last-win).
- **L2 (hacker):** `--ttl-ms` must be a positive integer (0 / negative / fractional / NaN / Infinity → exit 2).
- **L3 (hacker):** a `JSON.parse` failure maps to the stable reason "draft is not valid JSON" (emitPR
  validator messages still surface verbatim).
- **honesty L1:** the stale Design `O_NOFOLLOW` line corrected (the draft read is `statSync`, by design).
- **honesty M1:** this section (the recorded green run) added.
- **honesty L4 + cr MEDIUM:** two tests added — the opts-half of S1 (spy asserts custody comes only from
  argv, never the draft) and a real-emitPR validator-throw (valid-JSON draft missing repo/issueRef/diff →
  clean exit 1, no stack).

Deferred (follow-up, consistent with the VERIFY draft-io deferral): **cr PRINCIPLE** — extract a shared
`egress/_lib/cli-shared.js` (readDraftFile + MAX_DRAFT_FILE_BYTES + a shared `parseArgvFlags` incl. the
flag-injection guard) consumed by BOTH CLIs, so a future hardening of the security-relevant argv guard
can't be applied to one CLI and missed on the sibling. Not this wave (would touch both CLIs + add a file).

## Drift Notes

- The egress-armed path being the full broker deployment (not a light arming step) was surfaced by
  probing the actual path (runtime-claim-probe) rather than writing a runbook from the scoping doc's
  optimistic "arm killswitch/custody/approval" framing — the scoping doc under-weighted the broker lift.
