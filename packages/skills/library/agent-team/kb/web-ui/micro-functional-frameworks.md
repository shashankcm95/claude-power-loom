---
kb_id: web-ui/micro-functional-frameworks
version: 1
tags:
  - web-ui
  - microframework
  - routing
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: blade, jooby"
  - "Jooby releases (github.com/jooby-project/jooby/releases)"
related:
  - web-ui/action-mvc-frameworks
  - web-ui/ratpack-reactive-handler-chain
  - web-ui/forms-validation-binding
  - web-ui/javax-jakarta-migration
status: active
---

## Summary

**Concept**: Micro / fluent-functional JVM web frameworks — fluent lambda routes declared from `main` on an embedded server, with both a script (lambda) style and an annotated-MVC style. Blade and Jooby. The lightweight, low-ceremony lane (the JVM answer to Sinatra/Express).
**Key APIs**: Blade `Blade.of().get(path, ctx -> …).start(App.class, args)`, `@Path` + `@GetRoute/@PostRoute`, `@Param`/`@PathParam`/`@HeaderParam`/`@MultipartParam FileItem`, `WebHook.before(ctx)`, `@Schedule(cron=…)`, `EventType.SERVER_STARTED`; Jooby `extends Jooby` initializer blocks `get/post`, `req.param(...).intValue()` (`Mutant`), `@Path` + `@GET` MVC, `Results.html(...).put(...)`, `MockRouter`/`JoobyRule`.
**Gotcha**: Blade `@MultipartParam` route must not contain a slash ("DO NOT USE A SLASH WITHIN THE ROUTE OR IT WILL BREAK"); Blade `env("key")` returns `Optional` but `env("key", default)` returns a plain value (two shapes); Jooby 1.x → 2.x/3.x is a full API rewrite.
**2026-currency**: Jooby is at 4.x (base 1.1.3 is ~4 majors behind, full rewrite — `Context` replaces `req`/`rsp`); Blade 2.0.14 is ~2018 niche; both pre-Jakarta.
**Sources**: Baeldung `blade`/`jooby`; Jooby GitHub releases.

## Quick Reference

**The microframework shape**: declare routes fluently from `main` on an embedded server; minimal config, optional annotated-MVC overlay.

**Blade** (fluent + annotated):
- Fluent: `Blade.of().get(path, ctx -> ctx.text("...")).start(App.class, args)`.
- Annotated controller: `@Path` + `@GetRoute`/`@PostRoute`; `@JSON RestResponse<?>` for JSON.
- Param injection: `@Param`, `@PathParam`, `@HeaderParam`, `@CookieParam`, `@MultipartParam FileItem`, plus VO binding (`@Param User user`).
- Middleware: `WebHook.before(ctx)`; global `@Bean` vs `.use(mw)` vs `.before("/user/*", …)`.
- Lifecycle/config: `EventType.SERVER_STARTED`/`SESSION_CREATED` + `BladeLoader`; `application.properties`; `@Schedule(cron="0 */1 * * * ?")`; static/CORS via `.addStatics(...)` / `.enableCors(true)`; error pages via `mvc.view.404/500` or `extends DefaultExceptionHandler`.

**Jooby** (script + MVC):
- Script: `class App extends Jooby { { get("/", req -> "..."); post("/x", req -> ...); } }` (initializer blocks).
- MVC: `@Path` + `@GET`; `Results.html("welcome").put("model", value)`.
- Coercion: `req.param("id").intValue()` via the `Mutant` wrapper.
- Lifecycle: `onStart`/`onStarted`/`onStop`; HOCON `application.conf`; assets via `assets(...)`.
- Testing: `MockRouter` (unit), `JoobyRule` + REST-assured (live).

**Top gotchas**:
- **Blade `@MultipartParam`**: an inline author warning — "DO NOT USE A SLASH WITHIN THE ROUTE OR IT WILL BREAK".
- **Blade return-shape inconsistency**: `env("key")` → `Optional`, but `env("key", default)` → a plain value.
- Route ordering: a first-registered catch-all shadows later routes.
- **Jooby 1.x → 2.x/3.x is a full API rewrite** — no longer `extends Jooby`; `Context`/`ctx` replaces `req`/`rsp`; different module system. Corpus code does not port.

**Current (mid-2026)**: **Jooby 4.x** (4.5.2, 3 Jun 2024); 3.x in maintenance (3.11.9) — the base's **1.1.3 is ~4 majors behind** and a full rewrite ([Jooby releases](https://github.com/jooby-project/jooby/releases)). **Blade 2.0.14** (~2018) is low-activity/niche. Both are pre-Jakarta `javax.*`; embedded Jetty pins are EOL.

## Quick note on the lane

These sit between the full-stack frameworks (Grails/Ninja) and the bare handler chain (Ratpack): more structure than Ratpack's chain, far less than Spring Boot. The selling point is low ceremony — a runnable web app in a few lines from `main`.

## Full content

Blade and Jooby are the corpus's micro/fluent-functional frameworks: you declare routes with lambdas straight from `main` on an embedded server, optionally layering an annotated-MVC style on top.

### Blade

Blade's fluent core is `Blade.of().get(path, ctx -> …).start(App.class, args)`. Its annotated style uses `@Path` + `@GetRoute`/`@PostRoute` on a controller, with `@JSON RestResponse<?>` for JSON responses. Parameter injection is rich: `@Param`, `@PathParam`, `@HeaderParam`, `@CookieParam`, `@MultipartParam FileItem`, and whole-VO binding (`@Param User user`). Middleware is a `WebHook.before(ctx)`, registered globally as a `@Bean`, per-instance via `.use(mw)`, or path-scoped via `.before("/user/*", …)`. Lifecycle hooks fire on `EventType.SERVER_STARTED`/`SESSION_CREATED` (plus a `BladeLoader`); scheduling is `@Schedule(cron="0 */1 * * * ?")`; static assets and CORS are `.addStatics(...)` / `.enableCors(true)`; global error handling is `extends DefaultExceptionHandler` or `mvc.view.404/500`. Two API quirks: the `@MultipartParam` route **must not contain a slash** (an inline author warning: "DO NOT USE A SLASH WITHIN THE ROUTE OR IT WILL BREAK"), and `env("key")` returns an `Optional` while `env("key", default)` returns a plain value — two different return shapes for the same conceptual call.

### Jooby

Jooby (1.x) offers a script style and an MVC style. The script style subclasses `Jooby` and registers routes in initializer blocks: `{ get("/", req -> "..."); post("/x", req -> ...); }`. The MVC style uses `@Path` + `@GET` controllers with `Results.html("welcome").put("model", value)`. Path-param coercion goes through a `Mutant` wrapper: `req.param("id").intValue()`. Lifecycle hooks are `onStart`/`onStarted`/`onStop`; config is HOCON `application.conf`; static assets are `assets(...)`. Testing is `MockRouter` for unit render tests and `JoobyRule` + REST-assured for live HTTP tests. The defining hazard is upgrade cost: **Jooby 1.x → 2.x/3.x is a full API rewrite** — the framework no longer uses `extends Jooby`, `Context`/`ctx` replaces `req`/`rsp`, and the module system is different, so corpus code does not port.

### 2026 currency

- **Jooby is at 4.x** (4.5.2, 3 Jun 2024) with 3.x in maintenance (3.11.9, 17 Jun 2024) — the base's **1.1.3 is ~4 majors behind** ([Jooby releases](https://github.com/jooby-project/jooby/releases)), and because 1.x → 2.x was a clean-sheet rewrite, none of the corpus's `extends Jooby` code carries over.
- **Blade 2.0.14** (~2018) is low-activity/niche; no fresh CVE was found in this pass — the sourced risk is end-of-life exposure, not a single advisory.
- Both ship old embedded Jetty (EOL) and are pre-Jakarta `javax.*` — incompatible with Jakarta EE 9+ / Spring Boot 3+ runtimes (see the `javax→jakarta` migration doc).
- **Virtual threads (JDK 21, [JEP 444](https://blog.marcnuri.com/java-virtual-threads-project-loom-complete-guide))** plus modern AOT microframeworks ([Micronaut / Quarkus / Helidon / Javalin](https://www.infoworld.com/article/4066620/the-best-java-microframeworks-to-learn-now.html)) are the current low-ceremony lane these stacks competed in.
