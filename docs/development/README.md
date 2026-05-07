# Development

- [Extending power-loom](extending.md) — How to add new hooks, agents, or skills
- [Attribution](attribution.md) — Detailed per-component influence mapping

## Plugin-dev tooling (H.7.8)

- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — GitHub Actions CI: 3 parallel jobs on push:main + pull_request:main
  - `smoke` — runs `bash install.sh --test` (12/12 hook tests) + `node scripts/agent-team/contracts-validate.js`
  - `markdown-lint` — `npx markdownlint-cli2` against all `*.md` (excludes `node_modules`, `swarm/`)
  - `json-validate` — bash loop validating every `*.json` with `python3 -m json.tool`
- [`.markdownlint.json`](../../.markdownlint.json) — lenient markdown lint config (catches real bugs; tolerates stylistic inconsistency in 60+ existing docs)
- [`.editorconfig`](../../.editorconfig) — editor consistency: UTF-8, LF, final newline, trim trailing whitespace; 2-space indent for md/json/yml/js, 4-space for sh

CI uses `npx` for markdownlint so contributors don't need local npm install. No husky / package.json / python deps added — power-loom is zero-build / zero-dependency for end users by design.

## Other repo-root development docs

- [CONTRIBUTING.md](../../CONTRIBUTING.md) — Git workflow, phase-tag conventions, PR flow
- [CHANGELOG.md](../../CHANGELOG.md) — Version history (Keep-a-Changelog)
- [ATTRIBUTION.md](../../ATTRIBUTION.md) — Full attribution + license disclosures
- [skills/agent-team/BACKLOG.md](../../skills/agent-team/BACKLOG.md) — Deferred work + SHIPPED phase records

> Up: [docs/](..)
