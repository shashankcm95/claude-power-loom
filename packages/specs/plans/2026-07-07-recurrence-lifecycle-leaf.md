# Plan — recurrence-lifecycle pure leaf (ADR-0018 correction / ADR-0020)

lifecycle: persistent

## Decision (reshaped from ADR-0018 by the 2026-07-06 recon)

ADR-0018 mandated a one-time "extract the graduate/retire lifecycle as a shared library both
substrates consume," premised on it being *built more than once*. A read-only recon (5 mappers +
architect + honesty-auditor, firsthand-verified) found that premise **false at the code level**:

- The lifecycle is **built ONCE** — kernel `self-improve-store.js`.
- The lab causal-edge organ is a **different mechanism** (content-addressed tally + cross-run
  confirmation + Wilson-interval HARDEN gate + immutable tombstone), sharing **zero code** with it.
- `scripts/memory.js` (scars) has **no lifecycle code** — scar graduation is a human `/self-improve`
  discipline. Ghost-protocol *feeds* the kernel counter; it is not a second lifecycle.

So a literal "dedup two impls" would be **false-DRY** (ADR-0016's 2nd-consumer YAGNI gate is not met).
USER chose **docs + kernel cleanup**: correct ADR-0018 (ADR-0020) AND extract the genuinely-pure
DETECTION organ as a single-consumer kernel leaf that *names the organ once* (so a 4th reinvention is
visible), with a pluggable exit so fork #3 (rule vs gated-recall) stays open.

## Runtime probes (verified against the real code, 2026-07-07)

- `packages/kernel/spawn-state/self-improve-store.js` exists, 869 lines. Probe: `wc -l`.
- Anchors verified: `THRESHOLDS` :70 (`candidate:5, autoGraduate:10`), `hasConvergenceSpan` :314,
  `signalPolicy` :332, `_runScan` :490, `executeGraduation` :696, exports :825-842.
- The graduate-eligible predicate `policy.risk==='low' && entry.count>=THRESHOLDS.autoGraduate` is
  **duplicated verbatim at :529 (existing-path) and :562 (new-path)** — the one real in-file dup.
- Cross-window gate `hasConvergenceSpan` (:314) is span-between-two-STORED-timestamps
  (`Date.parse(firstSeen)`, `Date.parse(lastSeen)`), NOT age-from-now → the leaf needs **no clock**.
  NaN (absent/malformed) -> false (fail-closed). `MIN_CONVERGENCE_SPAN_MS = ONE_DAY_MS` (:182).
- Existing test contract EXISTS: `tests/unit/scripts/self-improve-store.test.js` (997 lines) — T1-T9
  scan behaviors (threshold-5 candidate, count-10 auto-grad new+existing-flip, idempotent no-double-log,
  medium-risk-no-autograd, re-classify, refresh), T14 log format, T23 signalPolicy export shape. This
  is the behavior-preserving safety net; it invokes via CLI `runCmd(home, 'scan')`.
- Cross-window gate and graduate-eligible are **mutually exclusive under current policies**
  (`requiresCrossWindow` is drift-only = high-risk; graduate needs low-risk) — but the leaf preserves
  the original new-path order (defer BEFORE graduate) so a future low-risk+cross-window policy is safe.

> **▶ post-refactor accretion (2026-07-07, after the build + VALIDATE):** the anchors above were probed against
> the PRE-refactor file; they describe the extraction TARGET. Post-refactor: the `:529/:562` duplicated predicate
> is GONE (that was the whole point — grep `risk === 'low' && entry.count` returns zero), and the remaining
> anchors shifted by the import + adapter lines (`hasConvergenceSpan` :318, `signalPolicy` :338, `_runScan` :496,
> `MIN_CONVERGENCE_SPAN_MS` :186). Read the CURRENT file for live line numbers. (Honesty-auditor MEDIUM-2.)

## The seam (minimal, behavior-preserving)

New pure leaf `packages/kernel/_lib/recurrence-lifecycle.js` (kernel `_lib` = legal inward import per
dependency-rule; mirrors `recency-decay.js`). No I/O, no Date, no mutation. Exports:

- `STAGE` frozen enum: `below-threshold | deferred-cross-window | candidate | graduate-eligible`.
- `hasConverged(tally, policy)` — `(lastSeenMs - firstSeenMs) > policy.crossWindowSpanMs`; non-finite -> false.
- `isGraduateEligible(tally, policy)` — `policy.lowRisk && count >= policy.autoGraduateThreshold`.
- `classifyRecurrence(tally, policy)` — the staged organ: below-threshold -> deferred-cross-window
  (only if `requiresCrossWindow`) -> graduate-eligible -> candidate. Order preserves `_runScan` new-path.

`tally = { count, firstSeenMs, lastSeenMs }`. `policy = { candidateThreshold, autoGraduateThreshold,
lowRisk, requiresCrossWindow, crossWindowSpanMs }`.

Store refactor (`self-improve-store.js`):

- `hasConvergenceSpan(entry)` becomes a thin wrapper -> builds tally/policy -> leaf `hasConverged`
  (preserves the export + any test).
- `_runScan` new-path: `classifyRecurrence(...)` switch (replaces the :501 threshold-skip, :543 defer,
  :562 graduate). Existing-path: `isGraduateEligible(...)` (replaces the :529 graduate). Both remove the
  duplicated predicate.
- The leaf-policy is built at the call site from `signalPolicy(signal)` + `THRESHOLDS.autoGraduate` +
  `MIN_CONVERGENCE_SPAN_MS` + `(risk === 'low')`. **`signalPolicy`'s own return shape is UNCHANGED**
  (exported + T23-tested).

## TDD order (TDD-treatment — pure extraction with an existing contract)

1. Write `tests/unit/kernel/recurrence-lifecycle.test.js` FIRST (leaf's pure behavior) -> RED (no leaf).
2. Build `recurrence-lifecycle.js` -> leaf tests GREEN.
3. Refactor `self-improve-store.js` to delegate.
4. Run the EXISTING 997-line `self-improve-store.test.js` -> must stay GREEN (behavior-preserving).
5. Full kernel suite green + `node scripts/generate-signpost.js --check` (new .js file).

## Files

- NEW `packages/kernel/_lib/recurrence-lifecycle.js` (~70 LoC)
- NEW `tests/unit/kernel/recurrence-lifecycle.test.js` (~150 LoC)
- EDIT `packages/kernel/spawn-state/self-improve-store.js` (~40 LoC net — delegate)
- NEW `packages/specs/adrs/0020-*.md` (correct ADR-0018 invariant #1)
- EDIT `packages/specs/adrs/0018-memory-architecture.md` (status-note + pointer to 0020)
- EDIT `docs/FORKS.md` (FORK-2 dated UPDATE — rebase-on-return)
- (post-PR, not in repo) MEMORY.md canonical line -> "ADR-0018 + ADR-0020"

## Risks

- R1 false-DRY / over-abstraction — mitigated: leaf is the DETECTION predicate only (not the loop, not
  a callback protocol); single consumer; lab untouched.
- R2 behavioral drift — mitigated: the 997-line existing contract is the safety net; leaf is pure +
  order-preserving; `signalPolicy`/`executeGraduation`/terminal-stickiness/no-op-lock residual unchanged.
- R3 SHADOW perturbation — mitigated: PR diff touches ZERO `packages/lab/` files (grep-verify).

## VALIDATE result (2026-07-07 — 3-lens board on the BUILT diff)

All three lenses **GREENLIGHT / Approve**; no code change required.

- **code-reviewer (correctness):** Approve. 0 CRITICAL/HIGH/MEDIUM/PRINCIPLE. Line-by-line diff of `_runScan`
  confirmed the only changes are the gate-expression replacements; `executeGraduation`, terminal-state stickiness,
  evidence-ring refresh, and the no-op-lock residual are byte-for-byte untouched. Asymmetry / boundaries / NaN
  fail-closed / STAGE ordering all verified. 1 LOW (note): the leaf's `(tally && tally.count) || 0` is a looser
  contract than the store needs — no fix, flagged for future callers.
- **hacker (adversarial):** NO NEW ATTACK SURFACE, green to merge. 8 probe families / 90,688 input combinations /
  **0 bypasses**. The load-bearing invariant — a converged high-risk `drift:` class can NEVER be forged into an
  auto-graduation — is preserved (`isGraduateEligible` hard-gates `lowRisk === true`). No prototype-pollution vector.
  The one reachable divergence (malformed/undefined `count`) moves in the SAFE direction (suppresses a spurious
  triage candidate). The unauthenticated-timestamp residual is UNCHANGED (not newly exposed).
- **honesty-auditor (claim-vs-evidence):** Grade **A-**, MINOR-OVERCLAIMS -> GREENLIGHT (no REVISE). 6/7 load-bearing
  claims VERIFIED TRUE (named-once, asymmetry, strict `>`, NaN fail-closed, export preserved, zero-lab-perturbation).
  Two non-blocking touch-ups, both APPLIED: (1) scoped the "byte-identical" wording to "behavior-preserving on
  store-produced inputs, fail-closed-safer on malformed external `count`" (this doc, ADR-0020, the leaf test header);
  (2) this dated probe accretion noting the `:529/:562` dup is the now-removed extraction target + shifted anchors.

**Disposition:** keep the safer `|| 0` normalization (all three lenses endorse the direction); ship. Root-built diff,
so no verdict-attestation record (Rule 4 — only delegated builder spawns are legal subjects).
