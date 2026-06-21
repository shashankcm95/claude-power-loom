---
kb_id: testing/architecture-coverage-quality
version: 1
tags:
  - testing
  - coverage
  - code-quality
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: libraries-testing (archunit), testing-libraries (mutation/checkstyle), testing-libraries-2 (jacocoexclusions/sonarqubeandjacoco)"
  - "PIT Gradle plugin — plugins.gradle.org (https://plugins.gradle.org/plugin/info.solidsoft.pitest)"
  - "ArchUnit 1.4.2 release news — archunit.org (https://www.archunit.org/news/release/2026/04/18/release-v1.4.2.html)"
related:
  - testing/junit5-jupiter
  - testing/load-performance-testing
status: active
---

## Summary

**Concept**: Test-adjacent quality gates — **ArchUnit** enforces architecture rules as unit tests, **JaCoCo** measures line/branch coverage, **PITest** measures mutation-kill strength, **CheckStyle**/**SpotBugs** do static analysis. They verify properties of the codebase, not individual behaviors.
**Key APIs**: ArchUnit `ClassFileImporter().importPackages(...)` + `ArchRuleDefinition.classes()/noClasses()` + `Architectures.layeredArchitecture()`; JaCoCo `jacoco-maven-plugin` (`prepare-agent` + `report`), `<excludes>` globs or a custom `@Generated` annotation; PITest mutation testing; CheckStyle `maven-checkstyle-plugin`.
**Gotcha**: JaCoCo `@Generated` exclusion requires retention `RUNTIME` *or* `CLASS` and a simple name that *contains* `Generated` (matched by substring, e.g. `MyGenerated` works); glob `<excludes>` operate on *compiled class* paths, not source.
**2026-currency**: ArchUnit 1.x stable (`layeredArchitecture()` no-arg deprecation resolved → `.consideringAllDependencies()`); PIT actively maintained (Gradle plugin 1.19.0); FindBugs (dead 2015) → SpotBugs.
**Sources**: Baeldung `libraries-testing`/`testing-libraries`(-2); PIT + ArchUnit releases.

## Quick Reference

**ArchUnit** (architecture rules as tests, JUnit 5):
```java
JavaClasses classes = new ClassFileImporter().importPackages("com.baeldung");
layeredArchitecture()
    .layer("Controller").definedBy("..controller..")
    .layer("Service").definedBy("..service..")
    .whereLayer("Controller").mayOnlyBeAccessedByLayers(...)
    .check(classes);
```
`ArchRuleDefinition.classes()/noClasses()` for fine-grained dependency/naming rules; `Architectures.layeredArchitecture()` for layer constraints.

**JaCoCo** (`jacoco-maven-plugin`): bind `prepare-agent` (instruments) + `report` goals. **Exclusions**:
- Glob `<excludes>` on *compiled class* paths (e.g. `**/dto/**`).
- A custom `@Generated` annotation — retention `RUNTIME` *or* `CLASS`, simple name *containing* `Generated`; JaCoCo 0.8.2+ auto-excludes annotated elements.
SonarQube consumes the JaCoCo agent output.

**PITest** (mutation testing): seeds code mutations and measures how many your tests kill — a stronger signal than line coverage. **CheckStyle** (`maven-checkstyle-plugin`, e.g. `AvoidStarImport`); **FindBugs** → **SpotBugs** static analysis.

**Top gotchas**:
- JaCoCo `@Generated` exclusion needs retention `RUNTIME` or `CLASS` AND a simple name that *contains* `Generated` — an annotation whose name lacks the `Generated` substring is ignored.
- Glob excludes match compiled class paths, not source files.
- Much of the corpus's PITest/JaCoCo/CheckStyle wiring is illustrative-only (plugins not actually bound) — see the corpus coverage gaps.

**Current (mid-2026)**: ArchUnit 1.4.2 is stable; PIT is active (Gradle plugin 1.19.0, Maven 1.15.x); FindBugs is dead → SpotBugs.

## Full content

These tools sit beside the test suite and gate *codebase-level* properties. They run in the same build but answer different questions: is the architecture intact, is the suite thorough, is the static-analysis surface clean.

### ArchUnit — architecture as tests

ArchUnit imports compiled classes (`ClassFileImporter`) and asserts structural rules: which packages may depend on which (`layeredArchitecture()`), naming conventions, no-cyclic-dependencies, annotation presence. Encoding architecture as ordinary JUnit tests means violations fail the build like any other test — architecture erosion is caught at PR time instead of review.

### JaCoCo — coverage measurement

JaCoCo runs as a Java agent (`prepare-agent`) that instruments classes, then emits a coverage `report`. The subtle part is exclusions: generated code (mappers, DTOs, Lombok output) shouldn't count against coverage. Two mechanisms — glob `<excludes>` over *compiled class* paths, or a custom `@Generated` annotation (which must have retention `RUNTIME` or `CLASS` and a simple name that *contains* `Generated`, since JaCoCo 0.8.2+ matches by simple-name substring). SonarQube ingests the agent output for its quality dashboards.

### PITest, CheckStyle, SpotBugs

**PITest** does mutation testing: it perturbs the code (flip a conditional, change a return) and checks whether the suite catches it — a far stronger adequacy signal than line coverage, which only proves a line *executed*. **CheckStyle** enforces style rules; **FindBugs** (long dead) → **SpotBugs** finds bug patterns statically. Note much of this tier in the corpus is README-listed but unwired (subject classes without bound plugins).

### 2026 currency

- **ArchUnit 0.14 → 1.x is stable**; the pre-1.0 `layeredArchitecture()` no-arg → `.consideringAllDependencies()` deprecation is long resolved. Current is 1.4.2 (2026-04-18). [ArchUnit 1.4.2 release news](https://www.archunit.org/news/release/2026/04/18/release-v1.4.2.html)
- **PIT mutation testing is actively maintained** — Gradle plugin 1.19.0 (2026-03-29), Maven plugin 1.15.x. [PIT Gradle plugin](https://plugins.gradle.org/plugin/info.solidsoft.pitest)
- **FindBugs (last release 2015) → SpotBugs** is the maintained successor; FindBugs receives no patches.
- The JaCoCo `@Generated`-exclusion behavior and ArchUnit's rules-as-tests concept carry forward unchanged. These gates run through the build's coverage/quality stage (see [testing/load-performance-testing](load-performance-testing.md) for the perf stage analog).
