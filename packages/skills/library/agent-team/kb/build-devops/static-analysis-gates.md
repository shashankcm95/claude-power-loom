---
kb_id: build-devops/static-analysis-gates
version: 1
tags:
  - build-devops
  - static-analysis
  - code-quality
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: checker-plugin, static-analysis, custom-pmd, animal-sniffer-mvn-plugin, maven-modules (enforcer)"
  - "PMD docs — Writing a custom Java rule (https://docs.pmd-code.org/latest/pmd_userdocs_extending_writing_java_rules.html)"
related:
  - build-devops/maven-build
  - build-devops/gradle-build
  - build-devops/compile-time-codegen
  - build-devops/jvm-runtime-modernization
status: active
---

## Summary

**Concept**: build-time correctness/quality gates that fail (or warn on) the build before code ships — pluggable type checking, source/bytecode static analysis, API-compatibility checks, and build-policy enforcement.
**Key APIs**: Checker Framework (`@NonNull`/`@Nullable`/`@MonotonicNonNull`/`@KeyFor`/`@Fenum`/`@Regex`); PMD (`AbstractJavaRule`+`visit(node)`+`addViolation`, `category/java/*.xml`); Animal Sniffer (`check`@`verify`); Maven Enforcer (`requireJavaVersion`/`banTransitiveDependencies` + custom `EnforcerRule`).
**Gotcha**: Checker `-Awarns` downgrades errors to warnings (violations compile "green"); Animal Sniffer `java16` = Java 1.6 (the JDK signature version), not Java 16, and binds only to `verify`.
**2026-currency**: PMD 7.25.0 (2026-05-29) changed the rule API (NodeStream, `getImage()` removed); base lacks Error Prone, SpotBugs 4.9.8, and JSpecify (the standardized nullness annotations).
**Sources**: Baeldung `checker-plugin`/`static-analysis`/`custom-pmd`/`animal-sniffer`/Enforcer; PMD custom-rule docs.

## Quick Reference

**Pluggable static type checking — Checker Framework** (javac annotation processors enforcing whole bug classes at compile time):

- Nullness: `@NonNull` / `@Nullable` / `@MonotonicNonNull` (set-once)
- `@KeyFor` (map-key presence), Fake-Enum `@Fenum` (nominal String/int "enums")
- Formatter (validates `String.format` strings + args), Regex `@Regex(n)` (capturing-group count)
- Gotcha: `-Awarns` downgrades errors to warnings — every intentional violation compiles "green"; remove it to fail the build.

**Source static analysis — PMD**: built-in + custom rulesets wired via `maven-pmd-plugin` `<reporting>`. Custom rule: `extend AbstractJavaRule`, override `visit(node)`, call `addViolation`. Ruleset control: include whole ruleset / single rule / override message+priority / override property / `<exclude>` one rule.

**API-compatibility — Animal Sniffer** (`animal-sniffer-mvn-plugin`): the `check` goal bound to `verify` validates code only uses APIs in a chosen signature artifact. `java16` = the Java **1.6** surface ("must run on Java 6") — NOT Java 16. `mvn compile`/`test` won't trigger it.

**Build-policy enforcement — Maven Enforcer**: built-in rules `requireMavenVersion` / `requireJavaVersion` / `requireEnvironmentVariable` / `requireActiveProfile` / `banDuplicatePomDependencyVersions` / `banTransitiveDependencies`; `<level>WARN</level>` for advisory; custom `EnforcerRule`.

**Top gotchas**:
- Checker `-Awarns` makes violations advisory (teaching output is in the warning log).
- Animal Sniffer's number is the JDK signature version, and it binds only to `verify`.
- PMD 5 ruleset layout (`rulesets/java/*.xml`) is stale — PMD 6+ uses `category/java/*.xml`.

**Current (mid-2026)**: PMD 7.25.0 — custom rules still `extend AbstractJavaRule` + `visit(...)` but node navigation moved to `NodeStream` (`ancestors()`/`descendants()`/`children()`), `getImage()` removed for typed accessors. Add **Error Prone** (400+ javac-time patterns, pairs with NullAway), **SpotBugs 4.9.8** (FindBugs successor), and **JSpecify** (standardized `@Nullable`/`@NonNull` adopted by Spring Framework 7).

## Full content

This cluster is the build-time correctness layer: gates that run during the build and can fail it (or warn) before code reaches a repository or registry. The corpus covers four kinds.

### Pluggable static type checking (Checker Framework)

The Checker Framework runs as javac annotation processors that enforce whole bug classes at compile time — nullness (`@NonNull`/`@Nullable`/`@MonotonicNonNull`), map-key presence (`@KeyFor`), fake enums (`@Fenum`), format-string validation, and regex capturing-group counts (`@Regex(n)`). It is the most durable concept in the cluster: the pluggable-type approach carries forward and is the lineage that JSpecify standardizes.

### Source static analysis (PMD) and custom rules

PMD scans source for rule violations, wired through `maven-pmd-plugin`. Authoring a custom rule means extending `AbstractJavaRule`, overriding `visit(node)`, and calling `addViolation`. Rulesets can include a whole ruleset, a single rule, or override a rule's message/priority/property. (The corpus `custom-pmd` module is only the rule class — no ruleset XML or test — so it isn't runnable end-to-end.)

### API-compatibility and build-policy enforcement

Animal Sniffer validates that code uses only APIs present in a chosen signature artifact (its `check` goal binds to `verify`). Maven Enforcer is the build-policy gate: built-in rules constrain Java/Maven versions, environment, active profiles, and transitive dependencies, with custom `EnforcerRule`s for project-specific policy.

### 2026 currency

- **PMD 7 rule API changed.** Current is **PMD 7.25.0 (2026-05-29)**. Custom Java rules still `extend AbstractJavaRule` + override `visit(...)`, but node navigation moved to a `NodeStream` API (`ancestors()`/`descendants()`/`children()`), `getImage()` was removed for typed accessors, and rulesets use `category/java/*.xml` — so the corpus's PMD 5 `rulesets/java/*.xml` layout is doubly stale. [PMD docs — Writing a custom Java rule](https://docs.pmd-code.org/latest/pmd_userdocs_extending_writing_java_rules.html)
- **Static analysis the base lacks**: **Error Prone** (Google compiler-plugin bug-pattern checker, 400+ patterns at `javac` time; pairs with NullAway) and **JSpecify** (the now-standardized `@Nullable`/`@NonNull` set adopted portfolio-wide by Spring Framework 7, consumable by NullAway/Error Prone/Checker) — JSpecify is the convergence point that ends the fragmented nullness-annotation landscape. [Java Code Geeks — Static Analysis & Code Generation for Java](https://www.javacodegeeks.com/2025/10/static-analysis-code-generation-for-java-preventing-bugs-before-they-happen.html) · [spring.io — Null Safety with JSpecify and NullAway](https://spring.io/blog/2025/03/10/null-safety-in-spring-apps-with-jspecify-and-null-away/)
- **SpotBugs 4.9.8 (Oct 2025)** is the active canonical FindBugs successor for bytecode bug-pattern scanning; JDK 21 bytecode analysis since 4.8.0. [appsecsanta — SpotBugs 2026](https://appsecsanta.com/spotbugs)
- **Legacy Enforcer SPI** `EnforcerRule` → `AbstractEnforcerRule`; the Checker Framework's pluggable-type approach carries forward unchanged at the concept level. [PMD docs — Writing a custom Java rule](https://docs.pmd-code.org/latest/pmd_userdocs_extending_writing_java_rules.html)
