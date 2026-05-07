# Development Workflow

## Git Conventions

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Branch naming: `feat/short-description`, `fix/short-description`
- PRs should be reviewable in one sitting (< 400 lines changed when possible)
- Never force-push to shared branches without explicit confirmation

## Testing Expectations

- Test new code paths — untested code is unfinished code
- 80%+ coverage for critical paths (auth, payments, data mutations)
- Integration tests for data flows crossing boundaries (API → DB → response)
- Run the full test suite before marking work complete

## Code Review Standards

- No self-merge on shared repositories
- Review checklist: security → correctness → performance → readability
- Only flag issues you are > 80% confident about
- Consolidate similar findings (not 5 separate "missing error handling" notes)

## Deploy

Before deploying, follow the deploy-checklist skill for the full pre-deployment verification workflow.

## Plan Mode for Multi-File Changes (H.7.9 — HETS-aware)

- Any task touching ≥2 distinct files → enter plan mode first
- Single-file changes, doc-only edits, trivial fixes → skip plan mode
- When in doubt: enter plan mode (cheap insurance, expensive to skip)

### `/plan` vs `/build-plan` decision tree (H.7.9)

- `/plan` — single-architect planner agent delegate; trivial-to-medium scope; thin 13-line command body
- `/build-plan` — HETS-aware variant; runs `route-decide.js` as Step 0; recommends architect spawn when `convergence_value ≥ 0.10` (post-context-mult); writes plans matching `swarm/plan-template.md` schema. Use for multi-file substantive work with non-obvious tradeoffs.
- Both coexist (additive, not replacement). Step 0's `root` recommendation in `/build-plan` redirects cleanly to `/plan`.

### Drift-note convention (H.7.9)

- During plan-mode work, capture observations of soft-norm drift in a `## Drift Notes` section of the plan file. Examples: "almost skipped plan mode for this one because it 'felt' single-file but turned out to touch 4 files"; "route-decide returned `root` but task is genuinely architectural — dictionary-expansion candidate".
- Drift notes feed the auto-loop's session-end review (`rules/core/self-improvement.md`).
- Per the H.7.9 meta-discipline directive: conversations and tasks are the primary plugin testing framework; pattern-emergence observations promote to substrate refinement.

## CI infrastructure changes (H.7.15)

- When adding CI workflows, install scripts, or other infrastructure that runs only at merge time / install time / CI time, **validate against a clean / non-author environment before merging**. The H.7.8 CI bug (PR #79 H.7.9 surfaced it: `bash install.sh --test` tested already-installed hooks at `$CLAUDE_DIR/hooks/scripts/`, which doesn't exist on a fresh CI checkout) and the `install_hooks` subdir-glob bug (H.7.12 surfaced it: `validators/` and `_lib/` subdirectories were never being copied) BOTH shipped because the original phases never ran the new infrastructure against a fresh environment.
- **Dogfood discipline**: try the new workflow as if you were a new contributor / fresh CI runner / minimal-install user. Specifically: (1) run install.sh on a path that doesn't already have ~/.claude populated, OR (2) push the change to a feature branch and let CI run against a clean checkout BEFORE merging to main.
- For subdir-related changes: explicitly verify subdirectories are copied (`ls $CLAUDE_DIR/<dir>/<subdir>/` should show files), not just the top-level glob.
- Pattern audit: when extending an install step or CI workflow, scan the related code for similar single-level-glob assumptions (`for f in dir/*.js` vs `cp -r dir/`).

## Route-Decision for Non-Trivial Tasks

- Before invoking `/build-team` or spawning sub-agents for a user task, run `node ~/Documents/claude-toolkit/scripts/agent-team/route-decide.js --task "<task>"` to get a routing recommendation
- Recommendation `route` → spawn the team / use HETS orchestration
- Recommendation `root` → answer directly; do not spawn sub-agents (over-routing wastes ~30× tokens for ~3× failure-mode coverage on trivial tasks)
- Recommendation `borderline` → surface the score decomposition to the user and let them pick; do not silently default
- Skip the gate when: task is invoked via `/chaos-test` (pre-routed), task is purely informational ("explain X"), task is a confirmation of a previously-discussed action ("yes, ship it"), task includes `--force-route` flag
- When in doubt: the gate is cheap (<100ms, deterministic). Run it. The decomposition alone is useful for explaining the routing decision to the user.
- **H.7.5 — When invoking on a conversation continuation**: ALWAYS pass `--context "<last assistant response excerpt>"` (max ~2K chars; bounded to last 1-3 turns). The bare task often strips the routing signal that lived in the prior recommendation; context restores it. Borderline-promotion rule fires when context has signal but bare task doesn't.
- **H.7.5 — If output emits `[ROUTE-DECISION-UNCERTAIN]`**: do NOT silently default to root. Either re-invoke with `--context "<prior turn>"`, or surface to user for explicit `--force-route` / `--force-root` choice. The forcing instruction means the heuristic abstained, not that root was the answer.
- **H.7.5 — Prompt design tip**: when crafting the gate's task string, embed the routing signal explicitly (e.g., "implement weighted-formula refit per H.7.4 plan via orchestration" beats bare "empirical refit"). Surface keywords help the deterministic layer; don't rely on the forcing-instruction fallback for cases where you already know the answer.
