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

## Hook layer placement (H.7.19)

When adding a new validator hook to `hooks/hooks.json`, default to **PostToolUse** unless the hook MUST block to prevent silent-failure or security violation.

**Decision tree** (matches `skills/agent-team/patterns/validator-conventions.md` Convention D):

- **PreToolUse** when: silent-failure prevention (skill won't load, stale-state edit), security gate (secrets, protected configs), or recovery is hard/expensive
- **PostToolUse** when: advisory linting, schema reminders, style suggestions — anything where the user can iterate

**Common deviation to avoid**: H.7.12 chose PreToolUse for `validate-plan-schema.js` because the toolkit had zero PostToolUse:Write entries at the time. This was a conservative misreading — "no examples in our toolkit" ≠ "not supported by Claude Code." H.7.17 corrected the deviation after `claude-code-guide` consultation confirmed PostToolUse:Write works.

**Lesson**: when uncertain about Claude Code hook semantics, consult the official docs (or `claude-code-guide` agent — drift-note 24) rather than inferring from absence in our codebase.

## Markdown emphasis discipline (H.7.18)

When writing markdown (`.md` files), wrap underscore-bearing tokens in backticks. The markdown emphasis parser sees `_token_` as italic emphasis. When unbackticked tokens like `HETS_TOOLKIT_DIR`, `_h70-test`, `_lib/`, `RUN_STATE_BASE`, or `_readPersonaContract` appear in the same paragraph as another underscore (with whitespace between), markdownlint MD037 ("no-space-in-emphasis") triggers and CI fails.

Token shapes that need backticks:

- **Env-var-style** (multi-underscore uppercase): `HETS_TOOLKIT_DIR`, `CLAUDE_PLUGIN_ROOT`, `RUN_STATE_BASE`, `WEIGHTS_VERSION`, `MODULE_NOT_FOUND`
- **Underscore-prefixed identifier**: `_h70-test`, `_lib/file-path-pattern`, `_readPersonaContract`, `_log.js`
- **Snake-lower** in dense paragraphs: `weights_version`, `route_decision` (only when paired)

Examples:

```markdown
❌ HETS_TOOLKIT_DIR || path.join(process.env.HOME, ...)
✓  `HETS_TOOLKIT_DIR` || `path.join(process.env.HOME, ...)`

❌ tests passed: 41/41 _h70-test; 0 contract violations
✓  tests passed: 41/41 `_h70-test`; 0 contract violations
```

The H.7.18 `validate-markdown-emphasis.js` PostToolUse hook detects this pattern and emits `[MARKDOWN-EMPHASIS-DRIFT]` for awareness. The hook is forward-looking; it doesn't auto-fix existing markdown.

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
- **H.7.16 — When output emits `[ROUTE-META-UNCERTAIN]`**: the task references substrate-meta tokens (`route-decide`, `weights_version`, `dict expansion`, `keyword set`, `forcing instruction`, etc.). The score may be biased low by the **substrate-meta routing catch-22** — when the proposed change modifies the routing scorer itself, the score above was computed using the CURRENT dictionary, which may not yet contain the tokens the proposed change would add. Apply judgment: if task is genuinely architect-shaped, escalate via `--force-route` or architect spawn (per `route-decide.js:11-13` load-bearing comment); if mechanical implementation of an already-decided design, current recommendation likely correct. The forcing instruction is advisory and does NOT alter the score or recommendation — score-additive guarantee preserved.
- **H.7.16 — Co-firing**: `[ROUTE-META-UNCERTAIN]` can fire alongside `[ROUTE-DECISION-UNCERTAIN]` (zero signals AND substrate-meta detected) and alongside any recommendation tier. The two are independent; both can appear in the same JSON output.
