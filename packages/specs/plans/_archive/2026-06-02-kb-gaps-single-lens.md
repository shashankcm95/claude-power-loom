---
date: 2026-06-02
status: complete
lifecycle: ephemeral
topic: "Persona-depth item 1 — author the ~10 deferred single-lens KB-gaps + re-link"
related:
  - packages/specs/research/2026-06-02-persona-instinct-kb-gap-harvest.md
  - packages/skills/library/agent-team/kb/
  - packages/runtime/personas/
---

# Plan — author the 10 deferred single-lens KB docs + re-link the personas

Completes persona-depth item 1: each archetype's `## Mindset` instinct that flagged a KB-gap gets a
backing referral doc; the flagging persona is then re-linked (slug moves KB-gap → `Instinct → KB
referral`).

## The 10 docs (kb_id = path; tags ≥3; version 1; web-grounded, sources verified real)

| kb_id | persona | instincts served |
|---|---|---|
| `security-dev/defense-in-depth` | 12-security-engineer | defense-in-depth, secure-by-default, auditability, realistic-severity |
| `security-dev/protocol-and-state-abuse` | 01-hacker | toctou-race-window, abuse-the-protocol-not-the-app, the-delta-is-byzantine-input |
| `backend-dev/jvm-observability` | 07-java-backend | observability-first |
| `backend-dev/type-safety-at-the-boundary` | 13-node-backend | type-safety-at-the-edge, race-window-awareness |
| `web-dev/performance-budgets` | 09-react-frontend | bundle-budget |
| `data-dev/lineage-and-cost` | 11-data-engineer | lineage-traceability, partition-and-cost-discipline |
| `hets/code-search-heuristics` | 14-codebase-locator | exhaustive-naming-variants, where-not-just-what, trace-every-reference, no-false-negatives, breadth-before-depth, entrypoint-finding, current-location-not-ideal, empirical-naming-convention |
| `hets/usability-adversary` | 02-confused-user | read-as-a-first-timer, unexplained-jargon, first-run-friction, the-undocumented-step, friction-smell, two-readers |
| `architecture/crosscut/control-and-data-flow` | 15-codebase-analyzer | data-flow-tracing, error-path-tracing, who-calls-what, state-mutation-surfacing |
| `architecture/crosscut/integration-boundary-contracts` | 16-codebase-pattern-finder | cross-cutting-integration-shape |

## Constraints (this session's substrate)

- **KB-doc schema** (`validate-kb-doc.js`): `kb_id` MUST equal the path id; `version: 1`; `tags` array
  ≥3; `## Summary` + `## Quick Reference` sections required. Match the fuller exemplar
  `kb/architecture/discipline/blast-radius-and-reversibility.md`.
- **architecture-doc-count cap** (`contracts-validate.js`): warn ≥45, error ≥51. Currently **17** →
  adding 2 (control-and-data-flow, integration-boundary-contracts) → 19, safe.
- **kb-architecture bidirectional `related:`** (`contracts-validate.js`): only the 2 architecture docs
  need reciprocal back-links — when they list `related: architecture/...`, add the new kbId back to
  those docs. The 8 non-architecture docs are exempt.
- **persona re-link safety**: editing the `Instinct → KB referral` block / `KB-gaps` line does NOT
  touch the numbered `## Mindset` headings, so `persona-instinct-reconcile` (the #206 validator) stays
  green (contract.instincts mirror the headings, unchanged).
- After authoring: `node packages/runtime/orchestration/kb-resolver.js scan` to refresh the manifest.

## Execution

1. **Author** in 2 waves of 5 (general-purpose web-enabled agents, 1 doc each, written directly to the
   target path). Wave 1 = the clearly-scoped domain docs (security ×2, backend ×2, web ×1); verify
   format/sources; Wave 2 = data + hets ×2 + architecture ×2.
2. **Verify** each: `validate-kb-doc` + markdownlint + `kb_id`==path + Summary/Quick-Reference present +
   spot-check sources are real (zero fabrications — the #205 discipline).
3. **Integrate**: kb-resolver scan; re-link the 10 personas (gap → referral); add the 2 architecture
   reciprocal back-links.
4. **Gate**: `contracts-validate.js` (kb-architecture-doc-count + related-bidirectional +
   persona-instinct-reconcile all clean); `install.sh --hooks --test` 118/0; markdownlint 0; a
   code-reviewer / honesty-auditor pass on a sample for source-realness.
5. **PR** (one cohesive "complete the referral library" PR, mirroring #205).

## Outcome — COMPLETE

All 10 docs authored (2 waves of 5 web-grounded agents), integrated, and verified.

- **10 new KB docs** (218-293 lines each), web-grounded; an **independent source-realness audit
  returned CLEAN** — 20/20 sampled falsifiable citations real + correctly attributed (exact page
  numbers, dates, thresholds, CWE names; zero fabrications).
- **10 personas re-linked** (gap → referral); after this, every re-linked persona has **zero**
  remaining KB-gaps. Two previously-unmapped-AND-ungapped instincts were surfaced and linked:
  `partition-and-cost-discipline` (11-data) and `type-safety-at-the-edge` (13-node).
- **10 reciprocal `related` back-links** added for the 2 architecture docs → bidirectional validator 0.
- **manifest regenerated** (`kb-resolver scan`) — picked up the 10 new docs + the 3 #205 docs the
  stale manifest was missing.
- Gates: `validate-kb-doc` **approve ×10**; markdownlint **0** (10 docs + 10 personas + 8 back-link
  edits); contracts-validate **0** for persona-instinct-reconcile / kb-architecture-doc-count (19/51) /
  kb-architecture-related-bidirectional / contract-kb-scope-resolves; `install.sh --hooks --test`
  **118/0**.

### Process notes

- **Sub-agent writes land in the main tree, not a worktree here** — a momentary scare (a word-split
  bug in my verify loop) looked like the files were missing; `find` + `git worktree list` confirmed
  all 10 were at their correct paths. The substrate did NOT auto-worktree these general-purpose spawns.
- **`execFileSync` throws on the validator's non-zero exit** — the back-link + (re-used) scripts must
  read `err.stdout` in a try/catch (same pattern as the test harnesses).
- **The `persona-instinct-reconcile` (#206) validator was unaffected** by re-linking, exactly as
  designed: it reads the numbered `## Mindset` headings, not the referral prose.

## Out of scope

- Then Phase 3 → v3.2 (Runtime Decomposition).
