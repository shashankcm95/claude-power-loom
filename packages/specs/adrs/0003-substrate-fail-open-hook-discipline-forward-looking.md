---
adr_id: 0003
title: "Substrate fail-open hook discipline as institutional commitment (governance-tier; forward-looking)"
tier: governance
status: accepted
created: 2026-05-10
author: root (HT.1.7 sub-plan; architect + code-reviewer per-phase pre-approval gate APPROVED-with-revisions; 7 FLAGs absorbed single-pass)
superseded_by: null
files_affected:
  - hooks/scripts/fact-force-gate.js
  - hooks/scripts/config-guard.js
  - hooks/scripts/error-critic.js
  - hooks/scripts/prompt-enrich-trigger.js
  - hooks/scripts/session-self-improve-prompt.js
  - hooks/scripts/session-reset.js
  - hooks/scripts/auto-store-enrichment.js
  - hooks/scripts/console-log-check.js
  - hooks/scripts/pre-compact-save.js
  - hooks/scripts/session-end-nudge.js
  - hooks/scripts/validators/verify-plan-gate.js
  - hooks/scripts/validators/validate-no-bare-secrets.js
  - hooks/scripts/validators/validate-frontmatter-on-skills.js
  - hooks/scripts/validators/validate-plan-schema.js
invariants_introduced:
  - "All substrate hooks shipped after 2026-05-10 (HT.1.7 onward) MUST satisfy ADR-0001's four mechanical fail-open invariants; new hook PRs include verification of each invariant in the PR body or commit message (institutional commitment, not optional convention)"
  - "Substrate maintainers running code review on hook PRs apply ADR-0001's discipline as a load-bearing review gate; PRs that don't verify all four invariants are NEEDS-REVISION regardless of other merit (governance gate, not advisory)"
related_adrs:
  - 0001
related_kb:
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/stability-patterns
  - architecture/discipline/reliability-scalability-maintainability
---

## Context

ADR-0001 codifies the **technical** discipline (four mechanical invariants for fail-open hook authoring) — codified retroactively in H.8.2 from existing convention across 14 hook scripts. ADR-0003 codifies the **governance** layer above the technical layer: the institutional commitment to enforce ADR-0001's discipline on all future hooks via code review.

The two ADRs address distinct concerns:

- **ADR-0001 (seed; technical-tier)** — WHAT the discipline is (the four mechanical invariants: top-level try/catch + decision: approve / clean exit on error + observability via `logger('error', ...)` + hard-block decisions reserved for genuine policy violations)
- **ADR-0003 (accepted; governance-tier)** — HOW the discipline is maintained as the substrate grows (institutional commitment from substrate maintainers + load-bearing code-review gate on hook PRs)

Without the governance layer, ADR-0001 is a snapshot — it documents what existed at H.8.2 but does not commit the substrate to maintaining the discipline as new hooks are added. Subsequent phases (H.8.3 through HT.1.6) added 6+ new hooks, all of which followed the discipline because authors knew about ADR-0001 and its invariants. That implicit institutional commitment is what ADR-0003 makes explicit + load-bearing.

The forces:

- **For making the commitment explicit**: as the substrate grows past the original 14 hooks (current count: 14 active per ADR-0001's `files_affected`; future count: hooks added at HT.1.x and beyond), the implicit institutional commitment becomes fragile. New contributors may not know about ADR-0001; reviewers may apply the discipline inconsistently; the discipline could erode silently. A governance-tier ADR with a load-bearing review gate prevents this drift.
- **Against making the commitment explicit**: institutional commitments create onboarding cost (new contributors must know to verify); review tax is non-zero per hook PR; one more rule among many — Convention G's cap-rule headroom (the substrate's policy of bounding the number of forcing instructions in the family) must be considered when adding institutional gates.

The substrate's choice: explicit commitment wins. The substrate's stability primitive (fail-open hooks) is too load-bearing to leave to implicit institutional muscle memory. Codifying the governance commitment + review gate is sequencing-correct — done now, before the hook count grows further, while the institutional cost is still low.

## Decision

**Substrate hooks shipped after 2026-05-10 (HT.1.7 onward) MUST satisfy ADR-0001's four mechanical fail-open invariants. Compliance verification is institutional + governance-gated.**

Concretely:

1. **Hook author responsibility**: every new hook PR includes verification of each of ADR-0001's four invariants in the PR body or commit message. The verification is explicit (e.g., "verified invariant 1 — top-level try/catch at line N; invariant 2 — decision: approve returned at line M; invariant 3 — fail-open path logs via logger('error', ...) at line K; invariant 4 — hard-block decision absent or scoped to genuine policy violation"). PRs without verification are NEEDS-REVISION regardless of other merit.

2. **Code reviewer responsibility**: substrate maintainers running code review on hook PRs apply ADR-0001's discipline as a load-bearing review gate. The four invariants are verified independently of the hook's primary purpose. A hook can be perfectly correct in its primary function and still fail this gate if any of the four mechanical invariants are missing or weakened.

3. **Load-bearing nature**: this gate is institutional, not optional. The substrate's commitment is to maintain ADR-0001's technical discipline as the hook count grows; the gate is the mechanism that delivers on the commitment. Case-by-case exceptions weaken the commitment + erode the discipline; the substrate's choice is to enforce uniformly rather than negotiate per-hook.

This separation — **technical ADR (ADR-0001) + governance ADR (ADR-0003) for the same domain** — is genuinely ADR-worthy. The two concerns are structurally distinct (mechanical correctness vs institutional enforcement); collapsing them into one ADR mixes scope; keeping them in separate ADRs preserves clarity at drift-detection time + during PR review.

## Consequences

**Positive consequences** (what we gain):

- **Substrate stability primitive remains load-bearing as the hook count grows.** The four mechanical invariants don't erode silently as new contributors join + new hooks land.
- **New hook authors have a canonical reference for the four invariants** — namely ADR-0001 — and a canonical reference for the institutional commitment around them — namely ADR-0003. The two ADRs are complementary; reading ADR-0003's `related_adrs: [0001]` directs new authors to the technical surface they need to satisfy.
- **Code reviewers have a load-bearing gate that survives reviewer turnover.** Even if the original substrate authors leave, future reviewers reading ADR-0003 know the discipline is institutional, not optional.
- **The substrate's institutional discipline is machine-readable** via this ADR's invariants. The drift-detection hook (`validate-adr-drift.js`) emits both ADR-0001 (mechanical) and ADR-0003 (governance) for shared `files_affected` — the reader sees the full picture at edit time.
- **Sequencing-correct timing.** Doing the governance reshape early — before the hook count grows further — keeps the institutional cost low + makes the commitment legible to all current contributors.

**Negative consequences** (what we sacrifice):

- **Onboarding cost** — new contributors must know to verify all four invariants in hook PRs. The substrate's existing onboarding (rules, kb, ADRs themselves) absorbs this; not zero but bounded.
- **PR review tax** — non-zero per hook PR. Reviewers spend time verifying the four invariants in addition to other review concerns. Mitigated by: the four invariants are mechanical (top-level try/catch is grep-able; logger usage is grep-able; decision: approve is grep-able); review tax is ~5 minutes per hook PR worst case.
- **One more institutional rule among many.** Convention G's cap-rule discipline (bounded number of forcing instructions in the family; current count is 10 post-H.8.8 with cap N=15) does not directly apply to ADRs — but the analogous discipline of "bounded number of institutional gates" is a real concern. ADR-0003 is one gate; future ADRs should be evaluated against this concern (HT.1.13 slopfiles + ADR-0005 will be the next institutional gate).
- **Two ADRs in drift-detection output for shared files.** When editing any of the 14 affected hooks, `[ADR-DRIFT-CHECK]` emits both ADR-0001 (mechanical) + ADR-0003 (governance). The reader must understand the technical-vs-governance distinction. Mitigated by: titles + invariants differ substantially; `related_adrs` cross-references make the relationship explicit; the drift-check forcing instruction emits ADR titles distinctly enough for the reader to parse.

**Open questions** (what we still don't know):

- Should there be an automated lint check that verifies ADR-0001's four mechanical invariants on hook file changes (independent of human review)? Drift-note candidate; HT.2 sweep target if the institutional-only mechanism proves insufficient.
- Will Convention G's cap-rule headroom for forcing instructions become a binding constraint as more institutional gates land? Drift-note candidate; revisit empirically once the substrate has 5+ governance-tier ADRs.
- Should ADR-0003's invariants 1 + 2 be consolidated into a single invariant ("PRs verify ADR-0001 invariants AND reviewers gate on verification")? Single-vs-double phrasing is a stylistic call; the current split keeps author + reviewer responsibilities distinct, which is useful for review-checklist construction.

## Alternatives Considered

### Alternative A: leave ADR-0001 as the sole reference

ADR-0001 documents the discipline's technical shape but does not commit the substrate to enforcing it on future hooks. The implicit commitment was institutionally fragile as the hook count grew. Rejected because:

- Implicit commitments erode silently. New contributors don't know they exist; reviewers apply them inconsistently.
- The substrate has 6+ hooks added after H.8.2 that all happen to satisfy ADR-0001 — but "happen to satisfy" is institutional luck, not load-bearing discipline.
- Making the commitment explicit at HT.1.7 — when the hook count is still 14 + the institutional cost is still low — is sequencing-correct.

### Alternative B: merge into ADR-0001 with a status-note commitment

Add a status note to ADR-0001 saying "applies forward to all post-2026-05-10 hooks; reviewers MUST verify on PR." Rejected because:

- Mixes retroactive technical evidence with forward-looking governance commitment in one document. Distinct scopes (WHAT vs HOW) deserve distinct ADRs for clarity.
- Status notes are append-only timeline entries, not load-bearing rule statements. The institutional commitment + review gate need ADR frontmatter (`invariants_introduced`) to be machine-readable + drift-active.
- Future readers reading ADR-0001 see "discipline existed; codified retroactively in H.8.2" — they don't naturally read forward to a status note three lines down to find the governance commitment.

### Alternative C: author as pattern doc instead of ADR

Codify the institutional commitment in `kb/architecture/discipline/code-review-gates.md` (a new KB doc). Rejected because:

- Pattern docs describe canonical software-engineering concepts (e.g., "fail-fast"); ADR-0003 captures a substrate-specific governance commitment, not a canonical concept.
- Pattern docs aren't drift-active; they don't surface in `[ADR-DRIFT-CHECK]` when relevant files are edited. The governance commitment loses its load-bearing surface.
- The ADR system is the right home for substrate-specific institutional decisions; the pattern-doc system is the right home for external knowledge. ADR-0003 is the former.

### Alternative D: do nothing

Continue with the implicit institutional commitment that produced 6+ post-H.8.2 hooks all satisfying ADR-0001. Rejected because:

- The gap between "retroactively codified" (ADR-0001) and "forward-looking governance commitment" is real; closing it strengthens institutional discipline as the substrate grows.
- "Do nothing" works while the original substrate authors are reviewing all hook PRs. As the substrate grows + onboards new maintainers, the discipline must be transferable — which requires explicit codification.
- The chaos theo F4 finding (master plan v3.1 line 344) flagged the retroactive shape as a refactor candidate; HT.0.9 ranked it backlog priority HT.1.7. Punting on the governance layer punts on the substrate's institutional discipline question.

## Status notes

- 2026-05-10 — proposed by root in HT.1.7 sub-plan
- 2026-05-10 — APPROVED-with-revisions at parallel architect + code-reviewer per-phase pre-approval gate; 7 FLAGs absorbed single-pass (1 HIGH convergent across both reviewers — "ship at status: accepted directly to avoid timing-window failure on test 74 + retroactive-status-mismatch reproduction"; 4 MEDIUM — governance-tier reframe + invariants tightening + drift-noise mitigation + seed naming defense; 2 LOW — bidirectional related_adrs + verification probe correction)
- 2026-05-10 — accepted; ships at `status: accepted` directly per absorbed FLAG-1 + FLAG-6 (the per-phase pre-approval gate IS the acceptance ceremony — same-day proposed + accepted transition recorded here for transparency rather than authoring transient `proposed` state on disk)

## Related work

- **Drift-notes**: none directly. Drift-note 60 (closed at HT.1.6) covered documentary persona class — different scope.
- **Phase tags**: HT.1.7 (this ADR's source case); H.8.2 (ADR-0001 retroactive codification origin); H.8.3 through HT.1.6 (the 6+ hooks added post-ADR-0001 that all happen to satisfy the discipline — empirical evidence of the implicit institutional commitment that ADR-0003 makes explicit); HT.0.6 (audit phase that documented the chaos theo F4 retroactive-shape finding); HT.0.9 (synthesis that ranked HT.1.7 as priority backlog item).
- **KB pattern docs**: `architecture/discipline/error-handling-discipline.md` (the substrate-curated principle that ADR-0001 implements at the hook layer); `architecture/discipline/stability-patterns.md` (Nygard's catalog; substrate hooks as bulkheads); `architecture/discipline/reliability-scalability-maintainability.md` (R/A/FT framing). Same set as ADR-0001 because the technical surface is shared; the governance layer rests on the same KB foundations.
- **Sibling ADRs**: ADR-0001 (technical-tier sibling at seed status); ADR-0002 (bridge-script entrypoint criterion at HT.1.3 — a different load-bearing institutional ADR for module-organization discipline; demonstrates the substrate's pattern of authoring ADRs for institutional commitments alongside technical disciplines).
