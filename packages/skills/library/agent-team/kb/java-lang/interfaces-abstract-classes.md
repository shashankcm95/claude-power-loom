---
kb_id: java-lang/interfaces-abstract-classes
version: 1
tags:
  - java-lang
  - oop
  - interfaces
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-oop-modifiers"
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-oop-patterns"
  - "JEP 409 Sealed Classes (final JDK 17): https://openjdk.org/jeps/409"
related:
  - java-lang/oop-class-design
  - java-lang/inheritance-polymorphism-binding
  - java-lang/functional-interfaces-lambdas
  - java-lang/enums
status: active
---

## Summary

**Concept**: Interface vs abstract class; interface method kinds (abstract, constant, `static`, `default`, `private`); default-method diamond resolution; marker interfaces; template-method abstract classes.
**Key APIs**: `default`/`static`/`private` interface methods, `Interface.super.method()`, marker interfaces, abstract class with constructors + shared state.
**Gotcha**: a multiple-interface default-method diamond must be explicitly overridden and resolved via `Interface.super.method()`; same-named interface constants must be qualified.
**2026-currency**: `sealed`/`permits` (final JDK 17, JEP 409) gives closed hierarchies + exhaustiveness checking, replacing marker-interface + `instanceof` chains.
**Sources**: `core-java-lang-oop-modifiers`, `core-java-lang-oop-patterns`.

## Quick Reference

**Interface vs abstract class**:

| | Interface | Abstract class |
|---|---|---|
| Instance state | none | shared fields |
| Constructors | no | yes |
| Multiple inheritance | yes (of type) | no |
| Partial impl | `default`/`static` methods | concrete methods + abstract hooks |
| Use for | multiple inheritance of type | template method + shared state |

**Interface member kinds**:
- abstract methods (implicitly `public abstract`)
- constants (implicitly `public static final`)
- `static` methods (Java 8)
- `default` methods (Java 8)
- `private` / `private static` methods (Java 9)
- inner interfaces; interface-extends-interface; marker interfaces

**Default-method diamond resolution** — when two implemented interfaces declare the same `default` method, the implementer MUST override and disambiguate:

```java
class MultiAlarmCar implements Alarm, Car {
    @Override public String beep() { return Alarm.super.beep(); }
}
```

Same-named interface *constants* across two interfaces must likewise be qualified (`Alarm.LIMIT`).

**Template method** (abstract-class idiom): a concrete method calls abstract hooks that subclasses fill in.

**Top gotchas**:
- An interface is reported as "abstract" by reflection (`Modifier.isAbstract` returns `true` for interfaces) — a proper-abstract check needs `&& !isInterface`.
- `default` methods add behavior to interfaces without breaking implementers — but a diamond forces explicit resolution.

**Current (mid-2026)**: `sealed interface`/`sealed class` ... `permits A, B` with `final`/`sealed`/`non-sealed` subtypes (final JDK 17) is the closed-hierarchy primitive. Records can implement a sealed interface, and `switch` pattern matching (JDK 21) gets compiler-checked exhaustiveness over the permitted set — the modern replacement for marker interface + `instanceof`.

## Full content

An **interface** is multiple inheritance of *type* with no instance state. Since Java 8 it can also carry `static` and `default` methods (concrete behavior), and since Java 9 `private` / `private static` helper methods to share code between defaults. Its constants are implicitly `public static final`; its abstract methods are implicitly `public abstract`. An **abstract class**, by contrast, can hold shared mutable state, declare constructors, and provide partial implementations — the natural home for the *template method* pattern, where a concrete method orchestrates calls to abstract hooks subclasses override.

A **marker interface** (no members) tags a type for a contract checked elsewhere (the historical `Serializable`/`Cloneable` style). The 2026 idiom for closed hierarchies moves past markers (see currency below).

The **default-method diamond** is the headline hazard. If a class implements two interfaces that both declare a `default` method with the same signature, the compiler refuses to pick one — the class must override the method and explicitly delegate via `Interface.super.method()`. The analogous rule applies to inherited *constants* of the same name: references must be qualified by the declaring interface. Note a reflection subtlety: `Modifier.isAbstract(...)` returns `true` for an interface, so distinguishing a *proper* abstract class requires the extra `&& !Modifier.isInterface(...)` check.

### 2026 currency

**Sealed classes/interfaces — final JDK 17 ([JEP 409](https://openjdk.org/jeps/409)).** `sealed ... permits A, B` declares a closed hierarchy whose direct subtypes must each be `final`, `sealed`, or `non-sealed`. This is the closed-hierarchy primitive the base only saw in preview — it replaces the marker-interface + `instanceof`-chain idiom. Records can implement a sealed interface, and `Class.isSealed()` / `Class.getPermittedSubclasses()` (returning `Class<?>[]`) expose the relationship reflectively.

Combined with **pattern matching for `switch` — final JDK 21 ([JEP 441](https://openjdk.org/jeps/441))**, a `switch` over a sealed type gets compiler-checked **exhaustiveness**: every permitted subtype must be handled (or a `default` supplied), turning a class of runtime bugs into compile errors. The Java 8/9 interface-method additions (`default`/`static`/`private`) are unchanged and remain current.
