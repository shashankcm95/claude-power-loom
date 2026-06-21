---
kb_id: java-lang/exceptions-and-linkage-errors
version: 1
tags:
  - java-lang
  - exceptions
  - error-handling
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-exceptions-2"
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-exceptions-3"
  - "Baeldung: Deprecate Finalization in Java 18: https://www.baeldung.com/java-18-deprecate-finalization"
related:
  - java-lang/optional
  - java-lang/module-system-jpms
status: active
---

## Summary

**Concept**: Checked vs unchecked exceptions, try/catch/finally, multi-catch, try-with-resources, exception chaining + suppression, `finally` hazards, and JVM linkage `*Error`s.
**Key APIs**: `throw`/`throws`, `catch (A | B e)`, try-with-resources (`AutoCloseable`), `Throwable(message, cause)` / `getCause()` / `getSuppressed()` / `addSuppressed()`, `Thread.setDefaultUncaughtExceptionHandler`.
**Gotcha**: a `return`/`throw` inside `finally` silently swallows a pending exception/return; a manual null-resource `close()` in `finally` masks the original error. try-with-resources fixes both (closes in reverse order, records close-time errors as *suppressed*).
**2026-currency**: helpful NPEs (JEP 358) default since Java 15; `finalize()` still `@Deprecated(forRemoval=true)` (JEP 421) — use `Cleaner`/`AutoCloseable`.
**Sources**: `core-java-exceptions-2`, `core-java-exceptions-3`.

## Quick Reference

**Fundamentals**:
- checked (`Exception`) must be declared or caught; unchecked (`RuntimeException`/`Error`) need not
- `throw` raises an instance; `throws` declares propagation
- multi-catch union: `catch (IOException | SQLException e)`
- try-with-resources closes `AutoCloseable` in **reverse** declaration order

**Custom exception**: `(message)` + `(message, cause)` constructors + `serialVersionUID`.

**Chaining & suppression**:
- `new RuntimeException(msg, cause)` + `getCause()`; walk the root-cause chain via `getCause()`
- try-with-resources records a close-time exception as **suppressed** (`getSuppressed()`/`addSuppressed()`), preventing "`finally` hides the real error"

**`finally` hazards**:
- `return`/`throw` in `finally` silently swallows the pending exception/return
- a null-resource `close()` in a manual `finally` masks the original — both motivate try-with-resources

**Anti-patterns**: empty `catch` (swallow); catching `Throwable` (also catches unrecoverable `Error`s); throw-as-goto; sneaky throws (`(E) e` erasure trick / Lombok `@SneakyThrows`).

**Linkage `*Error`s** (binary/dependency/class-init mismatch — not catchable logic bugs):
`NoClassDefFoundError`, `ClassNotFoundException` (checked), `ExceptionInInitializerError`, `NoSuchMethodError`/`NoSuchFieldError`/`AbstractMethodError`/`IllegalAccessError`, `StackOverflowError`.

**Common runtime exceptions**: `IllegalArgumentException` vs `NullPointerException`; `IllegalMonitorStateException` (`wait`/`notify` without the monitor); `ClassCastException` (erasure-deferred); `IndexOutOfBoundsException` "Source does not fit in dest" (`Collections.copy` needs the dest pre-sized by *elements* — `new ArrayList<>(n)` sets capacity only).

**Top gotchas**:
- `final` (immutable var / non-overridable method / non-extendable class) vs `finally` (always-runs block) vs `finalize()` (deprecated GC hook).
- Override `getMessage()` to delegate to `getLocalizedMessage()` because logging frameworks call `getMessage()`.

**Current (mid-2026)**: helpful NPE messages (JEP 358) default since Java 15. `finalize()` is `@Deprecated(forRemoval=true)` (JEP 421) — use `Cleaner`/`AutoCloseable`. JPMS strong encapsulation surfaces `InaccessibleObjectException` for blocked deep reflection.

## Full content

Exceptions divide into **checked** (`Exception` subtypes the compiler forces you to declare or catch) and **unchecked** (`RuntimeException` and `Error`, which need no declaration). `throw` raises an instance; `throws` declares that a method may propagate one. The handling constructs are `try`/`catch`/`finally`, the multi-catch *union* (`catch (A | B e)`, where `e` is effectively final), and **try-with-resources**, which auto-closes any `AutoCloseable` in **reverse** declaration order. Custom exceptions conventionally provide `(message)` and `(message, cause)` constructors plus a `serialVersionUID`.

**Chaining** preserves the causal trail: `new XException(message, cause)` plus `getCause()` lets a handler walk to the root cause, deciding to wrap-and-rethrow or handle. **Suppression** solves the historically painful "`finally` hides the real error" bug: when a resource's `close()` throws during stack unwinding, try-with-resources attaches that close-time exception as *suppressed* on the primary exception (`getSuppressed()`/`addSuppressed()`) rather than discarding the primary. This is precisely why try-with-resources is preferred over a manual `finally` block — two classic `finally` hazards are a `return`/`throw` inside `finally` (which silently swallows a pending exception or return value) and a null-resource `close()` call in a hand-written `finally` (which masks the original error with an NPE).

The recurring **anti-patterns** are the empty `catch` (swallowing the error), catching `Throwable` (which also catches unrecoverable `Error`s like `OutOfMemoryError`), exceptions used as control flow, and "sneaky throws" (the type-erasure `(E) e` trick or Lombok `@SneakyThrows`, which throw a checked exception without declaring it). Global handling is done with `Thread.setDefaultUncaughtExceptionHandler`. For localized messages, override `getMessage()` to delegate to `getLocalizedMessage()` (resolved from a `ResourceBundle`), because logging frameworks call `getMessage()`.

**JVM linkage `*Error`s** are a distinct family — binary, dependency, or class-init mismatches, not catchable logic bugs: `NoClassDefFoundError` (a compile-time class fails runtime init), the checked `ClassNotFoundException` (a dynamic-load miss), `ExceptionInInitializerError` (a static initializer threw), `NoSuchMethodError`/`NoSuchFieldError`/`AbstractMethodError`/`IllegalAccessError` (a binary contract drifted), and `StackOverflowError` (unbounded recursion or cyclic init). Common *runtime* exceptions worth distinguishing: `IllegalArgumentException` vs `NullPointerException` for a null parameter, `IllegalMonitorStateException` (calling `wait`/`notify` without owning the monitor), the erasure-deferred `ClassCastException`, and the `IndexOutOfBoundsException` "Source does not fit in dest" from `Collections.copy` — whose destination must already hold at least `source.size()` *elements*; `new ArrayList<>(n)` sets capacity, not size (fix via copy ctor / `addAll` / stream collection). Finally, three lookalike keywords: `final` (immutable variable / non-overridable method / non-extendable class), `finally` (the always-runs block), and `finalize()` (the deprecated GC hook).

### 2026 currency

**Helpful NullPointerExceptions — JEP 358, default since Java 15.** A modern NPE message names the exact null reference in a chained call (`Cannot invoke "X.y()" because "a.b" is null`), eliminating the guess-work the base teaches around.

**`finalize()` — still `@Deprecated(forRemoval=true)` as of JDK 25 (JEP 421, Java 18).** Deprecated but not yet removed; finalization can be disabled today and will be disabled-by-default before removal. Replace with `Cleaner` / `PhantomReference` / `AutoCloseable` + try-with-resources ([Baeldung: Deprecate Finalization in Java 18](https://www.baeldung.com/java-18-deprecate-finalization)).

**Unnamed variables `_` — final JDK 22 (JEP 456)** now name an unused `catch` variable (`catch (Exception _)`), a small modernization of the exception-handling surface. Note that **JPMS strong encapsulation** surfaces an `InaccessibleObjectException` (a `RuntimeException`) when deep reflection is blocked without `--add-opens` — hardened in JDK 17 (the `--illegal-access` escape hatch was removed); see `java-lang/module-system-jpms`. The serialization-RCE mitigation `ObjectInputFilter` (JEP 290) remains the in-JDK defense.
