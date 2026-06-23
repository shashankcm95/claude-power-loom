---
lifecycle: persistent
---

# Drift-loop evidence capture + cross-window convergence gate

**Wave**: kernel-tier self-improve substrate. **Branch**: `feat/drift-evidence-triage` (off fresh `origin/main` @515ab67).

## Problem (verified firsthand 2026-06-23)

The Ghost-Heartbeat drift judge classifies a session into a FROZEN drift class AND produces a
validated `evidence` string (`drift-audit.js:207` rejects an item without it). But
`drift-audit.js:246` emits `bumpSignal('drift:' + driftClass)`, and `bumpSignal`
(`drift-audit.js:222-227`) runs `self-improve-store.js bump --signal drift:<class>` — passing ONLY
the class. The evidence + sessionId are DISCARDED before the bump. `self-improve-store.js cmdBump`
persists per signal only `{count, firstSeen, lastSeen}`. At `/self-improve` triage a converged
`drift:*` candidate cannot be characterized → the 2026-06-23 triage of `cand-…-09d26d`
(`drift:contract-violation` ×3) was DISMISSED because the class was un-describable.

Second defect: a single intense ~4h arc can triple-count one root cause into a HIGH-risk
`rule-candidate` (`signalPolicy` drift-family `candidateThreshold=3`). Compaction rotates the
in-transcript `sessionId` (see memory `harness-runid-session-rotation`), so one arc produces several
distinct sids → "distinct sessionIds ≥ N" does NOT distinguish a one-arc burst from genuine
recurrence. The robust discriminator is the **wall-clock span**: a work-arc completes within a day;
genuine recurrence shows up across days.

## Runtime Probes (firsthand, 2026-06-23 — against the worktree base @515ab67)

| Claim | Probe | Result |
|---|---|---|
| No require-cycle from `spawn-state` → `egress/scrub` | `grep require packages/kernel/egress/scrub.js` + grep egress for self-improve-store | scrub→`_lib/secret-patterns` (leaf); egress never requires the store ⇒ no cycle |
| `drift:` is emitted ONLY by drift-audit's bumpSignal | `grep -rn 'drift:' --include=*.js packages \| grep bump\|signal` | only `drift-audit.js:246`; rest are `signalPolicy`/comments |
| Baseline green | `node tests/unit/scripts/{self-improve-store,drift-audit}.test.js` | 25/0 and 19/0 |
| `scrubEmitDiff` redacts a plain-quote secret (not just diffs) | `scrubEmitDiff('leaked sk-ant-AAAA… in code')` | `leaked [REDACTED] in code` |
| `parseArgs` mis-parses an evidence value starting with `--` | `parseArgs(['--signal','drift:x','--evidence','--force was used'])` | `{signal, evidence:true, "force was used":true}` — evidence LOST ⇒ `=`-form fix justified |

## Design

### Part 1 — persist per-occurrence evidence (bounded ring)

**Counter entry (`counters.signals[sig]`)**: add OPTIONAL `samples: [{evidence, sessionId, at}]`,
a bounded ring (last `MAX_EVIDENCE_SAMPLES = 10`, newest-last). Absent on old records + on
evidence-less bumps ⇒ backward-compatible.

**`self-improve-store.js`**
- `parseArgs`: also accept `--key=value` (split on FIRST `=`). Backward-compatible (no existing
  caller uses `=`); lets an evidence value that starts with `--`/contains spaces round-trip as ONE
  token (the probe-5 bug). Existing `--key value` space form preserved.
- `cmdBump`: new optional args `--evidence=<quote>`, `--session=<sid>`, `--at=<iso>`. When evidence
  present → `sanitizeEvidence` (lazy-require `egress/scrub.scrubEmitDiff` → strip control chars →
  collapse ws → bound `MAX_EVIDENCE_LEN = 500`) → `appendSample` (immutable, bounded). sid bounded
  +control-char-rejected; `at` parse-checked, else `now`. **Immutable**: new entry object + new
  `signals` map (no in-place mutation). Evidence-less bump = today's behavior exactly.
- Lazy require keeps the hot `bumpBatch` path free of egress; the store is the scrub authority so it
  never accretes raw secrets regardless of caller (task requirement). Fail-open w/ stderr warning if
  scrub unreachable (same pattern as the lock fallback) — but it is in-package, always present.

**`drift-audit.js`**
- `verifyJudgeOutputDetailed(items, opts)` returns `[{driftClass, evidence}]` (same allowlist /
  confidence / non-empty-evidence / dedup / cap logic). `verifyJudgeOutput` becomes
  `.map(d => d.driftClass)` — string[] contract UNCHANGED (T1–T6b stay green).
- `auditTranscript`: build `evidenceByClass` Map from the detailed survivors; compute `reviewedAt`
  once; default emit threads the evidence via `bumpSignal('drift:'+c, {evidence, sessionId, at})`,
  with evidence read from `evidenceByClass.get(c)`. Tests pass their own `emitFn(c)` ⇒ unaffected.
- `bumpSignal(signal, {evidence, sessionId, at} = {})`: pass `--evidence=<value>` (=-form, bounded),
  `--session=<sid>`, `--at=<iso>` only when evidence present. Not exported; only the CLI default emit
  uses it.

### Part 2 — cross-window convergence gate (drift-family only)

- `signalPolicy`: add `requiresCrossWindow: true` for `drift:` ONLY (NOT `rule-recurrence:` — keeps
  T21 green and matches task scope). Field present (`false`) on every return.
- `_runScan`, NEW-candidate path only (after the `existing` block's `continue`): `if
  (policy.requiresCrossWindow && !hasConvergenceSpan(entry)) continue;` — defer; the signal stays in
  counters and re-evaluates on a later scan once it spans a day.
- `hasConvergenceSpan(entry)` = `Date.parse(lastSeen) - Date.parse(firstSeen) > MIN_CONVERGENCE_SPAN_MS`
  (`= 86_400_000`, one day). **Span-only** — distinct-sessionId is deliberately NOT an alternative
  because compaction rotation inflates sids within one arc (probe rationale above); the samples ring
  still carries per-session evidence for the HUMAN triage, the gate uses wall-clock.
- Existing pending/terminal candidates hit the `existing` branch ⇒ gate does NOT retroactively
  un-converge them. Only NEW one-arc bursts are deferred.

**Surface in triage**: `_runScan` copies `entry.samples` onto the candidate (new + existing-refresh
paths). `cmdPending --json` already serializes full candidates ⇒ samples appear automatically.

## Behavior changes (honest)

- A drift class first seen today no longer converges to a candidate the same day; it converges once
  its `firstSeen..lastSeen` exceeds 1 day (genuine recurrence) OR is already a pending candidate.
  This is the intended fix for the one-arc-burst false-graduation.
- Tests T16/T18/T19 (same-day drift seeds) are UPDATED to seed a >1-day span so they still assert
  drift convergence under the new gate. T20–T23, T22/T22b (existing-candidate path) unchanged.

## Test plan (TDD — extend `tests/unit/scripts/self-improve-store.test.js`)

1. Update T16/T18/T19: seed `firstSeen`/`lastSeen` >1 day apart.
2. NEW: gate blocks a same-day one-arc drift burst (count≥3, span 0) → 0 candidates.
3. NEW: gate opens at >1-day span → 1 candidate.
4. NEW: `cmdBump --evidence/--session/--at` persists samples ring; bounded to 10 (newest kept).
5. NEW (non-vacuous): evidence carrying a planted `sk-ant-…` secret is `[REDACTED]` in the store.
6. NEW: `--evidence=--force …` round-trips (proves the `=`-form parser fix).
7. NEW: converged drift candidate exposes `samples` in `pending --json`.
8. NEW: old counters record (no samples) + evidence-less bump = no crash, no samples key added.
9. drift-audit: extend an e2e test to assert the default emit threads evidence (or unit-test
   `verifyJudgeOutputDetailed`).

## Gate
`node tests/unit/scripts/{self-improve-store,drift-audit}.test.js` green · full kernel suite
(`bash tests/run-pkg-unit.sh kernel`) · `bash install.sh --hooks --test` · eslint clean · multi-lens
VALIDATE (code-reviewer + hacker + honesty — self-improve substrate) · CodeRabbit · USER merge gate.

## HETS Spawn Plan
Architect VERIFY (pre-build, read-only) on this plan; post-build VALIDATE fans out code-reviewer
(correctness) + hacker (evidence-as-injection / secret-accretion / ring-DoS) + honesty-auditor
(claim-vs-evidence on the gate's "blocks one-arc burst" claim). Read-only personas for both passes.

## Pre-Approval Verification (architect VERIFY 2026-06-23 — verdict NEEDS-REVISION, all folded)

- **F1 (HIGH)** sample-ring immutability — freeze each `{evidence,sessionId,at}` at creation
  (`Object.freeze`); `appendSample` returns a new array; add a re-bump-does-not-mutate-prior test.
- **F2 (HIGH)** add a test: a same-day (span 0) ALREADY-pending drift candidate survives the gate
  (proves "gate affects only NEW candidates").
- **F3 (MED)** split `signalPolicy` branch — `requiresCrossWindow:true` for `drift:` ONLY; `false`
  for `rule-recurrence:` and the catch-all (keeps T21 green).
- **F4 (MED)** cap + `seen`/`isEmitted` dedup live in `verifyJudgeOutputDetailed` (single source);
  `verifyJudgeOutput` is a pure `.map`; `evidenceByClass` built from SURVIVORS (first-occurrence
  evidence), not raw items. Add a detailed-fn unit test (cap + first-occurrence).
- **F5 (MED)** `parseArgs`: when token has `=`, split on FIRST `=` (`indexOf`), parse inline, do NOT
  consume `argv[i+1]`. Add `parseArgs(['--evidence=foo','bar'])` test.
- **F6 (MED)** `hasConvergenceSpan` malformed timestamp → `NaN > day` is `false` → defer
  (fail-closed). Document + test.
- **F7 (MED)** scrub-unreachable ⇒ `sanitizeEvidence` returns '' ⇒ NO `samples` persisted (never
  raw); one-time stderr warning.
- **F8 (LOW)** honesty: a genuine recurrence whose total span stays <1 day is also DEFERRED (not
  dropped) until it next recurs across a day boundary — symmetric cost; ring preserves the evidence.
- **F9 (LOW)** module comment at the `egress/scrub` require site re: the deliberate outward
  dependency (deeper module, zero-drift) + the `bumpBatch`-carries-no-evidence forward-contract.
- **F10 (LOW)** reword "in-package" → "present in a correct install" (`egress` is a sibling dir).

## VALIDATE result (3-lens post-build, 2026-06-23)

Spawned in parallel on the built diff. **code-reviewer**: APPROVE (0 CRIT/HIGH; 1 PRINCIPLE — the
`spawn-state -> egress` outward require — documented + lazy + fail-closed, clean extraction path,
not a blocker). **hacker** (61 live probes against the BUILT modules): PASS-WITH-FIXES — 23 attack
classes, 4 bypasses. **honesty-auditor**: grade A- / MINOR-OVERCLAIMS (9/10 folds had code+test; F7
was code-only). Folds applied:

- **H1 (hacker HIGH) FOLDED** — `scrubEmitDiff`'s entropy pass only fires on `+`-diff-lines, so a
  high-entropy NON-canonical credential in a PROSE quote survived. `sanitizeEvidence` now runs an
  unconditional entropy pass (`redactHighEntropyTokens`, reusing `shannonEntropy`/`ENTROPY_BITS`)
  over the whole quote; hex shas stay under the 4.0-bit threshold (preserved). Test T34 (non-vacuous).
- **M1 (hacker MED) DOCUMENTED** — the gate reads self-asserted `firstSeen/lastSeen` (integrity !=
  provenance); a local writer could forge convergence. Bounded: drift is risk:high, NEVER
  auto-graduates (human-triaged advisory). `--at` confirmed NOT a gate lever. Advisory-only bound
  noted at `hasConvergenceSpan`.
- **L1 (hacker LOW) FOLDED** — `sanitizeSampleAt` normalizes a lenient/padded date to canonical ISO.
- **F7 (honesty MINOR) FOLDED** — `sanitizeEvidence` is now injectable + exported; T35 directly
  exercises the scrub-unreachable fail-closed path (null mod -> '') and the real-scrubber path.
- **M2 / split / double-base64** — pre-acknowledged coarse-scrub residuals (ADR-0017 human review);
  not regressions of this diff. **PRINCIPLE (extract scrubEmitDiff to `_lib`)** — deferred follow-up.

Non-vacuous proofs CONFIRMED by the hacker (removed each guard, watched T24/T28/T34 fire RED).
Final gate: store 37/0 · drift-audit 21/0 · kernel 101/101 · scripts+hooks green · eslint clean ·
`install.sh --all --test` 129/0 · FROZEN taxonomy untouched.
