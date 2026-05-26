---
pattern: meta-validation
status: active
intent: Run the chaos test on the chaos test infrastructure itself.
related: [hets]
---

## Summary

Bugs in audit infrastructure propagate to every audit downstream. Run the chaos-test machinery against itself after each new HETS feature. Demonstrated value in chaos-20260502-060039: surfaced C-1 prototype pollution in `contract-verifier.js` (would have force-passed any future contract), H-1 `.some` semantics, `\Z` regex bug — none of which would have surfaced in a regular target-the-toolkit audit.

## Intent

The audit substrate is the most-trusted code in the system. If it has bugs, every audit it produces is suspect. Meta-validation specifically targets the audit infra — verifier, tree-tracker, pattern-recorder, aggregator, persona contracts, the patterns in this directory — as the audit subject.

## Components

- **No new code** — this pattern uses the existing chaos-test command pointed at the toolkit directory itself.
- **Persona alignment** — the architect persona in particular is well-suited to flag oversells (e.g., "triple contract advertised but only 2/3 implemented"). The hacker persona attacks the verifier as a black box. The code-reviewer reads it as source.
- **Cross-run baseline** — runs are compared against prior chaos runs to detect regressions in the audit substrate, not just in the audit target.

## Failure Modes

1. **Recursion confusion** — actors reviewing HETS code may produce findings about HETS that the (HETS-driven) verifier then evaluates. Self-referential. Counter: clear separation in spawn prompts between "subject under audit" and "tools used to audit."
2. **Conformity bias** — actors that have read the HETS docs may be primed to interpret behavior favorably. Counter: include at least one actor whose task description deliberately omits HETS context (e.g., `02-confused-user` testing prompt-enrich-trigger doesn't need HETS context to do its job).
3. **Bootstrapping paradox** — if the verifier itself is broken (as it was in chaos-20260502-060039), the verifier's verdicts on the actors auditing the verifier are themselves suspect. Counter: cross-check verifier output against manual inspection for the first ~3 meta-validation runs.

## Validation Strategy

Concrete failure modes to plant in a future meta-validation run:
- Inject a deliberately-broken contract (e.g., `claimsHaveEvidence` always returns true). Verify chaos test catches it via convergence across personas.
- Inject a tree-tracker bug (e.g., `complete` writes wrong status). Verify aggregator notices the inconsistency and architect actor flags it.
- Inject a pattern-recorder bug (e.g., silent failures). Verify honesty-auditor measures missing entries.
- Add a fake new pattern doc with broken validation strategy. Verify next meta-run flags it as malformed (when pattern-targeted simulation runner exists in H.2).

## When to Use

- After every new HETS feature ships (verifier change, tree-tracker change, new persona, new pattern)
- Quarterly even if no changes — the substrate may have drifted via dependency updates or environmental changes
- After any regular chaos-test run produces unexpected verdicts (could be the audit infra, not the audit target)

## When Not to Use

- During active development of a new feature (run targeted unit checks, not full chaos)
- When budget is tight — meta-validation costs the same as a regular chaos run, but the bug-catching ROI is highest here so usually worth it

## Related Patterns

- [HETS](../SKILL.md) — the substrate being meta-validated
- All other patterns — meta-validation is what enables them to evolve safely
