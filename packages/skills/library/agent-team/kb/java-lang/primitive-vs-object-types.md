---
kb_id: java-lang/primitive-vs-object-types
version: 1
tags:
  - java-lang
  - type-system
  - primitives
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-2"
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-3"
  - "JRebel: What's New With Java 25 (JEP 519 compact object headers): https://www.jrebel.com/blog/java-25"
related:
  - java-lang/generics-type-erasure
  - java-lang/date-time-api
status: active
---

## Summary

**Concept**: The 8 primitives + wrapper types, autoboxing/unboxing, the boxed-`==` cache trap, primitive conversions, `Class` introspection, and floating-point comparison.
**Key APIs**: `Integer.valueOf`/`parseInt`, `Objects.equals`, `Arrays.stream(int[]).boxed()`, Apache `ArrayUtils.toObject/toPrimitive`, `Class.isInstance` / `isAssignableFrom`, `getClass()` vs `T.class`.
**Gotcha**: `Integer`/`Long` cache only −128..127, so `127L == 127L` is true but `128L == 128L` is false — always `.equals`/`Objects.equals`/unbox. Never `==` on doubles (FP error) — use epsilon.
**2026-currency**: wrapper constructors no longer slated for removal (JDK-8354338, fixVersion 25) but still deprecated — prefer `valueOf`. Compact object headers (JDK 25, JEP 519) shrink object overhead to 8 bytes.
**Sources**: `core-java-lang-2`, `core-java-lang-3`.

## Quick Reference

**8 primitives + wrappers**: `byte/Byte`, `short/Short`, `int/Integer`, `long/Long`, `float/Float`, `double/Double`, `char/Character`, `boolean/Boolean`.

**Conversions**:
- widening is implicit (`int → long → float → double`)
- narrowing needs an explicit cast and can truncate/wrap (`(byte) 130 == -126`)
- `char` is **unsigned 16-bit** (byte → char widens through int sign-extension)
- autoboxing/unboxing is automatic; wrapper parsing `Integer.parseInt` / `Boolean.parseBoolean`

**Boxed `==` cache trap**:

```java
Integer a = 127, b = 127; a == b; // true  (cached -128..127)
Integer c = 128, d = 128; c == d; // FALSE (outside cache)
```

Always compare wrappers with `.equals` / `Objects.equals`, or unbox.

**Array conversions**: autoboxing loop, `Arrays.stream(int[]).boxed()`, Apache `ArrayUtils.toObject/toPrimitive`. Runtime detection: `ClassUtils.isPrimitiveOrWrapper`, Guava `Primitives`.

**Floating-point comparison**: never `==` (FP accumulation error) — use epsilon, Guava `DoubleMath.fuzzyEquals`, Apache `Precision.equals`, or a JUnit delta.

**`Class` introspection**:
- `isInstance(obj)` = reflective `instanceof` (object-based) vs `isAssignableFrom` (class-to-class)
- direction trap: `Parent.class.isAssignableFrom(Child.class)` is `true` (easy to invert)
- `getClass()` (runtime type) vs `T.class` (static literal; only `.class` works for primitives/interfaces/abstract)
- name flavors: `getSimpleName`/`getName`/`getCanonicalName`/`getTypeName` (arrays `[I`, inner `$`, anonymous numbered `$1` with `null` canonical name)

**Top gotchas**:
- `Boolean.getBoolean("true")` returns `false` — it reads a *system property* named by the string, not the string's value.
- `Boolean.parseBoolean("127") == false`.
- `isAssignableFrom` direction is easy to invert.

**Current (mid-2026)**: wrapper constructors (`new Integer(...)` etc.) are still `@Deprecated` but **no longer `forRemoval`** (the Java-9 tag was reversed in JDK 25) — keep using `Integer.valueOf`/`parseInt`. JDK 25's compact object headers (JEP 519) cut object header overhead to 8 bytes.

## Full content

Java has eight **primitive** types and a matching boxed **wrapper** for each. Conversions between numeric primitives are *widening* (implicit and lossless along `int → long → float → double`) or *narrowing* (requires an explicit cast and can truncate or wrap — `(byte) 130` is `-126`). `char` is special: it is an **unsigned** 16-bit type, so a `byte → char` conversion widens *through* `int` with sign-extension. Autoboxing and unboxing convert silently between a primitive and its wrapper, and the wrapper classes parse strings via `Integer.parseInt`, `Boolean.parseBoolean`, etc.

The most cited identity bug is the **boxed `==` cache trap**. The JVM caches small wrapper instances (`Integer`/`Long` for −128..127, plus all `Boolean`/`Character` in the low range), so `127L == 127L` is `true` because both refer to the cached object, while `128L == 128L` is `false` because each autoboxes to a fresh object. The rule is absolute: compare wrappers with `.equals` / `Objects.equals`, or unbox to primitives. The analogous floating-point rule is to never compare `double`/`float` with `==` — accumulation error means equal-looking values differ in the low bits; use an epsilon, Guava `DoubleMath.fuzzyEquals`, Apache `Precision.equals`, or a JUnit delta.

Converting between primitive and wrapper *arrays* requires an explicit step — an autoboxing loop, `Arrays.stream(int[]).boxed()`, or Apache `ArrayUtils.toObject` / `toPrimitive`. Detecting whether a `Class` is a primitive or wrapper at runtime uses `ClassUtils.isPrimitiveOrWrapper` or Guava `Primitives`.

`Class` introspection has two confusing pairs. `isInstance(obj)` is a reflective, object-based `instanceof`; `isAssignableFrom(other)` is a class-to-class test whose direction is easy to invert — `Parent.class.isAssignableFrom(Child.class)` is `true`. `getClass()` returns the runtime type while `T.class` is a static literal (and only `.class` is available for primitives, interfaces, and abstract types). The name accessors differ too: `getSimpleName`/`getName`/`getCanonicalName`/`getTypeName` render arrays (`[I`), inner classes (`$`), and anonymous classes (numbered `$1`, with a `null` canonical name) differently. A perennial trap unrelated to types: `Boolean.getBoolean("true")` returns `false` because it reads a *system property* named by the argument, not the argument's value.

### 2026 currency

**Wrapper constructors — no longer slated for removal (CORRECTED).** `new Integer(...)`/`new Long(...)` and the other wrapper constructors were deprecated-for-removal in Java 9, but `forRemoval=true` was **dropped in JDK 25** ([JDK-8354338](https://bugs.openjdk.org/browse/JDK-8354338), fixVersion 25, "No longer deprecate wrapper class constructors for removal"). They remain `@Deprecated` — keep preferring `Integer.valueOf` / `parseInt` — but are no longer on the chopping block.

**Compact object headers — final JDK 25 ([JEP 519](https://www.jrebel.com/blog/java-25)).** The Java object header shrinks to 8 bytes, directly relevant to the primitive-vs-object memory-footprint tradeoff this lane teaches: the per-object overhead that motivates primitive arrays over wrapper arrays is now smaller. The boxed-`==` cache semantics, conversion rules, and `Class` introspection are otherwise unchanged across modern JDKs.
