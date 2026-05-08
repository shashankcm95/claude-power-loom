---
pattern: system-design-principles
status: active+enforced
intent: Canonical reference for system-design principles applied across the toolkit — SOLID + DRY + KISS + YAGNI + clean-code essentials. Architect agent + 04-architect HETS persona reference this when producing design output. Required reading before any architect-tier design work.
related: [validator-conventions, structural-code-review, route-decision]
---

## Summary

Five principle families govern design decisions in this toolkit. They're listed here in a single canonical place so the architect agent and HETS personas can reference the same set, and so the plan-schema validator's Tier 1 `## Principle Audit` requirement has unambiguous content to check against.

| Family | When it applies | Anti-pattern if violated |
|--------|-----------------|--------------------------|
| **SOLID** | Module / function / interface design | God Object, Tight Coupling, Leaky Abstraction |
| **DRY** | Cross-file logic duplication | Copy-paste drift, divergent fixes |
| **KISS** | Any new feature/abstraction | Over-engineering, premature framework |
| **YAGNI** | Speculative additions | Dead code, unused config surface |
| **Clean Code** | Naming, sizing, error handling | Ambiguous identifiers, megafiles, swallowed errors |

## SOLID

### Single Responsibility Principle (SRP)

**Definition**: A module/function/class has one reason to change. If two unrelated concerns share a file, splitting them makes both easier to evolve.

**When it applies**: every new file. If you can write a sentence describing what the file does that contains "and" (e.g., "checks plugin state AND emits forcing instruction AND records pattern"), consider splitting.

**Toolkit example**:
- `plugin-loaded-check.js` does ONE thing: emit `[PLUGIN-NOT-LOADED]` if marketplace registered + plugin disabled.
- `session-self-improve-prompt.js` does ONE thing: inject pending self-improve queue.
- These COULD be combined into a single "session-start state-checks" hook, but the SRP win — easier to test, easier to disable independently, easier to reason about — outweighs the KISS argument for combining.

**Violation example**: a hook script that both reads settings.json AND validates marketplace AND writes a marker file AND emits a forcing instruction has 4 responsibilities. Split.

### Open/Closed Principle (OCP)

**Definition**: Modules should be open for extension but closed for modification. Adding new behavior should not require editing existing code.

**When it applies**: when a new validator, contract, persona, or pattern is being added.

**Toolkit example**:
- `contracts-validate.js` has 4 named validators today. Adding `contract-plugin-hook-deployment` is OCP-clean: a new function added alongside, registered in the dispatcher map, no existing code modified.
- New HETS persona contracts are added as `swarm/personas-contracts/<NN>-<persona>.contract.json` without touching existing personas.
- New forcing instructions (`[FAILURE-REPEATED]`, `[PLUGIN-NOT-LOADED]`, etc.) are added as new hooks; the existing 8 instruction emitters are not modified.

**Violation example**: a switch-statement that requires a new `case` for every new pattern type. Refactor to a registration/dispatch model.

### Liskov Substitution Principle (LSP)

**Definition**: Subtypes must honor the contracts of their supertypes. A function that accepts a base type must work correctly with any subtype.

**When it applies**: less common in untyped JS, but holds for duck-typed interfaces.

**Toolkit example**:
- Every PreToolUse hook script must emit valid JSON-on-stdout (decision: approve/block + optional reason). New PreToolUse hooks are LSP-substitutable for existing ones — Claude Code consumes them identically.
- Every persona contract has the same JSON shape (`agentId`, `persona`, `role`, `skills`, `kb_scope`, `budget`, `functional`, `antiPattern`, `fallbackAcceptable`). A new persona contract is LSP-substitutable in HETS spawning workflows.

**Violation example**: a new validator that returns `decision: "warn"` (not in the documented enum). Breaks the contract; downstream consumers may misinterpret.

### Interface Segregation Principle (ISP)

**Definition**: Callers should not depend on interfaces they don't use. Prefer narrow named exports over fat objects.

**When it applies**: when designing shared utility modules in `_lib/`.

**Toolkit example**:
- `hooks/scripts/_lib/settings-reader.js` exports `readSettings()`, `isPluginEnabled()`, `getRegisteredMarketplaces()` as separate functions. A consumer that only needs `isPluginEnabled()` doesn't pull in the full `readSettings()` parser logic.
- `_lib/lock.js` exports just `withLock()` — not `lockFile`, `unlockFile`, `checkLockState`. The single function encapsulates the full RMW protection.

**Violation example**: a `SettingsManager` class with 20 methods where most callers use 2. Refactor to small focused exports.

### Dependency Inversion Principle (DIP)

**Definition**: High-level modules depend on abstractions, not concretions. Both depend on abstractions.

**When it applies**: every time a hook or substrate script reaches for `fs` / `path` / process state directly.

**Toolkit example**:
- Hook scripts depend on `_log.js` (abstraction over file logging), `findToolkitRoot()` (abstraction over path resolution), `_lib/settings-reader.js` (abstraction over settings.json access). They don't reach for `fs.readFileSync('/Users/.../.claude/...')` directly.
- This makes hooks portable: the abstraction layer handles plugin-vs-legacy install path resolution, env-var overrides, fallback chains.

**Violation example**: a new validator that hardcodes `/Users/USER/.claude/settings.json`. Breaks under different home dirs, plugin installs, CI environments.

## DRY — Don't Repeat Yourself

**Definition**: Extract shared logic when repetition is real, not speculative. Three or more substantively-similar implementations is the heuristic threshold.

**When it applies**: when a new hook or validator finds itself implementing the same primitive a second or third time.

**Toolkit example**: H.3.2 extracted `withLock()` to `_lib/lock.js` after 3 RMW scripts (budget-tracker, kb-resolver, tree-tracker) had inline lock implementations. H.5.5 extracted `runState.js`. H.7.14 extracted `findToolkitRoot()` after 5 substrate scripts had inline path-resolution logic.

**Violation example**: copy-pasting the secret-scanning regex set across multiple validators instead of importing from a shared module. When one needs updating, all need updating. Drift inevitable.

**When NOT to apply** (per `fundamentals.md`): if you've only seen a pattern twice, wait. Speculative DRY (extracting to abstract a single use case "in case it's reused") is over-engineering. Three is the threshold.

## KISS — Keep It Simple, Stupid

**Definition**: Prefer the simplest solution that works. Optimize for clarity over cleverness.

**When it applies**: every new feature, every new abstraction, every new hook.

**Toolkit example**:
- `migrate-to-plugin.sh` is 30 lines. It could be a Node script with argument parsing, dry-run mode, JSON-schema validation, multiple-file backup. KISS says: just do the one thing the user needs.
- The forcing-instruction family stays as plain stdout text emission. Could be a structured event protocol with subscribers; KISS says no, plain text is enough.

**Violation example**: a 5-step orchestration framework for what should be a single function call. If the abstraction has more configuration options than callers, it's over-engineered.

**Trade-off honestly**: KISS sometimes conflicts with SOLID's SRP (combining responsibilities into one file is simpler but violates SRP). When they conflict, lean SRP for code that's tested and SOLID-audited; lean KISS for one-off scripts and quick fixes.

## YAGNI — You Ain't Gonna Need It

**Definition**: Do not build features or abstractions before they are needed. Speculative generality is over-engineering.

**When it applies**: when the design includes "this might be useful for future X" without concrete present need.

**Toolkit example**: H.7.22's plan deferred the Distribution chaos-test orchestrator to H.7.23. Reason: the deployment-coverage contract (Phase 4) catches the failure class without needing the orchestrator scaffolding. Build the orchestrator only if recurrence happens.

**Violation example**: adding a `pluginConfig.advancedOptions` field to the manifest because "users might want it later." If nobody uses it, it's a maintenance burden + attack surface for zero benefit.

## Clean Code (per `fundamentals.md`)

| Concern | Rule | Why |
|---------|------|-----|
| Function size | < 50 lines | Comprehensible in one screen scroll |
| File size | < 800 lines (200-400 typical) | Forces good module decomposition |
| Nesting depth | ≤ 4 levels (use early returns) | Cognitive load grows quadratically |
| Naming | Descriptive, no abbreviations | Code is read 10x more than written |
| Booleans | `is`, `has`, `should`, `can` prefixes | Reads as natural-language predicates |
| Error handling | Explicit at every level; never silent | Silent failures are the worst kind |
| Immutability | Spread/map/filter, no mutation | Prevents hidden side effects |

## How these principles relate

- **SOLID** is the structural layer (what shape should the code have?).
- **DRY/KISS/YAGNI** are the rate-of-change layer (when do you commit to a structure?).
- **Clean Code** is the readability layer (does the structure communicate intent?).

A design that satisfies all four is more likely to be maintainable, testable, and evolvable. A design that violates one is suspicious; one that violates several should be redesigned.

## When to invoke this principle set

- **Always** when producing architect-tier design output (`agents/architect.md` requires `Principle Audit` in ADR template).
- **Always** when shipping a phase that's been routed via `route-decide` (validate-plan-schema.js requires `## Principle Audit` section).
- **Often** for non-trivial code changes (≥ 200 LoC, ≥ 3 files): mention which principles guided the decisions, even informally.
- **Rarely** for trivial fixes (typos, single-line corrections): principle audit overkill for one-character changes.

## Failure modes if violated

- **No principle audit in design**: design proposes complexity without justifying it. Reviewers can't tell if the complexity is necessary or accidental.
- **Principle audit as checkmarks**: claims compliance without showing how. Equivalent to no audit. The audit must identify real violations the design corrects, not rationalize existing decisions.
- **Principle conflict not surfaced**: KISS vs SRP conflicts are common. Designs that pretend the conflict doesn't exist are dishonest. Surface the trade-off; pick one; explain why.

## Related Patterns

- [Validator Conventions](validator-conventions.md) — Conventions A-E codify validator design; principle adherence is the meta-rule above them.
- [Structural Code Review](structural-code-review.md) — third leg of triple-contract verification; checks for principle violations as part of antiPattern detection.
- [Route Decision](route-decision.md) — tasks routed via `route` recommendation MUST include Principle Audit (validated by plan-schema).

## Phase

Codified: H.7.22 (closes drift-notes 13/14/15 — fundamentals missing SOLID, architect agent missing principle audit, HETS persona contract missing principle check). Architect agent + 04-architect HETS persona reference this doc; plan-schema validator enforces it.
