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

## ASCII-only in source edits

Emit **plain ASCII** in code edits unless a non-ASCII codepoint is genuinely required by the data. The lint gate (`eslint no-irregular-whitespace`) treats stray non-ASCII as an error, and CI fails on it. Recurring offenders:

- **Smart quotes** `“ ” ‘ ’` pasted in place of `" '` — common when copying prose into a string literal or comment.
- **A leading BOM** (`U+FEFF`) at file start or — worse — embedded mid-line inside a regex/string literal (invisible in most editors; trips `no-irregular-whitespace`).
- **Unicode whitespace** — non-breaking space `U+00A0`, narrow/zero-width spaces — where a normal space ` ` was intended.
- **Unicode dashes/ellipsis** `— … ‐` inside identifiers or code (fine in prose; never in a token).

If a non-ASCII character is intentional in a string, prefer the escaped form (`\u00A0`, `\u2014`) so the intent is explicit and the linter stays quiet. This is distinct from the markdown-emphasis discipline (that one is about `_underscores_`); this one is about non-ASCII codepoints leaking into source.

**Origin**: recurred 3× (latest: a literal BOM inside a regex tripped `no-irregular-whitespace`). Promoted from memory via `/self-improve` 2026-06-07. (Kept always-on rather than predicate-gated: applies to nearly every code edit, and the core-rules predicate-block count is at the T76 ceiling of 14.)

## Symbol resolution — navigate by binding, not grep-and-guess

When locating *where* to change a symbol, `grep` returns **text matches** — every same-named binding across the tree, plus hits in comments and strings. Picking "which one" by reading around each hit is the error-prone step; a wrong pick edits the wrong binding. Resolve by **binding**, not by text:

- **`grep` / `workspaceSymbol` LOCATES; the `LSP` tool RESOLVES.** Use a text or symbol search to find a candidate position, then `goToDefinition` / `findReferences` on it to get the exact binding — scope-aware, shadow-aware, and following imports **across files**. The cross-file case (the same name defined in several modules) is the one a text search cannot disambiguate and the one most likely to mis-edit.
- **Confirm before editing a non-unique symbol.** If a name has more than one definition, run `findReferences` (or `goToDefinition`) to confirm the binding you intend to change *before* the `Edit`.
- **For "who calls this", use `incomingCalls` / `outgoingCalls`** rather than a text search over the call-site spelling.
- The `LSP` tool needs a language server configured for the file type (live for the JS substrate here). When none is available it errors — fall back to `grep` plus reading enough surrounding context to be sure of the binding.

**Origin**: recurring grep-and-guess mis-targeting; `grep` is a *locator*, never a *binding resolver*. Kept always-on (not predicate-gated) for the same reason as the ASCII rule above — it applies to nearly every code edit, and the core-rules predicate-block count is at the T76 ceiling of 14.

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
