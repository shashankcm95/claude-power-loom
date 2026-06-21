---
kb_id: java-lang/functional-interfaces-lambdas
version: 1
tags:
  - java-lang
  - functional
  - lambdas
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lambdas"
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-functional"
  - "Wikipedia: Java version history: https://en.wikipedia.org/wiki/Java_version_history"
related:
  - java-lang/interfaces-abstract-classes
  - java-lang/optional
  - java-lang/language-evolution-8-to-25
status: active
---

## Summary

**Concept**: Lambdas and effectively-final capture, method references (4 kinds), the `java.util.function` interfaces, function composition, and FP concepts (purity, currying, monads, no TCO).
**Key APIs**: `Function` (+`compose`/`andThen`), `Predicate` (`and`/`or`/`negate`, `Predicate.not` Java 11), `Supplier`, `Consumer`, `BiFunction`/`BinaryOperator`, `UnaryOperator`, `@FunctionalInterface`, `Class::sm` / `instance::m` / `Type::im` / `Class::new`.
**Gotcha**: `compose` runs the argument function first; `andThen` runs *this* function first — the classic order trap. Lambdas capture only effectively-final locals (the single-element-array mutation workaround is an anti-pattern). Java has **no tail-call optimization**.
**2026-currency**: lambdas/method refs/functional interfaces are evergreen; `var` in lambda params (Java 11) and `_` for unused params (JDK 22) are the modern touches.
**Sources**: `core-java-lambdas`, `core-java-functional`.

## Quick Reference

**Lambda capture**: only effectively-final locals (value captured, not the variable). Instance/static fields *are* mutable from a lambda. The single-element-array mutation trick is an explicit anti-pattern (thread-safety smell). A lambda does NOT create a new scope (unlike an anonymous class).

**`java.util.function` core**:

| Interface | Shape | Combinators |
|---|---|---|
| `Function<T,R>` | `T -> R` | `compose`, `andThen` |
| `BiFunction<T,U,R>` | `(T,U) -> R` | `andThen` |
| `BinaryOperator<T>` | `(T,T) -> T` | used by `reduce` |
| `Supplier<T>` | `() -> T` | (lazy) |
| `Consumer<T>` / `BiConsumer` | side effect | `andThen` |
| `Predicate<T>` | `T -> boolean` | `and`, `or`, `negate`, `Predicate.not` (Java 11) |
| `UnaryOperator<T>` | `T -> T` | |

Chain predicates: `stream().reduce(x -> true, Predicate::and)` (all) / `(x -> false, Predicate::or)` (any).

**Method references (4 kinds)**: static `Class::sm`, bound `instance::m`, unbound/arbitrary `Type::im`, constructor `Class::new` (+ array ctor `T[]::new`); super-method refs.

**Composition trap**: `f.compose(g)` = `f(g(x))` — `g` runs first. `f.andThen(g)` = `g(f(x))` — `f` runs first.

**FP concepts**: first-class + pure functions; currying (nested `Function`); `Optional` as a monad (`flatMap` = bind); referential transparency; immutable data.

**Top gotchas**:
- `compose` vs `andThen` order is the classic mistake.
- Java has **no TCO** — tail-recursive code still grows the stack → `StackOverflowError`.
- Effectively-final capture blocks mutating a captured local.
- Custom `@FunctionalInterface` is for primitive specializations / checked-exception SAMs only.

**Current (mid-2026)**: the model is evergreen. `var` in lambda params (Java 11), `Predicate.not` (Java 11), and unnamed `_` lambda params (final JDK 22, JEP 456) are the deltas.

## Full content

A **lambda** is an anonymous implementation of a *functional interface* (a single-abstract-method type). It captures only **effectively-final** locals — the *value* is captured, not the variable — though instance and static fields remain mutable from inside a lambda. The single-element-array mutation trick (`int[] counter = {0}; ... counter[0]++`) circumvents this but is an explicit anti-pattern and a thread-safety smell. Unlike an anonymous class, a lambda does **not** introduce a new scope, so it cannot shadow enclosing names, and its `this` refers to the enclosing instance.

The `java.util.function` package supplies the standard SAM types: `Function` and `BiFunction` (with `compose`/`andThen`), `BinaryOperator` (the all-types-equal special case `reduce` uses), `Supplier` (for laziness), `Consumer`/`BiConsumer` (side effects), `Predicate` (with `and`/`or`/`negate`, plus `Predicate.not` since Java 11), and `UnaryOperator`. A custom `@FunctionalInterface` is warranted only for primitive specializations or for a SAM that throws a checked exception. Collections of predicates are reduced with `stream().reduce(x -> true, Predicate::and)` for "all" and `(x -> false, Predicate::or)` for "any".

**Method references** come in four kinds: static (`Class::staticMethod`), bound to a specific instance (`instance::method`), unbound/arbitrary-object (`Type::instanceMethod`, where the first stream element becomes the receiver), and constructor (`Class::new`, including array constructors `T[]::new`), plus super-method references.

The single most error-prone composition fact: **`compose` runs the argument function first** (`f.compose(g)` computes `f(g(x))`), whereas **`andThen` runs `this` function first** (`f.andThen(g)` computes `g(f(x))`). Other FP concepts in scope: first-class and pure functions, currying via nested `Function`s, `Optional` as a monad (`flatMap` is bind — see `java-lang/optional`), referential transparency, and immutability. A load-bearing limitation: **Java has no tail-call optimization**, so even a tail-recursive method grows the call stack and eventually throws `StackOverflowError` — recursion is not a free substitute for iteration.

### 2026 currency

The functional-Java model — lambdas, method references, `java.util.function`, composition, `Optional` — is stable and evergreen across all modern JDKs ([Java version history](https://en.wikipedia.org/wiki/Java_version_history)). The current-era refinements are syntactic: `var` in lambda parameters (final JDK 11) for consistent annotation placement, `Predicate.not(...)` (Java 11) for readable negation, and **unnamed variables `_` — final JDK 22 ([JEP 456](https://openjdk.org/jeps/456))** for unused lambda parameters and record-pattern components. Lambdas also pair with **virtual threads (final JDK 21)** in the `Executors.newVirtualThreadPerTaskExecutor()` idiom — the SAM is unchanged; what changed is the cheap thread it runs on (concurrency depth is a separate lane). The no-TCO limitation persists.
