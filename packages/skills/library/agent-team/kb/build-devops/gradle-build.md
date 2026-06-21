---
kb_id: build-devops/gradle-build
version: 1
tags:
  - build-devops
  - gradle
  - build-systems
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: gradle, gradle-5, gradle-6"
  - "endoflife.date — Gradle (https://endoflife.date/gradle)"
related:
  - build-devops/maven-build
  - build-devops/bazel-build
  - build-devops/static-analysis-gates
status: active
---

## Summary

**Concept**: Gradle — imperative-DSL build engine (Groovy or Kotlin) with a configure→execute lifecycle, lazy tasks, source sets, and a project-pinned wrapper; taught across three "generations" (4.x core, 5.x source-sets, 6.0 Kotlin-DSL feature showcase).
**Key APIs**: `DefaultTask`+`@TaskAction`, `Plugin<Project>`+extension object, `sourceSets { itest { ... } }`, configuration avoidance (`register` vs `create`), rich versions (`require`/`prefer`/`because`), `java-platform` BOM, `java-test-fixtures`, the Gradle Wrapper (`gradlew`).
**Gotcha**: `compile`/`testCompile`/`runtime` configs and the `maven` plugin were REMOVED in Gradle 7 → `implementation`/`api`/`testImplementation`/`runtimeOnly` + `maven-publish`; Nebula unused-dep lint is bytecode-based (reflection blind spot).
**2026-currency**: Gradle 7 is EOL; current line is Gradle 9 (9.6.0, 2026-06-18); 8.x maintenance-only; Gradle 9.4 added Java 26 toolchain support.
**Sources**: Baeldung `gradle`/`gradle-5`/`gradle-6` modules; endoflife.date Gradle.

## Quick Reference

**Three teaching generations**:

- **Core (`gradle`, 4.x Groovy DSL)**: lifecycle init→configure→execute; tasks (`doFirst`/`doLast`, `dependsOn`, `group`/`description`, `ext` props); typed/custom tasks (`DefaultTask`+`@TaskAction`); `buildSrc` shared logic; custom plugins (`Plugin<Project>` + extension + DSL block); fat jars (manual `zipTree` vs Shadow); JaCoCo (`finalizedBy` + glob/`@Generated` exclusions); JUnit 5 (`useJUnitPlatform`, tag filtering, Vintage engine); the `application` plugin.
- **5.x (`gradle-5`)**: running a `main` via `JavaExec`/`Exec`; Nebula Lint unused-deps (with reflection blind spot); **source sets** (custom `itest` set wired from `main` output); command-line args (`-Pargs` project property vs `-Dargs` system property).
- **6.0 (`gradle-6`, Kotlin DSL)** — the durable feature showcase: configuration **avoidance** (`register` vs `create`), dependency **constraints + rich versions** (`require`/`prefer`/`because`), **java-test-fixtures** (reusable `testFixtures` set; JUnit-5 default-method mix-in contract tests), `java-platform` BOM (version-less consumer deps), Gradle **Module Metadata** publishing (`.module`), `api` vs `implementation` encapsulation, SPI + AutoService.

**Canonical idioms**:

```groovy
// custom task
class PrintToolVersionTask extends DefaultTask { @TaskAction void run(){...} }
// custom plugin + extension
class GreetingPlugin implements Plugin<Project> {
  void apply(p){ p.extensions.create("greeting", GreetingPluginExtension); p.task("hello").doLast{...} }
}
// custom source set (Gradle synthesizes itest* configs from the name)
sourceSets { itest { compileClasspath += sourceSets.main.output; runtimeClasspath += sourceSets.main.output } }
configurations { itestImplementation.extendsFrom(testImplementation) }
```

```kotlin
// rich versions (Kotlin DSL)
implementation("com.google.guava:guava"){ version { require("10.0"); prefer("28.1-jre"); because("...") } }
// test fixtures consumer
testImplementation(testFixtures(project(":fibonacci-spi")))
// BOM
api(platform(project(":httpclient-platform")))
```

**Cross-Gradle — the Wrapper**: `gradlew`/`gradlew.bat` + `gradle-wrapper.properties` + the committed `gradle-wrapper.jar` bootstrap a project-pinned distribution via `GradleWrapperMain`.

**Top gotchas**:
- Nebula / unused-dependency lint is bytecode-based → misses reflection (the `gradle-5/unused-dependencies` module deliberately uses HttpClient via reflection to prove the blind spot). Advisory only.
- `compile`/`testCompile`/`runtime` removed in Gradle 7; the `maven` plugin (`mavenInstaller`/`pom.writeTo`) removed in 7; `JavaExec.main`/`application{mainClassName}` → `mainClass`.

**Current (mid-2026)**: Gradle 9.6.0 (2026-06-18); 8.x (8.14.5) maintenance-only since 2025-07-31; 7.x EOL (2023-02-10). The base's "Gradle 7+ idioms" are correct but the floor is now 8/9. `jcenter()` is dead → `mavenCentral()`.

## Full content

Gradle is the imperative-DSL counterpart to Maven's declarative POM. The corpus teaches it across three deliberate generations so the durable concepts separate from the version-churned syntax.

### Lifecycle, tasks, and plugins

Gradle's build runs init→configure→execute. The unit of work is the task — defined ad-hoc (`task name { doLast {...} }`) or as a typed `DefaultTask` subclass with `@TaskAction`. Shared logic lives in `buildSrc`; reusable behavior is packaged as a `Plugin<Project>` exposing an extension object that a DSL block (`greeting { ... }`) configures. JaCoCo and JUnit 5 wire in via the plugins block (`finalizedBy jacocoTestReport`, `useJUnitPlatform`).

### Source sets and the durable 6.0 features

Source sets are the mechanism for an extra compilation unit — e.g. a custom `itest` integration-test set wired from `main` output, with Gradle synthesizing `itest*` configurations from the set name. The Gradle 6.0 module is the most durable: configuration avoidance (lazy `register` over eager `create`), rich versions (`require`/`prefer`/`because`), reusable `java-test-fixtures` (a JUnit-5 interface with `@Test default` methods so every impl inherits the contract tests), the `java-platform` BOM for version-less consumer dependencies, Module Metadata publishing, and `api`-vs-`implementation` encapsulation.

### The Wrapper

Every Gradle project commits the wrapper (`gradlew` + `gradle-wrapper.properties` + `gradle-wrapper.jar`), which bootstraps a project-pinned Gradle distribution. This is the supply-chain-relevant entry point (`gradle-wrapper-validation` checks its integrity).

### 2026 currency

- **Build tools moved up two majors.** Gradle 7 (2021-04-09) is end-of-life (2023-02-10); the current line is **Gradle 9 (latest 9.6.0, 2026-06-18)**, with Gradle 8 (8.14.5, 2026-05-07) maintenance-only since 2025-07-31. Gradle 9.4.0 (2026-03-04) added Java 26 toolchain support. [endoflife.date — Gradle](https://endoflife.date/gradle) · [Gradle 9.6.0 Release Notes](https://docs.gradle.org/current/release-notes.html) · [Gradle 9.4.0 Release Notes](https://docs.gradle.org/9.4.0/release-notes.html)
- **Removed/dead configs**: `compile`/`testCompile`/`runtime` removed in Gradle 7 → `implementation`/`api`/`testImplementation`/`runtimeOnly`. The Gradle `maven` plugin (`gradle-to-maven`: `mavenInstaller`/`pom.whenConfigured`/`pom.writeTo`) removed in 7 → `maven-publish`. `JavaExec.main`/`application{mainClassName}` → `mainClass`. `configurations.compile.collect` fat-jar → Shadow (moved to `com.gradleup.shadow`).
- **Dead repos**: `jcenter()` went read-only May 2021 and JFrog fully sunset it 2024-08-15 (fetches auto-redirect to Maven Central) → use `mavenCentral()`. Bintray (shipkit/bintray-release) shut 2021. [JFrog — JCenter Sunset on August 15th, 2024](https://jfrog.com/blog/jcenter-sunset/)
- **Carries forward unchanged** at the concept level: configuration avoidance, version catalogs, test fixtures, the wrapper — what moved is the version floor, not the mental model. [endoflife.date — Gradle](https://endoflife.date/gradle)
