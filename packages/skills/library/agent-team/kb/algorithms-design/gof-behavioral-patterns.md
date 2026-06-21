---
kb_id: algorithms-design/gof-behavioral-patterns
version: 1
tags:
  - algorithms-design
  - design-patterns
  - gof
  - behavioral
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: patterns/design-patterns-behavioral, patterns/design-patterns-behavioral-2, patterns/design-patterns-functional, patterns/design-patterns-behavioral (nulls)"
  - "JEP 441: Pattern Matching for switch (https://openjdk.org/jeps/441)"
related:
  - algorithms-design/gof-creational-patterns
  - algorithms-design/gof-structural-patterns
  - algorithms-design/rule-engines-and-state-machines
status: active
---

## Summary

**Concept**: The GoF behavioral patterns (Observer, Visitor, Interpreter, State, Template Method, Chain of Responsibility, Command, Mediator, Memento, Null Object) plus double dispatch, the avoid-null catalogue, replace-if/switch idioms, and functional Currying.
**Key APIs**: Observer 3 ways (custom push / deprecated `Observable` / JavaBeans `PropertyChangeSupport`); Visitor double dispatch `accept`→`visit`; functional `@FunctionalInterface` Command; curried `Function` chains; `Optional`/`Objects.requireNonNull` null-avoidance.
**Gotcha**: `Observable`/`Observer` only fire after `setChanged()`; `PCLNewsAgency.setNews` fires the change *before* assigning the field; `assert` for validation is disabled by default (`-ea` required).
**2026-currency**: `java.util.Observable`/`Observer` deprecated since Java 9 (→ `PropertyChangeListener` / `Flow` / Reactor); sealed types + pattern-matching `switch` (Java 21) modernize Visitor & State.
**Sources**: Baeldung `design-patterns-behavioral` (+ `-2`, functional, nulls).

## Quick Reference

**The behavioral catalogue**:

| Pattern | Mechanism | Example |
|---|---|---|
| **Observer** | 3 ways: custom push, deprecated `java.util.Observable`/`Observer`, JavaBeans `PropertyChangeSupport` | news agency |
| **Visitor** | double dispatch `accept(v){ v.visit(this); }` + overloaded `visit(...)` | |
| **Interpreter** | tiny grammar | SQL-like `Select`/`From`/`Where` |
| **State** | object swaps state objects | `Package` swaps `PackageState` |
| **Template Method** | `final` skeleton + abstract steps | |
| **Chain of Responsibility** | handle-or-delegate via `nextProcessor` | |
| **Command** | functional `@FunctionalInterface` + invoker/receiver | |
| **Mediator** | colleagues coordinate through a mediator | |
| **Memento** | originator / memento / caretaker undo | single-level here |
| **Null Object** | no-op implementation | `NullRouter` |

**Double dispatch** (also used in DDD): pick behavior on the runtime types of *two* objects, since Java natively single-dispatches on the receiver.

**Avoid-null catalogue**: `Optional`, `Objects.requireNonNull`, hand-written `Preconditions`, Lombok `@NonNull`, FindBugs/SpotBugs annotations, Javadoc contracts, `assert` (disabled by default!), Commons `StringUtils.isNotEmpty/isNotBlank`, empty-collection returns, primitives-over-wrappers.

**Replace if/switch chains**: enum-with-abstract-method, factory + `Map` lookup, Command, or a rule engine (cross-reference `algorithms-design/rule-engines-and-state-machines`).

**Currying (functional pattern)**: a multi-arg function becomes a chain of single-arg `Function`s — `salutation -> body -> new Letter(...)`, up to a 6-deep curry, culminating in a type-safe staged builder via single-method interfaces.

**Top gotchas**:
- `Observable`/`Observer` only fire after `setChanged()`; `PCLNewsAgency.setNews` fires the change *before* assigning the field (a subtle ordering bug).
- Command-as-`@FunctionalInterface` loses the named receiver/undo unless you keep concrete classes.
- `assert` for argument validation is disabled by default — needs `-ea`.
- Memento here is single-level undo (one field, not a `Deque`).

**Current (mid-2026)**: `java.util.Observable`/`Observer` are deprecated (since Java 9) — use `PropertyChangeListener`, `java.util.concurrent.Flow`, or a reactive library. Sealed classes (Java 17) + pattern-matching `switch` + record patterns (Java 21) modernize Visitor and State, replacing `accept`/`visit` boilerplate with compiler-checked exhaustive switches.

## Full content

The behavioral patterns live in `patterns/design-patterns-behavioral` (+ `-2` for Memento), with the functional Currying example in `patterns/design-patterns-functional` and the avoid-null catalogue alongside the behavioral nulls package.

### Core behavioral patterns

Observer is shown three ways — a custom push observer, the deprecated `java.util.Observable`/`Observer` (which fires only after `setChanged()`), and the JavaBeans `PropertyChangeSupport`/`PropertyChangeListener` route. Visitor uses double dispatch: a node's `accept(visitor)` calls `visitor.visit(this)`, and overloaded `visit(...)` methods select behavior on the node's runtime type. Interpreter implements a tiny SQL-like grammar (`Select`/`From`/`Where`). State swaps `PackageState` objects on a `Package`. Template Method exposes a `final` skeleton with abstract steps. Chain of Responsibility threads a `nextProcessor`. Command uses a `@FunctionalInterface` with an invoker and receiver. Mediator centralizes colleague coordination. Memento implements originator/memento/caretaker undo (single-level here). Null Object provides a no-op `NullRouter`.

### Double dispatch, avoid-null, and replace-conditional

Double dispatch (shared with DDD) selects behavior on two runtime types — Java only single-dispatches, so the `accept`/`visit` indirection is the workaround. The avoid-null catalogue surveys ten techniques (from `Optional` and `Objects.requireNonNull` to empty-collection returns and primitives-over-wrappers), flagging that `assert` is disabled by default. The "replace if/switch chains" set offers enum-with-abstract-method, factory + Map lookup, Command, and rule engines as polymorphic alternatives to long conditionals.

### Functional Currying

The functional module shows Currying as a progression: a `BiFunction` becomes a 2-arg curry, then a 6-deep `Function<...>` chain, then a type-safe staged builder where single-method interfaces enforce argument order at compile time (`currying/Letter.java`).

### 2026 currency

- **`java.util.Observable`/`Observer` deprecated since Java 9** — remain deprecated-not-removed. Use `PropertyChangeListener`, `java.util.concurrent.Flow`, or Project Reactor instead.
- **Sealed classes (Java 17, JEP 409) + Pattern Matching for `switch` (Java 21, JEP 441) + Record Patterns (Java 21, JEP 440)** modernize the **Visitor** and **State** patterns: a sealed hierarchy plus an exhaustive `switch` with record deconstruction replaces the double-dispatch `accept`/`visit` boilerplate, with compiler-checked exhaustiveness. [JEP 409: Sealed Classes](https://openjdk.org/jeps/409) · [JEP 441 promoted to Completed for JDK 21 (InfoQ)](https://www.infoq.com/news/2023/07/tranforming-java-pattern) · [JEP 440: Record Patterns](https://openjdk.org/jeps/440)
- **JSpecify 1.0 (2024)** is the concrete answer to the avoid-null catalogue's `@Nullable` flag — the cross-vendor nullness standard superseding the abandoned JSR-305, adopted across Spring 7 / Boot 4. [Should you use JSpecify? — jspecify.dev](https://jspecify.dev/docs/whether/)
- The behavioral pattern concepts are evergreen; only the Observer base class and the null-annotation tooling moved.
