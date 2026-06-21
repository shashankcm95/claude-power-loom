---
kb_id: spring-boot/native-image-aot
version: 1
tags:
  - spring-boot
  - native-image
  - graalvm
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-native"
  - "Spring Boot 3.2 + GraalVM + Java 21 + virtual threads (spring.io/blog/2023/09/09/all-together-now-spring-boot-3-2-graalvm-native-images-java-21-and-virtual)"
  - "Spring Boot 4.0 Migration Guide (github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)"
related:
  - spring-boot/build-packaging
  - spring-boot/runtime-performance
status: active
---

## Summary

**Concept**: Ahead-of-time compilation of a Boot app to a GraalVM native image — the discontinued Spring Native 0.x path vs the production Boot 3 AOT path.
**Key APIs**: Spring Native 0.x `native-maven-plugin` + `spring-aot-maven-plugin` (legacy); Cloud Native Buildpacks `BP_NATIVE_IMAGE=true` + `paketobuildpacks/builder:tiny`; Boot 3 first-class AOT (`spring-boot-maven-plugin process-aot`, `native` profile).
**Gotcha**: the corpus only shows the discontinued Spring Native 0.x — do not seed it; Boot 3 folded native support in first-class.
**2026-currency**: Spring Native 0.x → Boot 3 AOT (production-supported since 3.0); Boot 4.0 native-image requires JDK 25+.
**Sources**: Baeldung `spring-native`; spring.io 2023; Spring Boot 4.0 migration guide.

## Quick Reference

**What it buys**: tens-of-MB RAM footprint and sub-second startup, at the cost of build-time AOT processing and closed-world constraints (reflection/proxies need hints).

**Production path (Boot 3+)**: native support is built in. Two routes:
- **Buildpacks** (no GraalVM install): `mvn spring-boot:build-image -Pnative` with `BP_NATIVE_IMAGE=true` produces an OCI image (`paketobuildpacks/builder:tiny`).
- **GraalVM plugin**: the `org.graalvm.buildtools:native-maven-plugin` + the `native` profile compiles a local native binary; Boot's AOT engine (`process-aot`) generates the reachability metadata.

**Legacy path (do not use)**: Spring Native 0.x added the `spring-aot-maven-plugin` + `native-maven-plugin` separately; it was experimental and is superseded.

**Top gotchas**:
- The corpus's Spring Native 0.x build config is non-current — Boot 3 AOT replaced it.
- Reflection, dynamic proxies, and resource loading in a native image need AOT hints (`RuntimeHintsRegistrar`).

**Current (mid-2026)**: GraalVM native images via Boot AOT have been production-supported since Boot 3.0; Boot 4.0 requires JDK 25+ for native-image. CRaC (JVM checkpoint/restore) is an alternative fast-startup mechanism (Boot 3.2) when a native image's constraints are too strict.

## Full content

Native compilation turns a Boot application into a standalone GraalVM native executable with a tiny memory footprint and near-instant startup — attractive for serverless and high-density deployment. The 2021 corpus only anticipated this with the experimental Spring Native 0.x; it is now a first-class, production feature of the framework.

### The closed-world model

GraalVM native-image performs ahead-of-time, closed-world compilation: everything reachable must be known at build time. Spring's AOT engine analyzes the bean graph at build time and generates the source/metadata needed so the dynamic features Spring relies on (reflection, proxies, resource loading) work in the native binary. Features outside that analysis need explicit hints.

### Two build routes

Buildpacks require no local GraalVM: `spring-boot:build-image` with `BP_NATIVE_IMAGE=true` produces an OCI image using a Paketo builder. The GraalVM `native-maven-plugin` route compiles a local binary and is driven by a `native` profile; Boot's `process-aot` goal generates the reachability metadata. The legacy Spring Native 0.x wired the AOT and native plugins separately and is no longer the path.

### When native is too strict: CRaC

When a workload depends on features that resist closed-world analysis, Project CRaC (Coordinated Restore at Checkpoint, Boot 3.2) offers an alternative: snapshot a warmed-up JVM and restore it for fast startup without giving up the dynamic JVM. See [spring-boot/runtime-performance](runtime-performance.md).

### 2026 currency

- **Spring Native 0.x → Boot 3 first-class AOT.** GraalVM native images are production-supported via Boot AOT since Boot 3.0 (replacing the experimental Spring Native 0.x), delivering tens-of-MB RAM and sub-second startup. [Spring Boot 3.2 + GraalVM + Java 21 + virtual threads](https://spring.io/blog/2023/09/09/all-together-now-spring-boot-3-2-graalvm-native-images-java-21-and-virtual/)
- **Boot 4.0 native baseline.** GraalVM native-image requires JDK 25+ under Boot 4.0 (Java 17 minimum overall, Java 25 first-class). [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **CRaC is the complementary fast-startup option** (Boot 3.2) for workloads where native-image constraints do not fit. [Spring Boot 3.2.0 available now](https://spring.io/blog/2023/11/23/spring-boot-3-2-0-available-now/)
