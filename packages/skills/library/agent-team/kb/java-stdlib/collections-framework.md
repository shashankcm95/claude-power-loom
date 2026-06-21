---
kb_id: java-stdlib/collections-framework
version: 1
tags:
  - java-stdlib
  - collections
  - data-structures
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-collections, core-java-collections-{2,3,4}, core-java-collections-array-list, core-java-collections-list{,-2,-3}, core-java-collections-set"
  - "JEP 431: Sequenced Collections (https://openjdk.org/jeps/431)"
related:
  - java-stdlib/map-implementations
  - java-stdlib/sequenced-collections
  - java-stdlib/iteration-and-modification
  - java-stdlib/collection-conversions
  - java-stdlib/stream-api
  - java-stdlib/arrays
status: active
---

## Summary

**Concept**: The `java.util` collections framework — `List` / `Set` / `Deque` / `Queue` implementations, their performance characteristics, and the legacy-vs-modern guidance. (Maps are large enough to be their own doc — see `java-stdlib/map-implementations`.)
**Key APIs**: `ArrayList`, `LinkedList`, `HashSet`, `TreeSet`, `EnumSet`, `ArrayDeque`, `PriorityQueue`; `Arrays.asList` (fixed-size view); `List.of`/`Set.of` (JDK 9 immutables).
**Gotcha**: `Arrays.asList` is a fixed-size array-backed view (`add`/`remove` throw `UnsupportedOperationException`); `list.remove(int)` is by index, `list.remove(Object)` by value.
**2026-currency**: `ArrayDeque` is the modern stack/queue over legacy `Stack`/`Vector`; `Set.of`/`List.of` over Guava `ImmutableList`; Sequenced Collections (JDK 21) add a uniform first/last API.
**Sources**: Baeldung `core-java-collections*` modules + JEP 431.

## Quick Reference

**Pick the implementation by access pattern:**

| Need | Use | Notes |
|---|---|---|
| Indexed random access, append | `ArrayList` | O(1) get; grows in place via `Arrays.copyOf` |
| Frequent head/tail insert | `ArrayDeque` (or `LinkedList`) | `ArrayDeque` faster, no per-node object |
| Stack (LIFO) | `ArrayDeque` (`push`/`pop`/`peek`) | NOT legacy `java.util.Stack` (extends `Vector`, iterates bottom→top) |
| Queue (FIFO) | `ArrayDeque` (`offer`/`poll`) | |
| Priority order | `PriorityQueue` | min-heap, natural order or `Comparator` |
| Unique, unordered, O(1) | `HashSet` | one null allowed |
| Unique, sorted/navigable | `TreeSet` | `NavigableSet`; rejects null → NPE |
| Unique enum constants | `EnumSet` | bit-vector; `allOf`/`noneOf`/`complementOf`/`range` |

**Canonical traps:**

- **`Arrays.asList`** — fixed-size, array-backed `Arrays$ArrayList` view: `add`/`remove` throw `UnsupportedOperationException`, element writes alias the backing array, and a cast to `java.util.ArrayList` throws `ClassCastException`. `Arrays.asList(int[])` yields a **single-element** `List<int[]>`, not `List<Integer>`. The single biggest recurring trap in the corpus.
- **`remove(int)` vs `remove(Object)`** — `list.remove(0)` removes by index; `list.remove(Integer.valueOf(0))` removes by value.
- **Shallow copies everywhere** — copy-constructors, `addAll`, `clone()` are shallow (element refs shared). `Collections.copy(dest,src)` requires `dest` pre-sized to `src.size()`.
- **Dedup preserving order** — `LinkedHashSet` (ordered) vs `HashSet` (unordered) vs Stream `distinct()`.
- **Performance** — `HashSet.contains` is O(1) vs `ArrayList.contains` O(n); `toArray(new T[0])` ≥ `toArray(new T[size])` on modern JITs (overturns old "pre-size" advice). `BitSet` is bit-per-flag vs `boolean[]`.

**Immutables:** `List.of` / `Set.of` (JDK 9) for true snapshots; `Collections.unmodifiableList` is a live **view**, not a copy.

**Current (mid-2026):** `ArrayDeque` replaces legacy `Stack`/`Vector`; `List.of`/`Set.of` (JDK 9) replace double-brace init and Guava `ImmutableList`; Sequenced Collections (JEP 431, JDK 21) retrofit `getFirst`/`getLast`/`reversed` onto `List`/`Deque`/`LinkedHashSet`/`SortedSet`.

## Full content

The `java.util` collections framework is a hierarchy of interfaces (`Collection` → `List` / `Set` / `Queue` / `Deque`) with multiple implementations trading off ordering, uniqueness, and access cost.

**Lists.** `ArrayList` is the default — capacity (the backing array length) is distinct from size (the element count); it grows in place by reallocating via `Arrays.copyOf`. `LinkedList` is a doubly-linked list better for frequent head/tail mutation but with O(n) indexed access. The recurring traps live here: `Arrays.asList` returns a fixed-size array-backed view (`Arrays$ArrayList`, not `java.util.ArrayList`), so `add`/`remove` throw `UnsupportedOperationException`, mutations alias the backing array, and a cast to `java.util.ArrayList` throws `ClassCastException`. The `remove(int)` (by index) vs `remove(Object)` (by value) overload trap is resolved with `list.remove(Integer.valueOf(x))` for value removal.

**Sets.** `HashSet` gives O(1) `contains`/`add` and allows one null. `TreeSet` implements `NavigableSet`/`SortedSet` (`first`/`last`/`headSet`/`tailSet`/`subSet`/`descendingIterator`) but rejects null with an NPE. `EnumSet` is a compact bit-vector representation with factory methods `allOf`/`noneOf`/`complementOf`/`range`/`copyOf`. Set algebra (union/intersection/difference) is done via JDK copies, Streams, Guava `Sets.*` views, or Apache `SetUtils`.

**Deque / Queue / Stack.** `ArrayDeque` serves as both a stack (`push`/`pop`/`peek` at the head) and a queue (`offer`/`poll` at the tail) and is the modern replacement for the legacy `java.util.Stack` (which extends `Vector`, iterates bottom→top, and leaks index access) and legacy LIFO uses. `PriorityQueue` is a min-heap in natural order (or a supplied `Comparator`).

**Performance.** Benchmarked throughout (JMH/JOL): `HashSet.contains` O(1) vs `ArrayList.contains` O(n); `toArray(new T[0])` is at least as fast as `toArray(new T[size])` on modern JITs (which overturns the old "always pre-size the array" advice); `BitSet` (bit-per-flag) beats `boolean[]` for dense flag sets; hashCode quality drives bucket distribution.

### 2026 currency

- **Sequenced Collections (JEP 431, JDK 21)** are the biggest structural gap in the Java-8 corpus. Three interfaces give every ordered collection a uniform first/last API: `SequencedCollection<E>` (`getFirst`/`getLast`/`addFirst`/`addLast`/`removeFirst`/`removeLast`/`reversed`), `SequencedSet<E>`, and `SequencedMap<K,V>`. Retrofitted onto `List`/`Deque`/`LinkedHashSet`/`SortedSet`/`LinkedHashMap`/`SortedMap`, replacing hand-rolled idioms like `list.get(list.size()-1)` → `list.getLast()`. [JEP 431: Sequenced Collections](https://openjdk.org/jeps/431) · [Oracle — Creating Sequenced Collections (JDK 21)](https://docs.oracle.com/en/java/javase/21/core/creating-sequenced-collections-sets-and-maps.html)
- **Immutable factories** `List.of`/`Set.of`/`Map.of` (JDK 9) supersede double-brace init, `Arrays.asList`, and Guava `ImmutableList`/`ImmutableMap`. [JEP 269 / Oracle collection factory docs]
- **`ArrayDeque` over `Stack`/`Vector`** remains current — the legacy synchronized classes are retained only for compatibility.
- **Primitive collections** — Trove (`gnu.trove`) and Colt (`cern.colt`, dead ~2004) are abandoned; the live alternatives are **Eclipse Collections** (13.0.0, Java-17 baseline), **fastutil**, and **HPPC**.
- The framework hierarchy itself carries forward unchanged; the 2026 additions are successors and gap-fills layered on top.
