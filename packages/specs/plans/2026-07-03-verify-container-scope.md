---
status: SCOPE
plan-of: verify-container the per-language compile/test-before-emit QUALITY gate. A SCOPE artifact, not a build plan; it maps what to REUSE (the ContainerAdapter primitive already exists) vs what is net-new (the egress pre-emit seam, per-language runners beyond pytest, the SHADOW-advisory recording), nails the trust framing (QUALITY not TRUST), the containment/host constraint (R12 residuals), and proposes a first SHADOW-advisory sub-wave.
---

# verify-container — pre-emit compile/test gate (scope)

F-W1..F-W3 are merged and SHADOW/dormant; F-W4 M0 (`maintainer_can_modify=false`) + M4 + M5 merged
(#492), with F-W4's remainder (M1 optional, M2, the operator arming half) held. With the emit
mechanism in place, the next north-star lever is candidate QUALITY: loom should never open a candidate
PR that fails the target repo's own build/tests. A maintainer will not merge a candidate whose tests
are red; verifying before emit is the highest-leverage remaining quality work (the fork-emit scope
named it: "verify-container right after").

## The load-bearing reframe (recon-completeness — do NOT rebuild what exists)

The hard part is ALREADY BUILT (v3.9 W1, `packages/lab/issue-corpus/`):

- **`ContainerAdapter.run({ repo, base_sha, candidate_patch, test_patch, test_ids })`**
  (`container-adapter.js`) does the whole contained pipeline: hardened clone -> apply patches ->
  run tests in a sandbox -> a result taxonomy (`CONTAINED_RESULT` / `SETUP_FAILURE` /
  `KILLED_FOR_DOS`) + a per-test parse (`parseTestStatus`, `evaluateOutcome`).
- **`_clone-lifecycle.js`** — the SHARED hardened git clone/apply (neutralizes repo hooks +
  ext-transport + fsmonitor, drops config + credential prompt, validates every attacker-controlled
  value, `--` at each flag boundary). Runs UNSANDBOXED on the host on attacker-influenced inputs.
- **`pytest-runner.js`** — the Python per-framework runner (the `LOOM_TEST_RESULT_PREFIX` marker
  convention + a wrapper). The TEMPLATE for adding more languages.
- **Backends**: `docker-backend.js` (R12 residuals CLOSED) + `sandbox-exec-backend.js` (macOS;
  H1 absolute-write-escape OPEN). `selectBackend` / `selectAttestedBackend`.

So verify-container REUSES the containment primitive. But VERIFY (3-lens, 2026-07-03) established it
is NOT a clean wiring wave: `ContainerAdapter.run` is coupled to the SEALED-CORPUS model (a caller-
supplied `base_sha`, an enumerated `test_ids` nodeid list, pre-provisioned deps in a network-denied
sandbox), and the LIVE pre-emit path has NONE of those. The real work is: (1) `ContainerAdapter.run`
(reuse) behind a NEW input-derivation adapter (base_sha threading + test-id enumeration OR a net-new
whole-suite mode, see O-INPUTS); (2) a dependency-provisioning model for a live repo's suite in a
network-denied sandbox (O-DEPS); (3) per-language runners beyond pytest + language DETECTION; (4) the
SHADOW-advisory recording + the eventual armed gate. The v3.9 W1 module named part of this as its own
deferred work ("wiring leg A into the scorer ... per-framework runners ... are W2 — NOT here").
**The reuse map is right; the input-derivation, whole-suite semantics, and dep-provisioning are
net-new and load-bearing — do not scope VC-W1 as a thin injected-fn wire.**

## The trust framing (LOAD-BEARING — QUALITY gate, NOT a trust gate)

**verify-container raises candidate QUALITY / merge-likelihood; it does NOT harden loom's trust
weight.** Per OQ-NS-6, an engineered / self-run check NARROWS, only a world-anchored merge HARDENS.
A candidate that passes tests loom itself ran in a sandbox is a STRONGER candidate, but "tests pass"
is not provenance: the tests are part of the actor-influenced diff (or the target repo's own suite,
which loom does not own). So:

- The verify RESULT feeds the emit QUALITY decision (open the PR / hold it), NOT any lab weight,
  reputation score, or `world_anchored` signal. It never touches `LIVE_SOURCES`.
- A green verify is advisory evidence for the HUMAN approver + a reason to emit, never a trust claim.
- This keeps verify-container cleanly on the QUALITY axis, disjoint from the #273 / world-anchor
  TRUST axis. (Do not let "we verified it" imply "it is trustworthy" — the sanitizer-best-effort
  lesson, SCAR #26.)

## The containment / host constraint (R12 — running untrusted code)

Verifying a candidate means EXECUTING untrusted code: the target repo's test harness (a stranger's
repo) plus the candidate diff. Containment is therefore load-bearing, and it is backend-dependent:

- **Docker backend (Linux)**: R12 residuals (H1 host-path escape, output-DoS bound, C1/C2
  process-group reaping) are CLOSED. The safe host for verifying an untrusted candidate.
- **macOS `sandbox-exec` backend**: H1 absolute-write-escape is OPEN + no hard memory-DoS bound +
  a read-scope residual (system dirs outside `/Users` readable). NOT fully contained.

**Consequence:** verify-container that runs a real untrusted candidate MUST use the Docker/Linux
backend. On the macOS dev host the containment is degraded — so VC-W1 (below) either runs only against
the loom-generated + human-approved candidate on the trusted dogfood path, or requires
`selectAttestedBackend` to pick Docker, or stays a MockBackend dry-run. This mirrors the pra2b R12
host decision (build host-agnostic; the untrusted-execution host is Linux/Docker, operator-deferred).

## The pre-emit seam (where it wires)

The egress `emitPR` chokepoint (`packages/kernel/egress/emit-pr.js`) is where the candidate `draft`
exists just before the PR is opened. verify-container adds a step BEFORE the emit — but the inputs
`ContainerAdapter.run` needs are NOT all present at this boundary (VERIFY H1/H2):

- The emitPR `data` is `{ repo, issueRef, diff }` and the frozen `draft` is `{ repo, issueRef, title,
  touched_paths, diff }` — NEITHER carries `base_sha` (it is even in the `DISPOSITION_KEYS` deny-list,
  so an actor cannot supply one). `base_sha` is resolved LIVE inside `ghEmit` (default_branch ->
  git/ref -> `baseCommitSha`) AFTER this seam. The verify's clone base must be THREADED from a trusted
  source — the draft-loop / corpus record's sealed `base_sha`, or the armed path's `requestedBaseSha`
  (from the VERIFIED approval body) — and must EQUAL the base `ghEmit` emits against (a moved base =>
  the verify graded a different commit; bind the verified base into the advisory record so a mismatch
  is observable). This is NET-NEW plumbing, not a "derive from draft" one-liner. (O-INPUTS.)
- `ContainerAdapter.run` grades an ENUMERATED `test_ids` nodeid list; an empty list yields all-missing
  and NO verdict. A live issue has no sealed `fail_to_pass`/`pass_to_pass`. So the verify needs either
  a net-new WHOLE-SUITE mode (run pytest/jest with no nodeid filter, grade on the runner exit code +
  a "no test newly failed" assertion) OR a test-discovery step. (O-INPUTS + O-TESTS.)

The steps, corrected:

1. THREAD `{ repo: upstreamRepo, base_sha (from the trusted source above), candidate_patch: the diff }`
   into the injected verifier fn.
2. `ContainerAdapter.run(...)` clones + applies + runs in the Docker backend (untrusted exec); detect
   the language/framework from the SANDBOXED clone's manifest INSIDE the adapter (NOT a separate
   host-side inspection pass — see the host-clone residual).
3. Record the result (with the verified base) to a DEDICATED advisory sidecar (SHADOW). VC-W1: NEVER
   block the emit. VC-W2 (armed): a `CONTAINED_RESULT` with a test FAIL blocks the emit behind a
   STRICT deploy flag; the fn is invoked in a fail-open, NON-REVERTING, throw-swallowing position
   (like the additive join-key write) so W1's emitted BYTES are unchanged.

**Host-side clone residual (VERIFY H4 — load-bearing NEW surface):** `ContainerAdapter.run` ->
`_clone-lifecycle.prepareClone` runs `git clone/checkout/apply` UNSANDBOXED on the HOST on
attacker-influenced inputs (repo ref, base_sha, patches) BEFORE any sandbox exists. Today
`emit-pr.js` touches NO clone (diff-as-DATA only; `child_process` is deliberately not imported). So
verify-container INTRODUCES a host-side git-exec-on-attacker-input surface at the egress chokepoint.
`_clone-lifecycle` is hardened (SSRF host-allowlist, `GIT_CONFIG_*` strip, hooks/ext/fsmonitor
neutralized, `--` boundaries, clone-byte cap) — but this surface must be NAMED (threat model + the
security invariants below), and the egress path must enforce the github.com clone host-allowlist so a
candidate ref cannot become an SSRF / local-file clone.

`ContainerAdapter` is `lab` and `emit-pr.js` is `kernel`; the K12 layer boundary means the kernel must
not hard-`require` the lab. Wire the verifier as an INJECTED fn (like `armedEmitFn`) so the kernel
stays lab-agnostic and the seam is unit-provable with a Mock. (O-LAYER.)

## Candidate vs test-patch + which tests (a real design point)

`ContainerAdapter.run` takes `candidate_patch` AND `test_patch` separately (RFC R3 tamper-resistance:
the candidate must not clobber the tests). For a pre-emit QUALITY gate the question is WHICH tests to
run — and NONE of these is a free reuse of the current `run()` contract, which grades designated
nodeids over a SEALED `fail_to_pass`/`pass_to_pass` designation the live path lacks (VERIFY H2/M):

- **(a) the target repo's EXISTING suite** at `base_sha` — proves the candidate does not BREAK the
  repo, the strongest merge-likelihood signal. But it needs (i) a net-new WHOLE-SUITE runner mode
  (no nodeid filter; grade on exit code + "no test newly failed") since `run()` has no such mode, and
  (ii) the repo's DEPENDENCIES installed, which the network-denied sandbox cannot do (O-DEPS). So
  option (a) is NOT the free default the first draft implied.
- **(b) loom's ADDED tests** (if the candidate includes new tests) as the `test_patch`, kept separate
  from `candidate_patch` so the candidate cannot silently weaken them (R3). Yields a pass/fail on
  loom's own tests; "the fix is covered" needs loom to enumerate which added nodeids are the fix's,
  treated purely as "these new tests must pass" (there is NO sealed corpus-grade `resolved` verdict on
  the live path).
- Best eventually: BOTH (regression + fix-covered), each as a separate patch (R3). O-TESTS.

## Dependency provisioning (O-DEPS — a first-class blocker, VERIFY H3)

The grading sandbox DENIES network by design (the containment wall; `pytest-runner.js` already strips
plugins "that would need deps the network-denied sandbox can't install"). Running a live repo's
EXISTING suite needs its deps installed (`pip install` / `npm install`) — impossible network-denied.
The corpus path sidesteps this via pre-provisioned sealed images; a live arbitrary GitHub repo is not.
Options: a TWO-PHASE model (a network-ON, otherwise-locked-down install phase, then a network-OFF test
phase), OR per-language base images with common deps, OR limiting the first cut to repos whose suite /
loom-added tests run with ZERO third-party deps. Until O-DEPS is resolved, "run the existing suite as
the default" is not realistic for most repos — VC-W1's real run is limited to the zero-dep / dogfood /
loom-added-tests path.

## Proposed sub-waves

- **VC-W1 (recommended first — SHADOW/advisory, DEFAULT MockBackend):** the pre-emit seam as an
  INJECTED verifier fn, wired in a fail-open throw-swallowing NON-REVERTING position; the dedicated
  advisory sidecar; the trust-axis disjointness (below) + a structural exclusion test. DEFAULT to
  MockBackend so the SHADOW seam is proven end-to-end WITHOUT introducing the untrusted-exec surface
  (host-side clone + sandboxed run) until an operator provisions a Docker/Linux host. The emitted PR
  BYTES are byte-identical; a REAL run (Docker backend) is gated on O-HOST + base_sha threading
  (O-INPUTS) + a runner mode (O-TESTS) + dep provisioning (O-DEPS), so the first real-run cut is the
  zero-dep / dogfood / loom-added-tests path. (NOT a thin wire — see the reframe.)
- **VC-W2 (arm the gate):** a `CONTAINED_RESULT` + test-FAIL blocks the emit, behind a STRICT deploy
  flag (the fork-emit arming pattern). Disposition keyed on WHOSE FAULT (VERIFY M, anti-bypass):
  `KILLED_FOR_DOS` = fail-CLOSED (a candidate that DoS'd its own verify does NOT emit — else an
  adversarial candidate trivially trips a hang/OOM to skip the gate); `SETUP_FAILURE` fail-open-
  advisory ONLY when attributable to loom-side infra (backend not attested, image absent), fail-closed
  if the failure is inside the candidate's run (sentinel-absent after a clean clone/apply). Record the
  reason so the disposition is auditable.
- **VC-W3+ (breadth):** more languages/frameworks; the O-DEPS two-phase / base-image model; the R3
  test-patch tamper-resistance; a per-run resource budget surfaced to the approver; clone caching.

## Open questions

- **O-INPUTS (VERIFY H1/H2 — load-bearing):** `base_sha` and the test-id set are NOT at the emitPR
  seam. How is `base_sha` threaded (the draft-loop / corpus sealed base, or the armed
  `requestedBaseSha`) and reconciled with `ghEmit`'s live base? And how are tests selected — a net-new
  WHOLE-SUITE runner mode, or an enumerated nodeid list? These gate whether the primitive can produce
  ANY verdict.
- **O-DEPS (VERIFY H3 — first-class blocker):** how a live repo's deps get installed in a
  network-denied sandbox (two-phase network-on-install then network-off-test, per-language base
  images, or a zero-dep-only first cut). See the dependency-provisioning section.
- **O-LAYER:** the kernel(egress) -> lab(ContainerAdapter) dependency. Inject the verifier fn (VC-W1
  default, keeps the kernel lab-agnostic) vs promote a thin container-verify primitive into
  `kernel/_lib`. Recommend inject-first; revisit if the seam needs kernel guarantees.
- **O-TESTS:** the repo's existing suite (a — needs a whole-suite mode + O-DEPS), loom's added tests
  (b), or both (recommend both eventually; separate patches per R3).
- **O-HOST:** the untrusted-execution host. Docker/Linux is the only fully-contained backend; the
  macOS dev host is degraded (H1 open). Recommend: VC-W1 defaults to MockBackend; a REAL run requires
  `selectAttestedBackend` -> Docker (operator-provisioned Linux host), never the macOS backend for an
  untrusted candidate.
- **O-DISPOSITION (armed, VC-W2 — anti-bypass, VERIFY M):** key fail-open-vs-closed on WHOSE FAULT,
  NOT the coarse result_class. `KILLED_FOR_DOS` = fail-CLOSED (else a candidate trips a hang/OOM to
  skip the gate — can't-verify is exactly the state an adversarial candidate manufactures);
  `SETUP_FAILURE` fail-open-advisory ONLY for loom-side infra, fail-closed if inside the candidate's
  run; record the reason.

## Security invariants (carry verbatim)

- verify-container is a QUALITY gate; its verdict is written ONLY to a dedicated advisory sidecar keyed
  by candidate id. It MUST NOT be added to the egress join-key payload (`writeJoinKey`), the
  world-anchor / lesson stores, any reputation / verdict-attestation record, or any field a
  `weight-source-gate` consumer reads — never a trust weight / `world_anchored` / `LIVE_SOURCES`
  (OQ-NS-6; disjoint from the #273 axis). Back it with a structural import-exclusion test (mirroring
  the live-loop world-anchor exclusion test) proving verify-container does not IMPORT any trust-axis
  lane (so it cannot call a trust-store writer); the sidecar-schema test (the QUALITY-only record shape,
  no trust field) covers the write side, and a raw-fs write to a trust dir is the documented
  data-channel residual. (VERIFY LOW — a NAMED forbidden sink, not just an abstract goal.)
- Running an untrusted candidate MUST use the contained Docker/Linux backend; the macOS `sandbox-exec`
  backend has R12 residuals OPEN (H1 absolute-write-escape) and is NOT full containment. VC-W1 DEFAULTS
  to MockBackend.
- verify-container ADDS a host-side git-exec-on-attacker-input surface at the egress chokepoint
  (`_clone-lifecycle.prepareClone` runs UNSANDBOXED on the host BEFORE any sandbox); today `emit-pr.js`
  has NONE. It relies on `_clone-lifecycle`'s host-side hardening AND the egress path must enforce the
  github.com clone host-allowlist (SSRF / local-file-clone defense). Named, not free. (VERIFY H4.)
- The kernel must not hard-`require` the lab (K12 layer boundary); wire the verifier as an injected fn.
- Claude scopes + builds the SHADOW/advisory mechanism (MockBackend default); a real untrusted-
  execution deploy on a Linux/Docker host is operator-owned, like the other arming steps.

## VERIFY result (3-lens board, 2026-07-03)

Read-only 3-lens VERIFY over the FIRST draft of this scope (architect + hacker + honesty-auditor,
parallel). **All three: NEEDS-REVISION** — the REUSE thesis was CONFIRMED correct (the trio
`ContainerAdapter.run` / `_clone-lifecycle` / `pytest-runner` genuinely do contained clone/apply/test/
parse; the R12 containment claims accurate; the QUALITY-not-TRUST framing sound), but the SEAM was
under-specified and over-claimed the "clean wiring" ease. All findings premise-probed and folded here:

- **base_sha is not at the emitPR seam (HIGH x3):** the draft carries no base_sha; it is resolved live
  inside `ghEmit` AFTER the seam. Rewrote the seam to THREAD base_sha from a trusted source (draft-loop
  sealed base / armed `requestedBaseSha`) + reconcile with the live base; added O-INPUTS.
- **"run the existing suite" != `run()`'s designated-test_ids grading (HIGH):** `run()` has no
  whole-suite mode. Corrected option (a) to require a net-new whole-suite mode OR test enumeration.
- **network-denied sandbox can't install deps (HIGH):** added the O-DEPS dependency-provisioning
  section (two-phase / base-images / zero-dep-first) as a first-class blocker.
- **new unsandboxed host-side clone at emit time (HIGH):** named the `_clone-lifecycle` host-side
  surface in the seam + the security invariants; added the github.com host-allowlist (SSRF) requirement.
- **O-DISPOSITION fail-open is a bypass (MEDIUM):** revised to key on WHOSE FAULT — `KILLED_FOR_DOS`
  fail-CLOSED (anti-bypass).
- **byte-identical conflates wire-bytes with host side effects (MEDIUM):** reframed VC-W1 to DEFAULT
  MockBackend (wire-bytes identical; the untrusted-exec surface gated on operator Docker).
- **trust-axis invariant needs a named sink + F-W4 prose (LOW x2):** named the forbidden sinks + a
  structural exclusion test; corrected the F-W4 state line.

Verdict after fold: the reuse thesis holds; VC-W1 is a genuine wave (MockBackend-default SHADOW seam +
the trust-axis disjointness + exclusion test) with the real Docker-backed run gated on
O-INPUTS/O-DEPS/O-HOST + the operator Linux host. NOT a thin wire.
