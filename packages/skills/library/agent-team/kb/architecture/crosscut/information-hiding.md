---
kb_id: architecture/crosscut/information-hiding
version: 1
tags:
  - crosscut
  - design-principle
  - foundational
  - architecture
  - modularity
  - encapsulation
sources_consulted:
  - "Parnas, D.L., 'On the Criteria To Be Used in Decomposing Systems Into Modules', CACM 15(12), December 1972 — the foundational paper introducing information hiding as a decomposition criterion"
  - "A Philosophy of Software Design (John Ousterhout, 2nd ed 2021) ch 5 (Information Hiding and Leakage) + ch 6 (General-Purpose Modules) + ch 7 (Different Layer, Different Abstraction) + ch 8 (Pull Complexity Downwards)"
  - "Clean Architecture (Robert C. Martin, 2017) ch 5 (Object-Oriented Programming) — encapsulation as one of OO's three load-bearing properties; clarifies info-hiding vs encapsulation"
  - "The Pragmatic Programmer (Hunt/Thomas, 20th anniv 2019) topic 10 (Orthogonality) + topic 32 (Decoupling) — orthogonality + decoupling as practical consequences of information hiding"
related:
  - architecture/crosscut/deep-modules
  - architecture/crosscut/dependency-rule
  - architecture/crosscut/single-responsibility
status: active+enforced
---

## Summary

**Principle (Parnas 1972)**: Decompose systems by hiding design decisions that are likely to change. Each module conceals one design decision from the rest of the system; that decision can change without affecting any caller.
**Failure mode**: information leakage — the same knowledge appears in multiple modules, so a change to that knowledge forces edits in every leak site.
**Test**: pretend a design decision changes; count how many modules must be edited. One = good. Many = leak.
**Sources**: Parnas (CACM 1972) + Ousterhout (PoSD ch 5) + Martin (Clean Architecture ch 5) + Pragmatic Programmer.
**Substrate**: `_lib/` shared modules hide implementation choices behind narrow exports; hook scripts hide validation logic behind stdin/stdout JSON contracts; the registry pattern hides storage layout behind read/write API.

## Quick Reference

**Parnas's decomposition criterion**: identify the design decisions likely to change. Make each one the secret of one module. The module's interface reveals what doesn't change; its implementation hides what does.

**The leak test**: pretend you're going to change a design decision. Count the modules you'd have to edit. If more than one, the decision is leaked — it's encoded redundantly across the system.

**Information hiding vs encapsulation**:

- *Encapsulation* (OO sense): grouping data + methods together; restricting external access via visibility modifiers. Mechanical.
- *Information hiding* (Parnas sense): choosing what NOT to expose. Strategic. Encapsulation is the mechanism; information hiding is the design discipline that guides what to encapsulate.

A module can be encapsulated yet leaky (private data but public methods that expose internal structure). Encapsulation without information-hiding-discipline is just access control.

**Common information leaks** (Ousterhout PoSD ch 5):

- File formats spread across reader + writer modules
- Algorithm choices encoded in callers (e.g., calling code assumes O(log n) lookup)
- Data structure details exposed by method signatures (e.g., returning a HashMap when the caller only iterates)
- Error conditions surfacing implementation details (e.g., SQL errors bubbling to UI)
- Configuration knobs that mirror implementation toggles

**Temporal decomposition** (Ousterhout's named anti-pattern): organizing modules by time-order of operations rather than by knowledge. Produces modules that share too much state with their predecessors + successors. Information hiding decomposes by *what each module knows*, not *when each step runs*.

**Apply when**: defining module boundaries; designing public APIs; deciding what to make private; choosing whether a class should be split.

**Substrate examples**:

- `scripts/agent-team/_lib/lock.js` — hides cross-process locking mechanism (lockfile + stale-PID detection); callers just call `acquireLock()` / `releaseLock()`
- `scripts/agent-team/_lib/frontmatter.js` — hides YAML parsing logic + inline-comment-strip details; callers get clean key/value pairs
- `hooks/scripts/auto-store-enrichment.js` — hides counter-store schema + 30-turn scan trigger; substrate just emits Stop hook input
- ADR-0001 — codifies fail-open + try/catch + logger invariants as substrate discipline; consumers of hooks know "hooks fail soft," not "hooks have these specific try/catch sites"

## Intent

Information hiding addresses the central problem of system change: when a design decision is encoded redundantly across many modules, every change to that decision becomes a multi-module edit. The edit cost scales with redundancy, not with the change's intrinsic complexity. Software ossifies.

Parnas's 1972 paper argues — counterintuitively for its time — that the *criterion* for decomposition should be "what design decisions are likely to change," not "what flowchart step is each module responsible for." The classic example: KWIC (Key Word In Context) indexing. The flowchart-based decomposition produces modules for each processing step (read input, shift words, sort, format). The information-hiding decomposition produces modules around design decisions (line storage, circular shifts, alphabetization criterion). The second is uglier from a procedural view but far easier to change — the storage format can be revised without touching the alphabetization criterion, and vice versa.

The intent isn't to obscure knowledge from teammates; it's to *contain* knowledge so that change is local. Hidden information is information that can be revised in one place.

## The Principle

> "We propose instead that one begins with a list of difficult design decisions or design decisions which are likely to change. Each module is then designed to hide such a decision from the others." — Parnas, CACM 1972 §I

Two formulations:

**Parnas's criterion (1972)**: A module's secret is a design decision; the module's interface should not reveal that decision.

**Ousterhout's restatement (PoSD ch 5)**: Information hiding is the technique for achieving deep modules. The module's *interface* describes what callers can do (abstractly); the *implementation* hides how it's done (data structures, algorithms, transient conditions). What's hidden can change without affecting callers.

The interface answers *what*. The implementation answers *how*. Information hiding draws the line such that the *how* never appears in the *what*.

## Why information hiding matters

### Change locality

Every leaked design decision is a change-amplification site. When the decision changes, every leak must be updated, and missed sites become bugs. Information hiding reduces the change to one site by definition.

This is the load-bearing engineering benefit. Software that can be safely changed is software that survives. Software that can't be safely changed accumulates workarounds + bug-compatibility shims + ultimately gets replaced.

### Cognitive load

A leaked decision must be reasoned about every time a leak-site is read. The reader can't trust that "this is just file I/O" if file format choices are scattered across the codebase — they need to verify that the local copy of the format matches the canonical one.

Hidden information shrinks the surface area a reader must hold in their head. The interface contract is the upper bound on what they need to know.

### Implementation flexibility

A hidden decision can be revised — replaced with a different data structure, a different algorithm, a different error strategy — without touching callers. This is the load-bearing affordance for performance work, security hardening, and bug fixes that would otherwise require a coordinated multi-module change.

### Composability

Modules that hide their decisions compose cleanly. Two such modules can be combined without one's secrets infecting the other's interface. Modules that leak compose with friction — each leak constrains how the module can be used.

## Recognizing information leakage

Per Ousterhout (PoSD ch 5), information leakage is the failure mode. Common shapes:

### Same format in reader + writer

```python
# file_writer.py
def write_user(user):
    fmt = "%s|%s|%d\n"           # ← format choice
    return fmt % (user.name, user.email, user.id)

# file_reader.py — ELSEWHERE
def parse_user(line):
    parts = line.strip().split("|")  # ← same format, leaked
    return User(name=parts[0], email=parts[1], id=int(parts[2]))
```

The pipe-separated format is a design decision (could be JSON, TSV, MessagePack). Encoding it in two places means a format change requires editing both — and missing one creates a parse failure that surfaces at runtime.

**Fix**: a single `UserSerializer` module that hides the format; reader and writer call its methods.

### Algorithm assumptions encoded in callers

```python
# cache_module.py
def lookup(key):    # O(log n) via balanced tree
    return tree.find(key)

# caller.py
for k in keys:
    val = cache.lookup(k)    # caller assumes O(log n); calls it in tight loops
```

The cache's caller has internalized the cost model. Replacing the tree with an LRU eviction cache (O(1) on hit, O(disk) on miss) breaks the caller's implicit performance contract — even though the interface is unchanged.

**Fix**: caller treats cache as opaque; doesn't optimize call patterns around assumed costs. If a particular access pattern matters, expose it explicitly as part of the interface (e.g., `batch_lookup(keys)`).

### Data structure exposure

```python
def get_active_users() -> Dict[int, User]:
    ...
```

Returning a `Dict` exposes the lookup data structure. Callers can index by id, iterate, mutate. The implementation can't switch to a list or set without breaking callers.

**Fix**: return a view type (`Iterable[User]`, `UserCollection`) that exposes only the operations callers should depend on.

### Error condition leakage

```python
try:
    user = repo.find(id)
except sqlalchemy.exc.NoResultFound:    # ← SQL-layer concept leaked to caller
    return None
```

The caller now knows the repo uses SQLAlchemy. Switching to a different ORM, an HTTP backend, or an in-memory store requires updating every catch site.

**Fix**: repo translates its internal error to a domain concept (`UserNotFound` or `None`); callers handle the domain concept.

### Configuration that mirrors implementation toggles

```yaml
# config.yml
cache_use_lru: true
cache_use_lfu: false
cache_use_arc: false
```

The config exposes the implementation's algorithm choices. Adding a new algorithm means new config keys + caller updates everywhere those keys flow.

**Fix**: config exposes the *intent* (`cache_strategy: balanced`); implementation maps strategy to algorithm internally.

## Information hiding vs encapsulation

These terms are often conflated. Disentangling:

- **Encapsulation** is a *mechanism* — language features (`private`, modules, closures) that restrict external access.
- **Information hiding** is a *discipline* — a design choice about what NOT to expose, even when language features would allow it.

Per Martin (Clean Architecture ch 5), OO encapsulation is one of three load-bearing OO properties (along with inheritance and polymorphism). But encapsulation alone doesn't deliver information hiding; it just provides the tool. A class with private fields and 30 public getters has used the encapsulation mechanism but practiced no information hiding — every field is exposed via its getter.

**The discipline test**: would adding a public method to expose internal state make the system more or less changeable? Information hiding chooses *less exposed* as the default.

## Temporal decomposition (the common anti-pattern)

Per Ousterhout (PoSD ch 5), the most common information-hiding failure is *temporal decomposition* — organizing modules by time-order of operations rather than by knowledge.

**Symptom**: modules named `Step1Processor`, `Step2Processor`, etc. Each module handles its time-slice of the work; each needs to know what the predecessor produced and what the successor expects.

**Why it leaks**: every module needs to know the data format flowing between steps. Format changes require coordinated multi-module updates.

**Better decomposition**: organize by *knowledge*. One module owns the data format (storage + serialization). Time-ordered steps consume the format-owner's API; they don't redeclare it.

The principle: modules should be organized around *what they know*, not *when they run*.

## When information hiding has tensions

### Debugging visibility

Hidden information is harder to inspect at runtime. Stack traces that would have shown the leaked detail now show only the interface call. Logs need to expose enough internal state for diagnosis without re-leaking the decision.

**Resolution**: explicit diagnostic surfaces — `Module.debug_state()` or `Module.health_check()` that returns curated internal information. The diagnostic interface is its own contract; it can change without affecting callers (who shouldn't depend on it for non-diagnostic purposes).

### Open-source / library boundaries

Library authors face a tension: hiding too much makes the library hard to extend; hiding too little couples consumers to internals. The resolution is layered visibility — public stable API for normal use, semi-public extension API for advanced use (with explicit "may change" notice), private implementation for internal use.

This isn't a violation of information hiding; it's a recognition that different consumer classes have different stability needs. Each layer hides what *that* class shouldn't depend on.

### Performance debugging

Sometimes a performance problem requires understanding what's inside a module. Information hiding can make this harder. But the alternative — exposing internals for performance debugging — leaks decisions permanently for a one-time investigation.

**Resolution**: expose performance-relevant metrics through a separate observability interface (counters, timing, cache hit rates). The metrics are an explicit contract for performance-relevant behavior; they don't leak data-structure choices.

## Apply when

- **Designing a new module**: ask "what design decisions could change here? What can I hide?" Make the module's interface as narrow as possible relative to what's hidden.
- **Reviewing an existing module**: count the leaked decisions. Each leak is a future change-amplification site.
- **Splitting a class**: per Parnas's criterion, split by *what each piece would hide*, not by *what each piece would do procedurally*.
- **Reviewing API surfaces**: every public method is a permanent commitment to a piece of revealed information. Is each one necessary?

## When NOT to use this principle (or apply with caveat)

**Don't apply when**:

- **Open-source APIs / public contracts** — consumers need stability guarantees that require *more* exposure, not less. Hiding internals is fine; hiding contract surfaces breaks downstream code on every refactor.
- **Cross-team interfaces with mature consumers** — if Team B has already absorbed the exposure cost (built against your current surface, has integration tests), additional hiding creates churn without benefit. The cost is borne; the work is recovering value from it.
- **Performance-critical hot paths where abstraction dominates** — rarely truly applicable; usually a hidden-tradeoff anti-pattern where "performance" excuses skipping decomposition. Profile first.

**Apply with caveat when**:

- **Internal modules with multiple stakeholders** — hide aggressively but document the contract surface clearly. The hiding-vs-exposure decision is per-stakeholder, not per-module.
- **Refactoring from low-hiding legacy** — increase hiding incrementally (one consumer at a time), not in a single big-bang. The risk is breaking downstream code paths you didn't know existed.

**Cross-reference**: `single-responsibility` defines WHAT to hide (the boundary follows the actor / reason-to-change). Information hiding implements SRP at the module surface — it's the mechanism, SRP is the principle. They co-vary: when SRP is violated, hiding becomes harder; when hiding is poor, SRP violations leak across boundaries.

## Substrate applications

### Hook scripts as opaque validators

Substrate hooks expose a tiny interface: stdin JSON → stdout JSON. Internally, they implement varied logic (validation, counter updates, fact-tracking). The substrate's consumers (Claude Code runtime, install.sh) don't know any of this — they just pipe input + read output.

This information hiding is what allows hooks to evolve (add validation rules, change counter shapes, refactor lock logic) without coordinated runtime changes. Each hook's internal evolution is local.

### `_lib/` shared modules

`scripts/agent-team/_lib/lock.js`, `_lib/frontmatter.js`, `_lib/safe-exec.js`, `_lib/atomic-write.js` each hide a substrate concern behind a narrow API:

- `lock.js`: callers get `acquireLock(path)` / `releaseLock(path)`; they don't know about lockfiles, stale-PID detection, or the underlying syscalls
- `frontmatter.js`: callers get `parseFrontmatter(content)`; they don't know about YAML 1.2 inline-comment handling or quote-aware scanning
- `safe-exec.js`: callers get `invokeNodeJson()`; they don't know that the implementation uses `execFileSync` (not `execSync` with shell)
- `atomic-write.js`: callers get atomic write semantics; they don't know about `.tmp.<pid>` rename mechanics

Each helper's implementation has evolved across HT phases without breaking callers — that's the information hiding benefit in practice.

### ADR-0001 substrate fail-open discipline

ADR-0001 codifies the substrate hook discipline as a *behavioral* contract: hooks fail open. Consumers know this. They don't know the implementation strategy (try/catch shape, logger semantics, exit code conventions) — those are hidden behind the behavioral guarantee.

When HT.2.3 migrated `session-end-nudge.js` to use shared `_lib/lock.js` primitives, the behavioral contract was preserved (fail-open held). The internal change was invisible to consumers because the implementation detail was hidden.

### Knowledge base content addressing

The kb-resolver hides KB storage layout behind `cat` / `cat-summary` / `cat-quickref` operations. Consumers identify content by `kb_id` (semantic name); they don't know whether the storage is filesystem, a content-addressed store, a remote API, or some hybrid. The decision can change.

## Tension with extreme transparency

Some engineering cultures advocate maximum transparency — "all internal state should be inspectable, always." This is a reasonable instinct for debugging support and learning. But sustained as a discipline it produces leakage: every inspectable detail becomes something callers eventually depend on (Hyrum's Law: with sufficient users, every observable becomes load-bearing).

The information hiding discipline accepts transparency where it's explicitly an interface (diagnostics, metrics, structured logs) and rejects it where it would be incidental (default-public fields, ad-hoc state dumps in production paths).

The synthesis (per Pragmatic Programmer's emphasis on judgment): expose what callers should depend on; hide what they shouldn't. When in doubt, hide — narrowing is cheap, widening is irreversible.

## History

Authored: kb authoring batch H.9.3 (post-HT.1.12 deferred-author-intent followup). Closes the 2-source `## Related KB docs (planned)` forward-references from `deep-modules.md` + `dependency-rule.md`. Pairs with deep-modules (information hiding is the technique by which deep modules are constructed) and dependency-rule (cross-boundary information hiding enforces the dependency rule's stability axis).

## Phase

Authored: H.9.3 KB authoring batch — sibling format-discipline trajectory under H.9.x. First of 5 unauthored planned KBs (per HT.1.12-followup BACKLOG entry). Foundational pairing: information-hiding × deep-modules is the canonical Parnas + Ousterhout coupling.
