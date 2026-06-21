---
kb_id: java-stdlib/sequenced-collections
version: 1
tags:
  - java-stdlib
  - collections
  - jdk21
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-collections-4 (Deque/Stack, toArray sizing — the pre-JEP-431 baseline)"
  - "JEP 431: Sequenced Collections (https://openjdk.org/jeps/431)"
related:
  - java-stdlib/collections-framework
  - java-stdlib/map-implementations
  - java-stdlib/stream-api
status: active
---

## Summary

**Concept**: Sequenced Collections (JEP 431, JDK 21) — three interfaces giving every ordered collection a uniform first/last/reversed API, retrofitted onto the existing hierarchy. This is the single biggest structural gap in the Java-8 corpus.
**Key APIs**: `SequencedCollection<E>` (`getFirst`/`getLast`/`addFirst`/`addLast`/`removeFirst`/`removeLast`/`reversed`), `SequencedSet<E>`, `SequencedMap<K,V>` (`putFirst`/`putLast`, `firstEntry`/`lastEntry`, `pollFirstEntry`/`pollLastEntry`).
**Gotcha**: `getFirst()`/`getLast()` throw `NoSuchElementException` on an empty collection; `addFirst`/`putFirst` are unsupported on `SortedSet`/`SortedMap` (order is comparator-defined) and throw `UnsupportedOperationException`.
**2026-currency**: JDK 21+ only; replaces `list.get(list.size()-1)`, manual reverse, and `TreeMap.firstKey()`/`lastKey()`.
**Sources**: JEP 431 + Oracle JDK 21 docs.

## Quick Reference

**The three interfaces (JEP 431, JDK 21):**

```java
// SequencedCollection<E> — on List, Deque, LinkedHashSet, SortedSet
seq.getFirst();  seq.getLast();
seq.addFirst(e); seq.addLast(e);
seq.removeFirst(); seq.removeLast();
SequencedCollection<E> rev = seq.reversed();   // reversed-order VIEW

// SequencedMap<K,V> — on LinkedHashMap, SortedMap (TreeMap)
map.putFirst(k, v);   map.putLast(k, v);
Entry<K,V> f = map.firstEntry();   Entry<K,V> l = map.lastEntry();
map.pollFirstEntry();  map.pollLastEntry();
map.sequencedKeySet();  map.sequencedValues();  map.sequencedEntrySet();
```

**Retrofitted onto:** `List`, `Deque`, `LinkedHashSet`, `SortedSet` (→ `SequencedCollection`/`SequencedSet`); `LinkedHashMap`, `SortedMap` (→ `SequencedMap`).

**Idioms it replaces:**

| Old (Java 8) | New (JDK 21) |
|---|---|
| `list.get(list.size()-1)` | `list.getLast()` |
| `Collections.reverse(copy)` / manual loop | `list.reversed()` |
| `new LinkedList<>(...)` push/pop juggling | `addFirst`/`removeFirst` on any `SequencedCollection` |
| `TreeMap.firstKey()` / `lastKey()` | `firstEntry()` / `lastEntry()` |
| `((LinkedHashSet) s).iterator().next()` for first | `s.getFirst()` |

**Gotchas:**

- `getFirst()`/`getLast()` throw `NoSuchElementException` on an empty collection (not null).
- `addFirst`/`addLast`/`putFirst`/`putLast` throw `UnsupportedOperationException` on `SortedSet`/`SortedMap` — their order is defined by the comparator, so you cannot force a positional insert.
- `reversed()` returns a **view**, not a copy — mutations write through to the backing collection.

**Current (mid-2026):** JDK 21 LTS and later. The Java-8 corpus has no equivalent; this is a net-new must-know.

## Full content

Before JDK 21, Java's ordered collections each exposed first/last access through ad-hoc, inconsistent methods: `List` used `get(0)` / `get(size()-1)`, `Deque` used `getFirst`/`getLast`/`peekFirst`/`peekLast`, `SortedSet` used `first`/`last`, `LinkedHashSet` had no direct last-element accessor at all, and reversing required a copy plus `Collections.reverse` or a manual loop. JEP 431 (delivered in JDK 21) closes this gap with three new interfaces inserted into the existing hierarchy.

`SequencedCollection<E>` adds `getFirst`/`getLast`/`addFirst`/`addLast`/`removeFirst`/`removeLast` and a `reversed()` view; it is implemented by `List`, `Deque`, `LinkedHashSet`, and `SortedSet`. `SequencedSet<E>` is the set-flavored sub-interface. `SequencedMap<K,V>` adds `putFirst`/`putLast`, `firstEntry`/`lastEntry`, `pollFirstEntry`/`pollLastEntry`, and the `sequencedKeySet`/`sequencedValues`/`sequencedEntrySet` views; it is implemented by `LinkedHashMap` and `SortedMap`.

The win is a single uniform vocabulary across every ordered container, eliminating error-prone hand-rolled idioms like `list.get(list.size()-1)`. The two important caveats: positional inserts (`addFirst`/`putFirst`) are unsupported on the sorted collections, where position is determined by the comparator (they throw `UnsupportedOperationException`), and `getFirst`/`getLast` throw `NoSuchElementException` on an empty collection rather than returning null.

### 2026 currency

- **Sequenced Collections (JEP 431, JDK 21)** is the canonical modern API and the biggest structural addition relative to the Java-8 base. Use it wherever the corpus shows a hand-rolled first/last/reverse idiom. [JEP 431: Sequenced Collections](https://openjdk.org/jeps/431) · [Oracle — Creating Sequenced Collections, Sets, and Maps (JDK 21)](https://docs.oracle.com/en/java/javase/21/core/creating-sequenced-collections-sets-and-maps.html)
- Requires JDK 21 (LTS) or later — not available on the Java-8 / Java-17 baselines. JDK 21 is the most-deployed LTS as of mid-2026.
