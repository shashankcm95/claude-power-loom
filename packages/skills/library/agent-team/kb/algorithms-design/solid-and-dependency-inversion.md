---
kb_id: algorithms-design/solid-and-dependency-inversion
version: 1
tags:
  - algorithms-design
  - solid
  - design-principle
  - dependency-inversion
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: patterns/solid, patterns/dip, patterns/dipmodular"
  - "Spring Framework 7.0 Release Notes (https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)"
related:
  - algorithms-design/gof-creational-patterns
  - algorithms-design/domain-driven-design
  - algorithms-design/clean-hexagonal-architecture
status: active
---

## Summary

**Concept**: The five SOLID principles (SRP, OCP, LSP, ISP, DIP) taught with explicit before/after violating-vs-fixed pairs, plus Dependency Inversion shown two ways — classic constructor injection and JPMS-modular `ServiceLoader`.
**Key APIs**: extract-presentation-from-data (SRP); implement-an-interface-don't-edit (OCP); preconditions/postconditions/invariants substitutability (LSP); role interfaces (ISP); consumer-owned `CustomerDao` interface + constructor injection / JPMS `uses`/`provides...with` + `ServiceLoader` (DIP).
**Gotcha**: LSP — express capability in the *type system*, not runtime exceptions (the `FixedTermDepositAccount` left outside the withdrawable hierarchy); `dipmodular` has real compile errors and bypasses `ServiceLoader` (treat as illustrative).
**2026-currency**: principles are evergreen; `new Integer(10)` in the SOLID `l` example → `Integer.valueOf`; JPMS / `ServiceLoader` is stable and current; JSpecify supersedes JSR-305.
**Sources**: Baeldung `solid` + `dip` + `dipmodular`.

## Quick Reference

**The five principles**:

| Principle | Rule | How it's taught |
|---|---|---|
| **SRP** (Single Responsibility) | one reason to change | extract presentation from data |
| **OCP** (Open/Closed) | extend by adding, don't edit | implement a new interface impl |
| **LSP** (Liskov Substitution) | subtypes must be substitutable | preconditions can't strengthen; postconditions can't weaken; invariants preserved; no new exceptions |
| **ISP** (Interface Segregation) | no fat interfaces | split into role interfaces |
| **DIP** (Dependency Inversion) | depend on abstractions | constructor-inject the interface |

**LSP's load-bearing lesson**: express capability in the *type system*, not in runtime exceptions. The fix deliberately leaves `FixedTermDepositAccount` outside the withdrawable hierarchy rather than having `withdraw()` throw — a non-withdrawable account simply doesn't have the method.

**DIP two ways**:
- **Classic** — a consumer-owned `CustomerDao` interface with constructor injection. The high-level module owns the abstraction; the low-level impl conforms to it.
- **JPMS-modular** — the same example as five Java modules; `uses` / `provides ... with` + `ServiceLoader.load(X.class).findFirst().get()` inverts the dependency at the module boundary:
```java
// module-info.java
provides com.x.CustomerDao with com.x.impl.MapCustomerDao;  // provider module
uses com.x.CustomerDao;                                      // consumer module
```

**Top gotchas**:
- The SOLID README omits a DIP article even though the `d` package fully demonstrates it.
- `dipmodular` has real compile errors (dangling `MapCustomerDao` import, missing `List`/`ArrayList` imports) and bypasses `ServiceLoader` in `main` — treat it as a declarative JPMS-wiring illustration only.
- `new Integer(10)` (deprecated boxing ctor) appears in the SOLID `l/advanced/Bar` example.

**Current (mid-2026)**: the principles are evergreen. JPMS (`module-info`, `requires`/`exports`/`provides`/`uses`, `ServiceLoader`) is a stable Java 9 feature, fully current. `new Integer(10)` → `Integer.valueOf` / autoboxing. JSpecify 1.0 supersedes JSR-305 for the nullness annotations DIP examples touch.

## Full content

The `patterns/solid`, `patterns/dip`, and `patterns/dipmodular` modules teach SOLID with explicit violating-vs-fixed pairs — the strongest feature of this slice.

### The five principles

SRP is taught by extracting a presentation responsibility out of a data class. OCP is taught by adding a new interface implementation rather than editing existing code. LSP is the most carefully argued: subtypes must be substitutable, which means preconditions can't strengthen, postconditions can't weaken, invariants must hold, and no new checked exceptions may appear. The corpus's LSP "fix" makes the point sharply by leaving a fixed-term deposit account *outside* the withdrawable type hierarchy — capability is expressed in the type system, not via a `withdraw()` that throws at runtime. ISP splits fat interfaces into role interfaces. DIP has consumers depend on abstractions they own, with the concrete implementation injected.

### Dependency Inversion, two ways

The classic DIP form uses a consumer-owned `CustomerDao` interface and constructor injection, so the high-level policy owns the abstraction and the low-level data-access detail conforms. The JPMS-modular form takes the identical example and splits it into five Java modules, using `uses` / `provides ... with` and `ServiceLoader.load(...)` to invert the dependency at the *module* boundary — the consumer module `uses` the abstraction, a provider module `provides ... with` the impl, and `ServiceLoader` resolves it at runtime. This is the same SPI/`ServiceLoader` idiom used for strategic DDD bounded-context wiring (cross-reference the DDD section). Note `dipmodular` does not actually compile as checked in — it is illustrative.

### 2026 currency

- **The principles (and DRY / KISS / YAGNI alongside them) are evergreen** — only framework wiring and library versions around them age. [Spring Framework 7.0 Release Notes](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)
- **JPMS / `ServiceLoader`** (`module-info`, `requires`/`exports`/`provides`/`uses`) is a stable Java 9 feature and fully current — the DIP-via-modules example carries forward unchanged.
- **`new Integer(10)`** in the SOLID `l` example → `Integer.valueOf` / autoboxing (deprecated boxing ctor).
- **JSpecify 1.0 (2024)** supersedes the abandoned JSR-305 `@Nullable` annotations these examples would otherwise reach for; adopted across Spring 7 / Boot 4. [Should you use JSpecify? — jspecify.dev](https://jspecify.dev/docs/whether/)
- DIP in framework form is Spring's DI/IoC; Spring DI realizes the same dependency-inversion principle these modules teach by hand.
