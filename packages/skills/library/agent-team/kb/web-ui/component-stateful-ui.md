---
kb_id: web-ui/component-stateful-ui
version: 1
tags:
  - web-ui
  - components
  - stateful
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: wicket, apache-tapestry"
  - "Apache Software Foundation announces Apache Wicket v10 (news.apache.org/foundation/entry/apache-software-foundation-announces-apache-wicket-v10)"
related:
  - web-ui/action-mvc-frameworks
  - web-ui/server-side-ui-vaadin-gwt
  - web-ui/forms-validation-binding
  - web-ui/javax-jakarta-migration
status: active
---

## Summary

**Concept**: Component-based, stateful UI — a page is a Java class paired with a markup template; the UI is a tree of component objects, interaction happens through component behaviors (not request actions), and page state is serialized between requests. Apache Wicket and Apache Tapestry.
**Key APIs**: Wicket `WebPage` + `add(new Label("hello", model))`, `wicket:id` HTML binding, `mountPage(path, Class)`, `PropertyModel<>(bean, "prop")`, `AjaxFormComponentUpdatingBehavior`; Tapestry `@Property`, magic `onActivate`/`on<Event>From<ComponentId>`, `<t:zone>` + `AjaxResponseRenderer.addRender`, IoC `ServiceBinder.bind`/`RequestFilter`.
**Gotcha**: Wicket state held by components must be `Serializable`; AJAX targets require `setOutputMarkupId(true)` or the partial update silently fails; Tapestry handlers matched by name (a typo = no handler, no error).
**2026-currency**: Wicket 10 (Mar 2024) is fully on Jakarta (Java 17+, Jakarta Servlet 5+); base Wicket 7.5 / Tapestry are pre-Jakarta `javax.*`.
**Sources**: Baeldung `wicket`/`apache-tapestry`; ASF Wicket v10 announcement.

## Quick Reference

**The component model**: the page is an object tree. You add component objects in Java; an HTML template binds to them by id. There are no "actions" — interaction flows through component behaviors/event handlers. The framework serializes page state between requests, so every retained field must be `Serializable`.

**Wicket**:
- `class HelloWorld extends WebPage { add(new Label("hello", "Hello World!")); }`; the HTML uses `<span wicket:id="hello">…</span>` to bind.
- Models: `PropertyModel<>(bean, "prop")` reads/writes a bean property reflectively.
- Mounting: `mountPage("/path", HelloWorld.class)` in the `WebApplication` subclass.
- AJAX: `AjaxFormComponentUpdatingBehavior("onchange")` → `onUpdate(target)` → `target.add(component)`; **requires `setOutputMarkupId(true)`** on the target or the update silently no-ops.
- Testing: `WicketTester` renders a page + `assertRenderedPage(...)`.

**Apache Tapestry**:
- Page = a Java class + a `.tml` template; `@Property` exposes fields; magic methods `onActivate(...)`, `on<Event>From<ComponentId>()` are matched **by name**.
- TML markup: `<t:form>`, `<t:zone>`, `<t:body/>`, `${expr}`, `${message:key}`.
- AJAX zone: `<t:zone id="...">` + `AjaxResponseRenderer.addRender(zoneId, block)` for server-driven partial render (no hand-written JS).
- Tapestry IoC: module classes + `ServiceBinder.bind(...)`, `MappedConfiguration` symbol contributions, request-pipeline `RequestFilter` contributed via `@Contribute` + `@Local`.

**Top gotchas**:
- **Magic-by-name failures**: a Tapestry `on<Event>From<ComponentId>` typo means no handler fires — no error.
- **Serialization**: anything held by a stateful Wicket component must be `Serializable`.
- **AJAX id requirement**: `setOutputMarkupId(true)` is mandatory for AJAX targets.
- Tapestry teaching code hardcodes `HMAC_PASSPHRASE = "change this immediately"`; Wicket has two `HelloWorld` classes in different packages and tests under a non-standard `src/main/test/java` root.

**Current (mid-2026)**: **Apache Wicket 10** (10.0 = 12 Mar 2024; latest 10.9.0, 5 May 2026) requires **Java 17+** and **Jakarta Servlet 5+** — fully off `javax.*`. The base's Wicket 7.5.0 predates that migration. Tapestry remains niche; concepts (component tree, IoC pipeline, AJAX zones) carry forward but the corpus code is pre-Jakarta.

## Full content

Component-based frameworks invert the action-MVC model: instead of routing a request to a method, the framework reconstructs a *stateful page object tree* per request, dispatches the interaction to a component's behavior/event handler, and re-renders. The developer thinks in widgets (labels, forms, zones), not in request/response pairs. The price is server-held state — page state is serialized between requests, which constrains what fields a component may retain and adds memory/serialization overhead per session.

### Wicket

A Wicket page is a `WebPage` subclass that programmatically `add()`s components; the paired HTML binds via `wicket:id` attributes (`<span wicket:id="hello">`). Models bridge components to data: `PropertyModel<>(bean, "propName")` reflectively reads/writes a bean property. Pages are mounted with `mountPage("/path", PageClass.class)` in the `WebApplication` subclass. AJAX uses behaviors: `AjaxFormComponentUpdatingBehavior("onchange")` overrides `onUpdate(AjaxRequestTarget target)`, which calls `target.add(component)` to repaint — but only if the component had `setOutputMarkupId(true)`, otherwise the partial update silently fails. Because page state is serialized between requests, **anything a stateful component holds must be `Serializable`**. Testing uses `WicketTester` to render and `assertRenderedPage`.

### Apache Tapestry

A Tapestry page is a Java class plus a `.tml` template. `@Property` exposes fields to the template; lifecycle and event handling go through *magic methods* matched **by name** — `onActivate(...)` for page activation and `on<Event>From<ComponentId>()` for component events. A typo in such a method name means the handler simply never fires, with no error — the framework's most common silent-failure trap. Templates use TML components (`<t:form>`, `<t:zone>`, `<t:body/>`) and expansions (`${expr}`, `${message:key}`). Server-driven AJAX uses `<t:zone>` plus `AjaxResponseRenderer.addRender(zoneId, block)` to re-render a region without authoring JS. Tapestry's IoC container wires services via module classes and `ServiceBinder.bind(...)`, with `MappedConfiguration` symbol contributions and request-pipeline `RequestFilter`s contributed via `@Contribute` + `@Local`. The teaching code carries a hardcoded `HMAC_PASSPHRASE = "change this immediately"` (the comment itself warns) and mixes `tapestry_5_4.xsd`/`tapestry_5_3.xsd` template schemas.

### 2026 currency

- **Apache Wicket migrated to Jakarta in Wicket 10.** [Wicket 10](https://news.apache.org/foundation/entry/apache-software-foundation-announces-apache-wicket-v10) (10.0 = 12 Mar 2024; current 10.9.0, 5 May 2026) requires **Java 17+** and **Jakarta Servlet 5+**, fully off `javax.*`. The base's Wicket 7.5.0 predates that and will not run on a Jakarta runtime without migration.
- **No named CVE was found for Wicket 7.5.0** in this pass; the sourced risk is end-of-life exposure (no security patches on the old line), not a single advisory.
- **Tapestry** stays a niche framework. The *concepts* — a stateful component tree, an IoC request pipeline, and server-rendered AJAX zones — carry forward, but the corpus code is pre-Jakarta `javax.*` and incompatible with the current generation (see the `javax→jakarta` migration doc).
