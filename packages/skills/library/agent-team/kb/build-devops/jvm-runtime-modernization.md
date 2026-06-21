---
kb_id: build-devops/jvm-runtime-modernization
version: 1
tags:
  - build-devops
  - jvm
  - performance
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: docker (heap-sizing), jmh, guest/remote-debugging"
  - "spring.io — Spring Boot CDS support and Project Leyden anticipation (https://spring.io/blog/2024/08/29/spring-boot-cds-support-and-project-leyden-anticipation/)"
related:
  - build-devops/docker-packaging
  - build-devops/jmh-benchmarking
  - build-devops/static-analysis-gates
  - build-devops/metrics-observability
status: active
---

## Summary

**Concept**: the net-new JVM runtime/packaging concerns that didn't exist (or weren't mainstream) in the 2021 base — virtual threads, AOT/CDS cold-start without GraalVM, and GraalVM native image — all of which intersect the container build/packaging story.
**Key APIs**: `spring.threads.virtual.enabled=true` (Boot 3.2+); JEP 483 AOT Class Loading & Linking (Java 24) = the JDK AOT-cache; Spring Boot 3.3+ CDS (out of the box, separate from the JDK AOT-cache); GraalVM native image (`spring-boot:build-image` / AOT processing); container heap via `ManagementFactory.getMemoryMXBean()`.
**Gotcha**: `synchronized` pinning of virtual threads in JDK 21 (improved later); GraalVM CE version line tracks but is distinct from the JDK GA; Oracle is shifting native-image focus to OpenJDK Project Leyden.
**2026-currency**: Java LTS is 25 (GA 2025-09-16, conservative default 21); virtual threads finalized in Java 21 (JEP 444); Spring Boot 3.3+ CDS cuts startup ~36-54% (~2x with AOT); the JDK AOT-cache is a separate JEP 483/Java 24 step; GraalVM 25 dropped the "for JDK" naming.
**Sources**: Baeldung `docker`(heap)/`jmh`/`remote-debugging`; spring.io CDS/Leyden.

## Quick Reference

**Virtual threads (Project Loom)** — finalized in **Java 21 via JEP 444**:
- Lightweight JVM-scheduled threads make "thread-per-request" scalable again.
- Spring Boot 3.2+ enables them via `spring.threads.virtual.enabled=true`.
- Pitfall: `synchronized` pinning in JDK 21 (improved in later JDKs).

**AOT startup without GraalVM — Project Leyden / CDS / AOT cache**:
- **JEP 483 (Ahead-of-Time Class Loading & Linking, Java 24)** is the first Leyden step in mainline OpenJDK.
- Spring Boot 3.3+ supports CDS out of the box (CDS alone cuts startup ~36-54%; ~2x with CDS+AOT). The JDK AOT-cache (Project Leyden, JEP 483 / Java 24) is a separate, later mechanism — not part of Boot 3.3.
- The non-GraalVM answer to container cold-start.

**GraalVM native image** — `GraalVM 25` (naming dropped "for JDK"); first-class in Spring Boot itself (AOT processing + `native` build, integrated since Boot 3.2 / Java 21). Oracle is shifting native-image AOT for the SE platform toward OpenJDK (Project Leyden).

**Container heap awareness**: `ManagementFactory.getMemoryMXBean().getHeapMemoryUsage().getMax()/getInit()`; pass flags via `JAVA_OPTS`. (Modern JVMs are container-aware by default, but explicit `-Xmx`/`-Xms` still matter.)

**Remote debugging (JDWP)**: `-agentlib:jdwp=transport=dt_socket,...` (runtime/IDE-side flags); a WAR-deployable Boot app via `SpringBootServletInitializer` is the debug target.

**Top gotchas**:
- `synchronized` pins a virtual thread to its carrier in JDK 21.
- GraalVM CE version line tracks but is distinct from the JDK GA (only "GraalVM 25" asserted).

**Current (mid-2026)**: Java LTS **25** (GA 2025-09-16; LTS cadence now every 2 years; conservative default 21). Target `<maven.compiler.release>21</maven.compiler.release>` or `25`. Temurin LTS windows: 21 → 2029-12-31, 25 → 2031-09-30.

## Full content

This doc collects the runtime/packaging concerns that the 2021 base predates but that now dominate JVM build/deploy decisions. The base only touches the edges (container heap sizing, JDWP remote debugging); the substance is the 2022-2026 net-new layer, all of which feeds back into how images are built and sized.

### Cold-start: virtual threads, AOT/CDS, native image

Three distinct answers to "make the JVM cheaper at runtime." Virtual threads (Loom, final in Java 21) make blocking thread-per-request code scale without async rewrites. CDS/AOT cache (Project Leyden's first mainline step, JEP 483 in Java 24) cuts startup time without GraalVM — directly relevant to container cold-start and the layered-jar packaging story. GraalVM native image is the most aggressive option (AOT-compiled native binary), now first-class in Spring Boot itself rather than a Quarkus-only differentiator. All three change how you build and size an image.

### Heap and debugging

The base's container-heap reading (`MemoryMXBean`) and JDWP remote-debugging mechanics still hold — modern JVMs are container-aware, but explicit heap flags and the JDWP transport string are unchanged.

### 2026 currency

- **Virtual threads (Project Loom)** — finalized in **Java 21 via JEP 444**. Spring Boot 3.2+ enables them via `spring.threads.virtual.enabled=true`. Pitfall: `synchronized` pinning in JDK 21 (improved in later JDKs). [JEP 444 coverage — Java 25 and the new age of performance](https://javapro.io/2026/03/05/java-25-and-the-new-age-of-performance-virtual-threads-and-beyond/) · [spring.io — Spring Boot 3.2, GraalVM, Java 21, virtual threads](https://spring.io/blog/2023/09/09/all-together-now-spring-boot-3-2-graalvm-native-images-java-21-and-virtual/)
- **AOT startup without GraalVM — Project Leyden / CDS / AOT cache** — **JEP 483 (Java 24)** is the first Leyden step in mainline OpenJDK; **Spring Boot 3.3+ supports CDS out of the box** (CDS alone cuts startup ~36-54%; ~2x with CDS+AOT). The JDK AOT-cache is the separate Leyden / JEP 483 (Java 24) mechanism, not a Boot 3.3 feature. [spring.io — Spring Boot CDS support and Project Leyden anticipation](https://spring.io/blog/2024/08/29/spring-boot-cds-support-and-project-leyden-anticipation/) · [bell-sw — Using Project Leyden with Spring Boot](https://bell-sw.com/blog/how-to-use-project-leyden-with-spring-boot/)
- **GraalVM 25** dropped the "for JDK" naming; Oracle is shifting GraalVM focus away from Java SE, advancing native-image AOT for the SE platform under OpenJDK (Project Leyden) instead. Only "GraalVM 25" is asserted (the CE line tracks but is distinct from the JDK GA). [graalvm.org — GraalVM CE 25 release notes](https://www.graalvm.org/release-notes/JDK_25/) · [ADTmag — Oracle Shifts GraalVM Focus Away from Java](https://adtmag.com/articles/2025/09/30/oracle-shifts-graalvm-focus-away-from-java.aspx)
- **Java LTS is 25** (GA 2025-09-16; cadence now every 2 years; conservative enterprise default 21). Temurin LTS windows: 21 → 2029-12-31, 25 → 2031-09-30; JDK 21 Oracle updates after Sep 2026 move to the paid OTN license (Temurin/Corretto remain free). [endoflife.date — Eclipse Temurin](https://endoflife.date/eclipse-temurin) · [Oracle Java SE Support Roadmap](https://www.oracle.com/java/technologies/java-se-support-roadmap.html)
