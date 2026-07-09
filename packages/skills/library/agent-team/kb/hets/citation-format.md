---
kb_id: hets/citation-format
version: 1
tags: [hets, conventions, citation, kb-sources, output-contract]
---

## Summary

Every HETS actor response that consults the knowledge base MUST end with a
`## KB Sources Consulted` section listing the `kb:<id>` refs that grounded its reasoning
(at least 2 specific refs). The `kb-citation-gate` PostToolUse hook enforces the strict
`kb:<id>` prefix on each ref — a populated section using file-path or skill-name "citations"
fails the gate. This is the canonical, gate-passing convention that every persona brief and
thin agent stub points to. It was extracted from `agents/architect.md` at persona-depth Wave 2
so a substrate-wide output convention lives in one home instead of being cross-referenced from
~24 files into one persona's definition.

## Full content

### The `## KB Sources Consulted` section

Format:

```text
## KB Sources Consulted

- `kb:<id>` — <one-line note on what this doc informed>
- `kb:<id>` — <one-line note>
```

**Minimum**: at least 2 `kb:<id>` references (1 from the always-relevant set + 1
context-appropriate). If the work touches AI systems, add an AI-systems ref. If you cannot
identify 2 relevant kb docs, that is a smell — pause and re-scan the kb index before responding.

### Strict citation format (the gate-passing rule)

The `kb-citation-gate` PostToolUse hook requires the `kb:<id>` prefix on each ref. Anything
else fails the gate, even if the heading is present (v2.8.2-run1 shakedown P2-3: an actor wrote
a populated section with file-path + skill-name "citations" → the gate fired SECONDARY-enforcement
on the missing `kb:` prefix).

**Correct examples** (these pass the gate):

- ✓ `` `kb:architecture/crosscut/single-responsibility` — informed module boundary split ``
- ✓ `` `kb:hets/spawn-conventions` — informed challenger pairing decision ``
- ✓ `` `kb:architecture/ai-systems/agent-design` — informed actor responsibility scoping ``

**Incorrect — DO NOT use** (these fail the gate):

- ✗ `` `Read: packages/skills/library/agent-team/SKILL.md` `` — file path, not a kb id
- ✗ `` `Skill: tech-stack-analyzer` `` — skill name, not a kb id
- ✗ `` `architect.md` `` — bare filename
- ✗ Free-form prose like "consulted the HETS docs" — no `kb:` prefix
- ✗ `` `kb:` `` alone (no body) — empty ref

Map your reasoning sources to specific `kb:<id>` refs from the catalog. If the reasoning came
from a file outside `packages/skills/library/agent-team/kb/`, that is evidence you skipped the
catalog — pause and find the right `kb:` ref before responding.

### Narrow exception — substrate-internal meta-edits

Only when the file being edited lives under `agents/`, `packages/runtime/personas/`,
`packages/runtime/contracts/`, or `swarm/run-state/` (a meta-fix to a persona's own definition,
the persona contracts, or HETS substrate files), the `## KB Sources Consulted` section may
contain `n/a — <one-line justification>` instead of citations. The criterion is **structural,
not semantic**: the test is "does the edited path start with `agents/`,
`packages/runtime/personas/`, `packages/runtime/contracts/`, or `swarm/run-state/`?", not "does
this feel mechanical?". Outside that file scope, always cite.

### Why mandatory at the response level

Design reviews, trade-off walkthroughs, and recommendation memos are valid actor outputs that
do not always warrant a full ADR. Without a response-level citation contract, kb grounding
becomes invisible to reviewers and to the bench harness `kb_consultation` soft-signal. An ADR's
`Sources:` field remains required for ADRs specifically; this `## KB Sources Consulted` section
is the universal floor.
