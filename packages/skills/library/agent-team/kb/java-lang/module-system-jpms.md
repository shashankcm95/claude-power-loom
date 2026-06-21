---
kb_id: java-lang/module-system-jpms
version: 1
tags:
  - java-lang
  - jpms
  - modules
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-jpms"
  - "Baeldung tutorials (eugenp/tutorials) module: pre-jpms"
  - "Happycoders: Java 25 features (JEP 511 module import declarations): https://www.happycoders.eu/java/java-25-features/"
related:
  - java-lang/reflection-and-proxies
  - java-lang/exceptions-and-linkage-errors
  - java-lang/language-evolution-8-to-25
status: active
---

## Summary

**Concept**: The Java Platform Module System (Project Jigsaw, Java 9) — `module-info.java` directives, decoupling via factory vs `ServiceLoader`, named/unnamed modules, and pre-JPMS migration breakage.
**Key APIs**: `exports`/`requires`/`requires transitive`/`provides ... with`/`uses`, `ServiceLoader.load(...)`, `java.lang.Module`/`ModuleDescriptor`/`ModuleLayer`, `addReads`/`addExports`/`addOpens`.
**Gotcha**: a classpath (non-module) class lives in the **unnamed** module (`null` name, `isNamed() == false`). Factory-based decoupling still couples the consumer to the service module; `ServiceLoader`-based decoupling removes the compile-time dependency on the provider.
**2026-currency**: strong encapsulation hardened in JDK 17 (`--illegal-access` removed). JDK 25 adds `import module M;` (JEP 511); the `javax.* → jakarta.*` migration deadline is fully past.
**Sources**: `core-java-jpms`, `pre-jpms`.

## Quick Reference

**`module-info.java` directives**:
- `exports <pkg>` — make a package's public API visible
- `requires <module>` — depend on a module
- `requires transitive <module>` — re-export a dependency's API to your consumers
- `provides <Interface> with <Impl>` + `uses <Interface>` — the `ServiceLoader` wiring

**Decoupling strategies** (weak → strong):
1. **factory-based** — export only an `external` package with an interface + static factory, hide `internal` impls. Consumer is still coupled to the service module.
2. **`ServiceLoader`-based** (stronger) — the service module exports only the interface; a separate provider module `provides ... with`; the consumer `uses` + `ServiceLoader.load(...)` with **no compile-time dependency** on the provider.

**Reflective module API**: `java.lang.Module` / `ModuleDescriptor` / `ModuleLayer`. A classpath class is in the **unnamed** module (`null` name, `isNamed() == false`); dynamic `addReads`/`addExports`/`addOpens`/`addUses`.

**Maven**: one Maven module == one Java module.

**Pre-JPMS migration breakage** (removed/internal → replacement):
- `com.sun.crypto.provider.SunJCE` → standard `Cipher`
- `sun.reflect.Reflection.getCallerClass` → `StackWalker`
- `javax.xml.bind.*` (JAXB, removed JDK 11) → `jakarta.xml.bind`
- `sun.misc.BASE64Encoder` → `java.util.Base64`
- JAX-WS `javax.xml.ws` removed JDK 11

**Custom runtime images**: `jlink`; multi-release JARs (`src/main/java8` vs `java9`, `Multi-Release: true`).

**Top gotchas**:
- A classpath class is unnamed (`null` name) — easy to assume otherwise.
- Factory decoupling does not remove the provider compile-time dependency; `ServiceLoader` does.
- Deep reflection across modules needs `opens`/`--add-opens` (else `InaccessibleObjectException`).

**Current (mid-2026)**: JDK 17 removed `--illegal-access` (strong encapsulation enforced); JDK 25 adds `import module M;` (JEP 511). The Jakarta renames are fully past — Spring Boot 3 dropped `javax.*`.

## Full content

JPMS (Project Jigsaw, Java 9) introduced a `module-info.java` descriptor that makes a JAR's dependencies and exposed API explicit and enforced. Its directives are `exports <pkg>` (publish a package's public types), `requires <module>` (declare a dependency), `requires transitive <module>` (re-export a dependency's API so consumers of *this* module also see it), and the service pair `provides <Interface> with <Impl>` / `uses <Interface>` that wires `ServiceLoader`.

The module system enables two **decoupling strategies** of increasing strength. The *factory-based* approach exports only an `external` package containing an interface plus a static factory, hiding the `internal` implementations — but the consumer still has a compile-time dependency on the service module. The stronger *`ServiceLoader`-based* approach has the service module export only the interface, a separate provider module declare `provides ... with`, and the consumer `uses` the interface and calls `ServiceLoader.load(...)` — so the consumer has **no compile-time dependency on the provider at all**, and providers can be swapped at deployment.

Modules are also reflectable: `java.lang.Module`, `ModuleDescriptor`, and `ModuleLayer` expose the runtime module graph, and dynamic methods (`addReads`/`addExports`/`addOpens`/`addUses`) adjust it. A crucial distinction is the **unnamed module** — any class loaded from the classpath rather than the module path belongs to it, has a `null` name, and reports `isNamed() == false`. In Maven, the convention is one Maven module per Java module.

The base captures a **pre-JPMS migration breakage** sampler that is still the canonical "what broke" list: the internal `com.sun.crypto.provider.SunJCE` (use the standard `Cipher`), the removed `sun.reflect.Reflection.getCallerClass` (use `StackWalker`), JAXB `javax.xml.bind.*` (removed JDK 11, now `jakarta.xml.bind`), `sun.misc.BASE64Encoder` (now `java.util.Base64`), and JAX-WS `javax.xml.ws` (removed JDK 11). Custom runtime images are built with `jlink`, and multi-release JARs (`src/main/java8` vs `java9`, `Multi-Release: true` in the manifest) let one JAR ship version-specific class implementations. Deep reflection across module boundaries requires `opens`/`--add-opens`, tying this lane to `java-lang/reflection-and-proxies` and the `InaccessibleObjectException` in `java-lang/exceptions-and-linkage-errors`.

### 2026 currency

**Strong encapsulation hardened — JDK 17.** The `--illegal-access` escape hatch (which in Java 9-16 let classpath code reflect into JDK internals with a warning) was **removed in JDK 17** ([Java version history](https://en.wikipedia.org/wiki/Java_version_history)). Deep reflection into a module that does not `opens` the package now fails with `InaccessibleObjectException` unless an explicit `--add-opens` is supplied — the base's "since Java 9" is now fully enforced.

**`javax.* → jakarta.*` — deadline fully past.** `javax.xml.bind` → `jakarta.xml.bind`, `javax.persistence.*` → `jakarta.persistence.*` (3.x; 3.2 in Jakarta EE 11), `javax.annotation.Generated`, `javax.mail`; **Spring Boot 3 dropped `javax.*` entirely**. The base's "NOT a Jakarta casualty" list remains correct: `javax.annotation.processing` (JSR-269), `javax.naming`/`javax.sql` (JNDI/JDBC stay in the JDK), and `javax.annotation.Nonnull` (JSR-305, a separate dead JSR).

**Module import declarations — final JDK 25 ([JEP 511](https://www.happycoders.eu/java/java-25-features/)).** `import module M;` imports every package a module exports in one statement — a new JPMS-adjacent convenience. The module model itself (directives, `ServiceLoader`, named/unnamed) is otherwise unchanged.
