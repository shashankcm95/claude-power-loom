---
pattern: structural-code-review
status: active
intent: The third leg of the "triple contract" defense — pattern checks against code shape, not just output content.
related: [hets, persona-skills-mapping, convergence-as-signal, validator-conventions]
---

## Summary

Pattern checks operate on **code blocks** (` ```...``` `) embedded in actor findings. Catches the 1000-zeros family of bugs: functionally-correct output produced by an architecturally-wrong approach. H.2.7 ships two checks: `noUnrolledLoops` (≥N identical lines = manual unrolling) and `noExcessiveNesting` (brace-counting depth limit, C-family). Closes the SKILL.md "triple contract" oversell by making the third leg real.

## Intent

The original 1000-zeros example: actor asked to print 1000 zeros writes `print(0)` × 1000 instead of `for i in range(1000): print(0)`. Functional check passes (output is 1000 zeros). Anti-pattern check (template repetition) might catch it but is tuned for finding text, not code. **Structural code review** is the dedicated third defense — it inspects the SHAPE of code, not its outputs or its narrative.

For HETS, this matters because builder personas (06-12) write code as part of their fix recommendations. Without pattern checks, an actor that produces "the right answer wrong" passes verification.

## Components

- **Code-block extraction**: regex match on triple-backtick fences, work on the content between (not the fences themselves).
- **`noUnrolledLoops` check**: line-by-line repetition counting; ≥`maxRepetitions` identical lines = fail. Default threshold: 5.
- **`noExcessiveNesting` check**: brace-counting depth tracker. Strips string literals + comments before counting (so `"{}"` inside a string doesn't inflate depth). Default `maxDepth`: 4 (matches the CLAUDE.md fundamentals "no nesting > 4 levels" rule).
- **Both functional checks**: failure cause verdict=fail (not warn). Rich return shape includes the offending sample.
- **Composability**: contracts can include either or both. For the chaos-test auditor personas, neither is required (they produce findings, not code). For builder personas, both should land in the contract — TODO follow-up to add them to 06-12.

## Failure modes

1. **False positive on legitimate boilerplate**: imports, type declarations, table data. Mitigation: `maxRepetitions` is configurable per-contract; bump threshold or skip the check via `--skip-checks` for contracts where data tables are normal.
2. **Indentation-based languages bypass nesting check**: Python doesn't use braces. The check returns pass (no depth detected) for Python code blocks. Documented limitation; future work could add an indentation-based path.
3. **Code embedded as plain text (no fences)**: not detected. Convention: actors should use fenced code blocks for any code in their findings (per `kb:hets/spawn-conventions`). Verifier doesn't enforce fence usage today.
4. **String-literal brace pollution** in nesting check: stripping is heuristic regex. Edge cases like template literals with `${...}` interpolation may still inflate. Worst case: false-positive failure on code with deep templates; user adjusts `maxDepth` or skips the check.

## Validation strategy

Stress-test scenarios:
- Plant code block with 10 identical `print(0)` lines → `noUnrolledLoops` should fail with `repetitionCount: 10`.
- Plant code block with `if (a) { if (b) { if (c) { if (d) { if (e) { ... } } } } }` (depth 5) with `maxDepth: 4` → `noExcessiveNesting` should fail with `maxObservedDepth: 5`.
- Plant clean code (loops + functions, depth ≤ 4, no repetition) → both checks pass.
- Plant Python code with no braces but deep indentation → `noExcessiveNesting` returns pass (limitation; documented).
- Plant boilerplate-style code (5 import statements) with default `maxRepetitions: 5` → fail; demonstrates need to tune per-contract.

## When to use

- All builder-persona contracts (06-12) once the team starts writing real code in findings — currently auditor personas don't write code so the checks are moot for them.
- Any persona contract where the spawn task involves implementing a fix (not just identifying one).
- Periodic chaos audits to verify the third-contract defense is firing in real outputs.

### Engineering vs Audit Tasks

The structural checks (`noUnrolledLoops` F5, `noExcessiveNesting` F6) apply uniformly across both task types via the H.5.7 `engineering-task.contract.json` template. See `commands/build-team.md` Step 7 for task-type heuristic + contract selection.

## When NOT to use

- Contracts for personas that produce only findings (auditor family — 01-05). Adding the checks adds verifier overhead with no benefit.
- Contracts where output is structured data (JSON, YAML, CSV in code blocks). Both checks apply heuristics designed for procedural code; data blocks may trigger false positives.
- Contracts with code blocks that are intentionally verbose (e.g., test fixtures, generated code). Use `--skip-checks` for those runs.

## Related patterns

- [HETS](../SKILL.md) — triple-contract framing
- [persona-skills-mapping](persona-skills-mapping.md) — which personas should opt in
- [convergence-as-signal](convergence-as-signal.md) — when multiple personas independently flag structural issues, treat as high-confidence
