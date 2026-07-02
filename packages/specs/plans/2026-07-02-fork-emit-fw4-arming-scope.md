---
status: SCOPE
plan-of: F-W4 the arming wave of the fork-emit path (token posture plus live probes plus dormancy flip). A SCOPE artifact, not a build plan; it splits F-W4 into the Claude-buildable MECHANISM half (stays SHADOW/dormant) and the OPERATOR-only ARMING half (live token, live probes, flag flips), and enumerates the open design questions that need the operator before any arming edit.
---

# F-W4 — arming-wave scope (mechanism half vs operator half)

After F-W1 (#488) + F-W2 (#489) + F-W2b (#490) + F-W3 (#491), the fork-emit MECHANISM is
COMPLETE: two-identity axis, fork lifecycle (`ensureFork`), moved-base invalidation, and the
cross-repo PR-open (`head=forkOwner:branch` + `maintainer_can_modify`) are all built and
mock-tested. Every one is SHADOW/dormant: production `emitPR` never populates `forkRepo`, so
`isForkMode` is always false and the emitted `gh` argv/bodies are byte-identical to the
same-owner path. F-W4 is the wave that turns dormancy into a live fork PR against a repo the
bot does not own.

**F-W4 is unlike F-W1..F-W3: it is not a single dormant code wave.** It mixes a small
Claude-buildable dormant/hardening half with an operator-only arming half (real token, real
GitHub probes, flag flips, deploy-constant values). This document scopes both halves and the
decisions the operator must make before the arming half runs. **No code is built by this
document; no live step is run.**

## The split (the load-bearing artifact)

| Piece | Owner | Live? | What it is |
|---|---|---|---|
| M1 disable-Actions-on-fork wire | Claude | dormant | wire `PUT /repos/{fork}/actions/permissions {enabled:false}` into `ensureFork`; fires only in fork mode (off in prod) |
| M2 `expectedForkOwner` -> trusted source | Claude (pending O-decision) | dormant | stop sourcing the fork owner from a co-forgeable field; read it from a deploy-trusted source (#273). Value is operator-set |
| M4 F3 structural single-producer pin | Claude | test-only | pin the single validated head-origin so a refactor cannot silently reintroduce an unvalidated `${forkOwner}:` interpolation (the SCAR #22 decline, mechanically enforced) |
| M5 fork-mode golden-bytes literal | Claude | test-only | freeze the exact fork-mode PR body/argv as a FROZEN golden literal so a future key-reorder fails a byte-diff |
| O1 provision token | Operator | LIVE | a throwaway-bot classic `public_repo` PAT (the only capable token class; fine-grained PATs cannot open cross-repo PRs) |
| O2 object-sharing live probe | Operator | LIVE | run the Q3 probe against a real fork; on pass, record the evidence and flip `OBJECT_SHARING_PROBE_RECORDED` in that commit |
| O3 set `expectedForkOwner` deploy value | Operator | LIVE | set the bot login as the deploy-trusted constant M2 reads |
| O4 the arming edit | Operator | LIVE | populate `forkRepo` + `expectedForkOwner` on the `emitPR` production call (`emit-pr.js:545`) so `isForkMode` goes true |
| O5 flip the deploy flag | Operator | LIVE | `LOOM_WORLD_ANCHOR_ARM` / the fork-mode deploy gate (strict explicit-truthy per `security.md`) |

**Security boundary (load-bearing, unchanged):** Claude NEVER provisions a token, runs a live
GitHub probe, sets a deploy-constant value, touches `/etc/loom` or `/opt/loom`, sets an arming
flag, or runs `--attested-cross-uid`. The operator runs O1..O5. Claude scopes the mechanism half
(M1/M4/M5, and M2 once its source is decided) and writes the operator runbook.

## Runtime probes (current state — grounded 2026-07-02 @ `0e466bb`)

- `OBJECT_SHARING_PROBE_RECORDED = false` -> `emit-pr.js:411` (HARD const; O2 flips it).
- `MAINTAINER_CAN_MODIFY` -> `gh-emit.js:84` (HARD const). Base ref @ `0e466bb` = `true`; **this wave (M0) flips it to `false`** (Q-M1-necessity RESOLVED) and DEFERS M1 as optional, so the maintainer-edit surface is removed AT THE SOURCE rather than mitigated by an in-band disable. (Snapshot line kept as the base-ref probe; superseded by the M0 build below.)
- production `emitPR` call passes `{draft, token, ghConfigDir, approvalHash, requestedBaseSha}` and NOT `forkRepo`/`expectedForkOwner` -> `emit-pr.js:545` (confirms fork mode is dormant in prod; O4 is the arming edit).
- no `actions/permissions` call exists in `packages/kernel/egress/` today -> M1 is a net-new dormant wire.
- no fork-mode golden literal exists in `gh-emit-two-identity.test.js` today -> M5 is net-new.
- signpost + release-surface clean at `0e466bb`.

## GitHub platform facts (researched + cited 2026-07-02 — load-bearing for Q-M1-necessity)

Verified against GitHub docs (not asserted from memory):

- **`maintainer_can_modify` semantics:** enabling it grants "maintainers of the upstream repository
  (that is, anyone with push access to the upstream repository)" the ability to "commit to the pull
  request's compare branch" — i.e. loom's FORK branch. When that branch contains workflows (a fork
  INHERITS them), the setting escalates: the label becomes "Allow edits AND access to secrets by
  maintainers," and a maintainer can edit the fork's workflows, "which can potentially reveal values
  of secrets and grant access to other branches." Source:
  docs.github.com/en/pull-requests/.../allowing-changes-to-a-pull-request-branch-created-from-a-fork.
- **Fork Actions default:** a newly-created fork does NOT run its inherited workflows by default —
  the fork owner must dismiss the "Workflows aren't being run on this forked repository"
  interstitial in the Actions tab to enable them (public-fork scheduled workflows are explicitly
  disabled by default). Caveat: pushing changes under `.github/workflows/` can silently enable
  Actions on a fork — but loom's egress DENIES `.github/` paths (`isEgressDeniedPath`), so loom's
  own writes never trip that. Sources: docs.github.com Actions "Disabling and enabling a workflow" +
  community discussions #50736 / #53510.

**Consequence:** the fork default is Actions-DISABLED, so M1 (explicit disable) ASSERTS the safe
default (defense against a REUSED / previously-enabled fork), it does not close an open-by-default
hole. And `maintainer_can_modify=true` is the capability that most directly re-opens the
workflow-edit surface. These two facts resolve Q-M1-necessity in favor of `false` (below).

## Claude mechanism half (dormant / hardening — recommended build order)

### M1 — disable Actions on the ephemeral fork (the F-W3 inherited-workflow catch)

**Why:** `maintainer_can_modify:true` grants the upstream maintainer push access to the fork
branch. A GitHub fork INHERITS the upstream's `.github/workflows` at `POST /forks`. The always-on
`.github/` egress denial (`isEgressDeniedPath`, `emit-pr.js:288`) covers only loom's EMITTED tree,
NOT the fork's inherited state (SCAR #21). So a live fork carries workflows the emitted-tree guard
cannot reach. Disabling Actions on the fork closes the Actions-EXECUTION surface before any
maintainer push. **It does NOT close the whole `maintainer_can_modify` hazard** (hacker VERIFY):
that flag also grants the maintainer PUSH access to loom's fork branch — content laundering inside
the H3 name-bound `assertForkTip` window (`gh-emit.js:890`, name-bound not handle-bound per the
`:862` admission), plus any deploy keys / installed apps a REUSED fork carries. Those are a SEPARATE
residual; the strictly-smaller alternative (drop the flag) is Q-M1-necessity below.

**Necessity (grounded):** a fresh fork defaults Actions-DISABLED (GitHub platform facts above), so
M1 ASSERTS the safe default rather than closing an open hole — its value is against a REUSED /
previously-enabled fork. If Q-M1-necessity resolves to `maintainer_can_modify=false` (recommended),
M1 demotes to OPTIONAL defense-in-depth (the maintainer-push-to-workflows vector is gone) and may be
deferred; if `true`, M1 stays load-bearing.

**Where (BOTH return sites — hacker VERIFY H-MED-1):** `ensureFork` (`gh-emit.js:566`) has TWO
distinct fork-ready return points, and the disable-Actions `PUT` must precede EACH:
(a) the idempotent existing-fork path, before `return { ready: true }` at `gh-emit.js:593` (this is
the STEADY-STATE path — an operator provisions one throwaway fork and reuses it, so every emit after
the first hits ONLY this branch); (b) the create-then-ready path, before the post-poll
`return { ready: true }` at `gh-emit.js:610`. Wiring only the CREATE block would leave the reuse
path (the common case) with Actions still enabled. Each is a single `gh(['api',
'repos/${resolvedForkRepo}/actions/permissions', '--method', 'PUT', ...], {env})` with a
kernel-constant `{enabled:false}` body (no actor bytes, mirroring the `POST /forks` no-body
envelope), placed AFTER the `verifyForkRepo` on that path. **Test requirement:** assert the
`actions/permissions` PUT fires on the single-200 existing-fork mock sequence, not only the
404-then-create sequence.

**Dormancy proof:** `ensureFork` is called ONLY when `isForkMode` is true (`gh-emit.js:737`);
prod is always same-owner, so the new call never fires in production. Same-owner golden-bytes
unchanged. The new call is exercised only by the existing fork-mode direct-`ghEmit` unit tests.

**Open sub-question (operator):** if the disable-Actions `PUT` returns non-200, does `ensureFork`
fail-closed (refuse the emit) or proceed? Recommendation: fail-closed + `emitEgressAlert` — a fork
whose Actions could not be confirmed-disabled is exactly the hazard M1 exists to close.

### M4 — F3 structural single-producer pin (SCAR #22, mechanically enforced)

**Why:** at F-W3, both VERIFY lenses recommended a head-site `OWNER_RE` re-assert; on
implementation it was provably-unreachable dead code (a duplicate of `validateForkIdentity`'s
check), so it was correctly DECLINED (theater per `security.md` non-vacuous-guard). The decline
rests on there being exactly ONE validated origin for the `${forkOwner}:` interpolation. A future
refactor could add a second, unvalidated origin and silently reopen the gap. M4 pins the
single-origin invariant with a STRUCTURAL test (a grep-style assertion that `forkOwner` reaches the
`head` sink from exactly the one `validateForkIdentity`-blessed binding), preferred over the dead
`OWNER_RE` per the F-W3 VALIDATE recommendation.

**Dormancy proof:** test-only; no production behavior change.

### M5 — fork-mode golden-bytes literal (freeze the arming target)

**Why:** the same-owner path has FROZEN golden literals (`GOLDEN_PULL_BODY` etc.,
`gh-emit-two-identity.test.js:48-51`) so a key-reorder fails a byte-diff. Fork mode has none. The
fork-mode PR body is DETERMINISTIC even while dormant (the `isForkMode` path is exercised by
direct-`ghEmit` unit tests), so its golden bytes can be frozen NOW. Freezing it before arming means
O4 cannot silently regress the fork-mode payload, and the same-owner golden re-run proves arming
did not disturb byte-identity.

**Dormancy proof:** test-only; asserts the already-built dormant fork-mode path.

### M2 — `expectedForkOwner` from a trusted source (#273; build pending O-decision)

**Why:** `expectedForkOwner` binds the fork write to LOOM's identity (C1, MANDATORY in
`ensureFork`). Today it would arrive as an `armedEmit` arg. Per #273 (integrity is not provenance),
a value the actor can influence should not steer the write: the fork owner should come from a source
OUTSIDE the actor envelope. **This NARROWS the surface (removes it from actor-supplied bytes) but
does NOT make it a trust anchor** (hacker VERIFY H-LOW): per the repo's own #273 canon, a custody /
deploy-config value is still SAME-UID co-forgeable, and `expectedForkOwner` only BINDS the write
target to a claimed owner login (an identity check at `gh-emit.js:500` / `:577`) — it is
defense-in-depth, NOT the authorization root. The authorization anchors stay the signed approval
(`approvalHash`) + the token capability; M2 does not change that.

**Why it is NOT purely Claude's to build:** the SOURCE is a deploy decision (an env var the
operator sets, a deploy-config file, or a kernel-owned custody value). Claude can build the reader
shape once the source is chosen, but must not pick the deploy mechanism unilaterally, and must not
set the value. **This is an OPEN QUESTION for the operator (below), not a ready-to-build M.**

## Operator arming half (runbook — NOT run by Claude)

These are documented for the operator. Claude does not execute any of them.

**O0 (hard ordering gate — before O2's flip / O4 / O5; hacker VERIFY H-MED-3).** Confirm the
DEPLOYED kernel already contains M1's in-band disable-Actions wire, verified by a fork-mode dry-run
trace on the deployed build (the `actions/permissions` PUT must appear on BOTH the reuse and create
paths). Do NOT flip `OBJECT_SHARING_PROBE_RECORDED` or arm a live fork write on a build where M1 is
absent or the deployed binary is stale — that would create + write a live fork with inherited
workflows ENABLED and `maintainer_can_modify=true`, exactly the SCAR #21 hazard M1 closes. M1 ships
dormant first (const stays false); the const-flip PR takes M1-merged-and-deployed as a precondition.

1. **O1 — token.** Provision a throwaway-bot classic `public_repo` PAT. Rev-3 doc-confirmed: only
   classic PATs open cross-repo PRs; fine-grained PATs cannot. Keep it out of source; it reaches
   `gh` only via `buildEmitEnv({token}).GH_TOKEN`.
2. **O2 — object-sharing live probe (Q3), then the const-flip via the merge gate.** TWO parts with
   DIFFERENT owners (architect VERIFY A-MED): (a) the ACT (operator-only, LIVE) — against a real
   throwaway fork, confirm a fork-side commit can reference an upstream-only sha (the DOC-SILENT
   claim the whole tree-write path rests on); capture the evidence. On FAIL: the fork path needs a
   different write strategy; do not arm. (b) the SOURCE EDIT — on PASS, flipping
   `OBJECT_SHARING_PROBE_RECORDED` to true is a change to a kernel `const` (`emit-pr.js:411`);
   UNLIKE O1/O3/O5 (deploy toggles), it ships through the normal build -> PR -> USER-merge pipeline
   with the probe evidence in the commit body, never a deploy-time operator toggle, and lands only
   after O0 confirms M1 is deployed.
3. **O3 — deploy the `expectedForkOwner` value** per the M2 decision (once made).
4. **O4 — the arming edit.** Add `forkRepo` + `expectedForkOwner` (from the M2 source) to the
   `emitPR` production call (`emit-pr.js:545`). This is the edit that makes `isForkMode` go true.
5. **O5 — flip the deploy flag** (`LOOM_WORLD_ANCHOR_ARM` / fork-mode gate). Per `security.md`, the
   ENABLE predicate is strict explicit-truthy; a typo fails CLOSED.
6. **Moved-base provenance (deferred, Part-B-blocked).** The F-W2b moved-base gate becomes
   provenance-bound only once a deployed cross-uid broker SIGNS the basis. Until then it is
   basis-integrity only, not provenance. This is a Part-B arming precondition, not an F-W4 code
   change.

## Open design questions (need the operator before ANY arming edit)

- **Q-M2: where does `expectedForkOwner` come from?** Options: (a) a deploy env var read at emit
  time; (b) a deploy-config file the kernel reads; (c) a kernel-owned custody value co-located with
  the token mint. Claude recommends (c) — same trust source as the token — but this is a deploy
  posture decision for the operator. Claude builds the reader once chosen.
- **Q-M3: does `OBJECT_SHARING_PROBE_RECORDED` stay a hard-const-flip (operator edits the const +
  commits evidence), or move to a probe-record reader?** Current design is the const-flip. A reader
  adds a file-read surface for no clear gain (YAGNI) while the const-flip keeps the evidence in git
  history. Recommendation: KEEP the const-flip; do not build a reader.
- **Q-M1-failmode: disable-Actions non-200 -> fail-closed or proceed?** Recommendation: fail-closed
  (see M1). Operator confirms.
- **Q-M1-necessity: is `maintainer_can_modify=true` needed at all? -> RESOLVED: `false`**
  (USER-CONFIRMED 2026-07-02; grounded in the GitHub platform facts above). M0 sets it EXPLICITLY
  `false` (flip the F-W3 const `true`->`false`), NOT omitted — the semantics then never depend on
  GitHub's create-PR default. Four reasons: (1) SMALLEST
  SURFACE — `false` removes the entire "anyone with upstream push access can commit to loom's fork
  branch + edit its workflows + access secrets" capability the docs confirm `true` grants. (2)
  TRUST-SIGNAL INTEGRITY (OQ-NS-6, the north-star) — with `false`, a merge is provably a merge of
  loom's EXACT approved content, not a maintainer-modified branch; `true` lets the merged bytes
  diverge from what loom's approval-hash stamped. (3) YAGNI — loom's draft-candidate flow does not
  rely on the maintainer editing loom's branch; with `false` the maintainer can still review /
  comment / request-changes / merge-as-is / merge-then-follow-up, so the north-star merge event is
  UNAFFECTED. (4) it SIMPLIFIES the mechanism half — `false` demotes M1 to optional defense-in-depth
  (the maintainer-push-to-workflows vector, the main reason M1 existed, is gone; the fork default is
  already Actions-disabled). Cost of `false`: a maintainer wanting a tiny fix-and-merge comments (or
  merges then follows up) instead of editing loom's branch in place — minor friction, worth the
  surface-and-integrity gain. This is a product/posture call; Claude recommends `false`.

## Dormancy / byte-identity invariant (must hold across the whole mechanism half)

Every M piece keeps production byte-identical: M1's call is behind `isForkMode`; M4/M5 are
test-only. The same-owner golden-bytes gate (`gh-emit-two-identity.test.js` tests 1-2) is the
acceptance gate for the mechanism half exactly as it was for F-W1..F-W3. Nothing in the mechanism
half populates `forkRepo` on the production path; only the operator's O4 does that.

## Recommended next step

Build the unambiguous, no-operator-dependency mechanism pieces dormant: **M1 + M4 + M5**. Defer M2
until Q-M2 is answered; do not touch M3 (keep the const-flip). The operator half (O1..O5) waits on
the operator. This mechanism-half build is a normal dormant wave (plan -> VERIFY -> TDD build ->
3-lens VALIDATE -> CodeRabbit -> PR -> USER merge), byte-identical, and needs the user's go.

## VERIFY result (3-lens board, 2026-07-02 @ `0e466bb`)

Read-only 3-lens VERIFY over this scope plan (architect + hacker + honesty-auditor, parallel).

- **architect: SOUND** — split, build-order (M1+M4+M5 dormant, M2 deferred on Q-M2), deferrals, and
  dependency ordering verified against the real repo. 1 MEDIUM + 1 LOW, both plan-prose (folded).
- **honesty-auditor: SOUND, 0 findings** — every runtime-probe claim TRUE against source (the two
  hard consts, the `emit-pr.js:545` dormant call, no `actions/permissions` today, no fork-mode
  golden literal today); the SCAR #21/#22 rationales faithfully stated; the Claude/operator boundary
  honest (no operator step quietly reassigned to Claude).
- **hacker: NEEDS-REVISION** — 3 MEDIUM + 1 LOW, ALL plan-prose precision / over-claim / one real
  ordering gap. NO dormancy break and NO unsafe code path (a live production-shape `ghEmit` trace
  made ZERO `/forks` or `actions/permissions` calls — dormancy holds).

**All 6 findings folded into this revision** (each premise-probed against source first): M1 named at
BOTH `ensureFork` return sites (`:593` reuse + `:610` create) with a reuse-path test requirement
(H-MED-1); M1's "closes the hazard" downgraded to "closes the Actions-EXECUTION surface" with the
maintainer-push residual named (H-MED-2); the O0 hard ordering gate added so arming cannot precede
M1-deployed (H-MED-3); O2 split into operator-ACT vs source-EDIT-through-the-merge-gate (A-MED); M2
restated as NARROWS-not-anchor per #273 (H-LOW); the phantom "O-disable-Actions" operator step
removed (A-LOW). Verdict after fold: the split + build-set are sound; the mechanism half (M1+M4+M5)
is ready to build dormant on the user's go, M2 waits on Q-M2, the operator half waits on the operator.

## VALIDATE result (M0+M4+M5 build — 2026-07-02)

The M0+M4+M5 mechanism-half build (this wave: `maintainer_can_modify` flipped to explicit `false`,
the M4 structural pin, the M5 fork-mode golden literal) passed a 3-lens VALIDATE over the BUILT diff
(code-reviewer + hacker-live-probe + honesty-auditor, parallel).

- **All three: SHIP-WITH-NOTES** — no CRITICAL/HIGH/MEDIUM. The hacker's 5 live probes HELD:
  fork-mode emits `maintainer_can_modify:false`; an actor planting `true` (even with a forged
  matching emission hash) is IGNORED (no escalation via the envelope, the #273 steering-field rule);
  same-owner is byte-identical; the fork body byte-equals the frozen golden (472 bytes); the M4 pin
  is non-vacuous. code-reviewer + honesty confirmed same-owner byte-identity, dormancy, and every
  code claim TRUE against source.
- **4 LOW findings, all folded:** the M4 `consumers` regex was order-sensitive (false-RED on a
  benign `{ forkOwner, resolvedForkRepo }` reorder) and blind to a divergent-name sink -> strengthened
  to match every `${ident}:${branch}` head interpolation with a name-validated owner plus an
  order-insensitive origin check (mutation-verified: a benign reorder PASSES; a divergent-name or a
  literal 3rd sink FAILS); the base-ref probe line annotated as superseded by M0; the F-W3 plan + the
  external-repo scope doc given a dated `maintainer_can_modify` supersession note.

Tests after fold: two-identity file 49/0; full kernel suite 116 files / 0 fail; pre-push gate 129/0.
DISPOSITION: SHIP (SHADOW, production byte-identical; the fork-mode payload change is dormant until F-W4 arms).

## Security invariants (the NEVER list — carries verbatim)

- Claude NEVER provisions a token, runs a live GitHub probe, sets a deploy-constant value, sets an
  arming flag, or runs `--attested-cross-uid`.
- Claude NEVER touches, reads, or stats `/etc/loom` or `/opt/loom`.
- Merges are the USER's gate. Explicit named `git add`; the PACT doc stays untracked.
- #273 NARROWS-not-closes until a deployed cross-uid broker signs live edges (Part B).
