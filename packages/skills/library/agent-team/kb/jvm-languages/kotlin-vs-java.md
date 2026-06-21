---
kb_id: jvm-languages/kotlin-vs-java
version: 1
tags:
  - jvm-languages
  - kotlin
  - language-semantics
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: guest/core-kotlin"
  - "Kotlin 2.4.0 (JetBrains) (https://blog.jetbrains.com/kotlin/2026/06/kotlin-2-4-0-released/)"
  - "What's new in Kotlin 2.4 (https://kotlinlang.org/docs/whatsnew24.html)"
related:
  - jvm-languages/vavr-control-types
  - jvm-languages/clojure-ring-web
status: active
---

## Summary

**Concept**: Kotlin's language differentiators vs Java — null safety, data classes, extension functions, operator overloading, interface delegation, function types, smart casts.
**Key APIs**: nullable `String?` + `?.`/`!!`/`?:`/`as?`; `data class` (`copy(named-args)`); `operator fun` overloading; `class Car(e:Engine):Engine by e` delegation; `companion object`; `is` smart casts in `when`; exceptions as expressions (`Nothing` type).
**Gotcha**: `!!` defeats null safety (throws NPE); `as?` returns null instead of throwing; smart cast only works on `val` / stable expressions (not `var`).
**2026-currency**: Kotlin 1.2 (corpus) → 2.4.0 (2026-06); post-K2 baseline; single `kotlin-stdlib` artifact; all corpus features remain current and idiomatic.
**Sources**: `guest/core-kotlin` module; Kotlin 2.4.0 release / What's new in Kotlin 2.4.

## Quick Reference

**Null safety**:

```kotlin
val s: String? = maybe()
s?.length            // safe call → null if s is null
s!!                  // not-null assert → throws NPE if null
s ?: "default"       // Elvis
x as? String         // safe cast → null on failure
list.filterNotNull(); s?.let { ... }
```

**Data classes** — auto-generate `toString`/`equals`/`hashCode`/`copy`:

```kotlin
data class User(val id: Int, var name: String)
val u2 = u.copy(name = "new")   // named-arg copy
```

**Extension functions & properties**; **operator overloading** (`operator fun inc / minus / invoke / compareTo`).

**Interface delegation** — `by`:

```kotlin
class Car(e: Engine) : Engine by e   // delegates Engine methods to e
```

**Properties**: `val`/`var`, custom `set(value) { field = ... }` with backing `field`; primary-constructor property declaration `constructor(val id: Int, var name: String)`; **companion object** (static analog).

**Function types**: lambdas, anonymous fns, bound/unbound refs (`String::plus`, `::String`), a class that IS a function (implement `(A,B)->R` + override `invoke`), lambdas with receiver `String.(...)->...`, currying.

**Smart casts**: `is` + `when(value) { is String -> ... }` — smart cast works ONLY on `val` / stable expressions, not `var`. Exceptions are expressions: `val x = try { } catch { }`, `throw` as expr, `Nothing` return type.

**Current (mid-2026)**: Kotlin 2.4.0 (2026-06); the single `kotlin-stdlib` artifact replaces the old `kotlin-stdlib-jdk7`/`-jdk8` split; supports Java 26. Every feature here is unchanged. Coroutines, Multiplatform (KMP), and Ktor — none in the corpus — are the modern mainstream Kotlin story.

## Full content

The corpus covers Kotlin through the lens of "Kotlin vs Java" — the differentiators, not the JVM-shared basics. Evidence: `guest/core-kotlin/src/test/kotlin/.../kotlinvsjava/*.kt` (11 files).

**Null safety** is the headline feature. Types are non-nullable by default; `String?` opts into nullability. The safe-call operator `?.` short-circuits to null; the not-null assertion `!!` throws NPE (and thereby *defeats* null safety — a deliberate escape hatch); the Elvis operator `?:` provides a default; the safe cast `as?` returns null on failure rather than throwing; `filterNotNull()` and `?.let{}` are common idioms.

**Data classes** (`data class`) auto-generate `toString`/`equals`/`hashCode` and a `copy(named-args)` that produces a modified clone — the immutability-friendly update idiom.

**Extension functions and properties** add members to existing types without inheritance. **Operator overloading** (`operator fun inc/minus/invoke/compareTo`) maps operators to functions. **Interface delegation** (`class Car(e: Engine) : Engine by e`) forwards an interface's methods to a held instance — composition without boilerplate. Evidence: `DelegationTest.kt`.

**Properties** support `val`/`var` plus custom accessors with a backing `field` (`set(value) { field = ... }`), primary-constructor property declaration (`constructor(val id: Int, var name: String)`), and the `companion object` static analog. Evidence: `PropertiesTest.kt`.

**Function types** are rich: lambdas, anonymous functions, bound and unbound references (`String::plus`, `::String`), a class that *is* a function (implement `(A,B)->R` and override `invoke`), lambdas with receiver (`String.(...)->...`), and currying. Evidence: `FunctionsTest.kt`.

**Smart casts** let `is` checks narrow a type automatically (`when(value) { is String -> value.length }`), but only on `val` or otherwise stable expressions — a `var` can change between the check and use, so the compiler refuses to smart-cast it. Exceptions are expressions in Kotlin: `val x = try {} catch {}`, `throw` is an expression, and the `Nothing` type marks code that never returns normally.

### 2026 currency

- **Kotlin 1.2 (corpus, 2018) → 2.4.0 (2026-06).** This is the post-K2 baseline. The single `kotlin-stdlib` artifact replaces the obsolete `kotlin-stdlib-jdk7`/`-jdk8` split. Kotlin 2.4 supports Java 26. All corpus features (data classes, delegation, operators, smart casts, extension functions, function types) remain current and idiomatic. [Kotlin 2.4.0 (JetBrains)](https://blog.jetbrains.com/kotlin/2026/06/kotlin-2-4-0-released/) · [What's new in Kotlin 2.4](https://kotlinlang.org/docs/whatsnew24.html)
- **The corpus is K1/1.2-era; the modern Kotlin story is much broader.** Coroutines, Kotlin Multiplatform (KMP), and Ktor — none present in the corpus — are now mainstream; 2.4 adds context parameters and stabilizes more stdlib. [Kotlin 2.4.0 (JetBrains)](https://blog.jetbrains.com/kotlin/2026/06/kotlin-2-4-0-released/)
- **Kotlin `when` is a peer to the JDK's own pattern matching** for `switch` (Java 21) — the JVM-wide convergence on pattern matching means `when` smart casts, JDK `switch` patterns, and Vavr's `Match`/`Case` now occupy the same conceptual space. [What's new in Java 25 (LTS)](https://keyholesoftware.com/java-25-whats-new/)
