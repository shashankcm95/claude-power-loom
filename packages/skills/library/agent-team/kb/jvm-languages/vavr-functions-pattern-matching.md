---
kb_id: jvm-languages/vavr-functions-pattern-matching
version: 1
tags:
  - jvm-languages
  - vavr
  - functional
  - pattern-matching
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: vavr"
  - "vavr-io/vavr releases (https://github.com/vavr-io/vavr/releases)"
related:
  - jvm-languages/vavr-control-types
  - jvm-languages/vavr-persistent-collections
status: active
---

## Summary

**Concept**: Vavr's functional building blocks — tuples, first-class function objects, `Match`/`Case` pattern matching, `Future`, property-based testing, and checked-exception lambdas.
**Key APIs**: `Tuple.of(...)` (`Tuple2..N`, `_1`/`._2()`, `update2` returns NEW); `Function0..Function5` (composition/currying/memoization); `Match(v).of(Case($(is(x)), r), Case($(), default))`; `io.vavr.concurrent.Future`; `Property.def(...).forAll(gen).suchThat(fn).check(...)`; `CheckedFunction1` + `.unchecked()`/`lift`/`liftTry`.
**Gotcha**: a `Match` with no matching case and no default `$()` throws `MatchError`; `Future.getValue()` returns `Option<Try<T>>`; `liftTry` wraps a throwing fn into one returning `Try`.
**2026-currency**: Vavr 1.0.1 (2026-03-01); APIs stable; the JDK's own `switch` pattern matching (Java 21/25) is now a peer to `Match`/`Case`.
**Sources**: `vavr` module; vavr-io/vavr releases.

## Quick Reference

**Tuples** — fixed-arity immutable groupings:

```java
Tuple2<String,Integer> t = Tuple.of("a", 1);
t._1; t._2();
Tuple2<String,Integer> t2 = t.update2(99);   // returns a NEW tuple (immutable)
t.map(f1, f2); t.map(biFn); t.apply(biFn); t.arity();
```

**First-class functions**: `Function0..Function5` (arbitrary arity), `Function2.of(methodRef)`, with composition / currying / memoization.

**Pattern matching** (`Match`/`Case`/`$` from `io.vavr.API`):

```java
String r = Match(value).of(
    Case($(is(1)), "one"),
    Case($(instanceOf(String.class)), "str"),
    Case($(), "default"));   // omit $() and a non-match throws MatchError
```

Predicate cases via `io.vavr.Predicates.{is, isIn, isNull, instanceOf, allOf, anyOf, noneOf}`; `.option(...)` returns an `Option` instead of throwing.

**Future** (`io.vavr.concurrent.Future`):

```java
Future<T> f = Future.of(supplier);          // or of(executor, supplier)
f.await(); f.getValue();                     // Option<Try<T>>
f.map(...).flatMap(...).zip(...);
f.recover(...).recoverWith(...).fallbackTo(...);
f.toCompletableFuture();
```

**Property-based testing** (`io.vavr.test`):

```java
Property.def("name").forAll(Arbitrary.integer()).suchThat(checkedFn)
        .check(10_000, 100).assertIsSatisfied();
```

**Checked-exception lambdas**: `CheckedFunction1` + `.unchecked()` / `API.unchecked`; `lift(fn)` → returns `Option`; `liftTry(fn)` → returns `Try`.

**Current (mid-2026)**: `io.vavr:vavr:1.0.1` (2026-03-01); all APIs stable. The JDK's pattern matching for `switch` + record patterns (Java 21) and primitive patterns (JEP 507, Java 25) is now a native peer to `Match`/`Case`.

## Quick anti-pattern note

`VavrUnitTest.whenIfWorksAsMatcher` is a teaching anti-pattern (a dangling `else` bound to the last `if`) — it demonstrates *why* naive `if` chains are worse than `Match`, NOT a pattern to copy.

## Full content

These are the functional building blocks beneath Vavr's control types and collections.

**Tuples** (`Tuple.of(...)` → `Tuple2..N`) are fixed-arity immutable groupings. Access components with `_1` / `_2()`; transform with `map(f1, f2)`, `map(BiFunction)`, `apply(BiFunction)`; `update2(v)` returns a NEW tuple (immutability); `arity()` reports the size.

**First-class functions** are reified as `Function0` through `Function5` (arbitrary arity), constructible from method references (`Function2.of(methodRef)`), and support composition, currying, and memoization.

**Pattern matching** (`Match`/`Case`/`$` imported statically from `io.vavr.API`) is a switch-expression replacement that returns a value. Cases use predicate combinators from `io.vavr.Predicates` (`is`, `isIn`, `isNull`, `instanceOf`, `allOf`, `anyOf`, `noneOf`). With no matching case and no default `$()`, a `MatchError` is thrown; `.option(...)` returns an `Option` instead. Notably, `Try.recover` is itself a pattern-match over the throwable (see `jvm-languages/vavr-control-types`). Evidence: `PatternMatchingUnitTest.java`.

**Future** (`io.vavr.concurrent.Future`) is Vavr's async value: `Future.of(supplier)` or `of(executor, supplier)`; `await`; `getValue()` returns `Option<Try<T>>` (none until complete, then success-or-failure); `map`/`flatMap`/`zip` compose it; `recover`/`recoverWith`/`fallbackTo` handle failure; `toCompletableFuture` bridges to the JDK; state predicates query progress. Evidence: `future/FutureUnitTest.java:39-49`.

**Property-based testing** (`io.vavr.test`) generates inputs and asserts invariants: `Arbitrary.integer().filter(...)`, `Property.def(...).forAll(gen).suchThat(checkedFn).check(size, tries)`, `assertIsSatisfied()`; the predicate is a `CheckedFunction1`. Evidence: `PropertyBasedLongRunningUnitTest.java`.

**Checked-exception lambdas** solve Java's checked-exception-in-lambda pain: `CheckedFunction1` with `.unchecked()` (or `API.unchecked`) erases the checked exception; `lift(fn)` produces a `Function` returning `Option`; `liftTry(fn)` produces one returning `Try`.

### 2026 currency

- **Vavr 1.0.0 (first stable major) shipped 2026-02-09; 1.0.1 is current (2026-03-01).** Tuples, function objects, `Match`/`Case`, `Future`, property testing, and checked-lambda helpers are stable and Java-8-compatible. [vavr-io/vavr releases](https://github.com/vavr-io/vavr/releases) · [Vavr roadmap #2953](https://github.com/orgs/vavr-io/discussions/2953)
- **The JDK's own pattern matching is now a peer to Vavr's `Match`/`Case`**: pattern matching for `switch` + record patterns (Java 21) and primitive patterns (JEP 507, Java 25). For new code on a modern LTS, native `switch` patterns cover many cases that previously required Vavr `Match`. [What's new in Java 25 (LTS)](https://keyholesoftware.com/java-25-whats-new/)
- **Virtual threads (Project Loom, GA in Java 21; pinning fixed by JEP 491 in Java 25)** are relevant to Vavr `Future` — blocking inside a `Future.of` supplier on a virtual-thread executor no longer ties up a carrier thread the way it did pre-Loom. [What's new in Java 25 (LTS)](https://keyholesoftware.com/java-25-whats-new/)
