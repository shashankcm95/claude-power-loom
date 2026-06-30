---
lifecycle: persistent
topic: pra2b, edge-signer-vehicle, loom-edge-sign, cross-uid-custody, transport, custody-verify
---

# Plan — PR-A2b W2b: the cross-uid edge-signer transport (`loom-edge-sign` + launcher + custody-verify; SHADOW)

## Context

PR-A2b W2a (#464) shipped the security CORE — the one canonical edge-id seal
(`kernel/_lib/world-anchor-edge-id.js`) and the recompute-inside WHAT gate
(`kernel/egress/loom-edge-bind.js`). The bind has **NO production caller yet** (its W2a header says
so explicitly: "SHADOW: this module has NO production caller until W2b"). W2b is the transport that
wires the bind to its first caller and gives the world-anchor edge a real cross-uid signing vehicle —
the symmetric twin of the deployed `loom-broker-*` chain, one custody domain over.

W2b stays **SHADOW + weight-inert** exactly like W1/W2a: the world-anchor store still passes
`signer:undefined` in production (`LIVE_SOURCES = Object.freeze([])`), so nothing here signs a real
edge or gates a real action this wave. W2b ships the MECHANISM (a real, custody-real-capable cross-uid
edge signer); the wiring of that signer into a live mint is PR-B (the Rubicon).

This is the per-wave analog of how the broker chain was built: `loom-broker-sign.js` (key-holder CLI)
+ `loom-broker-launch.js` (`crossUidLoomBrokerSigner`) + `loom-custody-verify.js` (the out-of-band
verifier). W2b builds the edge equivalents.

## Routing Decision

```json
{
  "recommendation": "route",
  "rationale": "kernel egress, security-load-bearing (a private-key-holding cross-uid signer CLI + an out-of-band custody verifier), 4 new files, mirrors a deployed chain. The #273-residual-narrowing arc. Clear architect+hacker+honesty 3-lens fan-out per the kernel/security/auth review rule (workflow.md Rule 2).",
  "convergence_value": ">= 0.10 (post-context-mult)"
}
```

This is the kernel/security/auth/data-mutation diff class → the full 3-lens VERIFY tier is REQUIRED
(workflow.md Rule 2): `architect` (design) + `hacker` (adversarial-security) + `honesty-auditor`
(claim-vs-evidence), pre-build; and `code-reviewer` + `hacker` + `honesty-auditor` at post-build
VALIDATE (Rule 2a — the hacker re-probes the BUILT code with live probes, not just the plan).

## HETS Spawn Plan

- **VERIFY (pre-build, parallel, read-only lenses, via Workflow not bare Agent tool — kb-citation-gate lesson):**
  - `architect` — the reuse-vs-duplicate transport-client factoring (Q1 below); the file/seam decomposition; the deploy-contract shape for W3.
  - `hacker` — adversarial: the cross-uid threat model on a DIRECT (non-sudo) invoke; flag-injection on the launcher; the key-open TOCTOU/symlink/perm surface; the stdin DoS (volume + slow-loris); the custody-verify C3 non-vacuity; any sign-arbitrary-oracle the transport could reopen around the W2a bind.
  - `honesty-auditor` — HONEST-SCOPE: SHADOW claims, "custody-real is a deployment property", integrity!=provenance (the edge signer proves custody of the KEY, NOT that `from_node_id` is world-anchored — that is PR-B).
- **BUILD:** delegated `node-backend`, `isolation:worktree`, TDD (tests-first, red, implement).
- **VALIDATE (post-build, parallel):** `code-reviewer` + `hacker` (live re-probe of the BUILT CLI) + `honesty-auditor`.
- **Rule 4:** record the delegated builder's verdicts into the Lab verdict-attestation store at wave close.

## Files To Modify

NEW (all `packages/kernel/egress/`):

1. **`loom-edge-sign.js`** — the key-holder CLI (the primary deliverable; mirror `loom-broker-sign.js`).
   - `readStdinBounded({maxBytes: MAX_EDGE_BYTES, deadlineMs})` — BOUNDED + DEADLINED. `MAX_EDGE_BYTES`
     is TIGHT (~16 KiB): an edge body is `{from_node_id(64hex), to_delta_ref(64hex), edge_type}` ~ 180 B,
     so 16 KiB is generous-but-tiny vs the broker's 1 MiB (the broker carries a scrubbed diff; the edge
     does not). NEVER `fs.readFileSync(0)` (unbounded on volume AND time — FORBIDDEN). Drain FIRST,
     before any gate that can `process.exit`, so the host's `input:` write always completes (no EPIPE).
   - WHO gate — REUSE `loom-broker-caller-auth.authorizeCaller({sudoUid: SUDO_UID, allowlistRaw:
     LOOM_EDGE_ALLOWED_UIDS})`. The module is generic over uid; the edge passes its OWN allowlist env var.
     Deny-on-unset (fail-closed) + a LOUD stderr on misconfig (the OBSERVABLE-reject rule).
   - WHAT gate — `loom-edge-bind.authorizeRequest({claimedBasis: process.argv[2], presentedCtxRaw})`
     (the W2a module's FIRST production caller). Runs BEFORE the key open (an unauthorized request never
     touches the key/TOCTOU surface). `basisToSign` is the RECOMPUTE, never the argv claim.
   - Key open — `LOOM_EDGE_KEY_FILE`: `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, fstat the resolved fd, reject
     non-regular + ANY group/world bit (`& 0o077` owner-only — a 0644 key lets a non-edge uid mint
     outside the broker), read THAT fd (no second path resolution). close-before-fail (fail() exits,
     skips finally).
   - Sign — `signEdgeId(basisToSign, {privateKeyPem: pem})` (= `signRecordId`; the alg-pinned ed25519
     leaf re-gates the output). Print ONLY base64 to stdout; errors → FIXED stderr msg (NEVER key bytes,
     NEVER err.stack) + empty stdout + non-zero exit. `main().catch(() => fail('internal error'))`.

2. **`loom-edge-launch.js`** — `crossUidLoomEdgeSigner` (mirror `loom-actor-launch.js`'s reuse pattern).
   - REUSE `crossUidSudoArgs({brokerUser: edgeUser, wrapperPath, sudoPath})` from `loom-broker-launch.js`
     (the RESUME's "confirmed generic"; the actor launcher already reuses it the same way — its throw
     messages reference the shared `brokerUser` param, acceptable for the DRY reuse).
   - Return the transport signer wired to `sudo -n -u <edgeUser> <wrapper>` (see Q1 for the client).

3. **The transport client (the `(edge_id, edgeBody) → base64|null` adapter)** — see **Q1** for the
   reuse-vs-dedicated decision. This is the function that plugs into the W1 `opts.signer(edge_id, edgeBody)`
   seam: it writes `edgeBody` (the recompute ctx) on the wrapper's stdin so the wrapper recompute-binds —
   NOT a blind passthrough; the edge_id is re-derived inside the wrapper and a mismatch is refused.

4. **`loom-edge-custody-verify.js`** — the out-of-band verifier twin (mirror `loom-custody-verify.js`).
   - DUPLICATE the verdict + report (`assessEdgeCustody` / `formatReport`) per the egress
     deliberate-duplication-for-independent-auditability convention (the actor twin did exactly this:
     `assessActorCustody`, "MIRROR, bounded, intentional — a separate trust domain; does NOT edit the
     shipped broker verifier"). Checks: C0 not-root · C1 key present + non-vacuous (lstat, never read) ·
     C2 host-read DENIED + owner-differs disambiguation · C2.5 wrapper integrity (root-owned, not
     group/world-writable, not host-owned) · **C3 EDGE sign-liveness** — the edge-specific probe.
   - **C3 probe (edge-specific):** present a real edge ctx `{from_node_id: <real 64hex>, to_delta_ref:
     <real 64hex>, edge_type: 'world-anchored-by'}`, compute the probe basis = `deriveWorldAnchorEdgeId(ctx)`
     (so the wrapper's recompute-bind ALLOWs it — the probe must be a GENUINE consistent edge, else the
     bind refuses and C3 is vacuous), sign via the cross-uid edge signer, verify via `verifyEdgeSig(basis,
     sig, {publicKeyPem, allowEnvFallback:false})`. Use a RANDOM nonce-derived endpoint per run so the
     probe is un-special-caseable (random 32-byte hex endpoints; the type stays the fixed real type).

NEW (tests, `tests/unit/kernel/egress/`): `loom-edge-sign.test.js` (subprocess integration, mirror the
broker-sign test), `loom-edge-launch.test.js` (argv-shape + signer wiring), `loom-edge-custody-verify.test.js`
(the PURE `assessEdgeCustody` over synthetic facts — the cross-uid TRUE branch a same-uid box cannot
produce). If Q1 picks a dedicated client: `loom-edge-client.test.js`.

UPDATE: `docs/SIGNPOST.md` (regenerate — 3-4 new `.js`), `packages/kernel/egress/README.md` (if it
enumerates the egress chain).

## The reuse-vs-duplicate decision (Q1 — for the VERIFY board to rule)

The transport client (`loomBrokerSigner` in `loom-broker-client.js`) is a generic
`(hex64, object) → base64sig|null` over a subprocess: `isHex64(arg1)` → `JSON.stringify(arg2)` on stdin
→ `execFileSync(cmd, [...args, arg1], {input})` → re-gate canonical-base64 + 64-byte. Structurally
IDENTICAL to what the edge needs.

- **Option (B2) REUSE `loomBrokerSigner`** (recommended-leaning): `crossUidLoomEdgeSigner` =
  `loomBrokerSigner(crossUidSudoArgs({brokerUser: edgeUser, wrapperPath}))`. The returned
  `sign(edge_id, edgeBody)` plugs straight into the W1 seam. The cross-uid path passes NO `opts.keyFile`
  and NO `opts.env`, so the broker-specific bits (`LOOM_BROKER_KEY_FILE` convenience, `RESERVED_ENV`) are
  never exercised. Matches the actor precedent most faithfully (reuse the generic base; the actor launcher
  reused `crossUidSudoArgs` and added NO duplicate client). DRY.
  - Known wart: the client's `MAX_CTX_BYTES = 1 MiB` is a LOOSER host-side fail-fast than the edge
    wrapper's 16 KiB — correct (the wrapper is the authority + refuses >16 KiB fail-closed) but not
    fail-fast-symmetric for the edge.
  - Coupling risk: a future broker-driven change to `loomBrokerSigner` silently affects the edge signer.
- **Option (B1) dedicated `loom-edge-client.js`** (`loomEdgeSigner`, edge naming: `LOOM_EDGE_KEY_FILE`
  convenience, `MAX_EDGE_BYTES` fail-fast, edge `RESERVED_ENV`). Matches the egress
  deliberate-duplication-for-auditability convention + decouples the two trust domains; costs ~85 lines
  of near-dup of subprocess-management (NOT a tiny one-liner like the `sha256hex` the F8 convention covers).

**RESOLVED by the 3-lens VERIFY board (unanimous): B2 — reuse `loomBrokerSigner`, wrapped in a named
`crossUidLoomEdgeSigner` in `loom-edge-launch.js` (NOT a raw inline call; NOT B1).** The transport client
is the LEAST security-load-bearing layer (its own header: "the client-side gates are NOT a security
boundary; all security lives in the key-holding wrapper") — duplicating 85 lines of subprocess management
adds a new attack surface for zero new trust boundary, and the deliberate-duplication convention is scoped
to tiny audited-in-place one-liners (the `sha256hex` F8 note), not a deep module. The named wrapper is
where the coupling is absorbed + separately tested, AND where the broker-naming env-leak guard lives (see
fold D1 below). Full rulings: VERIFY board folds.

## Phases

1. Write this plan; 3-lens VERIFY board (Workflow); fold findings into the plan (resolve Q1).
2. Delegated TDD build (node-backend, worktree): tests-first → red → implement the 4 files.
3. Firsthand disk-verify (Rule 2a): read the built diff on disk; run the new suites; run a live
   same-uid end-to-end (key in a scratch dir, SUDO_UID + LOOM_EDGE_ALLOWED_UIDS = SELF) proving a happy
   sig verifies + every gate refuses with empty stdout.
4. 3-lens VALIDATE board (code-reviewer + hacker live-reprobe + honesty).
5. Drift gates (signpost regen, eslint/yaml/markdownlint, full kernel suite) + CodeRabbit pre-PR
   (secret-free tree) + PR + USER merge.

## Verification Probes (verified firsthand during recon, 2026-06-30)

- `loom-edge-bind.js` exists, exports `authorizeRequest`/`validateCtxShape`/`CTX_KEYS`; `authorizeRequest`
  is `{claimedBasis, presentedCtxRaw}` → `{decision, reason, basisToSign}`; deny carries `basisToSign:null`.
  Probe: read `packages/kernel/egress/loom-edge-bind.js:92-120`.
- The W1 store signer seam is `opts.signer(edge_id, edgeBody)` where `edgeBody = Object.freeze({from_node_id,
  to_delta_ref, edge_type})` (NOT recorded_at). Probe: `world-anchor-edge-store.js:210-225`.
- `deriveWorldAnchorEdgeId(rec)` reads EXACTLY `{from_node_id, to_delta_ref, edge_type}` (null→'' coerce,
  String wrap). Probe: `kernel/_lib/world-anchor-edge-id.js:39-46`.
- `crossUidSudoArgs({brokerUser, wrapperPath, sudoPath})` is exported + generic (USERNAME_RE + abs/no-dotdot/
  no-control-char) and ALREADY reused by `loom-actor-launch.js`. Probe: `loom-broker-launch.js:50-77` +
  `loom-actor-launch.js:24,69`.
- `signEdgeId` / `verifyEdgeSig` are identity aliases of `signRecordId`/`verifyRecordSig` (alg-pinned
  ed25519, canonical-base64, fail-closed); `verifyRecordSig` supports `allowEnvFallback:false`. Probe:
  `edge-attestation.js:142-170`.
- `authorizeCaller({sudoUid, allowlistRaw})` is generic over uid; deny-on-unset. Probe:
  `loom-broker-caller-auth.js:68-76`.
- `loom-broker-sign.js` is the key-holder CLI template (bounded+deadlined stdin, WHO→WHAT→key-open→sign,
  O_NOFOLLOW + `& 0o077`, fixed-msg fail). Probe: `loom-broker-sign.js:33-119`.
- `loom-custody-verify.js` / `loom-actor-custody-verify.js` are the verifier templates; `assessCustody`
  is PURE over `facts`; the actor twin DUPLICATED the verdict (`assessActorCustody`) for a separate trust
  domain. Probe: `loom-custody-verify.js:41-123` + `loom-actor-custody-verify.js:11-13,68`.
- No `loom-edge-sign`/`loom-edge-launch`/`loom-edge-client`/`loom-edge-custody-verify` exists yet (only
  `loom-edge-bind.js`). Probe: `ls packages/kernel/egress/ | grep edge` → `loom-edge-bind.js` only.

## Out of Scope (Deferred)

- **PR-B (the Rubicon):** flipping `LIVE_SOURCES` + wiring the cross-uid signer into a live world-anchor
  mint + the net-new recall consumer that READS the authenticated edges. W2b only ships the signer; it
  signs nothing real this wave.
- **W3:** the deploy helper (root-owned wrapper install, sudoers stanza, the asymmetric-parse arming flag
  for any deploy signal) + the runbook. The custody-verify is built here; the wrapper/sudoers it verifies
  are W3's deploy artifacts.
- **`from_node_id` provenance** (integrity != provenance): the bind binds ctx↔basis CONSISTENCY; it does
  NOT prove `from_node_id` is a genuinely world-anchored node. That is the PR-B weight-minter's
  full-tuple commitment. W2b's signer proves KEY CUSTODY only.
- **The same-uid co-forge residual** survives until the full close. #273 NARROWS at W2b (the mechanism
  exists); it CLOSES only when ALL THREE land: (a) a DEPLOYED cross-uid edge broker, (b) out-of-band
  custody attestation, AND (c) PR-B's live trusted-source mint that flips the edge into a weight input.
  W2b alone signs nothing real (honesty VERIFY #2 — the earlier "CLOSES at deploy+attest" omitted (c)).

## Drift Notes

- Spawn the architect lens via Workflow / free-text, NOT the bare async Agent tool (the kb-citation-gate
  PostToolUse:Agent hook trips on the launch confirmation; documented in the W2a session snapshot).
- CI markdownlint EXCLUDES `packages/specs/` so this plan file is not lint-gated; the NEW `.js` files ARE
  (eslint no-irregular-whitespace + the signpost drift gate Test 121).
- Likely-CodeRabbit-class (pre-fold into the build directives so the board catches them): freeze any
  exported policy array; null-guard `authorizeX(null)` fail-closed; positive-integer guards on
  timeout/maxBuffer; the FIFO/symlink/perm key-open matrix; the never-EOF stdin deadline test.

## Why this is the right shape

W2b is pure transport + verification around the W2a security core — it adds NO new trust primitive, only
the cross-uid vehicle that lets the W2a bind run behind a key the same-uid host cannot read. Mirroring the
deployed broker chain (proven, reviewed, dogfooded) minimizes novel attack surface; the only genuinely new
code is the edge-specific C3 probe + the edge naming.

## What this DOESN'T claim to fix

Custody-real (a deployment property; the custody-verify reports `hostObservableChecksPassed` +
`requiresOutOfBandUidConfirmation`, never "verified"). `from_node_id` provenance (PR-B). It does not flip
any live switch (`LIVE_SOURCES` stays frozen-empty). **Replay-resistance is NOT a property of the edge
signature** — the sig is deterministic over a public content-address (no freshness/nonce in the signed
payload, by design — `world-anchor-edge-id.js` excludes `recorded_at`), so a captured `(basis, sig)` pair
is replayable for its edge. Acceptable at this SHADOW scope (the sig gates nothing); replay-resistance is
deferred to the PR-B minter's full-tuple freshness commitment (hacker VERIFY #3).

## References / reuse (not modifying)

- `loom-broker-sign.js`, `loom-broker-launch.js`, `loom-broker-client.js`, `loom-broker-caller-auth.js`,
  `loom-custody-verify.js`, `loom-actor-launch.js`, `loom-actor-custody-verify.js` (templates).
- `loom-edge-bind.js`, `kernel/_lib/world-anchor-edge-id.js`, `edge-attestation.js` (the W2a/earlier core
  this wave consumes — NOT modified).

## Pre-Approval Verification — 3-lens VERIFY board (2026-06-30)

All three lenses returned **SHIP-WITH-CHANGES** (no NEEDS-REVISION). Workflow `wf_ce564fd0-3f6`
(architect `a4f381c3a4cc2f855`, hacker `a10f276e4bbcbf06a`, honesty `ab9ee8e34d79a0c86`). The folds below
are AUTHORITATIVE build directives — the builder implements to these, not to the prose above where they
differ.

**Q1 ruling (unanimous): B2 wrapped in a named `crossUidLoomEdgeSigner`.** (architect + hacker + honesty
all independently concurred; reasoning in the Q1 section above.)

- **D1 [HIGH] `crossUidLoomEdgeSigner` is a named wrapper, NOT a raw `loomBrokerSigner` call, AND it
  forbids `opts.keyFile`/`opts.env` passthrough.** Shape: (a) `crossUidSudoArgs({brokerUser: edgeUser,
  wrapperPath, sudoPath})`; (b) `loomBrokerSigner({command, args, timeoutMs, maxBytes})` with NO keyFile
  and NO env; (c) return the `(edge_id, edgeBody)` signer. If the caller passes `keyFile` or `env`, THROW
  (the cross-uid key lives in the root-owned wrapper's env, never client-injected — and `loomBrokerSigner`
  would set `LOOM_BROKER_KEY_FILE`, the WRONG var name for the edge wrapper which reads `LOOM_EDGE_KEY_FILE`:
  a silent-misconfig trap). Test: `crossUidLoomEdgeSigner({...,keyFile:'/x'})` throws; and a test asserting
  the produced child env NEVER contains `LOOM_BROKER_KEY_FILE` (the broker-naming leak is inert).
- **D2 [HIGH] Port the WHO-contingency + custody-MECHANISM honest-scope header into `loom-edge-sign.js`
  verbatim** (from `loom-broker-sign.js:11-14` + `loom-broker-caller-auth.js:12-15`): SUDO_UID is
  unforgeable ONLY when sudo injected it (deployed `env_reset,!setenv`); a DIRECT invoke forges it; the
  cross-uid KEY CUSTODY is the real control; same-uid the host can read the key + ptrace this process — a
  MECHANISM, not custody-real. The WHO gate stays (defense-in-depth + the deployed case) but the comment
  must not present it as a boundary.
- **D3 [HIGH] C3 NON-VACUITY.** (a) `probeBasis = deriveWorldAnchorEdgeId(ctx)` over a GENUINE consistent
  edge — random `crypto.randomBytes(32).toString('hex')` endpoints (EXACTLY 64 hex), fixed real
  `edge_type:'world-anchored-by'`; pass `probeBasis` as the signer's edge_id AND write `ctx` on stdin;
  verify via `verifyEdgeSig(probeBasis, sig, {publicKeyPem, allowEnvFallback:false})`. (b) Assert
  `isHex64(from_node_id) && isHex64(to_delta_ref)` in the probe before signing (a shortened nonce → vacuous
  C3). (c) NEGATIVE test: a non-consistent (random, not-the-recompute) basis makes C3 FAIL with the
  bind-refuse signature — proving the failure path fires. (d) the synthetic-facts `assessEdgeCustody` unit
  test does NOT discharge C3 non-vacuity — the Phase-3 firsthand same-uid dogfood must do a REAL-key
  round-trip where C3 FAILS if the key is absent.
- **D4 [MED] `loom-edge-custody-verify.js` C3 imports ONLY `deriveWorldAnchorEdgeId` (kernel/_lib) +
  `verifyEdgeSig` (edge-attestation). It MUST NOT import `./approval`** (a mechanical mirror of
  `loom-custody-verify.js:23` would carry the broker's `computeEmissionHash`/`approvalSigBasis` → wrong
  basis → re-vacuates C3). Verify the import list in review.
- **D5 [MED] `MAX_EDGE_BYTES` ~16 KiB is load-bearing + the drain runs BEFORE the WHAT gate.** It is the
  ONLY volume bound on `edge_type` (the bind ALLOWs an arbitrary-length non-empty type — the W2a F9
  asymmetry; the store, not the bind, gates the type-set). The stdin drain with this cap MUST run before
  `authorizeRequest`, mirroring `loom-broker-sign.js:62`. Do NOT raise toward 1 MiB. Tests: (i) >16 KiB
  stdin → `too-large` + empty stdout; (ii) an edge body in (16 KiB, 1 MiB] is refused by the WRAPPER with
  empty stdout + non-zero exit (covers the wrapper bound even though the reused client's 1 MiB host
  fail-fast is looser). Note the host-vs-wrapper asymmetry in the launcher doc-comment as deliberate
  (host = fail-fast convenience; wrapper = authority).
- **D6 [MED] Key-open matrix = verbatim port of `loom-broker-sign.js:90-108`** with only
  `LOOM_BROKER_KEY_FILE → LOOM_EDGE_KEY_FILE`: `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`; fstat the fd from
  `openSync` (NEVER re-`statSync(path)` — TOCTOU); `st.isFile()`; `st.mode & 0o077` (owner-only, NOT
  `& 0o022`); close-before-fail on every interior reject (fail() → process.exit skips finally). VALIDATE
  hacker re-probes a 0644 key, a symlink key, a FIFO key against the BUILT CLI.
- **D7 [MED] Error path = no key/stack leak.** Identical `fail()` (fixed `'loom-edge-sign: '+msg`, empty
  stdout, exit 1) + `main().catch(() => fail('internal error'))` (NOT `.catch(e => fail(e.message))`).
  Test: a malformed PEM → empty stdout + a fixed stderr with NO PEM substring and NO `at ` stack frame.
- **D8 [MED] Replay blast-radius:** C3 MUST NOT print the probe `(basis, sig)` to stdout/stderr/logs —
  only the boolean verdict (so the probe never emits a reusable signature). (The `## What this DOESN'T
  claim to fix` replay line is folded above.)
- **D9 [LOW] Edge C3 follows the BROKER model — NO wrapper sentinel** (a sign IS the probe; cheap), NOT
  the actor `--loom-*-version-probe` model. W3's edge wrapper is therefore simpler than the actor wrapper
  (no `$1`-dispatch). The W3 forward-contract is: a root-owned wrapper that sets `LOOM_EDGE_KEY_FILE` +
  execs `node loom-edge-sign.js "$1"` (the basis on argv, ctx on stdin) + the sudoers stanza authorizing
  only the operator uid to `sudo -u loom-edge-signer <wrapper>` + `LOOM_EDGE_ALLOWED_UIDS`. No sentinel.
- **D10 [LOW] DRY-reuse wart note:** `crossUidLoomEdgeSigner`'s throw messages will reference `brokerUser`/
  `crossUidLoomBrokerSigner` (the accepted actor-precedent wart). Note it in the header exactly as
  `loom-actor-launch.js:67-68` does, so an edge failure's "broker" message does not confuse a reader.
- **D11 [LOW] `allowEnvFallback:false` for C3's `verifyEdgeSig` is a HARD requirement** (the verify key
  comes from the operator's `--verify-key` file, NEVER the `LOOM_EDGE_VERIFY_KEY` env — else a same-uid
  host points the verifier at its own key). Treat as a contract, not a style choice.
- **D12 [LOW] Phase-3 same-uid dogfood scope** proves the WHO/WHAT/key-perm gates + the sign/verify
  round-trip ONLY; it CANNOT exercise the C2-denied/C3-cross-uid TRUE branch (the host CAN read its own
  key → C2 correctly FAILS). The cross-uid TRUE branch is proven by the PURE `assessEdgeCustody` over
  synthetic cross-uid facts + a NAMED deferred real-deploy attestation residual. Phase-3 prose must not
  read as custody-real evidence.
- **D13 [LOW, no code] Custody-verify twins scaling note:** the edge twin is the 3rd; at a 4th, the shared
  C0/C1/C2/C2.5 FACT-GATHERING (not the verdict) becomes a consolidation candidate worth an ADR. Do NOT
  refactor in W2b (YAGNI; the convention is load-bearing for a security verifier). Acknowledged here to
  keep the duplication honest rather than reflexive.

## Build + VALIDATE result (3-lens, Rule 2a — built diff in worktree `agent-ae6feb7c809aa5058`)

Delegated `node-backend` TDD build (tests-first → red → green). 3 new sources + 3 new suites; no existing
SOURCE file modified — the only touched existing file is the auto-generated `docs/SIGNPOST.md` (regenerated
by the drift gate, never hand-edited). All 13 directives D1-D13 honored in the built code (per-directive
confirmation by all three VALIDATE lenses). Final shape (Q1=B2): 3 source files — the transport client is the REUSED `loomBrokerSigner`
wrapped in `loom-edge-launch.js`'s `crossUidLoomEdgeSigner` (no dedicated `loom-edge-client.js`).

**3-lens VALIDATE board (Workflow `wf_037f0041-55c`) — all SHIP:**

- **code-reviewer** (`a...`) SHIP, 0 CRIT/HIGH, 2 LOW. Confirmed every directive in the built code firsthand
  (D6 `& 0o077` + fstat-the-fd; D5 drain-before-WHAT; D7 `main().catch(()=>fail('internal error'))`; D1
  keyFile/env THROW; D3(c) real-key C3 round-trip present + non-vacuous; D4 no `./approval`).
- **hacker** (`a...`) SHIP — **40+ live probes across 8 throwaway scripts against the BUILT CLI, 0 bypasses.**
  The W2a sign-arbitrary-64-hex oracle stays CLOSED against a forged basis, a swapped axiom field, an
  extra-key 3-key-colliding ctx, numeric coercion, duplicate-key JSON, and trailing bytes — all refuse with
  empty stdout. Key-open matrix (0644/0640/0660/symlink/FIFO/dir/absent), stdin DoS (>16 KiB + slow-loris
  deadline ~2s), error-leak (malformed PEM / RSA → fixed msg, no key bytes, no stack), flag-injection, and
  WHO-gate (SUDO_UID unset / NBSP-padded / SUDO_USER spoof / (uid_t)-1) all HELD. C3 proven non-vacuous live
  (FAILs on key-absent / wrong-verify-key / sig-over-different-basis).
- **honesty-auditor** (`a...`) SHIP, **Grade A NO-OVERCLAIM.** Production inertness traced firsthand (zero
  callers of `crossUidLoomEdgeSigner`; `world-anchor-mint.js` passes `signer:undefined`; `LIVE_SOURCES`
  frozen-empty + untouched). 13/13 directives honored with traced evidence; 0 green-but-vacuous tests.

**Fold (1):** removed `parseArgv` from `loom-edge-custody-verify.js` exports (reviewer LOW — neither the
broker nor actor template exports it; narrows the security-module API to the mirror convention; no test
references it).

**Deferred (LOW, no action):** deterministic-sig replay (accepted-by-design — no freshness in the
content-addressed payload; deferred to PR-B's full-tuple commitment; documented in "What this DOESN'T claim
to fix"); the launcher header's HONEST-SCOPE under-claims D1 (an under-claim, harmless; D1 is fully
documented in the header body); the happy-path test's `stderr:''` is hardcoded like the broker template
(template-fidelity; SHADOW scope).

**Orchestrator independent verification (Rule 2a):** my own non-vacuous live dogfood (12/12) against the
real CLI — happy edge signs + verifies; #273 oracle closed (forged basis / axiom swap / F1 extra-key all
refuse); WHO + key-perm + leak-guard hold. (First dogfood run was self-inflicted-vacuous — a from-scratch
`env` with no PATH made `execFileSync('node',...)` spawn-error on every case; fixed to `process.execPath`.
The probe-honesty lesson, again.)

**Drift gates (all green):** signpost regenerated + `--check` up-to-date (Test 121); release-surface clean
at v3.11 (correctly unbumped — SHADOW); eslint exit 0 on all 6 files; the full kernel suite 113 files / 0
failed; `install.sh --hooks --test` 129 passed / 0 failed.

## CodeRabbit pre-PR fold (the 13th straight wave CodeRabbit complemented the board)

Two CLI passes (non-deterministic — different findings each run) → 7 distinct findings, all premise-probed
firsthand before folding (the async-bot gate). None were security bugs in the gate logic; 2 source
improvements + 4 test-non-vacuity gaps + 1 plan-prose contradiction. **Folded 6, deferred 1:**

- **[Major, source] euid for the C2 owner check** (`loom-edge-custody-verify.js`) — `gatherEdgeCustodyFacts`
  returned `runningUid: ruid` while `assessEdgeCustody`'s own model says POSIX perms use the EFFECTIVE uid;
  a setuid/seteuid launch would misclassify mode-lockdown vs real cross-uid. Folded: `runningUid =
  Number.isInteger(euid) ? euid : ruid`. (Inert in the normal operator-run case where ruid==euid; folded
  for correctness + code-vs-comment consistency.)
- **[Major, source] keep-draining after the size cap** (`loom-edge-sign.js` `readStdinBounded`) — the
  too-large branch finished + paused mid-stream, which can EPIPE a streaming caller still writing. Folded:
  MARK `tooLarge` + keep discarding until EOF/deadline, then return too-large (honors the same
  "always complete the drain" principle `main()` already follows; memory bounded, deadline still bounds time).
- **[Major, test] matching derived basis in the size tests** — the D5 (i)/(ii) tests used `'a'.repeat(64)`
  as the basis, so a drain regression would still refuse (basis-mismatch) and the test would pass vacuously.
  Folded: `deriveWorldAnchorEdgeId(big/mid)` so the size cap is the SOLE refusal reason (non-vacuous).
- **[minor, test] seed the parent env before the scrub assertion** (`loom-edge-launch.test.js` D1) — the
  test asserted the child env lacks the key-path vars but never set them in the parent, so it passed
  vacuously. Folded: seed both vars in the parent (restored in finally) so the scrub assertion can fail.
- **[minor, test] assert no PEM marker in the malformed-PEM leak test** — the test asserted no `NOTBASE64`
  body but the name claims "no PEM substring"; added the `KEY_MARKER` assertion to honor the contract.
- **[minor, plan] the "no existing file modified" contradiction** — clarified SIGNPOST is the only touched
  existing file (auto-generated, not hand-edited).
- **[minor, DEFERRED] skipped-tests-counted-as-PASS in the test harness** — a template-wide pattern (the
  broker + actor + every egress test uses the identical `try { fn(); passed++ }` harness; skips only occur
  on Windows where the suite does not run in CI). Deferring avoids diverging this one file's harness from
  the whole repo; a repo-wide harness change is the right scope if ever taken.

**Sibling debt (spawn_task):** the euid + keep-draining improvements apply equally to the LIVE
`loom-custody-verify.js` (broker) + `loom-actor-custody-verify.js` (actor) + `loom-broker-sign.js`, which
carry the identical `runningUid: ruid` and immediate-finish-on-too-large patterns. Flagged for an aligned
follow-up (the "extend the fix to siblings" discipline) — NOT folded into this SHADOW edge wave to keep the
diff scoped + avoid touching the deployed broker/actor chain.

Re-verified after the fold: all 3 suites green, eslint clean, signpost up-to-date, full kernel suite green.
