---
kb_id: java-lang/language-evolution-8-to-25
version: 1
tags:
  - java-lang
  - versions
  - language-evolution
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module family: core-java-9 / -10 / -11 / -12 / -13 / -14 / -15"
  - "endoflife.date/oracle-jdk: https://endoflife.date/oracle-jdk"
  - "Happycoders: Java 25 features: https://www.happycoders.eu/java/java-25-features/"
related:
  - java-lang/functional-interfaces-lambdas
  - java-lang/module-system-jpms
status: active
---

## Summary

**Concept**: The per-JDK language-feature tour — Java 8→16 in the base, extended through the current 17→21→25 LTS chain with the preview-era features now finalized.
**Key APIs**: `var` (10), `List.of`/`copyOf` (9/10), `String.repeat`/`strip`/`isBlank` (11), `HttpClient` (11), switch expressions (14), records (16), sealed types (17), record patterns + pattern-matching `switch` + virtual threads (21), FFM `java.lang.foreign` + unnamed `_` (22), scoped values + instance `main` (25).
**Gotcha**: all Java 12-15 `--enable-preview` / `@SuppressWarnings("preview")` flags are obsolete; the Java-12 `break <value>` switch syntax is gone (replaced by `yield`). String Templates were **WITHDRAWN** (no `STR."..."`).
**2026-currency**: current LTS chain is 17 (support ends Sep 2026) → 21 → 25 (current). Java 26 is the latest non-LTS (GA Mar 17 2026).
**Sources**: `core-java-9`..`core-java-15` modules; endoflife.date.

## Quick Reference

**Base coverage (Java 8→16)**:
- **8**: lambdas, method refs, streams, `Optional`, default/static interface methods, `java.time`
- **9**: JPMS, private interface methods, `List.of`/`Set.of`/`Map.of`, `Stream.takeWhile`/`dropWhile`/`ofNullable`, `StackWalker`, `VarHandle`, `Flow`, `Optional.stream`
- **10**: `var`, `List/Set.copyOf`, `Collectors.toUnmodifiable*`, `Optional.orElseThrow()`
- **11**: `String.repeat`/`strip`/`isBlank`/`lines`, `java.net.http.HttpClient`, `Predicate.not`, `var` in lambda params, single-file source launch
- **12**: `Collectors.teeing`, `Files.mismatch`, switch expressions (preview)
- **13**: switch `yield` (preview), text blocks (preview), `String.formatted`
- **14**: records (preview), pattern matching `instanceof` (preview), helpful NPEs
- **15**: sealed classes (preview), text blocks final
- **16**: records final, pattern matching `instanceof` final

**Finalized since the base (the deltas to apply)**:
- records — **final 16** (JEP 395); record patterns — **final 21** (JEP 440)
- pattern matching `instanceof` — **final 16**; switch expressions — **final 14**; text blocks — **final 15**
- sealed types — **final 17** (JEP 409)
- pattern matching for `switch` — **final 21** (JEP 441)
- virtual threads — **final 21** (JEP 444); sequenced collections — **final 21** (JEP 431)
- unnamed variables `_` — **final 22** (JEP 456); FFM `java.lang.foreign` — **final 22** (JEP 454)
- markdown javadoc `///` — **final 23** (JEP 467)
- scoped values — **final 25** (JEP 506); module import `import module M;` — **final 25** (JEP 511); compact source files + instance `main()` — **final 25** (JEP 512); flexible constructor bodies — **final 25** (JEP 513)

**Do NOT seed as current**: String Templates (WITHDRAWN, JDK 23 — no `STR."..."`); still-preview in JDK 25 = primitive patterns (JEP 507), structured concurrency (JEP 505), stable values (JEP 502).

**Current (mid-2026)**: LTS chain 17 → 21 → 25 (current). Applet API removed in JDK 26 (JEP 504). `strictfp` is a no-op since JDK 17 (JEP 306).

## Full content

The 2021 base teaches Java version-by-version with a dedicated module per release, treating "modern = Java 16." Each release added a coherent batch: **Java 8** delivered the functional core (lambdas, method references, streams, `Optional`, default/static interface methods, `java.time`); **Java 9** the module system plus collection factories (`List.of`/`Set.of`/`Map.of` — immutable, null-rejecting, dup-rejecting), stream additions (`takeWhile`/`dropWhile`/`ofNullable`), `StackWalker`, `VarHandle`, `Flow` reactive streams, and `Optional.stream`; **Java 10** `var` local-variable type inference, `copyOf`, `Collectors.toUnmodifiable*`, and the no-arg `Optional.orElseThrow()`; **Java 11** the `String` additions (`repeat`/`strip`/`isBlank`/`lines`), the standardized `java.net.http.HttpClient`, `Predicate.not`, and `var` in lambda parameters. **Java 12-15** then previewed the language features that define modern Java — switch expressions, text blocks, records, pattern matching for `instanceof`, sealed types — under `--enable-preview`, with **Java 16** finalizing records and `instanceof` pattern matching.

The single most important framing update is that **every Java 12-15 preview flag is now obsolete**, and the previewed features are finalized. Records are final since JDK 16 (JEP 395) and record patterns since 21 (JEP 440); switch expressions final since 14; text blocks final since 15; sealed types final since 17 (JEP 409); pattern matching for `switch` final since 21 (JEP 441). The Java-12 `break <value>` switch syntax no longer compiles — it was replaced by `yield`. The modern idioms that follow: use a `record` (not POJO/`Pair`/`Tuple2`) for value types and multiple returns; use sealed types + pattern matching (not marker interfaces + `instanceof` chains) for closed hierarchies; use records + `Set.of`/`List.of` for immutability.

### 2026 currency

Three LTS generations shipped after the base; the relevant chain is **17 → 21 → 25** ([endoflife.date/oracle-jdk](https://endoflife.date/oracle-jdk)).

Net-new features a current core-Java engineer must know (all final unless marked):

- **Virtual threads — final JDK 21 ([JEP 444](https://docs.oracle.com/en/java/javase/24/migrate/significant-changes-jdk-21.html)).** `Thread.ofVirtual()` / `Executors.newVirtualThreadPerTaskExecutor()`.
- **Sequenced collections — final JDK 21 (JEP 431).** `SequencedCollection`/`SequencedSet`/`SequencedMap` with uniform first/last/`reversed()`.
- **Unnamed variables & patterns — final JDK 22 ([JEP 456](https://openjdk.org/jeps/456)).** `_` for unused catch vars, lambda params, record-pattern components.
- **FFM `java.lang.foreign` — final JDK 22 ([JEP 454](https://www.happycoders.eu/java/foreign-function-memory-api/)).** `Arena`, `MemorySegment`, `Linker`, `ValueLayout.*` — the modern path over JNI and `Unsafe` off-heap.
- **Markdown javadoc `///` — final JDK 23 ([JEP 467](https://www.infoq.com/news/2024/09/java23-released/)).**
- **Scoped values — final JDK 25 ([JEP 506](https://openjdk.org/jeps/506)).** Immutable per-call-chain sharing; lighter than `ThreadLocal` with millions of virtual threads.
- **Module import declarations — final JDK 25 ([JEP 511](https://www.happycoders.eu/java/java-25-features/)).** `import module M;`.
- **Compact source files & instance main methods — final JDK 25 ([JEP 512](https://www.happycoders.eu/java/java-25-features/)).** A top-level `void main()` with no enclosing class.
- **Flexible constructor bodies — final JDK 25 ([JEP 513](https://www.jrebel.com/blog/java-25)).** Statements may run before `super(...)`/`this(...)`, relaxing the base's "must be first statement" rule.
- **Compact object headers — final JDK 25 (JEP 519).** 8-byte object headers.

**Do NOT seed as current.** **String Templates were WITHDRAWN** — previewed in JDK 21 (JEP 430) and 22 (JEP 459), then withdrawn in JDK 23; **no `STR."..."` syntax exists** ([javaalmanac](https://javaalmanac.io/features/stringtemplates/)). Still preview as of JDK 25 (not final): primitive types in patterns (JEP 507, 3rd preview), structured concurrency (JEP 505, 5th preview), stable values (JEP 502, preview), PEM encodings (JEP 470, preview).

**Removed / inert.** `strictfp` is a no-op since JDK 17 (JEP 306, always-strict FP). The **Applet API was removed in JDK 26** ([JEP 504](https://openjdk.org/jeps/504)) — the entire `java.applet` package plus `javax.swing.JApplet`.

**Versions & support (mid-2026)**: Java 17 LTS (premier support ends Sep 2026), Java 21 LTS (Sep 2028), **Java 25 LTS — current** (Sep 2030); Java 26 is the latest non-LTS (GA Mar 17 2026) ([Oracle Releases Java 25, Sep 16 2025](https://www.oracle.com/news/announcement/oracle-releases-java-25-2025-09-16/)).
