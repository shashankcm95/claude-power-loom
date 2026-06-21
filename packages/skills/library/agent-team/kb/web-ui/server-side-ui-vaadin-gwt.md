---
kb_id: web-ui/server-side-ui-vaadin-gwt
version: 1
tags:
  - web-ui
  - vaadin
  - gwt
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: vaadin, google-web-toolkit"
  - "Vaadin Roadmap (vaadin.com/roadmap)"
related:
  - web-ui/component-stateful-ui
  - web-ui/forms-validation-binding
  - web-ui/javax-jakarta-migration
status: active
---

## Summary

**Concept**: Server-side UI written entirely in Java — no hand-authored HTML; the framework renders the DOM. Vaadin (the UI is a Java component tree) and GWT (Java client compiled to JavaScript) are the two members; both let you write the browser UI in Java but by opposite mechanisms (server-rendered vs cross-compiled).
**Key APIs**: Vaadin 8 `extends com.vaadin.ui.UI` + `Binder<T>` + `@Push`; Vaadin Flow `@Route` view + `@SpringComponent @UIScope` + `binder.bindInstanceFields(this)` + Spring Data JPA; GWT `EntryPoint.onModuleLoad()`, sync `RemoteService` + async `…Async` with `AsyncCallback<T>`, `GWT.create(Svc.class)`, `.gwt.xml` module descriptor.
**Gotcha**: GWT's async interface must mirror the sync interface name + `Async` and append `AsyncCallback<T>` to every method or `GWT.create` breaks; Vaadin 8 `@Push` `ScheduledExecutorService` is never shut down (thread leak); one Vaadin module ships two incompatible majors.
**2026-currency**: Vaadin 8 is EOL (extended-maint only), Flow is at LTS 25; GWT is at 2.13.0 but J2CL is the strategic Java→JS successor; modern SPAs (React/Angular/Vue) superseded both.
**Sources**: Baeldung `vaadin`/`google-web-toolkit`; Vaadin Roadmap; GWT versions page.

## Quick Reference

**The server-side-UI premise**: write the browser UI in Java; never author HTML. Two mechanisms:
- **Vaadin** — a server-held component tree; the framework syncs the DOM to the browser over a websocket/XHR bridge.
- **GWT** — your Java *client* code is cross-compiled to JavaScript at build time and runs in the browser.

**Vaadin 8** (GWT-based generation):
- `class VaadinUI extends com.vaadin.ui.UI { init(VaadinRequest req) {...} }` with an inner `@WebServlet VaadinServlet`.
- Binding: `Binder<T>.forField(field).withValidator(new StringLengthValidator(...)).bind(getter, setter)`.
- Server push: `@Push` + a `ScheduledExecutorService` updating a `Label`.

**Vaadin Flow** (modern generation, Spring-integrated):
- `@Route` annotated view; `@SpringComponent @UIScope` editor component.
- `binder.bindInstanceFields(this)` auto-binds fields by name; persistence via Spring Data `JpaRepository` + derived query `findByLastNameStartsWithIgnoreCase`, seeded with a `CommandLineRunner`.

**GWT** (Java→JS):
- Client entry: `class App implements EntryPoint { void onModuleLoad() {...} }`.
- GWT-RPC trio: a sync `RemoteService` interface, an async `…Async` interface (same name + `Async`, every method takes a trailing `AsyncCallback<T>`), and a server `…Impl`; the client gets a proxy via `GWT.create(Svc.class)`.
- Module descriptor `.gwt.xml`: `<inherits>`, `<source path='client'/>`, `<entry-point>`, `<add-linker name="xsiframe"/>`.

**Top gotchas**:
- **GWT async-mirror rule**: the async interface must mirror the sync interface's name + `Async` and append `AsyncCallback<T>` to *every* method, or `GWT.create` fails.
- **Vaadin 8 thread leak**: the `@Push` `ScheduledExecutorService` is never shut down → one leaked thread pool per UI.
- **Dual-version trap**: one Vaadin Maven module pins both 8.8.5 (`com.vaadin.ui.*`) and 13.0.9 (`com.vaadin.flow.*`) — fragile classpath coexistence; don't mix the two mental models.
- Vaadin uses `org.springframework.util.StringUtils.isEmpty` (deprecated/removed; use `!StringUtils.hasLength(...)`).

**Current (mid-2026)**: **Vaadin LTS 25** (25.1.8, Java 21 / Spring Boot 4.x); **Vaadin 8 is extended-maintenance-only** (8.31.1) and Vaadin 14 free support ended Aug 2024 ([Vaadin Roadmap](https://vaadin.com/roadmap)). **GWT 2.13.0** (11 Feb 2026) is still maintained, but **J2CL** is the strategic Java→JS successor. Modern JS/TS SPA frameworks (React/Angular/Vue) are what superseded GWT and Vaadin 8 in practice.

## Full content

Both Vaadin and GWT let a Java developer build a browser UI without authoring HTML — but by opposite mechanisms. Vaadin keeps the component tree on the *server* and synchronizes the DOM to the browser; GWT cross-compiles your Java *client* code to JavaScript at build time so it runs entirely in the browser, talking back to the server via RPC.

### Vaadin

Vaadin ships two incompatible generations in one teaching module. **Vaadin 8** (GWT-based) UI is a `com.vaadin.ui.UI` subclass with an `init(VaadinRequest)` method and an inner `@WebServlet VaadinServlet`. Data binding uses `Binder<T>`: `binder.forField(field).withValidator(new StringLengthValidator(...)).bind(getter, setter)`. Server push uses `@Push` plus a `ScheduledExecutorService` that updates a `Label` — and the teaching code never shuts that executor down, leaking a thread pool per UI. **Vaadin Flow** is the modern generation: views are `@Route`-annotated, an editor component is `@SpringComponent @UIScope`, `binder.bindInstanceFields(this)` auto-binds by field name, and persistence is Spring Data JPA (`JpaRepository`, derived queries like `findByLastNameStartsWithIgnoreCase`) seeded by a `CommandLineRunner`. The fragile part is the single Maven module pinning **both** 8.8.5 (`com.vaadin.ui.*`) and 13.0.9 (`com.vaadin.flow.*`) — two majors on one classpath.

### GWT

GWT compiles Java *client* code to JavaScript. The client entry point implements `EntryPoint.onModuleLoad()`. Server calls go through the GWT-RPC trio: a synchronous `RemoteService` interface, an asynchronous companion interface whose name is the sync name + `Async` and whose every method appends an `AsyncCallback<T>` parameter, and a server-side `…Impl`. The client obtains a proxy via `GWT.create(Svc.class)`. The build is driven by a `.gwt.xml` module descriptor (`<inherits>`, `<source path='client'/>`, `<entry-point>`, `<add-linker name="xsiframe"/>`). The defining gotcha is the async-mirror rule: if the async interface's name or method shapes don't mirror the sync interface exactly (name + `Async`, trailing `AsyncCallback<T>`), `GWT.create` breaks.

### 2026 currency

- **Vaadin 8 is EOL** (paid extended maintenance only — 8.31.1, 28 Apr 2026); Vaadin 14 free support ended Aug 2024. Current is **LTS 25** (25.1.8) on Java 21 / Spring Boot 4.x ([Vaadin Roadmap](https://vaadin.com/roadmap)). Flow concepts (`@Route`, `Grid`, `Binder`) carry forward; the v8 API is a dead generation.
- **GWT is still maintained** at **2.13.0** (11 Feb 2026), but **J2CL** is the strategic Java→JS successor ([GWT versions](https://www.gwtproject.org/versions.html)).
- **No named CVE was found for Vaadin 8 or GWT 2.8.2** in this pass; the sourced risk for the old versions is end-of-life exposure, not a single advisory.
- Both modules are pre-Jakarta `javax.*` (servlet/inject) — incompatible with the current generation (see the `javax→jakarta` migration doc). In practice, **modern JS/TS SPA frameworks (React/Angular/Vue) are what superseded GWT and Vaadin 8**; this corpus references them only as "what replaced" these stacks.
