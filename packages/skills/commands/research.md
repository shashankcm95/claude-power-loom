# /research — Document codebase as-is for downstream Plan/Implement cycle

User-facing entry point for the **Research** step of the canonical RPI (Research → Plan → Implement) workflow adopted in H.8.6 from [humanlayer/advanced-context-engineering-for-coding-agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents). See `skills/agent-team/patterns/research-plan-implement.md` for doctrine.

## Arguments

`$ARGUMENTS` — the research question or topic.

Examples:
- `/research how does the prompt-enrichment loop work end-to-end?`
- `/research where does parseFrontmatter live and what variants exist?`
- `/research what are the active ADRs and which files do they touch?`

If `$ARGUMENTS` is empty, ask one clarifying question (research question + scope) and stop.

## CRITICAL — discipline of this command (per humanlayer canonical)

**This command's only job is to DOCUMENT the codebase as it exists today.**

- DO NOT suggest improvements or changes
- DO NOT perform root-cause analysis
- DO NOT propose future enhancements
- DO NOT critique the implementation
- DO NOT recommend refactoring
- ONLY describe what exists, where it exists, how it works, and how components interact

The output is a **technical map** of the existing system. It becomes input to `/plan`, where critique is welcome. Mixing documentation and critique in this phase contaminates downstream context (per ace-fca.md four-dimension framing: this protects Correctness — neutral facts vs. premature interpretation).

## Steps

### 1. Read directly-mentioned files in full

If the user mentions specific files (tickets, plans, source files), read them FULLY first using the Read tool **without** `limit`/`offset` parameters. This ensures full context before decomposing.

### 2. Search for prior research artifacts

Before spawning sub-agents, search `swarm/thoughts/shared/research/` for prior research on similar topics:

```bash
ls swarm/thoughts/shared/research/ 2>/dev/null
grep -lri "<keyword>" swarm/thoughts/shared/research/ 2>/dev/null
```

If a prior artifact covers the topic, surface it and ask the user whether to (a) reuse it, (b) supersede it (mark old `status: superseded`, write new), or (c) extend it. Don't redo research that exists.

### 3. Decompose the research question

Identify components, files, or concepts to investigate. Create a TodoWrite list to track sub-investigations.

### 4. Spawn documentary sub-agents in parallel

Per H.8.6 documentary-persona convention, the research command uses three personas (added in H.8.6):

- **14-codebase-locator** — finds WHERE files and components live (file paths, directory structure)
- **15-codebase-analyzer** — explains HOW specific code works (data flow, function purposes, no critique)
- **16-codebase-pattern-finder** — finds existing patterns to model after (with file:line citations, no recommendations)

Each persona's contract explicitly forbids critique language. They are documentarians, not critics.

```bash
# Identity assignment for each documentary persona
LOCATOR=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js assign \
  --persona 14-codebase-locator --task "research-${RUN_ID}" | jq -r '.identity')
ANALYZER=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js assign \
  --persona 15-codebase-analyzer --task "research-${RUN_ID}" | jq -r '.identity')
PATTERN_FINDER=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js assign \
  --persona 16-codebase-pattern-finder --task "research-${RUN_ID}" | jq -r '.identity')
```

Spawn each in parallel with focused sub-questions. Don't spawn all three for every research question — pick the appropriate ones.

### 5. Wait for all sub-agents and synthesize

After sub-agents complete, synthesize their findings into a single research artifact. Verify file:line citations are accurate (re-read suspicious ones in the main context).

### 6. Write research artifact to `swarm/thoughts/shared/research/`

Filename: `swarm/thoughts/shared/research/YYYY-MM-DD-<description>.md`

Required frontmatter (see `swarm/thoughts/shared/research/README.md`):

```yaml
---
date: YYYY-MM-DDThh:mm:ssTZ
researcher: <persona.identity or "root">
git_commit: <sha at research time>
branch: <branch name>
repository: power-loom
topic: "<question being researched>"
tags: [research, codebase, ...]
status: complete
last_updated: YYYY-MM-DD
last_updated_by: <persona.identity or "root">
---
```

Body: descriptive sections (no critique). End with a `## Follow-up questions for plan phase` heading capturing anything that surfaced as critique-territory but didn't belong in the documentary output.

### 7. Surface to user

Show the user the path to the research artifact and a one-paragraph executive summary. Suggest the next step:

> Research complete: `swarm/thoughts/shared/research/YYYY-MM-DD-X.md`. Next step: `/plan` consuming this artifact.

## What this command is NOT

- Not a substitute for `/build-team` when the task is action-oriented (research is preparatory; build-team executes)
- Not a substitute for `/chaos-test` (chaos is adversarial probing; research is neutral mapping)
- Not a place for critique or recommendations (those belong in `/plan`)
- Not a place for new work proposals (research describes existing state)

## Why a separate command

Per ace-fca.md doctrine, separating research from critique protects context Correctness. A research context full of critique language contaminates the downstream plan: the planner reads "this is buggy" framing instead of neutral "this works as follows" framing, and produces plan items based on the critique rather than the actual system. Research-first, critique-later is the canonical workflow.

The command is also **resumable**: research artifacts persist in `swarm/thoughts/shared/research/`, so subsequent sessions (and subsequent phases) can consume prior research without recomputing it.
