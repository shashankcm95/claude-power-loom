---
kb_id: algorithms-design/trees-heaps-and-buffers
version: 1
tags:
  - algorithms-design
  - data-structures
  - trees
  - heaps
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: data-structures, algorithms-miscellaneous-5, algorithms-miscellaneous-6"
  - "OpenHFT/Chronicle-Queue releases (https://github.com/OpenHFT/Chronicle-Queue/releases)"
related:
  - algorithms-design/sorting-algorithms
  - algorithms-design/graph-algorithms
status: active
---

## Summary

**Concept**: Hand-built data structures — trie (prefix tree), binary tree / BST, self-balancing AVL tree, binary/min-max heaps, streaming-median two-heap pattern, K-way merge, linked lists, and a lock-free SPSC circular (ring) buffer.
**Key APIs**: trie `Map.computeIfAbsent` insert + recursive bottom-up-pruning delete; AVL `getBalance` + 4 rotation cases (LL/RR/LR/RL); generic binary-heap index math `2i+1`/`2i+2`/`(i-1)/2`; two `PriorityQueue` heaps for streaming median; `volatile` sequence counters + modulo wrap for the ring buffer.
**Gotcha**: single-pass `(isBalanced, height)` tuple avoids an O(n^2) balance check; variant-1 streaming median truncates `.5` because `median` is `int`; the disk-backed `bigqueue` is unmaintained.
**2026-currency**: pure-JDK data structures are evergreen; `com.leansoft:bigqueue` → Chronicle Queue (`net.openhft:chronicle-queue`).
**Sources**: Baeldung `data-structures` + `algorithms-miscellaneous-5/6`.

## Quick Reference

**Trie (prefix tree)**: `Map<Character,TrieNode>` children + an `endOfWord` flag. Insert via `Map.computeIfAbsent`; delete is recursive with bottom-up node pruning (`Trie.java:14, 41-61`).

**Binary tree / BST**: add / contains / delete (0/1/2-child cases, with in-order-successor replacement on the 2-child delete); in/pre/post/level-order traversals (recursive + iterative); an ASCII pretty-printer using box-drawing connectors.

**AVL tree**: self-balancing BST with height tracking, a `getBalance` helper, and the 4 rotation cases:

| Imbalance | Rotation |
|---|---|
| Left-Left | single right |
| Right-Right | single left |
| Left-Right | left then right |
| Right-Left | right then left |

**Heaps**:
- Generic binary heap with index math `parent=(i-1)/2`, `left=2i+1`, `right=2i+2`.
- **Min-Max heap** — double-ended, alternating min/max levels, grandchild comparisons.
- **Streaming median** — two `PriorityQueue` heaps (a max-heap of the low half via `Comparator.reverseOrder()` + a min-heap of the high half) kept balanced within 1 (`MedianOfIntegerStream.java:17-41`).
- **K-way merge** — min-heap of the sorted-sequence heads.

**Tree algorithms**: reverse a binary tree (recursive + BFS-iterative); balanced-tree check via a **single-pass `(isBalanced, height)` tuple** so the recursion is O(n), not O(n^2) (`BalancedBinaryTree.java:9-22`).

**Lists**: find middle (slow/fast pointers), reverse (iterative + recursive), circular singly-linked (`tail.next = head`).

**Circular / ring buffer**: a fixed-capacity generic `CircularBuffer<E>` with `volatile` write/read sequence counters and modulo indexing — lock-free for the single-producer/single-consumer (SPSC) case.

**Disk-backed queue**: `Big Queue` (third-party `com.leansoft.bigqueue`), a persistent on-disk queue — unmaintained.

**Top gotchas**:
- The naive balanced-tree check recomputes height per node → O(n^2); the tuple-returning single pass fixes it.
- Variant-1 streaming median truncates `.5` because `median` is typed `int`.

**Current (mid-2026)**: the pure-JDK structures are evergreen. The disk-backed `com.leansoft:bigqueue:0.7.0` (~2016, abandoned) is superseded by **Chronicle Queue** (`net.openhft:chronicle-queue`), an actively-maintained off-heap memory-mapped persistent journal.

## Full content

This is the hand-built data-structures core, taught in `data-structures` plus tree/heap helpers in `algorithms-miscellaneous-5/6`.

### Tries and binary trees

The trie uses a `Map<Character,TrieNode>` per node plus an `endOfWord` boolean; insert is `computeIfAbsent`, and delete recurses to prune now-empty nodes bottom-up. The BST supports add / contains / delete (including the 2-child case via in-order-successor replacement), all four traversal orders both recursively and iteratively, and an ASCII pretty-printer.

### AVL and heaps

The AVL tree tracks height, computes a balance factor (`getBalance`), and applies the four rotation cases (LL/RR/LR/RL) to stay balanced. Heaps appear as a generic binary heap (with the standard `2i+1`/`2i+2`/`(i-1)/2` index arithmetic), a double-ended Min-Max heap (alternating min/max levels with grandchild comparisons), a streaming-median pattern using two balanced `PriorityQueue` heaps, and a K-way merge driven by a min-heap of sorted-sequence heads.

### Tree algorithms

Reversing a binary tree is shown recursively and via BFS iteration. The balanced-tree check is the instructive one: returning an `(isBalanced, height)` tuple in a single recursive pass avoids recomputing height at every node, turning an O(n^2) naive check into O(n).

### Lists and buffers

Linked-list utilities cover find-middle (slow/fast), reverse (iterative + recursive), and circular singly-linked (`tail.next = head`). The circular/ring buffer is a fixed-capacity generic `CircularBuffer<E>` using `volatile` sequence counters and modulo indexing — lock-free for a single producer and single consumer. A disk-backed persistent queue is shown via the third-party `bigqueue`.

### 2026 currency

- **`com.leansoft:bigqueue` → Chronicle Queue.** The unmaintained (~2016) disk-backed queue is superseded by **Chronicle Queue** (`net.openhft:chronicle-queue`, current **2026.4**), an actively-maintained off-heap memory-mapped persistent journal. [OpenHFT/Chronicle-Queue releases](https://github.com/OpenHFT/Chronicle-Queue/releases)
- The in-memory pure-JDK structures (trie, BST, AVL, heaps, ring buffer) are evergreen. A latent-risk note: the `bigqueue` 0.7.0 dependency carries no new CVEs but is unpatched-forever — treat any seeded use as deprecated.
- The corpus does **not** cover red-black trees (AVL only), B-trees/B+trees, skip lists, or probabilistic structures (Bloom filters, HyperLogLog) — known gaps if those are needed.
