# ③.1-W4 — Real claude -p run + genuinely-earned grounding (the final ③.1 wave)

- **Date**: 2026-06-18
- **Phase**: ③.1 dry-run (SHADOW, DRAFT-only, trust ZERO — OQ-NS-6)
- **Status**: PLAN — umbrella decomposition + W4a detail (the first buildable sub-wave)
- **Closes**: ③.1 → produces the routing corpus for Router-v2

## Goal

Make the 3-arm persona experiment (apparatus built in W3a+W3b) run for REAL: a real
`claude -p` solveFn, a harness-computed behavioral grade (never the subject's self-asserted
verdict), a genuinely-earned arm-C grounding slice, and the C2 store reconcile. The run
produces the routing corpus that feeds the queued Router-v2 wave. Everything is SHADOW —
the apparatus NARROWS; only a world-anchored EXTERNAL-PR merge hardens trust (OQ-NS-6).

## USER decisions (2026-06-18, the two load-bearing forks)

1. **Subject persona = forge `python-backend`** (the clean general-Python subject; the corpus
   is general Python, not ML). The full 3-layer split (agents → runtime/personas → contract).
2. **Arm-C grounding = generate genuinely-earned** lessons: run the real `claude -p`
   actor+confirm loop FOR `python-backend` on a corpus subset to produce genuine
   persona-attributed confirmed lessons, THEN run the 3-arm experiment slicing them. The
   truest test of the earned-vs-declared thesis (vs re-attribution or synthetic seeding).

## Runtime Probes (firsthand, 2026-06-18 — claims this plan rests on)

| Claim | Probe | Result |
|---|---|---|
| No Python persona exists; closest is `ml-engineer` | `ls agents/*.md` | 18 personas; no `python-backend` — confirmed |
| A real Python corpus already exists (ready-made) | `find packages/lab/issue-corpus/_spike/corpus-build/staged` | **18** sealed resolved OSS issues (networkx×7, more-itertools×3, parse×3, faker×2, markdown×2, tabulate×1, pygments×1) with `.verdict.json` |
| C2 store migration is a no-op (no live rows) | `LOOM_LAB_STATE_DIR` + `grep '"role"' packages/lab` | dir unset / absent; all 20 committed `built_by.role` are `"unattributed"` — record-time enforcement ships with empty backfill |
| Next persona number is 17 | `ls packages/runtime/personas/ contracts/` | run 01–16; `python-backend` = `17-python-backend` |
| Roster keyed by numbered form | `grep DEFAULT_ROSTERS registry.js` | `'13-node-backend': [...]` at :88; needs `'17-python-backend'`; merge at :215 migrates stores |
| The real solveFn = compose of existing modules | understand-fan-out maps | `runActorTrajectory` (`causal-edge/trajectory-friction-run.js:73`) + `ContainerAdapter.run` (`issue-corpus/container-adapter.js:236`) + `evaluateOutcome` (:161); recipe = `_spike/real-e2e-actor-dogfood.js` |
| The W3b sync guard is the intended async tripwire | understand map (arm-loop) | `arm-loop.js:133-135` throws on a thenable by design; W4 deletes it + threads `await` through runSolveSeam/runArm/runExperiment/cli |
| Grade is harness-computed over the SEALED corpus | understand map (grade-harness) | `evaluateOutcome(observed,{failToPass,passToPass})` → `resolved` (exact-set, never attacker stdout) → BEHAVIORAL_PASS/FAIL into `observedVerdict`'s slot |
| skill-forge workflow exists | `find packages/skills -ipath '*forge*'` | `packages/skills/library/skill-forge/SKILL.md` |

State claims that DECAY (re-probe at each sub-wave build): `LOOM_LAB_STATE_DIR` live rows
(C2 migration no-op); the next free persona number; the claude binary + sandbox-exec
attestation on the build host.

## Decomposition — 4 sub-waves (dependency chain W4a → W4b → W4c → W4d)

Each sub-wave is its own plan → architect VERIFY → TDD build → multi-lens VALIDATE → PR,
reviewable in one sitting. This umbrella anchors the sequence so the thread is not lost.

### W4a — Forge the `python-backend` (17-python-backend) subject persona [BUILDABLE NOW]

Purely additive; touches no experiment code. The prerequisite for arms B/C (the archetype
prose + the slice target). Deliverables:

- `agents/python-backend.md` — thin delegation layer (frontmatter `name`/`description`/
  `tools`/`model`/`color` + the "Read your brief at …" body), mirroring `node-backend.md`.
- `packages/runtime/personas/17-python-backend.md` — the authoritative identity brief
  (instincts, Layer-1 principles, the Python-builder lens), mirroring `13-node-backend.md`.
- `packages/runtime/contracts/17-python-backend.contract.json` — required skills, `kb_scope`,
  budget, `functional` + `antiPattern` verification checks, mirroring the 13-* contract.
- `packages/runtime/orchestration/identity/registry.js` — add `'17-python-backend'` to
  `DEFAULT_ROSTERS` (three roster names, matching the 3-name convention). The
  `_mergeRosterDefaults` read-merge (`registry.js:212-220`) SELF-HEALS existing stores — no
  migration step (proven by `registry-roster-fallback.test.js`).
- **Reconciliation is enforced by `contracts-validate.js`, NOT a `tests/unit/agents/` suite**
  (architect CRITICAL-1). The two validators + their gates:
  - **Capability reconcile** (`contracts-validate.js` ~:1219; test
    `tests/unit/runtime/contracts/agent-contract-reconcile.test.js:273` asserts count **18 →
    must bump to 19**): since `tools:` includes `Edit`/`Write` the contract MUST declare
    `worktree_writable`; `Bash` permits `bash_test_runner`; a read-only trait set under write
    tools is a `write-floor-missing` violation.
  - **Instinct reconcile** (`contracts-validate.js` ~:1290; test
    `persona-instinct-reconcile.test.js:298` asserts count **16 → must bump to 17**): the
    contract's `interface.instincts[]` MUST EXACTLY mirror the slugified numbered `## Mindset`
    headings in `17-python-backend.md` (set equality, deterministic `slugifyInstinct`). A
    heading with no contract slug → `instinct-missing-from-contract`; a slug with no heading →
    `instinct-not-in-brief`. Template: `13-node-backend.md:13-43` ↔ `contract.json:89-100`.
  - `agents/optimizer.md` + `agents/planner.md` exist WITHOUT numbered contracts and are
    correctly skipped (`NUMBERED_CONTRACT_RE`) — do NOT "fix" that; it is the source of the
    18-vs-16 count divergence.

`tools:` for `python-backend` = `["Read","Grep","Glob","Bash","Edit","Write"]` (a builder, same
capability surface as `node-backend`). It is Write-capable → a BUILD persona, never a
review-pass persona (workflow Rule 3).

**W4a build order (the instinct gate is the trap)**: author the persona brief's `## Mindset`
section FIRST → slugify the headings → set `interface.instincts[]` to exactly that slug set →
bump both count assertions (19 + 17) in the same diff. `_format` → `packages/runtime/schema/_format-spec.md`.

### W4b — Async seam + the real `claude -p` solve+grade driver

- **TDD-TREATMENT TRIGGER** (architect HIGH-2): deleting the sync tripwire (`arm-loop.js:133-135`)
  fails the live test `arm-loop.test.js:250-252` (`assert.throws(.../synchronous/)`). This is the
  "existing tests describe behavior that will change" case → rewrite that test FIRST to describe
  the NEW async contract (an async solveFn is awaited + wall-time-measured; a REJECTED promise
  degrades to `grade:'error'`, it must NOT escape catch-isolation), red against current impl,
  THEN convert. Make `runSolveSeam`/`runArm`/`runExperiment` + the cli call site `async`/`await`.
  PRESERVE the double catch-isolation (`arm-loop.js:24`) under `await` (the catch must now also
  catch a rejected promise). `arm-query` is unaffected (reads the persisted timeline). Preserve
  the `emitFn` guard in BOTH `runArm` and `runExperiment`.
- New injectable `real-solve.js` (lab sibling, K12-clean): `solveFn({arm,prompt,task})` =
  `runActorTrajectory` (claude -p actor → candidate diff in a hardened clone) →
  `ContainerAdapter.run({repo,base_sha,candidate_patch,test_patch,test_ids})` →
  `evaluateOutcome` → returns `{verdict: 'BEHAVIORAL_PASS'|'BEHAVIORAL_FAIL', ...}` (the
  HARNESS grade; the subject's stdout is INPUT to the sandbox, never the grade).
- **FLAG-1 (CI-green coupling)**: `arm-loop.js` must NEVER statically `require('./real-solve')`
  — that would transitively pull `child_process` into the CI-globbed `arm-loop.test.js`.
  `solveFn` is injected at the call site (`arm-loop.js:84,182`); `real-solve.js` is required ONLY
  by the W4c driver (outside `tests/unit/**`). `claudeBin=null` / injected `MockBackend` disables
  the real legs. A LOCAL real-engine spike proves the real path (Rule-2a-corollary: a green mock
  suite is a hypothesis, not proof).
- **MED-3 (honesty — do not over-claim tamper-resistance)**: the grade is harness-computed over
  the SEALED `failToPass`/`passToPass` (`container-adapter.js:161`, never attacker stdout) and is
  trustworthy FOR A NON-ADVERSARIAL SUBJECT. It is NOT tamper-proof: apply order is
  candidate-THEN-test (`container-adapter.js:245-247`), so a hostile candidate could clobber the
  test_patch — RFC R3 tamper-resistance is explicitly deferred (scorer W2, not W4). `python-backend`
  is non-adversarial → tolerable in SHADOW; state the residual, claim no more.
- Reuse VERBATIM: `makePytestResolver` (TMPDIR redirect already solved), the ANCHORED
  fence-strip (`calibration-issue-run.js:140`) for any LLM-judged leg, the hardened
  `prepareClone`. Select+cache ONE attested backend per session (`selectAttestedBackend`).

### W4c — Generate genuinely-earned lessons + run the 3-arm experiment [the ③.1-closing run]

- **CRITICAL-2 — `built_by` is NEVER stamped automatically** (architect): `scoreAttempt`
  (`calibration-issue.js:260-265`) and the existing `bootcamp-capture.js:43-59` recipe produce
  attempts WITH NO `built_by` field — which is exactly why all 20 committed nodes are
  `unattributed`. The W4c driver MUST explicitly inject
  `built_by: {role:'python-backend', roster_name:<a W4a roster name>, actor_kind:'claude_p'}`
  onto the attempt BEFORE `buildWorkedExampleNode` (`recall-graph.js:236`; shape per
  `arm-loop.test.js:53-59`). Without this, arm C's slice is empty and the thesis is untested.
  `roster_name` MUST be one of the three names W4a registers (validated by `ROSTER_TOKEN`);
  `role` is validated against `canonicalPersonaKey` (the `agents/*.md` glob) — both satisfied
  only once W4a ships. The `built_by.role` label is UNAUTHENTICATED provenance
  (`recall-graph.js:52-58`), never a trust input — do not over-claim authenticated authorship.
- **HIGH-1 — confirmation needs a DISTINCT actor diff** (architect): `runConfirmationPass` /
  `confirmsLesson` (`lesson-confirm.js:70-87`) REJECTS a confirming delta that equals the node's
  own patch (`:84`) or the accepted diff (`:85`), requires a REAL leg-A `BEHAVIORAL_PASS` (`:75`),
  and requires both `fail_to_pass` sets to exact-match the corpus-canonical `requirementFor`
  (`:79-80`). So the bootcamp shortcut (`candidate = accepted_diff`, `bootcamp-capture.js:55`)
  CANNOT confirm. W4c must run the REAL `claude -p` actor (W4b's `runActorTrajectory`) to produce
  an INDEPENDENT passing candidate that diverges from the accepted diff, grade it through the
  sandbox, and feed it as the confirming attempt with `opts.requirementFor` from the corpus.
- **HONEST FLOOR + fallback**: a real `claude -p` BEHAVIORAL_PASS on a fresh issue is NOT
  guaranteed (the corpus is 18 sealed issues — `staged/`). Set an explicit success floor (≥1
  confirmed lesson). If ZERO land, REPORT `n_confirmed=0` honestly — NEVER synthesize an edge
  (that re-introduces the #273 forged-edge class `security.md` forbids).
- **MED-1 guard (C2 ordering)**: any Rule-4 verdict recording in this wave uses the BARE
  `python-backend` form (the `canonical-persona-key.js:11` direction), so the W4d-before-or-after
  ordering is safe regardless of W4d's free-form-seam enforcement.
- Run `runExperiment` (real async solveFn) over the corpus for arms A/B/C → the F7 trace
  timeline; `compareArms` measures the discrimination (arm C recall/accrual/pass-rate vs A).
  Trace-signals primary (the W3-W4 metric choice); pass-rate is secondary.
- Output = the routing corpus for Router-v2 + the discrimination measurement.

### W4d — C2 full reconcile + real-content secret-scrub + reapOrphans + ③.1 phase-close

- Record-time roster enforcement: route raw persona keys through `canonicalPersonaKey` (or a
  roster-validating equivalent) at the write boundaries — primarily
  `verdict-attestation/store.js` `validateRecordVerdictInput` (`subject.persona`, the one
  free-form seam) + projection reconcile in `reputation/project.js` `personaOf`. The
  recall-graph/authorship lanes already refuse the numbered form (ROSTER_TOKEN leading-`[a-z]`).
  Migration = empty/trivial (probe-confirmed no live rows; re-probe at build).
- Real-content secret-scrub (the `arm-loop.js:20` deferral) using
  `kernel/_lib/secret-patterns.js` `getCanonicalSecretClasses` on any persisted artifact.
- `reapOrphans({dockerBin})` at batch start IF the Docker backend is selected (sandbox-exec
  default needs none).
- Then `/phase-close ③.1` (the 3-lens phase gate).

**Reconcile-ordering note**: `python-backend` (bare) is already canonical; W4c stamps the bare
form and recall-graph's ROSTER_TOKEN enforces it, so the free-form verdict-attestation seam
(W4d's target) is not exercised by W4c's writes — W4d may follow safely. If W4c ever records a
Rule-4 verdict row, W4d's `subject.persona` enforcement must precede it.

## Routing Decision

```json
{
  "recommendation": "root",
  "score_total": 0.05,
  "override": "route",
  "weights_version": "v1.3-dict-expanded-2026-06-12"
}
```

The scorer returned `root` (0.05): the token `experiment` scored as BOTH `domain_novelty`
(+0.15) AND a counter-signal (−0.25), netting genuinely-architect-shaped work (multi-file
substrate, security-sensitive subprocess spawn + store-write surface, async refactor across 4
modules, a new persona, a store reconcile) down to a false `root`. Per `route-decide.js`'s
load-bearing escalate-by-judgment comment, OVERRIDE to route. This is logged as a concrete
Router-v2 corpus data point (a real architect-shaped task the keyword scorer misclassified —
`drift:dictionary-gap`).

## HETS Spawn Plan

- **VERIFY (pre-build, this plan)**: 1 `architect` (read-only) pressure-tests the decomposition
  and the W4a forge specifics. Single-lens is sufficient at VERIFY for an additive forge wave;
  the security-sensitive surface (W4b/W4c real subprocess + W4d store-write) gets the full
  3-lens tier at ITS wave's VALIDATE.
- **BUILD (W4a)**: delegated `node-backend` (Write-capable builder) does the 3-layer forge +
  roster + tests (TDD).
- **VALIDATE (W4a, post-build)**: 1 `code-reviewer` (correctness) on the additive diff —
  W4a touches no data-mutation/security surface, so the single structural lens suffices (Rule
  2 reserves the 3-lens tier for kernel/security/auth/data-mutation diffs; W4b/W4c/W4d qualify,
  W4a does not). Record the delegated-build verdict per workflow Rule 4.

## Principle Audit (SOLID/DRY/KISS/YAGNI)

- **SRP/DIP**: the real solveFn is an INJECTED seam (W4b) mirroring the kernel
  `resolveParentFn` — arm-loop never reaches the network directly. The forge (W4a) adds new
  files alongside (Open/Closed), never edits the existing personas.
- **DRY**: W4b reuses `runActorTrajectory` / `ContainerAdapter` / `makePytestResolver` /
  the anchored fence-strip VERBATIM — no re-implementation of the v3.9 real-E2E machinery.
- **KISS/YAGNI**: W4a ships only the 3 layers + roster + reconciliation tests — no speculative
  persona capabilities. The decomposition defers each concern to the wave that needs it.
- **Immutability**: all builders return new objects; the seeded/earned recall-graph writes go
  through the verify-on-read stores (no in-place mutation of parsed rows).

## Drift Notes

- `drift:dictionary-gap` (conv→4): route-decide scored this architect-shaped wave `root` via the
  `experiment` double-count. Concrete Router-v2 corpus entry.
- Watched: the 3-layer persona split is INTENTIONAL (MEMORY: don't "dedup"). W4a forges a NEW
  persona across all 3 layers — confirm the reconciliation suite enforces the agreement.

## Pre-Approval Verification

**Architect VERIFY** (read-only, agentId `a42c84a9b827cc74a`, 2026-06-18) — verdict
**NEEDS-REVISION → REVISED-CLOSEABLE**. All findings folded above:

| Finding | Severity | Area | Disposition |
|---|---|---|---|
| Wrong test path (`tests/unit/agents/**`); two count assertions (18→19, 16→17) must bump | CRITICAL-1 | W4a | FOLDED — W4a now cites `contracts-validate.js` + the two `tests/unit/runtime/contracts/` tests + the count bumps |
| `built_by` never stamped by `scoreAttempt`/bootcamp recipe → `unattributed` lessons | CRITICAL-2 | W4c | FOLDED — W4c now mandates explicit `built_by` injection (cite `recall-graph.js:236` + `arm-loop.test.js:53-59`) |
| Confirmation needs a DISTINCT actor diff (not `accepted_diff`); set an honest floor | HIGH-1 | W4c | FOLDED — W4c now requires a real divergent actor pass + `requirementFor`; report `n_confirmed=0`, never synthesize |
| Async-guard test (`arm-loop.test.js:250-252`) is a TDD-treatment trigger | HIGH-2 | W4b | FOLDED — W4b now test-first; preserve double catch-isolation under `await` |
| Reconcile-ordering note correct; harden to a guard (bare `python-backend`) | MED-1 | decomposition | FOLDED — W4c MED-1 guard added |
| Contract must satisfy instinct set-equality (`## Mindset` slugs) + capability floor | MED-2 | W4a | FOLDED — W4a build-order step (Mindset-first → slugify → instincts[]) |
| "Harness-computed grade" ≠ tamper-proof (candidate-clobbers-test_patch, RFC R3 deferred) | MED-3 | honesty | FOLDED — W4b honesty caveat (non-adversarial-subject scope) |
| Corpus is 18 (not ~15+); roster merge self-heals on read | LOW-1 | honesty | FOLDED — Runtime Probes corrected |
| `real-solve.js` `require`s `child_process`; keep it out of `arm-loop.js`'s static graph | FLAG-1 | W4b | FOLDED — W4b lazy-import note |

**Architect-confirmed CORRECT (no change)**: async composition is wireable (`ContainerAdapter.run`/
`scoreAttempt`/`selectAttestedBackend` already async; conversion scope complete); the
reuse-verbatim list is real + DRY; `17-python-backend` is the right number (01–16 contiguous);
NO `marketplace.json`/`plugin.json` per-agent registration needed (agents auto-discover); the
route→override is justified; the C2 numbered-refusal characterization is accurate.

**Disposition**: REVISED-CLOSEABLE — proceed to build **W4a** (the prerequisite forge). W4b/W4c
findings are folded into the umbrella so each sub-plan is built on the real mechanism.
