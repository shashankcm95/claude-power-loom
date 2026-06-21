---
kb_id: java-lang/generics-type-erasure
version: 1
tags:
  - java-lang
  - generics
  - type-system
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-oop-generics"
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-syntax"
  - "Wikipedia: Java version history: https://en.wikipedia.org/wiki/Java_version_history"
related:
  - java-lang/oop-class-design
  - java-lang/primitive-vs-object-types
  - java-lang/reflection-and-proxies
status: active
---

## Summary

**Concept**: Generic methods/classes, bounded + wildcard type params, compile-time type erasure, raw types, super type tokens, generic-array workarounds.
**Key APIs**: `<T extends Number>`, `<E extends Rankable & Serializable>`, `List<? extends Building>`, `ParameterizedType.getActualTypeArguments()`, `(E[]) new Object[n]`, `Class.cast`.
**Gotcha**: erasure defers `ClassCastException` to the *caller's* assignment — an unchecked `(T) o` is effectively a cast to `Object` inside the method, so the CCE surfaces where the caller assigns the result, not at the cast site.
**2026-currency**: super type tokens are the literal mechanism behind Jackson `TypeReference` / Spring `ParameterizedTypeReference`; erasure model unchanged.
**Sources**: `core-java-lang-oop-generics`, `core-java-lang-syntax`.

## Quick Reference

**Generic forms**:
- generic method/class with own type params (a generic constructor can have params independent of the class)
- bounded `<T extends Number>`
- multi-bound intersection `<E extends Rankable & Serializable>`
- upper-bounded wildcard `List<? extends Building>` (producer); lower-bounded `List<? super Integer>` (consumer) — the PECS rule

**Type erasure** (compile-time only): `Stack<Integer>` is just `Stack` at runtime. Consequences:
- bridge methods are synthesized
- heap pollution is possible
- a deferred `ClassCastException`: an unchecked `(T) o` is a cast to `Object` inside the method; the CCE surfaces at the caller's concrete-type assignment
- two overloads that erase to the same signature won't compile

**Raw types**: `List` vs `List<String>` — unsafe; a lazy `ClassCastException` on retrieval; triggers "unchecked conversion"/"unchecked cast" warnings.

**Super type token** (Gafter's gem) — capture a full parameterized type at runtime:

```java
abstract class TypeRef<T> { final Type type;
    TypeRef() { type = ((ParameterizedType) getClass().getGenericSuperclass())
                         .getActualTypeArguments()[0]; } }
```

This is the basis of Jackson `TypeReference` and Spring `ParameterizedTypeReference`.

**Generic-array workaround**: `(E[]) new Object[n]` (safe only if fully encapsulated); a safe runtime cast via `Class.cast`.

**Top gotchas**:
- Heap pollution via generic varargs — `List<String>...` is a `List[]`; aliasing it as `Object[]` and storing a `List<Integer>` compiles but throws CCE on read. `@SafeVarargs` only documents intent.
- `@SafeVarargs` is legal only on `final`/`static`/`private` methods.
- Erasure-deferred CCE makes the stack trace point at the caller, not the buggy cast.

**Current (mid-2026)**: erasure and the super-type-token workaround are unchanged. Record patterns (JDK 21) and `var` (JDK 10) reduce the need to spell out parameterized types but do not change erasure.

## Full content

Generics are a **compile-time** type-safety feature implemented by **erasure**: `Stack<Integer>` and `Stack<String>` are both just `Stack` at runtime. The compiler inserts casts and synthesizes *bridge methods* to preserve polymorphism across the erased boundary, but the type argument itself is gone. Three direct consequences follow. First, two methods whose signatures erase to the same shape will not compile. Second, an unchecked cast `(T) o` inside a generic method is — after erasure — a cast to `Object`, so a wrong type does not fail at the cast; the `ClassCastException` is **deferred** to the caller's concrete-type assignment, where the inserted cast actually runs. Third, raw types (`List` instead of `List<String>`) reintroduce exactly this lazy `ClassCastException`-on-retrieval and draw "unchecked" warnings.

Bounds constrain type parameters: a single bound `<T extends Number>`, a multi-bound *intersection* `<E extends Rankable & Serializable>`, and wildcards for use-site variance — `? extends T` for producers, `? super T` for consumers (the PECS mnemonic). A generic *constructor* may declare its own type parameters independent of the class's.

Because the type argument is erased, recovering a *full* parameterized type at runtime requires the **super type token** (Gafter's gem): subclass an abstract generic carrier anonymously and read `getGenericSuperclass()` as a `ParameterizedType`, then `getActualTypeArguments()`. This single trick is the literal foundation of Jackson `TypeReference` and Spring `ParameterizedTypeReference`. Creating a generic array is impossible directly; the standard workaround is `(E[]) new Object[n]`, safe only when the array never escapes its container, with `Class.cast` available for a checked runtime cast.

The sharpest practical trap is **heap pollution via generic varargs**: a `List<String>...` parameter is really a `List[]`, which can be aliased as `Object[]` and have a `List<Integer>` stored into it — this compiles, and only blows up with a `ClassCastException` on read. `@SafeVarargs` suppresses the warning but only *documents* that the author believes the method is safe; it is legal only on `final`, `static`, or `private` methods.

### 2026 currency

The erasure model and the super-type-token workaround are unchanged across all modern JDKs (17/21/25); the base's teaching carries forward verbatim ([Java version history](https://en.wikipedia.org/wiki/Java_version_history)). Two adjacent modern features reduce the *verbosity* of working with generics without touching erasure: `var` local-variable type inference (final JDK 10) lets you omit the parameterized type on the left of an assignment, and record patterns / nested destructuring (final JDK 21, [JEP 440](https://openjdk.org/jeps/440)) let you bind generic record components positionally. The super type token remains the mechanism behind framework `TypeReference`-style classes — the generic-erasure deserialization trap originates in this lane and is exercised by serialization frameworks (Jackson/Gson) downstream.
