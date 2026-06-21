---
kb_id: build-devops/compile-time-codegen
version: 1
tags:
  - build-devops
  - codegen
  - annotation-processing
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: code-generation, gradle-6, performance-tests (MapStruct), maven-modules (jaxws)"
  - "Java Code Geeks — Static Analysis & Code Generation for Java (https://www.javacodegeeks.com/2025/10/static-analysis-code-generation-for-java-preventing-bugs-before-they-happen.html)"
related:
  - build-devops/maven-build
  - build-devops/static-analysis-gates
status: active
---

## Summary

**Concept**: compile-time code generation via annotation processors — generate boilerplate (value classes, factories, service descriptors, mappers, SOAP stubs) at build time so it never lives in source, with the JDK `ServiceLoader`/SPI as the decoupling backbone.
**Key APIs**: AutoValue (`@AutoValue` → `AutoValue_<Name>`, `@AutoValue.Builder`), AutoFactory (`@AutoFactory`, `@Provided` DI args + runtime args), AutoService (`@AutoService` → `META-INF/services`), `ServiceLoader.load(Iface.class)`, MapStruct `@Mapper`, `jaxws-maven-plugin wsimport`.
**Gotcha**: generated-code modules won't compile from a clean checkout until annotation processing runs (IDEs need it enabled, or `AutoValue_*` symbols appear unresolved) — the build-time-invisibility trap.
**2026-currency**: JAX-WS `wsimport` removed from the JDK since Java 11 → standalone Jakarta XML Web Services; MapStruct (zero-reflection, fastest mapper) and AutoValue/AutoService still current.
**Sources**: Baeldung `code-generation`/`gradle-6`/MapStruct/`jaxws`; Java Code Geeks codegen survey.

## Quick Reference

**Google Auto\* family**:

- **AutoValue**: `@AutoValue` on an abstract class; refer to the generated `AutoValue_<Name>`. Builder variant: `@AutoValue.Builder` abstract inner + `AutoValue_<Name>.Builder`. Defensive copy: override `build()` to wrap a collection field in `Collections.unmodifiableList(new ArrayList<>(...))` before `autoBuild()`. `auto-value` is `provided`; `auto-service` is `optional` (processors are off the runtime classpath).
- **AutoFactory**: `@AutoFactory(extending=AbstractFactory.class)`, `@Provided @Named("Sony") Camera` (DI-injected) + runtime args; needs a no-arg ctor when used as an AutoFactory base. Mixes JSR-330 `@Inject`/`@Named`/`Provider`; Guice glue.
- **AutoService**: `@AutoService(Iface.class)` on each impl generates `META-INF/services` for the JDK `ServiceLoader` → zero hand-written service descriptor.

**ServiceLoader / SPI decoupling**: interface in one module, `@AutoService`-annotated impl in another; consume via `ServiceLoader.load(TranslationService.class)`. The Gradle 6 fibonacci-SPI module shows the same pattern: `compileOnly("...auto-service-annotations")` + `annotationProcessor("...auto-service")` + `@AutoService(Iface.class)`.

**Other generators**:
- **MapStruct** `@Mapper` — compile-time, processor-driven, zero-reflection (the fastest mapper in the `performance-tests` shootout).
- **WSDL/SOAP stubs** — `jaxws-maven-plugin` `wsimport` generates port/types into `target/generated-sources` (not checked in).

**Top gotcha**: generated-code modules won't compile from a clean checkout until annotation processing / `wsimport` runs — IDEs need annotation processing enabled, or `AutoValue_*` / generated symbols appear unresolved. This "won't-compile-without-codegen" trap is shared with any library whose value lives in a processor.

**Current (mid-2026)**: AutoValue/AutoService/SPI and MapStruct are current. JAX-WS `wsimport` is gone from the JDK → use standalone Jakarta XML Web Services artifacts.

## Full content

This cluster is about generating boilerplate at compile time so it never appears in source. The mechanism is the annotation processor (the same javac extension point the Checker Framework uses for type checking), and the architectural backbone is the JDK `ServiceLoader`/SPI for decoupling interface from implementation.

### Google Auto\* and ServiceLoader/SPI

AutoValue generates immutable value classes (`equals`/`hashCode`/`toString`, optional builder, defensive-copy pattern for collection fields). AutoFactory generates factories that mix DI-`@Provided` constructor args with per-call runtime args. AutoService generates the `META-INF/services` descriptor the JDK `ServiceLoader` reads — so an interface in one module and `@AutoService`-annotated impls in another decouple cleanly with no hand-written descriptor. The processor artifacts are kept off the runtime classpath (`provided`/`optional`).

### Mappers and SOAP stubs

MapStruct is the fastest mapper precisely because it is processor-driven and reflection-free — code is generated at compile time. The corpus also generates SOAP stubs at build time via `jaxws-maven-plugin wsimport` into `target/generated-sources` (not checked in) — but this JAX-WS path is the most stale part of the cluster.

### The build-time-invisibility trap

The shared gotcha across every generator: a clean checkout won't compile until annotation processing runs. IDEs must have annotation processing enabled, or the generated symbols (`AutoValue_*`, generated mapper impls, `wsimport` types) appear unresolved. This is the same trap shared with the broader library cluster: code that won't compile without codegen.

### 2026 currency

- **JAX-WS removed from the JDK** (gone since Java 11; `wsimport`, `javax.xml.ws`) → standalone Jakarta XML Web Services artifacts; the corpus's `jaxws` and `maven-archetype` modules are wholesale stale. [Java Code Geeks — Static Analysis & Code Generation for Java](https://www.javacodegeeks.com/2025/10/static-analysis-code-generation-for-java-preventing-bugs-before-they-happen.html)
- **`javax.inject` → `jakarta.inject`** in the AutoFactory JSR-330 glue under Jakarta EE 9+ / Spring 6 / Boot 3 — but note `javax.xml.XMLConstants` (a JDK class in the `java.xml` module) is NOT a Jakarta-migrated API; do not mis-flag it. [Java Code Geeks — Static Analysis & Code Generation for Java](https://www.javacodegeeks.com/2025/10/static-analysis-code-generation-for-java-preventing-bugs-before-they-happen.html)
- **Carries forward unchanged**: AutoValue/AutoService/SPI and MapStruct are current at the concept level — codegen via annotation processors remains the canonical way to eliminate boilerplate before runtime. [Java Code Geeks — Static Analysis & Code Generation for Java](https://www.javacodegeeks.com/2025/10/static-analysis-code-generation-for-java-preventing-bugs-before-they-happen.html)
