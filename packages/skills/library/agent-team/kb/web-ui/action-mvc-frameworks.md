---
kb_id: web-ui/action-mvc-frameworks
version: 1
tags:
  - web-ui
  - mvc
  - routing
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: struts-2, grails, vraptor, ninja, play-framework"
  - "Apache Grails 7.0 announcement (grails.apache.org/blog/2025-10-18-introducing-grails-7.html)"
related:
  - web-ui/component-stateful-ui
  - web-ui/micro-functional-frameworks
  - web-ui/play-async-reactive
  - web-ui/forms-validation-binding
  - web-ui/jvm-templating-engines
  - web-ui/war-deployment-wildfly
  - web-ui/javax-jakarta-migration
status: active
---

## Summary

**Concept**: Action-based (request) MVC on the JVM — a controller class exposes an action/`execute()` method, request params auto-bind to fields/args, and a named result selects a view. The alternative to Spring MVC's `@RequestMapping` model, spanning Struts 2, Grails, VRaptor, Play, and Ninja.
**Key APIs**: Struts `String execute()` + `@Action`/`@Result` + `StrutsPrepareAndExecuteFilter`; Grails `respond`/`redirect`/`allowedMethods` + GORM; VRaptor `@Controller` + type-safe `redirectTo(Ctrl.class).method()`; Play `extends Controller` returning `Result` (`ok()`/`badRequest()`); Ninja `router.GET().route("/users").with(Ctrl::method)`.
**Gotcha**: catch-all routes registered first shadow later routes; VRaptor `AuthController` falls through on a missing `return`; Grails injects services by property name (silent break on rename).
**2026-currency**: Struts 2.5.x EOL + RCE CVEs (move to 6.x/7.x); Grails now Apache 7.0 on Boot 3.5; Play 3.0 on Pekko; all on `javax.*`.
**Sources**: Baeldung `struts-2`/`grails`/`vraptor`/`ninja`/`play-framework`; Apache Grails 7.0 blog.

## Quick Reference

**The action-MVC shape**: a request maps to a method on a controller; framework binds params, runs the method, and a *named result* (not a returned view object) picks the view.

**Struts 2** (front-controller filter + OGNL value stack):
- POJO action with `String execute()`; annotations `@Namespace`/`@Action`/`@Result(name, location)`.
- `StrutsPrepareAndExecuteFilter` mapped on `/*` in `web.xml`; JSP reads the OGNL value stack: `<s:property value="carMessage"/>`.

**Grails** (Groovy convention framework, "Rails for Java"):
- Controllers + actions; `respond obj`, `redirect`, `allowedMethods = [save:"POST", delete:"DELETE"]`.
- Convention routing `/$controller/$action?/$id?`; data binding `new Student(params)` / `def save(Student s)`.
- GORM active-record persistence; services injected by matching property name (`StudentService studentService`).

**VRaptor** (CDI controllers via Weld):
- `@Controller`; `Result.include(k, v)`, `.use(FreemarkerView.class).withTemplate(...)`, type-safe `result.redirectTo(Ctrl.class).method()`.
- Validation flow: `validator.validate(bean); validator.onErrorRedirectTo(this).form()`.
- CDI idiom: a no-arg ctor **alongside** the `@Inject` ctor; `beans.xml` `bean-discovery-mode="all"` + Weld servlet listener.

**Play** (controller returning `Result`):
- `extends Controller`; `ok()`/`badRequest()`/`notFound()`/`created()`; text `conf/routes` file: `VERB path controllers.X.m(id: Int ?= 1)`.

**Ninja** (Java-DSL routing + Guice):
- `router.GET().route("/users").with(Ctrl::method)` in `conf/Routes.java`; `Results.html()`, `Results.json().render(obj)`, `Results.redirect(...)`.

**Top gotchas**:
- Route ordering: a catch-all (`/.*`, `*data`) placed first shadows everything after it.
- VRaptor `AuthController` password-mismatch branch redirects but **does not `return`** — falls through and still creates the user (security bug).
- Struts `CarAction` does `new CarMessageService()` directly (not injectable); its only test is 100% commented out.
- HTTP-verb guards: browser DELETE via a hidden `_method` form override.

**Current (mid-2026)**: Apache **Struts 7.1.1** (6.x still supported); 2.5.x **EOL 30 Apr 2024** with active RCE/DoS CVEs. **Apache Grails 7.0** (on Spring Boot 3.5.x) is now an ASF top-level project — the base's 3.3.3 is ~4 majors behind. **Play 3.0** (Pekko). VRaptor 4.2.0 is effectively abandoned. All are pre-Jakarta `javax.*`.

## Full content

Action-based MVC (also "request MVC") is the dominant non-Spring web model on the JVM. A request resolves to a controller method; the framework binds request parameters into method arguments or controller fields, executes the method, and a *named result* selects the response view — in contrast to component-based frameworks (Wicket/Tapestry) where the page is a stateful object tree.

### Struts 2

The classic front-controller pattern: `StrutsPrepareAndExecuteFilter` is mapped on `/*` and dispatches to a POJO action whose `String execute()` returns a result name (`"success"`, `"input"`, ...). Annotations `@Namespace`, `@Action`, and `@Result(name, location)` wire URLs to actions to views. The view layer is JSP + the Struts taglib reading the **OGNL value stack** (`<s:property value="carMessage"/>`). The teaching module has notable defects: `CarAction` instantiates its service directly (`new CarMessageService()`) so it isn't injectable, and the only test is entirely commented out — there is no runnable test.

### Grails

A Groovy convention-over-configuration full-stack framework. Controllers expose actions; `respond` and `redirect` drive responses; `allowedMethods = [save:"POST", delete:"DELETE"]` guards verbs. Routing is convention-based (`/$controller/$action?/$id?`). Data binding is implicit (`new Student(params)`, `def save(Student s)`). Persistence is GORM active-record (`Student.get/list/save/delete`, `@Transactional` services). DI is by-name: a `StudentService studentService` property is injected by matching its name — so renaming the property silently breaks DI.

### VRaptor

A CDI-first action framework bootstrapped by Weld. Controllers are `@Controller`-annotated; the `Result` object drives output (`Result.include(k, v)`, `.use(FreemarkerView.class).withTemplate(...)`), and redirects are type-safe (`result.redirectTo(IndexController.class).method()`). Validation uses `validator.validate(bean)` then `validator.onErrorRedirectTo(this).form()`. The load-bearing CDI idiom: a no-arg constructor must sit **alongside** the `@Inject` constructor, and `META-INF/beans.xml` must declare `bean-discovery-mode="all"` with the Weld servlet listener. The teaching `AuthController` has a security-relevant bug: the password-mismatch branch calls `redirectTo(...).registrationForm()` but omits `return`, so control falls through and the user is still created.

### Play

Play controllers `extends Controller` and return a `Result` via helpers `ok()`, `badRequest()`, `notFound()`, `created()`. Routing is a text `conf/routes` file (`VERB path controllers.X.method(params)`) with typed/default/optional params, regex constraints, and wildcards (covered further in the Play async/reactive doc).

### Ninja

A full-stack "Rails for Java" with a Java-DSL router: `router.GET().route("/users").with(Ctrl::method)` in `conf/Routes.java`. Results are produced by `Results.html()`, `Results.json().render(obj)`, `Results.redirect(...)`. Ninja uses Guice DI, Bean Validation, i18n/flash scope, and a `NinjaDocTester` test harness. A first-registered catch-all `/.*` route shadows everything below it.

### 2026 currency

- **Apache Struts: leave 2.x entirely.** The whole 2.5.x branch is **EOL since 30 Apr 2024** ([endoflife.date — Struts](https://endoflife.date/struts)) with no further patches. Current is **7.1.1** (18 Oct 2025); 6.x is still supported (6.10.0). [CVE-2025-68493](https://www.herodevs.com/blog-posts/apache-struts-vulnerabilities-in-2026-critical-cves-still-unpatched) (CVSS 8.1) affects 2.x/6.0.0–6.1.0, fixed in 6.1.1; [CVE-2025-64775](https://cybersecuritynews.com/apache-struts-2-dos-vulnerability/) is a multipart DoS. ~98% of recent Struts downloads are still EOL 2.x ([Sonatype](https://www.sonatype.com/blog/years-old-apache-struts2-vulnerability-downloaded-325k-times-in-the-past-week)) — treat any `struts2-core` 2.x in a tree as exploitable.
- **Grails is now an Apache project.** [Apache Grails 7.0](https://grails.apache.org/blog/2025-10-18-introducing-grails-7.html) (18 Oct 2025) is built on Spring Boot 3.5.x; the base's "Grails 3.3.3" is ~4 majors behind.
- **Play 3.0 (Oct 2023)** swapped Akka for Apache Pekko ([Play 3.0 Migration](https://www.playframework.com/documentation/3.0.x/Migration30)); Play 2.9 is the last Akka line.
- **VRaptor 4.2.0** is effectively abandoned (Caelum); its native Hibernate `Criteria`/`Restrictions` were [removed in Hibernate ORM 6](https://docs.hibernate.org/orm/6.0/migration-guide/).
- **All action-MVC modules here are pre-Jakarta `javax.*`** and incompatible with Jakarta EE 9+ / Spring Boot 3+ runtimes — see the `javax→jakarta` migration doc.
