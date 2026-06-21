---
kb_id: java-lang/inheritance-polymorphism-binding
version: 1
tags:
  - java-lang
  - oop
  - polymorphism
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-oop-inheritance"
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-oop-others"
  - "JEP 394 Pattern Matching for instanceof (final JDK 16): https://openjdk.org/jeps/394"
related:
  - java-lang/oop-class-design
  - java-lang/interfaces-abstract-classes
  - java-lang/enums
status: active
---

## Summary

**Concept**: Inheritance (is-a), `super` access, dynamic dispatch vs static binding, field/static-method hiding, casting, covariant returns, and nested/anonymous classes.
**Key APIs**: `super(...)` / `super.method()` / `super.field`, `instanceof`, `Class.isInstance` / `Class.cast`, `Outer.this`, `outer.new Inner()`.
**Gotcha**: overriding → runtime dynamic dispatch by object type; overloading → compile-time static binding by reference type. **Static methods are hidden, not overridden; instance fields resolve by reference type** — neither is polymorphic.
**2026-currency**: pattern matching for `instanceof` (final JDK 16, JEP 394) binds + casts in one step: `if (o instanceof Foo f)`.
**Sources**: `core-java-lang-oop-inheritance`, `core-java-lang-oop-others`.

## Quick Reference

**Binding mechanics** (the load-bearing distinction):

| Mechanism | When resolved | By what |
|---|---|---|
| Overriding (instance methods) | runtime — **dynamic dispatch** | actual object type |
| Overloading | compile-time — **static binding** | declared/reference type |
| Static-method "hiding" | compile-time | reference type (NOT polymorphic) |
| Instance-field access | compile-time | reference type (NOT polymorphic) |

**Overload resolution order**: exact > widening/promotion > autoboxing > varargs. Explicit casts steer selection.

**`super`**: superclass constructor `super(...)`, method `super.method()`, shadowed field `super.field`.

**Casting**: upcast is implicit/safe; downcast is explicit and risks `ClassCastException` → guard with `instanceof`, or use reflective `Class.isInstance(obj)` / `Class.cast(obj)` (primitive-tolerant).

**Covariant return types**: an override may return a subtype of the supertype's declared return.

**Nested classes (four kinds)**:
- **static nested** — no enclosing instance; reads outer `static` members
- **inner/member** — needs `outer.new Inner()`; shadows outer fields; reach outer via `Outer.this.field`
- **local** — declared inside a method/block
- **anonymous** — extend a class / implement an interface inline; capture effectively-final locals; introduce a new scope (so they can shadow); `this` = the anonymous instance (a lambda's `this` = enclosing)

**Top gotchas**:
- `static` methods are hidden, not overridden — the core "singleton over static utility" argument.
- Instance fields resolve by reference type (hiding), never polymorphically.
- A multiple-interface default-method diamond must be resolved via `Interface.super.method()`.
- Double-brace init (`new HashSet<>(){{ add(...); }}`) creates an anonymous subclass with a hidden outer reference — a leak/serialization hazard; use `Set.of`.

**Current (mid-2026)**: pattern matching for `instanceof` (final JDK 16) collapses the guard-then-downcast pair into `if (o instanceof Foo f) { f.bar(); }`. Pattern matching for `switch` (final JDK 21) plus sealed types replace long `instanceof` chains with exhaustiveness-checked dispatch.

## Full content

Inheritance models an **is-a** relationship; the maxim is "favor composition over inheritance" where the relationship is really has-a. A subclass reaches its parent through `super` — the superclass constructor (`super(...)`), an overridden method (`super.method()`), or a shadowed field (`super.field`).

**Polymorphism splits into two mechanisms that are easy to conflate.** Overriding an *instance method* produces **dynamic dispatch**: the JVM picks the implementation at runtime based on the actual object type. Overloading, by contrast, is resolved at **compile time** by the declared (reference) type, following the precedence exact > widening > autoboxing > varargs. Two constructs masquerade as polymorphism but are not: a `static` method is *hidden* (resolved by reference type) rather than overridden, and an instance *field* is likewise resolved by reference type (hiding). These two facts underpin the classic argument for a singleton instance over a static utility class — only instance methods participate in dynamic dispatch.

**Casting** moves a reference up or down the hierarchy. Upcasting is implicit and always safe. Downcasting is explicit and can throw `ClassCastException`, so it is guarded with `instanceof` or performed reflectively via `Class.isInstance(obj)` (a reflective, primitive-tolerant `instanceof`) and `Class.cast(obj)`. An override may use a **covariant return type** — returning a subtype of the supertype's declared return.

**Nested classes** come in four flavors. A *static nested* class has no enclosing instance and can read the outer class's static members. An *inner (member)* class is tied to an instance, requires `outer.new Inner()`, shadows outer fields, and reaches the enclosing instance via `Outer.this.field`. A *local* class lives inside a method or block. An *anonymous* class extends a class or implements an interface inline, captures only effectively-final locals, and — unlike a lambda — introduces a new scope (so it can shadow names) and binds `this` to the anonymous instance rather than the enclosing one. The double-brace initialization trick is an anonymous subclass with a hidden synthetic outer reference and is a leak/serialization hazard.

### 2026 currency

**Pattern matching for `instanceof` — final JDK 16 ([JEP 394](https://openjdk.org/jeps/394)).** `if (o instanceof Foo f)` binds and downcasts in one expression, eliminating the guard-then-cast boilerplate the base teaches.

**Pattern matching for `switch` — final JDK 21 ([JEP 441](https://openjdk.org/jeps/441)).** Type and guarded patterns (`case Foo f when ...`), `case null`, and compiler-checked exhaustiveness over sealed hierarchies replace long `instanceof`/downcast chains — the modern way to express type-driven dispatch (see also `java-lang/interfaces-abstract-classes` for sealed types). **Record patterns — final JDK 21 ([JEP 440](https://openjdk.org/jeps/440))** add nested destructuring. **Unnamed variables `_` — final JDK 22 ([JEP 456](https://openjdk.org/jeps/456))** name unused pattern components and catch vars. The underlying binding mechanics (dynamic dispatch, hiding, casting) are unchanged.
