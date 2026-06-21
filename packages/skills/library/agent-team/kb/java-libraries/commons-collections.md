---
kb_id: java-libraries/commons-collections
version: 1
tags:
  - java-libraries
  - apache-commons
  - collections
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: libraries-apache-commons-collections, libraries-4 (eclipse/pcollections/pairs), libraries-primitive (fastutil/eclipse-primitives)"
  - "Apache Commons Collections release notes (commons.apache.org/proper/commons-collections/changes.html)"
related:
  - java-libraries/guava-collections
  - java-libraries/commons-io-lang
status: active
---

## Summary

**Concept**: non-JDK collection libraries beyond Guava — Apache Commons Collections 4 (`Bag`/`BidiMap`/`CircularFifoQueue`/decorators), Eclipse Collections (rich + primitive), FastUtil (primitive, anti-autoboxing), PCollections (persistent/immutable), and tuple libraries.
**Key APIs**: `collections4` `Bag`/`HashBag`/`CollectionBag`, `BidiMap`/`DualHashBidiMap`, `CircularFifoQueue`, `SetUtils`/`CollectionUtils`/`MapUtils`; Eclipse `MutableList`/`FastList` (`select`/`reject`/`collect`); FastUtil `Int2IntOpenHashMap`/`IntBigArrays`; PCollections `HashTreePMap`/`TreePVector`.
**Gotcha**: Commons `Bag.add` returns false on increment (violates `Collection.add`) — `CollectionBag` restores it; `transformedSet` retroactively transforms existing elements; PCollections/Javatuples mutators (`plus`/`with`/`setAt0`) return NEW instances.
**2026-currency**: Commons Collections 4.5.0 (non-vulnerable; the InvokerTransformer gadget was 3.x, not 4.x); Eclipse Collections 13.0.0; FastUtil 8.5.16.
**Sources**: Baeldung `libraries-apache-commons-collections`/`libraries-4`/`libraries-primitive` modules.

## Quick Reference

**Apache Commons Collections 4 (`collections4`):**

- `Bag`/`HashBag`/`TreeBag` — multiplicity; **`Bag.add` violates `Collection.add`** (returns false when only incrementing). `CollectionBag` restores the contract.
- `BidiMap`/`DualHashBidiMap` — bidirectional map.
- `CircularFifoQueue` — ring buffer (default capacity 32).
- `OrderedMap`/`LinkedMap` — insertion-order + index access + bidirectional iteration.
- `SetUtils` — lazy set-views + decorators (`predicatedSet`/`transformedSet` — `transformedSet` **retroactively** transforms existing elements).
- `CollectionUtils` — null-safe `addIgnoreNull`/`collate`/`collect`/`isEmpty`.
- `MapUtils` — `getString` (null-safe), `invertMap`, `fixedSizeMap`/`predicatedMap`/`lazyMap`.
- Legacy `Transformer`/`Predicate` (pre-`java.util.function`).

**Eclipse Collections** — rich iteration on `MutableList`/`FastList` (`select`/`reject`/`collect`/`detect`/`anySatisfy`/`partition`/`flatCollect`/`injectInto`/`zip`); a primitive API (`IntLists`/`IntSets`, `IntIntHashMap`, `IntInterval`, `primitiveStream()`) split across `*.api.*` interfaces vs `*.impl.*` factories.

**Primitive collections (avoid autoboxing):**

- **FastUtil** — type-specific maps/sets/lists (`Int2IntOpenHashMap`, `IntOpenHashSet`) + "big arrays" (`IntBigArrays.wrap` → `int[][]`, addressable beyond `Integer.MAX_VALUE`).
- Eclipse primitive collections (above). Motivation proven by JMH benchmark vs boxed `HashSet<Integer>`.

**Persistent/immutable + tuples:**

- **PCollections** — `HashTreePMap`/`TreePVector`/`HashTreePSet`; mutators `plus`/`minus`/`with` return **new** instances.
- **Javatuples** — `Unit`/`Pair`/`Triplet`/`Quartet` (immutable; `setAt0`/`add` return new).
- Commons Lang3 `Pair`/`ImmutablePair`/`MutablePair`/`Triple`; JDK `AbstractMap.SimpleEntry`; Vavr `Tuple2..16`; jOOL `Tuple2..16`.

**Current (mid-2026):** **Commons Collections 4.5.0** (19 Apr 2025, non-vulnerable line); **Eclipse Collections 13.0.0** (29 Jul 2025); **FastUtil 8.5.16**.

## Full content

Beyond Guava, the corpus teaches a cluster of collection libraries each filling a niche the JDK leaves open. **Apache Commons Collections 4** (`collections4`) contributes `Bag` types (multiplicity counts), bidirectional maps (`BidiMap`/`DualHashBidiMap`), a fixed-capacity ring buffer (`CircularFifoQueue`, default 32), insertion-order maps with index access (`OrderedMap`/`LinkedMap`), and decorator utilities. The decorator family (`SetUtils.predicatedSet`/`transformedSet`, `MapUtils.fixedSizeMap`/`predicatedMap`/`lazyMap`) wraps existing collections with added behavior — note that `transformedSet` *retroactively* transforms existing elements, not just future additions. The null-safe helper classes (`CollectionUtils.addIgnoreNull`/`collate`, `MapUtils.getString`/`invertMap`) round it out. The canonical contract-violation lesson lives here: `Bag.add` returns `false` when it only increments an existing element's count, breaking the `Collection.add` contract; `CollectionBag` is the decorator that restores it. The legacy `Transformer`/`Predicate` interfaces predate `java.util.function`.

**Eclipse Collections** offers a fluent rich-iteration API on `MutableList`/`FastList` (`select`, `reject`, `collect`, `detect`, `anySatisfy`, `partition`, `flatCollect`, `injectInto`, `zip`) plus a comprehensive primitive-collection API (`IntLists`, `IntSets`, `IntIntHashMap`, `IntInterval`, `primitiveStream()`) deliberately split across `*.api.*` interfaces and `*.impl.*` factory classes. **FastUtil** is the other anti-autoboxing library: type-specific maps/sets/lists (`Int2IntOpenHashMap`, `IntOpenHashSet`) plus "big arrays" (`IntBigArrays.wrap` produces an `int[][]` addressable beyond `Integer.MAX_VALUE`). The motivation for primitive collections is proven in the corpus by a JMH benchmark against a boxed `HashSet<Integer>`.

**PCollections** provides genuinely persistent/immutable collections (`HashTreePMap`, `TreePVector`, `HashTreePSet`) whose mutators (`plus`, `minus`, `with`) return new instances rather than mutating — the same return-new contract shared by Vavr collections and Functional Java's `fj.data.List`. Tuple support is fragmented: **Javatuples** (`Unit`/`Pair`/`Triplet`/`Quartet`, immutable with return-new `setAt0`/`add`), Commons Lang3 (`Pair`/`ImmutablePair`/`MutablePair`/`Triple`), the JDK's `AbstractMap.SimpleEntry`, and Vavr/jOOL `Tuple2..16`. (`javafx.util.Pair` is no longer in the JDK since JDK 11.)

### 2026 currency

- **Commons Collections 4.5.0** (19 Apr 2025) is the current non-vulnerable line. The famous InvokerTransformer deserialization gadget was in the **3.2.1 (3.x)** family, *not* 4.x — the base's collections4 usage is on the safe family. [Commons Collections security page](https://commons.apache.org/proper/commons-collections/security.html), [Commons Collections release notes](https://commons.apache.org/proper/commons-collections/changes.html)
- **Eclipse Collections 13.0.0** (29 Jul 2025). [Eclipse Collections site](https://eclipse.dev/collections/)
- **FastUtil 8.5.16** (Maven Central) — not pinned to a canonical mid-2026 release in the source but current.
- At the concept level the primitive-collection rationale (avoid autoboxing) and the persistent-collection return-new contract carry forward unchanged.
