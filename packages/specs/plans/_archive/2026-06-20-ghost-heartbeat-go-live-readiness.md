---
lifecycle: ephemeral
archive-after: 2026-08-15
---

# Ghost Heartbeat go-live readiness (PR-A) — honesty fixes + deployment-template + runbook

**Status:** PLAN (pre-VERIFY)
**Origin:** the `/phase-close` over the integrated Ghost Heartbeat Wave 2 (2026-06-20,
`CLOSEABLE-WITH-NOTES`) surfaced go-live preconditions + doc-honesty defects. This PR folds
the LOW-RISK subset; the correctness-sensitive `pruneEmitted` retention bound is split to a
dedicated follow-up (PR-B) per the "don't bundle a risky change with mechanical ones" + the
"reviewable in one sitting" disciplines.

## Scope (this PR — all low-risk: doc / config / a new runbook)

1. **Doc-honesty fixes (3 stale/overclaiming comments in merged code):**
   - `hooks/lifecycle/ghost-heartbeat-stop.js:14` — "The same marker is PR-3's drain queue."
     is FALSE: #373's runner globs `~/.claude/projects` directly and never reads the marker
     (the marker is THIS carrier's per-session debounce record only). Reword.
   - `spawn-state/drift-audit.js:56-57` — the file-header summary says "a filename/field
     mismatch is rejected"; the code does NOT reject (it uses the DOMINANT in-content
     sessionId — lines 116-126 already explain this correctly). Reword the stale summary to
     match (RFC section 10 recorded this correction; the comment lagged).
   - `spawn-state/ghost-heartbeat-run.js:9` — "The GUARANTEED unattended heartbeat" overclaims
     (the unattended runner->real-judge end-to-end was never observed; R-real uses a mock
     judge). Soften to "the unattended drain path (the real end-to-end run is gated to a
     post-install dogfood)."
2. **`settings-reference.json` Stop-block patch (the HIGH deployment finding):** add the
   `ghost-heartbeat-stop` entry to the Stop block, in the SAME relative position as
   `hooks.json` (after `session-end-nudge`, before `context-size-warn-stop`), so the two
   deployment templates stop drifting. Today a user who follows the documented manual-merge
   path (`install.sh:329-331` -> `settings-reference.json`) NEVER wires the Stop carrier.
3. **`GHOST_HEARTBEAT_JUDGE_MODEL` env override (RFC OQ-W2-1, undelivered):** the RFC promised
   an env-configurable judge model; the build hardcoded haiku. Make the `model` default in
   `runCapabilityFreeJudge` resolve `process.env.GHOST_HEARTBEAT_JUDGE_MODEL || DEFAULT_MODEL`
   (preserves the deliberate pin-by-default; adds the documented override). Document the var.
4. **RFC capability-free-guard honesty reword:** section 2 pillar 1 + section 5.6 claim the
   property is "guarded by a CI regression test." It is NOT: G3 (the real-`claude -p`
   sentinel-leak test) self-SKIPS when `claude` is off PATH (i.e. CI); G1 only catches a
   flag-STRING change, not a CLI-behavior change that re-opens a tool. Reword to the honest
   "a LOCAL pre-merge probe (skipped in CI where `claude` is absent) + a flag-string golden;
   a real-`claude` G3 pass is a GO-LIVE gate, not a continuous CI guarantee."
5. **GO-LIVE runbook (new doc — the highest-value forward artifact per the phase-close
   architect):** `docs/ghost-heartbeat-go-live.md` — the single forward contract for flipping
   `GHOST_HEARTBEAT_EMIT=1`, consolidating the (a)-(f) preconditions today scattered across 5
   plan files + MEMORY, INCLUDING the PR-B `pruneEmitted` + marker-GC safe-keep-set design
   sketch (below) so the follow-up is fully specified.

## Non-goals (split to PR-B — a dedicated, TDD-treated, architect-designed change)

- **`pruneEmitted` wiring** + **marker GC.** These touch the emitted-set, which is the
  double-emit CORRECTNESS boundary (RFC section 2.2 — convergence requires DISTINCT sessions;
  a wrongful prune -> re-audit -> re-emit -> a single session over-counts toward the
  threshold-of-3). A SAFE keep-set is non-trivial and is designed in the runbook (PR-B). NOT
  bundled here — a correctness-boundary change must not ride a doc/config batch.

## Runtime Probes (verified against `main`, not memory)

| Claim | Probe | Result |
|---|---|---|
| `pruneEmitted` has ZERO live callers | `grep -rn pruneEmitted packages/ tests/` | CONFIRMED — only its module, its test, + plan docs |
| `settings-reference.json` Stop block lacks `ghost-heartbeat-stop` | `node -e` dump of `hooks.Stop` | CONFIRMED — console-log-check, auto-store-enrichment, session-end-nudge (+ context-size-warn); NO ghost-heartbeat-stop |
| `hooks.json` Stop has it (the order to mirror) | `node -e` dump | CONFIRMED — …session-end-nudge, **ghost-heartbeat-stop**, context-size-warn-stop |
| `drift-audit` never passes `model` -> always `DEFAULT_MODEL` | read `drift-audit.js:212` + `capability-free-claude.js:47` | CONFIRMED — `runCapabilityFreeJudge({ prompt })`; `model` defaults to `DEFAULT_MODEL='claude-haiku-4-5-20251001'`, no env lookup |
| stop.js:14 dead comment / run.js:9 overclaim verbatim | `sed -n` | CONFIRMED both |
| RFC "guarded by a CI regression test" vs G3 self-skips off-PATH | read the RFC section 2/5.6 + `capability-free-claude.test.js` | (probe at build — phase-close PM read it firsthand: G3 `SKIP ... claude not on PATH (expected in CI)`) |

## PR-B design — an OPEN problem (VERIFY proved the naive sketch UNSAFE; the runbook documents it as OPEN, NOT a settled spec)

> **The architect VERIFY found the naive "present-paths keep-set" UNSAFE** — 3 HIGH holes from a
> KEY-SPACE MISMATCH: the emitted-set is keyed by the many-to-one *dominant sessionId*, the
> keep-set is derived from a *path*-keyed (lossy) cost-map, and the dominant sessionId is
> NON-MONOTONIC across compaction. So "every present path contributes its sessionId" ≠ "every
> re-auditable session is kept" → a still-re-auditable session can be wrongly pruned → re-audit
> double-emits → over-counts toward the convergence threshold-of-3. **The runbook documents
> PR-B as an OPEN design problem (the holes + the direction below), NOT a settled spec — a
> codified-wrong spec is worse than an honest open one. The real design happens under PR-B's
> own TDD + 3-lens tier.**
>
> **Direction the safe design MUST follow (architect):** the keep-set is a SUPERSET-safe
> OVER-approximation, never tight — **default-KEEP on uncertainty**; prune a sessionId only when
> POSITIVELY observed absent. (1) prune only when EVERY present path is audited-this-run-with-a-
> captured-sid OR skipped-with-a-NON-NULL-stored-sid (a null sid = "unknown" → defer the whole
> prune that run — covers the back-compat bare-number cost-map); (2) `auditTranscript` must thread
> `dg.sessionId` into EVERY return branch that computed a dominant sid (judge-fail / no-drift /
> emitted), null only on a genuine digest-fail — "audited-in-cost-map" and "sessionId-known" are
> DISTINCT predicates; (3) prune a sid only after it has been ABSENT for K≥2 consecutive complete
> runs AND past a wall-clock floor — absorbs the non-monotonic B→C→B dominant-sid flip + the
> concurrent Stop-child race (the lock makes the WRITE atomic, NOT the DECISION correct).
> **Named residual (honest):** a transcript ABSENT during a complete scan that later RETURNS
> (restored backup / remounted volume) re-audits → re-emits; bounded by `MAX_EMIT_PER_SESSION`
> per session; acceptable for an advisory counter (narrows-only → worst case = a false
> convergence surfacing a human-triage prompt). **Marker-GC** is the one PR-B piece VERIFY rated
> SAFE-as-sketched: lstat-no-follow + isFile (no symlink traversal out of `markerDir`), fail-open,
> env-clamped keep-N/TTL bound — bundle it WITH pruneEmitted (both runner-owned retention).

The (now-superseded) naive sketch, kept only to show WHY it is unsafe:
The emitted-set is keyed by in-content sessionId; pruning a session's entry is safe ONLY if
that session can never be re-audited. A session is re-audited only if its transcript is still
present in `~/.claude/projects`. So **keepSessionIds = the dominant sessionIds of all PRESENT
transcripts**. Derive it cheaply + safely WITHOUT extra reads:

- `auditTranscript` returns its `sessionId` (additive to the result).
- The runner cost-map carries it: `audited[path] = { mtimeMs, sessionId }` (schema bump, with
  back-compat tolerate of an old bare-number entry as `{ mtimeMs:n, sessionId:null }`).
- Every PRESENT path is either SKIPPED (in the cost-map -> stored sessionId) or AUDITED this
  run (-> captured sessionId). So `keepSessionIds` = (skipped paths' stored sessionId) UNION
  (audited paths' captured sessionId) = exactly the present sessions. NO extra reads.
- **Cost-map-reset self-heals:** a wiped cost-map -> every path is audited this run ->
  every sessionId re-captured -> keep-set complete -> NO wrongful emitted-set wipe (preserves
  the "a lossy cost-map only wastes a judge call, never misses/over-counts" invariant).
- **Only prune on a COMPLETE scan** (not budget/cap-cut): a cut scan has an incomplete
  keep-set -> defer pruning to a later complete run. A new-but-unaudited path has no emitted
  entry anyway (no-op).
- A dedicated `pruneEmittedState({ keepSessionIds, statePath, lockPath })` does the
  `withLockSoft(load -> pruneEmitted -> writeAtomic)` (the runner holds no lock itself).
- **Marker GC:** the Stop-hook's `ghost-heartbeat-spawns/` markers (debounce-only, no
  consumer) get a bounded keep-N-newest / TTL sweep in the runner (losing a marker only
  costs one extra debounced spawn — low-risk).

## Acceptance gates

- [ ] The 3 comments reworded to match the code; no behavior change.
- [ ] `settings-reference.json` Stop block includes the `ghost-heartbeat-stop` entry as the
      4th-of-5 (after `session-end-nudge`, before `context-size-warn`), using settings-reference's
      OWN convention (`description` + `"id": "stop:ghost-heartbeat"`, NOT hooks.json's `_comment`),
      `command: node HOME_DIR/.claude/packages/kernel/hooks/lifecycle/ghost-heartbeat-stop.js`,
      `timeout` matching hooks.json; valid JSON. A new `tests/unit/kernel/` test asserts the two
      Stop blocks agree (every hooks.json Stop command appears in settings-reference at the same
      position + the id) — picked up by the `find tests/unit/kernel` pre-push gate.
- [ ] `GHOST_HEARTBEAT_JUDGE_MODEL` override at the default-binding site (`model =
      process.env.GHOST_HEARTBEAT_JUDGE_MODEL || DEFAULT_MODEL` so an explicit caller arg still
      wins) + the pin comment updated to name the escape hatch + a unit test (stub `bin` echoes
      argv, assert `--model` flows).
- [ ] RFC reworded to match the artifact at ALL THREE overclaim sites — section 2 pillar 1
      (line 18) + section 5.6 consequence (line 95) + section 10 disposition (line 148): "guarded
      by a CI regression test" → "a LOCAL pre-merge probe (skipped in CI where `claude` is absent)
      + the G1 flag-string golden; a real-`claude` G3 pass is a GO-LIVE gate, not a continuous CI
      guarantee". Soften the line-76 W2-PR1-acceptance clause ("so a CLI change is caught") to note
      it self-skips in CI. Leave section 5.1/5.4 step-3 build-requirement language (describes what
      is shipped — accurate).
- [ ] `docs/ghost-heartbeat-go-live.md` written: the (a)-(f) precondition checklist + the PR-B
      design documented as an OPEN problem (the 3 holes + the architect's superset-safe direction
      + the vanished-then-returned residual), NOT a settled spec.
- [ ] `bash install.sh --hooks --test` green; full kernel suite green; eslint/yaml/markdownlint
      clean (ASCII-only); markdownlint on the new runbook + the RFC.
- [ ] VALIDATE (code-reviewer correctness + honesty-auditor on the RFC reword + runbook claims)
      then CodeRabbit.

## HETS Spawn Plan

Proportionate to a LOW-RISK doc/config PR (not the kernel/security/data-mutation 3-lens tier):

- **VERIFY (pre-build):** `architect` (the deployment-template fix correctness + the runbook /
  PR-B `pruneEmitted` safe-keep-set design soundness — is the cost-map-reset self-heal + the
  complete-scan guard actually safe?) + `code-reviewer` (settings-reference JSON shape/position,
  the env-override one-liner, the RFC reword accuracy).
- **VALIDATE (post-build):** `code-reviewer` (diff correctness) + `honesty-auditor` (does the
  RFC reword + runbook honestly match the artifacts; no new over-claim).

## Pre-Approval Verification (VERIFY board — folded 2026-06-20)

2-lens board (architect + code-reviewer). **architect: NEEDS-REVISION** (only on the PR-B
design SKETCH, NOT PR-A's scope — PR-A's mechanical items + the split are explicitly endorsed);
**code-reviewer: APPROVE-WITH-CHANGES.** Dispositions:

| # | Lens | Sev | Finding | Disposition |
|---|---|---|---|---|
| 1 | arch | HIGH×3 | the naive PR-B keep-set is UNSAFE (key-space mismatch + non-monotonic dominant-sid → 3 wrongful-prune sequences) | **FOLD** — runbook documents PR-B as an OPEN problem (holes + superset-safe direction + residual), NOT a settled spec; real design under PR-B's TDD + 3-lens tier |
| 2 | arch | MED | the split is right but DON'T ship the unsafe sketch as the spec | **FOLD** — item 5 + acceptance reworded to "OPEN, not settled" |
| 3 | arch | LOW | marker-GC is SAFE as sketched | keep in PR-B; runbook notes lstat-no-follow + fail-open + env-clamped bound |
| 4 | arch | LOW | PR-A mechanical items sound; settings-reference uses `description`+`id` (not `_comment`); env at default-binding | **FOLD** into the build |
| 5 | code-rev | HIGH | the sketch treats `auditTranscript` returning `sessionId` as a current fact — it is NOT (`{ok,emitted}` today) | **FOLD** — runbook states the additive `drift-audit.js` return change is a PR-B prerequisite |
| 6 | code-rev | HIGH | settings-reference entry needs an explicit `"id": "stop:ghost-heartbeat"` | **FOLD** into the build + the consistency test |
| 7 | code-rev | MED | the RFC overclaim ALSO appears at section 10 (line 148); §5.1/§5.4 step-3 are accurate build-reqs | **FOLD** — reword §2/§5.6/§10; leave §5.1/§5.4 |
| 8 | code-rev | MED | the vanished-then-returned transcript double-emit residual is undocumented | **FOLD** into the runbook's PR-B residuals |
| 9 | code-rev | LOW | specify the consistency-test file location | **FOLD** — `tests/unit/kernel/…`, gated by the kernel suite |
| 10 | code-rev | LOW | the model-pin comment should name the override escape hatch | **FOLD** into the comment update |

**Net:** PR-A scope unchanged (all mechanical items endorsed); the ONLY revision is honesty —
the runbook frames PR-B's `pruneEmitted` as OPEN-with-direction rather than settled-and-safe.
This is the VERIFY-before-codify discipline working: the gate stopped a double-count bug from
being frozen into the forward-contract doc.

**Build-discovered (in-theme) fix — G3 robustness.** During the build gate, the EXISTING
`capability-free-claude.test.js` G3 (the real-`claude -p` sentinel-leak test) FAILED on this box
with a claude `exit-1` — and FAILS IDENTICALLY on HEAD (environmental, NOT a regression;
`GHOST_HEARTBEAT_JUDGE_MODEL` unset). G3 was asserting `r.ok === true`, so it treated a claude
INVOCATION failure as a leak FAILURE. An exit-1 is INCONCLUSIVE (claude couldn't run a clean
classification), the same epistemic state as claude-absent — NOT a capability-free violation.
Folded a small robustness fix (directly in this PR's capability-free-guard honesty theme): G3 now
SKIPS on an invocation failure too, asserting no-leak ONLY on a SUCCESSFUL invocation. It still
FAILS on a real leak. This makes the test match the honest "local probe" framing the RFC reword
establishes. (In CI claude is absent → G3 already skipped → CI was always green; this fixes the
LOCAL pre-push gate + the test's epistemics.)

## Drift Notes

- This is the phase-close gate's own follow-through: the gate caught the divergence, this PR
  closes the cheap subset + specs the rest. The split (doc batch now, correctness-boundary
  change in PR-B) is the "don't bundle risk" discipline applied to my own remediation.
