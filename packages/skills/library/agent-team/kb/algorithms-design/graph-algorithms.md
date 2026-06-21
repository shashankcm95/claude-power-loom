---
kb_id: algorithms-design/graph-algorithms
version: 1
tags:
  - algorithms-design
  - graphs
  - shortest-path
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: algorithms-miscellaneous-2, algorithms-miscellaneous-3, algorithms-miscellaneous-5, algorithms-miscellaneous-6, algorithms-searching"
  - "google/guava releases (https://github.com/google/guava/releases)"
related:
  - algorithms-design/trees-heaps-and-buffers
  - algorithms-design/heuristic-metaheuristic-optimization
status: active
---

## Summary

**Concept**: Graph traversal (DFS/BFS/topological sort), shortest path (Dijkstra, A*), all three MST algorithms (Prim, Kruskal, Boruvka), cycle detection (three-color DFS; Floyd fast/slow for linked lists), and maze solving — plus the JGraphT and Guava `ValueGraph` libraries.
**Key APIs**: `ArrayDeque`/`Queue` BFS with `visited` set; pluggable `Scorer` cost+heuristic for A*; union-find (`find`/`union`) for MST cycle detection; Guava `MutableValueGraph`/`ValueGraphBuilder`/`EndpointPair`; JGraphT directed/weighted graphs.
**Gotcha**: `BoruvkaMST` stores `mst`/`totalWeight` as `static` (two instances clobber, not thread-safe); a level-order traversal bug checks `node.left != null` then adds `node.right`.
**2026-currency**: Guava `com.google.common.graph` is fully stable (`@Beta` removed, `asNetwork()` added) at 33.6.0; JGraphT 1.0.1 → 1.5.3 changed `VertexFactory`/`HamiltonianCycle`/`jgrapht-ext`.
**Sources**: Baeldung `algorithms-miscellaneous-2/3/5/6` + `algorithms-searching`.

## Quick Reference

**Traversal**:
- **DFS** — recursive + iterative-with-`Stack` on a BST and an adjacency-map graph.
- **BFS** — generic `<T>`, FIFO `ArrayDeque`/`Queue`, a `visited` set.
- **Topological sort** — DFS post-order, prepend to a `LinkedList`.

**Shortest path**:
- **Dijkstra** — hand-rolled settled/unsettled node sets.
- **A\*** — generic `RouteFinder` with a pluggable `Scorer` (cost + heuristic); demo on the London Underground with Haversine distance. The strategy seam is `Scorer.computeCost` (`algorithms-miscellaneous-2/.../astar/RouteFinder.java`).

**Minimum spanning tree** (all three classics):

| MST algorithm | Mechanism | Substrate |
|---|---|---|
| Prim | visited-set greedy edges | hand-rolled |
| Kruskal | sort edges + union-find cycle detection (min & max variants) | Guava `ValueGraph` |
| Boruvka | union-find component merging | Guava `ValueGraph` |

Union-find (`find`/`union`) drives MST cycle detection (`boruvka/UnionFind.java`, `kruskal/CycleDetector.java`).

**Cycle detection**:
- Directed graph: **three-color DFS** (white/gray/black = unvisited / being-visited / visited).
- Linked-list cycle: brute force, hashing, and **Floyd fast/slow** — plus cycle *removal* (brute, counting loop nodes, without counting).

**Maze solving**: BFS shortest path (queue + parent-pointer backtrack) and recursive DFS.

**Library graphs**:
- **JGraphT** — directed/weighted/complete graphs, Hamiltonian cycle, Eulerian circuit, image export.
- **Guava `com.google.common.graph`** — `MutableValueGraph`, `ValueGraphBuilder`, `EndpointPair` (the most modern, still-recommended graph substrate; ports cleanly to 2026).

**Top gotchas**:
- `BoruvkaMST` stores `mst` / `totalWeight` as `static` — two instances clobber each other and it is not thread-safe.
- A snapshot bug: level-order traversal checks `node.left != null` then adds `node.right` (`dfs/BinaryTree.java:145`).

**Current (mid-2026)**: Guava is at **33.6.0** with `@Beta` removed from the whole graph package and an `asNetwork()` view added — the graph API is now fully stable. JGraphT is at **1.5.3**; the base's 1.0.1 pre-dates the `VertexFactory` / `HamiltonianCycle` / `jgrapht-ext` graphics changes.

## Full content

Graph algorithms span several Baeldung modules (`algorithms-miscellaneous-2/3/5/6`, `algorithms-searching`). Most are hand-rolled; the standout modern library usage is Guava's `ValueGraph` (Kruskal/Boruvka run on it).

### Traversal and topological order

DFS is shown recursively and iteratively (with an explicit `Stack`) over both a BST and an adjacency-map graph; BFS is generic over `<T>` with a FIFO `ArrayDeque`/`Queue` and a `visited` set. Topological sort is DFS post-order prepended to a `LinkedList`.

### Shortest path

Dijkstra uses hand-rolled settled/unsettled node sets. A* is the more reusable design: a generic `RouteFinder` parameterized by a pluggable `Scorer` that supplies both the edge cost and the heuristic — demonstrated on the London Underground graph with Haversine distance. The `Scorer.computeCost` injection point is a clean Strategy seam (cross-reference the optimization section's pluggable `Distance`/`FitnessFunction`).

### Minimum spanning trees

All three classic MST algorithms appear: Prim (visited-set greedy), Kruskal (sort edges, union-find cycle detection, both min and max variants), and Boruvka (union-find component merging). Kruskal and Boruvka run on Guava `ValueGraph`. Union-find (`find`/`union`) is the shared primitive.

### Cycle detection and maze solving

Directed-graph cycles use a three-color DFS (white/gray/black). Linked-list cycles are detected by brute force, hashing, and Floyd's fast/slow pointers, with cycle *removal* shown three ways. Maze solving covers BFS shortest path (queue + parent-pointer backtrack) and recursive DFS.

### Library graphs

JGraphT supplies directed/weighted/complete graphs, Hamiltonian-cycle and Eulerian-circuit utilities, and image export. Guava's `com.google.common.graph` (`MutableValueGraph`, `ValueGraphBuilder`, `EndpointPair`) is the most modern substrate and the one that ports forward cleanly.

### 2026 currency

- **Guava graph API is now fully stable.** Current Guava is **33.6.0** (2025-04-14, `-jre` / `-android` flavors); `@Beta` was removed from the whole graph package and an `asNetwork()` view added — the `ValueGraph` usage in `boruvka`/`kruskal` is future-proof. [google/guava releases](https://github.com/google/guava/releases)
- **JGraphT 1.0.1 → 1.5.3** (2026-04-10, the last 1.5.x for Java 11; next is 1.6.0). The base's 1.0.1 pre-dates the `VertexFactory` / `HamiltonianCycle` / `jgrapht-ext` graphics changes, so a bump requires reworking those call sites. [org.jgrapht — mvnrepository](https://mvnrepository.com/artifact/org.jgrapht)
- The hand-rolled traversal / shortest-path / MST / cycle-detection code itself is pure-JDK and evergreen; only the library versions moved.
