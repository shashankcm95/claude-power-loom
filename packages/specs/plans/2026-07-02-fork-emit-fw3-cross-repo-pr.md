---
lifecycle: persistent
topic: fork-emit, F-W3, kernel-egress, cross-repo-pr, maintainer-can-modify, bd-2-no-workflows, dormant
plan-of: the fourth wave of the fork-emit path — the cross-repo PR-open (head=forkOwner:branch), the last dormant wave before F-W4 arming
status: SHIP — 2-lens VERIFY + inline TDD build + 3-lens VALIDATE (all SAFE-TO-SHIP, honesty A-); see the VALIDATE result
---

# F-W3 — the cross-repo PR-open (`head=forkOwner:branch`), DORMANT / byte-identical

Fourth wave of the fork-emit path (F-W1 two-identity axis MERGED `ffa4e67` PR #488; F-W2 fork lifecycle MERGED
`65142bc` PR #489; F-W2b moved-base MERGED `d44a81c` PR #490). F-W3 makes the PR-create emit a **cross-repo** pull
(`head={forkOwner}:{branch}`, base=upstream) in fork mode, plus `maintainer_can_modify` as a fork-mode kernel
constant. It is the LAST dormant wave — after F-W3 the whole fork mechanism is built; only F-W4's token + arming
stands between dormant and live.

**Still SHADOW/dormant/byte-identical:** every new behavior is gated on `isForkMode` (`gh-emit.js:721`), which is
false in the same-owner default (`forkRepo` never populated until F-W4). Same-owner emits keep the bare `head:
branch` and no `maintainer_can_modify` => the golden gh argv/bodies are unchanged from `d44a81c`.

## Recon-completeness win (grep before build — the drift:recon-depth discipline)

The scope doc names **BD-2: the ephemeral bot fork MUST carry NO `.github/workflows/**`** (the "Allow edits from
maintainers" -> "and access to secrets" hazard when a fork carries workflows). **This is ALREADY structurally
covered** and needs NO new guard: `isEgressDeniedPath` (`emit-pr.js:288`) denies ANY `.github/` path
case-insensitively (`/(^|\/)\.github(\/|$)/i`, comment "workflows / actions"), enforced at BOTH `assertEgressSafeDiff`
(`emit-pr.js:473`, before the draft is even built) AND the per-path validation in `ghEmit` (`:673`,
`isEgressDeniedPath(st.pathB)`). So a diff touching `.github/workflows/**` (or any `.github/`) is refused before any
emit — the emitted tree structurally cannot contain a workflow file. **F-W3 adds a NON-VACUOUS test asserting this
(a `.github/workflows/` diff is refused) + a comment naming BD-2 as satisfied by the existing guard — NOT a new
guard.** (Firsthand-probed on `d44a81c`; the absence of a claim is not evidence of absence — grep found the gate.)

## The change (small — the PR-create in `ghEmit`, firsthand-probed on `d44a81c`)

The only functional edit is the PR-create body at `gh-emit.js:947`:

```js
// BEFORE (d44a81c):
const prBodyJson = JSON.stringify({ title: prTitle(issueRef), head: branch, base, body: prBody(issueRef, approvalHash, baseCommitSha), draft: true });

// AFTER (F-W3):
const prPayload = { title: prTitle(issueRef), head: isForkMode ? `${forkOwner}:${branch}` : branch, base, body: prBody(issueRef, approvalHash, baseCommitSha), draft: true };
if (isForkMode) prPayload.maintainer_can_modify = MAINTAINER_CAN_MODIFY;   // named kernel const = true, fork-mode only
const prBodyJson = JSON.stringify(prPayload);
```

- **head** — in fork mode the head becomes `forkOwner:branch` (see the AFTER block above); in same-owner mode
  isForkMode is false so it stays the bare `branch` (byte-identical). forkOwner is a KERNEL value already
  OWNER_RE-validated at validateForkIdentity (line 481) and branch is kernel-built (`loom/issue-N-hash12`) — both
  kernel-derived, never actor bytes (the scope doc's MED envelope-injection guard). This also fixes the latent F-W1
  inconsistency: the dedup query already used the namespaced `forkOwner:branch` head (line 907) while the create used
  the bare `branch` (line 947) — in a real fork the create needs the namespaced head; F-W3 aligns them.
- **`maintainer_can_modify`**: a named kernel CONSTANT `MAINTAINER_CAN_MODIFY = true` (mirror `draft:true`'s hard
  constant discipline), added to the payload ONLY in fork mode (the field is meaningless same-repo; gating it
  preserves same-owner byte-identity — the object key order is unchanged in same-owner mode, so `JSON.stringify` is
  byte-identical). Rationale (scope doc arch M2 + BD-2): a polite-contribution default, bounded by ephemeral fork +
  DRAFT + human-gate + the no-workflow guarantee (the load-bearing guard is the `.github/` denial above, NOT the
  flag value).

## Open questions for the VERIFY board (recommendations inline)

- **Q-A (maintainer_can_modify gating).** Fork-mode-only (recommended, byte-identical) vs always-`true`? Same-repo
  `maintainer_can_modify` is a no-op/ignored by GitHub, but adding it unconditionally changes the same-owner golden
  bytes. **Recommend fork-mode-only.**
- **Q-B (head-build re-validation).** `forkOwner` is already OWNER_RE-validated at `validateForkIdentity`; the scope
  doc's MED says "re-validated at the head-build site." **Recommend a cheap defense-in-depth re-assert `OWNER_RE.test(
  forkOwner)` (or an assertion the value is unchanged) right at the head interpolation** — flag if the board judges
  it redundant churn given the single validated origin.
- **Q-C (BD-2 gating).** The `.github/` denial is ALWAYS-on (both same-owner + fork) — leave it always-on (a workflow
  emit is a concern regardless), just document that it SATISFIES the fork-specific BD-2. **Recommend leave as-is +
  test.**

## What stays UNCHANGED (byte-identical)

Same-owner emit: `head` bare, no `maintainer_can_modify`, the whole write sequence, the dedup happy path, the golden
argv/bodies — all identical to `d44a81c`. The H-1 PR-create-endpoint-is-upstream structural bind (`upstreamApi('pulls')`);
the post-create `pr.base.repo === upstream` backstop; `draft:true` hard constant; the moved-base gate (F-W2b); the
`.github/` egress denial; the fork-identity / TOCTOU guards (F-W2).

## TDD test list (tests FIRST, red, then build to green)

New tests in `tests/unit/kernel/egress/gh-emit-two-identity.test.js` (the fork-mode suite) + `gh-emit.test.js`:

1. **Cross-repo head in fork mode** — a distinct `forkRepo` (ensureFork mocked) => the PR-create body head is
   `forkOwner:branch`, base is the upstream default, and `maintainer_can_modify` is true.
2. **Same-owner head is bare + no maintainer_can_modify (byte-identical)** — no `forkRepo` => the PR-create body is
   byte-identical to `d44a81c` (`head === branch`, NO `maintainer_can_modify` key). Re-run the golden-bytes argv/body
   assertions.
3. **Dedup head consistency** — the dedup `?head=` query and the PR-create `head` use the SAME `forkOwner:branch`
   form in fork mode (no divergence between the two head spellings).
4. **BD-2 (existing guard, NON-VACUOUS)** — a diff touching `.github/workflows/ci.yml` is REFUSED (at
   `assertEgressSafeDiff` / the per-path validation), so the emitted tree can never carry a workflow file. Assert the
   refusal + zero writes. (Confirms the fork-secrets hazard is closed by the existing `.github/` denial.)
5. **`maintainer_can_modify` is a HARD CONSTANT** — no caller/param path can flip it (like `draft:true`); it is not
   read from `draft` or `data`.
6. **forkOwner in the head is OWNER_RE-clean** — (if Q-B accepted) a malformed forkOwner is already refused upstream
   at `validateForkIdentity`; assert the head interpolation only ever sees a validated owner.

## HETS Spawn Plan

kernel/egress security => FULL 3-lens tier REQUIRED at VALIDATE (Rule 2): code-reviewer, hacker (Rule 2a live probes
on the built cross-repo head — injection, byte-identity, the dedup/create head match), and honesty-auditor
(byte-identity, the BD-2-already-covered claim, dormancy). PRE-BUILD: a PROPORTIONATE 2-lens VERIFY (architect and
hacker) — the wave
is small (one PR-create edit + a const), so architect confirms the design + dormancy + the BD-2 recon finding, and
hacker probes the cross-repo-head envelope-injection surface; a full 3-lens VERIFY would over-spawn for a 2-change
diff (the discipline: one/two lenses for lower-stakes, the FULL tier at the post-build VALIDATE where it is required).
Routing: substrate kernel-egress security => route (route-decide scores `root` on the stakes-lexicon miss — the
substrate-meta catch-22; overridden by judgment per H.7.16, same class as F-W1/F-W2/F-W2b).

## Runtime Probes (claims this plan makes)

- The PR-create site + `head`/`maintainer_can_modify` absence + `isForkMode` gate + the dedup `head=forkOwner:branch`
  -> firsthand reads of `gh-emit.js` @ `d44a81c` (`:721,907,939-948`), this session.
- BD-2 is ALREADY covered: `isEgressDeniedPath` denies `.github/` (`emit-pr.js:288`), enforced at `assertEgressSafeDiff`
  (`:473`) + the per-path validation (`gh-emit.js:673`) -> firsthand grep + read, this session (not assumed).
- `forkOwner` is OWNER_RE-validated at `validateForkIdentity` (`gh-emit.js:481`) -> firsthand.

## Drift Notes

- F-W3 is the LAST dormant wave: after it, the fork mechanism (identities + lifecycle + moved-base + cross-repo PR)
  is complete; F-W4 = token posture + arming (flip `OBJECT_SHARING_PROBE_RECORDED`, populate `forkRepo` +
  `expectedForkOwner`→deploy-constant, the operator object-sharing live probe). State this so the board confirms the
  dormant boundary is honest (no live dependency this wave).
- The scope doc `research/2026-07-02-fork-emit-external-repo-scope.md` (referenced by the merged F-W1/F-W2/F-W2b plans
  and MEMORY, previously local-only) is committed WITH this wave so the references resolve on main.

## Pre-Approval Verification (2-lens VERIFY board, 2026-07-02)

**Board: architect + hacker (read-only, parallel). BOTH DESIGN-READY.** The hacker ran a LIVE probe of the BD-2
`.github/` denial + traced the head/transport/dedup paths; all 6 adversarial questions HELD (no exploit). The
architect verified every runtime claim firsthand on `d44a81c`. The wave is exploit-clean; the folds below are
defense-in-depth + non-vacuity tightenings, not blockers. **AUTHORITATIVE build directives (supersede body prose):**

- **F1 — spread factoring (architect, immutability + byte-order-provable).** Build the PR payload mutation-free so
  key-order byte-identity is visually provable:
  ```js
  const prBase = { title: prTitle(issueRef), head: isForkMode ? `${forkOwner}:${branch}` : branch, base, body: prBody(issueRef, approvalHash, baseCommitSha), draft: true };
  const prPayload = isForkMode ? { ...prBase, maintainer_can_modify: MAINTAINER_CAN_MODIFY } : prBase;
  const prBodyJson = JSON.stringify(prPayload);
  ```
  Spread appends `maintainer_can_modify` LAST, only in fork mode => same-owner bytes provably unchanged. Keep the
  change strictly BETWEEN `assertForkTip()` (H3) and the `ghJson(... 'pulls' ...)` call — do NOT move the create out
  of the H3/try-rollback fold (architect §4).
- **F2 — `MAINTAINER_CAN_MODIFY = true` is a HARD KERNEL CONSTANT** (module scope, mirror `draft:true`). NEVER read
  from `draft`/`data`/a param (the #273 steering-field rule — a maintainer-edit-permission bit is exactly what an
  actor must not set through the envelope). Q-A ruled fork-mode-only (a same-repo `maintainer_can_modify` is a GitHub
  no-op; adding it unconditionally is a pure byte-identity loss).
- **F3 — head-site OWNER_RE re-assert (architect Q-B + hacker MEDIUM-2, convergent).** `forkOwner` is validated once
  at `validateForkIdentity` (`:481`), ~466 lines from the interpolation sink. Add a LOCAL fail-closed invariant right
  after `branch` is built (covers BOTH the dedup head `:907` and the create head), gated on `isForkMode` so same-owner
  is untouched: `if (isForkMode && !OWNER_RE.test(forkOwner)) { emitEgressAlert('fork-owner-unsafe', {reason:'head-interpolation-reassert', ...}); throw ... }`. Frame it as "the interpolation site asserts its own precondition,
  fail-closed + observable" (a local invariant, not a re-run of the distant validator) — survives a future refactor
  that introduces a second `forkOwner` producer. `OWNER_RE` is already imported at module scope.
- **F4 — BD-2 is ALREADY covered; add a NON-VACUOUS confirming test (both lenses).** `.github/` is denied at
  `emit-pr.js:288` (`/(^|\/)\.github(\/|$)/i`), doubly-enforced (`assertEgressSafeDiff` + the per-stanza `:673`
  check). NO new guard. The test MUST be non-vacuous: a `.github/workflows/ci.yml` diff is REFUSED (present-target,
  fires RED) AND a benign non-`.github` diff PASSES the same path (the positive control — the guard discriminates,
  it does not reject everything). Q-C: leave the denial ALWAYS-on (a workflow emit is a hazard same-owner too).
- **F5 — literal-tree-path pin (hacker MEDIUM-1).** The `.git%2ehub/` / `.github%2f` / leading-space forms ALLOW
  through `isEgressDeniedPath` but are HARMLESS because the tree `path` is sent VERBATIM (`gh-emit.js:796,828`) and
  GitHub stores it literally (no URL-decode) => `.git%2ehub` is a literal non-workflow dir. This is the ONE BD-2
  premise resting on external-API behavior. Add a test PINNING it: assert `isEgressDeniedPath('.git%2ehub/ci.yml')
  === false` + a code comment that the harmlessness rests on GitHub not decoding the tree path (a future decode change
  surfaces as a failing pin, not a silent bypass).
- **F6 — surface the latent-bug FIX in the commit rationale (architect §5).** F-W3 doesn't just add the cross-repo
  head — it FIXES a real dedup-vs-create head inconsistency F-W1 left dormant (dedup used `forkOwner:branch` at
  `:907`, create used bare `branch` at `:947`). Condition -> Failure mode -> Resolution: in a real fork the create
  needs the namespaced head; the dedup already used it; F-W3 aligns them (TDD #3 is load-bearing for F-W4 — a
  mismatch would silently create duplicate cross-repo PRs).

**VALIDATE hacker re-probe list (Rule 2a, post-build):** (1) `MAINTAINER_CAN_MODIFY` hard-constant proof (a poisoned
`draft.maintainer_can_modify` is ignored); (2) dedup exact-set integrity in fork mode (a coincidental same-named
upstream branch does NOT dedup-match — the `head.repo.full_name === resolvedForkRepo` clause); (3) `ensureFork` C1
present-target non-vacuity; (4) golden-bytes same-owner regression.

**Disposition:** DESIGN-READY (both lenses). Build inline (TDD) given the small size; the FULL 3-lens VALIDATE (Rule
2) runs post-build. F-W3 is the LAST dormant wave — after it the fork mechanism is complete; F-W4 = token + arming.

## VALIDATE result (post-build 3-lens board, 2026-07-02)

Built inline (TDD: tests-first, F-W3a/c RED then GREEN). The BUILT diff got the full 3-lens VALIDATE (Rule 2; Rule 2a
— the hacker ran 6 live node harnesses / 52 adversarial probes against the built `ghEmit`). **All three SAFE-TO-SHIP;
honesty grade A-.**

- **code-reviewer: SAFE-TO-SHIP** — the spread factoring preserves same-owner byte-identity (golden-string strictEqual
  plus the 1b key-reorder negative control); `MAINTAINER_CAN_MODIFY` a true module const with one ref; `forkOwner` a
  single const producer with no reassignment before either sink; the change sits inside the assertForkTip/rollback
  fold. 1 PRINCIPLE (the F3 decision — below).
- **hacker: SAFE-TO-SHIP** — 52 live probes, 0 bypass. `maintainer_can_modify` is a genuine hard constant (a planted
  `draft.maintainer_can_modify` is ignored); cross-repo head injection closed at two chokepoints (NORMALIZED_REPO_RE +
  OWNER_RE); dedup exact-set holds; same-owner byte-identical; the `.github/` denial held against 17 encoding/case/
  traversal variants. 1 MEDIUM (BD-2 scope — below) + 2 LOW (F-W4 notes).
- **honesty-auditor: SAFE-TO-SHIP, grade A-** — all 5 load-bearing claims TRUE; 6/6 folds in-intent (F1/F2/F4/F5/F6
  literal, F3 in-intent via the immutability argument). Dormancy is DEMONSTRATED by two independent gates (forkRepo
  undefined through the production `emitPR->armedEmit` call + the `OBJECT_SHARING_PROBE_RECORDED` hard-const gate).

**Fold applied post-VALIDATE (this diff):**
- **BD-2 SCOPE CORRECTION (hacker MEDIUM + honesty LOW — the substantive catch the VERIFY board + the scope doc
  MISSED).** The `.github/` egress denial covers loom's EMITTED tree only; it does NOT reach what a fork ALREADY
  contains. A GitHub fork INHERITS the upstream's `.github/workflows` at `POST /forks`, and `maintainer_can_modify`
  grants the maintainer push access to the fork branch, so the fork-INHERITED-workflow + maintainer-push secrets
  hazard is a SEPARATE concern the emitted-tree denial cannot close. **Reworded the `MAINTAINER_CAN_MODIFY` comment**
  (`gh-emit.js`) from "the emitted tree can never carry a workflow" to the precise scope (loom never AUTHORS a
  workflow; the fork-inherited hazard is an F-W4 arming precondition), so the F-W4 board inherits the correct (not the
  narrow) invariant. NO code-behavior change (dormant; `maintainer_can_modify` never rides the wire this wave).

**F3 decision — RECORDED as a conscious defense-in-depth DECLINE (not a disproof).** The VERIFY board's F3 (a
head-site `OWNER_RE` re-assert) was DROPPED in the build: `forkOwner` is a single `const` from `validateForkIdentity`
(which runs the IDENTICAL `OWNER_RE.test(forkOwner)` and throws), never reassigned, with the reject exercised
non-vacuously by test 14. A re-assert's failure branch can never fire => provably-unreachable dead code, which
`security.md`'s non-vacuous-guard rule forbids. The hacker FUZZ-CONFIRMED this (915 accepted fork strings, ZERO would
fail a re-assert). The board unanimously ruled the drop CORRECT — but it is a conscious decline of the lenses'
future-proofing intent (catch a hypothetical FUTURE second `forkOwner` producer), now carried by the invariant
comment at the create site, not a runtime guard. Named here (per trade-off-articulation) so it is not a silent cut.

**F-W4 arming preconditions surfaced by VALIDATE (append to the F-W4 checklist — NOT F-W3 code):**
1. **Fork must be workflow-FREE as a REPOSITORY** before the first live cross-repo emit (the emitted-tree `.github/`
   denial does NOT cover inherited workflows): disable Actions on the ephemeral fork (`PUT /repos/{fork}/actions/
   permissions {enabled:false}`) at `ensureFork`, OR delete the inherited `.github/workflows/`, OR keep
   `maintainer_can_modify:false` until (a)/(b) is proven.
2. **F3 refactor-survival residual** — the single-`forkOwner`-producer invariant is carried by a comment, not a guard;
   if F-W4 wants it mechanically enforced, prefer a structural single-producer pin over the (dead) `OWNER_RE`
   re-assert.
3. **Fork-mode golden-bytes literal** — when F-W4 flips the dormancy live, freeze a FROZEN golden fork-mode PR body
   (like `GOLDEN_PULL_BODY`) so a future key-reorder fails a byte-diff, not just a field assertion; re-run the
   same-owner golden gate to prove arming did not regress byte-identity.

**Gate (post-fold, independently re-run):** full egress (23) + full kernel suite green; eslint clean, zero
eslint-disable; the emit-path golden-bytes byte-identical (same-owner). **DISPOSITION: SHIP** (SHADOW, emit-OFF,
byte-identical; the cross-repo head + `maintainer_can_modify` are DORMANT — `isForkMode` false in production; arms with
F-W4). F-W3 is the LAST dormant wave — the fork mechanism is now complete.
