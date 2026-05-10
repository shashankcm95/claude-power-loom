---
decision-record-pattern: lightweight
title: "Path-reference conventions across substrate documentation + commands + personas + KB docs"
created: 2026-05-10
phase: HT.1.10
status: active
related_phases: [HT.0.3, HT.0.4, HT.0.5a, HT.1.10]
related_drift_notes: [70]
---

# Path-reference conventions

## Context

The substrate's documentation, commands, persona MDs, and KB docs use **5 distinct path-reference conventions**. HT.0.3 audit framed this as inconsistency; HT.0.4 + HT.0.5a noted "mixed convention" cases. HT.1.10 empirical pre-validation (drift-note 70) revealed that the apparent inconsistencies are **intentional context-dependent uses**, not bugs — different conventions encode different semantic intent (source-path vs deployed-path vs runtime-resolved).

This doc codifies the conventions + when each applies. It's a `decision-record-pattern: lightweight` per HT.1.6 BACKLOG.md precedent — institutional weight for path-reference authoring discipline without ADR-system bloat.

## The 5 path conventions

### 1. Repo-relative (`scripts/agent-team/X.js`)

**Form**: relative path from toolkit root, no leading `~/` or `$HOME`.

**Example**: `scripts/agent-team/route-decide.js`

**When applies**:
- Within commands that document substrate scripts where the file location is internal to the toolkit
- Within persona MD frontmatter `kb_scope` fields (resolved by kb-resolver)
- Within ADR `files_affected` lists (resolved by adr.js + validate-adr-drift.js)

**Used by**: `commands/verify-plan.md`, `commands/build-plan.md`, `commands/implement.md`, `commands/research.md`; persona contracts; ADR `files_affected` arrays.

### 2. Hardcoded author-machine (`~/Documents/claude-toolkit/X`)

**Form**: literal `~/Documents/claude-toolkit/...` shell-expand-able home-relative path.

**Example**: `~/Documents/claude-toolkit/scripts/agent-team/pattern-runner.js`

**When applies**:
- When referencing files that exist ONLY in the source toolkit checkout (e.g., `swarm/hierarchical-aggregate.js`, `swarm/personas-contracts/*.json`, `swarm/run-state/`) and the doc reader is expected to invoke from the source location
- Within persona MD instructions where the persona executes on the author's machine and reads source-tree files for analysis (e.g., 04-architect.md reads `~/Documents/claude-toolkit/README.md` for documentary audit)
- Within commands that need to write to source-tree output dirs (e.g., `swarm/run-state/$RUN_ID/`)
- Within `forge.md` + `evolve.md` documentation of both-locations-write pattern (write to both source + deployed)

**Used by**: `commands/chaos-test.md`, `commands/forge.md`, `commands/evolve.md`, `commands/research.md`; 13 persona MDs (01-hacker, 02-confused-user, 03-code-reviewer, 04-architect, 05-honesty-auditor, 06-13); 4 KB docs (kb/README.md, kb/hets/symmetric-pair-conventions.md, kb/hets/spawn-conventions.md, kb/hets/challenger-conventions.md).

### 3. `$HOME`-aware (`$HOME/Documents/claude-toolkit/X`)

**Form**: `$HOME` shell variable expansion of the same path.

**Example**: `$HOME/Documents/claude-toolkit/scripts/agent-team/route-decide.js`

**When applies**:
- Inside bash code blocks that need to be portable across users with different `$HOME` values; the variable expansion mechanism is more reliable than `~` in some bash contexts
- Slash-command invocation contexts where `~` may not expand (per HT.1.5-verify code-reviewer Q4 HIGH severity catch — `$SCRIPT_DIR` is not set in slash-command context; `$HOME` is)
- Helper scripts invoked from commands

**Used by**: `commands/build-plan.md:31`, `commands/build-team.md:32`, `scripts/agent-team/build-team-helpers.sh` (per HT.1.5).

**Why preferred over Convention 2 in slash-command bash context**: `$HOME` is reliably set; `~` expansion depends on shell behavior which varies in slash-command harness execution.

### 4. Relative path (`../`)

**Form**: relative reference from the file's own location.

**Example**: `../skills/verify-plan/SKILL.md` (referenced from `commands/verify-plan.md`)

**When applies**:
- Within commands referencing skills/agents/KB docs in sibling directories
- Documentation cross-references where the file relationship is structural (not user-invoked)

**Used by**: `commands/verify-plan.md:3,54`, `commands/build-plan.md:156`, `commands/build-team.md:3,151`, `commands/research.md:3`.

**Caveat**: relative paths require the doc reader / parser to know the doc's location. They work for human readers + Claude tool reads but DON'T work for shell-invocation contexts.

### 5. Deployed-marketplace (`~/.claude/X`)

**Form**: literal `~/.claude/...` referencing the deployed-install path.

**Example**: `~/.claude/scripts/compliance-probe.sh`

**When applies**:
- When invoking scripts at runtime that exist in the deployed install (e.g., from `commands/chaos-test.md` running compliance-probe at end of swarm)
- When testing the deployed install's behavior (e.g., `02-confused-user.md:40` echoes JSON to deployed `prompt-enrich-trigger.js`)
- When the doc references a file that exists ONLY at the deployed path (rare — most files exist at both)
- `forge.md` + `evolve.md` both-locations-write pattern documents writing to deployed path alongside source

**Used by**: `commands/chaos-test.md:80`, `commands/forge.md`, `commands/evolve.md`, `commands/prune.md`, `commands/self-improve.md`, `commands/build-plan.md`, `commands/verify-plan.md`; `swarm/personas/02-confused-user.md:40`.

## Decision tree — which convention applies?

```
Q1: Is the file referenced inside an ADR `files_affected` list, persona contract `kb_scope`, or substrate-internal scope?
  YES → Convention 1 (repo-relative)
  NO  → Q2

Q2: Is the file referenced at runtime via shell invocation in a slash-command context?
  YES → Q3
  NO  → Q4

Q3: Does `~` expansion reliably work in this context?
  YES → Convention 2 (hardcoded ~/Documents/claude-toolkit/...) for source-only files
  NO  → Convention 3 ($HOME-aware)

Q4: Is the file source-only (does NOT exist at ~/.claude/...)?
  YES → Convention 2 (hardcoded ~/Documents/claude-toolkit/...) — required because file isn't deployed
  NO  → Q5

Q5: Is the file invoked at runtime as part of testing the deployed install?
  YES → Convention 5 (deployed ~/.claude/...) — semantically correct for runtime testing
  NO  → Q6

Q6: Is the reference cross-internal (file-to-sibling-file documentation cross-reference)?
  YES → Convention 4 (relative ../ path) — appropriate for structural documentation
  NO  → Convention 2 (hardcoded source-path) is the safe default for documentation
```

## Substrate scripts (runtime resolution)

Substrate scripts invoke `findToolkitRoot()` from `scripts/agent-team/_lib/toolkit-root.js` for portable runtime path resolution. The helper walks the priority chain:

1. `HETS_TOOLKIT_DIR` env var (explicit user override)
2. `CLAUDE_PLUGIN_ROOT` env var (set by Claude Code when running as installed plugin)
3. `process.cwd()` if it looks like a toolkit checkout
4. Fallback to `~/Documents/claude-toolkit/` (author-machine path as last resort)

Used by: `kb-resolver.js`, `pattern-runner.js`, `adr.js`, `build-spawn-context.js`, `validate-adr-drift.js`, `validate-kb-doc.js`, `identity/lifecycle-spawn.js`, `contracts-validate.js`, `budget-tracker.js`. (9 consumers post-HT.1.9.)

**Substrate scripts use `findToolkitRoot()` because their runtime location varies** (source checkout vs deployed install vs marketplace install vs user-set env var). Documentation paths in commands/personas/KB-docs are static — they describe the substrate at authoring time, not at runtime.

## Examples from existing files

### `commands/chaos-test.md` — mixed conventions, intentional

```bash
# Line 18: Convention 2 (source-path; pattern-runner.js exists in both, but doc references source location for clarity)
node ~/Documents/claude-toolkit/scripts/agent-team/pattern-runner.js list-patterns

# Line 79: Convention 2 (REQUIRED; swarm/hierarchical-aggregate.js is source-only — does NOT exist at ~/.claude/swarm/)
node ~/Documents/claude-toolkit/swarm/hierarchical-aggregate.js $RUN_ID

# Line 80: Convention 5 (deployed-path; compliance-probe.sh exists in both, runtime invocation context)
bash ~/.claude/scripts/compliance-probe.sh --last-24h
```

This is NOT inconsistent. Each line uses the right path for the file's actual location + the doc's semantic intent.

### `swarm/personas/02-confused-user.md` — mixed conventions, intentional

```text
Line 13: "The hook at `~/Documents/claude-toolkit/hooks/scripts/prompt-enrich-trigger.js`..."
  ↑ Convention 2 (source-path; documenting where the hook source lives)

Line 40: echo '{"prompt":"YOUR PROMPT HERE"}' | node ~/.claude/hooks/scripts/prompt-enrich-trigger.js
  ↑ Convention 5 (deployed-path; testing the deployed hook's runtime behavior)

Line 57: Save findings to: `~/Documents/claude-toolkit/swarm/run-state/{run-id}/02-confused-user-findings.md`
  ↑ Convention 2 (source-path; output dir is in source tree, not deployed install)
```

Each line uses the right path for its semantic purpose. Documenting hook source location, testing deployed install, writing to source-tree output — three distinct contexts, three distinct correct paths.

### `commands/build-team.md:32` — `$HOME`-aware in slash-command bash

```bash
ROUTE_DECIDE_SCRIPT="$HOME/Documents/claude-toolkit/scripts/agent-team/route-decide.js"
```

Convention 3 chosen because `~` expansion is unreliable in slash-command context (per HT.1.5-verify code-reviewer Q4 HIGH catch). `$HOME` is reliably set.

### `04-architect.md` — Convention 2 throughout

```text
- `~/Documents/claude-toolkit/README.md` — what's claimed
- `~/Documents/claude-toolkit/skills/*/SKILL.md`
- Save findings to: `~/Documents/claude-toolkit/swarm/run-state/{run-id}/04-architect-findings.md`
```

Persona executes on the author's machine; reads source-tree files for documentary audit. Convention 2 is functional, not just stylistic.

## What this DOES NOT prescribe

- **Multi-machine portability of persona MDs / commands / KB docs** — the substrate is currently author-machine-bound for development tasks. Multi-machine portability would require migrating Convention 2 hardcoded paths to a runtime-resolved alternative; that's an HT.2+ candidate, not currently a substrate goal.
- **Automated lint enforcement** — the convention is descriptive (which path applies in which semantic context) rather than prescriptive (one path everywhere). Automated enforcement would need rich semantic understanding; HT.2+ candidate.
- **Marketplace install path independence** — substrate scripts already use `findToolkitRoot()` for runtime resolution. Documentation paths are intentionally static.
- **Fragmented per-context conventions** — this doc is the canonical convention reference; future audits framing the conventions as "inconsistency" should consult this doc rather than recommending sweep.

## Drift-note resolution

**Drift-note 70 RESOLVED**: HT.0.3 + HT.0.4 + HT.0.5a "5 path conventions" finding is hereby reclassified from "consolidation candidate" / "needs sweep" to "documentation gap (now closed)." The 5 conventions are intentional context-dependent semantic encoding. This doc codifies when each applies; future audits should reference this doc.

## Phase + history

- **HT.1.10** (2026-05-10) — codified per `decision-record-pattern: lightweight` shape; closes HT.0.3 + HT.0.4 + HT.0.5a path-convention findings as documentation rather than code change; resolves drift-note 70 (the conventions were misframed as bugs at audit time)

## Related work

- **Phase tags**: HT.0.3 (commands path-reference findings); HT.0.4 (persona MD mixed conventions); HT.0.5a (KB hets docs hardcoded paths); HT.1.5 (`$HOME`-aware convention applied to `commands/build-team.md` slash-command bash); HT.1.10 (this doc); HT.2.1 (`swarm/measurement-methodology.md` sibling convention doc)
- **Drift-notes**: 70 (this doc resolves)
- **`decision-record-pattern: lightweight` precedents**: HT.1.6 BACKLOG.md documentary persona class entry (first lightweight decision record); this doc (second lightweight decision record); HT.1.12 + HT.1.15 BACKLOG.md entries (3 total lightweight decision records across HT.1 closed cohort per HT.0.9-verify FLAG-5 right-sizing); `swarm/measurement-methodology.md` (HT.2.1 — third substrate-internal convention doc; sibling shape with this doc; captures observed measurement-methodology practice across 9 case studies)
- **Sibling convention docs** (`swarm/` namespace; lightweight institutional decision records; NOT ADR-shape):
  - `swarm/path-reference-conventions.md` (this doc; HT.1.10; 203 LoC; 5 closed path conventions)
  - `swarm/measurement-methodology.md` (HT.2.1; ~207 LoC; APPENDABLE 5-pattern enumeration with 9 case studies)
- **Substrate runtime resolution**: `_lib/toolkit-root.js` `findToolkitRoot()` (H.7.14 extraction) — the runtime counterpart to documentation conventions
- **Slash-command-context catch**: HT.1.5-verify code-reviewer Q4 HIGH severity finding ($SCRIPT_DIR not set in slash-command context) drove the Convention 3 ($HOME-aware) choice for build-team-helpers.sh
