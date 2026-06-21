---
kb_id: build-devops/maven-build
version: 1
tags:
  - build-devops
  - maven
  - build-systems
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: maven-modules, maven-archetype, maven-polyglot"
  - "Apache Maven — release history (https://maven.apache.org/docs/history.html)"
related:
  - build-devops/gradle-build
  - build-devops/bazel-build
  - build-devops/static-analysis-gates
  - build-devops/compile-time-codegen
status: active
---

## Summary

**Concept**: Apache Maven — declarative POM-driven build: coordinates + lifecycle phases + plugin goals bound to phases; the deepest cluster of this domain (~25 submodules).
**Key APIs**: `mvn help:effective-pom` (Super POM merge), `<packaging>pom</packaging>`+`<modules>`, `<dependencyManagement>`/`<pluginManagement>`, custom Mojo (`@Mojo`/`@Parameter`/`AbstractMojo`), Surefire vs Failsafe, `dependency:tree`/`dependency:analyze`/`versions:*`.
**Gotcha**: a plugin execution under `<pluginManagement>` only (not `<plugins>`) is configured but never runs; `<activeByDefault>` profiles silently disable when ANY other profile activates.
**2026-currency**: latest GA is Maven 3.9.16 (2026-05-13, Java 8); Maven 4 still at 4.0.0-rc-5 (not GA, requires Java 17). POM/lifecycle/profile mechanics fully current.
**Sources**: Baeldung `maven-modules`/`maven-archetype`/`maven-polyglot`; Apache Maven release history.

## Quick Reference

**The POM model — three faces**:

- **Super POM** (implicit parent) supplies Maven Central repo, standard directory layout, default `finalName`, `pluginManagement` defaults.
- **Simplest POM** = `<modelVersion>4.0.0</modelVersion>` + `<groupId>`/`<artifactId>`/`<version>` only; everything else inherited.
- **Effective POM** = Super POM ⊕ parents ⊕ project ⊕ active profiles, fully interpolated. Inspect with `mvn help:effective-pom`.

Packaging types: `jar` / `war` / `pom` / `maven-plugin` / `maven-archetype` / `hpi`.

**Multi-module / aggregator**: `<packaging>pom</packaging>` + `<modules>`; centralize plugin versions in `<pluginManagement>`, dependency versions in `<dependencyManagement>`. Property indirection: define `<X.version>` in `<properties>`, reference `${X.version}`.

**Custom Mojo** (plugin authoring): `@Mojo(name="dependency-counter", defaultPhase=LifecyclePhase.COMPILE)` on a class `extends AbstractMojo`; `@Parameter(property="scope")` (CLI `-Dscope` or POM config); `@Parameter(defaultValue="${project}", required=true, readonly=true) MavenProject project`; `execute()` logs via `getLog().info(...)`. Fields are package-private (tooling injects by reflection). `<packaging>maven-plugin</packaging>`; `maven-plugin-annotations` at `provided` scope.

**Surefire vs Failsafe**: Surefire defaults `**/Test*`,`**/*Test`,`**/*Tests`,`**/*TestCase` (fail-fast in the `test` phase); Failsafe defaults `**/IT*`,`**/*IT`,`**/*ITCase` (goals `integration-test`+`verify`; defers failure to `verify` so `post-integration-test` teardown runs). `-Dmaven.test.failure.ignore=true` keeps building despite failures.

**Dependency hygiene**: `dependency:tree` (which version wins under "nearest definition wins"), `dependency:analyze` (used-undeclared + unused-declared), `versions:display-dependency-updates` → `use-latest-releases` → `revert`/`commit`. Version-collision resolution 3 ways: `<dependencyManagement>` pin, `<exclusions>`, Enforcer `banTransitiveDependencies`. `<optional>true</optional>` cuts transitivity at the provider.

**Plugin-config merge**: parent `combine.children="append"` (merge child entries) vs child `combine.self="override"` (replace parent block entirely — all-or-nothing).

**Top gotchas**:
- `pluginManagement` ≠ activation — execution declared only there never runs.
- `<activeByDefault>` is fragile — activating any other profile disables all `activeByDefault` profiles.
- "Nearest definition wins" can silently pick the OLDER version on a shorter path; invisible without `dependency:tree`.
- `dependency:analyze` is bytecode-based → misses reflection/SPI/JNI and inlined `static final` constants. Advisory only.

**Current (mid-2026)**: build on Maven 3.9.x (3.9.16); Maven 4 (4.0.0-rc-5) not GA. Legacy Enforcer `EnforcerRule` SPI → `AbstractEnforcerRule`. Target `<maven.compiler.release>21</maven.compiler.release>` (or 25), not the base's `1.7`/`1.8`/`9`.

## Full content

Maven is the deepest cluster of this build domain. The corpus's `maven-modules` aggregator alone spans ~25 submodules covering the full POM model, the lifecycle/plugin mechanism, custom Mojo + custom Enforcer rule authoring, every profile-activation trigger, the Surefire/Failsafe integration-test split, dependency hygiene (optional/collision/unused/version-automation), plugin-config merge control, archetype authoring, and even build-model extension via Polyglot.

### POM model and the lifecycle/plugin mechanism

Everything in Maven is the POM plus the lifecycle. The universal extension mechanism is the phase-bound `<execution>`: bind a plugin goal to a lifecycle phase and it runs at that phase. Core plugins are compiler, resources (with filtering), clean (custom filesets), and jar/install/deploy/site. The effective build is the Super POM merged with all parents, the project POM, and active profiles — always inspectable with `mvn help:effective-pom`.

### Custom plugins (Mojo) and Enforcer rules

A custom plugin is a Mojo: `@Mojo(name=..., defaultPhase=...)` on a class extending `AbstractMojo`, with `@Parameter`-annotated fields injected by reflection (so they are package-private). A custom Enforcer rule `implements EnforcerRule`, with `execute(EnforcerRuleHelper)` calling `helper.evaluate("${project.groupId}")` and throwing `EnforcerRuleException`. Both are build-time quality/policy gates authored in Java.

### Profiles, integration testing, dependency hygiene

Profiles support every activation trigger: `activeByDefault`, `<jdk>`, `<os>`, `<property>` (incl. `!`-negation), `<file><exists/missing>`. The Surefire/Failsafe split is the canonical IT pattern: Failsafe defers failures to `verify` so teardown (`post-integration-test`) still runs. Dependency hygiene is diagnostic-driven (`dependency:tree`, `dependency:analyze`, `versions:*`) — but bytecode analysis is advisory because it cannot see reflection, SPI, or inlined compile-time constants.

### Archetypes and Polyglot

Maven also generates projects (the `maven-archetype` packaging with `archetype-metadata.xml`, filtered/packaged fileSets, `${...}` substitution, `requiredProperties`) and supports non-XML POMs via Polyglot (`pom.json`/`pom.yml`) by implementing the `ModelProcessor` SPI (`locatePom`/`read`) wired through `.mvn/extensions.xml` with Plexus DI.

### 2026 currency

- **Maven 4 is still not GA.** Latest GA is **Maven 3.9.16 (2026-05-13, requires Java 8)**; Maven 4 is at **4.0.0-rc-5 (2025-11-13, requires Java 17)**. The POM model / lifecycle / profiles / `help:effective-pom` / `versions:*` mechanics remain fully current on 3.9.x. [Apache Maven — release history](https://maven.apache.org/docs/history.html)
- **JAX-WS removed from the JDK** (gone since Java 11; `wsimport`, `javax.xml.ws`) → standalone Jakarta XML Web Services artifacts; the corpus's `jaxws` and `maven-archetype` (JAX-RS 2.1/CDI 2.0 + a dead nightly-zip URL) modules are wholesale stale. [Apache Maven — release history](https://maven.apache.org/docs/history.html)
- **Compiler target moved.** JDK source/target `1.7`/`1.8`/`9` → `<maven.compiler.release>21</maven.compiler.release>` (conservative LTS) or `25` (newest LTS, GA 2025-09-16). [endoflife.date — Eclipse Temurin](https://endoflife.date/eclipse-temurin)
- **Legacy Enforcer SPI** `EnforcerRule` → `AbstractEnforcerRule`; old plugin pins everywhere (surefire/failsafe 2.22, compiler 3.8, enforcer 3.0.0-M2) should be bumped — treat unpinned plugin versions as the practical supply-chain risk. [Apache Maven — release history](https://maven.apache.org/docs/history.html)
- **Maven settings password encryption is obfuscation, not security** — reversible by anyone with the master file on the same machine; use a real vault / CI secret store for actual secrets.
