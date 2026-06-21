---
kb_id: jvm-languages/javalite-activerecord-web
version: 1
tags:
  - jvm-languages
  - javalite
  - web
  - orm
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: java-lite"
  - "CVE-2019-10172 (NVD) (https://nvd.nist.gov/vuln/detail/CVE-2019-10172)"
related:
  - jvm-languages/clojure-ring-web
  - jvm-languages/polyglot-scripting-interop
status: active
---

## Summary

**Concept**: JavaLite — a Rails-like Java web stack: ActiveJDBC (ActiveRecord ORM via build-time bytecode instrumentation), ActiveWeb (convention-routed MVC), and Guice DI.
**Key APIs**: empty `class Product extends Model` + `findAll`/`findById`/`findFirst("name = ?", ...)`/`saveIt`; `Base.open/close`; `AppController` actions + `@RESTful`; FreeMarker `.ftl` views; per-controller filters; Guice `bind().to().asEagerSingleton()` + `@javax.inject.Inject`.
**Gotcha**: ActiveJDBC REQUIRES the build-time `activejdbc-instrumentation` step — without it the empty `Model` subclass fails at runtime; the live-MySQL CRUD test is commented out (`//@Test`).
**2026-currency**: niche/low adoption (Spring Boot dominates); `javax.inject` → `jakarta.inject` for Jakarta EE 9+; Jackson 1.x (java-lite's JSON) has CVE-2019-10172 (XXE) — migrate to `com.fasterxml.jackson`.
**Sources**: `java-lite` module; CVE-2019-10172 (NVD).

## Quick Reference

**ActiveJDBC (ActiveRecord ORM)** — the model is an EMPTY class; columns are inferred from the DB table via build-time bytecode instrumentation:

```java
public class Product extends Model {}   // columns inferred from the table

Base.open(driver, url, user, pass);
Product p = new Product();
p.set("name", "Widget"); p.saveIt();    // dynamic attrs: set/get/fromMap/delete
Product.findAll();
Product.findById(1);
Product.findFirst("name = ?", "Widget");
Base.close();
```

**ActiveWeb (MVC)** — convention routing:

- `RequestDispatcher` filter, `root_controller`, static `exclusions`
- Controllers extend `AppController`; each public method is an action
- `@RESTful` auto-maps the 7 REST actions
- Views are FreeMarker `.ftl` under `WEB-INF/views/`
- Request data: `param()` / `getId()` / `getRequestString()`
- Hooks: `getContentType()` / `getLayout()` (null disables the layout)
- Filters: `addGlobalFilters`, per-controller `add(new DBConnectionFilter()).to(ProductsController.class)` — DB connection managed per controller

**Guice DI**: `Bootstrap.getInjector()` from an `AbstractModule` (`bind(X).to(XImpl).asEagerSingleton()`); field injection via `@javax.inject.Inject`.

**JSON REST**: request body → Map via legacy Jackson 1.x `org.codehaus.jackson.map.ObjectMapper`.

**Testing**: `ControllerSpec` + `request().param().get(action)`; `a(responseContent()).shouldContain(...)`; `setInjector(...)` for test DI.

**Current (mid-2026)**: niche, low adoption — Spring Boot dominates this space. Migrate `javax.inject` → `jakarta.inject` (Jakarta EE 9+), `mysql-connector-java` → `mysql-connector-j` (`com.mysql.cj.jdbc.Driver`), and OFF Jackson 1.x (CVE-2019-10172).

## Full content

JavaLite is a "Rails for Java" stack. The corpus covers its three pillars. Evidence: `java-lite/` (`app/models/*`, `app/controllers/*`, `app/services/*`, `app/config/*`, `WEB-INF/web.xml`, `ArticleControllerSpec.java`).

**ActiveJDBC** is an ActiveRecord-style ORM whose defining trick is the empty model: `class Product extends Model {}` declares no columns — they are inferred from the database table by a **build-time bytecode instrumentation** step (`activejdbc-instrumentation`). Without that step, the empty `Model` subclass fails at runtime, which is non-obvious to newcomers. Dynamic attribute access is `set`/`get`/`fromMap`/`saveIt`/`delete`; finders are `findAll`/`findById`/`findFirst("name = ?", ...)`; the connection lifecycle is `Base.open`/`Base.close`. Note the CRUD MySQL test is commented out (`//@Test`) because it hits a live `jdbc:mysql://localhost`.

**ActiveWeb** is the MVC layer with convention-over-configuration routing: a `RequestDispatcher` filter, a `root_controller`, and static `exclusions`. Controllers extend `AppController` and each public method is an action; `@RESTful` auto-maps the seven REST actions. Views are FreeMarker `.ftl` templates under `WEB-INF/views/`. Request data comes from `param()`/`getId()`/`getRequestString()`; response hooks include `getContentType()` and `getLayout()` (returning null disables the layout). Filters wire cross-cutting behaviour: `addGlobalFilters` for global ones, and per-controller `add(filter).to(Controller.class)` — the corpus manages the DB connection per controller this way.

**Dependency injection** uses Guice: `Bootstrap.getInjector()` constructs the injector from an `AbstractModule` (`bind(X).to(XImpl).asEagerSingleton()`), and fields are injected with `@javax.inject.Inject`. **JSON REST** decodes the request body into a `Map` via the legacy Jackson 1.x `org.codehaus.jackson.map.ObjectMapper`. **Testing** uses `ControllerSpec` with `request().param().get(action)`, fluent assertions like `a(responseContent()).shouldContain(...)`, and `setInjector(...)` for test-time DI.

### 2026 currency

- **JavaLite ActiveWeb/ActiveJDBC is niche with low 2026 adoption** — Spring Boot dominates this space. The concepts (ActiveRecord, convention routing, Guice DI) remain valid teaching material, but the stack is dated.
- **javax → jakarta is the dominant migration**: `javax.inject.Inject` → `jakarta.inject` for Jakarta EE 9+; the corpus's `web.xml` uses the very old web-app 2.5 / `java.sun.com` namespaces (modern is `jakarta.ee`). Spring Boot 3+ (Spring 6+) requires `jakarta.*`; tooling: OpenRewrite, Eclipse Transformer. [Spring Boot 3 / Jakarta migration](https://www.javacodegeeks.com/2024/12/spring-boot-3-and-the-move-to-jakarta-ee-what-developers-need-to-know.html)
- **Driver coordinates moved**: `mysql-connector-java 5.1.45` / `com.mysql.jdbc.Driver` → `mysql-connector-j` / `com.mysql.cj.jdbc.Driver`.
- **Security: Jackson 1.x is a dead, unpatched branch.** The 1.x branch java-lite uses (`org.codehaus.jackson:jackson-mapper-asl`) carries **CVE-2019-10172**, an XML external entity (XXE) flaw in `jackson-mapper-asl` 1.9.x. Current Jackson is `com.fasterxml.jackson` 2.x (3.x emerging), where databind CVEs are patched. Migrating java-lite off Jackson 1.x is the security action. [CVE-2019-10172 (NVD)](https://nvd.nist.gov/vuln/detail/CVE-2019-10172)
