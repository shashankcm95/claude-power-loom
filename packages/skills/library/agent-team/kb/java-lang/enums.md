---
kb_id: java-lang/enums
version: 1
tags:
  - java-lang
  - oop
  - enums
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-oop-types"
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-2"
  - "JEP 441 Pattern Matching for switch (final JDK 21): https://openjdk.org/jeps/441"
related:
  - java-lang/inheritance-polymorphism-binding
  - java-lang/interfaces-abstract-classes
status: active
---

## Summary

**Concept**: Enums as typed constant sets with fields, constructors, constant-specific method bodies, and Strategy-per-constant behavior; `EnumSet`/`EnumMap`; reverse-lookup caches.
**Key APIs**: enum field + private ctor + accessor, constant-specific `@Override`, `values()`, `EnumSet`, `EnumMap`, `static {}`-populated `Map BY_LABEL`.
**Gotcha**: enums can't be subclassed — share behavior via a common interface or an external `EnumMap` (with a `static {}` completeness guard that throws `IllegalStateException` if a constant is unmapped).
**2026-currency**: pattern matching for `switch` (final JDK 21) gives exhaustiveness checking over enum cases.
**Sources**: `core-java-lang-oop-types`, `core-java-lang-2`.

## Quick Reference

**Anatomy** — fields + private constructor + accessor:

```java
enum Element {
    HYDROGEN("H"), HELIUM("He");
    private final String symbol;
    Element(String symbol) { this.symbol = symbol; }
    public String symbol() { return symbol; }
}
```

**Strategy per constant** (constant-specific method bodies implementing an abstract method):

```java
enum PizzaDeliveryStrategy {
    EXPRESS { @Override void deliver(Pizza p) { /* ... */ } },
    NORMAL  { @Override void deliver(Pizza p) { /* ... */ } };
    abstract void deliver(Pizza p);
}
```

**Reverse-lookup cache** (O(1) `valueOfLabel`) — progressive series:
plain constants → one field + linear `valueOfLabel` → `static {}`-populated `Map<String, X> BY_LABEL` reverse cache → multiple fields + multiple caches + custom interface.

**Collections**: `EnumSet` (compact bit-set-backed set), `EnumMap` (array-backed map keyed by ordinal) — both faster than `HashSet`/`HashMap` for enum keys.

**Enum as Singleton**: a single `INSTANCE` constant is the thread-safe, serialization-safe singleton idiom.

**Extending enums** (enums can't be subclassed): have several enums implement a shared interface, OR hold behavior in an external `EnumMap` with a `static {}` completeness guard (`IllegalStateException` if a constant is unmapped).

**int → enum**: `values()[ordinal]` or a precomputed `Map<Integer, Enum>`.

**Top gotchas**:
- A failing `static {}` initializer surfaces as `ExceptionInInitializerError`, not the raw cause.
- `BY_LABEL` reverse caches assume unique labels; collisions silently overwrite.
- `values()` allocates a fresh array each call — cache it for hot loops.

**Current (mid-2026)**: `switch` over an enum gets compiler-checked exhaustiveness under pattern matching for `switch` (final JDK 21) — a missing constant becomes a compile-time concern.

## Full content

An enum is a fixed, typed set of constants that is also a full class: each constant can carry fields (set through a private constructor) and behavior. The richest idiom is **constant-specific method bodies** — declaring an `abstract` method on the enum and letting each constant supply its own implementation. This is the Strategy pattern with the strategies enumerated and type-safe, replacing a `switch` over an `int` code.

Because enums are reference-typed and identity-stable, `EnumSet` (a compact bit-set) and `EnumMap` (an ordinal-indexed array) are the preferred collections for enum keys. A single `INSTANCE` constant is the canonical thread-safe, serialization-safe **Singleton**.

Mapping a label or numeric code back to a constant is a recurring need, taught as a progressive series: from plain constants, to a single field plus a linear `valueOfLabel`, to a `static {}`-populated `Map<String, X> BY_LABEL` reverse cache for O(1) lookup, up to multiple fields with multiple caches behind a custom interface. Two hazards attend the cache: a failing `static {}` block surfaces wrapped as `ExceptionInInitializerError` (not the raw exception), and a reverse cache silently assumes its labels are unique.

Enums **cannot be subclassed**. To share behavior across enums, either have several enums implement a common interface, or externalize the behavior into an `EnumMap` keyed by the constant — guarded by a `static {}` completeness check that throws `IllegalStateException` if any constant is left unmapped, so adding a constant without its mapping fails loudly at class-init. Casting an `int` to an enum uses `values()[ordinal]` (allocates a fresh array per call) or a precomputed `Map<Integer, Enum>`.

### 2026 currency

The enum model itself is evergreen and unchanged. What modernizes the consuming code is **pattern matching for `switch` — final JDK 21 ([JEP 441](https://openjdk.org/jeps/441))**: a `switch` over an enum (or a sealed hierarchy) gets compiler-checked **exhaustiveness**, so omitting a constant is caught at compile time rather than slipping through a missing `default`. This pairs with the constant-specific-method-body Strategy idiom above as the two type-safe alternatives to scattered `if`/`switch` chains, and aligns with the move toward sealed types + records for closed modeling (see `java-lang/interfaces-abstract-classes`).
