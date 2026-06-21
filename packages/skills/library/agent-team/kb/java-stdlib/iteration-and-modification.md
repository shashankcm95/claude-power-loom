---
kb_id: java-stdlib/iteration-and-modification
version: 1
tags:
  - java-stdlib
  - collections
  - iteration
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-collections, core-java-collections-{2,3}, core-java-collections-list"
  - "Oracle — java.util Iterator / ConcurrentModificationException Javadoc"
related:
  - java-stdlib/collections-framework
  - java-stdlib/map-implementations
  - java-stdlib/stream-api
status: active
---

## Summary

**Concept**: Safely iterating and mutating `java.util` collections — `Iterator`/`ListIterator`, fail-fast vs fail-safe semantics, and the only safe in-loop removal idioms.
**Key APIs**: `Iterator.remove()`, `Collection.removeIf(Predicate)`, `ListIterator` (`set`/`add`/`previous`/`forEachRemaining`); live `keySet`/`values`/`entrySet` views.
**Gotcha**: structural modification during enhanced-for iteration throws `ConcurrentModificationException` (best-effort, can defer to the next `next()`); indexed-for removal skips the next element unless you decrement the index.
**2026-currency**: `ConcurrentHashMap` weakly-consistent iterators are still the fail-safe baseline; `removeIf` remains the idiomatic predicate-removal.
**Sources**: Baeldung `core-java-collections*` + `core-java-collections-list` (RemoveAll, Iterators).

## Quick Reference

**Safe in-loop removal — only these work:**

```java
Iterator<T> it = list.iterator();
while (it.hasNext()) { if (test(it.next())) it.remove(); }   // Iterator.remove

list.removeIf(x -> test(x));                                  // predicate removal (Java 8)
```

**Unsafe — throws `ConcurrentModificationException`:**

```java
for (T x : list) { if (test(x)) list.remove(x); }            // enhanced-for removal = classic CME
```

**Iterator mechanics:**

- `Iterator` — `hasNext`/`next`/`remove`/`forEachRemaining`.
- `ListIterator` — bidirectional (`previous`/`hasPrevious`/`nextIndex`/`previousIndex`) plus in-place `set` and `add`.
- **Indexed-for trap** — removing by index shifts subsequent elements left; `for (int i...) list.remove(i)` skips the next element unless you decrement `i`.

**Fail-fast vs fail-safe:**

| Kind | Behavior | Examples |
|---|---|---|
| Fail-fast | throws `ConcurrentModificationException` on structural mod during iteration (best-effort, not guaranteed) | `ArrayList`, `HashMap`, `HashSet`, `Collections.synchronizedMap` |
| Fail-safe (weakly consistent) | iterates over a snapshot/live state, never throws CME | `ConcurrentHashMap`, `CopyOnWriteArrayList` |

**Live views:** `map.keySet()`, `map.values()`, `map.entrySet()` are live views over the map — removing from the view removes from the map; their iterators support safe removal.

**Current (mid-2026):** `removeIf` is the idiomatic predicate-removal; fail-safe iteration via concurrent collections is unchanged; under Virtual Threads (JDK 21) the concurrent-collection guidance still holds.

## Full content

Iteration over a `java.util` collection is governed by the `Iterator` contract. The only safe way to remove an element while iterating with an `Iterator` is `Iterator.remove()`; the only safe predicate-batch removal is `Collection.removeIf(Predicate)` (Java 8). Any structural modification of a fail-fast collection through the collection itself during iteration triggers a `ConcurrentModificationException` — the classic instance being an `add`/`remove` call inside an enhanced-for loop. Fail-fast detection is best-effort: the JVM may defer the exception to the next `next()` call rather than the exact mutating call, so it is a debugging aid, not a guarantee.

`ListIterator` extends `Iterator` with bidirectional traversal (`previous`/`hasPrevious`), positional queries (`nextIndex`/`previousIndex`), and in-place `set`/`add`. An indexed `for` loop that removes by index must account for the left-shift of subsequent elements — failing to decrement the index skips the element that slid into the removed slot.

Fail-safe (weakly consistent) iteration is provided by the concurrent collections (`ConcurrentHashMap`, `CopyOnWriteArrayList`), which never throw `ConcurrentModificationException` because they iterate over a stable snapshot or tolerate concurrent structural change. The map view collections (`keySet`/`values`/`entrySet`) are live views: removing through the view mutates the backing map, and their iterators support safe removal.

### 2026 currency

- The `Iterator`/`ListIterator` contracts and fail-fast/fail-safe semantics carry forward unchanged from the Java-8 base.
- **`removeIf`** (Java 8) remains the idiomatic predicate removal; Stream `filter` + re-collect is the immutable alternative (see `java-stdlib/stream-api`).
- **Virtual Threads (JEP 444, JDK 21)** — concurrent-collection and fail-safe-iteration guidance is unchanged under virtual threads; the pinning caveat (don't hold `synchronized`/locks across blocking calls) was largely resolved by JEP 491 (JDK 24). [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) · [JEP 491: Synchronize Virtual Threads without Pinning](https://openjdk.org/jeps/491)
