# Coding Fundamentals

## Immutability (CRITICAL)

ALWAYS create new objects. NEVER mutate existing ones. Immutable data prevents hidden side effects and enables safe concurrency.

## Core Principles

- **KISS**: Prefer the simplest solution that works. Optimize for clarity over cleverness.
- **DRY**: Extract shared logic when repetition is real, not speculative.
- **YAGNI**: Do not build features or abstractions before they are needed.

## SOLID (object-oriented + functional decomposition)

- **Single Responsibility**: Each module/function has one reason to change. If a hook script does two unrelated things, split it.
- **Open/Closed**: Extend behavior by adding new code, not modifying existing code. New validators, new contracts, new patterns are added alongside — not by editing the existing.
- **Liskov Substitution**: Subtypes must honor the contracts of their supertypes. Less applicable in untyped JS but holds for duck-typed interfaces (e.g., a forcing-instruction emitter must always emit valid JSON-on-stdout).
- **Interface Segregation**: Don't force callers to depend on what they don't use. Prefer narrow named exports (`readSettings`, `isPluginEnabled`) over a single fat object.
- **Dependency Inversion**: Depend on abstractions, not concretions. Hook scripts depend on `_log.js`, `findToolkitRoot()`, `_lib/settings-reader.js` — not on raw `fs`/`path` everywhere.

When in doubt, see `skills/agent-team/patterns/system-design-principles.md` for the canonical reference with worked examples + violation patterns + cross-references to anti-patterns.

## File Organization

Many small files over few large files:
- 200–400 lines typical, 800 max
- Organize by feature/domain, not by type
- High cohesion, low coupling

## Error Handling

- Handle errors explicitly at every level
- User-friendly messages in UI code, detailed logging server-side
- Never silently swallow errors or use empty catch blocks

## Input Validation

- Validate at system boundaries (user input, API responses, file content)
- Use schema-based validation (Zod, Joi, etc.)
- Fail fast with clear messages
- Never trust external data

## Naming

- Variables/functions: `camelCase`
- Booleans: `is`, `has`, `should`, `can` prefixes
- Types/components: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

<important if "task involves editing or generating source code">

## ASCII-only in source edits

Emit **plain ASCII** in code edits unless a non-ASCII codepoint is genuinely required by the data. The lint gate (`eslint no-irregular-whitespace`) treats stray non-ASCII as an error, and CI fails on it. Recurring offenders:

- **Smart quotes** `“ ” ‘ ’` pasted in place of `" '` — common when copying prose into a string literal or comment.
- **A leading BOM** (`U+FEFF`) at file start or — worse — embedded mid-line inside a regex/string literal (invisible in most editors; trips `no-irregular-whitespace`).
- **Unicode whitespace** — non-breaking space `U+00A0`, narrow/zero-width spaces — where a normal space ` ` was intended.
- **Unicode dashes/ellipsis** `— … ‐` inside identifiers or code (fine in prose; never in a token).

If a non-ASCII character is intentional in a string, prefer the escaped form (`\u00A0`, `\u2014`) so the intent is explicit and the linter stays quiet. This is distinct from the markdown-emphasis discipline (that one is about `_underscores_`); this one is about non-ASCII codepoints leaking into source.

**Origin**: recurred 3× (latest: a literal BOM inside a regex tripped `no-irregular-whitespace`). Promoted from memory via `/self-improve` 2026-06-07.

</important>

<important if "task involves multi-file changes (≥2 distinct files) or task is at completion">

## Pre-Completion Checklist

- [ ] Code is readable and well-named
- [ ] Functions < 50 lines
- [ ] Files < 800 lines
- [ ] No nesting > 4 levels (use early returns)
- [ ] No hardcoded values (use constants/config)
- [ ] No mutation (spread/map/filter instead)
- [ ] Proper error handling at every level

</important>
