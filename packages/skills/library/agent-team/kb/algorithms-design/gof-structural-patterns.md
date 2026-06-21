---
kb_id: algorithms-design/gof-structural-patterns
version: 1
tags:
  - algorithms-design
  - design-patterns
  - gof
  - structural
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: patterns/design-patterns-structural"
  - "Java Language Changes — Oracle (https://docs.oracle.com/en/java/javase/17/language/java-language-changes.html)"
related:
  - algorithms-design/gof-creational-patterns
  - algorithms-design/gof-behavioral-patterns
status: active
---

## Summary

**Concept**: The GoF structural patterns — Facade, Adapter, Bridge, Composite, Decorator, Proxy — the patterns that compose objects into larger structures via wrapping and indirection.
**Key APIs**: `CarEngineFacade` (hides subsystem ordering); object-adapter via composition (MPH→KMPH); Bridge `Shape` × `Color`; Composite `Department` tree with recursive forEach; stackable `TreeDecorator` + `super.decorate()`; virtual/lazy-init `ExpensiveObjectProxy`.
**Gotcha**: `ExpensiveObjectProxy.object` is `private static` so the lazy real object leaks across all proxy instances; Composite `printDepartmentName` only side-effects to stdout (can't fold to a value).
**2026-currency**: pattern concepts are evergreen; the structural proxy test depends on **Log4j 1.x** (EOL 2015, CVE-2022-23307 / CVE-2019-17571) — migrate to reload4j / Log4j2 / SLF4J+Logback.
**Sources**: Baeldung `design-patterns-structural`.

## Quick Reference

The four "wrapping / indirection" patterns (Proxy / Decorator / Adapter / Bridge) plus Facade and Composite:

| Pattern | Intent | Example |
|---|---|---|
| **Facade** | hide subsystem call ordering behind a simple API | `CarEngineFacade` |
| **Adapter** | make an incompatible interface usable | object-adapter via composition, MPH→KMPH |
| **Bridge** | let abstraction and implementation vary independently | `Shape` × `Color` |
| **Composite** | treat leaf and composite uniformly | `Department` tree, recursive forEach |
| **Decorator** | add behavior by stacking wrappers | `TreeDecorator` + `super.decorate()` |
| **Proxy** | stand in for / control access to an object | virtual/lazy-init `ExpensiveObjectProxy` |

**Decorator** stacks: each `TreeDecorator` wraps a component and calls `super.decorate()` to chain, so behaviors compose at runtime without subclass explosion.

**Adapter** here is the *object* adapter (composition — the adapter holds the adaptee), not the class (inheritance) adapter.

**Bridge** separates an abstraction hierarchy (`Shape`) from an implementor hierarchy (`Color`) so the two can grow independently — the cross product is composed, not subclassed.

**Top gotchas**:
- `ExpensiveObjectProxy.object` is `private static`, so the lazily-created real object **leaks across all proxy instances** (a hidden-static-mutable-state bug — the proxy isn't per-instance lazy as intended).
- Composite `printDepartmentName` only side-effects to stdout — it can't fold the tree to a value, limiting the example.

**Current (mid-2026)**: the structural pattern concepts are conceptually durable and evergreen. The only staleness is the **Log4j 1.x** dependency in the proxy test (see security note below).

## Full content

The `patterns/design-patterns-structural` module covers all six GoF structural patterns. The base notes a "Proxy/Decorator/Adapter/Bridge" umbrella that ties the four wrapping/indirection patterns together — they all interpose an object between a client and a target, differing in *why*.

### Facade and Adapter

The Facade (`CarEngineFacade`) hides the ordering of subsystem calls behind one method, so clients don't sequence the subsystem themselves. The Adapter is the object-adapter form (composition): an MPH-reading component is adapted to a KMPH-expecting interface by a wrapper that converts on the fly.

### Bridge and Composite

The Bridge splits an abstraction (`Shape`) from an implementor (`Color`) so each hierarchy varies independently — adding a shape or a color does not multiply subclasses. The Composite models a `Department` tree where leaf and composite are treated uniformly via a recursive `forEach`; the example only prints (a fold-to-value version would be more useful).

### Decorator and Proxy

The Decorator stacks `TreeDecorator` wrappers, each delegating up via `super.decorate()`, so behaviors compose at runtime. The Proxy is a virtual/lazy-init proxy (`ExpensiveObjectProxy`) that defers creating the expensive real object until first use — but a bug makes the backing field `private static`, so the "lazy" object is shared across every proxy instance.

### 2026 currency

- **Security: Log4j 1.x in the proxy test.** The proxy test depends on **Log4j 1.x** (EOL 2015, a security liability). Affected by **CVE-2022-23307** (Chainsaw deserialization → RCE, CVSS 8.8 HIGH, CWE-502) and **CVE-2019-17571** (`SocketServer` deserializes untrusted log events → RCE, HIGH). Remediate by dropping in **`ch.qos.reload4j:reload4j` ≥ 1.2.18.3** (binary-compatible, all known Log4j 1.x CVEs fixed) or migrating to Log4j 2.x / SLF4J + Logback. [NVD — CVE-2022-23307](https://nvd.nist.gov/vuln/detail/CVE-2022-23307) · [reload4j.qos.ch](https://reload4j.qos.ch/index.html)
- The structural pattern concepts (Facade / Adapter / Bridge / Composite / Decorator / Proxy) are evergreen — only the logging dependency in the example is stale. [Java Language Changes — Oracle](https://docs.oracle.com/en/java/javase/17/language/java-language-changes.html)
- Note: reflection-heavy proxy/indirection patterns need GraalVM reflection hints to be AOT/native-image friendly under Spring Boot 3+ — relevant if these patterns are deployed in a native binary.
