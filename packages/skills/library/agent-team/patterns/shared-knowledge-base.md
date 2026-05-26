---
pattern: shared-knowledge-base
status: active
intent: One source of truth for docs all agents in a run reference; mid-run edits do not affect in-flight agents.
related: [content-addressed-refs, prompt-distillation, hets, skill-bootstrapping, tech-stack-analyzer, kb-scope-enforcement]
---

## Summary

KB docs live at `skills/agent-team/kb/` with stable `kb_id` (e.g. `web-dev/react-essentials`). All agents in a run reference the same docs via the `kb-resolver` CLI. At run start, the manifest is **frozen into the run-state directory**, so agents resolve against an immutable snapshot — KB edits during the run cannot retroactively change what already-spawned agents read.

## Intent

Real engineering teams converge on shared documentation (SharePoint, Notion, internal wikis) so everyone reasons from the same authority. Without this, each agent loads its own context and drifts. Shared KB collapses authoring redundancy (one doc, many readers), version-drift redundancy (everyone sees the same version in a given run), and storage redundancy (one file on disk, not N copies in spawn prompts).

## Components

- **KB directory**: `skills/agent-team/kb/<topic>/<doc>.md`. Each file has frontmatter with `kb_id`, `version`, `tags[]`.
- **Manifest**: `skills/agent-team/kb/manifest.json` — index of `kb_id → path / version / hash / tags`. Regenerate via `kb-resolver scan` after editing.
- **Resolver CLI**: `scripts/agent-team/kb-resolver.js` — `cat`, `hash`, `list`, `resolve`, `scan`, `snapshot`, `register`.
- **Run-state snapshot**: `swarm/run-state/<run-id>/kb-snapshot.json` — frozen view at run start. See [content-addressed-refs](content-addressed-refs.md) for ref syntax.

## Failure Modes

1. **Drift between manifest and disk** — someone edits a doc but forgets to run `scan`. Counter: `register` subcommand for single-file updates; `scan` is one command and quick to re-run; future H.2 task: pre-commit hook that runs `scan` automatically.
2. **kb_id collisions** — two docs with the same `kb_id` in frontmatter. Counter: `scan` warns when `kb_id` differs from the path-implied id; rejection at `register` time.
3. **Snapshot bypass** — an agent calls `kb-resolver cat <id>` instead of resolving against the snapshot. Counter: agents in a HETS run should call `resolve kb:<id>@<hash>` with the hash from the run snapshot, not bare `cat`.
4. **Ballooning KB** — every conversation adds a doc; KB grows unbounded. Counter: tags + retire policy; KB doc with no reads in 60 days flagged for review.

## Validation Strategy

Stress-test scenarios:
- Edit a KB doc mid-run; verify in-flight agents still resolve to the snapshot hash, not the new content
- Register a doc with a `kb_id` that conflicts with an existing entry; verify rejection
- Run `scan` after manually deleting a manifest entry; verify it's restored from the file's frontmatter
- Resolve a ref with a stale hash (`kb:web-dev/react@deadbeef` when current hash is `a3f1...`); verify mismatch detection

## When to Use

- Any HETS run where ≥2 agents reference the same authority (almost always)
- Any project that wants reproducible team behavior across runs
- When auditing an agent's reasoning — the KB snapshot tells you exactly what reference docs the agent saw

## When Not to Use

- Single-shot one-off agent invocations where shared context is overhead
- Tasks deliberately exercising the agent's own knowledge without scaffolding (chaos-test-like benchmarks)

## Related Patterns

- [Content-Addressed References](content-addressed-refs.md) — the ref syntax + hash-validation layer this KB sits on top of
- [Prompt Distillation](prompt-distillation.md) — KB docs themselves use the card+full form to keep refs cheap
- [HETS](../SKILL.md) — the substrate
