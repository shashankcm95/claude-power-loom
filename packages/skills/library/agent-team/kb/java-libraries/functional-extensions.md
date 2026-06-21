---
kb_id: java-libraries/functional-extensions
version: 1
tags:
  - java-libraries
  - functional
  - streams
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: libraries-5 (streamex/jool/fugue), libraries-6 (protonpack/fj), libraries-4 (distinctby/noexception/vavr)"
  - "endoflife.date / Eclipse Temurin (Java 9 Stream.takeWhile/dropWhile context)"
related:
  - java-libraries/guava-collections
status: active
---

## Summary

**Concept**: libraries that extend Java Streams + add functional data types — Protonpack/StreamEx/jOOL ("extra Stream ops", mostly redundant on Java 9+), and Vavr/Fugue/Functional-Java/NoException (functional data types `Option`/`Either`/`Try`). Vavr is the 2026 survivor.
**Key APIs**: Protonpack `StreamUtils.takeWhile`/`zip`/`windowed`; StreamEx `StreamEx`/`EntryStream`/`select(Type)`; jOOL `Seq` (`innerJoin`/`crossJoin`/`Unchecked`); Vavr `Tuple`/`Option`/`Either`/`Try`; the `distinctByKey` stateful-predicate idiom.
**Gotcha**: Protonpack/fj `takeWhile`/`takeUntil` were backfilled before Java 9 — now redundant with `Stream.takeWhile`/`dropWhile`; `Stream.distinct()` only uses `equals`, so distinct-by-derived-key needs a stateful `Predicate` over `ConcurrentHashMap.putIfAbsent`; Fugue `Option.some(null)` throws (unlike `Optional.ofNullable`).
**2026-currency**: Vavr survives; Fugue abandoned (use Vavr/`Optional`); much of the "extra Stream ops" cluster is JDK-9-redundant.
**Sources**: Baeldung `libraries-5`/`libraries-6`/`libraries-4` modules.

## Quick Reference

**The "extra Stream ops" cluster (mostly redundant on Java 9+):**

| Library | What it adds | 2026 note |
|---|---|---|
| **Protonpack** | `StreamUtils.takeWhile`/`takeUntil`/`skipWhile`, `zip`/`zipWithIndex`/`unfold`/`windowed`/`aggregate` | `takeWhile`/`dropWhile` now in JDK 9 |
| **StreamEx** | `StreamEx`/`IntStreamEx`/`EntryStream`, `select(Type)`, `toMap`, key/value pair ops | distinct(keyExtractor) handy |
| **jOOL / jOOλ** | `Seq` with SQL-ish `innerJoin`/`leftOuterJoin`/`crossJoin`, `cycle`/`duplicate`/`zip`, `Unchecked` wrappers | checked-exception lambdas |

**Functional data types:**

- **Vavr** (the 2026 survivor) — `Tuple`, `Option`, `Either`, `Try`, persistent collections.
- **Atlassian Fugue** — `Option`/`Either`/`Try`/`Pair` — **abandoned**; `Option.some(null)` *throws* (unlike `Optional.ofNullable`).
- **Functional Java (fj)** — `F<A,B>`, `map`/`bind`/`foldLeft`.
- **NoException** — `Exceptions.log().run(...)` to log-instead-of-propagate.

**Distinct-by-derived-key** (since `Stream.distinct()` only uses `equals`):

```java
public static <T> Predicate<T> distinctByKey(Function<? super T,?> keyEx) {
    Map<Object,Boolean> seen = new ConcurrentHashMap<>();
    return t -> seen.putIfAbsent(keyEx.apply(t), Boolean.TRUE) == null;
}
// or Eclipse / StreamEx distinct(keyExtractor) / Vavr
```

**Merging streams:** `Stream.concat(s1,s2)` (two), nested concat (three), `Stream.of(s1..sn).flatMap(identity)` (N); plus jOOL/Protonpack/StreamEx variants.

**Guava legacy functional toolkit** (pre-Java-8): `com.google.common.base.{Predicate,Function,Supplier}`, `Predicates`/`Functions`, `FluentIterable`, `Suppliers.memoize`/`memoizeWithExpiration`, `Preconditions`, `CharMatcher`.

**Current (mid-2026):** Vavr survives; Fugue is abandoned (use Vavr or JDK `Optional`); the "extra Stream ops" libraries are largely obsoleted by JDK 9+ Stream methods.

## Full content

This cluster is two distinct things bundled by intent: libraries that *extend the Stream API* and libraries that *add functional data types*. The extension libraries are, by 2026, mostly historical artifacts. **Protonpack** backfilled `takeWhile`/`takeUntil`/`skipWhile` before Java 9 shipped `Stream.takeWhile`/`dropWhile`, and added `zip`/`zipWithIndex`/`unfold`/`windowed`/`aggregate`. **StreamEx** offers a richer Stream subclass family (`StreamEx`, `IntStreamEx`, `EntryStream`) with key/value pair operations, `select(Type)` for type-filtering, and `distinct(keyExtractor)`. **jOOL/jOOλ** contributes `Seq`, a sequence type with SQL-style joins (`innerJoin`, `leftOuterJoin`, `crossJoin`), `cycle`/`duplicate`/`zip`, and `Unchecked` wrappers that let you use methods throwing checked exceptions inside lambdas.

The functional-data-type libraries are where the lasting value is. **Vavr** is the 2026 survivor: immutable `Tuple` types, `Option`, `Either`, `Try`, and persistent collections, all with a return-new contract. **Atlassian Fugue** offers the same shapes (`Option`/`Either`/`Try`/`Pair`) but is abandoned — and carries a subtle trap: `Fugue.Option.some(null)` *throws*, unlike `Optional.ofNullable(null)` which yields empty. **Functional Java (fj)** provides `F<A,B>` function objects with `map`/`bind`/`foldLeft`, and **NoException** offers `Exceptions.log().run(...)` to log-instead-of-propagate.

Two recurring idioms are worth memorizing. Because `Stream.distinct()` only uses `equals`, distinguishing by a *derived key* requires a stateful `Predicate` over `ConcurrentHashMap.putIfAbsent` (the `distinctByKey` helper) — or the built-in `distinct(keyExtractor)` from Eclipse Collections, StreamEx, or Vavr. Merging streams scales as `Stream.concat(s1,s2)` for two, nested concat for three, and `Stream.of(s1..sn).flatMap(identity)` for N. Finally, Guava's pre-Java-8 functional toolkit (`com.google.common.base.{Predicate,Function,Supplier}`, `FluentIterable`, `Suppliers.memoize`/`memoizeWithExpiration`, `CharMatcher`) is legacy but still appears; `Suppliers.memoize` overlaps the JDK 25 `Stable Values` feature.

### 2026 currency

- **Vavr** remains the live functional-data-type choice; **Atlassian Fugue** is abandoned — use Vavr or JDK `Optional`. The base's abandoned-library finding holds. (See also the JVM-languages lane, where Vavr appears as a functional language idiom; the persistent-collection mutate-vs-return-new contract is the shared concept.)
- The "extra Stream ops" cluster (Protonpack/fj `takeWhile`/`takeUntil`) is obsoleted by **`Stream.takeWhile`/`dropWhile` (Java 9)**; `Streams.stream(Collection)` is deprecated; `ImmutableMap.of` → `Map.of` (Java 9). [endoflife.date / Eclipse Temurin](https://endoflife.date/eclipse-temurin)
- Guava `Suppliers.memoize` overlaps JDK 25 `Stable Values` (JEP 455 — lazy thread-safe init). [What's new in Java 25 (Keyhole)](https://keyholesoftware.com/java-25-whats-new/)
