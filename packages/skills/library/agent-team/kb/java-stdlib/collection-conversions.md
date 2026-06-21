---
kb_id: java-stdlib/collection-conversions
version: 1
tags:
  - java-stdlib
  - collections
  - conversions
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: java-collections-conversions{,-2}, java-collections-maps-3, core-java-collections-list-3"
  - "JDK 16 — Stream.toList() (https://todd.ginsberg.com/post/java-16/stream-tolist/)"
related:
  - java-stdlib/collections-framework
  - java-stdlib/map-implementations
  - java-stdlib/stream-api
  - java-stdlib/arrays
  - java-stdlib/strings
status: active
---

## Summary

**Concept**: Converting between collection types — array ↔ List/Set, List → Map, Iterable/Iterator → Collection, List ↔ String, and primitive ↔ boxed bridges.
**Key APIs**: `Collectors.toMap` (+ 4-arg merge/supplier form), Guava `Maps.uniqueIndex`, Apache `MapUtils.populateMap`, `StreamSupport.stream(spliterator, false)`, `IntStream`/`Ints.asList`/`ArrayUtils.toObject`.
**Gotcha**: `Collectors.toMap` throws `IllegalStateException` on a duplicate key unless a merge function is supplied; it collects into a `HashMap` and loses order (pass `LinkedHashMap::new` via the 4-arg form).
**2026-currency**: `Stream.toList()` (JDK 16, immutable) over `collect(toList())`; `Collectors.toUnmodifiableList()` (JDK 10).
**Sources**: Baeldung `java-collections-conversions*` + `java-collections-maps-3`.

## Quick Reference

**Array ↔ collection:**

```java
List<String> l = Arrays.asList(arr);           // fixed-size VIEW (see arrays doc trap)
List<String> l = new ArrayList<>(Arrays.asList(arr));   // mutable copy
String[] a = list.toArray(new String[0]);      // toArray(new T[0]) ≥ toArray(new T[size])
int[] a = stream.mapToInt(i -> i).toArray();   // unbox Stream<Integer> → int[]
```

**List → Map (the duplicate-key trap):**

```java
Map<K,V> m = list.stream().collect(Collectors.toMap(User::id, u -> u));     // throws on dup key
Map<K,V> m = list.stream().collect(Collectors.toMap(User::id, u -> u,
        (a,b) -> a, LinkedHashMap::new));   // 4-arg: merge fn + map supplier (preserves order)
```

Alternatives: Guava `Maps.uniqueIndex(iterable, keyFn)`, Apache `MapUtils.populateMap`.

**Iterable / Iterator → Collection:**

```java
StreamSupport.stream(iterable.spliterator(), false).collect(toList());
```

**Primitive ↔ boxed bridges:** `IntStream.boxed()` → `Stream<Integer>`; Guava `Ints.asList(int...)`; Apache `ArrayUtils.toObject(int[])` / `toPrimitive(Integer[])`.

**Other conversions:** map `values()`/`keySet()` → array/List/Set; List ↔ String (`String.join` / `split`); `List<User>` → `List<UserDTO>` via ModelMapper (or MapStruct for record-heavy Java 17+).

**Canonical traps:**

- `Collectors.toMap` — `IllegalStateException` on duplicate keys without a merge fn; collects to `HashMap` (order lost) unless the 4-arg form supplies `LinkedHashMap::new`.
- `Collectors.joining` over a stream containing nulls throws NPE — `filter(Objects::nonNull)` first.
- `Arrays.asList(arr)` is a fixed-size view — wrap in `new ArrayList<>(...)` for a mutable copy.

**Current (mid-2026):** `Stream.toList()` (JDK 16) returns an **unmodifiable** list — prefer it over `collect(toList())` when immutability is wanted; `Collectors.toUnmodifiableList()` (JDK 10).

## Full content

The collections framework requires frequent cross-type conversion, and the conversion matrix is one of the corpus's strongest areas. Array-to-List conversion has the `Arrays.asList` view trap (fixed-size, array-backed — wrap in `new ArrayList<>(...)` for a mutable copy). List-to-array uses `toArray(new T[0])`, which is at least as fast as the pre-sized `toArray(new T[size])` on modern JITs. Unboxing a `Stream<Integer>` to an `int[]` uses `.mapToInt(i -> i).toArray()`.

List-to-Map via `Collectors.toMap` carries two traps: it throws `IllegalStateException` when two elements map to the same key (supply a merge function: `(a,b) -> a`), and it collects into a `HashMap` that loses encounter order (the 4-arg form takes a map supplier like `LinkedHashMap::new`, `TreeMap::new`, or `ConcurrentHashMap::new`). Guava `Maps.uniqueIndex` and Apache `MapUtils.populateMap` are library alternatives.

An arbitrary `Iterable`/`Iterator` is bridged to a Stream/Collection with `StreamSupport.stream(spliterator, false)`. Primitive-to-boxed bridges use `IntStream.boxed()`, Guava `Ints.asList`, or Apache `ArrayUtils.toObject`/`toPrimitive`. Object-graph mapping (`List<User>` → `List<UserDTO>`) is done with ModelMapper in the corpus.

### 2026 currency

- **`Stream.toList()` (JDK 16)** returns an **unmodifiable** `List` (like `List.of`), distinct from the *mutable* `Collectors.toList()`. Seed it over `collect(collectingAndThen(toList(), unmodifiableList()))` / Guava `toImmutableList`. [JDK 16 — Stream.toList() (Todd Ginsberg)](https://todd.ginsberg.com/post/java-16/stream-tolist/)
- **`Collectors.toUnmodifiableList/Set/Map()` (JDK 10)** for immutable terminal collection.
- **MapStruct** is the common record-aware mapper over ModelMapper for Java 17+ record-heavy code. [MapStruct](https://mapstruct.org/)
- The conversion idioms themselves carry forward unchanged; the additions are immutable-collection successors.
