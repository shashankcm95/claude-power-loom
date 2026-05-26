# H.7.3 — Route-decision intelligence + n=20 milestone

> Fifth phase via corrected autonomous-platform pattern. Hits the n=20 verdict milestone, unlocking H.7.4 (empirical refit of weighted_trust_score weights from accumulated data).

## Cycle headline

- **Pair-run**: 04-architect.theo (design, 12 findings, 85 citations, PASS) + 13-node-backend.noor (impl, 9 findings, 49 citations, PASS)
- **Convergence**: agree (1:1 with theo's design + 3 substantive pushbacks vs user-plan accepted)
- **Self-test**: 6/6 historical tasks produce theo's predicted recommendations
- **Milestone**: n=20 verdicts toolkit-wide; H.7.4 empirical refit now unblocked

## What landed

- **NEW** `scripts/agent-team/route-decide.js` (~310 LoC) — pure-function CLI helper with 6-dimension heuristic
- **NEW** `skills/agent-team/patterns/route-decision.md` (status `active+enforced`)
- `commands/build-team.md` — Step 0 inserted with 3-branch dispatch (route/borderline/root); fail-open if script missing
- `rules/core/workflow.md` — soft-rule section "Route-Decision for Non-Trivial Tasks"
- `patterns/README.md` — row 15 added
- 3 pattern docs updated for bidirectional related-link consistency

## theo's 3 substantive pushbacks (all accepted by noor)

1. **C-1**: Removed `review` from audit-binary trigger (too low-precision)
2. **C-2**: Split Compound into strong/weak; weak suppressed when Stakes fires (avoids double-counting)
3. **HIGH-2**: Raised Convergence-value weight from 0.10 to 0.15 (the dimension that uniquely justifies HETS over root)

## Self-test results (6/6 match theo's R1-R6 predictions)

| Task | Predicted | Actual | Score |
|------|-----------|--------|-------|
| Add rate limiting to Express API | borderline | borderline | 0.325 |
| React search-results-with-pagination | root* | root | 0.15 |
| Author k8s Deployment + Service manifest | route | route | 0.625 |
| Drop 9 stale entries from BACKLOG.md | root | root | 0 |
| Author USING.md walkthrough | root* | root | 0 |
| Design scalable URL shortener | borderline | borderline | 0.40 |

*known limit per theo's R2 — keyword heuristic doesn't catch UI-design / cross-cutting docs as routing-worthy. `--force-route` is the user-side escape hatch. Heuristic AGREES with hindsight on the over-route catches.

## n=20 milestone significance

H.6.6 committed to designing breeding rules from data, not theory:
> "Won't start until ≥20 verdicts accumulate. Designing from n=1 produces guesswork rules that get re-tuned later anyway."

We now have 20+ verdicts across 15 distinct identities. **H.7.4 — Empirical refit** is unblocked.

## Pattern generalization

Five phases via the corrected autonomous-platform pattern now:
- H.7.1 (callsite-wiring): architect + 13-node-backend
- H.7.2 (substrate-extension): architect + 13-node-backend
- H.5.7 (contract-template): architect + 13-node-backend
- CS-6 (doc work): architect + confused-user (NEW pair shape)
- H.7.3 (intelligence layer): architect + 13-node-backend

Pattern works across phase shapes AND pair shapes. Root coordinates ~10K tokens; substrate produces ~250-300K tokens.

## H.7.3 follow-ups (deferred)

- **H.7.4 — Empirical refit** (now unblocked): fit weighted_trust_score weights from 20+ verdicts; compare to H.7.2 theory-driven priors
- **Mid-orchestration escalation** — sub-agent → root signaling channel for "I need more agents"
- **Route-decide LLM-augmented mode** — for borderline cases
- **Per-user calibration** — `~/.claude/route-decide-preferences.json` for weight overrides
- **CS-13 env-var completion** — IRL test isolation; open since URL shortener
