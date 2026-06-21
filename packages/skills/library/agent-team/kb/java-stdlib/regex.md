---
kb_id: java-stdlib/regex
version: 1
tags:
  - java-stdlib
  - regex
  - text
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-regex{,-2}"
  - "Oracle — java.util.regex Pattern / Matcher Javadoc"
related:
  - java-stdlib/strings
  - java-stdlib/string-algorithms
  - java-stdlib/stream-api
status: active
---

## Summary

**Concept**: `java.util.regex` — pattern syntax, flags, and `Matcher` mechanics, plus the compile-once performance discipline and the catastrophic-backtracking caution.
**Key APIs**: `Pattern.compile`/`Pattern.quote`; `Matcher.find()`/`matches()`/`lookingAt()`/`group(n)`/`replaceAll`/`reset`; `asPredicate`/`splitAsStream`; `Matcher.results()` (JDK 9).
**Gotcha**: `find()` scans/advances vs `matches()` requires whole-input; counting via `find()` misses overlapping matches; `group(1)` on a non-capturing group throws `IndexOutOfBoundsException`; per-call `Pattern.compile`/`String.matches` is a massive hidden cost.
**2026-currency**: `Matcher.results()` (JDK 9) Stream over `find()` loops; regex-DoS / catastrophic backtracking on user-supplied patterns is the standing security concern.
**Sources**: Baeldung `core-java-regex{,-2}`.

## Quick Reference

**Compile once, reuse (performance discipline):**

```java
private static final Pattern P = Pattern.compile("\\d+");   // compile ONCE
Matcher m = P.matcher(input);                                // cheap per-call
while (m.find()) { ... m.group(); ... }
// Pattern.compile per call / String.matches allocates millions of objects (JMH-proven)
```

**Matcher mechanics:**

| Method | Behavior |
|---|---|
| `find()` | scans, advances; finds the next match anywhere |
| `matches()` | requires the WHOLE input to match |
| `lookingAt()` | anchored at start, partial OK |
| `group(n)` / `start(n)` / `end(n)` | captured group n |
| `replaceFirst` / `replaceAll` / `reset` | substitution / rewind |
| `asPredicate` / `split` / `splitAsStream` | stream / predicate interop |

**Syntax essentials:** char classes (`[abc]`, `[^abc]`, union `[a[b]]`, intersection `[a&&[b]]`, subtraction `[a&&[^b]]`), predefined classes (`\d \D \s \S \w \W`), quantifiers (`? * + {n} {n,m}` + lazy `?`), capturing/backreference (`\1` matches captured *text*), non-capturing `(?:...)`, atomic `(?>...)` (disables backtracking), scoped inline flags `(?i:...)`, boundaries (`^ $ \b \B`), lookaround (`(?=) (?!) (?<=) (?<!)`).

**Flags:** `CANON_EQ`/`CASE_INSENSITIVE`/`COMMENTS`/`DOTALL`/`LITERAL`/`MULTILINE`/`UNICODE_CHARACTER_CLASS` + inline `(?i)(?x)(?s)(?m)`.

**Traps:**

- `find()` (scan) vs `matches()` (whole-input) confusion is the #1 regex bug.
- Counting via `find()` misses **overlapping** matches.
- `group(1)` on a non-capturing `(?:...)` group throws `IndexOutOfBoundsException`.
- Match literal metacharacters with `Pattern.quote(...)` / `\Q...\E`.
- Atomic `(?>...)` disabling backtracking can change whether a match succeeds.

**Current (mid-2026):** `Matcher.results()` (JDK 9) returns a `Stream<MatchResult>` — prefer over manual `find()` loops; user-supplied patterns remain a regex-DoS / catastrophic-backtracking risk.

## Full content

`java.util.regex` splits into the immutable, thread-safe `Pattern` (a compiled regex) and the stateful, single-thread `Matcher` (a matching engine over a specific input). The dominant performance discipline is to compile a `Pattern` **once** (e.g., a `static final` field) and reuse it with cheap per-call `matcher(...)`/`reset` — re-compiling per call (or using the convenience `String.matches`/`String.replaceAll`, which compile internally every time) allocates millions of objects in hot loops, as the corpus's JMH benchmarks demonstrate.

The most common semantic bug is confusing `find()` (which scans and advances, locating the next match anywhere in the input) with `matches()` (which requires the entire input to match) and `lookingAt()` (anchored at the start, partial match permitted). Counting matches with a `find()` loop misses overlapping occurrences. Group access (`group(n)`/`start(n)`/`end(n)`) on a non-capturing `(?:...)` group throws `IndexOutOfBoundsException`. Literal metacharacters are matched with `Pattern.quote(...)` or `\Q...\E`.

The syntax surface is broad: character classes with union/intersection/subtraction (`[a&&[b]]`, `[a&&[^b]]`), predefined classes, greedy/lazy quantifiers, capturing groups with backreferences (where `\1` matches the captured *text*, not the pattern), non-capturing and atomic groups (the latter disabling backtracking, which can change match success), scoped inline flags (`(?i:...)`), boundaries, and the four lookaround forms. Applications include validating phone/date strings, counting non-overlapping matches, extracting numbers (int/decimal/scientific/hex), token replacement (a `StringBuilder` + `Function<Matcher,String>`), and camelCase-to-words.

### 2026 currency

- **`Matcher.results()` (JDK 9)** returns a `Stream<MatchResult>`, replacing the manual `find()` loop — the corpus references it but keeps it commented out at the Java-8 baseline. Pairs with `splitAsStream`/`asPredicate`. [Oracle — java.util.regex Matcher Javadoc]
- **Catastrophic backtracking / regex DoS** on attacker-controlled patterns or inputs remains the live security concern for `java.util.regex`; no JDK-core CVE has invalidated the corpus's regex idioms. Validate or bound user-supplied patterns. [Oracle — java.util.regex Pattern Javadoc]
- The full `Pattern`/`Matcher` API and syntax carry forward unchanged from the Java-8 base; this area is current and durable.
