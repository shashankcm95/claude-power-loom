---
kb_id: algorithms-design/gof-creational-patterns
version: 1
tags:
  - algorithms-design
  - design-patterns
  - gof
  - creational
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: patterns/design-patterns-creational, immutables"
  - "Java Language Changes — Oracle (https://docs.oracle.com/en/java/javase/17/language/java-language-changes.html)"
related:
  - algorithms-design/gof-structural-patterns
  - algorithms-design/gof-behavioral-patterns
  - algorithms-design/solid-and-dependency-inversion
status: active
---

## Summary

**Concept**: The GoF creational patterns — Singleton (with 5 thread-safety strategies), Factory Method / Abstract Factory, Builder (classic + FreeBuilder + staged), Prototype, Flyweight — plus static-factory-methods (Effective Java) and the Immutables value-class library.
**Key APIs**: enum singleton; double-checked locking `private static volatile`; init-on-demand holder idiom; `PolygonFactory.getPolygon(sides)`; generic `AbstractFactory<T>`; FreeBuilder `*_Builder`; Flyweight `computeIfAbsent` cache; Immutables `@Value.Immutable`/`@Value.Default`/`@Value.Parameter`.
**Gotcha**: DCL **requires `volatile`** or the partial-construction race returns; `PolygonFactory` returns `null` for unknown sides; the Flyweight here caches the whole object (no intrinsic/extrinsic split).
**2026-currency**: Java 16 **records** subsume much value-carrier boilerplate; FreeBuilder is **archived**; Immutables now generates builders/withers *for records*; `new Integer(10)` → `Integer.valueOf`.
**Sources**: Baeldung `design-patterns-creational` + `immutables`.

## Quick Reference

**Singleton** — 5 thread-safety strategies plus a deliberately-unsafe baseline:

| Strategy | Mechanism | Note |
|---|---|---|
| Lazy non-thread-safe | plain `if (instance == null)` | the counter-example baseline (`ClassSingleton`) |
| Draconian `synchronized` | synchronize the whole accessor | correct but slow |
| Double-checked locking (DCL) | `private static volatile` + sync block + inner null re-check | **`volatile` is load-bearing** — omit it and the partial-construction race returns |
| Eager `static final` | initialize at class load | simplest if always needed |
| Init-on-demand holder | nested `static final INSTANCE` | lazy + thread-safe, no sync |
| Enum singleton | single enum constant | JVM-guaranteed + serialization-safe (preferred per Effective Java) |

**Factory Method / Abstract Factory**: `PolygonFactory.getPolygon(sides)` (Factory Method); a generic `AbstractFactory<T>` + `FactoryProvider` selecting families (Abstract Factory).

**Builder** (three flavors):
- Classic fluent nested builder.
- **FreeBuilder** — annotation-processor-generated `*_Builder` with withers, `Optional` getters, collection adders, map putters, `buildPartial`.
- Curried / staged "type-safe builder" via single-method interfaces enforcing argument order at compile time.

**Prototype**: `Tree.copy()` clone hierarchy (avoids `Object.clone()`).

**Flyweight**: cache + share heavyweight objects keyed on intrinsic state via `computeIfAbsent` (`VehicleFactory.java`).

**Static factory methods** (Effective Java): named factories like `createWithDefaultCountry(...)` over public constructors.

**Immutables (library)**: `@Value.Immutable(prehash=true)`, `@Value.Default`, `@Value.Parameter`, `@Value.Auxiliary`; generated `ImmutablePerson.builder()...build()` and `.withAge(43)` copy-on-change withers.

**Top gotchas**:
- DCL without `volatile` reintroduces the broken-DCL partial-construction race — the single most important detail in the synchronization article.
- `PolygonFactory` returns `null` for unknown/6-side input (silent wrong answer).
- The Flyweight here caches the whole `Car` (no intrinsic/extrinsic split) — a simplified flyweight.
- `ExpensiveObjectProxy.object` is `private static`, leaking the lazy object across all proxies (a static-mutable-state trap, also relevant to the Proxy pattern).

**Current (mid-2026)**: Java 16 **records** (JEP 395) subsume most value-carrier boilerplate (ctor/accessors/`equals`/`hashCode`/`toString`, implicitly final). FreeBuilder is **archived** (latest 2.8.0, no active dev) — prefer records, with **Immutables** (now generating builders/withers/defaults *for* records) where records fall short. `new Integer(10)` → `Integer.valueOf` / autoboxing.

## Full content

Taught in `patterns/design-patterns-creational` plus the `immutables` value-class module, this is the full GoF creational catalogue with working, tested examples.

### Singleton

The Singleton article is the deepest, contrasting a deliberately-unsafe lazy baseline (`ClassSingleton`) against five thread-safety strategies: draconian `synchronized`, double-checked locking, eager `static final`, the initialization-on-demand holder idiom, and the enum singleton. The load-bearing detail is that DCL **requires** a `private static volatile` field — without `volatile`, a reader can observe a partially-constructed instance. The enum singleton (JVM-guaranteed and serialization-safe) is the recommended default.

### Factory and Builder

Factory Method appears as `PolygonFactory.getPolygon(sides)` (which returns `null` on unknown input — a validation weakness); Abstract Factory as a generic `AbstractFactory<T>` with a `FactoryProvider` selecting families. The Builder pattern is shown three ways: a classic fluent nested builder, FreeBuilder's annotation-processor-generated `*_Builder` (withers, `Optional` getters, collection adders, `buildPartial`), and a curried/staged type-safe builder using single-method interfaces to enforce argument order at compile time.

### Prototype, Flyweight, static factories, Immutables

Prototype clones via `Tree.copy()` (avoiding `Object.clone()`; note the copy is shallow on `Position`, safe only because `Position` is immutable). Flyweight caches and shares heavyweight objects via `computeIfAbsent` — though this example caches the whole object rather than splitting intrinsic/extrinsic state. Static factory methods follow Effective Java's named-constructor advice. The Immutables library generates value classes with `@Value.Immutable`/`@Value.Default`/`@Value.Parameter`/`@Value.Auxiliary`, builders, and copy-on-change withers.

### 2026 currency

- **Java records (final Java 16, JEP 395)** subsume most `immutables` / value-carrier boilerplate — auto constructor, accessors, `equals`/`hashCode`/`toString`, implicitly final. Immutables and Lombok still add builders / withers / defaults, and **Immutables now generates those for records** (current **2.12.2**, 2026-05-18). [Java Language Changes — Oracle](https://docs.oracle.com/en/java/javase/17/language/java-language-changes.html) · [org.immutables — mvnrepository](https://mvnrepository.com/artifact/org.immutables)
- **FreeBuilder is archived.** The repo (base pinned 2.4.1) was archived by its maintainer; latest release **2.8.0** (2022-10-09), no active development. Prefer records (+ Immutables for the builders/withers/defaults records lack). [inferred/FreeBuilder — GitHub (archived)](https://github.com/inferred/FreeBuilder) · [Builders, Withers, and Records — Sonar](https://www.sonarsource.com/blog/builders-withers-and-records-java-s-path-to-immutability/)
- **`new Integer(10)`** (deprecated boxing ctor) → `Integer.valueOf` / autoboxing.
- The Singleton idioms (DCL-with-volatile, init-on-demand holder, enum) remain fully idiomatic in 2026. The pattern concepts themselves are evergreen; only the value-class tooling moved.
