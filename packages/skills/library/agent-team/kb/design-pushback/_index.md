---
kb_id: design-pushback/_index
version: 1
tags:
  - design-pushback
  - anti-patterns
  - design-discipline
  - proactive-critique
  - foundational
related:
  - architecture/discipline/trade-off-articulation
  - architecture/discipline/refusal-patterns
  - hets/stack-skill-map
status: active+enforced
---

## Summary

**Principle**: When a user's brief contains a known suboptimal component choice that has a documented better alternative, the toolkit should surface the alternative **at brief-intake time** — before team spawn — with rationale and a user override path. Empirically derived from sessions where an agent silently went along with an obviously-wrong choice that could have been caught in 30 seconds of design review.

**Distinction from `refusal-patterns`**: refusal-patterns is about WHAT to refuse (harm, scope, capability). Design-pushback is about **suggesting better alternatives** — informational, not blocking. The user can always override; the pushback exists to give them the option to course-correct cheaply.

**Distinction from `trade-off-articulation`**: trade-off-articulation is **reactive** (architect surfaces sacrifices in their proposed design). Design-pushback is **proactive** (catches suboptimal choices in the USER's stated brief before any design happens).

**Status**: v2.8.6 ships the KB registry + 5 anchor docs. Architect/planner personas consult this kb at brief-intake. v2.9.0+ may add a deterministic `design-pushback-analyzer` script that matches user briefs against the registry mechanically; for now, the catalog is consulted manually by design-time agents (LLM-side).

## Quick Reference

### When this fires

A design-pushback entry matches when ALL `applies_when` conditions are satisfied AND none of the `applies_NOT_when` exclusions apply. Each entry encodes the "context filter" — Drive IS the right answer for `share a doc with my non-technical co-founder`; wrong for `production app file storage`. Context-filter rigor is what keeps the pushback signal high vs. noise.

### Severity ladder

| Severity | Behavior | When to use |
|----------|----------|-------------|
| **HIGH** | Pause for explicit user acknowledgment before proceeding; log override-rationale | Choices that materially compromise security, scalability, or operability with no upside in the stated context |
| **MEDIUM** | Surface inline as "Consider: …"; user can proceed without explicit ack | Choices that work but have a clearly-better alternative; reasonable people might disagree |
| **LOW** | Log as drift-note in run debrief; don't interrupt intake | Stylistic / convention disagreements; "FYI for future" |

### Override path

A HIGH-severity pushback can always be overridden by user statement: "Proceed with X anyway: <one-line rationale>". The rationale is logged to `~/.claude/library/sections/toolkit/stacks/design-pushback-overrides/volumes/<date>-<run-id>.md` for institutional learning (are users consistently overriding the same pushback? Maybe the entry is mis-calibrated).

## Full content

### Entry schema

Every `kb:design-pushback/<id>.md` MUST conform to this frontmatter shape:

```yaml
---
kb_id: design-pushback/<slug>
version: 1
tags: [design-pushback, <domain>, <severity-tag>]
related:
  - <related-kb-id>             # cross-link to architecture/security/data KB
status: active+enforced
pattern: |
  One-sentence statement of the anti-pattern. State it in the form
  "Using X for purpose Y in context Z". This is the matcher target.
severity: HIGH | MEDIUM | LOW
applies_when:
  intent: [build, plan, refactor]   # broad intent classes from tech-stack-analyzer
  domain: [web, backend, mobile, data, ml, infra, security]
  feature_keywords:                  # keyword list — match against parsed brief
    - <keyword>
    - <keyword>
applies_NOT_when:                    # exclude when ANY of these match
  - "<context phrase that makes the pattern legitimate>"
  - "<another such phrase>"
preferred_alternative:
  - <primary alternative name + 1-line description>
  - <secondary alternative if applicable>
why_better: |
  Multi-line bullet rationale. Cite specific properties (rate limits,
  SLA, security model, observability story) — not generic "best practice"
  appeals. Reader should be able to verify each claim independently.
override_requires: |
  When the user wants to proceed with the original choice, what must
  they explicitly acknowledge? List the specific risks accepted. This
  text is what gets logged in design-pushback-overrides/ for audit.
empirical_origin: |
  Where did this pattern come from? Reference the project, bench run,
  or post-mortem that surfaced it. Empirical origin > theoretical
  preference; entries without origin should be challenged.
---

## Quick Reference

[1-2 paragraph plain-language explanation; what the pattern looks like
in the wild; what the alternative looks like; when to override.]

## Full content

[Optional deeper treatment: code examples, cost comparisons, migration
paths, references to external sources.]
```

### How agents consume this catalog

**At brief-intake (tech-stack-analyzer / architect / planner)**:

1. Parse user brief → extract stated component choices (storage backends, auth mechanisms, deployment targets, language/framework selections, etc.)
2. List all `design-pushback/*.md` entries via `node packages/runtime/orchestration/kb-resolver.js list-design-pushback` (v2.9.0+) OR by reading `packages/skills/library/agent-team/kb/design-pushback/` directory directly (v2.8.6)
3. For each entry, evaluate the `applies_when` filter against the parsed brief:
   - All `applies_when` conditions match → candidate
   - Any `applies_NOT_when` exclusion matches → drop candidate
4. For matched entries, surface in the intake output:
   - **HIGH**: pause-for-acknowledgment block with the `preferred_alternative` + `why_better`
   - **MEDIUM**: inline note in plan summary
   - **LOW**: appended to drift-notes in the debrief
5. If user proceeds despite HIGH, log the override-rationale to `library/.../design-pushback-overrides/`

### How to add a new entry

Before adding an entry, verify:

1. **Empirical origin**: this pattern surfaced in ≥1 actual run / project (cite it). Theoretical "best practice" entries without empirical anchor get rejected — they tend to be over-aggressive and erode trust.
2. **Specificity**: the `applies_when` filter is narrow enough that false positives are unlikely. If you can't write good filters, the pattern is probably too general for design-pushback (consider an architect.md output-contract addition instead).
3. **Override path is sane**: a knowledgeable engineer should be able to read `override_requires` and decide intelligently. If the only override is "you really shouldn't", the entry is probably MEDIUM at best, not HIGH.
4. **Better-alternative is concrete**: not "use a real database" but "use Postgres + pgvector for the vector workload + relational data unification". Naming matters.

Then:
- Pick a slug: `<context>-<bad-choice>` or `<bad-choice>-for-<context>`
- Create `packages/skills/library/agent-team/kb/design-pushback/<slug>.md` following the schema above
- Add cross-references from related architecture/security/data KB docs
- Open a PR — review by 1 other person (sanity check on filter calibration)

### Calibration warnings

- **Over-aggressive registry kills trust**: if pushbacks fire on every project for nothing, agents will start ignoring them. Default to MEDIUM; only HIGH when the choice would cost more to fix later than the pushback-friction costs now.
- **Cultural pitfall**: design-pushback can read as "the toolkit telling me what to do". Frame entries as "here's what empirically happened in past projects that chose X" — descriptive, not prescriptive. Cite specific outcomes when possible.
- **Pattern blindness**: this catalog only catches what's in it. Novel suboptimal choices are still missed. Don't treat absence-from-catalog as endorsement; architect persona's trade-off-articulation contract remains the primary defense.

## Related Patterns

- [trade-off-articulation](../architecture/discipline/trade-off-articulation.md) — sister discipline; design-pushback is the proactive variant
- [refusal-patterns](../architecture/discipline/refusal-patterns.md) — adjacent; refusal-patterns says WHAT to refuse, design-pushback says WHAT to suggest as alternatives
- [stack-skill-map](../hets/stack-skill-map.md) — tech-stack-analyzer's input; design-pushback fires after stack-skill-map matches a stack but before team spawn
- [architecture/discipline/reliability-scalability-maintainability](../architecture/discipline/reliability-scalability-maintainability.md) — RSM trade-offs frequently motivate design-pushback entries (e.g., "single-region for mission-critical")
