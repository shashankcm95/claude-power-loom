---
kb_id: architecture/crosscut/single-responsibility
version: 1
tags:
  - crosscut
  - solid
  - design-principle
  - foundational
  - architecture
sources_consulted:
  - "Clean Code (Robert C. Martin, 2008) ch 8 + 10"
  - "Principles of Package Design (Matthias Noback, 2018) ch 1"
  - "A Philosophy of Software Design (John Ousterhout, 2nd ed 2021) ch 4-5"
  - "Designing Data-Intensive Applications (Martin Kleppmann, 2017) ch 7"
  - "charlax/professional-programming antipatterns: code-antipatterns / mvcs-antipatterns"
related:
  - architecture/crosscut/dependency-rule
  - architecture/crosscut/deep-modules
  - architecture/crosscut/acyclic-dependencies
status: active+enforced
---

## Summary

**Principle**: A class should have one, and only one, reason to change. Recursive at function / class / module / package / transaction / service / architecture-quantum.
**Test**: list the actors → if multiple, decompose by actor.
**Smells**: 5+ constructor args; util-bag modules; class+method name redundancy.
**Sources**: Martin (Clean Code ch 10) + Noback (PoPD ch 1) + Ousterhout (PoSD ch 4) + DDIA ch 7.
**Substrate**: `_lib/` extraction (H.7.14); Convention G (H.7.25).

## Quick Reference

**Principle (Martin, Clean Code ch 10)**: A class should have one, and only one, reason to change.

Equivalent at module / package / transaction / service / architecture-quantum scale. The load-bearing word is *reason* (or its proxy: *actor*, *task*, *consistency unit*).

**The "reason to change" test**:

1. List the actors (CFO / COO / CTO / Operations / Legal / etc.) requesting changes
2. For each method, identify which actor's request would drive it
3. Multiple actors → SRP violation; decompose by actor
4. Naming exercise: can you name the module without "and" / "or"? `UserAccountAndPaymentManager` is a confession of violation

**Top smells**:

- 5+ constructor-injected dependencies (Noback, PoPD ch 1)
- Class name redundant with method name (`Toasters.get_toaster()`) — charlax
- Util-bag modules — `util.py` / `tools.py` / `lib.py` accumulating unrelated helpers — charlax
- Temporal decomposition — modules organized by *when* operations happen, not *what* knowledge they encapsulate (Ousterhout, PoSD ch 5)
- Cross-actor coupling visible in git log — one PR touches many files for one logical change

**Refactoring patterns**:

- **Extract Class** — split by actor; original delegates or composes via DI
- **Extract Service** (architecture-level) — per Hard Parts ch 7 granularity disintegrators: code volatility / scalability / fault isolation / security / extensibility
- **Compose / Inject** — original module becomes a composer holding references to extracted modules

**SRP at granularities**:

| Level | "Reason to change" expression | Source |
|-------|-------------------------------|--------|
| Function | Does one thing — describable without "and"/"or" | Clean Code ch 3 |
| Class | One actor / change-driver | Clean Code ch 10 |
| Module | One change-pressure (Common Closure) | Noback / Martin |
| Package | One release reason | Noback CCP |
| Bounded Context | One ubiquitous language | Evans (DDD) |
| Transaction | One consistency unit | DDIA ch 7 |
| Architecture Quantum | One deployable + scalable + fault-isolated unit | Hard Parts ch 2 |

**Tensions**:

- **Ousterhout's Deep Modules**: SRP is "one reason to change," NOT "small." Both views serve cognitive load reduction (see [deep-modules](deep-modules.md))
- **DRY**: extract only when *knowledge* is duplicated, not just code (Pragmatic Programmer)
- **Performance**: profile first; relax SRP locally where measured cost demands; document the deviation

**Substrate examples**:

- `_lib/` discipline (H.7.14): 6 hardcoded-path callers → one stable abstraction; one reason-to-change per primitive
- Convention G class taxonomy (H.7.25): 3 forcing-instruction classes, each with one reason to exist; SRP applied at substrate-feature taxonomy
- HETS persona contracts: each `*.contract.json` defines one persona's responsibility scope

## Intent

Software changes when its environment changes — but environments change for many *different* reasons (business rules, technical infrastructure, regulation, team boundaries). A module that responds to multiple change-reasons couples those reasons together: a change in one direction risks breaking work in another. The cost is *change amplification* (many files touched per change) and *cognitive load* (developers must understand multiple unrelated concerns before they can safely modify any part).

The principle is a *separation* principle: keep each module's reasons-to-change isolated from the others. Each module then evolves at its own pace, in response to its own pressures, without disturbing peers.

## The Principle

> "A class should have one, and only one, reason to change."
> — Robert C. Martin (Clean Code, ch 10)

Equivalent phrasings across sources:

- "A module should be responsible to one, and only one, *actor*." (Martin's later refinement: actor = group of stakeholders who request changes)
- "Each class should focus on one area of responsibility." (Pragmatic Programmer)
- "Functional cohesion: all things in a module can be used to perform a single, well-defined task." (Noback, Principles of Package Design)
- "Each transaction should do one thing." (DDIA ch 7 — transactional units of consistency)

The variations point at the same idea at different granularities. The load-bearing word in all of them is **reason** (or its proxy: *actor*, *task*, *consistency unit*).

## Mechanism — how to apply

SRP is applied by *asking different questions* depending on the granularity:

### At function level

- **Question**: Does this function do one thing? (Clean Code: a function should do one thing, do it well, and do it only.)
- **Test**: Can you describe what the function does without using "and" or "or"?
- **Refactor**: Extract Method when a single function spans multiple abstraction levels.

### At class level

- **Question**: Who would request changes to this class, and for what reason?
- **Test**: List the actors. If more than one, the class likely has more than one responsibility.
- **Refactor**: Extract collaborator classes; use composition to recombine; let the original class delegate.

### At module / package level

- **Question**: What change pressure does this module exist to absorb? (per Common Closure Principle, see [acyclic-dependencies](acyclic-dependencies.md))
- **Test**: When the module changes, are the changes for related reasons or unrelated reasons?
- **Refactor**: Split modules along change-reason boundaries, not technical-layer boundaries.

### At transaction / consistency-unit level (DDIA)

- **Question**: What set of writes must succeed-or-fail-atomically as a logical unit?
- **Test**: Does the transaction span multiple aggregates / domains? If yes, the boundary is suspect.
- **Refactor**: Split via Saga; use eventual consistency for cross-aggregate workflows; keep transactions small and atomic.

### At service / architecture-quantum level (Hard Parts)

- **Question**: What's the minimum set of capabilities that must deploy together to function?
- **Test**: What does this service deploy and version independently of others?
- **Refactor**: Use granularity disintegrators (code volatility, scalability isolation, fault isolation) to find seams.

## The "Reason to Change" Test

Concretely, the test runs:

1. **List the actors** (or change-pressures) for the module under inspection. Examples:
   - "The CFO" requests changes when accounting rules change
   - "The COO" requests changes when staffing/HR rules change
   - "The Operations team" requests changes when deployment pipelines change
   - "The Legal team" requests changes when compliance rules change
2. **For each actor, identify which methods serve that actor.**
3. **If multiple actors share methods**, you have a violation: a change for one actor will affect work being done for another.
4. **Refactor by separating** the module so each actor's methods live in their own module.

Martin's classic example: an `Employee` class with `calculatePay()`, `reportHours()`, and `save()` methods serves three actors (CFO, COO, IT/Operations). When the CFO changes payroll rules, the same file is also under change for the COO's reporting changes — concurrency conflicts are inevitable, and the wrong test failure can mask a real bug.

## Recognizing Violations — smell catalog

Cross-source violation patterns:

### Smell: many constructor-injected dependencies

> "A sign of a class with many responsibilities is that it has many dependencies which are injected as constructor arguments." — Noback

If a class's constructor accepts 5+ collaborators, each of those collaborators likely represents a separate reason-to-change. Decompose by clustering related collaborators into sub-objects.

### Smell: class name redundant with method names

> "Repeating class name in method name" — charlax/professional-programming/code-antipatterns

```python
class Toasters(object):
    def get_toaster(self, toaster_id):  # Toasters.get_toaster() is redundant
        pass
```

The redundancy signals that the class scope is too narrow (a `Toaster` is just a holder for `Toaster` operations) AND too wide (the class probably does more than just toaster lookup once you look at all its methods). Refactor: rename to `get()` if the class is genuinely Toaster-focused, or split if not.

### Smell: util-bag modules

> "Having a library that contains all utils" — charlax

```python
def get_current_date(): ...
def create_csv(...): ...
def upload_to_sftp(...): ...
```

`util.py` / `tools.py` / `lib.py` modules that contain every cross-cutting helper accumulate change pressure from every direction. Each new helper makes future changes harder. **Substrate equivalent**: `_lib/` directories that grow into miscellany rather than holding cohesive primitives.

Refactor: split into topic-specific modules (`lib/date_utils.py`, `lib/csv_utils.py`, `lib/sftp.py`) — each with its own change-reason.

### Smell: temporal decomposition

> "Structure of system corresponds to the time order in which operations will occur" — Ousterhout, PoSD ch 5

Modules organized by *when* operations happen (StartupModule, RuntimeModule, ShutdownModule) rather than *what knowledge* they encapsulate. Each module needs to know about every domain because each domain has startup-shaped, runtime-shaped, and shutdown-shaped concerns. Refactor: organize by knowledge domain, not by temporal phase.

### Smell: ENTITY conflated with implementation detail

> "Entities should model business processes, not persistence details" — DDD via charlax/mvcs-antipatterns

Creating a `UserToaster` entity to model a many-to-many association table forces the domain layer to understand database structure. Refactor: put association properties on the entity that makes domain sense (`Toaster.owned_since`); push the association table to the repository layer.

## Refactoring patterns

### Extract Class

When a class has multiple responsibilities, identify the seam (often visible as: this method only uses these fields; that method only uses those fields). Move each cluster to its own class; have the original class delegate or compose.

### Extract Service (architecture-level)

When a module's responsibilities span multiple deployment concerns, extract a service. The granularity disintegrators (Hard Parts ch 7) are: scope/function divergence, code volatility, scalability/throughput, fault tolerance, security, extensibility.

### Compose / Inject

The refactored modules need to interact, so the original module often becomes a *composer* that holds references to the extracted modules and orchestrates their work. This is dependency injection in its most natural form.

### Apply ABF (Ask, Don't Tell) when state is split

When two extracted classes need information about each other, prefer asking (the consumer requests the data it needs) over telling (the producer pushes data). Reduces coupling.

## SRP at Different Granularities

The principle recurses across the system:

| Granularity | "Reason to change" expression | Source |
|-------------|-------------------------------|--------|
| Function | Does one thing — describable without "and"/"or" | Clean Code ch 3 |
| Class | One actor / change-driver | Clean Code ch 10 |
| Module | One change-pressure (Common Closure) | Noback / Martin |
| Package | One release reason | Noback (Common Closure Principle) |
| Bounded Context | One ubiquitous language | Evans (DDD) |
| Transaction | One consistency unit | DDIA ch 7 |
| Architecture Quantum | One deployable + scalable + fault-isolated unit | Hard Parts ch 2 |

The granularities aren't independent — applying SRP at the function level naturally surfaces the right class boundaries; applying it at the class level reveals module/package boundaries; etc. SRP is the foundation that the other SOLID principles + package principles + bounded contexts build on.

## Tension with Other Principles

### SRP vs Ousterhout's "Deep Modules"

The most cited tension. Ousterhout (PoSD ch 4) argues that *small modules accumulate interface complexity faster than they reduce implementation complexity*. He calls excessive class decomposition "classitis" — many tiny classes whose individual interfaces sum to greater cognitive load than one comprehensive class would impose.

This is **not** a contradiction with SRP if you read SRP carefully. The principle is "one reason to change," not "small." A deep module can have one reason-to-change AND a large implementation. The mistake Ousterhout is critiquing is using "small functions" as a proxy for SRP — small without single-responsibility produces shallow modules; single-responsibility without size discipline produces deep modules.

**Resolution**: optimize for *depth* (powerful implementation behind simple interface) AND *single responsibility* (one reason-to-change). The two are compatible; both are about reducing cognitive load.

### SRP vs DRY

Sometimes two modules share code that *looks* identical but represents different change-reasons. Extracting to a shared module satisfies DRY but may violate SRP — when the change-reasons diverge later, the shared module gets pulled in two directions.

**Heuristic** (per Pragmatic Programmer + Clean Code): DRY is about *knowledge* duplication, not *code* duplication. If two pieces of code happen to look similar but encode different knowledge (different reasons-to-change), keep them separate. Extract only when the underlying knowledge is shared.

**Substrate example**: substrate has `_lib/` helpers shared across hooks (locking, file-path patterns, toolkit-root resolution). These are extracted because their reason-to-change is "the substrate's filesystem semantics changes" — one reason, multiple consumers. Other code that *looks* similar across hooks (e.g., logging boilerplate) is intentionally duplicated because each hook's logging context is its own reason-to-change.

### SRP vs Performance

In hot paths, multiple responsibilities sometimes get bundled into a single function for cache locality, branch prediction, or to avoid call overhead. This is a real trade-off (per Hard Parts: "everything in software architecture is a trade-off").

**Heuristic**: optimize SRP first; profile; relax SRP locally and intentionally where measured performance demands it; document the deviation.

## Anti-Patterns

### "I'll just add this to the existing class" — change-by-accretion

The most common SRP violation in practice. A class starts with one responsibility; new feature requires touching it; rather than refactor, the developer adds methods. Repeated, the class accumulates responsibilities organically.

**Counter**: every PR that adds a method to an existing class should justify the addition against SRP. Code review checkpoint: "Does this method serve the same actor as the existing methods?"

### God Classes / God Modules

Extreme SRP violation: a single class/module with hundreds of methods serving every actor in the system. Symptoms: file > 1500 LoC; everyone touches it for every feature; merge conflicts are constant; nobody understands the whole.

**Counter**: split aggressively; use feature-specific names (the act of naming exposes which actor each method serves).

### Wrong-Axis Decomposition

Splitting modules along technical layers (DAO / Service / Controller for every domain) when the change-pressures are actually domain-aligned (User changes affect User's DAO + User's Service + User's Controller together). Each technical layer is then under change for every domain change.

**Counter**: organize by domain first (`user/`, `order/`, `inventory/` each containing their own DAO/Service/Controller), then by technical layer within each domain. This is the principle behind DDD's bounded contexts and Clean Architecture's vertical slicing.

### Premature Service Extraction

Extracting microservices before the change-reasons have stabilized produces "distributed monoliths" — services that always change together because their boundaries don't match their actors. Worst case scenario: now you have all the operational overhead of microservices and none of the independent-deployment benefit.

**Counter**: per Hard Parts, decompose modular monolith first; let actor boundaries emerge through use; extract services only when granularity disintegrators clearly favor it.

## Substrate-Specific Examples

### `_lib/` discipline (H.7.14)

The substrate's `scripts/agent-team/_lib/` extraction is SRP applied at the module level. Before H.7.14, six different files each had their own version of "find the toolkit root" — same code, six places, six change-reasons fused into one repeating pattern. The H.7.14 refactor extracted `_lib/toolkit-root.js` with one reason-to-change ("substrate filesystem semantics") and six callers that each have their own different reasons-to-change.

### Convention G's class taxonomy (H.7.25)

Convention G separates the forcing-instruction family into 3 classes (Class 1 advisory / Class 2 operator notice / Class 1 textual variant on hard-gate substrate). Each class has *one reason* its instructions exist:

- Class 1 exists to ask Claude for semantic recovery
- Class 2 exists to surface state to the human operator
- The variant exists to gate hard-block decisions with structured prose

When patterns drift across classes (e.g., `[MARKDOWN-EMPHASIS-DRIFT]` was a Class 1 with mechanical recovery — wrong reason for Class 1), the violation surfaces: the marker doesn't earn its Class 1 placement, and the H.7.27 migration retired it. Convention G is SRP applied at the substrate-feature taxonomy level.

### `forcing-instruction-family.md` catalog as SRP evidence

Each of the 8 active forcing instructions (post-H.7.27) has one specific detection condition and one specific recovery action. When two instructions had overlapping detection (`[CONFIRMATION-UNCERTAIN]` and `[PROMPT-ENRICHMENT-GATE]` — same hook, same prompt vagueness), the SRP violation surfaced: H.7.26 consolidated them into a unified marker with `tier:` discriminator. The fact that consolidation worked cleanly (no semantic loss) confirms the original split was performative, not principled.

### HETS persona contracts

Each HETS persona's `*.contract.json` defines the persona's responsibilities — what it can be assigned, what its kb_scope must include, what minimum quantities of output it produces. The contract is an SRP statement: "this persona is responsible for X." When `04-architect.contract.json` was extended with F6 (`containsKeywords` on Principle Audit) in H.7.22, it was tightening the architect's responsibility, not adding a second one.

## When to use this principle

- Always, at every granularity. SRP is foundational; later principles (Open/Closed, Liskov, Interface Segregation, Dependency Inversion) assume SRP-decomposed starting points.
- Particularly when adding new methods or fields to existing classes — the addition is a forcing function for SRP review.
- During retrospectives, when a single PR touches many files for one logical change (sign of cross-actor coupling).

## When NOT to use this principle (or apply with caveat)

- **Premature decomposition**: don't split a class that has only one actor today merely because you imagine future actors. YAGNI applies.
- **Performance-critical hot paths**: when measured profiling shows decomposition cost exceeds maintainability benefit. Document the deviation.
- **Throwaway prototypes**: SRP discipline pays back over the long run. For 1-week prototypes that will be discarded, the overhead may exceed the benefit. Don't enforce on disposable code.
- **When the "actor" is conceptual gymnastics**: if you're inventing actors to justify a split, the split probably doesn't earn itself. The actors should be obvious.

## Failure modes when applied incorrectly

- **Over-decomposition (classitis per Ousterhout)**: many tiny classes whose interfaces sum to greater cognitive load than the original. Solution: remember SRP is "one reason to change," not "small."
- **Cyclic dependencies between extracted classes**: when extraction is mechanical (split by line count) rather than principled (split by actor), the resulting classes often need bidirectional references. Solution: invert dependencies via abstractions; sometimes merging back is the right answer.
- **Wrong axis**: as described above (technical layers vs domain). Solution: organize by domain first.

## Tests / verification

- **Constructor argument count**: 5+ constructor args is a smell (Noback rule of thumb).
- **Method clustering**: do methods naturally cluster around fields (some methods touch fields A,B,C; others touch fields D,E,F)? Two clusters → two responsibilities.
- **Change history**: in retrospect, does this module get touched for unrelated reasons? Git log filtered by file is the empirical SRP audit.
- **Naming exercise**: can you name the module without "and"/"or"? `UserAccountAndPaymentManager` is a confession of violation.

## Related Patterns

- [architecture/crosscut/dependency-rule](dependency-rule.md) — once SRP gives clean modules, DIP keeps them depending in the right direction
- [architecture/crosscut/deep-modules](deep-modules.md) — Ousterhout's complexity-management principle; resolves the "small" misreading of SRP
- [architecture/crosscut/acyclic-dependencies](acyclic-dependencies.md) — package-level SRP via Common Closure Principle
- [architecture/crosscut/bounded-contexts](bounded-contexts.md) — DDD's domain-level SRP via bounded contexts
- [architecture/discipline/refactor](../discipline/refactor.md) — mechanics for safely applying SRP-driven refactorings to existing code

## Sources

Authored by multi-source synthesis of:

1. **Clean Code** (Robert C. Martin, 2008), ch 8 (Boundaries) + ch 10 (Classes). The "one reason to change" canonical formulation.
2. **Principles of Package Design** (Matthias Noback, 2018), ch 1 (SRP). Constructor-argument-count smell + "extract collaborators via composition or inheritance" technique.
3. **A Philosophy of Software Design** (John Ousterhout, 2nd ed 2021), ch 4 (Modules Should Be Deep) + ch 5 (Information Hiding). Counterpoint perspective on classitis; refines SRP to be about depth, not count.
4. **Designing Data-Intensive Applications** (Martin Kleppmann, 2017), ch 7 (Transactions). SRP applied to consistency units; transactional boundaries as actor-aligned.
5. **charlax/professional-programming antipatterns** — concrete violation patterns at code level (repeating class name, util-bag modules, temporal decomposition).
6. **Software Architecture: The Hard Parts** (Ford/Richards/Sadalage/Dehghani, 2021) — granularity disintegrators provide service-level SRP heuristics.
7. **The Pragmatic Programmer** (Hunt/Thomas) — DRY-vs-SRP heuristic ("knowledge duplication, not code duplication").

Substrate-specific examples cite drift-notes from this project's H.7.14, H.7.22, H.7.25, H.7.26, H.7.27 phases.

## Phase

Authored: kb authoring batch 1 (post-H.7.27, soak-track work). First-wave priority 1 of the authoring queue. Multi-source synthesis model verified by this doc.
