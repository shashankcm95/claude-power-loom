---
kb_id: architecture/crosscut/dependency-rule
version: 1
tags:
  - crosscut
  - solid
  - design-principle
  - foundational
  - architecture
  - boundaries
sources_consulted:
  - "Clean Architecture (Robert C. Martin, 2017) ch 5 (DIP) + ch 17-21 (Boundaries + The Clean Architecture)"
  - "Principles of Package Design (Matthias Noback, 2018) ch 5 (DIP)"
  - "A Philosophy of Software Design (John Ousterhout, 2nd ed 2021) ch 5 (Information Hiding) + ch 7 (Different Layer, Different Abstraction)"
  - "Software Architecture: The Hard Parts (Ford/Richards/Sadalage/Dehghani, 2021) ch 2 (Coupling)"
  - "Designing Data-Intensive Applications (Martin Kleppmann, 2017) ch 4 (Encoding/Evolution)"
related:
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/deep-modules
  - architecture/crosscut/acyclic-dependencies
  - architecture/crosscut/information-hiding
  - architecture/crosscut/idempotency
  - architecture/ai-systems/rag-anchoring
  - architecture/discipline/trade-off-articulation
status: active+enforced
---

## Summary

**Principle (Martin)**: Source code dependencies must point INWARD toward higher-level policy. Abstractions don't depend on details; details depend on abstractions.
**Two granularities**: DIP (class level — depend on interfaces, not concretions) + Dependency Rule (architecture level — concentric circles, business rules at center, infrastructure outside).
**Test**: business logic compiles without infrastructure on classpath.
**Sources**: Martin (Clean Arch ch 5 + 21) + Noback (PoPD ch 5) + Ousterhout (PoSD ch 5+7) + Hard Parts ch 2.
**Substrate**: kernel/userspace boundary (proto-OS); hooks-as-kernel; `_lib/` extraction (H.7.14); kb-resolver as stable abstraction.

## Quick Reference

**Principle (Martin, Clean Architecture)**: Source code dependencies must point INWARD toward higher-level policy. Abstractions should not depend on details; details should depend on abstractions.

**The DIP rules**:

- Don't refer to volatile concrete classes — refer to abstract interfaces instead
- Don't derive from volatile concrete classes
- Don't override concrete functions
- Never mention the name of anything concrete and volatile

**Inversion technique** (when A naturally wants B but B is more volatile):

1. Define interface I in A's package, expressing only what A needs
2. B implements I (in B's package)
3. A depends on I; B depends on I
4. Compile-time direction: B → A (inverted from natural inclination)
5. Runtime: A still calls B's implementation polymorphically

**Top smells**:

- Business logic imports from infrastructure (`from sqlalchemy import` in `domain/`)
- Framework annotations on domain entities (`@Entity`, `@JsonInclude`)
- Tests need infrastructure to run (database, network, message broker)
- `new` operators in high-level code (use Abstract Factory instead)
- Cross-layer transitive dependencies

**Refactoring patterns**:

- **Extract Interface (Pull-Up)** — interface lives with consumer (more stable side)
- **Add Abstract Factory** — defer concrete creation to outer layer
- **Move Decision Outward** — push config / decisions to composition root
- **Polymorphic Plugin** — common interface; variants implemented separately

**Direction at granularities**:

| Level | Direction expression |
|-------|---------------------|
| Class | DIP — depend on interfaces, not concretions (Martin / Noback) |
| Module | Stable Dependencies Principle — depend on more stable than self (Noback) |
| Package | Common Closure; cross-package deps point at stable abstractions |
| Layer | The Dependency Rule (Clean Architecture concentric circles) |
| Service | Static coupling — quanta depend on stable contracts (Hard Parts) |

**Tensions**:

- **Performance**: indirection has cost; profile + relax locally where measured
- **YAGNI**: don't introduce interfaces speculatively; only when concrete need (testability, swap planned, multiple impls)
- **Simplicity**: avoid "interface-itis" — only invert across volatility seams

**Substrate examples**:

- Kernel/userspace boundary (proto-OS): hooks/contracts/kb-resolver = stable kernel; user-extensions = volatile userspace; deps point inward
- `_lib/` extraction (H.7.14): 6 hardcoded-path callers depend on `findToolkitRoot()` abstraction; abstraction doesn't depend on consumers
- Forcing instructions: substrate emits text format; Claude reads + acts; substrate doesn't depend on Claude internals
- HETS persona contracts: implementations depend on contract.json schema; schema doesn't depend on any specific persona

## Intent

Software architectures fail when concerns get inverted: business rules end up depending on the database driver; domain entities import from web frameworks; tests require infrastructure to run. The result is a system where:

- Replacing a framework requires rewriting business logic
- Tests need a real database, message broker, and HTTP server to run
- A change in low-level detail (Postgres minor version) ripples up through every layer

The Dependency Rule prevents this by **inverting the natural flow of compile-time dependencies** so that volatile, low-level details (frameworks, databases, UI) depend on stable, high-level abstractions (business rules, domain logic) — not the other way around. The result is a system where the core is portable, testable, and immune to most external change.

## The Principle

### DIP (class level)

> "The most flexible systems are those in which source code dependencies refer only to abstractions, not to concretions." — Martin, *Clean Architecture* ch 5

**Practical rules** (Martin):

1. Don't refer to volatile concrete classes — refer to abstract interfaces instead
2. Don't derive from volatile concrete classes
3. Don't override concrete functions
4. Never mention the name of anything concrete and volatile

**Stable** = unlikely to change (interfaces, abstract base classes, primitives, OS APIs). Stable concrete things are exempt — depending on `String` is fine.

**Volatile** = under active change (specific frameworks, databases, third-party libraries you control). Depending on these directly couples your stable code to their change schedule.

### Dependency Rule (architecture level)

> "Source code dependencies can only point inward. Nothing in an inner circle can know anything at all about something in an outer circle." — Martin, *Clean Architecture* ch 21

The Clean Architecture's concentric-circle model:

```text
   ┌────────────────────────────────────┐
   │  Frameworks & Drivers              │  ← outermost, most volatile
   │   (Web, DB, UI, External APIs)     │
   │  ┌──────────────────────────────┐  │
   │  │  Interface Adapters          │  │  ← controllers, presenters, gateways
   │  │   (Controllers, Presenters)  │  │
   │  │  ┌────────────────────────┐  │  │
   │  │  │  Application Business  │  │  │  ← use cases / interactors
   │  │  │  Rules (Use Cases)     │  │  │
   │  │  │  ┌──────────────────┐  │  │  │
   │  │  │  │  Enterprise      │  │  │  │  ← entities, core domain logic
   │  │  │  │  Business Rules  │  │  │  │  (innermost, most stable)
   │  │  │  │  (Entities)      │  │  │  │
   │  │  │  └──────────────────┘  │  │  │
   │  │  └────────────────────────┘  │  │
   │  └──────────────────────────────┘  │
   └────────────────────────────────────┘
                     ▲
   Source code dependencies point INWARD
```

Equivalent at scale (Hard Parts framing): "static coupling" — the compile-time graph — must form a DAG where edges point from outer (volatile) toward inner (stable). The runtime flow of control may go either direction; the *source code dependency* direction is what matters.

## Mechanism — how to apply

### The inversion technique

When component A naturally wants to call component B, but B is more volatile than A:

1. **Define an interface I in A's package** describing what A needs
2. **B implements I**
3. **A depends on I** (its own interface)
4. **B depends on I** (which lives in A's package)
5. **Compile-time direction**: B → A (inverted from the natural inclination)
6. **Runtime direction**: A still calls B's implementation polymorphically

The interface lives with the *consumer* (the more stable side), not the *provider*. This is the load-bearing detail that distinguishes DIP from "just use interfaces."

### Concrete example (from Clean Architecture)

```text
       Application Layer            Database Layer
       ┌─────────────────────┐      ┌──────────────────────┐
       │                     │      │                      │
       │  ┌───────────────┐  │      │  ┌────────────────┐  │
       │  │ FinancialData ◄────────────│ FinancialData  │  │
       │  │    Gateway    │  │      │  │     Mapper     │  │
       │  │  (interface)  │  │      │  │  (concrete)    │  │
       │  └───────────────┘  │      │  └────────────────┘  │
       │          ▲          │      │                      │
       │          │ uses     │      │                      │
       │  ┌───────┴───────┐  │      │                      │
       │  │  Interactor   │  │      │                      │
       │  │ (use case)    │  │      │                      │
       │  └───────────────┘  │      │                      │
       └─────────────────────┘      └──────────────────────┘
```

- **Interactor** (Application) needs to fetch financial data
- **FinancialDataGateway** (interface) lives in the Application layer
- **FinancialDataMapper** (Database concrete) implements `FinancialDataGateway`
- Compile-time: Database depends on Application — *inversion achieved*
- Runtime: Application calls Database polymorphically through the interface

The Application layer is now **independent of the Database layer**. Replacing PostgreSQL with MongoDB requires writing a new mapper that implements `FinancialDataGateway` — Application code is untouched.

### Abstract Factory pattern (object instantiation)

DIP gets violated by `new` operators in high-level code, because `new ConcreteImpl()` is a concrete dependency. The Abstract Factory pattern resolves this:

```text
   Application                                 Concrete
   ┌─────────────────┐                         ┌────────────────┐
   │                 │                         │                │
   │  ServiceFactory │◄────────────────────────│ ServiceFactory │
   │   (interface)   │                         │      Impl      │
   │       ▲         │                         │ (creates       │
   │       │ makeSvc │                         │  ConcreteImpl) │
   │  ┌────┴───────┐ │                         └────────────────┘
   │  │ Application│ │                                  │
   │  └────────────┘ │                                  │ creates
   │       │         │                                  ▼
   │       │ uses    │                         ┌────────────────┐
   │  ┌────▼───────┐ │                         │  ConcreteImpl  │
   │  │  Service   │◄────────────────────────  │  (implements   │
   │  │ (interface)│ │                         │   Service)     │
   │  └────────────┘ │                         └────────────────┘
   └─────────────────┘
```

- `Application` depends on `Service` interface and `ServiceFactory` interface
- `ConcreteImpl` and `ServiceFactoryImpl` live in the volatile/outer layer
- Source-code arrows all point from outer to inner
- Application is fully decoupled from concrete implementations

## The Boundaries Concept

A boundary is the line in the source code dependency graph where direction inverts. Crossing a boundary means: a higher-volatility component compiles against a lower-volatility component, never the reverse.

### Why boundaries matter

Per Martin (*Clean Architecture* ch 17): "A good system architecture allows decisions to be made at the latest possible moment, without significant impact." Boundaries enable this by isolating decisions:

- **Database choice**: deferred behind a Gateway interface; you can choose Postgres vs Mongo at deploy time
- **Web framework**: deferred behind a Controller abstraction; you can swap Express for Fastify without touching business rules
- **UI**: deferred behind a Presenter / View boundary; CLI / Web / Mobile UIs are interchangeable

### Boundary anatomy

A boundary crossing is a function call from one side to the other, mediated by an abstraction:

```text
   stable side                       volatile side
   ┌─────────────────┐               ┌─────────────────┐
   │                 │               │                 │
   │  Use Case       │ ─── calls ──► │  Concrete Impl  │
   │                 │               │   (e.g. SQL)    │
   │   ▲             │               │   │             │
   │   │ implements  │               │   │ depends on  │
   │   │             │               │   ▼             │
   │  Interface      │ ◄─────────────│  Interface      │
   │  (lives here)   │               │                 │
   │                 │               │                 │
   └─────────────────┘               └─────────────────┘
```

The interface "lives" in the stable side; the volatile side compiles against it.

## Granularities — the principle recurses

| Granularity | "Dependency direction" expression | Source |
|-------------|-----------------------------------|--------|
| Function | High-level functions don't call low-level concretes; pass functions as parameters | Functional programming idioms |
| Class | DIP — depend on interfaces, not concrete classes | Martin (Clean Arch ch 5), Noback (PoPD ch 5) |
| Module | Stable modules don't import from volatile modules | Noback's Stable Dependencies Principle |
| Package | Common Closure Principle (separate by change-reason); cross-package deps point at stable abstractions | Noback (PoPD) |
| Layer | The Dependency Rule (Clean Architecture concentric circles) | Martin ch 21 |
| Service | Architecture Quantum static coupling — quanta depend on stable contracts (Hard Parts) | Hard Parts ch 2 |
| Build artifact | Acyclic Dependencies Principle — release direction follows dependency direction | Martin (Clean Arch ch 14) |

The same principle applies all the way down. Apply DIP at the class level, and the right module boundaries emerge; apply it at the module level, and the right layer boundaries emerge; etc.

## Recognizing Violations — smell catalog

### Smell: business logic imports from infrastructure

```python
# In domain/user.py — DOMAIN LAYER
from sqlalchemy import Column, Integer, String  # ❌ infrastructure dep
from flask import jsonify                        # ❌ web framework dep

class User:
    id = Column(Integer, primary_key=True)
    name = Column(String)
    
    def to_response(self):
        return jsonify({"id": self.id, "name": self.name})  # ❌ couples domain to web
```

The domain entity now requires SQLAlchemy and Flask to compile. Tests can't run without them. Migration to FastAPI requires rewriting the entity. **Refactor**: move SQLAlchemy mapping to `infrastructure/user_mapper.py`; move JSON serialization to `interface/user_presenter.py`; keep `domain/user.py` framework-free.

### Smell: framework annotations on domain entities

```java
@Entity                              // ❌ JPA annotation in domain
@Table(name = "users")               // ❌ persistence detail
@JsonInclude(NON_NULL)               // ❌ serialization detail
public class User {
    @Id                              // ❌ JPA annotation
    @GeneratedValue                  // ❌ JPA annotation
    private Long id;
    
    @Column(name = "user_name")      // ❌ database column name
    private String name;
}
```

Entity is shackled to JPA, Jackson, and a specific database schema. **Refactor**: pure POJO entity in domain; separate JPA-annotated mapper in infrastructure; mapping function in interface adapter layer.

### Smell: tests that need infrastructure to run

If your unit tests for use cases require a real database, message broker, or HTTP server, the use cases depend on those concretions. **Refactor**: inject test doubles for the infrastructure interfaces; use cases should be testable in pure isolation.

### Smell: `new` operators in high-level code

```typescript
// In use_case/create_order.ts — APPLICATION LAYER
class CreateOrderUseCase {
  execute(input: OrderInput) {
    const repo = new PostgresOrderRepository();  // ❌ direct concretion
    const sender = new SmtpEmailSender();        // ❌ direct concretion
    // ...
  }
}
```

`new ConcreteImpl()` is a compile-time dependency on the concrete. **Refactor**: inject via constructor (DI) and depend on interfaces; or use Abstract Factory pattern.

### Smell: cross-layer transitive dependencies

`A` imports from `B` (legitimate). `B` imports from `C` (legitimate). But `A`'s consumers now have a transitive dependency on `C`. If `C` is volatile, `A` is now indirectly volatile. **Refactor**: introduce abstractions at the `B` boundary so `A`'s consumers don't see `C`.

### Smell: data structures derived from framework types

```python
def create_user(request: HttpRequest):  # ❌ use case takes web type
    user = User(...)
    return HttpResponse(...)             # ❌ use case returns web type
```

Per Martin (*Clean Arch* ch 20): "Use case object should have no inkling about the way that data is communicated to the user." **Refactor**: define plain `CreateUserRequest` / `CreateUserResponse` data structures owned by the use case; controllers translate from `HttpRequest` to use case input.

## Refactoring Patterns

### Extract Interface (Pull-Up)

When module A directly imports concrete class B, and B is more volatile than A:

1. Identify what A actually needs from B (often a small subset of B's interface)
2. Define interface I in A's package, expressing only what A needs
3. Make B implement I (in B's package)
4. Replace A's import of B with import of I
5. Verify: A no longer compiles against B; B compiles against I

This is the Interface Segregation Principle (ISP) applied to enable DIP.

### Add Abstract Factory

When A needs to *create* instances of B (using `new`):

1. Define `IFactory` interface in A's package
2. Add `IFactory.create()` method returning `IService` (the interface)
3. Implement `ConcreteFactory` in B's package, returning concrete instances
4. Inject `IFactory` into A via constructor or method parameter
5. A calls `factory.create()` — concrete creation deferred to outer layer

### Move Decision Outward

When a low-level decision (e.g., "which encryption algorithm?") is being made in a high-level module:

1. Define decision as an injected dependency (strategy pattern)
2. Move decision logic to a configuration layer (composition root)
3. High-level module receives the strategy at construction; doesn't know which strategy

### Polymorphic Plugin

When swapping behavior across many call sites is needed (different DB engines, different auth providers):

1. Define common interface
2. Implement variants in separate packages
3. Composition root (outermost layer) selects variant at startup
4. All other code references the interface; never the concrete variant

## Tension with Other Principles

### Dependency Rule vs Performance

Indirection through interfaces has runtime cost (vtable lookups, branch prediction misses, allocation overhead from factories). For hot paths, this can matter.

**Heuristic** (per Hard Parts trade-off discipline): apply Dependency Rule by default; profile; relax locally and intentionally where measured cost matters; document the deviation.

### Dependency Rule vs YAGNI

Adding interfaces preemptively for "flexibility you might need" violates YAGNI. Most interfaces never see a second implementation; they're maintenance burden with no return.

**Heuristic** (Noback, PoPD ch 5): only introduce an interface when you have a *concrete* reason — not all third-party code requires DIP. Only abstract when:

- Not all public methods are meant for regular clients
- The class uses I/O (need test doubles)
- Class depends on volatile third-party code
- You foresee user wanting to replace the implementation
- Multiple specific things need a unified abstraction

Otherwise: stick with concrete classes (final classes, no interfaces). Per Noback: "Classes that almost never need an interface are: classes that model a domain concept; classes that represent stateful objects; classes that represent particular business logic or calculations."

### Dependency Rule vs Simplicity

Aggressive dependency inversion can produce "interface-itis" — every concrete class shadowed by an interface, doubling the file count for no real benefit.

**Counter**: distinguish *stable* from *volatile* dependencies. Stable concretions don't need inversion; only invert the volatility seams.

### Dependency Rule vs Pragmatism (small projects)

For a 200-line script or a 1-week prototype, full Clean Architecture concentric circles are overkill. The boundaries don't earn themselves at small scale.

**Heuristic**: apply Dependency Rule at the granularity that matches project scale. A small project may have one boundary (domain ↔ everything else); a complex one may have all four Clean Architecture layers.

## Anti-Patterns

### Reverse-Inversion (Concrete-First Design)

Designing the database schema or HTTP API first, then "fitting" business logic around it. The result: business rules are shaped by infrastructure constraints; entities are JPA-annotated row shapes rather than domain concepts.

**Counter**: design domain entities first as plain types; design use cases against pure entity types; let infrastructure adapt to the domain, not vice versa.

### Pseudo-Inversion (Interface as Decoration)

Defining an interface that only one class will ever implement, where the interface mirrors the class methods 1:1, just to "satisfy DIP." Doesn't help — there's no inversion benefit, just doubled file count.

**Counter**: only introduce interfaces where actual variability exists or testability requires it. Mock-needing is a legitimate reason; "satisfying the principle" is not.

### Leaky Abstraction

Interface designed correctly, but implementation details leak through (e.g., `Repository` interface that returns `SQLException`-wrapped results). Consumers end up depending on the leaked details transitively.

**Counter**: interfaces should expose only the abstraction, not its implementation context. If domain consumers need to handle "not found," express that as a domain concept (`Optional<User>` or `UserNotFoundError`), not as a database error.

### Stable Dependency on Volatile (PoPD's smell)

Importing a high-velocity package (constantly updated, breaking changes between versions) from your stable code. Each version of the dependency forces churn in your stable layer.

**Counter** (per Stable Dependencies Principle, PoPD): "A package should only depend upon packages that are more stable than it is." Wrap volatile dependencies in your own stable abstraction.

## Substrate-Specific Examples

### Kernel/Userspace boundary (proto-OS framing)

The substrate's positioning as a proto-OS for AI development relies on the Dependency Rule:

- **Kernel** (stable, slow-changing): hooks runtime, contract verification, kb-resolver, identity store, route-decide gate
- **Userspace** (volatile, user-extensible): custom skills, custom patterns, custom personas, project-specific ADRs

Source code dependencies must point inward — from userspace toward kernel. Custom skills depend on kb-resolver's interface; kb-resolver does not depend on any specific skill. Custom personas depend on contract.json schema; the schema doesn't depend on any specific persona.

When this boundary is violated (e.g., kernel hardcoding a path to a specific skill), the substrate's stability promise breaks. The H.7.14 `_lib/toolkit-root.js` extraction was a Dependency Rule application: substrate scripts now depend on `findToolkitRoot()` (a stable abstraction) rather than on hardcoded paths (volatile concretions).

### Hooks-as-kernel pattern

Each hook script is a stable module: it accepts JSON on stdin, emits JSON on stdout (or block-reason). The hook's interface is the stdin/stdout contract — fully abstract, framework-independent. Implementations of business validators (validate-no-bare-secrets, validate-frontmatter-on-skills, validate-plan-schema) compile against this stable interface.

The Claude Code runtime acts as the outer layer (the volatile framework). When Claude Code's hook protocol changes (it has, three times across substrate phases), only the *boundary translation layer* changes — the validators themselves, expressed in terms of the stable JSON contract, are untouched.

This is the Dependency Rule applied to plugin architecture: the plugin's internals depend only on the documented protocol; the protocol does not know about any specific plugin.

### kb-resolver and content-addressed refs

`kb-resolver.js` exposes `cat <kb_id>` / `resolve kb:<id>@<hash>` / `snapshot <run-id>`. These are stable abstractions. Consumers (HETS spawn flow, contract verifier, agent scripts) depend on these abstractions — never on the underlying file format, hash algorithm, or content layout. When the substrate added content-addressed hashing (H.2-bridge.2), consumer code was untouched because they depended on the abstract `resolve` operation, not on the implementation.

The Dependency Rule lets us evolve the kb implementation (add manifests, add validation, change file format) without breaking consumers.

### HETS persona contracts

Each persona's `contract.json` is the stable abstraction. Persona implementations (when the substrate spawns them via Claude Code's Agent tool) depend on the contract — not the other way around. Adding F6 (`containsKeywords` on Principle Audit) to `04-architect.contract.json` in H.7.22 was an extension of the abstraction; existing persona implementations continued working until they were specifically updated to satisfy F6.

### The `_lib/` extraction pattern

Substrate's `scripts/agent-team/_lib/` directory holds DRY abstractions extracted across multiple callers. By H.7.27, this includes:

- `lock.js` — file-locking primitive (4+ callers)
- `runState.js` — run-state directory resolution (3+ callers)
- `file-path-pattern.js` — file path detection patterns (2+ callers)
- `toolkit-root.js` — toolkit root resolution (6 callers)
- `marketplace-state-reader.js` — marketplace mirror state (3 callers)

Each is a stable abstraction; the consumer scripts depend on these. The consumer scripts can change for their own reasons (their own actors, their own use cases) without breaking the shared library. When the shared library changes (H.7.10's RMW-race fix to `lock.js`), all consumers benefit transparently.

This is exactly the Dependency Rule applied to substrate-internal architecture.

### Forcing instructions and the abstraction over Claude

The forcing-instruction family (8 active markers post-H.7.27) is itself a Dependency Rule application: substrate scripts emit forcing instructions (stable text format with bracketed markers) without depending on Claude's internals. Claude reads the forcing instruction and decides — Claude depends on the substrate's abstract communication channel (stdout text), not the other way around.

This inversion is what lets the substrate continue working across Claude model versions (Sonnet 3.5, Sonnet 4, Opus, etc.). The substrate is the stable layer; Claude implementations are the volatile layer that adapts.

## When to use this principle

- Always at the architectural-layer boundary between business logic and infrastructure (database, framework, web)
- At any module boundary where one side is significantly more volatile than the other (e.g., your code vs third-party SDK)
- When you need to test high-level logic without instantiating expensive or stateful low-level dependencies
- When you anticipate replacing a specific concrete implementation (database swap, framework migration)
- When multiple concrete implementations of the same role need to coexist (multi-database support, plugin systems)

## When NOT to use this principle (or apply with caveat)

- **Stable-to-stable dependencies**: depending on `String`, `List<T>`, language stdlib types — no inversion needed
- **Single-implementation interfaces with no testability concern**: pseudo-inversion; doubles the file count for no benefit
- **Throwaway scripts / 1-week prototypes**: full inversion overhead exceeds benefit at this scale
- **Hot paths where indirection cost is measured to matter**: profile first, then make a documented exception
- **Domain entities and value objects** (per Noback): these usually don't need interfaces — they ARE the abstractions

## Failure modes

- **Interface-itis**: every class shadowed by an interface; double the files for no benefit. Solution: only invert across volatility seams.
- **Leaky abstraction**: interface exposes implementation details transitively. Solution: design interface from consumer's perspective; reject any method that requires consumer to know implementation.
- **Wrong direction**: dependency points outward (toward more volatile). Solution: re-examine which side is more volatile; the abstraction lives with the more stable side.
- **Premature inversion**: defining interfaces speculatively. Solution: introduce inversion when concrete need arises (second implementation needed, testability required, swap planned), not preemptively.
- **Configuration leakage**: business logic reads config values directly, coupling it to config format. Solution: inject configuration as parameters; high-level logic doesn't know where config comes from.

## Tests / verification

- **Compile-time check**: business-rule modules should compile without infrastructure dependencies on the classpath. If they don't, you have leakage.
- **Test isolation**: unit tests for use cases should run without database, network, or message broker. If setup requires these, the use case has concrete dependencies.
- **Substitution test**: can you swap one concrete implementation for another without changing the higher-level code? If no, the higher-level code has concrete dependencies.
- **Static analysis**: tools like `dependency-cruiser` (JS/TS) or `archunit` (Java) can enforce architectural dependency rules. Configure them to fail builds on inward-vs-outward direction violations.
- **Import audit**: grep for forbidden imports in domain layer (e.g., `grep -r "from sqlalchemy" domain/` should return zero results).

## Related Patterns

- [architecture/crosscut/single-responsibility](single-responsibility.md) — once SRP gives you well-decomposed modules, DIP keeps them depending in the right direction; the two are paired
- [architecture/crosscut/deep-modules](deep-modules.md) — deep modules naturally hide implementation; DIP exposes the right level of abstraction
- [architecture/crosscut/information-hiding](information-hiding.md) — DIP and Information Hiding solve overlapping problems via different mechanisms
- [architecture/crosscut/acyclic-dependencies](acyclic-dependencies.md) — package-level dependency direction; ADP says no cycles; DIP says directions
- [architecture/crosscut/stable-dependencies](stable-dependencies.md) — Noback's I-metric quantifies stability for dependency-direction decisions

## Sources

Authored by multi-source synthesis of:

1. **Clean Architecture** (Robert C. Martin, 2017), ch 5 (DIP statement) + ch 17-21 (Boundaries, Policy and Level, Business Rules, The Clean Architecture). The architectural-scale formulation; concentric circles; "source code dependencies point inward."
2. **Principles of Package Design** (Matthias Noback, 2018), ch 5 (DIP). The class-level mechanics; rules for when interfaces earn themselves; the I-metric and A-metric for measuring stability and abstractness.
3. **A Philosophy of Software Design** (John Ousterhout, 2nd ed 2021), ch 5 (Information Hiding) + ch 7 (Different Layer, Different Abstraction). Complementary view — depth and abstraction layering; pass-through methods as a Dependency Rule violation symptom.
4. **Software Architecture: The Hard Parts** (Ford/Richards/Sadalage/Dehghani, 2021), ch 2 (Coupling). Static coupling as the architecture-quantum-level Dependency Rule; trade-off between coupling forms.
5. **Designing Data-Intensive Applications** (Martin Kleppmann, 2017), ch 4 (Encoding/Evolution). Backward/forward compatibility as a runtime form of dependency-direction concern (older code as the stable abstraction).

Substrate examples cite drift-notes from H.7.14 (`_lib/toolkit-root.js` extraction), H.7.22 (kernel/userspace framing), H.7.10 (`lock.js` RMW-race fix), and the broader proto-OS positioning established post-H.7.27.

## Phase

Authored: kb authoring batch 2 (post-H.7.27, soak-track work). First-wave priority 2 of the authoring queue. Multi-source synthesis from 5 sources covering class-level DIP through architecture-level Dependency Rule. Substrate examples emphasize the kernel/userspace boundary as the proto-OS-positioning load-bearing application.
