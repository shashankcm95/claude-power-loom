---
kb_id: web-ui/jvm-templating-engines
version: 1
tags:
  - web-ui
  - templating
  - mustache
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: mustache, ninja, vraptor, play-framework, grails, struts-2, apache-tapestry"
  - "Thymeleaf download / 3.1.x (thymeleaf.org/download.html)"
related:
  - web-ui/action-mvc-frameworks
  - web-ui/forms-validation-binding
  - web-ui/javax-jakarta-migration
status: active
---

## Summary

**Concept**: JVM server-side view-rendering engines — logic-less Mustache, plus the framework-specific engines (FreeMarker, Twirl, GSP, JSP, TML) each module ships. Mustache is the standalone exemplar (two Java implementations, different APIs); the others are seen as the default view layer of their host framework.
**Key APIs**: Mustache standalone `new DefaultMustacheFactory().compile(name).execute(writer, ctx).flush()` (`com.github.mustachejava`); Mustache-Spring `@Bean Mustache.Compiler` + `MustacheEnvironmentCollector`, `spring.mustache.suffix=.html` (`com.samskivert.mustache`); FreeMarker `.ftl` (`<#list>`, `${error!""}`); Twirl `.scala.html` (`views.html.index.render()`); GSP `<g:link>`/`<f:table>`; JSP + Struts taglib `<s:property>`; Tapestry TML `<t:zone>`.
**Gotcha**: Mustache ships **two engines** (`mustachejava` vs `samskivert` JMustache) with different APIs — don't mix mental models; logic-less means iteration/conditionals are expressed via sections, not code.
**2026-currency**: Mustache is still a supported Spring Boot view; **Thymeleaf 3.1.x** is the de facto modern Spring SSR default (the corpus's gap); GSP/JSP/TML are tied to legacy frameworks.
**Sources**: Baeldung `mustache` (+ host modules); Thymeleaf download page.

## Quick Reference

**Mustache** (logic-less, the standalone exemplar):
- Tags: `{{var}}` (escaped output), `{{{var}}}` (raw).
- Sections `{{#x}}…{{/x}}` — iterate a list OR conditionally render a single object.
- Inverted `{{^x}}…{{/x}}` — render when absent/empty/false.
- Partials `{{>partial}}` — poor-man's layout/include.
- Lambdas — a model method returning a `Function` invoked as a section, transforming the inner text.
- **Two engines**: standalone `mustache.java` (`com.github.mustachejava`) — `new DefaultMustacheFactory().compile(name).execute(writer, ctx).flush()`; vs Spring Boot's **JMustache** (`com.samskivert.mustache`) — `@Bean Mustache.Compiler` + `MustacheEnvironmentCollector`, `spring.mustache.suffix=.html`. Different APIs.

**FreeMarker** (`.ftl`): Ninja layout macros (`<@layout.myLayout>`); VRaptor `result.use(FreemarkerView.class).withTemplate(...)`, `<#list>`/`<#else>`, null-safe `${error!""}`, `?substring`/`?length`.

**Twirl** (`.scala.html`): Play — `views.html.index.render()`, `Html.apply(...)`.

**GSP + SiteMesh + Fields plugin**: Grails — `<g:link>`, `<g:form>`, `<f:table>`, `<f:all bean=…>`, layout via `<meta name="layout">`.

**JSP + taglib**: Struts — `<s:property value="carMessage"/>` reads the OGNL value stack.

**TML (Tapestry Markup)**: `<t:form>`, `<t:zone>`, `<t:body/>`, `${…}`, `${message:…}`.

**Component-rendered (no template language)**: Wicket (`wicket:id` binds HTML to Java components), Vaadin/GWT (Java builds the DOM directly).

**Top gotchas**:
- Mustache's **two engines have different APIs** — pick one and don't mix.
- Logic-less: there is no `if`/`for` — conditionals/iteration are sections (`{{#x}}`) and inverted sections (`{{^x}}`).
- FreeMarker null handling needs the `!` default operator (`${error!""}`) or it throws on a missing var.

**Current (mid-2026)**: Logic-less **Mustache remains a supported Spring Boot view**. **Thymeleaf 3.1.x** (3.1.5.RELEASE, 21 Apr 2026) is the de facto modern Spring server-side template ([Thymeleaf](https://www.thymeleaf.org/)) — and the corpus's named gap; Mustache/FreeMarker/JSP/GSP predate it as the mainstream default. GSP/JSP/TML are bound to their legacy host frameworks (Grails/Struts/Tapestry), all pre-Jakarta.

## Full content

The corpus shows a wide spread of server-side view engines, but only Mustache is taught standalone; the rest appear as the default view layer of their host framework. The common thread is that all of these render a model into HTML on the server (in contrast to Wicket/Vaadin/GWT, which build the DOM from Java with no template language).

### Mustache (logic-less)

Mustache is deliberately logic-less: the template has no `if`/`for`, only data tags and sections. `{{var}}` emits an HTML-escaped value (`{{{var}}}` raw). A section `{{#x}}…{{/x}}` does double duty — it iterates when `x` is a list and conditionally renders when `x` is a single truthy object. An inverted section `{{^x}}…{{/x}}` renders when `x` is absent/empty/false. Partials `{{>partial}}` include another template (the poor-man's layout). Lambdas let a model method return a `Function` that, used as a section, transforms the inner text. The trap is that the corpus uses **two different Java implementations**: standalone `mustache.java` (`com.github.mustachejava`) with `new DefaultMustacheFactory().compile(name).execute(writer, ctx).flush()`, and Spring Boot's **JMustache** (`com.samskivert.mustache`) wired with `@Bean Mustache.Compiler` + `MustacheEnvironmentCollector` and `spring.mustache.suffix=.html`. They have different APIs — don't carry one's idioms into the other.

### Framework-specific engines

The rest are each tied to a host framework: **FreeMarker** (`.ftl`) in Ninja (layout macros `<@layout.myLayout>`) and VRaptor (`result.use(FreemarkerView.class).withTemplate(...)`, `<#list>`/`<#else>`, null-safe `${error!""}`, `?substring`/`?length`); **Twirl** (`.scala.html`) in Play (`views.html.index.render()`, `Html.apply(...)`); **GSP** + SiteMesh + the Fields plugin in Grails (`<g:link>`, `<g:form>`, `<f:table>`, `<f:all bean=…>`, layout via `<meta name="layout">`); **JSP** + the Struts taglib in Struts (`<s:property value="carMessage"/>` reading the OGNL value stack); and **TML** in Tapestry (`<t:form>`, `<t:zone>`, `<t:body/>`, `${…}`, `${message:…}`). Wicket and Vaadin/GWT have no template language at all — Wicket binds HTML to Java via `wicket:id`, and Vaadin/GWT construct the DOM from Java.

### 2026 currency

- **Logic-less Mustache is still a supported Spring Boot view** — concept-level safe to seed.
- **Thymeleaf 3.1.x is the de facto modern Spring SSR template** ([Thymeleaf 3.1.5.RELEASE, 21 Apr 2026](https://www.thymeleaf.org/download.html)) and the corpus's explicit gap — Mustache/FreeMarker/JSP/GSP all predate it as the mainstream Spring default.
- **GSP/JSP/TML are bound to legacy host frameworks** (Grails/Struts/Tapestry) and inherit those frameworks' pre-Jakarta `javax.*` status (JSP/JSTL moved to `jakarta.servlet.jsp.*` in Jakarta EE 9+). See the `javax→jakarta` migration doc.
- **Bootstrap 2/3 + jQuery 2** class names appear across the Tapestry/Ninja/Mustache view templates; Bootstrap 3 is EOL — modern is **Bootstrap 5+** ([5.3.8, Aug 2025](https://versionlog.com/bootstrap/)).
