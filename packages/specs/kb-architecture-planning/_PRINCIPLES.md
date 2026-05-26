# Curation Principles

Read this first every session. Defines what earns inclusion in the architectural KB. Prevents scope creep; enables disciplined authoring.

## Inclusion criteria (must satisfy AT LEAST ONE)

### 1. Foundational

Pattern appears in 3+ Tier-1 canonical sources (see `_SOURCES.md` for tier definitions). High activation-noise-reduction value even if "everyone knows it" — the substrate's KB anchors the model on canonical framings rather than the activation-mixture-distribution from training data.

### 2. Drift-relevant

Pattern would have prevented a specific cascading bug class the substrate has actually seen. Cite the drift-note number(s) where this pattern would have helped. Substrate-specific value even if not foundational.

## Exclusion criteria (any one disqualifies)

- Pattern appears in only one source AND not drift-relevant (insufficient signal)
- Pattern is highly language-specific (substrate is stack-agnostic)
- Pattern is a tool recommendation in disguise ("use library X" is not an architectural pattern)
- Pattern is a fad (mentioned only in 2024+ blog posts; not yet stable)
- Pattern is too generic to be actionable ("write good code")
- Pattern duplicates an existing kb doc without adding architectural framing (e.g., generic "use Express middleware" overlaps with `kb/backend-dev/express-essentials`)

## Scope rules

- **Comprehensive but not exhaustive**: each authored doc is roughly 500-1500 lines. Not footnote-summary; not whole-book-vendor. Enough for the model to apply with nuance.
- **Substrate-specific examples**: every doc cites at least one substrate drift-note OR phase tag where this pattern is relevant. The substrate's own failures are unique evidence and shouldn't be wasted.
- **Cross-cutting wins**: when in doubt about taxonomy placement, prefer `crosscut/` over domain-specific. Broader retrievability.
- **Anti-pattern sections required**: every pattern doc includes "When NOT to use" + "Common misapplication" + "Failure mode if violated."
- **Citations are weighted**: Tier-1 sources carry direct authority; Tier-3+ sources support consensus detection only.

## KB size target

- Roughly 30-50 pattern docs total across all of `kb/architecture/`
- Bias toward fewer, deeper docs over many, shallower
- If we hit 50, audit before adding 51 (similar to Convention G's cap rule N=15 for forcing instructions)

## Authoring quality bar

A pattern doc is shippable when:

1. Frontmatter complete:
   - `kb_id: architecture/<topic>/<doc-name>` — matches file path exactly
   - `version: 1`
   - `tags: [...]` — at least 3 tags including taxonomy slot + cross-cutting concerns
   - `sources_consulted: [...]` — explicit list of sources cited
2. Summary section at top, ≤5 lines, paste-inline cheap
3. Full content covers all of:
   - Intent (what problem this solves)
   - Components / Mechanism (how it works)
   - When to use (positive criteria)
   - When NOT to use (anti-criteria)
   - Common misapplication (concrete failure modes)
   - Examples (at least one substrate-specific drawn from drift-notes or phase tags)
   - Related Patterns (cross-references to other kb/architecture docs)
4. Cites at least 2 Tier-1 or Tier-2 sources
5. Reviewed by user before merging to main

## Review checklist (apply before each PR ships)

- [ ] Inclusion criteria met (foundational OR drift-relevant)
- [ ] Frontmatter complete with sources_consulted array
- [ ] Substrate-specific example cited
- [ ] Anti-pattern + failure mode sections present
- [ ] No language-specific bias (or explicit caveats if unavoidable)
- [ ] Cross-references to related patterns added
- [ ] manifest.json regeneration considered (if shipping to canonical kb)

## Anti-scope creep guards

- **No "interesting but not relevant" patterns** — interesting alone fails the filter
- **No book-paraphrasing** — synthesize from multiple sources; don't restate one
- **No taxonomy expansion without evidence** — overflow patterns wait for 3+ candidates before earning a new taxonomy slot
- **No live integration in this track** — runtime hooks/contracts/agents stay out until v2.1+

## When in doubt

Default to **exclusion**. Better to ship 25 high-quality docs than 50 mediocre ones. The KB's value comes from selectivity — every doc earns its place by paying back at retrieval time.
