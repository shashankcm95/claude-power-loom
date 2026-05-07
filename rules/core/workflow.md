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

## Plan Mode for Multi-File Changes

- Any task touching ≥2 distinct files → enter plan mode first
- Single-file changes, doc-only edits, trivial fixes → skip plan mode
- When in doubt: enter plan mode (cheap insurance, expensive to skip)

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
