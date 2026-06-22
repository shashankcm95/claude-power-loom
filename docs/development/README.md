# Development

- [Extending power-loom](extending.md) — How to add new hooks, agents, or skills
- [Attribution](attribution.md) — Detailed per-component influence mapping

## Plan-mode tooling (H.7.9)

- [`packages/skills/commands/build-plan.md`](../../packages/skills/commands/build-plan.md) — HETS-aware plan authoring slash command. Wraps the planner agent with route-decide gate (Step 0) + architect-spawn recommendation (Step 3). Use for substantive multi-file architectural work; falls back to `/plan` for trivial scope.
- [`packages/skills/library/build-plan/SKILL.md`](../../packages/skills/library/build-plan/SKILL.md) — Skill body operationalizing the H.7.9 pattern.
- [`packages/specs/research/plan-template.md`](../../packages/specs/research/plan-template.md) — Canonical plan template with mandatory sections (Context / Routing Decision / HETS Spawn Plan / Files / Phases / Verification / Out of Scope / Drift Notes). Schema enforced at write time by the `validate-plan-schema.js` PostToolUse validator (`packages/kernel/validators/`).
- [`packages/skills/library/agent-team/patterns/plan-mode-hets-injection.md`](../../packages/skills/library/agent-team/patterns/plan-mode-hets-injection.md) — Pattern doc with Why/When/How/Failure-modes structure.

`/plan` and `/build-plan` coexist; `/plan` is the thin planner-agent delegate for trivial scope, `/build-plan` is the HETS-aware variant for substantive work. Step 0's `root` recommendation redirects cleanly between them.

## Plugin-dev tooling (H.7.8)

- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — GitHub Actions CI: a multi-job matrix on push:main + pull_request:main
  - `smoke` — runs `bash install.sh --hooks --test` (the hook smoke suite) + `node packages/runtime/orchestration/contracts-validate.js` + repo-consistency checks (persona roster, signpost drift, doc paths)
  - `markdown-lint` — `npx markdownlint-cli2` against all `*.md` (excludes `node_modules`, `swarm/`, `packages/specs/`)
  - `json-validate` — bash loop validating every `*.json` with `python3 -m json.tool`
  - the kernel / runtime / lab / aux unit-test suites + the `dormancy-assertion-k1` / `-k3b` gates + the `layer-boundary-advisory` (K12) check
- [`.markdownlint.json`](../../.markdownlint.json) — lenient markdown lint config (catches real bugs; tolerates stylistic inconsistency in 60+ existing docs)
- [`.editorconfig`](../../.editorconfig) — editor consistency: UTF-8, LF, final newline, trim trailing whitespace; 2-space indent for md/json/yml/js, 4-space for sh

CI uses `npx` for markdownlint so contributors don't need local npm install. No husky / package.json / python deps added — power-loom is zero-build / zero-dependency for end users by design.

## Other repo-root development docs

- [CONTRIBUTING.md](../../CONTRIBUTING.md) — Git workflow, phase-tag conventions, PR flow
- [CHANGELOG.md](../../CHANGELOG.md) — Version history (Keep-a-Changelog)
- [ATTRIBUTION.md](../../ATTRIBUTION.md) — Full attribution + license disclosures
- [packages/skills/library/agent-team/BACKLOG.md](../../packages/skills/library/agent-team/BACKLOG.md) — Deferred work + SHIPPED phase records

> Up: [docs/](..)
