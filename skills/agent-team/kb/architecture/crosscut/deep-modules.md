---
kb_id: architecture/crosscut/deep-modules
version: 1
tags:
  - crosscut
  - design-principle
  - foundational
  - architecture
  - complexity-management
  - information-hiding
sources_consulted:
  - "A Philosophy of Software Design (John Ousterhout, 2nd ed 2021) ch 4 (Modules Should Be Deep) + ch 5 (Information Hiding) + ch 6 (General-Purpose Modules) + ch 7 (Different Layer, Different Abstraction) + ch 8 (Pull Complexity Downwards)"
  - "Clean Code (Robert C. Martin, 2008) ch 3 (Functions) + ch 10 (Classes) — provides the counterpoint position"
  - "Clean Architecture (Robert C. Martin, 2017) ch 21 (Boundaries) — boundary-as-deep-module framing"
  - "The Pragmatic Programmer (Hunt/Thomas, 20th anniv 2019) — orthogonality + decoupling principles"
related:
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/dependency-rule
  - architecture/crosscut/information-hiding
  - architecture/crosscut/acyclic-dependencies
  - architecture/ai-systems/agent-design
status: active+enforced
---

## Summary

**Principle (Ousterhout)**: Modules should be deep — simple interface, powerful implementation. Optimize for depth (benefit/cost ratio), not "small."
**Counter-position**: Clean Code's "small functions" gospel produces classitis (excess decomposition); both views serve cognitive load reduction; depth subsumes both.
**Test**: caller understands a deep module via interface alone; doesn't need internals.
**Sources**: Ousterhout (PoSD ch 4-8) + Martin (Clean Code ch 3+10) + Pragmatic Programmer.
**Substrate**: hook scripts as deep modules; forcing instructions as deep abstractions; Convention G class taxonomy.

## Quick Reference

**Principle (Ousterhout, PoSD ch 4)**: The best modules are deep — they have a lot of functionality behind a simple interface.

Depth = benefit (functionality) / cost (interface complexity). Optimize for depth, not size.

**Recognizing depth (canonical examples)**:

- Unix file system API (open / read / write / close — vast functionality, tiny interface)
- Garbage collector (one-method effective interface; profound implementation)
- TCP (in-order reliable byte stream; hides packet ordering, retransmission, congestion)

**Recognizing shallowness (anti-examples)**:

- Classes that delegate everything to one collaborator (pass-through)
- Get/Set bean classes — interface size = field count
- Pass-through method classes — every public method invokes a similar internal method

**Pull complexity downwards (rule of thumb)**:

Pull down complexity if it (1) is closely related to existing functionality, (2) results in many simplifications elsewhere, (3) simplifies the interface.

**Information hiding (the partner technique)**:

- Hide implementation decisions: data structures, algorithms, error conditions
- Information leakage = same knowledge in multiple modules
- Avoid temporal decomposition (organize by knowledge, not time order)

**Tension with Clean Code's "small functions"**:

Both views serve cognitive load reduction. Resolution: depth subsumes both. Small functions are fine *within* deep modules; small *without* depth produces classitis (Ousterhout's term). Use depth as load-bearing metric, not function-line-count.

**Apply when**: designing reusable modules / classes / libraries; public APIs; layer boundaries; refactoring "should I split this class?" decisions.

**Substrate examples**:

- Hook scripts: stdin JSON / stdout JSON contract (simple); rich validation logic (deep)
- Forcing instructions: bracketed marker (simple); semantic recovery + substrate detection (deep)
- kb-resolver: 5 subcommands (simple); content-addressing + manifest + snapshot (deep)
- Convention G: 3-class taxonomy (simple); composing the substrate's full forcing-instruction family (deep)

## Intent

Two opposing failure modes in module design:

1. **God classes** — one massive module accumulates every responsibility; impossible to navigate, change-prone, untestable
2. **Classitis** — too-fine decomposition produces many tiny modules whose interfaces collectively impose more cognitive load than one well-designed comprehensive module

The "small is good" heuristic (Clean Code's "functions should be small") is a useful rule against god classes but, taken too far, produces classitis. Ousterhout's *A Philosophy of Software Design* is structured as the explicit counterpoint: depth, not size, is the right optimization target.

The intent of the deep-modules principle is to **make the cost of using a module low and the benefit of using it high**, by hiding complexity behind a simple interface rather than exposing it.

## The Principle

> "The best modules are those whose interfaces are much simpler than their implementations." — Ousterhout, *A Philosophy of Software Design* ch 4

Reformulated:

- **Cost**: the complexity a module imposes on callers (interface methods, parameters, exceptions, ordering constraints, pre-conditions)
- **Benefit**: the functionality the module provides (work done internally that callers don't need to do themselves)
- **Depth = benefit / cost**

A deep module: simple interface (low cost), powerful implementation (high benefit) — high depth.

A shallow module: interface complexity comparable to or exceeding implementation complexity — low or negative depth.

The goal is to maximize depth, not minimize size.

## Why depth matters

### Cognitive load

Per Ousterhout: complexity exists in two forms — *change amplification* (one logical change touches many files) and *cognitive load* (developers must understand many things to make changes). Deep modules reduce both.

When a caller uses a deep module, they understand the simple interface and trust the powerful implementation. They don't need to understand internals. The module *encapsulates* complexity — that's the cost-benefit win.

When callers must understand the module's internals to use it correctly, the module is providing no real abstraction. Its interface is leaky; its depth is shallow.

### Interface as cost

Every method on the public interface is a permanent cost imposed on every caller, forever:

- Each parameter must be considered when calling
- Each exception must be handled (or explicitly acknowledged)
- Each ordering constraint must be respected
- Each method-name must be remembered

Adding to the interface is rarely free. Removing is harder still. Therefore: keep the interface as small as possible while preserving usefulness.

### Implementation flexibility

A deep module's implementation can be replaced or refactored without touching callers, because the simple interface doesn't expose internal decisions. Shallow modules, by contrast, leak internal choices into their interfaces — replacing the implementation requires touching every caller.

## Recognizing depth

### Classic deep modules from the Unix world

- **Unix file system API**: `open`, `read`, `write`, `close`, `lseek` — a small interface that hides enormous implementation complexity (block allocation, journaling, caching, permissions, network filesystems, etc.)
- **Garbage collector**: typically a one-method interface (`new`/`malloc` triggers it implicitly); hides extraordinary internal complexity (mark-and-sweep, generational collection, write barriers)
- **TCP**: presents an in-order, reliable byte stream; hides packet ordering, retransmission, congestion control, fragmentation

These are exemplars: tiny interface, profound functionality. Callers interact with abstractions, not implementations.

### Classic shallow modules (anti-examples)

- **Classes that delegate everything to one collaborator**: their entire interface is a wrapper over a single internal method
- **Get/Set bean classes**: one method per field; interface size = field count; provides no abstraction
- **Pass-through method classes**: every public method invokes a similarly-named method on a held reference

Per Ousterhout (ch 4): shallow modules don't reduce overall complexity — they just spread it across more files. The cognitive cost of using N shallow modules is comparable to or greater than using one well-designed comprehensive module.

## Tension with Clean Code's "Small Functions"

This is the most cited tension in modern software design. Clean Code (Martin, ch 3): "The first rule of functions is that they should be small. The second rule is that they should be smaller than that."

Taken literally, this produces classitis. Ousterhout argues directly against this in PoSD ch 4 (titled "Modules Should Be Deep") — small for its own sake is anti-functional.

### Resolution: depth subsumes both

Both views are reaching for the same goal: low cognitive load. They differ on the right knob:

- Clean Code: minimize *function size* → small functions are easier to understand individually
- Ousterhout: maximize *module depth* → cumulative cognitive load matters, not local function size

A deep module can have a small interface AND large internal functions. A deep module can also have a small interface and small internal functions composed together. **Both are fine** — the test is depth (interface vs implementation), not local size.

The synthesis (per Pragmatic Programmer's emphasis on judgment): apply Clean Code's "small functions" rule where it serves understanding; reject it where it forces shallow modules. Use depth as the load-bearing metric, not function-line-count.

### When small functions help (Clean Code is right)

- Top-level orchestrator functions that delegate well-named subtasks
- Pure functions where the name reveals the abstraction (e.g., `extractDomainFromEmail`)
- Functions whose existence makes calling code more declarative

### When small functions hurt (Ousterhout is right)

- Functions that exist only to break up a long function with no reusability and no abstraction win
- Methods where the name is just a paraphrase of the body (`isEven(n) { return n % 2 == 0; }` outside a teaching context)
- Pass-through methods that delegate to an internal field with no semantic value-add
- Functions whose interface (parameters, return type, exceptions) is comparable in complexity to their body

## Information Hiding (the partner principle)

Per Ousterhout (PoSD ch 5), information hiding is the technique by which deep modules are built:

> "Information hiding is the technique for achieving deep modules where the implementation is hidden and not exposed in the interface."

A deep module hides its implementation decisions:

- Data structures used internally
- Algorithms chosen for the work
- Error conditions that don't affect the caller
- Caching, logging, or metric details

What gets exposed is the *abstraction* — what the module does, not how. When a design decision (data structure, algorithm) is hidden in one module, that module can change without affecting any caller.

### Information leakage (the failure mode)

Information leakage occurs when the same knowledge appears in multiple modules:

```python
# In file_writer.py
def write_user(user):
    fmt = "%s|%s|%d\n"  # ❌ format choice
    return fmt % (user.name, user.email, user.id)

# In file_reader.py — ELSEWHERE
def parse_user(line):
    parts = line.strip().split("|")  # ❌ same format choice, leaked
    return User(name=parts[0], email=parts[1], id=int(parts[2]))
```

Both functions know about the pipe-delimited format. Changing the format requires touching both. The format has *leaked* across module boundaries. **Refactor**: encapsulate the format in one module that exposes `serialize_user` and `deserialize_user`; both writer and reader depend on this module; the format choice is now hidden.

## Pull Complexity Downwards

Per Ousterhout (PoSD ch 8): "It is more important for a module to have a simple interface than a simple implementation."

When designing a module, the question is: who absorbs the complexity?

- **Push complexity up**: module exposes config parameters, intermediate states, error conditions. Each caller must handle them. Complexity is duplicated across N callers.
- **Pull complexity down**: module makes reasonable defaults, hides intermediate states, recovers from errors internally. Each caller sees a simple interface. Complexity is absorbed once, in the module.

Pull-down rule of thumb: pull complexity down if it (1) is closely related to existing functionality, (2) results in many simplifications elsewhere, (3) simplifies the interface.

### Configuration parameters as a case study

Many modules expose configuration parameters because the developer wasn't sure what the right value was, so they made it the caller's choice. Ousterhout argues: more often than not, the *module developer* is in a better position to choose the value than the caller. Exposing the parameter pushes complexity up to every caller without giving them a real benefit.

**Heuristic**: ask whether users are better able to find a value than the module is. If not, choose a sensible default and hide the option. Most callers benefit; the rare expert can override.

## Different Layer, Different Abstraction

Per Ousterhout (PoSD ch 7): "If adjacent layers have similar abstractions, that signals a problem with class decomposition."

A well-designed system layers from concrete (low) to abstract (high). Each layer presents a *different* abstraction than its neighbors. When adjacent layers expose nearly the same abstraction, the layering is doing no work — it's introducing complexity (more files, more interfaces) without providing useful encapsulation.

### Pass-through methods (a classitis symptom)

```typescript
class UserService {
  constructor(private repository: UserRepository) {}
  
  // Pass-through: just delegates to repository
  findById(id: string) { return this.repository.findById(id); }
  findByEmail(email: string) { return this.repository.findByEmail(email); }
  save(user: User) { return this.repository.save(user); }
  delete(id: string) { return this.repository.delete(id); }
}
```

`UserService` adds no abstraction beyond `UserRepository` — every method passes through. The "service layer" is shallow; the layer above it gets nothing it couldn't have gotten directly from the repository.

Solutions per Ousterhout (ch 7):

1. **Expose lower-level class directly** — eliminate the shallow wrapper
2. **Remove responsibility from higher-level class** — push it down to where the real abstraction lives
3. **Redistribute functionality** — find the abstraction-mismatch and rebalance
4. **Merge classes** — if the layering doesn't earn itself, collapse it

## Substrate-Specific Examples

### Hook scripts as deep modules

Each substrate hook (fact-force-gate, config-guard, validate-no-bare-secrets, etc.) is a deep module by design:

- **Interface**: stdin JSON in, stdout JSON out (or block-reason). One simple shape.
- **Implementation**: full validation logic, file pattern matching, edit-application semantics, error handling, logging, atomic-rename for tracker files

The interface is profoundly simple — the Claude Code runtime sees only "command, JSON in, JSON out, exit code." The implementation handles complex domain semantics (drift detection, cluster pattern matching for emphasis, plan-schema enforcement). Depth ratio is high.

When the validate-no-bare-secrets implementation evolved (H.7.21 Edit-result scan; H.7.10 `_lib/lock.js` RMW fix; etc.), no consumer changed — the JSON-in/JSON-out interface stayed identical. That's the depth win in action.

### Forcing instructions as deep abstractions

A forcing instruction is a deep module at the substrate-Claude boundary:

- **Interface**: bracketed marker in stdout text (`[PROMPT-ENRICHMENT-GATE]`, `[PLAN-SCHEMA-DRIFT]`, etc.)
- **Implementation**: substrate's deterministic detection logic + Claude's semantic recovery action

The marker itself is trivial. The semantics behind it (when does this fire? what should Claude do?) are rich. Claude reads the simple marker, understands the deeper contract, acts. The substrate doesn't need to encode the semantic recovery — it's hidden in Claude's training plus the substrate's prompt-pattern documentation.

This is depth at the protocol level: minimal interface, profound functionality.

### kb-resolver as a deep abstraction

`kb-resolver.js` exposes a tiny CLI interface:

```bash
node kb-resolver.js cat <kb_id>       # print doc body
node kb-resolver.js resolve <kb_id>@<hash>   # validate + return
node kb-resolver.js scan              # rebuild manifest
node kb-resolver.js snapshot <run-id> # freeze for chaos test
```

Five subcommands. Hidden inside: file system traversal, content-addressed hashing, manifest generation, hash-pinned ref resolution, snapshot freeze for chaos tests. Massive functionality, simple interface.

### `_lib/` modules as depth in action

The substrate's `_lib/` extracted helpers:

- `lock.js` — interface: `withLock(path, fn, opts)`. Implementation: PID-tracking, stale-lock detection, atomic rename, retry, garbage-PID guard.
- `runState.js` — interface: `getRunStateBase()`. Implementation: env-var precedence, walk-up search, hardcoded fallback.
- `toolkit-root.js` — interface: `findToolkitRoot()`. Implementation: env-var precedence, sentinel-file detection, walk-up traversal.

Each module: one or two functions exposed; rich internal semantics. Each consumer (4-6 callers per module) gets the abstraction without learning the implementation. When `lock.js` got its self-PID orphan reclamation in H.3.6, all consumers benefited transparently — the depth made the fix one-place.

### Convention G's class taxonomy as a deep abstraction

Convention G (H.7.25) distills the forcing-instruction family into a 3-class taxonomy:

- Class 1: advisory forcing instruction (deterministic detect + semantic recovery)
- Class 2: operator notice (status surface)
- Class 1 textual variant on hard-gate substrate

The taxonomy is the interface — three named classes. The implementation (when each fires; how each composes; why each exists) is the depth. Future substrate work can reason about new forcing instructions by referencing the class names — the deep abstraction makes complex coordination tractable.

### Anti-example: pre-Convention G forcing instructions

Before H.7.25, the substrate had 11 ungrouped forcing instructions, each with bespoke documentation. The "interface" was 11 separate names — high cost imposed on anyone trying to understand the family. The "implementation" was the same 11 things. Depth ratio: ~1 (no real abstraction). Convention G converted this to a 3-class abstraction; depth ratio shot up dramatically.

This is the substrate observing its own depth-deficit and refactoring to fix it.

## Tension with Other Principles

### Deep Modules vs YAGNI

Pulling complexity down implies the module developer anticipates patterns the caller will need. Done speculatively, this is YAGNI violation — building flexibility for hypothetical futures.

**Heuristic**: pull down complexity that is *closely related to existing functionality* and *results in concrete simplifications elsewhere*. Don't pull down speculative complexity.

### Deep Modules vs DRY

Deep modules sometimes encapsulate logic that *could* be shared with other modules. But sharing creates coupling. The trade-off: keep the deep module self-contained (some duplication) or extract the shared logic (some coupling).

**Heuristic**: prefer self-contained deep modules until duplication causes pain. The cost of premature extraction (interface coupling, shared-module coordination) often exceeds the cost of duplication.

### Deep Modules vs Single Responsibility

A deep module *can* have one responsibility expressed at high abstraction (TCP = "reliable byte stream"). But the principle of depth doesn't force narrow responsibility — a deep module could have multiple responsibilities if their interfaces compose into one cohesive abstraction.

The two principles are complementary:

- SRP: how to define module *boundaries* (one reason to change)
- Deep Modules: how to design module *interfaces* (simple surface, rich implementation)

A well-designed module satisfies both: one reason to change AND simple-interface-rich-implementation.

## Anti-Patterns

### Classitis

Per Ousterhout: many tiny classes whose individual simplicity is overwhelmed by collective interface complexity. Each class is "easy to understand in isolation," but using them together imposes high cognitive load.

**Counter**: optimize for depth, not for class count. Don't break a coherent module into pieces unless each piece earns its abstraction.

### Pass-Through Layer

A layer that exists to "decouple" but adds no abstraction — every method delegates to the layer below.

**Counter**: collapse the layer; or redesign so it actually presents a different abstraction than its neighbors.

### Configuration Avalanche

Module exposes 20+ config parameters because the developer couldn't decide on defaults. Each parameter is permanent cognitive load on every caller.

**Counter**: pull complexity down — choose sensible defaults; expose only the parameters that have legitimate caller-specific concerns.

### Leaky Abstractions

Module's interface forces callers to understand internal details (e.g., must call `setup()` before `process()`; must handle `ImplementationDetailException`).

**Counter**: design from the caller's perspective; eliminate ordering constraints and impl-specific exceptions where possible. If they can't be eliminated, they're not really hidden — acknowledge in documentation.

### Ego-Driven Cleverness

Per Ousterhout (ch 11, "Design It Twice"): designers often jump to the first plausible design without considering alternatives, especially when ego is involved. The first design is rarely the deepest.

**Counter**: design every important interface twice. Sketch alternatives. Compare on depth, complexity, and clarity. The second design is often substantially deeper than the first.

## When to use this principle

- Designing any reusable module / class / library
- Designing a public API surface
- Designing layer boundaries in a system
- When refactoring decisions arise (especially "should I split this class?")
- When evaluating proposed abstractions in code review

## When NOT to use this principle (or apply with caveat)

- **Prototypes / scripts** where the cost of sustained design exceeds the benefit
- **Truly trivial wrappers** that exist for a specific narrow reason (e.g., test fixtures) — just keep them simple
- **One-off code** that won't be reused

## Failure modes

- **Bloated modules masquerading as deep** — interface stays large, claimed as "necessary." Solution: remove cost from the interface; ensure there's a real depth ratio.
- **God modules disguised as deep** — one massive class with many responsibilities. Solution: SRP first; then deep modules within each responsibility boundary.
- **Misreading depth as size** — assuming deep means large. Depth is a *ratio*; small implementations can be deep if their interfaces are even smaller.
- **Skipping abstraction** — pulling complexity down sometimes obscures it. Solution: hide implementation, but document the abstraction precisely.

## Tests / verification

- **Interface inspection**: list the public methods of the module. Are any redundant? Could any be hidden? Does each provide work that callers couldn't easily do themselves?
- **Caller test**: does every caller of this module need to understand something specific to it (beyond reading the method name)? If yes, the abstraction is shallow.
- **Implementation test**: how big is the implementation relative to the interface? If implementation is comparable to or smaller than interface, depth is suspect.
- **Replacement test**: could the implementation be replaced (different algorithm, different data structure) without touching any caller? If no, the interface is leaking.
- **The "simple use case" test**: does the most common use of this module require only a single method call with default arguments? If not, the easy case isn't easy enough.

## Related Patterns

- [architecture/crosscut/single-responsibility](single-responsibility.md) — SRP defines module boundaries; deep modules optimize interface design within those boundaries
- [architecture/crosscut/information-hiding](information-hiding.md) — the technique for achieving depth; what's hidden becomes the depth
- [architecture/crosscut/dependency-rule](dependency-rule.md) — deep modules at boundaries enable inversion; shallow modules force outward dependencies
- [architecture/discipline/trade-off-articulation](../discipline/trade-off-articulation.md) — depth is itself a trade-off (developer effort vs caller benefit); explicit articulation per Hard Parts

## Sources

Authored by multi-source synthesis of:

1. **A Philosophy of Software Design** (John Ousterhout, 2nd ed 2021), the canonical source for this principle. Particular weight on:
   - Ch 4 (Modules Should Be Deep) — the principle statement
   - Ch 5 (Information Hiding and Leakage) — the technique
   - Ch 6 (General-Purpose Modules are Deeper) — generality vs specificity
   - Ch 7 (Different Layer, Different Abstraction) — pass-through methods, decorator analysis
   - Ch 8 (Pull Complexity Downwards) — the rule of thumb
2. **Clean Code** (Robert C. Martin, 2008), ch 3 (Functions) + ch 10 (Classes). Provides the explicit counterpoint position ("functions should be small"). The tension between Martin and Ousterhout is itself a pattern; explicit articulation here.
3. **Clean Architecture** (Robert C. Martin, 2017), ch 21 (The Clean Architecture). Boundaries are deep modules at the architectural scale.
4. **The Pragmatic Programmer** (Hunt/Thomas, 20th anniv 2019). Orthogonality and decoupling as enabling principles for deep modules.

Substrate examples cite drift-notes from H.3.6 (`_lib/lock.js` self-PID reclamation), H.7.10 (RMW-race fix), H.7.14 (`_lib/toolkit-root.js` extraction), H.7.21 (Edit-result scan extension), H.7.25 (Convention G class taxonomy as deep abstraction), and the broader hook-script architecture.

## Phase

Authored: kb authoring batch 2 (post-H.7.27, soak-track work). First-wave priority 3 of the authoring queue. Multi-source synthesis with explicit Ousterhout-vs-Martin tension preserved. Substrate examples emphasize the hook-script architecture and Convention G as concrete depth applications.
