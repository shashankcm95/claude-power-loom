---
title: "Wave D — auto-wire live-solve-one into the solve-queue (+ F4 preflight ensure-image)"
date: 2026-07-22
status: PLAN — pending architect VERIFY, then TDD build, then code-reviewer VALIDATE
lifecycle: persistent
routing: root (score 0.075; lab-substrate catch-22 — judgment applied; single-lens VERIFY + VALIDATE, not a full HETS team)
shadow: true   # weight-0, gates NOTHING; the queue is operational bookkeeping (Wave A invariant)
related:
  - packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md   # Side B stage 6 (merge-signal observability)
  - packages/lab/solve-queue/solve-queue-store.js                        # Wave A lifecycle store
  - packages/lab/solve-queue/merge-promote.js                           # Wave B poll -> mint (the downstream consumer)
---

# Wave D — solve->queue auto-wire (+ F4)

## Goal

Close the CAPTURE -> QUEUE gap so the autonomous loop runs end-to-end. Today `live-solve-one`
(`runLiveDraftLoop` -> `solveGradeDraftOne`) solves an issue, captures a `live_pending` lesson, and
dry-emits — but it NEVER records the solve into the Wave-A `solve-queue`. So the queue stays empty, and
the Wave-B poll-cron (#584) + `promoteMergedEntries` (#581) have nothing to observe. Wave D wires the
solve lifecycle INTO the queue, so a solve leaves a durable `drafted` entry carrying the Wave-B join key.

Plus **F4**: `preflightEnv` dies with `image-absent` when the `loom-actor:latest` tag silently vanishes
(observed this session). Add an opt-in ensure-image step (check + rebuild) so the live pipeline self-heals.

Everything is **SHADOW / weight-0**. The queue gates nothing; no arming; no PR emit; Claude never arms.

## Runtime Probes (firsthand — 2026-07-22)

| Claim | Probe | Result |
|---|---|---|
| solve-queue store has enqueue/advance and a `drafted` state | read `solve-queue-store.js` + `solve-queue-fold.js` | ops `enqueue/claimNext/advance/get/list`; lifecycle `queued->solving->drafted->in_flight->merged->minted`, `disposed` re-openable |
| Wave-B poll needs `candidate_patch_sha` on the entry | read `merge-promote.js:49,72` | `promoteOneInFlight` requires `ev.pr_url` AND `ev.candidate_patch_sha`; the sha is the join key to source the captured lesson |
| DRY pipeline can't reach `in_flight` | `emit` is DRY (no real PR); `in_flight` legal only from `drafted` and needs `pr_url` | Wave D takes an entry to **`drafted`** only; `drafted->in_flight` is the operator-armed emit (out of scope) |
| `candidate_patch_sha` = sidecar sha over the SCRUBBED candidate | read `live-draft-run.js:413` (disposal) + `captureLiveLesson` convention | `sidecarSha(scrubLabSecrets(solveRes.candidate))` — reuse verbatim so Wave-B join agrees |
| existing tests won't pollute the real ledger | read `live-draft-run.test.js:41` (`loopDeps` always sets semanticFn+frictionFn) | every test => `judgesInjected===true` => real queue ops default INERT (null); a test opts in via `deps.queueOps` |
| `lessonLegFn` DI pattern to copy | `live-draft-run.js:487` | hasOwnProperty presence check: explicit `deps.X` (incl. null) wins; real default built ONLY on `!judgesInjected` |
| F4 seam | `docker-actor-backend.js:173-175` | `attestActorContainment` returns `image-absent` when `!dockerImageExists`; build cmd is literally in the reason string |
| route gate | `route-decide.js --task "..."` | `root`, score 0.075 (lab-substrate catch-22) — judgment: single architect VERIFY + single code-reviewer VALIDATE, no full team |

## Design

### Part 1 — solve->queue wire (`live-draft-run.js` + `solve-queue-store.js` import)

**DI + isolation (mirrors `lessonLegFn`).** `runLiveDraftLoop` resolves `queueOps`:
```
const queueOps = hasOwnProperty(deps,'queueOps')
  ? deps.queueOps                                  // explicit (incl. null) wins
  : (!judgesInjected ? realQueueOps : null);       // real ops ONLY on the live-run path
```
`realQueueOps = { enqueue: store.enqueue, advance: store.advance }`. Threaded into `solveGradeDraftOne`
via `ctx.deps.queueOps`; `null` => every queue call is a no-op (test/DI path stays inert; the suite never
touches `~/.claude/lab-state/solve-queue`).

**2-point lifecycle (fail-soft, single helper).** Inside `solveGradeDraftOne`:
- **Start** (right after `ref` parse + classify succeed): `qCall(enqueue,{repo,issue_ref,persona})` then
  `qCall(advance, ->solving)`. (Parse-fail returns BEFORE this — nothing queued.)
- **Success** (the `ok:true, draft-written` terminus, before return): `qCall(advance, ->drafted,
  {candidate_patch_sha})` where the sha = `sidecarSha(scrubLabSecrets(solveRes.candidate))`.

`qCall(queueOps, op, ...args)`: no-op if `queueOps` null; else call, and on a throw OR `{ok:false}` emit
ONE `emitEgressAlert('solve-queue-wire-*', …)` (fail-closed-must-be-OBSERVABLE, security.md) and NEVER
change the record outcome (exact captureLiveLesson discipline — the wire is bookkeeping, never load-bearing).

**Failures rest at `solving` (named residual, v1).** A solve/grade/emit/artifact failure leaves the entry
at `solving`. This is HARMLESS: the poll only sweeps `in_flight`/`merged`, so a `solving` zombie is
invisible downstream — just untidy. A `dispose-on-failure` sweep is a deferred follow-up (keeps Wave D a
2-site wire, not a refactor of the 8-terminus function). Documented in the PR + carries.

### Part 2 — F4 ensure-image (`docker-actor-backend.js` + `live-draft-run.js` preflight)

- New `ensureActorImage({ dockerBin, image, build=false, buildFn })`: if `dockerImageExists` -> `{ok:true,
  built:false}`; else if `build` -> run `buildFn` (default: `docker build --provenance=false --sbom=false
  -t <image> - < Dockerfile.actor` via spawnSync), re-check -> `{ok:true,built:true}` |
  `{ok:false,reason:'still-absent-after-build'|'build-threw:…'}`; else `{ok:false,reason:'image-absent'}`.
- `preflightEnv` gains **opt-in** `deps.ensureImageFn`: when provided, run it before `attestFn`. Default
  (absent) => byte-identical current behavior (attest -> `image-absent`). The live-solve CLI wires
  `ensureImageFn = (o) => ensureActorImage({ ...o, build:true })`; tests inject a double. Building an image
  is a real side-effect => NEVER implicit; opt-in only. (Not an operator-only op — it's a normal local
  `docker build` from a repo Dockerfile; Claude may do it explicitly, as it did this session.)

## Test plan (TDD — tests first, run RED, then impl)

`live-draft-run.test.js` (queue wire):
- injected `queueOps` double records calls; happy-path solve => `enqueue` + `advance(solving)` +
  `advance(drafted,{candidate_patch_sha})`, sha == `sidecarSha(scrubLabSecrets(candidate))`.
- a failing solve => `enqueue`+`advance(solving)` but NO `advance(drafted)` (rests at solving).
- a `queueOps` op that THROWS or returns `{ok:false}` => outcome UNCHANGED + an observable alert (fail-soft).
- NO `queueOps` (default test path) => zero queue calls (isolation: real ledger untouched).
- explicit `deps.queueOps=null` beats the live default (presence-check).
- F4: `preflightEnv` with `ensureImageFn` returning built:true then attest ok => `{ok:true}`; ensure absent
  + default (no ensureImageFn) => unchanged `image-absent` path.

`docker-actor-backend.test.js` (ensureActorImage): present => no build; absent+build:false => `image-absent`;
absent+build:true+buildFn-restores => `{ok:true,built:true}`; absent+build:true+buildFn-noop =>
`still-absent-after-build`; buildFn throws => `build-threw:*`.

## Workflow

plan (this) -> **architect VERIFY** (design soundness + probe the join-key/isolation claims) -> TDD build
-> **code-reviewer VALIDATE** (single lens; SHADOW lab, not the kernel/security 3-lens tier) -> PR (USER merge gate).

## Architect VERIFY (2026-07-22) — findings folded

Verdict PROCEED-WITH-CHANGES. Join-key + isolation mechanically sound; folds:

- **HIGH F1 — null-persona enqueue defeats the wire.** `classifyFields.persona` is `null` for every
  no-persona (generic, D1-gap) issue; `enqueue` rejects `persona:null` (`bad-input`) → 3 spurious alerts,
  no entry, Wave B never sees the solve. **Fold:** build the enqueue input conditionally — `{repo:
  ref.slug, issue_ref: ref.issueRef}` and add `persona` ONLY when it's a non-empty string.
- **MED F2 — bind `ref.slug` / `ref.issueRef`, never `record.repo`/`record.id`.** Wave B compares
  slug-vs-slug (`merge-promote.js:54`); the entry repo MUST be the slug and issue_ref the number.
- **MED F3 — isolation via explicit opt-in, not `!judgesInjected`.** An enqueue fires UNCONDITIONALLY
  per record (unlike the deriver-gated `lessonWriteFn`), so `!judgesInjected` auto-enable would let a
  future loop-reaching test pollute the real ledger. **Fold:** two top-level params default OFF —
  `recordToQueue` (→ real queueOps) + `rebuildImageIfAbsent` (→ real ensureImageFn); `deps.queueOps` /
  `deps.ensureImageFn` are the explicit TEST seams (win via hasOwnProperty). The live entry points
  (`live-solve-one.js` CLI + `live-loop-run.js` scheduler) pass `recordToQueue:true`.
- **MED F4 — retry legality (no crying-wolf, no stale join key).** Read enqueue's returned `state`:
  `queued` → advance→solving (track); `solving` → resume, no re-advance (track); ahead
  (`drafted+`) → emit ONE `solve-queue-wire-skip-ahead` note, DON'T touch (first-solve-wins; its sha
  stays consistent). Only advance→drafted when tracking. Makes the "rest at solving" residual alert-free.
- **MED F5 — F4 default buildFn path.** Resolve `path.join(__dirname,'Dockerfile.actor')` (absolute; cwd
  isn't guaranteed repo-root); spawnSync with `timeout` + `maxBuffer` (a build is minutes-long/verbose).
- **LOW F6 — drafted-but-no-lesson.** Always carry `candidate_patch_sha` on `drafted` (valid regardless);
  a solve that captured NO lesson yields an entry whose sha joins to nothing → Wave B `skipped:
  no-captured-lesson` (harmless). Named, not gated.
- **LOW F7 — ensure-result handling + sha dedup.** `preflightEnv`: a non-ok `ensureImageFn` →
  `{ok:false, reason:'image-ensure-failed:'+reason}`. Compute `candidatePatchSha` ONCE in
  solveGradeDraftOne (after solve success) and reuse at BOTH the disposal site (was inline `:413`) and the
  drafted-wire → 2 of 3 sites deduped (capture's internal compute is the deferred DRY follow-up).

## VALIDATE result (2026-07-22) — code-reviewer lens on the BUILT diff (SHIP-WITH-NITS -> folded)

Both load-bearing invariants (fail-soft/outcome-purity + test isolation) verified clean against the code
+ dedicated tests. Two folds applied:

- **HIGH (fail-silent) — alert reason clobber.** `qCall`'s `-refused` alert passed `reason:` inside `detail`,
  but `emitEgressAlert`'s positional `reason` token is authoritative (`alert.js:19` — `Object.assign({},
  detail, {reason})`), silently dropping the real store reason (illegal-transition / lock-timeout / ...) —
  the exact `drift:fail-silent` trap this file documents 3 call sites away. **Fold:** rename the key to
  `refuse_reason` (premise-probed against alert.js firsthand). Pure observability regression (outcome-purity
  was never affected), but it defeats the alert's whole diagnostic purpose.
- **LOW — spurious illegal-transition on a failed solving-advance.** `qStartSolving` returned the entry_id
  even if the `queued->solving` advance failed (store lock-timeout), so a later `drafted` advance fired
  against a still-`queued` entry = a second misleading alert. **Fold:** gate the returned entry_id on the
  solving-advance actually landing (`adv.ok===true`); else return null (don't track; self-heals next run).
  Added a regression test.

Verified clean (no findings): join-key equals captureLiveLesson's + live-pending's basis; F1 persona-omission;
F4 opt-in-rebuild (no implicit build on any default/test path); no outcome-contract regression. 81/0 suite.

**CodeRabbit (async, post-PR; CHILL profile) — 2 nits, no Majors** (the board + VALIDATE caught the HIGHs):
- thread `ctx={repo, issue_ref}` through `qCall`/`qStartSolving` so a per-record queue alert IDENTIFIES the
  triggering issue (was op/reason/state only). Folded (also on the drafted-advance call site).
- add a live-loop test asserting the scheduler passes `recordToQueue:true` to `runLiveDraftLoop`. Folded
  (extended the existing STRUCTURAL emit-off test's draftFn spy).
- The skip-ahead "recurring-alert" note is an operational observation (no puller-dedup is wired) — behavior
  left unchanged per CodeRabbit's own guidance; a puller-dedup is out of scope for Wave D.

## Out of scope / carries
- `drafted -> in_flight` (needs the armed emit + a real PR) — operator-gated, later wave.
- dispose-on-failure sweep (zombie `solving` cleanup).
- the live cron dogfood on a real in-flight PR (this wave makes it POSSIBLE by populating the queue).
- DRY-extract a shared launchd-plist lib (ghost-heartbeat + solve-queue-schedule).
