---
kb_id: jvm-languages/vavr-persistent-collections
version: 1
tags:
  - jvm-languages
  - vavr
  - collections
  - immutability
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: vavr"
  - "Baeldung tutorials (eugenp/tutorials) module: vavr-2"
  - "Baeldung tutorials (eugenp/tutorials) module: java-vavr-stream"
  - "vavr-io/vavr releases (https://github.com/vavr-io/vavr/releases)"
related:
  - jvm-languages/vavr-control-types
  - jvm-languages/vavr-functions-pattern-matching
status: active
---

## Summary

**Concept**: Vavr's immutable persistent collections with structural sharing, the `asJava`/`asJavaMutable` interop contract, and the Vavr-vs-JDK `Stream` distinction.
**Key APIs**: `List`/`Stream`/`Array`/`Vector`/`Queue`/`HashSet`/`TreeSet`/`HashMap`/`TreeMap`; Vavr→Java `toJavaList`/`toJavaMap`/`toJavaOptional`/`toLinkedSet`; Java→Vavr `List.ofAll`/`Stream.ofAll`; `asJava()` (immutable view) vs `asJavaMutable()`.
**Gotcha**: `asJava().add()` throws `UnsupportedOperationException` (use `asJavaMutable()`); a "modified" persistent collection SHARES node instances with the original (`assertSame`) — not a deep copy; Vavr `Stream` is lazy/persistent/INDEXED, JDK `Stream` is one-shot with no element access.
**2026-currency**: Vavr 1.0.1 (2026-03-01); collections + structural sharing unchanged from 0.9.x.
**Sources**: `vavr`, `vavr-2`, `java-vavr-stream` modules; vavr-io/vavr releases.

## Quick Reference

**Persistent collection types**: `List`, `Stream` (lazy persistent indexed linked list), `Array`, `Vector`, `Queue`, `CharSeq`, `HashSet`, `TreeSet`/`SortedSet`, `BitSet`, `HashMap`/`Map`, `TreeMap`/`SortedMap`.

**Structural sharing** — "modifications" share unchanged nodes:

```java
List<Integer> a = List.of(1, 2, 3);
List<Integer> b = a.tail().prepend(0);
assertSame(a.tail(), ...);   // shared nodes — NOT a deep copy
```

**Java interop** (the recurring trap):

```java
java.util.List<T> view = vavrList.asJava();        // IMMUTABLE view
view.add(x);                                         // throws UnsupportedOperationException
java.util.List<T> mut = vavrList.asJavaMutable();   // mutable copy
// other Vavr→Java: toJavaList / toJavaParallelStream / toJavaMap / toJavaOptional / toLinkedSet
// Java→Vavr: List.ofAll(javaColl) / Stream.ofAll(javaStream)
```

**Vavr `Stream` vs JDK `Stream`**:

| | Vavr `Stream` | JDK `Stream` |
|---|---|---|
| Evaluation | lazy, persistent | lazy, one-shot pull |
| Element access | YES — `.get(i)` / `.indexOf` / `.insert` / `.remove` (return new) | NO |
| Reuse | reusable (snapshot semantics) | single-use |
| Custom de-dup | `distinctBy(comparator)` | n/a |

**Current (mid-2026)**: `io.vavr:vavr:1.0.1` (2026-03-01); persistent collections, structural sharing, and the `asJava`/`asJavaMutable` contract are unchanged from the 0.9.x corpus — the 1.0.x line is deliberately Java-8-compatible.

## Full content

Vavr's collections are persistent (immutable + efficient) data structures that complement its control types.

**The collection family** is broad: `List`, `Stream`, `Array`, `Vector`, `Queue`, `CharSeq`, `HashSet`, `TreeSet`/`SortedSet`, `BitSet`, `HashMap`/`Map`, `TreeMap`/`SortedMap`. Each is immutable: "mutating" operations return a new collection.

**Structural sharing** is what makes this efficient — a derived collection shares the unchanged node instances with its parent rather than deep-copying. The corpus demonstrates this with `assertSame`: `intList.tail().prepend(0)` shares nodes with the original. The practical lesson is to NOT assume a Vavr "copy" is a deep copy. Evidence: `collections/CollectionAPIUnitTest.java:97-111`.

**Java interop** carries the lane-level Vavr trap: `asJava()` returns an *immutable view*, so `asJava().add(x)` throws `UnsupportedOperationException`; you need `asJavaMutable()` for a mutable Java collection. Other conversions: Vavr→Java via `toJavaList`/`toJavaParallelStream`/`toJavaMap`/`toJavaOptional`/`toLinkedSet`; Java→Vavr via `List.ofAll`/`Stream.ofAll`. This trap recurs across the `vavr` and `vavr-2` modules, making it a true lane-level idiom. Evidence: `collections/CollectionAPIUnitTest.java:338-354`; `vavr-2/.../interoperability/CollectionsInteroperabilityUnitTest.java:62-76`.

**Vavr `Stream` vs JDK `Stream`** (from `java-vavr-stream`): the Vavr stream is a lazy, persistent, *indexed* linked list — it supports element access (`.get(i)`, `.indexOf`), insertion/removal (`.insert`, `.remove`, each returning a new stream), and snapshot semantics over a wrapped mutable source, plus `distinctBy(comparator)` for custom de-duplication. The JDK stream, by contrast, is a one-shot pull pipeline with no element access and single-use semantics. Caveat: the `java-vavr-stream` module is demo-only (no tests/assertions), `jdkFlatMapping()` leaves the terminal op commented so the pipeline never runs, and `vavrParallelStreamAccess()` is misnamed (no actual parallelism). Evidence: `java-vavr-stream/.../VavrSampler.java:31-97`.

### 2026 currency

- **Vavr 1.0.0 (first stable major) shipped 2026-02-09; 1.0.1 is current (2026-03-01).** The 1.0.x line is deliberately Java-8-compatible — no API revolution vs 0.10/0.11 — so persistent collections, structural sharing, and the `asJava`/`asJavaMutable` contract all carry forward unchanged. [vavr-io/vavr releases](https://github.com/vavr-io/vavr/releases) · [Vavr roadmap #2953](https://github.com/orgs/vavr-io/discussions/2953)
- **Spring Data still supports Vavr collection return types** (`Seq`/`Option`) on repositories, so the integration carries forward — but on Spring Boot 3+/Spring 6+ the JPA entity must use `jakarta.persistence.*` rather than `javax.persistence.*`. [Vavr support in Spring Data (Baeldung)](https://www.baeldung.com/spring-vavr)
- **No direct JDK equivalent** exists for Vavr's persistent collections with structural sharing — this remains a reason to reach for Vavr even as the JDK absorbs pattern matching and records.
