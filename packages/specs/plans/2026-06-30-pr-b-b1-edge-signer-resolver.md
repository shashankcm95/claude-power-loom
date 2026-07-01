# PR-B B1 — edge signer-routing resolver (SHADOW)

Status: plan / pre-build. Date 2026-06-30. First wave of PR-B (the Rubicon). Scope parent:
`packages/specs/research/2026-06-30-pr-b-rubicon-scope.md`. Builds against the now-DEPLOYED cross-uid edge
signer (uid 612, custody-real attested 2026-06-30).

## Goal

The world-anchor mint's `edgeSigner` opt comes from an always-`undefined` test seam today (`cli.js:352`
`edgeSigner: opts.edgeSigner`), so every production edge is UNSIGNED. B1 builds the resolver that routes that
opt between **direct** (unsigned, today's SHADOW default) and the **deployed cross-uid signer**
(`crossUidLoomEdgeSigner`), and wires it into `cli.js`. SHADOW: with the arming flag unset (every box until B5
arms), the resolver returns direct -> `signer: undefined` -> byte-identical to today.

## Q-DEP resolved at B1 (the scope deferred it as low-stakes) — RECOMMEND lab-side

The scope marked Q-DEP "low-stakes, ratifiable at B1" and TENTATIVELY placed the resolver kernel/egress.
Resolving it at B1: **RECOMMEND reversing to lab-side** (USER may override). The resolver's only caller is
`cli.js` (`@loom-layer: lab`), which ALREADY imports `kernel/egress/alert` (`cli.js:54`) — so lab->kernel is an
established legal edge in this exact file. Lab-side:

- imports `crossUidLoomEdgeSigner` from `kernel/egress/loom-edge-launch` (legal lab->kernel) and REUSES the
  canonical `normalizeBool` / `isDeployFlagSet` from `host-claude-guard.js` (legal lab->lab).
- A kernel-side resolver would force either churning the hacker-blessed `host-claude-guard.js` or DUPLICATING the
  asymmetric-parse pair kernel-side — a DRY violation the "single-home so the launchers cannot diverge" invariant
  (`host-claude-guard.js:90`) forbids.

Home: `packages/lab/world-anchor/edge-signer-resolve.js` (adjacent to its SOLE caller; `lab/_lib` is for
cross-domain shared leaves — YAGNI to promote a single-caller module). The VERIFY architect confirmed lab-side is
"strictly better" on the merits; the only ask was to frame it as a recommendation, not a fiat supersede (done).

## Design (mirror the blessed template, with the edge's SAFER fallback)

```
// STRICT-enable: only a valid truthy ARMS cross-uid; a typo -> false -> direct/unsigned (the safe fallback).
function defaultEdgeSignerLauncher() {
  const edgeUser    = (process.env.LOOM_EDGE_USER || '').trim();
  const wrapperPath = (process.env.LOOM_EDGE_WRAPPER || '').trim();
  const armed = normalizeBool(process.env.LOOM_EDGE_REQUIRE_UID_SEP);   // STRICT (host-claude-guard.js:69)
  if (edgeUser && wrapperPath && armed) return { mode: 'cross-uid', edgeUser, wrapperPath };
  if (edgeUser || wrapperPath || isDeployFlagSet(process.env.LOOM_EDGE_REQUIRE_UID_SEP)) {
    return { mode: 'direct', misconfig: true };   // a partial/garbage deploy signal -> still unsigned (SAFE) but OBSERVABLE
  }
  return { mode: 'direct' };
}
function resolveEdgeSignerLaunch({ edgeLauncherFn } = {}) {        // edgeLauncherFn = TEST-ONLY seam
  let launch;
  try { launch = (typeof edgeLauncherFn === 'function' ? edgeLauncherFn : defaultEdgeSignerLauncher)() || {}; }
  catch (e) { emitEgressAlert('edge-signer-resolver-threw', { detail: (e && e.message) || 'resolver-error' });
              return { mode: 'direct', signer: undefined }; }      // fail-SAFE to unsigned + OBSERVABLE
  if (launch.mode === 'cross-uid') {
    try {
      const { crossUidLoomEdgeSigner } = require('../../kernel/egress/loom-edge-launch');  // lazy: only an armed box loads it
      return { mode: 'cross-uid', signer: crossUidLoomEdgeSigner({ edgeUser: launch.edgeUser, wrapperPath: launch.wrapperPath }) };
    } catch (e) { emitEgressAlert('edge-signer-build-failed', { detail: (e && e.message) || 'build-error' });
                  return { mode: 'direct', signer: undefined }; }
  }
  if (launch.misconfig) emitEgressAlert('edge-signer-misconfigured', {});   // observable: armed/partial but not fully configured
  return { mode: 'direct', signer: undefined };
}
```

## THE KEY DESIGN DIVERGENCE FROM THE JUDGE TEMPLATE (architect + hacker to bless)

The judge launcher fails-**CLOSED-refuse** on `deployed-unconfigured` because its direct path is **PRIVILEGED**
(runs the actor as host uid 501). The EDGE signer's direct path is **BENIGN**: direct = UNSIGNED ->
`deriveWorldAnchorSource` returns `'mock'` -> NOT admitted by the B5 gate (custody-key + `commitment_verified`).
So B1 fails-**SAFE-to-unsigned**, not fail-closed-refuse:

- ARMING the cross-uid path uses STRICT `normalizeBool(LOOM_EDGE_REQUIRE_UID_SEP)` — a typo -> `false` -> unsigned
  -> SAFE. This is the correct polarity per the scope's hacker CRITICAL 1 (NEVER the lenient `isDeployFlagSet`
  for the privileged-enable direction).
- A half-configured / typo'd-flag box still produces UNSIGNED (safe) but emits an OBSERVABLE
  `edge-signer-misconfigured` alert (`security.md`: a fail-safe security decision should not be silent — so an
  operator who thinks they armed it but mis-typed sees the signal). `isDeployFlagSet` is used HERE only as a
  LENIENT misconfig DETECTOR (observability), never to ENABLE the privileged path.

Open for the board: (1) is fail-safe-to-unsigned correct vs fail-closed-refuse (my read: yes — unsigned is always
safe under the B5 admission gate; the judge's refuse is for a privileged direct path the edge lacks)? (2) should
the misconfig alert fire on a deployed-but-unarmed box (where `/etc/loom/edge-verify.pem` exists but
`LOOM_EDGE_REQUIRE_UID_SEP` is unset)? My read: NO — an unarmed box is the intended SHADOW state, not a misconfig;
only a PARTIAL/typo'd config is. So the resolver must NOT key on a key-file marker (unlike the judge's
`actorKeyMarkerPresent`), or every deployed-but-pre-B5 box alerts spuriously.

## cli.js wiring (SHADOW-preserving)

`cli.js:352` `edgeSigner: opts.edgeSigner` -> `edgeSigner: opts.edgeSigner !== undefined ? opts.edgeSigner :
resolveEdgeSignerLaunch().signer`. The test seam (`opts.edgeSigner`) wins when set; production (`opts.edgeSigner`
undefined + flag unset) -> resolver returns `{mode:'direct', signer:undefined}` -> byte-identical to today.

## Runtime probes

- `Probe:` the resolver template is lab/_lib + blessed -> `host-claude-guard.js:149` `resolveJudgeLaunch` (read
  firsthand) -> CONFIRMED.
- `Probe:` `crossUidLoomEdgeSigner({edgeUser, wrapperPath})` returns `(edge_id, edgeBody)=>base64|null` ->
  `loom-edge-launch.js:48,57,60` (read) -> CONFIRMED.
- `Probe:` SHADOW byte-identical -> with `LOOM_EDGE_*` unset, `defaultEdgeSignerLauncher()` -> `{mode:'direct'}`
  -> `signer` undefined. Asserted by a build-time unit test.
- `Probe:` on THIS deployed box `/etc/loom/edge-verify.pem` + `edge.key` EXIST (uid 612). The resolver must NOT
  key arming on a key-file marker, so a deployed-but-pre-B5 box still -> direct/unsigned (no behavior change until
  the operator sets the presence pair + arms). This is the deliberate divergence above.

## Tests (TDD-first)

- Polarity matrix for `armed` (STRICT): unset/`''`/`ture`(typo)/`0`/`false`/`no`/`off` -> NOT armed; `1`/`true`/
  `yes`/`on`/bool-true -> armed.
- Presence: both set + armed -> cross-uid; one set -> direct+misconfig (alert); none + unarmed -> direct (no
  alert); none + typo'd flag -> direct+misconfig (alert).
- `cross-uid` constructs a real signer (inject a mock `crossUidLoomEdgeSigner` via the launcher seam; assert a
  function is returned).
- Fail-safe: a launcher that THROWS -> `{mode:'direct', signer:undefined}` + `edge-signer-resolver-threw` emit
  (non-vacuous: assert the emit fired).
- cli.js wiring: `opts.edgeSigner` set -> honored; unset + flag unset -> `undefined` (byte-identical); unset +
  fully-armed -> the resolver's signer.

## Boards

- VERIFY (pre-build): **architect + hacker** (the polarity + the fail-safe-vs-refuse divergence is
  security-critical; this is the routing that decides signed-vs-unsigned). Read-only personas.
- VALIDATE (post-build, Rule 2a): **hacker** (attack the BUILT resolver's polarity, the fail-safe path, the cli
  wiring byte-identity, the misconfig-detector observability) + **code-reviewer** (correctness/resource).

## SHADOW guarantee

Production stays `signer: undefined` until B5 arms (`LOOM_EDGE_REQUIRE_UID_SEP` + the presence pair +
`LIVE_SOURCES` flip). Even with the cross-uid signer now DEPLOYED, B1 routes NOTHING until armed — the deploy +
B1 are independent (deploy = custody-real key in place; B1 = the dormant routing that one day reaches it).

## Pre-Approval Verification

VERIFY board (workflow `wf_5e6f421f-5a5`, 2026-06-30): **architect NEEDS-REVISION (core design BLESSED) + hacker
SHIP** (no CRITICAL/HIGH). The fail-SAFE-to-unsigned divergence, the STRICT-arm / LENIENT-detect polarity, the
"do NOT key on a key-file marker" call, and lab-side reuse of the canonical predicates were verified end-to-end
and blessed. All findings folded into this plan + the build:

Architect (5):

1. Q-DEP framed as a RECOMMENDATION, not a fiat supersede — done (the Q-DEP section above).
2. Cross-wave invariant (B1 ROUTES, B5 ADMITS; the arm flag is NOT the trust boundary) — in the impl header + the
   `cli.js` wiring comment.
3. `unknown-mode` emit arm restored for template parity (no silent swallow) — in the impl.
4. The ambiguous misconfig cell PINNED: both-present + explicit-off/unset arm = STAGED (silent); misconfig fires
   only on XOR presence OR a typo'd arm token — decided + tested.
5. Lazy-require test (kernel launcher NOT loaded on the unarmed path) + production-engaged default test — added.

Hacker (5, all MEDIUM/LOW, non-blocking):

1. Cite the BINDING firewall `weight-source-gate.js:37` (not the dormant `deriveWorldAnchorSource`) — in the impl
   header (B1 is doubly inert: no production consumer AND an empty admit-set).
2. Pin the `alert` import depth (`../../kernel/egress/alert`, two `..` from `world-anchor/`) — confirmed.
3. The per-mint misconfig emit is acceptable under SHADOW (mints are rare); LATCH/dedup once-per-process is a
   NAMED B5 carry (observability-DoS hardening).
4. Comment the test-seam precedence on the `cli.js` ternary — done.
5. The cross-uid sudo arg-build is already hardened upstream (USERNAME_RE, wrapperPath validation, no
   keyFile/env passthrough); the build-failed path is non-vacuously tested (an invalid edgeUser throws at
   construction -> caught -> emit).

VALIDATE (post-build, Rule 2a): hacker re-probes the BUILT resolver + the `cli.js` wiring; code-reviewer for
correctness/resource. To run after the build is green.

## VALIDATE result

VALIDATE board (Rule 2a, workflow `wf_f0d48910-b58`, 2026-06-30): **hacker SHIP + code-reviewer SHIP**
(UNANIMOUS; no CRITICAL/HIGH/MEDIUM). The hacker ran 9 live-probe batches (~110 hostile inputs) against the BUILT
resolver: **0 bypasses** — no hostile arm-flag token armed cross-uid without a valid-truthy (STRICT
`normalizeBool`), the misconfig detector never leaked into the enable decision, fail-safe-to-unsigned held
universally, the lazy-require is genuine (kernel launcher loads ONLY when fully armed, proven via a
`Module._resolveFilename` hook), every reject path emitted an observable alert, and production dispatch
(`cli.js:375` -> `resolveEdgeSignerLaunch().signer === undefined`) is byte-identical to pre-B1 UNSIGNED.
code-reviewer probed 2 extra whitespace cells (correct) + confirmed the `cli.js` wiring sits inside the existing
observable-non-fatal try/catch.

LOW findings (all non-blocking; none require a B1 change):

- The per-mint `edge-signer-misconfigured` emit has no once-per-process latch (observability-DoS on a mis-armed
  box). Already a NAMED B5 carry (dedup once-per-process). Acceptable under SHADOW (mints are rare).
- A Byzantine `edgeLauncherFn` (the TEST-ONLY seam) can fabricate a cross-uid launch, but `keyFile`/`env`/
  `sudoPath` are DROPPED (only `edgeUser`/`wrapperPath` forwarded) and the seam is PRODUCTION-UNREACHABLE
  (`main()` -> `mainObserveMerge(args)` with `opts={}`). Not a defect; noted for a future production caller.

No code change from VALIDATE. Ready for the pre-push gate + PR.
