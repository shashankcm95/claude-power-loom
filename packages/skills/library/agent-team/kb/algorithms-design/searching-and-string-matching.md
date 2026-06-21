---
kb_id: algorithms-design/searching-and-string-matching
version: 1
tags:
  - algorithms-design
  - searching
  - string-matching
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: algorithms-searching, algorithms-miscellaneous-1, algorithms-miscellaneous-2"
  - "HexFormat (Java SE 17 & JDK 17) — Oracle docs (https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/HexFormat.html)"
related:
  - algorithms-design/sorting-algorithms
  - algorithms-design/combinatorics-dp-bit-numeric
status: active
---

## Summary

**Concept**: Classic search and text-matching algorithms — binary/interpolation search over sorted arrays, kth-element selection (QuickSelect), and substring search (naive, Rabin-Karp, KMP, Boyer-Moore-Horspool, suffix tree) plus Levenshtein edit distance.
**Key APIs**: hand-rolled iterative/recursive binary search + JDK `Arrays.binarySearch`/`Collections.binarySearch`; QuickSelect partition; `BigInteger.probablePrime` rolling hash; suffix tree with `$`-terminated suffixes; 2D-DP edit distance.
**Gotcha**: overflow-safe midpoint `low + (high - low)/2`; interpolation search divides by `(data[high]-data[low])` → divide-by-zero on equal extremes; Boyer-Moore-Horspool shift table is size 256, breaks for Unicode > 255.
**2026-currency**: pure-JDK and evergreen; only stylistic relics; `RandomGenerator` (Java 17) preferred over `new Random()` for randomized pivots.
**Sources**: Baeldung `algorithms-searching` + `algorithms-miscellaneous-1/2`.

## Quick Reference

**Binary search** over a sorted `int[]`, O(log n). The load-bearing detail is the overflow-safe midpoint:

```java
int mid = low + ((high - low) / 2);   // NOT (low + high) / 2 — overflows near Integer.MAX_VALUE
```

Hand-rolled iterative + recursive variants exist; the JDK ships `Arrays.binarySearch(arr, key)` and `Collections.binarySearch(list, key)` (return `-(insertionPoint)-1` on miss).

**Interpolation search**: estimates the probe position by linear interpolation across the value range — best ~O(log log n) on *uniformly distributed* data, degrades to O(n) on skew. Bug to watch: it divides by `(data[high] - data[low])`, so equal extremes cause a divide-by-zero.

**Kth element selection**:
- kth-largest in one array: sort asc/desc, or QuickSelect (recursive, iterative-partition, randomized-pivot). QuickSelect averages O(n).
- kth-smallest across two sorted arrays: merge-then-sort O((n+m) log), linear-merge O(k), or binary-search-on-partition O(log min).
- Gotcha: QuickSelect returns `0` on out-of-range `k` (silent wrong answer, weak validation).

**Substring / pattern matching for large texts** (one technique per approach):

| Algorithm | Mechanism | Note |
|---|---|---|
| Naive scan | brute compare at every offset | O(nm) |
| Rabin-Karp | rolling hash + probable-prime modulus | recompute hash in O(1) per shift |
| Knuth-Morris-Pratt (KMP) | precomputed shift (failure) table | no backtrack on text |
| Boyer-Moore-Horspool | bad-character shift table, size 256 | breaks for Unicode > 255 |
| Suffix tree | all suffixes `$`-terminated; walk to find positions | preprocessing-heavy |

Rolling-hash normalization keeps the hash non-negative: `((value % prime) + prime) % prime`, with `BigInteger.probablePrime` for the modulus.

**Edit / Levenshtein distance**: recursive and a 2D-DP table taking the min of substitution/insertion/deletion (see `algorithms-design/combinatorics-dp-bit-numeric` for the DP framing).

**Current (mid-2026)**: all of this is hand-rolled pure-JDK 8 code (no `javax`/`jakarta` surface) and is evergreen. The only modernization is `RandomGenerator`/`RandomGeneratorFactory` (Java 17) over bare `new Random()` for the randomized-pivot QuickSelect variant.

## Full content

This material is taught in the Baeldung `algorithms-searching` module plus selection/edit-distance helpers in `algorithms-miscellaneous-1/2`. The pedagogical device is "show N approaches to one problem" — treat the variants as a comparison table, not separate facts.

### Searching sorted data

Binary search (`algorithms-searching/.../binarysearch/BinarySearch.java`) appears as iterative and recursive hand-rolled forms alongside the JDK `Arrays.binarySearch` / `Collections.binarySearch`. The canonical correctness detail is the overflow-safe midpoint `int mid = low + ((high - low) / 2)` (lines 15, 31) — the naive `(low + high) / 2` overflows for large indices.

Interpolation search probes a position estimated by linear interpolation, achieving ~O(log log n) on uniformly distributed data but degrading to O(n) on skew. Its divide-by-`(data[high]-data[low])` step is a divide-by-zero hazard when the extremes are equal.

### Selection (kth element)

The kth-largest family demonstrates QuickSelect in recursive, iterative-partition, and randomized-pivot forms (`algorithms-miscellaneous-1/.../kthlargest/FindKthLargest.java`). Across two sorted arrays the kth-smallest is shown three ways: merge-then-sort O((n+m) log), linear-merge O(k), and binary-search-on-partition O(log min). QuickSelect returns `0` for an out-of-range `k` — a silent-wrong-answer weakness worth guarding in real code.

### String / pattern matching

For large texts the corpus contrasts naive scanning, Rabin-Karp (rolling hash + probable-prime modulus, with `((value % prime) + prime) % prime` to stay non-negative — `textsearch/TextSearchAlgorithms.java:87`), Knuth-Morris-Pratt (precomputed shift table, no text backtracking), Boyer-Moore-Horspool (bad-character shift table of size 256 — breaks for codepoints > 255), and a suffix tree where every suffix is `$`-terminated and walked to find positions.

### Edit distance

Levenshtein distance is shown recursively and as a 2D-DP table taking the min of substitution, insertion, and deletion (`algorithms-miscellaneous-2/.../editdistance/*`). It is the canonical small-DP example (cross-reference the dynamic-programming section).

### 2026 currency

All search and string-matching code here is hand-rolled, pure-JDK 8 (`Optional`, `Comparator`, arrays) with no `javax`/`jakarta` surface, and is **evergreen** — only stylistic relics (debug `System.out.println`) date it. The single forward-looking modernization is the pluggable PRNG API **`RandomGenerator` / `RandomGeneratorFactory` (Java 17)** over bare `new Random()` for the randomized-pivot QuickSelect, giving reproducible, swappable randomization. The numeric utilities adjacent to this family (e.g. hex conversion) move to `java.util.HexFormat` (Java 17) — see [HexFormat — Oracle docs](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/HexFormat.html) — but the search algorithms themselves did not change.
