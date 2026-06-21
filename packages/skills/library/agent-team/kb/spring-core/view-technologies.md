---
kb_id: spring-core/view-technologies
version: 1
tags:
  - spring-core
  - view-templates
  - thymeleaf
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-thymeleaf / spring-mvc-forms-thymeleaf / spring-freemarker / spring-boot-jsp"
  - "Spring Framework Versions (official wiki, github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)"
related:
  - spring-core/spring-mvc-web-tier
status: active
---

## Summary

**Concept**: Server-side view engines render `@Controller` models to HTML; Thymeleaf is the modern Boot default, JSP/JSTL and FreeMarker are the alternatives.
**Key APIs**: Thymeleaf `th:*` attributes + `@{}`/`${}`/`#{}`/`*{}` expressions; `InternalResourceViewResolver`+`JstlView` (JSP); `FreeMarkerViewResolver`+`FreeMarkerConfigurer`.
**Gotcha**: JSP under Spring Boot needs `tomcat-embed-jasper` + WAR packaging — a fat JAR cannot serve JSPs from `WEB-INF`.
**2026-currency**: Thymeleaf migrates `thymeleaf-spring5` → `thymeleaf-spring6`; Velocity removed (Spring 5.1), Tiles EOL — Thymeleaf is the recommended engine.
**Sources**: Baeldung `spring-thymeleaf`/`spring-freemarker`/`spring-boot-jsp`; Spring Framework wiki.

## Quick Reference

**Thymeleaf** (modern Boot default):
- Expression kinds: `@{...}` URL, `${...}` variable, `#{...}` message, `*{...}` selection.
- Attributes: `th:text`/`th:href`/`th:src`/`th:each` (+ `iStat` status)/`th:if`/`th:unless`/`th:switch`/`th:case`/`th:field`/`th:with`/`th:classappend`/`th:errors`/`th:errorclass`/`th:inline`.
- Utility objects: `#dates` (java.util.Date) / `#temporals` (java.time via the Java8TimeDialect) / `#numbers` (`formatCurrency`) / `#strings` / `#bools` / `#lists` / `#fields`.
- Fragments: `th:fragment`/`th:insert`/`th:replace`/`th:include`; layout dialect `layout:decorate`.
- Plain-MVC wiring: `SpringTemplateEngine` + `ThymeleafViewResolver` + `SpringResourceTemplateResolver` (Boot autoconfigures it). CSRF token auto-injection in `th:action`.

**JSP + JSTL**: `InternalResourceViewResolver` + `JstlView`, `spring.mvc.view.prefix/suffix`; JSTL `<c:forEach>`/`<c:if>`/`<c:url>`; Spring form taglib (`form:form modelAttribute=`, `form:input/select/checkboxes/errors`). Under Boot needs `tomcat-embed-jasper` + WAR packaging.

**FreeMarker**: `FreeMarkerViewResolver` (name → view) + `FreeMarkerConfigurer` (`setTemplateLoaderPath` — where templates live); ops `??`/`???c` missing-value, `<#if>`/`<#list>`/`<#assign>`; Boot starter `spring-boot-starter-freemarker`.

**Top gotchas**:
- `java.util.Date` uses `#dates`; `java.time.*` needs the `Java8TimeDialect`/`#temporals`.
- A `th:with` variable is scoped to its element + descendants only.
- Thymeleaf indexed list binding needs `__${itemStat.index}__` preprocessing: `th:field="*{books[__${itemStat.index}__].title}"`.
- Pass server values into `<script>` via `th:inline="javascript"` + `/*[[${x}]]*/` (JS-escaped), never raw concatenation.

**Current (mid-2026)**: Thymeleaf is the recommended view engine; migrate `thymeleaf-spring5` → `thymeleaf-spring6` for Spring 6. Velocity view support was removed in Spring 5.1; Apache Tiles is Apache-retired (EOL 2019); Jade/Pug (jade4j) and Groovy markup are dead/niche.

## Full content

Spring MVC decouples controllers from rendering via the `ViewResolver` abstraction, so the same `@Controller` can drive Thymeleaf, JSP, or FreeMarker by swapping the resolver. Thymeleaf is the modern default because its templates are valid HTML (natural templating — designers can open them directly), it integrates Spring form binding and CSRF, and it ships rich utility objects.

### JSP's packaging constraint

JSP remains usable but carries a structural limitation under Spring Boot: a fat executable JAR cannot serve JSPs from `WEB-INF`, so JSP-on-Boot requires `tomcat-embed-jasper` and WAR packaging. This is the most common stumbling block when porting a classic JSP app to Boot.

### FreeMarker's two-bean split

FreeMarker wiring separates *which view* (`FreeMarkerViewResolver` maps a logical name to a template) from *where templates live* (`FreeMarkerConfigurer.setTemplateLoaderPath`). Forgetting the configurer means the resolver finds nothing.

### 2026 currency

Thymeleaf is in the base doc's durable core ("Thymeleaf as the recommended view engine"):

- **Thymeleaf Spring integration migrates `thymeleaf-spring5` → `thymeleaf-spring6`** for the Spring 6 / `jakarta.*` baseline; the `th:*` model is otherwise unchanged. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Velocity view support** was deprecated in Spring 4.3 and **removed in Spring 5.1** (the `spring-mvc-velocity` module is non-compilable); **Apache Tiles** is Apache-retired (2019). Do not adopt either for new work. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **MVC theme abstraction** (`ThemeResolver`/`ThemeChangeInterceptor`) is deprecated in Spring 6 — relevant where a Thymeleaf/Tiles view used themes. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Current versions (mid-2026)**: Spring Framework 7.0.8, Spring Boot 4.1.0; Java 17 floor. [Spring Boot | endoflife.date](https://endoflife.date/spring-boot)
