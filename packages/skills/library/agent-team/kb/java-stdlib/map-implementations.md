---
kb_id: java-stdlib/map-implementations
version: 1
tags:
  - java-stdlib
  - collections
  - maps
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-collections-maps{,-2,-3}, java-collections-maps-3"
  - "Oracle — String (Java SE 21) / java.util Map Javadoc"
related:
  - java-stdlib/collections-framework
  - java-stdlib/iteration-and-modification
  - java-stdlib/collection-conversions
  - java-stdlib/sequenced-collections
status: active
---

## Summary

**Concept**: `java.util.Map` implementations — `HashMap` / `LinkedHashMap` / `TreeMap` / `ConcurrentHashMap` / `EnumMap` / `WeakHashMap` — plus the hashCode/equals contract, Java-8 default methods, and the LRU and multi-value idioms.
**Key APIs**: `getOrDefault`/`putIfAbsent`/`computeIfAbsent`/`compute`/`merge`/`replaceAll`/`forEach`; `LinkedHashMap` access-order + `removeEldestEntry` (LRU); `containsKey`.
**Gotcha**: `get()==null` is ambiguous (key absent vs maps-to-null) — use `containsKey`; `byte[]` as a key is broken (identity equals); `Map.equals` fails for array-valued maps.
**2026-currency**: `Map.of`/`Map.ofEntries`/`Map.copyOf` (JDK 9) for immutables; `SequencedMap` (JDK 21) for first/last entry access.
**Sources**: Baeldung `core-java-collections-maps*` + `java-collections-maps-3`.

## Quick Reference

**Pick the Map by ordering / threading:**

| Need | Use | Notes |
|---|---|---|
| O(1), unordered | `HashMap` | one null key, null values; load factor 0.75 |
| Insertion or access order | `LinkedHashMap` | access-order + `removeEldestEntry` = LRU cache |
| Sorted / navigable keys | `TreeMap` | `NavigableMap`; rejects null key → NPE |
| Enum keys | `EnumMap` | compact array-backed |
| GC-reclaimable keys | `WeakHashMap` | entry removed when key is unreachable |
| Concurrent, lock-free reads | `ConcurrentHashMap` | rejects null key AND value; weakly-consistent iterators |
| Legacy synchronized | `Hashtable` / `Vector` / `Stack` | avoid in new code |

**Java-8 default methods (prefer over manual get-check-put):**

```java
map.getOrDefault(k, def);
map.putIfAbsent(k, v);
map.computeIfAbsent(k, key -> new ArrayList<>()).add(v);   // multi-value
map.merge(k, 1L, Long::sum);                                // frequency count
map.compute(k, (key,val) -> ...);
map.replaceAll((key,val) -> ...);
map.forEach((key,val) -> ...);
```

**Canonical traps:**

- **Key presence** — `containsKey(k)` is the only reliable test; `get(k) == null` is ambiguous when a key maps to a null value.
- **`byte[]` as a map key is broken** — arrays use identity equals/hashCode. Fix via a Base64 String, a `List<Byte>`, or a wrapper class implementing `equals`/`hashCode` over `Arrays.equals`/`Arrays.hashCode` (+ a defensive `clone()`).
- **Comparing array-valued maps** — `Map.equals` fails (array identity equals); use Guava `Maps.difference` with a custom `Equivalence`.
- **`TreeMap` / `ConcurrentHashMap` reject null** — `TreeMap` rejects null keys; `ConcurrentHashMap` rejects null keys AND values.
- **Immutable: view vs copy** — `Collections.unmodifiableMap` is a live **view**; Guava `ImmutableMap.copyOf` / JDK 9 `Map.of` are true snapshots.

**Multi-value & specialized maps:** `Map<K,List<V>>` via `computeIfAbsent`, Guava `Multimap`, Apache `MultiValuedMap`; BiMap via Guava `BiMap` / Apache `BidiMap`; case-insensitive keys via `TreeMap(String.CASE_INSENSITIVE_ORDER)`, Apache `CaseInsensitiveMap`, Spring `LinkedCaseInsensitiveMap`.

**Current (mid-2026):** `Map.of` / `Map.ofEntries` / `Map.copyOf` (JDK 9) for immutables; `SequencedMap` (JEP 431, JDK 21) adds `putFirst`/`putLast`, `firstEntry`/`lastEntry`, `pollFirstEntry`/`pollLastEntry`.

## Full content

`HashMap` is the default associative container: O(1) average get/put, one null key and null values permitted, backed by buckets with a default load factor of 0.75 (resize threshold = capacity × load factor). Correct behavior depends on the `hashCode`/`equals` contract — equal keys must have equal hash codes, and poor hashCode quality degrades bucket distribution toward O(n).

`LinkedHashMap` maintains either insertion order or access order; with access-order enabled and `removeEldestEntry` overridden, it becomes a bounded LRU cache. `TreeMap` is a sorted `NavigableMap` (rejects null keys with an NPE). `EnumMap` is a dense array-backed map for enum keys. `WeakHashMap` lets the GC reclaim entries whose keys become unreachable. `ConcurrentHashMap` provides lock-free reads and weakly-consistent (fail-safe) iterators but rejects both null keys and null values; it contrasts with `Collections.synchronizedMap`, which wraps a map with coarse locking and retains fail-fast iterators.

The Java-8 default methods (`getOrDefault`, `putIfAbsent`, `computeIfAbsent`, `compute`, `computeIfPresent`, `merge`, `replaceAll`, `forEach`) replace verbose get-check-put boilerplate — `computeIfAbsent` for multi-value maps, `merge(k, 1L, Long::sum)` for frequency counting.

Key gotchas: `containsKey` is the only reliable presence test (a null value makes `get()==null` ambiguous); raw `byte[]` keys break because arrays compare by identity (wrap them or Base64-encode); and `Map.equals` is unreliable for array-valued maps. `Map.Entry`/`AbstractMap.SimpleEntry` double as a lightweight tuple.

### 2026 currency

- **Immutable map factories** `Map.of`, `Map.ofEntries`, `Map.copyOf` (JDK 9) supersede the unmodifiable-view + Guava `ImmutableMap` patterns shown in the corpus. [Oracle — java.util Map factory methods]
- **`SequencedMap<K,V>` (JEP 431, JDK 21)** retrofits a uniform first/last API onto `LinkedHashMap`/`SortedMap`: `putFirst`/`putLast`, `firstEntry`/`lastEntry`, `pollFirstEntry`/`pollLastEntry`, `sequencedKeySet`/`Values`/`EntrySet`. Replaces `TreeMap.firstKey()`/`lastKey()` idioms. [JEP 431: Sequenced Collections](https://openjdk.org/jeps/431)
- **Records (JEP 395, final JDK 16)** replace manual `Map.Entry`/`SimpleEntry` tuple carriers in modern code. [JEP 395: Records](https://openjdk.org/jeps/395)
- **Concurrency under virtual threads** — `ConcurrentHashMap` guidance still holds under Virtual Threads (JEP 444, JDK 21); avoid pinning by not holding `synchronized`/locks across blocking calls (JEP 491, JDK 24 removed most pinning). [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) · [JEP 491: Synchronize Virtual Threads without Pinning](https://openjdk.org/jeps/491)
- The Map hierarchy and the hashCode/equals contract carry forward unchanged.
