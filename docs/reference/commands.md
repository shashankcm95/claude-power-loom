# Commands — Manual Shortcut Layer

> Returns to README: [../../README.md](../../README.md)

### Commands (14) — The Manual Shortcut Layer

Commands are `.md` files invoked by typing `/command-name`. They're explicit triggers; the same behaviors are also available as automatic rules where appropriate. Source: `packages/skills/commands/*.md`.

| Command | Action |
|---------|--------|
| `/review` | Delegate to code-reviewer agent |
| `/plan` | Delegate to planner agent — single-architect planner; trivial-to-medium scope |
| `/build-plan` | HETS-aware plan authoring; runs `route-decide.js` as Step 0, recommends an architect spawn at `convergence_value >= 0.10`, writes plans matching the plan-template schema |
| `/build-team` | Spawn a HETS team for a build task (super → orchestrator → actor) |
| `/implement` | Execute an approved plan from `packages/specs/plans/` |
| `/research` | Document a codebase as-is for the downstream Plan/Implement cycle |
| `/verify-plan` | Pre-approval verification: spawn architect + code-reviewer against the plan file, append structured findings before `ExitPlanMode` |
| `/phase-close` | Phase-level verification gate (post-phase analog of `/verify-plan`); spawns PM + Principal-SDE + Architect lenses over the integrated phase vs its exit criteria |
| `/security-audit` | Delegate to security-auditor agent |
| `/self-improve` | Run the full self-improvement review cycle |
| `/forge` | Create a new agent or skill on the fly |
| `/evolve` | Update an existing agent/skill with new learnings |
| `/prune` | Remove stale memory entries, duplicate rules, unused skills |
| `/chaos-test` (H.x) | Hierarchical chaos test of the toolkit itself — meta-validation pattern. Spawns HETS team with 5 auditor personas to audit the toolkit's own infrastructure. |

---

