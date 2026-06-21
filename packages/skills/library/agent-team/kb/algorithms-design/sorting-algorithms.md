---
kb_id: algorithms-design/sorting-algorithms
version: 1
tags:
  - algorithms-design
  - sorting
  - partitioning
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: algorithms-sorting, algorithms-sorting-2"
  - "Java Language Changes — Oracle (https://docs.oracle.com/en/java/javase/17/language/java-language-changes.html)"
related:
  - algorithms-design/searching-and-string-matching
  - algorithms-design/trees-heaps-and-buffers
status: active
---

## Summary

**Concept**: The full comparison-sort catalogue (bubble, merge, quick, insertion, heap, shell, selection) plus non-comparison sorts (counting, radix, bucket), advanced 3-way partitioning for duplicate-heavy data (Dutch National Flag, Bentley-McIlroy), and string sorting.
**Key APIs**: stable counting-sort placement from the back; 3-way partition returning the equal-key band; `Arrays.sort(char[])` for anagram checks; `Comparator.comparingDouble`; generic `Sorter<T>` bucket sort.
**Gotcha**: counting/radix assume non-negative ints (throw or break otherwise); merge sort is stable + O(n log n) but O(n) extra space; quicksort needs 3-way partitioning to avoid O(n^2) on many duplicates.
**2026-currency**: hand-rolled pure-JDK and evergreen; only stylistic relics (e.g. `IntStream.flatMap` bubble sort).
**Sources**: Baeldung `algorithms-sorting` + `algorithms-sorting-2`.

## Quick Reference

**Comparison sorts**:

| Sort | Key property | Notes |
|---|---|---|
| Bubble | naive + early-exit `swapNeeded` flag | O(n^2); flag stops early on sorted input |
| Merge | stable, O(n log n), O(n) extra | divide + merge |
| Quick | Lomuto partition; 3-way for duplicates | O(n log n) avg, O(n^2) worst |
| Insertion | imperative + recursive | O(n^2), fast on near-sorted |
| Heap | generic `ArrayList`-backed min-heap, repeated pop | O(n log n) |
| Shell | gap sequence n/2, n/4, ... | sub-quadratic |
| Selection | asc + desc | O(n^2) |

**Non-comparison sorts** (linear, but constrained):

| Sort | Mechanism | Constraint |
|---|---|---|
| Counting | count → prefix-sum → stable place from back | known max `k`, non-negative ints; O(n+k) |
| Radix (LSD) | counting sort per digit, base 10 | non-negative ints |
| Bucket | ~sqrt(n) buckets via value/max hash, sort each, concat | generic `Sorter<T>` |

**Stable counting-sort placement** writes from the back of the input to preserve order (reused in radix's per-digit pass):

```java
// CountingSort.java:14-18 — iterate input right-to-left, decrement count, place
output[--count[input[i]]] = input[i];
```

**Advanced 3-way partitioning for repeats** — both return the equal-to-pivot band so quicksort recurses only on the `<` and `>` zones:
- **Dutch National Flag** — 3-way lt/eq/gt via a switch on the compare result (`DutchNationalFlagPartioning.java:35-36`).
- **Bentley-McIlroy** — equal keys moved to the ends, then swapped into the middle (`BentleyMcIlroyPartioning.java:62-63`).

**String sorting**: alphabetize via `Arrays.sort(char[])` (used for anagram validation); sort-by-contained-number via a regex-extracted numeric key + `Comparator.comparingDouble`.

**In-place vs out-of-place**: array reversal teaches the O(1)- vs O(n)-extra-space distinction.

**Top gotchas**:
- `CountingSort` / `RadixSort` assume non-negative ints — they throw or silently break on negatives.
- Merge sort's stability costs O(n) extra space; quicksort is in-place but degrades to O(n^2) on duplicate-heavy data without 3-way partitioning.

**Current (mid-2026)**: all hand-rolled, pure-JDK 8, no `javax`/`jakarta` surface — evergreen. Only stylistic relics date it (an `IntStream.flatMap` bubble sort).

## Full content

Taught across the Baeldung `algorithms-sorting` and `algorithms-sorting-2` modules, this is the deepest, most multi-implementation slice of the domain (10+ variants). The "N approaches to one problem" device makes the variants comparison material rather than independent facts.

### Comparison sorts

Bubble sort appears naive and early-exit-optimized (a `swapNeeded` flag aborts once a pass makes no swaps). Merge sort is the canonical stable O(n log n) sort at the cost of O(n) auxiliary space. Quicksort uses Lomuto partitioning with a 3-way variant for duplicate-heavy data. Insertion sort is shown imperative and recursive; heap sort uses a generic `ArrayList`-backed min-heap with repeated pops; shell sort uses a halving gap sequence; selection sort is shown ascending and descending.

### Non-comparison sorts

Counting sort counts occurrences, prefix-sums, then places stably from the back of the input (O(n+k), needs a known max `k` and non-negative ints). Radix sort (LSD, base 10) reuses the counting-sort placement per digit. Bucket sort distributes into ~sqrt(n) buckets via a value/max hash, sorts each, and concatenates, behind a generic `Sorter<T>` interface.

### Advanced partitioning for repeats

Two partition schemes return the equal-to-pivot band so recursion skips it: Dutch National Flag (3-way lt/eq/gt via a switch on the compare) and Bentley-McIlroy (equal keys moved to the ends then swapped to the middle). Both are the right tool when data has many duplicate keys — plain Lomuto quicksort degrades toward O(n^2) there.

### String sorting and in-place reversal

Alphabetizing via `Arrays.sort(char[])` underpins anagram validation; sorting strings by a contained number uses a regex-extracted numeric key with `Comparator.comparingDouble`. Array reversal teaches the in-place (O(1) extra) vs out-of-place (O(n) extra) space distinction.

### 2026 currency

Every sort here is hand-rolled pure-JDK 8 (`Comparator`, arrays, streams) with no `javax`/`jakarta` surface — the implementations are **evergreen**. Only stylistic relics date the code (e.g. an `IntStream.flatMap` bubble sort that is clever-but-slow). No version, namespace, or library migration applies to this section. (For the broader Java language-feature evolution that touches adjacent code, see [Java Language Changes — Oracle](https://docs.oracle.com/en/java/javase/17/language/java-language-changes.html).)
