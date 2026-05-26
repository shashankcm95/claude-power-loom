# Self-improve loop empirically broken — 0 actionable signals in 47 candidates

**Date**: 2026-05-26
**Phase**: pre-Phase-0 (post v5.4 BLUEPRINT-LOCK)
**Signal-type**: substrate-self-observation + anti-pattern
**Pillar relevance**: cross-cutting; directly informs v3.3 Evolution Lab (E1/E2/E3/E4) design

## What happened

Audit of `~/.claude/checkpoints/self-improve-pending.json` on 2026-05-26 (21 days after the mechanism activated on 2026-05-05):

| Status | Count | % |
|---|---|---|
| Promoted | 2 | 4.3% |
| Auto-graduated (low-risk) | 1 | 2.1% |
| Dismissed | 43 | 91.5% |
| Pending | 1 | 2.1% (Phase 0 plan file — same noise category) |

**All 43 dismissals were correct dismissals.** Audited the signals:

**Category A — system files Claude trivially reads every session** (~30 of 43): `.claude/settings.json`, `.claude/agent-identities.json`, `.claude/scripts/self-improve-store.js` (the self-improve infra itself!), `.claude/checkpoints/observations.log` (the self-improve infra observing itself!), `.claude/spawn-history.jsonl`, `agent-team/contract-verifier.js`, `agent-team/BACKLOG.md`, `agent-team/route-decide.js`, `core/workflow.md`, etc. These are infrastructure-traffic frequencies. Not patterns.

**Category B — slash commands that ARE already shipped skills** (5 of 5 skill-candidates dismissed): `/plugin`, `/verify-plan`, `/compact`, `/build-team`, `/power-loom`. The detector surfaced these with "Consider forging a skill via skill-forge" — but they are already shipped skills the user actively uses. Categorically broken: the detector was suggesting we forge skills for skills that already exist.

**The 2 "promoted" candidates** were file-paths the mechanism logged to `observations.log` — themselves trivial (a JSONL session file + `agent-identities.json`). The "auto-graduate to observations log" path is technically the mechanism working, but the *content* graduated is junk.

Evidence: `~/.claude/checkpoints/self-improve-pending.json`, `~/.claude/self-improve-counters.json`, `~/.claude/checkpoints/observations.log` (13 lines, all variations of "file X observed N times").

## Why it matters

This is a category error. The mechanism asked: **"Which files / commands were observed most often?"** Frequency is not pattern. It's the same category error a bad HR metric makes ("Bob was at his desk 200 days this year"). The substrate's auto-improvement primitive was a frequency counter, not a learner.

The v3.3+ Evolution Lab spec (locked in v5.4 §6.4-§6.5) asks the right question instead: **"Which spawn outcomes failed? Which personas succeed at which task classes? What's the typed failure artifact for this rejection?"** — E1 negative attestations, A6 reputation snapshot, E2/E3 policy extraction. The current self-improve hooks predate that conceptual evolution and were never updated to match.

This is **direct empirical evidence for why v3.3 Evolution Lab must be outcome-centric, not frequency-centric.** The dismissal rate isn't a tuning problem — it's a category-of-signal problem. Re-tuning thresholds (5 → 10 → 20 occurrences) would not have helped. The signals themselves carry no learning.

Cross-reference: this aligns with the field-survey findings in `swarm/thoughts/shared/backlog/v3.1-v3.2-field-survey-debt.md` items B3 (Trust-Vulnerability Paradox — reputation must not be authority-widening) and B4 (MI9 goal-conditioned drift detection — track trajectory shape, not just outcome counts). Both reinforce: **the substrate must track what the agent DID with what it has, not what it touched.**

## Suggested response

**Immediate (2026-05-26)**: disabled 2 of the 3 self-improve hooks. UserPromptSubmit (queue notification) + Stop (counter increment) — removed. PreCompact preserved (its checkpoint-save side-effect has independent value; the now-frozen store means the embedded self-improve scan becomes a no-op). Pending Phase 0 candidate dismissed. Counters file and observations log preserved on disk as historical evidence.

**v3.3 design (when Evolution Lab work begins)**:
1. Read this entry. Treat the 47-candidate corpus in `self-improve-pending.json` as a *negative training set* — examples of what the substrate should NOT bother surfacing.
2. E1 negative attestation schema MUST encode (a) what was attempted, (b) why it failed, (c) typed failure category, (d) suggested constraint. Not "file X was touched N times."
3. E4 reputation snapshot MUST be observational and per-(persona, task-class) — NEVER feeding back into capability scope (per backlog B3 ADR).
4. Auto-promotion thresholds (the 5+/10+ pattern from prior mechanism) are suspect by default. v3.3 should require human-in-loop or contract-verified promotion paths. Frequency-based auto-graduation is what produced the noise in the first place.

**Process learning** (separately captured): the prompt-enrichment hook, file-fact-force gate, and task-tracking reminder are similar substrate self-mechanisms that fire deterministically. Each should be audited periodically against the same "what's its actionable-signal rate?" test. Substrate machinery that produces 0 signal at >50% noise is overhead, not infrastructure.

## Counter-signal

This learning would be invalidated if:
- Auditing in 90 days shows a re-tuned hook (different signal selection) produces ≥30% actionable rate on the same workload — proving the hook-substrate is salvageable, just mis-configured. I do not expect this; the hook-event surface (file-reads, command-invocations) does not see outcome data, so no re-tuning can fix it.
- The v3.3 Evolution Lab design discovers that frequency-of-touch IS a load-bearing signal — i.e., my characterization of "frequency is not pattern" is wrong in some context. Unlikely but worth naming as a falsifier.
- The dismissed corpus on re-audit shows that some dismissals were premature — patterns I missed at triage that would have been promotable. (Spot-checked 15 dismissals during this audit; none were premature. But the falsifier remains theoretically possible.)
