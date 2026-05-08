---
kb_id: architecture/crosscut/acyclic-dependencies
version: 1
tags:
  - crosscut
  - solid
  - design-principle
  - foundational
  - architecture
  - package-design
sources_consulted:
  - "Principles of Package Design (Matthias Noback, 2018) ch on Acyclic Dependencies Principle + Stable Dependencies Principle"
  - "Clean Architecture (Robert C. Martin, 2017) ch 14 (Component Coupling)"
  - "A Philosophy of Software Design (John Ousterhout, 2nd ed 2021) ch 9 (Better Together or Better Apart) — coupling considerations"
  - "Software Architecture: The Hard Parts (Ford/Richards/Sadalage/Dehghani, 2021) ch 2 (Coupling) + ch 5 (Component-Based Decomposition)"
  - "charlax/professional-programming antipatterns: code-antipatterns 'Util-bag library'"
related:
  - architecture/crosscut/dependency-rule
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/deep-modules
  - architecture/discipline/trade-off-articulation
status: active+enforced
---

## Summary

The dependency graph between packages / modules / components must be **acyclic** — a directed acyclic graph (DAG), no cycles. Cyclic dependencies make modules impossible to release independently, build atomically, or reason about in isolation. Per Martin (Clean Arch ch 14): "the morning after syndrome" — developers find their work broken because someone else changed a file in a cyclically-dependent module overnight. Resolution patterns: dependency inversion (introduce abstraction); extracting shared elements to a new package; mediator / chain-of-responsibility patterns. Substrate's `_lib/` extraction pattern (H.7.14 + others) IS acyclic-dependencies discipline applied at substrate scale — shared primitives extracted to depend-on-only-from-above.

## Intent

When module A depends on module B, and module B depends on module A, you have a cycle. Cycles are deeply problematic:

- **You can't release independently**: changes to A might break B; changes to B might break A; you must coordinate releases
- **You can't build incrementally**: building A requires B; building B requires A; recursive dependency
- **You can't reason in isolation**: understanding A requires understanding B; vice versa; the "module" is now A+B as one entangled unit
- **You can't extract**: when you want to reuse just A in another project, you must bring B along; transitively, anything B depends on; the cycle drags the whole graph

The intent of the Acyclic Dependencies Principle (ADP) is to keep the dependency graph clean enough that:

1. Every release is a clear, ordered sequence of components
2. Every component can be built, tested, deployed in isolation
3. Every component can be reasoned about by reading its source plus its (acyclic) dependencies
4. Every component can be extracted for reuse without bringing the entire graph

## The Principle

> "Allow no cycles in the component dependency graph." — Martin, *Clean Architecture* ch 14 (citing Robert C. Martin's Acyclic Dependencies Principle)

> "There must be no cycles in the dependency structure." — Noback, *Principles of Package Design* (paraphrasing the same principle)

The principle is structural — about the *graph shape*, not about specific modules. It applies at every granularity:

- Class dependencies (a class shouldn't depend on a class that depends on it)
- Module dependencies (modules form a DAG)
- Package dependencies (packages form a DAG; this is the canonical formulation)
- Service dependencies (in microservices, services form a DAG)
- Build artifact dependencies (jars, npm packages, etc. form a DAG)

The deeper fact: **a DAG can be topologically sorted**. There exists a linear order in which to build / release / understand the components. A graph with cycles cannot be — there's no "first" component.

## The "Morning After Syndrome"

Per Martin (Clean Architecture ch 14): a recognizable failure mode of teams without ADP discipline:

- Developers work all day on their feature
- Push to shared branch at end of day
- Come in next morning to find their code broken
- Investigation: someone else changed a file in a cyclically-dependent module
- Their feature now requires fixes to "their" code that they didn't change

The team learns to fear merge / pull. They work in long-lived branches to avoid integration. They schedule "integration days." They lose velocity.

The cause is cyclic dependencies between modules: changes propagate in ways that aren't predictable from looking at the file you're changing. The module's compile-time graph is the system's actual structure; cycles obscure it.

## Why cycles emerge

Cycles are rarely introduced deliberately. They emerge through innocent-seeming local decisions:

### Pattern: bidirectional reference

Module A needs to reference Module B for some functionality. Six months later, Module B needs to reference back to A for some operation. The bidirectional reference creates a cycle.

```text
A → B (initial; clean)
A ← B (added later; cycle now)
```

Each individual decision was correct in isolation. The cycle is an emergent property.

### Pattern: shared utility extraction

Modules A and B both need `formatDate()`. Pull it out to a shared `utils.py`. Now A depends on `utils`; B depends on `utils`. So far so good.

Later, `utils.py` grows: it now needs to call back to A's helpers (because A had some related logic). Now `utils → A`. Combined with `A → utils`, we have a cycle.

### Pattern: helper class trap

Module A has a helper class. The helper happens to need access to A's main class. The helper imports A; A imports its helper. Cycle.

### Pattern: god module

The "god module" / util-bag (per charlax) accumulates dependencies on everything. Eventually some other module needs to call into the god module; god depends on that module too; cycle.

## Recognizing cycles

### Static analysis

Tools like `dependency-cruiser` (JS/TS), `archunit` (Java), `import-linter` (Python), `pydeps` can detect cycles automatically. CI integration: fail the build if any cycle is introduced.

This is the substrate's recommended approach for v2.1+ runtime integration: a static-analysis pre-write hook (per drift-note 47) catches cycles deterministically before they ship.

### Manual inspection — the import map

Generate the dependency graph (e.g., `npm ls`, `pip list --graph`, `gradle dependencies`) and visualize. Cycles show up as visible loops. For small projects, this works without specialized tooling.

### Symptom inspection

Cycles often manifest as symptoms before they're recognized as cycles:

- "We can't release component X without component Y at the same time"
- "Why does my change to A break tests in B?"
- "We have to build everything in order; can't build just one component"
- "The folder structure looks like everything depends on everything"

When these symptoms appear, the dependency graph likely has cycles.

## Resolution patterns

When you find a cycle, the goal is to convert it to a DAG. Several techniques:

### Pattern 1: Dependency Inversion (most common)

Introduce an abstraction (interface) that both modules can depend on, breaking the direct cycle:

```text
Before:
   A → B
   A ← B
       (cycle)

After:
   A → I ← B
   A ← B-impl-of-I

(I lives in A's package or in a third package; B implements I)
```

This is the same DIP technique from [dependency-rule](dependency-rule.md) applied at module / package scope. The abstraction (interface) is the "lower-level" thing both modules depend on; concrete classes don't reference each other directly.

### Pattern 2: Extract Common Module

If A and B both reference shared logic, extract that logic to a third module C; both A and B depend on C; A and B don't depend on each other:

```text
Before:
   A ↔ B

After:
   A → C ← B
```

This works when the shared concern is genuinely shared and stable. Doesn't work if the shared logic is itself part of the cycle.

### Pattern 3: Mediator Pattern

If A and B need to communicate but shouldn't depend on each other, introduce a mediator M that knows both:

```text
A → M → B
A ← M ← B
```

A talks to M; M talks to B. Neither A nor B knows about the other. This is the classic mediator pattern from GoF, applied to break cycles.

### Pattern 4: Event Dispatcher (combining mediator + chain-of-responsibility)

For complex many-to-many cycles, use an event dispatcher:

- Each module emits events without knowing who listens
- Each module subscribes to events without knowing who emitted
- The dispatcher mediates

This decouples to the point where there are no compile-time references between the original cyclic modules. Trade-off: now you have a runtime coupling via events, and reasoning about flow becomes harder.

### Pattern 5: Merge

Sometimes A and B genuinely belong together — they were artificially split, and the cycle is the system telling you they're one thing. Merging them into a single module eliminates the cycle.

Per Ousterhout (PoSD ch 9 — Better Together or Better Apart): when two modules share a lot of state / used together / hard to understand independently, merging is often the right answer.

### Pattern 6: Refactor to single direction

Sometimes the bidirectional reference exists because of laziness — A→B is needed for one specific feature; B→A is needed for one specific feature; combining gives the cycle. The right answer might be to remove one of the references entirely (sometimes by passing data instead of by holding a reference).

## Acyclic Dependencies and Stable Dependencies (Noback)

The ADP is paired with the **Stable Dependencies Principle** (per Noback): "A package should only depend upon packages that are more stable than it is."

Stability has a quantitative measure (Noback's I-metric):

```text
I = C-out / (C-in + C-out)

where:
  C-out = number of outside classes the package depends on (efferent coupling)
  C-in  = number of outside classes that depend on this package (afferent coupling)
```

- I close to 0: very stable (many things depend on it; it depends on few things)
- I close to 1: very unstable (it depends on many things; few things depend on it)

The principle: dependencies should flow from less stable (high I) toward more stable (low I). In a DAG sorted by stability, the most stable packages are sinks; the most unstable packages are sources.

### Why stability gradient matters

Stable packages are the foundation. Building on them is safe — they don't change much, so your code doesn't break.

Unstable packages are the leaves. They change often (because they depend on many things; any of those changing forces them to change). They're the volatile part of the system.

Cycles are particularly bad here because they break the stability gradient: if A depends on B, and B depends on A, neither is more stable than the other. Both have to change together. The whole cycle becomes one big unstable unit.

## Substrate-Specific Examples

### `_lib/` extraction as ADP discipline

Substrate's `scripts/agent-team/_lib/` directory is acyclic-dependencies applied at substrate scale. Six different scripts originally each had their own version of "find the toolkit root." Each script independently coupled to the filesystem layout:

```text
Before (no cycle yet, but high coupling and duplication):
   contracts-validate.js → filesystem-layout-knowledge
   _lib/runState.js     → filesystem-layout-knowledge
   kb-resolver.js       → filesystem-layout-knowledge
   budget-tracker.js    → filesystem-layout-knowledge
   pattern-runner.js    → filesystem-layout-knowledge
   agent-identity.js    → filesystem-layout-knowledge
```

H.7.14 extracted `_lib/toolkit-root.js`. Now all six callers depend on `toolkit-root.js`; `toolkit-root.js` doesn't depend on any of them:

```text
After (clean DAG):
   contracts-validate.js → _lib/toolkit-root.js
   _lib/runState.js     → _lib/toolkit-root.js
   kb-resolver.js       → _lib/toolkit-root.js
   budget-tracker.js    → _lib/toolkit-root.js
   pattern-runner.js    → _lib/toolkit-root.js
   agent-identity.js    → _lib/toolkit-root.js
```

`_lib/toolkit-root.js` is the most stable component — every consumer depends on it; it depends on nothing in the substrate. Per Noback's I-metric, its instability is near zero. The DAG is clean; no cycle was ever introduced.

### `_lib/` modules as stable sinks

The substrate's `_lib/` has accumulated several stable primitives:

- `_lib/lock.js` — file-locking; ~4 consumers
- `_lib/runState.js` — run-state directory; ~3 consumers
- `_lib/file-path-pattern.js` — file path detection; ~2 consumers
- `_lib/toolkit-root.js` — toolkit root; ~6 consumers
- `_lib/marketplace-state-reader.js` — marketplace mirror state; ~3 consumers
- `_lib/settings-reader.js` — settings.json access; ~2 consumers

Each is a stable sink in the dependency graph. Each consumer depends on `_lib/X`; no `_lib/X` depends on any consumer. The substrate's `_lib/` directory is by construction acyclic.

### Hook → validator dependency direction

Substrate's hooks invoke validators (PreToolUse:Edit|Write hook calls validate-no-bare-secrets). The dependency is one-way: hook depends on validator (loads it); validator doesn't depend on hook (no callback into Claude Code runtime).

This is the Dependency Rule applied to plugin architecture: validators are the stable substrate; hooks are slightly less stable (they're glue). The direction is preserved by design.

### Forcing instructions emit without referencing back

The substrate's forcing-instruction architecture is acyclic by design: hooks emit forcing instructions to stdout (text format); Claude reads and acts. The communication is one-way at compile time:

```text
Hook → forcing-instruction text → stdout → Claude
```

Hook doesn't know about Claude's response. There's no compile-time reference from hook code to "what Claude did with the forcing instruction." The control flow has feedback (Claude may invoke another hook later), but the compile-time graph is acyclic.

This is the substrate's load-bearing architectural decoupling: substrate primitives don't know about Claude internals; Claude doesn't know about substrate internals. They communicate through the documented protocol (forcing instructions, JSON in/out).

### `kb-resolver` as a high-fan-in stable sink

`kb-resolver.js` is consumed by HETS spawn flow, contract verifier, agent scripts, hook scripts, and more. Many consumers; few or no internal dependencies on substrate-specific modules.

Per Noback's I-metric: kb-resolver has very high C-in (many things depend on it) and very low C-out (it depends on basic file-system primitives only). I ≈ 0; very stable. Its position as a foundation enables the broader substrate architecture.

### Drift-note 47 sibling concern

H.7.27's drift-note 47 sibling concern (forcing-instruction shared helper extraction) is an explicit ADP candidate: 9 different files emit forcing instructions with similar boilerplate. Extracting `_lib/forcing-instruction.js` would create another stable sink consumed by 9 callers.

Currently deferred until the count crosses 7+ callers post-consolidation (drift-note 47). The deferral is intentional: extracting too early creates premature abstraction; too late accumulates duplication. The substrate's discipline is to track the count and extract when the threshold is reached.

### Pre-Convention G forcing instructions had implicit cycles

Before H.7.25's Convention G, forcing-instruction emission code had implicit cyclical references through documentation: each emission file referenced "patterns from the forcing-instruction family"; the family documentation referenced specific emission files. The cycle wasn't structural (no compile-time cycle) but was conceptual (you couldn't understand any single forcing instruction without reading the others).

Convention G broke this conceptual cycle by introducing a *taxonomy* (3 named classes) that's stable and depends on nothing else. Each emission file references the class; the class doesn't reference specific emission files. The conceptual dependency graph is now acyclic.

## Tension with Other Principles

### ADP vs Convenience

Sometimes the most natural code structure has a cycle: A and B "obviously" reference each other because they collaborate closely. Refactoring to break the cycle (introducing interfaces, extracting common modules) feels like over-engineering.

**Heuristic**: small, contained cycles within a single tightly-coupled component (a single class file) are generally fine. Cross-package or cross-module cycles always need to be broken — the cost of even small cycles compounds at module scale.

### ADP vs DRY

DRY says "extract common logic to a shared place." But the shared place can become a new node in the dependency graph; if not careful, it can create cycles by depending on the modules it serves.

**Resolution**: extracted common modules should depend ONLY on lower-level (more stable) primitives. They should never depend on the modules that consume them. If you find yourself wanting a "shared" module to call back into a consumer, the abstraction is wrong.

### ADP vs Speed of Refactoring

Breaking a cycle often requires a non-trivial refactor (introduce interface, move classes, redistribute responsibilities). The cycle persists in the meantime.

**Heuristic** (per Hard Parts trade-off discipline): mark the cycle as a known issue (drift-note style); fix it during the next substantial change to the cycle's modules; don't pause feature work to refactor immediately, but don't ignore indefinitely.

### ADP vs Single-Module Pragmatism

A small project (one app, one team, single module) doesn't need package-design discipline. ADP applies at the granularity where the cost of cycles starts to matter — typically at "shared module" scale or above.

**Heuristic**: apply ADP when the project has multiple deployable units / multiple teams / multiple package boundaries.

## When to use this principle

- **Always at module / package boundaries** — never have cyclic dependencies at this scale
- **In substrate / library design** — your library should not have cycles in its public dependency graph
- **In microservices** — services should form a DAG; cyclic service dependencies are deployment hell
- **In monorepo design** — internal package boundaries enforce ADP via build-tool-level checks

## When NOT to use this principle (or apply with caveat)

- **Within a single class / file**: small contained "cycles" (mutual references between classes in the same file) are sometimes natural; ADP applies at higher granularity
- **Throwaway scripts / single-file tools**: no package boundaries to apply ADP at
- **When the cycle is well-encapsulated and tested**: pragmatically, if a cycle is contained and isn't causing problems, the refactoring cost may exceed the value

## Failure modes

- **Untracked cycles**: cycle exists but no one notices; emerges as "morning after syndrome." Solution: static analysis in CI.
- **Refactor-introduces-new-cycle**: breaking one cycle creates another. Solution: think through dependency graph holistically, not pairwise.
- **Over-eager extraction**: extracting common modules to break cycles creates fragmented architecture. Solution: only extract when the shared concern is real and stable.
- **Wrong abstraction at the broken cycle**: the interface that breaks the cycle leaks implementation details. Solution: design the interface from the consumer's perspective; don't just match the existing implementation.

## Tests / verification

- **Static analysis**: run `dependency-cruiser` / `archunit` / similar in CI; fail on any cycle
- **Build-order check**: can the project build incrementally (one module at a time)? If no, there's likely a cycle
- **Release independence test**: can each component be deployed independently? Cycles break this property
- **Topological sort test**: can you produce a build order? If multiple cycles, no valid order exists

## Related Patterns

- [architecture/crosscut/dependency-rule](dependency-rule.md) — DIP is the technique for breaking cycles via interfaces
- [architecture/crosscut/single-responsibility](single-responsibility.md) — modules with one reason to change tend to have cleaner dependency directions
- [architecture/crosscut/deep-modules](deep-modules.md) — deep modules with simple interfaces make ADP easier (fewer surface points to cycle through)
- [architecture/crosscut/stable-dependencies](stable-dependencies.md) — Noback's I-metric quantifies the stability gradient ADP enables
- [architecture/discipline/trade-off-articulation](../discipline/trade-off-articulation.md) — when ADP requires a refactor, articulate the cost vs benefit

## Sources

Authored by multi-source synthesis of:

1. **Principles of Package Design** (Matthias Noback, 2018), the canonical modern source. Key contributions:
   - The Acyclic Dependencies Principle statement
   - I-metric (instability) and A-metric (abstractness) as quantitative measures
   - The Stable Dependencies Principle and Stable Abstractions Principle
   - Refactoring techniques: dependency inversion, extracting cycle-causing classes, mediator, chain-of-responsibility
2. **Clean Architecture** (Robert C. Martin, 2017), ch 14 (Component Coupling). The "morning after syndrome" framing; the ADP statement; the Weekly Build alternative (and its problems).
3. **A Philosophy of Software Design** (Ousterhout, 2nd ed 2021), ch 9 (Better Together or Better Apart). When to merge tightly-coupled modules vs split them; sometimes the right answer to a cycle is to merge.
4. **Software Architecture: The Hard Parts** (Ford/Richards/Sadalage/Dehghani, 2021):
   - Ch 2 (Coupling) — coupling forms; static vs dynamic
   - Ch 5 (Component-Based Decomposition) — patterns for breaking apart entangled components
5. **charlax/professional-programming antipatterns** — the "util-bag library" antipattern as a common cause of cycles.

Substrate examples cite drift-notes from H.7.14 (`_lib/toolkit-root.js` extraction as ADP discipline), H.3.6 (lock.js fixes), H.7.27 (drift-note 47 sibling concern as ADP candidate), and the broader `_lib/` extraction pattern as the substrate's load-bearing application of ADP at substrate-internal scale.

## Phase

Authored: kb authoring batch 5 (post-H.7.27, soak-track work). First-wave priority 9 of the authoring queue. Multi-source synthesis from 5 sources. Substrate examples emphasize the `_lib/` extraction discipline as the substrate's ADP application; forcing-instruction architecture as compile-time-acyclic-with-runtime-feedback; drift-note 47 as a tracked ADP candidate. The substrate is itself acyclic by construction at the substrate-internal scale.
