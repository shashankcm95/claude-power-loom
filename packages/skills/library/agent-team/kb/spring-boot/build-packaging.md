---
kb_id: spring-boot/build-packaging
version: 1
tags:
  - spring-boot
  - build
  - packaging
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-artifacts-2"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-gradle"
  - "Spring Boot 4.0 Migration Guide (github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)"
related:
  - spring-boot/auto-configuration
  - spring-boot/native-image-aot
  - spring-boot/runtime-performance
  - spring-boot/actuator
  - spring-boot/observability-logging
status: active
---

## Summary

**Concept**: Boot's build/packaging toolchain — dependency management (parent vs BOM), starters, fat/thin/WAR jars, the repackage plugin, container/cloud deploy, build-time property injection.
**Key APIs**: `spring-boot-starter-parent`, `spring-boot-dependencies` BOM (`<scope>import</scope>`), `spring-boot-maven-plugin` `repackage`, `SpringBootServletInitializer`, Maven resource filtering (`@..@` delimiter), Gradle `bootJar`/`mainClass`.
**Gotcha**: plain `mvn package` is NOT `java -jar`-runnable as a Boot app — the `repackage` goal rewrites it into a `JarLauncher` fat jar.
**2026-currency**: Boot 4.0 renamed `spring-boot-starter-web` → `-starter-webmvc`, removed the executable-jar launch scripts (`.conf`/`JAVA_OPTS`), and removed Undertow.
**Sources**: Baeldung `spring-boot-artifacts-2` / `-gradle`; Spring Boot 4.0 migration guide.

## Quick Reference

**Dependency management — two ways**:
- *Inherit* `spring-boot-starter-parent` as the Maven `<parent>` (gets the BOM + plugin config + property defaults).
- *Import the BOM* when you already have a different parent: under `<dependencyManagement>` add `spring-boot-dependencies` with `<type>pom</type><scope>import</scope>`, then declare starters version-free.

**Starters** are curated dependency aggregations: `spring-boot-starter-{web,data-jpa,validation,test,actuator,security,thymeleaf,log4j2,jersey,...}`. Note Boot 2.3+ removed the validator from `-starter-web` — add `-starter-validation` explicitly.

**Executable (fat) jar**: bind the `repackage` goal of `spring-boot-maven-plugin`; it rewrites a plain jar into a `JarLauncher`-bootstrapped fat jar. **Plain `mvn package` alone is not runnable as a Boot app.**

**WAR deployment**: `<packaging>war</packaging>` + extend `SpringBootServletInitializer` (override `configure`) + mark the embedded container `provided`-scoped.

**Build-time property injection**: Maven resource filtering with `<filtering>true</filtering>` replaces `@project.version@` / `@custom@` tokens — the `@..@` delimiter is chosen so it does not collide with Spring's `${..}`; `useDefaultDelimiters=false` is essential. Read via `@Value("${...}")` or the Actuator `BuildProperties`. Git metadata via `git-commit-id-plugin` → `git.properties` → `@Value("${git.commit.*}")`.

**Gradle**: `bootJar{}`, `springBoot{ mainClass }` (renamed from `mainClassName` in Boot 2.4+), manifest `Start-Class`.

**Cloud/container**: Cloud Foundry (`manifest.yml`), GAE flex (`app.yaml`), AWS Beanstalk, OpenShift (K8s probes → `/actuator/health`), Heroku (`heroku-maven-plugin`), Docker via **Jib** (Dockerfile-less OCI image) or Cloud Native Buildpacks (`spring-boot-maven-plugin build-image`).

**Top gotchas**:
- Build-time `@..@` tokens stay literal (or fail context start) if resource filtering didn't run.
- Maven `${...}` filtering collides with Spring `${...}` — the Boot parent re-defines the delimiter to `@..@`.

**Current (mid-2026)**: Boot 4.0 renamed `spring-boot-starter-web` → `spring-boot-starter-webmvc`, requires explicit Flyway/Liquibase starters, removed Undertow, and removed the fully-executable jar `.conf` / `JAVA_OPTS` launch-script support; use `spring-boot-properties-migrator` on the 3.5 → 4.0 hop.

## Full content

Spring Boot ships an opinionated build toolchain on top of Maven and Gradle: a dependency BOM, curated starters, and a packaging plugin that produces a self-contained executable jar.

### Dependency management

The default path is inheriting `spring-boot-starter-parent`, which supplies the dependency BOM, plugin configuration, and sensible property defaults. When a project already has its own Maven `<parent>` (a corporate parent, say), import the BOM instead: declare `spring-boot-dependencies` under `<dependencyManagement>` with `<type>pom</type><scope>import</scope>`, after which starters can be declared without versions. The same technique works for the framework BOM (`spring-framework-bom`).

### Packaging shapes

Boot supports several artifact shapes. The **fat jar** is the default: the `spring-boot-maven-plugin` `repackage` goal rewrites a plain `mvn package` jar so it is bootstrapped by `JarLauncher` and runnable with `java -jar`. A **WAR** for an external servlet container needs `<packaging>war</packaging>`, a class extending `SpringBootServletInitializer`, and a `provided`-scoped embedded container. **Thin jars** (the experimental `spring-boot-thin-layout`) resolve dependencies at launch. An app can be published both as a fat jar and as a reusable library jar via the plugin's `<classifier>exec</classifier>` plus `maven-assembly-plugin`. Multi-module builds use a `<packaging>pom</packaging>` parent aggregating sibling library + application jars.

### Build-time property injection

Maven resource filtering substitutes build values into resources. Because Maven's default `${...}` delimiter collides with Spring's property placeholders, the Boot parent re-defines the filter delimiter to `@..@` (e.g. `application-version=@project.version@`) with `useDefaultDelimiters=false`. The values are read at runtime via `@Value` or the Actuator `BuildProperties`. Git commit metadata is injected the same way through `git-commit-id-plugin`.

### Deployment targets

The corpus demonstrates Cloud Foundry, Google App Engine flex, AWS Elastic Beanstalk, OpenShift (with Kubernetes liveness/readiness probes pointed at `/actuator/health`), Heroku, and Docker imaging via Jib (no Dockerfile) — plus the Maven Wrapper (`./mvnw`) so CI needs no preinstalled Maven.

### 2026 currency

- **Executable-jar launch scripts removed.** Fully-executable jar support (the prepended `.conf`/`JAVA_OPTS` shell script) was removed in Boot 4.0; use a normal `java -jar` invocation or a container. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **Boot 4.0 starter renames.** `spring-boot-starter-web` → `spring-boot-starter-webmvc`; Flyway and Liquibase now require explicit starters; Undertow was removed; modular autoconfigure jars ship; Kotlin 2.2+ is required. Upgrade path is Boot 3.5 → 4.0 with `spring-boot-properties-migrator`. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
- **BOM-import-vs-starter-parent, the custom-starter mechanism, and `git-commit-id-plugin` carry forward** — only the plugin's group id relocated (to `io.github.git-commit-id`). [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- For GraalVM native packaging and Cloud Native Buildpacks `BP_NATIVE_IMAGE`, see [spring-boot/native-image-aot](native-image-aot.md).
