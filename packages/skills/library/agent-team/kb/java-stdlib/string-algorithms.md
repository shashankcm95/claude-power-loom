---
kb_id: java-stdlib/string-algorithms
version: 1
tags:
  - java-stdlib
  - strings
  - algorithms
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-string-algorithms{,-2,-3}"
  - "JEP 254: Compact Strings (https://openjdk.org/jeps/254)"
related:
  - java-stdlib/strings
  - java-stdlib/regex
  - java-stdlib/math-and-numerics
status: active
---

## Summary

**Concept**: Classic string-processing algorithms — palindrome, anagram, character/word counting, search, dedup, reverse — and the code-unit-vs-code-point hazard that breaks most naive implementations.
**Key APIs**: `String.chars()` (code units) vs `String.codePoints()` (code points); `int[256]`/`int[Character.MAX_VALUE]` frequency tables; Guava `Multiset`; Aho-Corasick / lookahead regex for multi-keyword.
**Gotcha**: char-based algorithms operate on UTF-16 code units, so they break on supplementary/emoji code points — use `codePoints()`; `int[256]` frequency tables are Latin-1-only.
**2026-currency**: Compact Strings (JDK 9) make the code-unit/code-point distinction load-bearing; `String.strip`/`lines`/`repeat` (JDK 11) simplify pre/post-processing.
**Sources**: Baeldung `core-java-string-algorithms*`.

## Quick Reference

**The central hazard — code units vs code points:**

```java
str.chars()        // IntStream of UTF-16 CODE UNITS — breaks on emoji/supplementary
str.codePoints()   // IntStream of Unicode CODE POINTS — correct for the full BMP+supplementary
```

A surrogate-pair emoji is two code units but one code point; palindrome/anagram/count algorithms over `chars()` silently mis-handle them.

**Common algorithms (each shown ×many in the corpus):**

| Task | Idiomatic approach | Trap |
|---|---|---|
| Palindrome | two-pointer / reverse-and-compare | reverse over code units breaks emoji |
| Anagram | sort chars, or `int[256]` frequency, or Guava `Multiset` | `int[256]` is Latin-1-only |
| Count occurrences | `chars().filter(...).count()` / `codePoints()` | code-unit counting |
| Find word/string | `indexOf` loop / regex word boundary | overlapping matches missed by `indexOf` step |
| Multi-keyword search | Aho-Corasick / lookahead regex `(?=.*a)(?=.*b)` | naive nested loops O(n·m) |
| Repeated substring | `(s+s).indexOf(s, 1)` trick | |
| Reverse | `StringBuilder.reverse()` | reverses code units, mangles surrogate pairs |
| Remove dups / stopwords / emojis | `LinkedHashSet` / regex / emoji lib | emoji-java Unicode tables lag |

**Other catalogued tasks:** pangram check, word count, string diff, secure random password (Passay / `SecureRandom`), localization (`ResourceBundle` + `MessageFormat`, ICU4J for plural/gender).

**Padding trap:** `String.format("%5s", s).replace(' ', '0')` (a common left-pad idiom) corrupts inputs that already contain spaces.

**Current (mid-2026):** Compact Strings (JDK 9) make code-unit vs code-point handling load-bearing; `String.strip`/`lines`/`repeat`/`isBlank` (JDK 11) clean up pre/post-processing; ICU4J 77.1.0 (Unicode 16) for correct localization-grade text handling.

## Full content

The corpus presents nearly every classic string task with five to ten alternative implementations each (palindrome ×7, count-chars ×8, leading/trailing-zeros ×10). The single load-bearing lesson across all of them is the distinction between UTF-16 **code units** and Unicode **code points**. Java's `String` is a sequence of `char` (16-bit code units), so a supplementary character (any emoji or CJK extension beyond the BMP) is stored as a two-`char` surrogate pair. Algorithms that iterate `char`s — `String.chars()`, `StringBuilder.reverse()`, indexed `charAt` loops, `int[256]`/`int[65536]` frequency tables — silently corrupt such input. The correct approach uses `String.codePoints()` (an `IntStream` of full code points). The classic `int[256]` anagram frequency table is additionally Latin-1-only.

Concretely: palindrome detection (two-pointer or reverse-and-compare), anagram detection (sort the characters, count into a frequency array, or use Guava `Multiset` — all UTF-16-code-unit-bounded unless adapted), occurrence counting (`chars()`/`codePoints()` filter-and-count), substring/word search (note that an `indexOf` advance-by-length loop misses overlapping matches), and multi-keyword containment (Aho-Corasick automaton or a lookahead-regex conjunction `(?=.*a)(?=.*b)`). The "is one string a rotation of another" check uses the `(s+s).indexOf(s, 1)` trick. Padding via `String.format(...).replace(' ', '0')` corrupts inputs containing spaces — a frequent bug.

Localization-grade work uses `ResourceBundle` + `MessageFormat` for templated messages and ICU4J for plural/gender/grammatical-number rules. Secure random passwords use Passay or `SecureRandom` directly rather than non-crypto randomness.

### 2026 currency

- **Compact Strings (JEP 254, JDK 9)** back `String` with a `byte[]` + a coder flag, which is exactly why the code-unit-vs-code-point distinction (and Latin-1-only frequency tables) still matter on modern JDKs. [JEP 254: Compact Strings](https://openjdk.org/jeps/254)
- **`String.strip()`/`lines()`/`repeat()`/`isBlank()` (JDK 11)** are Unicode-aware helpers that simplify the pre/post-processing these algorithms wrap; `String.strip` over `trim`. [Oracle — String (Java SE 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/String.html)
- **ICU4J `com.ibm.icu` is 77.1.0 (Unicode 16-era)** — the live, maintained choice for correct localization, title-casing, and grapheme handling. [Eclipse — ICU4J 77.1.0 build info](https://download.eclipse.org/staging/2025-06/buildInfo/archive/download.eclipse.org/staging/2025-06/index/com.ibm.icu_77.1.0.html)
- **Dead/stale libs** — `emoji-java` (`com.vdurmont`, Unicode tables lag), `ahocorasick`, and the `org.bitbucket.cowwoc` diff-match-patch fork are niche/low-activity; prefer JDK + ICU4J where possible.
- **Apache Commons Text ≥ 1.10.0** required for `WordUtils` title-casing (Text4Shell CVE-2022-42889; current 1.15.0 safe). [Apache Security — CVE-2022-42889](https://security.apache.org/blog/cve-2022-42889/)
- The algorithms themselves carry forward unchanged.
