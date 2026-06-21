---
kb_id: algorithms-design/heuristic-metaheuristic-optimization
version: 1
tags:
  - algorithms-design
  - optimization
  - metaheuristics
  - genetic-algorithms
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: algorithms-genetic, algorithms-miscellaneous-1, algorithms-miscellaneous-4, algorithms-miscellaneous-6, algorithms-miscellaneous-3, algorithms-miscellaneous-2, optaplanner"
  - "OptaPlanner continues as Timefold (https://timefold.ai/blog/optaplanner-fork)"
related:
  - algorithms-design/graph-algorithms
  - algorithms-design/combinatorics-dp-bit-numeric
  - algorithms-design/rule-engines-and-state-machines
status: active
---

## Summary

**Concept**: Heuristic/metaheuristic optimization breadth — genetic algorithms (from-scratch + Jenetics), swarm/colony (ACO, PSO), local search (simulated annealing, hill climbing, gradient descent), adversarial/game AI (Minimax, MCTS, 2048), applied ML/stats (K-Means, Slope One, chi-square cipher break), and constraint solving (OptaPlanner).
**Key APIs**: Jenetics `Engine`/`Genotype`/`Chromosome`/`Phenotype`/`EvolutionResult`; MCTS Selection(UCT)→Expansion→Simulation→Backpropagation; time-bounded `while (System.currentTimeMillis() < end)`; pluggable `Distance`/`Scorer`/`FitnessFunction` Strategy; OptaPlanner `@PlanningSolution`/`@PlanningEntity`/`@PlanningVariable` + `HardSoftScore`.
**Gotcha**: hidden static mutable state recurs — `SimpleGeneticAlgorithm.solution` is a `static byte[]`; `SlopeOne` keeps `diff`/`freq` as static maps (not thread-safe).
**2026-currency**: OptaPlanner → **Timefold Solver** (2023 fork); Jenetics `org.jenetics`→`io.jenetics` (v4.0) and 3.7.0→8.x; Commons Math3 → Hipparchus.
**Sources**: Baeldung `algorithms-genetic` + misc-1/2/3/4/6 + `optaplanner`.

## Quick Reference

**Genetic algorithms**:
- From-scratch binary-chromosome GA: population, tournament selection, single-point / uniform crossover, mutation, elitism.
- **Jenetics** library: `Engine` / `Genotype` / `Chromosome` / `Phenotype`, alterers, selectors, `EvolutionResult` — on OneMax, knapsack, subset-sum, TSP.

**Swarm / colony**:
- **Ant Colony Optimization (ACO)** for TSP — pheromone trails, alpha/beta weighting, evaporation.
- **Particle Swarm Optimization (PSO)** / Multi-Swarm — inertia / cognitive / social / global velocity terms.

**Local search**:
- **Simulated annealing** for TSP — temperature schedule, accept-worse with `exp((best-current)/t)`.
- **Hill climbing** (Blocks-World).
- **Gradient descent** — adaptive step / sign flip.

**Adversarial / game AI**:
- **Minimax** — Game of Bones / Nim.
- **Monte Carlo Tree Search (MCTS)** — Selection (via UCT) → Expansion → Simulation → Backpropagation; time-bounded anytime: `while (System.currentTimeMillis() < end)` returning best-so-far.
- **2048 solver** — look-ahead best-move.

**Applied ML / stats**:
- **K-Means** clustering — pluggable `Distance` strategy, centroid relocation (Last.fm dataset).
- **Slope One** collaborative filtering.
- **Caesar-cipher break** via chi-square frequency analysis.

**Constraint solving**: **OptaPlanner** — `@PlanningSolution` / `@PlanningEntity` / `@PlanningVariable` / `@ValueRangeProvider`, `HardSoftScore`, easy-Java vs Drools-DRL score directors; `SolverFactory.createFromXmlResource(...)` → `buildSolver()` → `solver.solve(unsolved)`.

**Spatial**: Quadtree range search (2D partitioning, split at `MAX_POINTS`, prune non-overlapping subtrees).

**Reusable design seam**: nearly every optimizer injects a strategy function — `Distance` (K-Means), `Scorer` (A*), `FitnessFunction` (GA) — making the search engine reusable across problems.

**Top gotchas**: hidden static mutable state recurs across this corpus — `SimpleGeneticAlgorithm.solution` (`static byte[]`), `SlopeOne` `diff`/`freq`/`outputData` (static maps) — not thread-safe, two runs clobber.

**Current (mid-2026)**: OptaPlanner was forked as **Timefold Solver** (2023), now the actively-developed successor; OptaPlanner 8 had already moved to Constraint Streams (deprecating `EasyScoreCalculator` + `HardSoftScore.valueOf` → `.of`). Jenetics 3.7.0 → 8.x and the groupId renamed `org.jenetics` → `io.jenetics` at v4.0. Apache Commons Math3 → Hipparchus.

## Full content

This is the heuristic-search breadth of the domain, spanning `algorithms-genetic`, several `algorithms-miscellaneous-*` modules, and `optaplanner`. It is well-covered: GA / ACO / PSO / SA / hill-climbing / gradient-descent / MCTS / minimax all appear, with one real GA library (Jenetics).

### Evolutionary and swarm search

The from-scratch GA implements population management, tournament selection, single-point and uniform crossover, mutation, and elitism on a binary chromosome. Jenetics raises the same ideas to a library with `Engine`/`Genotype`/`Chromosome`/`Phenotype`, pluggable alterers and selectors, and an `EvolutionResult`, applied to OneMax, knapsack, subset-sum, and TSP. ACO solves TSP with pheromone trails (alpha/beta weighting, evaporation); PSO/Multi-Swarm uses inertia, cognitive, social, and global velocity terms.

### Local and adversarial search

Simulated annealing solves TSP with a temperature schedule and a Metropolis accept-worse rule `exp((best-current)/t)`. Hill climbing tackles Blocks-World; gradient descent uses an adaptive step with sign flipping. On the adversarial side, Minimax plays Game of Bones / Nim, MCTS runs the four-phase Selection(UCT)→Expansion→Simulation→Backpropagation loop as a time-bounded anytime algorithm (`while (System.currentTimeMillis() < end)`), and a 2048 solver does look-ahead best-move.

### Applied ML/stats and constraint solving

K-Means clustering uses a pluggable `Distance` strategy with centroid relocation (on a Last.fm dataset); Slope One does collaborative filtering; a Caesar cipher is broken by chi-square frequency analysis. OptaPlanner models constraint problems declaratively (`@PlanningSolution`/`@PlanningEntity`/`@PlanningVariable`/`@ValueRangeProvider`) scored by a `HardSoftScore`, with either an easy-Java or a Drools-DRL score director. A quadtree provides 2D range search with pruning.

The recurring design lesson is the injected strategy function (`Distance`/`Scorer`/`FitnessFunction`) that decouples the search engine from the problem.

### 2026 currency

- **OptaPlanner → Timefold Solver.** OptaPlanner's core team forked the project as **Timefold Solver** in 2023 (current **2.1.0**, 2026-03-28); it is the actively-developed successor and default recommendation. Constraint Streams carry forward (+ a "precompute" optimization); `@PlanningSolution`/`@PlanningEntity` carry over, namespaces change. OptaPlanner 8 had already moved to Constraint Streams (deprecating `EasyScoreCalculator` + `scanAnnotatedClasses` and `HardSoftScore.valueOf` → `.of`). [OptaPlanner continues as Timefold](https://timefold.ai/blog/optaplanner-fork) · [Upgrade from OptaPlanner — Timefold docs](https://docs.timefold.ai/timefold-solver/latest/upgrading-timefold-solver/upgrade-from-optaplanner)
- **Jenetics 3.7.0 → 8.x.** The groupId was renamed `org.jenetics` → `io.jenetics` at v4.0; a current 8.x bump rewrites every import (latest **8.3.0**). [jenetics v8.0.0 release](https://github.com/jenetics/jenetics/releases/tag/v8.0.0)
- **Apache Commons Math3 → Hipparchus.** Forked by the original core devs; Hipparchus (current **4.0.3**) is the actively-developed path. The `Pair` / `ChiSquareTest` APIs in `caesarcipher` / `multiswarm` map to Hipparchus equivalents. [About | Hipparchus](https://www.hipparchus.org/)
- **`RandomGenerator` / `RandomGeneratorFactory` (Java 17)** over bare `new Random()` gives reproducible, swappable PRNGs across the GA/ACO/PSO/SA/MCTS modules.
- The hand-rolled metaheuristics themselves are evergreen; only the library versions and PRNG idiom moved.
