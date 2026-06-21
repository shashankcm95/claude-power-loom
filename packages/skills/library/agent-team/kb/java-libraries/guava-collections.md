---
kb_id: java-libraries/guava-collections
version: 1
tags:
  - java-libraries
  - guava
  - collections
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: guava-modules/{guava-collections,guava-collections-list,guava-collections-map,guava-collections-set,guava-core}"
  - "Guava javadoc (javadoc.io/doc/com.google.guava/guava/latest)"
related:
  - java-libraries/commons-collections
  - java-libraries/in-process-caching
  - java-libraries/functional-extensions
status: active
---

## Summary

**Concept**: Google Guava's collection types beyond the JDK — `Multimap`, `BiMap`, `Table`, `RangeMap`/`RangeSet`, `Multiset`, `ClassToInstanceMap`, `EvictingQueue` — plus `Sets` algebra, `Joiner`/`Splitter`, and `Preconditions`. THE landmine: many ops return *live backing-collection views*, not copies.
**Key APIs**: `ArrayListMultimap`, `HashBiMap.inverse()`, `HashBasedTable`/`row`/`column`, `TreeRangeMap` vs `ImmutableRangeMap`, `HashMultiset.setCount`, `Sets.union`/`intersection`/`cartesianProduct`, `Preconditions.checkArgument`.
**Gotcha**: `Collections2.filter/transform`, `Lists.partition`/`reverse`, `Sets.union/intersection`, `RangeMap.subRangeMap` are write-through views; `Multimap.size()` = total pairs not distinct keys; `Multiset.setCount(k,-1)` throws.
**2026-currency**: Guava 33.6.0-jre — Multiset/Multimap/BiMap/Table/RangeMap API shape unchanged; bump the pin. Legacy `Predicate`/`Function`/`Ordering` superseded by JDK 8.
**Sources**: Baeldung `guava-collections*` + `guava-core` modules.

## Quick Reference

**The core collection types (no JDK equivalent — safe to seed):**

| Type | Purpose | Note |
|---|---|---|
| `Multimap` / `ArrayListMultimap` | multiple values per key | `size()` = total pairs, NOT distinct keys |
| `BiMap` / `HashBiMap` | bidirectional map | `inverse()`; value-uniqueness enforced |
| `Table` / `HashBasedTable` | 2-key map (row, column → value) | `row`/`column`/`columnMap`; `Tree`/`Array`/`Immutable` variants |
| `RangeMap` / `RangeSet` | interval → value | `TreeRangeMap` coalesces; `Immutable*` *rejects* overlaps (`IllegalArgumentException`) |
| `Multiset` / `HashMultiset` | element counts | `setCount(k,-1)` throws; CAS `setCount(k,exp,new)` |
| `ClassToInstanceMap` | typesafe heterogeneous container keyed by `Class<T>` | |
| `EvictingQueue` | bounded FIFO | silently evicts head on overflow |
| `MinMaxPriorityQueue` | dual-ended priority queue | |

**Sets algebra + helpers:** `Sets.union`/`intersection`/`symmetricDifference`/`cartesianProduct`/`powerSet`; `Joiner`/`Splitter`; `Lists.partition`/`reverse`/`charactersOf`; `Streams.zip`; `ContiguousSet`; `Ordering` (legacy `Comparator`).

**THE Guava landmine — live views, not copies:**

```java
Collection<X> view = Collections2.filter(list, pred);
view.add(matching);     // grows the BACKING list (write-through)
view.add(nonMatching);  // throws IllegalArgumentException
```

Write-through view producers: `Collections2.filter/transform`, `Lists.partition`, `Lists.reverse`, `Sets.union/intersection`, `RangeMap.subRangeMap`. (Apache `ListUtils.partition` behaves the same.)

**Preconditions (templated messages):**

```java
checkArgument(count > 0, "count must be positive but was %s", count);
checkNotNull(arg); checkState(cond); checkElementIndex(i, size);
```

**Contract-violating quirks:**

- `Multimap.size()` is total pairs, not distinct keys.
- `Multiset.setCount(k, -1)` throws.
- `ImmutableRangeMap`/`ImmutableRangeSet` builders throw on overlapping ranges; `TreeRange*` silently coalesce.

**Current (mid-2026):** **Guava 33.6.0-jre / -android** (14 Apr 2025) — collection API shape unchanged; just bump the pin. Legacy `Predicate`/`Function`/`Optional`/`Ordering`/`FluentIterable`/`Collections2` → prefer JDK 8 `java.util.function.*` / Streams / `Comparator`.

## Full content

Google Guava's collections are the most exhaustively-taught third-party collection library in the corpus, and the live-view semantics are taught deliberately. The headline types fill genuine JDK gaps: `Multimap` (multiple values per key, where `size()` returns the total number of key-value *pairs*, not distinct keys), `BiMap` (a bidirectional map with `inverse()` and enforced value-uniqueness), `Table` (a two-key map with `row`, `column`, and `columnMap` views and `HashBased`/`Tree`/`Array`/`Immutable` variants), `RangeMap`/`RangeSet` (interval-keyed structures where `TreeRangeMap` coalesces adjacent ranges but the `Immutable*` builders *reject* overlaps with `IllegalArgumentException`), `Multiset` (element-count bag with a compare-and-set `setCount(k, expected, new)`), `ClassToInstanceMap` (a type-safe heterogeneous container keyed by `Class<T>`), and the queues `EvictingQueue` (bounded FIFO that silently evicts the head) and `MinMaxPriorityQueue` (dual-ended). Supporting utilities include `Sets` algebra (`union`/`intersection`/`symmetricDifference`/`cartesianProduct`/`powerSet`), `Joiner`/`Splitter`, `Lists.partition`/`reverse`/`charactersOf`, `Streams.zip`, and `ContiguousSet`.

The single biggest conceptual trap — and one the tests deliberately assert — is that many operations return **live, write-through views over the backing collection, not copies**. `Collections2.filter`/`transform`, `Lists.partition`, `Lists.reverse`, `Sets.union`/`intersection`, and `RangeMap.subRangeMap` all mutate the original when you mutate the view; adding a non-matching element to a filtered view throws. A second cluster of "contract-violating" surprises: `Multiset.setCount(k, -1)` throws, the immutable range builders reject overlaps while the tree variants silently coalesce, and `Multimap.size()` counts pairs rather than keys.

`Preconditions` is Guava's argument-validation utility — `checkArgument`, `checkNotNull`, `checkState`, `checkElementIndex` — with templated `%s` messages that build the exception lazily. Much of Guava's *functional* surface (`Predicate`, `Function`, `Ordering`, `FluentIterable`, `Collections2`, `Iterables.filter`) predates Java 8 and is now superseded by the JDK; the genuine collection types above have no JDK equivalent and remain the reason to depend on Guava.

### 2026 currency

- **Guava 33.6.0-jre / -android** (14 Apr 2025): the `Multiset`/`Multimap`/`BiMap`/`Table`/`RangeMap`/`RangeSet` API shape is unchanged — just bump the pin. [Guava javadoc](https://javadoc.io/doc/com.google.guava/guava/latest/index.html)
- The legacy functional toolkit (`Predicate`/`Function`/`Optional`/`Ordering`/`FluentIterable`/`Collections2`/`Iterables.filter`) is superseded by Java 8 `java.util.function.*`, Streams, `Comparator`, and `Optional` — prefer the JDK for those. Guava `EventBus` is discouraged by Guava itself.
- The dir names `guava-18`/`19`/`21` in the corpus are *article* versions, not the resolved classpath (the root pom resolves to a single Guava version) — a pin-reading trap.
