---
kb_id: java-stdlib/stream-api
version: 1
tags:
  - java-stdlib
  - streams
  - functional
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-streams{,-2,-3}"
  - "JEP 485: Stream Gatherers (https://openjdk.org/jeps/485)"
related:
  - java-stdlib/collections-framework
  - java-stdlib/collection-conversions
  - java-stdlib/iteration-and-modification
  - java-stdlib/arrays
  - java-stdlib/regex
  - java-stdlib/sequenced-collections
status: active
---

## Summary

**Concept**: The Stream API (Java 8) — a lazy source → intermediate → terminal pipeline for functional bulk data processing, including collectors, primitive streams, and parallelism.
**Key APIs**: `map`/`flatMap`/`filter`/`distinct`/`sorted`/`limit`; `reduce` (1/2/3-arg); `collect` (`toList`/`toMap`/`groupingBy`/`partitioningBy`/`joining`); `IntStream`/`LongStream`/`DoubleStream`.
**Gotcha**: a Stream is single-use (second terminal op → `IllegalStateException`); `peek` is lazy/debug-only; `Collectors.toMap` loses order and throws on duplicate keys; parallel-`reduce` identity must be the true neutral element.
**2026-currency**: `Stream.toList()` (JDK 16, immutable); Stream Gatherers (JEP 485, JDK 24) for custom *intermediate* ops.
**Sources**: Baeldung `core-java-streams*` + JEP 485.

## Quick Reference

**Pipeline shape — source → intermediate (lazy) → terminal (eager):**

```java
List<String> out = list.stream()              // source
    .filter(s -> !s.isBlank())                // intermediate (lazy)
    .map(String::trim)                        // intermediate (lazy)
    .distinct().sorted()
    .collect(Collectors.toList());            // terminal (eager) — triggers execution
```

**Creation:** `Stream.of`, `Stream.iterate`/`generate` (infinite — bound with `limit`/`findFirst`), `Arrays.stream`, `Collection.stream`/`parallelStream`, `IntStream.range`, `Files.lines`.

**Collectors:** `toList`/`toSet`/`toMap`, `groupingBy`, `partitioningBy`, `joining(delim,prefix,suffix)`, `counting`, `summingInt`, `collectingAndThen`, custom `Collector.of`.

**Primitive streams:** `IntStream`/`LongStream`/`DoubleStream` → `min`/`max`/`sum`/`average` returning `OptionalInt`/`OptionalDouble`; bridge with `boxed`/`mapToObj`/`mapToInt`.

**Canonical correctness traps:**

- **One-shot** — a Stream cannot be reused after a terminal op (`IllegalStateException`); wrap creation in a `Supplier<Stream<T>>`.
- **`peek` is lazy** — does nothing without a terminal op; debug-only.
- **Parallel-reduce identity** must be the *true neutral element* — `parallelStream().reduce(5, Integer::sum)` adds 5 per partition, giving a wrong total.
- **`Collectors.toMap`** loses order (collects to `HashMap` — pass `LinkedHashMap::new` via the 4-arg form) and throws `IllegalStateException` on duplicate keys without a merge fn.
- **`Collectors.joining` over nulls** throws NPE — `filter(Objects::nonNull)` first.
- **Close IO-backed streams** — `Files.lines` needs try-with-resources; collection/array streams need no close.
- **Order** depends on the source (`List` preserves, `TreeSet` sorts); `forEach` is unordered, `forEachOrdered` preserves.

**Current (mid-2026):** `Stream.toList()` (JDK 16) returns an unmodifiable list — prefer over `collect(toList())`; Stream Gatherers (JEP 485, JDK 24) add custom intermediate ops (`windowFixed`/`windowSliding`/`fold`/`scan`/`mapConcurrent`).

## Full content

A Stream is a lazy, single-pass pipeline over a data source. Intermediate operations (`map`, `flatMap`, `filter`, `peek`, `distinct`, `sorted`, `skip`, `limit`) are lazy and return a new stream; nothing executes until a terminal operation (`collect`, `reduce`, `count`, `anyMatch`/`allMatch`/`noneMatch`, `findFirst`/`findAny`, `forEach`) is invoked. Laziness enables infinite streams (`Stream.iterate`/`generate`) bounded by short-circuiting `limit`/`findFirst`.

The most subtle correctness traps: a stream is one-shot — a second terminal operation throws `IllegalStateException`, so reusable pipelines wrap creation in a `Supplier<Stream<T>>`. `peek` is lazy and runs only when a terminal op pulls through it; it is for debugging, not side effects. `reduce` has 1/2/3-arg forms — the combiner matters for parallel and type-changing reductions, and the identity must be the genuine neutral element, or parallel execution adds it once per partition and produces a wrong result. `Collectors.toMap` loses encounter order (it builds a `HashMap`; pass `LinkedHashMap::new` via the 4-arg form) and throws on duplicate keys unless given a merge function; `Collectors.joining` over a stream with nulls throws NPE.

Primitive streams (`IntStream`/`LongStream`/`DoubleStream`) avoid boxing and offer `min`/`max`/`sum`/`average` returning `OptionalInt`/`OptionalDouble`. IO-backed streams (`Files.lines`) must be closed via try-with-resources; collection- and array-backed streams hold no resource and need no close. Encounter order depends on the source and is preserved by `forEachOrdered` but not `forEach`; parallelism is opt-in via `parallel()`/`parallelStream()` with a cost model driven by split/merge overhead and data locality.

### 2026 currency

- **`Stream.toList()` (JDK 16)** is an immutable terminal shortcut returning an **unmodifiable** list, distinct from the mutable `Collectors.toList()`. [JDK 16 — Stream.toList() (Todd Ginsberg)](https://todd.ginsberg.com/post/java-16/stream-tolist/)
- **Stream Gatherers (JEP 485, final in JDK 24)** add custom *intermediate* operations: `Stream.gather(Gatherer)` is to intermediate ops what `collect(Collector)` is to terminal ops — windowing/folding/limiting/dedup-by-key steps the fixed `map`/`filter`/`flatMap` set cannot express, with built-in factories in `java.util.stream.Gatherers` (`windowFixed`, `windowSliding`, `fold`, `scan`, `mapConcurrent`). Preview path: JEP 461 (22) → 473 (23) → final 485 (24). [JEP 485: Stream Gatherers](https://openjdk.org/jeps/485) · [Oracle — Stream Gatherers (JDK 24)](https://docs.oracle.com/en/java/javase/24/core/stream-gatherers.html)
- **`Matcher.results()` (JDK 9)** turns regex matches into a stream — the corpus references it but keeps it commented out at the Java-8 baseline.
- **`Collectors.toUnmodifiableList()` (JDK 10)** for immutable collection.
- The source → intermediate → terminal pipeline model carries forward unchanged.
