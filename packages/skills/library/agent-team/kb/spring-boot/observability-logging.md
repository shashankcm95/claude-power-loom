---
kb_id: spring-boot/observability-logging
version: 1
tags:
  - spring-boot
  - logging
  - observability
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-logging-log4j2"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-disable-logging"
  - "Spring Boot 3.4 Release Notes — Structured Logging (github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.4-Release-Notes#structured-logging)"
related:
  - spring-boot/actuator
  - spring-boot/build-packaging
status: active
---

## Summary

**Concept**: Boot's logging stack — the default Logback, swapping to Log4j2, the SLF4J facade, runtime level changes, and structured JSON logging.
**Key APIs**: `spring-boot-starter-logging` (Logback) vs `spring-boot-starter-log4j2`, SLF4J + Lombok `@Slf4j`, `/loggers` Actuator endpoint, `logging.level.*`, `logging.structured.format.{console,file}`.
**Gotcha**: swapping to Log4j2 requires *excluding* `spring-boot-starter-logging` first, or both backends fight.
**2026-currency**: structured JSON logging (`ecs`/`gelf`/`logstash`) is first-class in Boot 3.4; pin Log4j2 ≥ 2.17.1 (Log4Shell).
**Sources**: Baeldung `spring-boot-logging-log4j2` / `-disable-logging`; Spring Boot 3.4 release notes.

## Quick Reference

**Default**: Boot uses Logback behind the SLF4J facade out of the box, configured by `logging.*` properties and optionally `logback-spring.xml`.

**Swap to Log4j2**:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter</artifactId>
  <exclusions>
    <exclusion>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-logging</artifactId>
    </exclusion>
  </exclusions>
</dependency>
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-log4j2</artifactId>
</dependency>
```

Then configure with `log4j2-spring.xml`.

**Facade vs native**: always log through SLF4J (`LoggerFactory.getLogger` or Lombok `@Slf4j`), not a backend's native API, so the backend stays swappable.

**Runtime level changes**: POST to the Actuator `/loggers/<name>` endpoint, or set `logging.level.<package>=DEBUG`. Log groups via `logging.group.*`. Disable console logging per backend (JUL / Log4j2 / Logback) when only file output is wanted.

**Structured JSON logging (Boot 3.4)**: `logging.structured.format.console=ecs` (or `gelf`/`logstash`) and `logging.structured.format.file=...` emit machine-readable logs without an appender library.

**Top gotchas**:
- Forgetting to exclude `spring-boot-starter-logging` before adding Log4j2 leaves two backends on the classpath.
- Log4j 1.x (via gelfj) and `log4j 1.2.17` in the corpus are EOL and predate Log4Shell — do not seed them.

**Current (mid-2026)**: structured JSON logging is built in since Boot 3.4 (`ecs`/`gelf`/`logstash` + custom formats). Any Log4j2 config must pin ≥ 2.17.1 to cover Log4Shell and its follow-on CVEs. Pair runtime/structured logs with the Actuator (metrics, probes) and Micrometer Tracing for distributed tracing.

## Full content

Spring Boot ships a complete logging setup by default and makes the backend swappable. The corpus covers the swap mechanics, the facade discipline, runtime control, and per-backend console suppression.

### Default and swap

Out of the box Boot configures Logback behind SLF4J. Switching to Log4j2 is a two-step dependency change: exclude the transitive `spring-boot-starter-logging` (so Logback is removed) and add `spring-boot-starter-log4j2`, then provide a `log4j2-spring.xml`. Skipping the exclusion leaves both backends present and conflicting.

### Facade discipline and runtime control

Application code should log through the SLF4J facade (`@Slf4j` from Lombok is the terse form), never a backend's native API, so the backend choice stays an infrastructure decision. Log levels can be changed at runtime by POSTing to the Actuator `/loggers` endpoint or statically with `logging.level.*`; related loggers can be grouped with `logging.group.*`. Each backend (JUL, Log4j2, Logback) can have its console appender disabled when only file output is desired.

### Security note on the corpus's logging deps

The corpus's logging modules carry dated, security-relevant dependencies: Log4j 1.x via gelfj and `log4j 1.2.17` (both EOL), and Log4j2 configs that predate the Log4Shell era. These must not be seeded.

### 2026 currency

- **Structured JSON logging (Boot 3.4).** First-class support for Elastic Common Schema (`ecs`), Graylog Extended Log Format (`gelf`), and Logstash (`logstash`) plus custom formats, enabled via `logging.structured.format.file` and `logging.structured.format.console`. [Spring Boot 3.4 Release Notes — Structured Logging](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.4-Release-Notes#structured-logging)
- **Log4Shell — CVE-2021-44228.** RCE in Log4j 2.0-2.14.1; fix is Log4j 2.17.1, which cumulatively covers the follow-on CVEs (-45046, -45105, -44832). The base's "pin ≥ 2.17.x" guidance holds. [Tenable — Log4Shell FAQ](https://www.tenable.com/blog/cve-2021-44228-cve-2021-45046-cve-2021-4104-frequently-asked-questions-about-log4shell)
- **The Logback default, SLF4J facade, and `/loggers` runtime control carry forward unchanged** — only the structured-logging capability is net-new. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
