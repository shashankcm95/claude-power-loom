---
kb_id: design-pushback/syntactic-gate-extension-for-tool-bypass
version: 1
tags: [design-pushback, substrate-internal, gates, observability, hidden-cost, medium-severity]
related:
  - architecture/discipline/refusal-patterns
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/reliability-scalability-maintainability
status: active+enforced
pattern: |
  When an existing deterministic gate (e.g., a PreToolUse hook on tool X)
  is found to be bypassable by tool Y, the reflex fix is to extend the
  same gate via syntactic parsing of tool Y's input (e.g., extracting
  file paths from a Bash command line by regex) to plug the gap.

  This entry warns against that reflex without first measuring the cost
  of the parsing-layer change.
severity: MEDIUM
applies_when:
  intent: [substrate-extension, gate-design, hook-extension]
  context_keywords:
    - "bypass via Bash"
    - "bypass via heredoc"
    - "extend gate"
    - "PreToolUse parsing"
    - "regex on command line"
    - "syntactic gate"
applies_NOT_when:
  - "the bypass is the actual primary attack surface (not capability gap)"
  - "the gate has explicit STRICT mode opt-in for the broader pattern"
  - "the parsing target is structured (JSON, AST) not free-form syntax"
preferred_alternative:
  - "Add gate as WARN-not-BLOCK by default — observability without false-positive lockout"
  - "Reserve BLOCK for explicit --strict opt-in (env var or substrate config)"
  - "Document the bypass in the original gate's design notes; surface in audit reports"
  - "If bypass is high-severity (e.g., secret exfil), restructure the entire gate model — don't bolt on a parser"
why_better: |
  - **False-positive surface explodes**: A regex on Bash commands catches `> tsconfig.json` AND `> tsconfig.json.bak` AND `> /tmp/tsconfig.json` AND `mv foo tsconfig.json` (`mv` has no redirect token but ends up overwriting). Each false positive trains the operator to bypass the gate, eroding trust in ALL gates.
  - **Layer-mixing**: A PreToolUse:Write hook's job is "what file is about to be modified?" — answered by `tool_input.file_path`. A PreToolUse:Bash hook that *infers* the same thing from a Bash command is *parsing* (different architectural layer). Parsing-as-validation is a known anti-pattern when the parse target is informal syntax.
  - **Hidden cost ≥ original bypass cost**: The bypass demonstrated may be a one-off; the parser becomes a load-bearing dependency that must be maintained against shell quirks (process substitution, heredoc, dd, redirected fds, `bash -c "..."` nesting, etc.). MTTR for a buggy parser is often higher than MTTR for the bypass it's blocking.
  - **Substrate trust is asymmetric**: operators learn to *disable* gates that false-positive, but rarely *re-enable* them. A WARN-not-BLOCK gate preserves observability without inviting bypass habits.
empirical_origin: |
  v2.9.0 Phase D.1 (FIX-I9). Architect.theo HIGH-5 caught the reflex fix
  during the v2.9.0 design review: config-guard.js is PreToolUse:Write only;
  v2.8.5-control demonstrated a heredoc bypass by writing `tsconfig.json`
  via Bash. The naive fix was "extend config-guard to also parse Bash". The
  shipped fix is `validate-config-redirect.js` (PreToolUse:Bash) with
  WARN-not-BLOCK default + STRICT_CONFIG_GUARD=1 escalation env var, plus
  this catalog entry to mark the design-pushback for future similar reflexes.
override_requires: |
  Override is reasonable when ALL of the following hold:
  - The deployment context is a CI audit run where false-positives have
    near-zero cost (no human in the loop to retrain)
  - The bypass demonstrated is the actual attack surface (not a
    capability gap), e.g., active secret exfiltration via redirect
  - The substrate is shipping a clean structured-input parser (not regex
    on free-form syntax)
  - The override is gated behind an explicit env var or substrate-config
    flag (not implicit; not silently-default)
related_pattern_cross_links:
  - "kb:architecture/discipline/refusal-patterns — substrate-scope refusal is the parent category for substrate-internal decisions; this entry is the design-pushback view of the same trade-off."
  - "kb:architecture/discipline/error-handling-discipline — anti-silencing argues for WARN observability over silent-skip; this entry argues WARN observability over noisy-block."
---

## Quick Reference

**The anti-pattern**: An existing deterministic gate (e.g., a `PreToolUse:Write` hook on protected files) is found to be bypassable by another tool (e.g., a `Bash` redirect like `echo > tsconfig.json`). The reflex fix is to extend the same gate via syntactic parsing — regex over Bash command lines, heredoc detection, etc. — to plug the gap inline.

**Why it bites**: free-form syntax has effectively unbounded edge cases (process substitution, heredoc, `dd`, redirected fds, `bash -c "..."` nesting, `mv` overwrites without a redirect token, command aliases). Each false positive trains operators to bypass the gate, eroding trust in ALL gates. The parser becomes a load-bearing dependency whose MTTR for bugs often exceeds the MTTR for the original bypass it was patching.

**The fix**: add a secondary gate as **WARN-not-BLOCK** by default for observability, and reserve BLOCK behavior for explicit `--strict`/env-var opt-in where false-positives have near-zero cost. See `validate-config-redirect.js` (`PreToolUse:Bash`) + `STRICT_CONFIG_GUARD=1` escalation for the canonical example.

## Full content

### Pattern explanation

Reflex fixes for tool-Y-bypass of tool-X-gates often have hidden costs equal to or greater than the original bypass cost. The substrate's gate architecture should be designed around what the protected resource IS (a file, an action), not around what tools happen to reach it. When a tool-specific bypass is found:

1. **First**: ask whether the gate's *target* (the file, the action) has a tool-agnostic representation. If yes, restructure the gate to consume that representation.
2. **Second**: if no tool-agnostic representation exists, add a secondary gate as WARN-not-BLOCK — observability is cheap and avoids the false-positive cliff.
3. **Third**: reserve BLOCK behavior for explicit opt-in (env var, substrate config, CI mode) where false-positives have near-zero cost.

### Worked example — validate-config-redirect.js

```
PreToolUse:Write  → config-guard.js BLOCKS on protected file_path  ✓ load-bearing
PreToolUse:Bash   → validate-config-redirect.js WARNs on redirect    ✓ observability
                  + STRICT_CONFIG_GUARD=1 env var → BLOCKs           ✓ opt-in strict
```

The WARN behavior preserves operator trust (no surprise blocks on legitimate build scripts writing `tsconfig.build.json`). The opt-in STRICT mode preserves the gate for tight-discipline contexts. The KB entry preserves the design rationale for future similar bypasses.

### When not to apply this pushback

- The bypass is **actively exploited**, not theoretical. Measured signal > theoretical concern.
- The protected resource is **high-stakes** (production secrets, signing keys) where false-positive cost is small compared to false-negative cost.
- The substrate ships a **structured-input** parser, not regex on free-form syntax. (e.g., AST-based shell parser).

## Related Patterns

For the substrate-side decision framework, see `kb:architecture/discipline/refusal-patterns` — particularly the substrate-scope refusal axis. This design-pushback entry is the proactive-catalog view of the same trade-off; the refusal-patterns entry is the in-flight decision framework.

See also `kb:architecture/discipline/error-handling-discipline` — the anti-silencing argument is structurally similar (WARN observability over silent-skip vs. WARN observability over noisy-block).
