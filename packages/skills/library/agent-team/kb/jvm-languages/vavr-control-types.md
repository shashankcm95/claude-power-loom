---
kb_id: jvm-languages/vavr-control-types
version: 1
tags:
  - jvm-languages
  - vavr
  - functional
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: vavr"
  - "Baeldung tutorials (eugenp/tutorials) module: vavr-2"
  - "vavr-io/vavr releases (https://github.com/vavr-io/vavr/releases)"
related:
  - jvm-languages/vavr-persistent-collections
  - jvm-languages/vavr-functions-pattern-matching
  - jvm-languages/kotlin-vs-java
status: active
---

## Summary

**Concept**: Vavr's functional control/value types for total, exception-free error handling in Java — `Option`, `Try`, `Either`, `Validation`, `Lazy`.
**Key APIs**: `Option` (`Some`/`None`, `getOrElse`); `Try.of(...)` (`recover`/`getOrElseThrow(mapper)`/`map`); `Either<L,R>` (`Left`=error, right-biased, `.right()`/`.left()` projections); `Validation.combine(...).ap(Ctor::new)`; `Lazy` (memoized once).
**Gotcha**: `Validation` ACCUMULATES all errors (applicative); `Either`/`Try` SHORT-CIRCUIT on the first. `Either` is not implicitly the right value — you must project. `recover` is a pattern-match over the throwable, so it only recovers matching exception types.
**2026-currency**: Vavr 1.0.0 (first stable major) shipped 2026-02-09; 1.0.1 (2026-03-01) is current; Java-8-compatible; all idioms carry forward.
**Sources**: `vavr`, `vavr-2` modules; vavr-io/vavr releases.

## Quick Reference

**Option** — total replacement for nullable references:

```java
Option<String> o = Option.of(maybeNull);
o.getOrElse("default");   // Some/None
```

**Try** — computation that may throw, as a value:

```java
Try<Integer> t = Try.of(() -> Integer.parseInt(s));
t.isFailure();
t.getOrElse(0);
t.getOrElseThrow(ex -> new MyException(ex));
t.map(n -> n + 1).recover(NumberFormatException.class, 0)   // recover is a match over the throwable
 .onSuccess(...).onFailure(...).andThen(...).toOption();
```

**Either<L,R>** — typed disjoint union (`Left` = error, `Right` = success, right-biased):

```java
Either<String, Integer> e = compute();
e.right().getOrElseThrow(...);   // MUST project first — throws if it's actually a Left
e.left().getOrNull();
e.map(r -> r + 1);
```

Replaces anti-patterns like `Object[]` or `Map<String,Object>` multi-return.

**Validation** — applicative, ACCUMULATES all errors:

```java
Validation<Seq<String>, User> v =
    Validation.combine(validName, validEmail).ap(User::new);  // Valid / Invalid(Seq<String>)
```

Contrast: `Either`/`Try` short-circuit on the FIRST error. Choose deliberately.

**Lazy** — memoized, evaluates exactly once: `Lazy<Double> l = Lazy.of(Math::random)`.

**Current (mid-2026)**: `io.vavr:vavr:1.0.1` (2026-03-01) is current; `1.0.0` (the first stable major) shipped 2026-02-09. The 1.0.x line is deliberately Java-8-compatible — no API revolution vs 0.10/0.11; every control type here carries forward unchanged.

## Full content

Vavr brings total, value-based error handling to Java — the functional-half of this domain is carried almost entirely by Vavr (functional Java), not by a native functional JVM language.

**Option** is the null-free container: `Some`/`None`, with `getOrElse` for defaulting. It is the Vavr analog of Java's `Optional` but integrates with the rest of the Vavr type hierarchy.

**Try** models a computation that may throw, as a first-class value. `Try.of(supplier)` captures success or failure; `isFailure()` queries it; `getOrElse` / `getOrElseThrow(mapper)` extract it; `map`/`recover`/`onSuccess`/`onFailure`/`andThen`/`toStream`/`toOption` compose it. The critical subtlety: **`recover` is a pattern-match over the throwable** — a `recover` clause that matches only `ClientException` does NOT recover an unrelated `RuntimeException`, which remains `isFailure()`. Evidence: `exception/handling/VavrTry.java` + `VavrTryUnitTest.java`.

**Either<L,R>** is a typed disjoint union: by convention `Left` holds the error and `Right` the success, and it is right-biased. But it is **not implicitly the right value** — you must project with `.right()` or `.left()` before extracting, and `.right().getOrElseThrow()` throws if the value is actually a `Left`. `Either` replaces anti-patterns like returning `Object[]` or `Map<String,Object>` to convey "result or error." Evidence: `vavr-2/.../either/EitherDemo.java:10-36`.

**Validation** is the applicative cousin of `Either`: it **accumulates ALL errors** rather than short-circuiting. `Validation.combine(v1, v2).ap(User::new)` runs every validation and yields either `Valid(User)` or `Invalid(Seq<String>)` containing every failure. This is the deliberate choice point: use `Validation` when you want to report all problems (e.g. form validation); use `Either`/`Try` when first-failure short-circuit is correct. Evidence: `vavrvalidation/validator/UserValidator.java`.

**Lazy** is a memoized thunk that evaluates its supplier exactly once and caches the result.

### 2026 currency

- **Vavr is a stable, semantically-versioned library, not abandoned.** `io.vavr:vavr:1.0.1` (2026-03-01) is current; **1.0.0** — the first stable major — shipped 2026-02-09, only four months before this research date. The README states Vavr is "production-ready, stable, and not dead." [vavr-io/vavr releases](https://github.com/vavr-io/vavr/releases)
- **The 1.0.x line is deliberately Java-8-compatible** (no API revolution vs 0.10/0.11); the aggressive JDK bump is reserved for v2.x. All control types (`Option`/`Try`/`Either`/`Validation`/`Lazy`) carry forward unchanged from the 0.9.1 corpus. [Vavr roadmap #2953](https://github.com/orgs/vavr-io/discussions/2953)
- **The JDK's own pattern matching is now a peer to Vavr's value/control types**: pattern matching for `switch` + record patterns (Java 21) and primitive patterns (JEP 507, Java 25) mean some `Either`/`Try` ergonomics can be expressed natively — but Vavr's accumulating `Validation` and persistent collections have no direct JDK equivalent. [What's new in Java 25 (LTS)](https://keyholesoftware.com/java-25-whats-new/)
