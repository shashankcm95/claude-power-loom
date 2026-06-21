---
kb_id: web-ui/javax-jakarta-migration
version: 1
tags:
  - web-ui
  - jakarta
  - migration
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: apache-tapestry, struts-2, wicket, wildfly, ninja, vraptor, vaadin, play-framework, google-web-toolkit"
  - "Apache Software Foundation announces Apache Wicket v10 (news.apache.org/foundation/entry/apache-software-foundation-announces-apache-wicket-v10)"
related:
  - web-ui/action-mvc-frameworks
  - web-ui/component-stateful-ui
  - web-ui/server-side-ui-vaadin-gwt
  - web-ui/ratpack-reactive-handler-chain
  - web-ui/micro-functional-frameworks
  - web-ui/play-async-reactive
  - web-ui/realtime-websocket-webrtc
  - web-ui/javafx-desktop-ui
  - web-ui/jvm-templating-engines
  - web-ui/forms-validation-binding
  - web-ui/war-deployment-wildfly
status: active
---

## Summary

**Concept**: The single biggest 2026 caveat over this entire domain — every module touching servlet / CDI / validation / persistence / inject APIs is on **pre-Jakarta `javax.*`** and will not run on Jakarta EE 9+ / Spring Boot 3 / Spring 6 runtimes without migration. This is the cross-cutting "why none of this code runs on a current generation" theme plus the EOL/security posture beneath each framework name.
**Key facts**: `javax.servlet`/`javax.persistence`/`javax.validation`/`javax.inject`/`javax.enterprise` → `jakarta.*`; every maintained successor has crossed (Wicket 10, Hibernate 6+/7, Spring Boot 3+/4, Grails 7, Vaadin 24+/25, GWT 2.13); Spring Boot 2.x/Spring 5 baseline is out of OSS support (CVE-accruing).
**Gotcha**: a same-package rename (`javax.*` → `jakarta.*`) breaks every import; do NOT seed any `javax.*` import as current; EOL means "no security patches," not necessarily one named CVE.
**2026-currency**: this IS the currency doc — `javax→jakarta` is now the universal floor, not a caveat; Struts 2.x is the sharpest security flag (active RCE/DoS CVEs).
**Sources**: every module's freshness section; ASF Wicket v10; Hibernate 6 migration; HeroDevs Spring Boot EOL.

## Quick Reference

**The namespace flip** (`javax.*` → `jakarta.*`):
- `javax.servlet` → `jakarta.servlet` (Tapestry, GWT, Struts, Wicket, WildFly + `web.xml` 2.5/3.0 schemas).
- `javax.persistence` → `jakarta.persistence` (Ninja, VRaptor, Vaadin, Play).
- `javax.validation` → `jakarta.validation` (Bean Validation).
- `javax.inject` / `javax.enterprise` (CDI) → `jakarta.*` (VRaptor/Weld).

**Every maintained successor has already crossed**:
- Wicket 10 (Jakarta Servlet 5+, Java 17+), Hibernate 6+/7 (`jakarta.persistence.*`), Spring Boot 3+/4 (Spring 6/7), Grails 7, Vaadin 24+/25, GWT 2.13. The corpus's `javax.*` code is not just stale — it is **incompatible with the entire current generation**.

**EOL / dead / security-sensitive — do NOT recommend for new work**:
- **Struts 2.5.5** — long RCE/OGNL CVE history (S2-045, Equifax-era); whole 2.5.x EOL (no patches). **Strongest flag.**
- **Netflix Hystrix** (Ratpack) — EOL since 2018 → Resilience4j.
- **RxJava 1** (Ratpack) — EOL → RxJava 3.
- **Vaadin 8** — EOL (paid extended maint only).
- **VRaptor 4.2.0** — abandoned; native Hibernate `Criteria` removed in Hibernate 6.
- **GWT 2.8.2 / Blade 2.0.14 / Grails 3.3.3 / Wicket 7.5.0 / Ratpack 1.5.4 / Ninja 6.5.0 / Jooby 1.1.3** — all ~2016-2018, EOL, low-activity.

**Other staleness traps**:
- JavaFX removed from the JDK at 11 (OpenJFX); `jcenter()` shut down 2021; Akka relicensed BSL → Pekko; Jooby 1.x → 2.x full rewrite.

**Current (mid-2026)**: `javax→jakarta` is the **universal floor, not a caveat**. The framework taxonomy and "why these exist" framing are intact; what moved beneath every name is the version, license, namespace, and security posture.

## Full content

This is the cross-cutting freshness doc for the whole domain. The dominant 2026 reality is that **nearly every module here is on pre-Jakarta `javax.*`** and is incompatible with the current JVM web generation — and that several frameworks are EOL with no security patches.

### The javax → jakarta floor

When Java EE moved to the Eclipse Foundation as Jakarta EE, the namespace changed from `javax.*` to `jakarta.*` at Jakarta EE 9. Because it is a package rename, *every import breaks* — there is no runtime shim in the maintained successors. The affected APIs across this corpus: `javax.servlet` + `web.xml` 2.5/3.0 schemas (Tapestry, GWT, Struts, Wicket, WildFly); `javax.persistence` / `javax.validation` / `javax.inject` / `javax.enterprise` (Ninja, VRaptor, Vaadin, Play). Do **not** seed any `javax.*` import as current.

Every maintained successor has already crossed the line: [Apache Wicket 10](https://news.apache.org/foundation/entry/apache-software-foundation-announces-apache-wicket-v10) (Jakarta Servlet 5+, Java 17+), [Hibernate 6.0+](https://docs.hibernate.org/orm/6.0/migration-guide/)/7 (`jakarta.persistence.*`), Spring Boot 3+/4 on Spring 6/7, Apache Grails 7, Vaadin 24+/25, and GWT 2.13. So the corpus's `javax.*` code is not merely stale — it cannot compile against the current generation of any of these frameworks.

### EOL and security posture

Beyond the namespace, several frameworks are end-of-life:

- **Struts 2.5.5** is the sharpest flag — a long history of critical RCE/OGNL CVEs (S2-045 / Equifax-era) on a branch that is now EOL with no further patches. [CVE-2025-68493](https://www.herodevs.com/blog-posts/apache-struts-vulnerabilities-in-2026-critical-cves-still-unpatched) (CVSS 8.1) and [CVE-2025-64775](https://cybersecuritynews.com/apache-struts-2-dos-vulnerability/) (multipart DoS) are live; ~98% of recent downloads are still EOL 2.x ([Sonatype](https://www.sonatype.com/blog/years-old-apache-struts2-vulnerability-downloaded-325k-times-in-the-past-week)). Treat any `struts2-core` 2.x as exploitable. The fix is to leave 2.x for a supported line (6.1.1+, current 6.10.0 / 7.1.1) — see the action-MVC doc. [endoflife.date — Struts](https://endoflife.date/struts)
- **Netflix Hystrix** (Ratpack) — EOL since 2018; replace with [Resilience4j](https://docs.spring.io/spring-cloud-circuitbreaker/docs/current/reference/html/spring-cloud-circuitbreaker-resilience4j.html).
- **RxJava 1** (Ratpack) — EOL; current is [RxJava 3](https://github.com/ReactiveX/RxJava/releases).
- **Vaadin 8** — EOL (paid extended maintenance only).
- **VRaptor 4.2.0** — effectively abandoned; native Hibernate `Criteria`/`Restrictions` removed in Hibernate 6; dead `org.omg.*` (CORBA, removed at Java 11 / JEP 320); `org.hibernate.validator.constraints.Email` deprecated; jBCrypt 0.4 unmaintained.
- **GWT 2.8.2, Blade 2.0.14, Grails 3.3.3, Wicket 7.5.0, Ratpack 1.5.4/1.6.1, Ninja 6.5.0, Jooby 1.1.3** — all ~2016-2018, EOL, low-activity/niche.

For the EOL versions where no single named CVE was found (Wicket 7.5, Vaadin 8, Play 2.7, GWT 2.8.2, Grails 3.3.3, Ninja 6.5, Jooby 1.1.3), the sourced risk is "end-of-life, no security patches," not a specific advisory.

### The Spring baseline is also out of support

The corpus's Spring modules (Mustache, Vaadin Flow, WebRTC, WildFly) are on **Spring Boot 2.x / Spring 5 / JUnit 4**. Spring Boot 2.7 reached OSS EOL on 30 Jun 2023 — no security patches without a commercial subscription, so every Spring-integrated module sits on a CVE-accruing base. Move to 3.5 (until 30 Jun 2026) or 4.0. [HeroDevs — Spring Boot EOL](https://www.herodevs.com/blog-posts/spring-boot-versions-eol-dates-and-latest-releases-april-2026). Related: Spring Security OAuth (deprecated) is superseded by [Spring Authorization Server](https://spring.io/projects/spring-authorization-server/) (OAuth 2.1 / OIDC).

### Other staleness traps

- **JavaFX** removed from the JDK at JDK 11 (split to OpenJFX) — needs explicit deps + module path.
- **`jcenter()`** shut down (read-only) in 2021 — Ratpack-style Gradle builds must use Maven Central.
- **Akka relicensed to BSL** (Sept 2022) → Play 3.0 migrated to Apache Pekko.
- **Jooby 1.x → 2.x** is a full API rewrite — corpus code does not port.

### 2026 currency

This doc *is* the currency synthesis. The headline: **`javax→jakarta` is now the universal floor, not a caveat** — the whole maintained generation crossed it ([Wicket 10](https://news.apache.org/foundation/entry/apache-software-foundation-announces-apache-wicket-v10) · [Hibernate 6.0 migration](https://docs.hibernate.org/orm/6.0/migration-guide/)). At the concept level the domain still holds — it remains a tour of *alternative* JVM web frameworks and their templating/async/reactive idioms; what changed is the version, license, namespace, and security posture beneath each name. Two further net-new shifts reframe the lane: **virtual threads (JDK 21, [JEP 444](https://blog.marcnuri.com/java-virtual-threads-project-loom-complete-guide))** undercut the reactive frameworks' raison d'être, and modern AOT microframeworks ([Micronaut / Quarkus / Helidon / Javalin](https://www.infoworld.com/article/4066620/the-best-java-microframeworks-to-learn-now.html)) plus [Thymeleaf](https://www.thymeleaf.org/) are the current defaults the corpus's legacy stacks predate.
