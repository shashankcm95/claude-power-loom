---
kb_id: algorithms-design/rule-engines-and-state-machines
version: 1
tags:
  - algorithms-design
  - rule-engines
  - state-machines
  - drools
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: drools, rule-engines, rule-engines/jess, algorithms-miscellaneous-1, algorithms-miscellaneous-3"
  - "Apache KIE (Incubating) 10.1.0 announcement (https://www.mail-archive.com/general@incubator.apache.org/msg84955.html)"
related:
  - algorithms-design/heuristic-metaheuristic-optimization
  - algorithms-design/gof-behavioral-patterns
status: active
---

## Summary

**Concept**: Finite state machines (immutable functional + enum-based) and business-rules/inference engines — Drools (KIE bootstrap, `.drl` rules, MVEL, decision tables, backward chaining), Jess (Rete forward chaining, CLIPS, JSR-94), and the broader rule-engine landscape (Easy Rules, RuleBook, OpenL Tablets).
**Key APIs**: immutable FSM `switchState` returns a new machine; enum FSM per-constant `nextState()`; Drools `KieServices`→`KieFileSystem`→`KieBuilder.buildAll()`→`KieContainer`→`KieSession`, then `insert`/`setGlobal`/`fireAllRules`; backward chaining via recursive `query`.
**Gotcha**: Jess is commercial/abandoned (~2013, not in Maven Central); JSR-94 (`javax.rules`) is a dormant 2004 standard — both dead-ends.
**2026-currency**: Drools 7.x → Drools 8 (Rule Units, executable model) → **Apache KIE (Incubating) 10.x**; decision tables now require `.drl.xls`/`.drl.xlsx`/`.drl.csv`.
**Sources**: Baeldung `drools` + `rule-engines` + FSM modules.

## Quick Reference

**Finite state machines** (two idiomatic, switch-free designs):
- **Immutable functional FSM** — `switchState` returns `new RtFiniteStateMachine(...)` rather than mutating (`automata/RtFiniteStateMachine.java:22-24`). State is a value; transitions produce a new machine.
- **Enum FSM** — each enum constant supplies an abstract `nextState()` body, so there is no central `switch` (`enumstatemachine/LeaveRequestState.java`). The compiler enforces a body per state.

**Drools (business rules engine)**:
```java
// Bootstrap (DroolsBeanFactory.java)
KieServices ks = KieServices.Factory.get();
KieFileSystem kfs = ks.newKieFileSystem();          // load .drl resources
KieBuilder kb = ks.newKieBuilder(kfs); kb.buildAll();
KieContainer kc = ks.newKieContainer(...);
KieSession session = kc.newKieSession();
session.insert(fact); session.setGlobal("name", obj); session.fireAllRules();
```
- `.drl` rules use `when ... then ... end` with the MVEL dialect; `global` exposes external objects.
- **Decision tables** via Apache POI (Excel).
- **Backward chaining** via a recursive `query belongsTo(x, y)` (`BackwardChaining.drl`).

**Jess (Rete forward-chaining)**: CLIPS `.clp` rule files; the JSR-94 `javax.rules` vendor-neutral API. Commented out of the Baeldung reactor (`gov.sandia:jess` / `jsr94:jsr94` are not in Maven Central).

**Landscape survey**: Easy Rules, RuleBook, OpenL Tablets, Drools — the broader options beyond Drools/Jess.

**Top gotchas**:
- **Jess** is commercial/abandoned (~2013, not in Maven Central) — a dead-end.
- **JSR-94 (`javax.rules`)** is a dormant 2004-era standard — a dead-end.
- The `rule-engines/jess` module does not compile/build as checked in (it is illustrative only).

**Current (mid-2026)**: Drools moved 7.x → **Drools 8** (Rule Units; executable model replacing MVEL interpretation; KIE Server / Business Central / OSGi retired; Security Manager removed; JDK 11 minimum), then was donated to the ASF as **Apache KIE (Incubating)** with a bump to **10.x**. Decision tables now require `.drl.xls` / `.drl.xlsx` / `.drl.csv` extensions.

## Full content

This section pairs two unrelated-but-adjacent topics the corpus groups together: state machines (a control-flow idiom) and rule/inference engines (declarative decisioning).

### State machines

Two designs avoid the classic central `switch`. The immutable functional FSM treats state as a value: `switchState` returns a brand-new machine instance, so the FSM composes safely and is side-effect-free. The enum FSM puts an abstract `nextState()` method on the enum type and overrides it per constant, so the compiler guarantees every state defines its transition — a clean Replace-Conditional-with-Polymorphism (cross-reference the behavioral patterns' "replace if/switch chains" catalogue).

### Drools

Drools is bootstrapped through the KIE API: `KieServices` → `KieFileSystem` (load `.drl` resources) → `KieBuilder.buildAll()` → `KieContainer` → `KieSession`, then `insert(fact)` + `setGlobal(...)` + `fireAllRules()`. Rules are `when ... then ... end` blocks in the MVEL dialect; `global` injects external objects; Excel decision tables are parsed via Apache POI; and backward chaining is demonstrated with a recursive `query belongsTo(x, y)`.

### Jess and the rule-engine landscape

Jess implements Rete forward chaining with CLIPS `.clp` files and the vendor-neutral JSR-94 `javax.rules` API — but it is commented out of the reactor because `gov.sandia:jess` and `jsr94:jsr94` are not in Maven Central, and the module does not build. The broader survey names Easy Rules, RuleBook, and OpenL Tablets alongside Drools; in this snapshot only the survey article and the Drools/Jess code are concrete (the other submodule READMEs are empty).

### 2026 currency

- **Drools 7.x → Drools 8 → Apache KIE (Incubating).** Drools moved to the 8-series (Rule Units; an executable model replacing MVEL interpretation; KIE Server / Business Central / OSGi retired; Security Manager removed; JDK 11 minimum) and was then donated to the Apache Software Foundation as **Apache KIE (Incubating)**, bumped to **10.x** (10.1.0 announced 2025-07-10; 10.2.0 latest on GitHub). MVEL syntax is still allowed but interpretation is deprecated; decision tables now require `.drl.xls` / `.drl.xlsx` / `.drl.csv` extensions. [Apache KIE (Incubating) 10.1.0 announcement](https://www.mail-archive.com/general@incubator.apache.org/msg84955.html) · [apache/incubator-kie-drools releases](https://github.com/apache/incubator-kie-drools/releases) · [Drools Release Notes](https://docs.drools.org/latest/drools-docs/drools/release-notes/index.html)
- **Apache POI 3.13 → 5.5.1** (2025-11-30) for the decision-table parsing. [Apache POI download / release notes](https://poi.apache.org/download.html)
- **Jess and JSR-94 (`javax.rules`) remain dead-ends** — Jess is commercial/abandoned (~2013, not in Maven Central) and JSR-94 is a dormant 2004 standard. Do not seed new work on either.
- The two FSM idioms (immutable + enum) are pure-JDK and evergreen; sealed types + pattern-matching `switch` (Java 21) can modernize the enum FSM but are not required.
