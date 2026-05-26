# @power-loom/runtime

**Loom Runtime layer** — maps to v4 substrate synthesis §2 Layer 2.

HETS orchestration + persona system + decomposition. Per-RFC semver.

Depends on `@power-loom/kernel` (via `workspace:*`); never imports from `@power-loom/lab`.

## What lives here

- `contracts/` — 18 persona contracts (16 numbered + `challenger` + `engineering-task`)
- `personas/` — 16 persona briefs
- `traits/` — capability traits (v3.1)
- `schema/` — `_format-spec.md` (canonical findings format spec; referenced by every contract's `_format` field)
- `orchestration/` — HETS scripts (formerly `scripts/agent-team/` MINUS `_lib/*` which moved to `kernel/_lib/`)
- `orchestration/aggregate/` — `aggregate.js` + `hierarchical-aggregate.js`
- `decomposition/` — Pattern A trampoline + decomposition discipline (v3.2)
- `verify/` — spawn-verify dispatcher (v3.2)
- `test-runners/` — adapter shims (v3.2)

## What does NOT live here

- Kernel hooks / `_lib/` / validators → `packages/kernel/`
- Lab cognition → `packages/lab/`
- Skills → `packages/skills/`
