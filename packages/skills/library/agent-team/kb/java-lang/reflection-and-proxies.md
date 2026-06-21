---
kb_id: java-lang/reflection-and-proxies
version: 1
tags:
  - java-lang
  - reflection
  - metaprogramming
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-reflection"
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-reflection-2"
  - "foojay: Unsafe is finally going away (JEP 471): https://foojay.io/today/unsafe-is-finally-going-away-embracing-safer-memory-access-with-jep-471/"
related:
  - java-lang/generics-type-erasure
  - java-lang/annotations-and-processing
  - java-lang/module-system-jpms
status: active
---

## Summary

**Concept**: Runtime reflection (inspect/read/write/invoke), JDK dynamic proxies, `MethodHandle`/`VarHandle` (faster, typed), and `StackWalker`.
**Key APIs**: `Class.getDeclaredFields`/`getSuperclass`, `Field.setAccessible(true)`, `Constructor.newInstance`, `Proxy.newProxyInstance(loader, ifaces, InvocationHandler)`, `MethodHandles.lookup().findVirtual(...)` + `invokeExact`, `VarHandle.compareAndSet`, `StackWalker.getCallerClass`.
**Gotcha**: `getDeclaredFields` excludes inherited fields (recurse `getSuperclass`); `setAccessible(true)` is required for private access AND blocked by JPMS strong encapsulation (Java 9+) without `opens`/`--add-opens`; `invokeExact` is signature-strict (an autoboxed arg → `WrongMethodTypeException`).
**2026-currency**: JDK 17 removed the `--illegal-access` escape hatch — deep reflection needs explicit `--add-opens`. `Unsafe` memory access deprecated (JEP 471, JDK 23) → migrate to `VarHandle`/FFM.
**Sources**: `core-java-reflection`, `core-java-reflection-2`.

## Quick Reference

**Reflection — inspect & access**:
- metadata: name/modifiers/superclass/interfaces/package
- enumerate fields/methods/constructors: `getFields` (public, inherited) vs `getDeclaredFields` (all access, **NOT inherited** — recurse `getSuperclass`)
- instantiate: `Constructor.newInstance(...)` (`Class.newInstance` deprecated)
- private access: `setAccessible(true)`, then typed `getInt`/`setInt`/...; `canAccess` replaces `isAccessible`; type mismatch → `IllegalArgumentException`, no access → `IllegalAccessException`
- parameter names need the `-parameters` compiler flag (else `arg0`; guard with `isNamePresent`)
- `Modifier.isStatic`/`isAbstract`/`isInterface` — an interface reports `isAbstract == true`, so proper-abstract needs `&& !isInterface`

**JDK dynamic proxy** (interface-only; class proxying needs CGLIB/ByteBuddy):

```java
Foo proxy = (Foo) Proxy.newProxyInstance(loader, new Class[]{Foo.class},
    (p, method, args) -> { /* all calls funnel here */ return null; });
```

`Callable<Void>` / `Function<T,Void>` must `return null` (the `Void`/`Void.TYPE` distinction).

**`MethodHandle`** (Java 7, faster than reflection): `MethodHandles.lookup()`/`privateLookupIn`, `findVirtual`/`findStatic`/`findConstructor`/`findGetter`/`unreflect`, `MethodType.methodType(...)`; `invoke` vs `invokeExact` (signature-strict — autoboxed arg → `WrongMethodTypeException`) vs `invokeWithArguments`; `asSpreader`/`bindTo`.

**`VarHandle`** (Java 9): typed field/array refs with plain/atomic (`compareAndSet`/`getAndAdd`)/bitwise access; atomic ops return the *previous* value.

**`StackWalker`** (Java 9): lazy stack inspection replacing `Thread.getStackTrace()`; `getCallerClass()`; options `SHOW_REFLECT_FRAMES`/`RETAIN_CLASS_REFERENCE`.

**Top gotchas**:
- `getDeclaredFields` excludes inherited fields.
- `setAccessible(true)` blocked by JPMS without `opens`/`--add-opens` → `InaccessibleObjectException`.
- `invokeExact` is signature-strict.

**Current (mid-2026)**: JDK 17 removed `--illegal-access`; deep reflection requires explicit `--add-opens`. `sun.misc.Unsafe` memory access deprecated (JEP 471, JDK 23) → `VarHandle` (CAS) / FFM `java.lang.foreign` (off-heap).

## Full content

Reflection lets code inspect and manipulate types at runtime. You read a `Class`'s metadata (name, modifiers, superclass, interfaces, package) and enumerate its members — with the critical distinction that `getDeclaredFields`/`getDeclaredMethods` return all access levels but **only the declaring class's own members**, so collecting inherited members means recursing up `getSuperclass()`. Instantiation goes through `Constructor.newInstance(...)` (the older `Class.newInstance` is deprecated). Reading and writing fields, including private ones, requires `setAccessible(true)`, after which typed accessors (`getInt`/`setInt`/...) apply box/widen/narrow rules — a type mismatch throws `IllegalArgumentException` and a blocked access throws `IllegalAccessException` (`canAccess` is the modern replacement for `isAccessible`). Recovering real parameter names needs the `-parameters` compiler flag (otherwise they are `arg0`, `arg1`; guard with `isNamePresent`). A subtle modifier fact: `Modifier.isAbstract` is `true` for interfaces, so a "proper abstract class" check needs `&& !Modifier.isInterface`.

**JDK dynamic proxies** generate an interface implementation at runtime: `Proxy.newProxyInstance(loader, interfaces[], InvocationHandler)` funnels every interface call through `invoke(proxy, method, args)`. It is **interface-only** — proxying a concrete class needs CGLIB or ByteBuddy. The `Void` quirk shows up here: a `Callable<Void>`/`Function<T,Void>` must `return null`, and `Void.TYPE` is distinct from the `Void` class.

For performance and type-strictness, the **`MethodHandle`** API (Java 7) is faster than reflection: obtain a `Lookup` (`lookup()`/`publicLookup()`/`privateLookupIn`), then `findVirtual`/`findStatic`/`findConstructor`/`findGetter`/`unreflect` against a `MethodType`. Invocation has three modes — `invoke` (applies conversions), `invokeExact` (signature-strict; an autoboxed argument throws `WrongMethodTypeException`), and `invokeWithArguments` — plus combinators `asSpreader`/`bindTo`. **`VarHandle`** (Java 9) provides typed field/array references with plain, atomic (`compareAndSet`, `getAndAdd`), and bitwise (`getAndBitwiseOr`) access modes; its atomic operations return the *previous* value. **`StackWalker`** (Java 9) replaces the eager `Thread.getStackTrace()`/`Throwable` idiom with lazy, option-driven stack inspection (`getCallerClass()`, `SHOW_REFLECT_FRAMES`, `RETAIN_CLASS_REFERENCE`).

Reflection also intersects with **generics** (the super type token recovers a parameterized type — see `java-lang/generics-type-erasure`) and **annotations** (only `@Retention(RUNTIME)` annotations are reflection-visible — see `java-lang/annotations-and-processing`). Synthetic constructs surface here too: compiler-generated members detected via `Member.isSynthetic()` and the erasure-born `Method.isBridge()`.

### 2026 currency

**JPMS strong encapsulation — hardened (STRONGER than the base's "since Java 9").** The `--illegal-access` escape hatch was **removed in JDK 17**; deep reflection into JDK internals (or any module that does not `opens` the package) now requires an explicit `--add-opens` or module `opens` directive, else `InaccessibleObjectException` ([Java version history](https://en.wikipedia.org/wiki/Java_version_history)). The `tools.jar` / `com.sun.tools.javac.*` internals were modularized into `jdk.compiler` and likewise need `--add-exports`/`--add-opens`, and remain unsupported across releases.

**`sun.misc.Unsafe` memory access — being removed (JEP 471, JDK 23).** Compile-time deprecated as a staged removal; migrate CAS/atomics to **`VarHandle`** (JDK 9) and off-heap memory to **FFM `java.lang.foreign`** (final JDK 22) ([foojay: JEP 471](https://foojay.io/today/unsafe-is-finally-going-away-embracing-safer-memory-access-with-jep-471/)). The reflection, dynamic-proxy, `MethodHandle`, `VarHandle`, and `StackWalker` surfaces are otherwise stable and current.
