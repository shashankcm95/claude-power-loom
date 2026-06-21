---
kb_id: java-lang/oop-class-design
version: 1
tags:
  - java-lang
  - oop
  - class-design
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-oop-methods"
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-oop-patterns"
  - "JEP 395 Records (final JDK 16): https://openjdk.org/jeps/395"
related:
  - java-lang/inheritance-polymorphism-binding
  - java-lang/interfaces-abstract-classes
  - java-lang/generics-type-erasure
status: active
---

## Summary

**Concept**: Class anatomy (state + behavior), object identity via the `equals`/`hashCode` contract, ordering via `Comparable`/`Comparator`, immutability, and copy/clone semantics.
**Key APIs**: `Objects.hash(...)`, `Objects.equals(a,b)`, `Comparator.comparing(...).thenComparing(...)`, `Integer.compare(a,b)`, copy constructor, `Cloneable.clone()`.
**Gotcha**: `equals` symmetry breaks when a subclass adds a field to `equals` (favor composition); `a-b` overflows in `compareTo` — use `Integer.compare`.
**2026-currency**: `record` (final JDK 16, JEP 395) is the modern value-type idiom — auto `equals`/`hashCode`/`toString`, replacing hand-rolled POJOs.
**Sources**: `core-java-lang-oop-methods`, `core-java-lang-oop-patterns`.

## Quick Reference

Canonical `equals`/`hashCode` (hand-rolled, `prime = 31`, null-safe, `instanceof`):

```java
@Override public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Money)) return false;
    Money m = (Money) o;
    return amount == m.amount && Objects.equals(currency, m.currency);
}
@Override public int hashCode() { return Objects.hash(amount, currency); }
```

**`equals`/`hashCode` contract**: reflexive, symmetric, transitive, consistent; `equals` ⇒ equal `hashCode` (not vice-versa). Generation strategies: hand-rolled `31*h+f`, `Objects.hash(...)` (modern multi-field), Apache `HashCodeBuilder`, Lombok `@EqualsAndHashCode`, IDE-generated; test with `EqualsVerifier`.

**`Objects` helpers**: `Objects.equals` (null-safe), `Objects.hashCode(x)` (single, 0 for null) vs `Objects.hash(a,b,...)` (varargs) — note `Objects.hash(x) != Objects.hashCode(x)` because of array wrapping.

**Ordering**: `Comparable.compareTo` for natural order; `Comparator` for external orders; multi-key `comparing(T::getter).thenComparing(...).reversed()` + `nullsFirst`/`nullsLast`.

**Immutability recipe**: `final` class, all-`final` fields, no setters, defensive construction + defensive copy of mutable fields/collections; static factory + private ctor. `String` is the canonical immutable.

**Copy / clone**: copy constructor (defensive-copies mutable fields; can carry business logic; polymorphic via overridden `copy()`); `Cloneable.clone()` is flawed (protected, checked `CloneNotSupportedException`, no ctor call, shallow by default). Deep-copy options: copy ctor, `clone()`, Apache `SerializationUtils.clone`, Gson/Jackson round-trip.

**Top gotchas**:
- A constant `hashCode()` is legal but collapses every entry to one `HashMap` bucket (O(n)).
- Overriding `equals` without `hashCode` breaks `HashMap` lookup.
- Symmetry trap: `Voucher extends Money` adding a field to `equals` breaks symmetry → prefer composition.
- Subtraction overflow: `a-b` for large/opposite-sign ints overflows → use `Integer.compare`.
- Shallow copy shares nested mutable references; `clone()` does not deep-copy for you.

**Current (mid-2026)**: For value types and multiple return values use a `record` (final JDK 16, JEP 395) over POJO/`Pair`/`Triple`/`Tuple2` — the compact canonical constructor validates, accessors are `name()`, and `equals`/`hashCode`/`toString` are auto-generated. `Objects.hash` remains the modern path for non-record classes.

## Full content

A class bundles **state** (fields) and **behavior** (methods). The `this` keyword has five idioms — field/param disambiguation, constructor chaining `this(...)` (must be the first statement in the base teaching; see 2026 currency below), invoking an instance method, passing the current instance, and returning `this` for fluent chaining — plus qualified `Outer.this` to reach an enclosing instance from an inner class.

**Object creation & init order**: `new`, reflection (`Class.getConstructor(...).newInstance(...)`), or `clone()`. Initialization order is **static initializer → instance initializer block → constructor**; uninitialized fields take defaults (null/0/false).

**Object identity** rests on the `equals`/`hashCode` contract. The two methods must agree: equal objects must have equal hash codes. The canonical implementation uses `prime = 31`, null-safe field comparison, and an `instanceof` type check, optionally chaining `super.equals`/`super.hashCode`. The classic symmetry trap is subclassing and widening `equals` with a new field (`Voucher extends Money`) — `a.equals(b)` and `b.equals(a)` then disagree; the durable fix is composition over inheritance. A constant `hashCode()` compiles and satisfies the contract but degrades `HashMap` to O(n) by collapsing every key into one bucket.

**Ordering** is provided either intrinsically via `Comparable.compareTo` (natural order) or externally via `Comparator` (alternate orders, composed with `comparing(...).thenComparing(...).reversed()` and `nullsFirst`/`nullsLast`). The recurring bug is implementing `compareTo` as `a - b`: integer subtraction overflows for large or opposite-sign operands, silently inverting the order. Use `Integer.compare(a, b)`.

**Immutability** requires a `final` class, all-`final` fields, no setters, and defensive copies of any mutable field or collection both on construction and on getter return. A static factory over a private constructor is the common shape. `String` is the reference immutable.

**Copying** has two main paths. A copy constructor is the most flexible — it can defensively copy mutable members, encode business logic, and be made polymorphic by overriding a `copy()` method. `Cloneable.clone()` is the historically-flawed alternative: it is `protected`, throws checked `CloneNotSupportedException`, bypasses constructors, and is shallow by default. A shallow copy shares nested mutable references, so deep copies need a copy constructor, a careful `clone()`, or a serialization round-trip (Apache `SerializationUtils`, Gson, Jackson).

### 2026 currency

The base teaches `record` only in preview (Java 14). **Records are final since JDK 16 ([JEP 395](https://openjdk.org/jeps/395))** and are the modern idiom for immutable value types, multiple return values, and equals/hashCode/toString generation — preferred over POJOs and ad-hoc `Pair`/`Tuple2` types. A record's compact canonical constructor is the natural home for validation (`Objects.requireNonNull`), accessors are `name()`, and the old `--enable-preview` / `@SuppressWarnings("preview")` guards are obsolete.

**Flexible constructor bodies — final JDK 25 ([JEP 513](https://www.jrebel.com/blog/java-25)).** Statements (validation, computation, helper calls) may now run *before* `super(...)`/`this(...)`, relaxing the base doc's absolute "constructor chaining must be the first statement" invariant on modern JDKs.

For non-record classes, `Objects.hash(...)` / `Objects.equals(...)` remain the recommended hand-authoring path; `EqualsVerifier` remains the way to test the contract.
