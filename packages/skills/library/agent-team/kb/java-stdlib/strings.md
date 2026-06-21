---
kb_id: java-stdlib/strings
version: 1
tags:
  - java-stdlib
  - strings
  - text
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-strings, core-java-string-{apis,operations,operations-2,operations-3,conversions,conversions-2}"
  - "JEP 254: Compact Strings (https://openjdk.org/jeps/254)"
related:
  - java-stdlib/string-algorithms
  - java-stdlib/regex
  - java-stdlib/collection-conversions
  - java-stdlib/math-and-numerics
  - java-stdlib/java-time
status: active
---

## Summary

**Concept**: The `String` type and core string operations — immutability/interning, building/joining, conversion, comparison, splitting, and casing.
**Key APIs**: `StringBuilder`/`StringBuffer`, `String.join`/`StringJoiner`/`Collectors.joining`; `==` vs `equals`/`compareTo`; `split` (regex); `intern()`; `Integer.parseInt`/`valueOf`.
**Gotcha**: `==` compares references (true for interned literals, false vs `new String`); `split(".")` is a regex (escape `\\.`); `toUpperCase`/`toLowerCase` break for Turkish 'i' under the default locale — always pass an explicit `Locale`.
**2026-currency**: `String.strip()`/`lines()`/`isBlank()`/`repeat()`/`formatted()` (JDK 11); text blocks `"""` (JDK 15); Compact Strings (JDK 9).
**Sources**: Baeldung `core-java-string*` + `core-java-strings` + JEP 254.

## Quick Reference

**Building / joining:**

```java
new StringBuilder().append(a).append(b).toString();   // mutable, fast (not thread-safe)
new StringBuffer()...                                  // synchronized, legacy
String.join(",", list);
new StringJoiner(",", "[", "]").add("a").add("b");     // prefix/suffix/setEmptyValue
list.stream().collect(Collectors.joining(",", "[", "]"));
```

`StringBuffer` is the synchronized (legacy) counterpart of `StringBuilder`.

**Comparison:**

- `==` — reference identity (true for interned literals, false vs `new String("x")`).
- `equals` / `equalsIgnoreCase` / `compareTo` / `Objects.equals` — value comparison; Apache `StringUtils.equals*` is null-safe.

**Splitting / casing traps:**

- `split(".")` is a **regex** — escape `\\.` for a literal dot.
- `\R` (Java 8) / `String.lines()` (Java 11) for robust newline splitting — not hand-rolled `\r?\n|\r`.
- `toUpperCase`/`toLowerCase` break for the **Turkish 'i'** under default locale: `"i".toUpperCase(tr)` ≠ `"I"`. Always pass an explicit `Locale`.
- `contains`/`indexOf` are case-sensitive — `toLowerCase` first, or `StringUtils.containsIgnoreCase`, or `regionMatches(true,...)`.

**Conversion:** String ↔ int/long/double/BigDecimal/BigInteger (`Integer.parseInt`/`decode`, radix, `Integer` cache −128..127); String ↔ char[]/byte[] (charsets, `CharsetEncoder`/`Decoder` + `CodingErrorAction`, BOM, U+FFFD replacement); String ↔ enum (`valueOf`, case-sensitive); char → String; File/image → Base64; CSV → List.

**`String` internals:** immutable + interned (literals share one pooled instance; `new String` is off-pool; `.intern()` pools manually). Prefer `char[]` over `String` for passwords (wipeable via `Arrays.fill`; `String` lingers in the pool). The "constant string too long" limit is 65535 bytes in the class file. `CharSequence` is the read-only super-interface.

**Current (mid-2026):** `String.strip`/`stripLeading`/`stripTrailing`/`isBlank`/`lines`/`repeat`/`formatted` (JDK 11, Unicode-aware); text blocks `"""` are standard (JDK 15); Compact Strings (JDK 9) back `String` by `byte[]` + a coder flag.

## Full content

`String` is immutable and interned: string literals share a single instance in the string pool, `new String(...)` allocates an off-pool instance, and `.intern()` forces pooling. This is why `==` (reference comparison) is true for two equal literals but false against a `new String`, and why value comparison must use `equals`/`equalsIgnoreCase`/`compareTo` (or null-safe Apache `StringUtils.equals*`).

Mutable string building uses `StringBuilder` (fast, not thread-safe) or its synchronized legacy counterpart `StringBuffer`; joining uses `+`/`concat`, `String.join`, `StringJoiner` (with `add`/`merge`/`setEmptyValue`), or `Collectors.joining(delim, prefix, suffix)`.

The recurring operation traps: `split` takes a regex, so a literal dot must be escaped (`\\.`); newline splitting should use `\R` (Java 8) or `String.lines()` (Java 11) rather than a hand-rolled pattern; `contains`/`indexOf` are case-sensitive; and `toUpperCase`/`toLowerCase` are locale-sensitive — the Turkish dotless-i means the default-locale form silently corrupts text, so an explicit `Locale` is mandatory. Numeric conversion goes through `Integer.parseInt`/`valueOf`/`decode` (with radix support and the `Integer` cache for −128..127); charset conversion (`String` ↔ `byte[]`) uses `CharsetEncoder`/`CharsetDecoder` with a `CodingErrorAction` to control lossy replacement (U+FFFD) and BOM handling.

For sensitive data, `char[]` is preferred over `String` because it can be wiped with `Arrays.fill` whereas an interned `String` lingers; `char[].toString()` returns the object address, not the content. Compact Strings (JDK 9) back the `String` with a `byte[]` plus a coder flag (Latin-1 vs UTF-16), which is why character-indexed algorithms must distinguish code units from code points (see `java-stdlib/string-algorithms`).

### 2026 currency

- **`String.strip()`/`stripLeading()`/`stripTrailing()`/`isBlank()`/`lines()`/`repeat()` + `String.formatted()` (JDK 11)** are the Unicode-aware successors to `trim()` and the hand-rolled helpers. `String.strip` over `trim`; `Files.readString`/`writeString` (JDK 11) over `Files.readAllBytes` + `new String`. [Oracle — String (Java SE 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/String.html)
- **Text blocks (JEP 378, JDK 15)** — `"""` multi-line literals are plain standard syntax in 2026, no preview caveat. [JEP 378: Text Blocks](https://openjdk.org/jeps/378) · [Oracle — Text Blocks (JDK 26 docs)](https://docs.oracle.com/en/java/javase/26/language/text-blocks.html)
- **Compact Strings (JEP 254, JDK 9)** — `String` backed by `byte[]` + a coder flag; the reason `chars()` vs `codePoints()` and Latin-1-only anagram code still matter. [JEP 254: Compact Strings](https://openjdk.org/jeps/254)
- **Apache library migrations** — title-casing moved from the deprecated `org.apache.commons.lang3.text.WordUtils` to `org.apache.commons.text.WordUtils`; Commons Text must be **≥ 1.10.0** (Text4Shell, CVE-2022-42889 — current 1.15.0 is safe). [Apache Commons Text](https://commons.apache.org/proper/commons-text/) · [Apache Security — CVE-2022-42889](https://security.apache.org/blog/cve-2022-42889/)
- The `String` type semantics, pool/intern model, and `StringBuilder`/`StringJoiner` idioms carry forward unchanged.
