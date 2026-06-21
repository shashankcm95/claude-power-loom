---
kb_id: web-ui/war-deployment-wildfly
version: 1
tags:
  - web-ui
  - deployment
  - wildfly
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: wildfly"
  - "Spring Boot GraalVM native image (docs.spring.io/spring-boot/reference/packaging/native-image/index.html)"
related:
  - web-ui/action-mvc-frameworks
  - web-ui/javax-jakarta-migration
status: active
---

## Summary

**Concept**: Deploying a Spring Boot app as a WAR on an external application server (WildFly) instead of the embedded fat-JAR — the external-container deployment model and its exact pom/initializer mechanics. The corpus's deployment edge case.
**Key APIs**: `extends SpringBootServletInitializer` + override `configure(SpringApplicationBuilder)`; `<packaging>war</packaging>`; exclude `spring-boot-starter-tomcat`; mark `javax.servlet-api` `provided`; manifest entry `Dependencies: jdk.unsupported`.
**Gotcha**: a plain `@SpringBootApplication main()` won't bootstrap as a WAR (must extend the initializer); leaving `spring-boot-starter-tomcat` in collides with the host container; the `jdk.unsupported` manifest entry is needed for WildFly's modular classloader to allow `sun.misc`/Unsafe usage.
**2026-currency**: external-container WAR deployment of Spring Boot is increasingly uncommon — the dominant pattern is the executable fat-JAR with embedded server / containerized; Spring Boot 3+ adds GraalVM native images; `javax.servlet` → `jakarta.servlet`.
**Sources**: Baeldung `wildfly`; Spring Boot native-image docs.

## Quick Reference

**The external-container WAR recipe** (Spring Boot on WildFly):
1. **Extend the initializer**: `class Application extends SpringBootServletInitializer { @Override configure(SpringApplicationBuilder b) { return b.sources(Application.class); } }` — a plain `@SpringBootApplication main()` will not bootstrap as a WAR.
2. **Package as WAR**: `<packaging>war</packaging>` in the pom.
3. **Exclude the embedded server**: remove/exclude `spring-boot-starter-tomcat` (else it collides with the host container).
4. **Mark servlet API provided**: `javax.servlet-api` scope `provided` (the container supplies it).
5. **Manifest entry**: `Dependencies: jdk.unsupported` — WildFly's modular classloader needs it for `sun.misc`/Unsafe usage.

**Why each step**:
- Initializer → the WAR has no `main()` entry; the servlet container calls `configure`.
- Tomcat exclusion → two servlet containers on one classpath is a conflict.
- `provided` scope → don't bundle an API the container already exposes.
- `jdk.unsupported` → WildFly isolates modules; without the explicit dependency, `sun.misc.Unsafe` is invisible.

**Top gotchas**:
- Forgetting the initializer is the #1 failure — the app builds a WAR but never starts.
- The embedded fat-JAR (the Spring Boot default) and this WAR model are mutually exclusive build shapes.

**Current (mid-2026)**: **External-container WAR deployment of Spring Boot is increasingly uncommon** — the dominant pattern is the executable fat-JAR with an embedded server, typically containerized. Spring Boot 3.0+ also compiles to **GraalVM native images** for startup/memory wins. `javax.servlet` → `jakarta.servlet` (Jakarta EE 9+) — the WAR structure carries forward, the namespace does not.

## Full content

The WildFly module is the corpus's deployment edge case: it shows how to deploy a Spring Boot application as a **WAR on an external application server** rather than as the embedded executable fat-JAR that Spring Boot defaults to. The interesting content is the precise set of mechanics that make a fat-JAR-shaped app deployable on a standalone container.

### The recipe

There are five load-bearing changes. First, the application class must `extends SpringBootServletInitializer` and override `configure(SpringApplicationBuilder)` to return `builder.sources(Application.class)` — because a WAR has no `main()` entry point, the servlet container invokes `configure` to bootstrap Spring instead. Second, the pom must declare `<packaging>war</packaging>`. Third, `spring-boot-starter-tomcat` must be excluded, because shipping an embedded Tomcat into a WAR that runs on WildFly puts two servlet containers on one classpath. Fourth, `javax.servlet-api` is marked `provided` — the host container supplies it, so it must not be bundled. Fifth, the WAR's manifest needs a `Dependencies: jdk.unsupported` entry, because WildFly's modular classloader isolates modules and won't expose `sun.misc`/`Unsafe` (which Spring's dependencies use) without that explicit dependency.

### Why it matters

Each step exists for a concrete failure: omit the initializer and the WAR builds but never starts; leave Tomcat in and the two containers collide; bundle the servlet API and you risk a version clash with the container's; drop the `jdk.unsupported` manifest line and you hit `NoClassDefFoundError` on `sun.misc.Unsafe` at runtime under WildFly's classloader. The structure (initializer + tomcat exclusion + provided servlet API) is the durable lesson even as the surrounding versions move.

### 2026 currency

- **External-container WAR deployment is increasingly uncommon in 2026.** The dominant Spring Boot pattern is the executable fat-JAR with an embedded server, usually containerized (Docker/Kubernetes). The WAR-on-app-server model persists mainly in legacy/regulated estates.
- **GraalVM native images are the new deployment story.** Spring Boot 3.0+ compiles to [GraalVM native images](https://docs.spring.io/spring-boot/reference/packaging/native-image/index.html) for fast startup and low memory; [Spring Security ships native hints](https://docs.spring.io/spring-security/reference/native-image/index.html), but note the [OpenTelemetry Java agent does not work under native image](https://opentelemetry.io/blog/2023/spring-native/) — use the OTel Spring Boot starter instead.
- **`javax.servlet` → `jakarta.servlet`** (Jakarta EE 9+): the `web.xml` 2.5/3.0 schemas and `javax.servlet-api` dependency in this module are pre-Jakarta. The WAR *structure* (initializer + tomcat exclusion + provided API + manifest entry) carries forward; the namespace and Spring Boot baseline (2.x → 3.x/4.x) do not. See the `javax→jakarta` migration doc.
